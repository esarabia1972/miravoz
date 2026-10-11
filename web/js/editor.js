// editor.js — Editor de tableros (SPEC F3)
// El modelo de datos del editor ES el formato GRD nativo: editar = mutar el
// GridData del bundle y persistir. Export = serialización directa.

import { S } from './state.js';
import { labelText, navInfo } from './asterics.js';
import * as boards from './boards.js';
import { customAlert, customConfirm, showUndoToast, showInfoToast } from './ui.js';
import { saveBundle } from './sync.js';
import { pageOrder, pageCount, gridName, nextPageName, removePage, linksTo, migrateToActionSpeech } from './pages.js';

let editMode = false;
let editingCell = null; // { gridId, elData | null, x, y }
let arasaacSelection = null;

export function isEditMode() { return editMode; }

// --- Persistencia ---
async function persistBundle() {
    const b = S.currentBundle;
    if (!b) return;
    delete b.__predExtra; // palabras del tablero para la predicción: se recalculan
    migrateToActionSpeech(b); // F3-3b: los tableros editados usan semántica de acciones (sin cambiar lo que se dice)
    const grid = b.boards[S.currentGridId];
    if (grid) grid.lastUpdateTime = Date.now();
    await saveBundle(b); // local + nube (antes solo local: se perdía al recargar con sesión)
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
    await saveBundle(bundle, { isNew: true });
    boards.openBundle(bundle);
    enterEditMode();
}

// --- Modo edición (F3-2) ---
export function enterEditMode() {
    if (!S.currentBundle) return;
    // Tablet vinculada: una copia de solo lectura no se edita (el lápiz ya está oculto; esto lo garantiza)
    if (S.currentBundle.assignmentId && !S.currentBundle.profEdit && S.currentBundle.permission !== 'editable') return;
    if (S.currentBundle.type === 'test') return; // el tablero de prueba es fijo
    // Se pasa a voz por acciones ANTES de cualquier respaldo de "deshacer": así deshacer no deja celdas mudas
    migrateToActionSpeech(S.currentBundle);
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
    pagesOpen = false;
    boards.renderGrid(S.currentGridId);
}

/** Muestra una página existente (después de un deshacer, la actual puede no existir más). */
function renderSafe(gridId) {
    const b = S.currentBundle;
    if (!b) return;
    boards.renderGrid(b.boards[gridId] ? gridId : b.mainBoard);
}

// --- Páginas del tablero (10/10/2026) ---
// Un tablero importado de Asterics puede traer varias páginas vinculadas. En el editor se ven todas en
// una franja: tocar una la abre para editarla; además se agregan, renombran, borran y se elige la de inicio.
const thumbCache = new Map(); // `${gridId}:${lastUpdateTime}` -> nodo de miniatura

function pageThumb(grid) {
    const key = `${S.currentBundle.id}:${grid.id}:${grid.lastUpdateTime || 0}:${S.currentBundle.showAutoLabels ? 1 : 0}`;
    if (!thumbCache.has(key)) {
        if (thumbCache.size > 200) thumbCache.clear();
        thumbCache.set(key, boards.buildGridThumb(grid, S.currentBundle));
    }
    const node = thumbCache.get(key);
    return node ? node.cloneNode(true) : null;
}

async function goToPage(gridId) {
    S.navigationHistory = [];
    boards.renderGrid(gridId);
}

async function addPage() {
    const b = S.currentBundle;
    const cur = b.boards[S.currentGridId];
    const backupBundle = JSON.parse(JSON.stringify(b));
    const g = newGridData(nextPageName(b), cur?.rowCount || 3, cur?.minColumnCount || 4);
    b.boards[g.id] = g;
    await persistBundle();
    boards.renderGrid(g.id);
    showUndoToast(async () => {
        Object.assign(S.currentBundle, backupBundle);
        await persistBundle();
        renderSafe(S.currentGridId);
    });
}

async function deletePage(gridId) {
    const b = S.currentBundle;
    if (pageCount(b) <= 1) return;
    const name = gridName(b.boards[gridId]) || 'esta página';
    const links = linksTo(b, gridId);
    const extra = links ? ` ${links === 1 ? 'Una celda navega' : `${links} celdas navegan`} a esta página: ${links === 1 ? 'queda' : 'quedan'} sin ese vínculo.` : '';
    if (!(await customConfirm(`¿Borrar la página «${name}»?${extra}`))) return;
    const backupBundle = JSON.parse(JSON.stringify(b));
    removePage(b, gridId);
    await persistBundle();
    S.navigationHistory = [];
    boards.renderGrid(b.mainBoard);
    showUndoToast(async () => {
        Object.assign(S.currentBundle, backupBundle);
        await persistBundle();
        renderSafe(gridId);
    });
}

