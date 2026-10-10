// Tests de la tablet vinculada (SPEC F4-4) y de la profesional editando una copia (F4-3), con jsdom.
// Correr:
//   npm install --prefix /tmp/qa jsdom      (una vez; no ensucia el repo)
//   node tools/test-device.mjs              (o JSDOM_PATH=/ruta/a/node_modules/jsdom node tools/test-device.mjs)
//   node tools/test-device.mjs --case=vincular   (un solo caso, salida cruda)
//
// Mismo armado que tools/test-boot.mjs: cada caso en un proceso aparte (módulos ES singleton) y
// stubs de CDN. El stub de supabase soporta auth anónima, rpc por función y consultas encadenadas.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../web');
const CASES = ['vincular', 'vincular-invalido', 'arranque-sin-casita', 'desvinculada',
    'guardar-editable', 'guardar-readonly', 'profesional-edita'];

// ---------------------------------------------------------------- orquestador
const caseArg = process.argv.find(a => a.startsWith('--case='))?.slice(7);
if (!caseArg) {
    console.log('device (jsdom)');
    let pass = 0, fail = 0;
    for (const c of CASES) {
        const r = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(import.meta.url), `--case=${c}`], { encoding: 'utf8', timeout: 30000 });
        const line = (r.stdout || '').split('\n').find(l => l.startsWith('@@RESULT '));
        if (!line) {
            fail++;
            console.log(`  ✗ [${c}] el proceso no devolvió resultado (exit ${r.status})\n${r.stdout}\n${r.stderr}`);
            continue;
        }
        const res = JSON.parse(line.slice(9));
        for (const chk of res.checks) {
            if (chk.ok) { pass++; console.log(`  ✓ [${c}] ${chk.name}`); }
            else { fail++; console.log(`  ✗ [${c}] ${chk.name}\n      ${chk.detail}`); }
        }
        if (res.errors.length) console.log(`    (console.error en [${c}]: ${res.errors.join(' | ').slice(0, 400)})`);
    }
    console.log(`\n${pass} pasan, ${fail} fallan`);
    process.exit(fail ? 1 : 0);
}

// ---------------------------------------------------------------- un caso (proceso hijo)
function loadJSDOM() {
    const candidates = [process.env.JSDOM_PATH, '/tmp/qa/node_modules/jsdom', path.resolve(HERE, '../node_modules/jsdom')].filter(Boolean);
    for (const p of candidates) {
        if (fs.existsSync(p)) return createRequire(import.meta.url)(p).JSDOM;
    }
    try { return createRequire(import.meta.url)('jsdom').JSDOM; } catch {}
    console.log('Falta jsdom: npm install --prefix /tmp/qa jsdom');
    process.exit(2);
}

const checks = [];
const errors = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail: ok ? '' : detail });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const done = () => { console.log('@@RESULT ' + JSON.stringify({ checks, errors })); process.exit(0); };

const JSDOM = loadJSDOM();
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: false });
const win = dom.window;

for (const key of Object.getOwnPropertyNames(win)) {
    if (key in globalThis) continue;
    try { globalThis[key] = win[key]; } catch {}
}
for (const key of ['window', 'document', 'navigator', 'localStorage', 'location', 'Event', 'CustomEvent',
    'HTMLElement', 'Node', 'FileReader', 'Blob', 'DOMParser']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? win : win[key], configurable: true, writable: true });
}
win.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
let rafCount = 0;
globalThis.requestAnimationFrame = win.requestAnimationFrame = (fn) => (++rafCount < 5 ? setTimeout(() => fn(performance.now()), 16) : 0);
globalThis.cancelAnimationFrame = win.cancelAnimationFrame = () => {};
globalThis.speechSynthesis = win.speechSynthesis = { getVoices: () => [], speak: () => {}, cancel: () => {}, onvoiceschanged: null };
globalThis.SpeechSynthesisUtterance = win.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
globalThis.FaceMesh = win.FaceMesh = class { setOptions() {} onResults() {} send() {} };
globalThis.Camera = win.Camera = class { start() {} stop() {} };
globalThis.JSZip = win.JSZip = class {};
globalThis.fetch = win.fetch = async () => { throw new Error('sin red en test'); };
win.prompt = () => null;

const origError = console.error;
console.error = (...a) => { errors.push(a.map(x => (x && x.message) || String(x)).join(' ')); };
process.on('unhandledRejection', (e) => errors.push('unhandledRejection: ' + (e?.message || e)));

