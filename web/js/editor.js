// editor.js — Editor de tableros (SPEC F3)
// El modelo de datos del editor ES el formato GRD nativo: editar = mutar el
// GridData del bundle y persistir. Export = serialización directa.

import { S } from './state.js';
import * as boards from './boards.js';
import { customAlert, customConfirm } from './ui.js';

let editMode = false;
let editingCell = null; // { gridId, elData | null, x, y }
let arasaacSelection = null;

export function isEditMode() { return editMode; }

// --- Persistencia ---
async function persistBundle() {
    const b = S.currentBundle;
    if (!b) return;
    b.speechModel = 'actions'; // F3-3b: los tableros editados usan semántica de acciones
    const grid = b.boards[S.currentGridId];
    if (grid) grid.lastUpdateTime = Date.now();
    await localforage.setItem(b.id, b);
}

// --- Crear tablero nuevo (F3-1) ---
export function newGridData(name, rows = 3, cols = 4) {
    return {
        id: 'grid-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        modelName: 'GridData',
        modelVersion: '{"major": 7, "minor": 0, "patch": 0}',
        label: { es: name },
        rowCount: rows,
        minColumnCount: cols,
        gridElements: [],
        lastUpdateTime: Date.now()
    };
}

export async function createNewBundle() {
    const grid = newGridData('Mi tablero', 3, 4);
    const bundle = {
        id: 'bundle_' + Date.now(),
        name: 'Mi tablero',
        type: 'grd',
        importerVersion: boards.IMPORTER_VERSION,
        speechModel: 'actions',
        mainBoard: grid.id,
        boards: { [grid.id]: grid }
    };
    await localforage.setItem(bundle.id, bundle);
    boards.openBundle(bundle);
    enterEditMode();
}

// --- Modo edición (F3-2) ---
export function enterEditMode() {
    if (!S.currentBundle) return;
    editMode = true;
    document.body.classList.add('edit-mode');
    buildToolbar();
    boards.renderGrid(S.currentGridId || S.currentBundle.mainBoard);
}

export function exitEditMode() {
    editMode = false;
    document.body.classList.remove('edit-mode');
    const tb = document.getElementById('editor-toolbar');
    if (tb) tb.remove();
    boards.renderGrid(S.currentGridId);
}

function buildToolbar() {
    let tb = document.getElementById('editor-toolbar');
    if (tb) tb.remove();
    tb = document.createElement('div');
    tb.id = 'editor-toolbar';

    const b = S.currentBundle;
    const grid = () => b.boards[S.currentGridId];

    const mkBtn = (text, onClick, title = '') => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.textContent = text;
        btn.title = title;
        btn.onclick = onClick;
        return btn;
    };

    // Nombre del tablero (rename, F3-1)
    const nameInput = document.createElement('input');
    nameInput.className = 'glass-input';
    nameInput.style.width = '180px';
    nameInput.value = b.name;
    nameInput.onchange = async () => {
        b.name = nameInput.value.trim() || b.name;
        const g = grid();
        if (g) g.label = { ...(g.label || {}), es: b.name };
        await persistBundle();
    };
    tb.appendChild(nameInput);

    // Dimensiones
    const dims = (dr, dc) => async () => {
        const g = grid();
        const rows = Math.max(1, (g.rowCount || 3) + dr);
        const cols = Math.max(1, (g.minColumnCount || 4) + dc);
        const outOfRange = (g.gridElements || []).some(el => el.y >= rows || el.x >= cols);
        if (outOfRange && !(await customConfirm('Hay celdas fuera del nuevo tamaño: quedarán ocultas. ¿Continuar?'))) return;
        g.rowCount = rows;
        g.minColumnCount = cols;
        await persistBundle();
        boards.renderGrid(S.currentGridId);
    };
    tb.append(mkBtn('+Fila', dims(1, 0)), mkBtn('−Fila', dims(-1, 0)), mkBtn('+Col', dims(0, 1)), mkBtn('−Col', dims(0, -1)));

    // Nivel de vocabulario activo (F3-6)
    const lvl = document.createElement('select');
    lvl.className = 'glass-select';
    lvl.innerHTML = '<option value="0">Nivel: todos</option><option value="1">Nivel 1 (esencial)</option><option value="2">Nivel 2</option><option value="3">Nivel 3</option>';
    lvl.value = String(b.activeLevel || 0);
    lvl.onchange = async () => {
        b.activeLevel = parseInt(lvl.value, 10) || 0;
        await persistBundle();
        boards.renderGrid(S.currentGridId);
    };
    tb.appendChild(lvl);

    // Export .grd (F3-5)
    tb.appendChild(mkBtn('Exportar .grd', () => exportGrd(b)));

    tb.appendChild(mkBtn('✓ Terminar edición', exitEditMode));
    document.getElementById('board-view').prepend(tb);
}

