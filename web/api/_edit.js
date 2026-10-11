// api/_edit.js — Edición de tableros para el servidor MCP (etapa 2 · 1.7.0) · PURO (sin red), testeable con Node.
//
// Mismo formato que crea el editor de MiraVoz (editor.js): GRD de Asterics con bundle.boards = páginas,
// voz por acciones (speechModel 'actions'), colores Fitzgerald (colorCategory) y pictogramas de ARASAAC por URL.
// Así un tablero hecho desde Claude es idéntico a uno hecho en la consola y sigue siendo compatible con Asterics.
// Todas las funciones MUTAN el bundle que reciben y devuelven un resumen de lo que hicieron.

import { labelText } from '../js/asterics.js';
import { pageOrder, gridName, removePage as removePageFn, nextPageName } from '../js/pages.js';

export const LIMITS = { maxRows: 12, maxCols: 16, maxCellsPerCall: 120, maxText: 80 };

// Colores que ofrece el editor de MiraVoz (index.html, #ce-color)
export const COLORS = {
    amarillo: 'CC_PRONOUN_PERSON_NAME', verde: 'CC_VERB', azul: 'CC_DESCRIPTOR', naranja: 'CC_NOUN',
    rojo: 'CC_IMPORTANT', rosa: 'CC_SOCIAL_EXPRESSIONS', violeta: 'CC_PLACE', gris: 'CC_OTHERS'
};
export const COLOR_LABELS = {
    CC_PRONOUN_PERSON_NAME: 'amarillo (personas/pronombres)', CC_VERB: 'verde (verbos)', CC_DESCRIPTOR: 'azul (descriptores)',
    CC_NOUN: 'naranja (sustantivos)', CC_IMPORTANT: 'rojo (importante)', CC_SOCIAL_EXPRESSIONS: 'rosa (expresiones sociales)',
    CC_PLACE: 'violeta (lugares)', CC_OTHERS: 'gris (otros)'
};
const norm = (s) => String(s ?? '').trim().toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');

export class EditError extends Error {}
const fail = (m) => { throw new EditError(m); };

let seq = 0;
const uid = (p) => `${p}-${Date.now()}-${(++seq).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export function colorKey(c) {
    if (c === null || c === undefined || c === '') return null;
    if (/^CC_/.test(c)) return c;
    const k = COLORS[norm(c).replace(/[^a-z]/g, '')];
    if (!k) fail(`Color desconocido: "${c}". Opciones: ${Object.keys(COLORS).join(', ')} o "ninguno".`);
    return k;
}

export function arasaacUrl(id) { return `https://api.arasaac.org/api/pictograms/${id}?download=false&plural=false&color=true`; }
export function arasaacImage(id) {
    return { id: uid('grid-image'), modelName: 'GridImage', url: arasaacUrl(id),
        author: 'Sergio Palao / ARASAAC', authorURL: 'https://arasaac.org/terms-of-use', searchProviderName: 'ARASAAC' };
}

export function newGrid(name, rows = 3, cols = 4) {
    return { id: uid('grid'), modelName: 'GridData', modelVersion: '{"major": 7, "minor": 0, "patch": 0}',
        label: { es: String(name || 'Página') }, rowCount: clampInt(rows, 1, LIMITS.maxRows, 3), minColumnCount: clampInt(cols, 1, LIMITS.maxCols, 4),
        gridElements: [], lastUpdateTime: Date.now() };
}

function clampInt(v, min, max, def) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return def;
    if (n < min || n > max) fail(`El valor ${v} está fuera de rango (${min} a ${max}).`);
    return n;
}

export function newBundle({ nombre, filas = 3, columnas = 4, etiquetas = [] }) {
    const name = String(nombre || '').trim().slice(0, 60) || 'Mi tablero';
    const g = newGrid(name, filas, columnas);
    return { id: 'bundle_' + Date.now() + Math.floor(Math.random() * 1000), name, type: 'grd', importerVersion: 1, speechModel: 'actions',
        mainBoard: g.id, boards: { [g.id]: g }, tags: cleanTags(etiquetas) };
}

export function cleanTags(tags) {
    const out = [];
    for (const t of Array.isArray(tags) ? tags : []) {
        const s = String(t || '').trim().slice(0, 30);
        if (s && !out.some(x => norm(x) === norm(s))) out.push(s);
    }
    return out.slice(0, 10);
}

