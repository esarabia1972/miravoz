// asterics.js — Compatibilidad con el formato de Asterics Grid (10/10/2026)
//
// Lógica pura (sin DOM). Cubre todo lo que puede traer un .grd: tipos de celda, acciones, navegación,
// textos en varios idiomas y los respaldos completos (metadata, tablero global, diccionarios).
// Referencia: modelos de AsTeRICS-Grid (src/js/model: GridElement, GridData, GridAction*).
// Lo que MiraVoz no puede hacer (YouTube, domótica, etc.) se marca en la celda y se informa al importar:
// nunca queda una celda que "no hace nada" sin aviso.

// --- Textos ---

/**
 * Texto de un objeto de idiomas de Asterics ({ es: 'Hola', en: 'Hello' }) o de un texto plano.
 * Prioridad: es → variantes de español (es-ar, es-419…) → en → el primero que tenga texto.
 */
export function labelText(label) {
    if (label == null) return '';
    if (typeof label === 'string') return label;
    if (typeof label !== 'object') return String(label);
    const keys = Object.keys(label);
    const pick = (ok) => {
        if (ok(label.es)) return label.es;
        const esVariant = keys.find(k => /^es[-_]/i.test(k) && ok(label[k]));
        if (esVariant) return label[esVariant];
        if (ok(label.en)) return label.en;
        const any = keys.find(k => k !== 'undefined' && ok(label[k])) || keys.find(k => ok(label[k]));
        return any ? label[any] : null;
    };
    // Primero un texto visible; si no hay, uno de solo espacios (la tecla "espacio" de los teclados)
    return pick(v => typeof v === 'string' && v.trim() !== '') ?? pick(v => typeof v === 'string' && v !== '') ?? '';
}

// --- Tipos ---

export const ELEMENT = {
    NORMAL: 'ELEMENT_TYPE_NORMAL',
    COLLECT: 'ELEMENT_TYPE_COLLECT',
    PREDICTION: 'ELEMENT_TYPE_PREDICTION',
    YT_PLAYER: 'ELEMENT_TYPE_YT_PLAYER',
    LIVE: 'ELEMENT_TYPE_LIVE',
    MATRIX: 'ELEMENT_TYPE_MATRIX_CONVERSATION',
    DYNAMIC: 'ELEMENT_TYPE_DYNAMIC_GRID_PLACEHOLDER'
};

const UNSUPPORTED_TYPES = {
    [ELEMENT.YT_PLAYER]: 'reproductor de YouTube',
    [ELEMENT.LIVE]: 'dato en vivo',
    [ELEMENT.MATRIX]: 'conversación de Matrix',
    [ELEMENT.DYNAMIC]: 'tablero dinámico'
};

// Acciones que MiraVoz no puede ejecutar (nombre para mostrar)
const UNSUPPORTED_ACTIONS = {
    GridActionYoutube: 'YouTube',
    GridActionARE: 'domótica (AsTeRICS)',
    GridActionOpenHAB: 'domótica (openHAB)',
    GridActionHTTP: 'pedido a internet (HTTP)',
    GridActionUART: 'puerto serie',
    GridActionSystem: 'acción del sistema',
    GridActionPredefined: 'acción predefinida',
    GridActionMatrix: 'mensajería Matrix',
    GridActionPodcast: 'podcast',
    GridActionWordForm: 'formas de palabra',
    GridActionVocabLevelToggle: 'cambio de nivel de vocabulario',
    GridActionChangeLang: 'cambio de idioma'
};

// Acciones que MiraVoz sí ejecuta
const SUPPORTED_ACTIONS = new Set(['GridActionSpeak', 'GridActionSpeakCustom', 'GridActionNavigate',
    'GridActionCollectElement', 'GridActionPredict', 'GridActionAudio', 'GridActionWebradio', 'GridActionOpenWebpage']);

