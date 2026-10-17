// boards.js — Import GRD/OBZ, gestión de bundles, render de tableros (SPEC F1-1)

import { S } from './state.js';
import { customAlert, customConfirm, addToSentence, showUndoToast, showInfoToast, addLetter, completeWord, removeChar,
    popSentence, clearSentence, playSentence, toggleInSentence, sentenceText, currentPrefix, getSentence, onSentenceChange } from './ui.js';
import { speak, prefetchSpeech } from './speech.js';
import { getCellColor } from './colors.js';
import { saveBundle, removeBundle, isVisibleTo, pushBundle } from './sync.js';
import { bundleTime } from './sync-plan.js';
import { labelText, ELEMENT, COLLECT, navInfo, navigates, isUsable, unsupportedFeatures, isSpecialCell, isLetterCell,
    customSpeech, speakLanguage, audioAction, normalizeGrd, analyzeBundle, compatibilityMessage, isKeyboardPage, keyboardLowercase, collectActions } from './asterics.js';
import { suggest } from './prediction.js';
import * as gridEdit from './grid-edit.js';
import { radioAction, openWebpage, playRecordedAudio, stopRecordedAudio, stopRadio, closeWebpage } from './media.js';
import { importedName, splitBundle, fetchArasaacWords, applyAutoLabels, missingLabelIds, visibleLabel, cellText, speechOnNavigate, pageCount } from './pages.js';

export const IMPORTER_VERSION = 1;

// Hooks que instala main.js (evita dependencias circulares)
export const hooks = {
    onBundleOpened: () => {},     // decide calibración/estado tras abrir
    onGridRendered: () => {},     // main pasa los targets al DwellEngine
    onHomeRendered: () => {},     // ídem para las cards del home
    cellClickInterceptor: () => false, // editor (F3): true = consumió el click
    emptyCellClick: () => {},     // editor (F3): click en celda vacía
    isEditMode: () => false,      // editor (F3)
    onCellActivated: () => {},    // notificación de selección (benchmark F1-7)
    onCellDropped: () => {},      // editor (F3)
    onPageRendered: () => {},     // editor: actualiza la franja de páginas
    cellContextMenu: () => false, // 0.8.1 editor: botón derecho sobre una celda (true = lo manejó)
    onCellResize: () => {}        // 0.8.1c editor: tamaño nuevo al arrastrar la esquina
};

const gridContainer = document.getElementById('grid-container');
const boardList = document.getElementById('board-list');

export let activeGridElements = [];
export let activeHomeElements = [];

// --- Utilidades compartidas de import ---

function isNavigateAction(action) {
    return (action.navType === 'navigateToGrid' || action.modelName === 'GridActionNavigate') && action.toGridId;
}

// Inferencia del tablero raíz en bundles multipágina: el grid no referenciado
// por ninguna acción de navegación es el candidato a raíz.
function inferMainBoard(bundle) {
    if (Object.keys(bundle.boards).length <= 1) return;
    const referenced = new Set();
    Object.values(bundle.boards).forEach(board => {
        (board.gridElements || []).forEach(el => {
            (el.actions || []).forEach(action => {
                if (isNavigateAction(action)) referenced.add(action.toGridId);
            });
        });
    });
    const unreferenced = Object.keys(bundle.boards).filter(id => !referenced.has(id));
    if (unreferenced.length === 1) {
        bundle.mainBoard = unreferenced[0];
    } else if (unreferenced.length > 1) {
        // Entre los candidatos, el que lleva a más páginas (un teclado suelto o una copia vieja llevan a pocas)
        const scored = unreferenced.map(id => ({ id, n: reachableFrom(bundle, id).size }));
        const best = Math.max(...scored.map(x => x.n));
        if (best > 1) {
            const top = scored.filter(x => x.n === best);
            if (top.length === 1) { bundle.mainBoard = top[0].id; return; }
            unreferenced.splice(0, unreferenced.length, ...top.map(x => x.id));
        }
        const bundleName = bundle.name.toLowerCase();
        const bestMatch = unreferenced.find(id => {
            let boardName = bundle.boards[id].name || '';
            if (!boardName && bundle.boards[id].label) {
                boardName = labelText(bundle.boards[id].label);
            }
            return typeof boardName === 'string' && boardName.toLowerCase().includes(bundleName);
        });
        bundle.mainBoard = bestMatch || unreferenced[0];
    }
}

/** Páginas a las que se llega navegando desde una (incluida ella). */
function reachableFrom(bundle, startId) {
    const seen = new Set();
    const stack = [startId];
    while (stack.length) {
        const id = stack.pop();
        if (seen.has(id) || !bundle.boards[id]) continue;
        seen.add(id);
        (bundle.boards[id].gridElements || []).forEach(el => (el.actions || []).forEach(a => {
            if (isNavigateAction(a) && !seen.has(a.toGridId)) stack.push(a.toGridId);
        }));
    }
    return seen;
}

// --- Import .grd ---
async function importGrd(file) {
    const text = (await file.text()).replace(/^\uFEFF/, ''); // los respaldos de Asterics traen BOM
    const json = JSON.parse(text);
    if (!json || !Array.isArray(json.grids) || !json.grids.length) throw new Error('El archivo .grd no tiene tableros.');
    // Respaldo completo de Asterics: inicio declarado, sin tablero global ni miniaturas; diccionario de predicción
    const norm = normalizeGrd(json);
    if (!norm.grids.length) throw new Error('El archivo .grd no tiene tableros.');
    const bundle = {
        id: 'bundle_' + Date.now(),
        name: file.name.replace('.grd', ''),
        type: 'grd',
        importerVersion: IMPORTER_VERSION,
        mainBoard: norm.homeGridId || norm.grids[0].id,
        boards: {}
    };
    norm.grids.forEach(g => { bundle.boards[g.id] = g; });
    if (norm.predictionWords.length) bundle.predictionWords = norm.predictionWords;
    if (!norm.homeGridId) inferMainBoard(bundle);
    bundle.name = importedName(file.name, bundle);
    return bundle;
}

// --- Import .obz (Open Board Format) ---
async function importObz(file) {
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) throw new Error('El archivo .obz no tiene un manifest.json válido.');
    const manifest = JSON.parse(await manifestFile.async('text'));

    let rootBoardId = manifest.root;
    if (!rootBoardId && manifest.paths && manifest.paths.boards) {
        rootBoardId = Object.keys(manifest.paths.boards)[0];
    }

    const bundle = {
        id: 'bundle_' + Date.now(),
        name: file.name.replace('.obz', ''),
        type: 'obz',
        importerVersion: IMPORTER_VERSION,
        mainBoard: rootBoardId,
        boards: {}
    };

    // Extraer imágenes embebidas a Base64
    const imageMap = {};
    const imgPromises = [];
    zip.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir && /\.(png|jpe?g|gif|svg|webp)$/i.test(relativePath)) {
            imgPromises.push((async () => {
                const blob = await zipEntry.async('blob');
                await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => { imageMap[relativePath] = reader.result; resolve(); };
                    reader.readAsDataURL(blob);
                });
            })());
        }
    });
    await Promise.all(imgPromises);

    // Normalizar cada .obf a formato GRD interno
    const folder = zip.folder('boards');
    const filePromises = [];
    folder.forEach((relativePath, zipEntry) => {
        if (!zipEntry.name.endsWith('.obf')) return;
        filePromises.push((async () => {
            const obfJson = JSON.parse(await zipEntry.async('text'));
            const rows = obfJson.grid.rows || 3;
            const cols = obfJson.grid.columns || 4;
            const gridElements = [];
            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    const btnId = obfJson.grid.order[y][x];
                    if (!btnId) continue;
                    const btn = obfJson.buttons.find(b => b.id === btnId);
                    if (!btn) continue;

                    const img = obfJson.images ? obfJson.images.find(i => i.id === btn.image_id) : null;
                    let finalUrl = null;
                    if (img) {
                        const localPath = img.path || img.url;
                        if (localPath && imageMap[localPath]) {
                            finalUrl = imageMap[localPath];
                        } else {
                            const cleanPath = localPath ? localPath.replace(/^\.\//, '') : null;
                            finalUrl = (cleanPath && imageMap[cleanPath]) ? imageMap[cleanPath] : img.url;
                        }
                    }

                    const actions = [];
                    if (btn.load_board) {
                        const pathStr = typeof btn.load_board === 'string'
                            ? btn.load_board
                            : (btn.load_board.path || btn.load_board.id);
                        if (pathStr) {
                            const toId = pathStr.split('/').pop().replace('.obf', '');
                            actions.push({ navType: 'navigateToGrid', toGridId: toId });
                        }
                    }

                    let parsedBg = null;
                    if (Array.isArray(btn.background_color)) {
                        parsedBg = `rgb(${btn.background_color[0]}, ${btn.background_color[1]}, ${btn.background_color[2]})`;
                    } else if (typeof btn.background_color === 'string') {
                        parsedBg = btn.background_color;
                    }

                    gridElements.push({
                        x, y,
                        label: { es: btn.label, en: btn.label },
                        image: { url: finalUrl },
                        backgroundColor: parsedBg,
                        actions
                    });
                }
            }
            bundle.boards[obfJson.id] = {
                id: obfJson.id,
                name: obfJson.name,
                rowCount: rows,
                minColumnCount: cols,
                gridElements
            };
        })());
    });
    await Promise.all(filePromises);

    if (!manifest.root) inferMainBoard(bundle);
    return bundle;
}

/**
 * Importa un .grd/.obz. Si trae varias páginas, chooseSplit(n) decide (true = tableros separados).
 * Completa desde ARASAAC el texto de los pictogramas que vienen sin texto. Devuelve los bundles creados.
 */
export async function importFile(file, { chooseSplit = async () => false } = {}) {
    const ext = file.name.split('.').pop().toLowerCase();
    let bundle = null;
    if (ext === 'grd') bundle = await importGrd(file);
    else if (ext === 'obz') bundle = await importObz(file);
    else throw new Error('Formato no soportado: ' + ext);

    const report = compatibilityMessage(analyzeBundle(bundle)); // qué se adaptó y qué no se puede usar
    const n = pageCount(bundle);
    const stamp = Date.now();
    const list = (n > 1 && await chooseSplit(n))
        ? splitBundle(bundle, i => `bundle_${stamp + i}_${Math.random().toString(36).slice(2, 7)}`)
        : [bundle];
    for (const b of list) await saveBundle(b, { isNew: true }); // local + nube (si hay sesión, nace en la cuenta)
    // Textos de ARASAAC en segundo plano: la importación no espera a la red
    list.forEach(b => completeMissingTexts(b.id));
    list.report = report;
    return list;
}

