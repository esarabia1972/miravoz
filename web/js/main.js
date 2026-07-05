// main.js — Bootstrap y wiring de la aplicación (SPEC F1-1)
// Único módulo que conoce a todos los demás. El loop de render vive acá.

import { CONFIG, settings, initSettings, saveSettings } from './config.js';
import { S } from './state.js';
import { OneEuroFilter } from './filters.js';
import { speak } from './speech.js';
import { customAlert, showInfoToast, playSentence, popSentence, clearSentence, renderSentence } from './ui.js';
import { initAuth } from './auth.js';
import * as boards from './boards.js';
import * as tracking from './tracking.js';
import * as calibration from './calibration.js';
import { DwellEngine } from './dwell.js';
import { ScanEngine } from './scanning.js';
import { Benchmark } from './benchmark.js';
import * as editor from './editor.js';

// --- Storage local ---
localforage.config({ name: 'Miravoz', storeName: 'boards' });

// --- DOM ---
const canvasUI = document.getElementById('ui-layer');
const ctxUI = canvasUI.getContext('2d');
const homeView = document.getElementById('home-view');
const boardView = document.getElementById('board-view');
const topBar = document.getElementById('top-bar');
const bottomBar = document.getElementById('bottom-bar');
const instructionBox = document.getElementById('instruction-box');
const modeSelect = document.getElementById('mode-select');
const dwellSelect = document.getElementById('dwell-select');
const btnRecalibrar = document.getElementById('btn-recalibrar');
const btnIniciarCalibracion = document.getElementById('btn-iniciar-calibracion');
const fileImport = document.getElementById('file-import');
const importModal = document.getElementById('import-modal');

canvasUI.width = window.innerWidth;
canvasUI.height = window.innerHeight;
window.addEventListener('resize', () => {
    canvasUI.width = window.innerWidth;
    canvasUI.height = window.innerHeight;
});

// --- Iris experimental (F0-11) ---
const optOjos = document.getElementById('opt-ojos');
const urlParams = new URLSearchParams(window.location.search);
if (optOjos && !CONFIG.EXPERIMENTAL_IRIS && urlParams.get('iris') !== '1') {
    optOjos.remove();
}

// --- Filtros 1 Euro (F1-2) ---
const filterX = new OneEuroFilter({ minCutoff: CONFIG.ONE_EURO_MIN_CUTOFF, beta: CONFIG.ONE_EURO_BETA, dCutoff: CONFIG.ONE_EURO_D_CUTOFF });
const filterY = new OneEuroFilter({ minCutoff: CONFIG.ONE_EURO_MIN_CUTOFF, beta: CONFIG.ONE_EURO_BETA, dCutoff: CONFIG.ONE_EURO_D_CUTOFF });

function resetFilters() {
    filterX.reset();
    filterY.reset();
    S.rawX = null; S.rawY = null;
    S.smoothX = null; S.smoothY = null;
}

// --- Selección de un target (compartida por dwell y barrido) ---
const selectTarget = (target) => {
    if (target.isBoardCard) {
        boards.openBundle(target.data);
    } else if (target.isAccBtn) {
        target.element.click();
    } else {
        boards.handleCellClick(target.element, target.data);
    }
};

// --- Dwell engine (F0-6, F1-6) ---
const dwell = new DwellEngine(selectTarget);

// --- Motor de barrido (F2) ---
const scan = new ScanEngine(selectTarget);

// F2-2: entrada de activación unificada — cualquier switch que emule click o tecla.
let lastSwitchActivation = 0;
function onSwitchActivate(e) {
    if (S.trackingMode !== 'SCAN') return;
    const now = performance.now();
    if (now - lastSwitchActivation < 250) return; // debounce (switches 3D rebotan)
    lastSwitchActivation = now;

    // No interceptar interacciones con modales/settings abiertos
    const modalOpen = [...document.querySelectorAll('.modal-overlay')].some(m => m.style.display !== 'none');
    if (modalOpen) return;

    if (scan.activate()) {
        if (e.cancelable) e.preventDefault();
    }
}
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') onSwitchActivate(e);
});
window.addEventListener('pointerdown', (e) => {
    // En modo barrido, tocar CUALQUIER parte de la pantalla es la activación
    // (excepto la barra inferior de controles, para poder salir del modo)
    if (S.trackingMode === 'SCAN' && !e.target.closest('#bottom-bar') && !e.target.closest('.modal-overlay')) {
        onSwitchActivate(e);
    }
});

