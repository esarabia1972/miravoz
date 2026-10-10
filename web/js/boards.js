// boards.js — Import GRD/OBZ, gestión de bundles, render de tableros (SPEC F1-1)

import { S } from './state.js';
import { customAlert, customConfirm, addToSentence, showUndoToast } from './ui.js';
import { speak } from './speech.js';
import { getCellColor } from './colors.js';
import { saveBundle, removeBundle, isVisibleTo, pushBundle } from './sync.js';

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
    onCellDropped: () => {}       // editor (F3)
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
        const bundleName = bundle.name.toLowerCase();
        const bestMatch = unreferenced.find(id => {
            let boardName = bundle.boards[id].name || '';
            if (!boardName && bundle.boards[id].label) {
                boardName = bundle.boards[id].label.es || bundle.boards[id].label.en || '';
            }
            return typeof boardName === 'string' && boardName.toLowerCase().includes(bundleName);
        });
        bundle.mainBoard = bestMatch || unreferenced[0];
    }
}

// --- Import .grd ---
async function importGrd(file) {
    const text = await file.text();
    const json = JSON.parse(text);
    const bundle = {
        id: 'bundle_' + Date.now(),
        name: file.name.replace('.grd', ''),
        type: 'grd',
        importerVersion: IMPORTER_VERSION,
        mainBoard: json.grids[0].id,
        boards: {}
    };
    json.grids.forEach(g => { bundle.boards[g.id] = g; });
    inferMainBoard(bundle);
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

export async function importFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    let bundle = null;
    if (ext === 'grd') bundle = await importGrd(file);
    else if (ext === 'obz') bundle = await importObz(file);
    else throw new Error('Formato no soportado: ' + ext);

    await saveBundle(bundle, { isNew: true }); // local + nube (si hay sesión, nace en la cuenta)
    return bundle;
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
 * Usuario: solo tableros asignados a ese usuario.
 */
export function matchesHomeFilters(bundle, { tags = [], userBoardIds = null } = {}) {
    if (tags.length) {
        const own = new Set(normalizeTags(bundle.tags).map(tagKey));
        if (!tags.every(t => own.has(t))) return false;
    }
    if (userBoardIds && !userBoardIds.has(bundle.id)) return false;
    return true;
}

// Estado de filtros y asignaciones del home
const homeFilters = { tags: new Set(), userId: '' }; // tags en minúsculas
let homeCards = [];             // [{ card, bundle, entry }]
let assignCountByBoard = new Map();
let boardsByUser = new Map();   // aac_user_id -> Set(board_id)
let filterUsers = [];           // [{ id, display_name }]
let assignmentsRequest = 0;

const ICONS = {
    assign: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    tags: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>',
    export: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
    duplicate: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
    remove: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>'
};

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

function renderCardTags(container, bundle) {
    const tags = normalizeTags(bundle.tags);
    container.replaceChildren();
    container.hidden = tags.length === 0;
    tags.slice(0, 3).forEach(t => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = t;
        container.appendChild(chip);
    });
    if (tags.length > 3) {
        const more = document.createElement('span');
        more.className = 'tag-chip tag-chip-more';
        more.textContent = `+${tags.length - 3}`;
        more.title = tags.slice(3).join(', ');
        container.appendChild(more);
    }
    container.setAttribute('aria-label', tags.length ? `Etiquetas: ${tags.join(', ')}` : '');
}

/** Miniatura del tablero principal: grilla chica con los colores y pictogramas de cada celda. */
export function buildBoardThumb(bundle) {
    const grid = bundle.boards && bundle.boards[bundle.mainBoard];
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
            const label = el.label ? (el.label.es || el.label.en || '') : '';
            if (label) { const t = document.createElement('span'); t.textContent = label; c.appendChild(t); }
        }
        box.appendChild(c);
    }
    return box;
}

