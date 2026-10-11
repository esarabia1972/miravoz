// Tests de blink.js (parpadeo para seleccionar, 1.4.0). Correr: node tools/test-blink.mjs
import { BlinkDetector, eyeClosure, calibrateThreshold, BLINK_LIMITS } from '../web/js/blink.js';
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
// Secuencia a 30 cps: [[ms, valor], ...] → cantidad de disparos
function run(det, segments, t0 = 0) {
    let t = t0; const fires = [];
    for (const [ms, v] of segments) for (let k = 0; k < ms; k += 33) { const r = det.push(v, t); if (r.fire) fires.push({ t, at: r.closedAt }); t += 33; }
    return fires;
}
console.log('parpadeo');
t('cierre: promedio de los dos ojos; tolera un ojo o nada', () => {
    assert(eyeClosure({ eyeBlinkLeft: 0.2, eyeBlinkRight: 0.6 }) === 0.4, 'promedio');
    assert(eyeClosure({ eyeBlinkRight: 0.7 }) === 0.7 && eyeClosure(null) === null && eyeClosure({}) === null, 'parciales');
});
t('apagado: nunca dispara', () => {
    assert(run(new BlinkDetector({ mode: 'off' }), [[500, 0.1], [1500, 0.9], [500, 0.1]]).length === 0, '');
});
t('largo: los parpadeos reflejos (≤ 300 ms) no disparan; uno de 1 s dispara UNA vez', () => {
    const d = new BlinkDetector({ mode: 'long', holdMs: 600 });
    const reflex = [];
    for (let i = 0; i < 20; i++) reflex.push([700, 0.08], [200, 0.85]);
    assert(run(d, reflex).length === 0, 'reflejos');
    const f = run(d, [[500, 0.08], [1000, 0.9], [500, 0.08]]);
    assert(f.length === 1, 'un disparo: ' + f.length);
});
t('largo: el disparo informa cuándo empezó el cierre (para tomar el objetivo de antes de cerrar)', () => {
    const d = new BlinkDetector({ mode: 'long', holdMs: 600 });
    const f = run(d, [[330, 0.05], [900, 0.9]]);
    assert(f.length === 1 && Math.abs(f[0].at - 330) <= 33 && f[0].t >= f[0].at + 600, JSON.stringify(f));
});
t('largo: mirar hacia abajo (señal 0,35) no cierra con umbral 0,5; con histéresis no rebota', () => {
    const d = new BlinkDetector({ mode: 'long', holdMs: 600, threshold: 0.5 });
    assert(run(d, [[3000, 0.35]]).length === 0, 'mirar abajo');
    // ruido alrededor del umbral durante un cierre largo: un solo disparo
    const seg = []; for (let i = 0; i < 30; i++) seg.push([33, i % 2 ? 0.52 : 0.4]);
    assert(run(new BlinkDetector({ mode: 'long', holdMs: 600 }), [[300, 0.05], ...seg, [500, 0.05]]).length === 1, 'histéresis');
});
t('doble: dos cortos seguidos disparan; uno solo o separados no', () => {
    const d = new BlinkDetector({ mode: 'double' });
    assert(run(d, [[600, 0.05], [200, 0.9], [300, 0.05], [200, 0.9], [600, 0.05]]).length === 1, 'doble');
    assert(run(new BlinkDetector({ mode: 'double' }), [[600, 0.05], [200, 0.9], [1500, 0.05], [200, 0.9], [600, 0.05]]).length === 0, 'separados');
    assert(run(new BlinkDetector({ mode: 'double' }), [[600, 0.05], [1000, 0.9], [200, 0.05], [200, 0.9], [600, 0.05]]).length === 0, 'uno largo no cuenta como corto');
});
t('refractario: no se encadenan dos selecciones', () => {
    const d = new BlinkDetector({ mode: 'long', holdMs: 400 });
    const f = run(d, [[300, 0.05], [500, 0.9], [100, 0.05], [500, 0.9], [300, 0.05]]);
    assert(f.length === 1, 'refractario: ' + f.length);
});
t('sin cara o hueco largo: se pierde el gesto en curso', () => {
    const d = new BlinkDetector({ mode: 'long', holdMs: 600 });
    let tt = 0; const push = (v) => { const r = d.push(v, tt); tt += 33; return r.fire; };
    for (let i = 0; i < 5; i++) push(0.05);
    for (let i = 0; i < 10; i++) push(0.9); // 330 ms cerrado
    d.push(null, tt); tt += 33;              // se perdió la cara
    let fired = false; for (let i = 0; i < 12; i++) fired = push(0.9) || fired; // ≈400 ms más: no alcanza desde cero
    assert(!fired, 'no debe sumar el cierre de antes de perder la cara');
});
t('ajuste por persona: umbral entre abiertos y cerrados; si no se distinguen, avisa', () => {
    const open = Array.from({ length: 60 }, (_, i) => 0.05 + (i % 10) * 0.025); // hasta 0,275
    const closed = Array.from({ length: 30 }, () => 0.85);
    const r = calibrateThreshold(open, closed);
    assert(r.ok && r.threshold > 0.4 && r.threshold < 0.7, JSON.stringify(r));
    assert(!calibrateThreshold(open, Array(30).fill(0.35)).ok, 'poca diferencia');
    assert(!calibrateThreshold([0.1], [0.9]).ok, 'pocas muestras');
});
console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