// --- Home: listado de tableros guardados ---
let isRenderingBoards = false;
let rerenderRequested = false;

// Etiquetas (10/10/2026): bundle.tags = ['Hogar', ...]. Viajan dentro del bundle (sync sin migración).
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;

/** Normaliza una lista de etiquetas: trim, espacios simples, máx. 30 caracteres, sin duplicados (sin distinguir mayúsculas), máx. 10. */
export function normalizeTags(list) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
        if (typeof raw !== 'string') continue;
        const tag = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH).trim();
        const key = tag.toLocaleLowerCase('es');
        if (!tag || seen.has(key)) continue;
        seen.add(key);
        out.push(tag);
        if (out.length >= MAX_TAGS) break;
    }
    return out;
}

const tagKey = (t) => t.toLocaleLowerCase('es');

/**
 * Filtro del home (lógica pura). Etiquetas: el tablero debe tener TODAS las elegidas (cada chip achica).
 * Usuario: solo tableros asignados a ese usuario. Texto: el nombre contiene la búsqueda (ya en minúsculas).
 */
export function matchesHomeFilters(bundle, { tags = [], userBoardIds = null, query = '' } = {}) {
    if (query && !String(bundle.name || '').toLocaleLowerCase('es').includes(query)) return false;
    if (tags.length) {
        const own = new Set(normalizeTags(bundle.tags).map(tagKey));
        if (!tags.every(t => own.has(t))) return false;
    }
    if (userBoardIds && !userBoardIds.has(bundle.id)) return false;
    return true;
}

// Estado de filtros y asignaciones del home
const homeFilters = { tags: new Set(), userId: '', query: '' }; // tags y query en minúsculas
let homeBundles = [];           // un bundle por tablero visible (profesional) o una copia por tablero (tablet)
let homeReadOnly = false;       // tablet vinculada: sin acciones, sin usuarios ni badges
let homeCards = [];             // [{ card, bundle, entry }] (agrupando, un tablero puede tener varias tarjetas)
let assignCountByBoard = new Map();
let boardsByUser = new Map();   // aac_user_id -> Set(board_id)
let filterUsers = [];           // [{ id, display_name }]
let assignmentsRequest = 0;

// --- Orden y agrupación del home (estilo "Projects"; se recuerdan en este dispositivo) ---
const SORT_KEY = 'miravoz_home_sort';
const GROUP_KEY = 'miravoz_home_group';
const SORTS = ['modified', 'created', 'alpha'];
function readPref(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key, value) {
    try { localStorage.setItem(key, value); } catch { /* modo privado o cuota: no se recuerda */ }
}
const homeView = {
    sort: SORTS.includes(readPref(SORT_KEY, '')) ? readPref(SORT_KEY, '') : 'modified',
    group: readPref(GROUP_KEY, '0') === '1'
};

/** Última modificación: bundle.updatedAt o el mayor lastUpdateTime de los grids. */
export function bundleModifiedTime(bundle) { return bundleTime(bundle) || 0; }

/** Creación: no hay campo; se usa el timestamp del id `bundle_<ms>` y, si no, la última modificación. */
export function bundleCreatedTime(bundle) {
    const m = /^bundle_(\d{10,})/.exec(String(bundle?.id || ''));
    return m ? Number(m[1]) : (bundle?.updatedAt || bundleModifiedTime(bundle));
}

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base', numeric: true });

/** Ordena una copia de la lista: 'modified' y 'created' del más nuevo al más viejo; 'alpha' por nombre. */
export function sortBundles(list, sort = 'modified') {
    const out = [...list];
    if (sort === 'alpha') return out.sort(byName);
    const key = sort === 'created' ? bundleCreatedTime : bundleModifiedTime;
    return out.sort((a, b) => (key(b) - key(a)) || byName(a, b));
}

/**
 * Secciones para "Agrupar por etiqueta": una por etiqueta (alfabético) y al final "Sin etiqueta".
 * Un tablero con varias etiquetas aparece en cada sección. Devuelve [{ key, title, bundles }].
 */
export function groupBundlesByTag(list) {
    const groups = new Map();
    const untagged = [];
    list.forEach(b => {
        const tags = normalizeTags(b.tags);
        if (!tags.length) { untagged.push(b); return; }
        tags.forEach(t => {
            const k = tagKey(t);
            if (!groups.has(k)) groups.set(k, { key: k, title: t, bundles: [] });
            groups.get(k).bundles.push(b);
        });
    });
    const out = [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));
    if (untagged.length) out.push({ key: '', title: 'Sin etiqueta', bundles: untagged });
    return out;
}

let relativeFormatter = null;
/** "hace 1 minuto", "ayer", "hace 3 días"… ('' si no hay fecha). */
export function formatRelativeTime(ts, now = Date.now()) {
    if (!ts || !Number.isFinite(ts)) return '';
    if (!relativeFormatter) {
        try { relativeFormatter = new Intl.RelativeTimeFormat('es', { numeric: 'auto' }); } catch { return ''; }
    }
    const sec = Math.round((ts - now) / 1000); // negativo = pasado
    const abs = Math.abs(sec);
    if (abs < 60) return relativeFormatter.format(0, 'second'); // "ahora"
    const steps = [[3600, 60, 'minute'], [86400, 3600, 'hour'], [604800, 86400, 'day'],
        [2629800, 604800, 'week'], [31557600, 2629800, 'month'], [Infinity, 31557600, 'year']];
    for (const [limit, unit, name] of steps) {
        if (abs < limit) return relativeFormatter.format(Math.round(sec / unit), name);
    }
    return '';
}

const ICONS = {
    assign: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    tag: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>',
    tags: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>',
    export: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
    duplicate: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
    more: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    remove: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>'
};

// Menú "…" de la tarjeta (se cierra al tocar afuera, con Escape o al elegir)
let openMenuEl = null;
function closeCardMenu() {
    if (!openMenuEl) return;
    openMenuEl.remove(); openMenuEl = null;
    document.removeEventListener('pointerdown', onMenuOutside, true);
    document.removeEventListener('keydown', onMenuKey, true);
}
function onMenuOutside(e) { if (openMenuEl && !openMenuEl.contains(e.target)) closeCardMenu(); }
function onMenuKey(e) { if (e.key === 'Escape') closeCardMenu(); }
function openCardMenu(anchor, items) {
    const wasOpen = openMenuEl && openMenuEl.dataset.for === anchor.dataset.menuId;
    closeCardMenu();
    if (wasOpen) return;
    anchor.dataset.menuId ||= 'm' + Math.random().toString(36).slice(2, 8);
    const menu = document.createElement('div');
    menu.className = 'card-menu';
    menu.setAttribute('role', 'menu');
    menu.dataset.for = anchor.dataset.menuId;
    for (const [text, fn, danger] of items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.textContent = text;
        if (danger) b.className = 'is-danger';
        b.onclick = (e) => { e.stopPropagation(); closeCardMenu(); fn(); };
        menu.appendChild(b);
    }
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    menu.style.top = (r.bottom + 6 + h > window.innerHeight ? r.top - h - 6 : r.bottom + 6) + 'px';
    openMenuEl = menu;
    setTimeout(() => {
        document.addEventListener('pointerdown', onMenuOutside, true);
        document.addEventListener('keydown', onMenuKey, true);
    });
    menu.querySelector('button')?.focus();
}

function makeActionButton(kind, label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-icon card-action card-action-' + kind;
    btn.innerHTML = ICONS[kind]; // SVG fijo, sin datos de personas
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.onclick = (e) => { e.stopPropagation(); onClick(e); };
    return btn;
}

function makeTagLabel(text) {
    const label = document.createElement('span');
    label.className = 'tag-label';
    const icon = document.createElement('span');
    icon.className = 'tag-label-icon';
    icon.innerHTML = ICONS.tag; // SVG fijo
    const txt = document.createElement('span');
    txt.className = 'tag-label-text';
    txt.textContent = text; // lo escribe la profesional: textContent
    label.append(icon, txt);
    return label;
}

/** Etiquetas de la tarjeta como labels discretos con ícono (pie de la tarjeta). */
function renderCardTags(container, bundle) {
    const tags = normalizeTags(bundle.tags);
    container.replaceChildren();
    container.hidden = tags.length === 0;
    tags.slice(0, 3).forEach(t => container.appendChild(makeTagLabel(t)));
    if (tags.length > 3) {
        const more = document.createElement('span');
        more.className = 'tag-label tag-label-more';
        more.textContent = `+${tags.length - 3}`;
        more.title = tags.slice(3).join(', ');
        container.appendChild(more);
    }
    if (tags.length) container.setAttribute('aria-label', `Etiquetas: ${tags.join(', ')}`);
    else container.removeAttribute('aria-label');
}

/** Miniatura del tablero principal: grilla chica con los colores y pictogramas de cada celda. */
export function buildBoardThumb(bundle) {
    return buildGridThumb(bundle.boards && bundle.boards[bundle.mainBoard], bundle);
}

/** Miniatura de una página (también la usa la franja de páginas del editor). */
export function buildGridThumb(grid, bundle) {
    const els = (grid && grid.gridElements || []).filter(e => !e.hidden);
    if (!els.length) return null;
    const rows = Math.max(1, grid.rowCount || 1);
    const cols = Math.max(1, grid.minColumnCount || 1, ...els.map(e => (e.x || 0) + (e.width || 1)));
    const box = document.createElement('div');
    box.className = 'board-thumb';
    box.setAttribute('aria-hidden', 'true');
    box.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    box.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    for (const el of els) {
        if ((el.y || 0) >= rows || (el.x || 0) >= cols) continue;
        const c = document.createElement('div');
        c.className = 'board-thumb-cell';
        c.style.gridColumn = `${(el.x || 0) + 1} / span ${el.width || 1}`;
        c.style.gridRow = `${(el.y || 0) + 1} / span ${el.height || 1}`;
        const color = getCellColor(el);
        if (color) c.style.background = color;
        let src = el.image ? (el.image.data || el.image.url) : null;
        if (src && !src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('./')) {
            src = 'data:' + (el.image.contentType || 'image/jpeg') + ';base64,' + src;
        }
        if (src) {
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.decoding = 'async';
            img.alt = '';
            img.src = src;
            c.appendChild(img);
        } else {
            const label = visibleLabel(el, bundle);
            if (label) { const t = document.createElement('span'); t.textContent = label; c.appendChild(t); }
        }
        box.appendChild(c);
    }
    return box;
}

