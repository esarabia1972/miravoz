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
2. **La app funciona 100% sin cuenta.** El login suma sincronización y asignaciones; nunca es requisito.
3. **Ningún dato del usuario se pierde.**
   - Todo guardado de un tablero pasa por `sync.saveBundle()` y todo borrado por `sync.removeBundle()`.
   - Prohibido borrar lo local "para reflejar la nube".
   - Los conflictos se resuelven por el más nuevo, con backup en `miravoz_conflict_backup_<id>` (se guardan los últimos 3).
4. **Seguridad.**
   - Los textos que escribe una persona (nombres, labels) se insertan con `textContent`, nunca con `innerHTML`.
   - La anon key es pública: toda tabla nueva lleva RLS y su script en `supabase/`.
   - Ninguna clave de servicio en el cliente.
5. **Sin build step ni frameworks** salvo decisión explícita de Esteban. Cache-busting: cada cambio de JS o CSS sube el `?v=` en `index.html`.
6. **Git.**
   - Commits atómicos con el ID de la tarea (`F4-5: ...`). Nunca commitear `web/.vercel/` ni tocar `.git/config`.
   - En el sandbox de Claude, usar siempre `git --no-optional-locks`: el mount no permite borrar `index.lock` sin pedir permiso.
7. **Verificación mínima antes de cada commit.**
   - `node --input-type=module --check` sobre cada JS modificado.
   - Correr `node tools/test-*.mjs`.
   - Probar contra `asterics/nuclear.grd`.

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
| `tools/test-gaze.mjs` | Modelo híbrido del modo Iris con simulador geométrico (test de humo, NO evidencia de precisión real): híbrido vs solo-iris con movimiento de cabeza, aprendizaje implícito, salvaguardas (rechazo de modelos sesgados, tope 30% implícito, parpadeo, selección confiable) |
| `tools/test-calibration.mjs` | Calibración real (CARA 9 puntos y OJOS 9+5) con stubs mínimos: perfiles, abortos sin rostro, aprendizaje implícito y persistencia |
