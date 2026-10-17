// grid-edit.js — Manipulación de la grilla en modo edición (0.8.1g)
//
// Reemplaza el arrastre HTML5 (que en el iPad casi no anda y solo mostraba la imagen tocada) por eventos de
// puntero, igual en mouse, lápiz y dedo:
//   - Arrastrar una celda muestra la celda entera siguiendo al puntero y dónde va a caer (verde o rojo).
//     Con el dedo: mantener apretado un instante para levantarla (si se desliza enseguida, la grilla se desplaza).
//     Mantener apretado y soltar sin mover abre el menú de la celda (como el botón derecho).
//   - Selección múltiple: Shift/Cmd/Ctrl + clic, el botón "Seleccionar" (para el dedo) o un recuadro
//     arrastrando desde un lugar vacío. Arrastrar una seleccionada mueve todo el grupo.
//   - Estirar desde el borde derecho (ancho), el de abajo (alto) o la esquina (los dos).
//   - Encabezados de filas y columnas: insertar antes/después o eliminar (solo si está vacía).
// Los cambios los hace editor.js a través de editHooks (con deshacer).

import { canMoveGroup, elementsInRect } from './grid-layout.js';

export const editHooks = {
    openEditor: () => {},          // (el)
    openEmpty: () => {},           // (x, y)
    openMenu: () => {},            // (px, py, el|null, x, y)
    moveGroup: async () => {},     // (group, dx, dy, targetEl|null, tx, ty)
    resize: async () => {},        // (el, w, h)
    rowColMenu: () => {},          // (kind 'row'|'col', index, px, py)
    selectionChanged: () => {}     // (size)
};

export const selection = new Set();
let selectMode = false;
let ctx = null; // { container, gridData, cols, rows }

export function isSelectMode() { return selectMode; }
export function setSelectMode(on) {
    selectMode = !!on;
    document.body.classList.toggle('grid-select-mode', selectMode);
    if (!selectMode && selection.size === 0) editHooks.selectionChanged(0);
}
export function clearSelection() {
    if (!selection.size) return;
    selection.clear();
    paintSelection();
    editHooks.selectionChanged(0);
}
export function selectAll() {
    if (!ctx) return;
    (ctx.gridData.gridElements || []).forEach(e => { if (e.x < ctx.cols && e.y < ctx.rows) selection.add(e); });
    paintSelection();
    editHooks.selectionChanged(selection.size);
}
function toggle(el) {
    if (selection.has(el)) selection.delete(el); else selection.add(el);
    paintSelection();
    editHooks.selectionChanged(selection.size);
}
function paintSelection() {
    if (!ctx) return;
    ctx.container.querySelectorAll('.cell.edit-cell').forEach(c => c.classList.toggle('is-selected', selection.has(c._el)));
}

// --- Geometría: de coordenadas de pantalla a fila/columna ---
const tracks = (s) => String(s || '').split(/\s+/).map(parseFloat).filter(Number.isFinite);
function metrics(container) {
    const cs = getComputedStyle(container);
    const colW = tracks(cs.gridTemplateColumns), rowH = tracks(cs.gridTemplateRows);
    const gapX = parseFloat(cs.columnGap) || 0, gapY = parseFloat(cs.rowGap) || 0;
    const padL = parseFloat(cs.paddingLeft) || 0, padT = parseFloat(cs.paddingTop) || 0;
    const starts = (sizes, gap, pad) => { const out = []; let acc = pad; for (const s of sizes) { out.push(acc); acc += s + gap; } return out; };
    const colX = starts(colW, gapX, padL), rowY = starts(rowH, gapY, padT);
    const indexAt = (pos, sizes, gap) => {
        let acc = 0;
        for (let i = 0; i < sizes.length; i++) { acc += sizes[i]; if (pos < acc + gap / 2) return i; acc += gap; }
        return sizes.length - 1;
    };
    return {
        colW, rowH, colX, rowY, gapX, gapY,
        cellAt(clientX, clientY) {
            const r = container.getBoundingClientRect();
            return {
                x: Math.max(0, indexAt(clientX - r.left - padL + container.scrollLeft, colW, gapX)),
                y: Math.max(0, indexAt(clientY - r.top - padT + container.scrollTop, rowH, gapY))
            };
        }
    };
}

