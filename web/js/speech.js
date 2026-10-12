// speech.js — Síntesis de voz (SPEC F1-1)
//
// Particularidades de iPad/iPhone (Safari y app agregada a inicio), corregidas acá (10/10/2026):
//  - La voz queda BLOQUEADA hasta que se habla una vez dentro de un gesto de la persona (toque/tecla).
//    En modo Rostro o Barrido la selección no es un toque, así que nunca sonaba. Solución: al primer
//    toque/tecla en cualquier parte se "desbloquea" con una frase vacía y en silencio.
//  - Safari a veces deja la síntesis en pausa: se reanuda antes de hablar.
//  - Si la frase no queda referenciada, el navegador puede descartarla antes de decirla.
//  - La lista de voces llega tarde (evento voiceschanged).
//  - Con el iPad en modo silencio, Safari puede no emitir la voz (eso no se puede cambiar desde la web).

const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;

// 0.7.7: voz de cada persona. systemVoice: voiceURI elegida de la lista del dispositivo ('' = automática);
// rate y pitch: velocidad y tono (1 = normal). (La voz neural Piper de 0.7.6 se sacó: era lenta.)
export const RATE_LIMITS = [0.6, 1.4], PITCH_LIMITS = [0.7, 1.3];
export const SYSTEM_DEFAULT = 'sistema';
let prefs = { systemVoice: '', systemLang: 'es-ES', rate: 1, pitch: 1 };
const clamp = (v, [a, b], d) => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d);
export function setVoicePrefs(p = {}) {
    prefs = { ...prefs, ...p };
    prefs.rate = clamp(Number(prefs.rate), RATE_LIMITS, 1);
    prefs.pitch = clamp(Number(prefs.pitch), PITCH_LIMITS, 1);
}
export const voicePrefs = () => ({ ...prefs });
/** Voces en español del dispositivo (para elegir en Configuración). */
export function systemVoices() {
    if (!voices.length) loadVoices();
    return voices.filter(v => (v.lang || '').toLowerCase().startsWith('es'));
}
export const isEnhancedVoice = (v) => /mejorad|enhanced|premium|neural|natural|siri/i.test(`${v?.name || ''} ${v?.voiceURI || ''}`);
let voices = [];
let unlocked = false;
const alive = new Set(); // referencias a frases en curso (evita que se descarten)

function loadVoices() {
    if (!synth) return;
    const v = synth.getVoices();
    if (v && v.length) voices = v;
}
if (synth) {
    loadVoices();
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', loadVoices);
    else synth.onvoiceschanged = loadVoices;
}

function pickVoice(lang, voiceURI = null) {
    if (!voices.length) loadVoices();
    // Idioma pedido por la celda (speakLanguage de Asterics), si no es español
    if (lang && !/^es/i.test(lang)) {
        const l = String(lang).toLowerCase();
        const v = voices.find(x => (x.lang || '').toLowerCase() === l) || voices.find(x => (x.lang || '').toLowerCase().startsWith(l.slice(0, 2)));
        if (v) return v;
    }
    // Sin internet, una voz de red no suena: se prefieren las locales (si el navegador lo informa)
    const all = voices.filter(v => (v.lang || '').toLowerCase().startsWith('es'));
    const wanted = voiceURI || prefs.systemVoice;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (wanted) {
        const chosen = all.find(v => v.voiceURI === wanted);
        // 0.7.7e: una voz de internet ("Google español…") no suena sin conexión: se usa una local
        if (chosen && !(offline && chosen.localService === false)) return chosen;
    }
    const local = all.filter(v => v.localService !== false);
    const es = local.length ? local : all;
    if (!es.length) return null;
    // 0.7.6: las voces "mejoradas"/"premium" del dispositivo suenan mucho menos robóticas
    const enhanced = es.filter(isEnhancedVoice);
    if (enhanced.length) return enhanced.find(v => /es-(AR|419|US|MX)/i.test(v.lang)) || enhanced[0];
    const prefer = ['es-AR', 'es-419', 'es-US', 'es-MX'];
    return es.find(v => /Google español|Paulina|Mónica|Luciana|Elena|Isabela|Sabina/i.test(v.name))
        || prefer.map(p => es.find(v => v.lang === p)).find(Boolean)
        || es[0];
}

