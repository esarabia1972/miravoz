// Tests de align.js (alineación "tipo Starlink", 1.5.0). Correr: node tools/test-align.mjs
import { buildReference, alignmentState, recenterOffset, DriftWatch, ALIGN } from '../web/js/align.js';
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const pose = (tx, ty, tz) => ({ tx, ty, tz, yaw: 0, pitch: 0 });
const REF = { tx: -8.5, ty: 6, tz: -32, cfx: -1.1, cfy: 0.3 };
console.log('alineación');
t('referencia: medianas de la calibración; sin datos suficientes, null', () => {
    const poses = Array.from({ length: 60 }, (_, i) => pose(-8.5 + (i % 3 - 1) * 0.2, 6, -32));
    const cf = Array.from({ length: 20 }, () => [-1.1, 0.3]);
    const r = buildReference(poses, cf);
    assert(r && r.tx === -8.5 && r.tz === -32 && r.cfx === -1.1, JSON.stringify(r));
    assert(buildReference(poses.slice(0, 5), cf) === null && buildReference(poses, []) === null, 'faltan datos');
});
t('en la misma posición: alineado', () => {
    const s = alignmentState(pose(-8.5, 6, -32), REF);
    assert(s.ok && /quedate/.test(s.instruction), JSON.stringify(s));
});
t('distancia: más lejos pide acercarse, más cerca pide alejarse (primero la distancia)', () => {
    assert(/Acercate/.test(alignmentState(pose(-8.5, 6, -40), REF).instruction), 'lejos');
    assert(/Alejate/.test(alignmentState(pose(-5, 6, -25), REF).instruction), 'cerca');
});
t('corrimientos: espejo para la persona (+x de la cámara = su izquierda) y +y arriba', () => {
    const left = alignmentState(pose(-8.5 + 4, 6, -32), REF); // la cámara la ve a la derecha de la imagen = izquierda de la persona
    assert(left.dx < 0 && /derecha/.test(left.instruction), JSON.stringify(left));
    const up = alignmentState(pose(-8.5, 6 + 4, -32), REF);
    assert(up.dy > 0 && /Bajá/.test(up.instruction), JSON.stringify(up));
    assert(alignmentState(pose(-8.5 + ALIGN.posTolCm * 0.8, 6, -32), REF).ok, 'dentro de la tolerancia');
});
t('recentrar: offset = mediana mirando el centro − referencia; si es enorme, null (recalibrar)', () => {
    const o = recenterOffset(Array.from({ length: 30 }, (_, i) => [-1.1 + 0.25 + (i % 2 ? 0.02 : -0.02), 0.3 - 0.1]), REF);
    assert(o && Math.abs(o[0] - 0.25) < 0.03 && Math.abs(o[1] + 0.1) < 1e-6, JSON.stringify(o));
    assert(recenterOffset(Array.from({ length: 30 }, () => [1.5, 0.3]), REF) === null, 'demasiado grande');
    assert(recenterOffset([[0, 0]], REF) === null, 'pocas muestras');
});
t('aviso en uso: solo si se corre mucho y por un rato', () => {
    const w = new DriftWatch();
    assert(!w.push(pose(-8.5 + 2, 6, -32), REF, 0) && !w.push(pose(-8.5 + 2, 6, -32), REF, 5000), 'poco corrimiento');
    assert(!w.push(pose(-8.5 + 6, 6, -32), REF, 6000), 'recién empieza');
    assert(w.push(pose(-8.5 + 6, 6, -32), REF, 9100), 'sostenido');
    assert(!w.push(pose(-8.5, 6, -32), REF, 9200), 'vuelve');
});
console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
