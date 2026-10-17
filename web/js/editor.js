// editor.js — Editor de tableros (SPEC F3)
// El modelo de datos del editor ES el formato GRD nativo: editar = mutar el
// GridData del bundle y persistir. Export = serialización directa.

import { S } from './state.js';
import { labelText, navInfo } from './asterics.js';
import * as boards from './boards.js';
import { customAlert, customConfirm, showUndoToast, showInfoToast } from './ui.js';
import { saveBundle } from './sync.js';
import { pageOrder, pageCount, gridName, nextPageName, removePage, linksTo, migrateToActionSpeech } from './pages.js';
import { covered, insideGrid, maxSpan, firstFree, elementAt, canMoveGroup, insertRow, insertCol, deleteRow, deleteCol, rowIsEmpty, colIsEmpty } from './grid-layout.js';
import * as gridEdit from './grid-edit.js';

let editMode = false;
let editingCell = null; // { gridId, elData | null, x, y }
let arasaacSelection = null;
let uploadedImage = null;   // 0.8.1: imagen propia elegida (data URL ya achicada)
let clearImage = false;     // 0.8.1: "Quitar imagen"
let clipboardCell = null;   // 0.8.1: celda copiada o cortada (para Pegar)

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
        
        await withUndo(() => {
            g.rowCount = rows;
            g.minColumnCount = cols;
            // 0.8.1: una celda grande que queda cortada por el borde se achica para entrar
            for (const el of g.gridElements || []) {
                if (el.x < cols && el.x + (el.width || 1) > cols) el.width = cols - el.x;
                if (el.y < rows && el.y + (el.height || 1) > rows) el.height = rows - el.y;
            }
        });
    };
    
    // 0.8.1k: cada uno en su recuadro: «Filas  −  4  +» (el número muestra cuántas hay)
    const mkStepper = (label, minusFn, plusFn, countId, what) => {
        const box = document.createElement('div');
        box.className = 'et-stepper';
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', label);
        const l = document.createElement('span'); l.className = 'et-stepper-label'; l.textContent = label;
        const minus = mkBtn('−', minusFn, `Quitar una ${what} (la última)`); minus.className = 'et-step-btn'; minus.setAttribute('aria-label', `Quitar una ${what}`);
        const n = document.createElement('span'); n.className = 'et-stepper-count'; n.id = countId; n.setAttribute('aria-live', 'polite');
        const plus = mkBtn('+', plusFn, `Agregar una ${what} (al final)`); plus.className = 'et-step-btn'; plus.setAttribute('aria-label', `Agregar una ${what}`);
        box.append(l, minus, n, plus);
        return box;
    };
    const divRows = mkStepper('Filas', dims(-1, 0), dims(1, 0), 'et-rows-count', 'fila');
    tb.appendChild(divRows);

    // Aire pequeño
    const spacer3 = document.createElement('div');
    spacer3.style.width = '12px';
    tb.appendChild(spacer3);

    // Grupo Columnas
    const divCols = mkStepper('Columnas', dims(0, -1), dims(0, 1), 'et-cols-count', 'columna');
    tb.appendChild(divCols);

    // 0.8.1c: espacio entre celdas de esta página (para separar estímulos)
    const spacer5 = document.createElement('div');
    spacer5.style.width = '12px';
    tb.appendChild(spacer5);
    const gapSel = document.createElement('select');
    gapSel.className = 'glass-select et-dark';
    gapSel.title = 'Espaciado entre celdas de esta página';
    gapSel.setAttribute('aria-label', 'Espaciado entre celdas');
    [['', 'Automático'], ['4', 'Chico'], ['15', 'Normal'], ['32', 'Grande'], ['56', 'Muy grande']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; gapSel.appendChild(o); });
    gapSel.value = Number.isFinite(grid()?.cellGap) ? String(grid().cellGap) : '';
    if (gapSel.value === '' && Number.isFinite(grid()?.cellGap)) gapSel.value = '';
    gapSel.onchange = () => withUndo(() => { const g = grid(); if (gapSel.value === '') delete g.cellGap; else g.cellGap = parseInt(gapSel.value, 10); });
    tb.append(mkLabel('Espaciado'), gapSel);

    // 0.8.1: color de fondo de la página (la grilla)
    const spacer4 = document.createElement('div');
    spacer4.style.width = '12px';
    tb.appendChild(spacer4);
    const bgWrap = document.createElement('div');
    bgWrap.className = 'et-bg';
    const bgInput = document.createElement('input');
    bgInput.type = 'color';
    bgInput.title = 'Color de fondo de esta página';
    bgInput.setAttribute('aria-label', 'Color de fondo de esta página');
    bgInput.value = /^#[0-9a-f]{6}$/i.test(grid()?.backgroundColor || '') ? grid().backgroundColor : '#ffffff';
    const setBg = async (value) => {
        const backupBundle = JSON.parse(JSON.stringify(S.currentBundle));
        const g = grid();
        if (value) g.backgroundColor = value; else delete g.backgroundColor;
        await persistBundle();
        boards.renderGrid(S.currentGridId);
        showUndoToast(async () => { Object.assign(S.currentBundle, backupBundle); await persistBundle(); renderSafe(S.currentGridId); });
    };
    bgInput.onchange = () => setBg(bgInput.value);
    // iPad: el selector de color avisa con 'input' (a veces sin 'change' al cerrarse)
    let bgTimer = null;
    bgInput.oninput = () => { clearTimeout(bgTimer); bgTimer = setTimeout(() => { if (grid()?.backgroundColor !== bgInput.value) setBg(bgInput.value); }, 600); };
    const bgClear = mkBtn('Sin fondo', () => { bgInput.value = '#ffffff'; setBg(null); }, 'Quitar el color de fondo de esta página');
    bgClear.style.padding = '4px 10px';
    bgWrap.append(mkLabel('Fondo'), bgInput, bgClear);
    tb.appendChild(bgWrap);



    // 0.8.1d: dos filas ordenadas — 1) tablero, página y dificultad; 2) filas, columnas, espacio, fondo y, a la
    // derecha (0.8.1e: sin "Copiar para Claude")
    const lab = (t) => [...tb.querySelectorAll('.et-label')].find(l => l.textContent.startsWith(t));
    const row1 = document.createElement('div'); row1.className = 'et-row et-row-1';
    const row2 = document.createElement('div'); row2.className = 'et-row et-row-2';
    // 0.8.1r: "Dificultad" (niveles de vocabulario) queda oculta por ahora (boards.LEVELS_ENABLED)
    const dif = document.createElement('div'); dif.className = 'et-group'; dif.append(lab('Dificultad'), lvl);
    row1.append(lab('Tablero'), nameInput);
    if (boards.LEVELS_ENABLED) row1.append(dif);
    const esp = document.createElement('div'); esp.className = 'et-group'; esp.append(lab('Espaciado'), gapSel);
    const push = document.createElement('div'); push.style.flex = '1 1 auto';
    // 0.8.1g: "Seleccionar" (para el dedo; con mouse también sirve Shift/Cmd + clic o un recuadro desde un lugar vacío)
    const selBtn = mkBtn('Seleccionar', () => {
        gridEdit.setSelectMode(!gridEdit.isSelectMode());
        selBtn.classList.toggle('is-on', gridEdit.isSelectMode());
        selBtn.setAttribute('aria-pressed', String(gridEdit.isSelectMode()));
        if (gridEdit.isSelectMode()) showInfoToast('Tocá las celdas para elegirlas; después arrastrá una para mover todas.', 3500);
        else gridEdit.clearSelection();
    }, 'Elegir varias celdas para moverlas, duplicarlas, ocultarlas o eliminarlas juntas');
    selBtn.id = 'et-select';
    selBtn.setAttribute('aria-pressed', String(gridEdit.isSelectMode()));
    selBtn.classList.toggle('is-on', gridEdit.isSelectMode());
    // 0.8.1j: Deshacer / Rehacer con íconos (flechas curvas, como en los menús del sistema)
    const iconBtn = (id, label, svg, fn) => { const b2 = mkBtn('', fn, label); b2.id = id; b2.classList.add('et-icon'); b2.setAttribute('aria-label', label); b2.innerHTML = svg; return b2; };
    const undoBtn = iconBtn('et-undo', 'Deshacer (Cmd/Ctrl + Z)', '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>', () => undoLast());
    const redoBtn = iconBtn('et-redo', 'Rehacer (Cmd/Ctrl + Shift + Z)', '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>', () => redoLast());
    const undoGroup = document.createElement('div'); undoGroup.className = 'et-group et-undo-group'; undoGroup.append(undoBtn, redoBtn);
    row2.append(divRows, divCols, esp, bgWrap, push, undoGroup, selBtn);
    setTimeout(updateUndoButtons);
    tb.replaceChildren(row1, row2);

    document.getElementById('board-view').prepend(tb);
}


