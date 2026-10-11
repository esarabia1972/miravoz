// main.js — Bootstrap y wiring de la aplicación (SPEC F1-1)
// Único módulo que conoce a todos los demás. El loop de render vive acá.

import { CONFIG, settings, initSettings, saveSettings, isImplicitEnabled } from './config.js';
import { S } from './state.js';
import { APP_VERSION } from './build-info.js';
import { OneEuroFilter } from './filters.js';
import { speak, unlockSpeech, isSpeechSupported } from './speech.js';
import { customAlert, customConfirm, customChoice, showInfoToast, showErrorToast, playSentence, popSentence, clearSentence, renderSentence, cancelUndo, getSentence } from './ui.js';
import * as offline from './offline.js';
import { initAuth, signOut, consumeOAuthReturn, accountEnabled, oauthErrorText, NOT_ENABLED_MESSAGE } from './auth.js';
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
import { selectionContexts } from './contexts.js';
import { makeContext, localDeviceId, compatibilityMessage, geometryChanged, orientationOf } from './profiles.js';
import { failureAdvice } from './validation.js';
import * as practice from './practice.js';
import { BlinkDetector, eyeClosure, calibrateThreshold } from './blink.js';

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
    // M07: nunca de benchmark, verificación, señal inválida, diálogos, edición o calibración
    if (!implicitEnabled || S.trackingMode !== 'OJOS' || benchmark.active || pointer.invalid || !rect || !rect.width) return;
    if (selectionContexts.isBlocked() || editor.isEditMode() || calibSession || S.state !== 'BOARD') return;
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
    const entry = { samples, timer: null, revision: ojosProfile.revision, scope: profileScope() };
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
    if (entry.scope !== profileScope()) return; // cambió la persona: se descarta
    const updated = await calibration.addImplicitSamples('OJOS', entry.samples, entry.revision);
    if (updated && S.trackingMode === 'OJOS' && profileScope() === entry.scope) tracking.applyProfile('OJOS', updated);
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

// --- Parpadeo para elegir (1.4.0, blink.js) ---
// En Barrido es el pulsador; en Rostro/Iris elige lo que estaba bajo el cursor JUSTO ANTES de cerrar los ojos
// (al cerrar, la cara cambia un poco y en Iris el cursor se pausa: se usa la posición previa).
const blink = new BlinkDetector();
const cursorTrail = []; // últimas posiciones del cursor { t, x, y } (1,5 s)
let blinkFlash = null;  // { x, y, t } para dibujar la confirmación
let blinkCalib = null;  // muestras durante "Ajustar a esta persona"
const blinkOn = () => settings.blink && settings.blink.mode !== 'off';
function applyBlinkMode() {
    blink.configure(settings.blink || {});
    if (!blinkOn()) blink.reset();
    // "Solo parpadeo" (Rostro/Iris): la permanencia resalta pero no elige
    dwell.selectEnabled = !(blinkOn() && settings.blink.selectWith === 'blink' && (S.trackingMode === 'CARA' || S.trackingMode === 'OJOS'));
}
function cursorBefore(t) {
    for (let i = cursorTrail.length - 1; i >= 0; i--) if (cursorTrail[i].t <= t - 60) return cursorTrail[i];
    return cursorTrail[0] || null;
}
tracking.setFaceListener((fd, t) => {
    const c = fd ? eyeClosure(fd.eyes) : null;
    if (blinkCalib && c !== null) blinkCalib.push(c);
    if (!blinkOn()) return;
    const r = blink.push(c, t);
    if (r.fire) onBlinkFire(r.closedAt);
});
function onBlinkFire(closedAt) {
    const now = performance.now();
    if (calibSession || editor.isEditMode() || selectionContexts.isPaused() || blinkCalib) return;
    if (!['HOME', 'BOARD', 'PRACTICE'].includes(S.state)) return;
    if (S.state === 'PRACTICE' && practice.wantsBlink()) { practice.onBlink(); return; }
    if (S.trackingMode === 'SCAN') {
        if (scan.activate()) blinkFlash = { x: canvasUI.width / 2, y: 70, t: now };
        return;
    }
    if (S.trackingMode !== 'CARA' && S.trackingMode !== 'OJOS') return;
    // Si la permanencia acaba de elegir (mismo gesto largo sobre la celda), no se elige dos veces
    if (now - dwell.lastClickTime < CONFIG.DWELL_COOLDOWN_MS + 400) return;
    const p = cursorBefore(closedAt);
    if (!p) return;
    const target = dwell.targetAt(p.x, p.y);
    blinkFlash = { x: p.x, y: p.y, t: now };
    if (!target) return;
    dwell.markSelected(now);
    selectTarget(target);
}
function drawBlink(now) {
    if (!blinkOn()) return;
    const prog = blink.progress(now);
    const scanning = S.trackingMode === 'SCAN';
    const last = cursorTrail[cursorTrail.length - 1];
    const at = scanning ? { x: canvasUI.width / 2, y: 70 } : (blink.closed ? cursorBefore(blink.closedAt) : null) || last;
    if (prog > 0 && at) {
        ctxUI.beginPath();
        ctxUI.arc(at.x, at.y, 30, -Math.PI / 2, -Math.PI / 2 + prog * 2 * Math.PI);
        ctxUI.lineWidth = 7; ctxUI.strokeStyle = '#4fc3f7'; ctxUI.stroke();
    }
    if (blinkFlash && now - blinkFlash.t < 450) {
        const k = (now - blinkFlash.t) / 450;
        ctxUI.beginPath();
        ctxUI.arc(blinkFlash.x, blinkFlash.y, 20 + 30 * k, 0, 2 * Math.PI);
        ctxUI.lineWidth = 6 * (1 - k); ctxUI.strokeStyle = '#4fc3f7'; ctxUI.stroke();
    }
}