// --- Benchmark (F1-7) ---
const benchmark = new Benchmark();

// --- Hooks de boards ---
boards.hooks.onGridRendered = (targets) => { dwell.setTargets(targets); scan.setTargets(targets); };
boards.hooks.onHomeRendered = (targets) => {
    if (S.state === 'HOME') { dwell.setTargets(targets); scan.setTargets(targets); }
};
boards.hooks.onCellActivated = (elData) => benchmark.onActivated(elData);
boards.hooks.onBundleOpened = () => {
    clearSentence();
    // Solo los modos de puntero (Rostro/Iris) requieren calibración; Barrido y Manual no.
    if ((S.trackingMode === 'CARA' || S.trackingMode === 'OJOS') && !S.isCalibrated) {
        startCalibration();
    } else {
        S.state = 'BOARD';
    }
};

// --- Calibración ---
let calibSession = null;

function startCalibration() {
    if (S.trackingMode !== 'CARA' && S.trackingMode !== 'OJOS') return;

    calibration.updateCalibPoints();
    calibSession = new calibration.CalibrationSession(S.trackingMode, onCalibrationComplete);
    S.state = 'CALIBRATING_PENDING';

    boardView.style.opacity = '0';
    setTimeout(() => { if (S.state.startsWith('CALIBRATING')) boardView.style.display = 'none'; }, 500);
    homeView.style.display = 'none';
    topBar.style.display = 'none';
    bottomBar.style.display = 'none';

    resetFilters();
    dwell.reset();
    instructionBox.style.display = 'block';
}

function onCalibrationComplete(profile) {
    calibSession = null;
    if (!profile) {
        customAlert('No se pudo completar la calibración. Verificá que la cámara te detecte e intentá de nuevo.');
        goHome();
        return;
    }

    tracking.setWeights(profile.weightsX, profile.weightsY);
    S.isCalibrated = true;
    resetFilters();

    if (S.currentBundle) {
        S.state = 'BOARD';
        boardView.style.display = 'flex';
        setTimeout(() => (boardView.style.opacity = '1'), 50);
        dwell.setTargets(boards.activeGridElements);
    } else {
        goHome();
    }

    speak('Calibración completada');
    const px = Math.round(profile.meanError);
    showInfoToast(`Calibración: ${profile.quality} (error medio ±${px}px)`, 5000);
    instructionBox.style.display = 'none';
}

btnIniciarCalibracion.addEventListener('click', () => {
    if (!calibSession) return;
    instructionBox.style.display = 'none';
    S.state = 'CALIBRATING_ACTIVE';
    calibSession.begin(performance.now());
});

btnRecalibrar.addEventListener('click', async () => {
    if (S.trackingMode === 'OJOS' || S.trackingMode === 'CARA') {
        await calibration.clearProfile(S.trackingMode);
        tracking.clearWeights();
        S.isCalibrated = false;
        startCalibration();
    } else {
        customAlert('La calibración solo aplica a los modos con cámara (Rostro/Iris). El Modo Barrido y el Manual no la necesitan.');
    }
});

// --- Cambio de modo ---
modeSelect.addEventListener('change', (e) => {
    applyMode(e.target.value);
    saveSettings({ accessMode: e.target.value }); // persistir entre sesiones
});

function applyMode(mode) {
    S.trackingMode = mode;

    if (S.trackingMode === 'CLICKS' || S.trackingMode === 'SCAN') {
        S.isCalibrated = false;
        tracking.stopMediaPipe();
        resetFilters();
        dwell.reset();
        ctxUI.clearRect(0, 0, canvasUI.width, canvasUI.height);
        instructionBox.style.display = 'none';

        if (S.currentBundle) {
            S.state = 'BOARD';
            boardView.style.display = 'flex';
        } else {
            goHome();
        }

        if (S.trackingMode === 'SCAN') {
            const targets = (S.state === 'HOME') ? boards.activeHomeElements : boards.activeGridElements;
            scan.setTargets(targets);
            scan.start();
        } else {
            scan.stop();
        }
    } else {
        scan.stop();
        tracking.startMediaPipe();
        const profile = calibration.profiles[S.trackingMode];
        if (profile && profile.weightsX) {
            tracking.setWeights(profile.weightsX, profile.weightsY);
            S.isCalibrated = true;
            resetFilters();
            const targets = (S.state === 'HOME') ? boards.activeHomeElements : boards.activeGridElements;
            dwell.setTargets(targets);
            console.log(`Calibración cargada para ${S.trackingMode} (${profile.quality || 's/d'})`);
        } else {
            S.isCalibrated = false;
            tracking.clearWeights();
            startCalibration();
        }
    }
}