export const COLLECT = {
    SPEAK: 'COLLECT_ACTION_SPEAK',
    SPEAK_CONTINUOUS: 'COLLECT_ACTION_SPEAK_CONTINUOUS',
    SPEAK_CLEAR: 'COLLECT_ACTION_SPEAK_CLEAR',
    SPEAK_CONTINUOUS_CLEAR: 'COLLECT_ACTION_SPEAK_CONTINUOUS_CLEAR',
    CLEAR: 'COLLECT_ACTION_CLEAR',
    REMOVE_WORD: 'COLLECT_ACTION_REMOVE_WORD',
    REMOVE_CHAR: 'COLLECT_ACTION_REMOVE_CHAR',
    SHARE: 'COLLECT_ACTION_SHARE',
    COPY_CLIPBOARD: 'COLLECT_ACTION_COPY_CLIPBOARD',
    APPEND_CLIPBOARD: 'COLLECT_ACTION_APPEND_CLIPBOARD',
    CLEAR_CLIPBOARD: 'COLLECT_ACTION_CLEAR_CLIPBOARD',
    COPY_IMAGE_CLIPBOARD: 'COLLECT_ACTION_COPY_IMAGE_CLIPBOARD',
    TO_YOUTUBE: 'COLLECT_ACTION_TO_YOUTUBE',
    TOGGLE_TEXT_ROTATION: 'COLLECT_ACTION_TOGGLE_TEXT_ROTATION'
};
const COLLECT_SUPPORTED = new Set([COLLECT.SPEAK, COLLECT.SPEAK_CONTINUOUS, COLLECT.SPEAK_CLEAR, COLLECT.SPEAK_CONTINUOUS_CLEAR,
    COLLECT.CLEAR, COLLECT.REMOVE_WORD, COLLECT.REMOVE_CHAR, COLLECT.SHARE, COLLECT.COPY_CLIPBOARD, COLLECT.APPEND_CLIPBOARD,
    COLLECT.CLEAR_CLIPBOARD, COLLECT.TOGGLE_TEXT_ROTATION]);
const COLLECT_UNSUPPORTED = { [COLLECT.TO_YOUTUBE]: 'buscar la frase en YouTube', [COLLECT.COPY_IMAGE_CLIPBOARD]: 'copiar la frase como imagen' };

// --- Navegación ---

const NAV = { TO_GRID: 'navigateToGrid', TO_HOME: 'navigateToHomeGrid', TO_LAST: 'navigateToLastOpenedGrid', SEARCH: 'navigateToSearch' };

const isNavAction = (a) => a && (a.modelName === 'GridActionNavigate' || (a.navType && !a.modelName));

/**
 * Navegación de una celda: null si no navega, o
 *  { kind: 'grid', target, broken, addToCollect } | { kind: 'back', addToCollect } | { kind: 'home', addToCollect }
 *  | { kind: 'search' } (no soportada).
 * broken = el destino no está en este tablero (vínculo a un tablero que no se importó).
 */
export function navInfo(el, bundle) {
    const a = (el?.actions || []).find(isNavAction);
    if (!a) return null;
    const addToCollect = !!a.addToCollectElem;
    if (a.navType === NAV.TO_LAST || a.toLastGrid) return { kind: 'back', addToCollect };
    if (a.navType === NAV.TO_HOME) return { kind: 'home', addToCollect };
    if (a.navType === NAV.SEARCH) return { kind: 'search', addToCollect };
    if (a.toGridId) return { kind: 'grid', target: a.toGridId, broken: !(bundle?.boards && bundle.boards[a.toGridId]), addToCollect };
    return null;
}

/** La celda navega de verdad (vínculo válido, volver o inicio). */
export function navigates(el, bundle) {
    const n = navInfo(el, bundle);
    return !!n && (n.kind === 'back' || n.kind === 'home' || (n.kind === 'grid' && !n.broken));
}

// --- Acciones ---

export function collectActions(el) {
    return (el?.actions || []).filter(a => a.modelName === 'GridActionCollectElement' && a.action).map(a => a.action);
}

/** Voz propia de la celda: { text, lang } si tiene "decir texto personalizado". */
export function customSpeech(el) {
    const a = (el?.actions || []).find(a => a.modelName === 'GridActionSpeakCustom');
    if (!a) return null;
    return { text: labelText(a.speakText), lang: a.speakLanguage || null };
}

export function hasSpeakAction(el) {
    return (el?.actions || []).some(a => a.modelName === 'GridActionSpeak' || a.modelName === 'GridActionSpeakCustom');
}

export function speakLanguage(el) {
    const a = (el?.actions || []).find(a => a.modelName === 'GridActionSpeak' && a.speakLanguage);
    return a ? a.speakLanguage : null;
}

