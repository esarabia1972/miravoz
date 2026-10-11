// benchmark.js — Arnés de métricas del motor (SPEC F1-7)
// Activar con ?benchmark=1. Mide tasa de acierto y tiempo por selección en
// grillas 3x3 y 4x4. Los resultados se persisten en localforage ('miravoz_benchmarks')
// y son el criterio de aceptación de la Fase 1 (≥95% en 3x3, ≥85% en 4x4).

import { S } from './state.js';
import { openBundle, activeGridElements, IMPORTER_VERSION } from './boards.js';
import { speak } from './speech.js';
import * as tracking from './tracking.js';
import { summarizePhase } from './validation.js';

const TARGETS_PER_GRID = 20;
const STORAGE_KEY = 'miravoz_benchmarks';
// M04: cada objetivo tiene un tiempo máximo (si no se selecciona, cuenta como omisión) y antes de cada grilla
// hay un DESCANSO en el que no se pide nada: cualquier activación ahí es involuntaria.
export const TARGET_TIMEOUT_MS = 15000;
export const REST_MS = 10000;

export class Benchmark {
    constructor() {
        this.active = false;
        this.phases = [3, 4];
        this.reset();
    }

    reset() {
        this.phaseIdx = 0;
        this.results = [];       // por fase: {grid, records: [{target, hit, timeout, ms}], restMs, restActivations, durationMs}
        this.currentTarget = null;
        this.targetShownAt = 0;
        this.pending = 0;
        this.resting = false;
        clearTimeout(this.timeoutTimer);
        clearTimeout(this.restTimer);
    }

    start() {
        this.reset();
        this.active = true;
        this._openPhase();
    }

    _openPhase() {
        const n = this.phases[this.phaseIdx];
        this.results.push({ grid: `${n}x${n}`, records: [], restMs: REST_MS, restActivations: 0, durationMs: 0, startedAt: performance.now() });
        this.pending = TARGETS_PER_GRID;
        openBundle(buildGridBundle(n));
        // Descanso: no se pide nada. Lo que se active acá es una activación involuntaria.
        this.resting = true;
        speak(`Benchmark ${n} por ${n}. Primero, descansá unos segundos sin mirar nada en especial.`);
        this.restTimer = setTimeout(() => {
            this.resting = false;
            speak('Ahora, seleccioná el número indicado.');
            setTimeout(() => this._nextTarget(), 1500);
        }, REST_MS);
    }

    _cells() {
        return activeGridElements.filter(t => !t.isAccBtn);
    }

    _nextTarget() {
        this._clearHighlight();
        const cells = this._cells();
        if (cells.length === 0) return;
        this.currentTarget = cells[Math.floor(Math.random() * cells.length)];
        this.currentTarget.element.style.outline = '8px solid var(--scan-group)';
        this.currentTarget.element.style.outlineOffset = '-8px';
        this.targetShownAt = performance.now();
        clearTimeout(this.timeoutTimer);
        this.timeoutTimer = setTimeout(() => this._record(null, true), TARGET_TIMEOUT_MS);
    }

    _clearHighlight() {
        if (this.currentTarget && this.currentTarget.element) {
            this.currentTarget.element.style.outline = '';
            this.currentTarget.element.style.outlineOffset = '';
        }
        this.currentTarget = null;
    }

    // Llamado desde hooks.onCellActivated
    onActivated(elData) {
        if (!this.active) return;
        if (this.resting) { this.results[this.results.length - 1].restActivations++; return; }
        if (!this.currentTarget) return;
        this._record(elData, false);
    }

    _record(elData, timeout) {
        if (!this.currentTarget) return;
        clearTimeout(this.timeoutTimer);
        const ms = Math.round(performance.now() - this.targetShownAt);
        const hit = !timeout && elData === this.currentTarget.data;
        const phase = this.results[this.results.length - 1];
        phase.records.push({ target: this.currentTarget.data.label.es, hit, timeout: !!timeout, ms });
        phase.durationMs = Math.round(performance.now() - phase.startedAt);
        this.pending--;

        if (this.pending > 0) {
            this._nextTarget();
        } else if (this.phaseIdx < this.phases.length - 1) {
            this.phaseIdx++;
            this._openPhase();
        } else {
            this._finish();
        }
    }

    async _finish() {
        this._clearHighlight();
        this.active = false;

        clearTimeout(this.timeoutTimer);
        const summary = this.results.map(summarizePhase);

        // engine: 'tasks' (FaceLandmarker) o 'legacy' (FaceMesh) — para comparar motores con ?engine=legacy
        const entry = { ts: Date.now(), mode: S.trackingMode, engine: tracking.engineName, fps: Math.round(tracking.fps), summary, detail: this.results };
        try {
            const prev = (await localforage.getItem(STORAGE_KEY)) || [];
            prev.push(entry);
            await localforage.setItem(STORAGE_KEY, prev);
        } catch (e) {
            console.error('Error guardando benchmark:', e);
        }

        this._showResults(summary);
        console.table(summary);
    }

    _showResults(summary) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed; inset:0; background:var(--overlay-bg); z-index:30000; display:flex; align-items:center; justify-content:center;';
        const box = document.createElement('div');
        box.style.cssText = 'background:var(--modal-solid); border-radius:20px; padding:40px; color:var(--text-main); font-family:Inter,sans-serif; text-align:center; max-width:500px;';
        const title = document.createElement('h2');
        title.textContent = `Resultados del Benchmark (${S.trackingMode} · motor ${tracking.engineName === 'tasks' ? 'FaceLandmarker' : 'FaceMesh legado'} · ${Math.round(tracking.fps)} fps)`;
        box.appendChild(title);

        summary.forEach(s => {
            const p = document.createElement('p');
            p.style.fontSize = '1.2rem';
            const ok = (s.grid === '3x3' && s.accuracy >= 95) || (s.grid === '4x4' && s.accuracy >= 85);
            const t = s.medianTimeMs !== null ? `mediana ${(s.medianTimeMs / 1000).toFixed(1)} s, p90 ${(s.p90TimeMs / 1000).toFixed(1)} s` : 'sin selecciones correctas';
            p.textContent = `${s.grid}: ${s.correct}/${s.targets} correctas (${s.accuracy}%) · ${s.wrong} errores · ${s.timeouts} omisiones · ${t} · ${s.restActivations} activaciones en el descanso · ${ok ? 'cumple la meta interna' : 'no cumple la meta interna'}`;
            box.appendChild(p);
        });

        const note = document.createElement('p');
        note.style.cssText = 'color:var(--text-muted); font-size:0.85rem;';
        note.textContent = 'Metas internas del proyecto (no son un estándar clínico): ≥95% en 3x3 y ≥85% en 4x4, contando errores y omisiones. Guardado en miravoz_benchmarks.';
        box.appendChild(note);

        const btn = document.createElement('button');
        btn.textContent = 'Cerrar';
        btn.style.cssText = 'margin-top:20px; padding:12px 30px; border-radius:10px; border:none; background:#00ff88; color:black; font-weight:bold; cursor:pointer; font-size:1rem;';
        btn.onclick = () => overlay.remove();
        box.appendChild(btn);

        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }
}
