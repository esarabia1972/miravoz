// Tests de validez temporal de la mirada (M01) y aprendizaje implícito apagado (M07). Correr: node tools/test-selection.mjs
// Usa el DwellEngine, el filtro 1 Euro y el PointerController REALES con reloj controlado. Escenarios T01–T07 y T16
// de la especificación: se verifica la acción final (selecciones), no solo que se llamó a algo.

let fakeNow = 10000;
globalThis.performance = { now: () => fakeNow };
globalThis.window = { addEventListener() {}, innerWidth: 1000, innerHeight: 800 };
globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };

const { CONFIG } = await import('../web/js/config.js');
const { DwellEngine } = await import('../web/js/dwell.js');
const { OneEuroFilter } = await import('../web/js/filters.js');
const { PointerController, buildSample, invalidSample } = await import('../web/js/selection.js');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

// Dos celdas: A (0..400) y B (500..900), alto 0..800
const el = (left, right) => ({
    getBoundingClientRect: () => ({ left, right, top: 0, bottom: 800, width: right - left, height: 800 }),
    classList: { add() {}, remove() {} }, querySelector: () => null
});
const A = { element: el(0, 400), data: { id: 'A' } };
const B = { element: el(500, 900), data: { id: 'B' } };

function setup() {
    fakeNow = 10000;
    const selected = [];
    const dwell = new DwellEngine(tg => selected.push(tg.data.id));
    dwell.setTargets([A, B]);
    const fx = new OneEuroFilter({ minCutoff: 1, beta: 0.02 }), fy = new OneEuroFilter({ minCutoff: 1, beta: 0.02 });
    const invalidations = [];
    const pc = new PointerController({ dwell, filterX: fx, filterY: fy, maxAgeMs: () => CONFIG.MAX_SAMPLE_AGE_MS, onInvalidate: r => invalidations.push(r) });
    let seq = 0;
    const session = { id: 1 };
    const sample = (o = {}) => ({ sessionId: session.id, sequence: ++seq, capturedAt: fakeNow, receivedAt: fakeNow, mode: 'CARA',
        valid: true, reason: null, x: 200, y: 400, features: [0.5, 0.5], ...o });
    // Avanza el reloj: cámara a 30 cps, pantalla a 60 Hz. gen(ms) da la muestra de cada cuadro de cámara.
    const run = (ms, gen) => {
        let last = null;
        for (let elapsed = 0; elapsed < ms; elapsed += 1000 / 60) {
            fakeNow += 1000 / 60;
            if (Math.floor(fakeNow / (1000 / 30)) !== Math.floor((fakeNow - 1000 / 60) / (1000 / 30))) last = gen ? gen() : last;
            pc.step(last, fakeNow);
        }
        return last;
    };
    return { pc, dwell, selected, sample, run, session, invalidations };
}

