// Tests del contexto único de selección (M03): diálogos y superposiciones sobre el tablero. Escenarios T11–T12.
// Usa SelectionContexts, DwellEngine y PointerController reales con reloj controlado. Correr: node tools/test-contexts.mjs
let fakeNow = 10000;
globalThis.performance = { now: () => fakeNow };
globalThis.window = { addEventListener() {}, innerWidth: 1000, innerHeight: 800 };
globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };

const { CONFIG } = await import('../web/js/config.js');
const { DwellEngine } = await import('../web/js/dwell.js');
const { PointerController } = await import('../web/js/selection.js');
const { SelectionContexts } = await import('../web/js/contexts.js');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

const el = (id, left, right, top = 0, bottom = 800) => ({
    id, isConnected: true,
    getBoundingClientRect: () => ({ left, right, top, bottom, width: right - left, height: bottom - top }),
    classList: { add() {}, remove() {} }, querySelector: () => null
});
const target = (id, l, r, t, b) => ({ element: el(id, l, r, t, b), data: { id } });

function setup() {
    fakeNow = 10000;
    const selected = [];
    const dwell = new DwellEngine(tg => selected.push(tg.element.id));
    const id = { filter: x => x, reset() {} };
    const pointer = new PointerController({ dwell, filterX: id, filterY: id, maxAgeMs: () => CONFIG.MAX_SAMPLE_AGE_MS });
    let board = [target('celda-A', 0, 400), target('celda-B', 500, 900)];
    const applied = [];
    const ctx = new SelectionContexts({
        apply: (targets, info) => { applied.push(info.name); dwell.setTargets(targets); },
        baseTargets: () => board,
        onChange: () => pointer.invalidate('context', fakeNow)
    });
    ctx.setBase(board);
    let seq = 0;
    const look = (x, y, ms) => {
        for (let e = 0; e < ms; e += 1000 / 30) {
            fakeNow += 1000 / 30;
            pointer.step({ sessionId: 1, sequence: ++seq, capturedAt: fakeNow, valid: true, x, y }, fakeNow);
        }
    };
    return { ctx, dwell, pointer, selected, applied, look, setBoard: (b) => { board = b; } };
}

console.log('contextos (M03)');
t('T11 con un diálogo arriba, solo sus botones se pueden activar (el tablero cubierto no)', () => {
    const { ctx, selected, look } = setup();
    look(200, 400, CONFIG.DWELL_MS - 200);            // casi completa la celda A…
    const ok = target('btn-ok', 150, 250, 350, 450);  // …y aparece un diálogo justo encima
    const tok = ctx.push('dialog', () => [ok]);
    look(50, 100, CONFIG.DWELL_MS + 400);            // mira la celda A por fuera del botón
    assert(selected.length === 0, 'se activó el tablero cubierto: ' + selected);
    look(200, 400, CONFIG.DWELL_MS + 400);           // mira el botón del diálogo
    assert(selected.length === 1 && selected[0] === 'btn-ok', JSON.stringify(selected));
    ctx.pop(tok);
});
t('T11 el tablero se redibuja con el diálogo abierto: sus objetivos se guardan pero no se activan', () => {
    const { ctx, applied, selected, look, setBoard } = setup();
    const tok = ctx.push('dialog', () => [target('btn-ok', 0, 100, 0, 100)]);
    const nuevo = [target('celda-nueva', 300, 700)];
    setBoard(nuevo);
    ctx.setBase(nuevo); // onGridRendered durante el diálogo
    assert(applied[applied.length - 1] === 'dialog', 'el tablero recuperó los objetivos: ' + applied.join(','));
    look(500, 400, CONFIG.DWELL_MS + 400);
    assert(selected.length === 0, 'se activó la celda nueva: ' + selected);
    ctx.pop(tok);
    assert(applied[applied.length - 1] === 'base', 'no restauró');
});
t('T12 al cerrar se reconstruye desde el estado actual y hace falta una permanencia nueva', () => {
    const { ctx, selected, look, setBoard } = setup();
    look(200, 400, CONFIG.DWELL_MS - 100);
    const tok = ctx.push('dialog', () => [target('btn-ok', 900, 1000, 0, 100)]);
    const viejo = [target('celda-A', 0, 400)];
    viejo[0].element.isConnected = false;          // el nodo viejo ya no existe
    const fresco = [target('celda-A2', 0, 400)];
    setBoard(fresco);
    ctx.pop(tok);
    look(200, 400, 300);
    assert(selected.length === 0, 'se activó al cerrar: ' + selected);
    look(200, 400, CONFIG.DWELL_MS + 300);
    assert(selected.length === 1 && selected[0] === 'celda-A2', 'no usó el estado actual: ' + selected);
});
t('T12 diálogos anidados: cerrar el de arriba vuelve al anterior; cerrar fuera de orden no rompe', () => {
    const { ctx, applied } = setup();
    const a = ctx.push('dialog', () => [target('ok-1', 0, 10, 0, 10)]);
    const b = ctx.push('webpage', () => [target('volver', 0, 10, 0, 10)]);
    ctx.pop(b);
    assert(ctx.top().name === 'dialog' && applied[applied.length - 1] === 'dialog', applied.join(','));
    const c = ctx.push('webpage', () => []);
    ctx.pop(a);                       // se cierra el de abajo primero (p. ej. timeout)
    assert(ctx.top().name === 'webpage', 'perdió el de arriba');
    ctx.pop(c);
    assert(!ctx.isBlocked() && applied[applied.length - 1] === 'base', 'no volvió al tablero');
    assert(ctx.pop(c) === false, 'pop doble');
});
t('T12 cierre por tiempo (página web) no produce una selección en el tablero que reaparece', () => {
    const { ctx, selected, look } = setup();
    const tok = ctx.push('webpage', () => [target('volver', 0, 100, 0, 100)]);
    look(200, 400, 2000);             // mira donde estará la celda A
    ctx.pop(tok);                     // vence el tiempo
    look(200, 400, 200);
    assert(selected.length === 0, JSON.stringify(selected));
});
t('panel del acompañante: pausa (sin objetivos) y lo de abajo no se activa', () => {
    const { ctx, selected, look } = setup();
    const tok = ctx.push('companion', () => [target('x', 0, 1000)], { companion: true });
    assert(ctx.isPaused(), 'no pausó');
    look(200, 400, CONFIG.DWELL_MS + 500);
    assert(selected.length === 0, JSON.stringify(selected));
    ctx.pop(tok);
    assert(!ctx.isPaused(), 'sigue en pausa');
});
t('objetivos desconectados del diálogo se descartan', () => {
    const { ctx, applied } = setup();
    const gone = target('fantasma', 0, 10, 0, 10); gone.element.isConnected = false;
    let got = null;
    const c2 = new SelectionContexts({ apply: (tg) => { got = tg; } });
    c2.push('dialog', () => [gone, target('ok', 0, 10, 0, 10)]);
    assert(got.length === 1 && got[0].element.id === 'ok', JSON.stringify(got.map(x => x.element.id)));
    void ctx; void applied;
});

console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
