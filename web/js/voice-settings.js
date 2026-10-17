// voice-settings.js — Sección "Voz" de Configuración (0.7.7)
//
// La voz es parte de la identidad de quien comunica: se elige POR PERSONA (en la tablet vinculada, la de ese
// usuario; en la cuenta registrada, la de prueba) y se guarda en este dispositivo, porque cada equipo tiene su
// propia lista de voces. Se usan las voces del sistema: hablan al instante y sin conexión. Las "mejoradas" o
// "premium" (que se bajan gratis desde los ajustes del dispositivo) suenan mucho menos robóticas.

import { speak, setVoicePrefs, systemVoices, isEnhancedVoice, SYSTEM_DEFAULT, lastCloudError } from './speech.js';
import { listVoices } from './cloud-voice.js';
import { personScope } from './person-scope.js';

const KEY = 'miravoz_voice:';
// 0.8.1n: engine 'system' | 'miravoz'; cloudVoice = id de la voz de MiraVoz elegida
const DEFAULTS = { systemVoice: '', systemLang: 'es-ES', rate: 1, pitch: 1, engine: 'system', cloudVoice: '' };
let cloudVoices = null, cloudError = '', cloudLoading = false;

/** Pura (para tests): cómo se muestra una voz de MiraVoz en la lista. */
export function cloudVoiceLabel(v) {
    const g = { male: 'hombre', female: 'mujer', neutral: 'neutra' }[String(v.genero || '').toLowerCase()] || '';
    const a = String(v.edad || '').toLowerCase().replace(/[\s-]/g, '_');
    const age = { young: 'joven', middle_aged: 'adulta', old: 'mayor', child: 'infantil', kid: 'infantil' }[a] || '';
    const extra = [g, age, v.acento].filter(Boolean).join(', ');
    return extra ? `${v.nombre} (${extra})` : v.nombre;
}
async function loadCloudVoices(force = false) {
    if (cloudLoading || (cloudVoices && !force)) return;
    cloudLoading = true; cloudError = '';
    try { cloudVoices = await listVoices(); }
    catch (e) { cloudError = e?.message || 'No se pudieron cargar las voces de MiraVoz.'; cloudVoices = null; }
    cloudLoading = false;
    fill();
}
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

function fillCloud(sel) {
    sel.replaceChildren();
    const status = $('voice-status');
    if (!cloudVoices) {
        const o = document.createElement('option'); o.value = ''; o.textContent = cloudLoading || !cloudError ? 'Cargando voces…' : 'No disponibles'; sel.appendChild(o);
        if (!cloudLoading && !cloudError) loadCloudVoices();
        if (status) status.textContent = cloudError ? `${cloudError} Mientras tanto se usa la voz del sistema.` : 'Necesita internet la primera vez que se dice cada texto; después queda guardado en este dispositivo.';
        return;
    }
    const mine = cloudVoices.filter(v => v.propia), others = cloudVoices.filter(v => !v.propia);
    const group = (label, list) => {
        if (!list.length) return;
        const g = document.createElement('optgroup'); g.label = label;
        list.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).forEach(v => { const o = document.createElement('option'); o.value = v.id; o.textContent = cloudVoiceLabel(v); g.appendChild(o); });
        sel.appendChild(g);
    };
    // 0.8.1o: lista fija de MiraVoz (sin grupos)
    cloudVoices.slice().sort((a, b) => (a.genero || '').localeCompare(b.genero || '') || a.nombre.localeCompare(b.nombre)).forEach(v => { const o = document.createElement('option'); o.value = v.id; o.textContent = cloudVoiceLabel(v); sel.appendChild(o); });
    if (!cloudVoices.some(v => v.id === current.cloudVoice)) {
        current.cloudVoice = (mine[0] || others[0] || {}).id || '';
        if (current.cloudVoice) save();
    }
    sel.value = current.cloudVoice;
    if (status) status.textContent = lastCloudError
        ? `La última frase se dijo con la voz del sistema (${lastCloudError}).`
        : 'Voz natural de MiraVoz. Necesita internet la primera vez que se dice cada texto; después queda guardado en este dispositivo.';
}

function fill() {
    const sel = $('voice-system');
    if (!sel) return;
    const cloudMode = current.engine === 'miravoz';
    document.querySelectorAll('#voice-engine button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.engine === (cloudMode ? 'miravoz' : 'system'))));
    const help = $('voice-help');
    if (help) help.textContent = cloudMode ? 'Voces naturales de MiraVoz (requieren internet; los textos ya dichos quedan guardados).' : 'La voz de esta persona (las "mejoradas" suenan más naturales).';
    const pitchSel = $('voice-pitch');
    if (pitchSel) { pitchSel.disabled = cloudMode; pitchSel.title = cloudMode ? 'Las voces de MiraVoz no cambian el tono' : ''; }
    if (cloudMode) {
        fillCloud(sel);
        const rate = $('voice-rate'); if (rate) rate.value = String(current.rate);
        return;
    }
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
        if (current.engine === 'miravoz') {
            current.cloudVoice = e.target.value;
            await save(); speak('Hola, esta es mi voz.');
            return;
        }
        const [v, lang] = e.target.value.split('|');
        current.systemVoice = v; if (lang) current.systemLang = lang;
        await save(); speak('Hola, esta es mi voz.');
    });
    document.querySelectorAll('#voice-engine button').forEach(b => b.addEventListener('click', async () => {
        const engine = b.dataset.engine === 'miravoz' ? 'miravoz' : 'system';
        if (engine === current.engine) return;
        current.engine = engine;
        await save();
        fill();
        if (engine === 'miravoz' && cloudVoices && current.cloudVoice) speak('Hola, esta es mi voz.');
    }));
    window.addEventListener('miravoz:cloud-voice-fallback', () => { if (current.engine === 'miravoz') fill(); });
    $('voice-rate')?.addEventListener('change', async (e) => { current.rate = Number(e.target.value); await save(); speak('Así hablo.'); });
    $('voice-pitch')?.addEventListener('change', async (e) => { current.pitch = Number(e.target.value); await save(); speak('Así hablo.'); });
    $('btn-voice-test')?.addEventListener('click', () => speak(TEST_PHRASE));
    // Quien probó la voz natural de 0.7.6: se libera el espacio que ocupaba
    try { if (typeof caches !== 'undefined') caches.delete('miravoz-voz-v1').catch(() => {}); } catch {}
}
