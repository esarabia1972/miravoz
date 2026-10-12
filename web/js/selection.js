// selection.js — Validez temporal de la mirada y control de selección (M01, 11/10/2026)
//
// Problema que resuelve (reproducido en la revisión): con la cara perdida, los ojos cerrados o la cámara
// congelada, el cursor quedaba en su última posición y el dwell seguía corriendo: se seleccionaban celdas
// que la persona no estaba mirando. Reglas:
//  - Cada cuadro de cámara produce una MUESTRA (TrackingSample) con sesión, secuencia, momento de captura,
//    validez y motivo. Lo inválido se publica en el acto (sin rostro, parpadeo, pose, error, cámara detenida…).
//  - El dwell solo avanza con muestras NUEVAS (secuencia mayor), VÁLIDAS y RECIENTES (MAX_SAMPLE_AGE_MS).
//  - Cualquier invalidez reinicia todo: permanencia, candidato, filtros. Tras una interrupción hay que
//    completar una permanencia nueva y entera. Ni la misma muestra repetida ni el tiempo de suspensión suman.
// Módulo sin DOM (testeable con Node): main.js le pasa el dwell, los filtros y el reloj.

/**
 * @typedef {Object} TrackingSample
 * @property {number} sessionId      cambia al reiniciar cámara o motor
 * @property {number} sequence       único y creciente por cuadro nuevo
 * @property {number} capturedAt     performance.now() del hilo principal al tomar el cuadro
 * @property {number} receivedAt     ídem al tener el resultado (latencia = receivedAt - capturedAt)
 * @property {'CARA'} mode
 * @property {string} engineVersion
 * @property {string|null} profileRevision
 * @property {string} geometryId
 * @property {boolean} valid         true = x/y sirven para seleccionar
 * @property {string|null} reason    no-face | blink | no-features | pose | uncalibrated | offscreen | engine-error | stopped | hidden | inactive
 * @property {number|null} x         píxeles CSS del viewport
 * @property {number|null} y
 * @property {number[]|null} features features crudas del cuadro (para calibración), aunque x/y no sean válidos
 */

/**
 * Construye la muestra de un cuadro. Pura: recibe todo lo que necesita.
 * @param {Object} o
 * @param {'CARA'} o.mode
 * @param {boolean} o.face            hay rostro en el cuadro
 * @param {number[]|null} o.features  features del modo (null = no utilizables, p. ej. parpadeo)
 * @param {boolean} o.blink           el detector indica ojos cerrados 
 * @param {boolean} o.headOutOfPose   la cabeza salió de la pose de la calibración
 * @param {boolean} o.active          la app está en un estado donde se puede seleccionar (tablero/inicio)
 * @param {Function|null} o.predict   features → [x, y] (null = sin calibración)
 * @param {{w:number,h:number}} o.viewport
 * @param {number} [o.offscreenMargin=0.1] fracción del viewport fuera de la cual la predicción es inválida
 */
export function buildSample(o) {
    const base = {
        sessionId: o.sessionId, sequence: o.sequence, capturedAt: o.capturedAt, receivedAt: o.receivedAt ?? o.capturedAt,
        mode: o.mode, engineVersion: o.engineVersion || '', profileRevision: o.profileRevision ?? null,
        geometryId: o.geometryId || '', valid: false, reason: null, x: null, y: null,
        features: o.features || null
    };
    const fail = (reason) => ({ ...base, reason });
    if (o.error) return fail('engine-error');
    if (!o.face) return fail('no-face');
    if (o.blink) return { ...fail('blink'), features: null };
    if (!o.features) return fail('no-features');
    if (o.headOutOfPose) return fail('pose');
    if (!o.active) return fail('inactive');
    if (!o.predict) return fail('uncalibrated');
    const [px, py] = o.predict(o.features);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return fail('no-features');
    const { w, h } = o.viewport;
    const m = o.offscreenMargin ?? 0.1;
    // Muy fuera de la pantalla: no se "recorta al borde" para convertirlo en una selección válida
    if (px < -w * m || px > w * (1 + m) || py < -h * m || py > h * (1 + m)) return fail('offscreen');
    return { ...base, valid: true, x: Math.max(0, Math.min(w, px)), y: Math.max(0, Math.min(h, py)) };
}

/** Muestra inválida sin cuadro (cámara detenida, pestaña oculta, error al iniciar). */
export function invalidSample(reason, { sessionId = 0, sequence = 0, now = 0, mode = 'CARA' } = {}) {
    return { sessionId, sequence, capturedAt: now, receivedAt: now, mode, engineVersion: '', profileRevision: null,
             geometryId: '', valid: false, reason, x: null, y: null, features: null };
}

/**
 * Control de selección por puntero (Rostro). Decide, en cada refresco de pantalla, qué hacer con la
 * última muestra publicada:
 *  - 'tick'    muestra nueva, válida y reciente → filtra y avanza el dwell (con el reloj de captura)
 *  - 'hold'    la misma muestra todavía reciente → se dibuja el cursor, el dwell NO avanza
 *  - 'invalid' sin muestra, inválida, vencida, de otra sesión o anterior a una interrupción → se reinicia todo
 */
