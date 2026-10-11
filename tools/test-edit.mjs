// Tests de la edición de tableros del servidor MCP (web/api/_edit.js + escritura en _mcp.js, 1.7.0)
import * as E from '../web/api/_edit.js';
import { handle, TOOLS } from '../web/api/_mcp.js';
import { labelText, navInfo } from '../web/js/asterics.js';
import { pageOrder, gridName, arasaacIdFromUrl } from '../web/js/pages.js';
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.stack.split('\n').slice(0, 2).join(' ')); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const throwsEdit = (f, re) => { try { f(); } catch (e) { assert(e instanceof E.EditError && (!re || re.test(e.message)), e.message); return; } throw new Error('no falló'); };

console.log('edición de tableros (MCP)');
await t('tablero nuevo con el mismo formato que el editor de MiraVoz', () => {
    const b = E.newBundle({ nombre: 'Merienda', filas: 2, columnas: 3, etiquetas: ['Hogar', 'hogar', ' Comida '] });
    const g = b.boards[b.mainBoard];
    assert(b.type === 'grd' && b.speechModel === 'actions' && b.importerVersion === 1 && /^bundle_/.test(b.id), 'cabecera');
    assert(g.modelName === 'GridData' && g.rowCount === 2 && g.minColumnCount === 3 && labelText(g.label) === 'Merienda', 'página');
    assert(JSON.stringify(b.tags) === '["Hogar","Comida"]', 'etiquetas sin repetir: ' + JSON.stringify(b.tags));
    throwsEdit(() => E.newBundle({ nombre: 'x', filas: 40 }), /fuera de rango/);
});
await t('poner celda: texto, pictograma, color, voz propia; modificar solo lo indicado', () => {
    const b = E.newBundle({ nombre: 'T' }); const p = b.mainBoard;
    const r = E.setCell(b, p, { fila: 1, columna: 2, texto: 'Agua', pictograma_id: 2248, color: 'naranja' });
    const el = b.boards[p].gridElements[0];
    assert(r.creada && el.x === 1 && el.y === 0 && labelText(el.label) === 'Agua' && el.colorCategory === 'CC_NOUN' && arasaacIdFromUrl(el.image.url) === 2248, JSON.stringify(el));
    assert(el.actions.some(a => a.modelName === 'GridActionSpeak'), 'dice el texto por defecto');
    E.setCell(b, p, { fila: 1, columna: 2, dice: 'Quiero agua, por favor' });
    assert(labelText(el.label) === 'Agua' && el.image && el.actions.find(a => a.modelName === 'GridActionSpeakCustom').speakText.es === 'Quiero agua, por favor', 'solo cambia la voz');
    E.setCell(b, p, { fila: 1, columna: 2, silenciosa: true, color: 'ninguno', sin_pictograma: true });
    assert(!el.actions.length && !el.colorCategory && !el.image, 'silenciosa, sin color ni imagen');
    throwsEdit(() => E.setCell(b, p, { fila: 1, columna: 1, color: 'fucsia' }), /Color desconocido/);
});
await t('navegación: a otra página, volver, inicio, página nueva con el texto de la celda', () => {
    const b = E.newBundle({ nombre: 'T' }); const p = b.mainBoard;
    E.addPage(b, { nombre: 'Comida' });
    E.setCell(b, p, { fila: 1, columna: 1, texto: 'Comer', navega_a: 'comida' });
    const r = E.setCell(b, p, { fila: 1, columna: 2, texto: 'Juegos', navega_a: 'nueva' });
    E.setCell(b, p, { fila: 1, columna: 3, texto: 'Inicio', navega_a: 'inicio' });
    const els = b.boards[p].gridElements;
    assert(gridName(b.boards[navInfo(els[0], b).target]) === 'Comida', 'a Comida');
    assert(r.pagina_nueva && r.pagina_nueva.nombre === 'Juegos' && navInfo(els[1], b).target === r.pagina_nueva.id, 'página nueva');
    assert(navInfo(els[2], b).kind === 'home', 'inicio');
    E.setCell(b, p, { fila: 1, columna: 1, navega_a: 'ninguna' });
    assert(!navInfo(els[0], b), 'sin vínculo');
    throwsEdit(() => E.setCell(b, p, { fila: 2, columna: 1, navega_a: 'Inexistente' }), /No hay una página/);
});
await t('la grilla se agranda si hace falta; una celda grande no pisa otras', () => {
    const b = E.newBundle({ nombre: 'T', filas: 2, columnas: 2 }); const p = b.mainBoard;
    const r = E.setCell(b, p, { fila: 3, columna: 4, texto: 'X' });
    assert(r.grilla_ampliada && b.boards[p].rowCount === 3 && b.boards[p].minColumnCount === 4, 'ampliada');
    E.setCell(b, p, { fila: 1, columna: 1, texto: 'A' });
    E.setCell(b, p, { fila: 1, columna: 2, texto: 'B' });
    throwsEdit(() => E.setCell(b, p, { fila: 1, columna: 1, ancho: 2 }), /pisaría/);
    throwsEdit(() => E.setCell(b, p, { fila: 1, columna: 20, texto: 'Z' }), /fuera de rango|máximo/);
});
await t('mover (con intercambio) y borrar celdas', () => {
    const b = E.newBundle({ nombre: 'T' }); const p = b.mainBoard;
    E.setCell(b, p, { fila: 1, columna: 1, texto: 'A' }); E.setCell(b, p, { fila: 2, columna: 2, texto: 'B' });
    const r = E.moveCell(b, p, { fila: 1, columna: 1 }, { fila: 2, columna: 2 });
    const [A, B] = b.boards[p].gridElements;
    assert(r.intercambiada && A.x === 1 && A.y === 1 && B.x === 0 && B.y === 0, 'intercambio');
    E.clearCell(b, p, 1, 1);
    assert(b.boards[p].gridElements.length === 1, 'borrada');
    throwsEdit(() => E.clearCell(b, p, 3, 3), /No hay ninguna celda/);
});
await t('páginas: agregar, renombrar, achicar con cuidado, inicio, borrar (sin borrar la última)', () => {
    const b = E.newBundle({ nombre: 'T', filas: 3, columnas: 3 }); const p = b.mainBoard;
    const np = E.addPage(b, { nombre: 'Lugares' });
    assert(np.filas === 3 && np.columnas === 3, 'mismo tamaño que inicio');
    throwsEdit(() => E.addPage(b, { nombre: 'lugares' }), /Ya hay/);
    E.setCell(b, np.id, { fila: 3, columna: 3, texto: 'Plaza' });
    throwsEdit(() => E.editPage(b, np.id, { filas: 2 }), /quedarían afuera/);
    E.editPage(b, np.id, { nombre: 'Salidas', inicio: true });
    assert(b.mainBoard === np.id && gridName(b.boards[np.id]) === 'Salidas', 'renombrada e inicio');
    E.setCell(b, p, { fila: 1, columna: 1, texto: 'Ir', navega_a: 'Salidas' });
    const r = E.deletePage(b, E.resolvePage(b, 'Salidas'));
    assert(r.vinculos_quitados === 1 && b.mainBoard === p, JSON.stringify(r));
    throwsEdit(() => E.deletePage(b, p), /única página/);
});
await t('duplicar: copia independiente con vínculos internos reescritos', () => {
    const b = E.newBundle({ nombre: 'Orig' }); const p = b.mainBoard;
    E.setCell(b, p, { fila: 1, columna: 1, texto: 'Más', navega_a: 'nueva:Más cosas' });
    b.ownerId = 'u1'; b.syncedAt = 5;
    const c = E.duplicateBundle(b, 'Copia');
    assert(c.id !== b.id && c.name === 'Copia' && !c.ownerId && !c.syncedAt, 'nueva identidad');
    const target = navInfo(c.boards[c.mainBoard].gridElements[0], c).target;
    assert(c.boards[target] && !b.boards[target], 'el vínculo apunta a la página de la copia');
});
await t('revisar: vínculos rotos, páginas sueltas, sin pictograma, repetidas y lugares libres', () => {
    const b = E.newBundle({ nombre: 'T', filas: 2, columnas: 2 }); const p = b.mainBoard;
    E.setCell(b, p, { fila: 1, columna: 1, texto: 'Hola' });
    E.setCell(b, p, { fila: 1, columna: 2, texto: 'hola', pictograma_id: 1 });
    E.addPage(b, { nombre: 'Suelta' });
    b.boards[p].gridElements[0].actions.push({ modelName: 'GridActionNavigate', navType: 'navigateToGrid', toGridId: 'zz' });
    const tipos = E.reviewBundle(b).observaciones.map(o => o.tipo);
    for (const k of ['vínculo roto', 'sin pictograma', 'repetida en la página', 'página a la que no se llega navegando', 'lugares libres']) assert(tipos.includes(k), `falta "${k}": ${tipos}`);
});

