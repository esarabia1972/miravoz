// sync-plan.js — Lógica PURA de sincronización local↔nube (SPEC F4-5)
// Sin DOM, sin Supabase, sin localforage: testeable con Node (tools/test-sync.mjs).
//
// Modelo: last-write-wins por bundle, con detección de conflicto y backup del perdedor.
//   bundle.updatedAt : epoch ms de la última edición local (lo setea saveBundle)
//   bundle.syncedAt  : updatedAt que tenía el bundle la última vez que se subió/bajó OK
//   bundle.ownerId   : id del profesional dueño. Sin ownerId = tablero local "de nadie":
//                      se ve siempre (con o sin cuenta) y NUNCA se sube sin que la persona acepte.
// syncedAt funciona como TOKEN DE VERSIÓN (se compara por igualdad, no por reloj), así un
// reloj desfasado entre tablets no esconde cambios. El reloj solo decide el ganador de un conflicto.
// "dirty" local  = updatedAt !== syncedAt   (hay cambios sin subir)
// "changed" nube = updatedAt(nube) !== syncedAt(local)  (otro dispositivo subió algo)

/** Momento de última modificación de un bundle (con fallback a los grids GRD). */
export function bundleTime(b) {
    if (!b) return 0;
    if (b.updatedAt) return b.updatedAt;
    let t = 0;
    for (const g of Object.values(b.boards || {})) {
        if (g && typeof g.lastUpdateTime === 'number' && g.lastUpdateTime > t) t = g.lastUpdateTime;
    }
    return t;
}

/** ¿Este bundle local es visible para este usuario? (null = modo sin cuenta) */
export function isVisibleTo(bundle, userId) {
    if (!bundle) return false;
    if (!bundle.ownerId) return true;             // local sin dueño: visible siempre
    return !!userId && bundle.ownerId === userId; // de una cuenta: solo con esa cuenta
}

const META = new Set(['ownerId', 'syncedAt', 'updatedAt']);
/** Mismo contenido ignorando metadatos de sync. */
export function sameContent(a, b) {
    const strip = o => JSON.stringify(o, (k, v) => (META.has(k) ? undefined : v));
    return strip(a) === strip(b);
}

/** Normaliza tombstones (formato viejo: string id). */
export function normTombstone(t) {
    // Formato viejo (string) o syncedAt desconocido → null = "borrar siempre"
    return typeof t === 'string' ? { id: t, syncedAt: null, userId: null } : t;
}

/**
 * Calcula qué hacer en una sincronización completa.
 * @param {Object[]} localBundles  bundles de localforage (sin claves miravoz_*)
 * @param {Object[]} cloudRows     filas de la tabla boards: { id, bundle, updated_at }
 * @param {string}   userId        profesional logueado
 * @param {Object[]} tombstones    borrados pendientes: { id, syncedAt, userId }
 */
