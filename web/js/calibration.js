// calibration.js — Flujo de calibración de 9 puntos (SPEC F1-3, F1-4, F1-5)
// Muestreo robusto (warm-up + outliers), entrenamiento polinómico ridge,
// score de calidad y reintento automático del peor punto.

import { CONFIG } from './config.js';
import { trainModel, trimOutliers, qualityLabel } from './regression.js';
import * as gaze from './gaze-model.js';

const STORAGE_KEY = 'miravoz_calibration_v2'; // v2: 6 features polinómicas (v1 incompatible)

export let profiles = { OJOS: null, CARA: null };

export async function loadProfiles() {
    try {
        const stored = await localforage.getItem(STORAGE_KEY);
        if (stored) profiles = stored;
    } catch (e) {
        console.error('Error al cargar perfiles de calibración:', e);
    }
}

/** ¿El perfil guardado sirve para este modo? (los perfiles del modo Iris viejo, solo-iris, no) */
export function isUsableProfile(mode, profile) {
    if (!profile) return false;
    if (mode === 'OJOS') return profile.kind === gaze.MODEL_KIND && !!profile.model;
    return !!(profile.weightsX && profile.weightsY);
}

/**
 * Aprendizaje implícito (modo Iris): suma muestras confirmadas por el uso y re-entrena cada N.
 * @returns el perfil actualizado si se re-entrenó, o null.
 */
let implicitSinceRetrain = 0;
export async function addImplicitSamples(mode, samples) {
    const profile = profiles[mode];
    if (!isUsableProfile(mode, profile) || mode !== 'OJOS' || !samples.length) return null;
    profile.implicit = gaze.addImplicit(profile.implicit, samples, CONFIG.IMPLICIT_MAX_SAMPLES);
    implicitSinceRetrain++;
    let retrained = null;
    if (implicitSinceRetrain >= CONFIG.IMPLICIT_RETRAIN_EVERY) {
        implicitSinceRetrain = 0;
        try {
            const r = gaze.train(profile.samples, CONFIG.GAZE_LAMBDA, profile.implicit);
            if (gaze.acceptRetrain(profile.model, r.model, profile.samples)) {
                profile.model = r.model;
                retrained = profile;
            } else {
                // El modelo nuevo empeora sobre la calibración: probablemente aprendió de errores no corregidos.
                // Se descarta y se vacía lo implícito para no seguir arrastrando el sesgo.
                console.warn('Aprendizaje implícito: modelo descartado (empeoraba la calibración)');
                profile.implicit = [];
            }
        } catch (e) {
            console.warn('Re-entrenamiento implícito falló (se mantiene el modelo):', e?.message || e);
        }
    }
    await saveProfile(mode, profile);
    return retrained;
}

export async function clearProfile(mode) {
    profiles[mode] = null;
    await localforage.setItem(STORAGE_KEY, profiles);
}

async function saveProfile(mode, profile) {
    profiles[mode] = profile;
    try {
        await localforage.setItem(STORAGE_KEY, profiles);
    } catch (e) {
        console.error('Error guardando calibración:', e);
    }
}

// --- Puntos de calibración (grilla 3x3 sobre el viewport) ---
export let calibPoints = [];


export function updateCalibPoints() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const mx = w * 0.15;
    const my = h * 0.15;
    const cx = w / 2, cy = h / 2;
    calibPoints = [
        [mx, my], [cx, my], [w - mx, my],
        [mx, cy], [cx, cy], [w - mx, cy],
        [mx, h - my], [cx, h - my], [w - mx, h - my]
    ];
}

function pointsFor(mode) {
    // Modo Iris v3 ("cabeza quieta"): los mismos 9 puntos, sin los de mover la cabeza. El diagnóstico real
    // mostró que la gente no mueve la cabeza lo suficiente al pedírselo y que compensar cabeza con webcam no
    // alcanza; el modo vigila la pose en lugar de compensarla (gaze-model.js v3).
    return calibPoints.map(p => ({ target: [...p], headMove: false }));
}
updateCalibPoints();
window.addEventListener('resize', updateCalibPoints);

// --- Sesión de calibración ---
// Estados: PENDING (espera click en el botón) → COUNTDOWN → SAMPLING → ...
// Al terminar los 9 puntos: entrena, evalúa por punto y, si el peor punto supera
// el umbral, lo re-muestrea automáticamente (hasta CALIB_MAX_RETRIES_PER_POINT).

export class CalibrationSession {
    // onComplete({weightsX, weightsY, meanError, quality, pointErrors})
    constructor(mode, onComplete) {
        this.mode = mode;
        this.onComplete = onComplete;
        this.points = pointsFor(mode);
        this.pointSamples = this.points.map(p => ({ target: [...p.target], samples: [] }));
        this.retries = new Array(this.points.length).fill(0);
        this.queue = this.points.map((_, i) => i); // puntos pendientes
        this.currentIdx = null;
        this.phase = 'IDLE'; // IDLE | COUNTDOWN | SAMPLING | DONE
        this.phaseStart = 0;
        this.emptyPointStreak = 0; // abort de seguridad: puntos seguidos sin muestras
    }

    begin(now) {
        this._nextPoint(now);
    }

    _nextPoint(now) {
        if (this.queue.length === 0) {
            this._train(now);
            return;
        }
        this.currentIdx = this.queue.shift();
        this.pointSamples[this.currentIdx].samples = []; // limpia (relevante en retry)
        this.phase = 'COUNTDOWN';
        this.phaseStart = now;
    }