function buildBoardCard(bundle, { readOnly = false } = {}) {
    const card = document.createElement('div');
    card.className = readOnly ? 'board-card glass-box device-card' : 'board-card glass-box';
    const displayName = String(bundle.name || 'Tablero');
    card.setAttribute('data-name', displayName.toLowerCase());
    card.dataset.boardId = bundle.id;

    let previewText = 'Sin opciones';
    let optionsCount = 0;
    if (bundle.boards && bundle.mainBoard && bundle.boards[bundle.mainBoard]) {
        const mainElements = bundle.boards[bundle.mainBoard].gridElements || [];
        optionsCount = mainElements.length;
        const labels = mainElements
            .map(e => labelText(e.label))
            .filter(Boolean).slice(0, 5);
        if (labels.length > 0) {
            previewText = labels.join(', ') + (optionsCount > 5 ? '...' : '');
        }
    }

    const infoDiv = document.createElement('div');
    infoDiv.className = 'board-card-info';
    const h3 = document.createElement('h3');
    h3.className = 'board-card-title';
    h3.textContent = displayName;
    // Vista previa: miniatura del tablero principal armada en el momento con los datos locales
    // (no se guarda en la base). Si no hay celdas, se muestra el texto de siempre.
    const thumb = buildBoardThumb(bundle);
    const pMeta = document.createElement('p');
    pMeta.className = 'board-card-meta';
    const pages = pageCount(bundle);
    pMeta.textContent = (optionsCount ? `${optionsCount} celdas` : previewText) + (pages > 1 ? ` · ${pages} páginas` : '');
    infoDiv.append(h3, ...(thumb ? [thumb] : []), pMeta);

    // Tablet (solo lectura): sin acciones ni badge; la tarjeta entera abre la copia
    const actions = readOnly ? null : buildCardActions(bundle);

    const progress = document.createElement('div');
    progress.className = 'progress-bar';
    progress.style.cssText = 'position:absolute; bottom:0; left:0; height:10px; background:rgba(0,255,136,0.5); width:0%; transition:width 0.1s linear;';

    // Pie (como en "Projects"): última modificación a la izquierda y etiquetas a la derecha
    const footer = document.createElement('div');
    footer.className = 'board-card-footer';
    const time = document.createElement('span');
    time.className = 'board-card-time';
    const modified = bundleModifiedTime(bundle);
    time.textContent = formatRelativeTime(modified);
    if (modified) time.title = 'Última modificación: ' + new Date(modified).toLocaleString('es');
    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'board-card-tags';
    tagsDiv.setAttribute('role', 'group');
    renderCardTags(tagsDiv, bundle);
    footer.append(time, tagsDiv);
    footer.hidden = !time.textContent && tagsDiv.hidden;

    card.append(infoDiv, ...(actions ? [actions.actionsDiv] : []), footer, progress);
    card.onclick = () => openBundle(bundle);
    if (readOnly) {
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBundle(bundle); }
        };
    }

    const entry = { element: card, data: bundle, isBoardCard: true };
    return { card, bundle, entry, assignBtn: actions?.assignBtn || null, badge: actions?.badge || null };
}

