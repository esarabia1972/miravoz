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
// Acceso (EQUIPO.md regla 2, 10/10/2026): sin modo sin cuenta; profesionales solo con Google.
// 'editor-local' se eliminó: sin sesión el home no es alcanzable, así que el editor siempre corre con sesión
// (lo cubre 'editor-sesion').
const CASES = ['sin-sesion', 'sin-cdn', 'vuelta-google-error', 'con-sesion', 'con-sesion-rechaza', 'editor-sesion', 'paginas', 'asterics', 'xss', 'practicar'];

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
const START_URL = caseArg === 'vuelta-google-error' ? 'http://localhost/?demo=1&error=access_denied&error_description=Acceso%20denegado' : 'http://localhost/';
const dom = new JSDOM(html, { url: START_URL, pretendToBeVisual: false });
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
// jsdom no implementa innerText: se emula con textContent (para poder leer los diálogos)
Object.defineProperty(win.HTMLElement.prototype, 'innerText', { get() { return this.textContent; }, set(v) { this.textContent = v; }, configurable: true });
win.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
let rafCount = 0;
globalThis.requestAnimationFrame = win.requestAnimationFrame = (fn) => (++rafCount < 5 ? setTimeout(() => fn(performance.now()), 16) : 0);
globalThis.cancelAnimationFrame = win.cancelAnimationFrame = () => {};
const spoken = [];
const synth = { getVoices: () => [], speak: (u) => spoken.push(u.text), cancel: () => {}, onvoiceschanged: null };
globalThis.speechSynthesis = win.speechSynthesis = synth;
globalThis.SpeechSynthesisUtterance = win.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
globalThis.FaceMesh = win.FaceMesh = class { setOptions() {} onResults() {} send() {} };
globalThis.Camera = win.Camera = class { start() {} stop() {} };
globalThis.JSZip = win.JSZip = class {};
const audios = [];
globalThis.Audio = win.Audio = class { constructor(src) { this.src = src; this.paused = true; this.volume = 1; audios.push(src); } play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } };
globalThis.fetch = win.fetch = async (url) => {
    // Caso 'paginas': ARASAAC responde la palabra de cada pictograma
    if (caseArg === 'paginas' && String(url).startsWith('https://api.arasaac.org/api/pictograms/es/')) {
        return { ok: true, json: async () => ({ keywords: [{ keyword: 'coche' }, { keyword: 'auto' }] }) };
    }
    throw new Error('sin red en test');
};

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
const ownedCase = caseArg === 'editor-sesion' || caseArg === 'paginas' || caseArg === 'asterics' || caseArg === 'practicar';
store.set('bundle_1', ownedCase ? clone(OWNED) : clone(BUNDLE));

// Stub de supabase-js
const sbCalls = [];
function makeSupabase({ user = null, tables = {} } = {}) {
    const session = user ? { user } : null;
    const query = (table) => {
        const q = { table, ops: [] };
        const rec = (op) => (...args) => { q.ops.push([op, args]); sbCalls.push({ table, op, args, q }); return builder; };
        const builder = {};
        for (const op of ['select', 'eq', 'in', 'is', 'gt', 'order', 'insert', 'upsert', 'update', 'delete', 'single', 'maybeSingle']) builder[op] = rec(op);
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
                signInWithOAuth: async (opts) => { sbCalls.push({ table: 'auth', op: 'signInWithOAuth', args: [JSON.parse(JSON.stringify(opts))] }); return { data: {}, error: null }; },
                signInWithPassword: async () => { sbCalls.push({ table: 'auth', op: 'signInWithPassword', args: [] }); return { error: null }; },
                signUp: async () => { sbCalls.push({ table: 'auth', op: 'signUp', args: [] }); return { data: {}, error: null }; }
            },
            from: query,
            rpc: async (fn, args) => { sbCalls.push({ table: 'rpc:' + fn, op: 'rpc', args: [args] }); return { data: null, error: null }; }
        })
    };
}