function buildBoardCard(bundle) {
    const card = document.createElement('div');
    card.className = 'board-card glass-box';
    card.setAttribute('data-name', bundle.name.toLowerCase());
    card.dataset.boardId = bundle.id;

    let previewText = 'Sin opciones';
    let optionsCount = 0;
    if (bundle.boards && bundle.mainBoard && bundle.boards[bundle.mainBoard]) {
        const mainElements = bundle.boards[bundle.mainBoard].gridElements || [];
        optionsCount = mainElements.length;
        const labels = mainElements
            .map(e => e.label ? (e.label.es || e.label.en) : '')
            .filter(Boolean).slice(0, 5);
        if (labels.length > 0) {
            previewText = labels.join(', ') + (optionsCount > 5 ? '...' : '');
        }
    }

    const infoDiv = document.createElement('div');
    infoDiv.className = 'board-card-info';
    const h3 = document.createElement('h3');
    h3.className = 'board-card-title';
    h3.textContent = bundle.name;
    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'board-card-tags';
    renderCardTags(tagsDiv, bundle);
    // Vista previa: miniatura del tablero principal armada en el momento con los datos locales
    // (no se guarda en la base). Si no hay celdas, se muestra el texto de siempre.
    const thumb = buildBoardThumb(bundle);
    const pMeta = document.createElement('p');
    pMeta.className = 'board-card-meta';
    pMeta.textContent = optionsCount ? `${optionsCount} celdas` : previewText;
    infoDiv.append(h3, tagsDiv, ...(thumb ? [thumb] : []), pMeta);

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

    actionsDiv.append(assignWrap, tagsBtn, exportBtn, duplicateBtn, deleteBtn);

    const progress = document.createElement('div');
    progress.className = 'progress-bar';
    progress.style.cssText = 'position:absolute; bottom:0; left:0; height:10px; background:rgba(0,255,136,0.5); width:0%; transition:width 0.1s linear;';

    card.append(infoDiv, actionsDiv, progress);
    card.onclick = () => openBundle(bundle);

    const entry = { element: card, data: bundle, isBoardCard: true };
    return { card, bundle, entry, assignBtn, badge };
}

