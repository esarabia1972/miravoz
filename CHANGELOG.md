# Changelog

Todas las versiones y cambios notables del proyecto MiraVoz serán documentados en este archivo.

## [Unreleased]

### Fase 0 - Estabilización
- **Added**: CHANGELOG.md
- **Changed**: Prototipo en Python movido al directorio `legacy/` para organizar el repositorio.
- **Fixed**: Renombrado `error.log` a `asterics/ayuda-backup.grd`.
- **Fixed**: Actualización de `.gitignore`.

### Fase 1 - Motor de acceso de calidad clínica (04/07/2026, implementada por Claude)
- **Changed (F1-1)**: Refactor completo — `app-v4.js` eliminado, código partido en 14 módulos ES en `web/js/` (main, config, state, tracking, calibration, regression, filters, dwell, boards, colors, speech, auth, ui, benchmark). Sin frameworks ni build step; `index.html` carga `js/main.js` como módulo.
- **Added (F1-2)**: Filtro **1 Euro** (`filters.js`) en reemplazo del filtro exponencial. Parámetros en `config.js`.
- **Changed (F1-3)**: Calibración con **features polinómicas de 2º grado** (6 términos) y **eliminación del escalado fijo** ×1.5/×2.0 post-predicción (causa del error en el borde inferior). Predicción con clamp al viewport. Nueva clave de perfiles `miravoz_calibration_v2` (los perfiles v1 se descartan: recalibrar una vez).
- **Changed (F1-3)**: `math.js` eliminado como dependencia — ridge resuelto con eliminación gaussiana propia (`regression.js`, módulo puro testeado con Node: 11/11 tests).
- **Added (F1-4)**: Muestreo robusto de calibración: warm-up de 200 ms (descarta la sacada de llegada), descarte de outliers >2σ por punto, repetición automática si quedan <10 muestras válidas.
- **Added (F1-5)**: **Score de calidad de calibración** (buena/regular/mala según error medio vs diagonal) mostrado al usuario, y **reintento automático del peor punto** si supera el 8% de la diagonal (1 reintento máx. por punto).
- **Added (F1-6)**: Cache de bounding boxes en el motor de dwell (refresh en resize/scroll/re-render + red de seguridad cada 1 s) — antes se llamaba `getBoundingClientRect` por elemento por frame.
- **Added (F1-7)**: **Benchmark del motor** con `?benchmark=1`: 20 objetivos en 3×3 + 20 en 4×4, mide tasa de acierto y tiempo por selección, persiste en `miravoz_benchmarks`. Criterio de cierre de fase: ≥95% en 3×3, ≥85% en 4×4.
- **Fixed**: el Tablero de Prueba ya no dispara la alerta de "reimportalo" (le faltaba `importerVersion`); debounce de doble click restaurado en `handleCellClick`; el listado del home ignora todas las claves internas `miravoz_*`; migración de `miravoz_dwell` (localStorage) a `miravoz_settings` (localforage).

### Fase 2 - Modo Barrido (04/07/2026, implementada por Claude)
- **Added (F2-1)**: Nuevo modo de acceso **Barrido** (`scanning.js`): patrones Fila→Elemento y Elemento por elemento, escape implícito al terminar la fila, pausa tras N ciclos sin activación con hint visual, primer resaltado del ciclo 50% más largo. El grupo del acumulador (play/borrar/atrás/casa) barre al final del ciclo.
- **Added (F2-2)**: Activación unificada: Espacio, Enter, click o tap en cualquier parte de la pantalla — compatible con cualquier pulsador comercial que emule tecla o click, sin integración de hardware. Debounce de 250 ms (los switches 3D locales rebotan).
- **Added (F2-3)**: Resaltado de alto contraste con doble contorno (blanco+verde para elementos, negro+amarillo para filas) — no depende solo del color (WCAG).
- **Added (F2-4)**: Feedback auditivo opcional al barrer: silencioso / beep (WebAudio) / decir cada opción (TTS a volumen reducido con cancelación).
- **Added (F2-5)**: Panel "Barrido" en Configuración: patrón, velocidad (0.6-3 s), sonido. Persistido en `miravoz_settings.scan`.
- **Added (F2-6)**: Accesibilidad estructural: celdas con `role="button"`, `tabindex`, `aria-label` y activación por teclado en modo Manual; grid con `role="group"`.
- **Tests**: máquina de estados del barrido verificada en Node con stub de DOM (16/16).

