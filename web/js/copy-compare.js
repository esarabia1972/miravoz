// copy-compare.js — ¿La copia de un usuario es igual al original? (0.8.1d) · PURO (testeable en Node)

// Lo que no es contenido del tablero (metadatos de cuenta, sincronización, copia o marcas de tiempo)
const META = new Set(['id', 'ownerId', 'syncedAt', 'updatedAt', 'assignmentId', 'permission', 'copyUpdatedAt', 'dirty', 'bundleId',
    'profEdit', 'ownerLabel', 'copiadoDe', 'tags', 'name', '__predExtra', 'lastUpdateTime', 'thumbnail']);

/** JSON con claves ordenadas (Postgres reordena las claves de jsonb) y sin metadatos. Pura. */
export function contentKey(bundle) {
    const walk = (v) => {
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === 'object') {
            const out = {};
            for (const k of Object.keys(v).sort()) if (!META.has(k) && v[k] !== undefined && v[k] !== null) out[k] = walk(v[k]);
            return out;
        }
        return v;
    };
    return JSON.stringify(walk(bundle || {}));
}

/**
 * Estado de la copia respecto del original. Pura.
 * @returns {'igual'|'copia'|'original'|'sin-original'}  'copia' = la copia tiene cambios más nuevos;
 *          'original' = el original cambió después de la copia.
 */
export function compareCopy(original, copyBundle, copyUpdatedAt) {
    if (!original) return 'sin-original';
    if (contentKey(original) === contentKey(copyBundle)) return 'igual';
    const copyT = Date.parse(copyUpdatedAt || '') || 0;
    const origT = Number(original.updatedAt) || 0;
    return copyT > origT ? 'copia' : 'original';
}

export const STATUS_TEXT = {
    igual: 'Igual a tu versión',
    copia: 'Su copia tiene cambios',
    original: 'Tu versión tiene cambios',
    'sin-original': 'Tu original ya no está'
};

