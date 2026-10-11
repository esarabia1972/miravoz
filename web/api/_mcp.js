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
import { pageOrder, gridName, arasaacIdFromUrl } from '../js/pages.js';

export const SERVER_INFO = { name: 'miravoz', title: 'MiraVoz', version: '1.6.0' };
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const MAX_CELLS = 400; // por respuesta de ver_tablero (las páginas grandes se paginan)

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

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
                pagina: { type: 'string', description: 'Nombre o id de una página para ver solo esa (opcional).' }
            },
            required: ['id'],
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

// --- Descripción de un tablero (pura) ---

const COLOR_NAMES = {
    CC_PRONOUN_PERSON_NAME: 'amarillo (personas/pronombres)', CC_VERB: 'verde (verbos)', CC_DESCRIPTOR: 'azul (descriptores)',
    CC_NOUN: 'naranja (sustantivos)', CC_SOCIAL_EXPRESSIONS: 'rosa (expresiones sociales)', CC_MISC: 'blanco (varios)',
    CC_PREPOSITION: 'violeta (preposiciones)', CC_QUESTION_NEGATION_PRONOUN: 'rojo (preguntas/negación)', CC_ADVERB: 'marrón (adverbios)',
    CC_CONJUNCTION: 'gris (conjunciones)', CC_ARTICLE: 'gris claro (artículos)', CC_IMPORTANT: 'rojo (importante)'
};

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

export function describeBoard(row, { pagina } = {}) {
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
        paginas: out,
        ...(truncated ? { aviso: `Se muestran las primeras ${MAX_CELLS} celdas. Pedí una página con el parámetro "pagina".` } : {})
    };
}

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
                    instructions: 'MiraVoz es una plataforma de comunicación aumentativa y alternativa (CAA). Estas herramientas leen los tableros y usuarios de la cuenta registrada conectada (por ahora solo lectura). Decir "usuario", nunca "paciente". Los usuarios suelen ser menores: no repetir sus datos fuera de lo necesario.'
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

export async function callTool(name, args, { db }) {
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
            if (!args.id) return toolError('Falta el id del tablero.');
            const rows = await db.select('boards', `select=id,name,updated_at,bundle&id=eq.${encodeURIComponent(args.id)}`);
            if (!rows.length) return toolError('No hay un tablero con ese id en esta cuenta.');
            return toolText(describeBoard(rows[0], { pagina: args.pagina }));
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
        async rpc(fn, body = {}) {
            const r = await fetchImpl(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!r.ok) throw Object.assign(new Error(`rpc ${fn}`), { status: r.status });
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
