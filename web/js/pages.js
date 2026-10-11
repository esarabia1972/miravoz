// pages.js — Tableros con varias páginas y textos de pictogramas (10/10/2026)
//
// Un archivo .grd/.obz puede traer varios tableros vinculados entre sí (en Asterics se ven como
// tableros separados). En MiraVoz son las PÁGINAS de un mismo tablero: bundle.boards = { gridId: GridData }
// y bundle.mainBoard es la página de inicio. Acá vive la lógica pura (sin DOM) para:
//  - ordenar las páginas, agregarlas, borrarlas y elegir la de inicio;
//  - separar un archivo en tableros independientes al importar;
//  - completar el texto de los pictogramas de ARASAAC que vienen sin texto (el.autoLabel);
//  - decidir qué decir al tocar una celda (también las que navegan).

import { labelText, isLetterCell, isSpecialCell, isKeyboardPage } from './asterics.js';

const isNav = (a) => a && (a.navType === 'navigateToGrid' || a.modelName === 'GridActionNavigate') && a.toGridId;

export function gridName(grid) {
    if (!grid) return '';
    return String(labelText(grid.label) || grid.name || '').trim();
}

/** Destinos de navegación de una página, en orden de lectura (fila por fila). */
function navTargets(grid) {
    const els = [...(grid?.gridElements || [])].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const out = [];
    els.forEach(el => (el.actions || []).forEach(a => { if (isNav(a)) out.push(a.toGridId); }));
    return out;
}

/**
 * Páginas en orden útil: la de inicio primero, después las que se alcanzan navegando (en orden de
 * recorrido) y al final las sueltas. Devuelve ids.
 */
export function pageOrder(bundle) {
    const boards = bundle?.boards || {};
    const ids = Object.keys(boards);
    const seen = new Set();
    const out = [];
    const queue = [];
    if (bundle.mainBoard && boards[bundle.mainBoard]) queue.push(bundle.mainBoard);
    while (queue.length) {
        const id = queue.shift();
        if (seen.has(id) || !boards[id]) continue;
        seen.add(id);
        out.push(id);
        navTargets(boards[id]).forEach(t => { if (!seen.has(t)) queue.push(t); });
    }
    ids.forEach(id => { if (!seen.has(id)) out.push(id); });
    return out;
}

export function pageCount(bundle) { return Object.keys(bundle?.boards || {}).length; }

/** Nombre para una página nueva que no repita los existentes: "Página 2", "Página 3"… */
export function nextPageName(bundle) {
    const names = new Set(Object.values(bundle?.boards || {}).map(g => gridName(g).toLocaleLowerCase('es')));
    let n = pageCount(bundle) + 1;
    while (names.has(`página ${n}`)) n++;
    return `Página ${n}`;
}

/**
 * Borra una página: saca las acciones que navegaban a ella (la celda queda, sin ese vínculo).
 * Si era la de inicio, pasa a serlo la siguiente en orden. No borra la última página.
 * Devuelve { ok, removedLinks, newMain }.
 */
export function removePage(bundle, gridId) {
    const boards = bundle?.boards || {};
    if (!boards[gridId] || pageCount(bundle) <= 1) return { ok: false, removedLinks: 0, newMain: bundle?.mainBoard };
    const order = pageOrder(bundle).filter(id => id !== gridId);
    delete boards[gridId];
    let removedLinks = 0;
    Object.values(boards).forEach(g => (g.gridElements || []).forEach(el => {
        if (!el.actions) return;
        const before = el.actions.length;
        el.actions = el.actions.filter(a => !(isNav(a) && a.toGridId === gridId));
        removedLinks += before - el.actions.length;
    }));
    if (bundle.mainBoard === gridId) bundle.mainBoard = order[0];
    return { ok: true, removedLinks, newMain: bundle.mainBoard };
}

/** Cuántas celdas de otras páginas navegan a esta (para avisar antes de borrar). */
export function linksTo(bundle, gridId) {
    let n = 0;
    Object.entries(bundle?.boards || {}).forEach(([id, g]) => {
        if (id === gridId) return;
        (g.gridElements || []).forEach(el => (el.actions || []).forEach(a => { if (isNav(a) && a.toGridId === gridId) n++; }));
    });
    return n;
}

