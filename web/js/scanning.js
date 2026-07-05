// scanning.js — Motor de barrido / scanning (SPEC F2-1)
// Para usuarios de switch: los pulsadores comerciales (AbleNet, Bluetooth, 3D locales)
// emulan un click o una tecla — la activación llega por onSwitchActivate() sin
// integración de hardware.
//
// Patrones:
//   LINEAR     — resalta elemento por elemento; la activación selecciona.
//   ROW_COLUMN — resalta filas; la activación entra a la fila y barre sus elementos;
//                la segunda activación selecciona. Al terminar la fila sin selección,
//                vuelve al barrido de filas (escape implícito).

import { settings } from './config.js';
import { speak } from './speech.js';

// Beep corto por WebAudio (F2-4)
let audioCtx = null;
function beep() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = 880;
        gain.gain.value = 0.08;
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.06);
    } catch (e) { /* audio no disponible */ }
}

export class ScanEngine {
    // onSelect(target): mismo contrato que DwellEngine
    constructor(onSelect) {
        this.onSelect = onSelect;
        this.active = false;
        this.targets = [];
        this._resetRun();
    }

    _cfg() {
        return settings.scan || { pattern: 'ROW_COLUMN', intervalMs: 1200, cycles: 3, audio: 'none' };
    }

    _resetRun() {
        this.phase = 'IDLE';        // IDLE | GROUPS | ITEMS | PAUSED
        this.groups = [];
        this.gIdx = 0;
        this.iIdx = 0;
        this.cycleCount = 0;
        this.lastAdvance = 0;
        this.selectionPauseUntil = 0;
        this._clearHighlights();
    }

    setTargets(targets) {
        this._clearHighlights();
        this.targets = (targets || []).filter(t => t.element && t.element.offsetParent !== null || t.element);
        if (this.active) this._start();
    }

    start() {
        this.active = true;
        this._start();
    }

    stop() {
        this.active = false;
        this._resetRun();
        this._hidePauseHint();
    }

    _start() {
        this._resetRun();
        if (this.targets.length === 0) return;
        this.groups = this._buildGroups();
        const cfg = this._cfg();
        if (cfg.pattern === 'LINEAR' || this.groups.length <= 1) {
            // LINEAR: una sola "fila" con todos los elementos
            this.groups = [this.targets.slice()];
            this.phase = 'ITEMS';
            this.gIdx = 0;
        } else {
            this.phase = 'GROUPS';
        }
        this.iIdx = 0;
        this.lastAdvance = performance.now();
        this._applyHighlight(true); // primer resaltado: dura 50% más (aterrizaje)
    }

    // Agrupa por fila visual: celdas del grid por data.y; el resto (botones del
    // acumulador, cards del home) por su posición vertical en pantalla.
    _buildGroups() {
        const byRow = new Map();
        for (const t of this.targets) {
            let key;
            if (t.data && Number.isInteger(t.data.y)) {
                key = 'row-' + t.data.y;
            } else if (t.isAccBtn) {
                key = 'acc';
            } else {
                key = 'top-' + Math.round(t.element.getBoundingClientRect().top / 40);
            }
            if (!byRow.has(key)) byRow.set(key, []);
            byRow.get(key).push(t);
        }
        // Orden: filas del grid primero (por y), luego el resto, el grupo 'acc' al final (F2-1)
        const keys = [...byRow.keys()].sort((a, b) => {
            if (a === 'acc') return 1;
            if (b === 'acc') return -1;
            return a.localeCompare(b, undefined, { numeric: true });
        });
        return keys.map(k => byRow.get(k));
    }

    _currentSet() {
        if (this.phase === 'GROUPS') return this.groups[this.gIdx] || [];
        if (this.phase === 'ITEMS') return [(this.groups[this.gIdx] || [])[this.iIdx]].filter(Boolean);
        return [];
    }

    _clearHighlights() {
        document.querySelectorAll('.scan-highlight, .scan-highlight-group').forEach(el => {
            el.classList.remove('scan-highlight', 'scan-highlight-group');
        });
    }

