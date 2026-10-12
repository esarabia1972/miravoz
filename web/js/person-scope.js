// person-scope.js — De quién es lo que se aprende y se guarda en este dispositivo (0.7.5).
// Tablet vinculada: 'user:<id del usuario>'. Cuenta registrada probando tableros: 'prueba'.
// Lo personal (predicción aprendida, frases favoritas) se guarda separado por persona: nunca se mezcla.
// main.js da la fuente (la misma que usan los perfiles de calibración).

let provider = () => 'prueba';

export function setPersonScopeProvider(fn) { if (typeof fn === 'function') provider = fn; }
export function personScope() {
    try { return provider() || 'prueba'; } catch { return 'prueba'; }
}
