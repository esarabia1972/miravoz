// api/_mcp.js — Núcleo del servidor MCP de MiraVoz (etapa 1: SOLO LECTURA · 1.6.0)
//
// Claude (u otro cliente MCP) se conecta a https://www.miravoz.com.ar/mcp. La cuenta registrada inicia sesión
// con Supabase Auth (servidor OAuth 2.1) y Claude recibe un token A NOMBRE DE ESA CUENTA: cada consulta va a
// Supabase con ese token, así que las mismas reglas RLS de la app hacen que solo vea sus tableros y usuarios.
//
// Transporte: "Streamable HTTP" sin sesión (cada POST es un mensaje JSON-RPC y la respuesta es JSON).
// Este archivo no depende de Vercel: handle(message, ctx) recibe un adaptador `db` (fetch a Supabase) → testeable.
// El "_" del nombre hace que Vercel NO lo publique como función: lo importa api/mcp.js.
//
// Privacidad: nunca se devuelven tokens de tablets, códigos de vinculación, imágenes propias (base64) ni audio.

import { labelText, navInfo } from '../js/asterics.js';
import { pageOrder, gridName, arasaacIdFromUrl, pickArasaacKeyword } from '../js/pages.js';
import * as E from './_edit.js';

export const SERVER_INFO = { name: 'miravoz', title: 'MiraVoz', version: '1.8.0' };
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const MAX_CELLS = 400; // por respuesta de ver_tablero (las páginas grandes se paginan)

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const RWD = { ...RW, destructiveHint: true };

export const INSTRUCTIONS = [
    'MiraVoz es una plataforma de comunicación aumentativa y alternativa (CAA). Estas herramientas leen y editan los tableros de la cuenta registrada conectada y leen sus usuarios.',
    'Decir "usuario", nunca "paciente". Los usuarios suelen ser menores: no repetir sus datos fuera de lo necesario.',
    'Buenas prácticas de CAA: vocabulario núcleo (palabras de alta frecuencia) en lugares fijos; colores Fitzgerald (amarillo personas/pronombres, verde verbos, azul descriptores, naranja sustantivos, rosa expresiones sociales, violeta lugares, rojo importante/urgente, gris otros); texto corto en cada celda; un pictograma de ARASAAC por celda; "volver" e "inicio" para navegar entre páginas.',
    'Para armar un tablero: crear_tablero → poner_celdas (en lote, con pictograma como palabra o id de ARASAAC) → revisar_tablero. Filas y columnas se cuentan desde 1. Cada cambio guarda antes una versión: con historial_tablero y restaurar_version se puede deshacer.',
    'Después de cambiar algo, ofrecer el enlace "abrir_en_miravoz" para que la cuenta lo vea y lo ajuste en la app (los cambios aparecen solos en unos segundos si MiraVoz está abierto).',
    'Usuarios: asignar_tablero da a cada usuario una COPIA (el original sigue siendo de la cuenta); para cambiar lo que ve un usuario se edita su copia (parámetro asignacion en las herramientas de páginas y celdas) o se le manda la versión nueva del original con actualizar_copia. La tablet recibe los cambios al abrirse o al recuperar la conexión.',
    'Antes de borrar páginas, celdas o tableros, quitar asignaciones, actualizar copias o cambiar lo que ve un usuario, confirmar con la persona. Mostrar códigos de vinculación solo si se pidieron.'
].join(' ');

const CELL_SCHEMA = {
    type: 'object',
    properties: {
        fila: { type: 'integer', minimum: 1, maximum: 12 },
        columna: { type: 'integer', minimum: 1, maximum: 16 },
        texto: { type: 'string', description: 'Texto visible de la celda (corto).' },
        pictograma: { type: ['string', 'integer'], description: 'Id de ARASAAC, o una palabra para buscar el pictograma (se usa el primer resultado).' },
        sin_pictograma: { type: 'boolean', description: 'true para quitar la imagen.' },
        color: { type: 'string', description: 'amarillo, verde, azul, naranja, rojo, rosa, violeta, gris o "ninguno".' },
        dice: { type: 'string', description: 'Texto que dice la voz si es distinto del visible (vacío = dice el texto).' },
        silenciosa: { type: 'boolean', description: 'true = no dice nada al elegirla (por ejemplo, una celda que solo navega).' },
        navega_a: { type: 'string', description: 'Nombre o id de otra página, "volver", "inicio", "nueva" (crea una página con el texto de la celda), "nueva:Nombre" o "ninguna".' },
        ancho: { type: 'integer', minimum: 1, maximum: 16 },
        alto: { type: 'integer', minimum: 1, maximum: 12 }
    },
    required: ['fila', 'columna'],
    additionalProperties: false
};
const POS = { type: 'object', properties: { fila: { type: 'integer', minimum: 1 }, columna: { type: 'integer', minimum: 1 } }, required: ['fila', 'columna'], additionalProperties: false };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const T_ID = { type: 'string', description: 'Id del tablero (de listar_tableros).' };
const T_PAGE = { type: 'string', description: 'Nombre o id de la página (sin indicar = la de inicio).' };
const T_ASG = { type: 'string', description: 'En lugar de un tablero propio: id de la asignación (la COPIA de un usuario, de ver_usuario). Cambia solo la copia de ese usuario; el original no cambia.' };
const T_USER = { type: 'string', description: 'Id del usuario (de listar_usuarios).' };
const PERM = { type: 'string', enum: ['solo_uso', 'editable'], description: '"solo_uso": el usuario no puede cambiarlo; "editable": en su tablet se puede editar.' };

