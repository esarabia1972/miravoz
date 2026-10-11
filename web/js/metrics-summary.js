// metrics-summary.js — Resumen de los eventos de uso (1.9.0) · PURO (sin DOM ni red), lo usan la pestaña
// Progreso de la app y el servidor MCP (Claude). Entrada: filas de usage_events (las más nuevas o en cualquier
// orden) y, opcionalmente, los tableros asignados al usuario (para encontrar las celdas que nunca se usan).

import { labelText } from './asterics.js';
import { pageOrder, gridName } from './pages.js';

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]; };
const dayKey = (ts) => String(ts).slice(0, 10);
const norm = (s) => String(s || '').trim().toLocaleLowerCase('es');

/**
 * @param {Array} events  filas { ts, kind, session_id, board_id, assignment_id, page_id, cell_id, label, method, duration_ms, data }
 * @param {{ boards?: Array<{ name, bundle, assignment_id? }>, recentPhrases?: number }} opts
 */
export function summarizeUsage(events, { boards = [], recentPhrases = 20 } = {}) {
    const ev = [...(events || [])].filter(e => e && e.ts && e.kind).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    const sel = ev.filter(e => e.kind === 'seleccion');
    const days = new Set(ev.map(e => dayKey(e.ts)));
    // Sesiones: por session_id (o cortes de más de 10 min sin actividad)
    const sessions = new Map();
    for (const e of ev) {
        const k = e.session_id || `s-${dayKey(e.ts)}`;
        const t = Date.parse(e.ts);
        const s = sessions.get(k) || { start: t, end: t, sel: [] };
        s.start = Math.min(s.start, t); s.end = Math.max(s.end, t);
        if (e.kind === 'seleccion') s.sel.push(e);
        sessions.set(k, s);
    }
    const sessList = [...sessions.values()];
    const minutes = Math.round(sessList.reduce((a, s) => a + Math.max(0, s.end - s.start), 0) / 60000);

    // Tiempo por selección (desde la anterior en la misma sesión; se descartan pausas largas > 60 s)
    const times = sel.map(e => e.duration_ms).filter(ms => Number.isFinite(ms) && ms > 0 && ms <= 60000);
    // Fatiga: primer tercio contra último tercio de cada sesión con al menos 9 selecciones
    const first = [], last = [];
    for (const s of sessList) {
        const t = s.sel.map(e => e.duration_ms).filter(ms => Number.isFinite(ms) && ms > 0 && ms <= 60000);
        if (t.length < 9) continue;
        const k = Math.floor(t.length / 3);
        first.push(...t.slice(0, k)); last.push(...t.slice(-k));
    }
    const fatigue = first.length ? { inicio_ms: median(first), final_ms: median(last), cambio: median(last) && median(first) ? +((median(last) / median(first)) - 1).toFixed(2) : null } : null;

    // Correcciones: "borrar" dentro de los 5 s siguientes a una selección
    let corrections = 0;
    for (let i = 1; i < ev.length; i++) {
        if (ev[i].kind === 'borrar' && ev[i - 1].kind === 'seleccion' && Date.parse(ev[i].ts) - Date.parse(ev[i - 1].ts) < 5000) corrections++;
    }
    const count = (arr, keyFn) => { const m = new Map(); for (const x of arr) { const k = keyFn(x); if (!k) continue; m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const methods = Object.fromEntries(count(sel, e => e.method || 'toque'));
    const topCells = count(sel, e => (e.label ? norm(e.label) : null)).slice(0, 15).map(([label, veces]) => ({ celda: label, veces }));
    const pages = count(ev.filter(e => e.kind === 'pagina' || e.kind === 'tablero'), e => e.label || e.page_id).slice(0, 10).map(([pagina, veces]) => ({ pagina, veces }));
    const phrases = ev.filter(e => e.kind === 'frase');
    const phraseLens = phrases.map(e => Number(e.data?.n)).filter(Number.isFinite);
    // Ida y vuelta: entrar a una página y volver sin elegir nada (señal de que no encuentra algo)
    let bounces = 0;
    for (let i = 1; i < ev.length - 1; i++) {
        if (ev[i].kind === 'pagina' && ev[i + 1].kind === 'pagina' && Date.parse(ev[i + 1].ts) - Date.parse(ev[i].ts) < 8000) bounces++;
    }

    // Celdas que nunca se usaron (en los tableros asignados), por id de celda o por texto
    const usedIds = new Set(sel.map(e => e.cell_id).filter(Boolean));
    const usedLabels = new Set(sel.map(e => norm(e.label)).filter(Boolean));
    const unused = [];
    for (const b of boards) {
        const bundle = b.bundle || {};
        for (const pid of pageOrder(bundle)) {
            const g = bundle.boards[pid];
            for (const el of g.gridElements || []) {
                const text = String(labelText(el.label) || (el.autoLabel && typeof el.autoLabel === 'object' ? String(el.autoLabel.es || '') : (typeof el.autoLabel === 'string' ? el.autoLabel : '')) || '');
                if (!text.trim()) continue;
                if (usedIds.has(el.id) || usedLabels.has(norm(text))) continue;
                const navOnly = (el.actions || []).some(a => a.toGridId || a.navType) && !(el.actions || []).some(a => /Speak/.test(a.modelName || ''));
                unused.push({ tablero: b.name || bundle.name, pagina: gridName(g), celda: text, fila: (el.y || 0) + 1, columna: (el.x || 0) + 1, ...(navOnly ? { solo_navega: true } : {}) });
            }
        }
    }

    const perDay = count(sel, e => dayKey(e.ts)).sort((a, b) => a[0].localeCompare(b[0])).map(([dia, selecciones]) => ({ dia, selecciones }));
    return {
        periodo: ev.length ? { desde: ev[0].ts, hasta: ev[ev.length - 1].ts } : null,
        dias_activos: days.size,
        sesiones: sessList.length,
        minutos_de_uso: minutes,
        selecciones: sel.length,
        selecciones_por_dia: perDay,
        tiempo_por_seleccion_ms: { mediana: median(times), p90: pct(times, 0.9) },
        fatiga: fatigue,
        metodos: methods,
        canceladas: ev.filter(e => e.kind === 'cancelada').length,
        correcciones: corrections,
        pausas_sin_cara: ev.filter(e => e.kind === 'pausa').length,
        calibraciones: ev.filter(e => e.kind === 'calibracion').length,
        alineaciones: ev.filter(e => e.kind === 'alineacion').length,
        frases: phrases.length,
        largo_medio_frase: phraseLens.length ? +(phraseLens.reduce((a, b) => a + b, 0) / phraseLens.length).toFixed(1) : null,
        celdas_mas_usadas: topCells,
        celdas_sin_uso: unused.slice(0, 200),
        cantidad_celdas_sin_uso: unused.length,
        paginas_mas_visitadas: pages,
        idas_y_vueltas: bounces,
        practica: ev.filter(e => e.kind === 'practica').length,
        frases_recientes: phrases.slice(-recentPhrases).reverse().map(e => ({ cuando: e.ts, texto: e.data?.texto || e.label || '' }))
    };
}
