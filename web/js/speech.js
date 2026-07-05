// speech.js — Síntesis de voz (SPEC F1-1)

if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => console.log('Voces TTS listas');
}

export function speak(text, { cancelPrevious = false, volume = 1.0 } = {}) {
    if (!text) return;
    if (cancelPrevious) speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    utterance.volume = volume;

    const voices = speechSynthesis.getVoices();
    const spanishVoices = voices.filter(v => v.lang.startsWith('es'));

    if (spanishVoices.length > 0) {
        let preferredVoice = spanishVoices.find(v =>
            v.name.includes('Google español') ||
            v.name.includes('Google Español') ||
            v.name.includes('Paulina') ||
            v.name.includes('Mónica') ||
            v.name.includes('Luciana') ||
            v.name.includes('Elena')
        );
        if (!preferredVoice) preferredVoice = spanishVoices[0];
        utterance.voice = preferredVoice;
        utterance.lang = preferredVoice.lang;
    }

    speechSynthesis.speak(utterance);
}