// --- Bloqueo del desplazamiento con el dedo mientras se arrastra ---
const stopTouch = (e) => { if (e.cancelable) e.preventDefault(); };
function blockScroll(on) {
    if (on) document.addEventListener('touchmove', stopTouch, { passive: false });
    else document.removeEventListener('touchmove', stopTouch);
}

/** Lo llama boards.renderGrid al empezar a dibujar la grilla en modo edición. */
export function beginRender(container, gridData, cols, rows) {
    ctx = { container, gridData, cols, rows };
    // Quitar de la selección lo que ya no está (p. ej. después de deshacer o borrar)
    const live = new Set(gridData.gridElements || []);
    let changed = false;
    for (const e of [...selection]) if (!live.has(e)) { selection.delete(e); changed = true; }
    if (changed) editHooks.selectionChanged(selection.size);
    container.classList.add('edit-grid');
    container.ondragstart = (e) => e.preventDefault(); // sin arrastre nativo de imágenes
}

/** Celda con contenido en modo edición. */
export function attachCell(cell, el) {
    cell._el = el;
    cell.classList.add('edit-cell');
    cell.classList.toggle('is-selected', selection.has(el));
    cell.querySelectorAll('img').forEach(i => { i.draggable = false; });
    addResizeHandles(cell, el);

    let suppressClick = false;
    cell.onclick = (e) => {
        if (suppressClick) { suppressClick = false; return; }
        if (selectMode || e.shiftKey || e.metaKey || e.ctrlKey) { toggle(el); return; }
        if (selection.size) { clearSelection(); return; }
        editHooks.openEditor(el);
    };

    cell.addEventListener('pointerdown', (e) => {
        if ((e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('.resize-handle')) return;
        const touch = e.pointerType === 'touch';
        const start = { x: e.clientX, y: e.clientY };
        let state = 'pending', drag = null;
        const hold = touch ? setTimeout(() => { state = 'held'; cell.classList.add('is-lifted'); blockScroll(true); try { navigator.vibrate?.(10); } catch { /* */ } }, 300) : null;
        const move = (ev) => {
            const d = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
            if (state === 'pending') {
                if (touch) { if (d > 8) done(); return; } // deja desplazar la grilla
                if (d > 5) { state = 'drag'; drag = startDrag(el, start); }
            } else if (state === 'held' && d > 5) { state = 'drag'; drag = startDrag(el, start); }
            if (state === 'drag' && drag) { if (ev.cancelable) ev.preventDefault(); drag.move(ev.clientX, ev.clientY); }
        };
        const up = (ev) => {
            if (state === 'drag' && drag) { suppressClick = true; drag.end(ev.clientX, ev.clientY); }
            else if (state === 'held') { suppressClick = true; editHooks.openMenu(ev.clientX, ev.clientY, el, el.x, el.y); }
            done();
        };
        const cancel = () => { if (drag) drag.cancel(); done(); };
        function done() {
            clearTimeout(hold);
            cell.classList.remove('is-lifted');
            blockScroll(false);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel);
            if (suppressClick) setTimeout(() => { suppressClick = false; }, 400); // por si el clic no llega
        }
        window.addEventListener('pointermove', move, { passive: false });
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
    });
}