export class PointerController {
    /**
     * @param {Object} deps
     * @param {{tick:Function, invalidate:Function}} deps.dwell
     * @param {{filter:Function, reset:Function}} deps.filterX
     * @param {{filter:Function, reset:Function}} deps.filterY
     * @param {() => number} deps.maxAgeMs
     * @param {(reason:string) => void} [deps.onInvalidate]  p. ej. cancelar el aprendizaje pendiente
     */
    constructor({ dwell, filterX, filterY, maxAgeMs, onInvalidate = () => {} }) {
        Object.assign(this, { dwell, filterX, filterY, maxAgeMs, onInvalidate });
        this.lastSequence = -1;
        this.lastSessionId = null;
        this.notBefore = -Infinity;   // muestras capturadas antes de esto no cuentan (interrupción)
        this.invalid = true;
        this.reason = 'start';
        this.cursor = null;
    }

    /** Interrupción explícita (pestaña oculta, cambio de modo, calibración nueva, error de motor…). */
    invalidate(reason, now) {
        if (now !== undefined) this.notBefore = Math.max(this.notBefore, now);
        this._reset(reason);
    }

    _reset(reason) {
        if (!this.invalid || this.reason !== reason) this.onInvalidate(reason);
        this.invalid = true;
        this.reason = reason;
        this.cursor = null;
        this.dwell.invalidate();
        this.filterX.reset();
        this.filterY.reset();
    }

    /**
     * ¿La muestra es nueva, de la sesión vigente, posterior a la última interrupción y reciente?
     * Devuelve 'new' | 'repeat' | 'stale' | 'old-session' | 'before-interruption' | 'none'.
     */
    classify(sample, now) {
        if (!sample) return 'none';
        if (sample.capturedAt < this.notBefore) return 'before-interruption';
        if (this.lastSessionId !== null && sample.sessionId < this.lastSessionId) return 'old-session';
        if (now - sample.capturedAt > this.maxAgeMs()) return 'stale';
        if (sample.sessionId === this.lastSessionId && sample.sequence <= this.lastSequence) return 'repeat';
        return 'new';
    }

    /** Llamar en cada refresco. Devuelve { action, reason, x, y }. */
    step(sample, now) {
        const kind = this.classify(sample, now);
        if (kind === 'repeat' && !this.invalid && this.cursor) {
            return { action: 'hold', reason: null, x: this.cursor.x, y: this.cursor.y };
        }
        if (kind !== 'new' && kind !== 'repeat') {
            this._reset(kind === 'none' ? 'no-sample' : kind);
            return { action: 'invalid', reason: this.reason, x: null, y: null };
        }
        if (kind === 'new') {
            if (sample.sessionId !== this.lastSessionId) this.lastSequence = -1;
            this.lastSessionId = sample.sessionId;
            this.lastSequence = sample.sequence;
        }
        if (!sample.valid) {
            this._reset(sample.reason || 'invalid');
            return { action: 'invalid', reason: this.reason, x: null, y: null };
        }
        if (kind === 'repeat') { // inválida antes y la misma muestra: nada que hacer hasta una nueva
            return { action: 'invalid', reason: this.reason, x: null, y: null };
        }
        // Validez ANTES del suavizado (el filtro nunca convierte una predicción inválida en válida)
        const t = sample.capturedAt;
        const x = this.filterX.filter(sample.x, t);
        const y = this.filterY.filter(sample.y, t);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            this._reset('filter');
            return { action: 'invalid', reason: this.reason, x: null, y: null };
        }
        this.invalid = false;
        this.reason = null;
        this.cursor = { x, y };
        this.dwell.tick(x, y, t);
        return { action: 'tick', reason: null, x, y };
    }

    /**
     * Para la calibración: devuelve las features de la muestra solo si es NUEVA y reciente (una por cuadro
     * de cámara, nunca repetida por refrescar la pantalla más rápido que la cámara). null en otro caso.
     */
    takeNewFeatures(sample, now) {
        const s = this.takeNewSample(sample, now);
        return s ? (s.features || null) : null;
    }

    /** La muestra si es NUEVA y reciente (aunque no sea válida para el puntero), o null. */
    takeNewSample(sample, now) {
        const kind = this.classify(sample, now);
        if (kind !== 'new') return null;
        if (sample.sessionId !== this.lastSessionId) this.lastSequence = -1;
        this.lastSessionId = sample.sessionId;
        this.lastSequence = sample.sequence;
        return sample;
    }
}

/** Mensaje para la persona de apoyo según el motivo de la pausa ('' = no mostrar). */
export function pauseMessage(reason) {
    switch (reason) {
        case 'no-face': return 'No se ve la cara: el cursor está en pausa';
        case 'blink': return '';
        case 'pose': return 'Volvé a poner la cabeza como en la calibración';
        case 'stale': case 'no-sample': return 'La cámara no está enviando imágenes';
        case 'engine-error': return 'La cámara tuvo un error: reintentando';
        case 'offscreen': return '';
        default: return '';
    }
}