// --- Export .grd (F3-5): serialización directa del formato nativo ---
export function exportGrd(bundle) {
    const payload = { grids: Object.values(bundle.boards) };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${bundle.name}.grd`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// --- Editor de celda (F3-3) ---
const modal = () => document.getElementById('cell-editor-modal');

export function openCellEditor(gridId, elData, x, y) {
    editingCell = { gridId, elData, x, y };
    arasaacSelection = null;

    const get = id => document.getElementById(id);
    get('ce-label').value = elData?.label ? (elData.label.es || elData.label.en || '') : '';

    // Modo de habla: deducir de las acciones existentes
    let speakMode = 'label', customText = '';
    if (elData?.actions) {
        const custom = elData.actions.find(a => a.modelName === 'GridActionSpeakCustom');
        const plain = elData.actions.find(a => a.modelName === 'GridActionSpeak');
        if (custom) { speakMode = 'custom'; customText = custom.speakText?.es || ''; }
        else if (!plain && S.currentBundle.speechModel === 'actions' && elData.id) speakMode = 'silent';
    }
    get('ce-speak-mode').value = speakMode;
    get('ce-speak-text').value = customText;
    get('ce-speak-text').style.display = speakMode === 'custom' ? 'block' : 'none';

    get('ce-color').value = elData?.colorCategory || '';
    get('ce-level').value = String(elData?.vocabularyLevel || 0);

    // Navegación: poblar tableros del bundle
    const navSel = get('ce-nav');
    navSel.innerHTML = '<option value="">No navega</option><option value="__new__">➕ Crear tablero nuevo…</option>';
    Object.values(S.currentBundle.boards).forEach(g => {
        if (g.id === gridId) return;
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = (g.label && (g.label.es || g.label.en)) || g.name || g.id;
        navSel.appendChild(opt);
    });
    const nav = elData?.actions?.find(a => (a.navType === 'navigateToGrid' || a.modelName === 'GridActionNavigate') && a.toGridId);
    navSel.value = nav ? nav.toGridId : '';

    // Preview de imagen actual
    const prev = get('ce-img-preview');
    prev.innerHTML = '';
    const src = elData?.image ? (elData.image.data || elData.image.url) : null;
    if (src) { const im = document.createElement('img'); im.src = src; prev.appendChild(im); }
    get('ce-arasaac-results').innerHTML = '';
    get('ce-arasaac-q').value = '';
    get('ce-delete').style.display = elData ? 'inline-block' : 'none';

    modal().style.display = 'flex';
}

// Búsqueda ARASAAC (F3-4)
async function searchArasaac(query) {
    const results = document.getElementById('ce-arasaac-results');
    results.innerHTML = '<p style="color:#aaa;">Buscando…</p>';
    try {
        const resp = await fetch(`https://api.arasaac.org/api/pictograms/es/search/${encodeURIComponent(query)}`);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const list = await resp.json();
        results.innerHTML = '';
        list.slice(0, 18).forEach(p => {
            const url = `https://api.arasaac.org/api/pictograms/${p._id}?download=false&plural=false&color=true`;
            const img = document.createElement('img');
            img.src = url;
            img.title = (p.keywords && p.keywords[0]?.keyword) || '';
            img.onclick = () => {
                arasaacSelection = { url, id: p._id };
                [...results.children].forEach(c => c.classList.remove('selected'));
                img.classList.add('selected');
            };
            results.appendChild(img);
        });
        if (list.length === 0) results.innerHTML = '<p style="color:#aaa;">Sin resultados.</p>';
    } catch (e) {
        results.innerHTML = '<p style="color:#f88;">Error buscando en ARASAAC (¿hay internet?).</p>';
    }
}

// Cachear el pictograma elegido como data-URL (offline-ready, F3-4)
async function toDataUrl(url) {
    try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        return await new Promise(res => {
            const r = new FileReader();
            r.onloadend = () => res(r.result);
            r.readAsDataURL(blob);
        });
    } catch { return null; }
}

