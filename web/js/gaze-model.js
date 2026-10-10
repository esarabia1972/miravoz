// gaze-model.js — Modelo del modo Iris (v3: "cabeza quieta") · Módulo PURO (sin DOM), testeable con Node.
//
// Historia y evidencia (diagnóstico real del 10/10/2026, miravoz-diag-2026-10-10-13-51.json):
//  - v1/v2 (híbrido cabeza+iris) eran inestables: en la calibración la cabeza casi no se movió
//    (yaw ±0,1° aun en los puntos de "mové la cabeza"), así que el modelo no pudo aprender a compensar,
//    y en el uso cada grado de giro movía el cursor.
//  - Con la cabeza en la pose de la calibración, el error mediano fue ~130 px; a ±4° ya ~230 px y a ±8° ~340 px.
//  - La mejor señal de mirada fueron los BLENDSHAPES de FaceLandmarker (eyeLook*): rango 2-3× mayor y
//    menos temblor que la posición geométrica del iris. Iris + blendshapes: ~90% de acierto 3×3
//    (validación dejando un punto afuera, cabeza quieta).
// Decisión: el modo Iris es para usuarios que NO mueven la cabeza (los que sí pueden, usan el modo Rostro,
// que da 95-100%). El modelo usa solo señales de los ojos y VIGILA la pose: si la cabeza se aleja de la
// pose de la calibración, tracking.js congela el cursor y main.js avisa ("volvé a la posición").
//
// Features crudas por cuadro (rawFeatures, 8 valores, se guardan completas para diagnóstico):
//   0 ix, 1 iy : iris dentro del ojo (headpose.irisInEye)
//   2 yaw, 3 pitch : pose de la cabeza en grados / 20      (solo para vigilar la pose)
//   4 nx, 5 ny : posición de la nariz en la imagen          (solo para vigilar la pose)
//   6 gh, 7 gv : blendshapes de mirada combinados (horizontal / vertical)
// Modelo: [ix, iy, gh, gv] estandarizadas + cuadráticos del iris, ridge con objetivo centrado.

import { ridgeTrain, dot } from './regression.js';

export const RAW_NAMES = ['ix', 'iy', 'yaw', 'pitch', 'nx', 'ny', 'gh', 'gv'];
export const MODEL_KIND = 'gaze-v3';   // perfiles anteriores (hybrid-v1/v2) quedan invalidados: recalibrar
export const BLINK_OPEN_RATIO = 0.12;  // alto/ancho del ojo por debajo del cual se considera parpadeo
const FEATURE_IDX = [0, 1, 6, 7];      // ix, iy, gh, gv
const FLOOR = [0.02, 0.02, 0.02, 0.02];
const Z_CLIP = 5;                      // una feature fuera de ±5σ de la calibración no puede dominar
const IMPLICIT_MAX_SHARE = 0.3;        // lo implícito nunca supera el 30% de las filas de entrenamiento

/** faceData (de tracking.js) → vector crudo de 8 valores, o null si falta algo o hay parpadeo. */
export function rawFeatures(faceData) {
    if (!faceData || !faceData.iris || !faceData.pose || !faceData.landmarks) return null;
    const { iris, pose, landmarks } = faceData;
    const eyes = faceData.eyes || {};
    // Parpadeo / ojo casi cerrado: el iris no es confiable (iy se dispara al dividir por la apertura)
    if (iris.open !== undefined && iris.open < BLINK_OPEN_RATIO) return null;
    const e = (k) => eyes[k] || 0;
    // Mirada horizontal: ambos ojos hacia el mismo lado de la imagen (In de uno = Out del otro)
    const gh = ((e('eyeLookOutLeft') - e('eyeLookInLeft')) + (e('eyeLookInRight') - e('eyeLookOutRight'))) / 2;
    const gv = ((e('eyeLookDownLeft') + e('eyeLookDownRight')) - (e('eyeLookUpLeft') + e('eyeLookUpRight'))) / 2;
    const v = [iris.x, iris.y, pose.yaw / 20, pose.pitch / 20, landmarks[1].x, landmarks[1].y, gh, gv];
    return v.every(Number.isFinite) ? v : null;
}

const select = (raw) => FEATURE_IDX.map(i => raw[i]);

/** Expansión sobre features estandarizadas z = [ix, iy, gh, gv] */
export function expand(z) {
    const [ix, iy] = z;
    return [...z, ix * ix, iy * iy, ix * iy];
}

function standardize(x, mean, std) {
    return x.map((v, i) => Math.max(-Z_CLIP, Math.min(Z_CLIP, (v - mean[i]) / std[i])));
}

export function predict(model, raw) {
    const f = expand(standardize(select(raw), model.mean, model.std));
    return [model.cx + dot(model.wx, f), model.cy + dot(model.wy, f)];
}

/**
 * Cuánto se alejó la cabeza de la pose de la calibración: { deg, shift }
 * deg = mayor desvío de yaw/pitch en grados; shift = desplazamiento de la nariz en la imagen (fracción).
 */
export function headDeviation(model, raw) {
    if (!model?.poseRef || !raw) return { deg: 0, shift: 0 };
    const p = model.poseRef;
    return {
        deg: Math.max(Math.abs(raw[2] * 20 - p.yaw), Math.abs(raw[3] * 20 - p.pitch)),
        shift: Math.hypot(raw[4] - p.nx, raw[5] - p.ny)
    };
}