/** Fila de acciones de la tarjeta de la profesional: asignar, etiquetas, exportar, duplicar y eliminar. */
function buildCardActions(bundle) {
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'board-card-actions';

    const assignWrap = document.createElement('span');
    assignWrap.className = 'card-action-wrap';
    const assignBtn = makeActionButton('assign', 'Dar copia a usuarios', () => openAssignModal(bundle));
    const badge = document.createElement('span');
    badge.className = 'card-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.hidden = true;
    assignWrap.append(assignBtn, badge);
    if (!S.currentUser) assignWrap.hidden = true; // asignar requiere cuenta

    const tagsBtn = makeActionButton('tags', 'Etiquetas', () => openTagsModal(bundle, tagsBtn));
    tagsBtn.dataset.tagsFor = bundle.id;

    const exportBtn = makeActionButton('export', 'Exportar .grd', () => {
        const payload = { grids: Object.values(bundle.boards) };
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${bundle.name}.grd`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });

    const duplicateBtn = makeActionButton('duplicate', 'Duplicar tablero', async () => {
        const clone = JSON.parse(JSON.stringify(bundle));
        clone.id = 'bundle_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        clone.name = clone.name + ' (copia)';
        delete clone.ownerId; delete clone.syncedAt; // es un tablero nuevo
        await saveBundle(clone, { isNew: true });
        loadSavedBoards();
    });

    const deleteBtn = makeActionButton('remove', 'Eliminar tablero', async () => {
        const assigned = assignCountByBoard.get(bundle.id) || 0;
        const extra = assigned ? ` Las copias que ya tienen ${assigned === 1 ? 'tu usuario' : `tus ${assigned} usuarios`} no se borran.` : '';
        if (!(await customConfirm(`¿Eliminar el tablero «${bundle.name}»?${extra}`))) return;
        await removeBundle(bundle);
        loadSavedBoards();
        showUndoToast(async () => {
            await saveBundle(bundle); // también cancela el borrado pendiente en la nube
            loadSavedBoards();
        });
    });
    deleteBtn.classList.add('card-action-danger');

    // 0.8.1e: tarjeta más liviana: Exportar, Duplicar y Eliminar van en el menú "…"
    const moreBtn = makeActionButton('more', 'Más opciones', () => openCardMenu(moreBtn, [
        ['Exportar .grd', () => exportBtn.onclick(new Event('click'))],
        ['Duplicar', () => duplicateBtn.onclick(new Event('click'))],
        ['Eliminar', () => deleteBtn.onclick(new Event('click')), true]
    ]));
    moreBtn.setAttribute('aria-haspopup', 'menu');
    actionsDiv.append(assignWrap, tagsBtn, moreBtn);
    return { actionsDiv, assignBtn, badge };
}

export async function loadSavedBoards() {
    // Si ya se está renderizando, no descartar el pedido: re-renderizar al terminar
    if (isRenderingBoards) { rerenderRequested = true; return; }
    isRenderingBoards = true;
    try {
        const keys = await localforage.keys();
        const bundles = [];
        for (const key of keys) {
            if (key.startsWith('miravoz_')) continue; // settings, calibración, benchmarks

            const bundle = await localforage.getItem(key);
            if (!bundle || !bundle.name) continue;
            // El tablero de prueba no se guarda: si quedó en disco por error (versiones viejas), se limpia.
            // No es de nadie ni está en la nube, así que no pasa por removeBundle.
            if (bundle.type === 'test') { await localforage.removeItem(key); continue; }
            // F4: tableros de una cuenta solo se ven con esa cuenta; los locales sin dueño, siempre
            if (!isVisibleTo(bundle, S.currentUser?.id)) continue;
            bundles.push(bundle);
        }
        renderHome(bundles);
    } finally {
        isRenderingBoards = false;
        if (rerenderRequested) { rerenderRequested = false; loadSavedBoards(); }
    }
}

/**
 * Home estilo "Projects" para una lista de bundles: pestañas de etiquetas con contadores, lupa, orden y
 * agrupación. La profesional lo usa con sus tableros; la tablet vinculada con sus copias y readOnly
 * (sin selector de usuario, sin badges y sin acciones: tocar la tarjeta abre la copia).
 */
export function renderHome(bundles, { readOnly = false } = {}) {
    homeBundles = Array.isArray(bundles) ? bundles : [];
    homeReadOnly = !!readOnly;
    if (homeReadOnly) {
        // La tablet no ve usuarios ni asignaciones (y descarta respuestas en vuelo)
        assignmentsRequest++;
        assignCountByBoard = new Map(); boardsByUser = new Map(); filterUsers = [];
        homeFilters.userId = '';
    }
    renderHomeCards();
    renderHomeFilterBar();
    applyHomeFilters(); // también avisa a main (hooks.onHomeRendered) con las tarjetas visibles
    if (!homeReadOnly) refreshAssignments(); // en segundo plano: badges y filtro por usuario
}

/** Arma las tarjetas según el orden y la agrupación elegidos (sin releer el disco). */
function renderHomeCards() {
    boardList.replaceChildren();
    activeHomeElements = [];
    homeCards = [];
    boardList.classList.toggle('is-grouped', homeView.group && homeBundles.length > 0);

    if (homeBundles.length === 0) {
        const p = document.createElement('p');
        p.className = homeReadOnly ? 'home-empty device-empty' : 'home-empty';
        p.textContent = homeReadOnly
            ? 'Todavía no hay tableros en esta tablet. Hay que asignarle uno a este usuario desde la cuenta registrada.'
            : 'Todavía no hay tableros. Creá uno nuevo o importá uno para empezar.';
        boardList.appendChild(p);
        return;
    }
    const sorted = sortBundles(homeBundles, homeView.sort);
    const fragment = document.createDocumentFragment();
    const addCard = (parent, bundle) => {
        const item = buildBoardCard(bundle, { readOnly: homeReadOnly });
        homeCards.push(item);
        parent.appendChild(item.card);
    };
    if (homeView.group) {
        // Mismo texto de etiqueta que en las pestañas (sin depender del orden elegido)
        const titles = new Map(tagsInUse(homeBundles).map(u => [u.key, u.tag]));
        groupBundlesByTag(sorted).forEach((g, i) => {
            if (g.key && titles.has(g.key)) g.title = titles.get(g.key);
            const section = document.createElement('section');
            section.className = 'home-group';
            const headId = `home-group-${i}`;
            section.setAttribute('aria-labelledby', headId);
            const h2 = document.createElement('h2');
            h2.className = 'home-group-title';
            h2.id = headId;
            const name = document.createElement('span');
            name.textContent = g.title; // etiqueta escrita por la profesional
            const count = document.createElement('span');
            count.className = 'home-group-count';
            h2.append(name, count);
            const grid = document.createElement('div');
            grid.className = 'home-group-grid';
            g.bundles.forEach(b => addCard(grid, b));
            section.append(h2, grid);
            fragment.appendChild(section);
        });
    } else {
        sorted.forEach(b => addCard(fragment, b));
    }
    boardList.appendChild(fragment);
    updateAssignBadges();
}

// --- Asignaciones para badges y filtro por usuario ---

/** Relee las asignaciones de la profesional (RLS ya filtra). Sin sesión o con error: sin badges ni filtro. */
export async function refreshAssignments() {
    const req = ++assignmentsRequest;
    let counts = new Map(), byUser = new Map(), people = [];
    if (S.currentUser && supabaseClient) {
        try {
            const [asg, au] = await Promise.all([
                supabaseClient.from('assignments').select('board_id, aac_user_id'),
                supabaseClient.from('aac_users').select('id, display_name')
            ]);
            if (asg && !asg.error && Array.isArray(asg.data)) {
                asg.data.forEach(({ board_id, aac_user_id }) => {
                    if (!board_id) return;
                    counts.set(board_id, (counts.get(board_id) || 0) + 1);
                    if (!byUser.has(aac_user_id)) byUser.set(aac_user_id, new Set());
                    byUser.get(aac_user_id).add(board_id);
                });
                if (au && !au.error && Array.isArray(au.data)) people = au.data;
            } else if (asg?.error) {
                console.error('Error leyendo asignaciones del home:', asg.error);
            }
        } catch (err) {
            console.error('Error leyendo asignaciones del home:', err);
        }
    }
    if (req !== assignmentsRequest || homeReadOnly) return; // llegó una respuesta más nueva / es la tablet
    assignCountByBoard = counts;
    boardsByUser = byUser;
    filterUsers = people
        .filter(u => u && u.id)
        .sort((a, b) => String(a.display_name || '').localeCompare(String(b.display_name || ''), 'es'));
    if (homeFilters.userId && !filterUsers.some(u => u.id === homeFilters.userId)) homeFilters.userId = '';
    updateAssignBadges();
    renderUserFilter();
    applyHomeFilters();
}

function updateAssignBadges() {
    homeCards.forEach(({ bundle, assignBtn, badge }) => {
        if (!assignBtn || !badge) return; // tarjeta de solo lectura (tablet)
        const n = assignCountByBoard.get(bundle.id) || 0;
        badge.hidden = n === 0;
        badge.textContent = n > 99 ? '99+' : String(n);
        const label = n === 0 ? 'Dar copia a usuarios'
            : `Dar copia a usuarios (${n} ${n === 1 ? 'usuario tiene' : 'usuarios tienen'} copia)`;
        assignBtn.title = label;
        assignBtn.setAttribute('aria-label', label);
    });
}

// --- Barra de filtros del home ---
const filterBar = document.getElementById('home-filters');
const tagFilterChips = document.getElementById('tag-filter-chips');
const userFilterWrap = document.getElementById('user-filter-wrap');
const userFilterSelect = document.getElementById('user-filter');
const filterEmptyMsg = document.getElementById('home-filter-empty');

/** Etiquetas en uso: [{ tag, key, count }] ordenadas alfabéticamente (sin distinguir mayúsculas). */
function tagsInUse(bundles) {
    const map = new Map();
    bundles.forEach(b => normalizeTags(b.tags).forEach(t => {
        const k = tagKey(t);
        if (!map.has(k)) map.set(k, { tag: t, key: k, count: 0 });
        map.get(k).count++;
    }));
    return [...map.values()].sort((a, b) => a.tag.localeCompare(b.tag, 'es', { sensitivity: 'base' }));
}

/** Pestaña "Nombre (N)": el nombre se recorta con "…" si es largo; el contador siempre se ve. */
function makeFilterTab(text, count, pressed, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'home-tab';
    const name = document.createElement('span');
    name.className = 'home-tab-name';
    name.textContent = text; // etiqueta escrita por la profesional: textContent
    const num = document.createElement('span');
    num.className = 'home-tab-count';
    num.textContent = ` (${count})`;
    btn.append(name, num);
    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    btn.onclick = onClick;
    return btn;
}

/** Pestañas tipo píldora: "Todos" + una por etiqueta (varias elegidas = tableros con todas). */
function renderHomeFilterBar() {
    if (!tagFilterChips) return;
    const used = tagsInUse(homeBundles);
    // Descartar etiquetas elegidas que ya no existen
    [...homeFilters.tags].forEach(k => { if (!used.some(u => u.key === k)) homeFilters.tags.delete(k); });

    tagFilterChips.replaceChildren();
    // Contadores = cantidad de tableros (no cambian con la búsqueda ni el filtro por usuario).
    // "Todos (N)" se ve siempre que haya tableros: reemplaza al título "Tableros".
    if (homeBundles.length) {
        const total = homeBundles.length;
        const all = makeFilterTab('Todos', total, homeFilters.tags.size === 0, () => {
            homeFilters.tags.clear();
            renderHomeFilterBar(); applyHomeFilters();
            tagFilterChips.querySelector('.home-tab')?.focus();
        });
        all.setAttribute('aria-label', `Todos los tableros, ${total}`);
        tagFilterChips.appendChild(all);
        used.forEach(({ tag, key, count }) => {
            const tab = makeFilterTab(tag, count, homeFilters.tags.has(key), () => {
                // 0.8.1m: una sola etiqueta por vez (tocar la elegida vuelve a "Todos")
                const was = homeFilters.tags.has(key);
                homeFilters.tags.clear();
                if (!was) homeFilters.tags.add(key);
                renderHomeFilterBar(); applyHomeFilters();
                [...tagFilterChips.querySelectorAll('.home-tab')].find(c => c.dataset.key === key)?.focus();
            });
            tab.dataset.key = key;
            const n = `${count} ${count === 1 ? 'tablero' : 'tableros'}`;
            tab.setAttribute('aria-label', `${tag}, ${n}`);
            tab.title = n;
            tagFilterChips.appendChild(tab);
        });
    }
    tagFilterChips.hidden = homeBundles.length === 0;
    renderUserFilter();
    requestAnimationFrame(updateTabArrows);
}

// 0.8.1d: etiquetas en una sola línea; si no entran, flechitas para correrlas (grisadas en los extremos)
const tabArrows = [...document.querySelectorAll('.home-tabs-arrow')];
function updateTabArrows() {
    if (!tagFilterChips || !tabArrows.length) return;
    const el = tagFilterChips;
    const overflow = !el.hidden && el.scrollWidth > el.clientWidth + 2;
    el.parentElement?.classList.toggle('has-overflow', overflow);
    tabArrows.forEach(b => {
        b.hidden = !overflow;
        const dir = Number(b.dataset.dir);
        b.disabled = dir < 0 ? el.scrollLeft <= 1 : el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    });
}
tabArrows.forEach(b => b.addEventListener('click', () => {
    tagFilterChips.scrollBy({ left: Number(b.dataset.dir) * Math.max(120, tagFilterChips.clientWidth * 0.7), behavior: 'smooth' });
}));
if (tagFilterChips) {
    tagFilterChips.addEventListener('scroll', updateTabArrows, { passive: true });
    window.addEventListener('resize', updateTabArrows);
}

function renderUserFilter() {
    if (!userFilterSelect || !userFilterWrap) return;
    const show = !homeReadOnly && !!S.currentUser && filterUsers.length > 0 && homeCards.length > 0;
    userFilterWrap.hidden = !show;
    if (show) {
        const all = document.createElement('option');
        all.value = '';
        all.textContent = 'Todos';
        const opts = filterUsers.map(u => {
            const o = document.createElement('option');
            o.value = u.id;
            o.textContent = u.display_name || 'Sin nombre'; // lo escribe la profesional: textContent
            return o;
        });
        userFilterSelect.replaceChildren(all, ...opts);
        userFilterSelect.value = homeFilters.userId;
    } else {
        homeFilters.userId = '';
    }
    // La barra se ve si hay tableros (pestañas, buscador, orden) o, en la cuenta registrada, siempre:
    // ahí están "Nuevo" e "Importar"
    if (filterBar) filterBar.hidden = homeBundles.length === 0 && homeReadOnly;
}

if (userFilterSelect) {
    userFilterSelect.addEventListener('change', () => {
        homeFilters.userId = userFilterSelect.value;
        applyHomeFilters();
    });
}

/** Aplica búsqueda + etiquetas + usuario con la clase .is-filtered-out y actualiza los targets de dwell/barrido. */
export function applyHomeFilters() {
    const criteria = {
        tags: [...homeFilters.tags],
        userBoardIds: homeFilters.userId ? (boardsByUser.get(homeFilters.userId) || new Set()) : null,
        query: homeFilters.query
    };
    const visible = [];
    homeCards.forEach(({ card, bundle, entry }) => {
        const ok = matchesHomeFilters(bundle, criteria);
        card.classList.toggle('is-filtered-out', !ok);
        if (ok) visible.push(entry);
    });
    activeHomeElements = visible;
    // Agrupado: ocultar secciones vacías y mostrar cuántos tableros quedan en cada una
    boardList.querySelectorAll('.home-group').forEach(section => {
        const n = section.querySelectorAll('.board-card:not(.is-filtered-out)').length;
        section.hidden = n === 0;
        const count = section.querySelector('.home-group-count');
        if (count) count.textContent = String(n);
    });
    if (filterEmptyMsg) filterEmptyMsg.hidden = !(homeCards.length > 0 && visible.length === 0);
    hooks.onHomeRendered(activeHomeElements);
}

// --- Buscador del home (lupa que se expande) ---
const searchBtn = document.getElementById('btn-home-search');
const searchField = document.getElementById('home-search-field');
const searchInput = document.getElementById('board-search');
const searchCloseBtn = document.getElementById('btn-home-search-close');

function openHomeSearch() {
    if (!searchField || !searchInput) return;
    searchField.hidden = false;
    if (searchBtn) { searchBtn.hidden = true; searchBtn.setAttribute('aria-expanded', 'true'); }
    searchInput.focus();
}

function closeHomeSearch({ returnFocus = true } = {}) {
    if (!searchField || !searchInput) return;
    const hadQuery = !!homeFilters.query;
    searchInput.value = '';
    homeFilters.query = '';
    searchField.hidden = true;
    if (searchBtn) {
        searchBtn.hidden = false;
        searchBtn.setAttribute('aria-expanded', 'false');
        if (returnFocus) searchBtn.focus();
    }
    if (hadQuery) applyHomeFilters();
}

if (searchInput && searchField) {
    searchBtn?.addEventListener('click', openHomeSearch);
    searchCloseBtn?.addEventListener('click', () => closeHomeSearch());
    searchInput.addEventListener('input', () => {
        homeFilters.query = searchInput.value.trim().toLocaleLowerCase('es');
        applyHomeFilters();
    });
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeHomeSearch(); }
    });
    // Si se va el foco y no hay nada escrito, vuelve a ser solo la lupa
    searchField.addEventListener('focusout', (e) => {
        if (searchField.contains(e.relatedTarget)) return;
        if (!searchInput.value.trim()) closeHomeSearch({ returnFocus: false });
    });
}

// --- Menú de orden y agrupación ---
const sortBtn = document.getElementById('btn-home-sort');
const sortMenu = document.getElementById('home-sort-menu');
const sortItems = () => sortMenu ? [...sortMenu.querySelectorAll('[role^="menuitem"]')] : [];

function syncSortMenu() {
    sortItems().forEach(item => {
        const on = item.dataset.sort ? item.dataset.sort === homeView.sort : homeView.group;
        item.setAttribute('aria-checked', on ? 'true' : 'false');
    });
}

function openSortMenu() {
    if (!sortMenu || !sortBtn) return;
    syncSortMenu();
    sortMenu.hidden = false;
    sortBtn.setAttribute('aria-expanded', 'true');
    (sortItems().find(i => i.getAttribute('aria-checked') === 'true') || sortItems()[0])?.focus();
}

function closeSortMenu({ returnFocus = true } = {}) {
    if (!sortMenu || sortMenu.hidden) return;
    sortMenu.hidden = true;
    sortBtn?.setAttribute('aria-expanded', 'false');
    if (returnFocus) sortBtn?.focus();
}

function chooseSortItem(item) {
    if (item.dataset.sort) {
        homeView.sort = item.dataset.sort;
        writePref(SORT_KEY, homeView.sort);
    } else {
        homeView.group = !homeView.group;
        writePref(GROUP_KEY, homeView.group ? '1' : '0');
    }
    syncSortMenu();
    closeSortMenu();
    renderHomeCards();
    applyHomeFilters();
}

if (sortBtn && sortMenu) {
    syncSortMenu();
    sortBtn.addEventListener('click', () => (sortMenu.hidden ? openSortMenu() : closeSortMenu()));
    sortBtn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openSortMenu(); }
    });
    sortItems().forEach(item => item.addEventListener('click', () => chooseSortItem(item)));
    sortMenu.addEventListener('keydown', (e) => {
        const items = sortItems();
        const i = items.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSortMenu(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
        else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
        else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
        else if (e.key === 'Tab') closeSortMenu({ returnFocus: false });
    });
    document.addEventListener('pointerdown', (e) => {
        if (!sortMenu.hidden && !sortMenu.contains(e.target) && !sortBtn.contains(e.target)) closeSortMenu({ returnFocus: false });
    });
}

// --- Apertura y render de tableros ---

export function openBundle(bundle) {
    try {
        if ((!bundle.importerVersion || bundle.importerVersion < IMPORTER_VERSION) && bundle.type !== 'test') {
            customAlert('Este tablero fue importado con una versión anterior — reimportalo para corregir posibles errores de imágenes y navegación.');
        }
        stopMedia();
        S.currentBundle = bundle;
        S.navigationHistory = [];

        document.getElementById('home-view').style.display = 'none';
        document.getElementById('top-bar').style.display = 'none';
        document.getElementById('bottom-bar').style.display = 'none';
        const boardView = document.getElementById('board-view');
        boardView.style.display = 'flex';
        boardView.style.opacity = '1'; // startCalibration puede haberla dejado en 0

        renderGrid(bundle.mainBoard);
        hooks.onBundleOpened();
        if (!bundle.assignmentId && bundle.type !== 'test' && !bundle.autoLabelsChecked) completeMissingTexts(bundle.id);
    } catch (err) {
        console.error('Error en openBundle:', err);
        customAlert('Error al intentar abrir el tablero: ' + err.message);
    }
}

/**
 * Tableros importados antes de que existiera el texto automático: se completa una vez, en segundo plano,
 * solo en tableros propios (las copias de la tablet las completa la profesional desde su tablero).
 */
const textsInFlight = new Set();
export async function completeMissingTexts(bundleId) {
    if (!bundleId || textsInFlight.has(bundleId)) return;
    textsInFlight.add(bundleId);
    try {
        const stored = await localforage.getItem(bundleId);
        if (!stored || stored.autoLabelsChecked || stored.type === 'test' || stored.assignmentId) return;
        const ids = missingLabelIds(stored);
        if (!ids.size) return;
        const words = await fetchArasaacWords(ids);
        if (!words.size) return; // sin red: se reintenta la próxima vez que se abra
        // Después de esperar a la red se aplica sobre la versión MÁS NUEVA (pudo editarse o sincronizarse)
        const live = S.currentBundle && S.currentBundle.id === bundleId && !S.currentBundle.assignmentId ? S.currentBundle : null;
        const target = live || await localforage.getItem(bundleId);
        if (!target) return;
        const changed = applyAutoLabels(target, words);
        if (missingLabelIds(target).size === 0) target.autoLabelsChecked = 1;
        if (!changed) return;
        await saveBundle(target);
        if (live && S.currentBundle === live && document.getElementById('board-view').style.display !== 'none') renderGrid(S.currentGridId);
    } catch (e) { console.warn('Textos de ARASAAC:', e); }
    finally { textsInFlight.delete(bundleId); }
}

/** Navegación de Asterics: a una página, "volver" o "ir al inicio" del tablero. */
export function navigateTo(nav) {
    if (!nav || !S.currentBundle) return;
    if (nav.kind === 'back') {
        if (S.navigationHistory.length) renderGrid(S.navigationHistory.pop());
        return;
    }
    const target = nav.kind === 'home' ? S.currentBundle.mainBoard : nav.target;
    if (!target || !S.currentBundle.boards[target] || target === S.currentGridId) return;
    S.navigationHistory.push(S.currentGridId);
    renderGrid(target);
}

let clipboardText = '';
async function writeClipboard(text) {
    clipboardText = text;
    try { await navigator.clipboard.writeText(text); showInfoToast('Frase copiada.', 1500); } catch { /* sin permiso */ }
}

/** Acciones de frase (COLLECT), radio y página web de una celda. */
function runSpecialActions(el, bundle) {
    (el.actions || []).forEach(a => {
        if (a.modelName === 'GridActionCollectElement') {
            switch (a.action) {
                case COLLECT.SPEAK: case COLLECT.SPEAK_CONTINUOUS: playSentence(); break;
                case COLLECT.SPEAK_CLEAR: case COLLECT.SPEAK_CONTINUOUS_CLEAR: playSentence(); clearSentence({ keepPending: true }); break;
                case COLLECT.CLEAR: clearSentence(); break;
                case COLLECT.REMOVE_WORD: popSentence(); break;
                case COLLECT.REMOVE_CHAR: removeChar(); break;
                case COLLECT.COPY_CLIPBOARD: writeClipboard(sentenceText()); break;
                case COLLECT.APPEND_CLIPBOARD: writeClipboard([clipboardText, sentenceText()].filter(Boolean).join(' ')); break;
                case COLLECT.CLEAR_CLIPBOARD: writeClipboard(''); break;
                case COLLECT.SHARE:
                    if (navigator.share) navigator.share({ text: sentenceText() }).catch(() => {});
                    else writeClipboard(sentenceText());
                    break;
                default: break; // girar texto: no aplica
            }
        } else if (a.modelName === 'GridActionWebradio') {
            radioAction(a, bundle);
        } else if (a.modelName === 'GridActionOpenWebpage') {
            openWebpage(a);
        }
    });
}

/** Corta la radio y cierra una página web abierta (al salir del tablero). */
export function stopMedia() { stopRadio(); closeWebpage(); stopRecordedAudio(); }

// --- Celdas que muestran la frase o sugerencias (se actualizan cuando cambia la frase) ---
let dynamicCells = { collect: [], prediction: [], upper: false, extra: [], keyboard: false, lowercase: true };

function predictionExtra(bundle) {
    if (bundle.__predExtra) return bundle.__predExtra;
    const words = new Map((bundle.predictionWords || []).map(([w, f]) => [w, f]));
    Object.values(bundle.boards || {}).forEach(g => (g.gridElements || []).forEach(el => {
        const t = labelText(el.label).trim();
        if (t.length > 1 && t.length < 30 && !/\s/.test(t)) words.set(t, (words.get(t) || 0) + 1);
    }));
    Object.defineProperty(bundle, '__predExtra', { value: [...words.entries()], enumerable: false, configurable: true });
    return bundle.__predExtra;
}

function updateDynamicCells() {
    if (!dynamicCells.collect.length && !dynamicCells.prediction.length) return;
    const items = getSentence();
    dynamicCells.collect.forEach(cell => {
        if (!cell.isConnected) return;
        const box = cell.querySelector('.collect-text');
        if (box) box.textContent = items.map(i => i.text).filter(Boolean).join(' ') || ' ';
    });
    if (dynamicCells.prediction.length) {
        const words = suggest(currentPrefix(), { extra: dynamicCells.extra, count: dynamicCells.prediction.length, upper: dynamicCells.upper });
        dynamicCells.prediction.forEach((cell, i) => {
            if (!cell.isConnected) return;
            const w = words[i] || '';
            cell.dataset.word = w;
            const lbl = cell.querySelector('.picto-label');
            if (lbl) lbl.textContent = w;
            cell.setAttribute('aria-label', w ? `Sugerencia: ${w}` : 'Sin sugerencia');
            cell.classList.toggle('is-empty', !w);
        });
    }
}
onSentenceChange(updateDynamicCells);

let lastCellClickTime = 0;

export function handleCellClick(cellElement, elementData) {
    // Editor (F3): en modo edición el click abre el editor de celda
    if (hooks.cellClickInterceptor(cellElement, elementData)) return;

    // Debounce de doble click físico
    const now = performance.now();
    if (now - lastCellClickTime < 500) return;
    lastCellClickTime = now;

    // Efecto visual
    cellElement.style.transform = 'scale(0.95)';
    setTimeout(() => (cellElement.style.transform = ''), 150);

    const bundle = S.currentBundle;
    const model = bundle && bundle.speechModel;
    const text = cellText(elementData); // propio (con idiomas de Asterics) o, si falta, el de ARASAAC

    // Predicción de palabras: completa lo que se está escribiendo
    if (elementData.type === ELEMENT.PREDICTION) {
        const word = cellElement.dataset.word;
        if (word) completeWord(word);
        hooks.onCellActivated(elementData);
        return;
    }
    // Celda que pide algo que MiraVoz no puede hacer (YouTube, domótica…): se avisa en vez de no hacer nada
    if (!isUsable(elementData, bundle)) {
        showInfoToast(`Esta celda usa ${unsupportedFeatures(elementData).join(', ')}: MiraVoz todavía no lo puede hacer.`);
        hooks.onCellActivated(elementData);
        return;
    }

    runSpecialActions(elementData, bundle); // frase, radio, página web
    // Celda de frase sin acciones propias: tocarla dice la frase
    if (elementData.type === ELEMENT.COLLECT && !collectActions(elementData).length) playSentence();
    const nav = navInfo(elementData, bundle);
    const navOk = navigates(elementData, bundle);
    const letter = dynamicCells.keyboard && isLetterCell(elementData); // solo en páginas de teclado; incluye el espacio
    const special = isSpecialCell(elementData);
    const audio = audioAction(elementData);
    const custom = customSpeech(elementData);
    const lang = (custom && custom.lang) || speakLanguage(elementData);

    // Qué se dice. Tableros editados en MiraVoz: solo lo que piden sus acciones (F3-3b).
    // Importados sin editar: además se dice el texto de las celdas comunes (las teclas y los botones
    // especiales no hablan, como en Asterics).
    let toSpeak = null;
    if (custom) toSpeak = custom.text || text;
    else if ((elementData.actions || []).some(a => a.modelName === 'GridActionSpeak')) toSpeak = text;
    else if (model !== 'actions' && !letter && !special) toSpeak = text;

    const imageUrl = elementData.image ? (elementData.image.data || elementData.image.url) : null;
    const item = { text, speakText: toSpeak, imageUrl, elData: elementData };

    if (navOk) {
        // Se dice el texto antes de pasar de página (p. ej. la pregunta de una secuencia importada)
        const say = speechOnNavigate(elementData, model);
        if (audio) playRecordedAudio(audio);
        else if (say) speak(say, { lang });
        if (nav.addToCollect && (text || imageUrl)) addToSentence(item);
        setTimeout(() => navigateTo(nav), 100);
    } else {
        if (audio) playRecordedAudio(audio);
        else if (toSpeak) speak(toSpeak, { lang });
        if (letter) {
            const ch = labelText(elementData.label);
            addLetter(dynamicCells.lowercase ? ch.toLocaleLowerCase('es') : ch, elementData);
        }
        else if (!special && !elementData.dontCollect && (text || imageUrl)) {
            if (elementData.toggleInBar) toggleInSentence(item); else addToSentence(item);
        }
    }
    hooks.onCellActivated(elementData);
}

/**
 * 0.8.1c: esquina para agrandar/achicar una celda arrastrando (editor). Muestra el tamaño en vivo y al soltar
 * avisa al editor (hooks.onCellResize), que valida que no tape otras celdas y guarda con deshacer.
 */
export function renderGrid(gridId) {
    if (!S.currentBundle || !S.currentBundle.boards[gridId]) {
        console.error('No se encontró el grid:', gridId);
        return;
    }

    S.currentGridId = gridId;
    const gridData = S.currentBundle.boards[gridId];
    gridContainer.innerHTML = '';
    activeGridElements = [];

    const rows = gridData.rowCount || 3;
    const cols = gridData.minColumnCount || 4;

    // Gap dinámico para grillas densas (teclados); 0.8.1c: la página puede fijar su propio espacio entre celdas
    if (Number.isFinite(gridData.cellGap)) {
        gridContainer.style.gap = `${gridData.cellGap}px`;
        gridContainer.style.padding = cols > 8 ? '5px 10px' : '10px 30px';
        gridContainer.classList.toggle('dense-grid', cols > 8);
    } else if (cols > 8) {
        gridContainer.style.gap = '4px';
        gridContainer.style.padding = '5px 10px';
        gridContainer.classList.add('dense-grid');
    } else {
        gridContainer.style.gap = '15px';
        gridContainer.style.padding = '10px 30px';
        gridContainer.classList.remove('dense-grid');
    }

    gridContainer.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    gridContainer.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`; // 0.8.1d: las filas se achican para entrar
    gridContainer.setAttribute('role', 'group');
    const gridLabel = labelText(gridData.label);
    if (gridLabel) gridContainer.setAttribute('aria-label', gridLabel);

    // F3-6: filtro por nivel de vocabulario activo (fuera del modo edición)
    const activeLevel = (!hooks.isEditMode() && S.currentBundle.activeLevel) || 0;

    const cellsMatrix = Array(rows).fill(null).map(() => Array(cols).fill(null));
    (gridData.gridElements || []).forEach(el => {
        if (activeLevel && el.vocabularyLevel && el.vocabularyLevel > activeLevel) return;
        if (el.y < rows && el.x < cols) cellsMatrix[el.y][el.x] = el;
    });

    // Celdas de frase y de predicción (Asterics): se registran y se actualizan con la frase
    const bundleNow = S.currentBundle;
    const letterLabels = (gridData.gridElements || []).map(e => labelText(e.label)).filter(t => [...t].length === 1 && /\p{L}/u.test(t));
    dynamicCells = {
        collect: [], prediction: [], keyboard: isKeyboardPage(gridData), lowercase: keyboardLowercase(gridData),
        upper: !keyboardLowercase(gridData) && letterLabels.length > 0 && letterLabels.filter(t => t === t.toLocaleUpperCase('es')).length >= letterLabels.length / 2,
        extra: predictionExtra(bundleNow)
    };
    gridContainer.style.backgroundColor = gridData.backgroundColor || '';
    // 0.8.1c: con color de fondo, las celdas vacías son transparentes (sirven de separador)
    gridContainer.classList.toggle('has-page-bg', !!gridData.backgroundColor);

    if (hooks.isEditMode()) gridEdit.beginRender(gridContainer, gridData, cols, rows);
    else gridEdit.teardown(gridContainer);

    const renderedCells = new Set();
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (renderedCells.has(`${x},${y}`)) continue;

            const elData = cellsMatrix[y][x];
            const cell = document.createElement('div');
            cell.className = 'cell';

            const w = elData && elData.width ? elData.width : 1;
            const h = elData && elData.height ? elData.height : 1;

            if (elData) {
                for (let iy = 0; iy < h; iy++) {
                    for (let ix = 0; ix < w; ix++) renderedCells.add(`${x + ix},${y + iy}`);
                }
            } else {
                renderedCells.add(`${x},${y}`);
            }

            cell.style.gridColumn = `${x + 1} / span ${w}`;
            cell.style.gridRow = `${y + 1} / span ${h}`;

            if (elData && (!elData.hidden || hooks.isEditMode())) {
                cell.id = `cell-${x}-${y}`;
                if (elData.hidden) cell.classList.add('is-hidden-cell'); // 0.8.1: oculta en uso, visible al editar

                const finalBgColor = getCellColor(elData);
                if (finalBgColor) {
                    cell.style.setProperty('background-color', finalBgColor, 'important');
                    cell.style.opacity = '0.9';
                    if (!elData.backgroundColor && !elData.textColor) {
                        elData.textColor = '#000000';
                    }
                }

                if (elData.borderColor) {
                    cell.style.borderColor = elData.borderColor;
                    cell.style.borderWidth = '3px';
                }

                if (elData.image) {
                    const img = document.createElement('img');
                    img.className = 'picto-img';
                    let imgSrc = elData.image.data || elData.image.url;
                    if (imgSrc && !imgSrc.startsWith('data:') && !imgSrc.startsWith('http') && !imgSrc.startsWith('./')) {
                        imgSrc = 'data:' + (elData.image.contentType || 'image/jpeg') + ';base64,' + imgSrc;
                    }
                    if (imgSrc) {
                        img.src = imgSrc;
                        img.alt = cellText(elData);
                        cell.appendChild(img);
                    }
                }

                const shown = visibleLabel(elData, S.currentBundle);
                if (elData.labelHidden) cell.classList.add('label-hidden');
                if (shown) {
                    const label = document.createElement('div');
                    label.className = 'picto-label';
                    label.innerText = shown;
                    if (elData.textColor) label.style.color = elData.textColor;
                    cell.appendChild(label);
                }

                // Formato propio de Asterics: color y tamaño de letra de la celda
                const lblEl = cell.querySelector('.picto-label');
                if (lblEl && elData.fontColor) lblEl.style.color = elData.fontColor;
                const pct = Number(elData.fontSizePct);
                const px = parseFloat(elData.fontSizePx);
                if (lblEl && (pct > 0 || px > 0)) {
                    cell.style.containerType = 'size';
                    lblEl.style.fontSize = pct > 0 ? `${Math.min(pct, 90)}cqh` : `min(${px}px, 45cqh)`;
                    lblEl.style.lineHeight = '1.1';
                }

                // Tipos especiales de Asterics
                if (elData.type === ELEMENT.PREDICTION) {
                    cell.classList.add('cell-prediction');
                    if (!lblEl) { const l = document.createElement('div'); l.className = 'picto-label'; cell.appendChild(l); }
                    dynamicCells.prediction.push(cell);
                } else if (elData.type === ELEMENT.COLLECT) {
                    cell.classList.add('cell-collect');
                    const box = document.createElement('div');
                    box.className = 'collect-text';
                    cell.appendChild(box);
                    dynamicCells.collect.push(cell);
                }

                // Lo que MiraVoz no puede hacer se marca (nunca una celda muda sin aviso)
                const missing = unsupportedFeatures(elData);
                if (!isUsable(elData, bundleNow)) {
                    cell.classList.add('cell-unavailable');
                    const badge = document.createElement('div');
                    badge.className = 'cell-unavailable-badge';
                    badge.textContent = 'No disponible';
                    cell.appendChild(badge);
                    cell.title = `No disponible en MiraVoz: ${missing.join(', ')}`;
                } else if (missing.length) {
                    cell.title = `Parte de esta celda no funciona en MiraVoz: ${missing.join(', ')}`;
                }
                const navI = navInfo(elData, bundleNow);
                if (navI && navI.kind === 'grid' && navI.broken && hooks.isEditMode()) {
                    cell.classList.add('cell-broken');
                    cell.title = 'Lleva a una página que no está en este tablero';
                }

                // Señal de que la celda abre otra página: esquina doblada con flecha (convención de carpetas en CAA)
                if (navigates(elData, bundleNow)) {
                    cell.classList.add('cell-nav');
                    const mark = document.createElement('div');
                    mark.className = 'cell-nav-mark';
                    mark.setAttribute('aria-hidden', 'true');
                    mark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>'; // SVG fijo
                    cell.appendChild(mark);
                    if (!cell.title) cell.title = navI.kind === 'back' ? 'Vuelve a la página anterior' : navI.kind === 'home' ? 'Va al inicio del tablero' : 'Abre otra página';
                }

                const progress = document.createElement('div');
                progress.className = 'progress-bar';
                cell.appendChild(progress);

                // F2-6: accesibilidad estructural (base para barrido y lectores de pantalla)
                cell.setAttribute('role', 'button');
                cell.setAttribute('tabindex', '0');
                const ariaLabel = cellText(elData);
                if (ariaLabel) cell.setAttribute('aria-label', cell.classList.contains('cell-nav') ? `${ariaLabel} (abre otra página)` : ariaLabel);
                cell.addEventListener('keydown', (e) => {
                    // Solo en modo Manual: en Barrido, Espacio/Enter son la activación del switch
                    if (S.trackingMode === 'CLICKS' && (e.code === 'Enter' || e.code === 'Space')) {
                        e.preventDefault();
                        handleCellClick(cell, elData);
                    }
                });

                cell.onclick = () => handleCellClick(cell, elData);
                activeGridElements.push({ element: cell, data: elData, isAccBtn: false });
                
                if (hooks.isEditMode()) gridEdit.attachCell(cell, elData); // 0.8.1g: arrastre, selección y bordes
            } else {
                cell.classList.add('empty-cell');
                if (hooks.isEditMode()) {
                    cell.classList.add('editable-slot');
                    gridEdit.attachSlot(cell, x, y);
                }
            }

            // 0.8.1: botón derecho → menú de edición de la celda (el editor decide si corresponde)
            {
                const cx = x, cy = y, cel = elData || null;
                cell.addEventListener('contextmenu', (e) => { if (hooks.cellContextMenu(e, cel, cx, cy)) e.preventDefault(); });
            }
            gridContainer.appendChild(cell);
        }
    }
    if (hooks.isEditMode()) gridEdit.endRender(); // encabezados de filas y columnas
    // 0.8.1n: con voz de MiraVoz, se bajan de antemano los textos de las celdas de esta página
    else setTimeout(() => prefetchSpeech((gridData.gridElements || []).filter(e => !e.hidden).map(e => cellText(e)).filter(Boolean)), 400);

    // Botones del acumulador también son targets de dwell
    document.querySelectorAll('.btn-acc').forEach(btn => {
        if (!btn.querySelector('.progress-bar')) {
            const progress = document.createElement('div');
            progress.className = 'progress-bar';
            btn.appendChild(progress);
            btn.style.position = 'relative';
            btn.style.overflow = 'hidden';
        }
        activeGridElements.push({ element: btn, data: null, isAccBtn: true });
    });

    updateDynamicCells();
    hooks.onGridRendered(activeGridElements);
    hooks.onPageRendered(gridId);
}

