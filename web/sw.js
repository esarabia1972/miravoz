// sw.js — Service Worker de MiraVoz: disponibilidad sin conexión (M05, 11/10/2026)
//
// Separado del Worker de visión (inferencia) y de la persistencia de tableros (localforage/IndexedDB):
// este archivo solo administra RECURSOS.
//  - Instalación: descarga el conjunto COMPLETO de offline-manifest.json (código, estilos, bibliotecas,
//    íconos, MediaPipe y su modelo) y verifica el sha256 de cada archivo. Si algo falla o no coincide, la
//    instalación falla y queda la versión anterior funcionando (nunca una mezcla de código nuevo con
//    WASM o modelo viejos).
//  - Activación: la decide la app (mensaje SKIP_WAITING) en un momento seguro: en el inicio, sin frase en
//    curso, sin calibración. Recién entonces se borran las versiones viejas.
//  - Respuestas: lo precargado sale del caché de la versión activa; los pictogramas de ARASAAC se guardan
//    en un caché de imágenes; autenticación, Supabase y cualquier pedido privado van SIEMPRE a la red
//    (no se guardan tokens ni datos de cuentas).

const APP_PREFIX = 'miravoz-app-';
// La app registra /sw.js?v=<versión del manifiesto>: cada versión es un Service Worker distinto (así el
// navegador detecta las actualizaciones aunque este archivo no cambie) y sabe exactamente qué conjunto instalar.
const MY_VERSION = new URL(self.location.href).searchParams.get('v');
const IMAGES_CACHE = 'miravoz-images-v1';
const MAX_IMAGES = 3000;
const META_CACHE = 'miravoz-meta';
// La versión ACTIVA se guarda aparte: mientras una actualización espera, se sigue sirviendo la versión activa
// completa (nunca archivos de la nueva mezclados con la vieja).
async function setActiveVersion(v) { const c = await caches.open(META_CACHE); await c.put('/__active-version', new Response(v)); }
async function getActiveVersion() { const c = await caches.open(META_CACHE); const r = await c.match('/__active-version'); return r ? r.text() : null; }

let manifestPromise = null;
function loadManifest(fresh = false) {
    if (!manifestPromise || fresh) {
        manifestPromise = fetch('/offline-manifest.json', { cache: 'no-store' }).then(r => {
            if (!r.ok) throw new Error('Sin manifiesto (' + r.status + ')');
            return r.json();
        });
    }
    return manifestPromise;
}

async function sha256Hex(buf) {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Descarga y verifica todo; recién al final escribe el caché de la versión (todo o nada). */
async function precache(manifest) {
    const entries = [
        ...manifest.files.map(f => ({ url: f.url === '/index.html' ? '/index.html' : f.url, sha256: f.sha256, local: true })),
        ...manifest.remote.map(r => ({ url: r.url, sha256: r.sha256, local: false }))
    ];
    // Lo que no cambió (mismo sha256 que en la versión activa) se copia del caché anterior: una actualización
    // no vuelve a descargar los ~30 MB de MediaPipe en cada deploy.
    const prevCache = await activeCache();
    const prevStored = prevCache && await prevCache.match('/offline-manifest.json');
    const prev = prevStored ? await prevStored.json() : null;
    const prevHash = new Map(prev ? [...prev.files, ...prev.remote].map(x => [x.url, x.sha256]) : []);
    const fetched = [];
    for (const e of entries) {
        if (prevCache && e.sha256 && prevHash.get(e.url) === e.sha256) {
            const old = await prevCache.match(e.url);
            if (old) { fetched.push([e.url, old]); continue; }
        }
        const resp = await fetch(e.url, { cache: 'no-store', mode: e.local ? 'same-origin' : 'cors', credentials: 'omit' });
        if (!resp.ok) throw new Error(`No se pudo descargar ${e.url} (${resp.status})`);
        const buf = await resp.arrayBuffer();
        if (e.sha256) {
            const h = await sha256Hex(buf);
            if (h !== e.sha256) throw new Error(`Contenido inesperado en ${e.url}: deploy a medio publicar o archivo alterado`);
        }
        const type = resp.headers.get('Content-Type');
        fetched.push([e.url, new Response(buf, { status: 200, headers: type ? { 'Content-Type': type } : {} })]); // una sola copia en memoria
    }
    const cache = await caches.open(APP_PREFIX + manifest.version);
    for (const [url, resp] of fetched) await cache.put(url, resp);
    await cache.put('/offline-manifest.json', new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } }));
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const manifest = await loadManifest(true);
        // Si mientras tanto se publicó otra versión, esta instalación no sirve: falla y la próxima carga registra la nueva
        if (MY_VERSION && manifest.version !== MY_VERSION) throw new Error('El manifiesto cambió durante la instalación');
        await precache(manifest); // si falla, la instalación falla y sigue la versión anterior
        const hadPrevious = (await caches.keys()).some(k => k.startsWith(APP_PREFIX) && k !== APP_PREFIX + manifest.version);
        // Primera instalación: no hay nada que reemplazar, se activa sola. Actualizaciones: espera a la app.
        if (!hadPrevious) await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const version = MY_VERSION || (await loadManifest()).version;
        const keep = APP_PREFIX + version;
        if (!(await caches.has(keep))) return; // no debería pasar: la instalación garantiza el caché completo
        await setActiveVersion(version);
        for (const k of await caches.keys()) if (k.startsWith(APP_PREFIX) && k !== keep) await caches.delete(k);
        await self.clients.claim();
    })());
});

