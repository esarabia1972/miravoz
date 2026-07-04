// dwell.js — Motor de fijación con histéresis y cache de rects (SPEC F0-6, F1-6)

import { CONFIG } from './config.js';

export class DwellEngine {
    // onSelect(target): callback al completar el dwell sobre un target
    constructor(onSelect) {
        this.onSelect = onSelect;
        this.targets = [];          // [{element, data, isBoardCard, isAccBtn}]
        this.rects = [];            // [{target, rect}] — cache (F1-6)
        this.lastRectRefresh = 0;
        this.reset();

        window.addEventListener('resize', () => this.refreshRects());
        window.addEventListener('scroll', () => this.refreshRects(), true);
    }

    reset() {
        this._clearVisual(this.currentTarget);
        this.currentTarget = null;
        this.candidateTarget = null;
        this.candidateSince = 0;
        this.dwellStartTime = 0;
        this.lastClickTime = 0;
    }

    // Reemplaza el conjunto de targets activos. Mide los rects en el próximo frame
    // (la vista puede no estar layouteada todavía).
    setTargets(targets) {
        this.reset();
        this.targets = targets || [];
        requestAnimationFrame(() => this.refreshRects());
    }

    refreshRects() {
        this.rects = this.targets.map(t => ({ target: t, rect: t.element.getBoundingClientRect() }));
        this.lastRectRefresh = performance.now();
    }

    _hitTest(x, y) {
        for (const { target, rect } of this.rects) {
            if (rect.width === 0 && rect.height === 0) continue; // nodo oculto/detached
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return target;
        }
        return null;
    }

    _bar(target) {
        return target ? target.element.querySelector('.progress-bar') : null;
    }

    _clearVisual(target) {
        if (!target || !target.element) return;
        target.element.classList.remove('active', 'clicked');
        const bar = this._bar(target);
        if (bar) bar.style.width = '0%';
    }

    // Llamar por frame con la posición suavizada del puntero.
    tick(x, y, now) {
        // Red de seguridad: refresco periódico del cache (layout pudo cambiar sin aviso)
        if (now - this.lastRectRefresh > CONFIG.RECT_REFRESH_MS) this.refreshRects();

        const hovered = this._hitTest(x, y);

        // Histéresis unificada (F0-6 v2): la nueva situación (otra celda o vacío)
        // debe persistir HYSTERESIS_MS antes de aceptarse.
        if (hovered !== this.currentTarget) {
            if (hovered !== this.candidateTarget) {
                this.candidateTarget = hovered;
                this.candidateSince = now;
            }
            if (now - this.candidateSince > CONFIG.HYSTERESIS_MS) {
                this._clearVisual(this.currentTarget);
                this.currentTarget = this.candidateTarget;
                if (this.currentTarget) {
                    this.currentTarget.element.classList.add('active');
                    this.dwellStartTime = now;
                }
            }
        } else {
            this.candidateTarget = null;
        }

        if (!this.currentTarget) return;

        if (now - this.lastClickTime <= CONFIG.DWELL_COOLDOWN_MS) {
            // En cooldown: no acumula progreso
            this.dwellStartTime = now;
            const bar = this._bar(this.currentTarget);
            if (bar) bar.style.width = '0%';
            return;
        }

        const dwellTime = now - this.dwellStartTime;
        if (dwellTime >= CONFIG.DWELL_MS) {
            this.currentTarget.element.classList.add('clicked');
            const selected = this.currentTarget;
            this.dwellStartTime = now;
            this.lastClickTime = performance.now();
            const bar = this._bar(selected);
            if (bar) bar.style.width = '0%';
            this.onSelect(selected);
        } else {
            const bar = this._bar(this.currentTarget);
            if (bar) bar.style.width = `${(dwellTime / CONFIG.DWELL_MS) * 100}%`;
        }
    }
}
