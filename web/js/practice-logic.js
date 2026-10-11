// practice-logic.js — Reglas de las actividades de Practicar (1.3.0) · Módulo PURO (sin DOM), testeable con Node.
//
// Progresión de habilidades de acceso (como en Look to Learn y la práctica clínica de CAA con mirada/cabeza):
//   1. Causa y efecto  — cualquier movimiento produce algo (no hay error posible)
//   2. Exploración     — recorrer TODA la pantalla (bordes y esquinas incluidos)
//   3. Apuntar         — llegar a un lugar y quedarse (permanencia), con objetivos que se achican
//   4. Elegir          — decidir entre 2, 3 y 4 opciones (paso previo a los tableros)
//   5. Seguir          — acompañar algo que se mueve despacio
// Principio común: aprendizaje sin error. Nada de "perdiste", nada que presione; si cuesta, se facilita solo.

export const LEVELS = [
    { id: 1, key: 'paint',   title: 'Pintar con sonido', skill: 'Causa y efecto', pointerOnly: true,
      hint: 'Mové la cabeza: la pantalla se pinta y suena.', hintTouch: 'Arrastrá el dedo: la pantalla se pinta y suena.' },
    { id: 2, key: 'reveal',  title: 'Descubrir',         skill: 'Explorar',       pointerOnly: true,
      hint: 'Recorré toda la pantalla para descubrir el dibujo.', hintTouch: 'Pasá el dedo por toda la pantalla para descubrir el dibujo.' },
    { id: 3, key: 'balloon', title: 'Globos',            skill: 'Apuntar',        pointerOnly: false,
      hint: 'Llevá el cursor al globo y quedate ahí hasta que explote.', hintTouch: 'Tocá el globo para que explote.', hintScan: 'Cuando se ilumine el globo, tocá la pantalla o el pulsador.' },
    { id: 4, key: 'choose',  title: 'Elegir',            skill: 'Elegir',         pointerOnly: false,
      hint: 'Elegí qué querés escuchar.', hintScan: 'Elegí qué querés escuchar: cuando se ilumine, tocá la pantalla o el pulsador.' },
    { id: 5, key: 'follow',  title: 'Seguir',            skill: 'Seguir',         pointerOnly: true,
      hint: 'Seguí a la luciérnaga con el cursor.', hintTouch: 'Seguí a la luciérnaga con el dedo.' }
];
/** Consigna según el modo de acceso (CARA/OJOS: cursor; CLICKS: dedo; SCAN: pulsador). */
export function hintFor(level, mode) {
    if (mode === 'SCAN' && level.hintScan) return level.hintScan;
    if (mode === 'CLICKS' && level.hintTouch) return level.hintTouch;
    return level.hint;
}

// --- Nivel 1 y 2: grilla de cobertura (qué partes de la pantalla ya se recorrieron) ---
export class CoverageGrid {
    constructor(cols, rows) { this.cols = cols; this.rows = rows; this.cells = new Uint8Array(cols * rows); this.count = 0; }
    /** Marca las celdas que toca un pincel circular de radio r (px) centrado en (x, y) dentro de w×h. */
    mark(x, y, r, w, h) {
        const cw = w / this.cols, ch = h / this.rows;
        const c0 = Math.max(0, Math.floor((x - r) / cw)), c1 = Math.min(this.cols - 1, Math.floor((x + r) / cw));
        const r0 = Math.max(0, Math.floor((y - r) / ch)), r1 = Math.min(this.rows - 1, Math.floor((y + r) / ch));
        let added = 0;
        for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
            // la celda cuenta si el pincel llega a su centro (no alcanza con rozar el borde)
            const cx = (col + 0.5) * cw, cy = (row + 0.5) * ch;
            if (Math.hypot(cx - x, cy - y) > r + Math.min(cw, ch) * 0.35) continue;
            const i = row * this.cols + col;
            if (!this.cells[i]) { this.cells[i] = 1; this.count++; added++; }
        }
        return added;
    }
    fraction() { return this.count / this.cells.length; }
    reset() { this.cells.fill(0); this.count = 0; }
}

