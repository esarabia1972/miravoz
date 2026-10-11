// calibration.js — Calibración de 9 puntos + verificación independiente (SPEC F1-3/4/5 · M02 · M04, 11/10/2026)
//
// Flujo: CAPTURA (9 puntos) → ENTRENAMIENTO → VERIFICACIÓN (5 objetivos nuevos) → aceptada | requiere ajuste.
//  - Muestreo: una muestra por cuadro NUEVO de cámara (main.js pasa solo muestras nuevas y recientes) y nunca
//    un cuadro capturado antes de que empiece la fijación del punto (sacada de llegada / objetivo anterior).
//  - trainingError (antes "meanError") mide ajuste sobre el entrenamiento: es diagnóstico, no rendimiento.
//  - La verificación usa posiciones que no se ajustaron (validation.js). Sus muestras NUNCA entran al
//    entrenamiento ni al aprendizaje implícito. Una verificación fallida no activa el cursor.
//  - Los perfiles se guardan con contexto (persona, dispositivo, cámara, geometría) en profiles.js.

import { CONFIG } from './config.js';
import { trainModel, trimOutliers, phi, dot } from './regression.js';
import * as gaze from './gaze-model.js';
import { ProfileStore, SCHEMA, MODEL_KINDS, checkCompatibility, newRevision } from './profiles.js';
import { validationTargets, computeMetrics, judge, RULES } from './validation.js';

// --- Almacén y contexto (M02) ---
let store = null;
function getStore() {
    if (!store) store = new ProfileStore(globalThis.localforage);
    return store;
}
/** Para los tests: reemplazar el almacenamiento */
export function _setStorage(storage) { store = new ProfileStore(storage); }

