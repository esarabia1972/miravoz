// auth.js — Supabase: autenticación (bypasseada, ver SPEC F4) y storage de tableros

import { S } from './state.js';
import { showSyncToast, hideSyncToast } from './ui.js';

const SUPABASE_URL = 'https://bpcedvpcwwwgnfinqztq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_dqFw8-mzNW88E5aRgG7WMw_byIf-pT1';

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// initAuth(onReady): onReady se llama UNA sola vez cuando hay "sesión" (bypass local).
// Evita el triple render de tableros del código anterior (FIXES F0.1-4).
let readyFired = false;

export function initAuth(onReady) {
    const handleSession = (session) => {
        S.currentUser = session?.user || null;

        if (S.currentUser) {
            document.getElementById('auth-view').style.display = 'none';
            document.getElementById('home-view').style.display = 'block';
            document.getElementById('top-bar').style.display = 'flex';
            document.getElementById('bottom-bar').style.display = 'flex';

            const nameEl = document.querySelector('.user-name');
            const avatarEl = document.querySelector('.user-avatar');
            if (nameEl) nameEl.innerText = S.currentUser.email;
            if (avatarEl) {
                avatarEl.style.display = 'flex';
                avatarEl.textContent = S.currentUser.email.substring(0, 2).toUpperCase();
            }

            if (!readyFired) {
                readyFired = true;
                // Al entrar por primera vez con sesión válida, descargamos los tableros
                downloadBoardsFromSupabase().then(() => {
                    onReady();
                });
            }
        } else {
            // Mostrar login
            document.getElementById('auth-view').style.display = 'flex';
            document.getElementById('home-view').style.display = 'none';
            document.getElementById('top-bar').style.display = 'none';
            document.getElementById('bottom-bar').style.display = 'none';
        }
    };

    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            handleSession(session);
        }
    });
    
    supabaseClient.auth.getSession().then(({ data }) => {
        handleSession(data.session);
    });

    const btnLogin = document.getElementById('btn-login');
    const emailInput = document.getElementById('auth-email-input');
    const passInput = document.getElementById('auth-password-input');
    if (btnLogin && emailInput && passInput) {
        btnLogin.onclick = async () => {
            const email = emailInput.value.trim();
            const password = passInput.value.trim();
            if (!email || !password) {
                alert("Completa ambos campos");
                return;
            }
            btnLogin.disabled = true;
            btnLogin.innerText = 'Cargando...';
            
            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
            
            if (error) {
                console.error("Login falló:", error);
                if (error.message.includes('Invalid login credentials')) {
                    // Puede que no exista, intentamos registro
                    const { error: signUpError } = await supabaseClient.auth.signUp({ email, password });
                    if (signUpError) {
                        if (signUpError.message.includes('User already registered')) {
                            alert("Error: Contraseña incorrecta o cuenta sin confirmar.");
                        } else {
                            alert("Error: " + signUpError.message);
                        }
                    } else {
                        alert("Cuenta creada. Si activaste confirmación, revisa tu correo. Si no, vuelve a iniciar sesión.");
                    }
                } else {
                    // Otro error (ej. email no confirmado)
                    alert("Error: " + error.message);
                }
            }
            
            btnLogin.disabled = false;
            btnLogin.innerText = 'Iniciar Sesión';
        };
    }

    const btnLogout = document.querySelector('.btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async (e) => {
            e.preventDefault();
            await supabaseClient.auth.signOut();
            window.location.reload();
        });
    }
}

async function getUser() {
    const { data } = await supabaseClient.auth.getSession();
    return data?.session?.user || null;
}

export async function downloadBoardsFromSupabase() {
    const user = await getUser();
    if (!user) return;
    try {
        showSyncToast('Descargando tableros...');
        const { data, error } = await supabaseClient
            .from('boards')
            .select('id, bundle')
            .eq('owner_professional_id', user.id);
            
        if (error) throw error;
        
        // Limpiamos los tableros locales (que no sean settings) para reflejar la nube real
        const keys = await window.localforage.keys();
        for (const k of keys) {
            if (!k.startsWith('miravoz_')) {
                await window.localforage.removeItem(k);
            }
        }
        
        // Guardamos localmente lo descargado
        for (const row of data) {
            await window.localforage.setItem(row.id, row.bundle);
        }
        hideSyncToast();
    } catch(e) {
        console.error('Error downloadBoardsFromSupabase:', e);
        hideSyncToast();
    }
}

export async function uploadBoardToSupabase(bundle) {
    const user = await getUser();
    if (!user) return;
    try {
        showSyncToast('Guardando en la nube...');
        const { error } = await supabaseClient.from('boards').upsert({
            id: bundle.id,
            owner_professional_id: user.id,
            name: bundle.name || 'Sin Título',
            bundle: bundle,
            updated_at: new Date().toISOString()
        });
        if (error) throw error;
        hideSyncToast();
    } catch (e) {
        console.error('Error uploadBoardToSupabase:', e);
        hideSyncToast();
    }
}

export async function deleteBoardFromSupabase(bundleId) {
    const user = await getUser();
    if (!user) return;
    try {
        showSyncToast('Borrando de la nube...');
        const { error } = await supabaseClient.from('boards').delete().eq('id', bundleId).eq('owner_professional_id', user.id);
        if (error) throw error;
        hideSyncToast();
    } catch (e) {
        console.error('Error deleteBoardFromSupabase:', e);
        hideSyncToast();
    }
}
