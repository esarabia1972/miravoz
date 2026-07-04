// calibration.js — Flujo de calibración de 9 puntos (SPEC F1-3, F1-4, F1-5)
// Muestreo robusto (warm-up + outliers), entrenamiento polinómico ridge,
// score de calidad y reintento automático del peor punto.

import { CONFIG } from './config.js';
import { trainModel, trimOutliers, qualityLabel } from './regression.js';

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
        this.pointSamples = calibPoints.map(p => ({ target: [...p], samples: [] }));
        this.retries = new Array(calibPoints.length).fill(0);
        this.queue = calibPoints.map((_, i) => i); // puntos pendientes
        this.currentIdx = null;
        this.phase = 'IDLE'; // IDLE | COUNTDOWN | SAMPLING | DONE
        this.phaseStart = 0;
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
            if (features && elapsed > CONFIG.SAMPLE_WARMUP_MS) {
                this.pointSamples[this.currentIdx].samples.push({ fx: features[0], fy: features[1] });
            }
            if (elapsed > CONFIG.SAMPLING_MS + CONFIG.SAMPLE_WARMUP_MS) {
                // F1-4: descarte de outliers del punto
                const p = this.pointSamples[this.currentIdx];
                p.samples = trimOutliers(p.samples, CONFIG.SAMPLE_OUTLIER_SIGMA);
                if (p.samples.length < CONFIG.MIN_SAMPLES_PER_POINT) {
                    // Muestras insuficientes (sin rostro / mucho ruido): repetir el punto
                    this.queue.unshift(this.currentIdx);
                }
                this._nextPoint(now);
            }
        }
    }

    _train(now) {
        const lambda = this.mode === 'OJOS' ? CONFIG.RIDGE_LAMBDA_OJOS : CONFIG.RIDGE_LAMBDA_CARA;
        let result;
        try {
            result = trainModel(this.pointSamples, lambda);
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
            if (err > worstErr) { worstErr = err; worstIdx = i; }
        });

        if (worstErr > threshold && this.retries[worstIdx] < CONFIG.CALIB_MAX_RETRIES_PER_POINT) {
            this.retries[worstIdx]++;
            console.log(`Calibración: reintentando punto ${worstIdx + 1} (error ${Math.round(worstErr)}px > ${Math.round(threshold)}px)`);
            this.queue.push(worstIdx);
            this._nextPoint(now);
            return;
        }

        const quality = qualityLabel(result.meanError, diag, CONFIG.CALIB_GOOD_FRAC, CONFIG.CALIB_POINT_ERROR_FRAC);
        const profile = {
            weightsX: result.weightsX,
            weightsY: result.weightsY,
            meanError: result.meanError,
            quality,
            ts: Date.now()
        };
        saveProfile(this.mode, profile);
        this.phase = 'DONE';
        this.onComplete(profile);
    }

    // Datos para que main.js dibuje el punto actual en el canvas
    renderInfo(now) {
        if (this.phase !== 'COUNTDOWN' && this.phase !== 'SAMPLING') return null;
        const [tx, ty] = calibPoints[this.currentIdx];
        const total = calibPoints.length;
        return {
            x: tx, y: ty,
            index: this.currentIdx,
            label: `${this.currentIdx + 1}/${total}`,
            sampling: this.phase === 'SAMPLING',
            countdownProgress: this.phase === 'COUNTDOWN'
                ? Math.min((now - this.phaseStart) / CONFIG.COUNTDOWN_MS, 1)
                : null
        };
    }
}
