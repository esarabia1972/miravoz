// cloud-voice.js — "Voces de MiraVoz" en el navegador (0.8.1n)
//
// Pide el audio a /api/voz y lo guarda en este dispositivo (Cache Storage): cada texto se pide una sola vez por
// voz y velocidad, y después suena al instante y sin conexión. Al abrir una página del tablero se bajan de
// antemano los textos de sus celdas. Se reproduce con un elemento <audio>: en iPad, una vez habilitado con un
// toque, puede sonar después sin otro toque (Barrido, Rostro, Mirada), y no lo corta el modo silencio.
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

// --- Reproducción ---
// 0.8.1o: en iPad, Web Audio respeta el modo silencio (se veía el parlante en la barra pero no sonaba), mientras
// que la voz del sistema y un elemento <audio> suenan igual. Por eso se reproduce con UN elemento <audio> que se
// habilita con el primer toque (después puede sonar sin otro toque: Barrido, Rostro, Mirada). Además, donde
// existe (Safari 17+), se pide la sesión de audio de "reproducción" para que tampoco la corte el modo silencio.
try { if (typeof navigator !== 'undefined' && navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* */ }

/** WAV de silencio (0,05 s) para habilitar el <audio> dentro de un toque. */
function silentWavUrl() {
    const rate = 8000, n = 400, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    let bin = ''; new Uint8Array(buf).forEach(b => { bin += String.fromCharCode(b); });
    return 'data:audio/wav;base64,' + btoa(bin);
}
let el = null, unlockedEl = false, current = null; // current = { resolve, url }
function audioEl() {
    if (!el && typeof Audio !== 'undefined') {
        el = new Audio();
        el.preload = 'auto';
        el.setAttribute('playsinline', '');
    }
    return el;
}
// Cada toque, hasta que el <audio> quede habilitado
if (typeof window !== 'undefined') {
    const onTap = () => { unlockCloudAudio(); if (unlockedEl) { window.removeEventListener('pointerdown', onTap, true); window.removeEventListener('keydown', onTap, true); } };
    window.addEventListener('pointerdown', onTap, true);
    window.addEventListener('keydown', onTap, true);
}
/** Llamar dentro de un toque o tecla (iPad): deja el audio habilitado para después. */
export function unlockCloudAudio() {
    const a = audioEl();
    if (!a || unlockedEl || current) return;
    try {
        a.src = silentWavUrl();
        a.volume = 0.01;
        const p = a.play();
        if (p && p.then) p.then(() => { unlockedEl = true; }).catch(() => {});
        else unlockedEl = true;
    } catch { /* */ }
}
function finish(c) {
    if (!c) return;
    if (current === c) current = null;
    try { URL.revokeObjectURL(c.url); } catch { /* */ }
    c.resolve();
}
export function stopCloud() {
    const c = current;
    if (!c) return;
    current = null;
    try { el.pause(); } catch { /* */ }
    finish(c);
}
export function isCloudPlaying() { return !!current; }

/** Reproduce el MP3. Devuelve una promesa que termina cuando deja de sonar (o se corta). */
export async function playAudio(buf, { volume = 1 } = {}) {
    const a = audioEl();
    if (!a) throw new Error('sin audio');
    stopCloud();
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
    return new Promise((resolve, reject) => {
        const c = { resolve, url };
        current = c;
        a.onended = () => finish(c);
        a.onerror = () => { if (current === c) { current = null; try { URL.revokeObjectURL(url); } catch { /* */ } reject(new Error('no se pudo reproducir')); } };
        a.src = url;
        a.volume = Math.max(0, Math.min(1, volume));
        const p = a.play();
        if (p && p.catch) p.catch((err) => {
            if (current !== c) return;
            current = null;
            try { URL.revokeObjectURL(url); } catch { /* */ }
            reject(new Error(err && err.name === 'NotAllowedError' ? 'audio bloqueado (falta un toque)' : 'no se pudo reproducir'));
        });
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
