// users.js — "Mis usuarios" (F4-2 / F4-3 / F4-4): usuarios, sus copias asignadas, casita y tablet vinculada.
// Regla: todo texto que escribe una persona (nombres de usuarios y de tableros) va con textContent.

import { supabaseClient } from './auth.js';
import { customAlert, customConfirm, customChoice } from './ui.js';
import { openProgress } from './progress.js';

export let users = [];
let currentProfessionalId = null;
let loadError = false;               // falló la consulta principal de usuarios
const expandedUsers = new Set();     // fichas abiertas ("Ver tableros"), sobrevive a los re-render
// (1.3.3) La configuración de acceso se hace en la propia tablet: ya no hay panel "Configuración de su tablet".


export function setProfessionalId(id) {
    currentProfessionalId = id;
}

export async function fetchUsers() {
    if (!currentProfessionalId) return [];

    const { data: usersData, error: usersError } = await supabaseClient
        .from('aac_users')
        .select('*')
        .eq('professional_id', currentProfessionalId)
        .order('created_at', { ascending: false });

    if (usersError || !Array.isArray(usersData)) {
        console.error('Error fetching users:', usersError);
        loadError = true;
        renderUsersList();
        return users;
    }
    loadError = false;

    const ids = usersData.map(u => u.id);
    const empty = { data: [], error: null };
    // Las tres consultas son independientes: en paralelo. Si una falla, el resto de la ficha se muestra igual.
    const [codesRes, copiesRes, devicesRes] = ids.length ? await Promise.all([
        supabaseClient.from('access_codes').select('code, aac_user_id, expires_at')
            .in('aac_user_id', ids).is('redeemed_at', null).gt('expires_at', new Date().toISOString()),
        supabaseClient.from('assignments')
            .select('id, aac_user_id, permission, copy_updated_at, board_id, name:copy_bundle->>name')
            .in('aac_user_id', ids),
        supabaseClient.from('device_tokens').select('token_hash, aac_user_id, created_at, last_seen_at')
            .in('aac_user_id', ids)
    ]).catch(err => {
        console.error('Error cargando fichas de usuarios:', err);
        const fail = { data: null, error: err };
        return [fail, fail, fail];
    }) : [empty, empty, empty];

    if (codesRes.error) console.error('Error fetching access codes:', codesRes.error);
    if (copiesRes.error) console.error('Error fetching assignments:', copiesRes.error);
    if (devicesRes.error) console.error('Error fetching device links:', devicesRes.error);

    const codes = Array.isArray(codesRes.data) ? codesRes.data : [];
    const copies = Array.isArray(copiesRes.data) ? copiesRes.data : [];
    const devices = Array.isArray(devicesRes.data) ? devicesRes.data : [];

    usersData.forEach(user => {
        const codeRecord = codes.find(c => c.aac_user_id === user.id);
        user.access_code = codeRecord ? formatCode(codeRecord.code) : null;
        user.access_code_expires = codeRecord ? codeRecord.expires_at : null;
        user.codesError = !!codesRes.error;
        user.copies = copies.filter(a => a.aac_user_id === user.id)
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
        user.copiesError = !!copiesRes.error;
        user.devices = devices.filter(d => d.aac_user_id === user.id);
        user.devicesError = !!devicesRes.error;
    });

    users = usersData;
    renderUsersList();
    return users;
}

export async function createUser(displayName) {
    if (!currentProfessionalId) return;

    const { data: newUser, error: userError } = await supabaseClient
        .from('aac_users')
        .insert([{
            professional_id: currentProfessionalId,
            display_name: displayName
        }])
        .select()
        .single();

    if (userError || !newUser) {
        console.error('Error creating user:', userError);
        customAlert('No se pudo crear el usuario. Revisá la conexión e intentá de nuevo.');
        return;
    }

    // Código para vincular su tablet: lo genera el servidor (F4-4, supabase/02)
    await generateCode(newUser.id, { silent: true });

    await fetchUsers();
}

