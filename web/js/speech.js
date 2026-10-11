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

function pickVoice(lang) {
    if (!voices.length) loadVoices();
    // Idioma pedido por la celda (speakLanguage de Asterics), si no es español
    if (lang && !/^es/i.test(lang)) {
        const l = String(lang).toLowerCase();
        const v = voices.find(x => (x.lang || '').toLowerCase() === l) || voices.find(x => (x.lang || '').toLowerCase().startsWith(l.slice(0, 2)));
        if (v) return v;
    }
    // Sin internet, una voz de red no suena: se prefieren las locales (si el navegador lo informa)
    const all = voices.filter(v => (v.lang || '').toLowerCase().startsWith('es'));
    const local = all.filter(v => v.localService !== false);
    const es = local.length ? local : all;
    if (!es.length) return null;
    const prefer = ['es-AR', 'es-419', 'es-US', 'es-MX'];
    return es.find(v => /Google español|Paulina|Mónica|Luciana|Elena|Isabela|Sabina/i.test(v.name))
        || prefer.map(p => es.find(v => v.lang === p)).find(Boolean)
        || es[0];
}

/** Desbloquea la voz en iOS: debe llamarse dentro de un gesto (toque o tecla). */
export function unlockSpeech() {
    if (!synth || unlocked) return;
    unlocked = true;
    try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        u.lang = 'es-ES';
        synth.speak(u);
    } catch { /* sin soporte */ }
}
// Primer toque o tecla en cualquier parte de la app (antes que cualquier otro manejador)
if (typeof window !== 'undefined') {
    const once = () => { unlockSpeech(); window.removeEventListener('pointerdown', once, true); window.removeEventListener('keydown', once, true); };
    window.addEventListener('pointerdown', once, true);
    window.addEventListener('keydown', once, true);
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

export function speak(text, { cancelPrevious = true, volume = 1.0, lang = null, _retry = false } = {}) {
    if (!text || !synth) return;
    let cancelled = false;
    if (cancelPrevious) {
        if (deferredGo) { clearTimeout(deferredGo); deferredGo = null; }
        if (synth.speaking || synth.pending) { synth.cancel(); cancelled = true; }
    }
    if (synth.paused) synth.resume();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    utterance.volume = volume;
    const voice = _retry ? null : pickVoice(lang);
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }

    let started = false, finished = false;
    alive.add(utterance);
    const done = () => { finished = true; alive.delete(utterance); };
    utterance.onstart = () => { started = true; startEvents = true; };
    utterance.onend = done;
    utterance.onerror = (e) => {
        done();
        if (e && e.error && e.error !== 'interrupted' && e.error !== 'canceled') {
            console.warn('Voz:', e.error);
            if (!_retry) { speak(text, { cancelPrevious: true, volume, lang, _retry: true }); return; }
            // M08: la frase NO se borra; la app avisa y se puede reintentar con el botón de reproducir
            if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('miravoz:speech-error', { detail: { error: e.error } }));
        }
    };

    const go = () => {
        synth.speak(utterance);
        setTimeout(() => {
            if (!startEvents || started || finished || !alive.has(utterance)) return;
            // Trabada: no empezó. Se libera la cola y se reintenta una vez con la voz por defecto del sistema.
            alive.delete(utterance);
            synth.cancel();
            if (!_retry) setTimeout(() => speak(text, { cancelPrevious: false, volume, lang, _retry: true }), 60);
            else if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('miravoz:speech-error', { detail: { error: 'stuck' } }));
        }, START_TIMEOUT_MS);
    };
    // Después de cancel(), Safari a veces ignora el speak inmediato: se difiere un instante
    if (cancelled) deferredGo = setTimeout(() => { deferredGo = null; go(); }, 30);
    else go();
}
