// tracking.js — Motor de cámara: rostro → features → predicción (SPEC F1-1, F1-3; Iris etapa 1)
// El video se procesa 100% local: ningún frame sale del dispositivo (invariante de arquitectura).
//
// Motores:
//  - 'tasks'  : MediaPipe Tasks Vision · FaceLandmarker (por defecto desde 10/2026). Además de los
//               478 puntos entrega la pose de la cabeza y blendshapes de mirada (base del modo Iris híbrido).
//  - 'legacy' : @mediapipe/face_mesh (congelado desde 2022). Se usa como respaldo si FaceLandmarker no
//               inicia en el navegador, o a pedido con ?engine=legacy (para comparar en el benchmark).
// Los dos devuelven la MISMA topología de 478 puntos, así que las features del modo Rostro (nariz,
// landmark 1) son idénticas y las calibraciones guardadas siguen valiendo.

import { S } from './state.js';
import { phi, dot } from './regression.js';
import { poseFromMatrix, pickEyeBlendshapes, irisInEye } from './headpose.js';
import * as gaze from './gaze-model.js';
import { CONFIG } from './config.js';
import { showSyncToast, hideSyncToast, showInfoToast } from './ui.js';
import { buildSample, invalidSample } from './selection.js';
import { FrameScheduler, RollingStats, RateCounter } from './vision-scheduler.js';

const TASKS_VERSION = '1.1.0';
// M05: alojado en el proyecto (web/vendor) para funcionar sin conexión; el modelo lo guarda el Service Worker
const TASKS_BASE = `/vendor/mediapipe-tasks-vision-${TASKS_VERSION}`;
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const LEGACY_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe';

const params = new URLSearchParams(window.location.search);
const forcedEngine = params.get('engine'); // 'legacy' | 'tasks' | null
// M06: dónde corre la inferencia. 'main' (por defecto, el comportamiento probado) o 'worker' (?vision=worker,
// en evaluación hasta medirlo en el iPad). Si el worker falla, se vuelve al hilo principal.
let visionMode = params.get('vision') === 'worker' ? 'worker' : 'main';

// --- M06: mediciones (sin video ni datos personales) ---
const inferStats = new RollingStats(300);   // tiempo de inferencia por cuadro (ms)
const latencyStats = new RollingStats(300); // captura → resultado (ms)
const resultRate = new RateCounter();       // resultados nuevos por segundo
let droppedFrames = 0;
/** Métricas del motor para el diagnóstico (M06/M08). */
export function visionStats(now = performance.now()) {
    const r = (v) => (v === null ? null : Math.round(v * 10) / 10);
    return {
        mode: visionMode, engine: engineName, delegate: visionMode === 'worker' ? workerDelegate : landmarkerDelegate,
        inferP50: r(inferStats.percentile(0.5)), inferP95: r(inferStats.percentile(0.95)),
        latencyP50: r(latencyStats.percentile(0.5)), latencyP95: r(latencyStats.percentile(0.95)),
        resultsPerSec: resultRate.rate(now), dropped: droppedFrames + (scheduler ? scheduler.dropped : 0), samples: latencyStats.count,
        sampleAgeMs: latestSample ? Math.round(now - latestSample.capturedAt) : null
    };
}
let workerDelegate = null;
let scheduler = null;
let visionWorker = null;

// --- Estado público ---
/** Features crudas del modo activo: [fx, fy] o null si no hay rostro */
export let currentFeatures = null;
/** Datos completos del último frame (para el modo Iris híbrido y diagnóstico) */
export let faceData = null; // { landmarks, pose, eyes, iris, t }
/** Modo Iris: la cabeza está fuera de la pose de la calibración (cursor en pausa) */
export let headOutOfPose = false;
/** Motor en uso: 'tasks' | 'legacy' | null (todavía no inició) */
export let engineName = null;
/** Cuadros procesados por segundo (promedio móvil) */
export let fps = 0;

