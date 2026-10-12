// Tests del registro de uso (1.9.0): resumen puro, cola de la tablet y ver_progreso del servidor MCP
const store = new Map();
globalThis.localforage = { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, JSON.parse(JSON.stringify(v))); return v; } };
const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) };
globalThis.window = { addEventListener() {}, innerWidth: 1180, innerHeight: 734 };
globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
globalThis.setInterval = () => 0;

const { summarizeUsage } = await import('../web/js/metrics-summary.js');
const metrics = await import('../web/js/metrics.js');
const { handle } = await import('../web/api/_mcp.js');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.stack.split('\n').slice(0, 2).join(' ')); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

const BOARD = { name: 'Merienda', mainBoard: 'g', boards: { g: { id: 'g', label: { es: 'Merienda' }, gridElements: [
    { id: 'c1', x: 0, y: 0, label: { es: 'Agua' }, actions: [{ modelName: 'GridActionSpeak' }] },
    { id: 'c2', x: 1, y: 0, label: { es: 'Leche' }, actions: [{ modelName: 'GridActionSpeak' }] },
    { id: 'c3', x: 2, y: 0, label: { es: 'Galletitas' }, actions: [{ modelName: 'GridActionSpeak' }] }
] } } };
const at = (min, sec = 0) => new Date(Date.UTC(2026, 9, 11, 14, min, sec)).toISOString();
function sampleEvents() {
    const ev = [{ ts: at(0), kind: 'sesion_inicio', session_id: 's1' }, { ts: at(0, 2), kind: 'tablero', session_id: 's1', label: 'Merienda' }];
    for (let i = 0; i < 12; i++) ev.push({ ts: at(1 + i), kind: 'seleccion', session_id: 's1', cell_id: i % 2 ? 'c2' : 'c1', label: i % 2 ? 'Leche' : 'Agua', method: 'permanencia', duration_ms: i < 4 ? 2000 : i >= 8 ? 4000 : 3000 });
    ev.push({ ts: at(12, 2), kind: 'borrar', session_id: 's1' });
    ev.push({ ts: at(14), kind: 'frase', session_id: 's1', label: 'agua leche', data: { n: 2, texto: 'agua leche' } });
    ev.push({ ts: at(15), kind: 'pausa', session_id: 's1', label: 'sin cara', duration_ms: 5000 });
    ev.push({ ts: at(20), kind: 'sesion_fin', session_id: 's1', duration_ms: 1200000 });
    return ev;
}

console.log('registro de uso');
await t('resumen: uso, tiempos, cansancio, correcciones, celdas más usadas y sin uso, frases', () => {
    const s = summarizeUsage(sampleEvents(), { boards: [{ name: 'Merienda', bundle: BOARD }] });
    assert(s.dias_activos === 1 && s.sesiones === 1 && s.minutos_de_uso === 20 && s.selecciones === 12, JSON.stringify(s).slice(0, 200));
    assert(s.tiempo_por_seleccion_ms.mediana === 3000 && s.variacion_tiempos.inicio_ms === 2000 && s.variacion_tiempos.final_ms === 4000 && s.variacion_tiempos.cambio === 1, JSON.stringify(s.variacion_tiempos));
    assert(s.correcciones === 1 && s.pausas_sin_cara === 1 && s.frases === 1 && s.largo_medio_frase === 2, 'conteos');
    assert(s.celdas_mas_usadas[0].veces === 6 && s.cantidad_celdas_sin_uso_registrado === 1 && s.celdas_sin_uso_registrado[0].celda === 'Galletitas', JSON.stringify(s.celdas_sin_uso_registrado));
    assert(s.frases_recientes[0].texto === 'agua leche' && s.metodos.permanencia === 12, 'frases y métodos');
});
await t('celdas con texto raro (autoLabel no texto, label numérico) no rompen el resumen', () => {
    const odd = { mainBoard: 'g', boards: { g: { id: 'g', gridElements: [{ id: 'x', label: {}, autoLabel: { es: 'Hola', source: 'arasaac' } }, { id: 'y', label: null, autoLabel: true }] } } };
    const s = summarizeUsage([], { boards: [{ name: 'Raro', bundle: odd }] });
    assert(Array.isArray(s.celdas_sin_uso_registrado) && s.celdas_sin_uso_registrado.some(c => c.celda === 'Hola'), JSON.stringify(s.celdas_sin_uso_registrado));
});
await t('sin eventos: resumen vacío sin errores', () => {
    const s = summarizeUsage([], {});
    assert(s.selecciones === 0 && s.variacion_tiempos === null && s.periodo === null, JSON.stringify(s).slice(0, 100));
});

