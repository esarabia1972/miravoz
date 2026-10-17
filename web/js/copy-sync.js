// copy-sync.js — Original de la cuenta ↔ copia de un usuario (0.8.1d)
//
// Cada usuario usa una COPIA del tablero (su tablet puede cambiarla si es "Puede editarse"). Desde el tablero o
// desde "Tableros de <usuario>" la cuenta puede:
//   - ver si la copia es igual a su versión o cuál de las dos cambió;
//   - "Enviar mi versión": la copia pasa a ser igual al original;
//   - "Traer sus cambios": el original pasa a ser igual a la copia.
// Antes de pisar cualquiera de los dos se guarda una versión de respaldo (se puede restaurar).

import { supabaseClient } from './auth.js';
import { saveBundle } from './sync.js';

import { compareCopy, contentKey, STATUS_TEXT } from './copy-compare.js';
export { compareCopy, contentKey, STATUS_TEXT };

async function backup(boardId, bundle, note) {
    // Misma vía que Claude (09_guardar_version_rpc.sql): la función verifica en el servidor que el tablero o la
    // copia ('copia:<id>') sea de la cuenta. El INSERT directo en board_versions lo rechaza la política con las copias.
    const { error } = await supabaseClient.rpc('save_board_version', { p_board_id: boardId, p_bundle: bundle, p_note: note });
    if (error) {
        console.error('save_board_version:', error);
        throw new Error('No se pudo guardar la versión de respaldo, así que no se cambió nada. Revisá la conexión e intentá de nuevo.');
    }
}

/** La copia del usuario pasa a ser igual al original (con respaldo de la copia anterior). */
export async function sendOriginalToCopy(asg, original) {
    if (asg.copy_bundle) await backup(`copia:${asg.id}`, asg.copy_bundle, 'antes de recibir la versión del original');
    const clone = JSON.parse(JSON.stringify(original));
    delete clone.ownerId; delete clone.syncedAt;
    const now = new Date().toISOString();
    const { error } = await supabaseClient.from('assignments').update({ copy_bundle: clone, copy_updated_at: now }).eq('id', asg.id);
    if (error) throw error;
    asg.copy_bundle = clone; asg.copy_updated_at = now;
    return asg;
}

/** El original pasa a ser igual a la copia (conserva su id, nombre, etiquetas y dueño; con respaldo). */
export async function pullCopyToOriginal(asg, original) {
    await backup(original.id, original, 'antes de traer los cambios de una copia');
    const next = JSON.parse(JSON.stringify(asg.copy_bundle));
    for (const k of ['assignmentId', 'permission', 'copyUpdatedAt', 'dirty', 'bundleId', 'profEdit', 'ownerLabel', 'copiadoDe']) delete next[k];
    next.id = original.id;
    next.name = original.name;
    if (original.tags) next.tags = original.tags;
    if (original.ownerId) next.ownerId = original.ownerId;
    if (original.syncedAt) next.syncedAt = original.syncedAt;
    await saveBundle(next);
    return next;
}