// --- M01: muestras con sesión, secuencia y momento de captura ---
// sessionId cambia al reiniciar la cámara o el motor (un resultado de la sesión anterior nunca reactiva
// el control); sequence crece con cada cuadro nuevo. La última muestra publicada es lo único que mira main.js.
let sessionId = 0;
let sequence = 0;
/** @type {import('./selection.js').TrackingSample|null} */
export let latestSample = null;
/** Revisión del perfil activo (M02) y geometría con la que se calibró: viajan en cada muestra */
let profileRevision = null;
function geometryId() { return `${window.innerWidth}x${window.innerHeight}`; }
function publishInvalid(reason) {
    latestSample = invalidSample(reason, { sessionId, sequence: ++sequence, now: performance.now(), mode: S.trackingMode });
    S.rawX = null; S.rawY = null;
}
/** Cámara en uso (M02: se guarda con el perfil). null hasta que arranca. */
export let cameraInfo = null;
/** Para diagnóstico: latencias captura→resultado de los últimos cuadros (ms) */
export const latencies = [];

// --- Modelo de la calibración ---
// CARA: pesos polinómicos sobre la nariz. OJOS: modelo híbrido cabeza+iris (gaze-model.js).
let weightsX = null;
let weightsY = null;
let gazeModel = null;
export function setWeights(wx, wy) { weightsX = wx; weightsY = wy; }
export function clearWeights() { weightsX = null; weightsY = null; gazeModel = null; profileRevision = null; }
export function hasWeights() { return S.trackingMode === 'OJOS' ? !!gazeModel : !!(weightsX && weightsY); }

/** Aplica un perfil de calibración guardado al modo. */
export function applyProfile(mode, profile) {
    profileRevision = profile?.revision || null;
    if (mode === 'OJOS') { gazeModel = profile?.model || null; return; }
    setWeights(profile.weightsX, profile.weightsY);
}

/**
 * Rostro: con pose (FaceLandmarker) → [giro, cabeceo] en decenas de grados (escala cercana a 1 para la regresión);
 * sin pose (motor legado) → posición de la nariz. Exportada para los tests.
 */
export function caraFeatures(fd) {
    if (fd.pose && Number.isFinite(fd.pose.yaw) && Number.isFinite(fd.pose.pitch)) return [fd.pose.yaw / 10, fd.pose.pitch / 10];
    if (engineName === 'tasks') return null; // cuadro sin pose con un perfil de ángulos: muestra inválida
    return [fd.landmarks[1].x, fd.landmarks[1].y];
}

// Extrae features según el modo.
//  CARA → [giro, cabeceo] de la cabeza (motor legado: nariz, landmark 1)
//  OJOS → vector crudo del modelo híbrido (necesita la pose de la cabeza: solo motor FaceLandmarker)
function extractFeatures(fd, mode) {
    if (mode === 'OJOS') return gaze.rawFeatures(fd);
    return caraFeatures(fd);
}

// Modo Iris: mediana por componente de los últimos N cuadros (quita picos de parpadeos/ruido sin retrasar
// tanto como un promedio). Se resetea al detener la cámara.
const medianBuf = [];
function medianFeatures(f) {
    medianBuf.push(f);
    while (medianBuf.length > CONFIG.GAZE_MEDIAN_FRAMES) medianBuf.shift();
    return f.map((_, i) => {
        const vals = medianBuf.map(v => v[i]).sort((a, b) => a - b);
        return vals[Math.floor(vals.length / 2)];
    });
}

function predict(features) {
    let x, y;
    if (S.trackingMode === 'OJOS') {
        [x, y] = gaze.predict(gazeModel, medianFeatures(features));
    } else {
        const f = phi(features[0], features[1]);
        x = dot(weightsX, f); y = dot(weightsY, f);
    }
    return [x, y]; // sin recortar: buildSample decide si está demasiado afuera (M01)
}

// Últimas features (2 s) para el aprendizaje implícito del modo Iris
const recent = [];
/** Features crudas de los últimos `ms` milisegundos (excluyendo los últimos `skipMs`). */
export function recentFeatures(ms, skipMs = 0) {
    const now = performance.now();
    return recent.filter(r => r.t >= now - ms && r.t <= now - skipMs).map(r => r.f);
}