### Fase 3 (v1) - Editor de tableros (05/07/2026, implementada por Claude)
- **Added (F3-1)**: Botón "Nuevo Tablero" (crea bundle GRD nativo vacío y abre en edición); rename desde la toolbar; redimensionar grilla (+/− filas y columnas con aviso si quedan celdas fuera).
- **Added (F3-2)**: Modo edición (lápiz en la barra del tablero): celdas clickeables para editar, slots vacíos con "+" para crear, motores de acceso en pausa durante la edición, celdas ocultas visibles solo en edición.
- **Added (F3-3)**: Editor de celda: texto, modo de habla (dice el texto / dice otro texto [GridActionSpeakCustom] / silenciosa), color por categoría Fitzgerald, nivel de vocabulario, navegación a tablero existente o creado al vuelo, eliminar celda.
- **Changed (F3-3b)**: Semántica de habla por acciones para bundles con `speechModel: 'actions'` (editados en MiraVoz); los importados sin editar conservan el comportamiento legacy (hablar el label). El runtime ahora respeta `GridActionSpeakCustom` también en tableros importados editados.
- **Added (F3-4)**: Búsqueda de pictogramas **ARASAAC** integrada (API pública), con atribución CC BY-NC-SA guardada en el elemento y cache del pictograma elegido como data-URL (offline-ready).
- **Added (F3-5)**: Export **.grd** (serialización directa del formato nativo — round-trip con AsTeRICS Grid). Export .obz pendiente (F3.1).
- **Added (F3-6)**: **Niveles de vocabulario** sobre el campo nativo `vocabularyLevel`: selector de nivel activo por tablero; en uso (no en edición) solo se muestran las celdas del nivel. Interopera con AsTeRICS al exportar.
- **Decisión (F3-7)**: el editor se implementó en vanilla JS (módulo `editor.js`), consistente con la arquitectura sin build step. Pendientes para F3.1: drag & drop para mover celdas, re-layout compacto por nivel, export .obz, duplicar tablero, undo.

### Fase 4 (parcial): F4.1 y F4.2, por Antigravity (05/07 a 09/10/2026)
- **Added (F4-1)**: Login de profesionales con email y contraseña de Supabase. La tabla `boards` pasa a Postgres (JSONB).
- **Added (F4-2/F4-3)**: Gestión de usuarios (`aac_users`) con código de acceso (`access_codes`) y asignación de un tablero a un usuario como copia (`assignments.copy_bundle`).

### Fase 4: fix de pérdida de datos y modo sin cuenta (09/10/2026, equipo coordinado por Claude)
- **Fixed (bloqueante)**: se perdían datos.
  - Al arrancar con sesión, `downloadBoardsFromSupabase` borraba todos los tableros locales.
  - El editor nunca subía cambios: los tableros nuevos y las ediciones desaparecían al recargar.
  - Ahora todo guardado pasa por `sync.saveBundle()` y todo borrado por `sync.removeBundle()` (nuevo módulo `sync.js`).
- **Added (F4-5)**: Sincronización local↔nube con fusión (`sync-plan.js`, lógica pura testeada).
  - Last-write-wins por tablero. `syncedAt` funciona como token de versión, así un reloj desfasado entre tablets no esconde cambios.
  - En un conflicto, la versión que pierde queda en `miravoz_conflict_backup_<id>` (se guardan las últimas 3) y se avisa con un toast.
  - Los borrados pendientes (tombstones por cuenta) se recuperan si otro dispositivo editó el tablero después.
  - Se reintenta al volver la conexión y al volver a la app.
  - Concurrencia optimista al subir (`update … where updated_at = leído` / `insert`). Las subidas del mismo tablero se serializan.
  - Si la nube vuelve vacía teniendo tableros ya sincronizados, no se borra nada local.
- **Fixed (invariante F4)**: la app vuelve a funcionar 100% sin cuenta.
  - El login es opcional: "Ingresar (profesionales)" en la barra inferior, con "Crear cuenta" separado de "Ingresar".
  - Muestra los tableros locales antes de esperar a la red o a la sesión.
  - Funciona aunque no cargue el CDN de Supabase.
  - El logout usa `scope: 'local'`, así también funciona sin red.
