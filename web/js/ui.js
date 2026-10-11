// ui.js — Modales, toasts y acumulador de frases (SPEC F1-1)

import { speak } from './speech.js';
import { getCellColor } from './colors.js';
import { learnWord } from './prediction.js';
import { selectionContexts, buttonTargets } from './contexts.js';

// --- Modales ---
// Hay un solo #custom-dialog: los diálogos se encolan para que dos pedidos simultáneos
// (p. ej. la sync preguntando mientras el editor confirma) nunca dejen una promesa colgada.
let dialogChain = Promise.resolve();
function queued(fn) {
    const p = dialogChain.then(fn);
    dialogChain = p.catch(() => {});
    return p;
}

export function customAlert(message) { return queued(() => showAlert(message)); }
export function customConfirm(message) { return queued(() => showConfirm(message)); }

/** Diálogo con dos opciones con nombre propio. Devuelve true (primera opción) o false (segunda). */
export function customChoice(message, firstLabel, secondLabel) {
    return queued(async () => {
        const ok = document.getElementById('btn-dialog-ok');
        const cancel = document.getElementById('btn-dialog-cancel');
        const prev = [ok.textContent, cancel.textContent];
        ok.textContent = firstLabel;
        cancel.textContent = secondLabel;
        try { return await showConfirm(message); }
        finally { ok.textContent = prev[0]; cancel.textContent = prev[1]; }
    });
}

function showAlert(message) {
    const dialog = document.getElementById('custom-dialog');
    const msg = document.getElementById('dialog-message');
    const btnCancel = document.getElementById('btn-dialog-cancel');
    const btnOk = document.getElementById('btn-dialog-ok');

    msg.innerText = message;
    btnCancel.style.display = 'none';
    dialog.style.display = 'flex';
    // M03: mientras el diálogo está abierto, la mirada y el barrido apuntan solo a sus botones
    const token = selectionContexts.push('dialog', () => buttonTargets([btnOk]), { element: dialog });

    return new Promise(resolve => {
        btnOk.onclick = () => { dialog.style.display = 'none'; selectionContexts.pop(token); resolve(); };
    });
}

function showConfirm(message) {
    const dialog = document.getElementById('custom-dialog');
    const msg = document.getElementById('dialog-message');
    const btnCancel = document.getElementById('btn-dialog-cancel');
    const btnOk = document.getElementById('btn-dialog-ok');

    msg.innerText = message;
    btnCancel.style.display = 'inline-block';
    dialog.style.display = 'flex';
    const token = selectionContexts.push('dialog', () => buttonTargets([btnCancel, btnOk]), { element: dialog });

    return new Promise(resolve => {
        btnOk.onclick = () => { dialog.style.display = 'none'; selectionContexts.pop(token); resolve(true); };
        btnCancel.onclick = () => { dialog.style.display = 'none'; selectionContexts.pop(token); resolve(false); };
    });
}

// --- Toast ---
export function showSyncToast(message = 'Sincronizando...') {
    const toast = document.getElementById('sync-toast');
    if (toast) {
        document.getElementById('sync-message').textContent = message;
        toast.style.display = 'flex';
    }
}

export function hideSyncToast() {
    const toast = document.getElementById('sync-toast');
    if (toast) toast.style.display = 'none';
}

// Toast breve autodescartable (usado para el score de calibración, F1-5)
export function showInfoToast(message, ms = 4000) {
    showSyncToast(message);
    const toast = document.getElementById('sync-toast');
    if (toast) {
        const spinner = toast.querySelector('.spinner');
        if (spinner) spinner.style.display = 'none';
        setTimeout(() => {
            hideSyncToast();
            if (spinner) spinner.style.display = '';
        }, ms);
    }
}

// --- Undo Toast (F3) ---
let undoTimeout = null;
/** Invalida un "deshacer" pendiente (p. ej. si el tablero se actualizó desde otro dispositivo). */
export function cancelUndo() {
    if (undoTimeout) clearTimeout(undoTimeout);
    const toast = document.getElementById('undo-toast');
    if (toast) toast.style.display = 'none';
    const btn = document.getElementById('undo-btn');
    if (btn) btn.onclick = null;
}
export function showUndoToast(onUndoCallback) {
    let toast = document.getElementById('undo-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'undo-toast';
        toast.style.cssText = 'position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#333; color:#fff; padding:12px 24px; border-radius:24px; display:flex; align-items:center; gap:16px; z-index:15000; box-shadow:0 4px 12px rgba(0,0,0,0.3); font-family:sans-serif; font-size:14px;';
        
        const msg = document.createElement('span');
        msg.id = 'undo-msg';
        
        const btn = document.createElement('button');
        btn.textContent = 'Deshacer';
        btn.style.cssText = 'background:none; border:none; color:#00ff88; font-weight:bold; cursor:pointer; font-size:14px; padding:0; text-transform:uppercase;';
        btn.id = 'undo-btn';
        
        toast.append(msg, btn);
        document.body.appendChild(toast);
    }
    
    document.getElementById('undo-msg').textContent = 'Acción realizada';
    const btn = document.getElementById('undo-btn');
    btn.onclick = () => {
        if (undoTimeout) clearTimeout(undoTimeout);
        toast.style.display = 'none';
        if (onUndoCallback) onUndoCallback();
    };
    
    toast.style.display = 'flex';
    if (undoTimeout) clearTimeout(undoTimeout);
    undoTimeout = setTimeout(() => {
        toast.style.display = 'none';
    }, 5000);
}

