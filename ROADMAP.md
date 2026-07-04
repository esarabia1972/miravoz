# MiraVoz — Roadmap de producto (V1)

**Fecha:** 04/07/2026 · **Fuentes:** investigación de mercado CAA, análisis de código de `app-v4.js`, sesión de revisión con Leticia (27/06/2026).

**Flujo de trabajo por fase:** desarrollo en Antigravity → revisión de código (Claude) → pruebas de usuario (Leticia y usuarios reales) → cierre de fase.

**Decisiones marco ya tomadas:**

- Modos de acceso del producto: **Manual (touch/click) + Rostro (head tracking) + Barrido (switch)**. El modo Iris sale del producto y queda detrás de un flag experimental; se revisita solo si mejora la tecnología de gaze estimation en browser o si una métrica propia (tasa de selección correcta en grilla 3×3) supera un umbral definido.
- **Interoperabilidad como principio:** import Y export `.grd`/`.obz` sin pérdida. Nadie queda rehén de MiraVoz.
- Vocabulario del dominio: los chicos/pacientes son **"usuarios"**; quien crea y asigna tableros es **"profesional"**.
- El loop de tracking queda en vanilla JS siempre; si se adopta un framework reactivo, es solo para la capa de gestión (home, editor, settings).

---

## Fase 0 — Estabilización del MVP

**Objetivo:** que la demo que tropezó con Leticia corra sin tropiezos. Ningún feature nuevo; solo bugs y ajustes de bajo esfuerzo/alto impacto. Todos los ítems están detallados en `analisis-codigo-miravoz.md`.

**Tareas:**

1. Fix flag de cámara: `isMediaPipeRunning = false` al hacer `camera.stop()` (bug OJOS→CLICKS→OJOS deja el tracking muerto).
2. Fix regex OBZ línea ~591: `/\\.(png|...)$/i` → `/\.(png|...)$/i` (las imágenes embebidas nunca se extraen; hoy dependen de internet).
3. Navegación GRD robusta: en `handleCellClick`, aceptar `action.modelName === 'GridActionNavigate'` además de `navType` (GRDs viejos pierden navegación en silencio).
4. Quitar `localforage.clear()` del logout (hoy borra todos los tableros y calibraciones del usuario sin aviso).
5. Acumulador: mostrar **texto** además de imagen; quitar el límite de 8 ítems con `shift()` → scroll horizontal.
6. **Histéresis en dwell** (~150 ms de tolerancia a salidas breves de la celda antes de resetear el progreso). Es la mejora de usabilidad #1 del tracking; el prototipo Python la tenía y la versión web la perdió.
7. `DWELL_MS` configurable desde la UI (slider o presets: 800/1200/2000/3000 ms), persistido con la calibración.
8. Usar `colorCategory` del formato GRD (colores Fitzgerald reglamentados) en lugar de la heurística `getAutoColor()` por labels.
9. Soportar `width`/`height` (spans) de gridElements en `renderGrid` (celdas multi-celda hoy se renderizan 1×1).
10. Limpieza: eliminar `calibDataY` y ramas muertas, unificar nombres de estados, definir o quitar `ENABLE_CLICK_SOUND`/`playClickSound`, sanitizar `bundle.name` (XSS por `innerHTML`).
11. Mover Iris a flag experimental (oculto del selector por defecto).

**Criterios de aceptación:**

- Alternar modos repetidamente nunca deja la cámara muerta.
- Un `.obz` con imágenes embebidas se ve completo **sin internet** (una vez cargada la app).
- Con modo Rostro, un usuario promedio completa "yo quiero albóndigas puré" en el tablero nuclear sin selecciones falsas ni celdas imposibles.
- Cerrar sesión no destruye datos locales.
- Re-test con Leticia **con anteojos puestos** (caso que falló en la sesión) documentando el resultado.

---

## Fase 1 — Motor de acceso de calidad clínica (modo Rostro)

**Objetivo:** llevar el head tracking de "sorprendente en demo" a "confiable en sesión de 30 minutos". Todo lo de esta fase se mide sobre el modo Rostro (beneficia a Iris de rebote, pero no se optimiza para él).

**Tareas:**

1. **1 Euro Filter** en reemplazo del filtro exponencial actual (parámetros `mincutoff`/`beta` ajustables; es el estándar en interacción por puntero).
2. **Features polinómicas de 2º grado** `[1, x, y, x², y², xy]` en la calibración (el spec Python original ya lo proponía; con 9 puntos × ~30 muestras alcanza de sobra) y **eliminar el escalado fijo post-predicción** (×1.5/×2.0), que es la causa del error sistemático "no puedo bajar" observado con Leticia.
3. **Métrica de calidad de calibración:** error residual por punto al terminar; si un punto supera el umbral, ofrecer repetir solo ese punto. Mostrar un score simple ("calibración: buena/regular/mala").
4. Descarte de outliers en el muestreo de calibración (ignorar primeros ~200 ms de cada punto y muestras a >2σ).
5. Cachear los `getBoundingClientRect()` al renderizar el grid (invalidar en resize/scroll) en lugar de consultarlos por elemento por frame.
6. Refactor incremental del monolito: separar `app-v4.js` en módulos ES (`tracking.js`, `calibration.js`, `dwell.js`, `boards.js`, `tts.js`, `ui.js`). Sin framework todavía; solo módulos. Evaluar Web Worker para el loop MediaPipe recién después de medir FPS con el profiler (el cuello de botella actual es precisión, no rendimiento).
7. Definir la **métrica de referencia del motor**: tasa de selección correcta en grilla 3×3 y 4×4, y tiempo medio por selección. Registrarla en cada prueba (es también el criterio de re-entrada del modo Iris).