// --- Motor de barrido (F2) ---
const scan = new ScanEngine(selectTarget);

// F2-2: entrada de activación unificada — cualquier switch que emule click o tecla.
let lastSwitchActivation = 0;
function onSwitchActivate(e) {
    if (S.trackingMode !== 'SCAN') return;
    if (S.state !== 'HOME' && S.state !== 'BOARD' && S.state !== 'PRACTICE') return; // p. ej. con el login abierto
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, #auth-view, #top-bar')) return;
    const now = performance.now();
    if (now - lastSwitchActivation < 250) return; // debounce (switches 3D rebotan)
    lastSwitchActivation = now;

    // Paneles del acompañante: el pulsador no activa nada detrás. Un diálogo SÍ se maneja con el pulsador (M03).
    if (selectionContexts.isPaused()) return;

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
    // En un diálogo, tocar el fondo también activa el barrido (tocar un botón lo elige directamente).
    const inDialog = e.target.closest('#custom-dialog');
    if (S.trackingMode === 'SCAN' && !e.target.closest('#bottom-bar') && (inDialog ? !e.target.closest('button') : !e.target.closest('.modal-overlay'))) {
        onSwitchActivate(e);
    }
});

// --- Benchmark (F1-7) ---
const benchmark = new Benchmark();

// --- M03: contexto único de selección (tablero abajo; diálogos y superposiciones encima) ---
const INERT_IDS = ['home-view', 'board-view', 'top-bar', 'bottom-bar', 'users-view', 'auth-view', 'practice-view'];
selectionContexts.configure({
    apply: (targets) => { dwell.setTargets(targets); scan.setTargets(targets); },
    baseTargets: () => (S.state === 'PRACTICE' ? practice.targets() : S.state === 'HOME' ? boards.activeHomeElements : boards.activeGridElements),
    onChange: (blocked, top) => {
        // Entrar o salir de un contexto reinicia la permanencia: lo que quedó debajo no se activa solo
        pointer.invalidate('context', performance.now());
        // Con un diálogo arriba, el fondo no es accesible por ninguna vía (teclado, lector de pantalla, toque)
        const modal = blocked && top && !top.companion;
        for (const id of INERT_IDS) {
            const el = document.getElementById(id);
            if (el && (!top || !top.element || !el.contains(top.element))) el.inert = modal;
        }
    }
});
// Paneles del acompañante (configuración, usuarios, importar, editar celda, etiquetas, dar copia): pausan la selección
let companionToken = null;
function syncCompanionContext() {
    const open = [...document.querySelectorAll('.modal-overlay')].some(el => el.id !== 'custom-dialog' && el.style.display && el.style.display !== 'none');
    if (open && companionToken === null) companionToken = selectionContexts.push('companion', () => [], { companion: true });
    else if (!open && companionToken !== null) { selectionContexts.pop(companionToken); companionToken = null; }
}

