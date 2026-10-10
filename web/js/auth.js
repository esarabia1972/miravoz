// auth.js — Autenticación de profesionales con Supabase (SPEC F4-1)
// Decisión de producto (10/10/2026, Esteban): las profesionales entran SOLO con Google; no hay modo sin cuenta.
// Las tablets de los usuarios no inician sesión: se vinculan con un código (device.js).
// Este módulo solo maneja sesión y formulario; la sincronización de tableros vive en sync.js.

import { S } from './state.js';

const SUPABASE_URL = 'https://bpcedvpcwwwgnfinqztq.supabase.co';
// Clave publicable (anon): es pública por diseño; la seguridad depende de las políticas RLS.
const SUPABASE_ANON_KEY = 'sb_publishable_dqFw8-mzNW88E5aRgG7WMw_byIf-pT1';

// Si el CDN de supabase-js no cargó (sin red, bloqueado), no hay ingreso: la pantalla lo avisa.
// flowType 'pkce': la vuelta de Google trae ?code= (no el token en la URL) y supabase-js lo canjea al iniciar.
export const supabaseClient = window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: 'pkce', detectSessionInUrl: true } })
    : null;

export async function getUser() {
    if (!supabaseClient) return null;
    try {
        const { data } = await supabaseClient.auth.getSession();
        return data?.session?.user || null;
    } catch {
        return null;
    }
}

/**
 * initAuth({ onReady, onSignedIn, onSignedOut })
 *  - onReady(user|null): UNA sola vez al arrancar, haya o no sesión.
 *  - onSignedIn(user):   cuando alguien inicia sesión después del arranque.
 *  - onSignedOut():      cuando la sesión se cierra o expira.
 */
// Una sesión ANÓNIMA es la de una tablet vinculada (F4-4), nunca una profesional.
const asProfessional = (u) => (u && !u.is_anonymous ? u : null);

/** Usuario profesional logueado (null si no hay sesión o si es la sesión anónima de una tablet). */
export async function getProfessional() {
    return asProfessional(await getUser());
}

export function initAuth({ onReady, onSignedIn, onSignedOut }) {
    let ready = false;
    const fireReady = (user) => {
        if (ready) return;
        ready = true;
        S.currentUser = user || null;
        // Diferido: onReady usa Supabase y no debe correr dentro del callback de auth
        setTimeout(() => onReady(S.currentUser), 0);
    };

    if (!supabaseClient) {
        fireReady(null);
    } else {
        supabaseClient.auth.onAuthStateChange((event, session) => {
            const user = asProfessional(session?.user);
            if (event === 'INITIAL_SESSION') { fireReady(user); return; }
            if (!ready) return; // el arranque lo resuelve INITIAL_SESSION / getSession
            if (event === 'SIGNED_IN' && user && user.id !== S.currentUser?.id) {
                S.currentUser = user;
                // Diferido: no llamar a Supabase dentro del callback (puede trabar el lock de auth)
                setTimeout(() => onSignedIn(user), 0);
            } else if (event === 'SIGNED_OUT' && S.currentUser) {
                S.currentUser = null;
                setTimeout(() => onSignedOut(), 0);
            }
        });
        // Red de seguridad por si la versión del SDK no emite INITIAL_SESSION
        getUser().then(u => fireReady(asProfessional(u)));
    }

    wireAuthForm();
}

// --- Ingreso con Google (único método para profesionales, desde 10/10/2026) ---
// Supabase redirige a Google y vuelve a esta misma página; supabase-js canjea el ?code= solo (PKCE).
function wireAuthForm() {
    const btn = document.getElementById('btn-google');
    const err = document.getElementById('auth-error');
    if (!btn) return;
    btn.onclick = async () => {
        if (!supabaseClient) { if (err) err.textContent = 'Sin conexión con el servidor. Revisá internet y recargá la página.'; return; }
        btn.disabled = true;
        if (err) err.textContent = '';
        // Volver a la misma URL (conserva parámetros como ?iris=1), sin restos de un intento anterior
        const back = new URL(window.location.href);
        ['code', 'error', 'error_code', 'error_description', 'state'].forEach(k => back.searchParams.delete(k));
        back.hash = '';
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: back.toString(), queryParams: { prompt: 'select_account' } }
        });
        if (error) {
            console.error('Ingreso con Google:', error);
            btn.disabled = false;
            if (err) err.textContent = 'No se pudo abrir el ingreso con Google. Probá de nuevo en un rato.';
        }
        // si no hay error, el navegador ya está yendo a Google
    };
    // Si se vuelve con "Atrás" y el navegador restaura la página desde caché, rehabilitar el botón
    window.addEventListener('pageshow', () => { btn.disabled = false; });
}

/** Si volvimos de Google con un error o con el ?code= ya canjeado, limpiar la URL y mostrar el error. */
export function consumeOAuthReturn() {
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const desc = url.searchParams.get('error_description') || hashParams.get('error_description');
    const had = ['code', 'error', 'error_code', 'error_description', 'state'].some(k => url.searchParams.has(k)) || hashParams.has('error');
    if (had) {
        ['code', 'error', 'error_code', 'error_description', 'state'].forEach(k => url.searchParams.delete(k));
        url.hash = '';
        window.history.replaceState(null, '', url.toString());
    }
    return desc ? decodeURIComponent(desc.replace(/\+/g, ' ')) : null;
}

export async function signOut() {
    // scope local: cierra la sesión en este dispositivo aunque no haya red
    if (supabaseClient) await supabaseClient.auth.signOut({ scope: 'local' });
}
