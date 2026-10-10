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
import { showSyncToast, hideSyncToast, showInfoToast } from './ui.js';

const TASKS_VERSION = '1.1.0';
const TASKS_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`;
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const LEGACY_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe';

const params = new URLSearchParams(window.location.search);
const forcedEngine = params.get('engine'); // 'legacy' | 'tasks' | null

// --- Estado público ---
/** Features crudas del modo activo: [fx, fy] o null si no hay rostro */
export let currentFeatures = null;
/** Datos completos del último frame (para el modo Iris híbrido y diagnóstico) */
export let faceData = null; // { landmarks, pose, eyes, iris, t }
/** Motor en uso: 'tasks' | 'legacy' | null (todavía no inició) */
export let engineName = null;
/** Cuadros procesados por segundo (promedio móvil) */
export let fps = 0;

// --- Pesos de la calibración ---
let weightsX = null;
let weightsY = null;
export function setWeights(wx, wy) { weightsX = wx; weightsY = wy; }
export function clearWeights() { weightsX = null; weightsY = null; }
export function hasWeights() { return !!(weightsX && weightsY); }

// Extrae features según el modo. Devuelve [fx, fy] o null. (Idéntico al motor anterior.)
function extractFeatures(landmarks, mode) {
    if (mode === 'OJOS') {
        const avgPupilX = (landmarks[473].x + landmarks[468].x) / 2;
        const avgPupilY = (landmarks[473].y + landmarks[468].y) / 2;
        const anchorX = (landmarks[33].x + landmarks[263].x) / 2;
        const anchorY = (landmarks[33].y + landmarks[263].y) / 2;
        const interOcular = landmarks[263].x - landmarks[33].x;
        if (Math.abs(interOcular) < 1e-6) return null;
        return [(avgPupilX - anchorX) / interOcular, (avgPupilY - anchorY) / interOcular];
    }
    // CARA: punta de la nariz (landmark 1)
    return [landmarks[1].x, landmarks[1].y];
}

function predict(features) {
    const f = phi(features[0], features[1]);
    return [
        Math.max(0, Math.min(window.innerWidth, dot(weightsX, f))),
        Math.max(0, Math.min(window.innerHeight, dot(weightsY, f)))
    ];
}

// Procesamiento común a ambos motores
let fpsWindowStart = 0, fpsFrames = 0;
let waitingFirstFrame = false;
function onLandmarks(landmarks, extra = {}) {
    const now = performance.now();
    if (waitingFirstFrame) { waitingFirstFrame = false; hideSyncToast(); }
    fpsFrames++;
    if (now - fpsWindowStart >= 1000) { fps = fpsFrames * 1000 / (now - fpsWindowStart); fpsFrames = 0; fpsWindowStart = now; }

    if (!landmarks) { currentFeatures = null; faceData = null; return; }
    faceData = { landmarks, pose: extra.pose || null, eyes: extra.eyes || null, iris: irisInEye(landmarks), t: now };
    currentFeatures = extractFeatures(landmarks, S.trackingMode);
    if ((S.state === 'BOARD' || S.state === 'HOME') && currentFeatures && hasWeights()) {
        const [px, py] = predict(currentFeatures);
        S.rawX = px;
        S.rawY = py;
    }
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

async function startTasks(video, gen) {
    let landmarker = await withTimeout(getLandmarker(), 25000, 'descarga del modelo');
    if (gen !== generation) return false; // se pidió detener mientras cargaba

    const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    if (gen !== generation) { s.getTracks().forEach(t => t.stop()); return false; } // arranque viejo: no tocar el vigente
    stream = s;
    video.muted = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.srcObject = s;
    await video.play();
    if (gen !== generation) return false;

    let consecutiveErrors = 0;
    let recovering = false;
    const step = () => {
        if (gen !== generation) return;
        try {
            if (!recovering && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
                lastVideoTime = video.currentTime;
                const res = landmarker.detectForVideo(video, performance.now());
                consecutiveErrors = 0;
                const lm = res.faceLandmarks && res.faceLandmarks[0];
                onLandmarks(lm || null, lm ? {
                    pose: poseFromMatrix(res.facialTransformationMatrixes?.[0]?.data),
                    eyes: pickEyeBlendshapes(res.faceBlendshapes?.[0]?.categories)
                } : {});
            }
        } catch (e) {
            consecutiveErrors++;
            if (consecutiveErrors === 1) console.error('Error procesando cuadro (el loop sigue):', e);
            if (consecutiveErrors >= 30 && !recovering) {
                recovering = true;
                if (landmarkerDelegate === 'GPU') {
                    fallbackToCpu().then(lm => { landmarker = lm; consecutiveErrors = 0; recovering = false; })
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
            onLandmarks(lm || null);
        });
    }
    if (!camera) {
        camera = new window.Camera(video, {
            onFrame: async () => { await faceMesh.send({ image: video }); },
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

export function stopMediaPipe() {
    generation++; // invalida cualquier arranque en curso
    if (waitingFirstFrame) { waitingFirstFrame = false; hideSyncToast(); }
    stopStream();
    if (camera) camera.stop();
    running = false;
    currentFeatures = null;
    faceData = null;
}
