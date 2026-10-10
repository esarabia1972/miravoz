// Tests del modelo híbrido del modo Iris (web/js/gaze-model.js) con un simulador geométrico.
// No reemplaza la prueba con webcam: verifica que la LÓGICA separa cabeza de ojos.
// Correr: node tools/test-gaze.mjs
import { rawFeatures, train, predict, addImplicit, expand, acceptRetrain, isConfidentSelection } from '../web/js/gaze-model.js';
import { trainModel, phi, dot } from '../web/js/regression.js';

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

// --- Simulador: pantalla 1280×800 px a 55 cm; 1 cm ≈ 38 px ---
const W = 1280, H = 800, D = 55, PX = 38;
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

/** Genera las features que vería la cámara para alguien mirando el punto (tx, ty) con una pose dada. */
function observe(tx, ty, head, noise = 1, irisBias = 0) {
    // Posición de la cabeza (cm, respecto del centro de la pantalla) y giro (grados)
    const { hx, hy, yaw, pitch } = head;
    // Ángulo total de mirada necesario para ver el objetivo desde esa posición
    const gx = Math.atan2((tx - W / 2) / PX - hx, D) * 180 / Math.PI;
    const gy = Math.atan2((ty - H / 2) / PX - hy, D) * 180 / Math.PI;
    // Lo que no aporta la cabeza lo ponen los ojos (ojo ±35° ≈ iris ±1)
    const eyeX = gx - yaw, eyeY = gy - pitch;
    const iris = { x: eyeX / 35 + irisBias + 0.03 * gauss() * noise, y: eyeY / 25 + 0.06 * gauss() * noise }; // vertical más ruidoso (párpado)
    const pose = { yaw: yaw + 0.8 * gauss() * noise, pitch: pitch + 0.8 * gauss() * noise, roll: 0 };
    const lm = [];
    lm[1] = { x: 0.5 + hx / 40 + yaw / 300 + 0.002 * gauss() * noise, y: 0.5 + hy / 40 + pitch / 300 + 0.002 * gauss() * noise };
    const eyes = {
        eyeLookOutLeft: Math.max(0, eyeX / 35), eyeLookInRight: Math.max(0, eyeX / 35),
        eyeLookInLeft: Math.max(0, -eyeX / 35), eyeLookOutRight: Math.max(0, -eyeX / 35),
        eyeLookDownLeft: Math.max(0, eyeY / 25), eyeLookDownRight: Math.max(0, eyeY / 25),
        eyeLookUpLeft: Math.max(0, -eyeY / 25), eyeLookUpRight: Math.max(0, -eyeY / 25)
    };
    for (const k in eyes) eyes[k] = Math.min(1, Math.max(0, eyes[k] + 0.04 * gauss() * noise));
    return rawFeatures({ landmarks: lm, iris, pose, eyes });
}

const pts9 = [];
for (const fy of [0.15, 0.5, 0.85]) for (const fx of [0.15, 0.5, 0.85]) pts9.push([fx * W, fy * H]);
const pts5 = [[0.5 * W, 0.5 * H], [0.5 * W, 0.15 * H], [0.15 * W, 0.5 * H], [0.85 * W, 0.5 * H], [0.5 * W, 0.85 * H]];
const stillHead = () => ({ hx: gauss() * 0.5, hy: gauss() * 0.5, yaw: gauss() * 1.5, pitch: gauss() * 1.5 });
const movingHead = () => ({ hx: gauss() * 3, hy: gauss() * 2, yaw: gauss() * 10, pitch: gauss() * 7 });

// Calibración como la de la app: 9 puntos quietos + 5 puntos moviendo la cabeza
function calibration() {
    const pts = [];
    for (const p of pts9) pts.push({ target: p, samples: Array.from({ length: 30 }, () => ({ raw: observe(p[0], p[1], stillHead()) })) });
    for (const p of pts5) pts.push({ target: p, samples: Array.from({ length: 50 }, () => ({ raw: observe(p[0], p[1], movingHead()) })) });
    return pts;
}

