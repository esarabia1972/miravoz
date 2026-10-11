// Tests del uso sin conexión (M05): Service Worker REAL (web/sw.js) en una simulación de navegador con
// CacheStorage, fetch y red que se puede cortar. Escenarios T18 y T19. Correr: node tools/test-offline.mjs
// Nota: esto prueba la LÓGICA del Service Worker; el comportamiento en Safari/iPad (cuotas, desalojo, pestaña
// vs pantalla de inicio) se verifica en el dispositivo.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../web');
const ORIGIN = 'https://miravoz.test';
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

// --- CacheStorage en memoria ---
class FakeCache {
    constructor() { this.map = new Map(); }
    async put(req, resp) { const url = typeof req === 'string' ? req : req.url; this.map.set(new URL(url, ORIGIN).href, { body: Buffer.from(await resp.arrayBuffer()), status: resp.status, type: resp.headers.get('Content-Type') }); }
    async match(req, opts = {}) {
        const href = new URL(typeof req === 'string' ? req : req.url, ORIGIN);
        for (const [k, v] of this.map) {
            const u = new URL(k);
            if (u.origin + u.pathname === href.origin + href.pathname && (opts.ignoreSearch || u.search === href.search)) return new Response(v.body, { status: v.status, headers: v.type ? { 'Content-Type': v.type } : {} });
        }
        return undefined;
    }
}
function makeCaches() {
    const store = new Map();
    return {
        store,
        async open(n) { if (!store.has(n)) store.set(n, new FakeCache()); return store.get(n); },
        async keys() { return [...store.keys()]; },
        async has(n) { return store.has(n); },
        async delete(n) { return store.delete(n); }
    };
}

// --- Servidor simulado (lo publicado) y red ---
function makeNet(manifest) {
    const files = new Map();
    for (const f of manifest.files) files.set(f.url, fs.readFileSync(path.join(WEB, f.url.slice(1))));
    files.set('/offline-manifest.json', Buffer.from(JSON.stringify(manifest)));
    files.set('/sw.js', fs.readFileSync(path.join(WEB, 'sw.js')));
    const remote = new Map(manifest.remote.map(r => [r.url, Buffer.from('modelo-de-prueba')]));
    const net = { online: true, files, remote, requests: [] };
    net.fetch = async (input) => {
        const url = new URL(typeof input === 'string' ? input : input.url, ORIGIN);
        net.requests.push(url.href);
        if (!net.online) throw new TypeError('Failed to fetch (sin conexión)');
        const body = url.origin === ORIGIN ? (files.get(url.pathname === '/' ? '/index.html' : url.pathname)) : remote.get(url.href) || (url.hostname === 'api.arasaac.org' ? Buffer.from('png') : null);
        if (!body) return new Response('no', { status: 404 });
        return new Response(body, { status: 200 });
    };
    return net;
}

