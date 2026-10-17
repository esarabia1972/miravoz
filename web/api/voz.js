// /api/voz — "Voces de MiraVoz" (0.8.1n): voces naturales con ElevenLabs.
//
//   GET  /api/voz?lista=1                         → voces disponibles en la cuenta de ElevenLabs de MiraVoz
//   POST /api/voz  { texto, voz, velocidad }      → audio MP3 de ese texto con esa voz
//
// La clave de ElevenLabs vive solo acá (variable de entorno ELEVENLABS_API_KEY, nunca en el navegador).
// Solo responde a una cuenta registrada (token de sesión de Supabase) o a una tablet vinculada (su token).
// El navegador guarda cada audio: cada texto se pide una sola vez por voz (ver web/js/cloud-voice.js).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_config.js';

const EL = 'https://api.elevenlabs.io';
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5'; // rápido (~75 ms) y con español
const MAX_CHARS = 400;
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-MiraVoz-Device'
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function supa(path, { token = SUPABASE_ANON_KEY, method = 'GET', body } = {}) {
    return fetch(`${SUPABASE_URL}${path}`, {
        method,
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
}

/** ¿Quién pide? Una cuenta registrada (sesión) o una tablet vinculada (token). */
async function authorized(request) {
    const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '')?.[1];
    if (bearer) {
        try { if ((await supa('/auth/v1/user', { token: bearer })).ok) return true; } catch { /* sigue */ }
    }
    const device = request.headers.get('x-miravoz-device') || '';
    if (/^[0-9a-f]{64}$/i.test(device)) {
        try {
            // Liviana (supabase/14_voz_tablet.sql); si todavía no se corrió, la de siempre de la tablet
            let r = await supa('/rest/v1/rpc/device_valid', { method: 'POST', body: { p_token: device } });
            if (r.ok) return (await r.json()) === true;
            r = await supa('/rest/v1/rpc/device_fetch', { method: 'POST', body: { p_token: device } });
            if (r.ok) { const d = await r.json(); return !!(d && d.ok); }
        } catch { /* sigue */ }
    }
    return false;
}

function keyOrError() {
    const key = process.env.ELEVENLABS_API_KEY;
    return key ? { key } : { error: json({ error: 'Las voces de MiraVoz no están configuradas en el servidor.' }, 503) };
}

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function GET(request) {
    if (!(await authorized(request))) return json({ error: 'Iniciá sesión o vinculá la tablet.' }, 401);
    const { key, error } = keyOrError();
    if (error) return error;
    const r = await fetch(`${EL}/v1/voices`, { headers: { 'xi-api-key': key } });
    if (!r.ok) return json({ error: r.status === 401 ? 'La clave de ElevenLabs no es válida o no tiene permiso para leer voces.' : `ElevenLabs respondió ${r.status}.` }, 502);
    const data = await r.json();
    const voces = (data.voices || []).map(v => ({
        id: v.voice_id,
        nombre: v.name,
        propia: v.category !== 'premade', // las que agregaste a "My Voices" (clonadas, diseñadas o de la biblioteca)
        genero: v.labels?.gender || '',
        acento: v.labels?.accent || '',
        edad: v.labels?.age || '',
        idioma: v.labels?.language || v.verified_languages?.[0]?.language || '',
        muestra: v.preview_url || ''
    }));
    return json({ voces, modelo: MODEL });
}

export async function POST(request) {
    if (!(await authorized(request))) return json({ error: 'Iniciá sesión o vinculá la tablet.' }, 401);
    const { key, error } = keyOrError();
    if (error) return error;
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Pedido inválido.' }, 400); }
    const texto = String(body?.texto || '').replace(/\s+/g, ' ').trim();
    const voz = String(body?.voz || '');
    const velocidad = Math.min(1.2, Math.max(0.7, Number(body?.velocidad) || 1));
    if (!texto) return json({ error: 'Falta el texto.' }, 400);
    if (texto.length > MAX_CHARS) return json({ error: `Texto demasiado largo (máximo ${MAX_CHARS} caracteres).` }, 413);
    if (!/^[A-Za-z0-9]{8,40}$/.test(voz)) return json({ error: 'Voz inválida.' }, 400);

    const r = await fetch(`${EL}/v1/text-to-speech/${voz}?output_format=mp3_44100_64`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: texto, model_id: MODEL, language_code: 'es', voice_settings: { speed: velocidad } })
    });
    if (!r.ok) {
        const t = await r.text().catch(() => '');
        const msg = r.status === 401 ? 'La clave de ElevenLabs no es válida.'
            : r.status === 429 ? 'Se alcanzó el límite de uso de las voces de MiraVoz.'
            : r.status === 402 || /quota|credits/i.test(t) ? 'No quedan créditos de voz en la cuenta de ElevenLabs.'
            : `ElevenLabs respondió ${r.status}.`;
        return json({ error: msg }, 502);
    }
    return new Response(r.body, { status: 200, headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=31536000' } });
}
