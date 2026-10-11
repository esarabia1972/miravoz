// Tests de perfiles con contexto (M02), verificación independiente (M04) y benchmark honesto (M04).
// Escenarios T08–T10 y T13–T15. Correr: node tools/test-profiles.mjs
const W = 1280, H = 800;
globalThis.window = { innerWidth: W, innerHeight: H, addEventListener() {} };
let fakeNow = 0;
globalThis.performance = { now: () => fakeNow };
const mem = new Map();
let failWrites = false;
globalThis.localforage = {
    async getItem(k) { return mem.has(k) ? structuredClone(mem.get(k)) : null; },
    async setItem(k, v) { if (failWrites) throw new Error('cuota agotada'); mem.set(k, structuredClone(v)); return v; }
};
const origErr = console.error; console.error = () => {};
const origLog = console.log; console.log = (...a) => { if (!String(a[0]).startsWith('Calibración: reintentando')) origLog(...a); };

const { CONFIG } = await import('../web/js/config.js');
const cal = await import('../web/js/calibration.js');
const P = await import('../web/js/profiles.js');
const V = await import('../web/js/validation.js');
const { PointerController } = await import('../web/js/selection.js');
const { summarizePhase } = V;

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; origLog('  ✓', n); } catch (e) { fail++; origLog('  ✗', n, '\n     ', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const good = (x, y) => [0.3 + 0.4 * x / W + 0.001 * gauss(), 0.3 + 0.4 * y / H + 0.001 * gauss()];

let ctx = { scope: 'user:ana', deviceId: 'dev-1', engine: 'tasks', w: W, h: H, camera: { frameRate: 30 } };
cal.setContextProvider(() => P.makeContext(ctx));

function runSession(featFn, opts) {
    let result, done = false;
    const s = new cal.CalibrationSession('CARA', p => { result = p; done = true; }, opts);
    let now = 1000;
    s.begin(now);
    while (!done && now < 300000) {
        now += 33;
        const info = s.renderInfo(now);
        const f = info ? featFn(info, now) : null;
        s.onFrame(f, now, f ? { capturedAt: now, features: f } : null);
    }
    return { result, done };
}

origLog('perfiles (M02)');
await t('calibración aceptada: guarda contexto completo y verificación con métricas', async () => {
    const r = runSession(info => good(info.x, info.y));
    assert(r.result && r.result.validation.status === 'accepted', JSON.stringify(r.result && r.result.validation));
    const p = r.result;
    assert(p.schema === 3 && p.revision && p.modelKind === 'poly-headangles-v1', 'esquema/revisión/modelo');
    assert(p.context.scope === 'user:ana' && p.context.deviceId === 'dev-1' && p.context.orientation === 'landscape' && p.context.viewport.w === W, 'contexto');
    assert(Number.isFinite(p.trainingError) && Number.isFinite(p.validation.metrics.medianError) && p.validation.metrics.coverage > 0.6, 'métricas');
    await new Promise(r => setTimeout(r, 0));
    assert(cal.checkProfile('CARA').ok, 'no compatible en el mismo contexto: ' + cal.checkProfile('CARA').reason);
});
await t('Rostro: verificación a lazo cerrado (cursor visible) corrige el desplazamiento de la cabeza', async () => {
    // Persona cuya cabeza "se hunde" en la verificación (+0.06 en y, ~un tercio de pantalla).
    const drift = 0.06;
    const open = runSession(info => { const g = good(info.x, info.y); return info.stage === 'VALIDATE' ? [g[0], g[1] + drift] : g; });
    assert(open.result && open.result.validation.status === 'failed', 'sin corregir debería fallar');
    // Misma deriva, pero la persona mira el cursor y lo lleva al punto (controlador proporcional)
    let corr = [0, 0], sawCursor = false;
    const closed = runSession(info => {
        const g = good(info.x, info.y);
        if (info.stage !== 'VALIDATE') return g;
        if (info.cursor) {
            sawCursor = true;
            corr = [corr[0] - 0.15 * (info.cursor[0] - info.x) * 0.4 / W, corr[1] - 0.15 * (info.cursor[1] - info.y) * 0.4 / H];
        }
        return [g[0] + corr[0], g[1] + drift + corr[1]];
    });
    assert(sawCursor, 'en Rostro la verificación tiene que mostrar el cursor');
    assert(closed.result && closed.result.validation.status === 'accepted', JSON.stringify(closed.result && closed.result.validation.metrics && { m: closed.result.validation.metrics.medianError, p90: closed.result.validation.metrics.p90Error }));
});
await t('T08 cambio de usuario: el perfil de otra persona nunca se usa', () => {
    ctx = { ...ctx, scope: 'user:beto' };
    const c = cal.checkProfile('CARA');
    assert(!c.ok && c.reason === 'no-profile', c.reason);
    // y aunque se lo pasara explícito, el ámbito no coincide
    ctx = { ...ctx, scope: 'user:ana' };
    const ana = cal.getProfile('CARA');
    assert(P.checkCompatibility(ana, P.makeContext({ ...ctx, scope: 'user:beto' }), { mode: 'CARA' }).reason === 'scope', 'scope');
});
await t('T08 rotación, otro dispositivo y otro motor invalidan', () => {
    const ana = cal.getProfile('CARA');
    assert(P.checkCompatibility(ana, P.makeContext({ ...ctx, w: H, h: W }), { mode: 'CARA' }).reason === 'orientation', 'orientación');
    assert(P.checkCompatibility(ana, P.makeContext({ ...ctx, deviceId: 'dev-2' }), { mode: 'CARA' }).reason === 'device', 'dispositivo');
    const ojos = { ...ana, context: { ...ana.context, engine: 'tasks' } };
    assert(P.checkCompatibility(ojos, P.makeContext({ ...ctx, engine: 'legacy' }), { mode: 'OJOS' }).reason === 'engine', 'motor en Iris');
    assert(P.checkCompatibility(ojos, P.makeContext({ ...ctx, engine: 'legacy' }), { mode: 'CARA' }).reason === 'engine', 'Rostro (ángulos) también depende del motor');
});
await t('T09 barras de Safari (alto ±8%) no invalidan; un cambio grande sí', () => {
    const ana = cal.getProfile('CARA');
    assert(P.checkCompatibility(ana, P.makeContext({ ...ctx, h: H * 0.92 }), { mode: 'CARA' }).ok, 'barra de Safari invalidó');
    assert(P.checkCompatibility(ana, P.makeContext({ ...ctx, h: H * 1.06 }), { mode: 'CARA' }).ok, 'barra (+) invalidó');
    assert(P.checkCompatibility(ana, P.makeContext({ ...ctx, w: W * 0.7 }), { mode: 'CARA' }).reason === 'geometry', 'cambio grande de ancho');
    assert(P.checkCompatibility(ana, P.makeContext({ ...ctx, h: H * 0.6 }), { mode: 'CARA' }).reason === 'geometry', 'cambio grande de alto');
});
await t('T10 perfil viejo v2 (sin contexto): se conserva para recuperación pero no se aplica', async () => {
    mem.clear();
    mem.set('miravoz_calibration_v2', { CARA: { weightsX: [1, 2, 3, 4, 5, 6], weightsY: [1, 2, 3, 4, 5, 6], meanError: 9 }, OJOS: null });
    cal._setStorage(globalThis.localforage);
    await cal.loadProfiles();
    assert(cal.checkProfile('CARA').reason === 'no-profile', 'aplicó el viejo');
    const store = new P.ProfileStore(globalThis.localforage);
    await store.load();
    assert(store.data.legacy && store.data.legacy.CARA && store.data.legacy.CARA.weightsX, 'no conservó el viejo');
    assert(P.checkCompatibility({ weightsX: [1], weightsY: [1] }, P.makeContext(ctx), { mode: 'CARA' }).reason === 'legacy', 'legacy');
    assert(mem.has('miravoz_calibration_v2'), 'borró el v2');
});
await t('T10 escritura fallida: no destruye lo persistido y avisa', async () => {
    mem.clear();
    cal._setStorage(globalThis.localforage);
    await cal.loadProfiles();
    const r1 = runSession(info => good(info.x, info.y));
    await new Promise(r => setTimeout(r, 0));
    const persisted = structuredClone(mem.get('miravoz_calibration_v3'));
    failWrites = true;
    const r2 = runSession(info => good(info.x, info.y));
    await new Promise(r => setTimeout(r, 0));
    failWrites = false;
    assert(r2.result.validation.status === 'accepted', 'la segunda no se aceptó');
    assert(JSON.stringify(mem.get('miravoz_calibration_v3')) === JSON.stringify(persisted), 'pisó lo persistido');
    assert(cal.isUnsaved(), 'no avisó');
    assert(cal.getProfile('CARA').revision === r2.result.revision, 'no quedó en memoria');
    assert(r1.result.revision !== r2.result.revision, 'revisiones iguales');
});
await t('desvincular: borra solo los perfiles de ese usuario', async () => {
    await cal.saveProfile('CARA', cal.getProfile('CARA'));
    ctx = { ...ctx, scope: 'user:beto' };
    const r = runSession(info => good(info.x, info.y));
    await new Promise(res => setTimeout(res, 0));
    assert(r.result.validation.status === 'accepted', 'beto');
    await cal.clearScope('user:ana');
    const st = mem.get('miravoz_calibration_v3');
    assert(!st.scopes['user:ana'] && st.scopes['user:beto'], JSON.stringify(Object.keys(st.scopes)));
    ctx = { ...ctx, scope: 'user:ana' };
});

origLog('verificación (M04)');
await t('T13 el modelo ajusta el entrenamiento pero falla los objetivos reservados → rechazada y no se guarda', async () => {
    mem.clear();
    cal._setStorage(globalThis.localforage);
    await cal.loadProfiles();
    // En la verificación, la "mirada" cae en otro lado (como si el modelo solo hubiera memorizado los 9 puntos)
    const r = runSession(info => info.stage === 'VALIDATE' ? good(W - info.x, H - info.y) : good(info.x, info.y));
    await new Promise(res => setTimeout(res, 0));
    assert(r.result && r.result.validation.status === 'failed', JSON.stringify(r.result && r.result.validation.failures));
    assert(r.result.trainingError < 30, 'el ajuste debería ser bueno: ' + r.result.trainingError);
    assert(!cal.getProfile('CARA'), 'guardó una calibración rechazada');
    assert(V.failureAdvice(r.result.validation.failures).length > 0, 'sin consejos');
    assert(!V.failureAdvice(['median']).join(' ').match(/Rostro/), 'no sugiere "usá Rostro"');
});
await t('T13 las muestras de verificación no entran al entrenamiento', () => {
    const r = runSession(info => good(info.x, info.y));
    const n = r.result.validation.metrics.validFrames;
    assert(n > 0, 'sin cuadros de verificación');
    // CARA no guarda muestras; el modelo es el mismo que se entrenó antes de verificar (no se re-entrena)
    assert(r.result.weightsX && !r.result.samples, 'estructura');
});
await t('T14 cuadros duplicados (la misma muestra en muchos refrescos) no alcanzan el mínimo → aborta', () => {
    const pc = new PointerController({ dwell: { tick() {}, invalidate() {} }, filterX: { filter: x => x, reset() {} }, filterY: { filter: x => x, reset() {} }, maxAgeMs: () => 250 });
    let result = 'pendiente';
    const s = new cal.CalibrationSession('CARA', p => { result = p; });
    let now = 1000; s.begin(now);
    let frozen = null;
    while (result === 'pendiente' && now < 120000) {
        now += 8; // pantalla a 120 Hz
        const info = s.renderInfo(now);
        // la cámara manda UNA muestra por punto y después se congela
        if (info && (!frozen || frozen.target !== info.index)) frozen = { sessionId: 1, sequence: Math.floor(now), capturedAt: now, features: good(info.x, info.y), target: info.index };
        fakeNow = now;
        const fresh = frozen ? pc.takeNewSample({ ...frozen, capturedAt: Math.min(frozen.capturedAt, now) }, now) : null;
        s.onFrame(fresh ? fresh.features : null, now, fresh);
    }
    assert(result === null, 'aprobó con muestras repetidas');
});
await t('T14 cuadros tardíos (capturados antes de la fijación del punto) no cuentan', () => {
    let result = 'pendiente';
    const s = new cal.CalibrationSession('CARA', p => { result = p; });
    let now = 1000; s.begin(now);
    while (result === 'pendiente' && now < 120000) {
        now += 33;
        const info = s.renderInfo(now);
        const f = info ? good(info.x, info.y) : null;
        s.onFrame(f, now, f ? { capturedAt: now - 2000, features: f } : null); // siempre 2 s de atraso
    }
    assert(result === null, 'aprobó con cuadros atrasados');
});
await t('reglas: cobertura baja, error y temblor se detectan; umbrales versionados', () => {
    const tg = [[100, 100]];
    const m = V.computeMetrics([{ target: tg[0], preds: [[100, 100], [102, 99]], expectedFrames: 30 }], { w: W, h: H });
    assert(V.judge(m).failures.includes('coverage'), 'cobertura');
    const far = V.computeMetrics([{ target: [100, 100], preds: Array(30).fill([400, 400]), expectedFrames: 30 }], { w: W, h: H });
    assert(V.judge(far).failures.includes('median') && V.judge(far).failures.includes('p90'), 'error');
    const shaky = V.computeMetrics([{ target: [100, 100], preds: Array.from({ length: 30 }, (_, i) => [100 + (i % 2 ? 150 : -150), 100]), expectedFrames: 30 }], { w: W, h: H });
    assert(V.judge(shaky).failures.includes('dispersion'), 'temblor');
    assert(/provisional/.test(V.RULES.version), 'versión');
    const targets = V.validationTargets(W, H);
    assert(targets.length === 5 && targets.every(([x, y]) => ![0.15, 0.5, 0.85].some(f => Math.abs(x - f * W) < 1) || ![0.15, 0.5, 0.85].some(f => Math.abs(y - f * H) < 1)), 'reusa posiciones de la calibración');
});

origLog('benchmark (M04)');
await t('T15 los denominadores incluyen errores y omisiones; descanso cuenta activaciones involuntarias', () => {
    assert(typeof summarizePhase === 'function', 'summarizePhase no exportada');
    const s = summarizePhase({ grid: '3x3', restMs: 10000, restActivations: 2, durationMs: 90000, records: [
        { hit: true, ms: 2000 }, { hit: true, ms: 3000 }, { hit: false, ms: 2500 }, { hit: false, timeout: true, ms: 15000 }, { hit: true, ms: 4000 }
    ] });
    assert(s.targets === 5 && s.correct === 3 && s.wrong === 1 && s.timeouts === 1, JSON.stringify(s));
    assert(s.accuracy === 60, `accuracy ${s.accuracy}`);
    assert(s.medianTimeMs === 3000 && s.falseActivationsPerMin === 12, JSON.stringify(s));
    assert(summarizePhase({ grid: '4x4', records: [{ hit: false, timeout: true, ms: 15000 }] }).accuracy === 0, 'solo omisiones');
});

console.error = origErr;
origLog(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