// --- Navegación Home/Board ---
function goHome() {
    if (editor.isEditMode()) editor.exitEditMode();
    S.state = 'HOME';
    S.currentBundle = null;
    boards.loadSavedBoards(); // refresca las cards (nombres/contadores editados)
    boardView.style.display = 'none';
    homeView.style.display = 'flex';
    topBar.style.display = 'flex';
    bottomBar.style.display = 'flex';
    instructionBox.style.display = 'none';
    ctxUI.clearRect(0, 0, canvasUI.width, canvasUI.height);
    dwell.setTargets(boards.activeHomeElements);
    if (S.trackingMode === 'SCAN') scan.setTargets(boards.activeHomeElements);
}

document.getElementById('btn-acc-home').addEventListener('click', goHome);

document.getElementById('btn-acc-back').addEventListener('click', () => {
    if (S.navigationHistory.length > 0) {
        boards.renderGrid(S.navigationHistory.pop());
    }
});

function flashBtn(btn) {
    btn.classList.add('active');
    setTimeout(() => btn.classList.remove('active'), 200);
}

document.getElementById('btn-acc-play').addEventListener('click', (e) => {
    flashBtn(e.currentTarget);
    playSentence();
});
document.getElementById('btn-acc-delete').addEventListener('click', (e) => {
    flashBtn(e.currentTarget);
    popSentence();
});
document.getElementById('btn-acc-clear').addEventListener('click', (e) => {
    flashBtn(e.currentTarget);
    clearSentence();
});

// --- Import ---
fileImport.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const bundle = await boards.importFile(file);
        await boards.loadSavedBoards();
        importModal.style.display = 'none';
        customAlert(`¡Tablero .${bundle.type} importado exitosamente!`);
    } catch (err) {
        console.error('Error importando:', err);
        customAlert('Hubo un error importando el archivo: ' + err.message);
    }
    fileImport.value = '';
});

document.getElementById('btn-open-import').addEventListener('click', () => {
    importModal.style.display = 'flex';
});
document.getElementById('btn-close-import').addEventListener('click', () => {
    importModal.style.display = 'none';
});

document.getElementById('btn-test-board').addEventListener('click', () => {
    boards.openBundle(boards.buildTestBundle());
});

// --- Editor (Fase 3) ---
document.getElementById('btn-new-board').addEventListener('click', () => {
    editor.createNewBundle();
});
document.getElementById('btn-edit-board').addEventListener('click', () => {
    if (editor.isEditMode()) editor.exitEditMode();
    else editor.enterEditMode();
});

// --- Buscador ---
const searchInput = document.getElementById('board-search');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        document.querySelectorAll('.board-card').forEach(card => {
            const name = card.getAttribute('data-name') || '';
            card.style.display = name.includes(query) ? 'flex' : 'none';
        });
    });
}

// --- Settings modal ---
const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
if (btnSettings && settingsModal) {
    btnSettings.addEventListener('click', (e) => {
        e.preventDefault();
        settingsModal.style.display = 'flex';
    });
    document.getElementById('btn-close-settings').addEventListener('click', () => {
        settingsModal.style.display = 'none';
    });
}

if (dwellSelect) {
    dwellSelect.addEventListener('change', (e) => {
        saveSettings({ dwellMs: parseInt(e.target.value, 10) });
    });
}

// F2-5: settings de barrido
function wireScanSetting(id, key, isNumber = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = String(settings.scan[key]);
    el.addEventListener('change', (e) => {
        const value = isNumber ? parseInt(e.target.value, 10) : e.target.value;
        saveSettings({ scan: { ...settings.scan, [key]: value } });
    });
}