export const WRITE_TOOLS = [
    { name: 'crear_tablero', title: 'Crear tablero', annotations: RW,
      description: 'Crea un tablero nuevo vacío (una página) en la cuenta. Devuelve su id y el enlace para abrirlo en MiraVoz.',
      inputSchema: obj({ nombre: { type: 'string' }, filas: { type: 'integer', minimum: 1, maximum: 12 }, columnas: { type: 'integer', minimum: 1, maximum: 16 }, etiquetas: { type: 'array', items: { type: 'string' } } }, ['nombre']) },
    { name: 'duplicar_tablero', title: 'Duplicar tablero', annotations: RW,
      description: 'Crea una copia independiente de un tablero (por ejemplo, para adaptarlo a otro usuario sin tocar el original).',
      inputSchema: obj({ id: T_ID, nombre: { type: 'string' } }, ['id']) },
    { name: 'editar_tablero', title: 'Renombrar o etiquetar tablero', annotations: RW,
      description: 'Cambia el nombre y/o las etiquetas de un tablero (las etiquetas reemplazan a las anteriores).',
      inputSchema: obj({ id: T_ID, nombre: { type: 'string' }, etiquetas: { type: 'array', items: { type: 'string' } } }, ['id']) },
    { name: 'agregar_pagina', title: 'Agregar página', annotations: RW,
      description: 'Agrega una página al tablero (por defecto del mismo tamaño que la de inicio). Para vincularla, usar navega_a en poner_celdas.',
      inputSchema: obj({ tablero: T_ID, asignacion: T_ASG, nombre: { type: 'string' }, filas: { type: 'integer', minimum: 1, maximum: 12 }, columnas: { type: 'integer', minimum: 1, maximum: 16 } }, []) },
    { name: 'editar_pagina', title: 'Editar página', annotations: RW,
      description: 'Renombra una página, cambia su tamaño (filas/columnas) o la hace página de inicio.',
      inputSchema: obj({ tablero: T_ID, asignacion: T_ASG, pagina: T_PAGE, nombre: { type: 'string' }, filas: { type: 'integer', minimum: 1, maximum: 12 }, columnas: { type: 'integer', minimum: 1, maximum: 16 }, inicio: { type: 'boolean' } }, ['pagina']) },
    { name: 'borrar_pagina', title: 'Borrar página', annotations: RWD,
      description: 'Borra una página (las celdas que llevaban a ella quedan sin ese vínculo). Confirmar antes con la persona. Se puede deshacer con restaurar_version.',
      inputSchema: obj({ tablero: T_ID, asignacion: T_ASG, pagina: T_PAGE }, ['pagina']) },
    { name: 'poner_celdas', title: 'Poner celdas', annotations: RW,
      description: 'Crea o modifica celdas de una página, en lote (hasta 120 por llamada). En una celda existente solo cambia lo indicado. Si una celda queda fuera de la grilla, la grilla se agranda.',
      inputSchema: obj({ tablero: T_ID, asignacion: T_ASG, pagina: T_PAGE, celdas: { type: 'array', items: CELL_SCHEMA, minItems: 1, maxItems: 120 } }, ['celdas']) },
    { name: 'mover_celda', title: 'Mover celda', annotations: RW,
      description: 'Mueve una celda a otra posición de la misma página; si el destino tiene una celda del mismo tamaño, las intercambia.',
      inputSchema: obj({ tablero: T_ID, asignacion: T_ASG, pagina: T_PAGE, desde: POS, hasta: POS }, ['desde', 'hasta']) },
    { name: 'borrar_celdas', title: 'Borrar celdas', annotations: RWD,
      description: 'Borra celdas de una página. Confirmar antes con la persona. Se puede deshacer con restaurar_version.',
      inputSchema: obj({ tablero: T_ID, asignacion: T_ASG, pagina: T_PAGE, celdas: { type: 'array', items: POS, minItems: 1, maxItems: 120 } }, ['celdas']) },
    { name: 'revisar_tablero', title: 'Revisar tablero', annotations: RO,
      description: 'Revisa la calidad de un tablero: vínculos rotos, páginas a las que no se llega, celdas sin pictograma o vacías, palabras repetidas y lugares libres.',
      inputSchema: obj({ id: T_ID, asignacion: T_ASG }) },
    { name: 'historial_tablero', title: 'Historial del tablero', annotations: RO,
      description: 'Lista las versiones guardadas antes de cada cambio hecho desde Claude (las más nuevas primero), de un tablero o de la copia de un usuario.',
      inputSchema: obj({ id: T_ID, asignacion: T_ASG }) },
    { name: 'restaurar_version', title: 'Restaurar versión', annotations: RW,
      description: 'Vuelve el tablero a una versión anterior (de historial_tablero). Antes guarda la versión actual, así también se puede deshacer.',
      inputSchema: obj({ id: T_ID, asignacion: T_ASG, version: { type: 'integer', description: 'Número de versión de historial_tablero.' } }, ['version']) },
    // --- Etapa 3: usuarios, asignaciones y borrar tableros (cambian lo que ve un usuario: confirmar antes) ---
    { name: 'crear_usuario', title: 'Crear usuario', annotations: RW,
      description: 'Da de alta un usuario (persona que se comunica con MiraVoz) y devuelve su código para vincular la tablet (vence en 7 días).',
      inputSchema: obj({ nombre: { type: 'string' } }, ['nombre']) },
    { name: 'generar_codigo', title: 'Generar código de vinculación', annotations: RW,
      description: 'Genera un código nuevo para vincular la tablet de un usuario (invalida el anterior no usado; vence en 7 días). Mostrarlo solo si la persona lo pidió.',
      inputSchema: obj({ usuario: T_USER }, ['usuario']) },
    { name: 'asignar_tablero', title: 'Asignar tablero', annotations: RW,
      description: 'Le da a uno o más usuarios una COPIA de un tablero (el original queda libre para seguir editándolo). Confirmar antes con la persona.',
      inputSchema: obj({ tablero: T_ID, usuarios: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 30 }, permiso: PERM, inicio: { type: 'boolean', description: 'true = que sea su tablero de inicio.' } }, ['tablero', 'usuarios']) },
    { name: 'quitar_asignacion', title: 'Quitar asignación', annotations: RWD,
      description: 'Le saca a un usuario su copia de un tablero (se guarda una versión antes). Confirmar antes con la persona.',
      inputSchema: obj({ asignacion: { type: 'string', description: 'Id de la asignación (de ver_usuario).' } }, ['asignacion']) },
    { name: 'cambiar_permiso', title: 'Cambiar permiso', annotations: RW,
      description: 'Cambia si la copia de un usuario se puede editar en su tablet.',
      inputSchema: obj({ asignacion: { type: 'string' }, permiso: PERM }, ['asignacion', 'permiso']) },
    { name: 'elegir_tablero_inicio', title: 'Elegir tablero de inicio', annotations: RW,
      description: 'Define cuál de sus copias abre la tablet del usuario al empezar (o ninguna).',
      inputSchema: obj({ usuario: T_USER, asignacion: { type: ['string', 'null'], description: 'Id de la asignación, o null para ninguna.' } }, ['usuario', 'asignacion']) },
    { name: 'actualizar_copia', title: 'Actualizar copia del usuario', annotations: RWD,
      description: 'Reemplaza la copia de un usuario por la versión actual del tablero original (después de mejorarlo). Si la copia era editable, se pierden los cambios hechos en ella (quedan en historial_tablero con la asignación). Confirmar antes con la persona.',
      inputSchema: obj({ asignacion: { type: 'string' } }, ['asignacion']) },
    { name: 'borrar_tablero', title: 'Borrar tablero', annotations: RWD,
      description: 'Borra un tablero de la cuenta (se guarda una versión antes). Los usuarios que tenían una copia la conservan. Confirmar antes con la persona.',
      inputSchema: obj({ id: T_ID }, ['id']) }
];

