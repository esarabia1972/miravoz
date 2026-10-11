# MiraVoz — Informe de implementación M01–M08

**Fecha:** 11/10/2026 · **Especificación:** `especificacion-tecnica-miravoz-para-claude.md` (carpeta del proyecto MiraVoz)
**Versión publicada al cerrar:** ver `web/version.json` (hash del contenido de `web/`, no un commit).

Este informe distingue lo **implementado y probado** (con pruebas automáticas reproducibles) de lo que queda
**pendiente de dispositivo real** (iPad Air) o de **participantes**. Ninguna prueba simulada demuestra precisión
ocular real. Declarar listo el código no equivale a declarar validado el acceso ocular.

## 1. Estado por requisito

| Req. | Estado | Evidencia | Pendiente |
|---|---|---|---|
| **M01** Datos inválidos o viejos | **Implementado y probado** | `web/js/selection.js` (`buildSample`, `PointerController`), `dwell.js` (`invalidate`, hueco > límite = interrupción), `tracking.js` (muestra por cuadro con sesión/secuencia/captura; inválida en el acto). `tools/test-selection.mjs` (16): T01–T07 con dwell, filtro y controlador reales y reloj controlado; prueba de mutación verificó que los tests detectan la regresión. | Medir `MAX_SAMPLE_AGE_MS` (250 ms) en el iPad. |
| **M02** Perfiles por persona/cámara/geometría | **Implementado y probado** | `web/js/profiles.js` (ámbito `user:<id>` / `prueba`, `checkCompatibility`, `GEOMETRY_RULE`, `ProfileStore` con escritura segura), `calibration.js` (un perfil por modo **y orientación**), `main.js` (`beginCameraAccess`: verificación rápida al habilitar la cámara; rotación/cambio grande suspende). `tools/test-profiles.mjs` T08–T10. | Confirmar en Safari que las barras no disparan recalibraciones (regla: ancho > 12% o alto > 15%). |
| **M03** Contexto único de selección | **Implementado y probado** | `web/js/contexts.js` (pila; base guardada mientras hay diálogo; restauración desde el estado actual; `inert`), `ui.js`/`media.js`/`benchmark.js` (diálogos con objetivos de mirada y barrido), paneles del acompañante pausan. `tools/test-contexts.mjs` (7) T11–T12 + 3 verificaciones en `test-boot.mjs`. | Probar con VoiceOver y con un pulsador real. |
| **M04** Calibración y validación separadas | **Implementado y probado** | `web/js/validation.js` (5 objetivos nuevos, cobertura, mediana, p90, temblor; reglas versionadas `v1-provisional-2026-10-11`; `summarizePhase` del benchmark), `calibration.js` (CAPTURA → ENTRENAMIENTO → VERIFICACIÓN; una muestra por cuadro nuevo; descarte de cuadros atrasados; una verificación fallida no activa ni se guarda), `benchmark.js` (omisiones, descanso, mediana/p90). `tools/test-profiles.mjs` T13–T15, `test-calibration.mjs` (16). | **Ajustar los umbrales con mediciones reales**: hoy son provisorios. |
| **M05** Arranque sin conexión | **Implementado y probado (lógica)** | `web/sw.js` (conjunto completo verificado por sha256, todo o nada, reutiliza lo que no cambió, actualización solo al arrancar o con "Actualizar ahora"), `offline.js` (estado honesto), `web/vendor/*` (bibliotecas y MediaPipe alojados con licencia), `vercel.json` (encabezados por tipo; `buildCommand` verifica el manifiesto). `tools/test-offline.mjs` (10) T18–T19 sobre el Service Worker real en un navegador simulado. | **Arranque en frío sin red en el iPad** (pestaña y pantalla de inicio), cuotas/desalojo de WebKit, voz sin conexión, y el sha256 del modelo (no se pudo descargar desde el entorno de desarrollo). |
| **M06** Inferencia separada y medida | **Implementado, pendiente de dispositivo** | `web/js/vision-worker.js` (FaceLandmarker en Worker, `?vision=worker`), `vision-scheduler.js` (1 en vuelo + 1 pendiente, descarte por sesión/secuencia, caída por timeout → invalidación y vuelta al hilo principal), métricas `tracking.visionStats()` (inferencia y captura→resultado p50/p95, resultados/s, descartados). `tools/test-vision.mjs` (5). | Que el Worker funcione en Safari/iPad (GPU, `OffscreenCanvas`); comparar con el hilo principal en una sesión de 20 min. El predeterminado sigue siendo el hilo principal hasta medirlo. |
| **M07** Aprendizaje implícito | **Implementado y probado** | Apagado por defecto (`isImplicitEnabled`, solo `?implicit=1`). Modelo base inmutable, candidato aceptado solo si no empeora sobre la **evidencia reservada** (muestras de la verificación), procedencia por muestra, historial y `rollbackModel`; exclusión de benchmark, verificación, diálogos, edición, calibración y señal inválida; nada se escribe si cambió la persona o la revisión. `test-selection.mjs` T16, `test-calibration.mjs` T17. | Evaluar si aporta con datos reales antes de habilitarlo para nadie. |
| **M08** Modos, voz, diagnóstico, trazabilidad | **Implementado; voz pendiente de dispositivo** | Iris sigue experimental (`?iris=1`) con explicación Rostro/Iris y ayuda de colocación sin pedir mover la cabeza; error de voz conserva la frase y avisa; panel de diagnóstico solo con `?diag=1` (versión, modo, motor, latencias, antigüedad de muestra, motivo de pausa, verificación del perfil); reporte de **rendimiento** con solo métricas agregadas; identificador de entrega = hash del contenido (`web/version.json`), visible en Configuración. | Voz real por mirada después del gesto inicial (también sin conexión). |

