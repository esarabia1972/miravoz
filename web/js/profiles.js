// profiles.js — Perfiles de calibración con contexto: persona, dispositivo, cámara y geometría (M02, 11/10/2026)
//
// Antes había UN perfil por modo y por navegador (miravoz_calibration_v2): en una tablet compartida o al
// girar el iPad se aplicaba la calibración de otra persona o de otra geometría. Ahora:
//  - los perfiles se guardan por ÁMBITO de persona: `user:<aacUserId>` en una tablet vinculada y `prueba`
//    para la profesional (perfil de prueba separado). Nunca se infiere identidad por la cara;
//  - cada perfil guarda motor, tipo de modelo, cámara, viewport, orientación y estado de validación;
//  - checkCompatibility() decide si se puede usar; los perfiles viejos sin contexto se conservan (para
//    recuperación) pero NO se aplican: piden calibrar de nuevo;
//  - guardar nunca destruye lo último persistido: si la escritura falla, el perfil nuevo queda solo en memoria
//    y se avisa.
// Regla de geometría (documentada y testeada): cambiar la orientación siempre invalida. Un cambio de ancho
// > 12% o de alto > 15% también. Variaciones menores (barras de Safari que aparecen y desaparecen, ~5-10%
// del alto) NO invalidan, para no entrar en un bucle de recalibración; igual cada arranque hace la
// verificación rápida, que detecta un desajuste real.

export const SCHEMA = 3;
export const STORAGE_KEY = 'miravoz_calibration_v3';
export const LEGACY_KEY = 'miravoz_calibration_v2';
export const GEOMETRY_RULE = { widthFrac: 0.12, heightFrac: 0.15 };

/** Tipo de modelo por modo (si cambia el modelo o las features, los perfiles viejos dejan de servir) */
// CARA (1.1.0, 11/10/2026): con FaceLandmarker se usan los ÁNGULOS de la cabeza (giro y cabeceo), que no cambian
// si la persona se corre o se hunde en la silla; la posición de la nariz en la imagen sí (diagnóstico del iPad Air 4:
// error mediano 131 px con la nariz y 46 px con ángulos, mismos datos). El motor legado (sin pose) sigue con la nariz.
export const MODEL_KINDS = { CARA: 'poly-headangles-v1', CARA_NOSE: 'poly-nose-v2' }; // OJOS: gaze.MODEL_KIND (lo agrega calibration.js)

export function orientationOf(w, h) { return w >= h ? 'landscape' : 'portrait'; }

/** Identificador local y aleatorio de este navegador (no identifica a la persona ni al hardware). */
export function localDeviceId(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    const KEY = 'miravoz_device_local_id';
    try {
        let id = storage && storage.getItem(KEY);
        if (!id) {
            id = 'dev-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
            storage && storage.setItem(KEY, id);
        }
        return id;
    } catch { return 'dev-sin-almacenamiento'; }
}

