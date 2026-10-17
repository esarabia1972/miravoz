// test-cloud-voice.mjs — voces de MiraVoz (0.8.1n): normalización del texto y etiqueta de la voz
import { normalizeText, speedKey } from '../web/js/cloud-voice.js';
import { closeSentence } from '../web/js/speech.js';
import { cloudVoiceLabel } from '../web/js/voice-settings.js';
let ok = 0, bad = 0;
const t = (name, cond) => { if (cond) ok++; else { bad++; console.error('✗', name); } };
t('mayúsculas a oración (no deletrear)', normalizeText('  BARTOLITO  ') === 'Bartolito' && normalizeText('OTRA VEZ') === 'Otra vez');
t('texto normal no cambia', normalizeText('Quiero  agua, por favor') === 'Quiero agua, por favor');
t('una letra queda igual', normalizeText('A') === 'A' && normalizeText('OK') === 'Ok');
t('velocidad acotada', speedKey(2) === '1.20' && speedKey(0.1) === '0.70' && speedKey(undefined) === '1.00');
t('etiqueta de voz', cloudVoiceLabel({ nombre: 'Tomás', genero: 'male', edad: 'young', acento: 'argentine' }) === 'Tomás (hombre, joven, argentine)' && cloudVoiceLabel({ nombre: 'X' }) === 'X');
t('la frase cierra con punto', closeSentence('yo quiero agua') === 'yo quiero agua.' && closeSentence('¿vamos?') === '¿vamos?' && closeSentence('¡hola!  ') === '¡hola!' && closeSentence('listo.') === 'listo.');
console.log(`${bad ? '✗' : '✓'} test-cloud-voice: ${ok} ok, ${bad} fallidos`);
process.exit(bad ? 1 : 0);
