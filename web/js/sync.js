// sync.js — Persistencia de tableros: local primero, nube cuando hay sesión (SPEC F4-5)
// Reglas (ver EQUIPO.md):
//  - TODO guardado de un bundle pasa por saveBundle() y todo borrado por removeBundle().
//  - Nunca se borra ni se pisa nada local sin dejar backup (miravoz_conflict_backup_<id>, últimos 3).
//  - Un tablero local "de nadie" (sin ownerId) no se sube sin que la persona acepte.
//  - Las operaciones de nube de un mismo bundle se serializan (cola por id).
// Cuando un bundle cambia en disco por la sync, se emite 'miravoz:bundles-changed' {ids, removed}.

import { S } from './state.js';
import { supabaseClient, getProfessional as getUser } from './auth.js'; // nunca sincronizar con la sesión anónima de una tablet
import { showSyncToast, hideSyncToast, showInfoToast, customConfirm } from './ui.js';
import { planSync, pushDecision, bundleTime, isVisibleTo, normTombstone, sameContent } from './sync-plan.js';

export { isVisibleTo };

const TOMBSTONES_KEY = 'miravoz_sync_tombstones';
const ADOPT_DECLINED_KEY = 'miravoz_adopt_declined';
const BACKUP_PREFIX = 'miravoz_conflict_backup_';

// --- Cola por id: las operaciones de nube de un bundle nunca se cruzan ---
const queues = new Map();
function enqueue(id, fn) {
    const prev = queues.get(id) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    queues.set(id, next);
    next.finally(() => { if (queues.get(id) === next) queues.delete(id); });
    return next;
}

// --- Helpers locales ---
async function getTombstones() {
    return ((await localforage.getItem(TOMBSTONES_KEY)) || []).map(normTombstone);
}
async function setTombstones(list) {
    const byId = new Map(list.map(t => [t.id, t]));
    await localforage.setItem(TOMBSTONES_KEY, [...byId.values()]);
}
async function dropTombstone(id) {
    const t = await getTombstones();
    if (t.some(x => x.id === id)) await setTombstones(t.filter(x => x.id !== id));
}

export async function backupBundle(id, bundle, reason) {
    if (!bundle) return;
    const key = BACKUP_PREFIX + id;
    const prev = (await localforage.getItem(key)) || [];
    prev.push({ savedAt: Date.now(), reason, bundle });
    await localforage.setItem(key, prev.slice(-3));
}

export async function listLocalBundles() {
    const out = [];
    for (const key of await localforage.keys()) {
        if (key.startsWith('miravoz_')) continue;
        const b = await localforage.getItem(key);
        if (b && b.name) out.push(b);
    }
    return out;
}

function notifyChanged(ids, removed = []) {
    if (!ids.length && !removed.length) return;
    window.dispatchEvent(new CustomEvent('miravoz:bundles-changed', { detail: { ids, removed } }));
}

const isSyncable = b => b && b.type !== 'test';

// --- Guardar (local siempre; nube en background si hay sesión) ---
/**
 * @param {Object} bundle
 * @param {{isNew?: boolean}} opts  isNew: tablero creado/importado/duplicado AHORA.
 *        Si hay sesión, nace en la cuenta. Editar un tablero local "de nadie" no lo sube.
 */
// Copias asignadas en una tablet vinculada (F4-4): las guarda device.js por otra vía
let copySaver = null;
export function setCopySaver(fn) { copySaver = fn; }

export async function saveBundle(bundle, { isNew = false } = {}) {
    if (bundle.assignmentId && copySaver) return copySaver(bundle);
    bundle.updatedAt = Date.now();
    if (isNew && S.currentUser && !bundle.ownerId && isSyncable(bundle)) bundle.ownerId = S.currentUser.id;
    await localforage.setItem(bundle.id, bundle);
    await dropTombstone(bundle.id); // p. ej. "deshacer" de un borrado
    if (bundle.ownerId) pushBundle(bundle); // fire-and-forget: si falla queda "dirty" y se reintenta
}

