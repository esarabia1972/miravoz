// neural-voice.js — Voz natural (Piper) que corre en el dispositivo (0.7.6, prototipo)
//
// Por qué así: en CAA la voz es la identidad de la persona, así que tiene que ser LA MISMA con y sin internet.
// Piper genera una voz neural cálida en el navegador (Safari del iPad, Chrome en Android o en la compu), sin
// mandar el texto a ningún servidor. Se descarga una sola vez (el modelo de la voz + el motor) y queda en el
// caché "miravoz-voz-v1"; después anda sin conexión. Si algo falla, speech.js usa la voz del dispositivo.

export const VOICE_CACHE = 'miravoz-voz-v1';
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';
const VENDOR = new URL('../vendor/piper-1.0.0/', import.meta.url).href;
const RUNTIME = ['ort.wasm.min.mjs', 'ort-wasm-simd.wasm', 'piper-phonemize.mjs', 'piper_phonemize.wasm', 'piper_phonemize.data'].map(f => VENDOR + f);

export const NEURAL_VOICES = {
    'es_AR-daniela-high': { label: 'Daniela (Argentina, femenina)', mb: 114, path: 'es/es_AR/daniela/high/es_AR-daniela-high' },
    'es_MX-ald-medium': { label: 'Ald (México, masculina)', mb: 63, path: 'es/es_MX/ald/medium/es_MX-ald-medium' }
};
export const RUNTIME_MB = 30;
const voiceFiles = (id) => { const v = NEURAL_VOICES[id]; return v ? { model: HF + v.path + '.onnx', config: HF + v.path + '.onnx.json' } : null; };

const hasCaches = () => typeof caches !== 'undefined';

/** ¿Están el motor y esa voz en el dispositivo? */
export async function isDownloaded(id) {
    const f = voiceFiles(id);
    if (!f || !hasCaches()) return false;
    try {
        const c = await caches.open(VOICE_CACHE);
        for (const u of [...RUNTIME, f.model, f.config]) if (!(await c.match(u))) return false;
        return true;
    } catch { return false; }
}

/** Baja lo que falte (con progreso 0..1). Se puede cancelar con signal. */
export async function download(id, { onProgress = () => {}, signal } = {}) {
    const f = voiceFiles(id);
    if (!f) throw new Error('voz desconocida');
    if (!hasCaches()) throw new Error('este navegador no permite guardar la voz');
    try { await navigator.storage?.persist?.(); } catch {}
    const c = await caches.open(VOICE_CACHE);
    const todo = [];
    for (const u of [...RUNTIME, f.config, f.model]) if (!(await c.match(u))) todo.push(u);
    const est = { [f.model]: NEURAL_VOICES[id].mb * 1e6, [VENDOR + 'piper_phonemize.data']: 18e6, [VENDOR + 'ort-wasm-simd.wasm']: 10.6e6 };
    const total = todo.reduce((a, u) => a + (est[u] || 2e5), 0) || 1;
    let done = 0;
    for (const u of todo) {
        const resp = await fetch(u, { signal, mode: 'cors', credentials: 'omit', cache: 'no-store' });
        if (!resp.ok) throw new Error(`no se pudo bajar ${u.split('/').pop()} (${resp.status})`);
        const reader = resp.body?.getReader();
        const chunks = [];
        let got = 0;
        if (reader) {
            for (;;) {
                const { done: end, value } = await reader.read();
                if (end) break;
                chunks.push(value); got += value.length;
                onProgress(Math.min(0.99, (done + Math.min(got, est[u] || got)) / total));
            }
        } else chunks.push(new Uint8Array(await resp.arrayBuffer()));
        const type = u.endsWith('.mjs') ? 'text/javascript' : u.endsWith('.json') ? 'application/json' : 'application/octet-stream';
        await c.put(u, new Response(new Blob(chunks, { type }), { headers: { 'Content-Type': type } }));
        done += est[u] || got;
    }
    onProgress(1);
}

/** Borra la voz (y el motor si ya no queda ninguna). */
export async function removeVoice(id) {
    const f = voiceFiles(id);
    if (!f || !hasCaches()) return;
    const c = await caches.open(VOICE_CACHE);
    await c.delete(f.model); await c.delete(f.config);
    const others = Object.keys(NEURAL_VOICES).filter(k => k !== id);
    if (!(await Promise.all(others.map(isDownloaded))).some(Boolean)) for (const u of RUNTIME) await c.delete(u);
    if (current === id) shutdown();
}

// --- Motor (Worker) ---
let worker = null, current = null, readyP = null, sampleRate = 22050, seq = 0;
const pending = new Map();
export const stats = { initMs: null, lastMs: null, lastChars: null };

