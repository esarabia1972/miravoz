// users.js — "Mis usuarios" (F4-2 / F4-3 / F4-4): usuarios, sus copias asignadas, casita y tablet vinculada.
// Regla: todo texto que escribe una persona (nombres de usuarios y de tableros) va con textContent.

import { supabaseClient } from './auth.js';
import { customAlert, customConfirm, showInfoToast } from './ui.js';

export let users = [];
let currentProfessionalId = null;
let loadError = false;               // falló la consulta principal de usuarios
const expandedUsers = new Set();     // fichas abiertas ("Ver tableros"), sobrevive a los re-render
const expandedSettings = new Set();  // "Configuración de su tablet" abierta, sobrevive a los re-render
const settingsDrafts = new Map();    // cambios sin guardar por usuario (no se pierden si se re-renderiza)

// F4-6: configuración de acceso por perfil (aac_users.settings)
const SETTINGS_DEFAULTS = { accessMode: 'CLICKS', dwellMs: 1200, scan: { pattern: 'ROW_COLUMN', intervalMs: 1200, audio: 'none' } };
const ACCESS_MODES = [
    { value: 'CLICKS', label: 'Manual (tocar o hacer clic)' },
    { value: 'SCAN', label: 'Barrido' },
    { value: 'CARA', label: 'Rostro' }
];
const ACCESS_MODE_NAMES = { CLICKS: 'Manual', CARA: 'Rostro', SCAN: 'Barrido' };
const DWELL_OPTIONS = [800, 1200, 2000, 3000, 5000];
const SCAN_PATTERNS = [
    { value: 'ROW_COLUMN', label: 'Fila → elemento' },
    { value: 'LINEAR', label: 'Elemento por elemento' }
];
const SCAN_INTERVALS = [600, 900, 1200, 1800, 2500, 3000];
const SCAN_AUDIO = [
    { value: 'none', label: 'Silencio' },
    { value: 'beep', label: 'Beep' },
    { value: 'speak', label: 'Decir la opción' }
];

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

/** Lee aac_users.settings y completa con defaults los valores que falten o no sean válidos. */
function accessSettingsOf(user) {
    const s = (user && user.settings && typeof user.settings === 'object') ? user.settings : {};
    const scan = (s.scan && typeof s.scan === 'object') ? s.scan : {};
    const pick = (v, allowed, def) => allowed.includes(v) ? v : def;
    return {
        accessMode: pick(s.accessMode, ACCESS_MODES.map(m => m.value), SETTINGS_DEFAULTS.accessMode),
        dwellMs: pick(Number(s.dwellMs), DWELL_OPTIONS, SETTINGS_DEFAULTS.dwellMs),
        scan: {
            pattern: pick(scan.pattern, SCAN_PATTERNS.map(p => p.value), SETTINGS_DEFAULTS.scan.pattern),
            intervalMs: pick(Number(scan.intervalMs), SCAN_INTERVALS, SETTINGS_DEFAULTS.scan.intervalMs),
            audio: pick(scan.audio, SCAN_AUDIO.map(a => a.value), SETTINGS_DEFAULTS.scan.audio)
        }
    };
}