// localforage en memoria
const store = new Map();
const lfCalls = { removeItem: [] };
const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const localforage = {
    config() {},
    async keys() { return [...store.keys()]; },
    async getItem(k) { return store.has(k) ? clone(store.get(k)) : null; },
    async setItem(k, v) { store.set(k, clone(v)); return v; },
    async removeItem(k) { lfCalls.removeItem.push(k); store.delete(k); }
};
globalThis.localforage = win.localforage = localforage;

// ---------------------------------------------------------------- datos
const mkBundle = (id, name) => ({ id, name, type: 'grd', importerVersion: 1, mainBoard: 'g_' + id,
    boards: { ['g_' + id]: { id: 'g_' + id, label: { es: name }, rowCount: 1, minColumnCount: 1,
        gridElements: [{ id: 'e1', x: 0, y: 0, width: 1, height: 1, label: { es: 'hola' }, actions: [] }] } } });
const STAMP1 = '2026-10-01T10:00:00.000Z';
const STAMP2 = '2026-10-02T10:00:00.000Z';
const ROW1 = { id: 'as1', board_id: 'orig1', copy_bundle: mkBundle('orig1', 'Casita'), permission: 'editable', copy_updated_at: STAMP1 };
const ROW2 = { id: 'as2', board_id: 'orig2', copy_bundle: mkBundle('orig2', 'Comida'), permission: 'read_only', copy_updated_at: STAMP2 };
const asCopy = (row) => ({ ...clone(row.copy_bundle), id: 'miravoz_copy_' + row.id, bundleId: row.copy_bundle.id,
    assignmentId: row.id, permission: row.permission, copyUpdatedAt: row.copy_updated_at, dirty: false });

const ANON = { id: 'anon1', is_anonymous: true };
const PROF = { id: 'u1', email: 'pro@b.c', is_anonymous: false };
const AAC = { id: 'au1', display_name: 'Mateo', home_board_id: null, settings: {}, professional_id: 'u1' };