let device = null;
const rpcCalls = [];
const fakeSb = { rpc: async (fn, args) => { rpcCalls.push({ fn, n: args.p_events.length }); return { data: { ok: true, saved: args.p_events.length }, error: null }; } };
metrics.initMetrics({ supabase: fakeSb, device: () => device });
await new Promise(r => setTimeout(r, 10));
const ctx = { bundle: { id: 'b1', bundleId: 'b1', assignmentId: '00000000-0000-0000-0000-0000000000aa', name: 'Merienda' }, gridId: 'g', pageName: 'Merienda' };
await t('tablet sin consentimiento: no registra nada', () => {
    device = { token: 'tok', aacUserId: 'A', settings: {} };
    metrics.cellSelected({ id: 'c1', x: 0, y: 0 }, ctx, 'permanencia', 'Agua');
    assert(metrics._state().queue.length === 0 && !metrics.isRecording(), 'nada');
});
await t('con consentimiento: sesión, página y selecciones con método y tiempo; se suben en tandas', async () => {
    device = { token: 'tok', aacUserId: 'A', settings: { metrics: { enabled: true } } };
    metrics.pageShown(ctx);
    metrics.cellSelected({ id: 'c1', x: 0, y: 0, colorCategory: 'CC_NOUN' }, ctx, 'parpadeo', 'Agua');
    metrics.cellSelected({ id: 'c2', x: 1, y: 0 }, ctx, 'permanencia', 'Leche');
    metrics.sentenceSpoken([{ text: 'Agua' }, { text: 'Leche', speakText: 'leche fría' }], ctx);
    const q = metrics._state().queue;
    const kinds = q.map(e => e.kind);
    assert(kinds.join() === 'sesion_inicio,tablero,seleccion,seleccion,frase', kinds.join());
    const s1 = q.find(e => e.kind === 'seleccion');
    assert(s1.method === 'parpadeo' && s1.board === 'b1' && s1.assignment && s1.data.fila === 1 && s1.ms === null, JSON.stringify(s1));
    assert(q[3].ms >= 0 && q[4].data.texto === 'Agua leche fría', 'tiempo y texto');
    await metrics.flush();
    assert(rpcCalls.length === 1 && rpcCalls[0].fn === 'device_log_events' && rpcCalls[0].n === 5 && metrics._state().queue.length === 0, JSON.stringify(rpcCalls));
});
await t('pausa desde la tablet: deja de registrar y lo avisa; al reanudar vuelve', async () => {
    metrics.setPaused(true);
    metrics.cellSelected({ id: 'c3' }, ctx, 'toque', 'Galletitas');
    const kinds = metrics._state().queue.map(e => e.kind);
    assert(kinds.includes('registro_pausado') && !kinds.includes('seleccion') && !metrics.isRecording(), kinds.join());
    metrics.setPaused(false);
    assert(metrics.isRecording() && metrics._state().queue.some(e => e.kind === 'registro_reanudado'), 'reanudado');
});
await t('si la cuenta desactivó el registro, lo pendiente se descarta', async () => {
    await new Promise(r => setTimeout(r, 30)); // que termine la subida que disparó la pausa
    fakeSb.rpc = async () => ({ data: { ok: false, disabled: true }, error: null });
    metrics.cellSelected({ id: 'c1' }, ctx, 'toque', 'Agua');
    await metrics.flush();
    assert(metrics._state().queue.length === 0, 'descartado');
});

await t('0.7.5 H01: eventos pendientes de A no se envían con el vínculo de B; desvincular vacía la cola', async () => {
    const online = (v) => Object.defineProperty(globalThis, 'navigator', { value: { onLine: v }, configurable: true, writable: true });
    let sent = [];
    fakeSb.rpc = async (fn, args) => { sent.push(...args.p_events); return { data: { ok: true }, error: null }; };
    online(false);
    device = { token: 'tokA', aacUserId: 'A', settings: { metrics: { enabled: true } } };
    metrics.cellSelected({ id: 'c1' }, ctx, 'toque', 'Agua');
    assert(metrics._state().queue.length >= 1 && metrics._state().queue.every(e => e.own === 'A'), 'dueño A');
    device = { token: 'tokB', aacUserId: 'B', settings: { metrics: { enabled: true } } };
    online(true);
    await metrics.flush();
    assert(sent.length === 0 && metrics._state().queue.length === 0, 'no se reatribuye: ' + JSON.stringify(sent));
    metrics.cellSelected({ id: 'c2' }, ctx, 'toque', 'Leche');
    await metrics.flush();
    assert(sent.length >= 1 && sent.every(e => !('own' in e)), 'B se envía sin el campo interno');
    online(false);
    metrics.cellSelected({ id: 'c3' }, ctx, 'toque', 'Galletitas');
    await metrics.clearQueue();
    assert(metrics._state().queue.length === 0, 'vaciada al desvincular');
    online(true);
});

await t('MCP ver_progreso y ver_eventos', async () => {
    const db = {
        select: async (table, q) => {
            if (table === 'aac_users') return [{ id: 'u1', display_name: 'Mateo', settings: { metrics: { enabled: true } } }];
            if (table === 'assignments') return [{ id: 'a1', copy_bundle: BOARD }];
            if (table === 'usage_events') return q.includes('kind=eq.frase') ? sampleEvents().filter(e => e.kind === 'frase') : [...sampleEvents()].reverse();
            return [];
        }
    };
    const call = async (name, args) => JSON.parse((await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { db, user: { id: 'p' }, base: 'x' })).result.content[0].text);
    const p = await call('ver_progreso', { usuario: 'u1', dias: 7 });
    assert(p.usuario === 'Mateo' && p.registro_activado && p.selecciones === 12 && p.celdas_sin_uso_registrado[0].celda === 'Galletitas', JSON.stringify(p).slice(0, 200));
    const e = await call('ver_eventos', { usuario: 'u1', tipo: 'frase' });
    assert(e.cantidad === 1 && e.eventos[0].tipo === 'frase', JSON.stringify(e));
});
console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
