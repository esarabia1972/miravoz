// main.js — Bootstrap y wiring de la aplicación (SPEC F1-1)
// Único módulo que conoce a todos los demás. El loop de render vive acá.

import { CONFIG, settings, initSettings, saveSettings, isImplicitEnabled } from './config.js';
import { S } from './state.js';
import { OneEuroFilter } from './filters.js';
import { speak, unlockSpeech, isSpeechSupported } from './speech.js';
import { customAlert, customConfirm, customChoice, showInfoToast, playSentence, popSentence, clearSentence, renderSentence, cancelUndo } from './ui.js';
import { initAuth, signOut, consumeOAuthReturn } from './auth.js';
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
import { initTheme } from './theme.js';
import { PointerController, pauseMessage } from './selection.js';
import { makeContext, localDeviceId, compatibilityMessage, geometryChanged, orientationOf } from './profiles.js';
import { failureAdvice } from './validation.js';

// --- Cuenta (decisión 10/10/2026): las profesionales entran SOLO con Google; no hay modo sin cuenta.
// Sin sesión se muestra la pantalla de ingreso (Google o "vincular esta tablet con un código").
function showAuthView(show) {
    // Con el ingreso abierto, barrido y dwell quedan en pausa (appLoop solo corre en HOME/BOARD)
    if (show) S.state = 'AUTH';
    else if (S.state === 'AUTH') S.state = 'HOME';
    // Sin foco automático en "Ingresar con Google": en una tablet que quedó desvinculada, el pulsador
    // (Espacio/Enter) activaría el botón y el chico terminaría en la pantalla de Google.
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
    const name = user ? (user.user_metadata?.full_name || user.user_metadata?.name || user.email) : '';
    if (nameEl) nameEl.textContent = name;
    if (avatarEl) {
        avatarEl.style.display = user ? 'flex' : 'none';
        avatarEl.textContent = user ? (name || '?').substring(0, 2).toUpperCase() : '';
    }
    if (accountBtn) { accountBtn.textContent = 'Cerrar sesión'; accountBtn.style.display = user ? '' : 'none'; }
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
    if (!S.currentUser) return;
    if (!(await customConfirm('¿Cerrar sesión? Tus tableros quedan guardados en tu cuenta.'))) return;
    await deviceMod.clearProfessionalCopies(); // no dejar copias de los chicos en este navegador
    await signOut();
    window.location.reload(); // vuelve a la pantalla de ingreso; los tableros locales NO se borran (F0-4)
});

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
// (los botones de modo se arman en init, cuando ya existe applyMode)

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

// --- Modo Iris: aprendizaje implícito (EXPERIMENTAL, apagado por defecto: M07) ---
// Con ?implicit=1, cada selección por dwell que NO se corrige (borrar último / atrás) en los 3 s
// siguientes se suma al modelo. Un dwell no corregido no demuestra intención: por eso no se usa por defecto.
const implicitEnabled = isImplicitEnabled();
let pendingImplicit = null;

