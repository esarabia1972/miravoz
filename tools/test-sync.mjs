// Tests de la lógica pura de sincronización (web/js/sync-plan.js)
// Correr: node tools/test-sync.mjs
import { planSync, bundleTime, isVisibleTo, pushDecision } from '../web/js/sync-plan.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ✓', name); }
    catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message); }
}
function eq(a, b, msg = '') {
    const A = JSON.stringify(a), B = JSON.stringify(b);
    if (A !== B) throw new Error(`${msg} esperado ${B}, obtenido ${A}`);
}
const U = 'user-1';
const ids = arr => arr.map(x => (typeof x === 'string' ? x : x.id)).sort();
const row = (b, updated_at = null) => ({ id: b.id, bundle: b, updated_at });

console.log('sync-plan');

t('local sin dueño NO se sube solo: queda para preguntar (adopt)', () => {
    const p = planSync([{ id: 'a', name: 'A', updatedAt: 10 }], [], U);
    eq(ids(p.adopt), ['a']); eq(p.upload, []); eq(p.removeLocal, []);
});

t('local de OTRA cuenta no se toca', () => {
    const p = planSync([{ id: 'a', name: 'A', ownerId: 'otro', updatedAt: 10 }], [], U);
    eq(p.upload, []); eq(p.removeLocal, []); eq(p.saveLocal, []);
});

t('solo en la nube → se baja con ownerId y syncedAt', () => {
    const p = planSync([], [row({ id: 'c', name: 'C', updatedAt: 50 })], U);
    eq(ids(p.saveLocal), ['c']);
    eq([p.saveLocal[0].ownerId, p.saveLocal[0].syncedAt, p.saveLocal[0].updatedAt], [U, 50, 50]);
});

t('solo en la nube pero borrado acá (tombstone) → se borra en la nube, no se baja', () => {
    const p = planSync([], [row({ id: 'c', name: 'C', updatedAt: 50 })], U, ['c']);
    eq(p.saveLocal, []); eq(p.deleteCloud, ['c']);
});

t('editado localmente (dirty) y nube igual → se sube', () => {
    const L = { id: 'a', name: 'A editado', ownerId: U, updatedAt: 200, syncedAt: 100 };
    const C = { id: 'a', name: 'A', updatedAt: 100 };
    const p = planSync([L], [row(C)], U);
    eq(ids(p.upload), ['a']); eq(p.saveLocal, []); eq(p.conflicts, []);
});

t('cambiado en otro dispositivo y local limpio → se baja', () => {
    const L = { id: 'a', name: 'A', ownerId: U, updatedAt: 100, syncedAt: 100 };
    const C = { id: 'a', name: 'A2', updatedAt: 300 };
    const p = planSync([L], [row(C)], U);
    eq(ids(p.saveLocal), ['a']); eq(p.saveLocal[0].name, 'A2'); eq(p.upload, []);
});

t('ambos iguales → no hace nada', () => {
    const L = { id: 'a', name: 'A', ownerId: U, updatedAt: 100, syncedAt: 100 };
    const p = planSync([L], [row({ ...L })], U);
    eq([p.upload.length, p.saveLocal.length, p.conflicts.length], [0, 0, 0]);
});

t('conflicto, gana local más nuevo → sube y respalda la nube', () => {
    const L = { id: 'a', name: 'A', ownerId: U, updatedAt: 500, syncedAt: 100 };
    const C = { id: 'a', name: 'Anube', updatedAt: 300 };
    const p = planSync([L], [row(C)], U);
    eq(ids(p.upload), ['a']); eq(p.conflicts.length, 1);
    eq([p.conflicts[0].kept, p.conflicts[0].lost.name], ['local', 'Anube']);
});

