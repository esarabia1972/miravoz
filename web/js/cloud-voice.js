// cloud-voice.js — "Voces de MiraVoz" en el navegador (0.8.1n)
//
// Pide el audio a /api/voz y lo guarda en este dispositivo (Cache Storage): cada texto se pide una sola vez por
// voz y velocidad, y después suena al instante y sin conexión. Al abrir una página del tablero se bajan de
// antemano los textos de sus celdas. Se reproduce con Web Audio: en iPad, una vez habilitado con un toque,
// puede sonar después sin otro toque (Barrido, Rostro, Mirada).
// Si algo falla o tarda, speech.js usa la voz del sistema: MiraVoz nunca se queda muda.

const CACHE = 'miravoz-voces-v1';
const FETCH_TIMEOUT_MS = 3500;
let authProvider = async () => ({});
export function setCloudAuth(fn) { authProvider = fn; }

/** Pura (para tests): el texto que se manda y se usa de clave. Las etiquetas EN MAYÚSCULAS se pasan a
 *  minúscula con mayúscula inicial: si no, algunas voces las deletrean. */
export function normalizeText(text) {
    let t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length > 1 && t === t.toLocaleUpperCase('es') && /\p{L}{2,}/u.test(t)) {
        t = t.toLocaleLowerCase('es');
        t = t.charAt(0).toLocaleUpperCase('es') + t.slice(1);
    }
    return t;
}
export const speedKey = (rate) => Math.min(1.2, Math.max(0.7, Number(rate) || 1)).toFixed(2);

async function headers() {
    const a = await authProvider();
    const h = { 'Content-Type': 'application/json' };
    if (a.device) h['X-MiraVoz-Device'] = a.device;
    else if (a.token) h.Authorization = `Bearer ${a.token}`;
    return h;
}

async function sha(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
async function cacheKey(text, voice, rate) {
    return new Request(`/__voz/${encodeURIComponent(voice)}/${speedKey(rate)}/${await sha(text)}.mp3`);
}
async function openCache() {
    try { return typeof caches !== 'undefined' ? await caches.open(CACHE) : null; } catch { return null; }
}

/** MP3 (ArrayBuffer) del texto con esa voz: primero el guardado en el dispositivo, si no lo pide. */
export async function getAudio(rawText, voice, rate = 1, { timeout = FETCH_TIMEOUT_MS } = {}) {
    const text = normalizeText(rawText);
    if (!text || !voice) throw new Error('sin texto o voz');
    const cache = await openCache();
    const key = await cacheKey(text, voice, rate);
    if (cache) {
        const hit = await cache.match(key).catch(() => null);
        if (hit) return hit.arrayBuffer();
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('sin conexión');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
        const r = await fetch('/api/voz', { method: 'POST', headers: await headers(), body: JSON.stringify({ texto: text, voz: voice, velocidad: Number(speedKey(rate)) }), signal: ctrl.signal });
        if (!r.ok) {
            let msg = `voz ${r.status}`;
            try { msg = (await r.json()).error || msg; } catch { /* */ }
            throw Object.assign(new Error(msg), { status: r.status });
        }
        const buf = await r.arrayBuffer();
        if (cache) cache.put(key, new Response(buf.slice(0), { headers: { 'Content-Type': 'audio/mpeg' } })).catch(() => {});
        return buf;
    } finally { clearTimeout(timer); }
}

/** Voces disponibles (para Configuración). */
export async function listVoices() {
    const r = await fetch('/api/voz?lista=1', { headers: await headers() });
    let data = {};
    try { data = await r.json(); } catch { /* */ }
    if (!r.ok) throw new Error(data.error || `No se pudieron cargar las voces (${r.status}).`);
    return data.voces || [];
}

// --- Reproducción con Web Audio ---
let ctx = null, current = null;
function audioCtx() {
    if (!ctx) {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) return null;
        ctx = new AC();
    }
    return ctx;
}
// Si el sistema suspendió el audio (iPad que volvió de segundo plano), el próximo toque lo reanuda
if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', () => { if (ctx && ctx.state !== 'running') { try { ctx.resume(); } catch { /* */ } } }, true);
}
/** Llamar dentro de un toque o tecla (iPad): deja el audio habilitado para después. */
export function unlockCloudAudio() {
    const c = audioCtx();
    if (!c) return;
    try {
        if (c.state === 'suspended') c.resume();
        const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
        s.buffer = b; s.connect(c.destination); s.start(0);
    } catch { /* */ }
}
export function stopCloud() {
    if (current) { try { current.onended = null; current.stop(); } catch { /* */ } current = null; }
}
export function isCloudPlaying() { return !!current; }

/** Reproduce el MP3. Devuelve una promesa que termina cuando deja de sonar (o se corta). */
export async function playAudio(buf, { volume = 1 } = {}) {
    const c = audioCtx();
    if (!c) throw new Error('sin Web Audio');
    if (c.state === 'suspended') { try { await c.resume(); } catch { /* */ } }
    if (c.state !== 'running') throw new Error('audio bloqueado');
    const audio = await new Promise((res, rej) => c.decodeAudioData(buf.slice(0), res, rej));
    stopCloud();
    const src = c.createBufferSource();
    src.buffer = audio;
    const gain = c.createGain(); gain.gain.value = volume;
    src.connect(gain); gain.connect(c.destination);
    current = src;
    return new Promise((resolve) => {
        src.onended = () => { if (current === src) current = null; resolve(); };
        src.start(0);
    });
}

// --- Bajar de antemano (textos de las celdas de la página abierta) ---
let queue = [], running = false;
export function prefetch(texts, voice, rate = 1) {
    if (!voice || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    const seen = new Set(queue.map(q => q.t));
    for (const raw of texts) {
        const t = normalizeText(raw);
        if (t && t.length <= 120 && !seen.has(t)) { seen.add(t); queue.push({ t, voice, rate }); }
    }
    if (queue.length > 200) queue = queue.slice(-200);
    if (!running) drain();
}
async function drain() {
    running = true;
    while (queue.length) {
        const { t, voice, rate } = queue.shift();
        try { await getAudio(t, voice, rate, { timeout: 8000 }); }
        catch (e) { if (e && (e.status === 401 || e.status === 502 || e.status === 503)) { queue = []; break; } }
    }
    running = false;
}

/** Cuánto ocupan los audios guardados (para Configuración). */
export async function cachedCount() {
    const c = await openCache();
    if (!c) return 0;
    try { return (await c.keys()).length; } catch { return 0; }
}
export async function clearCloudCache() {
    try { if (typeof caches !== 'undefined') await caches.delete(CACHE); } catch { /* */ }
}
