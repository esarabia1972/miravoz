import { supabaseClient } from './auth.js';
import { customAlert, customConfirm } from './ui.js';

export let users = [];
let currentProfessionalId = null;

export function setProfessionalId(id) {
    currentProfessionalId = id;
}

export async function fetchUsers() {
    if (!currentProfessionalId) return [];
    
    // Fetch users
    const { data: usersData, error: usersError } = await supabaseClient
        .from('aac_users')
        .select('*')
        .eq('professional_id', currentProfessionalId)
        .order('created_at', { ascending: false });

    if (usersError) {
        console.error('Error fetching users:', usersError);
        return [];
    }

    // Fetch access codes (only for the current professional's users)
    const { data: codesData, error: codesError } = await supabaseClient
        .from('access_codes')
        .select('*');

    if (codesError) {
        console.error('Error fetching access codes:', codesError);
    } else {
        // Map codes to users
        usersData.forEach(user => {
            const codeRecord = codesData.find(c => c.aac_user_id === user.id);
            user.access_code = codeRecord ? codeRecord.code : 'Sin código';
        });
    }

    users = usersData;
    renderUsersList();
    return users;
}

export async function createUser(displayName) {
    if (!currentProfessionalId) return;

    // 1. Insert user
    const { data: newUser, error: userError } = await supabaseClient
        .from('aac_users')
        .insert([{
            professional_id: currentProfessionalId,
            display_name: displayName
        }])
        .select()
        .single();

    if (userError) {
        console.error('Error creating user:', userError);
        customAlert('Error al crear usuario');
        return;
    }

    // 2. Generate 6-digit access code (format: XXX-XXX)
    const rawCode = Math.floor(100000 + Math.random() * 900000).toString();
    const formattedCode = `${rawCode.substring(0,3)}-${rawCode.substring(3)}`;

    // 3. Insert code
    const { error: codeError } = await supabaseClient
        .from('access_codes')
        .insert([{
            code: formattedCode,
            aac_user_id: newUser.id
        }]);

    if (codeError) {
        console.error('Error creating access code:', codeError);
        customAlert('Usuario creado, pero hubo un error generando el código.');
    }

    // Refresh list
    await fetchUsers();
}

export async function deleteUser(userId) {
    if (!currentProfessionalId) return;

    // Delete user from aac_users. If cascade is set, it deletes access codes and assignments.
    const { error } = await supabaseClient
        .from('aac_users')
        .delete()
        .eq('id', userId)
        .eq('professional_id', currentProfessionalId); // safety check

    if (error) {
        console.error('Error deleting user:', error);
        customAlert('Error al eliminar usuario: ' + error.message);
        return;
    }

    await fetchUsers();
}

export function renderUsersList() {
    const listEl = document.getElementById('users-list');
    if (!listEl) return;
    
    listEl.innerHTML = '';
    
    if (users.length === 0) {
        listEl.innerHTML = '<p style="color: var(--text-muted);">No tienes pacientes registrados todavía.</p>';
        return;
    }

    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'glass-box';
        div.style.padding = '15px';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        
        const nameDiv = document.createElement('div');
        nameDiv.innerHTML = `<strong>${user.display_name}</strong>`;
        
        const codeDiv = document.createElement('div');
        codeDiv.style.display = 'flex';
        codeDiv.style.alignItems = 'center';
        codeDiv.style.gap = '10px';

        const codeSpan = document.createElement('span');
        codeSpan.style.fontFamily = 'monospace';
        codeSpan.style.fontSize = '1.2em';
        codeSpan.style.background = 'rgba(255,255,255,0.1)';
        codeSpan.style.padding = '5px 10px';
        codeSpan.style.borderRadius = '5px';
        codeSpan.innerText = `Código: ${user.access_code}`;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-icon';
        deleteBtn.style.color = '#ff4444';
        deleteBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
        deleteBtn.title = 'Eliminar usuario';
        deleteBtn.onclick = async () => {
            const confirmed = await customConfirm(`¿Estás seguro de que quieres eliminar a ${user.display_name}? Esta acción no se puede deshacer.`);
            if (confirmed) {
                await deleteUser(user.id);
            }
        };

        codeDiv.appendChild(codeSpan);
        codeDiv.appendChild(deleteBtn);

        div.appendChild(nameDiv);
        div.appendChild(codeDiv);
        listEl.appendChild(div);
    });
}

export function initUsers() {
    const btnCreate = document.getElementById('btn-create-user');
    const inputName = document.getElementById('new-user-name');
    
    if (btnCreate && inputName) {
        btnCreate.addEventListener('click', async () => {
            const name = inputName.value.trim();
            if (!name) return;
            
            btnCreate.disabled = true;
            btnCreate.innerText = 'Creando...';
            
            await createUser(name);
            
            inputName.value = '';
            btnCreate.disabled = false;
            btnCreate.innerText = 'Crear Usuario';
        });
    }
}
