// Tests de practice-logic.js (Practicar, 1.3.0). Correr: node tools/test-practice.mjs
import { LEVELS, CoverageGrid, noteForY, nextBalloonSize, balloonPosition, BALLOON, optionCount, pickOptions,
    followPosition, nextLoopSeconds, FOLLOW, appendLog, LOG_MAX, summarize } from '../web/js/practice-logic.js';
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

console.log('practicar');
t('cinco niveles en orden de dificultad; en barrido solo los que tienen botones', () => {
    assert(LEVELS.map(l => l.id).join() === '1,2,3,4,5', 'orden');
    assert(LEVELS.filter(l => !l.pointerOnly).map(l => l.id).join() === '3,4', 'sin puntero: 3 y 4');
});
t('cobertura: un pincel marca celdas una sola vez y llega a los bordes', () => {
    const g = new CoverageGrid(8, 6);
    assert(g.mark(10, 10, 40, 800, 600) >= 1, 'esquina');
    const c = g.count; g.mark(10, 10, 40, 800, 600);
    assert(g.count === c, 'no cuenta dos veces');
    for (let y = 0; y <= 600; y += 50) for (let x = 0; x <= 800; x += 50) g.mark(x, y, 40, 800, 600);
    assert(g.fraction() === 1, 'recorrido completo = 100%: ' + g.fraction());
    g.reset(); assert(g.count === 0 && g.fraction() === 0, 'reset');
});
t('notas: arriba más agudo, siempre dentro de la escala', () => {
    assert(noteForY(10, 600) > noteForY(590, 600), 'arriba más agudo');
    assert(noteForY(-50, 600) > 0 && noteForY(9999, 600) > 0, 'fuera de rango no rompe');
});
t('globos: se achican al acertar hasta el mínimo y crecen si cuesta hasta el máximo (sin error)', () => {
    const minDim = 700; let s = BALLOON.startFrac * minDim;
    for (let i = 0; i < 40; i++) s = nextBalloonSize(s, { popped: true, minDim });
    assert(Math.abs(s - BALLOON.minFrac * minDim) < 1e-6, 'mínimo ' + s);
    for (let i = 0; i < 40; i++) s = nextBalloonSize(s, { popped: false, minDim });
    assert(Math.abs(s - BALLOON.startFrac * minDim) < 1e-6, 'máximo ' + s);
});
t('globos: la posición queda dentro de la pantalla y lejos del anterior', () => {
    for (let i = 0; i < 200; i++) {
        const p = balloonPosition(150, 1000, 600, rnd);
        assert(p.x >= 0 && p.y >= 0 && p.x + 150 <= 1000 && p.y + 150 <= 600, JSON.stringify(p));
    }
    const prev = { x: 0, y: 0 }; let far = 0;
    for (let i = 0; i < 50; i++) { const p = balloonPosition(100, 1000, 600, rnd, prev); if (Math.hypot(p.x, p.y) > 250) far++; }
    assert(far > 40, 'casi siempre lejos del anterior: ' + far);
});
t('elegir: 2 → 3 → 4 opciones, sin repetir', () => {
    assert([0, 4, 5, 9, 10, 30].map(optionCount).join() === '2,2,3,3,4,4', 'progresión');
    const o = pickOptions(4, rnd); assert(new Set(o.map(x => x.key)).size === 4, 'sin repetidas');
});
t('seguir: el recorrido queda dentro de la pantalla y acelera con tope', () => {
    for (let s = 0; s < 60; s += 0.25) { const p = followPosition(s, 1000, 600); assert(p.x > 100 && p.x < 900 && p.y > 80 && p.y < 520, JSON.stringify(p)); }
    let l = FOLLOW.loopSeconds; for (let i = 0; i < 20; i++) l = nextLoopSeconds(l);
    assert(l === FOLLOW.minLoopSeconds, 'tope de velocidad');
});
t('registro: se acota y resume sin textos personales', () => {
    let log = []; for (let i = 0; i < LOG_MAX + 30; i++) log = appendLog(log, { level: 3, done: i, durationMs: 60000 });
    assert(log.length === LOG_MAX && log[log.length - 1].done === LOG_MAX + 29, 'acotado');
    assert(summarize({ level: 3, done: 7 }) === '7 globo(s)', summarize({ level: 3, done: 7 }));
    assert(/40%/.test(summarize({ level: 5, onTargetFrac: 0.4 })), 'seguir');
    assert(appendLog(null, { level: 1 }).length === 1, 'lista rota → nueva');
});
console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