t('conflicto, gana nube más nueva → baja y respalda lo local', () => {
    const L = { id: 'a', name: 'Alocal', ownerId: U, updatedAt: 300, syncedAt: 100 };
    const C = { id: 'a', name: 'A', updatedAt: 500 };
    const p = planSync([L], [row(C)], U);
    eq(ids(p.saveLocal), ['a']); eq(p.upload, []);
    eq([p.conflicts[0].kept, p.conflicts[0].lost.name], ['cloud', 'Alocal']);
});

t('borrado en otro dispositivo, local limpio → se borra local', () => {
    const L = { id: 'a', name: 'A', ownerId: U, updatedAt: 100, syncedAt: 100 };
    const otro = { id: 'b', name: 'B', updatedAt: 100 };
    const p = planSync([L], [row(otro)], U);
    eq(p.removeLocal, ['a']); eq(p.upload, []);
});

t('borrado en otro dispositivo pero editado acá → gana la edición (se resube)', () => {
    const L = { id: 'a', name: 'A', ownerId: U, updatedAt: 200, syncedAt: 100 };
    const p = planSync([L], [], U);
    eq(ids(p.upload), ['a']); eq(p.removeLocal, []);
});

t('bundles viejos sin updatedAt usan lastUpdateTime de los grids', () => {
    eq(bundleTime({ boards: { g1: { lastUpdateTime: 5 }, g2: { lastUpdateTime: 9 } } }), 9);
    eq(bundleTime({ updatedAt: 3, boards: { g: { lastUpdateTime: 9 } } }), 3);
    eq(bundleTime(null), 0);
});

t('migración: bundle legado idéntico en ambos lados → solo se marca sincronizado', () => {
    const b = { id: 'a', name: 'A', boards: { g: { lastUpdateTime: 7 } } };
    const p = planSync([b], [row({ ...b }, '2026-07-05T00:00:00Z')], U);
    eq([p.upload.length, p.saveLocal.length, p.conflicts.length, p.removeLocal.length], [0, 1, 0, 0]);
    eq([p.saveLocal[0].ownerId, p.saveLocal[0].syncedAt > 0], [U, true]);
});

t('migración: bundle legado distinto → gana el más nuevo, backup silencioso', () => {
    const L = { id: 'a', name: 'A', boards: { g: { lastUpdateTime: 900 } } };
    const C = { id: 'a', name: 'A', boards: { g: { lastUpdateTime: 100 } } };
    const p = planSync([L], [row(C)], U);
    eq(ids(p.upload), ['a']); eq([p.conflicts.length, p.conflicts[0].silent], [1, true]);
});

t('después de sincronizar, volver a sincronizar no hace nada (idempotencia)', () => {
    const C = { id: 'a', name: 'A', updatedAt: 100 };
    const p1 = planSync([], [row(C)], U);
    const synced = p1.saveLocal[0];
    const p2 = planSync([synced], [row({ ...synced })], U);
    eq([p2.upload.length, p2.saveLocal.length, p2.conflicts.length, p2.removeLocal.length], [0, 0, 0, 0]);
});

t('la copia bajada conserva el id de la fila aunque el bundle no lo traiga', () => {
    const p = planSync([], [{ id: 'x', bundle: { name: 'X', updatedAt: 1 }, updated_at: null }], U);
    eq(p.saveLocal[0].id, 'x');
});

t('isVisibleTo: sin dueño visible siempre; con dueño solo para esa cuenta', () => {
    eq(isVisibleTo({ id: 'a' }, null), true);
    eq(isVisibleTo({ id: 'a', ownerId: U }, null), false);
    eq(isVisibleTo({ id: 'a', ownerId: U }, U), true);
    eq(isVisibleTo({ id: 'a', ownerId: U }, 'otro'), false);
});

t('nube vacía con tableros ya sincronizados → sospechoso, no se borra nada local', () => {
    const L = { id: 'a', name: 'A', ownerId: U, updatedAt: 100, syncedAt: 100 };
    const p = planSync([L], [], U);
    eq([p.suspicious, p.removeLocal.length], [true, 0]);
});