export const TOOLS = [
    {
        name: 'quien_soy',
        title: 'Cuenta conectada',
        description: 'Muestra con qué cuenta registrada de MiraVoz está conectado Claude (nombre y correo).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: RO
    },
    {
        name: 'listar_tableros',
        title: 'Listar tableros',
        description: 'Lista los tableros de comunicación (CAA) de la cuenta: id, nombre, etiquetas y última modificación. Usar el id con ver_tablero.',
        inputSchema: {
            type: 'object',
            properties: {
                buscar: { type: 'string', description: 'Texto para filtrar por nombre (opcional).' },
                etiqueta: { type: 'string', description: 'Mostrar solo los tableros con esta etiqueta (opcional).' }
            },
            additionalProperties: false
        },
        annotations: RO
    },
    {
        name: 'ver_tablero',
        title: 'Ver tablero',
        description: 'Describe un tablero: sus páginas (la de inicio primero), la grilla de cada página y cada celda con su texto, lo que dice, su color (categoría Fitzgerald), el pictograma de ARASAAC y a qué página lleva si navega.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Id del tablero (de listar_tableros).' },
                asignacion: { type: 'string', description: 'En lugar de id: la copia de un usuario (id de asignación de ver_usuario).' },
                pagina: { type: 'string', description: 'Nombre o id de una página para ver solo esa (opcional).' }
            },
            additionalProperties: false
        },
        annotations: RO
    },
    {
        name: 'listar_usuarios',
        title: 'Listar usuarios',
        description: 'Lista los usuarios (personas que se comunican con MiraVoz) de la cuenta, con cuántos tableros tienen asignados y si su tablet está vinculada.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: RO
    },
    {
        name: 'ver_usuario',
        title: 'Ver usuario',
        description: 'Muestra los tableros asignados a un usuario: nombre, permiso (solo uso o editable), cuál es su tablero de inicio y cuándo se actualizó.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'Id del usuario (de listar_usuarios).' } },
            required: ['id'],
            additionalProperties: false
        },
        annotations: RO
    },
    {
        name: 'buscar_pictogramas',
        title: 'Buscar pictogramas',
        description: 'Busca pictogramas de ARASAAC en español por palabra. Devuelve el id, las palabras asociadas y la URL de la imagen. Pictogramas: Sergio Palao, ARASAAC (Gobierno de Aragón), licencia CC BY-NC-SA.',
        inputSchema: {
            type: 'object',
            properties: {
                palabra: { type: 'string', description: 'Palabra a buscar, por ejemplo "agua" o "baño".' },
                cantidad: { type: 'integer', minimum: 1, maximum: 20, description: 'Cuántos resultados (por defecto 8).' }
            },
            required: ['palabra'],
            additionalProperties: false
        },
        annotations: { ...RO, openWorldHint: true }
    }
];
TOOLS.push(...WRITE_TOOLS);

// --- Descripción de un tablero (pura) ---

const COLOR_NAMES = E.COLOR_LABELS;

function cellImage(el) {
    const url = el?.image?.url || '';
    const id = arasaacIdFromUrl(url);
    if (id) return { arasaac_id: id };
    if (el?.image?.data || /^data:/.test(url)) return { imagen: 'propia' };
    if (/^https?:/i.test(url)) return { imagen: 'url' };
    return null;
}

function cellSpeech(el) {
    const custom = (el.actions || []).find(a => a.modelName === 'GridActionSpeakCustom');
    if (custom) return labelText(custom.speakText) || '';
    const speaks = (el.actions || []).some(a => a.modelName === 'GridActionSpeak');
    return speaks ? null : undefined; // null = dice el texto; undefined = no habla (o es especial)
}