async function setStartPage(gridId) {
    const b = S.currentBundle;
    if (b.mainBoard === gridId) return;
    const prev = b.mainBoard;
    b.mainBoard = gridId;
    await persistBundle();
    renderPagesStrip();
    showUndoToast(async () => {
        S.currentBundle.mainBoard = prev;
        await persistBundle();
        renderPagesStrip();
    });
}

function hasAutoLabels(b) {
    return Object.values(b.boards || {}).some(g => (g.gridElements || []).some(el => el.autoLabel && el.autoLabel.es));
}

// La franja ocupaba demasiado alto (10/10/2026, pedido de Esteban): ahora las páginas van en un selector
// compacto dentro de la barra del editor ("‹ Página 1 de 5 · Nombre ▾ ›") que despliega un panel.
let pagesOpen = false;

function setPagesOpen(open) {
    pagesOpen = open;
    const panel = document.getElementById('editor-pages');
    const btn = document.querySelector('#editor-toolbar .ep-current');
    if (panel) panel.hidden = !open;
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', (e) => {
        if (!pagesOpen) return;
        const nav = document.querySelector('#editor-toolbar .ep-nav');
        const dialog = document.getElementById('custom-dialog');
        if (nav && !nav.contains(e.target) && !(dialog && dialog.contains(e.target))) setPagesOpen(false);
    });
    document.addEventListener('keydown', (e) => {
        if (pagesOpen && e.key === 'Escape') {
            setPagesOpen(false);
            const btn = document.querySelector('#editor-toolbar .ep-current');
            if (btn) btn.focus();
        }
    });
}

