// /.well-known/oauth-protected-resource (RFC 9728): le dice a Claude dónde iniciar sesión (Supabase Auth).
import { SUPABASE_URL, SCOPES, baseUrl, CORS } from './_config.js';

export function GET(request) {
    const base = baseUrl(request);
    return Response.json({
        resource: `${base}/mcp`,
        authorization_servers: [`${SUPABASE_URL}/auth/v1`],
        bearer_methods_supported: ['header'],
        scopes_supported: SCOPES,
        resource_name: 'MiraVoz',
        resource_documentation: `${base}/terminos`
    }, { headers: { ...CORS, 'Cache-Control': 'public, max-age=300' } });
}
export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }
