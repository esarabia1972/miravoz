// state.js — Estado compartido de la aplicación (SPEC F1-1)
// Único lugar donde vive el estado mutable global. Los módulos lo importan como `S`.

export const S = {
    // Máquina de estados: HOME | BOARD | CALIBRATING_PENDING | CALIBRATING_COUNTDOWN | CALIBRATING_SAMPLING
    state: 'HOME',
    trackingMode: 'CLICKS',   // CLICKS | CARA | OJOS (experimental)
    isCalibrated: false,

    // Gaze
    rawX: null,
    rawY: null,
    smoothX: null,
    smoothY: null,

    // Tablero activo
    currentBundle: null,
    currentGridId: null,
    navigationHistory: [],

    // Usuario (bypass local por ahora — ver SPEC F4)
    currentUser: null
};