// --- Un Service Worker (instancia de sw.js?v=...) ---
function loadSW(version, caches, net) {
    const listeners = {};
    const self = {
        location: new URL(`${ORIGIN}/sw.js?v=${version}`),
        addEventListener: (type, fn) => { listeners[type] = fn; },
        skipped: false,
        skipWaiting: async () => { self.skipped = true; },
        clients: { claim: async () => {} }
    };
    const ctx = vm.createContext({ self, caches, fetch: net.fetch, crypto: globalThis.crypto, Response, URL, console, TextEncoder });
    vm.runInContext(fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8'), ctx);
    const run = async (type, extra = {}) => {
        let p = null, resp = null;
        const ev = { ...extra, waitUntil: (x) => { p = x; }, respondWith: (x) => { resp = x; } };
        listeners[type](ev);
        if (p) await p;
        return resp ? await resp : null;
    };
    return {
        self,
        install: () => run('install'),
        activate: () => run('activate'),
        fetch: (url, mode = 'no-cors') => run('fetch', { request: { method: 'GET', url: new URL(url, ORIGIN).href, mode } }),
        message: (data) => new Promise(async (resolve) => {
            const port = { postMessage: (d) => resolve(d) };
            await run('message', { data, ports: [port] });
            setTimeout(() => resolve('sin respuesta'), 50);
        })
    };
}

const manifest = JSON.parse(fs.readFileSync(path.join(WEB, 'offline-manifest.json'), 'utf8'));

console.log('offline (M05)');
await t('el manifiesto está al día con los archivos de web/', () => {
    const r = spawnSync(process.execPath, [path.join(HERE, 'build-offline-manifest.mjs'), '--check'], { encoding: 'utf8' });
    assert(r.status === 0, (r.stderr || r.stdout).trim());
});
await t('el manifiesto incluye lo necesario para arrancar sin red (código, estilos, bibliotecas, MediaPipe y modelo)', () => {
    const urls = new Set(manifest.files.map(f => f.url));
    for (const u of ['/index.html', '/style.css', '/js/main.js', '/js/tracking.js', '/js/selection.js', '/manifest.webmanifest',
        '/vendor/localforage-1.10.0/localforage.min.js', '/vendor/supabase-js-2.117.3/supabase.js', '/vendor/jszip-3.10.1/jszip.min.js',
        '/vendor/inter-5.3.0/inter.css', '/vendor/mediapipe-tasks-vision-1.1.0/vision_bundle.mjs',
        '/vendor/mediapipe-tasks-vision-1.1.0/wasm/vision_wasm_internal.wasm']) assert(urls.has(u), 'falta ' + u);
    assert(manifest.remote.some(r => /face_landmarker\.task$/.test(r.url)), 'falta el modelo');
    assert(!urls.has('/sw.js') && !urls.has('/offline-manifest.json'), 'no debe precargarse a sí mismo');
    const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
    assert(!/https:\/\/(cdn|fonts|cdnjs)\./.test(html), 'index.html todavía depende de una CDN');
});
await t('T18 preparación completa → sin red abre la app, sus módulos, MediaPipe y los pictogramas guardados', async () => {
    const caches = makeCaches(), net = makeNet(manifest);
    const sw = loadSW(manifest.version, caches, net);
    await sw.install();
    assert(sw.self.skipped, 'primera instalación: debería activarse sola');
    await sw.activate();
    const st = await sw.message({ type: 'STATUS' });
    assert(st.ready === true && st.version === manifest.version, JSON.stringify(st).slice(0, 200));
    const img = await sw.message({ type: 'CACHE_IMAGES', urls: ['https://api.arasaac.org/api/pictograms/6981?download=false'] });
    assert(img.ok === 1 && img.failed === 0, JSON.stringify(img));
    net.online = false;
    const page = await sw.fetch('/', 'navigate');
    assert(page && page.status === 200 && /<html/i.test(await page.text()), 'no abrió la página sin red');
    const js = await sw.fetch('/js/main.js?v=55');
    assert(js && js.status === 200, 'main.js sin red');
    const wasm = await sw.fetch('/vendor/mediapipe-tasks-vision-1.1.0/wasm/vision_wasm_internal.wasm');
    assert(wasm && wasm.status === 200, 'WASM sin red');
    const model = await sw.fetch(manifest.remote[0].url, 'cors');
    assert(model && (await model.text()) === 'modelo-de-prueba', 'modelo sin red');
    const pic = await sw.fetch('https://api.arasaac.org/api/pictograms/6981?download=false');
    assert(pic && pic.status === 200, 'pictograma sin red');
});
await t('los pedidos privados (Supabase, autenticación) nunca se interceptan ni se guardan', async () => {
    const caches = makeCaches(), net = makeNet(manifest);
    const sw = loadSW(manifest.version, caches, net);
    await sw.install(); await sw.activate();
    const r = await sw.fetch('https://abcd.supabase.co/rest/v1/boards?select=*', 'cors');
    assert(r === null, 'interceptó Supabase');
    const r2 = await sw.fetch('https://abcd.supabase.co/auth/v1/token', 'cors');
    assert(r2 === null, 'interceptó auth');
    assert(await sw.fetch('/offline-manifest.json') === null, 'el manifiesto debe ir a la red (detección de versiones)');
});
await t('T19 descarga incompleta (sin red a mitad) → la instalación falla y no queda una versión a medias', async () => {
    const caches = makeCaches(), net = makeNet(manifest);
    net.files.delete('/js/boards.js'); // el servidor no lo tiene (404)
    const sw = loadSW(manifest.version, caches, net);
    let failed = false;
    try { await sw.install(); } catch { failed = true; }
    assert(failed, 'instaló con un archivo faltante');
    assert(!(await caches.has('miravoz-app-' + manifest.version)), 'quedó un caché parcial');
});
await t('T19 actualización con un archivo alterado (deploy a medio publicar) → se rechaza y la versión anterior sigue sirviendo', async () => {
    const caches = makeCaches(), net = makeNet(manifest);
    const v1 = loadSW(manifest.version, caches, net);
    await v1.install(); await v1.activate();
    // Se publica una "versión 2" cuyo main.js no coincide con su manifiesto
    const m2 = JSON.parse(JSON.stringify(manifest)); m2.version = 'v2-prueba';
    net.files.set('/offline-manifest.json', Buffer.from(JSON.stringify(m2)));
    net.files.set('/js/main.js', Buffer.from('// otro contenido'));
    const v2 = loadSW('v2-prueba', caches, net);
    let failed = false;
    try { await v2.install(); } catch { failed = true; }
    assert(failed, 'aceptó un archivo alterado');
    net.online = false;
    const js = await v1.fetch('/js/main.js');
    assert(js && (await js.text()) !== '// otro contenido', 'sirvió el archivo alterado');
});
await t('T19 actualización válida: espera a la app (sin mezclar versiones) y al activarse borra la anterior', async () => {
    const caches = makeCaches(), net = makeNet(manifest);
    const v1 = loadSW(manifest.version, caches, net);
    await v1.install(); await v1.activate();
    const m2 = JSON.parse(JSON.stringify(manifest)); m2.version = 'v2-buena';
    const newMain = Buffer.from('// main v2');
    const crypto = await import('node:crypto');
    m2.files.find(f => f.url === '/js/main.js').sha256 = crypto.createHash('sha256').update(newMain).digest('hex');
    net.files.set('/offline-manifest.json', Buffer.from(JSON.stringify(m2)));
    net.files.set('/js/main.js', newMain);
    const v2 = loadSW('v2-buena', caches, net);
    await v2.install();
    assert(!v2.self.skipped, 'una actualización no debe activarse sola (podría cortar una frase)');
    const during = await v1.fetch('/js/main.js');
    assert((await during.text()) !== '// main v2', 'mezcló la versión nueva antes de activarse');
    await v2.activate(); // la app mandó SKIP_WAITING en un momento seguro
    const after = await v2.fetch('/js/main.js');
    assert((await after.text()) === '// main v2', 'no sirve la nueva');
    assert(!(await caches.has('miravoz-app-' + manifest.version)), 'no borró la anterior');
});
await t('T19 el manifiesto cambió durante la instalación → falla (la próxima carga registra la versión nueva)', async () => {
    const caches = makeCaches(), net = makeNet(manifest);
    const sw = loadSW('otra-version', caches, net);
    let failed = false;
    try { await sw.install(); } catch { failed = true; }
    assert(failed, 'instaló un conjunto que no es el suyo');
});

console.log('offline.js (estado honesto)');
const off = await import('../web/js/offline.js');
await t('collectImageUrls: solo imágenes https externas, sin repetir; las embebidas no', () => {
    const urls = off.collectImageUrls([{ boards: { g: { gridElements: [
        { image: { url: 'https://api.arasaac.org/api/pictograms/1' } }, { image: { url: 'https://api.arasaac.org/api/pictograms/1' } },
        { image: { url: 'http://inseguro/x.png' } }, { image: { data: 'data:image/png;base64,AA', url: 'https://x/y.png' } }, { label: {} }] } } }]);
    assert(JSON.stringify(urls) === '["https://api.arasaac.org/api/pictograms/1"]', JSON.stringify(urls));
});
await t('statusText: nunca dice "preparado" con faltantes, imágenes fallidas o sin Service Worker', () => {
    assert(/Preparado para usar sin conexión/.test(off.statusText({ ready: true, version: 'x', imagesChecked: true, imagesFailed: 0 })), 'listo');
    assert(!/Preparado/.test(off.statusText({ ready: false, missing: ['/a'] })), 'faltantes');
    assert(/no se pudieron guardar/.test(off.statusText({ ready: true, version: 'x', imagesChecked: true, imagesFailed: 3 })), 'imágenes');
    assert(/poco espacio/.test(off.statusText({ ready: true, version: 'x', imagesChecked: true, imagesFailed: 0, lowSpace: true })), 'espacio');
    assert(/no permite/.test(off.statusText({ unsupported: true })), 'sin soporte');
    assert(/Tocá "Preparar"/.test(off.statusText({ ready: true, version: 'x', imagesChecked: false })), 'falta preparar imágenes');
});

console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
