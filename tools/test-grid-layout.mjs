// Tests de grid-layout.js (celdas de varias filas/columnas, 0.8.1). Correr: node tools/test-grid-layout.mjs
import { overlaps, covered, insideGrid, maxSpan, firstFree, elementAt } from '../web/js/grid-layout.js';
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const carne = { x: 1, y: 0, width: 3, height: 1 }, papas = { x: 0, y: 2, width: 2, height: 1 }, ensalada = { x: 3, y: 2, width: 2, height: 1 };
const grid = { rowCount: 3, minColumnCount: 5, gridElements: [carne, papas, ensalada] };
console.log('grid-layout');
t('superposición de rectángulos con tamaño', () => {
    assert(overlaps({ x: 2, y: 0 }, carne) && !overlaps({ x: 0, y: 0 }, carne) && !overlaps({ x: 4, y: 0 }, carne), 'carne');
    assert(overlaps({ x: 1, y: 2, width: 3, height: 1 }, papas) && overlaps({ x: 1, y: 2, width: 3, height: 1 }, ensalada), 'tapa dos');
});
t('covered excluye la propia celda', () => {
    assert(covered(grid, { x: 1, y: 0, width: 4, height: 1 }, carne).length === 0, 'agrandar a la derecha libre');
    assert(covered(grid, { x: 1, y: 0, width: 3, height: 3 }, carne).length === 2, 'agrandar hacia abajo tapa papas y ensalada');
});
t('insideGrid y maxSpan respetan el borde', () => {
    assert(insideGrid(grid, carne) && !insideGrid(grid, { x: 3, y: 0, width: 3, height: 1 }), 'borde derecho');
    const m = maxSpan(grid, 3, 1); assert(m.w === 2 && m.h === 2, JSON.stringify(m));
});
t('firstFree encuentra lugar para 1×1 y para 2×1', () => {
    const a = firstFree(grid, 1, 1); assert(a.x === 0 && a.y === 0, JSON.stringify(a));
    const b = firstFree(grid, 2, 1); assert(b.x === 0 && b.y === 1, JSON.stringify(b));
    assert(firstFree(grid, 5, 3) === null, 'no entra 5×3');
});
t('elementAt devuelve la celda grande desde cualquiera de sus posiciones', () => {
    assert(elementAt(grid, 3, 0) === carne && elementAt(grid, 4, 2) === ensalada && elementAt(grid, 2, 1) === null, 'elementAt');
});
console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