// --- Editor de celda (F3-3) ---
const modal = () => document.getElementById('cell-editor-modal');

export function openCellEditor(gridId, elData, x, y) {
    editingCell = { gridId, elData, x, y };
    arasaacSelection = null;
    uploadedImage = null;
    clearImage = false;

    const get = id => document.getElementById(id);
    get('ce-label').value = labelText(elData?.label);
    get('ce-show-label').checked = !elData?.labelHidden;
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

    // 0.8.1: tamaño (columnas × filas que ocupa), hasta el borde de la grilla
    const grid = S.currentBundle.boards[gridId];
    const ox = elData ? elData.x : x, oy = elData ? elData.y : y;
    const max = maxSpan(grid, ox, oy);
    const fill = (sel, n, v) => {
        sel.innerHTML = '';
        for (let i = 1; i <= n; i++) { const o = document.createElement('option'); o.value = String(i); o.textContent = String(i); sel.appendChild(o); }
        sel.value = String(Math.min(Math.max(1, v || 1), n));
    };
    fill(get('ce-w'), max.w, elData?.width);
    fill(get('ce-h'), max.h, elData?.height);
    get('ce-img-clear').disabled = !src;

    modal().style.display = 'flex';
}

// 0.8.1: vista previa de la imagen elegida (pictograma, propia o ninguna)
function showPreview(src) {
    const prev = document.getElementById('ce-img-preview');
    prev.innerHTML = '';
    if (src) { const im = document.createElement('img'); im.src = src; im.alt = ''; prev.appendChild(im); }
    document.getElementById('ce-img-clear').disabled = !src;
}

