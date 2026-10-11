// Tests de la etapa 3 del servidor MCP: usuarios, asignaciones, copias y borrar tableros (1.8.0)
import { handle, cleanCopy } from '../web/api/_mcp.js';
import * as E from '../web/api/_edit.js';
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.stack.split('\n').slice(0, 2).join(' ')); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

function fakeDb() {
    const T = { boards: new Map(), aac_users: new Map(), assignments: new Map(), board_versions: [] };
    let clock = 1000, seq = 0;
    const iso = () => new Date(clock++).toISOString();
    const val = (q, k) => { const m = new RegExp(`(?:^|&)${k}=eq\\.([^&]+)`).exec(q); return m ? decodeURIComponent(m[1]) : null; };
    const db = {
        T, calls: [],
        user: async () => ({ id: 'p1' }),
        select: async (table, q) => {
            if (table === 'board_versions') { const b = val(q, 'board_id'), id = Number(val(q, 'id') || 0); return T.board_versions.filter(v => v.board_id === b && (!id || v.id === id)).reverse(); }
            const rows = [...T[table].values()];
            const inm = /id=in\.\(([^)]*)\)/.exec(q);
            return rows.filter(r => (!val(q, 'id') || r.id === val(q, 'id')) && (!val(q, 'board_id') || r.board_id === val(q, 'board_id')) && (!val(q, 'aac_user_id') || r.aac_user_id === val(q, 'aac_user_id'))
                && (!inm || inm[1].split(',').map(decodeURIComponent).includes(r.id))).map(r => JSON.parse(JSON.stringify(r)));
        },
        insert: async (table, row) => {
            if (table === 'board_versions') { if (db.noVersions) throw new Error('x'); T.board_versions.push({ ...row, id: T.board_versions.length + 1, created_at: iso() }); return true; }
            T[table].set(row.id, { ...row, updated_at: row.updated_at || iso() }); return true;
        },
        insertReturning: async (table, rows) => (Array.isArray(rows) ? rows : [rows]).map(r => { const row = { id: `${table}-${++seq}`, copy_updated_at: iso(), ...r }; T[table].set(row.id, row); return { id: row.id, aac_user_id: row.aac_user_id }; }),
        patch: async (table, filter, values) => {
            const id = val(filter, 'id'), row = T[table].get(id);
            if (!row) return [];
            const cu = val(filter, 'copy_updated_at'), ua = val(filter, 'updated_at');
            if (cu && row.copy_updated_at !== cu) return [];
            if (ua && row.updated_at !== ua) return [];
            T[table].set(id, { ...row, ...values }); return [{ id }];
        },
        del: async (table, filter) => { T[table].delete(val(filter, 'id')); return true; },
        rpc: async (fn, body) => {
            if (fn === 'save_board_version') {
                if (db.noVersions) throw Object.assign(new Error('42501 rls'), { status: 403 });
                T.board_versions.push({ board_id: body.p_board_id, bundle: body.p_bundle, note: body.p_note, id: T.board_versions.length + 1, created_at: iso() });
                return T.board_versions.length;
            }
            return fn === 'create_access_code' && T.aac_users.has(body.p_aac_user_id) ? { code: 'ABCD2345', expires_at: 'en 7 días' } : null;
        },
        arasaac: async () => [{ _id: 7, keywords: [{ keyword: 'x' }] }]
    };
    return db;
}
const callWith = (db) => async (name, args) => {
    const r = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { db, user: { id: 'p1' }, base: 'https://www.miravoz.com.ar' });
    const txt = r.result.content[0].text;
    return { err: r.result.isError ? txt : null, data: r.result.isError ? null : JSON.parse(txt) };
};