/**
 * Sube un bundle comparando antes con la versión de la nube (nunca pisa a ciegas).
 * @returns {Promise<boolean>} true si la nube quedó con esta versión.
 */
export function pushBundle(bundle, { adopt = false } = {}) {
    return enqueue(bundle.id, () => doPush(bundle, adopt));
}

async function doPush(bundle, adopt, attempt = 0) {
    if (!supabaseClient || !isSyncable(bundle)) return false;
    const user = await getUser();
    if (!user) return false;

    // El DISCO es la fuente de verdad (saveBundle siempre escribe antes de encolar el push);
    // la referencia en memoria puede ser vieja si una sync ya reemplazó el bundle.
    const disk = await localforage.getItem(bundle.id);
    if (!disk && !adopt) return false; // se borró mientras esperaba en la cola
    const cur = disk || bundle;
    if (cur.ownerId && cur.ownerId !== user.id) return false; // nunca lo de otra cuenta
    if (!cur.ownerId && !adopt) return false;                  // local de nadie: no sin permiso

    try {
        const { data: row, error: readErr } = await supabaseClient
            .from('boards').select('bundle, updated_at').eq('id', cur.id).maybeSingle();
        if (readErr) throw readErr;

        const decision = pushDecision(cur, row);
        if (decision === 'conflict-cloud-wins') {
            // Otro dispositivo guardó algo más nuevo: respaldar lo local (releído) y bajar la nube
            const latest = (await localforage.getItem(cur.id)) || cur;
            await backupBundle(cur.id, latest, 'conflicto: ganó otro dispositivo');
            const cu = bundleTime(row.bundle) || Date.parse(row.updated_at) || Date.now();
            const fresh = { ...row.bundle, id: cur.id, ownerId: user.id, updatedAt: cu, syncedAt: cu };
            await localforage.setItem(cur.id, fresh);
            notifyChanged([cur.id]);
            showInfoToast(`"${fresh.name}" se actualizó desde otro dispositivo. Tu versión quedó respaldada.`, 9000);
            return false;
        }
        if (decision === 'conflict-local-wins') {
            await backupBundle(cur.id, row.bundle, 'conflicto: ganó este dispositivo');
        }

        const stamp = bundleTime(cur) || Date.now();
        const record = {
            owner_professional_id: user.id,
            name: cur.name || 'Sin título',
            bundle: { ...cur, ownerId: user.id, syncedAt: stamp },
            updated_at: new Date(stamp).toISOString()
        };

        // Concurrencia optimista: solo escribir si la fila sigue como la leímos.
        // Si otro dispositivo escribió en el medio, se vuelve a leer y decidir (máx. 3 intentos).
        let lost = false;
        if (row) {
            const { data, error } = await supabaseClient.from('boards').update(record)
                .eq('id', cur.id).eq('updated_at', row.updated_at).select('id');
            if (error) throw error;
            lost = !data || data.length === 0;
        } else {
            const { error } = await supabaseClient.from('boards').insert({ id: cur.id, ...record });
            if (error && error.code === '23505') lost = true; // alguien la creó en el medio
            else if (error) throw error;
        }
        if (lost) {
            if (attempt < 2) return doPush(bundle, adopt, attempt + 1);
            throw new Error('la fila cambió en la nube durante el guardado (se reintenta en la próxima sync)');
        }

        // Marcar sincronizado: en disco y en la referencia en memoria (S.currentBundle)
        const now = (await localforage.getItem(cur.id)) || (adopt ? { ...cur } : null);
        if (now) {
            now.ownerId = user.id;
            now.syncedAt = stamp;
            await localforage.setItem(cur.id, now);
        }
        if (bundle.id === cur.id) { bundle.ownerId = user.id; bundle.syncedAt = stamp; }
        return true;
    } catch (e) {
        reportCloudError(e);
        console.warn('pushBundle: quedó pendiente de subir', bundle.id, e?.message || e);
        return false;
    }
}