/**
 * 0.8.1: imagen propia → se achica (lado mayor ≤ 512 px) y se guarda como data URL dentro del tablero (anda sin
 * conexión y viaja con la nube y el respaldo). PNG si tiene transparencia; JPEG si es una foto.
 */
export async function shrinkImage(file, max = 512) {
    if (!file || !/^image\//.test(file.type || '')) throw new Error('El archivo no es una imagen.');
    if (file.size > 25 * 1024 * 1024) throw new Error('La imagen es demasiado grande (más de 25 MB).');
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la imagen.')); i.src = url; });
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        let alpha = false;
        if (/png|gif|webp|svg/.test(file.type)) {
            const d = ctx.getImageData(0, 0, w, h).data;
            for (let i = 3; i < d.length; i += 16) if (d[i] < 250) { alpha = true; break; }
        }
        return alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
    } finally { URL.revokeObjectURL(url); }
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
                uploadedImage = null; clearImage = false;
                showPreview(url);
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

    // 0.8.1: tamaño — si tapa otras celdas, se pregunta antes de quitarlas
    const w = parseInt(get('ce-w').value, 10) || 1, h = parseInt(get('ce-h').value, 10) || 1;
    const rect = { x: elData ? elData.x : x, y: elData ? elData.y : y, width: w, height: h };
    if (!insideGrid(grid, rect)) { customAlert('Con ese tamaño la celda se sale de la grilla.'); return; }
    const hit = covered(grid, rect, elData);
    if (hit.length) {
        const names = hit.map(e => labelText(e.label) || e.autoLabel?.es || 'sin texto').slice(0, 4).join(', ');
        const ok = await customConfirm(`Con ese tamaño, la celda tapa ${hit.length === 1 ? 'otra celda' : `${hit.length} celdas`} (${names}). ¿Quitarlas? Se puede deshacer.`);
        if (!ok) return;
        grid.gridElements = grid.gridElements.filter(e => !hit.includes(e));
    }

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
    elData.width = w; elData.height = h;
    if (get('ce-show-label').checked) delete elData.labelHidden; else elData.labelHidden = true;

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

    // 0.8.1: imagen propia o quitar la imagen
    if (clearImage) delete elData.image;
    if (uploadedImage) {
        elData.image = { id: 'grid-image-' + Date.now(), modelName: 'GridImage', data: uploadedImage, searchProviderName: 'propia' };
    }
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
    boards.hooks.isEditMode = () => editMode;
    boards.hooks.onPageRendered = () => { if (editMode) { renderPagesStrip(); updateUndoButtons(); } };

    // 0.8.1g: manipulación de la grilla (grid-edit.js)
    const curGrid = () => S.currentBundle.boards[S.currentGridId];
    gridEdit.editHooks.openEditor = (el) => { if (editMode) openCellEditor(S.currentGridId, el, el.x, el.y); };
    gridEdit.editHooks.openEmpty = (x, y) => { if (editMode) openCellEditor(S.currentGridId, null, x, y); };
    gridEdit.editHooks.openMenu = (px, py, el, x, y) => openCellMenu(px, py, el, x, y);
    gridEdit.editHooks.rowColMenu = (kind, i, px, py) => openRowColMenu(kind, i, px, py);
    gridEdit.editHooks.selectionChanged = (n) => updateSelectionBar(n);
    gridEdit.editHooks.moveGroup = async (group, dx, dy, target) => {
        if (!editMode) return;
        const g = curGrid();
        const single = (e) => (e.width || 1) === 1 && (e.height || 1) === 1;
        const el = group[0];
        if (group.length === 1 && target && single(el) && single(target)) {
            // Dos celdas de 1×1: se intercambian
            await withUndo(() => { const fx = el.x, fy = el.y; el.x = target.x; el.y = target.y; target.x = fx; target.y = fy; });
            return;
        }
        if (!canMoveGroup(g, group, dx, dy)) { showInfoToast('No entra ahí: hay otras celdas o se sale de la grilla.', 3000); boards.renderGrid(S.currentGridId); return; }
        await withUndo(() => { group.forEach(e => { e.x += dx; e.y += dy; }); });
    };
    gridEdit.editHooks.resize = (el, w, h) => boards.hooks.onCellResize(el, w, h);

    // Teclado en edición: Supr borra la selección, flechas la mueven, Esc la quita, Cmd/Ctrl+A selecciona todo,
    // Cmd/Ctrl+Z deshace. No actúa mientras se escribe en un campo o con un diálogo abierto.
    document.addEventListener('keydown', async (e) => {
        if (!editMode || S.state !== 'BOARD') return;
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (modal().style.display === 'flex' || document.getElementById('cell-menu')) return;
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); await undoLast(); return; }
        if ((mod && e.key.toLowerCase() === 'z' && e.shiftKey) || (e.ctrlKey && e.key.toLowerCase() === 'y')) { e.preventDefault(); await redoLast(); return; }
        if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); gridEdit.selectAll(); return; }
        if (!gridEdit.selection.size) return;
        const sel = [...gridEdit.selection];
        if (e.key === 'Escape') { gridEdit.clearSelection(); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); selectionAction('delete'); return; }
        const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (arrows[e.key]) {
            e.preventDefault();
            const [dx, dy] = arrows[e.key];
            if (canMoveGroup(curGrid(), sel, dx, dy)) await withUndo(() => { sel.forEach(c => { c.x += dx; c.y += dy; }); }, { toast: false });
        }
    });

    // 0.8.1c: agrandar/achicar una celda arrastrando su borde o esquina
    boards.hooks.onCellResize = async (elData, w, h) => {
        if (!editMode) return;
        const grid = S.currentBundle.boards[S.currentGridId];
        const rect = { x: elData.x, y: elData.y, width: w, height: h };
        if (!insideGrid(grid, rect)) { boards.renderGrid(S.currentGridId); return; }
        const hit = covered(grid, rect, elData);
        if (hit.length) {
            const names = hit.map(e => labelText(e.label) || e.autoLabel?.es || 'sin texto').slice(0, 4).join(', ');
            if (!(await customConfirm(`Con ese tamaño, la celda tapa ${hit.length === 1 ? 'otra celda' : `${hit.length} celdas`} (${names}). ¿Quitarlas? Se puede deshacer.`))) { boards.renderGrid(S.currentGridId); return; }
        }
        await withUndo(() => {
            if (hit.length) grid.gridElements = grid.gridElements.filter(e => !hit.includes(e));
            elData.width = w; elData.height = h;
        });
    };

    // 0.8.1: imagen propia
    const fileInput = document.getElementById('ce-upload-file');
    document.getElementById('ce-upload').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
    fileInput.addEventListener('change', async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        try {
            uploadedImage = await shrinkImage(f);
            arasaacSelection = null; clearImage = false;
            [...document.getElementById('ce-arasaac-results').children].forEach(c => c.classList.remove('selected'));
            showPreview(uploadedImage);
        } catch (e) { customAlert(e?.message || 'No se pudo usar esa imagen.'); }
    });
    document.getElementById('ce-img-clear').addEventListener('click', () => {
        uploadedImage = null; arasaacSelection = null; clearImage = true;
        [...document.getElementById('ce-arasaac-results').children].forEach(c => c.classList.remove('selected'));
        showPreview(null);
    });

    // 0.8.1: botón derecho sobre una celda → menú (Editar, Duplicar, Copiar, Cortar, Pegar, Ocultar, Eliminar)
    boards.hooks.cellContextMenu = (e, elData, x, y) => {
        const editBtn = document.getElementById('btn-edit-board');
        const canEdit = editMode || (editBtn && editBtn.offsetParent !== null && !document.body.classList.contains('protected-mode'));
        if (!canEdit || !S.currentBundle) return false;
        openCellMenu(e.clientX, e.clientY, elData, x, y);
        return true;
    };
    document.addEventListener('pointerdown', (e) => { const m = document.getElementById('cell-menu'); if (m && !m.contains(e.target)) closeCellMenu(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCellMenu(); });
    window.addEventListener('resize', closeCellMenu);
}

