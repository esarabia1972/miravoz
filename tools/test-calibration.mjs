// Tests de la sesión de calibración REAL (web/js/calibration.js) en Node, con stubs mínimos de globals.
// Cubre modo CARA (regresión), modo OJOS v3 (9 puntos, cabeza quieta), abort sin rostro, aprendizaje implícito
// y persistencia. Correr: node tools/test-calibration.mjs

// --- Stubs de globals (antes de importar: calibration.js usa window al cargar) ---
const W = 1280, H = 800;
globalThis.window = { innerWidth: W, innerHeight: H, addEventListener() {} };
const store = new Map();
globalThis.localforage = {
    async getItem(k) { return store.has(k) ? structuredClone(store.get(k)) : null; },
    async setItem(k, v) { store.set(k, structuredClone(v)); return v; } // clona como IndexedDB
};
const origErr = console.error, origLog = console.log;
let quiet = false;
console.error = (...a) => { if (!quiet) origErr(...a); };

const { CONFIG } = await import('../web/js/config.js');
const cal = await import('../web/js/calibration.js');
const { CalibrationSession, isUsableProfile, addImplicitSamples, loadProfiles } = cal;
const { rawFeatures } = await import('../web/js/gaze-model.js');

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; origLog('  ✓', n); } catch (e) { fail++; origLog('  ✗', n, '\n     ', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

// Simulador geométrico (misma idea que observe() de tools/test-gaze.mjs)
const D = 55, PX = 38;
function observe(tx, ty, head, noise = 1) {
    const { hx, hy, yaw, pitch } = head;
    const gx = Math.atan2((tx - W / 2) / PX - hx, D) * 180 / Math.PI;
    const gy = Math.atan2((ty - H / 2) / PX - hy, D) * 180 / Math.PI;
    const eyeX = gx - yaw, eyeY = gy - pitch;
    const iris = { x: eyeX / 35 + 0.03 * gauss() * noise, y: eyeY / 25 + 0.06 * gauss() * noise };
    const pose = { yaw: yaw + 0.8 * gauss() * noise, pitch: pitch + 0.8 * gauss() * noise, roll: 0 };
    const lm = []; lm[1] = { x: 0.5 + hx / 40 + yaw / 300, y: 0.5 + hy / 40 + pitch / 300 };
    const eyes = {
        eyeLookOutLeft: Math.max(0, eyeX / 35), eyeLookInRight: Math.max(0, eyeX / 35),
        eyeLookInLeft: Math.max(0, -eyeX / 35), eyeLookOutRight: Math.max(0, -eyeX / 35),
        eyeLookDownLeft: Math.max(0, eyeY / 25), eyeLookDownRight: Math.max(0, eyeY / 25),
        eyeLookUpLeft: Math.max(0, -eyeY / 25), eyeLookUpRight: Math.max(0, -eyeY / 25)
    };
    for (const k in eyes) eyes[k] = Math.min(1, Math.max(0, eyes[k] + 0.04 * gauss() * noise));
    return rawFeatures({ landmarks: lm, iris, pose, eyes });
}

/** Corre una sesión con el reloj simulado (33 ms/frame). featFn(info, t) → features o null. */
function runSession(mode, featFn, maxMs = 300000) {
    let result, done = false;
    const s = new CalibrationSession(mode, p => { result = p; done = true; });
    const log = []; // por frame: info de renderInfo
    let now = 0;
    s.begin(now);
    while (!done && now < maxMs) {
        now += 33;
        const info = s.renderInfo(now);
        if (info) log.push({ ...info, t: now });
        s.onFrame(info ? featFn(info, now) : null, now);
    }
    return { s, result, done, now, log };
}

// Duración de SAMPLING por índice de punto (primer bloque continuo)
function samplingDurations(log) {
    const d = {};
    let prev = null, start = 0;
    for (const e of log) {
        const key = e.sampling ? e.index : null;
        if (key !== prev) { if (prev !== null && d[prev] === undefined) d[prev] = e.t - start; start = e.t; prev = key; }
    }
    return d;
}

origLog('calibration (sesión real, reloj simulado)');
const diag = Math.hypot(W, H);

// 1. CARA — regresión
const caraFeat = info => [0.3 + 0.4 * info.x / W + 0.002 * gauss(), 0.3 + 0.4 * info.y / H + 0.002 * gauss()];
const cara = runSession('CARA', caraFeat);
await t('CARA: termina con perfil {weightsX, weightsY, meanError, quality} sin kind', () => {
    const p = cara.result;
    assert(cara.done && p, 'no terminó / perfil null');
    assert(Array.isArray(p.weightsX) && p.weightsX.length === 6 && Array.isArray(p.weightsY), 'pesos');
    assert(p.kind === undefined && p.model === undefined && p.samples === undefined, `trae campos de OJOS: ${Object.keys(p)}`);
    assert(Number.isFinite(p.meanError) && typeof p.quality === 'string', 'meanError/quality');
});
await t('CARA: 9 puntos, error medio bajo (<2% diagonal), calidad buena', () => {
    assert(cara.s.points.length === 9, `${cara.s.points.length} puntos`);
    const capture = cara.log.filter(e => e.stage === 'CAPTURE');
    assert(new Set(capture.map(e => e.index)).size === 9, 'no recorrió los 9');
    assert(capture.every(e => e.label.endsWith('/9') && e.hint === null), 'label/hint inesperado en CARA');
    assert(cara.result.meanError < diag * 0.02, `meanError ${cara.result.meanError.toFixed(1)} px`);
    assert(cara.result.quality === 'buena', cara.result.quality);
    origLog(`    (CARA) error medio ${cara.result.meanError.toFixed(1)} px en ${(cara.now / 1000).toFixed(1)} s simulados`);
});
await t('CARA: isUsableProfile(CARA) true; isUsableProfile(OJOS) false', () => {
    assert(isUsableProfile('CARA', cara.result), 'CARA');
    assert(!isUsableProfile('OJOS', cara.result), 'OJOS con perfil CARA');
});

// 2. OJOS híbrido
// Cabeza: quieta en los 9; en los de mover la cabeza, oscila suave (seno) en yaw/pitch/posición.
const still = () => ({ hx: gauss() * 0.5, hy: gauss() * 0.5, yaw: gauss() * 1.5, pitch: gauss() * 1.5 });
const moving = now => ({ hx: 3 * Math.sin(now / 700), hy: 2 * Math.cos(now / 900), yaw: 10 * Math.sin(now / 500), pitch: 7 * Math.cos(now / 600) });
const isHeadHint = h => typeof h === 'string' && /mov[eé] la cabeza/i.test(h) && !/sin mover/i.test(h);
const ojosFeat = (info, now) => observe(info.x, info.y, isHeadHint(info.hint) ? moving(now) : still());
const ojos = runSession('OJOS', ojosFeat);
await t('OJOS (v3, cabeza quieta): 9 puntos, todos con la indicación de cabeza quieta', () => {
    assert(ojos.s.points.length === 9, `${ojos.s.points.length}`);
    const byIdx = {};
    for (const e of ojos.log) if (e.stage === 'CAPTURE') byIdx[e.index] = e;
    assert(Object.keys(byIdx).length === 9, `recorrió ${Object.keys(byIdx).length}`);
    assert(Object.values(byIdx).every(e => e.label.endsWith('/9')), 'label');
    assert(Object.values(byIdx).every(e => e.hint && /cabeza quieta/i.test(e.hint) && !isHeadHint(e.hint)), 'hint');
});
await t('OJOS: perfil kind gaze-v3 con model (y poseRef), samples (9 con raw), implicit []', () => {
    const p = ojos.result;
    assert(ojos.done && p, 'perfil null');
    assert(p.kind === 'gaze-v3' && p.model && p.model.wx && p.model.mean && p.model.poseRef, 'kind/model');
    assert(p.samples.length === 9, `samples ${p.samples.length}`);
    assert(p.samples.every(s => s.samples.length >= CONFIG.MIN_SAMPLES_PER_POINT && s.samples.every(x => x.raw.length === 8 && Object.keys(x).length === 1)), 'raw');
    assert(Array.isArray(p.implicit) && p.implicit.length === 0, 'implicit');
    assert(Number.isFinite(p.meanError) && p.quality, 'meanError/quality');
    origLog(`    (OJOS) error medio ${p.meanError.toFixed(1)} px (${p.quality}) en ${(ojos.now / 1000).toFixed(1)} s simulados`);
    if (process.env.DBG) origLog(JSON.stringify({ ...p.validation.metrics, perPoint: undefined }), p.validation.failures);
});
await t('OJOS: isUsableProfile true; perfil viejo solo-iris {weightsX, weightsY} false', () => {
    assert(isUsableProfile('OJOS', ojos.result), 'híbrido');
    assert(!isUsableProfile('OJOS', { weightsX: [1, 2, 3, 4, 5, 6], weightsY: [1, 2, 3, 4, 5, 6], meanError: 10 }), 'viejo aceptado');
    assert(!isUsableProfile('OJOS', null) && !isUsableProfile('CARA', null), 'null');
});

// 5. Persistencia (antes de tocar el perfil con el implícito)
await t('persistencia: miravoz_calibration_v3 (ámbito "prueba") con ambos perfiles y loadProfiles() los recupera', async () => {
    await new Promise(r => setTimeout(r, 0));
    const st = store.get('miravoz_calibration_v3');
    const sc = st && st.scopes && st.scopes.prueba;
    assert(sc && sc.CARA && sc.OJOS, `guardado: ${st && JSON.stringify(Object.keys(st))}`);
    assert(sc.OJOS.kind === 'gaze-v3' && sc.CARA.weightsX && sc.CARA.schema === 3 && sc.CARA.context, 'contenido');
    cal._setStorage(globalThis.localforage);
    await loadProfiles();
    assert(isUsableProfile('OJOS', cal.getProfile('OJOS')) && isUsableProfile('CARA', cal.getProfile('CARA')), 'no recuperó');
    assert(JSON.stringify(cal.getProfile('OJOS').model) === JSON.stringify(ojos.result.model), 'modelo distinto');
});

// 3. Sin rostro
await t('sin rostro: 3 puntos seguidos con features null → onComplete(null), sin loop', () => {
    quiet = true;
    const r = runSession('CARA', () => null, 60000);
    const r2 = runSession('OJOS', () => null, 60000);
    quiet = false;
    assert(r.done && r.result === null, `CARA done=${r.done} result=${r.result}`);
    assert(r2.done && r2.result === null, `OJOS done=${r2.done}`);
    const pts = new Set(r.log.map(e => e.index));
    assert(pts.size === 1 && r.s.phase === 'DONE', `puntos mostrados ${[...pts]}`);
    const expected = 3 * (CONFIG.COUNTDOWN_MS + CONFIG.SAMPLING_MS + CONFIG.SAMPLE_WARMUP_MS);
    assert(r.now < expected + 500, `tardó ${r.now} ms`);
});
await t('sin rostro intermitente (cara aparece y desaparece) no aborta si un punto sale bien', () => {
    quiet = true;
    const r = runSession('CARA', (info, now) => (Math.floor(now / 2700) % 3 === 2 ? null : caraFeat(info)), 120000);
    quiet = false;
    assert(r.done && r.result, 'abortó o no terminó');
});

// 4. Aprendizaje implícito
const implicitBatch = () => {
    const tx = (0.15 + 0.7 * rnd()) * W, ty = (0.15 + 0.7 * rnd()) * H, h = still(); // cabeza quieta (como pide el modo Iris v3)
    return Array.from({ length: CONFIG.IMPLICIT_SAMPLES_PER_SELECT }, () => ({ target: [tx, ty], raw: observe(tx, ty, h) }));
};
await t('implícito: 4 llamadas → null; la 5ª re-entrena (model nuevo) y acumula implicit', async () => {
    const before = JSON.stringify(cal.getProfile('OJOS').model);
    for (let i = 0; i < CONFIG.IMPLICIT_RETRAIN_EVERY - 1; i++) {
        const r = await addImplicitSamples('OJOS', implicitBatch());
        assert(r === null, `llamada ${i + 1} devolvió perfil`);
    }
    assert(JSON.stringify(cal.getProfile('OJOS').model) === before, 'cambió el modelo antes de la 5ª');
    const r = await addImplicitSamples('OJOS', implicitBatch());
    assert(r && r.kind === 'gaze-v3', '5ª no devolvió perfil');
    assert(JSON.stringify(r.model) !== before, 'modelo igual');
    const n = CONFIG.IMPLICIT_RETRAIN_EVERY * CONFIG.IMPLICIT_SAMPLES_PER_SELECT;
    assert(r.implicit.length === n, `implicit ${r.implicit.length} ≠ ${n}`);
    assert(store.get('miravoz_calibration_v3').scopes.prueba.OJOS.implicit.length === n, 'no persistió implicit');
});
await t('implícito: respeta IMPLICIT_MAX_SAMPLES', async () => {
    const calls = Math.ceil(CONFIG.IMPLICIT_MAX_SAMPLES / CONFIG.IMPLICIT_SAMPLES_PER_SELECT) + 10;
    for (let i = 0; i < calls; i++) await addImplicitSamples('OJOS', implicitBatch());
    // Nunca supera el tope (puede quedar por debajo si la salvaguarda descartó un re-entrenamiento y vació lo implícito)
    assert(cal.getProfile('OJOS').implicit.length > 0 && cal.getProfile('OJOS').implicit.length <= CONFIG.IMPLICIT_MAX_SAMPLES, `${cal.getProfile('OJOS').implicit.length}`);
});
await t('implícito: modo CARA, sin perfil o samples vacío → null sin romper', async () => {
    assert(await addImplicitSamples('CARA', implicitBatch()) === null, 'CARA');
    assert(await addImplicitSamples('OJOS', []) === null, 'vacío');
    const keep = cal.getProfile('OJOS');
    await cal.clearProfile('OJOS');
    assert(await addImplicitSamples('OJOS', implicitBatch()) === null, 'sin perfil');
    await cal.saveProfile('OJOS', { weightsX: [1], weightsY: [1] }); // perfil viejo solo-iris
    assert(await addImplicitSamples('OJOS', implicitBatch()) === null, 'perfil viejo');
    await cal.saveProfile('OJOS', keep);
});
await t('implícito: el contador se reinicia al recalibrar (una nueva sesión OJOS)', async () => {
    await addImplicitSamples('OJOS', implicitBatch()); // contador ≠ 0
    const r = runSession('OJOS', ojosFeat);
    assert(r.result && r.result.implicit.length === 0, 'perfil nuevo');
    for (let i = 0; i < CONFIG.IMPLICIT_RETRAIN_EVERY - 1; i++) assert(await addImplicitSamples('OJOS', implicitBatch()) === null, `llamada ${i + 1}`);
    assert(await addImplicitSamples('OJOS', implicitBatch()), '5ª no re-entrenó');
});

origLog(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