let contextProvider = () => ({ scope: 'prueba', deviceId: null, engine: null, viewport: { w: window.innerWidth, h: window.innerHeight },
    orientation: window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait', dpr: 1, camera: null });
/** main.js informa el contexto actual: ámbito de persona, motor, cámara, viewport. */
export function setContextProvider(fn) { contextProvider = fn; }
export function currentContext() { return contextProvider(); }

export function modelKindFor(mode, ctx = currentContext()) {
    if (mode === 'OJOS') return gaze.MODEL_KIND;
    return ctx && ctx.engine === 'legacy' ? MODEL_KINDS.CARA_NOSE : MODEL_KINDS.CARA;
}

export async function loadProfiles() { await getStore().load(); }

// Un perfil por modo Y por orientación: calibrar en vertical no pisa el horizontal (girar el iPad y volver
// recupera el perfil anterior, con su verificación rápida).
const slot = (mode, ctx = currentContext()) => `${mode}@${ctx.orientation}`;

/** Perfil guardado del modo para la persona y la orientación actuales (o null). */
export function getProfile(mode) { return getStore().get(currentContext().scope, slot(mode)); }

/** ¿Se puede usar el perfil del modo en el contexto actual? → { ok, reason, profile } */
export function checkProfile(mode) {
    const profile = getProfile(mode);
    return { ...checkCompatibility(profile, currentContext(), { mode, modelKind: modelKindFor(mode) }), profile };
}

/** ¿El último guardado falló? (el perfil activo vive solo en memoria) */
export function isUnsaved() { return getStore().unsaved; }

/**
 * Compatibilidad estructural del perfil con el modo (y, si hay contexto, con persona/geometría).
 * Un perfil sin verificación aceptada nunca es usable.
 */
export function isUsableProfile(mode, profile, ctx = null) {
    if (!profile) return false;
    if (mode === 'OJOS' && !(profile.kind === gaze.MODEL_KIND && profile.model)) return false;
    if (mode !== 'OJOS' && !(profile.weightsX && profile.weightsY)) return false;
    return checkCompatibility(profile, ctx, { mode, modelKind: modelKindFor(mode) }).ok;
}

export async function saveProfile(mode, profile) {
    const ctx = currentContext();
    // Se guarda en la orientación con la que se calibró (no en la actual, si se giró mientras tanto)
    const orientation = (profile && profile.context && profile.context.orientation) || ctx.orientation;
    return getStore().put(ctx.scope, `${mode}@${orientation}`, profile);
}

export async function clearProfile(mode) { await getStore().remove(currentContext().scope, slot(mode)); }

/** Al desvincular la tablet: se borran los perfiles de ese usuario (no los tableros). */
export async function clearScope(scope) { await getStore().removeScope(scope); }

/** Función features → [x, y] de un perfil (sin recortar). */
export function predictorFor(mode, profile) {
    if (mode === 'OJOS') return (f) => gaze.predict(profile.model, f);
    return (f) => { const p = phi(f[0], f[1]); return [dot(profile.weightsX, p), dot(profile.weightsY, p)]; };
}

/**
 * Aprendizaje implícito (modo Iris, EXPERIMENTAL: solo con ?implicit=1 · M07).
 *  - El modelo BASE (el que pasó la verificación) es inmutable; un re-entrenamiento produce un CANDIDATO.
 *  - El candidato se acepta solo si sobre la evidencia RESERVADA (muestras de la verificación, que nunca se
 *    entrenan) no es peor que el modelo BASE. Se compara siempre contra la base, no contra el anterior, para
 *    que no haya degradación acumulativa.
 *  - Si mientras tanto cambió el perfil activo (otra persona, recalibración, otra revisión), no se escribe nada.
 *  - Cada muestra guarda su procedencia; rollbackModel() vuelve a la base sin tocar tableros.
 * @param {string} mode
 * @param {Array<{target,raw}>} samples
 * @param {string|null} expectedRevision revisión del perfil cuando se registró la selección
 * @returns el perfil actualizado si se aceptó un candidato, o null.
 */
let implicitSinceRetrain = 0;
export async function addImplicitSamples(mode, samples, expectedRevision = null) {
    const scope = currentContext().scope;
    const profile = getProfile(mode);
    if (!isUsableProfile(mode, profile) || mode !== 'OJOS' || !samples.length) return null;
    if (expectedRevision && profile.revision !== expectedRevision) return null; // la selección era de otro perfil
    const tagged = samples.map(s => ({ ...s, source: 'implicit', ts: Date.now() }));
    const next = { ...profile, baseModel: profile.baseModel || profile.model, implicit: gaze.addImplicit(profile.implicit, tagged, CONFIG.IMPLICIT_MAX_SAMPLES) };
    implicitSinceRetrain++;
    let retrained = null;
    if (implicitSinceRetrain >= CONFIG.IMPLICIT_RETRAIN_EVERY) {
        implicitSinceRetrain = 0;
        try {
            const r = gaze.train(next.samples, CONFIG.GAZE_LAMBDA, next.implicit);
            const reserved = next.validationSamples && next.validationSamples.length ? next.validationSamples : null;
            const ok = reserved
                ? gaze.calibrationError(r.model, reserved) <= gaze.calibrationError(next.baseModel, reserved)
                : gaze.acceptRetrain(next.baseModel, r.model, next.samples, 1.0);
            if (ok) {
                next.model = r.model;
                next.revision = newRevision();
                next.history = [...(profile.history || []), { revision: profile.revision, at: Date.now() }].slice(-5);
                retrained = next;
            } else {
                console.warn('Aprendizaje implícito: candidato descartado (no mejora sobre la evidencia reservada)');
                next.implicit = [];
            }
        } catch (e) {
            console.warn('Re-entrenamiento implícito falló (se mantiene el modelo):', e?.message || e);
        }
    }
    // Re-chequeo después del trabajo: si cambió la persona o el perfil activo, no se escribe
    const now = getProfile(mode);
    if (currentContext().scope !== scope || !now || now.revision !== profile.revision) return null;
    await saveProfile(mode, next);
    return retrained;
}

/** Vuelve al modelo base verificado (descarta lo aprendido con el uso). */
export async function rollbackModel(mode) {
    const p = getProfile(mode);
    if (!p || !p.baseModel) return null;
    const next = { ...p, model: p.baseModel, implicit: [], revision: newRevision(), history: [...(p.history || []), { revision: p.revision, at: Date.now(), rollback: true }].slice(-5) };
    await saveProfile(mode, next);
    return next;
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

const VALIDATION_SAMPLING_MS = 1000;
// Rostro (1.2.0): la verificación es a LAZO CERRADO — se ve el cursor y la persona lo lleva al punto, como en el
// uso real. A lazo abierto (sin cursor) se medía la precisión absoluta de la cabeza, que se desplaza unos grados
// en pocos segundos (diagnósticos del iPad Air 4, 11/10/2026): con el cursor visible eso se corrige solo.
// Iris sigue a lazo abierto (un cursor que sigue a la mirada distrae y arrastra la vista).
const CARA_VALIDATION_COUNTDOWN_MS = 2500;
const MAX_POINT_SAMPLING_MS = 3000; // tope por punto si el motor entrega pocos cuadros por segundo

/**
 * Sesión de calibración (o solo verificación, con { validateOnly: perfil }).
 * onComplete(profile | null): profile.validation.status = 'accepted' | 'failed'. null = abortada.
 */
export class CalibrationSession {
    constructor(mode, onComplete, { validateOnly = null } = {}) {
        this.mode = mode;
        this.onComplete = onComplete;
        this.validateOnly = validateOnly;
        this.viewport = { w: window.innerWidth, h: window.innerHeight };
        this.points = calibPoints.map(p => ({ target: [...p] }));
        this.pointSamples = this.points.map(p => ({ target: [...p.target], samples: [] }));
        this.retries = new Array(this.points.length).fill(0);
        this.queue = validateOnly ? [] : this.points.map((_, i) => i);
        this.currentIdx = null;
        this.stage = validateOnly ? 'VALIDATE' : 'CAPTURE';
        this.phase = 'IDLE'; // IDLE | COUNTDOWN | SAMPLING | DONE
        this.phaseStart = 0;
        this.emptyPointStreak = 0;
        this.trained = null;   // { profileDraft, predictor }
        this.vTargets = [];
        this.vIdx = -1;
        this.vData = [];
        this.vCursor = null;
    }

    begin(now) {
        if (this.validateOnly) this._startValidation(now, this.validateOnly);
        else this._nextPoint(now);
    }

    _nextPoint(now) {
        if (this.queue.length === 0) { this._train(now); return; }
        this.currentIdx = this.queue.shift();
        this.pointSamples[this.currentIdx].samples = [];
        this.phase = 'COUNTDOWN';
        this.phaseStart = now;
    }

    /**
     * Llamar en cada refresco.
     * @param {number[]|null} features  features de una muestra NUEVA (null si no hay cuadro nuevo o no es válida)
     * @param {number} now
     * @param {{capturedAt:number, features:number[]|null}|null} [fresh] la muestra nueva (para cobertura y descarte por tiempo)
     */
    onFrame(features, now, fresh) {
        const isNewFrame = fresh !== undefined ? !!fresh : !!features;
        const capturedAt = fresh ? fresh.capturedAt : now;
        if (this._closedLoop() && features && this.trained && (this.phase === 'COUNTDOWN' || this.phase === 'SAMPLING')) {
            const [x, y] = this.trained.predictor(features);
            if (Number.isFinite(x) && Number.isFinite(y)) {
                const c = this.vCursor;
                this.vCursor = c ? [c[0] + 0.35 * (x - c[0]), c[1] + 0.35 * (y - c[1])] : [x, y]; // suavizado solo para dibujar
            }
        }
        if (this.phase === 'COUNTDOWN') {
            if (now - this.phaseStart > this._countdownMs()) { this.phase = 'SAMPLING'; this.phaseStart = now; }
            return;
        }
        if (this.phase !== 'SAMPLING') return;
        const elapsed = now - this.phaseStart;
        // Solo cuadros capturados DESPUÉS del warm-up de este punto (nunca del objetivo anterior)
        // …y nunca un cuadro atrasado (más viejo que el límite de frescura de M01)
        const inWindow = capturedAt >= this.phaseStart + CONFIG.SAMPLE_WARMUP_MS && now - capturedAt <= CONFIG.MAX_SAMPLE_AGE_MS;
        if (this.stage === 'VALIDATE') { this._validationFrame(features, isNewFrame && inWindow, elapsed, now); return; }

        if (features && inWindow) {
            const sample = this.mode === 'OJOS' ? { fx: features[0], fy: features[1], raw: features } : { fx: features[0], fy: features[1] };
            this.pointSamples[this.currentIdx].samples.push(sample);
        }
        // Con cámara/motor lentos (iPad), se sigue muestreando hasta juntar suficientes cuadros únicos, con tope
        const enough = this.pointSamples[this.currentIdx].samples.length >= CONFIG.MIN_SAMPLES_PER_POINT * 2;
        if ((elapsed > CONFIG.SAMPLING_MS + CONFIG.SAMPLE_WARMUP_MS && enough) || elapsed > MAX_POINT_SAMPLING_MS + CONFIG.SAMPLE_WARMUP_MS) {
            const p = this.pointSamples[this.currentIdx];
            p.samples = trimOutliers(p.samples, CONFIG.SAMPLE_OUTLIER_SIGMA);
            if (p.samples.length < CONFIG.MIN_SAMPLES_PER_POINT) {
                // Muestras insuficientes (sin rostro / cuadros repetidos o tardíos): repetir el punto,
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

    _closedLoop() { return this.stage === 'VALIDATE' && this.mode !== 'OJOS'; }
    _countdownMs() { return this._closedLoop() ? CARA_VALIDATION_COUNTDOWN_MS : CONFIG.COUNTDOWN_MS; }

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
        // F1-5: reintento automático del peor punto si supera el umbral (diagnóstico de ajuste)
        const diag = Math.hypot(window.innerWidth, window.innerHeight);
        const threshold = diag * CONFIG.CALIB_POINT_ERROR_FRAC;
        let worstIdx = -1, worstErr = 0;
        result.pointErrors.forEach((err, i) => { if (err > worstErr) { worstErr = err; worstIdx = i; } });
        if (worstIdx >= 0 && worstErr > threshold && this.retries[worstIdx] < CONFIG.CALIB_MAX_RETRIES_PER_POINT) {
            this.retries[worstIdx]++;
            console.log(`Calibración: reintentando punto ${worstIdx + 1} (error ${Math.round(worstErr)}px > ${Math.round(threshold)}px)`);
            this.queue.push(worstIdx);
            this._nextPoint(now);
            return;
        }

        const ctx = currentContext();
        const base = {
            schema: SCHEMA,
            revision: newRevision(),
            mode: this.mode,
            modelKind: modelKindFor(this.mode),
            context: {
                scope: ctx.scope, deviceId: ctx.deviceId, engine: ctx.engine, camera: ctx.camera,
                viewport: { ...ctx.viewport }, orientation: ctx.orientation, dpr: ctx.dpr,
                calibRect: { x: calibPoints[0][0], y: calibPoints[0][1], w: calibPoints[8][0] - calibPoints[0][0], h: calibPoints[8][1] - calibPoints[0][1] },
                coords: 'css-px-viewport' // convención única para calibrar y para seleccionar
            },
            trainingError: result.meanError,
            meanError: result.meanError, // compatibilidad: es el error de AJUSTE (no de rendimiento)
            createdAt: Date.now(),
            ts: Date.now()
        };
        const draft = this.mode === 'OJOS'
            ? { ...base, kind: gaze.MODEL_KIND, model: result.model,
                samples: this.pointSamples.map(p => ({ target: p.target, samples: p.samples.map(s => ({ raw: s.raw })) })), implicit: [] }
            : { ...base, weightsX: result.weightsX, weightsY: result.weightsY };
        implicitSinceRetrain = 0;
        this._startValidation(now, draft);
    }

    // --- Verificación (M04) ---
    _startValidation(now, profile) {
        this.stage = 'VALIDATE';
        this.trained = { profile, predictor: predictorFor(this.mode, profile) };
        this.vTargets = validationTargets(window.innerWidth, window.innerHeight);
        this.vData = this.vTargets.map(t => ({ target: t, preds: [], newFrames: 0 }));
        this.vIdx = 0;
        this.phase = 'COUNTDOWN';
        this.phaseStart = now;
    }

    _validationFrame(features, countable, elapsed, now) {
        const d = this.vData[this.vIdx];
        if (countable) {
            d.newFrames++;
            if (features && this.mode === 'OJOS') (d.raws = d.raws || []).push(features); // evidencia reservada (M07)
            if (features) {
                // Igual que en el uso real (tracking.js): en Iris se predice sobre la mediana de los últimos cuadros
                let f = features;
                if (this.mode === 'OJOS') {
                    d.buf = [...(d.buf || []), features].slice(-CONFIG.GAZE_MEDIAN_FRAMES);
                    f = features.map((_, i) => { const v = d.buf.map(b => b[i]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; });
                }
                const [x, y] = this.trained.predictor(f);
                if (Number.isFinite(x) && Number.isFinite(y)) d.preds.push([x, y]);
            }
        }
        const vEnough = d.newFrames >= 15;
        if ((elapsed > VALIDATION_SAMPLING_MS + CONFIG.SAMPLE_WARMUP_MS && vEnough) || elapsed > MAX_POINT_SAMPLING_MS + CONFIG.SAMPLE_WARMUP_MS) {
            this.vIdx++;
            if (this.vIdx < this.vTargets.length) { this.phase = 'COUNTDOWN'; this.phaseStart = now; return; }
            this._finishValidation();
        }
    }

    _finishValidation() {
        // Cobertura sobre los cuadros que ENTREGÓ el motor (un motor lento no es "falta de señal"); con casi
        // ningún cuadro, la cobertura es 0.
        const totalFrames = this.vData.reduce((a, d) => a + d.newFrames, 0);
        if (totalFrames === 0) {
            // Sin cuadros (cámara o modelo todavía cargando): no es un resultado de verificación; no se guarda nada
            this.phase = 'DONE';
            this.onComplete(null);
            return;
        }
        const points = this.vData.map(d => ({ target: d.target, preds: d.preds, expectedFrames: Math.max(d.newFrames, 5) }));
        const metrics = computeMetrics(points, { w: window.innerWidth, h: window.innerHeight });
        const verdict = judge(metrics);
        const quality = verdict.status !== 'accepted' ? 'no aprobada'
            : metrics.medianError <= 0.2 * metrics.cellRef ? 'buena' : 'aceptable';
        const reserved = this.mode === 'OJOS' && !this.validateOnly
            ? { validationSamples: this.vData.map(d => ({ target: d.target, samples: (d.raws || []).map(raw => ({ raw })) })), baseModel: this.trained.profile.model }
            : {};
        const profile = {
            ...this.trained.profile,
            ...reserved,
            quality,
            validation: { status: verdict.status, failures: verdict.failures, metrics, rules: RULES.version, checkedAt: Date.now() }
        };
        this.phase = 'DONE';
        // Solo se persiste una calibración ACEPTADA. Una fallida no reemplaza a la anterior ni activa el cursor.
        // En una verificación rápida fallida se guarda el estado "failed" del perfil existente (pide recalibrar).
        if (verdict.status === 'accepted' && !this.validateOnly) saveProfile(this.mode, profile);
        else if (this.validateOnly) {
            // Verificación rápida: se registra aparte; nunca pisa la verificación con la que se aceptó el perfil
            const stored = getProfile(this.mode);
            if (stored && stored.revision === this.trained.profile.revision) {
                saveProfile(this.mode, { ...stored, lastQuickCheck: { status: verdict.status, failures: verdict.failures, checkedAt: Date.now(), medianError: metrics.medianError, p90Error: metrics.p90Error, coverage: metrics.coverage } });
            }
        }
        this.onComplete(profile);
    }

    // Datos para que main.js dibuje el punto actual en el canvas
    renderInfo(now) {
        if (this.phase !== 'COUNTDOWN' && this.phase !== 'SAMPLING') return null;
        const validating = this.stage === 'VALIDATE';
        const [tx, ty] = validating ? this.vTargets[this.vIdx] : this.points[this.currentIdx].target;
        return {
            x: tx, y: ty,
            index: validating ? this.vIdx : this.currentIdx,
            stage: this.stage,
            label: validating ? `V${this.vIdx + 1}/${this.vTargets.length}` : `${this.currentIdx + 1}/${this.points.length}`,
            hint: validating ? (this.mode === 'OJOS' ? 'Verificación: mirá el punto, con la cabeza quieta' : 'Verificación: llevá el cursor al punto con la cabeza y mantenelo ahí')
                : (this.mode === 'OJOS' ? 'Mirá el punto, con la cabeza quieta' : null),
            sampling: this.phase === 'SAMPLING',
            countdownProgress: this.phase === 'COUNTDOWN' ? Math.min((now - this.phaseStart) / this._countdownMs(), 1) : null,
            cursor: this._closedLoop() && this.vCursor ? [...this.vCursor] : null
        };
    }
}
