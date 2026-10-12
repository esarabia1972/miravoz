// favorites.js — Frases favoritas de cada persona (0.7.5)
//
// La persona (o quien la acompaña) guarda la frase armada para decirla de nuevo con una sola selección:
// "Necesito ayuda", "Me duele", "Quiero ir al baño". No reordena ni cambia el tablero: es una lista aparte,
// en el orden en que se guardaron, que se abre con la estrella de la barra.
// Se guardan en este dispositivo, separadas por persona (person-scope.js), y viajan en el respaldo.

import { personScope } from './person-scope.js';

const PREFIX = 'miravoz_favs:';
export const MAX_FAVORITES = 24;

const keyFor = (scope) => PREFIX + scope;
const store = () => (typeof localforage !== 'undefined' ? localforage : null);

/** Texto visible de una frase (lo que se lee en la tarjeta). */
export function phraseText(items) {
    return (items || []).map(i => i && i.text).filter(Boolean).join(' ').trim();
}

/** Lo mínimo para volver a mostrar y decir la frase (sin datos internos del tablero). */
export function cleanItems(items) {
    return (Array.isArray(items) ? items : []).filter(i => i && typeof i === 'object').map(i => {
        const out = { text: String(i.text || '') };
        if (i.speakText !== undefined && i.speakText !== null) out.speakText = String(i.speakText);
        if (typeof i.imageUrl === 'string' && i.imageUrl && !i.imageUrl.startsWith('blob:')) out.imageUrl = i.imageUrl;
        const e = i.elData;
        if (e && (e.colorCategory || e.backgroundColor)) out.elData = { ...(e.colorCategory ? { colorCategory: e.colorCategory } : {}), ...(e.backgroundColor ? { backgroundColor: e.backgroundColor } : {}) };
        if (i.letters) out.letters = true;
        return out;
    }).filter(i => i.text || i.imageUrl);
}

/** Pura (para tests): agrega una frase si no está repetida y hay lugar. */
export function addTo(list, items, now = Date.now()) {
    const clean = cleanItems(items);
    const text = phraseText(clean);
    if (!clean.length) return { list, added: false, reason: 'vacia' };
    const norm = (t) => t.toLocaleLowerCase('es');
    if (list.some(f => norm(phraseText(f.items)) === norm(text))) return { list, added: false, reason: 'repetida' };
    if (list.length >= MAX_FAVORITES) return { list, added: false, reason: 'llena' };
    const id = 'f' + now.toString(36) + Math.random().toString(36).slice(2, 6);
    return { list: [...list, { id, items: clean, at: new Date(now).toISOString() }], added: true };
}

/** Valida una lista que viene de afuera (respaldo). */
export function sanitizeList(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const f of list.slice(0, MAX_FAVORITES)) {
        if (!f || typeof f !== 'object') continue;
        const items = cleanItems(f.items);
        if (!items.length) continue;
        out.push({ id: String(f.id || ('f' + out.length)), items, at: typeof f.at === 'string' ? f.at : new Date().toISOString() });
    }
    return out;
}

let cache = { scope: null, list: [] };

export async function loadFavorites(scope = personScope()) {
    if (cache.scope === scope) return cache.list;
    let list = [];
    try { list = sanitizeList(await store()?.getItem(keyFor(scope))); } catch { list = []; }
    cache = { scope, list };
    return list;
}
async function save(scope, list) {
    cache = { scope, list };
    try { await store()?.setItem(keyFor(scope), list); } catch { /* sin espacio: queda en memoria */ }
}

export async function addFavorite(items) {
    const scope = personScope();
    const list = await loadFavorites(scope);
    const r = addTo(list, items);
    if (r.added) await save(scope, r.list);
    return r;
}
export async function removeFavorite(id) {
    const scope = personScope();
    const list = await loadFavorites(scope);
    await save(scope, list.filter(f => f.id !== id));
}

/** Para el respaldo: todas las listas guardadas en este dispositivo, por persona. */
export async function allFavorites() {
    const out = {};
    const s = store();
    if (!s || !s.keys) return out;
    try {
        for (const k of await s.keys()) if (k.startsWith(PREFIX)) out[k.slice(PREFIX.length)] = sanitizeList(await s.getItem(k));
    } catch {}
    return out;
}
/** Restaurar: se suman a las que ya hay (sin repetir). Devuelve cuántas se agregaron. */
export async function mergeFavorites(scope, incoming) {
    let list = await loadFavorites(scope);
    let n = 0;
    for (const f of sanitizeList(incoming)) { const r = addTo(list, f.items); if (r.added) { list = r.list; n++; } }
    await save(scope, list);
    return n;
}
