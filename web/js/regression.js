// regression.js — Núcleo matemático de la calibración (SPEC F1-3, F1-4, F1-5)
// Módulo PURO (sin DOM, sin dependencias externas): testeable con Node.
// Reemplaza a math.js: la resolución del sistema ridge se hace con eliminación
// gaussiana propia (matrices 6x6, trivial numéricamente).

// F1-3: expansión polinómica de 2º grado. Compartida por calibración y predicción.
export function phi(fx, fy) {
    return [1, fx, fy, fx * fx, fy * fy, fx * fy];
}

export const NUM_FEATURES = 6;

// Producto punto genérico
export function dot(w, f) {
    let s = 0;
    for (let i = 0; i < w.length; i++) s += w[i] * f[i];
    return s;
}

// Resuelve A·x = b por eliminación gaussiana con pivoteo parcial.
function solve(A, b) {
    const n = A.length;
    // matriz aumentada (copia)
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
        // pivoteo parcial
        let pivot = col;
        for (let r = col + 1; r < n; r++) {
            if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
        }
        if (Math.abs(M[pivot][col]) < 1e-12) throw new Error('Matriz singular en solve()');
        if (pivot !== col) [M[col], M[pivot]] = [M[pivot], M[col]];
        // eliminación
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const factor = M[r][col] / M[col][col];
            for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
        }
    }
    return M.map((row, i) => row[n] / M[i][i]);
}

// Entrena ridge: X = matriz de features (N x F), y = vector objetivo (N)
// Devuelve el vector de pesos (F).  W = (XᵀX + λI)⁻¹ Xᵀy
export function ridgeTrain(X, y, lambda) {
    const F = X[0].length;
    // XᵀX + λI
    const A = Array.from({ length: F }, () => new Array(F).fill(0));
    for (const row of X) {
        for (let i = 0; i < F; i++) {
            for (let j = i; j < F; j++) A[i][j] += row[i] * row[j];
        }
    }
    for (let i = 0; i < F; i++) {
        for (let j = 0; j < i; j++) A[i][j] = A[j][i]; // simétrica
        A[i][i] += lambda;
    }
    // Xᵀy
    const b = new Array(F).fill(0);
    for (let n = 0; n < X.length; n++) {
        for (let i = 0; i < F; i++) b[i] += X[n][i] * y[n];
    }
    return solve(A, b);
}

// F1-4: descarta outliers de un conjunto de muestras crudas [{fx, fy}] de UN punto:
// elimina las que estén a más de `sigmas` desviaciones estándar de la media en fx o fy.
export function trimOutliers(samples, sigmas = 2) {
    if (samples.length < 3) return samples;
    const stats = (vals) => {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
        return { mean, sd };
    };
    const sx = stats(samples.map(s => s.fx));
    const sy = stats(samples.map(s => s.fy));
    return samples.filter(s =>
        (sx.sd === 0 || Math.abs(s.fx - sx.mean) <= sigmas * sx.sd) &&
        (sy.sd === 0 || Math.abs(s.fy - sy.mean) <= sigmas * sy.sd)
    );
}

// Entrena el modelo completo a partir de muestras agrupadas por punto de calibración.
// pointSamples: array de { target: [tx, ty], samples: [{fx, fy}] }
// Devuelve { weightsX, weightsY, pointErrors, meanError }
// pointErrors[i] = error medio en px del punto i evaluado con el modelo entrenado.
export function trainModel(pointSamples, lambda) {
    const X = [], yx = [], yy = [];
    for (const p of pointSamples) {
        for (const s of p.samples) {
            X.push(phi(s.fx, s.fy));
            yx.push(p.target[0]);
            yy.push(p.target[1]);
        }
    }
    if (X.length < NUM_FEATURES) throw new Error('Muestras insuficientes para entrenar');
    const weightsX = ridgeTrain(X, yx, lambda);
    const weightsY = ridgeTrain(X, yy, lambda);

    const pointErrors = pointSamples.map(p => {
        if (p.samples.length === 0) return Infinity;
        let sum = 0;
        for (const s of p.samples) {
            const f = phi(s.fx, s.fy);
            const px = dot(weightsX, f);
            const py = dot(weightsY, f);
            sum += Math.hypot(px - p.target[0], py - p.target[1]);
        }
        return sum / p.samples.length;
    });
    const meanError = pointErrors.reduce((a, b) => a + b, 0) / pointErrors.length;
    return { weightsX, weightsY, pointErrors, meanError };
}

// F1-5: clasifica la calidad de la calibración según el error medio relativo a la diagonal.
export function qualityLabel(meanError, viewportDiag, goodFrac = 0.04, regularFrac = 0.08) {
    const frac = meanError / viewportDiag;
    if (frac < goodFrac) return 'buena';
    if (frac < regularFrac) return 'regular';
    return 'mala';
}
