// grid-layout.js — Ocupación de la grilla con celdas de varias filas/columnas (0.8.1) · PURO (testeable en Node)
// Una celda (gridElement) ocupa desde (x, y) un rectángulo de width × height. Ninguna puede tapar a otra.

const W = (el) => Math.max(1, el.width || 1);
const H = (el) => Math.max(1, el.height || 1);

/** ¿Se superponen dos rectángulos? */
export function overlaps(a, b) {
    return a.x < b.x + W(b) && b.x < a.x + W(a) && a.y < b.y + H(b) && b.y < a.y + H(a);
}

/** Celdas que taparía `rect` ({x, y, width, height}), sin contar `except`. */
export function covered(grid, rect, except = null) {
    return (grid.gridElements || []).filter(e => e !== except && overlaps(rect, e));
}

/** ¿Entra `rect` dentro de la grilla? */
export function insideGrid(grid, rect) {
    const rows = grid.rowCount || 3, cols = grid.minColumnCount || 4;
    return rect.x >= 0 && rect.y >= 0 && rect.x + W(rect) <= cols && rect.y + H(rect) <= rows;
}

/** Máximo ancho/alto posible desde (x, y) dentro de la grilla. */
export function maxSpan(grid, x, y) {
    return { w: Math.max(1, (grid.minColumnCount || 4) - x), h: Math.max(1, (grid.rowCount || 3) - y) };
}

/** Primer lugar libre (recorriendo filas) donde entra un rectángulo de w × h; null si no hay. */
export function firstFree(grid, w = 1, h = 1, except = null) {
    const rows = grid.rowCount || 3, cols = grid.minColumnCount || 4;
    for (let y = 0; y + h <= rows; y++) {
        for (let x = 0; x + w <= cols; x++) {
            const r = { x, y, width: w, height: h };
            if (!covered(grid, r, except).length) return { x, y };
        }
    }
    return null;
}

/** Celda que ocupa la posición (x, y) (aunque empiece antes, por su tamaño). */
export function elementAt(grid, x, y) {
    return (grid.gridElements || []).find(e => overlaps({ x, y, width: 1, height: 1 }, e)) || null;
}

// ---------------------------------------------------------------- 0.8.1g: mover grupos, filas y columnas intermedias

/** ¿Se puede mover el grupo `group` (dx, dy) sin salirse ni tapar otras celdas? */
export function canMoveGroup(grid, group, dx, dy) {
    const others = (grid.gridElements || []).filter(e => !group.includes(e));
    return group.every(e => {
        const r = { x: e.x + dx, y: e.y + dy, width: W(e), height: H(e) };
        return insideGrid(grid, r) && !others.some(o => overlaps(r, o));
    });
}

/** ¿La fila y no tiene ninguna celda (ni parte de una grande)? */
export function rowIsEmpty(grid, y) {
    return !(grid.gridElements || []).some(e => e.y <= y && y < e.y + H(e) && e.x < (grid.minColumnCount || 4));
}
export function colIsEmpty(grid, x) {
    return !(grid.gridElements || []).some(e => e.x <= x && x < e.x + W(e) && e.y < (grid.rowCount || 3));
}

/** Inserta una fila vacía en la posición `at` (0 = arriba de todo). Las celdas grandes que la cruzan se estiran. */
export function insertRow(grid, at) {
    for (const e of grid.gridElements || []) {
        if (e.y >= at) e.y += 1;
        else if (e.y + H(e) > at) e.height = H(e) + 1;
    }
    grid.rowCount = (grid.rowCount || 3) + 1;
}
export function insertCol(grid, at) {
    for (const e of grid.gridElements || []) {
        if (e.x >= at) e.x += 1;
        else if (e.x + W(e) > at) e.width = W(e) + 1;
    }
    grid.minColumnCount = (grid.minColumnCount || 4) + 1;
}

/** Elimina la fila `at` solo si está vacía (no borra contenido). Devuelve true si la eliminó. */
export function deleteRow(grid, at) {
    if ((grid.rowCount || 3) <= 1 || !rowIsEmpty(grid, at)) return false;
    for (const e of grid.gridElements || []) if (e.y > at) e.y -= 1;
    grid.rowCount = (grid.rowCount || 3) - 1;
    return true;
}
export function deleteCol(grid, at) {
    if ((grid.minColumnCount || 4) <= 1 || !colIsEmpty(grid, at)) return false;
    for (const e of grid.gridElements || []) if (e.x > at) e.x -= 1;
    grid.minColumnCount = (grid.minColumnCount || 4) - 1;
    return true;
}

/** Celdas que tocan el rectángulo entre (x1, y1) y (x2, y2) (selección con recuadro). */
export function elementsInRect(grid, x1, y1, x2, y2) {
    const r = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1) + 1, height: Math.abs(y2 - y1) + 1 };
    return (grid.gridElements || []).filter(e => overlaps(r, e));
}