// Prueba: 300 miradas a puntos al azar con movimiento de cabeza "de chico" (moderado)
// Como el benchmark: se mira el CENTRO de una celda (con algo de imprecisión) durante el dwell;
// el cursor filtrado ≈ promedio de ~10 cuadros con la cabeza en una pose dada.
function testSet(n = 300) {
    return Array.from({ length: n }, () => {
        const c = Math.floor(rnd() * 9);
        const tx = ((c % 3) + 0.5) * W / 3 + gauss() * 25, ty = (Math.floor(c / 3) + 0.5) * H / 3 + gauss() * 25;
        const head = movingHead();
        return { tx, ty, cell: c, frames: Array.from({ length: 10 }, () => observe(tx, ty, head)) };
    });
}
const avgPred = (fn, frames) => { const ps = frames.map(fn); return [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length]; };
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
// Acierto en grilla 3x3 (celda que contiene el punto predicho)
const cell3 = (x, y) => Math.min(2, Math.max(0, Math.floor(x / (W / 3)))) + 3 * Math.min(2, Math.max(0, Math.floor(y / (H / 3))));

console.log('gaze-model (simulador)');
const cal = calibration();
const test = testSet();
const { model, meanError } = train(cal, 1);

t('rawFeatures devuelve 8 valores y null si falta la pose', () => {
    assert(observe(640, 400, stillHead()).length === 8, 'largo');
    assert(rawFeatures({ landmarks: [{}, { x: 0.5, y: 0.5 }], iris: { x: 0, y: 0 }, pose: null }) === null, 'sin pose debería ser null');
});

t('expand agrega 5 términos (8 → 13)', () => assert(expand(new Array(8).fill(1)).length === 13, 'largo'));

const hyb = s => avgPred(r => predict(model, r), s.frames);
const hybErr = test.map(s => { const [x, y] = hyb(s); return Math.hypot(x - s.tx, y - s.ty); });
const hybAcc = test.filter(s => { const [x, y] = hyb(s); return cell3(x, y) === s.cell; }).length / test.length;

// Modelo anterior: solo iris con polinomio de 2º grado (como el modo Iris retirado)
const old = trainModel(cal.map(p => ({ target: p.target, samples: p.samples.map(s => ({ fx: s.raw[0], fy: s.raw[1] })) })), 0.01);
const oldP = s => avgPred(r => { const f = phi(r[0], r[1]); return [dot(old.weightsX, f), dot(old.weightsY, f)]; }, s.frames);
const oldErr = test.map(s => { const [x, y] = oldP(s); return Math.hypot(x - s.tx, y - s.ty); });
const oldAcc = test.filter(s => { const [x, y] = oldP(s); return cell3(x, y) === s.cell; }).length / test.length;

console.log(`    (simulador) error mediano: híbrido ${median(hybErr).toFixed(0)} px vs solo-iris ${median(oldErr).toFixed(0)} px · acierto 3×3: híbrido ${(hybAcc * 100).toFixed(0)}% vs solo-iris ${(oldAcc * 100).toFixed(0)}% · error de calibración ${meanError.toFixed(0)} px`);

t('con movimiento de cabeza, el híbrido es mucho mejor que solo-iris (≥2× menos error)', () => {
    assert(median(hybErr) * 2 <= median(oldErr), `híbrido ${median(hybErr).toFixed(0)} vs solo-iris ${median(oldErr).toFixed(0)}`);
});

t('en el simulador, el híbrido acierta ≥90% en 3×3', () => assert(hybAcc >= 0.9, `${(hybAcc * 100).toFixed(1)}%`));

t('aprendizaje implícito: buffer FIFO acotado', () => {
    let b = [];
    for (let i = 0; i < 40; i++) b = addImplicit(b, Array.from({ length: 10 }, (_, k) => ({ i, k })), 300);
    assert(b.length === 300 && b[0].i === 10, `largo ${b.length}, primero ${b[0].i}`);
});