function recordImplicitSelection(rect) {
    if (!implicitEnabled || S.trackingMode !== 'OJOS' || benchmark.active || pointer.invalid || !rect || !rect.width) return;
    const ojosProfile = calibration.getProfile('OJOS');
    if (!calibration.isUsableProfile('OJOS', ojosProfile)) return;
    const winMs = Math.min(CONFIG.DWELL_MS * 0.7, 1000); // sin la sacada de llegada
    const feats = tracking.recentFeatures(winMs, 100).filter(f => f && f.length === gaze.RAW_NAMES.length);
    if (feats.length < 3) return;
    // Solo aprender de selecciones "seguras": el cursor estuvo en el centro del objetivo casi todo el dwell
    if (!gaze.isConfidentSelection(ojosProfile.model, feats, rect)) return;
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

// --- M01: el puntero solo selecciona con muestras nuevas, válidas y recientes ---
const pointer = new PointerController({
    dwell, filterX, filterY,
    maxAgeMs: () => CONFIG.MAX_SAMPLE_AGE_MS,
    onInvalidate: () => cancelPendingImplicit()
});
// Pestaña oculta, app en segundo plano o pantalla bloqueada: se cancela todo y, al volver, las muestras
// anteriores no cuentan (no se ejecuta tiempo acumulado ni una selección inmediata)
document.addEventListener('visibilitychange', () => pointer.invalidate(document.hidden ? 'hidden' : 'resumed', performance.now()));
window.addEventListener('pagehide', () => pointer.invalidate('hidden', performance.now()));
window.addEventListener('pageshow', () => pointer.invalidate('resumed', performance.now()));

// --- Motor de barrido (F2) ---
const scan = new ScanEngine(selectTarget);

// F2-2: entrada de activación unificada — cualquier switch que emule click o tecla.
let lastSwitchActivation = 0;
function onSwitchActivate(e) {
    if (S.trackingMode !== 'SCAN') return;
    if (S.state !== 'HOME' && S.state !== 'BOARD') return; // p. ej. con el login abierto
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, #auth-view, #top-bar')) return;
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
// Página web abierta desde un tablero de Asterics: la mirada y el barrido apuntan solo a "Volver"; al cerrarla, se restauran
document.addEventListener('miravoz-overlay', (e) => {
    const t = e.detail && e.detail.targets;
    const targets = t || (S.state === 'HOME' ? boards.activeHomeElements : boards.activeGridElements);
    dwell.setTargets(targets);
    scan.setTargets(targets);
});
boards.hooks.onBundleOpened = () => {
    clearSentence();
    // Tablet vinculada: el lápiz de edición solo aparece en copias editables
    document.body.classList.toggle('copy-editable', S.currentBundle?.permission === 'editable');
    // El tablero de prueba es fijo: no se edita ni se guarda (antes, editarlo lo dejaba en el inicio)
    document.body.classList.toggle('test-board', S.currentBundle?.type === 'test');
    // Profesional editando la copia de un usuario: aviso fijo arriba
    updateCopyBanner();
    // Solo los modos de puntero (Rostro/Iris) requieren calibración; Barrido y Manual no.
    if ((S.trackingMode === 'CARA' || S.trackingMode === 'OJOS') && !S.isCalibrated) {
        if (!calibSession) beginCameraAccess();
    } else {
        S.state = 'BOARD';
    }
};

// --- Calibración ---
let calibSession = null;

// M02: ámbito de persona y contexto de pantalla/cámara con el que se guardan y comparan los perfiles
function profileScope() {
    return deviceMod.isDeviceMode() && deviceMod.device?.aacUserId ? `user:${deviceMod.device.aacUserId}` : 'prueba';
}
calibration.setContextProvider(() => makeContext({
    scope: profileScope(), deviceId: localDeviceId(), engine: tracking.engineName,
    w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1, camera: tracking.cameraInfo
}));

const btnCalibText = () => document.getElementById('btn-iniciar-calibracion');

/**
 * M02: el perfil tiene que ser de esta persona, este dispositivo, esta orientación y estar verificado.
 * Aunque sea compatible, se hace una verificación rápida (5 puntos) antes de habilitar la selección.
 */
function beginCameraAccess() {
    const chk = calibration.checkProfile(S.trackingMode);
    S.isCalibrated = false;
    tracking.clearWeights();
    if (chk.ok) {
        tracking.applyProfile(S.trackingMode, chk.profile);
        startCalibration({ validateOnly: chk.profile });
    } else {
        const msg = compatibilityMessage(chk.reason);
        if (msg) showInfoToast(msg, 6000);
        startCalibration();
    }
}

/** Calibración completa, o verificación rápida de un perfil guardado ({ validateOnly: perfil }). */
function startCalibration({ validateOnly = null } = {}) {
    if (S.trackingMode !== 'CARA' && S.trackingMode !== 'OJOS') return;

    calibration.updateCalibPoints();
    calibSession = new calibration.CalibrationSession(S.trackingMode, onCalibrationComplete, { validateOnly });
    S.isCalibrated = false;
    pointer.invalidate('calibrating', performance.now());
    if (btnCalibText()) btnCalibText().textContent = validateOnly
        ? 'Verificación rápida: presioná y mirá 5 puntos'
        : 'Presioná para iniciar calibración';
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
    const wasQuickCheck = !!calibSession?.validateOnly;
    calibSession = null;
    pointer.invalidate('calibrated', performance.now());
    // M04: una verificación fallida NO activa el cursor. Se ofrece repetir, con consejos de colocación.
    if (profile && profile.validation && profile.validation.status !== 'accepted') {
        tracking.clearWeights();
        S.isCalibrated = false;
        instructionBox.style.display = 'none';
        if (S.currentBundle) { S.state = 'BOARD'; boardView.style.display = 'flex'; boardView.style.opacity = '1'; }
        else goHome();
        const tips = failureAdvice(profile.validation.failures || []);
        const m = profile.validation.metrics;
        customChoice(
            `${wasQuickCheck ? 'La verificación rápida no salió bien' : 'La calibración no pasó la verificación'}: el cursor no se activa todavía.\n\n` +
            (tips.length ? `Sugerencias: ${tips.join('; ')}.\n\n` : '') +
            `Datos: error mediano ${Math.round(m.medianError)} px, p90 ${Math.round(m.p90Error)} px, señal válida ${Math.round(m.coverage * 100)}%.`,
            'Repetir calibración', 'Ahora no'
        ).then(again => { if (again) startCalibration(); });
        return;
    }
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
        resetFilters();
    } else {
        goHome();
    }

    speak(wasQuickCheck ? 'Verificación completada' : 'Calibración completada');
    // M04: se informa la VERIFICACIÓN (objetivos nuevos), no el error de ajuste del entrenamiento
    const m = profile.validation?.metrics;
    const detail = m ? `error mediano ${Math.round(m.medianError)} px, p90 ${Math.round(m.p90Error)} px` : '';
    showInfoToast(`Calibración ${profile.quality}${detail ? ` · ${detail}` : ''}${calibration.isUnsaved() ? ' · no se pudo guardar: vale solo para esta sesión' : ''}`, 6000);
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

// --- Modo de acceso como botones visibles (el <select> oculto sigue siendo la fuente de verdad) ---
const MODE_LABELS = { CLICKS: 'Manual', CARA: 'Rostro', SCAN: 'Barrido', OJOS: 'Iris (exp.)' };
function renderModeSegmented() {
    const box = document.getElementById('mode-segmented');
    if (!box) return;
    box.innerHTML = '';
    const available = [...modeSelect.options].map(o => o.value);
    for (const v of ['CLICKS', 'SCAN', 'CARA', 'OJOS'].filter(m => available.includes(m))) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.dataset.mode = v;
        b.textContent = MODE_LABELS[v];
        b.onclick = () => {
            if (S.trackingMode === v) return;
            modeSelect.value = v;
            modeSelect.dispatchEvent(new Event('change'));
        };
        box.appendChild(b);
    }
    updateModeSegmented();
}
function updateModeSegmented() {
    document.querySelectorAll('#mode-segmented button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === S.trackingMode)));
    // Recalibrar solo tiene sentido con cámara (Rostro; Iris experimental): en Manual y Barrido, grisado
    const usesCamera = S.trackingMode === 'CARA' || S.trackingMode === 'OJOS';
    if (btnRecalibrar) {
        btnRecalibrar.disabled = !usesCamera;
        btnRecalibrar.title = usesCamera ? 'Volver a calibrar la cámara' : 'Recalibrar solo se usa en modo Rostro';
        btnRecalibrar.setAttribute('aria-disabled', String(!usesCamera));
    }
}

function applyMode(mode) {
    S.trackingMode = mode;
    pointer.invalidate('mode', performance.now());
    updateModeSegmented();
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
        beginCameraAccess();
    }
}

// --- Navegación Home/Board ---
function goHome() {
    if (editor.isEditMode()) editor.exitEditMode();
    document.getElementById('copy-banner')?.remove();
    boards.stopMedia(); // radio o página web de un tablero de Asterics
    if (deviceMod.isDeviceMode()) { openDeviceHome(); return; } // tablet: vista de inicio del adulto
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
        importModal.style.display = 'none';
        const list = await boards.importFile(file, {
            chooseSplit: async (n) => !(await customChoice(
                `Este archivo trae ${n} tableros vinculados entre sí. ¿Cómo querés importarlos?\n\n` +
                `Como un tablero con ${n} páginas: se mantienen los vínculos para pasar de uno a otro.\n` +
                `Como ${n} tableros separados: cada uno queda suelto y los vínculos se pierden.`,
                `Un tablero con ${n} páginas`, `${n} tableros separados`))
        });
        await boards.loadSavedBoards();
        const head = list.length > 1 ? `Se importaron ${list.length} tableros.` : `Se importó «${list[0].name}».`;
        customAlert(list.report ? `${head}\n\n${list.report}` : head);
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
// Vive en boards.js (barra del home): se combina con etiquetas/usuario vía .is-filtered-out.

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
    document.getElementById('btn-settings-done')?.addEventListener('click', () => { settingsModal.style.display = 'none'; });
    document.getElementById('btn-test-voice')?.addEventListener('click', () => {
        const status = document.getElementById('voice-status');
        if (!isSpeechSupported()) { if (status) status.textContent = 'Este navegador no tiene síntesis de voz.'; return; }
        unlockSpeech();
        speak('Hola, esta es la voz de MiraVoz', { cancelPrevious: true });
        if (status) status.textContent = 'Si no escuchaste nada, revisá el volumen y el modo silencio del dispositivo.';
    });
    settingsModal.addEventListener('pointerdown', (e) => { if (e.target === settingsModal) settingsModal.style.display = 'none'; });
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
    btn.textContent = 'Benchmark';
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
        sample: tracking.latestSample ? { seq: tracking.latestSample.sequence, valid: tracking.latestSample.valid, reason: tracking.latestSample.reason, lat: Math.round(tracking.latestSample.receivedAt - tracking.latestSample.capturedAt) } : null,
        smooth: S.smoothX === null ? null : [Math.round(S.smoothX), Math.round(S.smoothY)],
        target
    });
}
if (diag) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = 'Diagnóstico';
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
            // Una muestra por cuadro NUEVO de cámara (M04/T05): refrescar la pantalla no multiplica observaciones
            const fresh = pointer.takeNewSample(tracking.latestSample, now);
            calibSession.onFrame(fresh ? fresh.features : null, now, fresh);
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
            // M01: sin rostro, ojos cerrados, cabeza fuera de pose, cámara congelada o muestra vieja → pausa y
            // se reinicia la permanencia. El dwell solo avanza con muestras nuevas (reloj de captura).
            const r = pointer.step(tracking.latestSample, now);
            S.smoothX = r.x; S.smoothY = r.y;
            if (r.x !== null) drawCursor(r.x, r.y);
            else if (S.isCalibrated) { const msg = pauseMessage(r.reason); if (msg) drawPauseMessage(msg); }
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