export async function loadSavedBoards() {
    // Si ya se está renderizando, no descartar el pedido: re-renderizar al terminar
    if (isRenderingBoards) { rerenderRequested = true; return; }
    isRenderingBoards = true;
    try {
        const keys = await localforage.keys();
        boardList.innerHTML = '';
        activeHomeElements = [];
        homeCards = [];

        const fragment = document.createDocumentFragment();
        for (const key of keys) {
            if (key.startsWith('miravoz_')) continue; // settings, calibración, benchmarks

            const bundle = await localforage.getItem(key);
            if (!bundle || !bundle.name) continue;
            // El tablero de prueba no se guarda: si quedó en disco por error (versiones viejas), se limpia.
            // No es de nadie ni está en la nube, así que no pasa por removeBundle.
            if (bundle.type === 'test') { await localforage.removeItem(key); continue; }
            // F4: tableros de una cuenta solo se ven con esa cuenta; los locales sin dueño, siempre
            if (!isVisibleTo(bundle, S.currentUser?.id)) continue;

            const item = buildBoardCard(bundle);
            homeCards.push(item);
            fragment.appendChild(item.card);
        }

        if (homeCards.length === 0) {
            boardList.innerHTML = '<p style="color: var(--text-muted);">Todavía no hay tableros. Creá uno nuevo o importá uno para empezar.</p>';
        } else {
            boardList.appendChild(fragment);
        }
        updateAssignBadges();
        renderHomeFilterBar();
        applyHomeFilters(); // también avisa a main (hooks.onHomeRendered) con las tarjetas visibles
        refreshAssignments(); // en segundo plano: badges y filtro por usuario
    } finally {
        isRenderingBoards = false;
        if (rerenderRequested) { rerenderRequested = false; loadSavedBoards(); }
    }
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
    if (req !== assignmentsRequest) return; // llegó una respuesta más nueva
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

function makeFilterChip(text, pressed, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter-chip';
    btn.textContent = text;
    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    btn.onclick = onClick;
    return btn;
}

function renderHomeFilterBar() {
    if (!tagFilterChips) return;
    const used = tagsInUse(homeCards.map(c => c.bundle));
    // Descartar etiquetas elegidas que ya no existen
    [...homeFilters.tags].forEach(k => { if (!used.some(u => u.key === k)) homeFilters.tags.delete(k); });

    tagFilterChips.replaceChildren();
    if (used.length) {
        tagFilterChips.appendChild(makeFilterChip('Todas', homeFilters.tags.size === 0, () => {
            homeFilters.tags.clear();
            renderHomeFilterBar(); applyHomeFilters();
        }));
        used.forEach(({ tag, key, count }) => {
            const chip = makeFilterChip(`${tag} (${count})`, homeFilters.tags.has(key), () => {
                if (homeFilters.tags.has(key)) homeFilters.tags.delete(key); else homeFilters.tags.add(key);
                renderHomeFilterBar(); applyHomeFilters();
                [...tagFilterChips.querySelectorAll('.filter-chip')].find(c => c.dataset.key === key)?.focus();
            });
            chip.dataset.key = key;
            chip.setAttribute('aria-label', `${tag}, ${count} ${count === 1 ? 'tablero' : 'tableros'}`);
            tagFilterChips.appendChild(chip);
        });
    }
    tagFilterChips.hidden = used.length === 0;
    renderUserFilter();
}

function renderUserFilter() {
    if (!userFilterSelect || !userFilterWrap) return;
    const show = !!S.currentUser && filterUsers.length > 0 && homeCards.length > 0;
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
    if (filterBar) filterBar.hidden = (tagFilterChips?.hidden ?? true) && userFilterWrap.hidden;
}

if (userFilterSelect) {
    userFilterSelect.addEventListener('change', () => {
        homeFilters.userId = userFilterSelect.value;
        applyHomeFilters();
    });
}

/** Aplica etiquetas + usuario con una clase propia (el buscador de texto usa style.display y no la pisa). */
export function applyHomeFilters() {
    const criteria = {
        tags: [...homeFilters.tags],
        userBoardIds: homeFilters.userId ? (boardsByUser.get(homeFilters.userId) || new Set()) : null
    };
    const visible = [];
    homeCards.forEach(({ card, bundle, entry }) => {
        const ok = matchesHomeFilters(bundle, criteria);
        card.classList.toggle('is-filtered-out', !ok);
        if (ok) visible.push(entry);
    });
    activeHomeElements = visible;
    if (filterEmptyMsg) filterEmptyMsg.hidden = !(homeCards.length > 0 && visible.length === 0);
    hooks.onHomeRendered(activeHomeElements);
}

// --- Apertura y render de tableros ---

export function openBundle(bundle) {
    try {
        if ((!bundle.importerVersion || bundle.importerVersion < IMPORTER_VERSION) && bundle.type !== 'test') {
            customAlert('Este tablero fue importado con una versión anterior — reimportalo para corregir posibles errores de imágenes y navegación.');
        }
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
    } catch (err) {
        console.error('Error en openBundle:', err);
        customAlert('Error al intentar abrir el tablero: ' + err.message);
    }
}

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

    let hasNavigation = false;
    if (elementData.actions) {
        for (const action of elementData.actions) {
            if (isNavigateAction(action)) {
                hasNavigation = true;
                setTimeout(() => {
                    S.navigationHistory.push(S.currentGridId);
                    renderGrid(action.toGridId);
                }, 100);
            }
        }
    }

    if (!hasNavigation) {
        const labelText = elementData.label ? (elementData.label.es || elementData.label.en) : '';
        // F3-3b: semántica de habla por acciones para bundles editados en MiraVoz;
        // comportamiento legacy (hablar el label) para bundles importados sin editar.
        let toSpeak = labelText;
        if (S.currentBundle && S.currentBundle.speechModel === 'actions') {
            const custom = (elementData.actions || []).find(a => a.modelName === 'GridActionSpeakCustom');
            const plain = (elementData.actions || []).find(a => a.modelName === 'GridActionSpeak');
            if (custom) toSpeak = (custom.speakText && custom.speakText.es) || labelText;
            else if (!plain) toSpeak = null; // celda silenciosa
        }
        if (toSpeak) speak(toSpeak);
        if (labelText || elementData.image) {
            addToSentence({
                text: labelText,
                speakText: toSpeak,
                imageUrl: elementData.image ? (elementData.image.data || elementData.image.url) : null,
                elData: elementData
            });
        }
    }
    hooks.onCellActivated(elementData);
}