**Criterios de aceptación:**

- Tasa de selección correcta ≥ 95% en grilla 3×3 y ≥ 85% en 4×4 con modo Rostro (usuario sin discapacidad motora, sesión de 5 min).
- El cursor alcanza las 4 esquinas y el borde inferior sin escalado artificial.
- Recalibrar un solo punto malo es posible sin rehacer los 9.
- Sesión de 30 min sin recalibración forzada (con la cabeza en posición razonablemente estable).

---

## Fase 2 — Modo Barrido (scanning)

**Objetivo:** el tercer modo de acceso, el que abre MiraVoz a usuarios sin control de cabeza ni motricidad fina. Sin integración de hardware: los switches comerciales (AbleNet, Bluetooth de Mercado Libre, fabricantes 3D locales) emulan click/tecla.

**Tareas:**

1. Motor de barrido con dos patrones (los que Leticia mostró en el Grid/Tobii): **elemento por elemento** y **fila → elemento**. (Columna→fila puede esperar.)
2. Entrada de selección: click / barra espaciadora / Enter / tap en cualquier parte de la pantalla — cualquier switch que emule eso funciona.
3. Parámetros por perfil: velocidad de barrido (ms por ítem), número de ciclos antes de pausar, resaltado visual de alto contraste (borde grueso + overlay, no solo color).
4. **Feedback auditivo opcional** al barrer (decir cada opción o un beep) — configurable, como en Grid.
5. Incluir en el barrido los botones del acumulador (play, borrar, atrás, casa), no solo las celdas.
6. Accesibilidad estructural que el barrido necesita y hoy falta: celdas con roles ARIA y foco navegable por teclado (beneficia lectores de pantalla de rebote).

**Criterios de aceptación:**

- Un usuario con un solo movimiento voluntario (una tecla) puede componer y reproducir una frase de 3 pictogramas navegando entre tableros.
- Leticia lo prueba contra el barrido del Grid de su paciente y no encuentra un bloqueante funcional.
- Funciona con un switch Bluetooth real (comprar uno local para el test).

---

## Fase 3 — Editor de tableros

**Objetivo:** el "mundo #1" de Leticia: dejar de depender de AsTeRICS para crear. "Me la paso editando: no hay un tablero igual a otro."

**Tareas:**

1. CRUD de tableros: crear desde cero (dimensiones libres, ej. 5×3, 2×1), duplicar, renombrar, eliminar.
2. Edición de celda: texto, **búsqueda de pictogramas ARASAAC integrada** (API pública; respetar atribución CC BY-NC-SA — ver nota de licencia abajo), imagen propia, color (categorías Fitzgerald + libre), celda vacía intencional.
3. Opciones por celda: **silenciar** (no hacer speak), texto a decir distinto del label (equivalente a `GridActionSpeakCustom`, que hoy se ignora en el import), acción de navegación a tablero existente o **nuevo creado al vuelo**.
4. **Export a `.grd` y `.obz` sin romper enlaces** entre tableros (round-trip completo: lo que sale de MiraVoz se importa en AsTeRICS Grid y viceversa). Test automatizado de round-trip.
5. **Niveles de dificultad / espaciado inteligente** — el diferencial: el contenido del tablero se define una vez, y un control de "dificultad" lo re-renderiza (3 celdas grandes centradas ↔ grilla completa) sin duplicar el tablero. Versión 1: manual (la profesional marca qué celdas sobreviven en cada nivel); la versión con IA queda para Fase 6.
6. Decisión de framework: esta es la fase con UI compleja (drag & drop, formularios, previews). Evaluar acá una **isla reactiva** (Vue/React/Svelte) solo para el editor y la gestión, con el runtime del tablero + tracking intactos en vanilla.

**Criterios de aceptación:**

- Leticia crea desde cero un tablero de actividad real (con navegación, colores y pictogramas ARASAAC) sin tocar AsTeRICS, en menos tiempo del que le toma en AsTeRICS.
- Round-trip verificado: exportar de MiraVoz → importar en AsTeRICS Grid → los enlaces y pictogramas sobreviven (y viceversa).
- Un tablero con 2 niveles de dificultad se alterna sin re-edición.

---

## Fase 4 — Usuarios, perfiles y asignación

**Objetivo:** el "mundo #2": el flujo profesional↔usuarios que en AsTeRICS es "un chino". Este es el diferencial de producto más claro frente a todo el mercado gratuito.

**Tareas:**