function drawPauseMessage(msg) {
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

// La configuración que define la profesional (aac_users.settings) se aplica SOLO cuando cambia: así un
// ajuste hecho por un adulto en la tablet (menú de la esquina) no se pisa en cada arranque.
async function applyDeviceSettings(s = {}) {
    const key = JSON.stringify(s || {});
    if (key !== deviceMod.device?.appliedSettingsKey) {
        const patch = {};
        const mode = ACCESS_MODE_MAP[s.accessMode];
        if (mode) patch.accessMode = mode;
        if (Number.isFinite(s.dwellMs)) patch.dwellMs = s.dwellMs;
        if (s.scan && typeof s.scan === 'object') patch.scan = { ...settings.scan, ...s.scan };
        if (Object.keys(patch).length) {
            await saveSettings(patch);
            syncSettingsControls();
        }
        await deviceMod.markSettingsApplied(key);
    }
    const target = settings.accessMode || 'CLICKS';
    if (target !== S.trackingMode) { modeSelect.value = target; applyMode(target); }
}

// Refleja los settings guardados en los controles del panel de configuración
function syncSettingsControls() {
    if (dwellSelect) dwellSelect.value = String(settings.dwellMs);
    for (const [id, key] of [['scan-pattern', 'pattern'], ['scan-interval', 'intervalMs'], ['scan-audio', 'audio']]) {
        const el = document.getElementById(id);
        if (el) el.value = String(settings.scan[key]);
    }
}

// --- Pantalla completa (tablet): se pide con un gesto del usuario; donde no se puede, no pasa nada ---
function requestFullscreenSafe() {
    const el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fn) { try { const p = fn.call(el); if (p && p.catch) p.catch(() => {}); } catch { /* no soportado */ } }
}


