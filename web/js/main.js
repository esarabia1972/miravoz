// main.js — Bootstrap y wiring de la aplicación (SPEC F1-1)
// Único módulo que conoce a todos los demás. El loop de render vive acá.

import { CONFIG, settings, initSettings, saveSettings } from './config.js';
import { S } from './state.js';
import { OneEuroFilter } from './filters.js';
import { speak } from './speech.js';
import { customAlert, showInfoToast, playSentence, popSentence, clearSentence, renderSentence, cancelUndo } from './ui.js';
import { initAuth, signOut } from './auth.js';
import { fetchUsers, setProfessionalId, initUsers } from './users.js';
import { syncAll } from './sync.js';
import * as deviceMod from './device.js';
import * as boards from './boards.js';
import * as tracking from './tracking.js';
import * as gaze from './gaze-model.js';
import * as calibration from './calibration.js';
import { DwellEngine } from './dwell.js';
import { ScanEngine } from './scanning.js';
import { Benchmark } from './benchmark.js';
import * as editor from './editor.js';

// --- Cuenta (F4): opcional. Sin sesión la app funciona 100% local. ---
function showAuthView(show) {
    // Con el login abierto, barrido y dwell quedan en pausa (appLoop solo corre en HOME/BOARD)
    if (show) S.state = 'AUTH';
    else if (S.state === 'AUTH') S.state = 'HOME';
    if (show) document.getElementById('auth-email-input')?.focus();
    document.getElementById('auth-view').style.display = show ? 'flex' : 'none';
    document.getElementById('home-view').style.display = show ? 'none' : 'flex';
    document.getElementById('top-bar').style.display = show ? 'none' : 'flex';
    document.getElementById('bottom-bar').style.display = show ? 'none' : 'flex';
}

function updateAccountUI() {
    const user = S.currentUser;
    const nameEl = document.querySelector('.user-name');
    const avatarEl = document.querySelector('.user-avatar');
    const accountBtn = document.getElementById('btn-account');
    const usersBtn = document.getElementById('btn-nav-users');
    if (nameEl) nameEl.textContent = user ? user.email : 'Sin cuenta (solo este dispositivo)';
    if (avatarEl) {
        avatarEl.style.display = user ? 'flex' : 'none';
        avatarEl.textContent = user ? user.email.substring(0, 2).toUpperCase() : '';
    }
    if (accountBtn) accountBtn.textContent = user ? 'Cerrar sesión' : 'Ingresar (profesionales)';
    if (usersBtn) usersBtn.style.display = user ? '' : 'none';
}

async function onProfessionalSession(user) {
    setProfessionalId(user.id);
    fetchUsers();
    await syncAll();
    deviceMod.flushProfessionalCopies(); // copias de usuarios editadas sin conexión
}

document.getElementById('btn-account')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (S.currentUser) {
        await deviceMod.clearProfessionalCopies(); // no dejar copias de los chicos en este navegador
        await signOut();
        window.location.reload(); // estado limpio; los tableros locales NO se borran (F0-4)
    } else {
        showAuthView(true);
    }
});
document.getElementById('btn-auth-back')?.addEventListener('click', () => showAuthView(false));

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

    document.getElementById('btn-nav-users')?.addEventListener('click', () => {
        document.getElementById('users-view').style.display = 'flex';
    });
    document.getElementById('btn-close-users')?.addEventListener('click', () => {
        document.getElementById('users-view').style.display = 'none';
    });
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
    // El centro del objetivo se toma ANTES de actuar (la acción puede re-renderizar el tablero)
    const rect = target.element?.getBoundingClientRect?.();
    if (target.isBoardCard) {
        boards.openBundle(target.data);
    } else if (target.isAccBtn) {
        target.element.click();
    } else {
        boards.handleCellClick(target.element, target.data);
    }
    // Después de la acción: si fue "borrar"/"atrás", su click ya canceló la selección anterior
    recordImplicitSelection(rect);
};

// --- Modo Iris: aprendizaje implícito ---
// Cada selección por dwell que NO se corrige (borrar último / atrás) en los 3 s siguientes se toma
// como "miraba ese objetivo" y sus muestras se suman al modelo (re-entrena cada N). Así el modo
// mejora con el uso y se adapta a cambios de luz, postura o anteojos sin recalibrar.
const implicitEnabled = urlParams.get('implicit') !== '0';
let pendingImplicit = null;