// --- Benchmark (F1-7): botón visible con ?benchmark=1 ---
if (urlParams.get('benchmark') === '1') {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = '📊 Benchmark';
    btn.onclick = () => benchmark.start();
    const group = document.querySelector('.bottom-group.group-right .control-group');
    if (group) group.prepend(btn);
}

// --- Loop principal ---
function appLoop() {
    // El try/catch garantiza que una excepción en un frame NUNCA mate el loop:
    // sin él, un error aborta el requestAnimationFrame y la app queda muerta en silencio.
    try {
        ctxUI.clearRect(0, 0, canvasUI.width, canvasUI.height);
        const now = performance.now();

        if (calibSession && S.state === 'CALIBRATING_ACTIVE') {
            calibSession.onFrame(tracking.currentFeatures, now);
            // onFrame puede completar la sesión (onCalibrationComplete pone calibSession en null):
            // re-chequear antes de dibujar el punto.
            if (calibSession) {
                const info = calibSession.renderInfo(now);
                if (info) drawCalibPoint(info);
            }
        } else if (editor.isEditMode()) {
            // En modo edición los motores de acceso quedan en pausa (se edita con mouse/touch)
        } else if ((S.state === 'BOARD' || S.state === 'HOME') && S.trackingMode === 'SCAN') {
            scan.tick(now);
        } else if ((S.state === 'BOARD' || S.state === 'HOME') && (S.trackingMode === 'CARA' || S.trackingMode === 'OJOS')) {
            if (S.rawX !== null && S.rawY !== null && !isNaN(S.rawX) && !isNaN(S.rawY)) {
                S.smoothX = filterX.filter(S.rawX, now);
                S.smoothY = filterY.filter(S.rawY, now);

                if (!isNaN(S.smoothX) && !isNaN(S.smoothY)) {
                    dwell.tick(S.smoothX, S.smoothY, now);
                    drawCursor(S.smoothX, S.smoothY);
                }
            }
        }
    } catch (e) {
        console.error('Error en appLoop (el loop continúa):', e);
    }

    requestAnimationFrame(appLoop);
}

function drawCalibPoint(info) {
    ctxUI.beginPath();
    ctxUI.arc(info.x, info.y, 25, 0, 2 * Math.PI);
    ctxUI.fillStyle = info.sampling ? '#00ff88' : '#ff3366';
    ctxUI.fill();
    ctxUI.lineWidth = 4;
    ctxUI.strokeStyle = '#ffffff';
    ctxUI.stroke();

    if (info.countdownProgress !== null) {
        ctxUI.beginPath();
        ctxUI.arc(info.x, info.y, 35, -Math.PI / 2, (-Math.PI / 2) + (info.countdownProgress * 2 * Math.PI));
        ctxUI.strokeStyle = '#ff3366';
        ctxUI.stroke();
    }

    ctxUI.fillStyle = '#ffffff';
    ctxUI.font = 'bold 20px Inter';
    ctxUI.textAlign = 'center';
    ctxUI.textBaseline = 'middle';
    ctxUI.fillText(info.label, info.x, info.y);
}

function drawCursor(x, y) {
    ctxUI.beginPath();
    ctxUI.arc(x, y, 15, 0, 2 * Math.PI);
    ctxUI.fillStyle = 'rgba(0, 255, 136, 0.8)';
    ctxUI.fill();
    ctxUI.lineWidth = 2;
    ctxUI.strokeStyle = '#ffffff';
    ctxUI.stroke();
}

// --- Arranque ---
(async function init() {
    await initSettings();
    if (dwellSelect) dwellSelect.value = String(settings.dwellMs);
    wireScanSetting('scan-pattern', 'pattern');
    wireScanSetting('scan-interval', 'intervalMs', true);
    wireScanSetting('scan-audio', 'audio');
    editor.initEditor();
    renderSentence();

    initAuth(async () => {
        await calibration.loadProfiles();
        await boards.loadSavedBoards();

        // Restaurar el modo de acceso de la sesión anterior (con perfiles ya cargados)
        let savedMode = settings.accessMode;
        if (savedMode === 'OJOS' && !document.getElementById('opt-ojos')) savedMode = 'CLICKS';
        if (savedMode && savedMode !== 'CLICKS' && savedMode !== S.trackingMode) {
            modeSelect.value = savedMode;
            applyMode(savedMode);
        }
    });

    requestAnimationFrame(appLoop);
})();