export function newRevision(now = Date.now()) {
    return `rev-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Contexto actual con el que se compara un perfil.
 * @returns {{scope, deviceId, engine, viewport:{w,h}, orientation, dpr, camera:{width,height}|null}}
 */
export function makeContext({ scope, deviceId, engine, w, h, dpr = 1, camera = null }) {
    return { scope, deviceId, engine, viewport: { w, h }, orientation: orientationOf(w, h), dpr, camera };
}

/**
 * ¿Se puede usar este perfil en este contexto? → { ok, reason }
 * reason: null | 'no-profile' | 'legacy' | 'model' | 'scope' | 'device' | 'engine' | 'orientation' | 'geometry' | 'not-validated'
 */
export function checkCompatibility(profile, ctx, { mode, modelKind } = {}) {
    if (!profile) return { ok: false, reason: 'no-profile' };
    if (profile.schema !== SCHEMA || !profile.context) return { ok: false, reason: 'legacy' };
    if (modelKind && profile.modelKind !== modelKind) return { ok: false, reason: 'model' };
    const c = profile.context;
    if (ctx) {
        if (c.scope !== ctx.scope) return { ok: false, reason: 'scope' };
        if (c.deviceId && ctx.deviceId && c.deviceId !== ctx.deviceId) return { ok: false, reason: 'device' };
        // Iris y Rostro (ángulos) necesitan la pose de FaceLandmarker: otro motor invalida el perfil
        if (ctx.engine && c.engine && ctx.engine !== c.engine) return { ok: false, reason: 'engine' };
        if (c.orientation !== ctx.orientation) return { ok: false, reason: 'orientation' };
        if (geometryChanged(c.viewport, ctx.viewport)) return { ok: false, reason: 'geometry' };
    }
    if (!profile.validation || profile.validation.status !== 'accepted') return { ok: false, reason: 'not-validated' };
    return { ok: true, reason: null };
}

/** Cambio geométrico importante según GEOMETRY_RULE (las barras de Safari no cuentan). */
export function geometryChanged(a, b) {
    if (!a || !b) return true;
    const dw = Math.abs(a.w - b.w) / Math.max(1, a.w);
    const dh = Math.abs(a.h - b.h) / Math.max(1, a.h);
    return dw > GEOMETRY_RULE.widthFrac || dh > GEOMETRY_RULE.heightFrac;
}

/** Texto para la persona de apoyo según el motivo de incompatibilidad. */
export function compatibilityMessage(reason) {
    switch (reason) {
        case 'legacy': return 'La calibración guardada es de una versión anterior: hay que calibrar de nuevo.';
        case 'model': return 'Cambió el modelo de seguimiento: hay que calibrar de nuevo.';
        case 'engine': return 'Cambió el motor de cámara: hay que calibrar de nuevo.';
        case 'orientation': return 'Se giró la pantalla: hay que calibrar en esta orientación.';
        case 'geometry': return 'Cambió mucho el tamaño de la pantalla: hay que calibrar de nuevo.';
        case 'device': return 'La calibración es de otro dispositivo: hay que calibrar de nuevo.';
        case 'not-validated': return 'La calibración no pasó la verificación: hay que repetirla.';
        default: return '';
    }
}

/**
 * Almacén de perfiles por ámbito. storage: { getItem, setItem } async (localforage).
 * Estructura persistida: { schema: 3, scopes: { [scope]: { CARA, OJOS } }, legacy?: <v2 sin tocar> }
 */
export class ProfileStore {
    constructor(storage) {
        this.storage = storage;
        this.data = { schema: SCHEMA, scopes: {} };
        this.unsaved = false;     // true = el último guardado falló: el perfil activo vive solo en memoria
        this.loadFailed = false;  // true = no se pudo leer: antes de escribir se reintenta leer (no pisar otros ámbitos)
    }

    async load() {
        try {
            const v3 = await this.storage.getItem(STORAGE_KEY);
            if (v3 && v3.schema === SCHEMA && v3.scopes) this.data = v3;
            if (!this.data.legacy) {
                // Migración controlada: el perfil viejo (sin contexto) se conserva para recuperación, sin aplicarlo
                const v2 = await this.storage.getItem(LEGACY_KEY);
                if (v2 && (v2.CARA || v2.OJOS)) this.data.legacy = { ...v2, migratedAt: Date.now() };
            }
            this.loadFailed = false;
        } catch (e) {
            console.error('Error al cargar perfiles de calibración:', e);
            this.loadFailed = true;
        }
        return this.data;
    }

    get(scope, mode) {
        return (this.data.scopes[scope] && this.data.scopes[scope][mode]) || null;
    }

    /** Guarda sin destruir lo persistido si la escritura falla. Devuelve true si quedó persistido. */
    async put(scope, mode, profile) {
        if (this.loadFailed) await this.load(); // nunca escribir sobre una lectura fallida (borraría a otras personas)
        const next = JSON.parse(JSON.stringify(this.data));
        next.scopes[scope] = { ...(next.scopes[scope] || {}), [mode]: profile };
        try {
            await this.storage.setItem(STORAGE_KEY, next);
            this.data = next;
            this.unsaved = false;
            return true;
        } catch (e) {
            console.error('No se pudo guardar la calibración (queda solo en esta sesión):', e);
            this.data = next;          // se usa en memoria…
            this.unsaved = true;       // …y se avisa; lo persistido antes sigue intacto en el almacenamiento
            return false;
        }
    }

    async remove(scope, mode) {
        if (!this.data.scopes[scope] || !this.data.scopes[scope][mode]) return;
        const next = JSON.parse(JSON.stringify(this.data));
        delete next.scopes[scope][mode];
        try { await this.storage.setItem(STORAGE_KEY, next); this.data = next; }
        catch (e) { console.error('No se pudo borrar la calibración:', e); this.data = next; }
    }

    /** Al desvincular una tablet: borra SOLO los perfiles de ese usuario (no toca tableros ni otros ámbitos). */
    async removeScope(scope) {
        if (!this.data.scopes[scope]) return;
        const next = JSON.parse(JSON.stringify(this.data));
        delete next.scopes[scope];
        try { await this.storage.setItem(STORAGE_KEY, next); } catch { /* se reintenta la próxima vez */ }
        this.data = next;
    }
}
