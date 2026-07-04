// tracking.js — MediaPipe FaceMesh, extracción de features y predicción (SPEC F1-1, F1-3)
// El video se procesa 100% local: ningún frame sale del dispositivo (invariante de arquitectura).

import { S } from './state.js';
import { phi, dot } from './regression.js';

let faceMesh = null;
let camera = null;
let isMediaPipeRunning = false;

// Features actuales (crudas, normalizadas): [fx, fy] o null si no hay rostro
export let currentFeatures = null;

// Pesos activos (6 features polinómicas). null = sin calibrar.
let weightsX = null;
let weightsY = null;

export function setWeights(wx, wy) {
    weightsX = wx;
    weightsY = wy;
}

export function clearWeights() {
    weightsX = null;
    weightsY = null;
}

export function hasWeights() {
    return !!(weightsX && weightsY);
}

// Extrae features según el modo. Devuelve [fx, fy] o null.
function extractFeatures(landmarks, mode) {
    const avgPupilX = (landmarks[473].x + landmarks[468].x) / 2;
    const avgPupilY = (landmarks[473].y + landmarks[468].y) / 2;
    if (mode === 'OJOS') {
        // Vector pupila normalizado por distancia interocular (invariante a traslación/escala)
        const anchorX = (landmarks[33].x + landmarks[263].x) / 2;
        const anchorY = (landmarks[33].y + landmarks[263].y) / 2;
        const interOcular = landmarks[263].x - landmarks[33].x;
        if (Math.abs(interOcular) < 1e-6) return null;
        return [(avgPupilX - anchorX) / interOcular, (avgPupilY - anchorY) / interOcular];
    }
    // CARA: punta de la nariz (landmark 1)
    return [landmarks[1].x, landmarks[1].y];
}

// Predicción con clamp al viewport. Sin escalado post-hoc (F1-3: eliminado).
function predict(features) {
    const f = phi(features[0], features[1]);
    const x = dot(weightsX, f);
    const y = dot(weightsY, f);
    return [
        Math.max(0, Math.min(window.innerWidth, x)),
        Math.max(0, Math.min(window.innerHeight, y))
    ];
}

export function startMediaPipe() {
    if (S.trackingMode === 'CLICKS') return;
    if (isMediaPipeRunning) return;

    const videoElement = document.getElementById('input-video');

    if (!faceMesh) {
        faceMesh = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });
        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        faceMesh.onResults((results) => {
            if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
                const landmarks = results.multiFaceLandmarks[0];
                currentFeatures = extractFeatures(landmarks, S.trackingMode);

                if ((S.state === 'BOARD' || S.state === 'HOME') && currentFeatures && hasWeights()) {
                    const [px, py] = predict(currentFeatures);
                    S.rawX = px;
                    S.rawY = py;
                }
            } else {
                currentFeatures = null;
            }
        });
    }

    if (!camera) {
        camera = new Camera(videoElement, {
            onFrame: async () => { await faceMesh.send({ image: videoElement }); },
            width: 640,
            height: 480
        });
    }

    camera.start();
    isMediaPipeRunning = true;
}

export function stopMediaPipe() {
    if (camera) camera.stop();
    isMediaPipeRunning = false;
    currentFeatures = null;
}