### Escenarios de prueba (sección 6)

| ID | Dónde | Resultado |
|---|---|---|
| T01–T07 | `test-selection.mjs`, `test-vision.mjs` | Pasan |
| T08–T10 | `test-profiles.mjs` | Pasan |
| T11–T12 | `test-contexts.mjs`, `test-boot.mjs` | Pasan |
| T13–T15 | `test-profiles.mjs` | Pasan |
| T16–T17 | `test-selection.mjs`, `test-calibration.mjs` | Pasan |
| T18–T19 | `test-offline.mjs` (lógica del Service Worker) | Pasan · pendiente iPad |
| T20 | `test-device.mjs` y `test-sync.mjs` (copias editables vs solo lectura, cambios pendientes, concurrencia) | Pasan (cobertura previa) |
| T21 | — | **Pendiente de dispositivo** (voz real) |
| T22 | `test-boot.mjs`, `test-pages.mjs`, `test-asterics.mjs`, `test-device.mjs`, `test-sync.mjs` | Pasan |

## 2. Cómo correr las pruebas

```bash
npm install          # una vez (jsdom, solo para desarrollo)
npm test             # todos los grupos (13)
node tools/build-offline-manifest.mjs   # después de tocar cualquier archivo de web/
```

`npm test` falla si `web/offline-manifest.json` o `web/version.json` quedaron desactualizados. Vercel corre el mismo control (`buildCommand`) y **no publica** si falta regenerarlo.

## 3. Migración de perfiles y recuperación

- **v2 → v3:** el perfil viejo (`miravoz_calibration_v2`) se conserva en `miravoz_calibration_v3.legacy` y en su clave original; **no se aplica** (pide calibrar). No se borra vocabulario ni tableros.
- **Escritura fallida:** lo persistido no se toca; el perfil nuevo vale para la sesión y se avisa.
- **Lectura fallida:** antes de escribir se vuelve a leer (no se pisan perfiles de otras personas).
- **Desvincular una tablet:** se borran solo los perfiles de ese usuario.
- **Verificación rápida fallida:** queda registrada en `lastQuickCheck`; no pisa la verificación con la que se aceptó el perfil.

## 4. Actualizaciones y uso sin conexión

- Cada publicación genera una versión (hash del contenido). El Service Worker de esa versión descarga y verifica el conjunto completo; si algo falla, sigue la anterior.
- **Nunca se recarga solo en pleno uso.** Una versión descargada se aplica al próximo arranque o con **Configuración → Actualizar ahora** (solo sin frase en curso).
- **Preparar sin conexión:** Configuración → "Preparar para usar sin conexión" (descarga los pictogramas de los tableros del dispositivo y pide almacenamiento persistente). El estado dice "Preparado" solo si está todo.
- Requieren conexión: primera vinculación o ingreso, radios, sitios web, búsqueda de pictogramas nuevos y el motor legado (FaceMesh).

## 5. Diagnóstico

- `?diag=1`: panel técnico y botones "Diagnóstico" (cuadros numéricos, **solo con la cara de quien desarrolla**) y "Rendimiento" (solo métricas agregadas).
- `?vision=worker`: motor en Worker (en evaluación). `?benchmark=1`: benchmark con descanso y omisiones.

## 6. Publicación

Push a `main` → Vercel corre `node tools/build-offline-manifest.mjs --check` y publica `web/`. Verificar después:
`/version.json` (versión esperada), `/offline-manifest.json` y, en el iPad, Configuración → Uso sin conexión.

## 7. Dependencias y licencias

| Recurso | Versión | Licencia | Ubicación |
|---|---|---|---|
| localforage | 1.10.0 | Apache-2.0 | `web/vendor/localforage-1.10.0` |
| JSZip | 3.10.1 | MIT/GPLv3 (dual) | `web/vendor/jszip-3.10.1` |
| supabase-js | 2.117.3 | MIT | `web/vendor/supabase-js-2.117.3` (con SRI) |
| Inter | 5.3.0 (fontsource) | OFL-1.1 | `web/vendor/inter-5.3.0` |
| MediaPipe Tasks Vision | 1.1.0 | Apache-2.0 | `web/vendor/mediapipe-tasks-vision-1.1.0` |
| Modelo FaceLandmarker | float16/1 | Apache-2.0 | URL oficial de Google, guardado por el Service Worker |
| WebEyeTrack/BlazeGaze | — | Código MIT; pesos entrenados con GazeCapture (uso de investigación) | **No incorporado**: candidato futuro sujeto a revisión de licencias |

## 8. Lo que este trabajo NO afirma

- Precisión del modo Iris o Rostro en el iPad ni con las personas destinatarias.
- Que el Worker mejore la latencia en Safari.
- Que la voz funcione sin conexión en un iPad concreto.
- Aislamiento entre cuentas en la base desplegada (requiere la prueba con dos cuentas reales de prueba).

El protocolo para medir todo esto está en `PROTOCOLO_VALIDACION_IPAD.md`.