export function planSync(localBundles, cloudRows, userId, tombstones = []) {
    const plan = {
        saveLocal: [],     // bundles a escribir en local (bajados de la nube)
        upload: [],        // bundles a subir
        adopt: [],         // bundles locales sin dueño: subir SOLO si la persona acepta
        removeLocal: [],   // ids a borrar en local (borrados desde otro dispositivo) — con backup
        deleteCloud: [],   // ids a borrar en la nube (tombstones vigentes)
        dropTombstones: [],// tombstones resueltos/obsoletos
        conflicts: [],     // { id, name, kept: 'local'|'cloud', lost, silent? }
        suspicious: false  // la nube vino vacía teniendo tableros ya sincronizados: no borrar nada
    };
    const local = new Map(localBundles.filter(Boolean).map(b => [b.id, b]));
    const cloud = new Map(cloudRows.filter(r => r && r.bundle).map(r => [r.id, r]));
    const cloudTime = row => bundleTime(row.bundle) || Date.parse(row.updated_at) || 0;

    // --- Tombstones (solo los de esta cuenta; los viejos sin userId se asumen de esta cuenta)
    const tombIds = new Set();
    for (const raw of tombstones) {
        const t = normTombstone(raw);
        if (t.userId && t.userId !== userId) continue; // de otra cuenta: se conserva para ella
        tombIds.add(t.id);
        const row = cloud.get(t.id);
        if (!row) { plan.dropTombstones.push(t.id); continue; } // ya no existe: listo
        const cu = cloudTime(row);
        if (t.syncedAt != null && cu !== t.syncedAt) {
            // Se borró acá, pero otro dispositivo lo editó después: gana la edición (se recupera)
            plan.saveLocal.push(fromCloud(row.bundle, t.id, userId, cu));
            plan.dropTombstones.push(t.id);
            plan.conflicts.push({ id: t.id, name: row.bundle.name, kept: 'cloud', lost: null, revived: true });
        } else {
            plan.deleteCloud.push(t.id);
        }
    }

    const ownedSynced = [...local.values()].filter(b => b.ownerId === userId && b.syncedAt);
    plan.suspicious = cloud.size === 0 && ownedSynced.length > 0;

    for (const [id, L] of local) {
        if (L.ownerId && L.ownerId !== userId) continue; // de otra cuenta: no tocar
        const row = cloud.get(id);
        const lu = bundleTime(L);
        const ls = L.syncedAt || 0;

        if (!row) {
            if (!L.ownerId) plan.adopt.push(L);              // local de nadie: preguntar
            else if (lu !== ls) plan.upload.push(L);         // borrado en otro lado pero editado acá
            else if (!plan.suspicious) plan.removeLocal.push(id); // borrado desde otro dispositivo
            continue;
        }

        const C = row.bundle;
        const cu = cloudTime(row);

        if (sameContent(L, C)) {
            // Iguales: solo asegurar metadatos de "sincronizado"
            if (L.ownerId !== userId || ls !== cu || lu !== cu) plan.saveLocal.push(fromCloud(C, id, userId, cu));
            continue;
        }

        if (!L.syncedAt) {
            // Migración: bundle de versiones anteriores (sin metadatos) que existe en ESTA cuenta.
            // Gana el más nuevo; backup del otro, sin aviso (no es un conflicto real).
            if (lu > cu) {
                plan.upload.push(L);
                plan.conflicts.push({ id, name: L.name, kept: 'local', lost: C, silent: true });
            } else {
                plan.saveLocal.push(fromCloud(C, id, userId, cu));
                plan.conflicts.push({ id, name: C.name || L.name, kept: 'cloud', lost: L, silent: true });
            }
            continue;
        }

        const localDirty = lu !== ls;
        const cloudChanged = cu !== ls;

        if (localDirty && cloudChanged) {
            if (lu >= cu) {
                plan.upload.push(L);
                plan.conflicts.push({ id, name: L.name, kept: 'local', lost: C });
            } else {
                plan.saveLocal.push(fromCloud(C, id, userId, cu));
                plan.conflicts.push({ id, name: C.name || L.name, kept: 'cloud', lost: L });
            }
        } else if (localDirty) {
            plan.upload.push(L);
        } else if (cloudChanged) {
            plan.saveLocal.push(fromCloud(C, id, userId, cu));
        }
    }

    // Solo en la nube → bajar (salvo borrado pendiente acá)
    for (const [id, row] of cloud) {
        if (local.has(id) || tombIds.has(id)) continue;
        plan.saveLocal.push(fromCloud(row.bundle, id, userId, cloudTime(row)));
    }

    return plan;
}

/**
 * Decide qué hacer al SUBIR un bundle editado, mirando la versión actual de la nube.
 * @returns 'upload' | 'conflict-local-wins' | 'conflict-cloud-wins'
 */
export function pushDecision(local, cloudRow) {
    if (!cloudRow || !cloudRow.bundle) return 'upload';
    const cu = bundleTime(cloudRow.bundle) || Date.parse(cloudRow.updated_at) || 0;
    const ls = local.syncedAt || 0;
    if (cu === ls || sameContent(local, cloudRow.bundle)) return 'upload'; // nadie más la tocó
    return bundleTime(local) >= cu ? 'conflict-local-wins' : 'conflict-cloud-wins';
}

function fromCloud(C, id, userId, cu) {
    return { ...C, id, ownerId: userId, updatedAt: cu, syncedAt: cu };
}
