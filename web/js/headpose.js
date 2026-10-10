// headpose.js — Matemática pura sobre la salida de FaceLandmarker (testeable con Node)
// Base del modo Iris híbrido (etapa 2): separar el movimiento de la cabeza del de los ojos.

/**
 * Pose de la cabeza desde la "facial transformation matrix" de MediaPipe
 * (4x4, column-major, en cm, cara canónica → cara detectada).
 * Ángulos en grados: yaw (+ = gira a la derecha de la imagen), pitch (+ = mira hacia abajo en imagen),
 * roll (inclinación lateral). Traslación en cm respecto de la cámara (tz negativo = delante).
 */
export function poseFromMatrix(data) {
    if (!data || data.length < 16) return null;
    const r00 = data[0], r10 = data[1], r20 = data[2];
    const r21 = data[6], r22 = data[10];
    const deg = 180 / Math.PI;
    const yaw = Math.asin(Math.max(-1, Math.min(1, -r20))) * deg;
    const pitch = Math.atan2(r21, r22) * deg;
    const roll = Math.atan2(r10, r00) * deg;
    return { yaw, pitch, roll, tx: data[12], ty: data[13], tz: data[14] };
}

/** Blendshapes de FaceLandmarker → objeto { nombre: score } (solo los de mirada y parpadeo). */
const KEEP = /^eye(Look(In|Out|Up|Down)|Blink|Squint|Wide)(Left|Right)$/;
export function pickEyeBlendshapes(categories) {
    const out = {};
    for (const c of categories || []) {
        if (KEEP.test(c.categoryName)) out[c.categoryName] = c.score;
    }
    return out;
}

/**
 * Posición del iris normalizada por la geometría de CADA ojo (no por la cara entera):
 * x ∈ ~[-1, 1] de comisura a comisura, y ∈ ~[-1, 1] de párpado a párpado. Promedio de ambos ojos.
 * Índices del mesh refinado (478 puntos): ojo A 33/133 (comisuras), 159/145 (párpados), iris 468;
 * ojo B 263/362, 386/374, iris 473. (Mismos índices en FaceMesh legado y FaceLandmarker.)
 */
export function irisInEye(lm) {
    const eye = (outer, inner, top, bottom, iris) => {
        const cx = (lm[outer].x + lm[inner].x) / 2, cy = (lm[top].y + lm[bottom].y) / 2;
        const w = Math.hypot(lm[inner].x - lm[outer].x, lm[inner].y - lm[outer].y);
        const h = Math.abs(lm[bottom].y - lm[top].y);
        if (w < 1e-6) return null;
        return { x: (lm[iris].x - cx) / (w / 2), y: h > 1e-6 ? (lm[iris].y - cy) / (h / 2) : 0, open: h / w };
    };
    const a = eye(33, 133, 159, 145, 468);
    const b = eye(263, 362, 386, 374, 473);
    if (!a || !b) return null;
    // En coordenadas de imagen ambos iris se desplazan en el mismo sentido: se promedian directo
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, open: (a.open + b.open) / 2 };
}
