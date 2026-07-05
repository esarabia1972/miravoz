# Handoff para Antigravity — Estado del proyecto y trabajo pendiente

**Fecha:** 05/07/2026 · **Autor:** Claude (implementó Fases 1, 2 y 3-v1) · **Última versión:** commit `1d1c27c`, deployada en https://miravoz-ok.vercel.app

## Estado: qué está hecho y funciona

- **Fase 0** (estabilización) — por Antigravity, auditada y aprobada (`REVIEW_FASE0.md`).
- **Fase 1** (motor Rostro): refactor a 14 módulos ES en `web/js/`, 1 Euro Filter, calibración polinómica con score de calidad y reintento del peor punto, benchmark `?benchmark=1`. Validada en uso real.
- **Fase 2** (Barrido): `scanning.js`, patrones fila→elemento y lineal, activación Espacio/Enter/click/tap, audio opcional, settings en ⚙.
- **Fase 3 v1** (Editor): `editor.js` — nuevo tablero, modo edición (lápiz junto al tacho), editor de celda (habla label/custom/silencio vía acciones GRD, color Fitzgerald, nivel de vocabulario, navegación con creación al vuelo), búsqueda ARASAAC con atribución y cache offline del pictograma, export `.grd`. Round-trip export/import verificado dentro de MiraVoz.
- **Fase 3.1** (Pulido del Editor) — COMPLETADO por Antigravity.
  - Implementado Drag & Drop para mover celdas fluidamente.
  - Agregado Duplicate board en el Home.
  - Implementado sistema de "Deshacer" (Toast UI) para acciones destructivas (borrar tablero, borrar/editar celda, mover celda, dimensionar filas/columnas).
  - Estilizada barra de herramientas de edición y diseño de tarjetas del Home mejorado (más altas, botonera vertical).
  - Arreglado problema del acumulador para respetar `speakCustom`.

## Reglas de trabajo (NO romper)

1. **Leer `SPEC_FASES_0-4.md` antes de tocar código.** Sección 0 = convenciones e invariantes (privacidad del video, interoperabilidad copy-on-write, tracking siempre vanilla, terminología usuario/profesional).
2. **El modelo de datos es el formato GRD nativo** (GridData v7). Nunca reconstruir objetos descartando campos desconocidos.
3. **Módulos ES sin build step.** No introducir frameworks ni bundlers sin decisión explícita de Esteban.
4. **Cache-busting:** todo cambio en CSS/JS bumpea el `?v=` en `index.html` (lección aprendida a los golpes).
5. **Git:** commits atómicos con mensaje descriptivo; `git push origin main` = deploy automático a producción (Vercel conectado al repo GitHub `esarabia1972/miravoz`, root directory `web`). El remote ya está configurado con token.
6. **Verificación mínima antes de push:** `node --input-type=module --check < web/js/<archivo>.js` para cada JS tocado. Probar contra `asterics/nuclear.grd` (tiene de todo: 39 tableros, spans, colorCategory, speakCustom, radios con Base64).
7. **Nunca commitear** `web/.vercel/` (tiene un token) ni tocar `.git/config`.

## Trabajo pendiente técnico (Postergado de la Fase 3)

1. **Round-trip con AsTeRICS Grid real:** exportar un tablero editado → importarlo en grid.asterics.eu → verificar colores, navegación, celda silenciosa, speakCustom, pictogramas. Ajustar `exportGrd()` si hace falta.
2. **Export `.obz`** (transformación inversa del import de `boards.js`: manifest.json + un .obf por grid + imágenes; ver SPEC F3-5).

## Después: Fase 4 (usuarios y asignación)

**Todo el diseño está en `SPEC_FASES_0-4.md` sección F4**: esquema SQL completo para Supabase, modelo de asignación-como-copia con permisos, acceso de los chicos por código de dispositivo (sin email), sync last-write-wins. Leerlo entero antes de empezar. Precauciones especiales:

- El bypass actual de auth está encapsulado en `web/js/auth.js` — es el único archivo de auth a tocar.
- **Auditar RLS antes de reactivar nada** (la anon key es pública en el cliente).
- La app debe seguir funcionando 100% local sin cuenta (invariante).
- Hay un token de Vercel en `web/.vercel/token` si hace falta deployar por CLI.

## Contexto de producto (para decisiones de UX)

- Los tres modos de acceso son Manual, Rostro y Barrido. **Iris está oculto a propósito** (`?iris=1` para investigación) — no "arreglarlo" ni exponerlo.
- La experta clínica es Leticia (socia); sus flujos de trabajo están documentados en `sintesis-sesion-leticia-270626.md` (carpeta MiraVoz del proyecto de Esteban) y guían todas las decisiones del editor y la futura gestión de usuarios.
- Pictogramas ARASAAC: licencia CC BY-NC-SA — la atribución que aparece en el modal y en los elementos guardados es obligatoria, no decorativa.
- Documentos de referencia en esta carpeta: `ROADMAP.md`, `SPEC_FASES_0-4.md`, `REVIEW_FASE0.md`, `TESTING_FASE1.md`, `TESTING_FASE2.md`, `FIXES_F0-1.md`, `CHANGELOG.md` (mantenerlo al día).

## Arquitectura de módulos (mapa rápido)

```
web/js/
├── main.js        # wiring + appLoop (try/catch: NUNCA dejar que muera el rAF)
├── config.js      # CONFIG + settings persistidos (miravoz_settings en localforage)
├── state.js       # S = estado global compartido
├── tracking.js    # MediaPipe → features → predicción (pesos polinómicos)
├── calibration.js # sesión 9 puntos, outliers, score, retry; clave miravoz_calibration_v2
├── regression.js  # matemática pura (phi, ridge, quality) — testeable con Node
├── filters.js     # OneEuroFilter
├── dwell.js       # dwell + histéresis + cache de rects
├── scanning.js    # barrido (ScanEngine)
├── boards.js      # import GRD/OBZ, renderGrid, bundles, hooks
├── editor.js      # editor F3 (toolbar, modal de celda, ARASAAC, export)
├── colors.js      # colorCategory Fitzgerald + fallback legacy
├── speech.js      # TTS
├── ui.js          # modales, toasts, acumulador
├── auth.js        # Supabase (bypass encapsulado)
└── benchmark.js   # ?benchmark=1
```

Claves de localforage reservadas (el listado del home ignora todo prefijo `miravoz_`): `miravoz_settings`, `miravoz_calibration_v2`, `miravoz_benchmarks`.