export function describeBoard(row, { pagina, base } = {}) {
    const bundle = row.bundle || {};
    const boards = bundle.boards || {};
    const order = pageOrder(bundle);
    const nameOf = (id) => gridName(boards[id]) || id;
    let pages = order;
    if (pagina) {
        const q = String(pagina).toLocaleLowerCase('es');
        pages = order.filter(id => id === pagina || nameOf(id).toLocaleLowerCase('es') === q);
        if (!pages.length) pages = order.filter(id => nameOf(id).toLocaleLowerCase('es').includes(q));
    }
    let budget = MAX_CELLS, truncated = false;
    const out = pages.map(id => {
        const g = boards[id] || {};
        const els = [...(g.gridElements || [])].sort((a, b) => (a.y - b.y) || (a.x - b.x));
        const cols = Math.max(1, g.minColumnCount || 1, ...els.map(e => (e.x || 0) + (e.width || 1)));
        const rows = Math.max(1, g.rowCount || 1, ...els.map(e => (e.y || 0) + (e.height || 1)));
        const cells = [];
        for (const el of els) {
            if (budget <= 0) { truncated = true; break; }
            budget--;
            const c = { fila: (el.y || 0) + 1, columna: (el.x || 0) + 1 };
            const text = labelText(el.label) || el.autoLabel || '';
            if (text) c.texto = text;
            if ((el.width || 1) > 1 || (el.height || 1) > 1) c.tamano = `${el.width || 1}x${el.height || 1}`;
            const sp = cellSpeech(el);
            if (typeof sp === 'string' && sp !== text) c.dice = sp;
            if (sp === undefined && !(el.actions || []).length) c.silenciosa = true;
            if (el.colorCategory) c.color = COLOR_NAMES[el.colorCategory] || el.colorCategory;
            const img = cellImage(el);
            if (img) Object.assign(c, img);
            const nav = navInfo(el, bundle);
            if (nav) c.navega = nav.kind === 'grid' ? (nav.broken ? 'vínculo roto' : nameOf(nav.target)) : nav.kind === 'back' ? 'volver' : nav.kind === 'home' ? 'inicio' : nav.kind;
            if (el.hidden) c.oculta = true;
            cells.push(c);
        }
        return { id, nombre: nameOf(id), inicio: id === bundle.mainBoard, filas: rows, columnas: cols, celdas: cells };
    });
    return {
        id: row.id, nombre: row.name, actualizado: row.updated_at,
        etiquetas: Array.isArray(bundle.tags) ? bundle.tags : [],
        cantidad_paginas: order.length,
        ...(base ? { abrir_en_miravoz: openUrl(base, row.id) } : {}),
        paginas: out,
        ...(truncated ? { aviso: `Se muestran las primeras ${MAX_CELLS} celdas. Pedí una página con el parámetro "pagina".` } : {})
    };
}

export const openUrl = (base, id, page) => `${base}/?tablero=${encodeURIComponent(id)}${page ? `&pagina=${encodeURIComponent(page)}` : ''}`;

// --- JSON-RPC ---

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const toolText = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }], structuredContent: Array.isArray(data) ? { items: data } : data });
const toolError = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

/**
 * Procesa UN mensaje JSON-RPC. ctx = { db } (adaptador a Supabase con el token de la cuenta).
 * Devuelve la respuesta, o null para notificaciones (sin id).
 */
export async function handle(msg, ctx) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return err(msg?.id, -32600, 'Pedido inválido');
    const isNotification = msg.id === undefined || msg.id === null;
    try {
        switch (msg.method) {
            case 'initialize': {
                const asked = msg.params?.protocolVersion;
                return ok(msg.id, {
                    protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: SERVER_INFO,
                    instructions: INSTRUCTIONS
                });
            }
            case 'notifications/initialized':
            case 'notifications/cancelled':
                return null;
            case 'ping':
                return ok(msg.id, {});
            case 'tools/list':
                return ok(msg.id, { tools: TOOLS });
            case 'tools/call': {
                const name = msg.params?.name;
                const args = msg.params?.arguments || {};
                if (!TOOLS.some(t => t.name === name)) return err(msg.id, -32602, `Herramienta desconocida: ${name}`);
                return ok(msg.id, await callTool(name, args, ctx));
            }
            default:
                return isNotification ? null : err(msg.id, -32601, `Método no soportado: ${msg.method}`);
        }
    } catch (e) {
        return isNotification ? null : err(msg.id, -32603, 'Error interno');
    }
}

export async function callTool(name, args, ctx) {
    const { db } = ctx;
    if (WRITE_TOOLS.some(t => t.name === name)) return writeTool(name, args, ctx);
    switch (name) {
        case 'quien_soy': {
            const u = await db.user();
            return toolText({ nombre: u.user_metadata?.full_name || u.user_metadata?.name || null, correo: u.email });
        }
        case 'listar_tableros': {
            const rows = await db.select('boards', 'select=id,name,updated_at,tags:bundle->tags&order=updated_at.desc');
            let list = rows.map(r => ({ id: r.id, nombre: r.name, etiquetas: Array.isArray(r.tags) ? r.tags : [], actualizado: r.updated_at }));
            if (args.buscar) { const q = String(args.buscar).toLocaleLowerCase('es'); list = list.filter(b => String(b.nombre).toLocaleLowerCase('es').includes(q)); }
            if (args.etiqueta) { const q = String(args.etiqueta).toLocaleLowerCase('es'); list = list.filter(b => b.etiquetas.some(t => String(t).toLocaleLowerCase('es') === q)); }
            return toolText({ cantidad: list.length, tableros: list });
        }
        case 'ver_tablero': {
            if (args.asignacion) {
                const a = await db.select('assignments', `select=id,copy_bundle,copy_updated_at&id=eq.${encodeURIComponent(args.asignacion)}`);
                if (!a.length) return toolError('No hay una asignación con ese id en esta cuenta.');
                const d = describeBoard({ id: a[0].id, name: a[0].copy_bundle?.name, updated_at: a[0].copy_updated_at, bundle: a[0].copy_bundle || {} }, { pagina: args.pagina });
                return toolText({ ...d, es_copia_de_usuario: true, abrir_en_miravoz: `${ctx.base}/?copia=${encodeURIComponent(a[0].id)}` });
            }
            if (!args.id) return toolError('Falta el id del tablero.');
            const rows = await db.select('boards', `select=id,name,updated_at,bundle&id=eq.${encodeURIComponent(args.id)}`);
            if (!rows.length) return toolError('No hay un tablero con ese id en esta cuenta.');
            return toolText(describeBoard(rows[0], { pagina: args.pagina, base: ctx.base }));
        }
        case 'listar_usuarios': {
            const [users, asg, devs] = await Promise.all([
                db.select('aac_users', 'select=id,display_name,created_at,home_board_id&order=created_at.asc'),
                db.select('assignments', 'select=aac_user_id'),
                db.select('device_tokens', 'select=aac_user_id').catch(() => [])
            ]);
            const count = (list, id) => list.filter(a => a.aac_user_id === id).length;
            return toolText({ cantidad: users.length, usuarios: users.map(u => ({ id: u.id, nombre: u.display_name, tableros_asignados: count(asg, u.id), tablet_vinculada: count(devs, u.id) > 0, creado: u.created_at })) });
        }
        case 'ver_usuario': {
            if (!args.id) return toolError('Falta el id del usuario.');
            const id = encodeURIComponent(args.id);
            const users = await db.select('aac_users', `select=id,display_name,home_board_id&id=eq.${id}`);
            if (!users.length) return toolError('No hay un usuario con ese id en esta cuenta.');
            const u = users[0];
            const asg = await db.select('assignments', `select=id,board_id,permission,copy_updated_at,assigned_at,name:copy_bundle->>name&aac_user_id=eq.${id}&order=assigned_at.asc`);
            return toolText({
                id: u.id, nombre: u.display_name,
                tableros: asg.map(a => ({ asignacion: a.id, nombre: a.name || 'Tablero sin nombre', permiso: a.permission === 'editable' ? 'editable' : 'solo uso', inicio: a.id === u.home_board_id, tablero_original: a.board_id || null, actualizado: a.copy_updated_at }))
            });
        }
        case 'buscar_pictogramas': {
            const word = String(args.palabra || '').trim();
            if (!word) return toolError('Falta la palabra a buscar.');
            const n = Math.max(1, Math.min(20, Number(args.cantidad) || 8));
            const found = await db.arasaac(word);
            const list = (Array.isArray(found) ? found : []).slice(0, n).map(p => ({
                arasaac_id: p._id,
                palabras: (p.keywords || []).map(k => k.keyword).filter(Boolean).slice(0, 5),
                imagen: `https://static.arasaac.org/pictograms/${p._id}/${p._id}_500.png`
            }));
            return toolText({ cantidad: list.length, pictogramas: list, atribucion: 'Pictogramas: Sergio Palao. Origen: ARASAAC (http://www.arasaac.org). Licencia: CC (BY-NC-SA). Propiedad: Gobierno de Aragón (España).' });
        }
    }
    return toolError('Herramienta no disponible.');
}

