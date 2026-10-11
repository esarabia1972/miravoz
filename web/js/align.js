// align.js — Alineación de la cara "tipo antena Starlink" (1.5.0) · Módulo PURO (sin DOM), testeable con Node.
//
// Problema (validación en iPad, 11/10/2026): la calibración se guarda bien, pero si la persona se corre, se acerca
// o la tablet se mueve o se inclina, la relación cabeza↔pantalla ya no es la de la calibración y el cursor queda
// corrido. No hace falta recalibrar: alcanza con volver a la MISMA posición y "recentrar".
//
// Referencia (se guarda al aceptar una calibración de Rostro):
//   - posición de la cabeza respecto de la cámara: tx, ty, tz (matriz de FaceLandmarker; ~cm; tz < 0)
//   - features del punto CENTRAL de la calibración (giro/10, cabeceo/10): hacia dónde apunta la cabeza al mirar el centro
// Alinear:
//   1. Guía visual: un punto (la cara) que hay que llevar al centro de un aro, con el tamaño justo (distancia).
//   2. Recentrar: mirando el punto del centro 1,5 s, la diferencia con la referencia se resta a las features
//      (corrige una tablet inclinada o una cabeza algo corrida sin recalibrar).

export const ALIGN = {
    posTolCm: 2.5,        // corrimiento lateral/vertical aceptado
    distTol: 0.12,        // ±12% de la distancia de la calibración
    holdMs: 800,          // alineado sostenido antes de pasar a recentrar
    recenterMs: 1500,     // mirando el centro
    maxOffset: 1.2,       // offset máximo en features (= 12°): más que eso, conviene recalibrar
    driftFactor: 1.6,     // en uso: aviso si se corre más que tolerancia × factor…
    driftMs: 3000         // …durante este tiempo
};

const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

/** Referencia a partir de las poses de toda la calibración y las features del punto central. */
export function buildReference(poses, centerFeatures) {
    const p = (poses || []).filter(q => q && Number.isFinite(q.tz) && q.tz < 0);
    const c = (centerFeatures || []).filter(f => Array.isArray(f) && f.length >= 2);
    if (p.length < 20 || c.length < 5) return null;
    return {
        tx: +med(p.map(q => q.tx)).toFixed(2), ty: +med(p.map(q => q.ty)).toFixed(2), tz: +med(p.map(q => q.tz)).toFixed(2),
        cfx: +med(c.map(f => f[0])).toFixed(4), cfy: +med(c.map(f => f[1])).toFixed(4), v: 1
    };
}

/**
 * Estado de alineación. Convención de pantalla (lo que ve la persona, como en un espejo):
 * dx > 0 = la cabeza está corrida hacia SU derecha; dy > 0 = está más arriba; ratio > 1 = está más lejos.
 * (FaceLandmarker: +x de la cámara = izquierda de la persona; +y hacia arriba.)
 */
export function alignmentState(pose, ref) {
    if (!pose || !ref) return null;
    const dx = -(pose.tx - ref.tx), dy = pose.ty - ref.ty;
    const ratio = pose.tz / ref.tz; // ambos negativos: >1 más lejos
    const posOk = Math.abs(dx) <= ALIGN.posTolCm && Math.abs(dy) <= ALIGN.posTolCm;
    const distOk = Math.abs(ratio - 1) <= ALIGN.distTol;
    return { dx, dy, ratio, posOk, distOk, ok: posOk && distOk, instruction: instructionFor({ dx, dy, ratio, posOk, distOk }) };
}

export function instructionFor({ dx, dy, ratio, posOk, distOk }) {
    if (!distOk) return ratio > 1 ? 'Acercate un poco a la tablet' : 'Alejate un poco de la tablet';
    if (!posOk) {
        if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'Corré la cabeza un poco a tu izquierda' : 'Corré la cabeza un poco a tu derecha';
        return dy > 0 ? 'Bajá un poco la cabeza (o subí la tablet)' : 'Subí un poco la cabeza (o bajá la tablet)';
    }
    return 'Muy bien: quedate así';
}

/** Offset de recentrado (features) con lo medido mirando el centro; null si es demasiado grande (recalibrar). */
export function recenterOffset(centerSamples, ref) {
    const c = (centerSamples || []).filter(f => Array.isArray(f) && f.length >= 2);
    if (!ref || c.length < 8) return null;
    const ox = med(c.map(f => f[0])) - ref.cfx, oy = med(c.map(f => f[1])) - ref.cfy;
    if (!Number.isFinite(ox) || !Number.isFinite(oy) || Math.hypot(ox, oy) > ALIGN.maxOffset) return null;
    return [+ox.toFixed(4), +oy.toFixed(4)];
}

/** Seguimiento en uso: avisa (sin pausar) si la cabeza se corrió de la posición alineada durante un rato. */
export class DriftWatch {
    constructor() { this.since = null; this.flag = false; }
    push(pose, ref, t) {
        const s = alignmentState(pose, ref);
        if (!s) { this.since = null; return this.flag = false; }
        const far = Math.abs(s.dx) > ALIGN.posTolCm * ALIGN.driftFactor || Math.abs(s.dy) > ALIGN.posTolCm * ALIGN.driftFactor
            || Math.abs(s.ratio - 1) > ALIGN.distTol * ALIGN.driftFactor;
        if (!far) { this.since = null; return this.flag = false; }
        if (this.since === null) this.since = t;
        return this.flag = t - this.since >= ALIGN.driftMs;
    }
    reset() { this.since = null; this.flag = false; }
}
