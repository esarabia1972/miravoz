// voice-worker.js — Voz natural (Piper) en un Worker, para no frenar la cámara ni la interfaz (0.7.6).
// Lee TODO del caché "miravoz-voz-v1" (lo baja neural-voice.js): funciona sin conexión y nada sale del equipo.
// Mensajes: { type: 'init', voice } → { type: 'ready', sampleRate, ms } | { type: 'error', error }
//           { type: 'synth', id, text } → { type: 'audio', id, pcm (Float32Array), sampleRate, ms } | { type: 'error', id, error }

const VOICE_CACHE = 'miravoz-voz-v1';
const BASE = new URL('../vendor/piper-1.0.0/', self.location.href).href;

let ort = null, session = null, config = null, phon = null, onPhonemes = null, ready = null;

async function fromCache(url) {
    const cache = await caches.open(VOICE_CACHE);
    const hit = await cache.match(url);
    if (!hit) throw new Error('falta descargar: ' + url.split('/').pop());
    return hit;
}

/** Importa un módulo guardado en el caché (sin red: anda sin conexión aunque el Service Worker no lo tenga). */
async function importCached(url) {
    const src = await (await fromCache(url)).text();
    const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    try { return await import(blobUrl); } finally { URL.revokeObjectURL(blobUrl); }
}

async function init(voice) {
    const t0 = performance.now();
    // Runtime de ONNX (wasm sin hilos: la página no está aislada entre orígenes)
    ort = await importCached(BASE + 'ort.wasm.min.mjs');
    const wasm = URL.createObjectURL(await (await fromCache(BASE + 'ort-wasm-simd.wasm')).blob());
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = { 'ort-wasm-simd.wasm': wasm, 'ort-wasm.wasm': wasm };
    // Fonemas (eSpeak NG): se crea una sola vez y se reusa en cada frase
    const { createPiperPhonemize } = await importCached(BASE + 'piper-phonemize.mjs');
    const [wasmBin, dataBin] = await Promise.all([
        fromCache(BASE + 'piper_phonemize.wasm').then(r => r.arrayBuffer()),
        fromCache(BASE + 'piper_phonemize.data').then(r => r.arrayBuffer())
    ]);
    phon = await createPiperPhonemize({
        noInitialRun: true,
        wasmBinary: wasmBin,
        getPreloadedPackage: () => dataBin,
        locateFile: (u) => BASE + u,
        print: (line) => { if (onPhonemes) onPhonemes(line); },
        printErr: (m) => console.warn('[voz] fonemas:', m)
    });
    config = await (await fromCache(voice.config)).json();
    const model = await (await fromCache(voice.model)).arrayBuffer();
    session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
    return { sampleRate: config.audio.sample_rate, ms: Math.round(performance.now() - t0) };
}

function phonemes(text) {
    return new Promise((resolve, reject) => {
        onPhonemes = (line) => { onPhonemes = null; try { resolve(JSON.parse(line).phoneme_ids); } catch (e) { reject(e); } };
        try {
            phon.callMain(['-l', config.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
        } catch (e) { onPhonemes = null; reject(e); }
    });
}

async function synth(text) {
    const t0 = performance.now();
    const ids = await phonemes(text);
    const inf = config.inference || {};
    const feeds = {
        input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
        input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
        scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale ?? 0.667, inf.length_scale ?? 1, inf.noise_w ?? 0.8]), [3])
    };
    if (config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
    const out = await session.run(feeds);
    const pcm = new Float32Array(out.output.data);
    return { pcm, ms: Math.round(performance.now() - t0) };
}

// Una sola cosa a la vez (el modelo no es reentrante); lo pedido para decir pasa antes que lo que se precalcula
let busy = false;
const queue = [];
function pump() {
    if (busy || !queue.length) return;
    const i = queue.findIndex(j => !j.warm);
    const job = queue.splice(i >= 0 ? i : 0, 1)[0];
    busy = true;
    synth(job.text).then(({ pcm, ms }) => {
        self.postMessage({ type: 'audio', id: job.id, pcm, sampleRate: config.audio.sample_rate, ms }, [pcm.buffer]);
    }).catch(e => self.postMessage({ type: 'error', id: job.id, error: String(e?.message || e) }))
      .finally(() => { busy = false; pump(); });
}

self.onmessage = async (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'init') {
        ready = ready || init(msg.voice);
        try { self.postMessage({ type: 'ready', ...(await ready) }); }
        catch (e) { ready = null; self.postMessage({ type: 'error', error: String(e?.message || e) }); }
    } else if (msg.type === 'synth') {
        try { await ready; } catch { return; }
        queue.push({ id: msg.id, text: String(msg.text || '').slice(0, 600), warm: !!msg.warm });
        pump();
    } else if (msg.type === 'cancel-warm') {
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i].warm) { self.postMessage({ type: 'error', id: queue[i].id, error: 'cancelado' }); queue.splice(i, 1); }
    }
};