// --- Hooks de boards ---
boards.hooks.onHomeRendered = (targets) => { if (S.state === 'HOME') selectionContexts.setBase(targets); };
boards.hooks.onGridRendered = (targets) => { if (S.state !== 'PRACTICE') selectionContexts.setBase(targets); };
boards.hooks.onCellActivated = (elData) => benchmark.onActivated(elData);
boards.hooks.onBundleOpened = () => {
    // La frase NO se vacía al abrir otro tablero (como en Asterics): una frase se arma con palabras de varios
    // tableros. Se vacía solo con "borrar todo", una celda que la borra, o al cerrar sesión / desvincular.
    if (S.currentBundle?.type === 'test' && String(S.currentBundle.id || '').startsWith('benchmark_')) clearSentence();
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
    if (practice.isOpen()) practice.closePractice({ silent: true }); // calibrar con Practicar abierto: se cierra (y se calla)

    calibration.updateCalibPoints();
    calibSession = new calibration.CalibrationSession(S.trackingMode, onCalibrationComplete, { validateOnly });
    S.isCalibrated = false;
    pointer.invalidate('calibrating', performance.now());
    if (btnCalibText()) btnCalibText().textContent = validateOnly
        ? 'Verificación rápida: presioná y mirá 5 puntos'
        : 'Presioná para iniciar calibración';
    // M08: ayuda de colocación para la persona de apoyo (nunca pide mover la cabeza)
    const help = document.getElementById('calib-help');
    if (help) help.textContent = S.trackingMode === 'OJOS'
        ? 'Iris (experimental): colocá el iPad frente a la cara, a la altura de los ojos y a unos 40-60 cm, con luz de frente y sin contraluz. No hace falta mover la cabeza: solo mirar cada punto.'
        : 'Rostro: el cursor sigue la nariz. Colocá el iPad frente a la cara, con luz de frente, y seguí cada punto con la cabeza.';
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
        selectionContexts.setBase(boards.activeGridElements);
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

// Salida de la pantalla de calibración (para la persona de apoyo): vuelve a Manual sin perder nada
document.getElementById('btn-cancelar-calibracion')?.addEventListener('click', () => {
    calibSession = null;
    instructionBox.style.display = 'none';
    modeSelect.value = 'CLICKS';
    modeSelect.dispatchEvent(new Event('change'));
    if (S.currentBundle) { S.state = 'BOARD'; boardView.style.display = 'flex'; boardView.style.opacity = '1'; }
});

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
    if (practice.isOpen()) practice.closePractice({ silent: true });
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
        // 1.4.0: en Barrido con parpadeo, la cámara queda encendida solo para el pulsador (sin cursor ni calibración)
        tracking.setScanCamera(S.trackingMode === 'SCAN' && blinkOn());
        if (S.trackingMode === 'SCAN' && blinkOn()) tracking.startMediaPipe();
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
            selectionContexts.setBase((S.state === 'HOME') ? boards.activeHomeElements : boards.activeGridElements);
            scan.start();
        } else {
            scan.stop();
        }
    } else {
        scan.stop();
        tracking.startMediaPipe();
        beginCameraAccess();
    }
    applyBlinkMode();
}