// Tablero de prueba 3x3 (números 1-9)
export function buildTestBundle() {
    const testElements = [];
    for (let i = 1; i <= 9; i++) {
        testElements.push({
            x: (i - 1) % 3,
            y: Math.floor((i - 1) / 3),
            label: { es: i.toString() },
            image: null,
            actions: []
        });
    }
    return {
        id: 'test_board_123',
        name: 'Tablero de Prueba (1 al 9)',
        type: 'test',
        importerVersion: IMPORTER_VERSION,
        mainBoard: 'main',
        boards: {
            main: { id: 'main', rowCount: 3, minColumnCount: 3, gridElements: testElements }
        }
    };
}
// --- Lógica de Asignación (Fase 4.2) ---
// F4-3: asignar = copiar. Se elige una tanda de usuarios (checkboxes) y un permiso para todos.
import { users, fetchUsers } from './users.js';
import { supabaseClient } from './auth.js';
import { compareCopy, statusBadge, sendOriginalToCopy, pullCopyToOriginal } from './copy-sync.js';

let bundleToAssign = null;

const assignModal = document.getElementById('assign-modal');
const assignUsersList = document.getElementById('assign-users-list');
const assignSelectAll = document.getElementById('assign-select-all');
const assignPermission = document.getElementById('assign-permission');
// Permiso como dos botones (el <select> oculto sigue siendo la fuente de verdad)
const PERM_HELP = {
    read_only: 'La tablet del usuario puede usar el tablero pero no modificarlo.',
    editable: 'En la tablet del usuario se puede editar su copia (por ejemplo, la familia).'
};
function syncPermissionButtons() {
    const v = assignPermission ? assignPermission.value : 'read_only';
    document.querySelectorAll('#assign-permission-seg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.perm === v)));
    const help = document.getElementById('assign-permission-help');
    if (help) help.textContent = PERM_HELP[v] || '';
}
document.querySelectorAll('#assign-permission-seg button').forEach(b => {
    b.addEventListener('click', () => { if (assignPermission) assignPermission.value = b.dataset.perm; syncPermissionButtons(); });
});
const assignBoardName = document.getElementById('assign-board-name');
const btnCancelAssign = document.getElementById('btn-cancel-assign');
const btnConfirmAssign = document.getElementById('btn-confirm-assign');
const btnCloseAssign = document.getElementById('btn-close-assign');

const assignCheckboxes = () => assignUsersList
    ? [...assignUsersList.querySelectorAll('input[type="checkbox"][data-user-id]:not(:disabled)')]
    : [];
const selectedAssignIds = () => assignCheckboxes().filter(c => c.checked).map(c => c.dataset.userId);

/** "Mateo", "Mateo y Bruno", "Mateo, Bruno y Sofi" */
function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

function updateAssignButton() {
    const n = selectedAssignIds().length;
    btnConfirmAssign.disabled = n === 0;
    btnConfirmAssign.textContent = n === 0 ? 'Elegí al menos un usuario'
        : `Dar copia a ${n} ${n === 1 ? 'usuario' : 'usuarios'}`;
    if (assignSelectAll) {
        const all = assignCheckboxes();
        assignSelectAll.disabled = all.length === 0;
        assignSelectAll.checked = all.length > 0 && n === all.length;
        assignSelectAll.indeterminate = n > 0 && n < all.length;
    }
}

function assignMessage(text) {
    const p = document.createElement('p');
    p.className = 'assign-note';
    p.textContent = text;
    assignUsersList.replaceChildren(p);
}

async function openAssignModal(bundle) {
    bundleToAssign = bundle;
    if (assignBoardName) assignBoardName.textContent = bundle.name ? `«${bundle.name}»` : '';
    if (assignPermission) assignPermission.value = 'read_only'; // default: Solo mirar
    syncPermissionButtons();
    if (assignSelectAll) { assignSelectAll.checked = false; assignSelectAll.indeterminate = false; }

    assignUsersList.innerHTML = '<div style="text-align:center; padding:20px;"><div class="spinner" style="border-width:2px; width:20px; height:20px; border-top-color:var(--accent-text); margin:0 auto;"></div></div>';
    assignModal.style.display = 'flex';
    updateAssignButton();

    if (users.length === 0) {
        assignMessage('Todavía no tenés usuarios. Crealos en "Mis usuarios".');
        updateAssignButton();
        return;
    }

    // Quiénes ya tienen su copia de este tablero
    const { data: assignments, error } = await supabaseClient
        .from('assignments')
        .select('id, aac_user_id, copy_bundle, copy_updated_at')
        .eq('board_id', bundle.id);
    if (bundleToAssign !== bundle) return; // se cerró o se abrió otro mientras tanto
    if (error) console.error('Error leyendo asignaciones:', error);

    const asgByUser = new Map((Array.isArray(assignments) ? assignments : []).map(a => [a.aac_user_id, a]));
    const assignedUserIds = new Set(asgByUser.keys());
    // El original para comparar: la versión guardada en este dispositivo (la más nueva)
    const original = (await localforage.getItem(bundle.id)) || bundle;
    if (bundleToAssign !== bundle) return;

    assignUsersList.replaceChildren();
    if (error) {
        const warn = document.createElement('p');
        warn.className = 'assign-note';
        warn.textContent = 'No pudimos ver quiénes ya tienen su copia. Si elegís a alguien que ya la tiene, te avisamos.';
        assignUsersList.appendChild(warn);
    }

    users.forEach(user => {
        const isAssigned = assignedUserIds.has(user.id);
        const label = document.createElement('label');
        label.className = 'assign-option' + (isAssigned ? ' is-assigned' : '');

        const box = document.createElement('input');
        box.type = 'checkbox';
        box.dataset.userId = user.id;
        if (isAssigned) {
            box.checked = true;
            box.disabled = true;
        } else {
            box.addEventListener('change', updateAssignButton);
        }

        // display_name lo escribe la profesional: siempre como texto (nunca innerHTML)
        const nameSpan = document.createElement('span');
        nameSpan.textContent = user.display_name;
        label.append(box, nameSpan);
        if (isAssigned) {
            label.appendChild(assignedCopyControls(user, asgByUser.get(user.id), original));
        }
        assignUsersList.appendChild(label);
    });
    updateAssignButton();
}

// 0.8.1d (devolución de Leti): para quien ya tiene su copia, ver si es igual al original y sincronizar en
// cualquiera de los dos sentidos, o editar su copia ahí mismo.
function assignedCopyControls(user, asg, original) {
    const box = document.createElement('span');
    box.className = 'assign-copy';
    const status = document.createElement('span');
    const actions = document.createElement('span');
    actions.className = 'assign-copy-actions';
    const btn = (text, title, fn, extra = '') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-secondary assign-copy-btn ' + extra;
        b.textContent = text;
        b.title = title;
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(b); });
        return b;
    };
    const name = user.display_name;
    const paint = () => {
        const st = compareCopy(original, asg.copy_bundle, asg.copy_updated_at);
        const badge = statusBadge(st);
        status.className = 'assign-status ' + badge.cls;
        status.textContent = badge.text;
        status.title = badge.title;
        send.disabled = st === 'igual';
        pull.disabled = st === 'igual' || st === 'sin-original';
    };
    const run = async (b, fn, okMsg) => {
        const prev = b.textContent;
        b.disabled = true; b.textContent = '...';
        try { await fn(); showInfoToast(okMsg); }
        catch (err) { console.error(err); customAlert(err.message?.startsWith('No se pudo') ? err.message : 'No se pudo completar. Revisá la conexión e intentá de nuevo.'); }
        b.textContent = prev;
        paint();
    };
    const send = btn('Copiar mi versión', `Reemplazar la copia de ${name} por tu versión`, async (b) => {
        if (!(await customConfirm(`La copia de ${name} va a quedar igual a tu versión. Lo que haya cambiado en su copia se guarda como versión anterior. ¿Seguir?`))) return;
        run(b, async () => {
            if (original.ownerId && !(await pushBundle(original))) throw new Error('No se pudo subir tu versión a la nube. Revisá la conexión.');
            await sendOriginalToCopy(asg, original);
            fetchUsers();
        }, `Listo: ${name} tiene tu versión.`);
    });
    const pull = btn('Traer sus cambios', `Reemplazar tu versión por la copia de ${name}`, async (b) => {
        if (!(await customConfirm(`Tu tablero va a quedar igual a la copia de ${name}. Tu versión actual se guarda como versión anterior. ¿Seguir?`))) return;
        run(b, async () => {
            const next = await pullCopyToOriginal(asg, original);
            Object.keys(original).forEach(k => delete original[k]);
            Object.assign(original, next);
            window.dispatchEvent(new CustomEvent('miravoz:bundles-changed', { detail: { ids: [original.id], removed: [] } }));
        }, `Listo: tu tablero quedó igual a la copia de ${name}.`);
    });
    const edit = btn('Editar copia', `Editar la copia de ${name}`, () => {
        closeAssignModal();
        window.dispatchEvent(new CustomEvent('miravoz:edit-copy', { detail: { assignmentId: asg.id } }));
    });
    // 0.8.1l: Nombre · [Editar copia] · estado · [Copiar mi versión] [Traer sus cambios]
    edit.classList.add('assign-edit-btn');
    actions.append(status, send, pull);
    box.append(edit, actions);
    paint();
    return box;
}

