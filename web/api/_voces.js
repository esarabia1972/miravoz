// _voces.js — Voces de MiraVoz (0.8.1o): solo estas aparecen en Configuración y solo estas se pueden pedir.
// Para agregar una: sumar su id de ElevenLabs (de "My Voices") con nombre y género, y publicar.
export const VOCES = [
    { id: 'h60rOzgfLmYsntfqgGu2', nombre: 'Sofía', genero: 'female' },
    { id: '4wDRKlxcHNOFO5kBvE81', nombre: 'Melisa', genero: 'female' },
    { id: 'gBTPbHzRd0ZmV75Z5Zk4', nombre: 'Carlos', genero: 'male' },
    { id: 'pXzlRykxH388Ltp35fHG', nombre: 'Rolando', genero: 'male' }
];
export const VOZ_IDS = new Set(VOCES.map(v => v.id));
