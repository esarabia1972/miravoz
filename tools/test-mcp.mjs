// Tests del servidor MCP (web/api/_mcp.js, etapa 1 solo lectura · 1.6.0). Correr: node tools/test-mcp.mjs
import { handle, TOOLS, describeBoard, PROTOCOL_VERSIONS } from '../web/api/_mcp.js';
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const nav = (to) => ({ modelName: 'GridActionNavigate', navType: 'navigateToGrid', toGridId: to });
const BUNDLE = { name: 'Nuclear', mainBoard: 'g1', tags: ['Hogar'], boards: {
    g1: { id: 'g1', label: { es: 'Inicio' }, rowCount: 2, minColumnCount: 2, gridElements: [
        { id: 'a', x: 0, y: 0, width: 1, height: 1, label: { es: 'Quiero' }, colorCategory: 'CC_VERB', image: { url: 'https://api.arasaac.org/api/pictograms/5441?download=false' }, actions: [{ modelName: 'GridActionSpeak' }] },
        { id: 'b', x: 1, y: 0, width: 1, height: 1, label: { es: 'Comida' }, image: { data: 'data:image/png;base64,AAAA' }, actions: [nav('g2')] },
        { id: 'c', x: 0, y: 1, width: 2, height: 1, label: { es: 'Hola' }, actions: [{ modelName: 'GridActionSpeakCustom', speakText: { es: 'Hola, ¿cómo estás?' } }] }
    ] },
    g2: { id: 'g2', label: { es: 'Comida' }, rowCount: 1, minColumnCount: 1, gridElements: [{ id: 'd', x: 0, y: 0, label: { es: 'Volver' }, actions: [{ modelName: 'GridActionNavigate', navType: 'navigateToLastOpenedGrid' }] }] }
} };
const calls = [];
const db = {
    user: async () => ({ email: 'a@b.c', user_metadata: { full_name: 'Esteban' } }),
    select: async (table, q) => {
        calls.push(`${table}?${q}`);
        if (table === 'boards' && q.includes('id=eq.')) return q.includes('id=eq.b1') ? [{ id: 'b1', name: 'Nuclear', updated_at: 'x', bundle: BUNDLE }] : [];
        if (table === 'boards') return [{ id: 'b1', name: 'Nuclear', updated_at: 'x', tags: ['Hogar'] }, { id: 'b2', name: 'Bebidas', updated_at: 'y', tags: null }];
        if (table === 'aac_users' && q.includes('id=eq.')) return [{ id: 'u1', display_name: 'Mateo', home_board_id: 'as1' }];
        if (table === 'aac_users') return [{ id: 'u1', display_name: 'Mateo', created_at: 'z' }];
        if (table === 'assignments' && q.includes('aac_user_id=eq.')) return [{ id: 'as1', board_id: 'b1', permission: 'editable', copy_updated_at: 'w', name: 'Nuclear' }];
        if (table === 'assignments') return [{ aac_user_id: 'u1' }, { aac_user_id: 'u1' }];
        if (table === 'device_tokens') return [{ aac_user_id: 'u1' }];
        return [];
    },
    arasaac: async () => [{ _id: 2248, keywords: [{ keyword: 'agua' }] }]
};
const call = (name, args = {}) => handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { db });
const data = (r) => JSON.parse(r.result.content[0].text);