// --- Acumulador de frases ---
let sentenceAccumulator = [];
const sentenceContainer = document.getElementById('sentence-container');

export function getSentence() { return sentenceAccumulator; }

// Quien muestra la frase dentro del tablero (celdas de frase y de predicción de Asterics) se suscribe acá
const sentenceListeners = new Set();
export function onSentenceChange(fn) { sentenceListeners.add(fn); return () => sentenceListeners.delete(fn); }
function changed() {
    renderSentence();
    sentenceListeners.forEach(fn => { try { fn(sentenceAccumulator); } catch (e) { console.warn(e); } });
}

export function clearSentence() {
    sentenceAccumulator = [];
    changed();
}

/** Borra el último elemento (una palabra o un pictograma). */
export function popSentence() {
    if (sentenceAccumulator.length > 0) {
        sentenceAccumulator.pop();
        changed();
    }
}

export function addToSentence(item) {
    closeWord();
    sentenceAccumulator.push(item);
    changed();
}

// --- Teclado (10/10/2026): las letras se juntan en una palabra hasta un espacio ---
const lastItem = () => sentenceAccumulator[sentenceAccumulator.length - 1];
const openWord = () => { const l = lastItem(); return l && l.letters && l.open ? l : null; };

/** Cierra la palabra que se está escribiendo (y la aprende para la predicción). */
function closeWord() {
    const w = openWord();
    if (w) { w.open = false; learnWord(w.text); }
}

/** Agrega un carácter del teclado. El espacio termina la palabra. */
export function addLetter(char, elData = null) {
    if (char === ' ' || char === '\u00a0') {
        if (openWord()) { closeWord(); changed(); }
        return;
    }
    const w = openWord();
    if (w) w.text += char;
    else sentenceAccumulator.push({ text: char, letters: true, open: true, elData });
    changed();
}

/** Lo que se está escribiendo (para la predicción): '' si no hay palabra abierta. */
export function currentPrefix() { const w = openWord(); return w ? w.text : ''; }

/** Borra un carácter: de la palabra que se escribe o, si es un pictograma, el pictograma entero. */
export function removeChar() {
    const l = lastItem();
    if (!l) return;
    if (l.letters && l.text.length > 1) { l.text = l.text.slice(0, -1); l.open = true; }
    else sentenceAccumulator.pop();
    changed();
}

/** Completa la palabra abierta con una sugerencia de la predicción (o la agrega). */
export function completeWord(word) {
    const w = openWord();
    if (w) { w.text = word; w.open = false; }
    else sentenceAccumulator.push({ text: word, letters: true, open: false });
    learnWord(word);
    changed();
}

/** "Agregar o sacar" (toggleInBar de Asterics): si el elemento ya está en la frase, lo saca. */
export function toggleInSentence(item) {
    const id = item.elData && item.elData.id;
    const i = id ? sentenceAccumulator.findIndex(x => x.elData && x.elData.id === id) : -1;
    if (i >= 0) { sentenceAccumulator.splice(i, 1); changed(); }
    else addToSentence(item);
}

/** Texto de la frase (lo que se ve), por ejemplo para copiar. */
export function sentenceText() {
    return sentenceAccumulator.map(i => i.text).filter(Boolean).join(' ');
}

export function playSentence() {
    if (sentenceAccumulator.length === 0) return;
    closeWord();
    const fullText = sentenceAccumulator
        .map(i => (i.speakText !== undefined ? i.speakText : i.text))
        .filter(Boolean)
        .join(', '); // como siempre: una pausa breve entre pictogramas
    if (fullText) speak(fullText);
}

export function renderSentence() {
    sentenceContainer.innerHTML = '';
    sentenceAccumulator.forEach(item => {
        const el = document.createElement('div');
        el.className = 'sentence-item';

        let bgColor = '#fff';
        if (item.elData) {
            bgColor = getCellColor(item.elData) || '#fff';
        }
        el.style.setProperty('background-color', bgColor, 'important');

        if (item.imageUrl) {
            const img = document.createElement('img');
            img.src = item.imageUrl;
            el.appendChild(img);
        } else if (item.text) {
            const span = document.createElement('span');
            span.textContent = item.text;
            el.appendChild(span);
        }
        sentenceContainer.appendChild(el);
    });
    sentenceContainer.scrollLeft = sentenceContainer.scrollWidth;
}

// --- Toast de error (rojo, letras blancas, se cierra solo) ---
let errorToastTimer = null;
export function showErrorToast(message, ms = 5000) {
    let toast = document.getElementById('error-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'error-toast';
        toast.className = 'error-toast';
        toast.setAttribute('role', 'alert');
        toast.onclick = () => toast.classList.remove('visible');
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    // reflow para que la animación se repita si ya estaba visible
    toast.classList.remove('visible'); void toast.offsetWidth; toast.classList.add('visible');
    if (errorToastTimer) clearTimeout(errorToastTimer);
    errorToastTimer = setTimeout(() => toast.classList.remove('visible'), ms);
}
