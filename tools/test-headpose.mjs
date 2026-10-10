// Tests de headpose.js (matemática del motor FaceLandmarker). Correr: node tools/test-headpose.mjs
import { poseFromMatrix, pickEyeBlendshapes, irisInEye } from '../web/js/headpose.js';
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const near = (a, b, tol, m = '') => { if (Math.abs(a - b) > tol) throw new Error(`${m} esperado ${b}, obtenido ${a}`); };
// Matriz column-major de rotación (yaw alrededor de Y, pitch alrededor de X) + traslación
function matrix(yawDeg, pitchDeg, t = [0, 0, -50]) {
    const y = yawDeg * Math.PI / 180, p = pitchDeg * Math.PI / 180;
    const Ry = [[Math.cos(y), 0, Math.sin(y)], [0, 1, 0], [-Math.sin(y), 0, Math.cos(y)]];
    const Rx = [[1, 0, 0], [0, Math.cos(p), -Math.sin(p)], [0, Math.sin(p), Math.cos(p)]];
    const R = Ry.map((row, i) => [0, 1, 2].map(j => row.reduce((s, _, k) => s + Ry[i][k] * Rx[k][j], 0)));
    const d = new Array(16).fill(0);
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) d[c * 4 + r] = R[r][c];
    d[12] = t[0]; d[13] = t[1]; d[14] = t[2]; d[15] = 1;
    return d;
}
console.log('headpose');
t('identidad → 0°', () => { const p = poseFromMatrix(matrix(0, 0)); near(p.yaw, 0, 1e-9); near(p.pitch, 0, 1e-9); near(p.roll, 0, 1e-9); near(p.tz, -50, 1e-9); });
t('yaw 20°', () => near(poseFromMatrix(matrix(20, 0)).yaw, 20, 1e-6));
t('pitch -15°', () => near(poseFromMatrix(matrix(0, -15)).pitch, -15, 1e-6));
t('yaw 25° + pitch 10° se separan', () => { const p = poseFromMatrix(matrix(25, 10)); near(p.yaw, 25, 1e-6); near(p.pitch, 10, 1e-6); });
t('roll 15° con yaw 10° y traslación', () => {
    const r = 15 * Math.PI / 180, d = matrix(10, 0, [3, -2, -60]);
    // aplicar Rz a izquierda: R' = Rz · R (column-major)
    const R = [[d[0], d[4], d[8]], [d[1], d[5], d[9]], [d[2], d[6], d[10]]];
    const Rz = [[Math.cos(r), -Math.sin(r), 0], [Math.sin(r), Math.cos(r), 0], [0, 0, 1]];
    const M = Rz.map((row, i) => [0, 1, 2].map(j => row.reduce((s, _, k) => s + Rz[i][k] * R[k][j], 0)));
    for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++) d[c * 4 + rr] = M[rr][c];
    const p = poseFromMatrix(d);
    near(p.roll, 15, 1e-6); near(p.yaw, 10, 1e-6); near(p.pitch, 0, 1e-6); near(p.tx, 3, 1e-9); near(p.tz, -60, 1e-9);
});
t('matriz inválida → null', () => { if (poseFromMatrix(null) !== null || poseFromMatrix([1, 2]) !== null) throw new Error('no null'); });
t('blendshapes: solo mirada/parpadeo', () => {
    const o = pickEyeBlendshapes([{ categoryName: 'eyeLookUpLeft', score: 0.3 }, { categoryName: 'jawOpen', score: 0.9 }, { categoryName: 'eyeBlinkRight', score: 0.1 }]);
    if (JSON.stringify(Object.keys(o).sort()) !== '["eyeBlinkRight","eyeLookUpLeft"]') throw new Error(JSON.stringify(o));
});
// Malla sintética: ojos horizontales, iris en el centro o corrido
function mesh(dx = 0, dy = 0) {
    const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    const set = (i, x, y) => { lm[i] = { x, y, z: 0 }; };
    set(33, 0.30, 0.40); set(133, 0.40, 0.40); set(159, 0.35, 0.38); set(145, 0.35, 0.42); set(468, 0.35 + dx * 0.05, 0.40 + dy * 0.02);
    set(263, 0.70, 0.40); set(362, 0.60, 0.40); set(386, 0.65, 0.38); set(374, 0.65, 0.42); set(473, 0.65 + dx * 0.05, 0.40 + dy * 0.02);
    return lm;
}
t('iris centrado → (0, 0)', () => { const r = irisInEye(mesh()); near(r.x, 0, 1e-9); near(r.y, 0, 1e-9); });
t('iris corrido a la derecha de la imagen → x ≈ +1 en ambos ojos', () => near(irisInEye(mesh(1, 0)).x, 1, 1e-9));
t('iris hacia abajo → y ≈ +1', () => near(irisInEye(mesh(0, 1)).y, 1, 1e-9));
t('apertura del ojo = alto/ancho', () => near(irisInEye(mesh()).open, 0.4, 1e-9));
console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
