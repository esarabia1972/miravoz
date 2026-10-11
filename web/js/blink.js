// blink.js — Parpadeo voluntario como forma de seleccionar (1.4.0) · Módulo PURO (sin DOM), testeable con Node.
//
// El parpadeo es a la vez un gesto voluntario y un reflejo (15-20 por minuto, 100-300 ms). Para no confundirlos:
//   - 'long'   : parpadeo LARGO — ojos cerrados al menos holdMs (por defecto 600 ms). El reflejo nunca dura tanto.
//   - 'double' : DOS parpadeos cortos seguidos (cada uno 60-450 ms, el segundo empieza ≤ 600 ms después del primero).
// Señal: blendshapes eyeBlinkLeft/Right de FaceLandmarker (0 = abierto, 1 = cerrado), promedio de los dos ojos.
// Histéresis: se considera "cerrado" por encima del umbral y "abierto" recién por debajo de umbral − 0,15
// (mirar hacia abajo baja los párpados y sube la señal: el umbral se ajusta por persona con calibrateThreshold).
// Después de cada selección hay un período refractario (no se encadenan selecciones).

export const BLINK_DEFAULTS = { mode: 'off', holdMs: 600, threshold: 0.5, selectWith: 'both' };
export const BLINK_LIMITS = { minThreshold: 0.25, maxThreshold: 0.85, hysteresis: 0.15, refractoryMs: 900,
    doubleMinMs: 60, doubleMaxMs: 450, doubleGapMs: 600, maxGapMs: 250 };

/** Cierre de ojos 0..1 a partir de los blendshapes (null si no hay datos). */
export function eyeClosure(eyes) {
    if (!eyes) return null;
    const l = eyes.eyeBlinkLeft, r = eyes.eyeBlinkRight;
    if (!Number.isFinite(l) && !Number.isFinite(r)) return null;
    if (!Number.isFinite(l)) return r;
    if (!Number.isFinite(r)) return l;
    return (l + r) / 2;
}

export class BlinkDetector {
    constructor(opts = {}) { this.configure(opts); this.reset(); }
    configure({ mode, holdMs, threshold } = {}) {
        if (mode) this.mode = mode;
        if (Number.isFinite(holdMs)) this.holdMs = holdMs;
        if (Number.isFinite(threshold)) this.threshold = Math.max(BLINK_LIMITS.minThreshold, Math.min(BLINK_LIMITS.maxThreshold, threshold));
        this.mode ??= BLINK_DEFAULTS.mode; this.holdMs ??= BLINK_DEFAULTS.holdMs; this.threshold ??= BLINK_DEFAULTS.threshold;
    }
    reset() {
        this.closed = false; this.closedAt = 0; this.fired = false;
        this.lastT = null; this.lastShort = null; this.refractoryUntil = 0; this.value = null;
    }
    /**
     * Un cuadro NUEVO de cámara. closure = 0..1 o null (sin cara). t = momento de captura (ms).
     * → { fire: boolean, closedAt?: number } — fire=true una sola vez por gesto voluntario reconocido.
     */
    push(closure, t) {
        if (this.mode === 'off') return { fire: false };
        // Sin cara, o un hueco largo entre cuadros: se pierde el gesto en curso (no se adivina)
        if (closure === null || !Number.isFinite(closure) || (this.lastT !== null && t - this.lastT > BLINK_LIMITS.maxGapMs)) {
            const wasClosed = this.closed;
            this.closed = false; this.fired = false; this.lastT = closure === null ? null : t; this.value = closure;
            if (wasClosed) this.lastShort = null;
            if (closure === null) return { fire: false };
        }
        this.lastT = t; this.value = closure;
        const closeTh = this.threshold, openTh = this.threshold - BLINK_LIMITS.hysteresis;
        if (!this.closed && closure >= closeTh) {
            this.closed = true; this.closedAt = t; this.fired = false;
        } else if (this.closed && closure <= openTh) {
            this.closed = false;
            const dur = t - this.closedAt;
            if (this.mode === 'double' && !this.fired) {
                const isShort = dur >= BLINK_LIMITS.doubleMinMs && dur <= BLINK_LIMITS.doubleMaxMs;
                if (isShort && this.lastShort && this.closedAt - this.lastShort.end <= BLINK_LIMITS.doubleGapMs && t >= this.refractoryUntil) {
                    const at = this.lastShort.start;
                    this.lastShort = null;
                    this.refractoryUntil = t + BLINK_LIMITS.refractoryMs;
                    return { fire: true, closedAt: at };
                }
                this.lastShort = isShort ? { start: this.closedAt, end: t } : null;
            }
            this.fired = false;
            return { fire: false };
        }
        if (this.mode === 'long' && this.closed && !this.fired && t - this.closedAt >= this.holdMs && t >= this.refractoryUntil) {
            this.fired = true; // un solo disparo por cierre: hay que abrir los ojos para el siguiente
            this.refractoryUntil = t + BLINK_LIMITS.refractoryMs;
            return { fire: true, closedAt: this.closedAt };
        }
        return { fire: false };
    }
    /** Progreso 0..1 del parpadeo largo en curso (para dibujar el anillo); 0 si no aplica. */
    progress(t) {
        if (this.mode !== 'long' || !this.closed || this.fired) return 0;
        return Math.max(0, Math.min(1, (t - this.closedAt) / this.holdMs));
    }
}

/**
 * Ajuste por persona: con muestras de ojos ABIERTOS (mirando la pantalla, también abajo) y ojos CERRADOS,
 * el umbral queda entre el percentil 95 de "abiertos" y la mediana de "cerrados".
 * → { threshold, ok, reason } (ok=false si no se distinguen bien: hay que repetir o no usar el parpadeo).
 */
export function calibrateThreshold(openSamples, closedSamples) {
    const clean = (a) => (a || []).filter(Number.isFinite).sort((x, y) => x - y);
    const o = clean(openSamples), c = clean(closedSamples);
    if (o.length < 10 || c.length < 5) return { threshold: BLINK_DEFAULTS.threshold, ok: false, reason: 'pocas-muestras' };
    const q = (a, p) => a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))];
    const openHigh = q(o, 0.95), closedMid = q(c, 0.5);
    if (closedMid - openHigh < 0.2) return { threshold: BLINK_DEFAULTS.threshold, ok: false, reason: 'poca-diferencia', openHigh, closedMid };
    const th = openHigh + 0.5 * (closedMid - openHigh);
    return { threshold: +Math.max(BLINK_LIMITS.minThreshold, Math.min(BLINK_LIMITS.maxThreshold, th)).toFixed(3), ok: true, openHigh, closedMid };
}