// ---------------------------------------------------------------- stub de supabase-js
const sbCalls = [];
const rpcCalls = [];
let anonSignIns = 0;
function makeSupabase({ user = null, tables = {}, rpc = {} } = {}) {
    let session = user ? { user } : null;
    let authCb = null;
    const query = (table) => {
        const q = { table, ops: [] };
        const builder = {};
        for (const op of ['select', 'eq', 'in', 'is', 'gt', 'order', 'insert', 'upsert', 'update', 'delete', 'single', 'maybeSingle']) {
            builder[op] = (...args) => { q.ops.push([op, args]); sbCalls.push({ table, op, args, q }); return builder; };
        }
        builder.then = (res, rej) => {
            const t = tables[table];
            let data = typeof t === 'function' ? t(q) : (t ?? []);
            const eqs = q.ops.filter(([op]) => op === 'eq').map(([, a]) => a);
            if (Array.isArray(data) && !q.ops.some(([op]) => op === 'update')) {
                data = data.filter(r => eqs.every(([k, v]) => !(k in r) || r[k] === v));
            }
            if (q.ops.some(([op]) => ['maybeSingle', 'single'].includes(op))) data = (Array.isArray(data) ? data[0] : data) || null;
            return Promise.resolve({ data, error: null }).then(res, rej);
        };
        return builder;
    };
    return {
        createClient: () => ({
            auth: {
                getSession: async () => ({ data: { session } }),
                getUser: async () => ({ data: { user: session?.user || null } }),
                onAuthStateChange: (cb) => { authCb = cb; setTimeout(() => cb('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
                signInAnonymously: async () => { anonSignIns++; session = { user: ANON }; setTimeout(() => authCb?.('SIGNED_IN', session), 0); return { data: { session }, error: null }; },
                signOut: async () => { session = null; return { error: null }; },
                signInWithPassword: async () => ({ error: null }),
                signUp: async () => ({ data: {}, error: null })
            },
            from: query,
            rpc: async (fn, args) => {
                rpcCalls.push({ fn, args: clone(args) });
                const r = rpc[fn];
                return typeof r === 'function' ? r(args) : (r ?? { data: null, error: null });
            }
        })
    };
}

// ---------------------------------------------------------------- escenario por caso
const cfg = { user: null, tables: {}, rpc: {} };
const DEVICE = (home) => ({ aacUserId: 'au1', displayName: 'Mateo', homeAssignmentId: home, settings: {}, linkedAt: 1 });
let profUpdateRow = null; // para profesional-edita

switch (caseArg) {
    case 'vincular':
    case 'vincular-invalido':
        cfg.tables = { aac_users: [{ ...AAC, home_board_id: 'as1' }], assignments: [ROW1], boards: [] };
        cfg.rpc.redeem_access_code = caseArg === 'vincular'
            ? { data: { ok: true, aac_user_id: 'au1', display_name: 'Mateo', home_board_id: 'as1', settings: {} }, error: null }
            : { data: { ok: false, error: 'Código inválido, vencido o ya usado.' }, error: null };
        break;
    case 'arranque-sin-casita':
        store.set('miravoz_device', DEVICE(null));
        store.set('miravoz_copy_as1', asCopy(ROW1));
        store.set('miravoz_copy_as2', asCopy(ROW2));
        cfg.user = ANON;
        cfg.tables = { aac_users: [AAC], assignments: [ROW1, ROW2], boards: [] };
        break;
    case 'desvinculada':
        store.set('miravoz_device', DEVICE('as1'));
        store.set('miravoz_copy_as1', asCopy(ROW1));
        store.set('miravoz_copy_as2', asCopy(ROW2));
        cfg.user = ANON;
        cfg.tables = { aac_users: [], assignments: [] };
        break;
    case 'guardar-editable':
    case 'guardar-readonly': {
        const row = caseArg === 'guardar-editable' ? ROW1 : ROW2;
        store.set('miravoz_device', DEVICE(row.id));
        store.set('miravoz_copy_' + row.id, asCopy(row));
        cfg.user = ANON;
        cfg.tables = { aac_users: [{ ...AAC, home_board_id: row.id }], assignments: [row] };
        cfg.rpc.save_assignment_copy = { data: { ok: true, copy_updated_at: '2026-10-09T12:00:00.000Z' }, error: null };
        break;
    }
    case 'profesional-edita':
        cfg.user = PROF;
        cfg.tables = {
            boards: [], access_codes: [], aac_users: [AAC],
            assignments: (q) => {
                if (q.ops.some(([op]) => op === 'update')) { profUpdateRow = q; return [{ copy_updated_at: '2026-10-09T13:00:00.000Z' }]; }
                return [{ ...clone(ROW2), aac_users: { display_name: 'Mateo' } }];
            }
        };
        break;
}
win.supabase = makeSupabase(cfg);

const $ = id => document.getElementById(id);
const visible = el => !!el && el.style.display !== 'none';
const S = (await import(pathToFileURL(path.join(WEB, 'js/state.js')).href)).S;

try {
    await import(pathToFileURL(path.join(WEB, 'js/main.js')).href);
} catch (e) {
    check('main.js se importa sin excepciones', false, e.stack);
    done();
}
await sleep(300);

async function rename(newName) {
    const editor = await import(pathToFileURL(path.join(WEB, 'js/editor.js')).href);
    editor.enterEditMode();
    check('modo edición activo', editor.isEditMode() && $('editor-toolbar'), 'sin #editor-toolbar');
    const input = $('editor-toolbar')?.querySelector('input');
    input.value = newName;
    input.dispatchEvent(new win.Event('change'));
    await sleep(200);
    return editor;
}

// 1. Vincular
if (caseArg === 'vincular' || caseArg === 'vincular-invalido') {
    $('btn-account').click();
    await sleep(50);
    check('#auth-view visible tras "Ingresar"', visible($('auth-view')), $('auth-view').style.display);
    $('btn-show-link').click();
    check('#auth-step-link visible', visible($('auth-step-link')), $('auth-step-link').style.display);
    const input = $('link-code-input');
    input.value = 'abcd efgh';
    input.dispatchEvent(new win.Event('input'));
    check('input formatea "abcd efgh" → "ABCD-EFGH"', input.value === 'ABCD-EFGH', `value="${input.value}"`);
    $('btn-link-device').click();
    await sleep(400);
    check('se llamó signInAnonymously', anonSignIns === 1, `llamadas=${anonSignIns}`);
    const redeem = rpcCalls.find(c => c.fn === 'redeem_access_code');
    check("rpc('redeem_access_code', {p_code:'ABCDEFGH'})", redeem?.args?.p_code === 'ABCDEFGH', JSON.stringify(rpcCalls));
    if (caseArg === 'vincular') {
        check('miravoz_device guardado', store.get('miravoz_device')?.aacUserId === 'au1' && store.get('miravoz_device')?.homeAssignmentId === 'as1', JSON.stringify(store.get('miravoz_device')));
        check('copia bajada a miravoz_copy_as1', store.get('miravoz_copy_as1')?.bundleId === 'orig1', JSON.stringify(Object.keys(Object.fromEntries(store))));
        check('body.device-mode', document.body.classList.contains('device-mode'), document.body.className);
        check('#bottom-bar oculto', !visible($('bottom-bar')), $('bottom-bar').style.display);
        check('#auth-view oculto', !visible($('auth-view')), $('auth-view').style.display);
        check('#board-view visible con la casita abierta', visible($('board-view')) && S.currentBundle?.id === 'miravoz_copy_as1', `board=${$('board-view').style.display} current=${S.currentBundle?.id}`);
        check('ninguna llamada a "boards" (la sesión anónima no sincroniza)', !sbCalls.some(c => c.table === 'boards'), JSON.stringify(sbCalls.filter(c => c.table === 'boards').map(c => c.op)));
    } else {
        check('#link-error muestra el error', /Código inválido/.test($('link-error').textContent), `"${$('link-error').textContent}"`);
        check('no hay modo tablet', !document.body.classList.contains('device-mode') && !store.has('miravoz_device'), document.body.className);
        check('#btn-link-device rehabilitado', !$('btn-link-device').disabled, 'disabled');
    }
}

// 2. Arranque vinculado sin casita
if (caseArg === 'arranque-sin-casita') {
    const cards = [...document.querySelectorAll('#board-list .device-card')];
    check('lista con 2 .device-card', cards.length === 2, `cards=${cards.length}`);
    check('títulos de las cards', cards.map(c => c.querySelector('h3').textContent).join(',') === 'Casita,Comida', cards.map(c => c.textContent).join(','));
    check('título con el nombre del usuario', document.querySelector('#board-list .device-title')?.textContent === 'Tableros de Mateo', document.querySelector('#board-list .device-title')?.textContent);
    check('body.device-mode y barras ocultas', document.body.classList.contains('device-mode') && !visible($('bottom-bar')) && !visible($('top-bar')), `${document.body.className} bottom=${$('bottom-bar').style.display}`);
    check('ninguna llamada a "boards" de supabase', !sbCalls.some(c => c.table === 'boards'), JSON.stringify(sbCalls.map(c => c.table)));
    check('pullCopies consultó aac_users y assignments', sbCalls.some(c => c.table === 'aac_users') && sbCalls.some(c => c.table === 'assignments'), JSON.stringify([...new Set(sbCalls.map(c => c.table))]));
    cards[1].click();
    await sleep(50);
    check('click en card abre la copia', S.currentBundle?.id === 'miravoz_copy_as2' && visible($('board-view')), S.currentBundle?.id);
}

// 3. Desvinculada remotamente
if (caseArg === 'desvinculada') {
    check('miravoz_device borrado', !store.has('miravoz_device'), JSON.stringify(store.get('miravoz_device')));
    check('copias borradas', ![...store.keys()].some(k => k.startsWith('miravoz_copy_')), JSON.stringify([...store.keys()]));
    const msg = $('dialog-message');
    check('customAlert visible "desvinculada"', visible($('custom-dialog')) && /desvinculada/.test(msg.innerText || msg.textContent), `${$('custom-dialog').style.display} "${msg.innerText || msg.textContent}"`);
    const bks = [...store.keys()].filter(k => k.startsWith('miravoz_conflict_backup_'));
    check('(info) respaldo de copias antes de borrar', true, '');
    // Decisión de producto: al desvincular se borran copias Y respaldos (son datos del chico; privacidad).
    check('desvinculada: no quedan respaldos de copias en la tablet', !bks.length, JSON.stringify(bks));
}

// 4. Guardar copia
if (caseArg === 'guardar-editable' || caseArg === 'guardar-readonly') {
    const editable = caseArg === 'guardar-editable';
    const aid = editable ? 'as1' : 'as2';
    check('casita abierta', S.currentBundle?.id === 'miravoz_copy_' + aid && visible($('board-view')), S.currentBundle?.id);
    check(`body.copy-editable ${editable ? 'presente' : 'ausente'} (lápiz ${editable ? 'visible' : 'oculto'} por CSS)`,
        document.body.classList.contains('copy-editable') === editable, document.body.className);
    if (!editable) {
        // Una copia de solo lectura no entra en modo edición en la tablet (editor.enterEditMode lo bloquea)
        const editor = await import(pathToFileURL(path.join(WEB, 'js/editor.js')).href);
        editor.enterEditMode();
        check('read_only: no entra en modo edición', !editor.isEditMode() && !$('editor-toolbar'), 'entró en edición');
    } else {
        await rename('Renombrada');
    }
    const saved = store.get('miravoz_copy_' + aid);
    if (editable) check('copia renombrada en localforage', saved?.name === 'Renombrada', JSON.stringify(saved?.name));
    const calls = rpcCalls.filter(c => c.fn === 'save_assignment_copy');
    if (editable) {
        const a = calls[0]?.args;
        check("rpc('save_assignment_copy') llamada", calls.length >= 1, JSON.stringify(rpcCalls.map(c => c.fn)));
        check('p_assignment_id = as1', a?.p_assignment_id === 'as1', JSON.stringify(a?.p_assignment_id));
        check('p_copy_bundle.id = id original (orig1)', a?.p_copy_bundle?.id === 'orig1', JSON.stringify(a?.p_copy_bundle?.id));
        const leaked = ['assignmentId', 'permission', 'copyUpdatedAt', 'dirty', 'bundleId', 'profEdit', 'ownerLabel'].filter(k => a?.p_copy_bundle && k in a.p_copy_bundle);
        check('p_copy_bundle sin metadatos de la copia', a && leaked.length === 0, `campos filtrados: ${leaked}`);
        check('p_copy_bundle.name = Renombrada', a?.p_copy_bundle?.name === 'Renombrada', JSON.stringify(a?.p_copy_bundle?.name));
        check('p_expected_updated_at = valor original', a?.p_expected_updated_at === STAMP1, JSON.stringify(a?.p_expected_updated_at));
        check('tras subir: dirty=false y copyUpdatedAt nuevo', saved?.dirty === false && saved?.copyUpdatedAt === '2026-10-09T12:00:00.000Z', JSON.stringify({ d: saved?.dirty, c: saved?.copyUpdatedAt }));
    } else {
        check('read_only: NO se llamó a save_assignment_copy', calls.length === 0, JSON.stringify(calls));
    }
    check('ninguna escritura en "boards"', !sbCalls.some(c => c.table === 'boards'), JSON.stringify(sbCalls.filter(c => c.table === 'boards').map(c => c.op)));
}

// 5. Profesional edita copia
if (caseArg === 'profesional-edita') {
    check('sesión de profesional activa', S.currentUser?.id === 'u1', JSON.stringify(S.currentUser));
    window.dispatchEvent(new CustomEvent('miravoz:edit-copy', { detail: { assignmentId: 'as2' } }));
    await sleep(200);
    const editor = await import(pathToFileURL(path.join(WEB, 'js/editor.js')).href);
    check('copia abierta', S.currentBundle?.id === 'miravoz_copy_as2' && S.currentBundle?.profEdit, S.currentBundle?.id);
    check('#copy-banner con el nombre del usuario', /Mateo/.test($('copy-banner')?.textContent || ''), $('copy-banner')?.textContent);
    check('modo edición activo', editor.isEditMode(), 'no');
    const input = $('editor-toolbar')?.querySelector('input');
    input.value = 'Para Mateo';
    input.dispatchEvent(new win.Event('change'));
    await sleep(200);
    const ops = profUpdateRow?.ops || [];
    const upd = ops.find(([op]) => op === 'update')?.[1][0];
    check("update en 'assignments'", !!upd, JSON.stringify(sbCalls.filter(c => c.table === 'assignments').map(c => c.op)));
    check('update con copy_bundle renombrado e id original', upd?.copy_bundle?.name === 'Para Mateo' && upd?.copy_bundle?.id === 'orig2', JSON.stringify({ n: upd?.copy_bundle?.name, id: upd?.copy_bundle?.id }));
    check(".eq('id','as2')", ops.some(([op, a]) => op === 'eq' && a[0] === 'id' && a[1] === 'as2'), JSON.stringify(ops));
    check(".eq('copy_updated_at', valor original)", ops.some(([op, a]) => op === 'eq' && a[0] === 'copy_updated_at' && a[1] === STAMP2), JSON.stringify(ops));
    check('.select() al final (detecta conflicto)', ops.some(([op]) => op === 'select'), JSON.stringify(ops));
    check('no se usó la RPC de la tablet', !rpcCalls.some(c => c.fn === 'save_assignment_copy'), JSON.stringify(rpcCalls));
    check('ninguna escritura en "boards" para la copia', !sbCalls.some(c => c.table === 'boards' && ['insert', 'upsert', 'update'].includes(c.op)), 'hubo escritura en boards');
    const saved = store.get('miravoz_copy_as2');
    check('copyUpdatedAt actualizado y dirty=false', saved?.copyUpdatedAt === '2026-10-09T13:00:00.000Z' && saved?.dirty === false, JSON.stringify({ c: saved?.copyUpdatedAt, d: saved?.dirty }));
    check('la copia no aparece en el home de la profesional', ![...document.querySelectorAll('#board-list .board-card h3')].some(h => h.textContent === 'Para Mateo'), 'aparece');
}

console.error = origError;
done();