// Procesamiento común a ambos motores
let fpsWindowStart = 0, fpsFrames = 0;
let waitingFirstFrame = false;
function onLandmarks(landmarks, extra = {}, capturedAt = performance.now()) {
    const now = performance.now();
    if (latencies.length >= 300) latencies.shift();
    latencies.push(now - capturedAt);
    latencyStats.push(now - capturedAt);
    resultRate.tick(now);
    if (waitingFirstFrame) { waitingFirstFrame = false; hideSyncToast(); }
    fpsFrames++;
    if (now - fpsWindowStart >= 1000) { fps = fpsFrames * 1000 / (now - fpsWindowStart); fpsFrames = 0; fpsWindowStart = now; }

    const sampleBase = { sessionId, sequence: ++sequence, capturedAt, receivedAt: now, mode: S.trackingMode,
        engineVersion: `${engineName || 'iniciando'}-${TASKS_VERSION}-${landmarkerDelegate}`, profileRevision, geometryId: geometryId(),
        viewport: { w: window.innerWidth, h: window.innerHeight } };
    if (!landmarks) {
        currentFeatures = null; faceData = null; headOutOfPose = false;
        // M01: sin cara no hay cursor en NINGÚN modo (antes en Rostro quedaba congelado y el dwell seguía)
        latestSample = buildSample({ ...sampleBase, face: false });
        S.rawX = null; S.rawY = null;
        return;
    }
    faceData = { landmarks, pose: extra.pose || null, eyes: extra.eyes || null, iris: irisInEye(landmarks), t: now };
    currentFeatures = extractFeatures(faceData, S.trackingMode);
    if (currentFeatures) {
        recent.push({ t: now, f: currentFeatures });
        while (recent.length && recent[0].t < now - 2000) recent.shift();
    }
    // Modo Iris v3: si la cabeza se alejó de la pose de la calibración, el modelo no es válido → pausa
    if (S.trackingMode === 'OJOS' && gazeModel && currentFeatures) {
        const dev = gaze.headDeviation(gazeModel, currentFeatures);
        // Histéresis: se pausa al pasar el umbral y se reanuda recién al volver por debajo del 75%
        // (evita que el aviso parpadee cuando la cabeza está justo en el límite)
        const k = headOutOfPose ? 0.75 : 1;
        headOutOfPose = dev.deg > CONFIG.GAZE_HEAD_TOLERANCE_DEG * k || dev.shift > CONFIG.GAZE_HEAD_SHIFT_TOL * k;
        if (headOutOfPose) { S.rawX = null; S.rawY = null; }
    } else {
        headOutOfPose = false;
    }
    // Parpadeo u ojos casi cerrados (modo Iris): el detector lo indica y la muestra es inválida
    const blink = S.trackingMode === 'OJOS' && faceData.iris && faceData.iris.open !== undefined && faceData.iris.open < gaze.BLINK_OPEN_RATIO;
    latestSample = buildSample({
        ...sampleBase, face: true, features: currentFeatures, blink, headOutOfPose,
        active: S.state === 'BOARD' || S.state === 'HOME' || S.state === 'PRACTICE',
        predict: hasWeights() ? predict : null
    });
    S.rawX = latestSample.valid ? latestSample.x : null;
    S.rawY = latestSample.valid ? latestSample.y : null;
}

// --- Motor 'tasks' (FaceLandmarker) ---
// Una sola instancia y una sola descarga aunque se alterne de modo mientras carga.
let landmarkerPromise = null;
let landmarkerDelegate = 'GPU';
let stream = null;    // stream del arranque VIGENTE (nunca lo asigna un arranque viejo)
let rafId = null;
let lastVideoTime = -1;

function getLandmarker(delegate = 'GPU') {
    if (!landmarkerPromise) {
        landmarkerPromise = (async () => {
            const vision = await import(`${TASKS_BASE}/vision_bundle.mjs`);
            const fileset = await vision.FilesetResolver.forVisionTasks(`${TASKS_BASE}/wasm`);
            const options = (d) => ({
                baseOptions: { modelAssetPath: FACE_MODEL, delegate: d },
                runningMode: 'VIDEO',
                numFaces: 1,
                outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: true
            });
            if (delegate === 'GPU') {
                try {
                    const lm = await vision.FaceLandmarker.createFromOptions(fileset, options('GPU'));
                    landmarkerDelegate = 'GPU';
                    return lm;
                } catch (e) {
                    console.warn('FaceLandmarker con GPU no disponible, uso CPU:', e?.message || e);
                }
            }
            landmarkerDelegate = 'CPU';
            return vision.FaceLandmarker.createFromOptions(fileset, options('CPU'));
        })().catch((e) => { landmarkerPromise = null; throw e; });
    }
    return landmarkerPromise;
}

