// test-copy-sync.mjs — comparación original ↔ copia (0.8.1d)
import { contentKey, compareCopy } from '../web/js/copy-compare.js';
let ok = 0, bad = 0;
const t = (name, cond) => { if (cond) ok++; else { bad++; console.error('✗', name); } };
const orig = { id: 'b1', name: 'Tomi', ownerId: 'p', updatedAt: 1000, mainBoard: 'g', boards: { g: { rowCount: 2, gridElements: [{ id: 'a', x: 0, y: 0, label: { es: 'hola' } }] } } };
const copy = JSON.parse(JSON.stringify(orig)); delete copy.ownerId; copy.assignmentId = 'x'; copy.name = 'Otro';
t('igual sin metadatos', compareCopy(orig, copy, null) === 'igual');
const reordered = { boards: { g: { gridElements: [{ label: { es: 'hola' }, y: 0, x: 0, id: 'a' }], rowCount: 2 } }, mainBoard: 'g' };
t('orden de claves no importa', contentKey(orig) === contentKey(reordered));
const changed = JSON.parse(JSON.stringify(copy)); changed.boards.g.gridElements[0].label.es = 'chau';
t('copia más nueva', compareCopy(orig, changed, new Date(5000).toISOString()) === 'copia');
t('original más nuevo', compareCopy({ ...orig, updatedAt: 9000 }, changed, new Date(5000).toISOString()) === 'original');
t('sin original', compareCopy(null, copy, null) === 'sin-original');
console.log(`${bad ? '✗' : '✓'} test-copy-sync: ${ok} ok, ${bad} fallidos`);
process.exit(bad ? 1 : 0);
