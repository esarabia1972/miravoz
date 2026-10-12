# MiraVoz — Equipo de desarrollo

**Desde 09/10/2026.** Claude (Cowork) es líder técnico y desarrollador principal y coordina agentes con roles fijos. Esteban es el dueño del producto y Leticia hace la validación clínica. Antigravity ya no commitea a `main`: si aporta algo, lo hace en una rama y Claude lo revisa e integra.

## Roles

| Rol | Quién | Responsabilidad | Entrega |
|---|---|---|---|
| **Producto** | Esteban | Prioridades, decisiones de alcance y aprobar el cierre de cada fase | Decisiones en el chat del proyecto |
| **Validación clínica** | Leticia | Pruebas con usuarios reales, flujos de la profesional y criterios de aceptación clínicos | `TESTING_FASEn.md` completado |
| **Líder técnico / Dev** | Claude | Diseño, implementación, integración, commits y CHANGELOG | Commits atómicos con IDs del spec |
| **Dev (paralelo)** | Agente | Tareas acotadas e independientes, en una copia aislada del repo (worktree) | Diff que el líder revisa antes de integrar |
| **QA** | Agente | Tests automáticos en Node (lógica pura y arranque de la app con DOM simulado) y prueba de humo en producción tras cada deploy | Tests en `tools/` y reporte pasa/falla |
| **Revisión + Seguridad** | Agente | Revisión adversarial del diff contra el spec y los invariantes: RLS, XSS, privacidad del video, pérdida de datos | Lista de hallazgos por severidad |
| **UX / CAA** | Agente | Revisar cada pantalla nueva con criterios de accesibilidad (WCAG, tamaño de toque, operable por barrido o teclado) y con el lenguaje y los flujos de Leticia | Lista de ajustes de UI |

## Reglas que todo el equipo respeta

1. **Leer `SPEC_FASES_0-4.md` §0 antes de tocar código.** Invariantes:
   - El video nunca sale del dispositivo.
   - Interoperabilidad copy-on-write con GRD.
   - Tracking y runtime en vanilla JS.
   - Se dice "usuario" y "profesional", **nunca "paciente"**.
2. **Acceso (decisión de Esteban, 10/10/2026):**
   - Las profesionales entran **solo con Google**; no hay modo sin cuenta ni contraseñas.
   - Las tablets de los usuarios no inician sesión: se vinculan con un código de un solo uso y guardan un token (`supabase/03`).
   - Una sesión ya iniciada sigue funcionando sin red con los datos locales.
3. **Ningún dato del usuario se pierde.**
   - Todo guardado de un tablero pasa por `sync.saveBundle()` y todo borrado por `sync.removeBundle()`.
   - Prohibido borrar lo local "para reflejar la nube".
   - Los conflictos se resuelven por el más nuevo, con backup en `miravoz_conflict_backup_<id>` (se guardan los últimos 3).
4. **Seguridad.**
   - Los textos que escribe una persona (nombres, labels) se insertan con `textContent`, nunca con `innerHTML`.
   - La anon key es pública: toda tabla nueva lleva RLS y su script en `supabase/`.
   - Ninguna clave de servicio en el cliente.
5. **Sin build step ni frameworks** salvo decisión explícita de Esteban. Cache-busting: cada cambio de JS o CSS sube el `?v=` en `index.html`. Las bibliotecas externas van en `web/vendor/<nombre>-<versión>/` (con su licencia), nunca desde una CDN: la app tiene que abrir sin conexión.
6. **Git.**
   - Commits atómicos con el ID de la tarea (`F4-5: ...`). Nunca commitear `web/.vercel/` ni tocar `.git/config`.
   - En el sandbox de Claude, usar siempre `git --no-optional-locks`: el mount no permite borrar `index.lock` sin pedir permiso.
7. **Verificación mínima antes de cada commit.**
   - `node --input-type=module --check` sobre cada JS modificado.
   - **Regenerar el manifiesto sin conexión** si se tocó algo en `web/`: `node tools/build-offline-manifest.mjs` (M05). Sin esto, el Service Worker no instala la versión nueva y `npm test` falla.
   - Correr `npm test` (todos los grupos; `npm install` una vez para jsdom).
   - Probar contra `asterics/nuclear.grd`.