// --- 0.8.1: menú contextual de celda ---
function closeCellMenu() { document.getElementById('cell-menu')?.remove(); }

// 0.8.1g: pila de deshacer (Cmd/Ctrl+Z en edición) además del aviso con "Deshacer"; 0.8.1j: y de rehacer
const undoStack = [];
const redoStack = [];
const snapshot = () => ({ backup: JSON.parse(JSON.stringify(S.currentBundle)), gridId: S.currentGridId, bundleId: S.currentBundle.id });
async function applySnapshot(entry) {
    Object.assign(S.currentBundle, entry.backup);
    await persistBundle();
    renderSafe(entry.gridId);
    updateUndoButtons();
}
async function restoreBackup(entry) {
    const i = undoStack.indexOf(entry);
    if (i >= 0) undoStack.splice(i, 1);
    if (!S.currentBundle || S.currentBundle.id !== entry.bundleId) return;
    redoStack.push(snapshot());
    await applySnapshot(entry);
}
export async function undoLast() {
    const entry = undoStack[undoStack.length - 1];
    if (!entry || !S.currentBundle || entry.bundleId !== S.currentBundle.id) { showInfoToast('No hay nada para deshacer.', 1800); return; }
    await restoreBackup(entry);
}
export async function redoLast() {
    const entry = redoStack[redoStack.length - 1];
    if (!entry || !S.currentBundle || entry.bundleId !== S.currentBundle.id) { showInfoToast('No hay nada para rehacer.', 1800); return; }
    redoStack.pop();
    undoStack.push(snapshot());
    await applySnapshot(entry);
}
function updateUndoButtons() {
    const id = S.currentBundle?.id;
    const g = S.currentBundle?.boards?.[S.currentGridId];
    const rc = document.getElementById('et-rows-count'), cc = document.getElementById('et-cols-count');
    if (g && rc) rc.textContent = String(g.rowCount || 3);
    if (g && cc) cc.textContent = String(g.minColumnCount || 4);
    const u = document.getElementById('et-undo'), r = document.getElementById('et-redo');
    if (u) u.disabled = !undoStack.some(e => e.bundleId === id);
    if (r) r.disabled = !redoStack.some(e => e.bundleId === id);
}
async function withUndo(fn, { toast = true } = {}) {
    const entry = { backup: JSON.parse(JSON.stringify(S.currentBundle)), gridId: S.currentGridId, bundleId: S.currentBundle.id };
    const changed = await fn();
    if (changed === false) return false;
    undoStack.push(entry);
    if (undoStack.length > 20) undoStack.shift();
    redoStack.length = 0; // un cambio nuevo descarta lo que se podía rehacer
    await persistBundle();
    boards.renderGrid(entry.gridId);
    updateUndoButtons();
    if (toast) showUndoToast(() => restoreBackup(entry));
    return true;
}