// --- Etapa 2: escritura ---
// Cada cambio: 1) lee la fila, 2) aplica el cambio en memoria (_edit.js), 3) guarda la versión ANTERIOR en
// board_versions (si no se puede, NO se escribe: ningún dato se pierde), 4) escribe con concurrencia optimista
// (solo si la fila sigue como se leyó; si otro dispositivo guardó en el medio, se reintenta). La app de MiraVoz
// detecta la versión nueva (updatedAt/syncedAt) y la baja sola.

async function resolvePictograms(cells, db) {
    const chosen = [];
    for (const c of cells) {
        if (c.pictograma === undefined || c.pictograma === null || c.pictograma === '') continue;
        if (/^\d+$/.test(String(c.pictograma))) { c.pictograma_id = Number(c.pictograma); continue; }
        const found = await db.arasaac(String(c.pictograma).trim());
        if (Array.isArray(found) && found.length) {
            c.pictograma_id = found[0]._id;
            chosen.push({ fila: c.fila, columna: c.columna, buscado: c.pictograma, arasaac_id: found[0]._id, palabra: pickArasaacKeyword(found[0].keywords) });
        } else chosen.push({ fila: c.fila, columna: c.columna, buscado: c.pictograma, arasaac_id: null, aviso: 'sin resultados: la celda quedó sin pictograma' });
    }
    return chosen;
}

/** Guarda la versión anterior: primero con la función del servidor (09), si no existe con INSERT directo (07/08). */
async function saveVersion(db, boardId, bundle, note) {
    try { await db.rpc('save_board_version', { p_board_id: boardId, p_bundle: bundle, p_note: note }); return; }
    catch (err) { if (err.status !== 404) throw err; }
    await db.insert('board_versions', { board_id: boardId, bundle, source: 'claude', note });
}

async function mutateBoard(ctx, id, note, fn) {
    const { db, user } = ctx;
    for (let attempt = 0; attempt < 3; attempt++) {
        const rows = await db.select('boards', `select=id,name,updated_at,bundle&id=eq.${encodeURIComponent(id)}`);
        if (!rows.length) throw new E.EditError('No hay un tablero con ese id en esta cuenta.');
        const row = rows[0];
        const bundle = JSON.parse(JSON.stringify(row.bundle || {}));
        if (!bundle.boards) throw new E.EditError('El tablero no tiene páginas.');
        const result = await fn(bundle);
        try { await saveVersion(db, id, row.bundle, note); }
        catch (err) { throw new E.EditError(`No se pudo guardar la versión de respaldo, así que no se hizo el cambio. ¿Falta correr supabase/07_versiones_de_tableros.sql? (detalle: ${err.message})`); }
        const now = Math.max(Date.now(), (row.bundle?.updatedAt || 0) + 1);
        Object.assign(bundle, { id, ownerId: user.id, updatedAt: now, syncedAt: now, speechModel: bundle.speechModel || 'actions' });
        delete bundle.__predExtra;
        const written = await db.patch('boards', `id=eq.${encodeURIComponent(id)}&updated_at=eq.${encodeURIComponent(row.updated_at)}`,
            { name: bundle.name || row.name, bundle, updated_at: new Date(now).toISOString() });
        if (written.length) return { result, bundle };
    }
    throw new E.EditError('El tablero se estaba guardando desde otro dispositivo. Probá de nuevo en unos segundos.');
}

// --- Etapa 3: copias de usuarios (assignments.copy_bundle) ---
const COPY_META = ['assignmentId', 'permission', 'copyUpdatedAt', 'dirty', 'bundleId', 'profEdit', 'ownerLabel', 'ownerId', 'syncedAt', '__predExtra'];
export function cleanCopy(bundle) { const out = JSON.parse(JSON.stringify(bundle || {})); COPY_META.forEach(k => delete out[k]); return out; }
const tgt = (args) => (args.asignacion ? { kind: 'copy', id: String(args.asignacion) } : { kind: 'board', id: String(args.tablero ?? args.id ?? '') });
const versionKey = (t) => (t.kind === 'copy' ? `copia:${t.id}` : t.id);
const openTarget = (base, t, page) => (t.kind === 'copy' ? `${base}/?copia=${encodeURIComponent(t.id)}` : openUrl(base, t.id, page));