// --- Escritura de punta a punta con una base simulada ---
function fakeDb() {
    const boards = new Map(), versions = [];
    let clock = 1000;
    const db = {
        boards, versions,
        user: async () => ({ id: 'u1', email: 'a@b.c' }),
        select: async (table, q) => {
            const id = decodeURIComponent((/id=eq\.([^&]+)/.exec(q) || [])[1] || '');
            if (table === 'boards') return id ? (boards.has(id) ? [JSON.parse(JSON.stringify(boards.get(id)))] : []) : [...boards.values()];
            if (table === 'board_versions') {
                const bid = decodeURIComponent((/board_id=eq\.([^&]+)/.exec(q) || [])[1] || '');
                const vid = Number((/&id=eq\.(\d+)/.exec(q) || [])[1] || 0);
                return versions.filter(v => v.board_id === bid && (!vid || v.id === vid)).reverse();
            }
            return [];
        },
        insert: async (table, row) => {
            if (table === 'board_versions') { if (db.noVersions) throw new Error('42P01'); versions.push({ ...row, id: versions.length + 1, created_at: 'ahora' }); return true; }
            if (table === 'boards') { boards.set(row.id, { ...row, updated_at: new Date(clock++).toISOString() }); return true; }
        },
        patch: async (table, filter, values) => {
            const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(filter)[1]);
            const ua = decodeURIComponent(/updated_at=eq\.([^&]+)/.exec(filter)[1]);
            const row = boards.get(id);
            if (db.raceOnce) { db.raceOnce = false; row.updated_at = new Date(clock++).toISOString(); } // otro dispositivo guardó en el medio
            if (!row || row.updated_at !== ua) return [];
            boards.set(id, { ...row, ...values });
            return [{ id }];
        },
        arasaac: async (w) => (w === 'nada' ? [] : [{ _id: w === 'agua' ? 2248 : 999, keywords: [{ keyword: w }] }])
    };
    return db;
}
const callWith = (db) => async (name, args) => {
    const r = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { db, user: { id: 'u1' }, base: 'https://www.miravoz.com.ar' });
    const txt = r.result.content[0].text;
    return { err: r.result.isError ? txt : null, data: r.result.isError ? null : JSON.parse(txt) };
};

