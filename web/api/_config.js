// Configuración pública del servidor MCP (la anon key es pública por diseño: la seguridad es RLS).
export const SUPABASE_URL = 'https://bpcedvpcwwwgnfinqztq.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_dqFw8-mzNW88E5aRgG7WMw_byIf-pT1';
// Scopes estándar de Supabase Auth. Sin 'openid': el ID token exige claves asimétricas.
export const SCOPES = ['email', 'profile'];

/** Origen público con el que llegó el pedido (www.miravoz.com.ar, o el de una vista previa de Vercel). */
export function baseUrl(request) {
    const h = request.headers;
    const host = h.get('x-forwarded-host') || h.get('host') || 'www.miravoz.com.ar';
    const proto = h.get('x-forwarded-proto') || 'https';
    return `${proto}://${host}`;
}

export const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id'
};
