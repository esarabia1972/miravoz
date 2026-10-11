// metrics.js — Registro de uso de la tablet vinculada (1.9.0)
//
// Decisión de Esteban (11/10/2026): se registran EVENTOS (cada selección, frase, página, pausa…), no solo
// resúmenes. Como eso equivale a registrar lo que la persona comunicó, solo se registra si la cuenta registrada
// declaró tener el consentimiento del usuario o de su familia (device.settings.metrics.enabled) y si nadie lo
// pausó en la tablet. Los eventos se juntan en el dispositivo y se suben con el token de la tablet
// (device_log_events, supabase/10); sin conexión esperan en la cola (localforage) hasta que vuelve la red.
// Nunca se registra video, imagen ni nada de la cámara.

const QUEUE_KEY = 'miravoz_metrics_queue';
const PAUSE_KEY = 'miravoz_metrics_paused';
const MAX_QUEUE = 5000;          // tope local (si pasa mucho tiempo sin red se descartan los más viejos)
const FLUSH_MS = 20000;

let deps = { supabase: null, device: () => null };
let queue = [];
let loaded = false;
let flushing = false;
let session = null;              // { id, start, lastAt, selections }
let lastSelectAt = null;
let lastPage = null;

export function initMetrics(d) {
    deps = { ...deps, ...d };
    load();
    setInterval(() => flush(), FLUSH_MS);
    window.addEventListener('online', () => flush());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { endSession('oculta'); flush(); }
        else startSession();
    });
}

async function load() {
    try { queue = (await localforage.getItem(QUEUE_KEY)) || []; } catch { queue = []; }
    loaded = true;
}
const persist = () => localforage.setItem(QUEUE_KEY, queue.slice(-MAX_QUEUE)).catch(() => {});

/** ¿Se registra en este momento? (tablet vinculada, con consentimiento y sin pausa) */
export function isRecording() {
    const dev = deps.device();
    return !!(dev && dev.token && dev.settings && dev.settings.metrics && dev.settings.metrics.enabled === true && !isPaused());
}
export function isAvailable() {
    const dev = deps.device();
    return !!(dev && dev.settings && dev.settings.metrics && dev.settings.metrics.enabled === true);
}
export function isPaused() { try { return localStorage.getItem(PAUSE_KEY) === '1'; } catch { return false; } }
export function setPaused(p) {
    if (p) { push('registro_pausado', {}, true); try { localStorage.setItem(PAUSE_KEY, '1'); } catch {} }
    else { try { localStorage.removeItem(PAUSE_KEY); } catch {} push('registro_reanudado', {}); }
    flush();
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 's' + Date.now() + Math.random().toString(36).slice(2));

function push(kind, fields = {}, force = false) {
    if (!force && !isRecording()) return;
    const now = Date.now();
    if (session) session.lastAt = now;
    queue.push({ kind, ts: new Date(now).toISOString(), session: session?.id || null, ...fields });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    persist();
}

export function startSession() {
    if (!isRecording() || session) return;
    session = { id: uuid(), start: Date.now(), lastAt: Date.now(), selections: 0 };
    lastSelectAt = null;
    push('sesion_inicio', { data: { viewport: [window.innerWidth, window.innerHeight] } });
}
export function endSession(reason = 'fin') {
    if (!session) return;
    push('sesion_fin', { ms: Date.now() - session.start, data: { motivo: reason, selecciones: session.selections } });
    session = null;
}

/** Contexto del tablero abierto: { bundle, gridId } → campos comunes del evento. */
function where(ctx) {
    const b = ctx && ctx.bundle;
    return { board: b?.bundleId || b?.id || null, assignment: b?.assignmentId || null, page: ctx?.gridId || null };
}

/** Una celda elegida. method: permanencia | parpadeo | barrido | toque. */
export function cellSelected(el, ctx, method, label) {
    if (!isRecording()) return;
    startSession();
    const now = Date.now();
    const ms = lastSelectAt ? Math.min(now - lastSelectAt, 600000) : null; // tiempo desde la selección anterior
    lastSelectAt = now;
    if (session) session.selections++;
    push('seleccion', { ...where(ctx), cell: el?.id || null, label: label || null, method, ms,
        data: { fila: (el?.y ?? 0) + 1, columna: (el?.x ?? 0) + 1, color: el?.colorCategory || null } });
}
export function selectionAbandoned(label, ctx, progress) {
    push('cancelada', { ...where(ctx), label: label || null, data: { progreso: Math.round(progress * 100) / 100 } });
}
export function pageShown(ctx) {
    if (!isRecording()) return;
    const key = `${ctx?.bundle?.id}|${ctx?.gridId}`;
    if (key === lastPage) return;
    const isNewBoard = !lastPage || lastPage.split('|')[0] !== String(ctx?.bundle?.id);
    lastPage = key;
    startSession();
    push(isNewBoard ? 'tablero' : 'pagina', { ...where(ctx), label: ctx?.pageName || null, data: isNewBoard ? { nombre: ctx?.bundle?.name || null } : undefined });
}
export function sentenceSpoken(items, ctx) {
    if (!items || !items.length) return;
    const texto = items.map(i => (i.speakText !== undefined ? i.speakText : i.text)).filter(Boolean).join(' ');
    push('frase', { ...where(ctx), label: texto.slice(0, 200), data: { n: items.length, texto } });
}
export function sentenceEdited(kind, ctx) { push(kind === 'clear' ? 'borrar_todo' : 'borrar', where(ctx)); }
export function paused(reason, ms) { push('pausa', { label: reason, ms }); }
export function calibrated(data) { push('calibracion', { data }); }
export function aligned(data) { push('alineacion', { data }); }
export function practiced(entry) { push('practica', { label: String(entry?.level ?? ''), ms: entry?.durationMs ?? null, data: entry }); }
export function modeChanged(mode) { push('modo', { label: mode }); }

/** Sube la cola (en tandas de 300). Si la cuenta desactivó el registro, se descarta lo pendiente. */
export async function flush() {
    if (flushing || !loaded || !queue.length || !deps.supabase || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    const dev = deps.device();
    if (!dev || !dev.token) return;
    flushing = true;
    try {
        while (queue.length) {
            const batch = queue.slice(0, 300);
            const { data, error } = await deps.supabase.rpc('device_log_events', { p_token: dev.token, p_events: batch });
            if (error) break;                                   // sin red o error: se reintenta después
            if (data && data.ok === false && (data.disabled || data.unlinked)) { queue = []; await persist(); break; }
            queue = queue.slice(batch.length);
            await persist();
        }
    } catch { /* se reintenta */ }
    finally { flushing = false; }
}

/** Para los tests */
export function _state() { return { queue, session }; }