    _applyHighlight(isFirst = false) {
        this._clearHighlights();
        const set = this._currentSet();
        const cls = this.phase === 'GROUPS' ? 'scan-highlight-group' : 'scan-highlight';
        set.forEach(t => t.element.classList.add(cls));
        this.firstBoost = isFirst;

        // Feedback auditivo (F2-4)
        const cfg = this._cfg();
        if (cfg.audio === 'beep') {
            beep();
        } else if (cfg.audio === 'speak' && this.phase === 'ITEMS' && set[0] && set[0].data) {
            const label = set[0].data.label ? (set[0].data.label.es || set[0].data.label.en) : null;
            if (label) speak(label, { cancelPrevious: true, volume: 0.5 });
        }
    }

    // Llamar por frame desde el loop principal.
    tick(now) {
        if (!this.active || this.phase === 'IDLE' || this.phase === 'PAUSED') return;
        if (now < this.selectionPauseUntil) return;

        const cfg = this._cfg();
        let interval = cfg.intervalMs;
        if (this.firstBoost) interval *= 1.5; // primer elemento del ciclo dura más

        if (now - this.lastAdvance < interval) return;
        this.lastAdvance = now;
        this.firstBoost = false;

        if (this.phase === 'GROUPS') {
            this.gIdx++;
            if (this.gIdx >= this.groups.length) {
                this.gIdx = 0;
                this.cycleCount++;
                if (this.cycleCount >= cfg.cycles) { this._pause(); return; }
                this._applyHighlight(true);
                return;
            }
            this._applyHighlight();
        } else if (this.phase === 'ITEMS') {
            this.iIdx++;
            const group = this.groups[this.gIdx] || [];
            if (this.iIdx >= group.length) {
                // Escape implícito: fila terminada sin selección
                this.iIdx = 0;
                if (this._cfg().pattern === 'LINEAR' || this.groups.length <= 1) {
                    this.cycleCount++;
                    if (this.cycleCount >= cfg.cycles) { this._pause(); return; }
                    this._applyHighlight(true);
                } else {
                    this.phase = 'GROUPS';
                    this._applyHighlight(true);
                }
                return;
            }
            this._applyHighlight();
        }
    }

    // Activación del switch (F2-2). Devuelve true si consumió el evento.
    activate() {
        if (!this.active) return false;
        const now = performance.now();

        if (this.phase === 'PAUSED') {
            this._hidePauseHint();
            this.cycleCount = 0;
            this.phase = (this._cfg().pattern === 'LINEAR' || this.groups.length <= 1) ? 'ITEMS' : 'GROUPS';
            this.gIdx = 0;
            this.iIdx = 0;
            this.lastAdvance = now;
            this._applyHighlight(true);
            return true;
        }

        if (this.phase === 'GROUPS') {
            this.phase = 'ITEMS';
            this.iIdx = 0;
            this.cycleCount = 0;
            this.lastAdvance = now;
            this._applyHighlight(true);
            return true;
        }

        if (this.phase === 'ITEMS') {
            const target = (this.groups[this.gIdx] || [])[this.iIdx];
            if (target) {
                this._clearHighlights();
                this.selectionPauseUntil = now + 600; // respiro post-selección
                this.onSelect(target);
                // Si la selección re-renderizó (navegación), setTargets ya reinició el motor.
                // Si no, volver al barrido de filas desde el inicio:
                if (this.phase === 'ITEMS' || this.phase === 'GROUPS') {
                    this.phase = (this._cfg().pattern === 'LINEAR' || this.groups.length <= 1) ? 'ITEMS' : 'GROUPS';
                    this.gIdx = 0;
                    this.iIdx = 0;
                    this.cycleCount = 0;
                    this.lastAdvance = now + 600;
                    this._applyHighlight(true);
                }
            }
            return true;
        }
        return false;
    }

    _pause() {
        this.phase = 'PAUSED';
        this._clearHighlights();
        this._showPauseHint();
    }

    _showPauseHint() {
        let hint = document.getElementById('scan-pause-hint');
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'scan-pause-hint';
            hint.textContent = 'Barrido en pausa — activá el pulsador para continuar';
            hint.style.cssText = 'position:fixed; bottom:120px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.85); color:#00ff88; padding:16px 30px; border-radius:40px; font-size:1.1rem; font-weight:600; z-index:15000;';
            document.body.appendChild(hint);
        }
        hint.style.display = 'block';
    }

    _hidePauseHint() {
        const hint = document.getElementById('scan-pause-hint');
        if (hint) hint.style.display = 'none';
    }
}