async function mutateCopy(ctx, asgId, note, fn) {
    const { db } = ctx;
    for (let attempt = 0; attempt < 3; attempt++) {
        const rows = await db.select('assignments', `select=id,copy_bundle,copy_updated_at&id=eq.${encodeURIComponent(asgId)}`);
        if (!rows.length) throw new E.EditError('No hay una asignación con ese id en esta cuenta.');
        const row = rows[0];
        const bundle = JSON.parse(JSON.stringify(row.copy_bundle || {}));
        if (!bundle.boards) throw new E.EditError('La copia no tiene páginas.');
        const result = await fn(bundle);
        try { await saveVersion(db, `copia:${asgId}`, row.copy_bundle, note); }
        catch (err) { throw new E.EditError(`No se pudo guardar la versión de respaldo de la copia, así que no se hizo el cambio. ¿Falta correr supabase/09_guardar_version_rpc.sql? (detalle: ${err.message})`); }
        const stamp = new Date(Math.max(Date.now(), Date.parse(row.copy_updated_at || 0) + 1)).toISOString();
        const written = await db.patch('assignments', `id=eq.${encodeURIComponent(asgId)}&copy_updated_at=eq.${encodeURIComponent(row.copy_updated_at)}`,
            { copy_bundle: cleanCopy(bundle), copy_updated_at: stamp });
        if (written.length) return { result, bundle };
    }
    throw new E.EditError('La copia se estaba guardando desde la tablet del usuario. Probá de nuevo en unos segundos.');
}
const mutate = (ctx, t, note, fn) => {
    if (!t.id) throw new E.EditError('Falta indicar el tablero (o la asignación).');
    return t.kind === 'copy' ? mutateCopy(ctx, t.id, note, fn) : mutateBoard(ctx, t.id, note, fn);
};
const permValue = (p) => (p === 'editable' ? 'editable' : 'read_only');
const formatCode = (c) => (c && c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c);