// --- Importación ---

const ASTERICS_BACKUP = /(^|[_\-\s])asterics[-_ ]?(aac[-_ ]?)?(custom[-_ ]?)?(grid[-_ ]?)?backup$/i;

const cleanCopySuffix = (s) => String(s || '').replace(/\s*\((copy|copia)\)\s*$/i, '').replace(/\s+/g, ' ').trim();

/**
 * Nombre del tablero al importar. Los respaldos de Asterics se llaman
 * "<usuario>_<fecha>_asterics-aac-custom-backup": en ese caso se usa el nombre de la página de inicio.
 */
export function importedName(fileName, bundle) {
    const base = String(fileName || '').replace(/\.(grd|obz)$/i, '').trim();
    if (base && !ASTERICS_BACKUP.test(base)) return base;
    return cleanCopySuffix(gridName(bundle?.boards?.[bundle.mainBoard])) || base || 'Tablero importado';
}

/**
 * Separa un tablero de varias páginas en tableros independientes (uno por página).
 * Los vínculos entre páginas se pierden: se sacan las acciones de navegación (quedan las demás).
 * makeId(i) genera el id de cada bundle nuevo.
 */
export function splitBundle(bundle, makeId) {
    const order = pageOrder(bundle);
    return order.map((gid, i) => {
        const grid = JSON.parse(JSON.stringify(bundle.boards[gid]));
        (grid.gridElements || []).forEach(el => { if (el.actions) el.actions = el.actions.filter(a => !isNav(a)); });
        const { boards: _b, mainBoard: _m, id: _i, name: _n, ...rest } = bundle;
        return {
            ...rest,
            id: makeId(i),
            name: cleanCopySuffix(gridName(grid)) || `${bundle.name} ${i + 1}`,
            mainBoard: gid,
            boards: { [gid]: grid }
        };
    });
}

// --- Textos de pictogramas de ARASAAC ---

/** Id del pictograma si la imagen es de la API de ARASAAC (null si no). */
export function arasaacIdFromUrl(url) {
    const m = /api\.arasaac\.org\/(?:api\/)?pictograms\/(\d+)/i.exec(String(url || ''));
    return m ? Number(m[1]) : null;
}

// Preferencias rioplatenses cuando ARASAAC ofrece varias palabras para el mismo pictograma
const PREFERIDAS_AR = new Set(['auto', 'colectivo', 'pileta', 'remera', 'frutilla', 'durazno', 'pochoclo',
    'heladera', 'celular', 'computadora', 'anteojos', 'pollera', 'campera', 'zapatillas', 'medias',
    'birome', 'pibe', 'nene', 'nena', 'manteca', 'palta', 'choclo', 'arvejas', 'banana', 'ananá']);

/** Elige la palabra del pictograma: la primera, salvo que otra sea la forma rioplatense. */
export function pickArasaacKeyword(keywords) {
    const list = (Array.isArray(keywords) ? keywords : []).map(k => String(k?.keyword || '').trim()).filter(Boolean);
    if (!list.length) return '';
    return list.find(k => PREFERIDAS_AR.has(k.toLocaleLowerCase('es'))) || list[0];
}

const hasText = (el) => !!String(labelText(el.label)).trim();

/** Ids de ARASAAC de las celdas que tienen pictograma pero no texto (ni texto automático). */
export function missingLabelIds(bundle) {
    const ids = new Set();
    Object.values(bundle?.boards || {}).forEach(g => (g.gridElements || []).forEach(el => {
        if (hasText(el) || (el.autoLabel && el.autoLabel.es)) return;
        const id = arasaacIdFromUrl(el.image && el.image.url);
        if (id) ids.add(id);
    }));
    return ids;
}