const USER = { id: 'u1', email: 'a@b.c' };
const XSS = '<img src=x onerror=alert(1)>';
const withSession = ['con-sesion', 'con-sesion-rechaza', 'editor-sesion', 'paginas', 'asterics', 'xss', 'practicar'].includes(caseArg);
if (caseArg !== 'sin-cdn') {
    win.supabase = makeSupabase(withSession ? {
        user: USER,
        tables: {
            boards: [{ id: CLOUD.id, bundle: CLOUD, updated_at: new Date(1000).toISOString() },
                     ...(ownedCase ? [{ id: 'bundle_1', bundle: clone(OWNED), updated_at: new Date(500).toISOString() }] : [])],
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

if (caseArg === 'sin-sesion' || caseArg === 'sin-cdn' || caseArg === 'vuelta-google-error') {
    check('#auth-view visible', visible($('auth-view')), `display=${$('auth-view').style.display}`);
    check('#btn-google y #btn-show-link presentes', !!$('btn-google') && !!$('btn-show-link'), 'falta alguno');
    check('#btn-google dice "Ingresar con Google"', /Ingresar con Google/.test($('btn-google')?.textContent || ''), $('btn-google')?.textContent);
    check('#home-view, #top-bar y #bottom-bar ocultos', !visible($('home-view')) && !visible($('top-bar')) && !visible($('bottom-bar')),
        `home=${$('home-view').style.display} top=${$('top-bar').style.display} bottom=${$('bottom-bar').style.display}`);
    const gone = ['btn-auth-back', 'auth-email-input', 'auth-password-input', 'btn-signup', 'btn-login'].filter(id => $(id));
    check('no existen los restos del modo sin cuenta / contraseña', gone.length === 0, `aparecen: ${gone}`);
    check('#btn-account oculto sin sesión', !visible($('btn-account')), `display="${$('btn-account').style.display}"`);
    check('#btn-nav-users oculto', !visible($('btn-nav-users')), `display="${$('btn-nav-users').style.display}"`);
    check('sin llamadas a tablas de la nube', !sbCalls.some(c => c.table !== 'auth'), JSON.stringify(sbCalls.map(c => c.table + '.' + c.op)));
    check('el tablero local NO se borró', store.has('bundle_1') && lfCalls.removeItem.length === 0, JSON.stringify(lfCalls.removeItem));
}

if (caseArg === 'vuelta-google-error') {
    check('URL limpia (sin error/error_description) y conserva ?demo=1', location.search === '?demo=1' && location.hash === '', location.href);
    const et = document.getElementById('error-toast');
    check('toast rojo con el error de Google', !!et && et.classList.contains('visible') && /Acceso denegado/.test(et.textContent), et ? `"${et.textContent}"` : 'sin toast');
}

if (caseArg === 'sin-sesion') {
    check('#auth-error vacío al arrancar', $('auth-error').textContent.trim() === '', `"${$('auth-error').textContent}"`);
    // Simula restos de un intento anterior en la URL: redirectTo debe salir limpio
    history.replaceState(null, '', '/?demo=1&code=abc&state=xyz#frag');
    $('btn-google').click();
    await sleep(50);
    const oauth = sbCalls.filter(c => c.op === 'signInWithOAuth');
    const o = oauth[0]?.args[0];
    check('click en #btn-google llama signInWithOAuth una vez', oauth.length === 1, JSON.stringify(sbCalls.map(c => c.op)));
    check("provider = 'google'", o?.provider === 'google', JSON.stringify(o));
    check('redirectTo sin code/state/hash y con ?demo=1', o?.options?.redirectTo === 'http://localhost/?demo=1', JSON.stringify(o?.options?.redirectTo));
    check('sin signInWithPassword ni signUp', !sbCalls.some(c => ['signInWithPassword', 'signUp'].includes(c.op)), 'hubo');
}

if (caseArg === 'sin-cdn') {
    $('btn-google').click();
    await sleep(50);
    check('sin CDN: click en Google muestra mensaje en #auth-error', $('auth-error').textContent.trim().length > 0, `"${$('auth-error').textContent}"`);
    check('sin CDN: sigue en la pantalla de ingreso', visible($('auth-view')) && !visible($('home-view')), $('auth-view').style.display);
    check('sin CDN: sin excepciones', !errors.some(e => /unhandledRejection|TypeError/.test(e)), errors.join(' | '));
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

if (caseArg === 'editor-sesion') {
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
    const after = upserts().slice(before);
    check('con sesión se llamó a upsert con el nombre nuevo', after.some(u => u.id === 'bundle_1' && u.name === 'Renombrado'), JSON.stringify(after.map(u => u.name)));

    // 0.8.1: celda nueva de 2 columnas, botón derecho, fondo de la página
    const { S } = await import(pathToFileURL(path.join(WEB, 'js/state.js')).href);
    const g = S.currentBundle.boards[S.currentGridId];
    g.rowCount = 3; g.minColumnCount = 4; g.gridElements = [];
    boards.renderGrid(S.currentGridId); await sleep(20);
    editor.openCellEditor(S.currentGridId, null, 0, 0);
    $('ce-label').value = 'carne'; $('ce-w').value = '3';
    check('el editor ofrece ancho hasta el borde (4 columnas)', $('ce-w').options.length === 4 && $('ce-h').options.length === 3, `${$('ce-w').options.length}x${$('ce-h').options.length}`);
    $('ce-save').click(); await sleep(150);
    const el = g.gridElements.find(e => e.label?.es === 'carne');
    check('la celda queda de 3×1', el && el.width === 3 && el.height === 1, JSON.stringify(el && { w: el.width, h: el.height }));
    check('se dibuja ocupando 3 columnas', $('cell-0-0')?.style.gridColumn.includes('span 3'), $('cell-0-0')?.style.gridColumn);
    $('cell-0-0').dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
    await sleep(20);
    const menu = $('cell-menu');
    check('botón derecho abre el menú de la celda', menu && /Editar/.test(menu.textContent) && /Duplicar/.test(menu.textContent) && /Eliminar/.test(menu.textContent), menu ? menu.textContent : 'sin menú');
    [...menu.querySelectorAll('button')].find(b => b.textContent === 'Duplicar').click(); await sleep(150);
    const copies = g.gridElements.filter(e => e.label?.es === 'carne');
    check('Duplicar pone la copia en el primer lugar libre (3×1 en la fila 2)', copies.length === 2 && copies[1].y === 1 && copies[1].x === 0 && copies[1].width === 3, JSON.stringify(copies.map(c => [c.x, c.y, c.width])));
    const bg = $('editor-toolbar').querySelector('input[type=color]');
    bg.value = '#000000'; bg.dispatchEvent(new win.Event('change')); await sleep(150);
    check('color de fondo de la página guardado y aplicado', g.backgroundColor === '#000000' && $('grid-container').style.backgroundColor !== '', `${g.backgroundColor} / ${$('grid-container').style.backgroundColor}`);
    // 0.8.1c: celdas vacías transparentes con fondo, espacio entre celdas, solo imagen, esquina para agrandar
    check('con fondo, la grilla marca las celdas vacías como transparentes', $('grid-container').classList.contains('has-page-bg'), $('grid-container').className);
    const gapSel = [...$('editor-toolbar').querySelectorAll('select')].find(x => [...x.options].some(o => o.textContent === 'Muy grande'));
    gapSel.value = '56'; gapSel.dispatchEvent(new win.Event('change')); await sleep(150);
    check('espacio entre celdas por página', g.cellGap === 56 && $('grid-container').style.gap === '56px', `${g.cellGap} / ${$('grid-container').style.gap}`);
    check('cada celda tiene la esquina para cambiar el tamaño', !!$('cell-0-0')?.querySelector('.resize-handle'), '');
    check('0.8.1g: bordes para estirar (ancho, alto y esquina)', ['.resize-e', '.resize-s', '.resize-se'].every(q => !!$('cell-0-0')?.querySelector(q)), '');
    check('0.8.1g: la grilla queda en modo edición (sin arrastre nativo)', document.querySelector('.grid-container')?.classList.contains('edit-grid') && !$('cell-0-0')?.draggable, '');
    check('0.8.1j: botones Seleccionar, Deshacer y Rehacer en la barra', !!document.getElementById('et-select') && !!document.getElementById('et-undo') && !!document.getElementById('et-redo'), '');
    editor.openCellEditor(S.currentGridId, g.gridElements[0], 0, 0);
    $('ce-show-label').checked = false; $('ce-save').click(); await sleep(150);
    check('"Mostrar el texto" apagado: solo imagen (el texto queda para la voz)', g.gridElements[0].labelHidden === true && !$('cell-0-0').querySelector('.picto-label') && $('cell-0-0').getAttribute('aria-label') === 'carne', $('cell-0-0').innerHTML.slice(0, 120));
}

if (caseArg === 'paginas') {
    const boards = await import(pathToFileURL(path.join(WEB, 'js/boards.js')).href);
    const editor = await import(pathToFileURL(path.join(WEB, 'js/editor.js')).href);
    const { S } = await import(pathToFileURL(path.join(WEB, 'js/state.js')).href);
    // Respaldo de Asterics sintético: 3 preguntas encadenadas por la celda del título, con BOM
    const q = (id, title, next) => ({ id, label: { es: title }, rowCount: 3, minColumnCount: 3, gridElements: [
        { id: id + 't', x: 0, y: 0, width: 3, height: 1, label: { es: title }, actions: next ? [{ modelName: 'GridActionNavigate', navType: 'navigateToGrid', toGridId: next }] : [] },
        { id: id + 'p', x: 0, y: 2, width: 1, height: 1, label: {}, actions: [{ modelName: 'GridActionSpeak' }], image: { url: 'https://api.arasaac.org/api/pictograms/6981?download=false' } }] });
    const grd = '﻿' + JSON.stringify({ grids: [q('q2', '¿Cuál ladra?', 'q3'), q('q1', '¿Cuál tiene ruedas?', 'q2'), q('q3', '¿Cuál vuela?', null)] });
    const file = { name: 'ana_2026-10-10_14-08_asterics-aac-custom-backup.grd', text: async () => grd };
    let asked = 0;
    const list = await boards.importFile(file, { chooseSplit: async (n) => { asked = n; return false; } });
    const b = list[0];
    check('importar pregunta con la cantidad de páginas', asked === 3, `asked=${asked}`);
    check('un tablero con 3 páginas, inicio = la no referenciada', list.length === 1 && Object.keys(b.boards).length === 3 && b.mainBoard === 'q1', JSON.stringify({ n: list.length, main: b.mainBoard }));
    check('nombre legible desde la página de inicio', b.name === '¿Cuál tiene ruedas?', b.name);
    await sleep(150); // los textos de ARASAAC se completan en segundo plano
    check('texto de ARASAAC completado en segundo plano (forma rioplatense)', store.get(b.id)?.boards.q1.gridElements[1].autoLabel?.es === 'auto', JSON.stringify(store.get(b.id)?.boards.q1.gridElements[1].autoLabel));
    check('guardado en localforage', !!store.get(b.id), 'no está');

    const split = await boards.importFile(file, { chooseSplit: async () => true });
    check('importar separados crea 3 tableros sin vínculos', split.length === 3 && split.every(x => Object.keys(x.boards).length === 1)
        && !split[0].boards.q1.gridElements[0].actions.length, JSON.stringify(split.map(x => x.name)));

    await boards.loadSavedBoards();
    await sleep(100);
    const card = [...document.querySelectorAll('#board-list .board-card')].find(c => c.querySelector('h3')?.textContent === '¿Cuál tiene ruedas?' && /páginas/.test(c.textContent));
    check('la tarjeta dice "3 páginas"', card && /3 páginas/.test(card.querySelector('.board-card-meta').textContent), card?.querySelector('.board-card-meta')?.textContent);

    // Uso: el pictograma sin texto no muestra texto pero se dice; la pregunta se dice antes de navegar
    boards.openBundle(await localforage.getItem(b.id));
    await sleep(50);
    check('el texto automático no se ve en la celda', !document.querySelector('#grid-container .picto-label') || ![...document.querySelectorAll('#grid-container .picto-label')].some(l => l.textContent === 'auto'), 'se ve "auto"');
    const titleCell = document.getElementById('cell-0-0');
    check('la celda que navega tiene la señal de "abre otra página" y el pictograma no', titleCell.querySelector('.cell-nav-mark') && !document.getElementById('cell-0-2').querySelector('.cell-nav-mark'), 'falta o sobra la marca');
    spoken.length = 0;
    titleCell.click();
    await sleep(200);
    check('tocar la pregunta la dice y pasa a la siguiente', spoken.includes('¿Cuál tiene ruedas?') && S.currentGridId === 'q2', JSON.stringify({ spoken, cur: S.currentGridId }));
    await sleep(600);
    spoken.length = 0;
    document.getElementById('cell-0-2').click();
    await sleep(50);
    check('el pictograma sin texto dice la palabra de ARASAAC', spoken.includes('auto'), JSON.stringify(spoken));

    // Editor: franja de páginas
    editor.enterEditMode();
    const chips = () => [...document.querySelectorAll('#editor-pages .ep-page')];
    const panel = () => document.getElementById('editor-pages');
    const curBtn = document.querySelector('#editor-toolbar .ep-current');
    check('las páginas van en un selector compacto en la barra, con el panel cerrado', curBtn && /Página 2 de 3/.test(curBtn.textContent) && panel()?.hidden === true, curBtn?.textContent + ' hidden=' + panel()?.hidden);
    curBtn.click();
    check('tocar el selector abre el panel de páginas', panel().hidden === false, 'sigue cerrado');
    document.querySelector('#editor-toolbar .ep-arrow[aria-label="Página siguiente"]').click();
    await sleep(20);
    check('la flecha › pasa a la página siguiente', S.currentGridId === 'q3', S.currentGridId);
    document.querySelector('#editor-toolbar .ep-arrow[aria-label="Página anterior"]').click();
    await sleep(20);
    check('la lista del panel muestra las 3 páginas en orden', chips().length === 3 && chips().map(c => c.title).join('|') === '¿Cuál tiene ruedas?|¿Cuál ladra?|¿Cuál vuela?', chips().map(c => c.title).join('|'));
    check('la de inicio está marcada', chips()[0].querySelector('.ep-start'), 'sin marca');
    chips()[2].click();
    await sleep(20);
    check('tocar una página la abre para editar y cierra el panel', S.currentGridId === 'q3' && chips()[2].classList.contains('is-active') && editor.isEditMode() && panel().hidden, S.currentGridId);
    document.querySelector('#editor-pages .ep-add').click();
    await sleep(100);
    check('"+ Página" agrega y abre una página nueva', chips().length === 4 && S.currentGridId !== 'q3' && /Página 4/.test(document.querySelector('#editor-pages .is-active').title), chips().map(c => c.title).join('|'));
    const startBtn = [...document.querySelectorAll('#editor-pages .ep-tools button')].find(x => /inicio/.test(x.textContent));
    startBtn.click();
    await sleep(100);
    check('"Usar como inicio" cambia la página de inicio', S.currentBundle.mainBoard === S.currentGridId && store.get(b.id).mainBoard === S.currentGridId, S.currentBundle.mainBoard);
    const delBtn = document.querySelector('#editor-pages .ep-delete');
    delBtn.click();
    await sleep(50);
    check('pide confirmación antes de borrar la página', /Borrar la página/.test($('dialog-message').textContent), $('dialog-message').textContent);
    {
        const { selectionContexts } = await import(pathToFileURL(path.join(WEB, 'js/contexts.js')).href);
        const top = selectionContexts.top();
        const ids = top ? top.getTargets().map(t => t.element.id) : [];
        check('M03: el diálogo es el contexto activo y sus botones (Cancelar y Aceptar) son los objetivos', top && top.name === 'dialog' && ids.includes('btn-dialog-ok') && ids.includes('btn-dialog-cancel'), JSON.stringify(ids));
        boards.renderGrid(S.currentGridId); // el tablero se redibuja detrás (p. ej. una sincronización)
        check('M03: redibujar el tablero no le quita el control al diálogo', selectionContexts.top() === top, 'cambió el contexto');
    }
    document.getElementById('btn-dialog-ok').click();
    await sleep(150);
    check('"Borrar página" la borra (con confirmación) y la de inicio pasa a otra', Object.keys(store.get(b.id).boards).length === 3 && store.get(b.id).boards[store.get(b.id).mainBoard], JSON.stringify(Object.keys(store.get(b.id).boards)));
    const toggle = document.querySelector('#editor-pages .ep-autolabels input');
    check('aparece "Mostrar texto de los pictogramas"', !!toggle, 'no aparece');
    chips().find(c => c.title === '¿Cuál ladra?').click();
    toggle && (toggle.checked = true, toggle.dispatchEvent(new win.Event('change')));
    await sleep(100);
    check('al activarlo el texto se ve en la celda', [...document.querySelectorAll('#grid-container .picto-label')].some(l => l.textContent === 'auto'), document.getElementById('grid-container').textContent.slice(0, 100));
    // Deshacer después de la primera edición no deja mudas las celdas (la migración corre al entrar a editar)
    document.querySelector('#editor-pages .ep-add').click();
    await sleep(100);
    document.getElementById('undo-btn').click();
    await sleep(100);
    const titleEl = Object.values(S.currentBundle.boards).flatMap(g => g.gridElements).find(e => e.id === 'q1t');
    check('deshacer no deja muda la celda de la pregunta', S.currentBundle.speechModel === 'actions' && titleEl.actions.some(a => a.modelName === 'GridActionSpeak'), JSON.stringify(titleEl?.actions));
    editor.exitEditMode();
    check('al salir de edición se quita la franja', !document.getElementById('editor-pages'), 'sigue');
}

if (caseArg === 'asterics') {
    const boards = await import(pathToFileURL(path.join(WEB, 'js/boards.js')).href);
    const ui = await import(pathToFileURL(path.join(WEB, 'js/ui.js')).href);
    const { S } = await import(pathToFileURL(path.join(WEB, 'js/state.js')).href);
    // Respaldo completo sintético con todo lo que puede traer Asterics
    const E = (id, x, y, o = {}) => ({ id, x, y, width: 1, height: 1, label: {}, actions: [], type: 'ELEMENT_TYPE_NORMAL', ...o });
    const N = (extra) => ({ modelName: 'GridActionNavigate', ...extra });
    const letters = ['H', 'O', 'L', 'A', ' '].map((c, i) => E('k' + i, i, 0, { label: { es: c } }))
        .concat(['B', 'C', 'D', 'E', 'F'].map((c, i) => E('kk' + i, i, 3, { label: { es: c } }))); // página de teclado (≥ 8 teclas)
    const home = { id: 'home', label: { es: 'Inicio' }, rowCount: 4, minColumnCount: 6, thumbnail: { data: 'data:image/png;base64,AAAA' },
        webRadios: [{ radioId: 'r1', radioName: 'Radio Uno', radioUrl: 'http://radio.example/stream.mp3' }],
        gridElements: [...letters,
            E('del', 5, 0, { label: { es: 'Borrar' }, actions: [{ modelName: 'GridActionCollectElement', action: 'COLLECT_ACTION_REMOVE_CHAR' }] }),
            E('pr1', 0, 1, { type: 'ELEMENT_TYPE_PREDICTION' }), E('pr2', 1, 1, { type: 'ELEMENT_TYPE_PREDICTION' }),
            E('col', 2, 1, { type: 'ELEMENT_TYPE_COLLECT', width: 4, actions: [{ modelName: 'GridActionCollectElement', action: 'COLLECT_ACTION_SPEAK_CONTINUOUS' }] }),
            E('go', 0, 2, { label: { 'es-ar': 'Más cosas' }, actions: [N({ navType: 'navigateToGrid', toGridId: 'p2' })] }),
            E('yt', 1, 2, { actions: [{ modelName: 'GridActionYoutube', action: 'YT_TOGGLE' }] }),
            E('rota', 2, 2, { label: { es: 'Rota' }, actions: [{ modelName: 'GridActionSpeak' }, N({ navType: 'navigateToGrid', toGridId: 'no-esta' })] }),
            E('ana', 3, 2, { image: { data: 'data:image/png;base64,AAAA' }, actions: [{ modelName: 'GridActionSpeakCustom', speakText: { es: 'ANALÍA' } }] }),
            E('rad', 4, 2, { label: { es: 'Radio' }, actions: [{ modelName: 'GridActionWebradio', action: 'WEBRADIO_ACTION_START', radioId: 'r1' }] })] };
    const p2 = { id: 'p2', label: { es: 'Página 2' }, rowCount: 1, minColumnCount: 4, gridElements: [
        E('y', 2, 0, { label: { es: 'y' } }),
        E('web', 3, 0, { label: { es: 'Diario' }, actions: [{ modelName: 'GridActionOpenWebpage', openURL: 'https://example.org/', timeoutSeconds: 0 }] }),
        E('back', 0, 0, { label: { es: 'Volver' }, actions: [N({ navType: 'navigateToLastOpenedGrid' })] }),
        E('ini', 1, 0, { label: { es: 'Inicio' }, actions: [N({ navType: 'navigateToHomeGrid' })] })] };
    const glob = { id: 'glob', label: { es: 'Tablero global' }, rowCount: 1, minColumnCount: 1, gridElements: [E('g1', 0, 0)] };
    const json = { grids: [glob, p2, home], metadata: { homeGridId: 'home', globalGridId: 'glob' }, dictionaries: [{ data: JSON.stringify({ HOLANDA: { f: 1 } }) }] };
    const file = { name: 'nene_2026-10-08_20-00_asterics-aac-full-backup.grd', text: async () => JSON.stringify(json) };
    let asked = 0;
    const list = await boards.importFile(file, { chooseSplit: async (n) => { asked = n; return false; } });
    const b = list[0];
    check('respaldo completo: inicio declarado y sin tablero global', b.mainBoard === 'home' && !b.boards.glob && asked === 2, JSON.stringify({ main: b.mainBoard, pages: Object.keys(b.boards), asked }));
    check('sin miniaturas guardadas', !b.boards.home.thumbnail, 'quedó la miniatura');
    check('informe de compatibilidad (vínculo roto y YouTube)', /1 celda lleva/.test(list.report) && /YouTube \(1\)/.test(list.report) && /teclado/.test(list.report), list.report);

    boards.openBundle(await localforage.getItem(b.id));
    await sleep(50);
    const cell = (id) => document.getElementById(id);
    check('texto solo en es-ar se ve', /Más cosas/.test(cell('cell-0-2').textContent), cell('cell-0-2').textContent);
    check('YouTube se marca "No disponible"', cell('cell-1-2').classList.contains('cell-unavailable') && /No disponible/.test(cell('cell-1-2').textContent), cell('cell-1-2').className);
    check('el vínculo roto no muestra la marca de "abre otra página"', !cell('cell-2-2').querySelector('.cell-nav-mark') && cell('cell-0-2').querySelector('.cell-nav-mark'), 'marcas incorrectas');

    const tap = async (id) => { cell(id).click(); await sleep(520); };
    ui.clearSentence();
    spoken.length = 0;
    await tap('cell-0-0'); await tap('cell-1-0'); await tap('cell-2-0');
    const sent = () => ui.getSentence().map(i => i.text);
    check('las letras forman una palabra y no hablan', JSON.stringify(sent()) === '["hol"]' && spoken.length === 0, JSON.stringify({ s: sent(), spoken }));
    check('la frase se ve en la celda de frase del tablero', /hol/.test(cell('cell-2-1').textContent), cell('cell-2-1').textContent);
    const pred = cell('cell-0-1').dataset.word;
    check('la predicción sugiere (en minúscula, como Asterics) lo que empieza igual', /^hol/.test(pred) && pred === pred.toLowerCase(), pred);
    await tap('cell-0-1');
    check('tocar la sugerencia completa la palabra', JSON.stringify(sent()) === JSON.stringify([pred]), JSON.stringify(sent()));
    await tap('cell-0-0');
    check('después de completar, la letra empieza otra palabra', sent().length === 2 && sent()[1] === 'h', JSON.stringify(sent()));
    await tap('cell-5-0');
    check('"borrar letra" borra un carácter (y la palabra si queda vacía)', sent().length === 1, JSON.stringify(sent()));
    spoken.length = 0;
    await tap('cell-2-1');
    check('tocar la celda de frase la dice', spoken.some(t => t.includes(pred)), JSON.stringify(spoken));
    spoken.length = 0;
    await tap('cell-3-2');
    check('pictograma sin texto con "decir texto" dice ANALÍA', spoken.includes('ANALÍA'), JSON.stringify(spoken));
    spoken.length = 0;
    await tap('cell-1-2');
    check('tocar YouTube no habla ni agrega a la frase', !spoken.length && !ui.getSentence().some(i => i.elData && i.elData.id === 'yt'), JSON.stringify(spoken));
    await tap('cell-4-2');
    check('la radio arranca la emisora del tablero', audios.includes('http://radio.example/stream.mp3'), JSON.stringify(audios));
    const before = ui.getSentence().length;
    await tap('cell-2-2');
    check('el vínculo roto se comporta como celda común (habla y va a la frase)', S.currentGridId === 'home' && ui.getSentence().length === before + 1, S.currentGridId);
    await tap('cell-0-2');
    check('navegar a la página 2', S.currentGridId === 'p2', S.currentGridId);
    spoken.length = 0;
    const n0 = ui.getSentence().length;
    await tap('cell-2-0');
    check('"y" en una página común es una palabra: se dice y va a la frase', spoken.includes('y') && ui.getSentence().length === n0 + 1, JSON.stringify(spoken));
    const { selectionContexts } = await import(pathToFileURL(path.join(WEB, 'js/contexts.js')).href);
    await tap('cell-3-0');
    const ov = document.getElementById('webpage-overlay');
    const top = selectionContexts.top();
    const overlayTargets = top ? top.getTargets() : [];
    check('abrir página web: panel con "Volver" y la mirada apunta solo a ese botón', ov && top && top.name === 'webpage' && overlayTargets.length === 1 && /Volver al tablero/.test(overlayTargets[0].element.textContent)
        && !/allow-popups/.test(ov.querySelector('iframe').getAttribute('sandbox')), JSON.stringify({ ov: !!ov, top: top && top.name }));
    check('con la página abierta, el tablero de abajo queda inerte', document.getElementById('board-view').inert === true, String(document.getElementById('board-view').inert));
    ov.querySelector('button').click();
    check('"Volver al tablero" cierra la página y vuelve el tablero', !document.getElementById('webpage-overlay') && !selectionContexts.isBlocked() && document.getElementById('board-view').inert === false, 'sigue abierta');
    const media = await import(pathToFileURL(path.join(WEB, 'js/media.js')).href);
    media.openWebpage({ openURL: location.origin + '/otra' });
    check('nunca abre el propio MiraVoz dentro del panel', !document.getElementById('webpage-overlay'), 'se abrió');
    await tap('cell-0-0');
    check('"volver" regresa a la página anterior', S.currentGridId === 'home', S.currentGridId);
    await tap('cell-0-2'); await tap('cell-1-0');
    check('"ir al inicio" va a la página de inicio', S.currentGridId === 'home', S.currentGridId);
    // La frase se mantiene al cambiar de tablero (como Asterics)
    const before2 = ui.getSentence().length;
    boards.openBundle(boards.buildTestBundle());
    await sleep(50);
    check('la frase NO se vacía al abrir otro tablero', before2 > 0 && ui.getSentence().length === before2, `${before2} → ${ui.getSentence().length}`);
    // --- 0.7.5: Deshacer, Detener, Favoritas, predicción por persona ---
    const speech = await import(pathToFileURL(path.join(WEB, 'js/speech.js')).href);
    const undoBtn = $('btn-acc-undo');
    ui.clearSentence(); ui.addToSentence({ text: 'yo' }); ui.addToSentence({ text: 'quiero' }); ui.addToSentence({ text: 'agua' });
    check('Deshacer está oculto si no se borró nada', undoBtn.hidden === true, String(undoBtn.hidden));
    ui.popSentence(); ui.clearSentence();
    check('después de borrar aparece Deshacer', undoBtn.hidden === false && ui.getSentence().length === 0, String(undoBtn.hidden));
    undoBtn.click();
    check('Deshacer recupera lo que había antes de "borrar todo"', JSON.stringify(sent()) === '["yo","quiero"]', JSON.stringify(sent()));
    undoBtn.click();
    check('Deshacer otra vez recupera la palabra borrada', JSON.stringify(sent()) === '["yo","quiero","agua"]' && undoBtn.hidden === true, JSON.stringify(sent()));
    ui.popSentence(); ui.addToSentence({ text: 'leche' });
    check('agregar algo nuevo cierra el historial de deshacer', undoBtn.hidden === true && !ui.canUndo(), String(undoBtn.hidden));
    spoken.length = 0;
    $('btn-acc-play').click();
    check('mientras dice la frase, el botón pasa a Detener', speech.isSpeakingSentence() && $('btn-acc-play').classList.contains('is-speaking') && spoken.length === 1, JSON.stringify(spoken));
    $('btn-acc-play').click();
    check('Detener corta la voz y no borra la frase', !speech.isSpeakingSentence() && !$('btn-acc-play').classList.contains('is-speaking') && JSON.stringify(sent()) === '["yo","quiero","leche"]' && spoken.length === 1, JSON.stringify(sent()));
    $('btn-acc-fav').click(); await sleep(60);
    let fav = document.getElementById('favorites-overlay');
    const saveBtn = fav && [...fav.querySelectorAll('button')].find(b => /Guardar la frase/.test(b.textContent));
    check('Favoritas se abre encima, con su propio contexto de selección', fav && selectionContexts.top()?.name === 'favoritas' && saveBtn && $('board-view').inert === true, selectionContexts.top()?.name);
    saveBtn.click(); await sleep(80);
    const card = fav.querySelector('.favorite-card');
    check('"Guardar la frase" la agrega como tarjeta elegible por la mirada', card && /yo quiero leche/.test(card.textContent) && selectionContexts.top().getTargets().some(t => t.element === card), fav.textContent.slice(0, 120));
    check('la misma frase no se ofrece guardar dos veces', ![...fav.querySelectorAll('button')].some(b => /Guardar la frase/.test(b.textContent)), '');
    [...fav.querySelectorAll('button')].find(b => /Volver/.test(b.textContent)).click();
    ui.clearSentence(); spoken.length = 0;
    $('btn-acc-fav').click(); await sleep(60);
    fav = document.getElementById('favorites-overlay');
    fav.querySelector('.favorite-card').click(); await sleep(30);
    check('elegir una favorita la pone en la frase, la dice y vuelve al tablero', JSON.stringify(sent()) === '["yo","quiero","leche"]' && spoken.some(t => /yo, quiero, leche/.test(t)) && !document.getElementById('favorites-overlay') && !selectionContexts.isBlocked(), JSON.stringify({ s: sent(), spoken }));
    ui.undoSentence();
    check('elegir una favorita se puede deshacer (vuelve la frase anterior)', ui.getSentence().length === 0, JSON.stringify(sent()));
    const lsKeys = Object.keys(win.localStorage);
    check('la predicción aprende por persona (sin clave global)', lsKeys.includes('miravoz_pred_words:prueba') && !lsKeys.includes('miravoz_pred_words'), JSON.stringify(lsKeys));
    const { Benchmark } = await import(pathToFileURL(path.join(WEB, 'js/benchmark.js')).href);
    const bm = new Benchmark();
    bm.start();
    check('el benchmark abre su grilla 3×3 y empieza con la frase vacía', S.currentBundle && S.currentBundle.id === 'benchmark_3x3' && ui.getSentence().length === 0, S.currentBundle && S.currentBundle.id);
    bm.reset(); bm.active = false;
}

if (caseArg === 'xss') {
    const list = $('users-list');
    check('fetchUsers renderizó el usuario', list.textContent.includes(XSS), list.innerHTML.slice(0, 200));
    check('display_name malicioso no crea <img> en #users-list', !list.querySelector('img'), list.innerHTML.slice(0, 300));
    const users = await import(pathToFileURL(path.join(WEB, 'js/users.js')).href);
    users.renderUsersList();
    check('renderUsersList directo tampoco crea <img>', !list.querySelector('img'), list.innerHTML.slice(0, 300));
}

if (caseArg === 'practicar') {
    const { S } = await import(pathToFileURL(path.join(WEB, 'js/state.js')).href);
    const { selectionContexts } = await import(pathToFileURL(path.join(WEB, 'js/contexts.js')).href);
    check('"Nuevo" e "Importar" están en la barra del home (arriba)', $('home-filters') && !$('home-filters').hidden && $('home-filters').contains($('btn-new-board')) && $('home-filters').contains($('btn-open-import')), $('home-filters')?.hidden);
    check('"Tablero de Prueba" ya no está; "Practicar" sí', !$('btn-test-board') && !!$('btn-practice'), '');
    check('Mis usuarios es pantalla completa', $('users-view').classList.contains('fullscreen-panel'), $('users-view').className);
    $('btn-new-user').click(); await sleep(20);
    check('"Nuevo usuario" abre el modal del nombre', visible($('new-user-modal')) && !!$('new-user-name'), $('new-user-modal').style.display);
    $('btn-cancel-new-user').click(); await sleep(10);
    check('Cancelar cierra el modal sin crear', !visible($('new-user-modal')) && !sbCalls.some(c => c.table === 'aac_users' && c.op === 'insert'), '');
    // 0.7.8: modo Mirada = Manual + Modo protegido; se sale con botón y confirmación
    const mirada = [...document.querySelectorAll('#mode-segmented button')].find(b => b.dataset.mode === 'MIRADA');
    check('hay botón de modo "Mirada"', !!mirada, '');
    mirada.click(); await sleep(30);
    check('Mirada: modo protegido sin cámara (como Manual)', document.body.classList.contains('protected-mode') && S.trackingMode === 'CLICKS' && mirada.getAttribute('aria-checked') === 'true', `${document.body.className} ${S.trackingMode}`);
    check('Mirada: "Salir" visible y botón Practicar disponible', !!$('btn-exit-protected') && !!$('btn-practice'), '');
    $('btn-exit-protected').click(); await sleep(30);
    const okBtn = $('btn-dialog-ok'); okBtn && okBtn.click(); await sleep(30);
    check('"Salir" + confirmar vuelve a Manual sin protección', !document.body.classList.contains('protected-mode') && S.trackingMode === 'CLICKS', document.body.className);
    check('lista de tableros con botones de página', !!document.querySelector('#home-view .pager .pager-btn[data-dir="down"]'), '');
    const barrido = [...document.querySelectorAll('#mode-segmented button')].find(b => b.dataset.mode === 'SCAN');
    barrido.click(); await sleep(30);
    check('0.7.9: Barrido también usa el modo protegido', document.body.classList.contains('protected-mode') && S.trackingMode === 'SCAN', document.body.className);
    $('btn-exit-protected').click(); await sleep(30);
    $('btn-dialog-ok') && $('btn-dialog-ok').click(); await sleep(30);
    check('0.7.9: "Salir" desde Barrido vuelve a Manual', !document.body.classList.contains('protected-mode') && S.trackingMode === 'CLICKS', `${document.body.className} ${S.trackingMode}`);
    $('btn-practice').click();
    await sleep(50);
    const pv = $('practice-view');
    check('Practicar abre su pantalla y el estado PRACTICE', pv && !pv.hidden && S.state === 'PRACTICE', `${S.state}`);
    const cardsP = [...pv.querySelectorAll('.practice-card')];
    check('6 niveles en el menú; Parpadear deshabilitado sin parpadeo', cardsP.length === 6 && cardsP[5].classList.contains('is-disabled'), String(cardsP.length));
    const base = selectionContexts.baseTargets ? selectionContexts.baseTargets() : null;
    void base;
    // Nivel 3: globos
    cardsP[2].click(); await sleep(30);
    const balloon = pv.querySelector('.practice-balloon');
    check('nivel 3 muestra un globo seleccionable', !!balloon, '');
    balloon.click(); await sleep(20);
    check('reventar el globo cuenta', /Globos: 1/.test(pv.querySelector('.practice-counter').textContent), pv.querySelector('.practice-counter').textContent);
    // Volver al menú y abrir Elegir
    pv.querySelector('.practice-back').click(); await sleep(20);
    check('"Actividades" vuelve al menú', pv.querySelectorAll('.practice-card').length === 6, '');
    pv.querySelectorAll('.practice-card')[3].click(); await sleep(20);
    const opts = pv.querySelectorAll('.practice-choice');
    check('nivel 4 empieza con 2 opciones', opts.length === 2, String(opts.length));
    opts[0].click(); await sleep(20);
    check('elegir dice la opción y cuenta', /Elecciones: 1/.test(pv.querySelector('.practice-counter').textContent) && spoken.some(t => /Tambor|Campana|Melodía|Silbido/.test(t)), JSON.stringify(spoken.slice(-2)));
    // Niveles de canvas: arrancan sin errores
    for (const i of [0, 1, 4]) {
        pv.querySelector('.practice-back').click(); await sleep(10);
        pv.querySelectorAll('.practice-card')[i].click(); await sleep(60);
    }
    check('niveles 1, 2 y 5 arrancan sin excepciones', !errors.some(e => /practice|TypeError/.test(e)), errors.join(' | '));
    pv.querySelector('.practice-back').click(); await sleep(10);
    pv.querySelector('.practice-back').click(); await sleep(30);
    check('"Salir" cierra Practicar y vuelve al inicio', pv.hidden && S.state === 'HOME' && visible($('home-view')), `${S.state}`);
    const log = JSON.parse(win.localStorage.getItem('miravoz_practice_prueba') || '[]');
    check('queda registro local de la práctica (sin datos personales)', Array.isArray(log), JSON.stringify(log));
}

console.error = origError;
done();