// Errores que no son de red (permisos/RLS, tipo de columna, tabla inexistente) no se arreglan
// reintentando: avisar UNA vez por sesión para que no queden "pendientes" en silencio.
let cloudErrorShown = false;
function reportCloudError(e) {
    const code = e && e.code;
    const isServerSide = code && (/^(42|22|23)/.test(code) || code.startsWith('PGRST'));
    if (!isServerSide || cloudErrorShown) return;
    cloudErrorShown = true;
    console.error('Error de la nube (no es de red):', e);
    showInfoToast('No se pudo guardar en la nube (error del servidor). Tus tableros siguen guardados en este dispositivo.', 9000);
}

// --- Borrar ---
export async function removeBundle(bundle) {
    // Leer el disco: tiene el ownerId/syncedAt vigentes (el objeto de la tarjeta puede ser viejo)
    const disk = (await localforage.getItem(bundle.id)) || bundle;
    await localforage.removeItem(bundle.id);
    if (!disk.ownerId || !isSyncable(disk)) return; // nunca estuvo en la nube
    const tomb = { id: disk.id, syncedAt: disk.syncedAt ?? null, userId: disk.ownerId };
    await setTombstones([...(await getTombstones()), tomb]); // por si falla o no hay red
    enqueue(disk.id, async () => {
        if (await localforage.getItem(disk.id)) return; // se deshizo el borrado
        if (await deleteInCloud(disk.id, disk.ownerId)) await dropTombstone(disk.id);
    });
}

async function deleteInCloud(id, ownerId) {
    if (!supabaseClient) return false;
    const user = await getUser();
    if (!user || (ownerId && ownerId !== user.id)) return false;
    try {
        const { error } = await supabaseClient.from('boards').delete()
            .eq('id', id).eq('owner_professional_id', user.id);
        if (error) throw error;
        return true;
    } catch (e) {
        console.warn('deleteInCloud: quedó pendiente', id, e?.message || e);
        return false;
    }
}

// --- Sync completo ---
let syncing = false;
let lastSync = 0;

export async function syncAll({ quiet = false } = {}) {
    const plan = await runSync(quiet);
    // La pregunta de adopción va FUERA del candado de sync y nunca interrumpe al usuario
    // usando un tablero (syncs silenciosas por online/visibilitychange no preguntan).
    if (plan && !quiet && S.state === 'HOME') await askAdoption(plan.adopt);
    return plan;
}

async function runSync(quiet) {
    if (syncing || !supabaseClient) return null;
    const user = await getUser();
    if (!user) return null;
    syncing = true;
    lastSync = Date.now();
    if (!quiet) showSyncToast('Sincronizando tableros...');
    const changed = [], removed = [];
    try {
        const { data: rows, error } = await supabaseClient
            .from('boards').select('id, bundle, updated_at').eq('owner_professional_id', user.id);
        if (error) throw error;

        const local = await listLocalBundles();
        const localTime = new Map(local.map(b => [b.id, bundleTime(b)]));
        const plan = planSync(local, rows || [], user.id, await getTombstones());
        if (plan.suspicious) console.warn('syncAll: la nube devolvió 0 tableros teniendo tableros sincronizados; no se borra nada local.');

        // 1. Backups de conflicto ANTES de pisar nada
        for (const c of plan.conflicts) if (c.lost) await backupBundle(c.id, c.lost, `sync: ganó ${c.kept}`);

        // 2. Bajar (salvo que se haya editado localmente mientras corría la sync)
        const updatedNames = [];
        for (const b of plan.saveLocal) {
            const cur = await localforage.getItem(b.id);
            if (cur && bundleTime(cur) !== (localTime.get(b.id) || 0)) continue; // editado recién: lo resuelve el próximo sync
            if (!cur || !sameContent(cur, b)) updatedNames.push(b.name || 'Sin título');
            await localforage.setItem(b.id, b);
            changed.push(b.id);
        }
        // 1.7.0: cambios hechos desde otro lado (otro dispositivo o Claude) mientras MiraVoz estaba abierto
        if (quiet && updatedNames.length && !plan.conflicts.some(c => !c.silent)) {
            showInfoToast(updatedNames.length === 1 ? `Se actualizó «${updatedNames[0]}»` : `Se actualizaron ${updatedNames.length} tableros`, 4000);
        }

        // 3. Borrados que vinieron de otro dispositivo (con backup)
        for (const id of plan.removeLocal) {
            const cur = await localforage.getItem(id);
            if (!cur || bundleTime(cur) !== (localTime.get(id) || 0)) continue;
            await backupBundle(id, cur, 'borrado desde otro dispositivo');
            await localforage.removeItem(id);
            removed.push(id);
        }

        // 4. Borrados pendientes de este dispositivo
        const pending = await getTombstones();
        const done = new Set(plan.dropTombstones);
        for (const id of plan.deleteCloud) if (await deleteInCloud(id)) done.add(id);
        await setTombstones(pending.filter(t => !done.has(t.id)));

        // 5. Subir
        for (const b of plan.upload) await pushBundle(b);

        if (!quiet) hideSyncToast();

        const visible = plan.conflicts.filter(c => !c.silent);
        if (visible.length) {
            const names = visible.map(c => `"${c.name || c.id}"`).join(', ');
            showInfoToast(`Se actualizó desde otro dispositivo: ${names}. Si había cambios acá, quedaron respaldados.`, 9000);
        }
        return plan;
    } catch (e) {
        console.error('syncAll falló (se reintenta luego):', e);
        if (!quiet) hideSyncToast();
        return null;
    } finally {
        syncing = false;
        notifyChanged(changed, removed);
    }
}