/** La GPU inició pero falla en cada cuadro (algunos Android, contexto WebGL perdido): pasar a CPU. */
async function fallbackToCpu() {
    const old = landmarkerPromise;
    landmarkerPromise = null;
    try { (await old)?.close?.(); } catch { /* ignorar */ }
    return getLandmarker('CPU');
}

function withTimeout(promise, ms, what) {
    return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`Tiempo agotado: ${what}`)), ms))]);
}

async function openCamera(video, gen) {
    const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    if (gen !== generation) { s.getTracks().forEach(t => t.stop()); return null; } // arranque viejo: no tocar el vigente
    stream = s;
    const st = s.getVideoTracks()[0]?.getSettings?.() || {};
    cameraInfo = { width: st.width || null, height: st.height || null, frameRate: st.frameRate || null, facingMode: st.facingMode || 'user', mirror: false };
    s.getVideoTracks().forEach(tr => tr.addEventListener('ended', () => { if (gen === generation) publishInvalid('camera-ended'); }));
    video.muted = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.srcObject = s;
    await video.play();
    if (gen !== generation) return null;
    return s;
}

// --- M06: motor en un Web Worker (?vision=worker) ---
function workerSupported() {
    return typeof Worker !== 'undefined' && typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined';
}

async function startWorker(video, gen) {
    const w = new Worker(new URL('./vision-worker.js', import.meta.url), { type: 'module' });
    visionWorker = w;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('El motor en worker no inició a tiempo')), 30000);
        w.onmessage = (e) => {
            if (e.data?.type === 'ready') { clearTimeout(timer); workerDelegate = e.data.delegate; resolve(); }
            else if (e.data?.type === 'fatal') { clearTimeout(timer); reject(new Error(e.data.error)); }
        };
        w.onerror = (ev) => { clearTimeout(timer); reject(new Error(ev.message || 'error en el worker')); };
        w.postMessage({ type: 'init' });
    });
    if (gen !== generation) { w.terminate(); return false; }
    const s = await openCamera(video, gen);
    if (!s) { w.terminate(); return false; }

    scheduler = new FrameScheduler({
        send: (f) => w.postMessage({ type: 'frame', bitmap: f.bitmap, sessionId: f.sessionId, sequence: f.sequence, capturedAt: f.capturedAt }, [f.bitmap]),
        release: (f) => { try { f.bitmap && f.bitmap.close(); } catch { /* ya liberado */ } },
        timeoutMs: 2000
    });
    const failed = (why) => {
        if (gen !== generation) return;
        console.warn('Motor en worker caído, vuelvo al hilo principal:', why);
        publishInvalid('engine-error'); // la mirada se invalida ANTES de recuperar
        try { w.terminate(); } catch { /* nada */ }
        visionWorker = null; scheduler = null;
        visionMode = 'main';
        stopMediaPipe();
        startMediaPipe(); // sesión nueva, hilo principal: nunca se mezclan resultados de los dos motores
    };
    w.onmessage = (e) => {
        const d = e.data || {};
        if (d.type !== 'result' && d.type !== 'error') return;
        if (!scheduler || gen !== generation) return;
        const usable = scheduler.onResult(d, performance.now());
        if (!usable) return;
        if (d.type === 'error') { publishInvalid('engine-error'); return; }
        inferStats.push(d.inferMs);
        onLandmarks(d.landmarks, d.landmarks ? { pose: d.pose, eyes: d.eyes } : {}, d.capturedAt);
    };
    w.onerror = (ev) => failed(ev.message || 'error');

    const camFps = s.getVideoTracks()[0]?.getSettings?.().frameRate || 30;
    const minIntervalMs = 1000 / Math.min(camFps, 60) * 0.9;
    let lastDetect = 0, frameSeq = 0;
    const step = () => {
        if (gen !== generation) return;
        const tNow = performance.now();
        if (scheduler && scheduler.checkTimeout(tNow)) { failed('sin respuesta'); return; }
        if (scheduler && video.readyState >= 2 && video.currentTime !== lastVideoTime && tNow - lastDetect >= minIntervalMs) {
            lastVideoTime = video.currentTime;
            lastDetect = tNow;
            const capturedAt = tNow;
            const seq = ++frameSeq;
            createImageBitmap(video).then((bitmap) => {
                if (gen !== generation || !scheduler) { bitmap.close(); return; }
                scheduler.submit({ bitmap, sequence: seq, capturedAt }, performance.now());
            }).catch(() => { droppedFrames++; });
        }
        rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return true;
}

