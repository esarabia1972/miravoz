# Fase 1 — Walkthrough y checklist de pruebas

**Implementada por Claude · commit `5b0f0ef` · 04/07/2026**

## Qué cambió

- **Refactor completo (F1-1):** `app-v4.js` ya no existe. El código vive en 14 módulos ES en `web/js/` (sin frameworks, sin build step). `index.html` carga `js/main.js` como módulo. `math.js` eliminado de las dependencias CDN.
- **1 Euro Filter (F1-2):** el cursor debería sentirse notablemente más estable en reposo sin volverse "pesado" al moverse.
- **Regresión polinómica sin escalado fijo (F1-3):** ataca directamente el "no puedo bajar". Los perfiles de calibración viejos se descartan (clave nueva `_v2`): **hay que calibrar una vez de nuevo**, es esperado.
- **Calibración robusta (F1-4/5):** descarta muestras malas; si un punto salió mal lo **repite solo** (vas a ver que a veces vuelve a un punto — es a propósito); al terminar muestra un toast con el **score: buena/regular/mala (±px)**.
- **Benchmark (F1-7):** con `?benchmark=1` en la URL aparece el botón "📊 Benchmark".

## Antes de probar

1. Redeploy a Vercel (cambió `index.html` y todo el JS).
2. Hard-refresh / incógnito.
3. Consola del navegador abierta (F12) la primera vez: si algo falla al cargar módulos, el error aparece ahí. Reportar cualquier línea roja.

## Checklist

### 1. Humo (nada debería haber cambiado)
- [ ] Importar `nuclear.grd` → colores, navegación, spans, acumulador, play — todo igual que antes
- [ ] Importar `.obz` → imágenes embebidas OK
- [ ] Modo Manual: frase de 3 pictogramas
- [ ] Alternar Manual↔Rostro 3 veces → tracking vivo
- [ ] Recargar → tableros y ajuste de fijación persisten (el dwell ahora migra a un storage nuevo: la primera carga toma el valor viejo automáticamente)
- [ ] Tablero de Prueba → ya NO aparece la alerta de "reimportalo"

### 2. Calibración nueva (el corazón de la fase)
- [ ] Calibrar en modo Rostro → al terminar aparece el toast "Calibración: buena/regular/mala (±Npx)". **Anotar el valor.**
- [ ] 🔬 **Borde inferior:** ¿ahora llegás a la última fila? (era el objetivo #1)
- [ ] 🔬 **Esquinas:** ¿llegan las 4?
- [ ] El cursor en reposo tiembla visiblemente menos que antes
- [ ] Calibrar "mal" a propósito (mirar para otro lado en un punto) → el sistema debería repetir ese punto solo y/o reportar score "regular/mala"
- [ ] Leticia con anteojos → anotar el score que da (ahora tenemos número, no solo "anda/no anda")

### 3. Benchmark (criterio de cierre de la fase)
- [ ] Abrir con `?benchmark=1`, calibrar en Rostro, tocar "📊 Benchmark"
- [ ] Seleccionar el número resaltado en amarillo, 20 veces en 3×3 y 20 en 4×4
- [ ] Anotar resultados: **objetivo ≥95% en 3×3 y ≥85% en 4×4**
- [ ] Repetir en modo Manual (baseline de control)
- [ ] Los resultados quedan guardados (consola: `localforage.getItem('miravoz_benchmarks')`)

### 4. Registro

| Dato | Valor |
|---|---|
| Score de calibración (Esteban) | |
| Score de calibración (Leticia con anteojos) | |
| Benchmark 3×3 Rostro (% y seg/selección) | |
| Benchmark 4×4 Rostro | |
| ¿Borde inferior resuelto? | |
| Errores en consola (si hubo) | |

## Si algo se rompió

`git log` tiene el checkpoint previo (`f0e16a4` + el estado pre-refactor está en el commit inicial). Rollback: `git checkout f0e16a4 -- web/` — pero antes avisame, prefiero arreglar el bug que revertir la fase.

## Nota de tuning

Si el cursor se siente "lagueado" al moverse rápido, o todavía tiembla: los parámetros del filtro están en `js/config.js` (`ONE_EURO_MIN_CUTOFF` — bajarlo = más suave y más lag; `ONE_EURO_BETA` — subirlo = más reactivo al movimiento rápido). Es esperable una pasada de ajuste fino con datos reales.
