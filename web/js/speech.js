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
    const es = voices.filter(v => (v.lang || '').toLowerCase().startsWith('es'));
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

export function speak(text, { cancelPrevious = false, volume = 1.0, lang = null } = {}) {
    if (!text || !synth) return;
    if (cancelPrevious) synth.cancel();
    if (synth.paused) synth.resume();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    utterance.volume = volume;
    const voice = pickVoice(lang);
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }

    alive.add(utterance);
    const done = () => alive.delete(utterance);
    utterance.onend = done;
    utterance.onerror = (e) => {
        done();
        if (e && e.error && e.error !== 'interrupted' && e.error !== 'canceled') {
            console.warn('Voz:', e.error);
            // M08: la frase NO se borra; la app avisa y se puede reintentar con el botón de reproducir
            if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('miravoz:speech-error', { detail: { error: e.error } }));
        }
    };

    // Después de cancel(), Safari a veces ignora el speak inmediato: se difiere un instante
    if (cancelPrevious) setTimeout(() => synth.speak(utterance), 30);
    else synth.speak(utterance);
}