export function renderPagesStrip() {
    const b = S.currentBundle;
    const tb = document.getElementById('editor-toolbar');
    let nav = tb && tb.querySelector('.ep-nav');
    if (!editMode || !b || !tb) { if (nav) nav.remove(); pagesOpen = false; return; }
    if (!nav) {
        nav = document.createElement('div');
        nav.className = 'ep-nav';
        const anchor = tb.querySelector('.et-name');
        if (anchor) anchor.after(nav); else tb.prepend(nav);
    }
    nav.replaceChildren();

    const order = pageOrder(b);
    const idx = Math.max(0, order.indexOf(S.currentGridId));
    const mkArrow = (txt, label, target) => {
        const a = document.createElement('button');
        a.type = 'button';
        a.className = 'btn btn-secondary ep-arrow';
        a.textContent = txt;
        a.title = label;
        a.setAttribute('aria-label', label);
        a.disabled = !target;
        a.onclick = () => { if (target) goToPage(target); };
        return a;
    };
    const current = document.createElement('button');
    current.type = 'button';
    current.className = 'ep-current';
    current.setAttribute('aria-haspopup', 'true');
    current.title = 'Ver todas las páginas';
    const curName = gridName(b.boards[S.currentGridId]) || `Página ${idx + 1}`;
    const count = document.createElement('span');
    count.className = 'ep-count';
    count.textContent = order.length > 1 ? `Página ${idx + 1} de ${order.length}` : 'Página';
    const nm = document.createElement('span');
    nm.className = 'ep-current-name';
    nm.textContent = curName; // viene del archivo importado: textContent
    const caret = document.createElement('span');
    caret.className = 'ep-caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '▾';
    current.append(count, nm, caret);
    current.onclick = () => setPagesOpen(!pagesOpen);
    nav.append(mkArrow('‹', 'Página anterior', order[idx - 1]), current, mkArrow('›', 'Página siguiente', order[idx + 1]));

    const bar = document.createElement('div');
    bar.id = 'editor-pages';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Páginas del tablero');
    nav.appendChild(bar);

    const list = document.createElement('div');
    list.className = 'ep-list';
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', 'Páginas del tablero');
    pageOrder(b).forEach((id, i) => {
        const g = b.boards[id];
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ep-page' + (id === S.currentGridId ? ' is-active' : '');
        chip.setAttribute('role', 'tab');
        chip.setAttribute('aria-selected', id === S.currentGridId ? 'true' : 'false');
        const name = gridName(g) || `Página ${i + 1}`;
        chip.title = name;
        const thumb = pageThumb(g);
        const box = document.createElement('span');
        box.className = 'ep-thumb';
        if (thumb) box.appendChild(thumb);
        const label = document.createElement('span');
        label.className = 'ep-name';
        label.textContent = name; // lo escribe la profesional: textContent
        chip.append(box, label);
        if (id === b.mainBoard) {
            const start = document.createElement('span');
            start.className = 'ep-start';
            start.textContent = 'Inicio';
            chip.appendChild(start);
        }
        chip.onclick = () => { setPagesOpen(false); if (id !== S.currentGridId) goToPage(id); };
        list.appendChild(chip);
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'ep-add';
    add.textContent = '+ Página';
    add.title = 'Agregar una página vacía a este tablero';
    add.onclick = addPage;
    list.appendChild(add);

    // Acciones de la página que se está editando
    const cur = b.boards[S.currentGridId];
    const tools = document.createElement('div');
    tools.className = 'ep-tools';
    const lbl = document.createElement('span');
    lbl.className = 'et-label';
    lbl.textContent = 'Esta página';
    const nameIn = document.createElement('input');
    nameIn.className = 'glass-input et-dark ep-rename';
    nameIn.value = gridName(cur);
    nameIn.setAttribute('aria-label', 'Nombre de esta página');
    nameIn.onchange = async () => {
        const v = nameIn.value.trim();
        if (!v || !cur) { nameIn.value = gridName(cur); return; }
        cur.label = { ...(cur.label || {}), es: v };
        if (pageCount(b) === 1) b.name = v; // con una sola página, página y tablero se llaman igual
        await persistBundle();
        renderPagesStrip();
    };
    const startBtn = document.createElement('button');
    startBtn.className = 'btn btn-secondary';
    startBtn.textContent = b.mainBoard === S.currentGridId ? 'Es la de inicio' : 'Usar como inicio';
    startBtn.disabled = b.mainBoard === S.currentGridId;
    startBtn.title = 'La página con la que se abre el tablero';
    startBtn.onclick = () => setStartPage(S.currentGridId);
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-secondary ep-delete';
    delBtn.textContent = 'Borrar página';
    delBtn.disabled = pageCount(b) <= 1;
    delBtn.title = pageCount(b) <= 1 ? 'Un tablero necesita al menos una página' : 'Borrar esta página';
    delBtn.onclick = () => deletePage(S.currentGridId);
    tools.append(lbl, nameIn, startBtn, delBtn);

    // Textos que MiraVoz completó desde ARASAAC: se dicen siempre; mostrarlos en la celda es opcional
    if (hasAutoLabels(b)) {
        const wrap = document.createElement('label');
        wrap.className = 'ep-autolabels';
        wrap.title = 'Los pictogramas que venían sin texto usan la palabra de ARASAAC para la voz. Esto decide si además se ve en la celda.';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!b.showAutoLabels;
        cb.onchange = async () => {
            b.showAutoLabels = cb.checked;
            await persistBundle();
            boards.renderGrid(S.currentGridId);
        };
        wrap.append(cb, document.createTextNode(' Mostrar texto de los pictogramas'));
        tools.appendChild(wrap);
    }

    bar.append(list, tools);
    setPagesOpen(pagesOpen);
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

    const mkLabel = (text, title = '') => {
        const l = document.createElement('span');
        l.className = 'et-label';
        l.textContent = text;
        if (title) { l.title = title; l.textContent += ' ⓘ'; }
        return l;
    };

    // Nombre del tablero (rename, F3-1). Con varias páginas, cada página se renombra en la franja de páginas.
    tb.appendChild(mkLabel('Tablero'));
    const nameInput = document.createElement('input');
    nameInput.className = 'glass-input et-dark et-name';
    nameInput.value = b.name;
    nameInput.onchange = async () => {
        b.name = nameInput.value.trim() || b.name;
        nameInput.value = b.name;
        const g = grid();
        if (g && pageCount(b) === 1) g.label = { ...(g.label || {}), es: b.name };
        await persistBundle();
        renderPagesStrip();
    };
    tb.appendChild(nameInput);

    // 1.7.0: referencia para pegar en Claude (conector MiraVoz): tablero y página actuales
    const refBtn = mkBtn('Copiar para Claude', async () => {
        const g = grid();
        const text = `Tablero "${b.name}" (id: ${b.id})${g ? `, página "${gridName(g) || 'inicio'}"` : ''}`;
        try { await navigator.clipboard.writeText(text); showInfoToast('Copiado: pegalo en Claude para pedirle cambios en este tablero.', 4000); }
        catch { customAlert(text); }
    }, 'Copia el nombre y el id del tablero y de la página para pedirle cambios a Claude');
    refBtn.classList.add('et-claude');
    tb.appendChild(refBtn);
    
    // Aire
    const spacer1 = document.createElement('div');
    spacer1.style.width = '24px';
    tb.appendChild(spacer1);

    // Nivel de vocabulario activo (F3-6)
    tb.appendChild(mkLabel('Dificultad', 'Filtra qué celdas ve el usuario según su nivel: cada celda tiene un "nivel de vocabulario" en su editor. "Todas" muestra el tablero completo; "Nivel 1" solo lo esencial. Sirve para usar el MISMO tablero con usuarios de distinta capacidad sin duplicarlo.'));
    const lvl = document.createElement('select');
    lvl.className = 'glass-select et-dark';
    lvl.innerHTML = '<option value="0">Todas las celdas</option><option value="1">Solo nivel 1 (esencial)</option><option value="2">Hasta nivel 2</option><option value="3">Hasta nivel 3</option>';
    lvl.value = String(b.activeLevel || 0);
    lvl.onchange = async () => {
        b.activeLevel = parseInt(lvl.value, 10) || 0;
        await persistBundle();
        boards.renderGrid(S.currentGridId);
    };
    tb.appendChild(lvl);

    // Aire
    const spacer2 = document.createElement('div');
    spacer2.style.width = '24px';
    tb.appendChild(spacer2);

    // Dimensiones
    const dims = (dr, dc) => async () => {
        const g = grid();
        const rows = Math.max(1, (g.rowCount || 3) + dr);
        const cols = Math.max(1, (g.minColumnCount || 4) + dc);
        const outOfRange = (g.gridElements || []).some(el => el.y >= rows || el.x >= cols);
        if (outOfRange && !(await customConfirm('Hay celdas fuera del nuevo tamaño: quedarán ocultas. ¿Continuar?'))) return;
        
        const backupBundle = JSON.parse(JSON.stringify(S.currentBundle));
        g.rowCount = rows;
        g.minColumnCount = cols;
        await persistBundle();
        boards.renderGrid(S.currentGridId);

        showUndoToast(async () => {
            Object.assign(S.currentBundle, backupBundle);
            await persistBundle();
            renderSafe(S.currentGridId);
        });
    };
    
    // Grupo Filas
    const divRows = document.createElement('div');
    divRows.style.cssText = 'display:flex; align-items:center; gap:4px;';
    const btnRowMinus = mkBtn('−', dims(-1, 0)); btnRowMinus.style.padding = '4px 8px';
    const btnRowPlus = mkBtn('+', dims(1, 0)); btnRowPlus.style.padding = '4px 8px';
    divRows.append(btnRowMinus, mkLabel('Filas'), btnRowPlus);
    tb.appendChild(divRows);

    // Aire pequeño
    const spacer3 = document.createElement('div');
    spacer3.style.width = '12px';
    tb.appendChild(spacer3);

    // Grupo Columnas
    const divCols = document.createElement('div');
    divCols.style.cssText = 'display:flex; align-items:center; gap:4px;';
    const btnColMinus = mkBtn('−', dims(0, -1)); btnColMinus.style.padding = '4px 8px';
    const btnColPlus = mkBtn('+', dims(0, 1)); btnColPlus.style.padding = '4px 8px';
    divCols.append(btnColMinus, mkLabel('Columnas'), btnColPlus);
    tb.appendChild(divCols);



    document.getElementById('board-view').prepend(tb);
}


// --- Editor de celda (F3-3) ---
const modal = () => document.getElementById('cell-editor-modal');

export function openCellEditor(gridId, elData, x, y) {
    editingCell = { gridId, elData, x, y };
    arasaacSelection = null;

    const get = id => document.getElementById(id);
    get('ce-label').value = labelText(elData?.label);
    // Texto completado desde ARASAAC: se sugiere como placeholder (escribir un texto lo reemplaza)
    get('ce-label').placeholder = elData?.autoLabel?.es ? `${elData.autoLabel.es} (de ARASAAC)` : '';

    // Modo de habla: deducir de las acciones existentes
    let speakMode = 'label', customText = '';
    if (elData?.actions) {
        const custom = elData.actions.find(a => a.modelName === 'GridActionSpeakCustom');
        const plain = elData.actions.find(a => a.modelName === 'GridActionSpeak');
        if (custom) { speakMode = 'custom'; customText = labelText(custom.speakText); }
        else if (!plain && S.currentBundle.speechModel === 'actions' && elData.id) speakMode = 'silent';
    }
    get('ce-speak-mode').value = speakMode;
    get('ce-speak-text').value = customText;
    get('ce-speak-text').style.display = speakMode === 'custom' ? 'block' : 'none';

    get('ce-color').value = elData?.colorCategory || '';
    get('ce-level').value = String(elData?.vocabularyLevel || 0);

    // Navegación: poblar tableros del bundle
    const navSel = get('ce-nav');
    navSel.innerHTML = '<option value="">No navega</option><option value="__back__">Volver a la página anterior</option><option value="__home__">Ir a la página de inicio</option><option value="__new__">Crear página nueva…</option>';
    Object.values(S.currentBundle.boards).forEach(g => {
        if (g.id === gridId) return;
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = labelText(g.label) || g.name || g.id;
        navSel.appendChild(opt);
    });
    // Navegación de Asterics: a una página, "volver" o "ir al inicio" (un vínculo roto se muestra como "No navega")
    const nav = elData ? navInfo(elData, S.currentBundle) : null;
    navSel.value = !nav ? '' : nav.kind === 'back' ? '__back__' : nav.kind === 'home' ? '__home__' : (nav.kind === 'grid' && !nav.broken ? nav.target : '');

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
    results.innerHTML = '<p style="color:var(--text-muted);">Buscando…</p>';
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
        if (list.length === 0) results.innerHTML = '<p style="color:var(--text-muted);">Sin resultados.</p>';
    } catch (e) {
        results.innerHTML = '<p style="color:var(--error-text);">Error buscando en ARASAAC (¿hay internet?).</p>';
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
    
    // Backup for undo
    const backupBundle = JSON.parse(JSON.stringify(S.currentBundle));

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

    const rawLabel = get('ce-label').value;
    // La tecla espacio de un teclado tiene texto ' ': no se recorta. Se guarda solo en español
    // (si quedaran otras variantes, al vaciar el texto reaparecería, p. ej., el de es-ar).
    const labelText = rawLabel.trim() === '' && rawLabel.length > 0 ? ' ' : rawLabel.trim();
    elData.label = { es: labelText };

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

    const prevNav = (elData.actions || []).find(a => a.modelName === 'GridActionNavigate');
    const keep = prevNav && prevNav.addToCollectElem ? { addToCollectElem: true } : {}; // "agregar a la frase al navegar"
    let navTo = get('ce-nav').value;
    if (navTo === '__new__') {
        const g = newGridData(labelText || nextPageName(S.currentBundle));
        S.currentBundle.boards[g.id] = g;
        navTo = g.id;
    }
    if (navTo === '__back__') {
        actions.push({ id: 'ga-nav-' + Date.now(), modelName: 'GridActionNavigate', navType: 'navigateToLastOpenedGrid', ...keep });
    } else if (navTo === '__home__') {
        actions.push({ id: 'ga-nav-' + Date.now(), modelName: 'GridActionNavigate', navType: 'navigateToHomeGrid', ...keep });
    } else if (navTo) {
        actions.push({ id: 'ga-nav-' + Date.now(), modelName: 'GridActionNavigate', navType: 'navigateToGrid', toGridId: navTo, ...keep });
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
    
    showUndoToast(async () => {
        Object.assign(S.currentBundle, backupBundle);
        await persistBundle();
        renderSafe(gridId);
    });
}

async function deleteCell() {
    const { gridId, elData } = editingCell;
    if (!elData) return;
    
    // Backup for undo
    const backupBundle = JSON.parse(JSON.stringify(S.currentBundle));
    
    const grid = S.currentBundle.boards[gridId];
    grid.gridElements = grid.gridElements.filter(e => e !== elData);
    await persistBundle();
    modal().style.display = 'none';
    boards.renderGrid(gridId);
    
    showUndoToast(async () => {
        Object.assign(S.currentBundle, backupBundle);
        await persistBundle();
        renderSafe(gridId);
    });
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
    boards.hooks.onCellDropped = async (fromX, fromY, toX, toY) => {
        if (!editMode) return;
        const grid = S.currentBundle.boards[S.currentGridId];
        if (!grid || !grid.gridElements) return;
        
        // Backup for undo
        const backupBundle = JSON.parse(JSON.stringify(S.currentBundle));
        
        const sourceEl = grid.gridElements.find(e => e.x === fromX && e.y === fromY);
        const targetEl = grid.gridElements.find(e => e.x === toX && e.y === toY);
        
        if (sourceEl) {
            sourceEl.x = toX;
            sourceEl.y = toY;
        }
        if (targetEl) {
            targetEl.x = fromX;
            targetEl.y = fromY;
        }
        
        await persistBundle();
        boards.renderGrid(S.currentGridId);
        
        showUndoToast(async () => {
            Object.assign(S.currentBundle, backupBundle);
            await persistBundle();
            renderSafe(S.currentGridId);
        });
    };
    boards.hooks.isEditMode = () => editMode;
    boards.hooks.onPageRendered = () => { if (editMode) renderPagesStrip(); };
}