function cloneCell(el) {
    const c = JSON.parse(JSON.stringify(el));
    c.id = 'grid-element-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    (c.actions || []).forEach((a, i) => { a.id = `ga-${Date.now()}-${i}`; });
    return c;
}

// --- 0.8.1g: filas y columnas intermedias ---
async function rowColOp(op, i) {
    const g = S.currentBundle.boards[S.currentGridId];
    if (op === 'row-del' && !rowIsEmpty(g, i)) { showInfoToast('Solo se puede eliminar una fila vacía (así no se pierde contenido).', 3500); return; }
    if (op === 'col-del' && !colIsEmpty(g, i)) { showInfoToast('Solo se puede eliminar una columna vacía (así no se pierde contenido).', 3500); return; }
    await withUndo(() => {
        if (op === 'row-before') insertRow(g, i);
        else if (op === 'row-after') insertRow(g, i + 1);
        else if (op === 'col-before') insertCol(g, i);
        else if (op === 'col-after') insertCol(g, i + 1);
        else if (op === 'row-del') return deleteRow(g, i);
        else if (op === 'col-del') return deleteCol(g, i);
    });
}
function buildMenu(px, py, items) {
    closeCellMenu();
    const menu = document.createElement('div');
    menu.id = 'cell-menu';
    menu.className = 'cell-menu';
    menu.setAttribute('role', 'menu');
    for (const it of items) {
        if (it === '-') { menu.appendChild(document.createElement('hr')); continue; }
        const b = document.createElement('button');
        b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = it.text; b.disabled = !!it.disabled;
        if (it.title) b.title = it.title;
        if (it.danger) b.classList.add('danger');
        b.onclick = async () => { closeCellMenu(); await it.fn(); };
        menu.appendChild(b);
    }
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(px, window.innerWidth - r.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(py, window.innerHeight - r.height - 8))}px`;
    menu.querySelector('button:not(:disabled)')?.focus();
}
function rowColItems(kind, i) {
    const g = S.currentBundle.boards[S.currentGridId];
    if (kind === 'row') {
        const empty = rowIsEmpty(g, i);
        return [
            { text: 'Insertar fila arriba', fn: () => rowColOp('row-before', i) },
            { text: 'Insertar fila abajo', fn: () => rowColOp('row-after', i) },
            { text: 'Eliminar esta fila', fn: () => rowColOp('row-del', i), danger: true, disabled: !empty || (g.rowCount || 3) <= 1, title: empty ? '' : 'Tiene celdas: vaciala primero' }
        ];
    }
    const empty = colIsEmpty(g, i);
    return [
        { text: 'Insertar columna a la izquierda', fn: () => rowColOp('col-before', i) },
        { text: 'Insertar columna a la derecha', fn: () => rowColOp('col-after', i) },
        { text: 'Eliminar esta columna', fn: () => rowColOp('col-del', i), danger: true, disabled: !empty || (g.minColumnCount || 4) <= 1, title: empty ? '' : 'Tiene celdas: vaciala primero' }
    ];
}
function openRowColMenu(kind, i, px, py) {
    if (!editMode) return;
    buildMenu(px, py, rowColItems(kind, i));
}

// --- 0.8.1g: selección múltiple ---
async function selectionAction(kind) {
    const sel = [...gridEdit.selection];
    if (!sel.length) return;
    const g = S.currentBundle.boards[S.currentGridId];
    if (kind === 'delete') {
        await withUndo(() => { g.gridElements = g.gridElements.filter(e => !gridEdit.selection.has(e)); });
        gridEdit.clearSelection();
    } else if (kind === 'hide') {
        const hide = sel.some(e => !e.hidden);
        await withUndo(() => { sel.forEach(e => { if (hide) e.hidden = true; else delete e.hidden; }); });
    } else if (kind === 'duplicate') {
        let lost = 0;
        await withUndo(() => {
            for (const e of sel) {
                const c = cloneCell(e);
                let spot = firstFree(g, c.width || 1, c.height || 1);
                if (!spot) { spot = firstFree(g, 1, 1); c.width = 1; c.height = 1; }
                if (!spot) { lost++; continue; }
                c.x = spot.x; c.y = spot.y; g.gridElements.push(c);
            }
            if (lost === sel.length) return false;
        });
        if (lost) showInfoToast(lost === sel.length ? 'No hay lugar libre en la grilla para duplicarlas.' : `No hubo lugar para ${lost} de las celdas.`, 3500);
    }
}
function updateSelectionBar(n) {
    let bar = document.getElementById('selection-bar');
    if (!n || !editMode) {
        bar?.remove();
        document.getElementById('et-select')?.classList.toggle('is-on', gridEdit.isSelectMode());
        return;
    }
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'selection-bar';
        bar.className = 'selection-bar';
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', 'Celdas seleccionadas');
        const count = document.createElement('span');
        count.className = 'sb-count';
        bar.appendChild(count);
        const mk = (text, fn, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sb-btn ' + cls; b.textContent = text; b.onclick = fn; bar.appendChild(b); return b; };
        mk('Duplicar', () => selectionAction('duplicate'));
        mk('Ocultar / Mostrar', () => selectionAction('hide'));
        mk('Eliminar', () => selectionAction('delete'), 'is-danger');
        mk('Listo', () => { gridEdit.clearSelection(); gridEdit.setSelectMode(false); updateSelectionBar(0); }, 'is-primary');
        document.body.appendChild(bar);
    }
    const cnt = bar.querySelector('.sb-count');
    cnt.textContent = `${n} ${n === 1 ? 'celda seleccionada' : 'celdas seleccionadas'}`;
    cnt.title = 'Arrastrá una para mover todas';
}

function openCellMenu(px, py, elData, x, y) {
    closeCellMenu();
    if (!editMode) enterEditMode(); // el botón derecho también entra a editar
    const grid = () => S.currentBundle.boards[S.currentGridId];
    const menu = document.createElement('div');
    menu.id = 'cell-menu';
    menu.className = 'cell-menu';
    menu.setAttribute('role', 'menu');
    const item = (text, fn, { disabled = false, danger = false } = {}) => {
        const b = document.createElement('button');
        b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = text; b.disabled = disabled;
        if (danger) b.classList.add('danger');
        b.onclick = async () => { closeCellMenu(); await fn(); };
        menu.appendChild(b);
    };
    const sep = () => menu.appendChild(document.createElement('hr'));
    const ox = elData ? elData.x : x, oy = elData ? elData.y : y;
    if (elData) {
        item('Editar', () => openCellEditor(S.currentGridId, elData, ox, oy));
        item('Duplicar', () => withUndo(() => {
            const g = grid(); const c = cloneCell(elData);
            let spot = firstFree(g, c.width || 1, c.height || 1);
            if (!spot) { spot = firstFree(g, 1, 1); c.width = 1; c.height = 1; }
            if (!spot) { customAlert('No hay lugar libre en la grilla para duplicarla.'); return false; }
            c.x = spot.x; c.y = spot.y; g.gridElements.push(c);
        }));
        sep();
        item('Copiar', () => { clipboardCell = JSON.parse(JSON.stringify(elData)); showInfoToast('Celda copiada: botón derecho en un lugar vacío → Pegar.', 3000); });
        item('Cortar', () => withUndo(() => {
            clipboardCell = JSON.parse(JSON.stringify(elData));
            grid().gridElements = grid().gridElements.filter(e2 => e2 !== elData);
        }));
    }
    item('Pegar', () => withUndo(() => {
        const g = grid(); const c = cloneCell(clipboardCell);
        c.x = ox; c.y = oy;
        const max = maxSpan(g, ox, oy);
        c.width = Math.min(c.width || 1, max.w); c.height = Math.min(c.height || 1, max.h);
        const hit = covered(g, c, elData || null).filter(e2 => e2 !== elData);
        if (hit.length) { showInfoToast('No entra ahí: tapa otras celdas.', 3000); return false; }
        if (elData) g.gridElements = g.gridElements.filter(e2 => e2 !== elData); // pegar sobre una celda la reemplaza
        g.gridElements.push(c);
    }), { disabled: !clipboardCell });
    if (elData) {
        item(elData.hidden ? 'Mostrar' : 'Ocultar', () => withUndo(() => { if (elData.hidden) delete elData.hidden; else elData.hidden = true; }));
        sep();
        item('Eliminar', () => withUndo(() => { grid().gridElements = grid().gridElements.filter(e2 => e2 !== elData); }), { danger: true });
    } else {
        item('Nueva celda', () => openCellEditor(S.currentGridId, null, x, y));
    }
    // 0.8.1g: filas y columnas desde la celda
    sep();
    for (const it of [...rowColItems('row', oy), ...rowColItems('col', ox)]) item(it.text, it.fn, { disabled: it.disabled, danger: it.danger });
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(px, window.innerWidth - r.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(py, window.innerHeight - r.height - 8))}px`;
    menu.querySelector('button:not(:disabled)')?.focus();
}