async function startTasks(video, gen) {
    if (visionMode === 'worker') {
        if (workerSupported()) {
            try { return await startWorker(video, gen); }
            catch (e) {
                if (gen !== generation) return false;
                console.warn('Motor en worker no disponible, uso el hilo principal:', e?.message || e);
                try { visionWorker && visionWorker.terminate(); } catch { /* nada */ }
                visionWorker = null; stopStream();
            }
        }
        visionMode = 'main';
    }
    let landmarker = await withTimeout(getLandmarker(), 25000, 'descarga del modelo');
    if (gen !== generation) return false; // se pidió detener mientras cargaba

    const s = await openCamera(video, gen);
    if (!s) return false;

    // Procesar como máximo al ritmo REAL de la cámara (normalmente 30 cps). Antes se procesaba en cada
    // refresco de pantalla (60-120 Hz) analizando varias veces la misma imagen: CPU de más en tablets.
    const camFps = s.getVideoTracks()[0]?.getSettings?.().frameRate || 30;
    const minIntervalMs = 1000 / Math.min(camFps, 60) * 0.9;
    let lastDetect = 0;

    let consecutiveErrors = 0;
    let recovering = false;
    const step = () => {
        if (gen !== generation) return;
        try {
            const tNow = performance.now();
            if (!recovering && video.readyState >= 2 && video.currentTime !== lastVideoTime && tNow - lastDetect >= minIntervalMs) {
                lastVideoTime = video.currentTime;
                lastDetect = tNow;
                const capturedAt = performance.now(); // momento de captura: viaja con el resultado aunque llegue tarde
                const res = landmarker.detectForVideo(video, capturedAt);
                inferStats.push(performance.now() - capturedAt);
                consecutiveErrors = 0;
                const lm = res.faceLandmarks && res.faceLandmarks[0];
                onLandmarks(lm || null, lm ? {
                    pose: poseFromMatrix(res.facialTransformationMatrixes?.[0]?.data),
                    eyes: pickEyeBlendshapes(res.faceBlendshapes?.[0]?.categories)
                } : {}, capturedAt);
            }
        } catch (e) {
            consecutiveErrors++;
            publishInvalid('engine-error'); // M01: un error invalida la mirada en el acto
            if (consecutiveErrors === 1) console.error('Error procesando cuadro (el loop sigue):', e);
            if (consecutiveErrors >= 30 && !recovering) {
                recovering = true;
                if (landmarkerDelegate === 'GPU') {
                    // Motor nuevo = sesión nueva: un resultado del motor anterior nunca se mezcla con el nuevo
                    fallbackToCpu().then(lm => { if (gen !== generation) return; sessionId++; landmarker = lm; consecutiveErrors = 0; recovering = false; })
                        .catch(() => { stopMediaPipe(); });
                } else {
                    console.error('FaceLandmarker falla también en CPU: se detiene la cámara.');
                    stopMediaPipe();
                }
            }
        }
        // rAF (no requestVideoFrameCallback): con el <video> oculto rVFC no garantiza callbacks.
        rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return true;
}

function stopStream() {
    if (visionWorker) { try { visionWorker.postMessage({ type: 'close' }); visionWorker.terminate(); } catch { /* nada */ } visionWorker = null; }
    if (scheduler) { scheduler.newSession(); scheduler = null; }
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    const video = document.getElementById('input-video');
    if (video) video.srcObject = null;
    lastVideoTime = -1;
}

// --- Motor 'legacy' (FaceMesh), cargado solo si hace falta ---
let faceMesh = null;
let camera = null;
let legacyCapturedAt = 0;

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if ([...document.scripts].some(s => s.src === src)) return resolve();
        const el = document.createElement('script');
        el.src = src; el.crossOrigin = 'anonymous';
        el.onload = resolve; el.onerror = () => reject(new Error('No cargó ' + src));
        document.head.appendChild(el);
    });
}