8. **Versión visible (renumerada a 0.7.0 el 12/10/2026).** Fuente única: `"version"` en `package.json`; se muestra en Configuración y la escribe `build-offline-manifest.mjs` en `version.json` (`app`). Se sube en cada publicación a `main`, antes de regenerar el manifiesto, y se anota en `CHANGELOG.md`. Mientras no esté en producción vamos por la serie 0.x:
   - **tercer dígito** (0.7.**1**): cada publicación, sea arreglo, ajuste visual o función chica;
   - **segundo dígito** (0.**8**.0, 0.**9**.0): solo cuando se decide sacar un release importante;
   - **1.0.0**: cuando se use en producción con usuarios reales. Recién ahí rige semver completo (mayor = cambios que obligan a rehacer datos, vinculación o formato de tableros).
   - Las versiones 1.0.0 a 1.9.9 (11 y 12/10/2026) fueron una numeración anterior: quedan en el CHANGELOG y en los tags como historia y no se reutilizan como referencia.

9. **Ayuda para Claude (desde 0.7.9c).** `web/api/_ayuda.js` es la guía de uso que devuelve la herramienta `ayuda_miravoz`. Cada publicación que cambie algo visible o de uso actualiza el tema correspondiente (y `AYUDA_VERSION`), junto con el CHANGELOG.

## Flujo por tarea

1. El líder parte la tarea, define los criterios de aceptación y decide qué se hace en paralelo.
2. Dev implementa, y si la lógica es pura la deja testeable en Node (patrón `regression.js`, `sync-plan.js`).
3. **QA y Revisión corren en paralelo sobre el mismo diff.** UX/CAA se suma si hay UI nueva.
4. El líder resuelve los hallazgos, commitea, actualiza el CHANGELOG y hace push (deploy automático a Vercel).
5. QA hace la prueba de humo en https://miravoz-ok.vercel.app.
6. Al cerrar una fase: `TESTING_FASEn.md` para Leticia y Esteban.

## Límites conocidos

- Desde el sandbox no se llega a `supabase.co` ni a `vercel.app`. Auditar la RLS o migrar la base necesita una de estas dos cosas:
  - que Esteban corra los scripts de `supabase/` en el SQL Editor;
  - o el navegador integrado de la app con la sesión de Esteban iniciada.
- Ningún agente puede probar webcam ni switch físico con una persona: eso sigue siendo prueba de usuario.
- Los agentes no recuerdan entre sesiones. La continuidad está en este archivo, `CHANGELOG.md`, `HANDOFF_ANTIGRAVITY.md` y la memoria del proyecto.

## Tests automáticos

| Archivo | Qué cubre |
|---|---|
| `tools/test-sync.mjs` | Fusión local↔nube: adopción, last-write-wins, conflictos, borrados pendientes, migración de bundles viejos, reloj desfasado, idempotencia |
| `tools/test-boot.mjs` | Arranque real de la app en jsdom con stubs de CDN: modo sin cuenta, sin CDN, con sesión (pregunta antes de adoptar), editor persiste y sube, XSS. Requiere `npm install --prefix /tmp/qa jsdom` |
| `tools/test-device.mjs` | Tablet vinculada (F4-4) y profesional editando copias (F4-3): vincular con código (válido/inválido), arranque con y sin casita, desvinculación remota, guardado de copia editable vs solo lectura, edición de copia por la profesional con concurrencia optimista |
| `tools/test-headpose.mjs` | Matemática del motor FaceLandmarker: pose de la cabeza desde la matriz (yaw/pitch/roll/traslación), blendshapes de mirada, iris normalizado por ojo |
| `tools/test-selection.mjs` | M01/M07: muestras inválidas o viejas nunca seleccionan (T01–T07), aprendizaje implícito apagado (T16) |
| `tools/test-profiles.mjs` | M02/M04: perfiles por persona, orientación y geometría, migración y escritura segura (T08–T10); verificación independiente, cuadros duplicados o tardíos, benchmark con omisiones (T13–T15) |
| `tools/test-contexts.mjs` | M03: diálogos sobre el tablero, redibujado detrás, anidados, cierre por tiempo (T11–T12) |
| `tools/test-offline.mjs` | M05: Service Worker real en navegador simulado: arranque sin red, descarga incompleta, archivo alterado, actualización sin mezclar versiones (T18–T19) |
| `tools/test-vision.mjs` | M06: cola de cuadros acotada, descarte por sesión, caída del motor, métricas |
| `tools/test-asterics.mjs` | Compatibilidad con Asterics Grid: textos en varios idiomas, navegación (volver, inicio, rota, búsqueda), teclas y páginas de teclado, celdas especiales y no disponibles, respaldos completos (inicio, tablero global, miniaturas, diccionarios), informe de importación y predicción de palabras |
| `tools/test-pages.mjs` | Tableros de varias páginas: orden de páginas, agregar/borrar/inicio, separar al importar, nombre de respaldos de Asterics, textos de ARASAAC (con fallas de red), qué se dice al navegar, migración a voz por acciones |
| `tools/test-calibration.mjs` | Calibración real de Rostro (9 puntos + verificación) con stubs mínimos: perfiles, abortos sin rostro y persistencia. |
