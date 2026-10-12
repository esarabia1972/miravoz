// protected-mode.js — Modo Mirada y Modo protegido (0.7.8)
//
// Modo Mirada: se elige con el Seguimiento ocular del propio dispositivo (en iPad: Accesibilidad → Seguimiento
// ocular). MiraVoz no usa su cámara: funciona como Manual, porque el sistema "toca" por la persona.
// Al entrar se activa el Modo protegido: pantalla completa y solo quedan los tableros, Practicar y las
// etiquetas; se ocultan el selector de modo, Recalibrar, Configuración, buscar, ordenar y todo lo que edita.
// Para salir: botón "Salir" + confirmación.
//
// Límites (de la plataforma, no de MiraVoz): una web no puede prender el Seguimiento ocular ni abrir su
// calibración. Tampoco puede saber con certeza si está activo: si en unos segundos no llega ningún movimiento
// de puntero (el del Seguimiento ocular, un mouse o un trackpad), se avisa cómo activarlo.

import { customConfirm } from './ui.js';

let active = false;
let hooks = { onExit: () => {} };
let detectTimer = null, sawPointer = false, banner = null;

export const isProtected = () => active;
export function initProtectedMode(h = {}) {
    hooks = { ...hooks, ...h };
    document.getElementById('btn-exit-protected')?.addEventListener('click', async () => {
        const ok = await customConfirm('¿Salir del modo protegido? Vuelven a verse la configuración, los modos y las herramientas de edición.');
        if (ok) { exitProtected(); hooks.onExit(); }
    });
    // Puntero que se mueve sin tocar: el del Seguimiento ocular (o un mouse/trackpad)
    window.addEventListener('pointermove', (e) => { if (e.pointerType && e.pointerType !== 'touch') { sawPointer = true; hideBanner(); } }, { passive: true });
}

function requestFullscreen() {
    const el = document.documentElement;
    const fs = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fs || document.fullscreenElement || document.webkitFullscreenElement) return;
    try { const p = fs.call(el); if (p && p.catch) p.catch(() => {}); } catch { /* sin pantalla completa: igual protegido */ }
}
function exitFullscreen() {
    const fs = document.exitFullscreen || document.webkitExitFullscreen;
    if (fs && (document.fullscreenElement || document.webkitFullscreenElement)) { try { const p = fs.call(document); if (p && p.catch) p.catch(() => {}); } catch {} }
}
// Si al arrancar no se pudo (hace falta un gesto), se pide en el primer toque o selección
const retryFullscreen = () => { if (active) requestFullscreen(); };

function showBanner() {
    if (banner || sawPointer || !active) return;
    banner = document.createElement('div');
    banner.className = 'protected-banner';
    banner.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = 'No se detecta el Seguimiento ocular. En iPad: Ajustes → Accesibilidad → Seguimiento ocular (o tres clics en el botón de arriba si está configurado el atajo).';
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'btn btn-secondary'; close.textContent = 'Entendido';
    close.onclick = hideBanner;
    banner.append(text, close);
    document.body.appendChild(banner);
}
function hideBanner() { banner?.remove(); banner = null; }

export function enterProtected({ checkPointer = true } = {}) {
    if (!active) {
        active = true;
        document.body.classList.add('protected-mode');
        window.addEventListener('pointerdown', retryFullscreen, true);
        window.addEventListener('click', retryFullscreen, true);
    }
    requestFullscreen();
    clearTimeout(detectTimer);
    if (checkPointer && !sawPointer) detectTimer = setTimeout(showBanner, 8000);
}

export function exitProtected() {
    if (!active) return;
    active = false;
    clearTimeout(detectTimer);
    hideBanner();
    document.body.classList.remove('protected-mode');
    window.removeEventListener('pointerdown', retryFullscreen, true);
    window.removeEventListener('click', retryFullscreen, true);
    exitFullscreen();
}
