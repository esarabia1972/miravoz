// theme.js — Modo Día / Noche (10/10/2026)
// El tema ya lo aplica un script inline en el <head> antes del primer pintado (sin parpadeo).
// Este módulo solo cablea los botones [data-theme-toggle] y persiste la elección.

const STORAGE_KEY = 'miravoz_theme';
const META_COLORS = { dark: '#0d0f14', light: '#f4f6f9' };

const SUN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const MOON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

export function getTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function save(theme) {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* modo privado / sin storage: solo esta sesión */ }
}

function updateMeta(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', META_COLORS[theme]);
}

function updateButtons(theme) {
    const isLight = theme === 'light';
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
        // En noche se ofrece el sol (pasar a día); en día, la luna (pasar a noche)
        btn.innerHTML = isLight ? MOON : SUN; // SVG fijo, sin texto de usuario
        const label = isLight ? 'Cambiar a modo noche' : 'Cambiar a modo día';
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
        btn.setAttribute('aria-pressed', String(isLight)); // presionado = modo día activo
    });
}

export function setTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    updateMeta(t);
    updateButtons(t);
}

export function initTheme() {
    setTheme(getTheme());
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
        btn.addEventListener('click', () => {
            const next = getTheme() === 'light' ? 'dark' : 'light';
            setTheme(next);
            save(next);
        });
    });
}
