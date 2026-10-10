// Tests de pages.js (tableros con varias páginas y textos de ARASAAC). Correr: node tools/test-pages.mjs
import {
    pageOrder, pageCount, nextPageName, removePage, linksTo, importedName, splitBundle,
    arasaacIdFromUrl, pickArasaacKeyword, missingLabelIds, applyAutoLabels, fetchArasaacWords, enrichAutoLabels,
    visibleLabel, cellText, speechOnNavigate, migrateToActionSpeech
} from '../web/js/pages.js';
let pass = 0, fail = 0;
const pending = [];
const t = (n, f) => {
    const run = async () => { try { await f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
    pending.push(run);
};
const eq = (a, b, m = '') => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${m} esperado ${B}, obtenido ${A}`); };

// Fixture sintético con la forma de un respaldo de Asterics: preguntas encadenadas por la celda del título
const pic = (id, x) => ({ id: 'e' + id, x, y: 2, width: 1, height: 1, label: {}, actions: [{ modelName: 'GridActionSpeak' }],
    image: { url: `https://api.arasaac.org/api/pictograms/${id}?download=false&plural=false&color=tr` } });
const page = (id, title, next) => ({
    id, label: { es: title }, rowCount: 3, minColumnCount: 3,
    gridElements: [
        { id: id + '-t', x: 0, y: 0, width: 3, height: 1, label: { es: title.toUpperCase() },
          actions: next ? [{ modelName: 'GridActionNavigate', navType: 'navigateToGrid', toGridId: next }] : [] },
        pic(6981, 0), pic(2493, 1), pic(2269, 2)
    ]
});
const fixture = () => ({
    id: 'bundle_1', name: 'x', type: 'grd', mainBoard: 'g1',
    boards: { g3: page('g3', '¿Cuál ladra?', 'g4'), g1: page('g1', '¿Cuál tiene ruedas?', 'g2'),
              g4: page('g4', '¿Cuál es amarilla?', null), g2: page('g2', '¿Cuál es redondo? (Copy)', 'g3'),
              g9: page('g9', 'Suelta', null) }
});

console.log('pages');
t('pageOrder: inicio, recorrido y sueltas al final', () => eq(pageOrder(fixture()), ['g1', 'g2', 'g3', 'g4', 'g9']));
t('pageCount', () => eq(pageCount(fixture()), 5));
t('nextPageName no repite', () => { const b = fixture(); b.boards.g9.label.es = 'Página 6'; eq(nextPageName(b), 'Página 7'); });
t('linksTo cuenta vínculos entrantes', () => eq(linksTo(fixture(), 'g3'), 1));
t('removePage saca vínculos y conserva la celda', () => {
    const b = fixture(); const r = removePage(b, 'g3');
    eq([r.ok, r.removedLinks], [true, 1]); eq(b.boards.g3, undefined);
    eq(b.boards.g2.gridElements[0].actions, []); eq(b.boards.g2.gridElements.length, 4);
});
t('removePage de la de inicio pasa a la siguiente', () => { const b = fixture(); removePage(b, 'g1'); eq(b.mainBoard, 'g2'); });
t('removePage no borra la última página', () => {
    const b = { mainBoard: 'a', boards: { a: page('a', 'A', null) } }; eq(removePage(b, 'a').ok, false); eq(pageCount(b), 1);
});
t('importedName: respaldo de Asterics usa la página de inicio', () =>
    eq(importedName('letialberti_2026-10-10_14-08_asterics-aac-custom-backup.grd', fixture()), '¿Cuál tiene ruedas?'));
t('importedName: otros nombres de respaldo', () => eq(importedName('asterics-grid-backup.grd', fixture()), '¿Cuál tiene ruedas?'));
t('importedName: nombre común se respeta', () => eq(importedName('Nuclear.grd', fixture()), 'Nuclear'));
t('importedName: saca "(Copy)"', () => { const b = fixture(); b.mainBoard = 'g2'; eq(importedName('x_asterics-aac-custom-backup.grd', b), '¿Cuál es redondo?'); });
t('splitBundle: un tablero por página, sin vínculos, ids y nombres', () => {
    const b = fixture(); b.tags = ['Escuela'];
    const out = splitBundle(b, i => 'n' + i);
    eq(out.map(x => x.id), ['n0', 'n1', 'n2', 'n3', 'n4']);
    eq(out[1].name, '¿Cuál es redondo?');
    eq(Object.keys(out[0].boards), ['g1']); eq(out[0].mainBoard, 'g1');
    eq(out[0].boards.g1.gridElements[0].actions, []);
    eq(out[0].tags, ['Escuela']);
    eq(b.boards.g1.gridElements[0].actions.length, 1, 'no muta el original');
});
t('arasaacIdFromUrl', () => {
    eq(arasaacIdFromUrl('https://api.arasaac.org/api/pictograms/6981?download=false'), 6981);
    eq(arasaacIdFromUrl('https://static.arasaac.org/pictograms/2493/2493_300.png'), null);
    eq(arasaacIdFromUrl('data:image/png;base64,xx'), null);
});
t('pickArasaacKeyword prefiere la forma rioplatense', () => {
    eq(pickArasaacKeyword([{ keyword: 'coche' }, { keyword: 'automóvil' }, { keyword: 'auto' }]), 'auto');
    eq(pickArasaacKeyword([{ keyword: 'paloma' }, { keyword: 'ave' }]), 'paloma');
    eq(pickArasaacKeyword([]), '');
});
t('missingLabelIds y applyAutoLabels', () => {
    const b = fixture();
    eq([...missingLabelIds(b)].sort(), [2269, 2493, 6981]);
    const n = applyAutoLabels(b, new Map([[6981, 'auto'], [2493, 'paloma']]));
    eq(n, 10); // 2 pictogramas × 5 páginas
    eq(b.boards.g1.gridElements[1].autoLabel, { es: 'auto', source: 'arasaac' });
    eq([...missingLabelIds(b)], [2269]);
});
t('fetchArasaacWords: usa la API y tolera fallas', async () => {
    const calls = [];
    const fake = async (url) => {
        calls.push(url);
        const id = Number(url.split('/').pop());
        if (id === 2) throw new Error('sin red');
        if (id === 3) return { ok: false };
        return { ok: true, json: async () => ({ keywords: [{ keyword: 'coche' }, { keyword: 'auto' }] }) };
    };
    const w = await fetchArasaacWords(new Set([1, 2, 3]), fake);
    eq([...w], [[1, 'auto']]);
    eq(calls.length, 3);
    eq(calls[0], 'https://api.arasaac.org/api/pictograms/es/1');
});
t('enrichAutoLabels completa el tablero', async () => {
    const b = fixture();
    const n = await enrichAutoLabels(b, async () => ({ ok: true, json: async () => ({ keywords: [{ keyword: 'pelota' }] }) }));
    eq(n, 15);
    eq(missingLabelIds(b).size, 0);
});
t('visibleLabel: el automático solo si se pide mostrarlo', () => {
    const el = { label: {}, autoLabel: { es: 'auto' } };
    eq(visibleLabel(el, {}), ''); eq(visibleLabel(el, { showAutoLabels: true }), 'auto');
    eq(visibleLabel({ label: { es: 'Sí' }, autoLabel: { es: 'auto' } }, { showAutoLabels: true }), 'Sí');
});
t('cellText: propio o automático', () => {
    eq(cellText({ label: { es: '' }, autoLabel: { es: 'auto' } }), 'auto');
    eq(cellText({ label: { es: 'Mamá' } }), 'Mamá');
    eq(cellText({}), '');
});
t('speechOnNavigate: importado dice el texto', () => eq(speechOnNavigate(fixture().boards.g1.gridElements[0], undefined), '¿CUÁL TIENE RUEDAS?'));
t('speechOnNavigate: editado respeta las acciones', () => {
    const nav = { modelName: 'GridActionNavigate', toGridId: 'x' };
    eq(speechOnNavigate({ label: { es: 'Comida' }, actions: [nav] }, 'actions'), null);
    eq(speechOnNavigate({ label: { es: 'Comida' }, actions: [nav, { modelName: 'GridActionSpeak' }] }, 'actions'), 'Comida');
    eq(speechOnNavigate({ label: { es: 'Comida' }, actions: [nav, { modelName: 'GridActionSpeakCustom', speakText: { es: 'Tengo hambre' } }] }, 'actions'), 'Tengo hambre');
});

t('migrateToActionSpeech conserva lo que se decía', () => {
    const b = fixture();
    b.boards.g1.gridElements[1].autoLabel = { es: 'auto' };
    const title = b.boards.g1.gridElements[0];
    const n = migrateToActionSpeech(b);
    eq(b.speechModel, 'actions');
    eq(speechOnNavigate(title, b.speechModel), '¿CUÁL TIENE RUEDAS?');
    eq(b.boards.g1.gridElements[1].actions.filter(a => a.modelName === 'GridActionSpeak').length, 1, 'no duplica');
    eq(n, 5, 'los 5 títulos');
    eq(migrateToActionSpeech(b), 0, 'idempotente');
});

for (const run of pending) await run();
console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
