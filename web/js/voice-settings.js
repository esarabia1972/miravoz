// voice-settings.js — Sección "Voz" de Configuración (0.7.7)
//
// La voz es parte de la identidad de quien comunica: se elige POR PERSONA (en la tablet vinculada, la de ese
// usuario; en la cuenta registrada, la de prueba) y se guarda en este dispositivo, porque cada equipo tiene su
// propia lista de voces. Se usan las voces del sistema: hablan al instante y sin conexión. Las "mejoradas" o
// "premium" (que se bajan gratis desde los ajustes del dispositivo) suenan mucho menos robóticas.

import { speak, setVoicePrefs, systemVoices, isEnhancedVoice, SYSTEM_DEFAULT } from './speech.js';
import { personScope } from './person-scope.js';

const KEY = 'miravoz_voice:';
const DEFAULTS = { systemVoice: '', systemLang: 'es-ES', rate: 1, pitch: 1 };
const TEST_PHRASE = 'Hola, ¿cómo estás? Quiero tomar un vaso de agua, por favor.';
const $ = (id) => document.getElementById(id);
let current = { ...DEFAULTS }, loadedScope = null;

/** Pura (para tests): cómo bajar voces mejoradas según el dispositivo. */
export function enhancedVoiceHelp(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : ''), touch = (typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0)) {
    const ipad = /iPad|iPhone/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
    if (ipad) return 'Para una "Mejorada": elegila en Ajustes → Accesibilidad → Contenido leído y usá acá "La de Ajustes del dispositivo".';
    if (/Macintosh/.test(ua)) return 'Más natural: Ajustes del Sistema → Accesibilidad → Contenido leído → bajá una voz "Mejorada".';
    if (/Android/.test(ua)) return 'Más natural: Ajustes → Accesibilidad → Texto a voz → Google → instalar la voz en español.';
    if (/Windows/.test(ua)) return 'Más voces: Configuración → Hora e idioma → Voz → Agregar voces.';
    return 'Se pueden agregar voces en los ajustes de voz del dispositivo.';
}

async function load(scope) {
    let v = null;
    try { v = await localforage.getItem(KEY + scope); } catch {}
    return { ...DEFAULTS, ...(v && typeof v === 'object' ? v : {}) };
}
async function save() {
    try { await localforage.setItem(KEY + loadedScope, current); } catch {}
    setVoicePrefs(current);
}

/** Aplica la voz de la persona actual (llamar al arrancar y cuando cambia la tablet vinculada). */
export async function applyPersonVoice() {
    const scope = personScope();
    current = await load(scope);
    loadedScope = scope;
    setVoicePrefs(current);
    fill();
}

function fill() {
    const sel = $('voice-system');
    if (!sel) return;
    const list = systemVoices().slice().sort((a, b) => (isEnhancedVoice(b) - isEnhancedVoice(a)) || a.name.localeCompare(b.name));
    sel.replaceChildren();
    const auto = document.createElement('option'); auto.value = ''; auto.textContent = 'Automática'; sel.appendChild(auto);
    // La voz que la persona eligió en los ajustes del dispositivo (en iPad, Safari no lista las "mejoradas")
    for (const [lang, label] of [['es-ES', 'España'], ['es-MX', 'México'], ['es-AR', 'Argentina']]) {
        const o = document.createElement('option'); o.value = `${SYSTEM_DEFAULT}|${lang}`; o.textContent = `La de Ajustes del dispositivo (${label})`; sel.appendChild(o);
    }
    for (const v of list) {
        const o = document.createElement('option');
        o.value = v.voiceURI;
        o.textContent = `${v.name} (${v.lang})${isEnhancedVoice(v) ? ' · mejorada' : ''}${v.localService === false ? ' · necesita internet' : ''}`;
        sel.appendChild(o);
    }
    const sysVal = current.systemVoice === SYSTEM_DEFAULT ? `${SYSTEM_DEFAULT}|${current.systemLang || 'es-ES'}` : null;
    sel.value = sysVal || (list.some(v => v.voiceURI === current.systemVoice) ? current.systemVoice : '');
    const rate = $('voice-rate'); if (rate) rate.value = String(current.rate);
    const pitch = $('voice-pitch'); if (pitch) pitch.value = String(current.pitch);
    const status = $('voice-status');
    if (status) {
        const hasEnhanced = list.some(isEnhancedVoice);
        status.textContent = !list.length ? 'Este navegador no tiene voces en español instaladas. ' + enhancedVoiceHelp()
            : current.systemVoice === SYSTEM_DEFAULT ? 'Usa la voz elegida en los ajustes del dispositivo.'
            : hasEnhanced ? 'Se guarda para esta persona en este dispositivo.' : enhancedVoiceHelp();
        status.title = 'Después de bajar una voz, recargá MiraVoz para verla en la lista.';
    }
}

export function initVoiceSettings() {
    applyPersonVoice();
    if (typeof speechSynthesis !== 'undefined' && speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', fill);
    $('voice-system')?.addEventListener('change', async (e) => {
        const [v, lang] = e.target.value.split('|');
        current.systemVoice = v; if (lang) current.systemLang = lang;
        await save(); speak('Hola, esta es mi voz.');
    });
    $('voice-rate')?.addEventListener('change', async (e) => { current.rate = Number(e.target.value); await save(); speak('Así hablo.'); });
    $('voice-pitch')?.addEventListener('change', async (e) => { current.pitch = Number(e.target.value); await save(); speak('Así hablo.'); });
    $('btn-voice-test')?.addEventListener('click', () => speak(TEST_PHRASE));
    // Quien probó la voz natural de 0.7.6: se libera el espacio que ocupaba
    try { if (typeof caches !== 'undefined') caches.delete('miravoz-voz-v1').catch(() => {}); } catch {}
}
