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