/** Página por id o nombre (sin distinguir mayúsculas ni tildes); sin referencia = la de inicio. */
export function resolvePage(bundle, ref) {
    const boards = bundle.boards || {};
    if (ref === undefined || ref === null || ref === '') return bundle.mainBoard;
    if (boards[ref]) return ref;
    const q = norm(ref);
    const ids = pageOrder(bundle);
    const exact = ids.find(id => norm(gridName(boards[id])) === q);
    if (exact) return exact;
    const partial = ids.filter(id => norm(gridName(boards[id])).includes(q));
    if (partial.length === 1) return partial[0];
    fail(partial.length > 1
        ? `"${ref}" coincide con varias páginas: ${partial.map(id => gridName(boards[id])).join(', ')}.`
        : `No hay una página "${ref}". Páginas: ${ids.map(id => gridName(boards[id])).join(', ')}.`);
}

const cellAt = (grid, x, y) => (grid.gridElements || []).find(e => x >= (e.x || 0) && x < (e.x || 0) + (e.width || 1) && y >= (e.y || 0) && y < (e.y || 0) + (e.height || 1));

/** Agranda la grilla si una celda queda afuera (dentro de los límites). Devuelve true si cambió. */
function fitGrid(grid, x, y, w = 1, h = 1) {
    let changed = false;
    if (y + h > (grid.rowCount || 1)) { if (y + h > LIMITS.maxRows) fail(`La fila ${y + h} supera el máximo (${LIMITS.maxRows}).`); grid.rowCount = y + h; changed = true; }
    if (x + w > (grid.minColumnCount || 1)) { if (x + w > LIMITS.maxCols) fail(`La columna ${x + w} supera el máximo (${LIMITS.maxCols}).`); grid.minColumnCount = x + w; changed = true; }
    return changed;
}

function navAction(bundle, target, cellText) {
    const t = norm(target);
    if (t === 'volver') return { action: { id: uid('ga-nav'), modelName: 'GridActionNavigate', navType: 'navigateToLastOpenedGrid' } };
    if (t === 'inicio') return { action: { id: uid('ga-nav'), modelName: 'GridActionNavigate', navType: 'navigateToHomeGrid' } };
    if (t === 'nueva' || t.startsWith('nueva:')) {
        const name = String(target).includes(':') ? String(target).split(':').slice(1).join(':').trim() : (cellText || nextPageName(bundle));
        const g = newGrid(name || nextPageName(bundle));
        bundle.boards[g.id] = g;
        return { action: { id: uid('ga-nav'), modelName: 'GridActionNavigate', navType: 'navigateToGrid', toGridId: g.id }, created: { id: g.id, nombre: gridName(g) } };
    }
    const to = resolvePage(bundle, target);
    return { action: { id: uid('ga-nav'), modelName: 'GridActionNavigate', navType: 'navigateToGrid', toGridId: to } };
}

const SPEAK = ['GridActionSpeak', 'GridActionSpeakCustom'];
const isNavA = (a) => a.modelName === 'GridActionNavigate' || a.navType === 'navigateToGrid';

/**
 * Crea o modifica la celda en (fila, columna) de una página (1-based). Solo cambia lo que se indica.
 * spec: { fila, columna, texto?, pictograma_id?, sin_pictograma?, color?, dice?, silenciosa?, navega_a?, ancho?, alto? }
 */
