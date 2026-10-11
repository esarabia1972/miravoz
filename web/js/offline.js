// offline.js — Registro del Service Worker y estado "Preparado para usar sin conexión" (M05, 11/10/2026)
//
// - Se registra /sw.js?v=<versión del manifiesto>: cada versión publicada es un Service Worker nuevo.
// - Una actualización se instala completa en segundo plano y se APLICA solo en un momento seguro (en el
//   inicio, sin frase en curso, sin calibración): nunca se recarga en medio de una frase o una selección.
// - "Preparado para usar sin conexión" se muestra solo si el Service Worker confirma que tiene TODO el
//   conjunto de la versión y los pictogramas de los tableros de este dispositivo (nunca ante una descarga
//   parcial o sin espacio).

let registration = null;
let updateReady = false;
let userRequested = false;
let startupApply = true; // se desactiva apenas la app entra en uso
let safeMoment = () => false;
let onUpdate = () => {};

/** URLs de imágenes externas (http/https) de los tableros, para guardarlas. Pura. */
export function collectImageUrls(bundles) {
    const urls = new Set();
    for (const b of bundles || []) {
        for (const g of Object.values((b && b.boards) || {})) {
            for (const el of (g && g.gridElements) || []) {
                const u = el && el.image && el.image.url;
                if (typeof u === 'string' && /^https:\/\//i.test(u) && !(el.image.data)) urls.add(u);
            }
        }
    }
    return [...urls];
}

/** Texto honesto del estado (puro). */
export function statusText(st) {
    if (!st || st.unsupported) return 'Este navegador no permite preparar MiraVoz para usarla sin conexión.';
    if (st.error) return `No se pudo revisar el estado sin conexión (${st.error}).`;
    if (!st.ready) {
        const n = (st.missing || []).length;
        return n ? `Todavía no está preparado: faltan ${n} archivo(s) de la app. Conectate a internet y abrí MiraVoz un rato.` : 'Todavía no está preparado.';
    }
    if (st.imagesFailed > 0) return `La app está lista, pero ${st.imagesFailed} pictograma(s) no se pudieron guardar: sin conexión esas celdas se verán sin imagen.`;
    if (st.lowSpace) return 'La app está lista, pero el dispositivo tiene poco espacio: el navegador podría borrar datos guardados.';
    if (st.imagesChecked === false) return `App lista para abrir sin conexión (versión ${st.version}). Tocá "Preparar" para guardar también los pictogramas de tus tableros.`;
    return `Preparado para usar sin conexión (versión ${st.version}).`;
}

/** Llamar cuando la app ya está en uso: a partir de ahí nada se aplica solo. */
export function markInUse() { startupApply = false; }

export function configureUpdates({ isSafeMoment, onUpdateReady } = {}) {
    if (isSafeMoment) safeMoment = isSafeMoment;
    if (onUpdateReady) onUpdate = onUpdateReady;
}

export async function registerOffline() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    let version = null;
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const r = await fetch('/offline-manifest.json', { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(timer);
        if (r.ok) version = (await r.json()).version;
    } catch { /* sin conexión: se usa el Service Worker ya instalado */ }
    try {
        registration = version
            ? await navigator.serviceWorker.register(`/sw.js?v=${version}`, { scope: '/' })
            : await navigator.serviceWorker.getRegistration('/');
    } catch (e) {
        console.warn('Service Worker no disponible:', e?.message || e);
        return null;
    }
    if (!registration) return null;
    const watch = (sw) => {
        if (!sw) return;
        const check = () => {
            // Nunca se recarga sola en pleno uso (alguien que solo usa la mirada quedaría frente a una pantalla
            // que pide un toque). Se aplica al próximo arranque o con "Actualizar ahora" en Configuración.
            if (sw.state === 'installed' && navigator.serviceWorker.controller) { updateReady = true; onUpdate(); }
        };
        sw.addEventListener('statechange', check);
        check();
    };
    // Al ARRANCAR (antes de entrar a un modo con cámara), una versión ya descargada se aplica en el acto
    if (registration.waiting && navigator.serviceWorker.controller && startupApply) {
        updateReady = true; userRequested = true;
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else if (registration.waiting) watch(registration.waiting);
    registration.addEventListener('updatefound', () => watch(registration.installing));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!updateReady || !userRequested) return; // primera instalación o activación ajena: no recargar
        window.location.reload();
    });
    return registration;
}

/** ¿Hay una versión nueva descargada esperando? */
export function hasUpdate() { return updateReady && !!(registration && registration.waiting); }

/** "Actualizar ahora" (lo toca la persona de apoyo): aplica la versión descargada y recarga. */
export function applyUpdateNow() {
    if (!hasUpdate() || !safeMoment()) return false;
    userRequested = true;
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    return true;
}
/** Compatibilidad: ya no aplica nada automáticamente durante el uso. */
export function applyUpdateIfSafe() { return false; }

function ask(msg, timeoutMs = 120000) {
    const sw = (navigator.serviceWorker && navigator.serviceWorker.controller) || (registration && registration.active);
    if (!sw) return Promise.resolve(null);
    return new Promise((resolve) => {
        const ch = new MessageChannel();
        const timer = setTimeout(() => resolve(null), timeoutMs);
        ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data); };
        sw.postMessage(msg, [ch.port2]);
    });
}

async function storageInfo() {
    const out = { lowSpace: false, persisted: null };
    try {
        if (navigator.storage && navigator.storage.estimate) {
            const { usage = 0, quota = 0 } = await navigator.storage.estimate();
            out.lowSpace = quota > 0 && quota - usage < 50e6; // menos de 50 MB libres para MiraVoz
        }
        if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted();
    } catch { /* sin datos */ }
    return out;
}

/** Estado actual (sin descargar nada). */
export async function offlineStatus() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return { unsupported: true };
    const st = await ask({ type: 'STATUS' }, 15000);
    if (!st) return { ready: false, missing: [], error: 'el Service Worker todavía no está activo' };
    return { ...st, ...(await storageInfo()), imagesChecked: false };
}

/** Prepara el uso sin conexión: pide almacenamiento persistente y guarda los pictogramas de los tableros. */
export async function prepareOffline(bundles) {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return { unsupported: true };
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* opcional */ }
    if (registration) { try { await registration.update(); } catch { /* sin red */ } }
    const imgs = await ask({ type: 'CACHE_IMAGES', urls: collectImageUrls(bundles) });
    const st = await offlineStatus();
    return { ...st, imagesChecked: true, imagesFailed: imgs ? imgs.failed : 0, imagesOk: imgs ? imgs.ok : 0 };
}