async function askAdoption(candidates) {
    const declined = new Set((await localforage.getItem(ADOPT_DECLINED_KEY)) || []);
    const toAsk = (candidates || []).filter(b => isSyncable(b) && !declined.has(b.id));
    if (!toAsk.length) return;
    const names = toAsk.slice(0, 3).map(b => `"${b.name}"`).join(', ') + (toAsk.length > 3 ? '…' : '');
    const ok = await customConfirm(
        `Hay ${toAsk.length} tablero(s) en este dispositivo que no están en ninguna cuenta (${names}). ` +
        `¿Querés guardarlos en tu cuenta? Así quedan en la nube y los podés asignar.`);
    if (ok) {
        const adopted = [];
        for (const b of toAsk) if (await pushBundle(b, { adopt: true })) adopted.push(b.id);
        notifyChanged(adopted);
    } else {
        toAsk.forEach(b => declined.add(b.id));
        await localforage.setItem(ADOPT_DECLINED_KEY, [...declined]);
    }
}

// --- 1.7.0: cambios en la nube en (casi) tiempo real ---
// Mientras la cuenta registrada tiene MiraVoz abierto, cada pocos segundos se consulta SOLO id y fecha de sus
// tableros (liviano). Si algo cambió (por ejemplo, Claude editó un tablero), se hace la sincronización completa.
let watchTimer = null;
let lastSig = null; // { id: updated_at } de la consulta anterior
/** ¿Cambió algo en la nube desde la consulta anterior? (la primera vez solo toma la referencia) */
export async function cloudHasChanges() {
    if (!supabaseClient || syncing) return false;
    const user = await getUser();
    if (!user) return false;
    const { data: rows, error } = await supabaseClient.from('boards').select('id, updated_at').eq('owner_professional_id', user.id);
    if (error || !rows) return false;
    const sig = Object.fromEntries(rows.map(r => [r.id, r.updated_at]));
    const prev = lastSig;
    lastSig = sig;
    if (!prev) return false;
    const ids = new Set([...Object.keys(prev), ...Object.keys(sig)]);
    for (const id of ids) if (prev[id] !== sig[id]) return true;
    return false;
}
export function startCloudWatch({ intervalMs = 8000, isActive = () => true } = {}) {
    if (watchTimer) return;
    watchTimer = setInterval(async () => {
        if (document.visibilityState !== 'visible' || !isActive() || syncing) return;
        try { if (await cloudHasChanges()) await syncAll({ quiet: true }); } catch { /* sin red: se reintenta */ }
    }, intervalMs);
}

// Reintentar al recuperar la conexión y al volver a la app (tablet que queda abierta)
window.addEventListener('online', () => { syncAll({ quiet: true }); });
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastSync > 30000) syncAll({ quiet: true });
});