// 1.9.1: iPad no deja hablar hasta un primer gesto. Si una frase se pidió antes (por ejemplo, eligiendo con la
// cabeza recién abierta la app) y no arrancó, se guarda y se dice apenas alguien toca la pantalla.
let pendingSpeech = null; // { text, opts, at }

/** Desbloquea la voz en iOS: debe llamarse dentro de un gesto (toque o tecla). */
export function unlockSpeech() {
    if (!synth) return;
    if (!unlocked || !startEvents) {
        unlocked = true;
        try {
            if (synth.paused) synth.resume();
            const u = new SpeechSynthesisUtterance('.');
            u.volume = 0.01; u.rate = 2; u.lang = 'es-ES';
            u.onstart = () => { startEvents = true; };
            synth.speak(u);
        } catch { /* sin soporte */ }
    }
    replayPending();
}
function replayPending() {
    if (pendingSpeech && Date.now() - pendingSpeech.at < 15000) {
        const p = pendingSpeech; pendingSpeech = null;
        speak(p.text, { ...p.opts, cancelPrevious: false, _retry: true });
    } else pendingSpeech = null;
}
// Cada toque o tecla (antes que cualquier otro manejador) hasta que la voz haya demostrado que funciona
if (typeof window !== 'undefined') {
    const onGesture = () => {
        unlockSpeech();
        if (startEvents) { window.removeEventListener('pointerdown', onGesture, true); window.removeEventListener('keydown', onGesture, true); }
    };
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
}

export function isSpeechSupported() { return !!synth; }

// Voz trabada (iPad sin conexión, 11/10/2026): la primera frase sonaba y las siguientes no. Safari puede dejar una
// frase "en curso" que nunca empieza ni termina, y todo lo que se encola detrás queda mudo ("Probar voz" sí andaba
// porque cancela antes de hablar). Por eso:
//  - cada frase nueva CANCELA la anterior (en CAA la última selección es la que importa);
//  - si una frase no empieza en START_TIMEOUT_MS, se cancela y se reintenta una vez con la voz del sistema;
//  - se prefieren voces locales (las de red no funcionan sin internet).
const START_TIMEOUT_MS = 1500;
let startEvents = false; // el vigilante solo actúa si este navegador ya demostró que avisa cuando empieza a hablar
let deferredGo = null; // frase esperando su turno después de un cancel()