export function setCell(bundle, pageId, spec) {
    const grid = bundle.boards[pageId];
    if (!grid) fail('Página inexistente.');
    const x = clampInt(spec.columna, 1, LIMITS.maxCols, 1) - 1, y = clampInt(spec.fila, 1, LIMITS.maxRows, 1) - 1;
    const w = spec.ancho ? clampInt(spec.ancho, 1, LIMITS.maxCols, 1) : null, h = spec.alto ? clampInt(spec.alto, 1, LIMITS.maxRows, 1) : null;
    let el = cellAt(grid, x, y);
    const created = !el;
    if (el && (el.x !== x || el.y !== y)) fail(`La posición fila ${y + 1}, columna ${x + 1} está ocupada por una celda más grande ("${labelText(el.label)}"), que empieza en fila ${el.y + 1}, columna ${el.x + 1}.`);
    if (!el) {
        el = { id: uid('grid-element'), modelName: 'GridElement', width: 1, height: 1, x, y, label: {}, actions: [{ id: uid('ga-speak'), modelName: 'GridActionSpeak' }], wordForms: [], pronunciation: {} };
        grid.gridElements = grid.gridElements || [];
        grid.gridElements.push(el);
    }
    const W = w ?? (el.width || 1), H = h ?? (el.height || 1);
    // Una celda más grande no puede pisar otras
    for (let yy = y; yy < y + H; yy++) for (let xx = x; xx < x + W; xx++) {
        const other = cellAt(grid, xx, yy);
        if (other && other !== el) fail(`Con tamaño ${W}x${H} la celda pisaría a "${labelText(other.label) || 'otra celda'}" (fila ${yy + 1}, columna ${xx + 1}).`);
    }
    const grew = fitGrid(grid, x, y, W, H);
    el.width = W; el.height = H;
    if (spec.texto !== undefined) {
        const t = String(spec.texto ?? '');
        el.label = { es: t.trim() === '' && t.length > 0 ? ' ' : t.trim().slice(0, LIMITS.maxText) };
        delete el.autoLabel;
    }
    if (spec.color !== undefined) { const k = colorKey(spec.color === 'ninguno' ? null : spec.color); if (k) el.colorCategory = k; else delete el.colorCategory; }
    if (spec.pictograma_id) el.image = arasaacImage(Number(spec.pictograma_id));
    if (spec.sin_pictograma) delete el.image;
    let others = (el.actions || []).filter(a => !SPEAK.includes(a.modelName) && !isNavA(a));
    let speak = (el.actions || []).filter(a => SPEAK.includes(a.modelName));
    let nav = (el.actions || []).filter(isNavA);
    if (spec.silenciosa === true) speak = [];
    if (typeof spec.dice === 'string') speak = spec.dice.trim() ? [{ id: uid('ga-speakc'), modelName: 'GridActionSpeakCustom', speakText: { es: spec.dice.trim().slice(0, 200) } }] : [{ id: uid('ga-speak'), modelName: 'GridActionSpeak' }];
    if (spec.silenciosa === false && !speak.length) speak = [{ id: uid('ga-speak'), modelName: 'GridActionSpeak' }];
    let newPage = null;
    if (spec.navega_a !== undefined) {
        if (spec.navega_a === null || norm(spec.navega_a) === 'ninguna' || spec.navega_a === '') nav = [];
        else { const r = navAction(bundle, spec.navega_a, labelText(el.label)); nav = [r.action]; newPage = r.created || null; }
    }
    el.actions = [...others, ...speak, ...nav];
    grid.lastUpdateTime = Date.now();
    return { creada: created, fila: y + 1, columna: x + 1, grilla_ampliada: grew, ...(newPage ? { pagina_nueva: newPage } : {}) };
}

export function clearCell(bundle, pageId, fila, columna) {
    const grid = bundle.boards[pageId];
    const x = Number(columna) - 1, y = Number(fila) - 1;
    const el = cellAt(grid, x, y);
    if (!el) fail(`No hay ninguna celda en fila ${fila}, columna ${columna}.`);
    grid.gridElements = grid.gridElements.filter(e => e !== el);
    grid.lastUpdateTime = Date.now();
    return { borrada: labelText(el.label) || '(sin texto)' };
}

/** Mueve una celda; si el destino está ocupado por una celda del mismo tamaño, las intercambia. */
export function moveCell(bundle, pageId, from, to) {
    const grid = bundle.boards[pageId];
    const fx = Number(from.columna) - 1, fy = Number(from.fila) - 1, tx = clampInt(to.columna, 1, LIMITS.maxCols, 1) - 1, ty = clampInt(to.fila, 1, LIMITS.maxRows, 1) - 1;
    const a = cellAt(grid, fx, fy);
    if (!a) fail(`No hay ninguna celda en fila ${from.fila}, columna ${from.columna}.`);
    const b = cellAt(grid, tx, ty);
    if (b === a) return { movida: false };
    if (b && ((b.width || 1) !== (a.width || 1) || (b.height || 1) !== (a.height || 1) || b.x !== tx || b.y !== ty)) fail('El destino está ocupado por una celda de otro tamaño: mové esa primero.');
    fitGrid(grid, tx, ty, a.width || 1, a.height || 1);
    if (b) { b.x = a.x; b.y = a.y; }
    a.x = tx; a.y = ty;
    grid.lastUpdateTime = Date.now();
    return { movida: true, intercambiada: !!b };
}

export function addPage(bundle, { nombre, filas, columnas, copiar_tamano_de } = {}) {
    let rows = filas, cols = columnas;
    if ((rows === undefined || cols === undefined) && copiar_tamano_de !== undefined) {
        const ref = bundle.boards[resolvePage(bundle, copiar_tamano_de)];
        rows ??= ref.rowCount; cols ??= ref.minColumnCount;
    }
    const main = bundle.boards[bundle.mainBoard];
    const g = newGrid(String(nombre || '').trim() || nextPageName(bundle), rows ?? main?.rowCount ?? 3, cols ?? main?.minColumnCount ?? 4);
    if (Object.values(bundle.boards).some(x => norm(gridName(x)) === norm(gridName(g)))) fail(`Ya hay una página "${gridName(g)}".`);
    bundle.boards[g.id] = g;
    return { id: g.id, nombre: gridName(g), filas: g.rowCount, columnas: g.minColumnCount };
}