    // Llamar por frame con las features actuales (o null si no hay rostro).
    onFrame(features, now) {
        if (this.phase === 'COUNTDOWN') {
            if (now - this.phaseStart > CONFIG.COUNTDOWN_MS) {
                this.phase = 'SAMPLING';
                this.phaseStart = now;
            }
        } else if (this.phase === 'SAMPLING') {
            // F1-4: warm-up — descartar las muestras iniciales (sacada de llegada)
            const elapsed = now - this.phaseStart;
            const headMove = this.points[this.currentIdx].headMove;
            if (features && elapsed > CONFIG.SAMPLE_WARMUP_MS) {
                // Modo Iris: features = vector crudo del modelo híbrido (fx, fy = iris, para outliers)
                const sample = this.mode === 'OJOS'
                    ? { fx: features[0], fy: features[1], raw: features }
                    : { fx: features[0], fy: features[1] };
                this.pointSamples[this.currentIdx].samples.push(sample);
            }
            const duration = headMove ? CONFIG.GAZE_HEADMOVE_SAMPLING_MS : CONFIG.SAMPLING_MS;
            if (elapsed > duration + CONFIG.SAMPLE_WARMUP_MS) {
                // F1-4: descarte de outliers del punto (no en los de mover la cabeza: ahí la variación es buscada)
                const p = this.pointSamples[this.currentIdx];
                if (!headMove) p.samples = trimOutliers(p.samples, CONFIG.SAMPLE_OUTLIER_SIGMA);
                if (p.samples.length < CONFIG.MIN_SAMPLES_PER_POINT) {
                    // Muestras insuficientes (sin rostro / mucho ruido): repetir el punto,
                    // pero NUNCA en loop infinito — 3 intentos vacíos seguidos abortan.
                    this.emptyPointStreak++;
                    if (this.emptyPointStreak >= 3) {
                        console.error('Calibración abortada: la cámara no entrega rostro/features.');
                        this.phase = 'DONE';
                        this.onComplete(null);
                        return;
                    }
                    this.queue.unshift(this.currentIdx);
                } else {
                    this.emptyPointStreak = 0;
                }
                this._nextPoint(now);
            }
        }
    }

    _train(now) {
        let result;
        try {
            result = this.mode === 'OJOS'
                ? gaze.train(this.pointSamples, CONFIG.GAZE_LAMBDA)
                : trainModel(this.pointSamples, CONFIG.RIDGE_LAMBDA_CARA);
        } catch (e) {
            console.error('Error entrenando modelo:', e);
            this.phase = 'DONE';
            this.onComplete(null);
            return;
        }

        // F1-5: reintento automático del peor punto si supera el umbral
        const diag = Math.hypot(window.innerWidth, window.innerHeight);
        const threshold = diag * CONFIG.CALIB_POINT_ERROR_FRAC;
        let worstIdx = -1, worstErr = 0;
        result.pointErrors.forEach((err, i) => {
            if (this.points[i].headMove) return; // ver abajo: no se reintentan
            if (err > worstErr) { worstErr = err; worstIdx = i; }
        });

        // Los puntos de "mover la cabeza" tienen más error por naturaleza: no se reintentan (calibración más corta)
        if (worstIdx >= 0 && worstErr > threshold && this.retries[worstIdx] < CONFIG.CALIB_MAX_RETRIES_PER_POINT) {
            this.retries[worstIdx]++;
            console.log(`Calibración: reintentando punto ${worstIdx + 1} (error ${Math.round(worstErr)}px > ${Math.round(threshold)}px)`);
            this.queue.push(worstIdx);
            this._nextPoint(now);
            return;
        }

        const quality = qualityLabel(result.meanError, diag, CONFIG.CALIB_GOOD_FRAC, CONFIG.CALIB_POINT_ERROR_FRAC);
        const profile = this.mode === 'OJOS'
            ? {
                kind: gaze.MODEL_KIND,
                model: result.model,
                // Se guardan las muestras (solo el vector crudo) para re-entrenar con el aprendizaje implícito
                samples: this.pointSamples.map(p => ({ target: p.target, samples: p.samples.map(s => ({ raw: s.raw })) })),
                implicit: [],
                meanError: result.meanError,
                quality,
                ts: Date.now()
            }
            : {
                weightsX: result.weightsX,
                weightsY: result.weightsY,
                meanError: result.meanError,
                quality,
                ts: Date.now()
            };
        implicitSinceRetrain = 0;
        saveProfile(this.mode, profile);
        this.phase = 'DONE';
        this.onComplete(profile);
    }

    // Datos para que main.js dibuje el punto actual en el canvas
    renderInfo(now) {
        if (this.phase !== 'COUNTDOWN' && this.phase !== 'SAMPLING') return null;
        const pt = this.points[this.currentIdx];
        const [tx, ty] = pt.target;
        const total = this.points.length;
        return {
            x: tx, y: ty,
            index: this.currentIdx,
            label: `${this.currentIdx + 1}/${total}`,
            hint: pt.headMove
                ? 'Mirá el punto y mové la cabeza despacito'
                : (this.mode === 'OJOS' ? 'Mirá el punto, con la cabeza quieta' : null),
            sampling: this.phase === 'SAMPLING',
            countdownProgress: this.phase === 'COUNTDOWN'
                ? Math.min((now - this.phaseStart) / CONFIG.COUNTDOWN_MS, 1)
                : null
        };
    }
}