/** Aplica las palabras encontradas (Map id -> palabra). Devuelve cuántas celdas se completaron. */
export function applyAutoLabels(bundle, words) {
    let n = 0;
    Object.values(bundle?.boards || {}).forEach(g => (g.gridElements || []).forEach(el => {
        if (hasText(el) || (el.autoLabel && el.autoLabel.es)) return;
        const id = arasaacIdFromUrl(el.image && el.image.url);
        const w = id && words.get(id);
        if (w) { el.autoLabel = { es: w, source: 'arasaac' }; n++; }
    }));
    return n;
}

/** Busca en ARASAAC la palabra de cada pictograma (6 a la vez, 6 s máximo cada uno; los que fallan se omiten). */
export async function fetchArasaacWords(ids, fetchImpl = (typeof fetch !== 'undefined' ? fetch : null)) {
    const words = new Map();
    if (!fetchImpl) return words;
    const queue = [...ids];
    const worker = async () => {
        while (queue.length) {
            const id = queue.shift();
            const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
            try {
                const resp = await fetchImpl(`https://api.arasaac.org/api/pictograms/es/${id}`, ctrl ? { signal: ctrl.signal } : undefined);
                if (resp.ok) {
                    const w = pickArasaacKeyword((await resp.json())?.keywords);
                    if (w) words.set(id, w);
                }
            } catch { /* sin red o ARASAAC caído: la celda queda sin texto */ }
            finally { if (timer) clearTimeout(timer); }
        }
    };
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
    return words;
}

/** Completa los textos que faltan. Devuelve cuántas celdas cambiaron. */
export async function enrichAutoLabels(bundle, fetchImpl) {
    const ids = missingLabelIds(bundle);
    if (!ids.size) return 0;
    const words = await fetchArasaacWords(ids, fetchImpl);
    return applyAutoLabels(bundle, words);
}

// --- Qué se ve y qué se dice ---

/** Texto visible de la celda: el propio, o el automático solo si el tablero pide mostrarlo. */
export function visibleLabel(el, bundle) {
    const own = String(labelText(el?.label));
    if (own.trim()) return own;
    return bundle?.showAutoLabels && el?.autoLabel ? String(el.autoLabel.es || '') : '';
}

/** Texto que representa a la celda para la voz y la frase: el propio o, si no hay, el automático. */
export function cellText(el) {
    const own = String(labelText(el?.label));
    if (own.trim()) return own;
    return el?.autoLabel ? String(el.autoLabel.es || '') : '';
}

/**
 * Qué decir al tocar una celda que NAVEGA (null = nada).
 * Tableros importados sin editar: se dice su texto (p. ej. la pregunta antes de pasar a la siguiente).
 * Tableros editados en MiraVoz: se respeta la acción de voz de la celda.
 */
export function speechOnNavigate(el, speechModel) {
    const text = cellText(el);
    if (speechModel !== 'actions') return text || null;
    const actions = el?.actions || [];
    const custom = actions.find(a => a.modelName === 'GridActionSpeakCustom');
    if (custom) return labelText(custom.speakText) || text || null;
    if (actions.some(a => a.modelName === 'GridActionSpeak')) return text || null;
    return null;
}

/**
 * Al editar por primera vez un tablero importado se pasa a la voz "por acciones" (F3-3b). Para que no
 * cambie lo que la persona venía escuchando, cada celda con texto que no tenía acción de voz recibe
 * GridActionSpeak (antes, sin editar, se decía su texto; también al navegar). Devuelve cuántas cambió.
 */
export function migrateToActionSpeech(bundle) {
    if (!bundle || bundle.speechModel === 'actions') return 0;
    let n = 0;
    Object.values(bundle.boards || {}).forEach(g => { const kb = isKeyboardPage(g); (g.gridElements || []).forEach(el => {
        if (!cellText(el) || (kb && isLetterCell(el)) || isSpecialCell(el)) return; // teclas y botones especiales no hablaban
        const actions = el.actions || [];
        if (actions.some(a => a.modelName === 'GridActionSpeak' || a.modelName === 'GridActionSpeakCustom')) return;
        el.actions = [...actions, { id: 'ga-speak-mig-' + (el.id || n), modelName: 'GridActionSpeak' }];
        n++;
    }); });
    bundle.speechModel = 'actions';
    return n;
}
