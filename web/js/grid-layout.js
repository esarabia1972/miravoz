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
