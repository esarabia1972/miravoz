// gaze-model.js — Modelo del modo Iris HÍBRIDO (cabeza + iris) · etapa 2
// Módulo PURO (sin DOM): testeable con Node (tools/test-gaze.mjs).
//
// Idea: el punto de la pantalla depende de DÓNDE está la cabeza (pose + posición) y de HACIA DÓNDE
// apuntan los ojos respecto de la cabeza (iris dentro del ojo + blendshapes de mirada). El modelo
// anterior usaba solo el iris y confundía "giré la cabeza" con "miré para el costado".
//
// Features crudas por cuadro (rawFeatures):
//   ix, iy   : iris dentro del ojo (headpose.irisInEye), ~[-1, 1]
//   yaw, pch : pose de la cabeza en grados / 20
//   nx, ny   : posición de la nariz en la imagen (landmark 1), [0, 1]
//   gh, gv   : blendshapes de mirada combinados (horizontal / vertical), ~[-1, 1]
// Modelo: features estandarizadas (z-score) + términos cuadráticos del iris y cruces iris×cabeza,
// ridge por eje con objetivo centrado (el intercepto no se penaliza).

import { ridgeTrain, dot } from './regression.js';

export const RAW_NAMES = ['ix', 'iy', 'yaw', 'pitch', 'nx', 'ny', 'gh', 'gv'];
export const MODEL_KIND = 'hybrid-v1';
export const BLINK_OPEN_RATIO = 0.12; // alto/ancho del ojo por debajo del cual se considera parpadeo
const Z_CLIP = 5;                      // una feature fuera de ±5σ de la calibración no puede dominar la predicción
const IMPLICIT_MAX_SHARE = 0.3;        // lo implícito nunca supera el 30% de las filas de entrenamiento

/** faceData (de tracking.js) → vector crudo, o null si falta algo imprescindible. */
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

/** Expansión sobre features estandarizadas z = (raw - mean) / std */
export function expand(z) {
    const [ix, iy, yaw, pitch] = z;
    return [...z, ix * ix, iy * iy, ix * iy, ix * yaw, iy * pitch];
}

function standardize(raw, mean, std) {
    return raw.map((v, i) => Math.max(-Z_CLIP, Math.min(Z_CLIP, (v - mean[i]) / std[i])));
}

export function predict(model, raw) {
    const f = expand(standardize(raw, model.mean, model.std));
    return [model.cx + dot(model.wx, f), model.cy + dot(model.wy, f)];
}

/**
 * Entrena el modelo.
 * @param {Array<{target:[x,y], samples:Array<{raw:number[]}>}>} pointSamples  calibración
 * @param {number} lambda   regularización ridge (sobre features estandarizadas; ~1)
 * @param {Array<{target:[x,y], raw:number[]}>} extra  muestras implícitas (aprendizaje con el uso)
 * @returns {{model, pointErrors:number[], meanError:number}}
 */
export function train(pointSamples, lambda = 1, extra = []) {
    const rows = [];
    for (const p of pointSamples) for (const s of p.samples) rows.push({ raw: s.raw, t: p.target });
    // Lo implícito suma, pero sin desplazar a la calibración: como máximo 30% del total (las más recientes)
    const maxExtra = Math.floor(rows.length * IMPLICIT_MAX_SHARE / (1 - IMPLICIT_MAX_SHARE));
    for (const e of extra.slice(-maxExtra)) rows.push({ raw: e.raw, t: e.target });
    const F = RAW_NAMES.length;
    if (rows.length < 30) throw new Error('Muestras insuficientes para el modelo híbrido');

    const mean = new Array(F).fill(0), std = new Array(F).fill(0);
    for (const r of rows) r.raw.forEach((v, i) => { mean[i] += v; });
    mean.forEach((_, i) => { mean[i] /= rows.length; });
    for (const r of rows) r.raw.forEach((v, i) => { std[i] += (v - mean[i]) ** 2; });
    // Piso de desvío: una feature casi constante en la calibración (p. ej. pitch muy quieto) no explota al predecir
    const FLOOR = [0.02, 0.02, 0.05, 0.05, 0.005, 0.005, 0.02, 0.02];
    std.forEach((_, i) => { std[i] = Math.max(Math.sqrt(std[i] / rows.length), FLOOR[i] ?? 1e-3); });

    const X = rows.map(r => expand(standardize(r.raw, mean, std)));
    const cx = rows.reduce((a, r) => a + r.t[0], 0) / rows.length;
    const cy = rows.reduce((a, r) => a + r.t[1], 0) / rows.length;
    const wx = ridgeTrain(X, rows.map(r => r.t[0] - cx), lambda);
    const wy = ridgeTrain(X, rows.map(r => r.t[1] - cy), lambda);
    const model = { kind: MODEL_KIND, mean, std, wx, wy, cx, cy };

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
