// ui.js — Modales, toasts y acumulador de frases (SPEC F1-1)

import { speak } from './speech.js';
import { getCellColor } from './colors.js';

// --- Modales ---
export function customAlert(message) {
    const dialog = document.getElementById('custom-dialog');
    const msg = document.getElementById('dialog-message');
    const btnCancel = document.getElementById('btn-dialog-cancel');
    const btnOk = document.getElementById('btn-dialog-ok');

    msg.innerText = message;
    btnCancel.style.display = 'none';
    dialog.style.display = 'flex';

    return new Promise(resolve => {
        btnOk.onclick = () => { dialog.style.display = 'none'; resolve(); };
    });
}

export function customConfirm(message) {
    const dialog = document.getElementById('custom-dialog');
    const msg = document.getElementById('dialog-message');
    const btnCancel = document.getElementById('btn-dialog-cancel');
    const btnOk = document.getElementById('btn-dialog-ok');

    msg.innerText = message;
    btnCancel.style.display = 'inline-block';
    dialog.style.display = 'flex';

    return new Promise(resolve => {
        btnOk.onclick = () => { dialog.style.display = 'none'; resolve(true); };
        btnCancel.onclick = () => { dialog.style.display = 'none'; resolve(false); };
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

export function clearSentence() {
    sentenceAccumulator = [];
    renderSentence();
}

export function popSentence() {
    if (sentenceAccumulator.length > 0) {
        sentenceAccumulator.pop();
        renderSentence();
    }
}

export function addToSentence(item) {
    sentenceAccumulator.push(item);
    renderSentence();
}

export function playSentence() {
    if (sentenceAccumulator.length === 0) return;
    const fullText = sentenceAccumulator
        .map(i => i.speakText !== undefined ? i.speakText : i.text)
        .filter(Boolean)
        .join(', ');
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
