// favorites-ui.js — Pantalla "Favoritas" encima del tablero (0.7.5).
// Se elige con el mismo acceso que el tablero (permanencia, parpadeo, barrido o toque): es un contexto de
// selección propio (contexts.js), así el tablero de abajo no se activa mientras está abierta.
// Los textos de las frases van siempre con textContent.

import { loadFavorites, addFavorite, removeFavorite, phraseText, MAX_FAVORITES } from './favorites.js';
import { getSentence, setSentence, playSentence, showInfoToast } from './ui.js';
import { selectionContexts, buttonTargets } from './contexts.js';

let overlay = null, token = null, removing = false;
let hooks = { onSpoken: () => {} };
export function initFavoritesUI(h = {}) { hooks = { ...hooks, ...h }; }
export function isFavoritesOpen() { return !!overlay; }

function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function btn(cls, text, onClick, aria) {
    const b = el('button', cls, text);
    b.type = 'button';
    if (aria) b.setAttribute('aria-label', aria);
    b.addEventListener('click', onClick);
    return b;
}

export async function openFavorites() {
    if (overlay) return;
    removing = false;
    overlay = el('div', 'favorites-overlay');
    overlay.id = 'favorites-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Frases favoritas');
    document.body.appendChild(overlay);
    const mine = overlay;
    token = selectionContexts.push('favoritas', () => buttonTargets([...mine.querySelectorAll('button')]), { element: mine });
    await render();
}

export function closeFavorites() {
    if (!overlay) return;
    overlay.remove(); overlay = null;
    if (token !== null) { selectionContexts.pop(token); token = null; }
}

async function render() {
    if (!overlay) return;
    const list = await loadFavorites();
    if (!overlay) return; // se cerró mientras cargaba
    const current = getSentence();
    const currentText = phraseText(current).toLocaleLowerCase('es');
    const already = currentText && list.some(f => phraseText(f.items).toLocaleLowerCase('es') === currentText);
    overlay.replaceChildren();

    const head = el('div', 'favorites-head');
    head.appendChild(btn('btn btn-secondary favorites-btn', 'Volver', closeFavorites, 'Volver al tablero'));
    head.appendChild(el('h2', 'favorites-title', removing ? 'Elegí la frase que querés quitar' : 'Favoritas'));
    const actions = el('div', 'favorites-actions');
    if (!removing && current.length && !already && list.length < MAX_FAVORITES) {
        actions.appendChild(btn('btn btn-primary favorites-btn', 'Guardar la frase', async () => {
            const r = await addFavorite(current);
            showInfoToast(r.added ? 'Frase guardada en Favoritas.' : r.reason === 'llena' ? `Ya hay ${MAX_FAVORITES} favoritas: quitá una para guardar otra.` : 'Esa frase ya está en Favoritas.');
            render();
        }, `Guardar «${phraseText(current)}» en Favoritas`));
    }
    if (list.length) {
        actions.appendChild(btn('btn btn-secondary favorites-btn' + (removing ? ' is-on' : ''), removing ? 'No quitar' : 'Quitar una', () => { removing = !removing; render(); },
            removing ? 'Cancelar: no quitar ninguna' : 'Quitar una frase de Favoritas'));
    }
    head.appendChild(actions);
    overlay.appendChild(head);

    if (!list.length) {
        overlay.appendChild(el('p', 'favorites-empty', current.length
            ? 'Todavía no hay frases favoritas. "Guardar la frase" guarda la que está armada arriba para decirla de nuevo con una sola selección.'
            : 'Todavía no hay frases favoritas. Armá una frase en el tablero y volvé acá para guardarla.'));
    } else {
        const grid = el('div', 'favorites-grid' + (removing ? ' is-removing' : ''));
        for (const f of list) {
            const text = phraseText(f.items);
            const card = btn('favorite-card', null, async () => {
                if (removing) {
                    await removeFavorite(f.id);
                    removing = false;
                    showInfoToast(`Se quitó «${text}» de Favoritas.`);
                    render();
                    return;
                }
                setSentence(f.items);
                hooks.onSpoken(getSentence());
                playSentence();
                closeFavorites();
            }, removing ? `Quitar «${text}»` : `Decir «${text}»`);
            card.dataset.word = text;
            const pics = el('div', 'favorite-pics');
            f.items.filter(i => i.imageUrl).slice(0, 4).forEach(i => {
                const img = document.createElement('img');
                img.src = i.imageUrl; img.alt = ''; img.loading = 'lazy';
                pics.appendChild(img);
            });
            if (pics.childElementCount) card.appendChild(pics);
            card.appendChild(el('span', 'favorite-text', text));
            grid.appendChild(card);
        }
        overlay.appendChild(grid);
    }
    // Los objetivos cambiaron: el contexto de arriba se vuelve a leer
    if (token !== null) selectionContexts.refresh(token);
}