async function writeTool(name, args, ctx) {
    const { db, user, base } = ctx;
    try {
        switch (name) {
            case 'crear_tablero': {
                const b = E.newBundle(args);
                const now = Date.now();
                Object.assign(b, { ownerId: user.id, updatedAt: now, syncedAt: now });
                await db.insert('boards', { id: b.id, owner_professional_id: user.id, name: b.name, bundle: b, updated_at: new Date(now).toISOString() });
                return toolText({ creado: true, id: b.id, nombre: b.name, pagina_inicio: { id: b.mainBoard, filas: b.boards[b.mainBoard].rowCount, columnas: b.boards[b.mainBoard].minColumnCount }, abrir_en_miravoz: openUrl(base, b.id) });
            }
            case 'duplicar_tablero': {
                const rows = await db.select('boards', `select=id,name,bundle&id=eq.${encodeURIComponent(args.id)}`);
                if (!rows.length) return toolError('No hay un tablero con ese id en esta cuenta.');
                const b = E.duplicateBundle(rows[0].bundle, args.nombre);
                const now = Date.now();
                Object.assign(b, { ownerId: user.id, updatedAt: now, syncedAt: now });
                await db.insert('boards', { id: b.id, owner_professional_id: user.id, name: b.name, bundle: b, updated_at: new Date(now).toISOString() });
                return toolText({ creado: true, id: b.id, nombre: b.name, paginas: Object.keys(b.boards).length, abrir_en_miravoz: openUrl(base, b.id) });
            }
            case 'editar_tablero': {
                const { result } = await mutateBoard(ctx, args.id, 'renombrar/etiquetas', (b) => {
                    const out = {};
                    if (args.nombre !== undefined) { const n = String(args.nombre).trim().slice(0, 60); if (!n) throw new E.EditError('El nombre no puede quedar vacío.'); b.name = n; out.nombre = n; }
                    if (args.etiquetas !== undefined) { b.tags = E.cleanTags(args.etiquetas); out.etiquetas = b.tags; }
                    return out;
                });
                return toolText({ ok: true, ...result, abrir_en_miravoz: openUrl(base, args.id) });
            }
            case 'agregar_pagina': {
                const { result } = await mutate(ctx, tgt(args), 'agregar página', (b) => E.addPage(b, args));
                return toolText({ ok: true, pagina: result, abrir_en_miravoz: openTarget(base, tgt(args), result.id) });
            }
            case 'editar_pagina': {
                let pid;
                const { result } = await mutate(ctx, tgt(args), 'editar página', (b) => { pid = E.resolvePage(b, args.pagina); return E.editPage(b, pid, args); });
                return toolText({ ok: true, pagina: pid, ...result, abrir_en_miravoz: openTarget(base, tgt(args), pid) });
            }
            case 'borrar_pagina': {
                const { result } = await mutate(ctx, tgt(args), 'borrar página', (b) => E.deletePage(b, E.resolvePage(b, args.pagina)));
                return toolText({ ok: true, ...result, se_puede_deshacer: 'historial_tablero + restaurar_version' });
            }
            case 'poner_celdas': {
                const cells = (args.celdas || []).map(c => ({ ...c }));
                if (!cells.length) return toolError('No se indicó ninguna celda.');
                if (cells.length > E.LIMITS.maxCellsPerCall) return toolError(`Hasta ${E.LIMITS.maxCellsPerCall} celdas por llamada.`);
                const pics = await resolvePictograms(cells, db);
                let pid;
                const { result } = await mutate(ctx, tgt(args), `poner ${cells.length} celda(s)`, (b) => {
                    pid = E.resolvePage(b, args.pagina);
                    return cells.map(c => E.setCell(b, pid, c));
                });
                const nuevas = result.filter(r => r.pagina_nueva).map(r => r.pagina_nueva);
                return toolText({ ok: true, pagina: pid, creadas: result.filter(r => r.creada).length, modificadas: result.filter(r => !r.creada).length,
                    grilla_ampliada: result.some(r => r.grilla_ampliada), ...(nuevas.length ? { paginas_nuevas: nuevas } : {}), ...(pics.length ? { pictogramas: pics } : {}),
                    abrir_en_miravoz: openTarget(base, tgt(args), pid) });
            }
            case 'mover_celda': {
                let pid;
                const { result } = await mutate(ctx, tgt(args), 'mover celda', (b) => { pid = E.resolvePage(b, args.pagina); return E.moveCell(b, pid, args.desde, args.hasta); });
                return toolText({ ok: true, ...result, abrir_en_miravoz: openTarget(base, tgt(args), pid) });
            }
            case 'borrar_celdas': {
                let pid;
                const { result } = await mutate(ctx, tgt(args), `borrar ${args.celdas?.length || 0} celda(s)`, (b) => { pid = E.resolvePage(b, args.pagina); return (args.celdas || []).map(c => E.clearCell(b, pid, c.fila, c.columna)); });
                return toolText({ ok: true, borradas: result.map(r => r.borrada), se_puede_deshacer: 'historial_tablero + restaurar_version', abrir_en_miravoz: openTarget(base, tgt(args), pid) });
            }
            case 'revisar_tablero': {
                const t = tgt(args);
                const rows = t.kind === 'copy'
                    ? (await db.select('assignments', `select=id,copy_bundle&id=eq.${encodeURIComponent(t.id)}`)).map(r => ({ name: r.copy_bundle?.name, bundle: r.copy_bundle }))
                    : await db.select('boards', `select=id,name,bundle&id=eq.${encodeURIComponent(t.id)}`);
                if (!rows.length) return toolError('No hay un tablero (o copia) con ese id en esta cuenta.');
                return toolText({ tablero: rows[0].name, ...E.reviewBundle(rows[0].bundle || {}), abrir_en_miravoz: openTarget(base, t) });
            }
            case 'historial_tablero': {
                const v = await db.select('board_versions', `select=id,created_at,source,note&board_id=eq.${encodeURIComponent(versionKey(tgt(args)))}&order=created_at.desc&limit=30`);
                return toolText({ cantidad: v.length, versiones: v.map(x => ({ version: x.id, fecha: x.created_at, origen: x.source, cambio_que_vino_despues: x.note })) });
            }
            case 'restaurar_version': {
                const t = tgt(args);
                const v = await db.select('board_versions', `select=id,bundle&board_id=eq.${encodeURIComponent(versionKey(t))}&id=eq.${Number(args.version)}`);
                if (!v.length) return toolError('No hay esa versión para este tablero.');
                const old = v[0].bundle;
                if (t.kind === 'board' && !(await db.select('boards', `select=id&id=eq.${encodeURIComponent(t.id)}`)).length) {
                    // El tablero se había borrado: se vuelve a crear desde esa versión
                    const now = Date.now();
                    const b = { ...cleanCopy(old), id: t.id, ownerId: user.id, updatedAt: now, syncedAt: now };
                    await db.insert('boards', { id: t.id, owner_professional_id: user.id, name: b.name || 'Tablero recuperado', bundle: b, updated_at: new Date(now).toISOString() });
                    return toolText({ ok: true, recuperado: b.name, abrir_en_miravoz: openUrl(base, t.id) });
                }
                await mutate(ctx, t, `restaurar versión ${args.version}`, (b) => {
                    for (const k of Object.keys(b)) delete b[k];
                    Object.assign(b, JSON.parse(JSON.stringify(old)));
                    return {};
                });
                return toolText({ ok: true, restaurada: Number(args.version), abrir_en_miravoz: openTarget(base, t) });
            }
            case 'crear_usuario': {
                const n = String(args.nombre || '').trim().slice(0, 60);
                if (!n) return toolError('Falta el nombre del usuario.');
                const [u] = await db.insertReturning('aac_users', { professional_id: user.id, display_name: n });
                let code = null;
                try { code = await db.rpc('create_access_code', { p_aac_user_id: u.id }); } catch { /* el usuario queda creado igual */ }
                return toolText({ creado: true, id: u.id, nombre: n, ...(code ? { codigo_de_vinculacion: formatCode(code.code), vence: code.expires_at } : { aviso: 'No se pudo generar el código: usar generar_codigo.' }) });
            }
            case 'generar_codigo': {
                const c = await db.rpc('create_access_code', { p_aac_user_id: args.usuario }).catch(() => null);
                if (!c || !c.code) return toolError('No se pudo generar el código (¿el usuario es de esta cuenta?).');
                return toolText({ codigo_de_vinculacion: formatCode(c.code), vence: c.expires_at, como_usar: 'En la tablet: www.miravoz.com.ar → "Vincular esta tablet con un código".' });
            }
            case 'asignar_tablero': {
                const rows = await db.select('boards', `select=id,name,bundle&id=eq.${encodeURIComponent(args.tablero)}`);
                if (!rows.length) return toolError('No hay un tablero con ese id en esta cuenta.');
                const ids = [...new Set((args.usuarios || []).map(String))];
                const users = await db.select('aac_users', `select=id,display_name&id=in.(${ids.map(encodeURIComponent).join(',')})`);
                if (users.length !== ids.length) return toolError('Alguno de esos usuarios no es de esta cuenta.');
                const already = await db.select('assignments', `select=aac_user_id&board_id=eq.${encodeURIComponent(args.tablero)}`);
                const dup = users.filter(u => already.some(a => a.aac_user_id === u.id));
                if (dup.length) return toolError(`${dup.map(u => u.display_name).join(', ')} ya tiene una copia de «${rows[0].name}». Para darle la versión nueva usar actualizar_copia.`);
                const copy = cleanCopy(rows[0].bundle);
                const created = await db.insertReturning('assignments', ids.map(id => ({ board_id: args.tablero, aac_user_id: id, copy_bundle: copy, permission: permValue(args.permiso) })), 'id,aac_user_id');
                if (args.inicio) for (const a of created) await db.patch('aac_users', `id=eq.${encodeURIComponent(a.aac_user_id)}`, { home_board_id: a.id });
                return toolText({ ok: true, tablero: rows[0].name, permiso: permValue(args.permiso) === 'editable' ? 'editable' : 'solo uso',
                    asignaciones: created.map(a => ({ usuario: users.find(u => u.id === a.aac_user_id)?.display_name, asignacion: a.id, inicio: !!args.inicio })),
                    nota: 'La tablet del usuario lo recibe al abrirse o al recuperar la conexión.' });
            }
            case 'quitar_asignacion': {
                const a = await db.select('assignments', `select=id,copy_bundle&id=eq.${encodeURIComponent(args.asignacion)}`);
                if (!a.length) return toolError('No hay una asignación con ese id en esta cuenta.');
                try { await saveVersion(db, `copia:${a[0].id}`, a[0].copy_bundle, 'quitar asignación'); }
                catch { return toolError('No se pudo guardar la versión de respaldo de la copia, así que no se quitó. ¿Falta correr supabase/09_guardar_version_rpc.sql?'); }
                await db.del('assignments', `id=eq.${encodeURIComponent(a[0].id)}`);
                return toolText({ ok: true, quitado: a[0].copy_bundle?.name || 'tablero', nota: 'Si era su tablero de inicio, la tablet queda sin tablero de inicio.' });
            }
            case 'cambiar_permiso': {
                const w = await db.patch('assignments', `id=eq.${encodeURIComponent(args.asignacion)}`, { permission: permValue(args.permiso) });
                if (!w.length) return toolError('No hay una asignación con ese id en esta cuenta.');
                return toolText({ ok: true, permiso: permValue(args.permiso) === 'editable' ? 'editable' : 'solo uso' });
            }
            case 'elegir_tablero_inicio': {
                if (args.asignacion) {
                    const a = await db.select('assignments', `select=id,aac_user_id&id=eq.${encodeURIComponent(args.asignacion)}`);
                    if (!a.length || a[0].aac_user_id !== args.usuario) return toolError('Esa asignación no es de ese usuario.');
                }
                const w = await db.patch('aac_users', `id=eq.${encodeURIComponent(args.usuario)}`, { home_board_id: args.asignacion || null });
                if (!w.length) return toolError('No hay un usuario con ese id en esta cuenta.');
                return toolText({ ok: true, inicio: args.asignacion || null });
            }
            case 'actualizar_copia': {
                const a = await db.select('assignments', `select=id,board_id&id=eq.${encodeURIComponent(args.asignacion)}`);
                if (!a.length) return toolError('No hay una asignación con ese id en esta cuenta.');
                if (!a[0].board_id) return toolError('El tablero original de esta copia se borró: no hay de dónde actualizarla.');
                const o = await db.select('boards', `select=id,name,bundle&id=eq.${encodeURIComponent(a[0].board_id)}`);
                if (!o.length) return toolError('No se encontró el tablero original.');
                const fresh = cleanCopy(o[0].bundle);
                await mutateCopy(ctx, a[0].id, 'actualizar desde el original', (b) => { for (const k of Object.keys(b)) delete b[k]; Object.assign(b, fresh); return {}; });
                return toolText({ ok: true, actualizada: o[0].name, se_puede_deshacer: 'historial_tablero y restaurar_version con la asignación', nota: 'La tablet la recibe al abrirse o al recuperar la conexión.' });
            }
            case 'borrar_tablero': {
                const rows = await db.select('boards', `select=id,name,bundle&id=eq.${encodeURIComponent(args.id)}`);
                if (!rows.length) return toolError('No hay un tablero con ese id en esta cuenta.');
                try { await saveVersion(db, rows[0].id, rows[0].bundle, 'borrar tablero'); }
                catch { return toolError('No se pudo guardar la versión de respaldo, así que no se borró.'); }
                const copies = await db.select('assignments', `select=id&board_id=eq.${encodeURIComponent(rows[0].id)}`);
                await db.del('boards', `id=eq.${encodeURIComponent(rows[0].id)}`);
                return toolText({ ok: true, borrado: rows[0].name, copias_que_se_conservan: copies.length, recuperar: 'historial_tablero y restaurar_version con el mismo id lo vuelven a crear.' });
            }
        }
    } catch (e) {
        if (e instanceof E.EditError) return toolError(e.message);
        throw e;
    }
    return toolError('Herramienta no disponible.');
}

