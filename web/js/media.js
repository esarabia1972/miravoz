// media.js — Radio por internet, páginas web y audios grabados de los tableros de Asterics (10/10/2026)
//
// Radio: las emisoras vienen en grid.webRadios ({ radioId, radioName, radioUrl }). Las acciones son
// iniciar, alternar, siguiente, anterior y volumen. Los streams http:// no suenan desde una página https
// (lo bloquea el navegador): se avisa en vez de fallar en silencio.
// Página web: se muestra encima del tablero con un botón grande "Volver" y vuelve sola después de
// timeoutSeconds (como Asterics), porque con la mirada no se puede usar una pestaña nueva.

import { showInfoToast } from './ui.js';
import { selectionContexts, buttonTargets } from './contexts.js';

let radio = null;          // HTMLAudioElement
let radioList = [];        // emisoras del tablero abierto
let radioIndex = -1;

/** Emisoras de todas las páginas del tablero (sin repetir). */
export function bundleRadios(bundle) {
    const seen = new Set();
    const out = [];
    Object.values(bundle?.boards || {}).forEach(g => (g.webRadios || []).forEach(r => {
        const id = r.radioId || r.radioUUID;
        if (!id || seen.has(id) || !r.radioUrl) return;
        seen.add(id);
        out.push({ id, name: String(r.radioName || 'Radio').trim(), url: r.radioUrl });
    }));
    return out;
}

function playAt(i) {
    if (!radioList.length) { showInfoToast('Este tablero no tiene radios cargadas.'); return; }
    radioIndex = (i + radioList.length) % radioList.length;
    const st = radioList[radioIndex];
    if (!/^https?:\/\//i.test(st.url)) { showInfoToast(`La radio «${st.name}» no tiene una dirección válida.`); return; }
    if (/^http:\/\//i.test(st.url) && typeof location !== 'undefined' && location.protocol === 'https:') {
        showInfoToast(`La radio «${st.name}» usa una dirección http:// que el navegador bloquea.`);
        return;
    }
    stopRadio();
    radio = new Audio(st.url);
    radio.volume = 0.8;
    radio.play().then(() => showInfoToast(`Radio: ${st.name}`, 2500))
        .catch(() => showInfoToast(`No se pudo reproducir «${st.name}».`));
}

export function stopRadio() {
    if (radio) { try { radio.pause(); radio.src = ''; } catch {} radio = null; }
}

export function isRadioPlaying() { return !!radio && !radio.paused; }

/** Ejecuta una acción GridActionWebradio. */
export function radioAction(action, bundle) {
    radioList = bundleRadios(bundle);
    const byId = (id) => radioList.findIndex(r => r.id === id);
    switch (action.action) {
        case 'WEBRADIO_ACTION_START': {
            const i = byId(action.radioId);
            playAt(i >= 0 ? i : 0);
            break;
        }
        case 'WEBRADIO_ACTION_STOP': stopRadio(); break;
        case 'WEBRADIO_ACTION_TOGGLE':
            if (isRadioPlaying()) stopRadio();
            else playAt(action.radioId && byId(action.radioId) >= 0 ? byId(action.radioId) : Math.max(0, radioIndex));
            break;
        case 'WEBRADIO_ACTION_NEXT': playAt(radioIndex + 1); break;
        case 'WEBRADIO_ACTION_PREV': playAt(radioIndex - 1); break;
        case 'WEBRADIO_ACTION_VOLUP': if (radio) radio.volume = Math.min(1, radio.volume + 0.15); break;
        case 'WEBRADIO_ACTION_VOLDOWN': if (radio) radio.volume = Math.max(0, radio.volume - 0.15); break;
        default: break;
    }
}

// --- Página web ---
let webTimer = null;

// Mientras la página está abierta, la mirada y el barrido apuntan SOLO al botón "Volver" (contexto M03)
let webToken = null;

export function closeWebpage() {
    if (webTimer) { clearTimeout(webTimer); webTimer = null; }
    const ov = document.getElementById('webpage-overlay');
    if (ov) ov.remove();
    if (webToken !== null) { selectionContexts.pop(webToken); webToken = null; }
}

/** Muestra una página web encima del tablero (solo http/https). */
export function openWebpage(action) {
    const url = String(action.openURL || '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    try { if (new URL(url).origin === location.origin) return; } catch { return; } // nunca el propio MiraVoz
    closeWebpage();
    const ov = document.createElement('div');
    ov.id = 'webpage-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'Página web');
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn btn-primary webpage-back';
    back.textContent = 'Volver al tablero';
    back.onclick = closeWebpage;
    const frame = document.createElement('iframe');
    frame.src = url;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin'); // sin ventanas nuevas (no se usan con la mirada)
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.title = url;
    const note = document.createElement('p');
    note.className = 'webpage-note';
    note.textContent = 'Si la página queda en blanco, ese sitio no permite mostrarse dentro de otra aplicación.';
    ov.append(back, frame, note);
    document.body.appendChild(ov);
    // Vuelve sola (como Asterics). Sin tiempo configurado: 60 s, para que nadie quede atrapado
    const secs = Number(action.timeoutSeconds) > 0 ? Math.min(Number(action.timeoutSeconds), 600) : 60;
    webTimer = setTimeout(closeWebpage, secs * 1000);
    webToken = selectionContexts.push('webpage', () => buttonTargets([back]), { element: ov });
}

// --- Audio grabado (GridActionAudio) ---
let currentAudio = null;

export function stopRecordedAudio() { if (currentAudio) { try { currentAudio.pause(); } catch {} currentAudio = null; } }

export function playRecordedAudio(action) {
    const data = String(action.dataBase64 || '');
    if (!data) return false;
    const src = data.startsWith('data:') ? data : `data:${action.mimeType || 'audio/webm'};base64,${data}`;
    try {
        if (currentAudio) currentAudio.pause();
        currentAudio = new Audio(src);
        currentAudio.play().catch(() => {});
        return true;
    } catch { return false; }
}