// Vista de inicio de la tablet (para el adulto): como la de profesionales —logo, buscador, modo de acceso,
// recalibrar; abajo el nombre del usuario, configuración, desvincular y tablero de prueba— pero sin crear,
// importar ni gestionar usuarios. Al abrir la app va directo a la casita (si hay); el botón Inicio vuelve acá.
async function openDeviceHome({ casita = false } = {}) {
    if (casita) {
        const home = await deviceMod.getHomeCopy();
        if (home) { boards.openBundle(home); return; }
    }
    S.state = 'HOME';
    S.currentBundle = null;
    boardView.style.display = 'none';
    homeView.style.display = 'flex';
    topBar.style.display = 'flex';
    bottomBar.style.display = 'flex';
    updateDeviceAccountUI();
    // Mismo home que la profesional (pestañas de etiquetas, lupa, orden y agrupación) en solo lectura:
    // sin usuarios, badges ni acciones. Tocar una tarjeta abre la copia; los targets de dwell/barrido
    // llegan por boards.hooks.onHomeRendered con las tarjetas visibles.
    boards.renderHome(await deviceMod.listCopies(), { readOnly: true });
}

function updateDeviceAccountUI() {
    const name = deviceMod.device?.displayName || '';
    const nameEl = document.querySelector('.user-name');
    const avatarEl = document.querySelector('.user-avatar');
    if (nameEl) nameEl.textContent = name;
    if (avatarEl) { avatarEl.style.display = name ? 'flex' : 'none'; avatarEl.textContent = name.substring(0, 2).toUpperCase(); }
}