/** Lugar vacío en modo edición: clic = nueva celda; arrastrar = selección con recuadro. */
export function attachSlot(cell, x, y) {
    let suppressClick = false;
    cell.onclick = () => {
        if (suppressClick) { suppressClick = false; return; }
        if (selection.size) { clearSelection(); return; }
        editHooks.openEmpty(x, y);
    };
    cell.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const touch = e.pointerType === 'touch';
        const start = { x: e.clientX, y: e.clientY };
        let state = 'pending', box = null, m = null;
        const hold = touch ? setTimeout(() => { state = 'held'; blockScroll(true); }, 300) : null;
        const move = (ev) => {
            const d = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
            if (state === 'pending') {
                if (touch) { if (d > 8) done(); return; }
                if (d > 5) state = 'box';
            } else if (state === 'held' && d > 5) state = 'box';
            if (state !== 'box') return;
            if (ev.cancelable) ev.preventDefault();
            if (!m) {
                m = metrics(ctx.container);
                box = document.createElement('div');
                box.className = 'grid-marquee';
                ctx.container.appendChild(box);
            }
            const b = m.cellAt(ev.clientX, ev.clientY);
            const x1 = Math.min(x, b.x), y1 = Math.min(y, b.y), x2 = Math.max(x, b.x), y2 = Math.max(y, b.y);
            box.style.gridColumn = `${x1 + 1} / ${x2 + 2}`;
            box.style.gridRow = `${y1 + 1} / ${y2 + 2}`;
            const picked = new Set(elementsInRect(ctx.gridData, x, y, b.x, b.y));
            ctx.container.querySelectorAll('.cell.edit-cell').forEach(c => c.classList.toggle('is-selected', picked.has(c._el) || (ev.shiftKey && selection.has(c._el))));
            box._picked = picked;
        };
        const up = (ev) => {
            if (state === 'box') {
                suppressClick = true;
                if (!ev.shiftKey && !ev.metaKey) selection.clear();
                (box?._picked || []).forEach(e2 => selection.add(e2));
                paintSelection();
                editHooks.selectionChanged(selection.size);
            } else if (state === 'held') {
                suppressClick = true;
                editHooks.openMenu(ev.clientX, ev.clientY, null, x, y);
            }
            done();
        };
        function done() {
            clearTimeout(hold);
            blockScroll(false);
            box?.remove();
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', done);
            if (suppressClick) setTimeout(() => { suppressClick = false; }, 400);
        }
        window.addEventListener('pointermove', move, { passive: false });
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', done);
    });
}