// --- Navegación Home/Board ---
function goHome() {
    if (practice.isOpen()) practice.closePractice({ silent: true });
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
    selectionContexts.setBase(boards.activeHomeElements);
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

// --- Practicar (1.3.0): actividades de acceso; reemplaza al botón "Tablero de Prueba" ---
practice.initPractice({
    setTargets: (t) => { if (S.state === 'PRACTICE') selectionContexts.setBase(t); },
    mode: () => S.trackingMode,
    scope: () => profileScope(),
    blinkInfo: () => ({ available: blinkOn() && tracking.isRunning(), mode: settings.blink.mode, value: blink.value, threshold: blink.threshold }),
    onExit: () => {
        pointer.invalidate('context', performance.now());
        if (S.currentBundle) { S.state = 'BOARD'; selectionContexts.setBase(boards.activeGridElements); }
        else goHome();
    }
});
document.getElementById('btn-practice').addEventListener('click', () => {
    if ((S.trackingMode === 'CARA' || S.trackingMode === 'OJOS') && !S.isCalibrated) {
        showInfoToast('Para practicar con la cámara primero hay que calibrar. Después tocá Practicar otra vez.', 6000);
        beginCameraAccess();
        return;
    }
    if (editor.isEditMode()) editor.exitEditMode();
    boards.stopMedia();
    S.state = 'PRACTICE';
    pointer.invalidate('context', performance.now());
    practice.openPractice();
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
        refreshOfflineStatus();
        const up = document.getElementById('btn-apply-update');
        if (up) up.hidden = !offline.hasUpdate();
    });
    document.getElementById('btn-apply-update')?.addEventListener('click', () => {
        if (!offline.applyUpdateNow()) showInfoToast('Terminá o borrá la frase en curso y volvé a intentar.', 4000);
    });
    document.getElementById('btn-prepare-offline')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const el = document.getElementById('offline-status');
        btn.disabled = true;
        if (el) el.textContent = 'Preparando… (puede tardar unos minutos la primera vez)';
        try {
            const st = await offline.prepareOffline(await localBundlesForOffline());
            if (el) el.textContent = offline.statusText(st);
        } finally { btn.disabled = false; }
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

// --- Configuración del parpadeo (1.4.0) ---
function wireBlinkSettings() {
    const mode = document.getElementById('blink-mode'), hold = document.getElementById('blink-hold'), sel = document.getElementById('blink-select');
    const status = document.getElementById('blink-status'), adjust = document.getElementById('btn-blink-adjust');
    if (!mode) return;
    const refresh = () => {
        mode.value = settings.blink.mode; hold.value = String(settings.blink.holdMs); sel.value = settings.blink.selectWith;
        document.getElementById('blink-hold-wrap').hidden = settings.blink.mode !== 'long';
        document.getElementById('blink-options').hidden = settings.blink.mode === 'off';
    };
    refresh();
    const save = async (patch) => {
        await saveSettings({ blink: { ...settings.blink, ...patch } });
        refresh();
        // Barrido: encender o apagar la cámara del pulsador según corresponda
        if (S.trackingMode === 'SCAN' && 'mode' in patch) applyMode('SCAN'); else applyBlinkMode();
    };
    mode.addEventListener('change', () => save({ mode: mode.value }));
    hold.addEventListener('change', () => save({ holdMs: parseInt(hold.value, 10) }));
    sel.addEventListener('change', () => save({ selectWith: sel.value }));
    adjust.addEventListener('click', async () => {
        if (!tracking.isRunning()) {
            status.textContent = 'Para ajustar, la cámara tiene que estar encendida: elegí Rostro, o Barrido con el parpadeo activado.';
            return;
        }
        adjust.disabled = true;
        const phase = async (text, ms) => {
            status.textContent = text; speak(text, { cancelPrevious: true });
            await new Promise(r => setTimeout(r, 900)); // tiempo de reacción: no se mide
            blinkCalib = [];
            await new Promise(r => setTimeout(r, ms));
            const got = blinkCalib; blinkCalib = null; return got;
        };
        const open = await phase('Mirá la pantalla con los ojos abiertos. Mirá también la parte de abajo.', 4000);
        const closed = await phase('Ahora cerrá los ojos.', 2500);
        speak('Listo, ya podés abrir los ojos.', { cancelPrevious: true });
        const r = calibrateThreshold(open, closed);
        if (r.ok) {
            await save({ threshold: r.threshold });
            status.textContent = `Listo: ajustado a esta persona (umbral ${r.threshold.toFixed(2)}).`;
        } else {
            status.textContent = r.reason === 'pocas-muestras'
                ? 'No se vio bien la cara durante el ajuste. Revisá la luz y probá de nuevo.'
                : 'Los ojos abiertos y cerrados se parecen demasiado para la cámara: probá con más luz, sin anteojos con reflejo, o usá permanencia.';
        }
        adjust.disabled = false;
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
    // Sin objetivo y sin cara (diálogos, home) no aporta: no se graba. Se conservan los últimos 20000 cuadros
    // (antes se cortaba al llenarse y se perdían justo las calibraciones más recientes).
    if (!target && !tracking.currentFeatures) return;
    if (diagRows.length >= 20000) diagRows.shift();
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
    const perf = document.createElement('button');
    perf.className = 'btn btn-secondary';
    perf.textContent = 'Rendimiento';
    perf.title = 'Descarga solo métricas agregadas del motor (sin video ni datos personales)';
    perf.onclick = () => downloadPerfReport();
    if (group) group.prepend(perf);
}

// --- Loop principal ---
function appLoop() {
    // El try/catch garantiza que una excepción en un frame NUNCA mate el loop:
    // sin él, un error aborta el requestAnimationFrame y la app queda muerta en silencio.
    try {
        ctxUI.clearRect(0, 0, canvasUI.width, canvasUI.height);
        const now = performance.now();

        if (diag) recordDiag(now);
        syncCompanionContext();
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
        } else if (selectionContexts.isPaused()) {
            // Panel del acompañante abierto: selección en pausa (el fondo no se activa)
            pointer.invalidate('companion', now);
        } else if (editor.isEditMode()) {
            // En modo edición los motores de acceso quedan en pausa (se edita con mouse/touch)
        } else if ((S.state === 'BOARD' || S.state === 'HOME' || S.state === 'PRACTICE') && S.trackingMode === 'SCAN') {
            scan.tick(now);
            if (S.state === 'PRACTICE') practice.tickPractice(now, null);
        } else if (S.state === 'PRACTICE' && S.trackingMode === 'CLICKS') {
            practice.tickPractice(now, null); // Manual: el cursor es el dedo (lo toma practice.js)
        } else if ((S.state === 'BOARD' || S.state === 'HOME' || S.state === 'PRACTICE') && (S.trackingMode === 'CARA' || S.trackingMode === 'OJOS')) {
            // M01: sin rostro, ojos cerrados, cabeza fuera de pose, cámara congelada o muestra vieja → pausa y
            // se reinicia la permanencia. El dwell solo avanza con muestras nuevas (reloj de captura).
            const r = pointer.step(tracking.latestSample, now);
            S.smoothX = r.x; S.smoothY = r.y;
            if (S.state === 'PRACTICE') practice.tickPractice(now, r.x !== null ? { x: r.x, y: r.y } : null);
            if (r.x !== null) {
                cursorTrail.push({ t: now, x: r.x, y: r.y });
                while (cursorTrail.length && cursorTrail[0].t < now - 1500) cursorTrail.shift();
            }
            if (r.x !== null) drawCursor(r.x, r.y);
            else if (S.isCalibrated) { const msg = pauseMessage(r.reason); if (msg) drawPauseMessage(msg); }
        }
        if (!calibSession) drawBlink(now);
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

    // Verificación de Rostro a lazo cerrado: el cursor se ve (anillo celeste) para llevarlo al punto
    if (info.cursor) {
        ctxUI.beginPath();
        ctxUI.arc(info.cursor[0], info.cursor[1], 14, 0, 2 * Math.PI);
        ctxUI.lineWidth = 5;
        ctxUI.fillStyle = 'rgba(79,195,247,0.35)';
        ctxUI.fill();
        ctxUI.strokeStyle = '#4fc3f7';
        ctxUI.stroke();
    }

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

// 1.3.3 (decisión de Esteban): la configuración de acceso se hace EN la tablet (Configuración). Lo que haya
// quedado guardado en aac_users.settings desde la cuenta registrada ya no se aplica; solo se restaura el modo local.
async function applyDeviceSettings() {
    const target = settings.accessMode || 'CLICKS';
    if (target !== S.trackingMode) { modeSelect.value = target; applyMode(target); }
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
            if (v && (geometryChanged(v, { w: window.innerWidth, h: window.innerHeight }) || orientationOf(v.w, v.h) !== orientationOf(window.innerWidth, window.innerHeight))) {
                // Se cancela y se vuelve a decidir con la geometría nueva: si hay un perfil para esta orientación,
                // alcanza con la verificación rápida
                calibSession = null;
                beginCameraAccess();
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
    await applyDeviceSettings(); // después de abrir: calibra una sola vez si hace falta

    // Refrescar desde la nube en segundo plano (la tablet ya es usable con lo local)
    const res = await deviceMod.pullCopies();
    if (res === 'unlinked') {
        await calibration.clearScope(profileScope());
        await deviceMod.unlink();
        await customAlert('Esta tablet fue desvinculada desde la cuenta registrada.');
        window.location.reload();
        return;
    }
    if (res === 'ok') {
        await applyDeviceSettings();
        if (S.state === 'HOME') openDeviceHome();
    }
}

window.addEventListener('miravoz:device-unlinked', async () => {
    await calibration.clearScope(profileScope());
    await deviceMod.unlink();
    await customAlert('Esta tablet fue desvinculada desde la cuenta registrada.');
    window.location.reload();
});

// --- M08: voz que falla: la frase se conserva y se puede reintentar ---
window.addEventListener('miravoz:speech-error', () => {
    showInfoToast('No se pudo decir la frase. Sigue en pantalla: tocá reproducir para intentar de nuevo (revisá volumen y modo silencio).', 6000);
});

// --- M08: versión real de lo publicado (hash del contenido, ver tools/build-offline-manifest.mjs) ---
// La versión mostrada es la del código que CORRE (build-info.js, cacheado junto con la app). version.json
// (siempre de la red) dice la publicada: si difiere, se avisa que hay una nueva esperando a reabrir.
let appVersion = APP_VERSION, appBuild = null;
{
    const el = document.getElementById('app-version');
    if (el) el.textContent = `Versión ${APP_VERSION}`;
}
fetch('/version.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(v => {
    appBuild = v && v.version;
    const el = document.getElementById('app-version');
    if (!el || !v) return;
    if (v.version) el.title = `Compilación publicada ${v.version}`;
    if (v.app && v.app !== APP_VERSION) el.textContent = `Versión ${APP_VERSION} · hay una nueva (${v.app}): cerrá y volvé a abrir MiraVoz`;
}).catch(() => {});

// --- M08: panel de diagnóstico SOLO para desarrollo (?diag=1): métricas técnicas, sin video ni textos ---
const perfSnapshots = [];
if (urlParams.get('diag') === '1') {
    const panel = document.createElement('div');
    panel.id = 'diag-panel';
    panel.setAttribute('aria-hidden', 'true');
    panel.style.cssText = 'position:fixed; left:8px; top:8px; z-index:40000; background:rgba(0,0,0,0.75); color:#9f9; font:12px/1.35 monospace; padding:8px 10px; border-radius:8px; pointer-events:none; white-space:pre;';
    document.body.appendChild(panel);
    setInterval(() => {
        const v = tracking.visionStats();
        const s = tracking.latestSample;
        const prof = (S.trackingMode === 'CARA' || S.trackingMode === 'OJOS') ? calibration.getProfile(S.trackingMode) : null;
        panel.textContent = [
            `versión ${appVersion || '?'} (${appBuild || '?'}) · modo ${S.trackingMode} · motor ${v.engine || '-'} (${v.mode}${v.delegate ? ', ' + v.delegate : ''})`,
            `inferencia p50/p95 ${v.inferP50 ?? '-'}/${v.inferP95 ?? '-'} ms · captura→resultado ${v.latencyP50 ?? '-'}/${v.latencyP95 ?? '-'} ms`,
            `resultados/s ${v.resultsPerSec} · descartados ${v.dropped} · antigüedad muestra ${v.sampleAgeMs ?? '-'} ms`,
            `muestra ${s ? (s.valid ? 'válida' : 'inválida: ' + s.reason) : '-'} · puntero ${pointer.invalid ? 'en pausa (' + pointer.reason + ')' : 'activo'}`,
            `perfil ${prof ? `${prof.validation?.status || 'sin verificar'} rev ${prof.revision || '-'}` : '-'} · contexto ${selectionContexts.top()?.name || 'tablero'}`,
            `parpadeo ${settings.blink.mode} · cierre ${blink.value == null ? '-' : blink.value.toFixed(2)} · umbral ${blink.threshold.toFixed(2)}${blink.closed ? ' · CERRADO' : ''}`
        ].join('\n');
    }, 500);
    setInterval(() => { if (perfSnapshots.length < 720) perfSnapshots.push({ t: Math.round(performance.now() / 1000), ...tracking.visionStats() }); }, 10000);
}

/** Reporte de rendimiento: solo métricas agregadas (sin video, fotos, textos comunicados, tokens ni nombres). */
function downloadPerfReport() {
    const prof = calibration.getProfile(S.trackingMode);
    const report = {
        kind: 'miravoz-rendimiento', version: appVersion, build: appBuild, ua: navigator.userAgent, viewport: [innerWidth, innerHeight],
        mode: S.trackingMode, vision: tracking.visionStats(), snapshots: perfSnapshots,
        profileValidation: prof && prof.validation ? { status: prof.validation.status, rules: prof.validation.rules, metrics: { ...prof.validation.metrics, perPoint: undefined } } : null
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' }));
    a.download = `miravoz-rendimiento-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// --- M05: uso sin conexión ---
async function refreshOfflineStatus() {
    const el = document.getElementById('offline-status');
    if (el) el.textContent = offline.statusText(await offline.offlineStatus());
}
/** Tableros de este dispositivo (propios o copias de la tablet), para guardar sus pictogramas. */
async function localBundlesForOffline() {
    const out = [];
    for (const k of await localforage.keys()) {
        if (k.startsWith('miravoz_') && !k.startsWith('miravoz_copy_')) continue;
        const b = await localforage.getItem(k);
        if (b && b.boards) out.push(b);
    }
    return out;
}

// --- Arranque ---
// El arranque nunca puede quedar colgado esperando al almacenamiento o al Service Worker (Safari en
// navegación privada puede demorar o no responder): cada paso tiene un tope y, si vence, se sigue.
const withTimeout = (p, ms, fallback) => Promise.race([Promise.resolve(p).catch(() => fallback), new Promise(r => setTimeout(() => r(fallback), ms))]);

// Red de seguridad: si a los 12 s no se ve ni el ingreso ni la app, se muestra el ingreso
setTimeout(() => {
    const visible = (id) => { const el = document.getElementById(id); return el && el.style.display && el.style.display !== 'none'; };
    if (!['auth-view', 'home-view', 'board-view'].some(visible) && !S.state.startsWith('CALIBRATING')) {
        console.warn('Arranque demorado: se muestra la pantalla de ingreso');
        showAuthView(true);
    }
}, 12000);

(async function init() {
    initTheme();
    await withTimeout(initSettings(), 3000);
    applyBlinkMode();
    offline.configureUpdates({
        isSafeMoment: () => !calibSession && getSentence().length === 0,
        onUpdateReady: () => { const b = document.getElementById('btn-apply-update'); if (b) b.hidden = false; }
    });
    await withTimeout(offline.registerOffline(), 2500); // al arrancar, una versión ya descargada se aplica acá (antes de usar la cámara)
    offline.markInUse();
    renderModeSegmented();
    if (dwellSelect) dwellSelect.value = String(settings.dwellMs);
    wireScanSetting('scan-pattern', 'pattern');
    wireScanSetting('scan-interval', 'intervalMs', true);
    wireScanSetting('scan-audio', 'audio');
    wireBlinkSettings();
    editor.initEditor();
    initUsers();
    renderSentence();

    // Tablet vinculada a un usuario: modo dispositivo (sin gestión ni cuenta de profesional)
    if (await withTimeout(deviceMod.loadDevice(), 3000, null)) {
        await withTimeout(calibration.loadProfiles(), 3000);
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

    // Cuentas habilitadas: si el servidor dice que no, se cierra la sesión acá mismo y se avisa.
    // S.currentUser = null antes de signOut para que onSignedOut no recargue y se pierda el mensaje.
    async function admitOrReject(user) {
        if ((await accountEnabled()) !== false) return true;
        S.currentUser = null;
        try { await signOut(); } catch { /* sin red: igual queda afuera */ }
        showAuthView(true);
        updateAccountUI();
        showErrorToast(NOT_ENABLED_MESSAGE);
        return false;
    }

    initAuth({
        onReady: async (user) => {
            // Recién acá (supabase-js ya canjeó el ?code= de Google) se limpia la URL
            const oauthError = consumeOAuthReturn();
            if (user) { if (await admitOrReject(user)) await enterProfessionalApp(user); return; }
            showAuthView(true);
            updateAccountUI();
            if (oauthError) showErrorToast(oauthErrorText(oauthError));
        },
        onSignedIn: async (user) => { if (await admitOrReject(user)) await enterProfessionalApp(user); },
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