async function saveCell() {
    const { gridId, x, y } = editingCell;
    let { elData } = editingCell;
    const grid = S.currentBundle.boards[gridId];
    const get = id => document.getElementById(id);

    if (!elData) {
        elData = {
            id: 'grid-element-' + Date.now(), modelName: 'GridElement',
            width: 1, height: 1, x, y, label: {}, actions: [], wordForms: [], pronunciation: {}
        };
        grid.gridElements = grid.gridElements || [];
        grid.gridElements.push(elData);
    }

    const labelText = get('ce-label').value.trim();
    elData.label = { ...(elData.label || {}), es: labelText };

    // Color
    elData.colorCategory = get('ce-color').value || null;

    // Nivel (F3-6)
    const level = parseInt(get('ce-level').value, 10) || 0;
    elData.vocabularyLevel = level || null;

    // Acciones: reconstruir speak + navigate preservando las demás
    const others = (elData.actions || []).filter(a =>
        !['GridActionSpeak', 'GridActionSpeakCustom', 'GridActionNavigate'].includes(a.modelName) &&
        a.navType !== 'navigateToGrid');
    const actions = [...others];

    const speakMode = get('ce-speak-mode').value;
    if (speakMode === 'label') {
        actions.push({ id: 'ga-speak-' + Date.now(), modelName: 'GridActionSpeak' });
    } else if (speakMode === 'custom') {
        actions.push({ id: 'ga-speakc-' + Date.now(), modelName: 'GridActionSpeakCustom', speakText: { es: get('ce-speak-text').value.trim() } });
    } // silent: sin acción de speak

    let navTo = get('ce-nav').value;
    if (navTo === '__new__') {
        const g = newGridData(labelText || 'Nuevo tablero');
        S.currentBundle.boards[g.id] = g;
        navTo = g.id;
    }
    if (navTo) {
        actions.push({ id: 'ga-nav-' + Date.now(), modelName: 'GridActionNavigate', navType: 'navigateToGrid', toGridId: navTo });
    }
    elData.actions = actions;

    // Imagen ARASAAC elegida: guardar con atribución (CC BY-NC-SA) y cache offline
    if (arasaacSelection) {
        const data = await toDataUrl(arasaacSelection.url);
        elData.image = {
            id: 'grid-image-' + Date.now(), modelName: 'GridImage',
            url: arasaacSelection.url, data,
            author: 'Sergio Palao / ARASAAC', authorURL: 'https://arasaac.org/terms-of-use',
            searchProviderName: 'ARASAAC'
        };
    }

    await persistBundle();
    modal().style.display = 'none';
    boards.renderGrid(gridId);
}

async function deleteCell() {
    const { gridId, elData } = editingCell;
    if (!elData) return;
    if (!(await customConfirm('¿Eliminar esta celda?'))) return;
    const grid = S.currentBundle.boards[gridId];
    grid.gridElements = grid.gridElements.filter(e => e !== elData);
    await persistBundle();
    modal().style.display = 'none';
    boards.renderGrid(gridId);
}

// --- Wiring del modal (una vez) ---
export function initEditor() {
    document.getElementById('ce-arasaac-q').addEventListener('keydown', (e) => {
        if (e.code === 'Enter') { e.preventDefault(); searchArasaac(e.target.value.trim()); }
    });
    document.getElementById('ce-arasaac-go').addEventListener('click', () => {
        searchArasaac(document.getElementById('ce-arasaac-q').value.trim());
    });
    document.getElementById('ce-speak-mode').addEventListener('change', (e) => {
        document.getElementById('ce-speak-text').style.display = e.target.value === 'custom' ? 'block' : 'none';
    });
    document.getElementById('ce-save').addEventListener('click', saveCell);
    document.getElementById('ce-cancel').addEventListener('click', () => { modal().style.display = 'none'; });
    document.getElementById('ce-delete').addEventListener('click', deleteCell);

    // Interceptores en boards
    boards.hooks.cellClickInterceptor = (cell, elData) => {
        if (!editMode) return false;
        openCellEditor(S.currentGridId, elData, elData.x, elData.y);
        return true;
    };
    boards.hooks.emptyCellClick = (x, y) => {
        if (!editMode) return;
        openCellEditor(S.currentGridId, null, x, y);
    };
    boards.hooks.isEditMode = () => editMode;
}