function recordImplicitSelection(rect) {
    if (!implicitEnabled || S.trackingMode !== 'OJOS' || benchmark.active || !rect || !rect.width) return;
    if (!calibration.isUsableProfile('OJOS', calibration.profiles.OJOS)) return;
    const winMs = Math.min(CONFIG.DWELL_MS * 0.7, 1000); // sin la sacada de llegada
    const feats = tracking.recentFeatures(winMs, 100).filter(f => f && f.length === gaze.RAW_NAMES.length);
    if (feats.length < 3) return;
    // Solo aprender de selecciones "seguras": el cursor estuvo en el centro del objetivo casi todo el dwell
    if (!gaze.isConfidentSelection(calibration.profiles.OJOS.model, feats, rect)) return;
    const step = Math.max(1, Math.floor(feats.length / CONFIG.IMPLICIT_SAMPLES_PER_SELECT));
    const target = [rect.left + rect.width / 2, rect.top + rect.height / 2];
    const samples = feats.filter((_, i) => i % step === 0).slice(0, CONFIG.IMPLICIT_SAMPLES_PER_SELECT).map(raw => ({ target, raw }));
    commitPendingImplicit(); // la anterior ya pasó su ventana de corrección implícitamente
    const entry = { samples, timer: null };
    entry.timer = setTimeout(() => { if (pendingImplicit === entry) commitPendingImplicit(); }, CONFIG.IMPLICIT_CONFIRM_MS);
    pendingImplicit = entry;
}

function cancelPendingImplicit() {
    if (pendingImplicit) clearTimeout(pendingImplicit.timer);
    pendingImplicit = null;
}

async function commitPendingImplicit() {
    const entry = pendingImplicit;
    if (!entry) return;
    clearTimeout(entry.timer);
    pendingImplicit = null;
    const updated = await calibration.addImplicitSamples('OJOS', entry.samples);
    if (updated && S.trackingMode === 'OJOS') tracking.applyProfile('OJOS', updated);
}

// --- Dwell engine (F0-6, F1-6) ---
const dwell = new DwellEngine(selectTarget);

// --- Motor de barrido (F2) ---
const scan = new ScanEngine(selectTarget);

