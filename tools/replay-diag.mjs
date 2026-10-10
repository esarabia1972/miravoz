// Reproduce un diagnóstico real (?diag=1 → "⬇ Diagnóstico") contra el modelo del modo Iris.
// Uso: node tools/replay-diag.mjs <archivo.json>
// El JSON NO se versiona (son datos de una persona): queda en la carpeta del proyecto de Esteban.
import fs from 'fs';
const gaze = await import(new URL('../web/js/gaze-model.js', import.meta.url));
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const [W, H] = d.viewport;
const g = new Map(); let last = null;
for (const r of d.rows) { const t = r.target; if (!t || !['calib','calib-head'].includes(t.kind) || !t.sampling || !r.f || JSON.stringify(r.f) === last) continue;
  last = JSON.stringify(r.f); const k = `${Math.round(t.x)},${Math.round(t.y)}`; if (!g.has(k)) g.set(k, { target: [t.x, t.y], samples: [] }); g.get(k).samples.push({ raw: r.f }); }
const pts = [...g.values()];
const cell = (x, y) => `${Math.min(2, Math.max(0, Math.floor(x / (W / 3))))},${Math.min(2, Math.max(0, Math.floor(y / (H / 3))))}`;
let hit = 0, tot = 0; const errs = [];
for (const p of pts) {
  const { model } = gaze.train(pts.filter(q => q !== p), 0.005);
  const P = p.samples.map(s => gaze.predict(model, s.raw));
  P.forEach(q => errs.push(Math.hypot(q[0] - p.target[0], q[1] - p.target[1])));
  for (let k = 0; k + 10 <= P.length; k += 10) { const mx = P.slice(k, k + 10).reduce((a, q) => a + q[0], 0) / 10, my = P.slice(k, k + 10).reduce((a, q) => a + q[1], 0) / 10; tot++; if (cell(mx, my) === cell(...p.target)) hit++; }
}
errs.sort((a, b) => a - b);
const full = gaze.train(pts, 0.005).model;
console.log(`v3 real (dejando un punto afuera): error mediano ${errs[errs.length >> 1].toFixed(0)} px · acierto celda 3×3 ${(hit / tot * 100).toFixed(0)}% · poseRef`, Object.fromEntries(Object.entries(full.poseRef).map(([k, v]) => [k, +v.toFixed(3)])));
// vigilancia de pose sobre el benchmark
let out = 0, n = 0; last = null;
for (const r of d.rows) { if (!r.target || r.target.kind !== 'bench' || !r.f || JSON.stringify(r.f) === last) continue; last = JSON.stringify(r.f); n++; if (gaze.headDeviation(full, r.f).deg > 4) out++; }
console.log(`benchmark (moviendo la cabeza): ${(out / n * 100).toFixed(0)}% de los cuadros con la cabeza a más de 4° de la pose de calibración → cursor congelado + aviso`);