async function startLegacy(video, gen) {
    if (!window.FaceMesh) await loadScript(`${LEGACY_BASE}/face_mesh@0.4.1633559619/face_mesh.js`);
    if (!window.Camera) await loadScript(`${LEGACY_BASE}/camera_utils@0.3.1675466862/camera_utils.js`);
    if (gen !== generation) return false;
    if (!faceMesh) {
        faceMesh = new window.FaceMesh({ locateFile: (file) => `${LEGACY_BASE}/face_mesh@0.4.1633559619/${file}` });
        faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        faceMesh.onResults((results) => {
            const lm = results.multiFaceLandmarks && results.multiFaceLandmarks[0];
            onLandmarks(lm || null, {}, legacyCapturedAt);
        });
    }
    if (!camera) {
        camera = new window.Camera(video, {
            onFrame: async () => { legacyCapturedAt = performance.now(); await faceMesh.send({ image: video }); },
            width: 640, height: 480
        });
    }
    await camera.start();
    if (gen !== generation) { camera.stop(); return false; }
    return true;
}

// --- API pública (la usa main.js) ---
let generation = 0;
let running = false;

function cameraError(e) {
    const msg = e?.name === 'NotFoundError' ? 'No se encontró una cámara.'
        : e?.name === 'NotAllowedError' ? 'Sin permiso para usar la cámara: habilitalo en el navegador.'
        : 'No se pudo iniciar la cámara.';
    waitingFirstFrame = false;
    showInfoToast(msg, 7000);
}

export function startMediaPipe() {
    if (S.trackingMode === 'CLICKS' || S.trackingMode === 'SCAN') return;
    if (running) return;
    running = true;
    const gen = ++generation;
    sessionId++; // M01: sesión nueva
    publishInvalid('starting');
    const video = document.getElementById('input-video');

    const useLegacy = forcedEngine === 'legacy' || engineName === 'legacy';
    // La primera vez descarga el modelo (~4 MB): avisar hasta que llegue el primer cuadro
    waitingFirstFrame = true;
    showSyncToast('Preparando la cámara…');
    (async () => {
        if (!useLegacy) {
            try {
                if (await startTasks(video, gen)) engineName = 'tasks';
                return;
            } catch (e) {
                if (gen !== generation) return; // un arranque viejo nunca toca el estado del vigente
                stopStream();
                if (e?.name === 'NotAllowedError' || e?.name === 'NotFoundError') {
                    console.error('Sin acceso a la cámara:', e.name);
                    cameraError(e);
                    running = false;
                    return; // no es un problema del motor: el legado tampoco tendría cámara
                }
                console.warn('FaceLandmarker no pudo iniciar; uso el motor legado:', e?.message || e);
                if (forcedEngine === 'tasks') { cameraError(e); running = false; return; }
            }
        }
        try {
            if (await startLegacy(video, gen)) engineName = 'legacy';
        } catch (e) {
            if (gen !== generation) return;
            console.error('No se pudo iniciar la cámara:', e);
            cameraError(e);
            running = false;
        }
    })();
}

// --- Recuperación de la cámara (pista terminada, congelada o tomada por otra app) ---
// Con la página visible y sin cuadros nuevos por más de 2,5 s, se reinicia la cámara con espera creciente
// (2, 4, 8… hasta 30 s). Mientras tanto la mirada está inválida (M01): nunca se selecciona con datos viejos.
let lastRestart = 0, restartDelay = 2000;
if (typeof window !== 'undefined' && typeof setInterval === 'function') {
    setInterval(() => {
        if (!running || waitingFirstFrame || (typeof document !== 'undefined' && document.hidden)) return;
        const now = performance.now();
        const age = latestSample ? now - latestSample.receivedAt : Infinity;
        if (latestSample && latestSample.reason === 'starting') return;
        if (age < 2500) { restartDelay = 2000; return; }
        if (now - lastRestart < restartDelay) return;
        lastRestart = now;
        restartDelay = Math.min(restartDelay * 2, 30000);
        console.warn('La cámara no envía cuadros: reinicio');
        stopMediaPipe();
        startMediaPipe();
    }, 1000);
}

export function stopMediaPipe() {
    generation++; // invalida cualquier arranque en curso
    if (waitingFirstFrame) { waitingFirstFrame = false; hideSyncToast(); }
    stopStream();
    if (camera) camera.stop();
    running = false;
    sessionId++;
    publishInvalid('stopped');
    currentFeatures = null;
    faceData = null;
    recent.length = 0;
    medianBuf.length = 0;
    headOutOfPose = false;
}
