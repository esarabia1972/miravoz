// colors.js — Colores Fitzgerald por colorCategory nativo del GRD + fallback legacy (SPEC F0-8)

// Valores reales verificados en nuclear.grd (GridData v7)
const CATEGORY_COLORS = {
    'CC_PRONOUN_PERSON_NAME': '#fff176',
    'CC_VERB': '#81c784',
    'CC_DESCRIPTOR': '#64b5f6',
    'CC_NOUN': '#ffb74d',
    'CC_IMPORTANT': '#ff8a80',
    'CC_SOCIAL_EXPRESSIONS': '#f48fb1',
    'CC_PLACE': '#ba68c8',
    'CC_OTHERS': '#9e9e9e'
};

export function getCategoryColor(category) {
    if (!category) return null;
    return CATEGORY_COLORS[category] || null;
}

// Fallback legacy: inferencia por label para tableros sin colorCategory
export function getAutoColor(label) {
    if (!label) return null;
    const l = label.trim().toUpperCase();
    if (['YO', 'TÚ', 'PERSONAS'].includes(l)) return '#fff176';
    if (['QUIERO', 'VERBOS'].includes(l)) return '#81c784';
    if (['SÍ', 'NO', 'BIEN', 'MAL'].includes(l)) return '#64b5f6';
    if (['BAÑO', 'ME GUSTA', 'NO ME GUSTA', 'HABLAR CON', 'AYUDA', 'DAME', 'DESCANSO', 'VOLVER', 'EXPRESIONES', 'SOBRE MÍ', 'PARAR', 'QUIERO IR AL BAÑO', 'ME ENCUENTRO MAL', 'ME ESTOY MAREANDO', 'QUIERO DESCANSAR', 'TENGO CALOR', 'TENGO FRÍO', 'TENGO HAMBRE', 'TENGO SED', 'ESTÁ ROTO', 'NO ENTIENDO', 'NO SÉ QUÉ PASA', 'HAY MUCHO RUIDO'].includes(l)) return '#ff8a80';
    if (['COMIDA', 'BEBIDA', 'ROPA', 'LUGARES', 'TRANSPORTES', 'CASA', 'COLEGIO', 'OBJETOS', 'APARATOS', 'JUGUETES', 'CLIMA', 'COLORES', 'CUERPO', 'ESTADOS', 'ASEO', 'TIEMPO', 'FORMAS', 'ANIMALES', 'DEPORTES', 'OCIO', 'FIESTAS', 'CONCEPTOS', 'DESCRIPCIÓN', 'PLANTAS'].includes(l)) return '#ffb74d';
    if (['CORE 50'].includes(l)) return '#ba68c8';
    if (['NÚMEROS', 'PALABRAS', 'TECLADO', 'RADIO', 'YOUTUBE'].includes(l)) return '#9e9e9e';
    return null;
}

// Prioridad (SPEC F0-8): backgroundColor explícito > colorCategory > fallback por label
export function getCellColor(elData) {
    if (!elData) return null;
    if (elData.backgroundColor) return elData.backgroundColor;
    const byCategory = getCategoryColor(elData.colorCategory);
    if (byCategory) return byCategory;
    const labelStr = typeof elData.label === 'string'
        ? elData.label
        : (elData.label ? (elData.label.es || elData.label.en) : '');
    return labelStr ? getAutoColor(labelStr) : null;
}
