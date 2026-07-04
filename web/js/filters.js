// filters.js — Filtro 1 Euro (SPEC F1-2)
// Casiez, Roussel & Vogel (2012). Estándar de facto para suavizado de punteros:
// filtra fuerte cuando el movimiento es lento (mata jitter) y suaviza poco cuando
// es rápido (no agrega lag perceptible).

class LowPass {
    constructor() { this.y = null; }
    filter(x, alpha) {
        this.y = (this.y === null) ? x : alpha * x + (1 - alpha) * this.y;
        return this.y;
    }
}

export class OneEuroFilter {
    constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
        this.reset();
    }

    _alpha(cutoff, dt) {
        const tau = 1 / (2 * Math.PI * cutoff);
        return 1 / (1 + tau / dt);
    }

    // x: medición cruda; tMs: timestamp en milisegundos (performance.now())
    filter(x, tMs) {
        const t = tMs / 1000;
        if (this.tPrev === null) {
            this.tPrev = t;
            this.xPrev = x;
            this.xLP.filter(x, 1);
            this.dxLP.filter(0, 1);
            return x;
        }
        const dt = Math.max(t - this.tPrev, 1e-3);
        this.tPrev = t;

        const dx = (x - this.xPrev) / dt;
        this.xPrev = x;

        const edx = this.dxLP.filter(dx, this._alpha(this.dCutoff, dt));
        const cutoff = this.minCutoff + this.beta * Math.abs(edx);
        return this.xLP.filter(x, this._alpha(cutoff, dt));
    }

    reset() {
        this.xLP = new LowPass();
        this.dxLP = new LowPass();
        this.tPrev = null;
        this.xPrev = null;
    }
}
