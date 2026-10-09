// Test de humo del arranque de la app (web/index.html + web/js/*) con DOM simulado (jsdom).
// Correr:
//   npm install --prefix /tmp/qa jsdom      (una vez; no ensucia el repo)
//   node tools/test-boot.mjs                (o JSDOM_PATH=/ruta/a/node_modules/jsdom node tools/test-boot.mjs)
//
// Cada caso corre en un proceso Node aparte: los módulos ES son singletons y auth.js
// decide en el import si hay cliente de Supabase, así que no se pueden reusar entre casos.
// Las dependencias de CDN (supabase, localforage, MediaPipe, JSZip) se reemplazan por stubs.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../web');
const CASES = ['sin-cuenta', 'sin-cdn', 'con-sesion', 'con-sesion-rechaza', 'editor-local', 'editor-sesion', 'xss'];

// ---------------------------------------------------------------- orquestador
const caseArg = process.argv.find(a => a.startsWith('--case='))?.slice(7);
if (!caseArg) {
    console.log('boot (jsdom)');
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

// Exponer el entorno del navegador como globals de Node
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
const synth = { getVoices: () => [], speak: () => {}, cancel: () => {}, onvoiceschanged: null };
globalThis.speechSynthesis = win.speechSynthesis = synth;
globalThis.SpeechSynthesisUtterance = win.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
globalThis.FaceMesh = win.FaceMesh = class { setOptions() {} onResults() {} send() {} };
globalThis.Camera = win.Camera = class { start() {} stop() {} };
globalThis.JSZip = win.JSZip = class {};
globalThis.fetch = win.fetch = async () => { throw new Error('sin red en test'); };

const origError = console.error;
console.error = (...a) => { errors.push(a.map(x => (x && x.message) || String(x)).join(' ')); };
process.on('unhandledRejection', (e) => errors.push('unhandledRejection: ' + (e?.message || e)));

// localforage en memoria (clona como IndexedDB)
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

const BUNDLE = { id: 'bundle_1', name: 'Prueba', type: 'grd', mainBoard: 'g1', boards: { g1: { id: 'g1', label: { es: 'Prueba' }, rowCount: 2, minColumnCount: 2, gridElements: [{ id: 'e1', x: 0, y: 0, width: 1, height: 1, label: { es: 'hola' }, actions: [] }] } } };
const CLOUD = { id: 'bundle_cloud', name: 'Nube', type: 'grd', mainBoard: 'gc', updatedAt: 1000, boards: { gc: { id: 'gc', label: { es: 'Nube' }, rowCount: 1, minColumnCount: 1, gridElements: [] } } };
// En editor-sesion el tablero ya es de la cuenta y está sincronizado (en local y en la nube)
const OWNED = { ...clone(BUNDLE), ownerId: 'u1', updatedAt: 500, syncedAt: 500 };
store.set('bundle_1', caseArg === 'editor-sesion' ? clone(OWNED) : clone(BUNDLE));

// Stub de supabase-js
const sbCalls = [];
function makeSupabase({ user = null, tables = {} } = {}) {
    const session = user ? { user } : null;
    const query = (table) => {
        const q = { table, ops: [] };
        const rec = (op) => (...args) => { q.ops.push([op, args]); sbCalls.push({ table, op, args, q }); return builder; };
        const builder = {};
        for (const op of ['select', 'eq', 'in', 'order', 'insert', 'upsert', 'update', 'delete', 'single', 'maybeSingle']) builder[op] = rec(op);
        builder.then = (res, rej) => {
            let data = typeof tables[table] === 'function' ? tables[table](q) : (tables[table] ?? []);
            if (q.ops.some(([op]) => op === 'maybeSingle')) {
                const idEq = q.ops.find(([op, a]) => op === 'eq' && a[0] === 'id');
                data = (Array.isArray(data) ? data : []).find(r => !idEq || r.id === idEq[1][1]) || null;
            }
            return Promise.resolve({ data, error: null }).then(res, rej);
        };
        return builder;
    };
    return {
        createClient: () => ({
            auth: {
                getSession: async () => ({ data: { session } }),
                onAuthStateChange: (cb) => { setTimeout(() => cb('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
                signOut: async () => ({ error: null }),
                signInWithPassword: async () => ({ error: null }),
                signUp: async () => ({ data: {}, error: null })
            },
            from: query
        })
    };
}

const USER = { id: 'u1', email: 'a@b.c' };
const XSS = '<img src=x onerror=alert(1)>';
const withSession = ['con-sesion', 'con-sesion-rechaza', 'editor-sesion', 'xss'].includes(caseArg);
if (caseArg !== 'sin-cdn') {
    win.supabase = makeSupabase(withSession ? {
        user: USER,
        tables: {
            boards: [{ id: CLOUD.id, bundle: CLOUD, updated_at: new Date(1000).toISOString() },
                     ...(caseArg === 'editor-sesion' ? [{ id: 'bundle_1', bundle: clone(OWNED), updated_at: new Date(500).toISOString() }] : [])],
            aac_users: caseArg === 'xss' ? [{ id: 'au1', display_name: XSS, professional_id: 'u1' }] : [],
            access_codes: [{ code: '123-456', aac_user_id: 'au1' }]
        }
    } : {});
}

const $ = id => document.getElementById(id);
const visible = el => !!el && el.style.display !== 'none';
// Escrituras de tableros: upsert/insert/update (sync.js usa concurrencia optimista: insert o update condicional)
const upserts = () => sbCalls.filter(c => c.table === 'boards' && ['upsert', 'insert', 'update'].includes(c.op))
    .map(c => ({ ...c.args[0], id: c.args[0].id ?? c.q.ops.find(([op, a]) => op === 'eq' && a[0] === 'id')?.[1][1] }));

try {
    await import(pathToFileURL(path.join(WEB, 'js/main.js')).href);
} catch (e) {
    check('main.js se importa sin excepciones', false, e.stack);
    done();
}
await sleep(300);

const cards = () => [...document.querySelectorAll('#board-list .board-card')].map(c => c.querySelector('h3')?.textContent);

if (caseArg === 'sin-cuenta' || caseArg === 'sin-cdn') {
    check('#home-view visible', visible($('home-view')), `display=${$('home-view').style.display}`);
    check('#auth-view oculto', !visible($('auth-view')), `display=${$('auth-view').style.display}`);
    check('#btn-account dice "Ingresar (profesionales)"', $('btn-account').textContent.trim() === 'Ingresar (profesionales)', `texto="${$('btn-account').textContent.trim()}"`);
    check('#btn-nav-users oculto', !visible($('btn-nav-users')), `display="${$('btn-nav-users').style.display}"`);
    check('tablero local aparece en #board-list', cards().includes('Prueba'), `cards=${JSON.stringify(cards())}`);
    check('sin llamadas a la nube', sbCalls.length === 0, JSON.stringify(sbCalls));
}

if (caseArg === 'con-sesion' || caseArg === 'con-sesion-rechaza') {
    check('#btn-account dice "Cerrar sesión"', $('btn-account').textContent.trim() === 'Cerrar sesión', $('btn-account').textContent);
    check('#btn-nav-users visible', visible($('btn-nav-users')), `display="${$('btn-nav-users').style.display}"`);
    const cloudLocal = store.get('bundle_cloud');
    check('tablero de la nube bajado a localforage', cloudLocal && cloudLocal.name === 'Nube' && cloudLocal.ownerId === 'u1', JSON.stringify(cloudLocal));
    check('ambos tableros en #board-list mientras se pregunta', cards().includes('Prueba') && cards().includes('Nube'), JSON.stringify(cards()));
    // El tablero local "de nadie" NO se sube sin preguntar
    check('se pregunta antes de subir el tablero local (#custom-dialog visible)', visible($('custom-dialog')) && /no están en ninguna cuenta/.test($('dialog-message').innerText || $('dialog-message').textContent), $('dialog-message').textContent);
    check('antes de responder no hubo upsert de bundle_1', !upserts().some(u => u.id === 'bundle_1'), JSON.stringify(upserts()));
    if (caseArg === 'con-sesion') {
        $('btn-dialog-ok').click();
        await sleep(200);
        check('al aceptar: bundle_1 adoptado (upsert con owner u1)', upserts().some(u => u.id === 'bundle_1' && u.owner_professional_id === 'u1'), JSON.stringify(upserts()));
        check('al aceptar: bundle_1 queda con ownerId u1 en local', store.get('bundle_1')?.ownerId === 'u1', JSON.stringify(store.get('bundle_1')?.ownerId));
    } else {
        $('btn-dialog-cancel').click();
        await sleep(200);
        check('al rechazar: no se sube bundle_1', !upserts().some(u => u.id === 'bundle_1'), JSON.stringify(upserts()));
        check('al rechazar: bundle_1 sigue sin dueño (visible sin cuenta)', !store.get('bundle_1')?.ownerId, JSON.stringify(store.get('bundle_1')?.ownerId));
        check('al rechazar: no se vuelve a preguntar (miravoz_adopt_declined)', (store.get('miravoz_adopt_declined') || []).includes('bundle_1'), JSON.stringify(store.get('miravoz_adopt_declined')));
    }
    check('ningún tablero local se borró', lfCalls.removeItem.length === 0 && store.has('bundle_1'), `removeItem=${JSON.stringify(lfCalls.removeItem)}`);
}

if (caseArg === 'editor-local' || caseArg === 'editor-sesion') {
    const boards = await import(pathToFileURL(path.join(WEB, 'js/boards.js')).href);
    const editor = await import(pathToFileURL(path.join(WEB, 'js/editor.js')).href);
    const before = upserts().length;
    const b = await localforage.getItem('bundle_1');
    boards.openBundle(b);
    editor.enterEditMode();
    check('modo edición activo y toolbar creada', editor.isEditMode() && $('editor-toolbar'), 'sin #editor-toolbar');
    const input = $('editor-toolbar')?.querySelector('input');
    const t0 = Date.now();
    input.value = 'Renombrado';
    input.dispatchEvent(new win.Event('change'));
    await sleep(150);
    const saved = store.get('bundle_1');
    check('nombre nuevo persistido en localforage', saved?.name === 'Renombrado', JSON.stringify(saved?.name));
    check('updatedAt actualizado', saved?.updatedAt >= t0, `updatedAt=${saved?.updatedAt}`);
    check('label del grid principal renombrado', saved?.boards?.g1?.label?.es === 'Renombrado', JSON.stringify(saved?.boards?.g1?.label));
    if (caseArg === 'editor-sesion') {
        const after = upserts().slice(before);
        check('con sesión se llamó a upsert con el nombre nuevo', after.some(u => u.id === 'bundle_1' && u.name === 'Renombrado'), JSON.stringify(after.map(u => u.name)));
    } else {
        check('sin sesión no hay llamadas a la nube', sbCalls.length === 0, JSON.stringify(sbCalls));
    }
}

if (caseArg === 'xss') {
    const list = $('users-list');
    check('fetchUsers renderizó el usuario', list.textContent.includes(XSS), list.innerHTML.slice(0, 200));
    check('display_name malicioso no crea <img> en #users-list', !list.querySelector('img'), list.innerHTML.slice(0, 300));
    const users = await import(pathToFileURL(path.join(WEB, 'js/users.js')).href);
    users.renderUsersList();
    check('renderUsersList directo tampoco crea <img>', !list.querySelector('img'), list.innerHTML.slice(0, 300));
}

console.error = origError;
done();