export function audioAction(el) {
    return (el?.actions || []).find(a => a.modelName === 'GridActionAudio' && a.dataBase64) || null;
}

export function radioActions(el) { return (el?.actions || []).filter(a => a.modelName === 'GridActionWebradio'); }
export function webpageAction(el) { return (el?.actions || []).find(a => a.modelName === 'GridActionOpenWebpage' && a.openURL) || null; }

/**
 * Celda "especial": maneja la frase, la radio, una página web, YouTube, etc. No es una palabra:
 * no se agrega a la frase y solo habla si tiene acción de voz explícita.
 */
export function isSpecialCell(el) {
    if (!el) return false;
    if (el.type && el.type !== ELEMENT.NORMAL) return true;
    return (el.actions || []).some(a => a.modelName && !['GridActionSpeak', 'GridActionSpeakCustom', 'GridActionNavigate', 'GridActionAudio'].includes(a.modelName));
}

/** Tecla de teclado: un solo carácter, sin imagen, que no navega. Se junta con las letras vecinas en una palabra. */
export function isLetterCell(el, text) {
    const t = text != null ? text : labelText(el?.label);
    if (!t || [...t].length !== 1) return false;
    if (el.image && (el.image.data || el.image.url)) return false;
    if ((el.type || ELEMENT.NORMAL) !== ELEMENT.NORMAL) return false;
    return !(el.actions || []).some(a => a.modelName && a.modelName !== 'GridActionSpeak' && a.modelName !== 'GridActionSpeakCustom');
}

/** Página de teclado: tiene al menos 8 teclas de un carácter. Solo ahí las letras forman palabras
 * (en un tablero común, "y" u "o" son palabras que se dicen solas). */
export function isKeyboardPage(grid) {
    let n = 0;
    for (const el of (grid && grid.gridElements) || []) { if (isLetterCell(el) && ++n >= 8) return true; }
    return false;
}

/** Lo que la celda pide y MiraVoz no puede hacer: lista de nombres (vacía = todo soportado). */
export function unsupportedFeatures(el) {
    const out = [];
    if (!el) return out;
    if (UNSUPPORTED_TYPES[el.type]) out.push(UNSUPPORTED_TYPES[el.type]);
    else if (el.type && !Object.values(ELEMENT).includes(el.type)) out.push('tipo de celda desconocido');
    (el.actions || []).forEach(a => {
        if (!a.modelName) return; // acciones de tableros .obz normalizados (navigateToGrid)
        if (UNSUPPORTED_ACTIONS[a.modelName]) out.push(UNSUPPORTED_ACTIONS[a.modelName]);
        else if (!SUPPORTED_ACTIONS.has(a.modelName)) out.push(`acción desconocida (${a.modelName})`);
        else if (a.modelName === 'GridActionCollectElement' && COLLECT_UNSUPPORTED[a.action]) out.push(COLLECT_UNSUPPORTED[a.action]);
        else if (a.modelName === 'GridActionCollectElement' && a.action && !COLLECT_SUPPORTED.has(a.action)) out.push('acción de frase desconocida');
        else if (a.modelName === 'GridActionNavigate' && a.navType === NAV.SEARCH) out.push('búsqueda');
    });
    return [...new Set(out)];
}

/**
 * Hace algo la celda en MiraVoz? false = todo lo que pide no está soportado y no tiene voz ni navegación
 * (se ve atenuada y con el aviso "No disponible").
 */
export function isUsable(el, bundle) {
    if (!unsupportedFeatures(el).length) return true;
    if (UNSUPPORTED_TYPES[el.type]) return false;
    if (hasSpeakAction(el) || navigates(el, bundle) || audioAction(el) || radioActions(el).length || webpageAction(el)) return true;
    return collectActions(el).some(c => COLLECT_SUPPORTED.has(c));
}

// --- Importación ---

/**
 * Prepara un .grd para importarlo como UN tablero:
 *  - respaldo completo (con metadata): usa homeGridId como inicio y saca el tablero global (MiraVoz ya
 *    tiene su barra con Inicio, Atrás, la frase y Hablar);
 *  - saca las miniaturas (Asterics guarda una captura por tablero: peso inútil);
 *  - diccionarios de predicción: se guardan las palabras más frecuentes.
 * Devuelve { grids, homeGridId, globalDropped, predictionWords }.
 */
