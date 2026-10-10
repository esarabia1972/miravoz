// device.js — Tablet vinculada a un usuario (SPEC F4-4)
// La tablet del chico NO inicia sesión: canjea el código que generó la profesional por un TOKEN
// secreto que guarda en el dispositivo (supabase/03_tokens_de_tablet.sql: device_redeem / device_fetch /
// device_save_copy validan el token en el servidor). Desde ahí:
//  - abre directo en su "casita" (home_board_id = una de sus copias asignadas), sin gestión;
//  - trabaja SIEMPRE sobre copias locales (offline-first) y las refresca al abrir/volver;
//  - solo guarda en la nube las copias con permiso 'editable' (RPC device_save_copy).
// Las copias se guardan en localforage con clave = id = 'miravoz_copy_<assignmentId>': el prefijo
// miravoz_ las deja fuera del home de profesional y de la sync de tableros (sync.js).

import { supabaseClient } from './auth.js';
import { customAlert, customConfirm, showInfoToast } from './ui.js';
import { backupBundle, setCopySaver } from './sync.js';

const DEVICE_KEY = 'miravoz_device';
const COPY_PREFIX = 'miravoz_copy_';
const META = ['assignmentId', 'permission', 'copyUpdatedAt', 'dirty', 'bundleId', 'updatedAt', 'profEdit', 'ownerLabel'];

/** { aacUserId, displayName, homeAssignmentId, settings, linkedAt } o null */
export let device = null;
export const isDeviceMode = () => !!device;

export async function loadDevice() {
    device = (await localforage.getItem(DEVICE_KEY)) || null;
    return device;
}

const copyKey = (assignmentId) => COPY_PREFIX + assignmentId;

function copyFromRow(row) {
    const b = row.copy_bundle || {};
    return {
        ...b,
        id: copyKey(row.id),
        bundleId: b.id || null,
        assignmentId: row.id,
        permission: row.permission,
        copyUpdatedAt: row.copy_updated_at,
        dirty: false
    };
}

function copyToServer(copy) {
    const out = { ...copy };
    META.forEach(k => delete out[k]);
    out.id = copy.bundleId || out.id;
    return out;
}

export async function listCopies() {
    const out = [];
    for (const k of await localforage.keys()) {
        if (!k.startsWith(COPY_PREFIX)) continue;
        const c = await localforage.getItem(k);
        if (c) out.push(c);
    }
    return out.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
}

export async function getHomeCopy() {
    if (!device?.homeAssignmentId) return null;
    return localforage.getItem(copyKey(device.homeAssignmentId));
}

// --- Vincular ---
/** Canjea el código. Devuelve { ok: true } o { ok: false, error }. */
export async function linkWithCode(rawCode) {
    if (!supabaseClient) return { ok: false, error: 'Sin conexión con el servidor. Probá de nuevo con internet.' };
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session && !session.user.is_anonymous) {
            return { ok: false, error: 'Hay una profesional con sesión iniciada en este dispositivo. Cerrá esa sesión antes de vincular la tablet.' };
        }
        const { data, error } = await supabaseClient.rpc('device_redeem', { p_code: rawCode });
        if (error) {
            console.error('device_redeem:', error);
            return { ok: false, error: error.message?.includes('intentos') ? error.message
                : `No se pudo vincular (${error.code || error.message || 'error del servidor'}). Revisá la conexión e intentá de nuevo.` };
        }
        if (!data?.ok || !data.token) return { ok: false, error: data?.error || 'Código inválido, vencido o ya usado.' };

        await clearCopiesFromDevice(); // restos de otro vínculo o de una profesional en este navegador
        device = {
            token: data.token, // secreto de esta tablet: solo vive en este dispositivo
            aacUserId: data.aac_user_id,
            displayName: data.display_name,
            homeAssignmentId: data.home_board_id || null,
            settings: data.settings || {},
            linkedAt: Date.now()
        };
        await localforage.setItem(DEVICE_KEY, device);
        await pullCopies();
        return { ok: true };
    } catch (e) {
        console.error('linkWithCode:', e);
        return { ok: false, error: `No se pudo vincular (${e?.message || 'sin conexión'}). Revisá la conexión e intentá de nuevo.` };
    }
}

/** Copias con cambios que todavía no se pudieron subir. */
export async function pendingCopies() {
    return (await listCopies()).filter(c => c.dirty && (c.permission === 'editable' || c.profEdit));
}

