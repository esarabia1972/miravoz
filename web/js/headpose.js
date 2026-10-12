// headpose.js — Matemática pura sobre la salida de FaceLandmarker (testeable con Node)
// Pose de la cabeza (modo Rostro) y blendshapes de los ojos (parpadeo).

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
