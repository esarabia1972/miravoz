// auth.js — Autenticación de profesionales con Supabase (SPEC F4-1)
// La cuenta es OPCIONAL: sin sesión la app funciona 100% local (invariante F4).
// Este módulo solo maneja sesión y formulario; la sincronización de tableros vive en sync.js.

import { S } from './state.js';
import { customAlert } from './ui.js';

const SUPABASE_URL = 'https://bpcedvpcwwwgnfinqztq.supabase.co';
// Clave publicable (anon): es pública por diseño; la seguridad depende de las políticas RLS.
const SUPABASE_ANON_KEY = 'sb_publishable_dqFw8-mzNW88E5aRgG7WMw_byIf-pT1';

// Si el CDN de supabase-js no cargó (sin red, bloqueado), la app sigue en modo local.
export const supabaseClient = window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
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

function wireAuthForm() {
    const emailInput = document.getElementById('auth-email-input');
    const passInput = document.getElementById('auth-password-input');
    const btnLogin = document.getElementById('btn-login');
    const btnSignup = document.getElementById('btn-signup');
    if (!emailInput || !passInput) return;

    const readForm = () => {
        const email = emailInput.value.trim();
        const password = passInput.value;
        if (!email || !password) { customAlert('Completá el correo y la contraseña.'); return null; }
        return { email, password };
    };

    const busy = (btn, text) => {
        const original = btn.textContent;
        btn.disabled = true; btn.textContent = text;
        return () => { btn.disabled = false; btn.textContent = original; };
    };

    if (btnLogin) btnLogin.onclick = async () => {
        if (!supabaseClient) { customAlert('Sin conexión con el servidor: podés seguir usando MiraVoz sin cuenta.'); return; }
        const creds = readForm(); if (!creds) return;
        const done = busy(btnLogin, 'Ingresando…');
        const { error } = await supabaseClient.auth.signInWithPassword(creds);
        done();
        if (error) {
            console.error('Login falló:', error);
            if (/invalid login credentials/i.test(error.message)) {
                customAlert('Correo o contraseña incorrectos. Si todavía no tenés cuenta, usá "Crear cuenta".');
            } else if (/email not confirmed/i.test(error.message)) {
                customAlert('Tu cuenta todavía no está confirmada: revisá tu correo.');
            } else {
                customAlert('No se pudo ingresar: ' + error.message);
            }
        } else {
            passInput.value = '';
        }
    };

    // Enter en el formulario = Ingresar
    [emailInput, passInput].forEach(el => el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); btnLogin?.click(); }
    }));

    if (btnSignup) btnSignup.onclick = async () => {
        if (!supabaseClient) { customAlert('Sin conexión con el servidor.'); return; }
        const creds = readForm(); if (!creds) return;
        if (creds.password.length < 8) { customAlert('La contraseña debe tener al menos 8 caracteres.'); return; }
        const done = busy(btnSignup, 'Creando…');
        const { data, error } = await supabaseClient.auth.signUp(creds);
        done();
        if (error) {
            customAlert(/already registered/i.test(error.message)
                ? 'Ya existe una cuenta con ese correo. Usá "Ingresar".'
                : 'No se pudo crear la cuenta: ' + error.message);
        } else if (!data.session) {
            customAlert('Cuenta creada. Revisá tu correo para confirmarla y después ingresá.');
        }
    };
}

export async function signOut() {
    // scope local: cierra la sesión en este dispositivo aunque no haya red
    if (supabaseClient) await supabaseClient.auth.signOut({ scope: 'local' });
}
