// auth.js — Supabase: autenticación (bypasseada, ver SPEC F4) y storage de tableros

import { S } from './state.js';
import { showSyncToast, hideSyncToast } from './ui.js';

const SUPABASE_URL = 'https://bpcedvpcwwwgnfinqztq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_dqFw8-mzNW88E5aRgG7WMw_byIf-pT1';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// initAuth(onReady): onReady se llama UNA sola vez cuando hay "sesión" (bypass local).
// Evita el triple render de tableros del código anterior (FIXES F0.1-4).
let readyFired = false;

export function initAuth(onReady) {
    const handleSession = (sessionData) => {
        S.currentUser = sessionData;

        document.getElementById('auth-view').style.display = 'none';
        document.getElementById('home-view').style.display = 'block';
        document.getElementById('top-bar').style.display = 'flex';
        document.getElementById('bottom-bar').style.display = 'flex';

        const nameEl = document.querySelector('.user-name');
        const avatarEl = document.querySelector('.user-avatar');
        if (nameEl) nameEl.innerText = sessionData.email;
        if (avatarEl) {
            avatarEl.style.display = 'flex';
            avatarEl.textContent = sessionData.email.substring(0, 2).toUpperCase();
        }

        if (!readyFired) {
            readyFired = true;
            onReady();
        }
    };

    window.localforage.getItem('miravoz_mock_session').then((mockSession) => {
        if (mockSession) {
            handleSession(mockSession);
        } else {
            const btnSendOtp = document.getElementById('btn-send-otp');
            const emailInput = document.getElementById('auth-email-input');
            if (btnSendOtp && emailInput) {
                btnSendOtp.onclick = async () => {
                    const email = emailInput.value.trim();
                    if (!email) return;
                    const sessionData = { id: email, email: email };
                    await window.localforage.setItem('miravoz_mock_session', sessionData);
                    handleSession(sessionData);
                };
            }
        }
    });

    // Logout: borra la sesión simulada
    const btnLogout = document.querySelector('.btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async (e) => {
            e.preventDefault();
            await window.localforage.removeItem('miravoz_mock_session');
            window.location.reload();
        });
    }
}

async function getUser() {
    return S.currentUser || null;
}

export async function uploadBoardToSupabase(bundle) {
    const user = await getUser();
    if (!user) return; // sin sesión real (bypass): no-op
    try {
        showSyncToast('Guardando en la nube...');
        const filePath = `${user.id}/${bundle.id}.json`;
        const { error } = await supabaseClient.storage.from('boards')
            .upload(filePath, JSON.stringify(bundle), { contentType: 'application/json', upsert: true });
        if (error) console.error('Error subiendo tablero:', error);
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
        const { error } = await supabaseClient.storage.from('boards').remove([`${user.id}/${bundleId}.json`]);
        if (error) console.error('Error borrando tablero:', error);
        hideSyncToast();
    } catch (e) {
        console.error('Error deleteBoardFromSupabase:', e);
        hideSyncToast();
    }
}