function shutdown() {
    try { worker?.terminate(); } catch {}
    worker = null; current = null; readyP = null; memo.clear();
    for (const p of pending.values()) p.reject(new Error('voz detenida'));
    pending.clear();
}

/** Prepara el motor con esa voz (si está descargada). Devuelve true si quedó lista. */
export function prepare(id) {
    if (current === id && readyP) return readyP;
    shutdown();
    current = id;
    readyP = (async () => {
        if (!(await isDownloaded(id))) return false;
        worker = new Worker(new URL('./voice-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = (ev) => {
            const m = ev.data || {};
            if (m.type === 'ready' || (m.type === 'error' && m.id === undefined)) { worker._init?.(m); return; }
            const p = pending.get(m.id);
            if (!p) return;
            pending.delete(m.id);
            if (m.type === 'audio') { stats.lastMs = m.ms; p.resolve({ pcm: m.pcm, sampleRate: m.sampleRate }); }
            else p.reject(new Error(m.error || 'error de voz'));
        };
        worker.onerror = (e) => { console.warn('[voz] worker:', e.message || e); worker?._init?.({ type: 'error', error: e.message || 'worker' }); };
        const f = voiceFiles(id);
        const r = await new Promise((resolve) => { worker._init = resolve; worker.postMessage({ type: 'init', voice: f }); });
        if (r.type !== 'ready') { console.warn('[voz] no se pudo iniciar:', r.error); shutdown(); return false; }
        sampleRate = r.sampleRate; stats.initMs = r.ms;
        return true;
    })().catch((e) => { console.warn('[voz]', e); shutdown(); return false; });
    return readyP;
}
export const isReady = () => !!worker && !!readyP && current !== null;
export const currentVoice = () => current;

// Audio ya generado (palabras de las celdas, frases repetidas): sale al instante
const memo = new Map();
const MEMO_MAX = 300;
function remember(text, a) { memo.set(text, a); if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value); }

/** Genera el audio de un texto (Float32 mono). warm = precálculo de fondo (cede el turno). */
export function synth(text, { warm = false, fresh = false } = {}) {
    const key = String(text || '').trim();
    if (!key) return Promise.reject(new Error('vacío'));
    const hit = fresh ? null : memo.get(key);
    if (hit) { memo.delete(key); memo.set(key, hit); return Promise.resolve(hit); }
    if (!worker) return Promise.reject(new Error('voz no lista'));
    const id = ++seq;
    stats.lastChars = key.length;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve: (a) => { remember(key, a); resolve(a); }, reject });
        worker.postMessage({ type: 'synth', id, text: key, warm });
    });
}

/** Precalcula en segundo plano las palabras del tablero visible (así, al elegirlas, suenan sin demora). */
export function warm(texts) {
    if (!worker) return;
    try { worker.postMessage({ type: 'cancel-warm' }); } catch {}
    const list = [...new Set((texts || []).map(t => String(t || '').trim()).filter(t => t && t.length <= 80 && !memo.has(t)))].slice(0, 60);
    for (const t of list) synth(t, { warm: true }).catch(() => {});
}

// --- Reproducción (WebAudio: una vez habilitado con un toque, suena aunque se elija con la cabeza) ---
let ctx = null;
export function audioContext() {
    try {
        if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
        return ctx;
    } catch { return null; }
}
/** Llamar dentro de un gesto (toque o tecla). */
export function unlockAudio() {
    const a = audioContext();
    if (a && a.state !== 'running') a.resume().catch(() => {});
    return !!a && a.state === 'running';
}
export const audioRunning = () => !!ctx && ctx.state === 'running';

/** Reproduce; devuelve { stop(), ended: Promise }. */
export function play({ pcm, sampleRate: sr }, { volume = 1 } = {}) {
    const a = audioContext();
    if (!a) throw new Error('sin audio');
    const buf = a.createBuffer(1, pcm.length, sr || sampleRate);
    buf.copyToChannel ? buf.copyToChannel(pcm, 0) : buf.getChannelData(0).set(pcm);
    const src = a.createBufferSource();
    const g = a.createGain();
    g.gain.value = Math.max(0, Math.min(1, volume));
    src.buffer = buf;
    src.connect(g).connect(a.destination);
    let resolveEnd;
    const ended = new Promise(r => { resolveEnd = r; });
    src.onended = () => resolveEnd();
    src.start();
    return { stop: () => { try { src.stop(); } catch {} resolveEnd(); }, ended, seconds: pcm.length / (sr || sampleRate) };
}