/** Adaptador real: PostgREST y Auth de Supabase con el token de la cuenta; ARASAAC público. */
export function supabaseDb({ url, anonKey, token, fetchImpl = fetch }) {
    const headers = { apikey: anonKey, Authorization: `Bearer ${token}`, Accept: 'application/json' };
    return {
        async user() {
            const r = await fetchImpl(`${url}/auth/v1/user`, { headers });
            if (!r.ok) throw Object.assign(new Error('auth'), { status: r.status });
            return r.json();
        },
        async select(table, query) {
            const r = await fetchImpl(`${url}/rest/v1/${table}?${query}`, { headers });
            if (!r.ok) throw Object.assign(new Error(`db ${table}`), { status: r.status });
            return r.json();
        },
        async insert(table, row) {
            const r = await fetchImpl(`${url}/rest/v1/${table}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(row) });
            if (!r.ok) { const t = await r.text().catch(() => ''); throw Object.assign(new Error(`insert ${table}: ${r.status} ${t.slice(0, 200)}`), { status: r.status }); }
            return true;
        },
        async insertReturning(table, rows, select = 'id') {
            const r = await fetchImpl(`${url}/rest/v1/${table}?select=${select}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(rows) });
            if (!r.ok) throw Object.assign(new Error(`insert ${table}`), { status: r.status });
            const data = await r.json();
            return Array.isArray(data) ? data : [data];
        },
        async del(table, filter) {
            const r = await fetchImpl(`${url}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers });
            if (!r.ok) throw Object.assign(new Error(`delete ${table}`), { status: r.status });
            return true;
        },
        async patch(table, filter, values) {
            const r = await fetchImpl(`${url}/rest/v1/${table}?${filter}&select=id`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(values) });
            if (!r.ok) throw Object.assign(new Error(`patch ${table}`), { status: r.status });
            const data = await r.json();
            return (Array.isArray(data) ? data : []).map(x => ({ id: x.id }));
        },
        async rpc(fn, body = {}) {
            const r = await fetchImpl(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!r.ok) { const t = await r.text().catch(() => ''); throw Object.assign(new Error(`rpc ${fn}: ${r.status} ${t.slice(0, 200)}`), { status: r.status }); }
            return r.json();
        },
        async arasaac(word) {
            const r = await fetchImpl(`https://api.arasaac.org/api/pictograms/es/search/${encodeURIComponent(word)}`);
            if (r.status === 404) return [];
            if (!r.ok) throw new Error('arasaac');
            return r.json();
        }
    };
}