async function saveSettings(user, draft, saveBtn) {
    const prev = (user.settings && typeof user.settings === 'object') ? user.settings : {};
    const prevScan = (prev.scan && typeof prev.scan === 'object') ? prev.scan : {};
    // Merge: no se pierden claves que no maneja esta pantalla (p. ej. vocabularyLevel)
    const settings = {
        ...prev,
        accessMode: draft.accessMode,
        dwellMs: draft.dwellMs,
        scan: { ...prevScan, ...draft.scan }
    };
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';
    let error = null;
    try {
        ({ error } = await supabaseClient.from('aac_users').update({ settings }).eq('id', user.id));
    } catch (err) {
        error = err;
    }
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar configuración';
    if (error) {
        console.error('Error guardando la configuración de la tablet:', error);
        customAlert('No se pudo guardar la configuración. Revisá la conexión e intentá de nuevo.');
        return;
    }
    user.settings = settings;
    settingsDrafts.delete(user.id);
    const msg = `Listo: la tablet de ${user.display_name} va a usar ${ACCESS_MODE_NAMES[settings.accessMode]} la próxima vez que se conecte.`;
    if (typeof showInfoToast === 'function') showInfoToast(msg, 5000); else customAlert(msg);
    renderUsersList(`settings-save:${user.id}`);
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

function shortDate(iso) {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}`;
}

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

function renderTablet(user) {
    const box = el('div', 'user-tablet');

    // Tablet(s) vinculada(s)
    if (user.devicesError) {
        box.appendChild(el('p', 'user-note', 'No pudimos ver si tiene una tablet vinculada.'));
    } else if (!user.devices.length) {
        box.appendChild(el('p', 'user-note', 'Sin tablet vinculada.'));
    } else {
        user.devices.forEach((device, i) => {
            const row = el('div', 'user-row');
            const label = user.devices.length > 1 ? `Tablet ${i + 1} vinculada` : 'Tablet vinculada';
            const seen = device.last_seen_at ? ` · última conexión ${shortDate(device.last_seen_at)}` : '';
            row.appendChild(el('span', 'user-device', device.created_at ? `${label} desde el ${shortDate(device.created_at)}${seen}` : label));
            row.appendChild(button('Desvincular tablet', `Desvincular la tablet de ${user.display_name}`, () => unlinkDevice(user, device)));
            box.appendChild(row);
        });
    }

    // Código de vinculación
    const row = el('div', 'user-row');
    const code = el('span', 'user-code');
    if (user.codesError) {
        code.textContent = 'No pudimos cargar el código para vincular su tablet.';
    } else if (user.access_code) {
        const days = Math.max(0, Math.ceil((new Date(user.access_code_expires) - Date.now()) / 86400000));
        code.textContent = `Código para vincular su tablet: ${user.access_code} · un solo uso · vence en ${days} ${days === 1 ? 'día' : 'días'}`;
    } else {
        code.textContent = 'Sin código vigente para vincular una tablet.';
    }
    row.appendChild(code);
    const gen = button(user.access_code ? 'Nuevo código' : 'Generar código',
        `${user.access_code ? 'Nuevo código' : 'Generar código'} para la tablet de ${user.display_name}`,
        () => generateCode(user.id));
    gen.title = 'Genera un código de un solo uso (vence en 7 días). El código anterior deja de servir.';
    row.appendChild(gen);
    box.appendChild(row);
    return box;
}

function seconds(ms) {
    const s = String(ms / 1000).replace('.', ',');
    return s === '1' ? '1 segundo' : `${s} segundos`;
}

/** Campo con label visible asociado (for/id) a un select. */
function selectField(id, labelText, options, value, onChange) {
    const field = el('div', 'user-settings-field');
    const label = el('label', 'user-settings-label', labelText);
    label.htmlFor = id;
    const sel = el('select', 'glass-select user-settings-select');
    sel.id = id;
    options.forEach(opt => {
        const o = el('option', null, opt.label);
        o.value = String(opt.value);
        sel.appendChild(o);
    });
    sel.value = String(value);
    sel.addEventListener('change', () => onChange(sel.value));
    field.appendChild(label);
    field.appendChild(sel);
    return field;
}

/** F4-6: "Configuración de su tablet" (plegable). Edita aac_users.settings. */
function renderSettings(user) {
    const box = el('div', 'user-settings');
    const panelId = `user-settings-${user.id}`;
    const open = expandedSettings.has(user.id);

    const toggle = button(open ? 'Ocultar configuración de su tablet' : 'Configuración de su tablet',
        `${open ? 'Ocultar' : 'Ver'} la configuración de la tablet de ${user.display_name}`, () => {
            if (expandedSettings.has(user.id)) expandedSettings.delete(user.id); else expandedSettings.add(user.id);
            renderUsersList(`settings-toggle:${user.id}`);
        }, 'btn btn-secondary user-btn user-settings-toggle');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-controls', panelId);
    toggle.dataset.focusKey = `settings-toggle:${user.id}`;
    box.appendChild(toggle);

    const panel = el('div', 'user-settings-panel');
    panel.id = panelId;
    panel.hidden = !open;
    box.appendChild(panel);
    if (!open) return box;

    if (!settingsDrafts.has(user.id)) settingsDrafts.set(user.id, accessSettingsOf(user));
    const draft = settingsDrafts.get(user.id);

    panel.appendChild(el('p', 'user-note', 'Se aplica en la tablet vinculada la próxima vez que se abra o se conecte. Un adulto puede cambiarlo en la tablet manteniendo apretada la esquina superior derecha.'));

    const grid = el('div', 'user-settings-grid');
    const base = `us-${user.id}`;

    const caraFields = [];
    const scanFields = [];
    const updateVisibility = () => {
        caraFields.forEach(f => { f.hidden = draft.accessMode !== 'CARA'; });
        scanFields.forEach(f => { f.hidden = draft.accessMode !== 'SCAN'; });
    };

    grid.appendChild(selectField(`${base}-mode`, 'Modo de acceso', ACCESS_MODES, draft.accessMode, v => {
        draft.accessMode = v;
        updateVisibility();
    }));

    const dwell = selectField(`${base}-dwell`, 'Tiempo de fijación (Rostro)',
        DWELL_OPTIONS.map(ms => ({ value: ms, label: seconds(ms) })), draft.dwellMs, v => { draft.dwellMs = Number(v); });
    caraFields.push(dwell);
    grid.appendChild(dwell);

    const pattern = selectField(`${base}-pattern`, 'Patrón', SCAN_PATTERNS, draft.scan.pattern, v => { draft.scan.pattern = v; });
    const speed = selectField(`${base}-interval`, 'Velocidad',
        SCAN_INTERVALS.map(ms => ({ value: ms, label: seconds(ms) })), draft.scan.intervalMs, v => { draft.scan.intervalMs = Number(v); });
    const audio = selectField(`${base}-audio`, 'Sonido al barrer', SCAN_AUDIO, draft.scan.audio, v => { draft.scan.audio = v; });
    [pattern, speed, audio].forEach(f => { scanFields.push(f); grid.appendChild(f); });

    updateVisibility();
    panel.appendChild(grid);

    const saveBtn = button('Guardar configuración', `Guardar la configuración de la tablet de ${user.display_name}`,
        () => saveSettings(user, draft, saveBtn), 'btn btn-primary user-btn');
    saveBtn.dataset.focusKey = `settings-save:${user.id}`;
    const row = el('div', 'user-row');
    row.appendChild(saveBtn);
    panel.appendChild(row);
    return box;
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

    users.forEach(user => {
        const card = el('div', 'glass-box user-card');

        // Cabecera: nombre + Ver tableros + eliminar
        const head = el('div', 'user-row user-head');
        head.appendChild(el('strong', 'user-name', user.display_name)); // nunca innerHTML (XSS)

        const headActions = el('div', 'user-row');
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
        headActions.appendChild(toggle);

        const deleteBtn = el('button', 'btn-icon user-btn-icon');
        deleteBtn.type = 'button';
        deleteBtn.style.color = 'var(--danger-text)';
        // SVG fijo (sin datos de personas)
        deleteBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
        deleteBtn.title = 'Eliminar usuario';
        deleteBtn.setAttribute('aria-label', `Eliminar a ${user.display_name}`);
        deleteBtn.addEventListener('click', async () => {
            const confirmed = await customConfirm(`¿Eliminar a ${user.display_name}? Se borran también sus copias de tableros y su tablet queda desvinculada. No se puede deshacer.`);
            if (confirmed) await deleteUser(user.id);
        });
        headActions.appendChild(deleteBtn);
        head.appendChild(headActions);
        card.appendChild(head);

        card.appendChild(renderTablet(user));
        card.appendChild(renderSettings(user));

        const panel = el('div', 'user-copies');
        panel.id = panelId;
        panel.hidden = !open;
        if (open) renderCopies(user, panel);
        card.appendChild(panel);

        listEl.appendChild(card);
    });

    if (focusKey) {
        const target = [...listEl.querySelectorAll('[data-focus-key]')].find(n => n.dataset.focusKey === focusKey);
        if (target) target.focus();
    }
}

export function initUsers() {
    const btnCreate = document.getElementById('btn-create-user');
    const inputName = document.getElementById('new-user-name');

    if (btnCreate && inputName) {
        btnCreate.addEventListener('click', async () => {
            const name = inputName.value.trim();
            if (!name) return;

            btnCreate.disabled = true;
            btnCreate.textContent = 'Creando...';

            await createUser(name);

            inputName.value = '';
            btnCreate.disabled = false;
            btnCreate.textContent = 'Crear usuario';
        });
    }
}