async function activeCache() {
    const v = await getActiveVersion();
    if (v && await caches.has(APP_PREFIX + v)) return caches.open(APP_PREFIX + v);
    return null;
}

const isArasaacImage = (url) => url.hostname === 'api.arasaac.org' && /^\/api\/pictograms\/\d+/.test(url.pathname);
const isPrivate = (url) => /supabase\.co$/.test(url.hostname) || url.pathname.startsWith('/auth') || url.pathname.startsWith('/rest/');

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    // Imágenes guardadas con "Preparar para usar sin conexión" (de cualquier origen): primero el caché de imágenes
    if (req.destination === 'image' && url.origin !== self.location.origin) {
        event.respondWith((async () => {
            const hit = await (await caches.open(IMAGES_CACHE)).match(req.url);
            if (hit) return hit;
            const resp = await fetch(req);
            if (isArasaacImage(url) && (resp.ok || resp.type === 'opaque')) (await caches.open(IMAGES_CACHE)).put(req.url, resp.clone()).catch(() => {});
            return resp;
        })());
        return;
    }
    if (isPrivate(url)) return; // cuentas, tokens y datos: siempre la red, nunca el caché

    if (url.origin === self.location.origin) {
        // El manifiesto y el propio Service Worker siempre de la red: así se detectan las versiones nuevas
        if (url.pathname === '/offline-manifest.json' || url.pathname === '/sw.js') return;
        event.respondWith((async () => {
            const cache = await activeCache();
            if (cache) {
                if (req.mode === 'navigate' && url.pathname !== '/' && url.pathname !== '/index.html') {
                    // Páginas propias (privacidad, términos): la suya, con o sin ".html"
                    const page = (await cache.match(url.pathname, { ignoreSearch: true })) || (await cache.match(url.pathname + '.html', { ignoreSearch: true }));
                    if (page) return page;
                }
                const key = req.mode === 'navigate' ? (url.pathname === '/' ? '/index.html' : url.pathname) : url.pathname;
                const hit = await cache.match(key, { ignoreSearch: true });
                if (hit) return hit;
                if (req.mode === 'navigate') {
                    try { return await fetch(req); } catch { return (await cache.match('/index.html')) || Response.error(); }
                }
            }
            return fetch(req);
        })());
        return;
    }
    if (isArasaacImage(url)) {
        event.respondWith((async () => {
            const cache = await caches.open(IMAGES_CACHE);
            const hit = await cache.match(req.url);
            if (hit) return hit;
            const resp = await fetch(req);
            if (resp.ok || resp.type === 'opaque') cache.put(req.url, resp.clone()).catch(() => {});
            return resp;
        })());
        return;
    }
    // MediaPipe y su modelo (precargados)
    event.respondWith((async () => {
        const cache = await activeCache();
        const hit = cache && await cache.match(req.url);
        return hit || fetch(req);
    })());
});

// --- Mensajes de la app ---
self.addEventListener('message', (event) => {
    const msg = event.data || {};
    const reply = (data) => event.ports && event.ports[0] && event.ports[0].postMessage(data);
    if (msg.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
    if (msg.type === 'STATUS') {
        event.waitUntil((async () => {
            try {
                const cache = await activeCache();
                const stored = cache && await cache.match('/offline-manifest.json');
                const m = stored ? await stored.json() : null;
                if (!m) { reply({ ready: false, version: null, missing: ['manifiesto'] }); return; }
                const missing = [];
                for (const u of [...m.files.map(f => f.url), ...m.remote.map(r => r.url)]) {
                    if (!(await cache.match(u, { ignoreSearch: true }))) missing.push(u);
                }
                reply({ ready: missing.length === 0, version: m.version, missing, files: m.files.length + m.remote.length });
            } catch (e) { reply({ ready: false, error: String(e && e.message || e) }); }
        })());
        return;
    }
    if (msg.type === 'CACHE_IMAGES') {
        // Pictogramas de los tableros guardados en este dispositivo (para usarlos sin conexión)
        event.waitUntil((async () => {
            const cache = await caches.open(IMAGES_CACHE);
            let ok = 0; const failed = [];
            for (const u of (msg.urls || []).slice(0, MAX_IMAGES)) {
                try {
                    if (await cache.match(u)) { ok++; continue; }
                    const r = await fetch(u, { mode: 'cors', credentials: 'omit' });
                    if (!r.ok) throw new Error(String(r.status));
                    await cache.put(u, r);
                    ok++;
                } catch { failed.push(u); }
            }
            reply({ ok, failed: failed.length, sample: failed.slice(0, 3) });
        })());
    }
});