/** Intenta subir todo lo pendiente (antes de desvincular o cerrar sesión). */
export async function flushCopies() {
    for (const c of await pendingCopies()) await enqueuePush(c);
    return (await pendingCopies()).length; // lo que quedó sin subir
}

/** Borra copias y sus respaldos de este dispositivo (son datos del chico: privacidad). */
async function clearCopiesFromDevice() {
    for (const k of await localforage.keys()) {
        if (k.startsWith(COPY_PREFIX) || k.startsWith('miravoz_conflict_backup_' + COPY_PREFIX)) await localforage.removeItem(k);
    }
}

export async function unlink() {
    await clearCopiesFromDevice();
    await localforage.removeItem(DEVICE_KEY);
    device = null;
    // (la tablet no tiene sesión: no hay nada que cerrar en Supabase)
}

// --- Traer copias del servidor (al abrir, al volver a la app, al recuperar conexión) ---
let pulling = false;
let lastPull = 0;

/** @returns {'ok'|'offline'|'unlinked'} */
export async function pullCopies() {
    if (!device || !supabaseClient || pulling) return 'offline';
    pulling = true;
    lastPull = Date.now();
    const changed = [], removed = [];
    try {
        if (!device.token) return 'unlinked'; // vínculo viejo (sesión anónima): hay que volver a vincular

        const { data: res, error } = await supabaseClient.rpc('device_fetch', { p_token: device.token });
        if (error) throw error;
        if (!res?.ok) return res?.unlinked ? 'unlinked' : 'offline'; // la profesional desvinculó o borró al usuario

        const me = res.user;
        Object.assign(device, { displayName: me.display_name, homeAssignmentId: me.home_board_id || null, settings: me.settings || {} });
        await localforage.setItem(DEVICE_KEY, device);
        const rows = res.assignments || [];

        const serverIds = new Set();
        for (const row of rows || []) {
            serverIds.add(copyKey(row.id));
            const local = await localforage.getItem(copyKey(row.id));
            if (!local) {
                await localforage.setItem(copyKey(row.id), copyFromRow(row));
                changed.push(copyKey(row.id));
            } else if (local.dirty && row.permission === 'editable') {
                await enqueuePush(local); // tiene cambios sin subir: intenta subirlos (resuelve conflicto)
            } else if (local.copyUpdatedAt !== row.copy_updated_at || local.permission !== row.permission
                       || (local.dirty && row.permission !== 'editable')) {
                if (local.dirty) await backupBundle(local.id, local, 'la copia pasó a solo lectura');
                await localforage.setItem(copyKey(row.id), copyFromRow(row));
                changed.push(copyKey(row.id));
            }
        }
        // Copias que la profesional quitó: se sacan de la tablet (con respaldo)
        for (const c of await listCopies()) {
            if (serverIds.has(c.id)) continue;
            await backupBundle(c.id, c, 'asignación quitada por la profesional');
            await localforage.removeItem(c.id);
            removed.push(c.id);
        }
        return 'ok';
    } catch (e) {
        console.warn('pullCopies (se reintenta luego):', e?.message || e);
        return 'offline';
    } finally {
        pulling = false;
        if (changed.length || removed.length) {
            window.dispatchEvent(new CustomEvent('miravoz:bundles-changed', { detail: { ids: changed, removed } }));
        }
    }
}

// --- Guardar una copia (lo llama sync.saveBundle cuando el bundle es una copia) ---
const pushQueue = new Map();

async function saveCopy(copy) {
    copy.updatedAt = Date.now();
    copy.dirty = true;
    await localforage.setItem(copy.id, copy);
    // La profesional edita cualquier copia desde su cuenta (F4-3); la tablet, solo las editables
    if (!copy.profEdit && copy.permission !== 'editable') return; // solo lectura: queda local (y se pisa en el próximo pull)
    return enqueuePush(copy);
}

/** Todas las subidas de una copia pasan por esta cola (nunca dos en paralelo con el mismo "esperado"). */
function enqueuePush(copy) {
    const prev = pushQueue.get(copy.id) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => pushCopy(copy));
    pushQueue.set(copy.id, next);
    next.finally(() => { if (pushQueue.get(copy.id) === next) pushQueue.delete(copy.id); });
    return next;
}