document.getElementById('btn-unlink-device')?.addEventListener('click', async () => {
    const scope = profileScope();
    if (await deviceMod.confirmAndUnlink()) { await calibration.clearScope(scope); window.location.reload(); }
});

// M02: girar el iPad o cambiar mucho el área de uso suspende la selección y pide calibrar en la geometría
// nueva. Las barras de Safari (cambios chicos de alto) no cuentan: ver GEOMETRY_RULE en profiles.js.
let geometryTimer = null;
function onGeometryChange() {
    clearTimeout(geometryTimer);
    geometryTimer = setTimeout(() => {
        if (S.trackingMode !== 'CARA' && S.trackingMode !== 'OJOS') return;
        if (calibSession) {
            // Se giró (o cambió mucho la pantalla) en plena calibración: los puntos ya no corresponden → de nuevo.
            // Un cambio chico (barras de Safari) no la interrumpe.
            const v = calibSession.viewport;
            if (v && geometryChanged(v, { w: window.innerWidth, h: window.innerHeight }) || (v && orientationOf(v.w, v.h) !== orientationOf(window.innerWidth, window.innerHeight))) {
                startCalibration();
            }
            return;
        }
        if (!S.isCalibrated) return;
        const chk = calibration.checkProfile(S.trackingMode);
        if (chk.ok) return;
        pointer.invalidate('geometry', performance.now());
        S.isCalibrated = false;
        tracking.clearWeights();
        showInfoToast(compatibilityMessage(chk.reason) || 'Cambió la pantalla: hay que calibrar de nuevo.', 6000);
        startCalibration();
    }, 600);
}
window.addEventListener('resize', onGeometryChange);
window.addEventListener('orientationchange', onGeometryChange);

async function enterDeviceMode() {
    document.body.classList.add('device-mode');
    document.getElementById('auth-view').style.display = 'none';
    S.state = 'HOME';
    // Pantalla completa al primer toque (los navegadores solo la permiten tras un gesto del usuario)
    window.addEventListener('pointerdown', requestFullscreenSafe, { once: true });
    await openDeviceHome({ casita: true });
    await applyDeviceSettings(deviceMod.device?.settings); // después de abrir: calibra una sola vez si hace falta

    // Refrescar desde la nube en segundo plano (la tablet ya es usable con lo local)
    const res = await deviceMod.pullCopies();
    if (res === 'unlinked') {
        await deviceMod.unlink();
        await customAlert('Esta tablet fue desvinculada por la profesional.');
        window.location.reload();
        return;
    }
    if (res === 'ok') {
        await applyDeviceSettings(deviceMod.device?.settings);
        if (S.state === 'HOME') openDeviceHome();
    }
}

window.addEventListener('miravoz:device-unlinked', async () => {
    await calibration.clearScope(profileScope());
    await deviceMod.unlink();
    await customAlert('Esta tablet fue desvinculada por la profesional.');
    window.location.reload();
});

// --- Arranque ---
(async function init() {
    initTheme();
    await initSettings();
    renderModeSegmented();
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


    async function enterProfessionalApp(user) {
        showAuthView(false);
        updateAccountUI();
        await calibration.loadProfiles();
        await boards.loadSavedBoards();      // primero lo local (la sesión guardada funciona sin red)
        restoreAccessMode();
        await onProfessionalSession(user);
        if (S.state === 'HOME') await boards.loadSavedBoards();
    }

    initAuth({
        onReady: async (user) => {
            // Recién acá (supabase-js ya canjeó el ?code= de Google) se limpia la URL
            const oauthError = consumeOAuthReturn();
            if (user) { await enterProfessionalApp(user); return; }
            showAuthView(true);
            updateAccountUI();
            const err = document.getElementById('auth-error');
            if (oauthError && err) err.textContent = `No se pudo ingresar con Google: ${oauthError}`;
        },
        onSignedIn: (user) => enterProfessionalApp(user),
        onSignedOut: () => window.location.reload() // sesión cerrada o vencida: vuelve a la pantalla de ingreso
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