export function renderGrid(gridId) {
    if (!S.currentBundle || !S.currentBundle.boards[gridId]) {
        console.error('No se encontró el grid:', gridId);
        return;
    }

    // Drag and drop helper
    const handleDragDrop = (cell, targetX, targetY) => {
        if (!hooks.isEditMode()) return;
        cell.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });
        cell.addEventListener('dragenter', (e) => e.preventDefault());
        cell.addEventListener('drop', (e) => {
            e.preventDefault();
            try {
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                if (data.gridId === gridId && hooks.onCellDropped) {
                    hooks.onCellDropped(data.x, data.y, targetX, targetY);
                }
            } catch (err) {}
        });
    };

    S.currentGridId = gridId;
    const gridData = S.currentBundle.boards[gridId];
    gridContainer.innerHTML = '';
    activeGridElements = [];

    const rows = gridData.rowCount || 3;
    const cols = gridData.minColumnCount || 4;

    // Gap dinámico para grillas densas (teclados)
    if (cols > 8) {
        gridContainer.style.gap = '4px';
        gridContainer.style.padding = '5px 10px';
        gridContainer.classList.add('dense-grid');
    } else {
        gridContainer.style.gap = '15px';
        gridContainer.style.padding = '10px 30px';
        gridContainer.classList.remove('dense-grid');
    }

    gridContainer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    gridContainer.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    gridContainer.setAttribute('role', 'group');
    const gridLabel = gridData.label ? (gridData.label.es || gridData.label.en || '') : '';
    if (gridLabel) gridContainer.setAttribute('aria-label', gridLabel);

    // F3-6: filtro por nivel de vocabulario activo (fuera del modo edición)
    const activeLevel = (!hooks.isEditMode() && S.currentBundle.activeLevel) || 0;

    const cellsMatrix = Array(rows).fill(null).map(() => Array(cols).fill(null));
    (gridData.gridElements || []).forEach(el => {
        if (activeLevel && el.vocabularyLevel && el.vocabularyLevel > activeLevel) return;
        if (el.y < rows && el.x < cols) cellsMatrix[el.y][el.x] = el;
    });

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
                        img.alt = elData.label ? (elData.label.es || '') : '';
                        cell.appendChild(img);
                    }
                }

                if (elData.label) {
                    const label = document.createElement('div');
                    label.className = 'picto-label';
                    label.innerText = elData.label.es || elData.label.en || '';
                    if (elData.textColor) label.style.color = elData.textColor;
                    cell.appendChild(label);
                }

                const progress = document.createElement('div');
                progress.className = 'progress-bar';
                cell.appendChild(progress);

                // F2-6: accesibilidad estructural (base para barrido y lectores de pantalla)
                cell.setAttribute('role', 'button');
                cell.setAttribute('tabindex', '0');
                const ariaLabel = elData.label ? (elData.label.es || elData.label.en || '') : '';
                if (ariaLabel) cell.setAttribute('aria-label', ariaLabel);
                cell.addEventListener('keydown', (e) => {
                    // Solo en modo Manual: en Barrido, Espacio/Enter son la activación del switch
                    if (S.trackingMode === 'CLICKS' && (e.code === 'Enter' || e.code === 'Space')) {
                        e.preventDefault();
                        handleCellClick(cell, elData);
                    }
                });

                cell.onclick = () => handleCellClick(cell, elData);
                activeGridElements.push({ element: cell, data: elData, isAccBtn: false });
                
                if (hooks.isEditMode()) {
                    cell.draggable = true;
                    cell.addEventListener('dragstart', (e) => {
                        e.dataTransfer.setData('text/plain', JSON.stringify({ x: elData.x, y: elData.y, gridId }));
                        e.dataTransfer.effectAllowed = 'move';
                    });
                    handleDragDrop(cell, elData.x, elData.y);
                }
            } else {
                cell.classList.add('empty-cell');
                if (hooks.isEditMode()) {
                    cell.classList.add('editable-slot');
                    const ex = x, ey = y;
                    cell.onclick = () => hooks.emptyCellClick(ex, ey);
                    handleDragDrop(cell, ex, ey);
                }
            }

            gridContainer.appendChild(cell);
        }
    }

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

    hooks.onGridRendered(activeGridElements);
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
        .select('aac_user_id')
        .eq('board_id', bundle.id);
    if (bundleToAssign !== bundle) return; // se cerró o se abrió otro mientras tanto
    if (error) console.error('Error leyendo asignaciones:', error);

    const assignedUserIds = new Set((Array.isArray(assignments) ? assignments : []).map(a => a.aac_user_id));

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
            const tag = document.createElement('span');
            tag.className = 'assign-tag';
            tag.textContent = '(ya tiene su copia)';
            label.appendChild(tag);
        }
        assignUsersList.appendChild(label);
    });
    updateAssignButton();
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
    const suggestions = tagsInUse(homeCards.map(c => c.bundle).filter(b => b.id !== tagsBundle.id))
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
    await loadSavedBoards(); // chips de la tarjeta y filtros
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
