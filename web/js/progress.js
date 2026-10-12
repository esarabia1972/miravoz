// progress.js — Pestaña "Progreso" de un usuario (1.9.0): resume los eventos de uso de su tablet.
// El cálculo es el mismo que usa Claude (metrics-summary.js). Los textos de usuarios y tableros van con textContent.

import { supabaseClient } from './auth.js';
import { customConfirm, customAlert } from './ui.js';
import { summarizeUsage } from './metrics-summary.js';

let panel = null;

function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
const secs = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };
const METHOD_NAMES = { permanencia: 'Fijación', parpadeo: 'Parpadeo', barrido: 'Barrido', toque: 'Toque' };

function ensurePanel() {
    if (panel) return panel;
    panel = el('div', 'modal-overlay fullscreen-panel');
    panel.id = 'progress-view';
    panel.style.display = 'none';
    panel.style.zIndex = '11000';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    const inner = el('div', 'fullscreen-panel-inner');
    const header = el('div', 'fullscreen-panel-header');
    const back = el('button', 'fullscreen-back');
    back.type = 'button';
    back.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg><span>Volver</span>';
    back.onclick = () => { panel.style.display = 'none'; };
    const title = el('h2', null, 'Estadística'); title.id = 'progress-title';
    const range = el('select', 'glass-select progress-range'); range.id = 'progress-range';
    for (const [v, t] of [['7', 'Últimos 7 días'], ['30', 'Últimos 30 días'], ['90', 'Últimos 90 días']]) { const o = el('option', null, t); o.value = v; range.appendChild(o); }
    range.value = '30';
    header.append(back, title, range);
    const body = el('div', 'progress-body'); body.id = 'progress-body';
    inner.append(header, body);
    panel.appendChild(inner);
    document.body.appendChild(panel);
    return panel;
}

let opts = {};
export async function openProgress(user, options = {}) {
    opts = options;
    ensurePanel();
    panel.style.display = 'flex';
    document.getElementById('progress-title').textContent = `Estadística de ${user.display_name}`;
    const range = document.getElementById('progress-range');
    range.onchange = () => load(user, Number(range.value));
    await load(user, Number(range.value));
}

async function load(user, days) {
    const body = document.getElementById('progress-body');
    body.replaceChildren(el('p', 'user-note', 'Cargando…'));
    try {
        const since = new Date(Date.now() - days * 86400000).toISOString();
        const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('la consulta tardó demasiado')), ms));
        const [evRes, asgRes] = await Promise.race([Promise.all([
            supabaseClient.from('usage_events').select('ts,kind,session_id,board_id,assignment_id,page_id,cell_id,label,method,duration_ms,data')
                .eq('aac_user_id', user.id).gte('ts', since).order('ts', { ascending: false }).limit(20000),
            supabaseClient.from('assignments').select('id,copy_bundle').eq('aac_user_id', user.id)
        ]), timeout(15000)]);
        if (evRes.error) {
            body.replaceChildren(el('p', 'user-note', `No se pudo cargar el registro (${evRes.error.message || evRes.error.code || 'error'}). ¿Ya se corrió supabase/10_metricas_de_uso.sql?`));
            return;
        }
        const boards = (asgRes.data || []).map(a => ({ name: a.copy_bundle?.name, bundle: a.copy_bundle || {}, assignment_id: a.id }));
        const s = summarizeUsage(evRes.data || [], { boards, recentPhrases: 30 });
        render(body, s, user);
        if (!user.settings?.metrics?.enabled) body.prepend(el('p', 'user-note', 'El registro de uso está desactivado para este usuario. Se activa abajo, con el consentimiento de la persona o su familia.'));
    } catch (e) {
        console.error('Progreso:', e);
        body.replaceChildren(el('p', 'user-note', `No se pudo mostrar el progreso: ${e?.message || e}`));
    }
}

function card(label, value, note) {
    const c = el('div', 'progress-card');
    c.append(el('span', 'progress-card-value', String(value)), el('span', 'progress-card-label', label));
    if (note) c.appendChild(el('span', 'progress-card-note', note));
    return c;
}

function list(title, items, fmt, empty) {
    const sec = el('section', 'progress-section');
    sec.appendChild(el('h3', null, title));
    if (!items.length) { sec.appendChild(el('p', 'user-note', empty)); return sec; }
    const ul = el('ul', 'progress-list');
    items.forEach(i => ul.appendChild(el('li', null, fmt(i))));
    sec.appendChild(ul);
    return sec;
}

