// backup-ui.js — Botones "Descargar respaldo" y "Restaurar respaldo" de Configuración (0.7.5).
// Cuenta registrada: tableros + favoritas y palabras de cada persona de este dispositivo.
// Tablet vinculada: solo las favoritas y palabras de su usuario (sus tableros ya están en la cuenta registrada).
// Siempre se respalda y se restaura SOLO lo de quien usa el dispositivo ahora (personScope): si este navegador
// fue antes la tablet de otra persona, sus frases no viajan en el respaldo de la cuenta.

import { buildBackup, parseBackup, restoredBundle, mergeWords, MAX_BACKUP_BYTES } from './backup.js';
import { allFavorites, mergeFavorites } from './favorites.js';
import { learnedWordsFor, setLearnedWordsFor } from './prediction.js';
import { personScope } from './person-scope.js';
import { isVisibleTo } from './sync-plan.js';
import { saveBundle } from './sync.js';
import { customAlert, customChoice, showInfoToast } from './ui.js';
import { S } from './state.js';

let deps = { isDeviceMode: () => false, appVersion: '', onRestored: () => {} };
export function initBackupUI(d = {}) { deps = { ...deps, ...d }; }

async function localBoards() {
    const out = [];
    for (const key of await localforage.keys()) {
        if (key.startsWith('miravoz_')) continue;
        const b = await localforage.getItem(key);
        if (!b || !b.name || b.type === 'test' || b.assignmentId) continue;
        if (!isVisibleTo(b, S.currentUser?.id)) continue;
        out.push(b);
    }
    return out;
}

function wordScopes() {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('miravoz_pred_words:')) out.push(k.slice('miravoz_pred_words:'.length)); } } catch {}
    return out;
}

export async function downloadBackup() {
    const device = deps.isDeviceMode();
    const scope = personScope();
    const all = await allFavorites();
    const favorites = all[scope] && all[scope].length ? { [scope]: all[scope] } : {};
    const learned = wordScopes().includes(scope) ? learnedWordsFor(scope) : {};
    const words = Object.keys(learned).length ? { [scope]: learned } : {};
    const boards = device ? [] : await localBoards();
    const data = buildBackup({ boards, favorites, words, app: deps.appVersion, mode: device ? 'tablet' : 'cuenta' });
    const nFav = Object.values(favorites).reduce((a, l) => a + l.length, 0);
    if (!data.boards.length && !nFav && !Object.keys(words).length) { customAlert('Todavía no hay nada para respaldar en este dispositivo.'); return; }
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const d = new Date();
    const name = `MiraVoz-respaldo-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.miravoz.json`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    showInfoToast(`Respaldo descargado: ${data.boards.length} tablero(s) y ${nFav} frase(s) favorita(s).`, 5000);
}

export async function restoreBackupFile(file) {
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) { customAlert('El archivo es demasiado grande para ser un respaldo de MiraVoz.'); return; }
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) { customAlert(parsed.error); return; }
    const device = deps.isDeviceMode();
    const scope = personScope();
    // Solo lo de la persona actual (un respaldo de la tablet de Juan no se mete en la cuenta ni en otra tablet)
    const favScopes = Object.keys(parsed.favorites).filter(s => s === scope);
    const wordScopesIn = Object.keys(parsed.words).filter(s => s === scope && parsed.words[s] && Object.keys(parsed.words[s]).length);
    const nFav = favScopes.reduce((a, s) => a + (Array.isArray(parsed.favorites[s]) ? parsed.favorites[s].length : 0), 0);
    const nBoards = device ? 0 : parsed.boards.length;
    if (!nBoards && !nFav && !wordScopesIn.length) {
        const other = parsed.mode === 'tablet' ? ' Es el respaldo de una tablet: se restaura en la tablet de esa misma persona.' : '';
        customAlert(device && parsed.boards.length ? 'Este respaldo trae tableros: se restauran desde la cuenta registrada, no desde la tablet.' : 'Este respaldo no trae nada que se pueda restaurar acá.' + other);
        return;
    }
    const when = parsed.createdAt ? new Date(parsed.createdAt).toLocaleDateString('es-AR') : 'fecha desconocida';
    const lines = [`Respaldo del ${when}.`];
    if (nBoards) lines.push(`${nBoards} tablero(s): se agregan como tableros nuevos (no se reemplaza ninguno).`);
    if (nFav) lines.push(`${nFav} frase(s) favorita(s): se suman a las que ya hay.`);
    if (wordScopesIn.length) lines.push('Palabras aprendidas por la predicción: se suman.');
    if (parsed.skipped) lines.push(`${parsed.skipped} tablero(s) del archivo están dañados y no se van a restaurar.`);
    if (!(await customChoice(lines.join('\n\n') + '\n\n¿Restaurar?', 'Restaurar', 'Cancelar'))) return;

    let boardsOk = 0;
    if (nBoards) {
        const names = new Set((await localBoards()).map(b => String(b.name).toLocaleLowerCase('es')));
        const stamp = Date.now();
        for (let i = 0; i < parsed.boards.length; i++) {
            try {
                const b = restoredBundle(parsed.boards[i], names, `bundle_${stamp + i}_${Math.random().toString(36).slice(2, 7)}`);
                await saveBundle(b, { isNew: true });
                boardsOk++;
            } catch (e) { console.error('Restaurar tablero:', e); }
        }
    }
    let favOk = 0;
    for (const s of favScopes) favOk += await mergeFavorites(s, parsed.favorites[s]);
    for (const s of wordScopesIn) setLearnedWordsFor(s, mergeWords(learnedWordsFor(s), parsed.words[s]));

    const failed = nBoards - boardsOk;
    customAlert(`Listo: ${boardsOk} tablero(s) y ${favOk} frase(s) favorita(s) restaurados.` + (failed ? ` ${failed} tablero(s) no se pudieron guardar.` : ''));
    deps.onRestored();
}