1. Reactivar autenticación Supabase (resolver el rate-limit: SMTP propio o proveedor de email transaccional; quitar el bypass). **Revisar políticas RLS del bucket `boards` antes de reactivar** (hoy la anon key está en el cliente y las políticas no están auditadas).
2. Dos tipos de cuenta: **profesional** y **usuario**. El usuario ve solo sus tableros asignados y su tablero de inicio ("la casita"); UI mínima, sin gestión.
3. **Asignación de tableros**: desde su cuenta, la profesional asigna un tablero a uno o varios usuarios. Sin export/import. La asignación crea una **copia** (la divergencia es deseable en CAA — cada tablero es a medida), con vínculo al original.
4. **Vista de asignaciones**: qué tablero tiene cada usuario, y a quiénes se asignó cada tablero.
5. **Permisos por asignación**: solo lectura vs. editable ("este no me lo van a tocar; este, si quieren, lo pueden romper"). Pensado para que los padres puedan aprender a editar sin riesgo.
6. La profesional puede **editar el tablero asignado de un usuario desde su propia cuenta** (sin "entrar como" el usuario).
7. Actualización propagada **opcional y explícita** ("republicar a los que lo tienen") para tableros grupales/de actividad; nunca automática.
8. Configuración **por perfil de usuario**: modo de acceso, dwell, velocidad de barrido, voz TTS, calibración. (La calibración por usuario ya existe; se cuelga del perfil.)
9. Sync simple: `lastUpdateTime` (el formato GRD ya lo trae) + last-write-wins con aviso de conflicto. CRDTs solo si la edición concurrente real aparece como problema.

**Criterios de aceptación:**

- Leticia recrea su flujo real: crea 3 usuarios, asigna un tablero grupal a los 3, corrige el de uno desde su cuenta, y ve el mapa de asignaciones. Cronometrar contra el mismo flujo en AsTeRICS.
- Un usuario entra a su cuenta y aterriza en su casita con sus tableros, nada más.
- Dos dispositivos del mismo usuario ven el mismo estado tras sincronizar.

---

## Fase 5 — PWA y offline-first

**Objetivo:** la voz del usuario disponible **siempre**. Para CAA el offline no es nice-to-have: es un derecho (Communication Bill of Rights: acceso al sistema en todo momento). Además es la ventaja estructural en LATAM (tablet barata + PWA, sin app stores).

**Tareas:**

1. Web App Manifest + Service Worker: instalable, arranque offline completo.
2. **Cache local de pictogramas ARASAAC** al importar/crear (hoy se referencian por URL y sin internet desaparecen). Descargar a IndexedDB en el momento del import.
3. Cola de sincronización: cambios offline se suben al reconectar.
4. Presupuesto de almacenamiento y limpieza (los tableros con imágenes Base64 pesan; medir y comprimir — WebP).
5. Probar en el hardware real del mercado objetivo: tablet Android de gama baja + Chrome.

**Criterios de aceptación:**

- Modo avión: la app instalada abre, muestra todos los tableros con todos los pictogramas, habla, y el barrido/rostro funcionan.
- Los cambios hechos offline aparecen en otro dispositivo al reconectar.

---

## Fase 6 — Diferenciadores (backlog estratégico)

Sin orden comprometido; se priorizan al llegar.

- **Editor asistido por IA:** "quiero una actividad sobre el mundial para nivel inicial" → genera borrador de tablero con pictogramas ARASAAC (el sueño explícito de Leticia). El espaciado inteligente automático por perfil motor entra acá.
- **Predicción de frases con LLM en español** desde el acumulador de pictogramas (todo el estado del arte es anglocéntrico; hueco real). Con cuidado de autoría: sugerencias, nunca autocompletado forzado.
- **Vocabulario núcleo rioplatense propio** con `wordForms` (conjugaciones, clíticos) — el hueco #2 de la investigación de mercado. Trabajo clínico de Leticia + soporte del formato que ya existe en GRD.
- **Voces**: voces neuronales por API con fallback local; explorar ElevenLabs Impact Program / voice banking en español.
- **Telepráctica**: edición remota en vivo del tablero del usuario por la profesional.
- **Re-evaluación del modo Iris** si se cumple el criterio de re-entrada definido en Fase 1.

---

## Notas transversales

- **Licencia ARASAAC:** CC BY-NC-**SA** (no comercial). Si MiraVoz va a cobrar licencias, hay que resolver esto temprano (contactar a ARASAAC/Gobierno de Aragón por convenio, ofrecer conjuntos alternativos como Mulberry/OpenMoji, o modelo freemium donde lo pago no sea el contenido pictográfico). No dejarlo para el final.
- **Privacidad:** todo el video se procesa localmente (MediaPipe en el browser) — mantener esto como invariante de arquitectura y como argumento de venta en salud/educación. Nunca subir frames.
- **Métricas de uso** (para fases 1-2): instrumentar tasa de selección, tiempo por selección y recalibraciones por sesión. Son la evidencia para terapeutas y la brújula del producto.
- **Repo:** sacar `venv/` y `weights/` (1,1 GB) del repo (`.gitignore`); renombrar `error.log` (es un volcado `.grd` de 2 MB); archivar el prototipo Python en `/legacy`.
