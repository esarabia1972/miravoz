// benchmark.js — Arnés de métricas del motor (SPEC F1-7)
// Activar con ?benchmark=1. Mide tasa de acierto y tiempo por selección en
// grillas 3x3 y 4x4. Los resultados se persisten en localforage ('miravoz_benchmarks')
// y son el criterio de aceptación de la Fase 1 (≥95% en 3x3, ≥85% en 4x4).

import { S } from './state.js';
import { openBundle, activeGridElements, IMPORTER_VERSION } from './boards.js';
import { speak } from './speech.js';

const TARGETS_PER_GRID = 20;
const STORAGE_KEY = 'miravoz_benchmarks';

function buildGridBundle(n) {
    const els = [];
    for (let i = 1; i <= n * n; i++) {
        els.push({
            x: (i - 1) % n,
            y: Math.floor((i - 1) / n),
            label: { es: i.toString() },
            image: null,
            actions: []
        });
    }
    return {
        id: `benchmark_${n}x${n}`,
        name: `Benchmark ${n}x${n}`,
        type: 'test',
        importerVersion: IMPORTER_VERSION,
        mainBoard: 'main',
        boards: { main: { id: 'main', rowCount: n, minColumnCount: n, gridElements: els } }
    };
}

export class Benchmark {
    constructor() {
        this.active = false;
        this.phases = [3, 4];
        this.reset();
    }

    reset() {
        this.phaseIdx = 0;
        this.results = [];       // por fase: {grid, records: [{target, hit, ms}]}
        this.currentTarget = null;
        this.targetShownAt = 0;
        this.pending = 0;
    }

    start() {
        this.reset();
        this.active = true;
        this._openPhase();
    }

    _openPhase() {
        const n = this.phases[this.phaseIdx];
        this.results.push({ grid: `${n}x${n}`, records: [] });
        this.pending = TARGETS_PER_GRID;
        openBundle(buildGridBundle(n));
        speak(`Benchmark ${n} por ${n}. Seleccioná el número indicado.`);
        setTimeout(() => this._nextTarget(), 1500);
    }

    _cells() {
        return activeGridElements.filter(t => !t.isAccBtn);
    }

    _nextTarget() {
        this._clearHighlight();
        const cells = this._cells();
        if (cells.length === 0) return;
        this.currentTarget = cells[Math.floor(Math.random() * cells.length)];
        this.currentTarget.element.style.outline = '8px solid #ffdd00';
        this.currentTarget.element.style.outlineOffset = '-8px';
        this.targetShownAt = performance.now();
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
        if (!this.active || !this.currentTarget) return;
        const ms = Math.round(performance.now() - this.targetShownAt);
        const hit = elData === this.currentTarget.data;
        const phase = this.results[this.results.length - 1];
        phase.records.push({ target: this.currentTarget.data.label.es, hit, ms });
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

        const summary = this.results.map(phase => {
            const n = phase.records.length;
            const hits = phase.records.filter(r => r.hit).length;
            const meanMs = Math.round(phase.records.reduce((a, r) => a + r.ms, 0) / Math.max(n, 1));
            return { grid: phase.grid, targets: n, correct: hits, accuracy: +(hits / Math.max(n, 1) * 100).toFixed(1), meanTimeMs: meanMs };
        });

        const entry = { ts: Date.now(), mode: S.trackingMode, summary, detail: this.results };
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
        overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:30000; display:flex; align-items:center; justify-content:center;';
        const box = document.createElement('div');
        box.style.cssText = 'background:#1a1a2e; border-radius:20px; padding:40px; color:white; font-family:Inter,sans-serif; text-align:center; max-width:500px;';
        const title = document.createElement('h2');
        title.textContent = `Resultados del Benchmark (${S.trackingMode})`;
        box.appendChild(title);

        summary.forEach(s => {
            const p = document.createElement('p');
            p.style.fontSize = '1.2rem';
            const ok = (s.grid === '3x3' && s.accuracy >= 95) || (s.grid === '4x4' && s.accuracy >= 85);
            p.textContent = `${s.grid}: ${s.accuracy}% de acierto (${s.correct}/${s.targets}) · ${(s.meanTimeMs / 1000).toFixed(1)}s por selección ${ok ? '✅' : '❌'}`;
            box.appendChild(p);
        });

        const note = document.createElement('p');
        note.style.cssText = 'color:#aaa; font-size:0.85rem;';
        note.textContent = 'Criterio Fase 1: ≥95% en 3x3 y ≥85% en 4x4. Guardado en miravoz_benchmarks.';
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