/**
 * Entrena el modelo.
 * @param {Array<{target:[x,y], samples:Array<{raw:number[]}>}>} pointSamples  calibración
 * @param {number} lambdaRel regularización ridge relativa: λ = lambdaRel × n (features estandarizadas)
 * @param {Array<{target:[x,y], raw:number[]}>} extra  muestras implícitas (aprendizaje con el uso)
 * @returns {{model, pointErrors:number[], meanError:number}}
 */
export function train(pointSamples, lambdaRel = 0.005, extra = []) {
    const calRows = [];
    for (const p of pointSamples) for (const s of p.samples) calRows.push({ raw: s.raw, t: p.target });
    if (calRows.length < 30) throw new Error('Muestras insuficientes para el modelo del modo Iris');
    // Lo implícito suma, pero sin desplazar a la calibración: como máximo 30% del total (las más recientes)
    const maxExtra = Math.floor(calRows.length * IMPLICIT_MAX_SHARE / (1 - IMPLICIT_MAX_SHARE));
    const rows = [...calRows, ...extra.slice(-maxExtra).map(e => ({ raw: e.raw, t: e.target }))];

    const F = FEATURE_IDX.length;
    const xs = rows.map(r => select(r.raw));
    const mean = new Array(F).fill(0), std = new Array(F).fill(0);
    for (const x of xs) x.forEach((v, i) => { mean[i] += v; });
    mean.forEach((_, i) => { mean[i] /= xs.length; });
    for (const x of xs) x.forEach((v, i) => { std[i] += (v - mean[i]) ** 2; });
    std.forEach((_, i) => { std[i] = Math.max(Math.sqrt(std[i] / xs.length), FLOOR[i]); });

    const X = xs.map(x => expand(standardize(x, mean, std)));
    const cx = rows.reduce((a, r) => a + r.t[0], 0) / rows.length;
    const cy = rows.reduce((a, r) => a + r.t[1], 0) / rows.length;
    const lambda = lambdaRel * rows.length;
    const wx = ridgeTrain(X, rows.map(r => r.t[0] - cx), lambda);
    const wy = ridgeTrain(X, rows.map(r => r.t[1] - cy), lambda);

    // Pose de referencia: SOLO de la calibración (lo implícito no la corre)
    const avg = (i) => calRows.reduce((a, r) => a + r.raw[i], 0) / calRows.length;
    const poseRef = { yaw: avg(2) * 20, pitch: avg(3) * 20, nx: avg(4), ny: avg(5) };
    const model = { kind: MODEL_KIND, mean, std, wx, wy, cx, cy, poseRef };

    const pointErrors = pointSamples.map(p => {
        if (!p.samples.length) return Infinity;
        let sum = 0;
        for (const s of p.samples) {
            const [px, py] = predict(model, s.raw);
            sum += Math.hypot(px - p.target[0], py - p.target[1]);
        }
        return sum / p.samples.length;
    });
    const meanError = pointErrors.reduce((a, b) => a + b, 0) / pointErrors.length;
    return { model, pointErrors, meanError };
}

/** Error medio (px) de un modelo sobre las muestras de calibración. */
export function calibrationError(model, pointSamples) {
    let sum = 0, n = 0;
    for (const p of pointSamples) for (const s of p.samples) {
        const [x, y] = predict(model, s.raw);
        sum += Math.hypot(x - p.target[0], y - p.target[1]); n++;
    }
    return n ? sum / n : Infinity;
}

/**
 * Salvaguarda del aprendizaje implícito: el modelo re-entrenado solo se acepta si NO empeora más de
 * `tol` sobre la calibración (que es la única "verdad" segura). Evita que selecciones erróneas no
 * corregidas arrastren el modelo (refuerzo de un sesgo).
 */
export function acceptRetrain(oldModel, newModel, pointSamples, tol = 1.15) {
    return calibrationError(newModel, pointSamples) <= calibrationError(oldModel, pointSamples) * tol;
}

/**
 * ¿La selección parece confiable para aprender? La mayoría de los cuadros del dwell tienen que caer en la
 * zona CENTRAL del objetivo según el modelo actual (si el cursor rozaba el borde, quizás miraba otra celda).
 */
export function isConfidentSelection(model, raws, rect, centralFrac = 0.7, minShare = 0.6) {
    if (!raws.length || !rect) return false;
    const mx = rect.width * (1 - centralFrac) / 2, my = rect.height * (1 - centralFrac) / 2;
    const inside = raws.filter(r => {
        const [x, y] = predict(model, r);
        return x >= rect.left + mx && x <= rect.right - mx && y >= rect.top + my && y <= rect.bottom - my;
    }).length;
    return inside / raws.length >= minShare;
}

/**
 * Aprendizaje implícito: buffer acotado de muestras confirmadas por el uso (FIFO).
 * Cada selección aporta pocas muestras; se guardan como máximo `max`.
 */
export function addImplicit(buffer, samples, max = 300) {
    const out = [...(buffer || []), ...samples];
    return out.length > max ? out.slice(out.length - max) : out;
}