await t('armar un tablero entero desde Claude: crear → poner celdas con pictogramas por palabra → abrir en MiraVoz', async () => {
    const db = fakeDb(), call = callWith(db);
    const c = await call('crear_tablero', { nombre: 'Merienda', filas: 2, columnas: 3 });
    assert(c.data.creado && /\?tablero=bundle_/.test(c.data.abrir_en_miravoz), JSON.stringify(c));
    const id = c.data.id;
    const p = await call('poner_celdas', { tablero: id, celdas: [
        { fila: 1, columna: 1, texto: 'Quiero', pictograma: 'querer', color: 'verde' },
        { fila: 1, columna: 2, texto: 'Agua', pictograma: 'agua', color: 'naranja' },
        { fila: 1, columna: 3, texto: 'Galletitas', pictograma: 'nada' },
        { fila: 2, columna: 3, texto: 'Más', navega_a: 'nueva' }
    ] });
    assert(!p.err && p.data.creadas === 4 && p.data.paginas_nuevas.length === 1, JSON.stringify(p));
    assert(p.data.pictogramas.find(x => x.buscado === 'agua').arasaac_id === 2248 && p.data.pictogramas.find(x => x.buscado === 'nada').aviso, 'pictogramas');
    const row = db.boards.get(id);
    assert(row.bundle.updatedAt === row.bundle.syncedAt && row.bundle.ownerId === 'u1' && Date.parse(row.updated_at) === row.bundle.updatedAt, 'metadatos para que la app lo baje');
    assert(db.versions.length === 1 && db.versions[0].board_id === id, 'versión anterior guardada');
});
await t('concurrencia: si otro dispositivo guardó en el medio, se relee y se reintenta (no se pisa)', async () => {
    const db = fakeDb(), call = callWith(db);
    const id = (await call('crear_tablero', { nombre: 'T' })).data.id;
    db.raceOnce = true;
    const r = await call('poner_celdas', { tablero: id, celdas: [{ fila: 1, columna: 1, texto: 'Hola' }] });
    assert(!r.err && db.boards.get(id).bundle.boards[db.boards.get(id).bundle.mainBoard].gridElements.length === 1, JSON.stringify(r));
});
await t('sin tabla de versiones no se escribe nada (ningún dato se pierde)', async () => {
    const db = fakeDb(), call = callWith(db);
    const id = (await call('crear_tablero', { nombre: 'T' })).data.id;
    db.noVersions = true;
    const before = JSON.stringify(db.boards.get(id));
    const r = await call('poner_celdas', { tablero: id, celdas: [{ fila: 1, columna: 1, texto: 'Hola' }] });
    assert(/07_versiones/.test(r.err) && JSON.stringify(db.boards.get(id)) === before, r.err);
});
await t('historial y restaurar: deshace un cambio (y se puede volver a deshacer)', async () => {
    const db = fakeDb(), call = callWith(db);
    const id = (await call('crear_tablero', { nombre: 'T' })).data.id;
    await call('poner_celdas', { tablero: id, celdas: [{ fila: 1, columna: 1, texto: 'Hola' }] });
    await call('editar_tablero', { id, nombre: 'Saludos', etiquetas: ['Social'] });
    const h = await call('historial_tablero', { id });
    assert(h.data.cantidad === 2, JSON.stringify(h));
    const first = h.data.versiones[h.data.versiones.length - 1].version; // antes de poner la celda
    const r = await call('restaurar_version', { id, version: first });
    const b = db.boards.get(id).bundle;
    assert(!r.err && b.boards[b.mainBoard].gridElements.length === 0 && b.name === 'T', 'vuelve al tablero vacío');
    assert(db.versions.length === 3, 'la restauración también guardó una versión');
});
await t('errores claros: página o tablero inexistente, borrar la única página, tablero de otra cuenta', async () => {
    const db = fakeDb(), call = callWith(db);
    const id = (await call('crear_tablero', { nombre: 'T' })).data.id;
    assert(/No hay una página/.test((await call('poner_celdas', { tablero: id, pagina: 'Zoo', celdas: [{ fila: 1, columna: 1, texto: 'x' }] })).err), 'página');
    assert(/No hay un tablero/.test((await call('editar_tablero', { id: 'otro', nombre: 'x' })).err), 'tablero');
    assert(/única página/.test((await call('borrar_pagina', { tablero: id, pagina: 'T' })).err), 'única');
});
await t('herramientas: las de escritura están marcadas; borrar es destructivo', () => {
    const by = Object.fromEntries(TOOLS.map(x => [x.name, x.annotations]));
    assert(by.poner_celdas.readOnlyHint === false && by.borrar_celdas.destructiveHint && by.borrar_pagina.destructiveHint && by.revisar_tablero.readOnlyHint, JSON.stringify(by));
});
console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