console.log('servidor MCP');
await t('initialize: versión de protocolo, solo herramientas, instrucciones de CAA', async () => {
    const r = await handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, { db });
    assert(r.result.protocolVersion === '2025-06-18' && r.result.capabilities.tools && /usuario/.test(r.result.instructions), JSON.stringify(r));
    const r2 = await handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, { db });
    assert(r2.result.protocolVersion === PROTOCOL_VERSIONS[0], 'versión desconocida → la más nueva');
    assert(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, { db }) === null, 'las notificaciones no responden');
});
await t('las herramientas de lectura de la etapa 1 siguen siendo de solo lectura', async () => {
    const r = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { db });
    const read = ['quien_soy', 'listar_tableros', 'ver_tablero', 'listar_usuarios', 'ver_usuario', 'buscar_pictogramas', 'revisar_tablero', 'historial_tablero'];
    assert(r.result.tools.length === TOOLS.length && r.result.tools.filter(x => read.includes(x.name)).every(x => x.annotations.readOnlyHint && !x.annotations.destructiveHint), 'solo lectura');
});
await t('listar_tableros: filtra por nombre y etiqueta', async () => {
    assert(data(await call('listar_tableros')).cantidad === 2, 'todos');
    assert(data(await call('listar_tableros', { buscar: 'beb' })).tableros[0].nombre === 'Bebidas', 'buscar');
    assert(data(await call('listar_tableros', { etiqueta: 'hogar' })).tableros.length === 1, 'etiqueta');
});
await t('ver_tablero: páginas en orden, celdas con texto, voz, color, pictograma y navegación; nunca el base64', async () => {
    const r = await call('ver_tablero', { id: 'b1' });
    const d = data(r), txt = r.result.content[0].text;
    assert(d.cantidad_paginas === 2 && d.paginas[0].nombre === 'Inicio' && d.paginas[0].inicio, 'páginas');
    const [quiero, comida, hola] = d.paginas[0].celdas;
    assert(quiero.texto === 'Quiero' && quiero.arasaac_id === 5441 && /verde/.test(quiero.color), JSON.stringify(quiero));
    assert(comida.navega === 'Comida' && comida.imagen === 'propia', JSON.stringify(comida));
    assert(hola.dice === 'Hola, ¿cómo estás?' && hola.tamano === '2x1', JSON.stringify(hola));
    assert(d.paginas[1].celdas[0].navega === 'volver', 'volver');
    assert(!/base64|AAAA/.test(txt), 'no se filtran imágenes propias');
    assert(data(await call('ver_tablero', { id: 'b1', pagina: 'comida' })).paginas.length === 1, 'una página');
    assert((await call('ver_tablero', { id: 'nope' })).result.isError, 'id inexistente');
});
await t('usuarios: cantidad de tableros, tablet vinculada y asignaciones (sin tokens ni códigos)', async () => {
    const l = data(await call('listar_usuarios'));
    assert(l.usuarios[0].tableros_asignados === 2 && l.usuarios[0].tablet_vinculada === true, JSON.stringify(l));
    const u = await call('ver_usuario', { id: 'u1' });
    const d = data(u);
    assert(d.tableros[0].inicio && d.tableros[0].permiso === 'editable', JSON.stringify(d));
    assert(!calls.some(c => /access_codes|token_hash|copy_bundle(?!->>name)/.test(c)), 'consultas mínimas: ' + calls.join(' | '));
});
await t('pictogramas: id, palabras, imagen y atribución', async () => {
    const d = data(await call('buscar_pictogramas', { palabra: 'agua' }));
    assert(d.pictogramas[0].arasaac_id === 2248 && /static\.arasaac\.org/.test(d.pictogramas[0].imagen) && /BY-NC-SA/.test(d.atribucion), JSON.stringify(d));
});
await t('errores: método o herramienta desconocidos, pedido inválido', async () => {
    assert((await handle({ jsonrpc: '2.0', id: 9, method: 'x/y' }, { db })).error.code === -32601, 'método');
    assert((await call('borrar_todo')).error.code === -32602, 'herramienta');
    assert((await handle({ foo: 1 }, { db })).error.code === -32600, 'inválido');
});
await t('describeBoard acota la cantidad de celdas', () => {
    const many = { mainBoard: 'g', boards: { g: { id: 'g', gridElements: Array.from({ length: 500 }, (_, i) => ({ id: 'e' + i, x: i % 20, y: Math.floor(i / 20), label: { es: 'x' } })) } } };
    const d = describeBoard({ id: 'b', name: 'n', bundle: many });
    assert(d.paginas[0].celdas.length === 400 && d.aviso, 'acotado');
});
await t('HTTP: sin token → 401 con resource_metadata; con token → JSON-RPC; notificación → 202', async () => {
    const mcp = await import('../web/api/mcp.js');
    const prm = await import('../web/api/oauth-protected-resource.js');
    const H = { host: 'www.miravoz.com.ar', 'content-type': 'application/json' };
    const r1 = await mcp.POST(new Request('https://www.miravoz.com.ar/api/mcp', { method: 'POST', headers: H, body: '{}' }));
    assert(r1.status === 401 && /resource_metadata="https:\/\/www\.miravoz\.com\.ar\/\.well-known\/oauth-protected-resource"/.test(r1.headers.get('www-authenticate')), r1.headers.get('www-authenticate'));
    const meta = await (prm.GET(new Request('https://www.miravoz.com.ar/.well-known/oauth-protected-resource', { headers: H }))).json();
    assert(meta.resource === 'https://www.miravoz.com.ar/mcp' && /supabase\.co\/auth\/v1$/.test(meta.authorization_servers[0]), JSON.stringify(meta));
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        if (String(url).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ email: 'a@b.c' }), { status: 200 });
        if (String(url).includes('/rpc/account_enabled')) return new Response('true', { status: 200 });
        if (String(url).includes('/rest/v1/boards')) return new Response(JSON.stringify([{ id: 'b1', name: 'Nuclear', updated_at: 'x', tags: [] }]), { status: 200 });
        return new Response('[]', { status: 200 });
    };
    try {
        const auth = { ...H, authorization: 'Bearer abc' };
        const r2 = await mcp.POST(new Request('https://www.miravoz.com.ar/api/mcp', { method: 'POST', headers: auth, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'listar_tableros', arguments: {} } }) }));
        const j = await r2.json();
        assert(r2.status === 200 && JSON.parse(j.result.content[0].text).cantidad === 1, JSON.stringify(j));
        const r3 = await mcp.POST(new Request('https://www.miravoz.com.ar/api/mcp', { method: 'POST', headers: auth, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }));
        assert(r3.status === 202, 'notificación');
        globalThis.fetch = async (url) => String(url).endsWith('/auth/v1/user') ? new Response('{}', { status: 401 }) : new Response('[]');
        const r4 = await mcp.POST(new Request('https://www.miravoz.com.ar/api/mcp', { method: 'POST', headers: auth, body: '{}' }));
        assert(r4.status === 401 && /invalid_token/.test(r4.headers.get('www-authenticate')), 'token vencido');
    } finally { globalThis.fetch = realFetch; }
});
console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
