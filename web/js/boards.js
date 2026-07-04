// boards.js — Import GRD/OBZ, gestión de bundles, render de tableros (SPEC F1-1)

import { S } from './state.js';
import { customAlert, customConfirm, addToSentence } from './ui.js';
import { speak } from './speech.js';
import { getCellColor } from './colors.js';
import { uploadBoardToSupabase, deleteBoardFromSupabase } from './auth.js';

export const IMPORTER_VERSION = 1;

// Hooks que instala main.js (evita dependencias circulares)
export const hooks = {
    onBundleOpened: () => {},     // decide calibración/estado tras abrir
    onGridRendered: () => {},     // main pasa los targets al DwellEngine
    onHomeRendered: () => {},     // ídem para las cards del home
    onCellActivated: () => {}     // notificación de selección (benchmark F1-7)
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

    await localforage.setItem(bundle.id, bundle);
    uploadBoardToSupabase(bundle); // background, no-op sin sesión real
    return bundle;
}

// --- Home: listado de tableros guardados ---
let isRenderingBoards = false;

export async function loadSavedBoards() {
    if (isRenderingBoards) return;
    isRenderingBoards = true;
    try {
        const keys = await localforage.keys();
        boardList.innerHTML = '';
        activeHomeElements = [];

        const fragment = document.createDocumentFragment();
        let boardCount = 0;
        for (const key of keys) {
            if (key.startsWith('miravoz_')) continue; // settings, calibración, benchmarks

            const bundle = await localforage.getItem(key);
            if (!bundle || !bundle.name) continue;

            boardCount++;
            const card = document.createElement('div');
            card.className = 'board-card glass-box';
            card.style.flexDirection = 'column';
            card.style.alignItems = 'flex-start';
            card.style.gap = '15px';
            card.style.position = 'relative';
            card.style.overflow = 'hidden';
            card.setAttribute('data-name', bundle.name.toLowerCase());

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
            const h3 = document.createElement('h3');
            h3.style.cssText = 'margin:0; font-size:1.2rem; color:white;';
            h3.textContent = bundle.name;
            const pType = document.createElement('p');
            pType.style.cssText = 'font-size:0.85rem; color:#aaa; margin:5px 0 0 0;';
            pType.textContent = `Tipo: ${(bundle.type || '').toUpperCase()} | Opciones: ${optionsCount}`;
            const pPrev = document.createElement('p');
            pPrev.style.cssText = 'font-size:0.8rem; color:#888; margin:2px 0 0 0; font-style:italic;';
            pPrev.textContent = previewText;
            infoDiv.append(h3, pType, pPrev);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-delete-card';
            deleteBtn.style.alignSelf = 'flex-end';
            deleteBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();
                const confirmed = await customConfirm(`¿Estás seguro de que quieres eliminar el tablero "${bundle.name}"?`);
                if (confirmed) {
                    await localforage.removeItem(key);
                    deleteBoardFromSupabase(key);
                    loadSavedBoards();
                }
            };

            const progress = document.createElement('div');
            progress.className = 'progress-bar';
            progress.style.cssText = 'position:absolute; bottom:0; left:0; height:10px; background:rgba(0,255,136,0.5); width:0%; transition:width 0.1s linear;';

            card.append(infoDiv, deleteBtn, progress);
            card.onclick = () => openBundle(bundle);
            fragment.appendChild(card);

            activeHomeElements.push({ element: card, data: bundle, isBoardCard: true });
        }

        if (boardCount === 0) {
            boardList.innerHTML = '<p style="color: #aaa;">No hay tableros guardados. Importa uno para comenzar.</p>';
        } else {
            boardList.appendChild(fragment);
        }
        hooks.onHomeRendered(activeHomeElements);
    } finally {
        isRenderingBoards = false;
    }
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
        document.getElementById('board-view').style.display = 'flex';

        renderGrid(bundle.mainBoard);
        hooks.onBundleOpened();
    } catch (err) {
        console.error('Error en openBundle:', err);
        customAlert('Error al intentar abrir el tablero: ' + err.message);
    }
}

let lastCellClickTime = 0;

export function handleCellClick(cellElement, elementData) {
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
        const text = elementData.label ? (elementData.label.es || elementData.label.en) : '';
        if (text) {
            speak(text);
            addToSentence({
                text,
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

    const cellsMatrix = Array(rows).fill(null).map(() => Array(cols).fill(null));
    (gridData.gridElements || []).forEach(el => {
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

            if (elData && !elData.hidden) {
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

                cell.onclick = () => handleCellClick(cell, elData);
                activeGridElements.push({ element: cell, data: elData, isAccBtn: false });
            } else {
                cell.classList.add('empty-cell');
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