- **Changed (privacidad)**: un tablero local "de nadie" no se sube a la nube sin que la persona lo acepte.
  - Al iniciar sesión se pregunta una vez; si se rechaza, se recuerda.
  - Asignar un tablero así también pide confirmación.
  - Los tableros de una cuenta solo se ven con esa cuenta.
  - El tablero de prueba nunca se sincroniza.
- **Security**:
  - XSS por `display_name` corregido en la lista de usuarios y en el modal de asignar.
  - `access_codes` filtrados por los usuarios propios.
  - Códigos generados con CSPRNG.
  - Si la nube falla por un error del servidor (RLS, tipos), se avisa una vez en lugar de quedar pendiente en silencio.
- **Fixed (UX/CAA)**:
  - Con el login abierto, el barrido y el dwell quedan en pausa (antes, tipear la contraseña con Espacio o Enter activaba tarjetas ocultas).
  - Los diálogos se encolan para que dos confirmaciones simultáneas no se cuelguen.
  - Si el tablero abierto cambia desde otro dispositivo, se recarga y se invalida el "deshacer" pendiente.
  - Acciones de las tarjetas con `aria-label` y 44px. El botón de cuenta pasa a `<button>`.
  - Labels y `autocomplete` en el login; Enter envía el formulario. Foco visible.
  - "Paciente" reemplazado por "usuario"; textos en voseo.
  - `users.js` se cargaba dos veces: corregido.
- **Added**:
  - `EQUIPO.md`: roles del equipo y reglas.
  - `tools/test-sync.mjs` (29 tests) y `tools/test-boot.mjs`: arranque real en jsdom, 7 escenarios, 44 chequeos.
  - `supabase/`: auditoría de solo lectura del esquema real y requisitos de RLS.
- **Pendiente F4**:
  - Canje del código y la "casita" del chico (F4-4).
  - Asignación múltiple con permisos, republicar y editar copias (F4-3).
  - Settings por perfil (F4-6).
  - Versionar el esquema y RLS reales (`supabase/01_schema_f4.sql`).
  - Códigos de 8 caracteres con vencimiento corto.

### Fase 4: tablet del chico y asignaciones (09/10/2026, equipo coordinado por Claude)
- **Added (F4-4)**: Vincular la tablet de un usuario con un código.
  - La pantalla de ingreso tiene "Vincular esta tablet a un usuario".
  - La tablet entra con una sesión anónima de Supabase y canjea el código con la RPC `redeem_access_code`.
  - Modo tablet:
    - Abre directo en la casita (o en la lista de sus tableros), sin barras de gestión.
    - Usa copias locales (offline-first) que se refrescan al abrir, al volver a la app y al recuperar la conexión.
    - Aplica los settings del usuario.
    - Guarda solo las copias editables (RPC `save_assignment_copy`, concurrencia optimista); las de solo lectura no se pueden editar.
  - Salida para adultos: mantener apretada la esquina superior derecha 3 s, confirmar y escribir DESVINCULAR.
  - Si la profesional desvincula la tablet o borra al usuario, la tablet lo detecta.
  - Si se pierde la sesión anónima, avisa.
- **Added (F4-3)**: Asignación múltiple con checkboxes y permiso por tanda ("Puede editarse" / "Solo mirar").
  - Ficha por usuario en "Mis usuarios":
    - Sus copias, con cambio de permiso, casita, "Editar copia" y "Quitar".
    - Tablet vinculada, con opción de desvincularla.
    - Código de un solo uso con su vencimiento.
  - La profesional edita la copia de un usuario desde su cuenta: aviso "Estás editando la copia de…", UPDATE condicional, respaldo si hay conflicto. Al cerrar sesión no quedan copias de los chicos en el navegador.
- **Security (supabase/02)**:
  - Códigos de 8 caracteres generados por el servidor, de un solo uso, que vencen en 7 días.
  - Canje con límite de intentos.
  - RLS de dispositivo: la tablet solo lee su usuario y sus copias.
  - Las sesiones anónimas nunca son profesionales.
- **Tests**: `tools/test-device.mjs` (7 escenarios, 62 chequeos).