t('las muestras implícitas corrigen un sesgo que la calibración no vio (p. ej. cambió la luz o los anteojos)', () => {
    // Nueva sesión: el detector ubica el iris corrido (+0.15) respecto de la calibración
    const BIAS = 0.15;
    const test2 = Array.from({ length: 200 }, () => { const tx = (0.1 + 0.8 * rnd()) * W, ty = (0.1 + 0.8 * rnd()) * H; return { tx, ty, raw: observe(tx, ty, movingHead(), 1, BIAS) }; });
    const errOf = m => median(test2.map(s => { const [x, y] = predict(m, s.raw); return Math.hypot(x - s.tx, y - s.ty); }));
    const before = errOf(model);
    const implicit = [];
    for (let i = 0; i < 40; i++) { const tx = (0.15 + 0.7 * rnd()) * W, ty = (0.15 + 0.7 * rnd()) * H; const h = movingHead(); for (let k = 0; k < 6; k++) implicit.push({ target: [tx, ty], raw: observe(tx, ty, h, 1, BIAS) }); }
    const after = errOf(train(cal, 1, implicit).model);
    console.log(`    (simulador) con el sesgo nuevo: ${before.toFixed(0)} px → tras 40 selecciones confirmadas ${after.toFixed(0)} px · ¿la salvaguarda lo acepta? ${acceptRetrain(model, train(cal, 1, implicit).model, cal) ? 'sí' : 'no (conservador: pide recalibrar)'}`);
    assert(after <= before * 0.8, `no mejoró lo suficiente: ${before.toFixed(0)} → ${after.toFixed(0)}`);
});

t('salvaguarda: si lo implícito aprendió de errores (etiquetas de la celda vecina), el modelo nuevo se rechaza', () => {
    const wrong = [];
    for (let i = 0; i < 60; i++) { const tx = (0.15 + 0.7 * rnd()) * W, ty = (0.15 + 0.7 * rnd()) * H; const h = movingHead();
        for (let k = 0; k < 6; k++) wrong.push({ target: [tx + W / 3, ty], raw: observe(tx, ty, h) }); } // etiqueta corrida una celda
    const bad = train(cal, 1, wrong).model;
    assert(!acceptRetrain(model, bad, cal), 'debería rechazar el modelo sesgado');
    assert(acceptRetrain(model, model, cal), 'el mismo modelo se acepta');
});

t('lo implícito nunca supera el 30% de las filas (no desplaza a la calibración)', () => {
    const many = [];
    for (let i = 0; i < 5000; i++) many.push({ target: [W / 2 + W / 3, H / 2], raw: observe(W / 2, H / 2, movingHead()) });
    const m = train(cal, 1, many).model;
    const [x] = predict(m, observe(W / 2, H / 2, stillHead(), 0));
    assert(Math.abs(x - W / 2) < W / 3, `el centro se corrió a ${x.toFixed(0)} px (demasiado peso implícito)`);
});

t('parpadeo (ojo casi cerrado) → sin features', () => {
    const lm = []; lm[1] = { x: 0.5, y: 0.5 };
    assert(rawFeatures({ landmarks: lm, iris: { x: 0, y: 3, open: 0.05 }, pose: { yaw: 0, pitch: 0 }, eyes: {} }) === null, 'debería descartar');
    assert(rawFeatures({ landmarks: lm, iris: { x: 0, y: 0, open: 0.3 }, pose: { yaw: 0, pitch: 0 }, eyes: null }) !== null, 'ojo abierto (y eyes null) debería servir');
});

t('selección confiable solo si el cursor estuvo en el centro del objetivo', () => {
    const rect = { left: W / 3, right: 2 * W / 3, top: H / 3, bottom: 2 * H / 3, width: W / 3, height: H / 3 };
    const center = Array.from({ length: 8 }, () => observe(W / 2, H / 2, stillHead()));
    const edge = Array.from({ length: 8 }, () => observe(W / 3 + 10, H / 2, stillHead()));
    assert(isConfidentSelection(model, center, rect), 'centro debería ser confiable');
    assert(!isConfidentSelection(model, edge, rect), 'borde no debería ser confiable');
});

t('entrenar con muy pocas muestras lanza error claro', () => {
    let msg = '';
    try { train([{ target: [0, 0], samples: [{ raw: observe(10, 10, stillHead()) }] }], 1); } catch (e) { msg = e.message; }
    assert(/insuficientes/.test(msg), msg);
});

console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
