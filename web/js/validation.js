// validation.js — Verificación independiente de la calibración (M04, 11/10/2026) · Módulo PURO (sin DOM)
//
// El error que se mostraba ("±N px") se calculaba con las MISMAS muestras del entrenamiento: mide ajuste,
// no si el cursor va a caer en la celda que la persona mira. Ahora, después de entrenar, se muestran 5
// objetivos NUEVOS (posiciones que no se usaron para ajustar y en otro orden). Con esas muestras —que nunca
// entran al entrenamiento ni al aprendizaje— se calcula:
//  - cobertura: cuadros válidos recibidos / cuadros esperados durante la fijación;
//  - error mediano y percentil 90 (distancia entre la predicción y el objetivo, en px CSS);
//  - dispersión durante la fijación (temblor del cursor) y su relación con el tamaño de una celda.
// Los umbrales (RULES) son PROVISORIOS y están versionados: se ajustan con mediciones reales en el iPad.
// Su función es detectar fallas evidentes, no certificar un porcentaje de acierto.

export const RULES = {
    version: 'v1-provisional-2026-10-11',
    layout: '3x3',            // celda de referencia: un tercio del viewport en cada eje
    minCoverage: 0.6,         // al menos 60% de los cuadros esperados con señal válida
    maxMedianFrac: 0.35,      // error mediano ≤ 35% del lado menor de la celda
    maxP90Frac: 0.6,          // percentil 90 ≤ 60% del lado menor de la celda
    maxDispersionFrac: 0.3    // temblor (desvío típico en la fijación) ≤ 30% del lado menor
};

// Posiciones de verificación (fracciones del viewport): distintas de la grilla 3×3 de la calibración
// (15%, 50%, 85%) y recorridas en otro orden.
const POINTS = [[0.68, 0.32], [0.30, 0.70], [0.50, 0.40], [0.72, 0.68], [0.32, 0.30]];

export function validationTargets(w, h) { return POINTS.map(([fx, fy]) => [fx * w, fy * h]); }

export function cellReference(w, h, layout = RULES.layout) {
    const [cols, rows] = layout.split('x').map(Number);
    return Math.min(w / cols, h / rows);
}

function quantile(sorted, q) {
    if (!sorted.length) return Infinity;
    const i = (sorted.length - 1) * q;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * @param {Array<{target:[number,number], preds:Array<[number,number]>, expectedFrames:number}>} points
 * @param {{w:number,h:number}} viewport
 */
export function computeMetrics(points, { w, h }, rules = RULES) {
    const errors = [];
    let valid = 0, expected = 0;
    const perPoint = points.map(p => {
        valid += p.preds.length;
        expected += Math.max(p.expectedFrames || 0, p.preds.length);
        const errs = p.preds.map(([x, y]) => Math.hypot(x - p.target[0], y - p.target[1]));
        errors.push(...errs);
        let disp = Infinity;
        if (p.preds.length >= 2) {
            const mx = p.preds.reduce((a, q) => a + q[0], 0) / p.preds.length;
            const my = p.preds.reduce((a, q) => a + q[1], 0) / p.preds.length;
            disp = Math.sqrt(p.preds.reduce((a, q) => a + (q[0] - mx) ** 2 + (q[1] - my) ** 2, 0) / p.preds.length);
        }
        const sortedErr = [...errs].sort((a, b) => a - b);
        return { target: p.target, frames: p.preds.length, medianError: quantile(sortedErr, 0.5), dispersion: disp };
    });
    const sorted = [...errors].sort((a, b) => a - b);
    const disps = perPoint.map(p => p.dispersion).filter(Number.isFinite).sort((a, b) => a - b);
    return {
        rules: rules.version,
        cellRef: cellReference(w, h, rules.layout),
        coverage: expected ? valid / expected : 0,
        validFrames: valid,
        expectedFrames: expected,
        medianError: quantile(sorted, 0.5),
        p90Error: quantile(sorted, 0.9),
        dispersion: disps.length ? quantile(disps, 0.5) : Infinity,
        perPoint
    };
}

/** Aceptar o rechazar con las reglas versionadas. → { status: 'accepted'|'failed', failures: string[] } */
export function judge(m, rules = RULES) {
    const f = [];
    if (!(m.coverage >= rules.minCoverage)) f.push('coverage');
    if (!(m.medianError <= rules.maxMedianFrac * m.cellRef)) f.push('median');
    if (!(m.p90Error <= rules.maxP90Frac * m.cellRef)) f.push('p90');
    if (!(m.dispersion <= rules.maxDispersionFrac * m.cellRef)) f.push('dispersion');
    return { status: f.length ? 'failed' : 'accepted', failures: f };
}

/** Explicación para la persona de apoyo (sin pedir mover la cabeza). */
export function failureAdvice(failures) {
    const tips = [];
    if (failures.includes('coverage')) tips.push('la cámara perdió la cara o los ojos muchas veces: revisá la luz (de frente, sin contraluz) y que la cara entre completa en la cámara');
    if (failures.includes('median') || failures.includes('p90')) tips.push('el cursor quedó lejos de los puntos: acomodá el iPad a la altura de los ojos, a unos 40-60 cm, y repetí la calibración');
    if (failures.includes('dispersion')) tips.push('el cursor tiembla mucho: mejorá la luz y evitá reflejos en anteojos');
    return tips;
}

// --- Benchmark (M04): métricas que no esconden errores ni omisiones ---

/**
 * Resumen honesto de una fase: el denominador incluye omisiones (timeouts) y errores, no solo los intentos
 * que terminaron en selección. Las metas 95% (3×3) y 85% (4×4) son internas del proyecto, no un estándar clínico.
 * @param {{grid:string, records:Array<{hit:boolean, timeout?:boolean, ms:number}>, restMs:number, restActivations:number, durationMs:number}} phase
 */
export function summarizePhase(phase) {
    const recs = phase.records;
    const targets = recs.length;
    const correct = recs.filter(r => r.hit).length;
    const timeouts = recs.filter(r => r.timeout).length;
    const wrong = targets - correct - timeouts;
    const times = recs.filter(r => r.hit).map(r => r.ms).sort((a, b) => a - b);
    const q = (p) => (times.length ? times[Math.min(times.length - 1, Math.floor((times.length - 1) * p))] : null);
    const restMin = (phase.restMs || 0) / 60000;
    return {
        grid: phase.grid, targets, correct, wrong, timeouts,
        accuracy: +(correct / Math.max(targets, 1) * 100).toFixed(1),
        medianTimeMs: q(0.5), p90TimeMs: q(0.9),
        meanTimeMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
        restActivations: phase.restActivations || 0,
        falseActivationsPerMin: restMin ? +((phase.restActivations || 0) / restMin).toFixed(2) : null,
        durationMs: phase.durationMs || 0
    };
}

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