/** Formato legible: ABCD-EFGH */
function formatCode(code) {
    return code && code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** Pide al servidor un código nuevo (invalida el anterior no usado). */
export async function generateCode(aacUserId, { silent = false } = {}) {
    const { data, error } = await supabaseClient.rpc('create_access_code', { p_aac_user_id: aacUserId });
    if (error) {
        console.error('Error generando código:', error);
        customAlert('No se pudo generar el código para la tablet. Probá de nuevo en un rato.');
        return null;
    }
    if (!silent) await fetchUsers();
    return data;
}

export async function deleteUser(userId) {
    if (!currentProfessionalId) return;

    // ON DELETE CASCADE borra sus códigos, copias y vínculos de tablet.
    const { error } = await supabaseClient
        .from('aac_users')
        .delete()
        .eq('id', userId)
        .eq('professional_id', currentProfessionalId); // safety check

    if (error) {
        console.error('Error deleting user:', error);
        customAlert('No se pudo eliminar el usuario. Revisá la conexión e intentá de nuevo.');
        return;
    }

    expandedUsers.delete(userId);
    await fetchUsers();
}

// ---------------------------------------------------------------- copias (assignments)

const PERMISSIONS = [
    { value: 'read_only', label: 'Solo mirar' },
    { value: 'editable', label: 'Puede editarse' }
];

async function setPermission(user, copy, permission, selectEl) {
    const previous = copy.permission;
    selectEl.disabled = true;
    const { error } = await supabaseClient
        .from('assignments')
        .update({ permission })
        .eq('id', copy.id);
    selectEl.disabled = false;
    if (error) {
        console.error('Error cambiando permiso:', error);
        selectEl.value = previous;
        customAlert('No se pudo cambiar el permiso. Revisá la conexión e intentá de nuevo.');
        return;
    }
    copy.permission = permission; // sin re-render: el foco se queda en el selector
}

async function removeCopy(user, copy) {
    const ok = await customConfirm(`¿Quitarle «${copyName(copy)}» a ${user.display_name}? Su copia se borra; tu original no cambia.`);
    if (!ok) return;
    const { error } = await supabaseClient
        .from('assignments')
        .delete()
        .eq('id', copy.id);
    if (error) {
        console.error('Error quitando copia:', error);
        customAlert('No se pudo quitar la copia. Revisá la conexión e intentá de nuevo.');
        return;
    }
    await fetchUsers(); // si era la casita, la base la deja en null (ON DELETE SET NULL)
}

/** assignmentId = null saca la casita. */
async function setHome(user, assignmentId, focusCopyId) {
    const { error } = await supabaseClient
        .from('aac_users')
        .update({ home_board_id: assignmentId })
        .eq('id', user.id);
    if (error) {
        console.error('Error cambiando la casita:', error);
        customAlert('No se pudo cambiar el tablero de inicio. Revisá la conexión e intentá de nuevo.');
        return;
    }
    user.home_board_id = assignmentId;
    renderUsersList(`home:${focusCopyId}:${user.id}`);
}

async function unlinkDevice(user, device) {
    const ok = await customConfirm(`¿Desvincular la tablet de ${user.display_name}? Va a dejar de ver sus tableros hasta que la vincules de nuevo con un código.`);
    if (!ok) return;
    const { error } = await supabaseClient
        .from('device_tokens')
        .delete()
        .eq('token_hash', device.token_hash);
    if (error) {
        console.error('Error desvinculando tablet:', error);
        customAlert('No se pudo desvincular la tablet. Revisá la conexión e intentá de nuevo.');
        return;
    }
    await fetchUsers();
}

function copyName(copy) {
    return (copy && typeof copy.name === 'string' && copy.name.trim()) ? copy.name : 'Tablero sin nombre';
}

/** "hace un momento", "hace 5 minutos", "ayer", "hace 3 días", "el 12/10" */
export function relativeTime(iso, now = Date.now()) {
    const t = new Date(iso).getTime();
    if (!iso || Number.isNaN(t)) return null;
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return 'hace un momento';
    const m = Math.round(s / 60);
    if (m < 60) return m === 1 ? 'hace 1 minuto' : `hace ${m} minutos`;
    const h = Math.round(m / 60);
    if (h < 24) return h === 1 ? 'hace 1 hora' : `hace ${h} horas`;
    const d = Math.round(h / 24);
    if (d === 1) return 'ayer';
    if (d < 30) return `hace ${d} días`;
    return `el ${shortDate(iso)}`;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function shortDate(iso) {
    const d = new Date(iso);
    return `${d.getDate()}/${MONTHS[d.getMonth()]}`;
}
let userQuery = ''; // 1.9.7: buscador de Mis usuarios
const normName = (t) => String(t || '').toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// ---------------------------------------------------------------- render

function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
}

function button(text, ariaLabel, onClick, className = 'btn btn-secondary user-btn') {
    const b = el('button', className, text);
    b.type = 'button';
    b.setAttribute('aria-label', ariaLabel);
    b.addEventListener('click', onClick);
    return b;
}

// 1.9.0: registro de uso (granular) con consentimiento + pestaña Progreso
async function setMetrics(user, enabled) {
    if (enabled && !(await customChoice(
        `Al activar el registro, la tablet de ${user.display_name} guarda cada selección, las frases que arma y los tiempos, para analizar su progreso (incluso con Claude, si lo conectaste).\n\n` +
        'Hace falta el consentimiento de la persona o de su familia/responsables. ¿Lo tenés?', 'Sí, activar', 'Cancelar'))) return;
    if (!enabled && !(await customChoice(`¿Desactivar el registro de uso de ${user.display_name}?\n\nDesde la próxima conexión de su tablet no se guarda nada más. Lo ya registrado se conserva (se puede borrar desde Ver progreso).`, 'Desactivar', 'Cancelar'))) return;
    const prev = (user.settings && typeof user.settings === 'object') ? user.settings : {};
    const settings = { ...prev, metrics: { ...(prev.metrics || {}), enabled, ...(enabled ? { consent_at: new Date().toISOString() } : { disabled_at: new Date().toISOString() }) } };
    const { error } = await supabaseClient.from('aac_users').update({ settings }).eq('id', user.id);
    if (error) { customAlert('No se pudo cambiar. Revisá la conexión e intentá de nuevo.'); return; }
    user.settings = settings;
    renderUsersList(`metrics:${user.id}`);
}

function metricsButton(user) {
    const on = !!user.settings?.metrics?.enabled;
    const b = button(on ? 'Desactivar registro' : 'Activar registro', `${on ? 'Desactivar' : 'Activar'} el registro de uso de ${user.display_name}`, () => setMetrics(user, !on));
    b.dataset.focusKey = `metrics:${user.id}`;
    b.title = on ? 'Se registra el uso de su tablet (con consentimiento) para ver su progreso.' : 'Registrar el uso de su tablet para ver su progreso (necesita consentimiento).';
    return b;
}

/** 1.9.7: estado de la tablet (debajo del nombre): última conexión, código vigente y registro. */
function renderTabletInfo(user) {
    const info = el('div', 'user-tablet-info');
    const linked = !user.devicesError && user.devices.length > 0;
    if (user.devicesError) info.appendChild(el('span', 'user-device', 'No pudimos ver si tiene una tablet vinculada.'));
    else if (!linked) info.appendChild(el('span', 'user-device user-device-off', 'Sin tablet vinculada'));
    else user.devices.forEach((device, i) => {
        const prefix = user.devices.length > 1 ? `Tablet ${i + 1}: ` : '';
        info.appendChild(el('span', 'user-device', device.last_seen_at ? `${prefix}última conexión ${shortDate(device.last_seen_at)}` : `${prefix}tablet vinculada`));
    });
    if (user.codesError) info.appendChild(el('span', 'user-note', 'No pudimos cargar el código de vinculación.'));
    else if (user.access_code) {
        const mins = Math.max(0, Math.ceil((new Date(user.access_code_expires) - Date.now()) / 60000));
        const left = mins >= 120 ? `${Math.ceil(mins / 1440)} ${Math.ceil(mins / 1440) === 1 ? 'día' : 'días'}` : `${mins} min`;
        info.appendChild(el('span', 'user-code', `Código: ${user.access_code} · vence en ${left}`));
    }
    if (user.settings?.metrics?.enabled) info.appendChild(el('span', 'user-badge', 'Registro de uso activo'));
    return info;
}

/** 1.9.7: acciones de la tablet, apiladas a la derecha. */
function renderTabletActions(user) {
    const actions = el('div', 'user-side-actions');
    const linked = !user.devicesError && user.devices.length > 0;
    if (linked) user.devices.forEach((device, i) => actions.appendChild(
        button(user.devices.length > 1 ? `Desvincular tablet ${i + 1}` : 'Desvincular tablet', `Desvincular la tablet de ${user.display_name}`, () => unlinkDevice(user, device))));
    const gen = button(user.access_code || linked ? 'Nuevo código' : 'Generar código',
        `${user.access_code || linked ? 'Nuevo código' : 'Generar código'} para la tablet de ${user.display_name}`, () => generateCode(user.id));
    gen.title = 'Genera un código de 4 caracteres, de un solo uso, para vincular una tablet (vence a los 30 minutos). El código anterior deja de servir.';
    actions.appendChild(gen);
    actions.appendChild(metricsButton(user));
    return actions;
}


function renderCopies(user, container) {
    if (user.copiesError) {
        container.appendChild(el('p', 'user-note', 'No pudimos cargar sus tableros. Revisá la conexión y volvé a abrir "Mis usuarios".'));
        return;
    }
    if (!user.copies.length) {
        container.appendChild(el('p', 'user-note', 'Todavía no tiene tableros. Desde la pantalla de inicio, usá "Asignar" en un tablero para darle su copia.'));
        return;
    }

    const home = user.copies.find(c => c.id === user.home_board_id);
    container.appendChild(el('p', 'user-note', home
        ? `Tablero de inicio: «${copyName(home)}» (la tablet abre directo acá)`
        : 'Sin tablero de inicio: la tablet muestra la lista de sus tableros'));

    const list = el('ul', 'copy-list');
    user.copies.forEach(copy => {
        const name = copyName(copy);
        const isHome = copy.id === user.home_board_id;
        const li = el('li', 'copy-row');

        const info = el('div', 'copy-info');
        info.appendChild(el('strong', 'copy-name', name));
        const when = relativeTime(copy.copy_updated_at);
        info.appendChild(el('span', 'user-note', when ? `Editada ${when}` : 'Sin cambios desde que se la diste'));
        li.appendChild(info);

        const actions = el('div', 'copy-actions');

        const sel = el('select', 'glass-select copy-permission');
        sel.setAttribute('aria-label', `Permiso de «${name}» para ${user.display_name}`);
        PERMISSIONS.forEach(p => {
            const o = el('option', null, p.label);
            o.value = p.value;
            sel.appendChild(o);
        });
        sel.value = copy.permission === 'editable' ? 'editable' : 'read_only';
        sel.addEventListener('change', () => setPermission(user, copy, sel.value, sel));
        actions.appendChild(sel);

        const homeBtn = button(isHome ? 'Es su inicio' : 'Usar como inicio',
            isHome ? `«${name}» es el tablero de inicio de ${user.display_name}. Tocá para sacarlo` : `Hacer de «${name}» el tablero de inicio de ${user.display_name}`,
            () => setHome(user, isHome ? null : copy.id, copy.id),
            'btn btn-secondary user-btn' + (isHome ? ' is-home' : ''));
        homeBtn.setAttribute('aria-pressed', String(isHome));
        homeBtn.dataset.focusKey = `home:${copy.id}:${user.id}`;
        actions.appendChild(homeBtn);

        // Hook para el editor de copias (lo implementa main/editor)
        actions.appendChild(button('Editar copia', `Editar la copia de «${name}» de ${user.display_name}`, () => {
            window.dispatchEvent(new CustomEvent('miravoz:edit-copy', { detail: { assignmentId: copy.id } }));
        }));

        actions.appendChild(button('Quitar', `Quitarle «${name}» a ${user.display_name}`, () => removeCopy(user, copy),
            'btn btn-secondary user-btn user-btn-danger'));

        li.appendChild(actions);
        list.appendChild(li);
    });
    container.appendChild(list);
}

/** focusKey: data-focus-key del elemento que recupera el foco tras re-render (p. ej. botón de casita). */
export function renderUsersList(focusKey = null) {
    const listEl = document.getElementById('users-list');
    if (!listEl) return;

    listEl.replaceChildren();

    if (loadError) {
        listEl.appendChild(el('p', 'user-note', 'No pudimos cargar tus usuarios. Revisá la conexión e intentá de nuevo en un rato.'));
        return;
    }
    if (users.length === 0) {
        listEl.appendChild(el('p', 'user-note', 'Todavía no tenés usuarios. Creá el primero arriba.'));
        return;
    }

    const q = normName(userQuery.trim());
    const shown = q ? users.filter(u => normName(u.display_name).includes(q)) : users;
    if (!shown.length) listEl.appendChild(el('p', 'user-note', `Ningún usuario coincide con «${userQuery.trim()}».`));

    shown.forEach(user => {
        const card = el('div', 'glass-box user-card');
        const main = el('div', 'user-main');

        // Nombre destacado + estado de la tablet + Ver tableros / Ver progreso
        const nameRow = el('div', 'user-name-row');
        nameRow.appendChild(el('h3', 'user-name', user.display_name)); // nunca innerHTML (XSS)
        const deleteBtn = el('button', 'btn-icon user-btn-icon user-delete');
        deleteBtn.type = 'button';
        deleteBtn.style.color = 'var(--danger-text)';
        // SVG fijo (sin datos de personas)
        deleteBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
        deleteBtn.title = 'Eliminar usuario';
        deleteBtn.setAttribute('aria-label', `Eliminar a ${user.display_name}`);
        deleteBtn.addEventListener('click', async () => {
            const confirmed = await customConfirm(`¿Eliminar a ${user.display_name}? Se borran también sus copias de tableros y su tablet queda desvinculada. No se puede deshacer.`);
            if (confirmed) await deleteUser(user.id);
        });
        nameRow.appendChild(deleteBtn);
        main.appendChild(nameRow);
        main.appendChild(renderTabletInfo(user));

        const links = el('div', 'user-row user-links');
        const panelId = `user-copies-${user.id}`;
        const open = expandedUsers.has(user.id);
        const count = Array.isArray(user.copies) ? user.copies.length : 0;
        const toggle = button(open ? 'Ocultar tableros' : `Ver tableros (${count})`,
            `${open ? 'Ocultar' : 'Ver'} los tableros de ${user.display_name}`, () => {
                if (expandedUsers.has(user.id)) expandedUsers.delete(user.id); else expandedUsers.add(user.id);
                renderUsersList(`toggle:${user.id}`);
            });
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-controls', panelId);
        toggle.dataset.focusKey = `toggle:${user.id}`;
        links.appendChild(toggle);
        links.appendChild(button('Ver progreso', `Ver el progreso de ${user.display_name}`, () => openProgress(user)));
        main.appendChild(links);

        const top = el('div', 'user-top');
        top.append(main, renderTabletActions(user));
        card.appendChild(top);

        const panel = el('div', 'user-copies');
        panel.id = panelId;
        panel.hidden = !open;
        if (open) { renderCopies(user, panel); card.classList.add('is-open'); }
        card.appendChild(panel);

        listEl.appendChild(card);
    });

    if (focusKey) {
        const target = [...listEl.querySelectorAll('[data-focus-key]')].find(n => n.dataset.focusKey === focusKey);
        if (target) target.focus();
    }
}

export function initUsers() {
    const search = document.getElementById('users-search');
    if (search) search.addEventListener('input', () => { userQuery = search.value; renderUsersList(); });
    // Nuevo usuario (1.3.1): botón arriba a la derecha que abre un modal con el nombre
    const modal = document.getElementById('new-user-modal');
    const form = document.getElementById('new-user-form');
    const btnCreate = document.getElementById('btn-create-user');
    const inputName = document.getElementById('new-user-name');
    const openBtn = document.getElementById('btn-new-user');
    if (!modal || !form || !btnCreate || !inputName) return;
    const close = () => { modal.style.display = 'none'; inputName.value = ''; openBtn?.focus(); };
    openBtn?.addEventListener('click', () => {
        modal.style.display = 'flex';
        setTimeout(() => inputName.focus(), 50); // lo abre la persona de la cuenta registrada: se escribe directo
    });
    document.getElementById('btn-close-new-user')?.addEventListener('click', close);
    document.getElementById('btn-cancel-new-user')?.addEventListener('click', close);
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = inputName.value.trim();
        if (!name || btnCreate.disabled) return;
        btnCreate.disabled = true;
        btnCreate.textContent = 'Creando...';
        try { await createUser(name); } finally {
            btnCreate.disabled = false;
            btnCreate.textContent = 'Crear';
        }
        close();
    });
}
