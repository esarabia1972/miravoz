// Tests 0.7.5: respaldo propio, frases favoritas (puras), barrido quieto durante el parpadeo y voz pendiente.
const store = new Map();
globalThis.localforage = { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, JSON.parse(JSON.stringify(v))); return v; }, keys: async () => [...store.keys()] };

const B = await import('../web/js/backup.js');
const F = await import('../web/js/favorites.js');
const { setPersonScopeProvider } = await import('../web/js/person-scope.js');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.stack.split('\n').slice(0, 2).join(' ')); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

const BOARD = { id: 'b1', name: 'Merienda', ownerId: 'u1', syncedAt: 5, assignmentId: 'x', mainBoard: 'g', tags: ['Casa'],
    boards: { g: { id: 'g', gridElements: [{ id: 'c1', x: 0, y: 0, label: { es: 'Agua' }, image: { data: 'data:image/png;base64,AA' }, actions: [{ modelName: 'GridActionSpeak' }] }] } } };

console.log('respaldo');
await t('el respaldo lleva tableros sin datos de cuenta ni tokens, y descarta los inválidos', () => {
    const r = B.buildBackup({ boards: [BOARD, { name: 'roto' }], favorites: { 'user:1': [] }, words: { prueba: { hola: 2 } }, app: '0.7.5', now: 0 });
    assert(r.format === 'miravoz-respaldo' && r.version === 1 && r.boards.length === 1, JSON.stringify(r).slice(0, 120));
    const b = r.boards[0];
    assert(!('ownerId' in b) && !('syncedAt' in b) && !('assignmentId' in b) && b.tags[0] === 'Casa' && b.boards.g.gridElements[0].image.data, JSON.stringify(b));
    assert(!JSON.stringify(r).includes('token'), 'sin token');
});
await t('leer: rechaza archivos ajenos, dañados o de una versión más nueva', () => {
    assert(!B.parseBackup('').ok && !B.parseBackup('{no json').ok && !B.parseBackup('{"format":"otro"}').ok, 'ajenos');
    assert(/más nueva/.test(B.parseBackup(JSON.stringify({ format: 'miravoz-respaldo', version: 99 })).error), 'versión');
});
await t('leer: informa los tableros dañados en vez de restaurarlos a medias', () => {
    const p = B.parseBackup(JSON.stringify({ format: 'miravoz-respaldo', version: 1, boards: [BOARD, { name: 'x', boards: 'mal' }, null] }));
    assert(p.ok && p.boards.length === 1 && p.skipped === 2, JSON.stringify(p).slice(0, 100));
});
await t('restaurar crea un tablero nuevo y no pisa nombres existentes', () => {
    const names = new Set(['merienda']);
    const r = B.restoredBundle(BOARD, names, 'bundle_new');
    assert(r.id === 'bundle_new' && r.name === 'Merienda (respaldo)' && !r.ownerId && names.has('merienda (respaldo)'), JSON.stringify({ id: r.id, name: r.name }));
    const r2 = B.restoredBundle({ ...BOARD, name: 'Otro' }, names, 'b2');
    assert(r2.name === 'Otro', r2.name);
});
await t('palabras aprendidas: se suman quedándose con el mayor conteo', () => {
    const m = B.mergeWords({ hola: 3, chau: 1 }, { hola: 1, chau: 5, x: 9, mate: 2, bad: 'no' });
    assert(m.hola === 3 && m.chau === 5 && m.mate === 2 && !('x' in m) && !('bad' in m), JSON.stringify(m));
});

