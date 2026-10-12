// voice-settings.js — Sección "Voz" de Configuración (0.7.6)
// Elegir entre la voz del dispositivo (con la lista de voces en español; las "mejoradas" primero) y una voz
// natural (Piper) que se descarga una vez y anda sin conexión. "Probar" dice una frase y muestra la demora,
// para medir en cada tablet si la voz natural responde a tiempo.

import { settings, saveSettings } from './config.js';
import { speak, setVoicePrefs, systemVoices, isEnhancedVoice } from './speech.js';
import * as neural from './neural-voice.js';
import { customChoice, customAlert } from './ui.js';

const TEST_PHRASE = 'Hola, ¿cómo estás? Quiero tomar un vaso de agua, por favor.';
const $ = (id) => document.getElementById(id);
let downloading = null;

function fillEngine() {
    const sel = $('voice-engine');
    if (!sel) return;
    sel.replaceChildren();
    const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); };
    add('system', 'Del dispositivo');
    for (const [id, v] of Object.entries(neural.NEURAL_VOICES)) add('neural:' + id, `Natural: ${v.label}`);
    const v = settings.voice || {};
    sel.value = v.engine === 'neural' ? 'neural:' + v.neuralId : 'system';
}

function fillSystem() {
    const sel = $('voice-system');
    if (!sel) return;
    const list = systemVoices().slice().sort((a, b) => (isEnhancedVoice(b) - isEnhancedVoice(a)) || a.name.localeCompare(b.name));
    sel.replaceChildren();
    const auto = document.createElement('option'); auto.value = ''; auto.textContent = 'Automática'; sel.appendChild(auto);
    for (const v of list) {
        const o = document.createElement('option');
        o.value = v.voiceURI;
        o.textContent = `${v.name} (${v.lang})${isEnhancedVoice(v) ? ' · mejorada' : ''}`;
        sel.appendChild(o);
    }
    sel.value = settings.voice?.systemVoice || '';
    sel.hidden = settings.voice?.engine === 'neural';
}

async function status(text) { const el = $('voice-status'); if (el) el.textContent = text; }

async function refreshStatus() {
    const v = settings.voice || {};
    if (v.engine !== 'neural') {
        const enhanced = systemVoices().some(isEnhancedVoice);
        return status(enhanced ? 'Voz del dispositivo. Para cambiarla, elegí otra de la lista.'
            : 'Voz del dispositivo. En iPad se pueden bajar voces mejoradas en Ajustes → Accesibilidad → Contenido leído → Voces → Español.');
    }
    const info = neural.NEURAL_VOICES[v.neuralId];
    if (!(await neural.isDownloaded(v.neuralId))) return status(`${info?.label || 'Voz natural'}: falta descargarla.`);
    const ok = await neural.prepare(v.neuralId);
    if (!ok) return status('No se pudo iniciar la voz natural en este navegador: se usa la del dispositivo.');
    return status(`${info.label}: lista y disponible sin conexión.${neural.stats.initMs ? ` Cargó en ${(neural.stats.initMs / 1000).toFixed(1).replace('.', ',')} s.` : ''}`);
}

async function chooseEngine(value) {
    if (value === 'system') {
        await saveSettings({ voice: { ...settings.voice, engine: 'system' } });
        setVoicePrefs(settings.voice);
        fillSystem(); refreshStatus();
        return;
    }
    const id = value.slice('neural:'.length);
    const info = neural.NEURAL_VOICES[id];
    if (!info) return;
    if (!(await neural.isDownloaded(id))) {
        const ok = await customChoice(`Para usar «${info.label}» hay que descargarla una vez (unos ${info.mb + neural.RUNTIME_MB} MB; conviene con wifi). Después funciona sin conexión.\n\n¿Descargar ahora?`, 'Descargar', 'Cancelar');
        if (!ok) { fillEngine(); return; }
        if (downloading) return;
        downloading = new AbortController();
        const sel = $('voice-engine'); if (sel) sel.disabled = true;
        try {
            await neural.download(id, { signal: downloading.signal, onProgress: (p) => status(`Descargando ${info.label}… ${Math.round(p * 100)}%`) });
        } catch (e) {
            customAlert(`No se pudo descargar la voz (${e?.message || e}). Revisá la conexión e intentá de nuevo.`);
            fillEngine(); refreshStatus();
            return;
        } finally { downloading = null; if (sel) sel.disabled = false; }
    }
    await saveSettings({ voice: { ...settings.voice, engine: 'neural', neuralId: id } });
    setVoicePrefs(settings.voice);
    fillSystem();
    await status('Preparando la voz…');
    await refreshStatus();
}

async function test() {
    const v = settings.voice || {};
    if (v.engine === 'neural' && neural.isReady()) {
        const t0 = performance.now();
        try {
            const a = await neural.synth(TEST_PHRASE, { fresh: true }); // sin usar lo ya guardado: mide de verdad
            const ms = performance.now() - t0;
            speak(TEST_PHRASE); // ya está en memoria: suena enseguida
            const secs = (n) => (n / 1000).toFixed(1).replace('.', ',');
            status(`Tardó ${secs(ms)} s en preparar ${secs(a.pcm.length / a.sampleRate * 1000)} s de voz. Las palabras del tablero se preparan antes, así salen al instante.`);
        } catch (e) { status('La voz natural falló: se usa la del dispositivo.'); speak(TEST_PHRASE, { _system: true }); }
        return;
    }
    speak(TEST_PHRASE);
}

export function initVoiceSettings() {
    setVoicePrefs(settings.voice || {});
    fillEngine(); fillSystem(); refreshStatus();
    if (typeof speechSynthesis !== 'undefined' && speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', fillSystem);
    $('voice-engine')?.addEventListener('change', (e) => chooseEngine(e.target.value));
    $('voice-system')?.addEventListener('change', async (e) => {
        await saveSettings({ voice: { ...settings.voice, systemVoice: e.target.value } });
        setVoicePrefs(settings.voice);
        speak('Hola, esta es mi voz.', { _system: true });
    });
    $('btn-voice-test')?.addEventListener('click', test);
}