async function pushCopy(copy) {
    if (!supabaseClient) return false;
    const current = (await localforage.getItem(copy.id)) || copy;
    if (current.profEdit) return pushCopyAsProfessional(copy, current);
    try {
        if (!device?.token) return false;
        const { data, error } = await supabaseClient.rpc('device_save_copy', {
            p_token: device.token,
            p_assignment_id: current.assignmentId,
            p_copy_bundle: copyToServer(current),
            p_expected_updated_at: current.copyUpdatedAt
        });
        if (error) throw error;
        if (data?.unlinked) { window.dispatchEvent(new CustomEvent('miravoz:device-unlinked')); return false; }
        if (data?.conflict) {
            // La profesional editó la copia desde su cuenta: gana su versión, lo de acá va a respaldo
            await backupBundle(current.id, current, 'conflicto: la profesional editó la copia');
            const fresh = copyFromRow({ id: current.assignmentId, copy_bundle: data.copy_bundle,
                                        permission: current.permission, copy_updated_at: data.copy_updated_at });
            await localforage.setItem(fresh.id, fresh);
            window.dispatchEvent(new CustomEvent('miravoz:bundles-changed', { detail: { ids: [fresh.id], removed: [] } }));
            showInfoToast('Este tablero se actualizó desde la cuenta de la profesional.', 7000);
            return false;
        }
        const now = await localforage.getItem(current.id);
        if (now) {
            now.copyUpdatedAt = data.copy_updated_at;
            if (now.updatedAt === current.updatedAt) now.dirty = false; // si no se editó mientras subía
            await localforage.setItem(now.id, now);
        }
        copy.copyUpdatedAt = data.copy_updated_at; // referencia en memoria (S.currentBundle)
        if (copy.updatedAt === current.updatedAt) copy.dirty = false;
        return true;
    } catch (e) {
        console.warn('pushCopy: quedó pendiente', copy.id, e?.message || e);
        return false;
    }
}

// --- La profesional edita la copia de un usuario desde su cuenta (F4-3) ---
// Guarda con UPDATE directo (su RLS lo permite) y concurrencia optimista sobre copy_updated_at.
async function pushCopyAsProfessional(copy, current) {
    try {
        const stamp = new Date().toISOString(); // precisión de ms, igual que la RPC de la tablet
        const { data, error } = await supabaseClient.from('assignments')
            .update({ copy_bundle: copyToServer(current), copy_updated_at: stamp })
            .eq('id', current.assignmentId).eq('copy_updated_at', current.copyUpdatedAt)
            .select('copy_updated_at');
        if (error) throw error;
        if (!data || data.length === 0) {
            // La tablet la modificó mientras tanto: gana la versión de la tablet, lo de acá va a respaldo
            const { data: row, error: e2 } = await supabaseClient.from('assignments')
                .select('id, copy_bundle, permission, copy_updated_at').eq('id', current.assignmentId).maybeSingle();
            if (e2 || !row) throw e2 || new Error('La copia ya no existe');
            await backupBundle(current.id, current, 'conflicto: la tablet modificó la copia');
            const fresh = { ...copyFromRow(row), profEdit: true, ownerLabel: current.ownerLabel };
            await localforage.setItem(fresh.id, fresh);
            window.dispatchEvent(new CustomEvent('miravoz:bundles-changed', { detail: { ids: [fresh.id], removed: [] } }));
            showInfoToast('La copia se había modificado en la tablet del usuario: se cargó esa versión (la tuya quedó respaldada).', 8000);
            return false;
        }
        const newStamp = data[0].copy_updated_at;
        const now = await localforage.getItem(current.id);
        if (now) {
            now.copyUpdatedAt = newStamp;
            if (now.updatedAt === current.updatedAt) now.dirty = false;
            await localforage.setItem(now.id, now);
        }
        copy.copyUpdatedAt = newStamp;
        if (copy.updatedAt === current.updatedAt) copy.dirty = false;
        return true;
    } catch (e) {
        console.warn('pushCopyAsProfessional: quedó pendiente', copy.id, e?.message || e);
        return false;
    }
}

/** Trae la copia asignada para editarla como profesional. */
export async function loadCopyForProfessional(assignmentId) {
    if (!supabaseClient) return null;
    const { data: row, error } = await supabaseClient.from('assignments')
        .select('id, copy_bundle, permission, copy_updated_at, aac_users(display_name)')
        .eq('id', assignmentId).maybeSingle();
    if (error || !row) { console.error('loadCopyForProfessional:', error); return null; }
    const local = await localforage.getItem(copyKey(assignmentId));
    // Si había cambios sin subir sobre ESTA misma versión del servidor, se conservan
    const keepLocal = local && local.dirty && local.copyUpdatedAt === row.copy_updated_at;
    if (local && local.dirty && !keepLocal) await backupBundle(local.id, local, 'conflicto al reabrir la copia');
    const base = keepLocal ? local : copyFromRow(row);
    const copy = { ...base, profEdit: true, ownerLabel: row.aac_users?.display_name || 'este usuario' };
    await localforage.setItem(copy.id, copy);
    if (copy.dirty) enqueuePush(copy);
    return copy;
}