function closeAssignModal() {
    assignModal.style.display = 'none';
    bundleToAssign = null;
}

if (btnCancelAssign) btnCancelAssign.addEventListener('click', closeAssignModal);
if (btnCloseAssign) btnCloseAssign.addEventListener('click', closeAssignModal);
if (assignSelectAll) {
    assignSelectAll.addEventListener('change', () => {
        assignCheckboxes().forEach(c => { c.checked = assignSelectAll.checked; });
        updateAssignButton();
    });
}

if (btnConfirmAssign) {
    btnConfirmAssign.addEventListener('click', async () => {
        const selectedIds = selectedAssignIds();
        if (!bundleToAssign || selectedIds.length === 0) return;
        const permission = assignPermission && assignPermission.value === 'editable' ? 'editable' : 'read_only';

        btnConfirmAssign.disabled = true;
        btnConfirmAssign.textContent = 'Dando copias...';

        // La asignación referencia el tablero en la nube (FK board_id): asegurar que esté subido.
        // Si es un tablero local "de nadie", pedir permiso para guardarlo en la cuenta.
        // Releer del disco: la tarjeta puede tener una versión vieja (p. ej. recién adoptada por la sync)
        bundleToAssign = (await localforage.getItem(bundleToAssign.id)) || bundleToAssign;
        const adopt = !bundleToAssign.ownerId;
        if (adopt && !(await customConfirm('Para asignarlo, este tablero se va a guardar en tu cuenta (después se ve solo cuando ingresás). ¿Seguir?'))) {
            updateAssignButton();
            return;
        }
        if (!(await pushBundle(bundleToAssign, { adopt }))) {
            customAlert('No se pudo subir el tablero a la nube. Revisá la conexión e intentá de nuevo.');
            updateAssignButton();
            return;
        }
        const clone = JSON.parse(JSON.stringify(bundleToAssign));
        delete clone.ownerId; delete clone.syncedAt; // la copia es del usuario, no del tablero original

        // Una sola inserción para toda la tanda (si falla, no queda ninguna a medias)
        const rows = selectedIds.map(aacUserId => ({
            board_id: bundleToAssign.id,
            aac_user_id: aacUserId,
            copy_bundle: clone,
            permission
        }));
        const { error } = await supabaseClient.from('assignments').insert(rows);

        const boardName = bundleToAssign.name || 'este tablero';
        if (error) {
            console.error('Error asignando tablero:', error);
            if (error.code === '23505') {
                customAlert(`Alguno de esos usuarios ya tenía su copia de «${boardName}», así que no se dio ninguna. Actualizamos la lista: volvé a elegir.`);
                openAssignModal(bundleToAssign);
            } else {
                customAlert('No se pudo dar la copia. Revisá la conexión e intentá de nuevo.');
                updateAssignButton();
            }
            return;
        }

        const names = selectedIds.map(id => users.find(u => u.id === id)?.display_name).filter(Boolean);
        customAlert(`Listo: ${joinNames(names)} ${names.length === 1 ? 'ya tiene' : 'ya tienen'} su copia de «${boardName}».`);
        closeAssignModal();
        fetchUsers(); // refresca "Mis usuarios" con las copias nuevas
        refreshAssignments(); // badges y filtro por usuario del home
    });
}