// --- Nivel 1: nota según la altura (pentatónica de Do, dos octavas: suena bien en cualquier orden) ---
const PENTA = [0, 2, 4, 7, 9];
export function noteForY(y, h, base = 261.63) {
    const steps = PENTA.length * 2;
    const k = Math.max(0, Math.min(steps - 1, Math.floor((1 - y / Math.max(1, h)) * steps)));
    const semis = PENTA[k % PENTA.length] + 12 * Math.floor(k / PENTA.length);
    return base * Math.pow(2, semis / 12);
}

// --- Nivel 3: tamaño del globo que se adapta (sin error: si cuesta, crece) ---
export const BALLOON = { startFrac: 0.36, minFrac: 0.14, shrink: 0.88, grow: 1.15, helpAfterMs: 12000 };
export function nextBalloonSize(size, { popped, minDim }) {
    const max = BALLOON.startFrac * minDim, min = BALLOON.minFrac * minDim;
    const s = popped ? size * BALLOON.shrink : size * BALLOON.grow;
    return Math.max(min, Math.min(max, s));
}
/** Posición al azar para un globo de diámetro d dentro de w×h (con margen); rnd inyectable para tests. */
export function balloonPosition(d, w, h, rnd = Math.random, prev = null) {
    const m = 12;
    const fx = () => m + rnd() * Math.max(0, w - d - 2 * m), fy = () => m + rnd() * Math.max(0, h - d - 2 * m);
    let best = { x: fx(), y: fy() };
    if (prev) {
        // que no aparezca encima del anterior: se elige la más lejana de 4 posiciones
        let bestD = -1;
        for (let i = 0; i < 4; i++) {
            const p = i === 0 ? best : { x: fx(), y: fy() };
            const dd = Math.hypot(p.x - prev.x, p.y - prev.y);
            if (dd > bestD) { bestD = dd; best = p; }
        }
    }
    return best;
}

// --- Nivel 4: cuántas opciones (2 → 3 → 4 a medida que elige) ---
export const CHOICES = [
    { key: 'tambor', label: 'Tambor', color: '#e85d4a' },
    { key: 'campana', label: 'Campana', color: '#f2b632' },
    { key: 'melodia', label: 'Melodía', color: '#3fa7f5' },
    { key: 'silbido', label: 'Silbido', color: '#7bd389' }
];
export function optionCount(choicesMade) { return choicesMade >= 10 ? 4 : choicesMade >= 5 ? 3 : 2; }
export function pickOptions(n, rnd = Math.random) {
    const a = CHOICES.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, n);
}

// --- Nivel 5: recorrido suave (Lissajous) y velocidad ---
export const FOLLOW = { loopSeconds: 24, minLoopSeconds: 12, speedUp: 0.85, goalMs: 15000, radiusFrac: 0.085, nearFactor: 1.7 };
export function followPosition(t, w, h, loopSeconds = FOLLOW.loopSeconds) {
    const wv = (2 * Math.PI) / loopSeconds;
    const ax = w * 0.36, ay = h * 0.32;
    return { x: w / 2 + ax * Math.sin(wv * t), y: h / 2 + ay * Math.sin(wv * t * 1.5 + Math.PI / 4) };
}
export function nextLoopSeconds(s) { return Math.max(FOLLOW.minLoopSeconds, s * FOLLOW.speedUp); }

// --- Registro local de práctica (para la futura pestaña "Progreso") ---
export const LOG_MAX = 200;
export function appendLog(list, entry) {
    const out = Array.isArray(list) ? list.slice(-(LOG_MAX - 1)) : [];
    out.push(entry);
    return out;
}
export function summarize(entry) {
    if (!entry) return '';
    const min = Math.max(1, Math.round((entry.durationMs || 0) / 60000));
    switch (entry.level) {
        case 1: return `${min} min pintando`;
        case 2: return `${entry.done || 0} dibujo(s) descubierto(s)`;
        case 3: return `${entry.done || 0} globo(s)`;
        case 4: return `${entry.done || 0} elección(es)`;
        case 5: return `${Math.round((entry.onTargetFrac || 0) * 100)}% del tiempo siguiéndola`;
        default: return '';
    }
}
