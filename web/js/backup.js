// backup.js — Respaldo propio de MiraVoz (0.7.5)
//
// Un archivo .miravoz.json con lo que no se puede volver a bajar de la nube o de un .grd:
//  - tableros de la cuenta registrada (con páginas, acciones, imágenes, niveles, etiquetas);
//  - frases favoritas y palabras aprendidas por la predicción, de cada persona de este dispositivo.
// Nunca incluye el token de la tablet, sesiones, calibraciones (dependen del dispositivo) ni el registro de uso.
// Restaurar nunca reemplaza nada: los tableros entran como tableros nuevos y lo demás se suma a lo que hay.

export const BACKUP_FORMAT = 'miravoz-respaldo';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 60 * 1024 * 1024;
const MAX_BOARDS = 500;

const BUNDLE_META = ['ownerId', 'syncedAt', 'assignmentId', 'permission', 'copyUpdatedAt', 'aacUserId', 'dirty', 'bundleId', 'profEdit', 'ownerLabel'];

/** Un tablero listo para el respaldo: sin datos de cuenta ni de asignación. */
export function cleanBundleForBackup(b) {
    const out = JSON.parse(JSON.stringify(b));
    for (const k of BUNDLE_META) delete out[k];
    return out;
}

/** ¿Es un tablero utilizable? (estructura mínima que la app sabe abrir) */
export function isValidBundle(b) {
    if (!b || typeof b !== 'object' || typeof b.name !== 'string' || !b.name.trim()) return false;
    if (!b.boards || typeof b.boards !== 'object') return false;
    const pages = Object.values(b.boards);
    if (!pages.length || pages.length > 300) return false;
    return pages.every(g => g && typeof g === 'object' && Array.isArray(g.gridElements || []));
}

/** Arma el respaldo (puro: recibe los datos ya leídos). */
export function buildBackup({ boards = [], favorites = {}, words = {}, app = '', mode = 'cuenta', now = Date.now() } = {}) {
    return {
        format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date(now).toISOString(), app, mode,
        boards: boards.filter(isValidBundle).map(cleanBundleForBackup),
        favorites, words
    };
}

/**
 * Lee y valida un respaldo. No aplica nada: devuelve lo que se puede restaurar y lo que se descartó.
 * @returns {{ ok: true, boards, favorites, words, skipped, createdAt } | { ok: false, error }}
 */
export function parseBackup(text) {
    if (typeof text !== 'string' || !text.length) return { ok: false, error: 'El archivo está vacío.' };
    if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: 'El archivo es demasiado grande para ser un respaldo de MiraVoz.' };
    let data;
    try { data = JSON.parse(text); } catch { return { ok: false, error: 'El archivo no es un respaldo de MiraVoz (o está dañado).' }; }
    if (!data || data.format !== BACKUP_FORMAT) return { ok: false, error: 'El archivo no es un respaldo de MiraVoz.' };
    if (!(data.version >= 1) || data.version > BACKUP_VERSION) return { ok: false, error: 'Este respaldo es de una versión más nueva de MiraVoz: actualizá la app y probá de nuevo.' };
    const raw = Array.isArray(data.boards) ? data.boards.slice(0, MAX_BOARDS) : [];
    const boards = raw.filter(isValidBundle);
    const favorites = data.favorites && typeof data.favorites === 'object' && !Array.isArray(data.favorites) ? data.favorites : {};
    const words = data.words && typeof data.words === 'object' && !Array.isArray(data.words) ? data.words : {};
    return { ok: true, boards, favorites, words, skipped: raw.length - boards.length, createdAt: data.createdAt || null, mode: data.mode === 'tablet' ? 'tablet' : 'cuenta' };
}

/** Tablero restaurado: id nuevo, nombre sin chocar con los que ya hay. */
export function restoredBundle(b, existingNames, newId) {
    const out = cleanBundleForBackup(b);
    out.id = newId;
    const base = out.name.trim();
    let name = base;
    for (let i = 1; existingNames.has(name.toLocaleLowerCase('es')); i++) name = i === 1 ? `${base} (respaldo)` : `${base} (respaldo ${i})`;
    out.name = name;
    existingNames.add(name.toLocaleLowerCase('es'));
    delete out.updatedAt;
    return out;
}

/** Suma palabras aprendidas (se queda con el mayor conteo de cada una). */
export function mergeWords(a = {}, b = {}) {
    const out = { ...a };
    for (const [w, n] of Object.entries(b || {})) {
        if (typeof w !== 'string' || w.length < 2 || w.length > 40 || !Number.isFinite(n)) continue;
        out[w] = Math.max(out[w] || 0, Math.min(n, 1e6));
    }
    return out;
}