// --- Etiquetas de un tablero (10/10/2026) ---
// Se guardan en el propio bundle (bundle.tags) con saveBundle: viajan a la nube sin migración.
const tagsModal = document.getElementById('tags-modal');
const tagsBoardName = document.getElementById('tags-board-name');
const tagsCurrent = document.getElementById('tags-current');
const tagsInput = document.getElementById('tags-input');
const tagsAddBtn = document.getElementById('btn-add-tag');
const tagsSuggestions = document.getElementById('tags-suggestions');
const tagsSuggestionsWrap = document.getElementById('tags-suggestions-wrap');
const tagsStatus = document.getElementById('tags-status');
let tagsBundle = null;
let tagsReturnFocusId = null;

function setTagsStatus(text) { if (tagsStatus) tagsStatus.textContent = text; }

async function persistTags(nextTags) {
    if (!tagsBundle) return;
    // Releer del disco: la versión de la tarjeta puede ser vieja (p. ej. la sync la reemplazó)
    const fresh = (await localforage.getItem(tagsBundle.id)) || tagsBundle;
    fresh.tags = normalizeTags(nextTags);
    tagsBundle = fresh;
    await saveBundle(fresh);
    renderTagsModal();
}

function renderTagsModal() {
    if (!tagsBundle || !tagsCurrent) return;
    const current = normalizeTags(tagsBundle.tags);
    tagsCurrent.replaceChildren();
    if (current.length === 0) {
        const p = document.createElement('p');
        p.className = 'assign-note';
        p.textContent = 'Este tablero todavía no tiene etiquetas.';
        tagsCurrent.appendChild(p);
    }
    current.forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip tag-chip-edit';
        const txt = document.createElement('span');
        txt.textContent = tag;
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'tag-chip-remove';
        x.textContent = '×';
        x.setAttribute('aria-label', `Quitar la etiqueta ${tag}`);
        x.onclick = async () => {
            await persistTags(current.filter(t => t !== tag));
            setTagsStatus(`Se quitó «${tag}».`);
            tagsInput?.focus();
        };
        chip.append(txt, x);
        tagsCurrent.appendChild(chip);
    });

    // Sugerencias: etiquetas usadas en otros tableros que este no tiene
    const own = new Set(current.map(tagKey));
    const typed = tagKey((tagsInput?.value || '').trim());
    const suggestions = tagsInUse(homeBundles.filter(b => b.id !== tagsBundle.id))
        .filter(s => !own.has(s.key) && (!typed || s.key.includes(typed)));
    tagsSuggestions.replaceChildren();
    suggestions.forEach(({ tag }) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'filter-chip';
        b.textContent = '+ ' + tag;
        b.setAttribute('aria-label', `Agregar la etiqueta ${tag}`);
        b.onclick = () => addTag(tag);
        tagsSuggestions.appendChild(b);
    });
    if (tagsSuggestionsWrap) tagsSuggestionsWrap.hidden = suggestions.length === 0;
    const full = current.length >= MAX_TAGS;
    if (tagsInput) tagsInput.disabled = full;
    if (tagsAddBtn) tagsAddBtn.disabled = full;
    tagsSuggestions.querySelectorAll('button').forEach(b => { b.disabled = full; });
}

