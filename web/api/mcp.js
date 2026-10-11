// /mcp — Servidor MCP de MiraVoz (Streamable HTTP, sin sesión). La lógica vive en _mcp.js.
import { handle, supabaseDb } from './_mcp.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, baseUrl, CORS } from './_config.js';

const json = (body, status = 200, extra = {}) => new Response(body === null ? null : JSON.stringify(body), {
    status, headers: { ...CORS, ...(body === null ? {} : { 'Content-Type': 'application/json' }), 'Cache-Control': 'no-store', ...extra }
});

function unauthorized(request, error) {
    const meta = `${baseUrl(request)}/.well-known/oauth-protected-resource`;
    const challenge = `Bearer resource_metadata="${meta}"${error ? `, error="${error}"` : ''}`;
    return json({ error: error || 'unauthorized', error_description: 'Iniciá sesión con tu cuenta registrada de MiraVoz.' }, 401, { 'WWW-Authenticate': challenge });
}

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

// Sin flujo de eventos del servidor (no hay notificaciones que mandar): GET no aplica
export function GET() { return json({ error: 'Usar POST' }, 405, { Allow: 'POST, OPTIONS' }); }

export async function POST(request) {
    const auth = request.headers.get('authorization') || '';
    const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
    if (!token) return unauthorized(request);

    const db = supabaseDb({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, token });
    // Token válido y cuenta habilitada (misma regla que la app: supabase/06_cuentas_habilitadas.sql)
    let user;
    try { user = await db.user(); } catch { return unauthorized(request, 'invalid_token'); }
    try {
        const enabled = await db.rpc('account_enabled');
        if (enabled === false) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Cuenta no registrada en MiraVoz.' } }, 403);
    } catch { /* si la función no existe, rige RLS igual */ }

    let body;
    try { body = await request.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }, 400); }
    const msgs = Array.isArray(body) ? body : [body];
    const out = [];
    const ctx = { db, user, base: baseUrl(request) };
    for (const m of msgs) { const r = await handle(m, ctx); if (r) out.push(r); }
    if (!out.length) return json(null, 202);
    return json(Array.isArray(body) ? out : out[0]);
}