console.log('MCP etapa 3 (usuarios y asignaciones)');
await t('crear usuario devuelve su código de vinculación', async () => {
    const db = fakeDb(), call = callWith(db);
    const r = await call('crear_usuario', { nombre: 'Mateo' });
    assert(r.data.creado && r.data.codigo_de_vinculacion === 'ABCD-2345' && db.T.aac_users.get(r.data.id).professional_id === 'p1', JSON.stringify(r));
    assert((await call('generar_codigo', { usuario: r.data.id })).data.codigo_de_vinculacion === 'ABCD-2345', 'código nuevo');
    assert((await call('generar_codigo', { usuario: 'otro' })).err, 'usuario ajeno');
});
async function setup() {
    const db = fakeDb(), call = callWith(db);
    const b = (await call('crear_tablero', { nombre: 'Merienda' })).data.id;
    await call('poner_celdas', { tablero: b, celdas: [{ fila: 1, columna: 1, texto: 'Agua' }] });
    const u1 = (await call('crear_usuario', { nombre: 'Mateo' })).data.id;
    const u2 = (await call('crear_usuario', { nombre: 'Sofía' })).data.id;
    return { db, call, b, u1, u2 };
}
await t('asignar: una copia por usuario, sin metadatos de la cuenta, con permiso e inicio', async () => {
    const { db, call, b, u1, u2 } = await setup();
    const r = await call('asignar_tablero', { tablero: b, usuarios: [u1, u2], permiso: 'editable', inicio: true });
    assert(!r.err && r.data.asignaciones.length === 2, JSON.stringify(r));
    const a = db.T.assignments.get(r.data.asignaciones[0].asignacion);
    assert(a.permission === 'editable' && a.board_id === b && !a.copy_bundle.ownerId && !a.copy_bundle.syncedAt, JSON.stringify(a));
    assert(db.T.aac_users.get(u1).home_board_id === a.id, 'inicio');
    assert(/ya tiene una copia/.test((await call('asignar_tablero', { tablero: b, usuarios: [u1] })).err), 'no duplica');
    assert(/no es de esta cuenta/.test((await call('asignar_tablero', { tablero: b, usuarios: ['ajeno'] })).err), 'usuario ajeno');
});
await t('editar la copia de un usuario no toca el original (y queda versión de la copia)', async () => {
    const { db, call, b, u1 } = await setup();
    const asg = (await call('asignar_tablero', { tablero: b, usuarios: [u1] })).data.asignaciones[0].asignacion;
    const r = await call('poner_celdas', { asignacion: asg, celdas: [{ fila: 1, columna: 2, texto: 'Leche' }] });
    assert(!r.err && /\?copia=/.test(r.data.abrir_en_miravoz), JSON.stringify(r));
    const copy = db.T.assignments.get(asg).copy_bundle, orig = db.T.boards.get(b).bundle;
    assert(copy.boards[copy.mainBoard].gridElements.length === 2 && orig.boards[orig.mainBoard].gridElements.length === 1, 'solo la copia');
    assert(db.T.board_versions.some(v => v.board_id === `copia:${asg}`), 'versión de la copia');
    const h = await call('historial_tablero', { asignacion: asg });
    assert(h.data.cantidad === 1, JSON.stringify(h));
    const v = await call('ver_tablero', { asignacion: asg });
    assert(v.data.es_copia_de_usuario && v.data.paginas[0].celdas.length === 2, 'ver la copia');
});
await t('actualizar la copia desde el original (con respaldo) y deshacerlo', async () => {
    const { db, call, b, u1 } = await setup();
    const asg = (await call('asignar_tablero', { tablero: b, usuarios: [u1] })).data.asignaciones[0].asignacion;
    await call('poner_celdas', { tablero: b, celdas: [{ fila: 2, columna: 1, texto: 'Fruta' }] });
    const before = db.T.assignments.get(asg).copy_updated_at;
    const r = await call('actualizar_copia', { asignacion: asg });
    const copy = db.T.assignments.get(asg);
    assert(!r.err && copy.copy_bundle.boards[copy.copy_bundle.mainBoard].gridElements.length === 2 && copy.copy_updated_at !== before, 'actualizada (la tablet la detecta por copy_updated_at)');
    const vers = (await call('historial_tablero', { asignacion: asg })).data.versiones;
    await call('restaurar_version', { asignacion: asg, version: vers[0].version });
    const back = db.T.assignments.get(asg).copy_bundle;
    assert(back.boards[back.mainBoard].gridElements.length === 1, 'deshecho');
});
await t('permiso, inicio y quitar asignación (con respaldo)', async () => {
    const { db, call, b, u1, u2 } = await setup();
    const asg = (await call('asignar_tablero', { tablero: b, usuarios: [u1] })).data.asignaciones[0].asignacion;
    await call('cambiar_permiso', { asignacion: asg, permiso: 'editable' });
    assert(db.T.assignments.get(asg).permission === 'editable', 'permiso');
    assert(!(await call('elegir_tablero_inicio', { usuario: u1, asignacion: asg })).err && db.T.aac_users.get(u1).home_board_id === asg, 'inicio');
    assert((await call('elegir_tablero_inicio', { usuario: u2, asignacion: asg })).err, 'asignación de otro usuario');
    db.noVersions = true;
    assert(/09_guardar_version/.test((await call('quitar_asignacion', { asignacion: asg })).err) && db.T.assignments.has(asg), 'sin respaldo no se quita');
    db.noVersions = false;
    const r = await call('quitar_asignacion', { asignacion: asg });
    assert(!r.err && !db.T.assignments.has(asg) && db.T.board_versions.some(v => v.board_id === `copia:${asg}`), 'quitada con respaldo');
});
await t('borrar tablero: guarda versión, las copias se conservan y se puede recuperar', async () => {
    const { db, call, b, u1 } = await setup();
    await call('asignar_tablero', { tablero: b, usuarios: [u1] });
    const r = await call('borrar_tablero', { id: b });
    assert(!r.err && r.data.copias_que_se_conservan === 1 && !db.T.boards.has(b), JSON.stringify(r));
    const v = (await call('historial_tablero', { id: b })).data.versiones[0].version;
    const rec = await call('restaurar_version', { id: b, version: v });
    assert(!rec.err && db.T.boards.has(b) && db.T.boards.get(b).bundle.ownerId === 'p1', JSON.stringify(rec));
});
await t('cleanCopy saca los metadatos locales y de la cuenta', () => {
    const c = cleanCopy({ name: 'x', ownerId: 'p', syncedAt: 1, assignmentId: 'a', dirty: true, profEdit: true, boards: {} });
    assert(!c.ownerId && !c.syncedAt && !c.assignmentId && !c.dirty && !c.profEdit && c.name === 'x', JSON.stringify(c));
    void E;
});
console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