t('mismo contenido con metadatos distintos → no es conflicto', () => {
    const L = { id: 'a', name: 'A', ownerId: U, updatedAt: 300, syncedAt: 100 };
    const C = { id: 'a', name: 'A', updatedAt: 250 };
    const p = planSync([L], [row(C)], U);
    eq([p.conflicts.length, p.upload.length], [0, 0]);
});

t('tombstone y la nube NO cambió después → borrar en la nube', () => {
    const C = { id: 'x', name: 'X', updatedAt: 100 };
    const p = planSync([], [row(C)], U, [{ id: 'x', syncedAt: 100, userId: U }]);
    eq(p.deleteCloud, ['x']); eq(p.saveLocal, []);
});

t('tombstone pero otro dispositivo lo editó después → se recupera, no se borra', () => {
    const C = { id: 'x', name: 'X', updatedAt: 200 };
    const p = planSync([], [row(C)], U, [{ id: 'x', syncedAt: 100, userId: U }]);
    eq(p.deleteCloud, []); eq(ids(p.saveLocal), ['x']); eq(p.dropTombstones, ['x']);
    eq(p.conflicts[0].revived, true);
});

t('tombstone de OTRA cuenta → se ignora y se conserva', () => {
    const C = { id: 'x', name: 'X', updatedAt: 100 };
    const p = planSync([], [row(C)], U, [{ id: 'x', syncedAt: 100, userId: 'otra' }]);
    eq(p.deleteCloud, []); eq(p.dropTombstones, []); eq(ids(p.saveLocal), ['x']);
});

t('tombstone de un tablero que ya no está en la nube → se descarta', () => {
    const p = planSync([], [], U, [{ id: 'x', syncedAt: 100, userId: U }]);
    eq(p.dropTombstones, ['x']); eq(p.deleteCloud, []);
});

t('pushDecision: nube sin cambios desde la última sync → upload', () => {
    eq(pushDecision({ name: 'A2', updatedAt: 300, syncedAt: 200 }, { bundle: { name: 'A', updatedAt: 200 } }), 'upload');
    eq(pushDecision({ name: 'A', updatedAt: 300 }, null), 'upload');
});

t('pushDecision: otro dispositivo subió algo más viejo que mi edición → gana local', () => {
    eq(pushDecision({ name: 'A2', updatedAt: 500, syncedAt: 100 }, { bundle: { name: 'B', updatedAt: 300 } }), 'conflict-local-wins');
});

t('pushDecision: otro dispositivo subió algo más nuevo → gana nube (no pisar a ciegas)', () => {
    eq(pushDecision({ name: 'A2', updatedAt: 300, syncedAt: 100 }, { bundle: { name: 'B', updatedAt: 500 } }), 'conflict-cloud-wins');
});

t('reloj desfasado: otra tablet (reloj atrasado) editó después → igual se baja', () => {
    // Acá sincronizamos la versión 1000; la otra tablet editó pero su reloj marca 900
    const L = { id: 'a', name: 'A', ownerId: U, updatedAt: 1000, syncedAt: 1000 };
    const C = { id: 'a', name: 'A editado en tablet B', updatedAt: 900 };
    const p = planSync([L], [row(C)], U);
    eq(ids(p.saveLocal), ['a']); eq(p.saveLocal[0].name, 'A editado en tablet B');
});

t('pushDecision con reloj desfasado: la nube cambió (aunque con hora menor) → no se pisa a ciegas', () => {
    const d = pushDecision({ name: 'A2', updatedAt: 1200, syncedAt: 1000 }, { bundle: { name: 'B', updatedAt: 900 } });
    eq(d, 'conflict-local-wins'); // hay conflicto detectado (con backup), no un upload ciego
});

t('tombstone de formato viejo (string) → se borra en la nube', () => {
    const C = { id: 'x', name: 'X', updatedAt: 999 };
    const p = planSync([], [row(C)], U, ['x']);
    eq(p.deleteCloud, ['x']);
});

console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