// 0.7.5: "Detener" corta la voz sin borrar la frase, y la voz pendiente (iPad sin primer toque) se descarta si
// la frase se borra. sentenceUtterance = la frase completa que se está diciendo (para mostrar "Detener").
let sentenceUtterance = null;
const speakingListeners = new Set();
export function onSpeakingChange(fn) { speakingListeners.add(fn); return () => speakingListeners.delete(fn); }
let speakingPoll = null;
let retryTimer = null;
let generation = 0; // sube al detener o borrar: lo pedido antes ya no se dice (ni queda pendiente)
function setSentenceUtterance(u) {
    if (sentenceUtterance === u) return;
    sentenceUtterance = u;
    clearInterval(speakingPoll); speakingPoll = null;
    // Algunos navegadores no avisan el final (iPad interrumpido, Chrome con frases largas): si ya no habla, se suelta
    if (u && synth) speakingPoll = setInterval(() => { if (!synth.speaking && !synth.pending) setSentenceUtterance(null); }, 700);
    speakingListeners.forEach(fn => { try { fn(!!u); } catch {} });
}
export function isSpeakingSentence() { return !!sentenceUtterance; }
/** Descarta la voz que esperaba el primer toque (la frase cambió o se borró). */
export function dropPendingSpeech() { pendingSpeech = null; generation++; }
/** Corta lo que se está diciendo y lo que esperaba turno. No toca la frase. */
export function stopSpeech() {
    pendingSpeech = null;
    generation++;
    if (deferredGo) { clearTimeout(deferredGo); deferredGo = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    alive.clear();
    try { if (synth && (synth.speaking || synth.pending)) synth.cancel(); } catch {}
    setSentenceUtterance(null);
}

export function speak(text, { cancelPrevious = true, volume = 1.0, lang = null, _retry = false, sentence = false, voiceURI = null, rate = null, pitch = null } = {}) {
    if (!text || !synth) return;
    const gen = generation;
    let cancelled = false;
    if (cancelPrevious) {
        if (deferredGo) { clearTimeout(deferredGo); deferredGo = null; }
        if (synth.speaking || synth.pending) { synth.cancel(); cancelled = true; }
    }
    if (synth.paused) synth.resume();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    utterance.volume = volume;
    utterance.rate = Number.isFinite(rate) ? rate : prefs.rate;
    utterance.pitch = Number.isFinite(pitch) ? pitch : prefs.pitch;
    // 0.7.7e: "La de Ajustes del dispositivo": no se elige voz; el sistema usa la que la persona eligió para
    // español en sus ajustes (Safari en iPad no muestra en la lista las voces mejoradas descargadas).
    const useSystemDefault = (voiceURI || prefs.systemVoice) === SYSTEM_DEFAULT && (!lang || /^es/i.test(lang));
    const voice = _retry || useSystemDefault ? null : pickVoice(lang, voiceURI);
    if (useSystemDefault) utterance.lang = prefs.systemLang || 'es-ES';
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }

    let started = false, finished = false;
    alive.add(utterance);
    const done = () => { finished = true; alive.delete(utterance); if (sentenceUtterance === utterance) setSentenceUtterance(null); };
    utterance.onstart = () => { started = true; startEvents = true; };
    utterance.onend = done;
    utterance.onerror = (e) => {
        done();
        if (e && e.error && e.error !== 'interrupted' && e.error !== 'canceled') {
            console.warn('Voz:', e.error);
            if (!_retry) { speak(text, { cancelPrevious: true, volume, lang, sentence, _retry: true }); return; }
            // M08: la frase NO se borra; la app avisa y se puede reintentar con el botón de reproducir
            if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('miravoz:speech-error', { detail: { error: e.error } }));
        }
    };

    const go = () => {
        if (sentence) setSentenceUtterance(utterance);
        else if (sentenceUtterance && cancelPrevious) setSentenceUtterance(null);
        synth.speak(utterance);
        setTimeout(() => {
            if (!alive.has(utterance) || gen !== generation) return; // se detuvo o se borró mientras tanto
            if (!startEvents && !started && !finished) {
                // Nunca arrancó una frase en esta sesión: el navegador espera un toque. Se guarda para decirla entonces.
                if (sentenceUtterance === utterance) setSentenceUtterance(null);
                pendingSpeech = { text, opts: { volume, lang, sentence }, at: Date.now() };
                if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('miravoz:speech-blocked'));
                return;
            }
            if (!startEvents || started || finished || !alive.has(utterance)) return;
            // Trabada: no empezó. Se libera la cola y se reintenta una vez con la voz por defecto del sistema.
            alive.delete(utterance);
            if (sentenceUtterance === utterance) setSentenceUtterance(null);
            synth.cancel();
            if (!_retry) retryTimer = setTimeout(() => { retryTimer = null; if (gen === generation) speak(text, { cancelPrevious: false, volume, lang, sentence, _retry: true }); }, 60);
            else if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('miravoz:speech-error', { detail: { error: 'stuck' } }));
        }, START_TIMEOUT_MS);
    };
    // Después de cancel(), Safari a veces ignora el speak inmediato: se difiere un instante
    if (cancelled) deferredGo = setTimeout(() => { deferredGo = null; go(); }, 30);
    else go();
}
