// pager.js — Pasar de página con botones grandes en lugar de deslizar (0.7.8)
// Con la mirada (Seguimiento ocular del iPad, Rostro o Barrido) no se puede "arrastrar" una lista: estos dos
// botones mueven una pantalla para arriba o para abajo; quedan grisados cuando no hay más para ver.

/**
 * @param {HTMLElement} scrollEl  contenedor con scroll
 * @param {HTMLElement} host      dónde se ubican los botones (posición relativa)
 * @param {{ onChange?: () => void }} opts  avisa cuando cambia qué botones se ven (para rearmar objetivos)
 */
export function attachPager(scrollEl, host, { onChange = () => {} } = {}) {
    const box = document.createElement('div');
    box.className = 'pager';
    const mk = (dir, label, path) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pager-btn';
        b.dataset.dir = dir;
        b.dataset.word = label;
        b.setAttribute('aria-label', label);
        b.title = label;
        b.innerHTML = `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="${path}"></polyline></svg>`;
        b.addEventListener('click', () => {
            const step = Math.max(120, scrollEl.clientHeight * 0.85) * (dir === 'up' ? -1 : 1);
            scrollEl.scrollBy({ top: step, behavior: 'smooth' });
        });
        return b;
    };
    const up = mk('up', 'Página anterior', '18 15 12 9 6 15');
    const down = mk('down', 'Página siguiente', '6 9 12 15 18 9');
    box.append(up, down);
    host.appendChild(box);

    let last = '';
    const update = () => {
        const max = scrollEl.scrollHeight - scrollEl.clientHeight;
        const canUp = scrollEl.scrollTop > 4;
        const canDown = scrollEl.scrollTop < max - 4;
        // 0.7.8b: los botones están siempre; sin más para ver quedan grisados (no aparecen y desaparecen)
        for (const [b, can] of [[up, canUp], [down, canDown]]) { b.disabled = !can; b.setAttribute('aria-disabled', String(!can)); }
        host.classList.add('has-pager');
        const key = `${canUp}|${canDown}`;
        if (key !== last) { last = key; onChange(); }
    };
    let raf = 0;
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); };
    scrollEl.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(schedule).observe(scrollEl);
    if (typeof MutationObserver !== 'undefined') new MutationObserver(schedule).observe(scrollEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    update();
    return { buttons: () => [up, down].filter(b => !b.disabled), update };
}