### Modo Iris, etapa 1: nuevo motor de cámara (09/10/2026)
- **Changed**: `tracking.js` usa **MediaPipe Tasks Vision · FaceLandmarker** (`@mediapipe/tasks-vision@1.1.0`). El FaceMesh legado (congelado desde 2022) queda como respaldo automático y se puede forzar con `?engine=legacy`.
  - GPU con fallback a CPU, también si la GPU empieza a fallar a mitad de la sesión.
  - Una sola instancia del modelo; los arranques viejos nunca tocan la cámara del arranque vigente (protege contra el bug F0-1).
  - Aviso "Preparando la cámara…" mientras descarga el modelo, con timeout de 25 s. Los errores de permiso o de falta de cámara se muestran claros.
  - El `<video>` queda fuera de pantalla en lugar de `display:none` (compatibilidad con iOS y Android).
  - Los scripts legados se cargan solo si hacen falta, con versión fija.
- **Same**: el modo Rostro usa las mismas features (landmark 1) y las calibraciones guardadas siguen valiendo. Conviene recalibrar una vez y comparar el puntaje.
- **Added**:
  - `headpose.js`: pose de la cabeza, blendshapes de mirada e iris normalizado por ojo, como base del modo Iris híbrido (etapa 2). Se expone en `tracking.faceData`.
  - El benchmark registra `engine` y `fps`.
  - `tools/test-headpose.mjs` (11 tests).
- **Benchmark (10/10/2026, Esteban)**: los dos motores dan resultados idénticos en modo Rostro. FaceLandmarker: 3×3 95% (19/20, 3,2 s) y 4×4 100% (20/20, 3,5 s). FaceMesh: 3×3 95% (19/20, 3,1 s) y 4×4 100% (20/20, 3,4 s). Queda FaceLandmarker como motor por defecto.
- **Fixed (rendimiento)**: el motor nuevo procesaba en cada refresco de pantalla, a 108 cps en una pantalla de 120 Hz, analizando varias veces la misma imagen. Ahora va al ritmo real de la cámara (normalmente 30 cps), lo que ahorra CPU en tablets de gama baja.

### Modo Iris, etapa 2: modelo híbrido cabeza + iris (10/10/2026) — experimental, solo con `?iris=1`
- **Added**: `gaze-model.js`.
  - Estima el punto de la pantalla combinando la pose de la cabeza (yaw, pitch), la posición de la nariz, el iris dentro de cada ojo y los blendshapes de mirada.
  - Features estandarizadas, términos cuadráticos y cruces iris×cabeza; ridge.
  - Descarta parpadeos.
- **Changed**: la calibración del modo Iris tiene 14 puntos.
  - 9 con la cabeza quieta y 5 donde se pide "mirá el punto y mové la cabeza despacito"; así el modelo aprende a separar cabeza de ojos.
  - Se muestra una indicación en pantalla.
  - Los perfiles del modo Iris viejo (solo iris) quedan invalidados.
- **Added**: aprendizaje implícito. Cada selección por dwell que no se corrige en 3 s ("borrar último", "atrás" o "inicio") suma muestras al modelo, que se re-entrena cada 5 selecciones. Salvaguardas:
  - Solo cuentan las selecciones con el cursor en el centro del objetivo.
  - Lo implícito no supera el 30% del entrenamiento.
  - Un modelo que empeora sobre la calibración se descarta.
  - Desactivado durante el benchmark; se apaga con `?implicit=0`.
- **Sin cambios** en los modos Rostro, Barrido y Manual (verificado por revisión y por `tools/test-calibration.mjs`).
- **Tests**: `tools/test-gaze.mjs` (11) y `tools/test-calibration.mjs` (14).
- **Pendiente**: benchmark real con webcam. Criterio de reingreso: ≥90% en 3×3.
- **Fixed (10/10/2026, primera prueba real: "se vuelve muy inestable si muevo apenas la cabeza")**: modelo `hybrid-v2`. Los perfiles v1 se invalidan y hay que recalibrar.
  - Se quitaron los cruces iris×cabeza, que multiplicaban el ruido de la pose.
  - Regularización proporcional a la cantidad de muestras.
  - Mediana de 5 cuadros sobre las features.
  - Filtro 1 Euro más suave en modo Iris (minCutoff 0.3, beta 0.005), mientras que el modo Rostro sigue igual.