export function normalizeGrd(json) {
    const md = json && json.metadata;
    let grids = (json.grids || []).filter(g => g && g.id);
    let globalDropped = false;
    if (md && md.globalGridId && grids.length > 1 && grids.some(g => g.id === md.globalGridId)) {
        grids = grids.filter(g => g.id !== md.globalGridId);
        globalDropped = true;
    }
    grids.forEach(g => { delete g.thumbnail; delete g._rev; });
    const homeGridId = md && md.homeGridId && grids.some(g => g.id === md.homeGridId) ? md.homeGridId : null;
    const usesPrediction = grids.some(g => (g.gridElements || []).some(e => e.type === ELEMENT.PREDICTION));
    const predictionWords = usesPrediction ? dictionaryWords(json.dictionaries) : [];
    return { grids, homeGridId, globalDropped, predictionWords };
}

/** Palabras de los diccionarios de Asterics ({ PALABRA: { f: frecuencia, t: {...} } }), las 3000 más usadas. */
export function dictionaryWords(dictionaries) {
    const freq = new Map();
    (Array.isArray(dictionaries) ? dictionaries : []).forEach(d => {
        let data = d && d.data;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = null; } }
        if (!data || typeof data !== 'object') return;
        Object.entries(data).forEach(([w, v]) => {
            const word = String(w).trim();
            if (!word || word.length > 40) return;
            freq.set(word, (freq.get(word) || 0) + (Number(v && v.f) || 0) + 1);
        });
    });
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3000);
}

/**
 * Resumen de compatibilidad de un tablero importado: qué se adaptó y qué no se puede usar.
 * Devuelve { pages, cells, letters, prediction, collectCells, back, home, broken, radio, web, audio, unsupported: Map(nombre -> celdas) }.
 */
export function analyzeBundle(bundle) {
    const r = { pages: 0, cells: 0, letters: 0, prediction: 0, collectCells: 0, back: 0, home: 0, broken: 0, radio: 0, web: 0, audio: 0, unsupported: new Map() };
    Object.values(bundle?.boards || {}).forEach(g => {
        r.pages++;
        const kb = isKeyboardPage(g);
        (g.gridElements || []).forEach(el => {
            r.cells++;
            if (kb && isLetterCell(el)) r.letters++;
            if (el.type === ELEMENT.PREDICTION) r.prediction++;
            if (el.type === ELEMENT.COLLECT || collectActions(el).length) r.collectCells++;
            const n = navInfo(el, bundle);
            if (n && n.kind === 'back') r.back++;
            if (n && n.kind === 'home') r.home++;
            if (n && n.kind === 'grid' && n.broken) r.broken++;
            if (radioActions(el).length) r.radio++;
            if (webpageAction(el)) r.web++;
            if (audioAction(el)) r.audio++;
            unsupportedFeatures(el).forEach(f => r.unsupported.set(f, (r.unsupported.get(f) || 0) + 1));
        });
    });
    return r;
}

/** Texto para la profesional después de importar ('' si no hay nada que contar). */
export function compatibilityMessage(r) {
    const lines = [];
    const n = (k, s, p) => `${k} ${k === 1 ? s : p}`;
    if (r.broken) lines.push(`${n(r.broken, 'celda lleva', 'celdas llevan')} a tableros que no venían en el archivo: quedan sin ese vínculo (en el editor se ven con borde rojo).`);
    const adapted = [];
    if (r.back) adapted.push('"volver"');
    if (r.home) adapted.push('"ir al inicio"');
    if (r.collectCells) adapted.push('botones de la frase');
    if (r.letters) adapted.push('teclado (las letras forman palabras)');
    if (r.prediction) adapted.push('predicción de palabras');
    if (r.radio) adapted.push('radio por internet');
    if (r.web) adapted.push('abrir páginas web');
    if (r.audio) adapted.push('audios grabados');
    if (adapted.length) lines.push(`Funciona también: ${adapted.join(', ')}.`);
    if (r.unsupported.size) {
        const list = [...r.unsupported.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ');
        lines.push(`MiraVoz todavía no puede: ${list}. Las celdas que solo hacían eso se marcan con "No disponible"; en las demás, esa parte no funciona.`);
    }
    return lines.join('\n');
}