function render(body, s, user) {
    body.replaceChildren();
    if (!s.selecciones && !s.sesiones) {
        body.appendChild(el('p', 'user-note', 'Todavía no hay registros en este período.'));
    }
    const cards = el('div', 'progress-cards');
    cards.append(
        card('días con uso', s.dias_activos),
        card('minutos de uso', s.minutos_de_uso, `${s.sesiones} sesiones`),
        card('selecciones', s.selecciones),
        card('frases dichas', s.frases, s.largo_medio_frase ? `${String(s.largo_medio_frase).replace('.', ',')} pictogramas en promedio` : null),
        card('tiempo por selección', secs(s.tiempo_por_seleccion_ms.mediana), s.tiempo_por_seleccion_ms.p90 ? `9 de cada 10 en menos de ${secs(s.tiempo_por_seleccion_ms.p90)}` : null),
        card('correcciones', s.correcciones, `${s.canceladas} selecciones abandonadas`)
    );
    body.appendChild(cards);

    // Selecciones por día (barras simples)
    if (s.selecciones_por_dia.length) {
        const sec = el('section', 'progress-section');
        sec.appendChild(el('h3', null, 'Selecciones por día'));
        const chart = el('div', 'progress-bars');
        const max = Math.max(...s.selecciones_por_dia.map(d => d.selecciones));
        s.selecciones_por_dia.forEach(d => {
            const bar = el('div', 'progress-bar-col');
            bar.title = `${d.dia}: ${d.selecciones}`;
            const fill = el('div', 'progress-bar-fill'); fill.style.height = `${Math.max(4, (d.selecciones / max) * 100)}%`;
            bar.append(fill, el('span', 'progress-bar-label', d.dia.slice(8, 10)));
            chart.appendChild(bar);
        });
        sec.appendChild(chart);
        body.appendChild(sec);
    }

    const grid = el('div', 'progress-grid');
    grid.appendChild(list('Celdas más usadas', s.celdas_mas_usadas, i => `${i.celda} · ${i.veces}`, 'Sin selecciones todavía.'));
    grid.appendChild(list(`Sin uso registrado en el período (${s.cantidad_celdas_sin_uso_registrado})`, s.celdas_sin_uso_registrado.slice(0, 30), i => `${i.celda} — ${i.tablero}, ${i.pagina}`,
        s.selecciones ? 'Todas las celdas de sus tableros tienen uso registrado en el período.' : 'Sin datos en el período.'));
    const other = [];
    const v = s.variacion_tiempos;
    if (v) other.push(`Variación del tiempo entre selecciones: al principio de la sesión ${secs(v.inicio_ms)} por selección y al final ${secs(v.final_ms)}${v.cambio != null ? ` (${v.cambio > 0 ? '+' : ''}${Math.round(v.cambio * 100)}%)` : ''}. Es una observación de tiempos, no indica la causa.`);
    const m = Object.entries(s.metodos).map(([k, v]) => `${METHOD_NAMES[k] || k}: ${v}`).join(' · ');
    if (m) other.push(`Cómo elige: ${m}.`);
    other.push(`Pausas porque no se veía la cara: ${s.pausas_sin_cara}. Calibraciones: ${s.calibraciones}. Alineaciones: ${s.alineaciones}.`);
    if (s.idas_y_vueltas) other.push(`Idas y vueltas entre páginas sin elegir nada: ${s.idas_y_vueltas} (puede que no encuentre algo).`);
    if (s.practica) other.push(`Actividades de Practicar: ${s.practica}.`);
    grid.appendChild(list('Acceso', other, x => x, ''));
    grid.appendChild(list('Frases recientes', s.frases_recientes, f => `${fmtDate(f.cuando)} · ${f.texto}`, 'Sin frases dichas todavía.'));
    body.appendChild(grid);

    const del = el('button', 'btn btn-danger-outline', 'Borrar el registro de este usuario');
    del.type = 'button';
    del.onclick = async () => {
        if (!(await customConfirm(`¿Borrar todo el registro de uso de ${user.display_name}? No se puede deshacer.`))) return;
        const { error } = await supabaseClient.from('usage_events').delete().eq('aac_user_id', user.id);
        if (error) customAlert('No se pudo borrar. Revisá la conexión e intentá de nuevo.');
        else load(user, Number(document.getElementById('progress-range').value));
    };
    const foot = el('div', 'progress-foot');
    if (opts.toggleMetrics) {
        const on = !!user.settings?.metrics?.enabled;
        const tog = el('button', 'btn btn-secondary', on ? 'Desactivar registro' : 'Activar registro');
        tog.type = 'button';
        tog.title = on ? 'Desde la próxima conexión no se guarda nada más; lo ya registrado se conserva.' : 'Registrar el uso para ver su estadística (necesita consentimiento).';
        tog.onclick = async () => { if (await opts.toggleMetrics()) load(user, Number(document.getElementById('progress-range').value)); };
        foot.appendChild(tog);
    }
    foot.appendChild(del);
    body.appendChild(foot);
}