- **Added**: diagnóstico para desarrollo con `?diag=1`. El botón "⬇ Diagnóstico" descarga un JSON con features, pose, cursor y objetivo por cuadro (solo números, nunca video) para ajustar el modelo con datos reales. Usarlo solo con la cara de quien desarrolla.

### Modo Iris v3: "cabeza quieta", basado en datos reales (10/10/2026)
- **Diagnóstico** (`miravoz-diag-2026-10-10-13-51.json`, 9.659 cuadros, analizado con `tools/replay-diag.mjs`):
  - En los puntos de "mové la cabeza" la cabeza casi no se movió (yaw ±0,1°): el modelo híbrido nunca pudo aprender a compensar. Por eso el cursor se corría al mover la cabeza aun mirando el botón.
  - Con la cabeza en la pose de la calibración, el error mediano fue de ~130 px; a ±4° ~230 px y a ±8° ~340 px.
  - Los blendshapes de mirada de FaceLandmarker resultaron la mejor señal: rango 2-3× mayor y menos temblor que la posición del iris.
- **Changed**:
  - Modelo `gaze-v3` con solo señales de los ojos (iris + blendshapes), calibración de 9 puntos con la cabeza quieta y vigilancia de la pose.
  - Si la cabeza gira más de 4° o se desplaza respecto de la calibración, el cursor se pausa, el dwell no selecciona y aparece "Volvé a poner la cabeza como en la calibración" (con histéresis).
  - Sin cara, no hay cursor.
- **Resultado con los datos reales**, validación dejando un punto afuera: error mediano 122 px y **92% de acierto 3×3** con la cabeza quieta. En el benchmark grabado moviendo la cabeza, el 40% de los cuadros habría quedado en pausa en lugar de seleccionar mal.
- **Producto**: el modo Iris es para usuarios que no pueden mover la cabeza. Quien puede moverla usa el modo Rostro (95-100%).
- **Tools**: `tools/replay-diag.mjs` reproduce un diagnóstico contra el modelo. Los JSON de diagnóstico no se versionan.

### Acceso: solo Google y tablets con token (10/10/2026, decisión de Esteban)
- **Changed**: las profesionales entran **solo con Google** (`signInWithOAuth`, PKCE).
  - Se eliminaron el modo sin cuenta, el formulario de email y contraseña, "Crear cuenta", "Seguir sin cuenta" y "Ingresar (profesionales)".
  - Sin sesión se muestra la pantalla de ingreso: "Ingresar con Google" o "Vincular esta tablet con un código".
- **Fixed (vinculación)**: la tablet ya no usa una sesión anónima de Supabase, que fallaba.
  - Canjea el código por un token secreto que solo vive en el dispositivo y lee y guarda sus copias con `device_fetch` y `device_save_copy`, que validan el token en el servidor (`supabase/03_tokens_de_tablet.sql`).
  - En la base se guarda solo el hash del token.
  - Límite de intentos por IP más uno global.
  - Se retira el esquema de la 02 (políticas de dispositivo, `device_links`, sesiones anónimas).
- **Fixed**: en "Mis usuarios", el campo de nombre se autocompletaba con el email del navegador. Se desactivó el autocompletado.
- **Security**: supabase-js con versión fija (2.117.3) y SRI. Sin foco automático en "Ingresar con Google", para que un pulsador no lo active en una tablet desvinculada.
- **Tests**: `test-boot` (64) y `test-device` (75) actualizados al acceso nuevo.
- **Backlog modo Iris**: guía visual de alineación de la cabeza "tipo Starlink", que muestre cuánto y hacia dónde falta para volver a la pose de la calibración (idea de Esteban).

### Tablet vinculada: configuración y pantalla completa (10/10/2026)
- **Added (F4-6)**: en "Mis usuarios", cada ficha tiene "Configuración de su tablet".
  - Permite elegir modo de acceso, tiempo de fijación y barrido (patrón, velocidad, sonido); se guarda en `aac_users.settings`.
  - La tablet la aplica al abrirse o conectarse, solo cuando la profesional la cambió, así no pisa un ajuste hecho en la tablet.
