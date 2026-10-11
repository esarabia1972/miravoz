// Tests de asterics.js y prediction.js (compatibilidad con el formato de Asterics Grid). Correr: node tools/test-asterics.mjs
import {
    labelText, navInfo, navigates, isLetterCell, isSpecialCell, unsupportedFeatures, isUsable, customSpeech,
    speakLanguage, normalizeGrd, dictionaryWords, analyzeBundle, compatibilityMessage, collectActions, ELEMENT, isKeyboardPage
} from '../web/js/asterics.js';
import { suggest } from '../web/js/prediction.js';
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const eq = (a, b, m = '') => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${m} esperado ${B}, obtenido ${A}`); };

const nav = (extra) => ({ id: 'a', modelName: 'GridActionNavigate', ...extra });
const el = (o) => ({ id: 'e', x: 0, y: 0, width: 1, height: 1, label: {}, actions: [], type: 'ELEMENT_TYPE_NORMAL', ...o });
const bundle = { mainBoard: 'g1', boards: { g1: { id: 'g1', gridElements: [] }, g2: { id: 'g2', gridElements: [] } } };

console.log('asterics');
t('labelText: es, variantes de español, inglés, cualquiera, texto plano', () => {
    eq(labelText({ es: 'Hola', en: 'Hi' }), 'Hola');
    eq(labelText({ 'es-ar': 'Che' }), 'Che');
    eq(labelText({ es: '', 'es-AR': 'Vos' }), 'Vos');
    eq(labelText({ de: 'Hallo', en: 'Hello' }), 'Hello');
    eq(labelText({ de: 'Hallo' }), 'Hallo');
    eq(labelText({ undefined: 'X', fr: 'Salut' }), 'Salut');
    eq(labelText('Texto'), 'Texto');
    eq(labelText(null), '');
});
t('navInfo: página, rota, volver (dos formas), inicio, búsqueda', () => {
    eq(navInfo(el({ actions: [nav({ navType: 'navigateToGrid', toGridId: 'g2' })] }), bundle), { kind: 'grid', target: 'g2', broken: false, addToCollect: false });
    eq(navInfo(el({ actions: [nav({ navType: 'navigateToGrid', toGridId: 'zz' })] }), bundle).broken, true);
    eq(navInfo(el({ actions: [nav({ navType: 'navigateToLastOpenedGrid' })] }), bundle).kind, 'back');
    eq(navInfo(el({ actions: [nav({ navType: 'navigateToGrid', toLastGrid: true, toGridId: 'g2' })] }), bundle).kind, 'back');
    eq(navInfo(el({ actions: [nav({ navType: 'navigateToHomeGrid' })] }), bundle).kind, 'home');
    eq(navInfo(el({ actions: [nav({ navType: 'navigateToSearch' })] }), bundle).kind, 'search');
    eq(navInfo(el({ actions: [nav({ navType: 'navigateToGrid', toGridId: 'g2', addToCollectElem: true })] }), bundle).addToCollect, true);
    eq(navInfo(el({ actions: [{ navType: 'navigateToGrid', toGridId: 'g2' }] }), bundle).kind, 'grid', 'acciones de .obz sin modelName');
    eq(navInfo(el({ actions: [{ modelName: 'GridActionSpeak' }] }), bundle), null);
});
t('navigates: los vínculos rotos y la búsqueda no navegan', () => {
    eq(navigates(el({ actions: [nav({ toGridId: 'zz' })] }), bundle), false);
    eq(navigates(el({ actions: [nav({ navType: 'navigateToSearch' })] }), bundle), false);
    eq(navigates(el({ actions: [nav({ navType: 'navigateToHomeGrid' })] }), bundle), true);
});
t('isLetterCell: teclas sí; pictogramas, palabras y botones no', () => {
    eq(isLetterCell(el({ label: { es: 'A' } })), true);
    eq(isLetterCell(el({ label: { es: ' ' } })), true);
    eq(isLetterCell(el({ label: { es: 'Ñ' }, actions: [{ modelName: 'GridActionSpeak' }] })), true);
    eq(isLetterCell(el({ label: { es: 'A' }, image: { url: 'https://x/y.png' } })), false);
    eq(isLetterCell(el({ label: { es: 'AB' } })), false);
    eq(isLetterCell(el({ label: { es: 'X' }, actions: [{ modelName: 'GridActionCollectElement', action: 'COLLECT_ACTION_CLEAR' }] })), false);
});
t('isKeyboardPage: como Asterics (más del 40% de celdas de un carácter, o keyboardMode)', () => {
    eq(isKeyboardPage({ gridElements: 'ABCDEFGH'.split('').map(c => el({ label: { es: c } })) }), true);
    const words = ['Mamá', 'Papá', 'Comer', 'Agua', 'Baño', 'Sí', 'No', 'y', 'o'].map(c => el({ label: { es: c } }));
    eq(isKeyboardPage({ gridElements: words }), false, '"y" y "o" en un tablero de palabras');
    eq(isKeyboardPage({ keyboardMode: 'KEYBOARD_DISABLED', gridElements: 'ABCD'.split('').map(c => el({ label: { es: c } })) }), false);
    eq(isKeyboardPage({ keyboardMode: 'KEYBOARD_ENABLED', gridElements: words }), true);
    eq(isKeyboardPage(null), false);
});
t('isSpecialCell', () => {
    eq(isSpecialCell(el({ actions: [{ modelName: 'GridActionCollectElement', action: 'COLLECT_ACTION_CLEAR' }] })), true);
    eq(isSpecialCell(el({ type: ELEMENT.PREDICTION })), true);
    eq(isSpecialCell(el({ actions: [{ modelName: 'GridActionSpeak' }, nav({ toGridId: 'g2' })] })), false);
    eq(isSpecialCell(el({ actions: [{ modelName: 'GridActionAudio', dataBase64: 'x' }] })), false);
});
t('unsupportedFeatures e isUsable', () => {
    const yt = el({ actions: [{ modelName: 'GridActionYoutube', action: 'YT_TOGGLE' }] });
    eq(unsupportedFeatures(yt), ['YouTube']); eq(isUsable(yt, bundle), false);
    const ytSpeak = el({ label: { es: 'Música' }, actions: [{ modelName: 'GridActionSpeak' }, { modelName: 'GridActionYoutube' }] });
    eq(isUsable(ytSpeak, bundle), true, 'si además habla, se puede usar');
    eq(isUsable(el({ type: ELEMENT.YT_PLAYER }), bundle), false);
    eq(unsupportedFeatures(el({ actions: [{ modelName: 'GridActionCollectElement', action: 'COLLECT_ACTION_TO_YOUTUBE' }] })), ['buscar la frase en YouTube']);
    eq(unsupportedFeatures(el({ actions: [{ modelName: 'GridActionFuturo' }] })), ['acción desconocida (GridActionFuturo)']);
    eq(unsupportedFeatures(el({ type: 'ELEMENT_TYPE_NUEVO' })), ['tipo de celda desconocido']);
    eq(unsupportedFeatures(el({ actions: [{ modelName: 'GridActionWebradio', action: 'WEBRADIO_ACTION_START' }, { modelName: 'GridActionOpenWebpage', openURL: 'https://a' }, { modelName: 'GridActionAudio', dataBase64: 'x' }] })), []);
    eq(isUsable(el({ actions: [{ modelName: 'GridActionCollectElement', action: 'COLLECT_ACTION_REMOVE_CHAR' }] }), bundle), true);
});
t('customSpeech y speakLanguage', () => {
    eq(customSpeech(el({ actions: [{ modelName: 'GridActionSpeakCustom', speakText: { es: 'ANALÍA' }, speakLanguage: 'es' }] })), { text: 'ANALÍA', lang: 'es' });
    eq(customSpeech(el({ actions: [{ modelName: 'GridActionSpeakCustom', speakText: { 'es-ar': 'Che' } }] })).text, 'Che');
    eq(speakLanguage(el({ actions: [{ modelName: 'GridActionSpeak', speakLanguage: 'de' }] })), 'de');
    eq(collectActions(el({ actions: [{ modelName: 'GridActionCollectElement', action: 'COLLECT_ACTION_CLEAR' }] })), ['COLLECT_ACTION_CLEAR']);
});
t('normalizeGrd: respaldo completo → inicio, sin global ni miniaturas, diccionario', () => {
    const json = {
        grids: [{ id: 'home', thumbnail: { data: 'x' }, gridElements: [{ type: ELEMENT.PREDICTION }] }, { id: 'glob', gridElements: [] }, { id: 'p2', _rev: '1', gridElements: [] }],
        metadata: { homeGridId: 'home', globalGridId: 'glob' },
        dictionaries: [{ data: JSON.stringify({ HOLA: { f: 5 }, CHAU: { f: 1 } }) }, { data: { HOLA: { f: 2 } } }]
    };
    const n = normalizeGrd(json);
    eq(n.grids.map(g => g.id), ['home', 'p2']); eq(n.homeGridId, 'home'); eq(n.globalDropped, true);
    eq(n.grids[0].thumbnail, undefined); eq(n.grids[1]._rev, undefined);
    eq(n.predictionWords[0][0], 'HOLA');
});
t('normalizeGrd: respaldo parcial (solo grids) e inicio inexistente', () => {
    const n = normalizeGrd({ grids: [{ id: 'a', gridElements: [] }] });
    eq([n.homeGridId, n.globalDropped, n.predictionWords.length], [null, false, 0]);
    eq(normalizeGrd({ grids: [{ id: 'a', gridElements: [] }], metadata: { homeGridId: 'falta' } }).homeGridId, null);
    eq(normalizeGrd({ grids: [{ id: 'g', gridElements: [] }], metadata: { globalGridId: 'g' } }).grids.length, 1, 'no deja el tablero vacío');
});
t('dictionaryWords tolera basura', () => eq(dictionaryWords([{ data: '{roto' }, null, { data: 5 }]), []));
t('analyzeBundle y compatibilityMessage', () => {
    const b = { mainBoard: 'g1', boards: { g1: { id: 'g1', gridElements: [
        ...'ABCDEFGH'.split('').map(c => el({ label: { es: c } })), el({ actions: [nav({ navType: 'navigateToLastOpenedGrid' })] }),
        el({ actions: [nav({ toGridId: 'zz' })] }), el({ actions: [{ modelName: 'GridActionYoutube' }] }),
        el({ type: ELEMENT.PREDICTION }), el({ actions: [{ modelName: 'GridActionWebradio', action: 'WEBRADIO_ACTION_START' }] })
    ] } } };
    const r = analyzeBundle(b);
    eq([r.letters, r.back, r.broken, r.prediction, r.radio, r.unsupported.get('YouTube')], [8, 1, 1, 1, 1, 1]);
    const m = compatibilityMessage(r);
    if (!/1 celda lleva/.test(m) || !/YouTube \(1\)/.test(m) || !/teclado/.test(m)) throw new Error(m);
    eq(compatibilityMessage(analyzeBundle({ boards: { g: { gridElements: [el({ label: { es: 'Hola' }, actions: [{ modelName: 'GridActionSpeak' }] })] } } })), '');
});

console.log('prediction');
t('suggest: prefijo, mayúsculas, extra y lo aprendido primero', () => {
    const s1 = suggest('ho', { learned: {} });
    if (!s1.includes('hola') || !s1.every(w => w.startsWith('ho'))) throw new Error(JSON.stringify(s1));
    eq(suggest('HO', { upper: true, learned: {} }).every(w => w === w.toUpperCase()), true);
    eq(suggest('enc', { extra: [['ENCASTRES', 9]], learned: {} })[0], 'encastres');
    eq(suggest('ho', { learned: { hormiga: 3 } })[0], 'hormiga');
    eq(suggest('hola', { learned: {} }).includes('hola'), false, 'no repite lo ya escrito');
    eq(suggest('', { count: 3, learned: {} }).length, 3);
});

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
