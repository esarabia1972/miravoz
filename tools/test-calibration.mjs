// Tests de la sesión de calibración REAL (web/js/calibration.js) en Node, con stubs mínimos de globals.
// Cubre modo Rostro (CARA), abort sin rostro y persistencia. (El modo Iris se sacó en 0.7.9f.) Correr: node tools/test-calibration.mjs

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
const { CalibrationSession, isUsableProfile, loadProfiles } = cal;

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; origLog('  ✓', n); } catch (e) { fail++; origLog('  ✗', n, '\n     ', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

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
    assert(p.kind === undefined && p.model === undefined && p.samples === undefined, `campos inesperados: ${Object.keys(p)}`);
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
await t('CARA: isUsableProfile(CARA) true; sin perfil false', () => {
    assert(isUsableProfile('CARA', cara.result), 'CARA');
    assert(!isUsableProfile('CARA', null), 'null');
});

// 5. Persistencia (antes de tocar el perfil con el implícito)
await t('persistencia: miravoz_calibration_v3 (ámbito "prueba") y loadProfiles() lo recupera', async () => {
    await new Promise(r => setTimeout(r, 0));
    const st = store.get('miravoz_calibration_v3');
    const sc = st && st.scopes && st.scopes.prueba;
    assert(sc && sc['CARA@landscape'], `guardado: ${st && JSON.stringify(Object.keys(st))}`);
    assert(sc['CARA@landscape'].weightsX && sc['CARA@landscape'].schema === 3 && sc['CARA@landscape'].context, 'contenido');
    cal._setStorage(globalThis.localforage);
    await loadProfiles();
    assert(isUsableProfile('CARA', cal.getProfile('CARA')), 'no recuperó');
    assert(JSON.stringify(cal.getProfile('CARA').weightsX) === JSON.stringify(cara.result.weightsX), 'pesos distintos');
});

// 3. Sin rostro
await t('sin rostro: 3 puntos seguidos con features null → onComplete(null), sin loop', () => {
    quiet = true;
    const r = runSession('CARA', () => null, 60000);
    quiet = false;
    assert(r.done && r.result === null, `CARA done=${r.done} result=${r.result}`);
    const pts = new Set(r.log.map(e => e.index));
    assert(pts.size === 1 && r.s.phase === 'DONE', `puntos mostrados ${[...pts]}`);
    const expected = 3 * (CONFIG.COUNTDOWN_MS + 3000 + CONFIG.SAMPLE_WARMUP_MS); // tope de 3 s por punto si no llegan cuadros
    assert(r.now < expected + 500, `tardó ${r.now} ms`);
});
await t('sin rostro intermitente (cara aparece y desaparece) no aborta si un punto sale bien', () => {
    quiet = true;
    const r = runSession('CARA', (info, now) => (Math.floor(now / 2700) % 3 === 2 ? null : caraFeat(info)), 120000);
    quiet = false;
    assert(r.done && r.result, 'abortó o no terminó');
});

origLog(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
