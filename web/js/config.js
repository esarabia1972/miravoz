// config.js — Configuración global y settings persistidos (SPEC F0-7, F1)
// Única fuente de verdad para parámetros ajustables.

export const CONFIG = {
    // Dwell
    DWELL_MS: 1200,
    DWELL_COOLDOWN_MS: 800,
    HYSTERESIS_MS: 150,

    // Calibración
    COUNTDOWN_MS: 1500,
    SAMPLING_MS: 1000,
    SAMPLE_WARMUP_MS: 200,        // F1-4: descartar muestras iniciales (sacada de llegada)
    SAMPLE_OUTLIER_SIGMA: 2,      // F1-4: descartar muestras a >2σ del punto
    MIN_SAMPLES_PER_POINT: 10,    // F1-4: mínimo de muestras válidas por punto
    CALIB_MAX_RETRIES_PER_POINT: 1, // F1-5: reintentos automáticos del peor punto
    CALIB_POINT_ERROR_FRAC: 0.08, // F1-5: umbral de error por punto (fracción de la diagonal)
    CALIB_GOOD_FRAC: 0.04,        // F1-5: score "Buena" si error medio < 4% diagonal
    RIDGE_LAMBDA_CARA: 0.1,       // F1-3
    RIDGE_LAMBDA_OJOS: 0.01,      // F1-3 (con features polinómicas necesita algo más que 0.001)

    // Filtro 1 Euro (F1-2)
    ONE_EURO_MIN_CUTOFF: 1.0,
    ONE_EURO_BETA: 0.02,
    ONE_EURO_D_CUTOFF: 1.0,

    // Dwell targets: refresco de rects cacheados (F1-6, red de seguridad)
    RECT_REFRESH_MS: 1000,

    // Experimental
    EXPERIMENTAL_IRIS: false
};

const SETTINGS_KEY = 'miravoz_settings';

export const settings = {
    dwellMs: CONFIG.DWELL_MS,
    accessMode: 'CLICKS',
    // F2-5: configuración de barrido por perfil
    scan: {
        pattern: 'ROW_COLUMN',   // ROW_COLUMN | LINEAR
        intervalMs: 1200,        // 500-4000
        cycles: 3,               // vueltas sin activación antes de pausar
        audio: 'none'            // none | beep | speak
    }
};

// Carga settings desde localforage, migrando la clave vieja de localStorage si existe (F0.1 pendiente)
export async function initSettings() {
    try {
        let stored = await localforage.getItem(SETTINGS_KEY);
        // Migración desde la clave legacy 'miravoz_dwell' (localStorage)
        const legacy = localStorage.getItem('miravoz_dwell');
        if (!stored && legacy) {
            stored = { dwellMs: parseInt(legacy, 10) };
            await localforage.setItem(SETTINGS_KEY, stored);
        }
        if (legacy) localStorage.removeItem('miravoz_dwell');

        if (stored && typeof stored === 'object') {
            const scanDefaults = { ...settings.scan };
            Object.assign(settings, stored);
            settings.scan = { ...scanDefaults, ...(stored.scan || {}) }; // merge profundo de scan
        }
    } catch (e) {
        console.error('Error cargando settings:', e);
    }
    applySettings();
}

export function applySettings() {
    if (Number.isFinite(settings.dwellMs)) CONFIG.DWELL_MS = settings.dwellMs;
}

export async function saveSettings(patch) {
    Object.assign(settings, patch);
    applySettings();
    try {
        await localforage.setItem(SETTINGS_KEY, { ...settings });
    } catch (e) {
        console.error('Error guardando settings:', e);
    }
}