export function editPage(bundle, pageId, { nombre, filas, columnas, inicio } = {}) {
    const g = bundle.boards[pageId];
    const out = {};
    if (nombre !== undefined) {
        const n = String(nombre).trim();
        if (!n) fail('El nombre de la página no puede quedar vacío.');
        if (Object.entries(bundle.boards).some(([id, x]) => id !== pageId && norm(gridName(x)) === norm(n))) fail(`Ya hay otra página "${n}".`);
        g.label = { es: n }; out.nombre = n;
    }
    const els = g.gridElements || [];
    if (filas !== undefined) {
        const r = clampInt(filas, 1, LIMITS.maxRows, g.rowCount);
        const out_ = els.filter(e => (e.y || 0) + (e.height || 1) > r);
        if (out_.length) fail(`Con ${r} filas quedarían afuera ${out_.length} celda(s) (por ejemplo "${labelText(out_[0].label)}"). Movelas o borralas primero.`);
        g.rowCount = r; out.filas = r;
    }
    if (columnas !== undefined) {
        const c = clampInt(columnas, 1, LIMITS.maxCols, g.minColumnCount);
        const out_ = els.filter(e => (e.x || 0) + (e.width || 1) > c);
        if (out_.length) fail(`Con ${c} columnas quedarían afuera ${out_.length} celda(s) (por ejemplo "${labelText(out_[0].label)}"). Movelas o borralas primero.`);
        g.minColumnCount = c; out.columnas = c;
    }
    if (inicio === true) { bundle.mainBoard = pageId; out.inicio = true; }
    g.lastUpdateTime = Date.now();
    return out;
}

export function deletePage(bundle, pageId) {
    const name = gridName(bundle.boards[pageId]);
    const r = removePageFn(bundle, pageId);
    if (!r.ok) fail('No se puede borrar la única página del tablero.');
    return { borrada: name, vinculos_quitados: r.removedLinks, inicio: gridName(bundle.boards[bundle.mainBoard]) };
}

/** Copia independiente (ids de páginas nuevos, vínculos internos reescritos). */
export function duplicateBundle(src, nombre) {
    const copy = JSON.parse(JSON.stringify(src));
    const map = {};
    const boards = {};
    for (const [id, g] of Object.entries(copy.boards || {})) { const nid = uid('grid'); map[id] = nid; boards[nid] = { ...g, id: nid }; }
    for (const g of Object.values(boards)) for (const el of g.gridElements || []) for (const a of el.actions || []) if (a.toGridId && map[a.toGridId]) a.toGridId = map[a.toGridId];
    const out = { ...copy, id: 'bundle_' + Date.now() + Math.floor(Math.random() * 1000), name: String(nombre || `${src.name} (copia)`).slice(0, 60), boards, mainBoard: map[copy.mainBoard] || Object.keys(boards)[0] };
    for (const k of ['ownerId', 'syncedAt', 'updatedAt', 'assignmentId', 'permission', 'profEdit']) delete out[k];
    return out;
}

/** Revisión de calidad (solo lectura): vínculos rotos, páginas sueltas, celdas sin pictograma o sin texto, repetidos. */
export function reviewBundle(bundle) {
    const boards = bundle.boards || {};
    const order = pageOrder(bundle);
    const reachable = new Set();
    const q = [bundle.mainBoard];
    while (q.length) { const id = q.shift(); if (!boards[id] || reachable.has(id)) continue; reachable.add(id); for (const el of boards[id].gridElements || []) for (const a of el.actions || []) if (a.toGridId) q.push(a.toGridId); }
    const issues = [];
    for (const id of order) {
        const g = boards[id], page = gridName(g);
        const seen = new Map();
        const cols = g.minColumnCount || 1, rows = g.rowCount || 1;
        let used = 0;
        for (const el of g.gridElements || []) {
            used += (el.width || 1) * (el.height || 1);
            const where = `"${page}", fila ${(el.y || 0) + 1}, columna ${(el.x || 0) + 1}`;
            const text = labelText(el.label) || el.autoLabel || '';
            for (const a of el.actions || []) if (a.toGridId && !boards[a.toGridId]) issues.push({ tipo: 'vínculo roto', donde: where, celda: text });
            if (!text.trim() && !el.image) issues.push({ tipo: 'celda vacía', donde: where });
            else if (!el.image && text.trim().length > 1) issues.push({ tipo: 'sin pictograma', donde: where, celda: text });
            const k = norm(text);
            if (k && k.length > 1) { if (seen.has(k)) issues.push({ tipo: 'repetida en la página', donde: where, celda: text }); else seen.set(k, true); }
        }
        if (!reachable.has(id)) issues.push({ tipo: 'página a la que no se llega navegando', donde: `"${page}"` });
        const free = cols * rows - used;
        if (free > 0) issues.push({ tipo: 'lugares libres', donde: `"${page}"`, cantidad: free });
    }
    return { paginas: order.length, observaciones: issues.slice(0, 200), total: issues.length };
}