console.log('selection (M01)');
t('control: mirar A el tiempo de dwell selecciona A una vez', () => {
    const { selected, sample, run } = setup();
    run(CONFIG.DWELL_MS + CONFIG.HYSTERESIS_MS + 200, () => sample());
    assert(selected.length === 1 && selected[0] === 'A', JSON.stringify(selected));
});
t('T01 Rostro: se pierde la cara cerca de completar el dwell → ninguna selección; la permanencia se reinicia', () => {
    const { selected, sample, run } = setup();
    run(CONFIG.DWELL_MS - 100, () => sample());
    run(300, () => sample({ valid: false, reason: 'no-face', x: null, y: null }));
    assert(selected.length === 0, 'seleccionó sin cara');
    run(CONFIG.DWELL_MS - 200, () => sample());
    assert(selected.length === 0, 'el tiempo anterior se sumó');
    run(500, () => sample());
    assert(selected.length === 1, 'no completó una permanencia nueva');
});
t('T02 ojos cerrados (muestra inválida) con el cursor sobre una celda → no usa las coordenadas anteriores', () => {
    const { selected, sample, run } = setup();
    run(CONFIG.DWELL_MS - 150, () => sample({ mode: 'CARA' }));
    run(1500, () => sample({ mode: 'CARA', valid: false, reason: 'blink', x: null, y: null, features: null }));
    assert(selected.length === 0, JSON.stringify(selected));
});
t('T02 buildSample: parpadeo, sin rostro, pose, sin calibrar, error y fuera de pantalla son inválidos', () => {
    const base = { sessionId: 1, sequence: 1, capturedAt: 0, mode: 'CARA', face: true, features: [1, 2], active: true, predict: () => [100, 100], viewport: { w: 1000, h: 800 } };
    assert(buildSample(base).valid && buildSample(base).x === 100, 'válida');
    assert(buildSample({ ...base, blink: true }).reason === 'blink' && buildSample({ ...base, blink: true }).features === null, 'blink');
    assert(buildSample({ ...base, face: false }).reason === 'no-face', 'no-face');
    assert(buildSample({ ...base, features: null }).reason === 'no-features', 'no-features');
    assert(buildSample({ ...base, headOutOfPose: true }).reason === 'pose', 'pose');
    assert(buildSample({ ...base, predict: null }).reason === 'uncalibrated', 'uncalibrated');
    assert(buildSample({ ...base, active: false }).reason === 'inactive', 'inactive');
    assert(buildSample({ ...base, error: true }).reason === 'engine-error', 'error');
    assert(buildSample({ ...base, predict: () => [-300, 100] }).reason === 'offscreen', 'offscreen');
    const edge = buildSample({ ...base, predict: () => [1040, -20] });
    assert(edge.valid && edge.x === 1000 && edge.y === 0, 'cerca del borde se recorta');
    assert(buildSample({ ...base, predict: () => [NaN, 1] }).valid === false, 'NaN');
});
t('T02 un parpadeo corto (100 ms) también reinicia: nunca acumula durante la invalidez', () => {
    const { selected, sample, run } = setup();
    run(CONFIG.DWELL_MS - 150, () => sample({ mode: 'CARA' }));
    run(100, () => sample({ mode: 'CARA', valid: false, reason: 'blink', x: null, y: null }));
    run(400, () => sample({ mode: 'CARA' }));
    assert(selected.length === 0, 'sumó el tiempo de antes del parpadeo');
});
t('T03 la cara desaparece 5 s y vuelve a la misma celda → hace falta una permanencia nueva', () => {
    const { selected, sample, run } = setup();
    run(CONFIG.DWELL_MS - 100, () => sample());
    run(5000, () => sample({ valid: false, reason: 'no-face', x: null, y: null }));
    run(300, () => sample());
    assert(selected.length === 0, 'seleccionó al volver');
    run(CONFIG.DWELL_MS + 300, () => sample());
    assert(selected.length === 1, 'no seleccionó con la permanencia nueva');
});
t('T04 cámara congelada (misma muestra) → pausa por frescura y cero selecciones', () => {
    const { selected, sample, run, pc } = setup();
    run(400, () => sample());
    const frozen = sample();
    for (let i = 0; i < 300; i++) { fakeNow += 1000 / 60; pc.step(frozen, fakeNow); }
    assert(selected.length === 0, JSON.stringify(selected));
    assert(pc.invalid && pc.reason === 'stale', `estado ${pc.reason}`);
});
t('T04 sin muestras (cámara que no responde) → inválido', () => {
    const { pc } = setup();
    const r = pc.step(null, fakeNow);
    assert(r.action === 'invalid', r.action);
});
t('T05 una muestra repetida en muchos refrescos no avanza el dwell ni crea muestras de calibración', () => {
    const { pc, selected, sample } = setup();
    const s = sample();
    let ticks = 0;
    for (let i = 0; i < 10; i++) { fakeNow += 10; if (pc.step(s, fakeNow).action === 'tick') ticks++; }
    assert(ticks === 1, `ticks ${ticks}`);
    assert(selected.length === 0, 'seleccionó');
    const { pc: pc2, sample: sample2 } = setup();
    const c = sample2();
    let feats = 0;
    for (let i = 0; i < 10; i++) { fakeNow += 5; if (pc2.takeNewFeatures(c, fakeNow)) feats++; }
    assert(feats === 1, `features ${feats}`);
    fakeNow += 1000;
    assert(pc2.takeNewFeatures(sample2({ capturedAt: fakeNow - 600 }), fakeNow) === null, 'aceptó una muestra vieja');
});
t('T05 muestras con hueco mayor al límite no suman como permanencia', () => {
    const { pc, selected, sample } = setup();
    // muestras válidas pero cada 400 ms (más que MAX_SAMPLE_AGE_MS): cada una reinicia
    for (let i = 0; i < 20; i++) { fakeNow += 400; pc.step(sample(), fakeNow); }
    assert(selected.length === 0, JSON.stringify(selected));
});
t('T06 pestaña oculta y vuelta: no ejecuta tiempo acumulado ni selección inmediata', () => {
    const { pc, selected, sample, run } = setup();
    run(CONFIG.DWELL_MS - 100, () => sample());
    const before = sample();
    pc.invalidate('hidden', fakeNow);
    fakeNow += 60000; // suspensión
    pc.invalidate('resumed', fakeNow);
    pc.step({ ...before, sequence: before.sequence + 1 }, fakeNow); // resultado capturado antes de ocultar
    assert(selected.length === 0, 'seleccionó con una muestra de antes');
    run(200, () => sample());
    assert(selected.length === 0, 'seleccionó en el primer instante');
    run(CONFIG.DWELL_MS + 300, () => sample());
    assert(selected.length === 1, 'no seleccionó después');
});
t('T07 resultado tardío de la sesión anterior y error de motor: descartados, sin acciones pendientes', () => {
    const { pc, selected, sample, run, session } = setup();
    run(CONFIG.DWELL_MS - 100, () => sample());
    session.id = 2; // motor reiniciado (p. ej. GPU → CPU)
    run(100, () => sample());
    const late = { ...sample(), sessionId: 1, sequence: 99999 };
    for (let i = 0; i < 60; i++) { fakeNow += 16; pc.step({ ...late, capturedAt: fakeNow }, fakeNow); }
    assert(selected.length === 0, 'la sesión vieja reactivó el control');
    run(300, () => sample({ valid: false, reason: 'engine-error', x: null, y: null }));
    assert(selected.length === 0 && pc.reason === 'engine-error', pc.reason);
    run(CONFIG.DWELL_MS + 300, () => sample());
    assert(selected.length === 1, 'no se recuperó');
});
t('repetición: mantener la mirada repite la celda solo con señal viva y tras cooldown + permanencia', () => {
    const { selected, sample, run } = setup();
    run(2 * CONFIG.DWELL_MS + CONFIG.DWELL_COOLDOWN_MS + 500, () => sample());
    assert(selected.length === 2, `selecciones ${selected.length}`);
});
t('invalidaciones avisan (para cancelar el aprendizaje pendiente)', () => {
    const { run, sample, invalidations } = setup();
    run(200, () => sample());
    run(200, () => sample({ valid: false, reason: 'no-face', x: null, y: null }));
    assert(invalidations.includes('no-face'), JSON.stringify(invalidations));
});
t('invalidSample', () => {
    const s = invalidSample('stopped', { sessionId: 3, sequence: 4, now: 5 });
    assert(!s.valid && s.reason === 'stopped' && s.x === null && s.sessionId === 3, JSON.stringify(s));
});

console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
