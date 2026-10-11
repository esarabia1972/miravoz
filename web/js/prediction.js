// prediction.js — Predicción de palabras para las celdas de predicción de Asterics (10/10/2026)
//
// Fuentes, de mayor a menor peso: palabras que la persona ya escribió en este dispositivo (localStorage,
// nunca sale del equipo), el diccionario que traía el .grd, los textos del propio tablero y una lista base
// de palabras frecuentes del español rioplatense.

const LEARN_KEY = 'miravoz_pred_words';

const BASE = (`que de no a la el y en lo es un por me una te los se con para mi si ya bien yo
está estoy tengo quiero puedo voy vamos hay hola chau gracias por favor sí no más menos mucho poco
mamá papá casa escuela comer tomar agua jugar dormir baño ayuda ahora después hoy mañana ayer
qué quién cómo cuándo dónde porque también todo nada algo eso esto acá allá bueno malo lindo feo
duele frío calor hambre sed cansado contento triste enojado miedo amigo amiga seño profe tele música
quiero ir salir venir dar ver hacer decir saber querer poder estar ser tener gustar necesito me gusta
no me gusta otra vez basta terminé listo espera perdón hermano hermana abuelo abuela perro gato
pelota auto parque plaza fruta leche pan galletita chocolate jugo vos ustedes nosotros ellos él ella
día noche semana fin sábado domingo lunes martes miércoles jueves viernes`)
    .split(/\s+/).filter(Boolean);

function readLearned() {
    try { return JSON.parse(localStorage.getItem(LEARN_KEY) || '{}') || {}; } catch { return {}; }
}

/** Registra una palabra escrita con el teclado (para sugerirla primero la próxima vez). */
export function learnWord(word) {
    const w = String(word || '').trim();
    if (w.length < 2 || w.length > 40) return;
    const key = w.toLocaleLowerCase('es');
    const data = readLearned();
    data[key] = (data[key] || 0) + 1;
    const entries = Object.entries(data);
    if (entries.length > 2000) { // tope: se quedan las más usadas
        entries.sort((a, b) => b[1] - a[1]);
        try { localStorage.setItem(LEARN_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, 1500)))); } catch {}
        return;
    }
    try { localStorage.setItem(LEARN_KEY, JSON.stringify(data)); } catch { /* modo privado */ }
}

/**
 * Sugerencias para un prefijo (vacío = las más frecuentes). extra = [[palabra, peso], ...] del tablero.
 * upper = devolver en mayúsculas (teclados en mayúsculas). Pura salvo la lectura de lo aprendido.
 */
export function suggest(prefix, { extra = [], count = 6, upper = false, learned = readLearned() } = {}) {
    const p = String(prefix || '').toLocaleLowerCase('es');
    const score = new Map();
    const add = (w, s) => {
        const k = String(w || '').trim().toLocaleLowerCase('es');
        if (!k || k.length > 40) return;
        score.set(k, (score.get(k) || 0) + s);
    };
    BASE.forEach((w, i) => add(w, 1 + (BASE.length - i) / BASE.length));
    extra.forEach(([w, f]) => add(w, 2 + Math.log1p(Number(f) || 0)));
    Object.entries(learned || {}).forEach(([w, n]) => add(w, 10 + 3 * Math.log1p(n)));
    const out = [...score.entries()]
        .filter(([w]) => !p || (w.startsWith(p) && w !== p))
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'es'))
        .slice(0, count)
        .map(([w]) => (upper ? w.toLocaleUpperCase('es') : w));
    return out;
}
