// vision-scheduler.js — Cola de cuadros hacia el motor de visión y métricas de rendimiento (M06, 11/10/2026)
// Módulo PURO (sin DOM), testeable con Node.
//
// Reglas (no construir una cola creciente):
//  - como máximo UN cuadro en procesamiento y, como máximo, UNO pendiente (el más reciente);
//  - si llega un cuadro nuevo con otro pendiente, el pendiente se descarta (y se libera: bitmap.close());
//  - un resultado de otra sesión o de una secuencia ya superada se descarta;
//  - si el motor no responde en `timeoutMs`, se declara caído (la mirada se invalida antes de recuperar).

export class FrameScheduler {
    /**
     * @param {Object} o
     * @param {(frame) => void} o.send       envía un cuadro al motor
     * @param {(frame) => void} [o.release]  libera un cuadro descartado (p. ej. bitmap.close())
     * @param {number} [o.timeoutMs=2000]
     */
    constructor({ send, release = () => {}, timeoutMs = 2000 }) {
        Object.assign(this, { send, release, timeoutMs });
        this.inFlight = null;     // { sessionId, sequence, capturedAt, sentAt, ... }
        this.pending = null;
        this.sessionId = 1;
        this.lastResultSeq = -1;
        this.dropped = 0;
        this.dead = false;
    }

    /** Nueva sesión (motor reiniciado): todo lo anterior se descarta. */
    newSession() {
        this.sessionId++;
        if (this.pending) { this.release(this.pending); this.pending = null; }
        this.inFlight = null;
        this.lastResultSeq = -1;
        this.dead = false;
    }

    /** Ofrece un cuadro. Devuelve 'sent' | 'queued' | 'dropped-dead'. */
    submit(frame, now) {
        if (this.dead) { this.release(frame); return 'dropped-dead'; }
        const f = { ...frame, sessionId: this.sessionId };
        if (!this.inFlight) { this._send(f, now); return 'sent'; }
        if (this.pending) { this.release(this.pending); this.dropped++; }
        this.pending = f;
        return 'queued';
    }

    _send(f, now) {
        this.inFlight = { ...f, sentAt: now };
        this.send(f);
    }

    /**
     * Llega un resultado. Devuelve true si es utilizable (sesión vigente y secuencia nueva).
     * Siempre libera el lugar en vuelo y manda el pendiente si lo hay.
     */
    onResult(result, now) {
        const usable = !this.dead && result && result.sessionId === this.sessionId && result.sequence > this.lastResultSeq;
        if (result && result.sessionId === this.sessionId) {
            if (usable) this.lastResultSeq = result.sequence;
            if (this.inFlight && this.inFlight.sequence === result.sequence) this.inFlight = null;
        }
        if (!this.inFlight && this.pending && !this.dead) {
            const next = this.pending;
            this.pending = null;
            this._send(next, now);
        }
        return !!usable;
    }

    /** Llamar periódicamente: ¿el motor dejó de responder? */
    checkTimeout(now) {
        if (this.inFlight && !this.dead && now - this.inFlight.sentAt > this.timeoutMs) {
            this.dead = true;
            if (this.pending) { this.release(this.pending); this.pending = null; }
            return true;
        }
        return false;
    }
}

/** Ventana deslizante de mediciones con percentiles. */
export class RollingStats {
    constructor(size = 300) { this.size = size; this.values = []; }
    push(v) { if (Number.isFinite(v)) { this.values.push(v); if (this.values.length > this.size) this.values.shift(); } }
    percentile(p) {
        if (!this.values.length) return null;
        const s = [...this.values].sort((a, b) => a - b);
        return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
    }
    get count() { return this.values.length; }
}

/** Contador de cuadros únicos por segundo (ventana de 1 s). */
export class RateCounter {
    constructor() { this.times = []; }
    tick(now) { this.times.push(now); while (this.times.length && this.times[0] < now - 1000) this.times.shift(); }
    rate(now) { while (this.times.length && this.times[0] < now - 1000) this.times.shift(); return this.times.length; }
}