/** Profesional: reintentar copias pendientes (al iniciar sesión / volver la conexión). */
export async function flushProfessionalCopies() {
    for (const c of await listCopies()) if (c.profEdit && c.dirty) await enqueuePush(c);
}

/** Profesional: al cerrar sesión, subir lo pendiente y no dejar copias de chicos en el navegador. */
export async function clearProfessionalCopies() {
    await flushProfessionalCopies();
    for (const c of await listCopies()) {
        if (!c.profEdit) continue;
        if (c.dirty) continue; // no se pudo subir: no borrar (regla: ningún dato se pierde)
        await localforage.removeItem(c.id);
    }
}

setCopySaver((bundle) => (bundle.assignmentId ? saveCopy(bundle) : null));

// Reintentos automáticos (tablet que queda abierta todo el día)
async function backgroundPull() {
    const res = await pullCopies();
    if (res === 'unlinked') window.dispatchEvent(new CustomEvent('miravoz:device-unlinked'));
}
window.addEventListener('online', () => { if (device) backgroundPull(); else flushProfessionalCopies(); });
document.addEventListener('visibilitychange', () => {
    if (device && document.visibilityState === 'visible' && Date.now() - lastPull > 30000) backgroundPull();
});

// --- UI de vinculación (pantalla de ingreso) ---
export function wireLinkForm({ onLinked }) {
    const stepEmail = document.getElementById('auth-step-email');
    const stepLink = document.getElementById('auth-step-link');
    const input = document.getElementById('link-code-input');
    const btn = document.getElementById('btn-link-device');
    const err = document.getElementById('link-error');
    document.getElementById('btn-show-link')?.addEventListener('click', () => {
        stepEmail.style.display = 'none';
        stepLink.style.display = 'block';
        err.textContent = '';
        input.focus();
    });
    document.getElementById('btn-link-back')?.addEventListener('click', () => {
        stepLink.style.display = 'none';
        stepEmail.style.display = 'block';
    });
    input?.addEventListener('input', () => {
        // Mayúsculas y guion automático: ABCD-EFGH
        const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        input.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
    });
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } });
    if (btn) btn.onclick = async () => {
        const code = input.value.replace(/[^A-Za-z0-9]/g, '');
        if (code.length !== 8) { err.textContent = 'El código tiene 8 caracteres (por ejemplo ABCD-EFGH).'; return; }
        btn.disabled = true; btn.textContent = 'Vinculando…'; err.textContent = '';
        const res = await linkWithCode(code);
        btn.disabled = false; btn.textContent = 'Vincular';
        if (!res.ok) { err.textContent = res.error; return; }
        input.value = '';
        onLinked(device);
    };
}

// --- Salida para adultos: mantener apretada la esquina 3 segundos ---
export function wireAdultExit({ onUnlinked }) {
    let corner = document.getElementById('device-corner');
    if (!corner) {
        corner = document.createElement('div');
        corner.id = 'device-corner';
        corner.setAttribute('aria-hidden', 'true');
        document.body.appendChild(corner);
    }
    let timer = null;
    const start = (e) => {
        e.stopPropagation();
        e.preventDefault();
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const ok = await customConfirm(`Opciones de la tablet de ${device?.displayName || 'este usuario'}: ¿querés desvincularla? Los tableros dejan de estar en este dispositivo (siguen en la cuenta de la profesional).`);
            if (!ok) return;
            const left = await flushCopies();
            const warn = left ? `\nOJO: ${left} tablero(s) tienen cambios que no se pudieron subir y se van a perder.` : '';
            const typed = typeof window.prompt === 'function' ? window.prompt('Para confirmar, escribí DESVINCULAR' + warn) : null;
            if ((typed || '').trim().toUpperCase() !== 'DESVINCULAR') { customAlert('No se desvinculó.'); return; }
            await unlink();
            onUnlinked();
        }, 3000);
    };
    const cancel = () => clearTimeout(timer);
    corner.addEventListener('pointerdown', start);
    corner.addEventListener('pointerup', cancel);
    corner.addEventListener('pointerleave', cancel);
    corner.addEventListener('pointercancel', cancel);
    corner.addEventListener('contextmenu', (e) => e.preventDefault());
}
