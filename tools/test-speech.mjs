// Tests de speech.js (voz trabada en iPad sin conexión, 1.2.1). Correr: node tools/test-speech.mjs
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Síntesis simulada: mode 'ok' habla y termina; 'stuck' deja la frase en curso sin empezar nunca (bug de Safari)
const synth = {
    mode: 'ok', speaking: false, pending: false, paused: false, spoken: [], cancels: 0, current: null,
    getVoices: () => [{ name: 'Paulina', lang: 'es-MX', localService: true }, { name: 'Red', lang: 'es-AR', localService: false }],
    addEventListener() {},
    cancel() { this.cancels++; if (this.current) { const u = this.current; this.current = null; u.onerror && u.onerror({ error: 'canceled' }); } this.speaking = false; },
    resume() {},
    speak(u) {
        this.speaking = true; this.current = u;
        if (this.mode === 'stuck' && !u.voice?.__never) { if (this.stuckOnce) this.mode = 'ok'; return; }
        this.spoken.push({ text: u.text, voice: u.voice ? u.voice.name : null });
        setTimeout(() => { u.onstart && u.onstart(); setTimeout(() => { if (this.current === u) { this.current = null; this.speaking = false; u.onend && u.onend(); } }, 20); }, 5);
    }
};
globalThis.speechSynthesis = synth;
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent(e) { (globalThis.__events ||= []).push(e.type); } };
globalThis.CustomEvent = class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } };
const { speak } = await import('../web/js/speech.js');

console.log('speech');
await t('elige una voz local en español (nunca la de red)', async () => {
    synth.spoken = []; speak('hola'); await sleep(80);
    assert(synth.spoken[0] && synth.spoken[0].voice === 'Paulina', JSON.stringify(synth.spoken));
});
await t('una frase nueva cancela la anterior (no se encola detrás)', async () => {
    synth.spoken = []; synth.cancels = 0;
    speak('primera'); await sleep(3); speak('segunda'); await sleep(100);
    assert(synth.cancels >= 1 && synth.spoken.at(-1).text === 'segunda' && !synth.current, JSON.stringify(synth.spoken));
});
await t('voz trabada: si no empieza en 1,5 s se cancela y se reintenta con la voz del sistema', async () => {
    synth.spoken = []; synth.mode = 'stuck'; synth.stuckOnce = true;
    speak('agua'); await sleep(1700);
    assert(synth.spoken.length === 1 && synth.spoken[0].text === 'agua' && synth.spoken[0].voice === null, JSON.stringify(synth.spoken));
    synth.spoken = []; speak('después'); await sleep(80);
    assert(synth.spoken[0] && synth.spoken[0].text === 'después', 'la siguiente frase también suena');
});
await t('si sigue trabada después del reintento, avisa (la frase no se pierde)', async () => {
    globalThis.__events = []; synth.spoken = []; synth.mode = 'stuck'; synth.stuckOnce = false;
    speak('nada'); await sleep(3400);
    assert(globalThis.__events.includes('miravoz:speech-error'), JSON.stringify(globalThis.__events));
    synth.mode = 'ok';
});

console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
