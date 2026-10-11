// vision-worker.js — FaceLandmarker en un Web Worker (M06, 11/10/2026)
// detectForVideo() es síncrono y bloquea el hilo que lo corre: acá corre fuera del hilo de la interfaz.
// Recibe ImageBitmap (transferido) con su sesión, secuencia y momento de captura del hilo principal; devuelve
// los puntos, la pose y los blendshapes de mirada con LOS MISMOS identificadores (el reloj del worker no se usa
// para la validez: los performance.now() de contextos distintos pueden tener orígenes distintos).
import { poseFromMatrix, pickEyeBlendshapes } from './headpose.js';

const TASKS_BASE = '/vendor/mediapipe-tasks-vision-1.1.0';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let landmarker = null;
let delegate = 'GPU';
let lastTs = 0;

async function init() {
    const vision = await import(`${TASKS_BASE}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${TASKS_BASE}/wasm`);
    const options = (d) => ({
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: d },
        runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true
    });
    try {
        landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options('GPU'));
        delegate = 'GPU';
    } catch {
        landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options('CPU'));
        delegate = 'CPU';
    }
}

self.onmessage = async (e) => {
    const msg = e.data || {};
    if (msg.type === 'init') {
        try { await init(); self.postMessage({ type: 'ready', delegate }); }
        catch (err) { self.postMessage({ type: 'fatal', error: String(err && err.message || err) }); }
        return;
    }
    if (msg.type === 'frame') {
        const { bitmap, sessionId, sequence, capturedAt } = msg;
        try {
            if (!landmarker) throw new Error('motor no iniciado');
            // El timestamp de MediaPipe tiene que crecer siempre (dentro del worker)
            const ts = Math.max(lastTs + 1, Math.round(capturedAt));
            lastTs = ts;
            const t0 = performance.now();
            const res = landmarker.detectForVideo(bitmap, ts);
            const inferMs = performance.now() - t0;
            const lm = res.faceLandmarks && res.faceLandmarks[0];
            self.postMessage({
                type: 'result', sessionId, sequence, capturedAt, inferMs,
                landmarks: lm ? lm.map(p => ({ x: p.x, y: p.y, z: p.z })) : null,
                pose: lm ? poseFromMatrix(res.facialTransformationMatrixes?.[0]?.data) : null,
                eyes: lm ? pickEyeBlendshapes(res.faceBlendshapes?.[0]?.categories) : null
            });
        } catch (err) {
            self.postMessage({ type: 'error', sessionId, sequence, capturedAt, error: String(err && err.message || err) });
        } finally {
            try { bitmap && bitmap.close && bitmap.close(); } catch { /* ya liberado */ }
        }
    }
    if (msg.type === 'close') {
        try { landmarker && landmarker.close && landmarker.close(); } catch { /* nada */ }
        self.close();
    }
};