// --- Arrastre con vista previa de la celda (o del grupo seleccionado) ---
function startDrag(el, start) {
    const group = selection.has(el) ? [...selection] : [el];
    if (!selection.has(el) && selection.size) clearSelection();
    const m = metrics(ctx.container);
    const doms = [...ctx.container.querySelectorAll('.cell.edit-cell')].filter(c => group.includes(c._el));
    const ghosts = doms.map(d => {
        const r = d.getBoundingClientRect();
        const g = d.cloneNode(true);
        g.classList.add('drag-ghost');
        g.classList.remove('is-selected', 'is-lifted');
        g.querySelectorAll('.resize-handle').forEach(h => h.remove());
        g.removeAttribute('id');
        Object.assign(g.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0' });
        document.body.appendChild(g);
        d.classList.add('is-drag-source');
        return g;
    });
    const previews = group.map(g => {
        const p = document.createElement('div');
        p.className = 'drop-preview';
        ctx.container.appendChild(p);
        return { p, g };
    });
    document.body.classList.add('grid-dragging');
    let last = { dx: 0, dy: 0, tx: el.x, ty: el.y };
    const place = (dx, dy, ok) => {
        for (const { p, g } of previews) {
            p.style.gridColumn = `${g.x + dx + 1} / span ${g.width || 1}`;
            p.style.gridRow = `${g.y + dy + 1} / span ${g.height || 1}`;
            p.classList.toggle('is-invalid', !ok);
            p.hidden = dx === 0 && dy === 0;
        }
    };
    place(0, 0, true);
    const autoScroll = (cx, cy) => {
        const r = ctx.container.getBoundingClientRect(), edge = 40;
        if (cy > r.bottom - edge) ctx.container.scrollTop += 12; else if (cy < r.top + edge) ctx.container.scrollTop -= 12;
        if (cx > r.right - edge) ctx.container.scrollLeft += 12; else if (cx < r.left + edge) ctx.container.scrollLeft -= 12;
    };
    const cleanup = () => {
        ghosts.forEach(g => g.remove());
        previews.forEach(({ p }) => p.remove());
        doms.forEach(d => d.classList.remove('is-drag-source'));
        document.body.classList.remove('grid-dragging');
    };
    return {
        move(cx, cy) {
            const tx = cx - start.x, ty = cy - start.y;
            ghosts.forEach(g => { g.style.transform = `translate(${tx}px, ${ty}px) scale(1.03)`; });
            const t = m.cellAt(cx, cy);
            const dx = t.x - el.x, dy = t.y - el.y;
            last = { dx, dy, tx: t.x, ty: t.y };
            // Válido si entra; también el intercambio de dos celdas de 1×1
            const target = (ctx.gridData.gridElements || []).find(o => !group.includes(o) && o.x <= t.x && t.x < o.x + (o.width || 1) && o.y <= t.y && t.y < o.y + (o.height || 1));
            const swap = group.length === 1 && target && (el.width || 1) === 1 && (el.height || 1) === 1 && (target.width || 1) === 1 && (target.height || 1) === 1;
            place(dx, dy, swap || canMoveGroup(ctx.gridData, group, dx, dy));
            autoScroll(cx, cy);
        },
        end() {
            cleanup();
            const { dx, dy, tx, ty } = last;
            if (dx === 0 && dy === 0) return;
            const target = (ctx.gridData.gridElements || []).find(o => !group.includes(o) && o.x <= tx && tx < o.x + (o.width || 1) && o.y <= ty && ty < o.y + (o.height || 1)) || null;
            editHooks.moveGroup(group, dx, dy, target, tx, ty);
        },
        cancel: cleanup
    };
}

// --- Estirar desde los bordes ---
function addResizeHandles(cell, el) {
    for (const kind of ['e', 's', 'se']) {
        const h = document.createElement('div');
        h.className = `resize-handle resize-${kind}`;
        h.title = kind === 'e' ? 'Arrastrar para cambiar el ancho' : kind === 's' ? 'Arrastrar para cambiar el alto' : 'Arrastrar para cambiar el tamaño';
        h.setAttribute('aria-hidden', 'true');
        cell.appendChild(h);
        h.addEventListener('click', (e) => e.stopPropagation());
        h.addEventListener('pointerdown', (e) => {
            e.preventDefault(); e.stopPropagation();
            blockScroll(true);
            const m = metrics(ctx.container);
            let w = el.width || 1, hh = el.height || 1;
            const move = (ev) => {
                if (ev.cancelable) ev.preventDefault();
                const t = m.cellAt(ev.clientX, ev.clientY);
                if (kind !== 's') w = Math.max(1, Math.min(ctx.cols - el.x, t.x - el.x + 1));
                if (kind !== 'e') hh = Math.max(1, Math.min(ctx.rows - el.y, t.y - el.y + 1));
                cell.style.gridColumn = `${el.x + 1} / span ${w}`;
                cell.style.gridRow = `${el.y + 1} / span ${hh}`;
                cell.classList.add('is-resizing');
                cell.dataset.size = `${w}×${hh}`;
            };
            const up = () => {
                blockScroll(false);
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', up);
                cell.classList.remove('is-resizing');
                if (w !== (el.width || 1) || hh !== (el.height || 1)) editHooks.resize(el, w, hh);
            };
            window.addEventListener('pointermove', move, { passive: false });
            window.addEventListener('pointerup', up);
            window.addEventListener('pointercancel', up);
        });
    }
}

// --- Encabezados de filas y columnas (insertar / eliminar) ---
let ro = null;
export function endRender() {
    if (!ctx) return;
    const { container } = ctx;
    const draw = () => {
        if (!container.classList.contains('edit-grid')) return;
        container.querySelectorAll('.rc-handle').forEach(n => n.remove());
        const m = metrics(container);
        if (!m.colW.length || !m.rowH.length) return;
        const mk = (kind, i, style, label) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `rc-handle rc-${kind}`;
            b.setAttribute('aria-label', label);
            b.title = label;
            Object.assign(b.style, style);
            b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                const r = b.getBoundingClientRect();
                editHooks.rowColMenu(kind, i, r.left, r.bottom + 4);
            });
            container.appendChild(b);
        };
        m.colW.forEach((w, i) => mk('col', i, { left: `${m.colX[i] + w / 2 - 14}px`, top: '2px' }, `Columna ${i + 1}: insertar o eliminar`));
        m.rowH.forEach((h, i) => mk('row', i, { top: `${m.rowY[i] + h / 2 - 14}px`, left: '2px' }, `Fila ${i + 1}: insertar o eliminar`));
    };
    requestAnimationFrame(draw);
    if (!ro && 'ResizeObserver' in window) {
        let t = null;
        ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(draw, 60); });
        ro.observe(container);
    }
}

/** Al salir de edición. */
export function teardown(container) {
    clearSelection();
    setSelectMode(false);
    if (container) {
        container.classList.remove('edit-grid');
        container.querySelectorAll('.rc-handle, .drop-preview, .grid-marquee').forEach(n => n.remove());
    }
}