- **Added**: menú para adultos en la tablet (mantener apretada 3 s la esquina superior derecha) con modo de acceso, recalibrar, tiempos y barrido, pantalla completa y desvincular. Antes solo permitía desvincular, así que no había forma de cambiar el modo.
- **Added**: pantalla completa al primer toque donde el navegador lo permite, y app instalable con `manifest.webmanifest` (display fullscreen), meta tags de iOS e íconos nuevos. En iPad: Compartir → "Agregar a inicio".
- **Changed (pedido de Esteban)**: la vista de inicio de la tablet vinculada ahora es como la de las profesionales.
  - Arriba: logo, buscador, modo de acceso y recalibrar.
  - Abajo: nombre del usuario, configuración (tiempos y barrido), "Desvincular tablet" y "Tablero de prueba".
  - Sin "Nuevo tablero", "Importar", "Mis usuarios" ni "Cerrar sesión".
  - Al abrir, va directo a la casita si hay una; el botón Inicio vuelve a esta vista.
  - Se quitó el menú oculto de la esquina.
  - En modo barrido, tocar la barra superior ya no activa el pulsador.

### Interfaz: modo de acceso con botones, alto en iPad y modo Día/Noche (10/10/2026)
- **Changed**: el modo de acceso (Manual, Rostro, Barrido e Iris experimental) pasa a ser un grupo de botones visibles en la barra superior, en lugar del select nativo que se veía mal en iPad.
- **Fixed**: en iPad la barra inferior quedaba tapada. Ahora se usa `100dvh` y los márgenes seguros de iOS (safe-area).
- **Added**: modo **Día / Noche** en la web y en la tablet.
  - Se cambia con el ícono sol/luna al lado de la configuración, o en la pantalla de ingreso.
  - Se aplica antes del primer pintado y se guarda en el dispositivo.
  - Paleta clara con contraste AA medido, logo oscuro en modo día y colores fijos pasados a variables (`theme.js`).

### Home de la profesional: tarjetas, etiquetas y filtros (10/10/2026)
- **Fixed**:
  - El ícono de eliminar tablero quedaba cortado. La tarjeta tiene ahora una fila de acciones abajo: asignar, etiquetas, exportar, duplicar y eliminar.
  - El tablero de prueba aparecía en el inicio después de editarlo. Ahora no se puede editar, no se guarda y se limpió del inicio.
  - Los botones del modal "Dar copia" se veían mal.
  - El modal de Configuración se rediseñó en secciones (Rostro, Barrido), con voseo, botón "Listo" y las mismas velocidades que la ficha del usuario.
- **Added**:
  - Contador de usuarios asignados sobre el ícono de asignar, como un badge.
  - Confirmación antes de cerrar sesión.
  - **Etiquetas** por tablero, guardadas en el bundle y sincronizadas: editor con sugerencias, chips en la tarjeta y filtros en el home por etiquetas (acumulativos) y por usuario, combinables con el buscador.
  - Dwell y barrido usan solo las tarjetas visibles.
- **Ajustes (10/10/2026)**:
  - Eliminar un tablero pide confirmación; si tiene copias asignadas, avisa que esas copias no se borran.
  - El permiso al dar copia pasa a dos botones, "Solo mirar" y "Puede editarse", con una explicación. Antes era un select con emojis.
  - Todos los select usan la misma flecha y foco.
  - La tarjeta muestra una **miniatura** del tablero principal, armada en el momento con los datos locales (no se guarda en la base), en lugar de "Tipo".
  - Las acciones de la tarjeta quedan en una sola fila.
- **Fixed (voz en iPad)**:
  - iOS bloquea la síntesis de voz hasta que se habla una vez dentro de un toque. En modo Rostro o Barrido la selección no es un toque, así que no sonaba. Ahora la voz se desbloquea en silencio al primer toque o tecla.
  - Además: se reanuda si Safari la dejó en pausa, se mantienen referencias a las frases, se espera a que carguen las voces (prioridad es-AR/es-419) y hay un pequeño retraso después de `cancel()`.
  - Botón "🔊 Probar voz" en Configuración, con un aviso sobre el volumen y el modo silencio.
- **Fixed**:
  - "Editar copia" fallaba con "No se pudo abrir la copia". La consulta pedía el nombre del usuario embebido (`aac_users(...)`), y desde la migración 01 hay dos relaciones entre `assignments` y `aac_users` (la del usuario y la de la casita), así que PostgREST la rechazaba por ambigua. Ahora son dos consultas.
  - Se quitaron los emojis del permiso en la ficha del usuario.