// F2-2: entrada de activación unificada — cualquier switch que emule click o tecla.
let lastSwitchActivation = 0;
function onSwitchActivate(e) {
    if (S.trackingMode !== 'SCAN') return;
    if (S.state !== 'HOME' && S.state !== 'BOARD') return; // p. ej. con el login abierto
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, #auth-view, #device-corner')) return;
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
    // Tablet vinculada: el lápiz de edición solo aparece en copias editables
    document.body.classList.toggle('copy-editable', S.currentBundle?.permission === 'editable');
    // Profesional editando la copia de un usuario: aviso fijo arriba
    updateCopyBanner();
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
        customAlert(S.trackingMode === 'OJOS' && tracking.engineName === 'legacy'
            ? 'El Modo Iris necesita el motor de cámara nuevo, que no pudo iniciar en este navegador. Probá con Chrome o Edge actualizados.'
            : 'No se pudo completar la calibración. Verificá que la cámara te detecte e intentá de nuevo.');
        goHome();
        return;
    }

    tracking.applyProfile(S.trackingMode, profile);
    S.isCalibrated = true;
    resetFilters();
    cancelPendingImplicit();

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
    // 1 Euro por modo: el iris tiembla más que la nariz → suavizado más fuerte en modo Iris
    const iris = mode === 'OJOS';
    for (const f of [filterX, filterY]) {
        f.minCutoff = iris ? CONFIG.ONE_EURO_IRIS_MIN_CUTOFF : CONFIG.ONE_EURO_MIN_CUTOFF;
        f.beta = iris ? CONFIG.ONE_EURO_IRIS_BETA : CONFIG.ONE_EURO_BETA;
    }

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
        if (calibration.isUsableProfile(S.trackingMode, profile)) {
            tracking.applyProfile(S.trackingMode, profile);
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
    document.getElementById('copy-banner')?.remove();
    if (deviceMod.isDeviceMode()) { openDeviceHome(); return; } // tablet: la casita es su tablero de inicio
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

document.getElementById('btn-acc-home').addEventListener('click', () => { cancelPendingImplicit(); goHome(); });

document.getElementById('btn-acc-back').addEventListener('click', () => {
    cancelPendingImplicit(); // "atrás" corrige la selección anterior: no aprender de ella
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
    cancelPendingImplicit(); // "borrar último" corrige la selección anterior: no aprender de ella
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

// --- Diagnóstico para desarrollo (?diag=1) ---
// Graba por cuadro las features del modelo, la pose, el cursor y el objetivo (punto de calibración o
// celda del benchmark) para ajustar el modo Iris con datos reales. SOLO números derivados (nunca video
// ni imágenes) y SOLO se descarga si la persona toca el botón: no se envía a ningún lado.
// Usar únicamente con la cara de quien desarrolla, nunca con usuarios.
const diag = urlParams.get('diag') === '1';
const diagRows = [];
function recordDiag(now) {
    if (S.trackingMode !== 'OJOS' && S.trackingMode !== 'CARA') return;
    const fd = tracking.faceData;
    let target = null;
    if (calibSession && S.state === 'CALIBRATING_ACTIVE') {
        const info = calibSession.renderInfo(now);
        if (info) target = { kind: info.hint && /cabeza despacito/.test(info.hint) ? 'calib-head' : 'calib', x: info.x, y: info.y, sampling: info.sampling };
    } else if (benchmark.active && benchmark.currentTarget?.element) {
        const r = benchmark.currentTarget.element.getBoundingClientRect();
        target = { kind: 'bench', x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    if (diagRows.length >= 20000) return; // ~10 min a 30 cps
    diagRows.push({
        t: Math.round(now), mode: S.trackingMode,
        f: tracking.currentFeatures, pose: fd?.pose || null, iris: fd?.iris || null,
        raw: S.rawX === null ? null : [Math.round(S.rawX), Math.round(S.rawY)],
        smooth: S.smoothX === null ? null : [Math.round(S.smoothX), Math.round(S.smoothY)],
        target
    });
}
if (diag) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = '⬇ Diagnóstico';
    btn.title = 'Descarga los datos numéricos de la sesión (sin video) para ajustar el modo Iris';
    btn.onclick = () => {
        const payload = { version: 1, engine: tracking.engineName, viewport: [innerWidth, innerHeight],
                          ua: navigator.userAgent, rows: diagRows };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
        a.download = `miravoz-diag-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
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

        if (diag) recordDiag(now);
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
        } else if ((S.state === 'BOARD' || S.state === 'HOME') && S.trackingMode === 'OJOS' && tracking.headOutOfPose) {
            // Modo Iris: la cabeza salió de la posición de la calibración → cursor en pausa, sin selecciones
            dwell.reset();
            drawHeadWarning();
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

    // Modo Iris: indicación (p. ej. "mové la cabeza despacito") arriba de la pantalla
    if (info.hint) {
        ctxUI.font = 'bold 26px Inter';
        ctxUI.lineWidth = 6;
        ctxUI.strokeStyle = 'rgba(0,0,0,0.85)';
        const hy = info.y < canvasUI.height / 3 ? canvasUI.height - 50 : 50; // que no tape el punto
        const maxW = canvasUI.width - 40; // nunca cortado en pantallas angostas
        ctxUI.strokeText(info.hint, canvasUI.width / 2, hy, maxW);
        ctxUI.fillStyle = '#ffd27a';
        ctxUI.fillText(info.hint, canvasUI.width / 2, hy, maxW);
    }
}

function drawHeadWarning() {
    const msg = 'Volvé a poner la cabeza como en la calibración';
    ctxUI.font = 'bold 28px Inter';
    ctxUI.textAlign = 'center';
    ctxUI.textBaseline = 'middle';
    const y = canvasUI.height - 60, maxW = canvasUI.width - 40;
    ctxUI.lineWidth = 6;
    ctxUI.strokeStyle = 'rgba(0,0,0,0.85)';
    ctxUI.strokeText(msg, canvasUI.width / 2, y, maxW);
    ctxUI.fillStyle = '#ffd27a';
    ctxUI.fillText(msg, canvasUI.width / 2, y, maxW);
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

// --- La sync cambió tableros en disco: refrescar lo que se esté viendo ---
window.addEventListener('miravoz:bundles-changed', async (e) => {
    const { ids = [], removed = [] } = e.detail || {};
    const open = S.currentBundle;
    if (open && removed.includes(open.id)) {
        goHome();
        showInfoToast(`"${open.name}" se borró desde otro dispositivo (quedó un respaldo).`, 7000);
        return;
    }
    if (open && ids.includes(open.id)) {
        // Un "deshacer" pendiente aplicaría una foto vieja sobre la versión nueva: se invalida.
        cancelUndo();
        const cellModal = document.getElementById('cell-editor-modal');
        if (cellModal) cellModal.style.display = 'none';
        const fresh = await localforage.getItem(open.id);
        // Tablet: si la copia pasó a solo lectura mientras se editaba, salir de edición
        if (fresh && deviceMod.isDeviceMode() && fresh.permission !== 'editable' && editor.isEditMode()) editor.exitEditMode();
        if (fresh) document.body.classList.toggle('copy-editable', fresh.permission === 'editable');
        if (fresh) {
            S.currentBundle = fresh;
            const gridId = fresh.boards && fresh.boards[S.currentGridId] ? S.currentGridId : fresh.mainBoard;
            S.currentGridId = gridId;
            if (editor.isEditMode()) editor.enterEditMode(); // reconstruye toolbar con el bundle nuevo
            else boards.renderGrid(gridId);
        }
    }
    if (S.state === 'HOME') {
        if (deviceMod.isDeviceMode()) openDeviceHome();
        else boards.loadSavedBoards();
    }
});

// --- La profesional edita la copia de un usuario (F4-3) ---
function updateCopyBanner() {
    let banner = document.getElementById('copy-banner');
    const b = S.currentBundle;
    if (!b || !b.profEdit) { if (banner) banner.remove(); return; }
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'copy-banner';
        banner.setAttribute('role', 'status');
        boardView.prepend(banner);
    }
    banner.textContent = `Estás editando la copia de ${b.ownerLabel}. Tu original no cambia.`;
}

window.addEventListener('miravoz:edit-copy', async (e) => {
    const assignmentId = e.detail?.assignmentId;
    if (!assignmentId || !S.currentUser) return;
    const copy = await deviceMod.loadCopyForProfessional(assignmentId);
    if (!copy) { customAlert('No se pudo abrir la copia. Revisá la conexión e intentá de nuevo.'); return; }
    document.getElementById('users-view').style.display = 'none';
    boards.openBundle(copy);
    if (S.state === 'BOARD') editor.enterEditMode();
});

// --- Tablet vinculada a un usuario (F4-4) ---
const ACCESS_MODE_MAP = { MANUAL: 'CLICKS', CLICKS: 'CLICKS', FACE: 'CARA', CARA: 'CARA', SCAN: 'SCAN' }; // OJOS (experimental) no se aplica desde el servidor

async function applyDeviceSettings(s = {}) {
    const patch = {};
    const mode = ACCESS_MODE_MAP[s.accessMode];
    if (mode) patch.accessMode = mode;
    if (Number.isFinite(s.dwellMs)) patch.dwellMs = s.dwellMs;
    if (s.scan && typeof s.scan === 'object') patch.scan = { ...settings.scan, ...s.scan };
    if (Object.keys(patch).length) await saveSettings(patch);
    const target = settings.accessMode || 'CLICKS';
    if (target !== S.trackingMode) { modeSelect.value = target; applyMode(target); }
}

async function openDeviceHome() {
    const home = await deviceMod.getHomeCopy();
    if (home) { boards.openBundle(home); return; }

    // Sin casita definida: índice de sus tableros, con tarjetas grandes (operable por dwell/barrido)
    S.state = 'HOME';
    S.currentBundle = null;
    boardView.style.display = 'none';
    homeView.style.display = 'flex';
    topBar.style.display = 'none';
    bottomBar.style.display = 'none';
    const list = document.getElementById('board-list');
    list.innerHTML = '';
    const title = document.createElement('h2');
    title.className = 'device-title';
    title.textContent = `Tableros de ${deviceMod.device?.displayName || ''}`.trim();
    list.appendChild(title);

    const copies = await deviceMod.listCopies();
    const targets = [];
    if (!copies.length) {
        const p = document.createElement('p');
        p.className = 'device-empty';
        p.textContent = 'Todavía no hay tableros en esta tablet. La profesional tiene que asignarle uno a este usuario.';
        list.appendChild(p);
    }
    for (const copy of copies) {
        const card = document.createElement('div');
        card.className = 'board-card glass-box device-card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        const h3 = document.createElement('h3');
        h3.textContent = copy.name || 'Tablero';
        const progress = document.createElement('div');
        progress.className = 'progress-bar';
        progress.style.cssText = 'position:absolute; bottom:0; left:0; height:10px; background:rgba(0,255,136,0.5); width:0%; transition:width 0.1s linear;';
        card.append(h3, progress);
        card.onclick = () => boards.openBundle(copy);
        card.onkeydown = (e) => { if (e.key === 'Enter') boards.openBundle(copy); };
        list.appendChild(card);
        targets.push({ element: card, data: copy, isBoardCard: true });
    }
    dwell.setTargets(targets);
    scan.setTargets(targets);
}

async function enterDeviceMode() {
    document.body.classList.add('device-mode');
    document.getElementById('auth-view').style.display = 'none';
    S.state = 'HOME';
    deviceMod.wireAdultExit({ onUnlinked: () => window.location.reload() });
    await openDeviceHome();
    await applyDeviceSettings(deviceMod.device?.settings); // después de abrir: calibra una sola vez si hace falta

    // Refrescar desde la nube en segundo plano (la tablet ya es usable con lo local)
    const res = await deviceMod.pullCopies();
    if (res === 'unlinked') {
        await deviceMod.unlink();
        await customAlert('Esta tablet fue desvinculada por la profesional.');
        window.location.reload();
        return;
    }
    if (res === 'nosession') {
        showInfoToast('Esta tablet perdió la conexión con la cuenta. Sigue funcionando, pero los cambios no se guardan en la nube: pedile a la profesional un código nuevo (esquina superior derecha, mantener apretado).', 12000);
    }
    if (res === 'ok') {
        await applyDeviceSettings(deviceMod.device?.settings);
        if (S.state === 'HOME') openDeviceHome();
    }
}

window.addEventListener('miravoz:device-unlinked', async () => {
    await deviceMod.unlink();
    await customAlert('Esta tablet fue desvinculada por la profesional.');
    window.location.reload();
});

// --- Arranque ---
(async function init() {
    await initSettings();
    if (dwellSelect) dwellSelect.value = String(settings.dwellMs);
    wireScanSetting('scan-pattern', 'pattern');
    wireScanSetting('scan-interval', 'intervalMs', true);
    wireScanSetting('scan-audio', 'audio');
    editor.initEditor();
    initUsers();
    renderSentence();

    // Tablet vinculada a un usuario: modo dispositivo (sin gestión ni cuenta de profesional)
    if (await deviceMod.loadDevice()) {
        await calibration.loadProfiles();
        await enterDeviceMode();
        requestAnimationFrame(appLoop);
        return;
    }
    deviceMod.wireLinkForm({ onLinked: () => enterDeviceMode() });

    // Mostrar lo local de inmediato: la app nunca espera a la red ni a la sesión
    showAuthView(false);
    updateAccountUI();
    boards.loadSavedBoards();

    initAuth({
        onReady: async (user) => {
            showAuthView(false);
            updateAccountUI();
            await calibration.loadProfiles();
            await boards.loadSavedBoards();      // primero lo local: la app es usable ya
            restoreAccessMode();
            if (user) {
                await onProfessionalSession(user);
                if (S.state === 'HOME') await boards.loadSavedBoards();
            }
        },
        onSignedIn: async (user) => {
            showAuthView(false);
            updateAccountUI();
            await onProfessionalSession(user);
            if (S.state === 'HOME') await boards.loadSavedBoards();
        },
        onSignedOut: () => {
            updateAccountUI();
            if (S.state === 'HOME') boards.loadSavedBoards();
        }
    });

    function restoreAccessMode() {

        // Restaurar el modo de acceso de la sesión anterior (con perfiles ya cargados)
        let savedMode = settings.accessMode;
        if (savedMode === 'OJOS' && !document.getElementById('opt-ojos')) savedMode = 'CLICKS';
        if (savedMode && savedMode !== 'CLICKS' && savedMode !== S.trackingMode) {
            modeSelect.value = savedMode;
            applyMode(savedMode);
        }
    }

    requestAnimationFrame(appLoop);
})();