console.log('favoritas');
await t('guardar: sin vacías, sin repetidas (aunque cambie mayúscula) y con tope', () => {
    let r = F.addTo([], []);
    assert(!r.added && r.reason === 'vacia', 'vacía');
    r = F.addTo([], [{ text: 'Quiero', elData: { id: 'c1', colorCategory: 'CC_VERB', actions: [1] }, imageUrl: 'blob:x' }, { text: 'agua', speakText: 'agua fría' }]);
    assert(r.added && r.list[0].items[0].elData.colorCategory === 'CC_VERB' && !r.list[0].items[0].elData.actions && !r.list[0].items[0].imageUrl && r.list[0].items[1].speakText === 'agua fría', JSON.stringify(r.list));
    const again = F.addTo(r.list, [{ text: 'quiero' }, { text: 'AGUA' }]);
    assert(!again.added && again.reason === 'repetida', again.reason);
    let list = [];
    for (let i = 0; i < F.MAX_FAVORITES; i++) list = F.addTo(list, [{ text: 'f' + i }]).list;
    assert(F.addTo(list, [{ text: 'una más' }]).reason === 'llena', 'tope');
});
await t('cada persona tiene sus favoritas', async () => {
    let scope = 'user:A';
    setPersonScopeProvider(() => scope);
    await F.addFavorite([{ text: 'Me duele' }]);
    scope = 'user:B';
    const b = await F.loadFavorites();
    assert(b.length === 0, 'B no ve las de A');
    await F.addFavorite([{ text: 'Hola' }]);
    scope = 'user:A';
    const a = await F.loadFavorites();
    assert(a.length === 1 && F.phraseText(a[0].items) === 'Me duele', JSON.stringify(a));
    const all = await F.allFavorites();
    assert(all['user:A'].length === 1 && all['user:B'].length === 1, JSON.stringify(Object.keys(all)));
    const n = await F.mergeFavorites('user:A', [{ items: [{ text: 'Me duele' }] }, { items: [{ text: 'Baño' }] }, { items: 'mal' }]);
    assert(n === 1 && (await F.loadFavorites()).length === 2, String(n));
});

console.log('barrido y voz');
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.document = { querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }), body: { appendChild() {} } };
const { ScanEngine } = await import('../web/js/scanning.js');
await t('H02: con los ojos cerrados el barrido no avanza; al terminar elige lo que estaba resaltado', () => {
    const chosen = [];
    const mk = (n) => ({ element: { classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ top: 0 }), isConnected: true, closest: () => null }, data: { y: 0, n }, isAccBtn: false });
    const eng = new ScanEngine((tg) => chosen.push(tg.data.n));
    eng._cfg = () => ({ pattern: 'LINEAR', intervalMs: 1000, cycles: 3, audio: 'none' });
    eng.setTargets([mk('A'), mk('B'), mk('C')]);
    eng.start();
    const t0 = eng.lastAdvance;
    eng.tick(t0 + 1600); // pasa a B
    assert(eng.iIdx === 1, 'en B');
    eng.hold(true, t0 + 1700);           // empieza a cerrar los ojos sobre B
    eng.tick(t0 + 4000); eng.tick(t0 + 6000);
    assert(eng.iIdx === 1, 'sigue en B con los ojos cerrados: ' + eng.iIdx);
    eng.activate(); eng.hold(false, t0 + 6100);
    assert(chosen.join() === 'B', chosen.join());
});
await t('H04: la voz que esperaba el primer toque se descarta si la frase se borró', async () => {
    let said = [];
    const synth = { speaking: false, pending: false, paused: false, getVoices: () => [], speak: (u) => said.push(u.text), cancel() {}, resume() {} };
    globalThis.window = { speechSynthesis: synth, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
    globalThis.speechSynthesis = synth;
    globalThis.SpeechSynthesisUtterance = function (text) { this.text = text; };
    globalThis.CustomEvent = function (n) { this.type = n; };
    const sp = await import('../web/js/speech.js?h04');
    sp.speak('quiero agua', { sentence: true });
    await new Promise(r => setTimeout(r, 1600)); // no arrancó: queda pendiente del primer toque
    said = [];
    sp.dropPendingSpeech();
    sp.unlockSpeech();
    assert(!said.includes('quiero agua'), JSON.stringify(said));
});

console.log(`\n${pass} ok, ${fail} fallidos`);
process.exit(fail ? 1 : 0);