async function addTag(raw) {
    if (!tagsBundle) return;
    const tag = normalizeTags([raw])[0];
    if (!tag) { setTagsStatus('Escribí una palabra para la etiqueta.'); return; }
    const current = normalizeTags(tagsBundle.tags);
    if (current.some(t => tagKey(t) === tagKey(tag))) { setTagsStatus(`«${tag}» ya está.`); return; }
    if (current.length >= MAX_TAGS) { setTagsStatus(`Hasta ${MAX_TAGS} etiquetas por tablero.`); return; }
    if (tagsInput) tagsInput.value = '';
    await persistTags([...current, tag]);
    setTagsStatus(`Se agregó «${tag}».`);
    if (tagsInput && !tagsInput.disabled) tagsInput.focus();
}

function openTagsModal(bundle, triggerBtn) {
    if (!tagsModal) return;
    tagsBundle = bundle;
    tagsReturnFocusId = triggerBtn ? bundle.id : null;
    if (tagsBoardName) tagsBoardName.textContent = bundle.name ? `«${bundle.name}»` : '';
    if (tagsInput) { tagsInput.value = ''; tagsInput.maxLength = MAX_TAG_LENGTH; }
    setTagsStatus('');
    renderTagsModal();
    tagsModal.style.display = 'flex';
    (tagsInput && !tagsInput.disabled ? tagsInput : document.getElementById('btn-done-tags'))?.focus();
}

async function closeTagsModal() {
    if (!tagsModal || tagsModal.style.display === 'none') return;
    tagsModal.style.display = 'none';
    tagsBundle = null;
    const focusId = tagsReturnFocusId;
    await loadSavedBoards(); // etiquetas de la tarjeta y pestañas
    if (focusId) [...boardList.querySelectorAll('[data-tags-for]')].find(b => b.dataset.tagsFor === focusId)?.focus();
}

if (tagsModal) {
    tagsAddBtn?.addEventListener('click', () => addTag(tagsInput.value));
    tagsInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addTag(tagsInput.value); }
    });
    tagsInput?.addEventListener('input', () => renderTagsModal());
    document.getElementById('btn-done-tags')?.addEventListener('click', closeTagsModal);
    document.getElementById('btn-close-tags')?.addEventListener('click', closeTagsModal);
    tagsModal.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeTagsModal(); } });
}
