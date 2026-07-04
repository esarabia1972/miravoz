# MiraVoz — Especificación Técnica por Fases (F0–F4)

**Versión:** 1.0 · 04/07/2026
**Audiencia:** equipo de desarrollo (agentes de Antigravity). Documento autocontenido: incluye contexto, tareas con ID, detalle de implementación, esquemas de datos y criterios de aceptación por fase.
**Documentos hermanos:** `ROADMAP.md` (visión de producto), `MVP_Spec_Antigravity.md` (histórico, prototipo Python — NO usar como referencia de la app web).

---

## 0. Contexto y convenciones generales

### 0.1 Qué es MiraVoz

Aplicación web de Comunicación Aumentativa y Alternativa (CAA). Muestra tableros de pictogramas importados del ecosistema AsTeRICS Grid (`.grd`) y Open Board Format (`.obz`), permite componer frases y reproducirlas por voz. Métodos de acceso: **Manual** (click/touch), **Rostro** (head tracking por webcam con MediaPipe FaceMesh), y —a construir en F2— **Barrido** (scanning con switch). El modo **Iris queda fuera del producto** (flag experimental, ver F0-11).

### 0.2 Estado actual del código

- App en `eyetracking-caa-mvp/web/`: `index.html`, `style.css`, `app-v4.js` (monolito ~1.500 líneas), sin build system, dependencias por CDN (MediaPipe face_mesh + camera_utils, math.js, JSZip, localforage, supabase-js).
- Deploy: Vercel. Persistencia: IndexedDB vía localforage (store `Miravoz/boards`). Supabase configurado pero **bypasseado** (sesión mock, ver F4).
- El prototipo Python de la raíz (`*.py`, `weights/`, `venv/`) es legacy: no tocar, no usar como referencia.

### 0.3 Invariantes de arquitectura (válidos en todas las fases)

1. **Privacidad:** el video de la webcam se procesa 100% en el navegador. Ningún frame ni landmark sale del dispositivo, nunca.
2. **Interoperabilidad:** todo tablero creado o editado en MiraVoz debe poder exportarse a `.grd`/`.obz` y abrirse en AsTeRICS Grid sin pérdida funcional. Al editar estructuras importadas, **preservar los campos desconocidos** (copy-on-write: nunca reconstruir el objeto desde cero descartando keys que no entendemos, p. ej. `_id`, `_rev`, `additionalProps`, `pronunciation`).
3. **El loop de tracking y el runtime del tablero se mantienen en vanilla JS**, sin frameworks. Si en F3 se adopta un framework reactivo, es solo para editor/gestión.
4. **Terminología en UI y código:** los chicos son `user` ("usuario"); quien crea/asigna tableros es `professional` ("profesional"). Nunca "paciente".

### 0.4 Modelo de datos actual (bundle interno)

```js
// Clave localforage: bundle.id ("bundle_<timestamp>")
{
  id: "bundle_1751600000000",
  name: "nuclear",
  type: "grd" | "obz" | "test",
  mainBoard: "<gridId>",          // tablero raíz
  boards: {                        // grids GRD nativos (o normalizados desde OBF)
    "<gridId>": { /* GridData de AsTeRICS, ver 0.5 */ }
  }
}
// Otras claves reservadas en localforage: "miravoz_calibration"
```

### 0.5 Formato GRD (verificado sobre `asterics/nuclear.grd`, GridData v7)

Campos de **grid**: `id`, `label` (`{es: "..."}`), `rowCount`, `minColumnCount`, `gridElements`, `lastUpdateTime` (epoch ms), más campos a preservar (`_id`, `_rev`, `globalGridId`, `keyboardMode`, `thumbnail`, `webRadios`, `additionalFiles`, `showGlobalGrid`, `isShortVersion`, `modelName`, `modelVersion`).

Campos de **gridElement**: `x`, `y`, `width`, `height` (¡spans reales!), `label` (`{es}`), `image` (`{url, data, author, authorURL, searchProviderName, ...}`), `colorCategory`, `hidden` (bool), `vocabularyLevel`, `fontSizePx`, `wordForms`, `pronunciation`, `actions`, `type`, `additionalProps`.

**Acciones observadas** (con frecuencia en nuclear.grd): `GridActionSpeak` (774 — habla el label), `GridActionSpeakCustom` (53 — habla `speakText: {es: "..."}`), `GridActionNavigate` (43 — `toGridId`; en v6+ trae también `navType: "navigateToGrid"`), `GridActionYoutube`, `GridActionWebradio`, `GridActionCollectElement`.

**`colorCategory` — valores reales encontrados:** `CC_IMPORTANT`, `CC_NOUN`, `CC_VERB`, `CC_DESCRIPTOR`, `CC_PRONOUN_PERSON_NAME`, `CC_PLACE`, `CC_SOCIAL_EXPRESSIONS`, `CC_OTHERS`, y `null`.

### 0.6 Flujo de trabajo y Definition of Done por fase

- Una rama por fase: `fase-0-estabilizacion`, `fase-1-motor`, etc.
- Cada tarea tiene ID (`F0-1`, `F1-3`…): usarlos en commits y PRs.
- DoD de toda fase: (a) criterios de aceptación cumplidos y demostrables, (b) sin regresiones del checklist de humo (ver 0.7), (c) `CHANGELOG.md` actualizado con los IDs completados, (d) revisión de código externa (Claude) antes de pruebas de usuario con Leticia.

### 0.7 Checklist de humo (correr al final de cada fase)

1. Importar `asterics/nuclear.grd` → se ve, navega entre tableros, habla.
2. Importar un `.obz` de `asterics/` → pictogramas visibles (desde F0: también sin red).
3. Modo Manual: componer y reproducir frase de 3 pictogramas.
4. Modo Rostro: calibrar, seleccionar 5 celdas en el tablero de prueba 3×3.
5. Alternar Manual↔Rostro 3 veces: el tracking sigue vivo.
6. Recargar la página: tableros y calibración persisten.

---

## FASE 0 — Estabilización del MVP

**Objetivo:** cero features nuevos; que la demo que tropezó en la sesión del 27/06 corra impecable. Todo ocurre en `app-v4.js`, `index.html`, `style.css`.

### F0-1 · Fix: cámara muerta al alternar modos

**Bug:** `modeSelect` en CLICKS hace `camera.stop()` pero `isMediaPipeRunning` queda `true`; al volver a Rostro, `startMediaPipe()` retorna temprano y no hay tracking.
**Fix:** en el handler de `modeSelect` (rama CLICKS), agregar `isMediaPipeRunning = false;` junto al `camera.stop()`. En `startMediaPipe()`, mover la asignación `isMediaPipeRunning = true` a después de `camera.start()`.
**Test:** OJOS→CLICKS→OJOS→CLICKS→CARA: el cursor aparece siempre.

### F0-2 · Fix: regex de imágenes OBZ

**Bug (línea ~591):** `/\\.(png|jpe?g|gif|svg|webp)$/i` exige un backslash literal → ninguna ruta interna del zip matchea → las imágenes embebidas nunca se extraen a Base64 (verificado con Node: `re.test("images/foo.png") === false`). La app cae en silencio a `img.url` (requiere internet).
**Fix:** `/\.(png|jpe?g|gif|svg|webp)$/i`.
**Test:** importar `.obz` con imágenes embebidas, activar modo avión, recargar: los pictogramas se ven.

### F0-3 · Navegación GRD robusta

**Bug:** `handleCellClick` solo reconoce `action.navType === 'navigateToGrid'`. GRDs antiguos traen solo `modelName: 'GridActionNavigate'`.
**Fix:** condición `(action.navType === 'navigateToGrid' || action.modelName === 'GridActionNavigate') && action.toGridId`.

### F0-4 · Logout no destructivo

**Bug:** `btnLogout` ejecuta `localforage.clear()` → borra tableros y calibraciones del dispositivo.
**Fix:** eliminar el `clear()`. El logout solo cierra sesión. Si en el futuro hace falta "borrar datos del dispositivo", será una acción separada con `customConfirm` explícito.

### F0-5 · Acumulador con texto y sin pérdida

**Bugs:** `renderSentence()` solo renderiza `item.imageUrl` (celdas sin imagen = ítem invisible); límite de 8 ítems con `shift()` descarta el inicio de la frase en silencio.
**Fix:** cada `.sentence-item` muestra imagen (si hay) **y** label debajo (font ~0.7rem, ellipsis). Quitar el límite: el contenedor ya scrollea (`scrollLeft = scrollWidth`); mantener auto-scroll al final.

### F0-6 · Histéresis en el dwell

**Problema:** cualquier salida momentánea del bounding box resetea el progreso a 0. Con jitter de webcam, celdas difíciles de completar (visto en vivo).
**Spec:** nueva constante `CONFIG.HYSTERESIS_MS = 150`. Cambio en `handleGazeInteraction`:

```js
// Estado adicional: let lastSeenInCellTime = 0;
if (hoveredCellObj !== currentCell) {
    if (currentCell && (now - lastSeenInCellTime) < CONFIG.HYSTERESIS_MS) {
        // Salida breve: NO cambiar de celda ni resetear progreso.
        // (hoveredCellObj puede ser null o una celda vecina rozada)
    } else {
        /* lógica actual de cambio de celda */
    }
}
if (hoveredCellObj === currentCell && currentCell) lastSeenInCellTime = now;
```

Nota: si el usuario pasa a otra celda y *permanece* en ella > `HYSTERESIS_MS`, el cambio ocurre normalmente. La histéresis solo absorbe salidas más cortas que el umbral.
**Test:** con cursor simulado (mousemove en modo debug), oscilar sobre el borde de una celda a 5 Hz: el progreso avanza igual.

### F0-7 · Dwell configurable

**Spec:** control en la barra inferior (junto al selector de modo): select con presets `0.8 s / 1.2 s / 2 s / 3 s / 5 s` → setea `CONFIG.DWELL_MS`. Persistir en localforage bajo la clave nueva `miravoz_settings`:

```js
// clave "miravoz_settings"
{ dwellMs: 1200, hysteresisMs: 150, ttsVoiceName: null }
```

Cargar al iniciar; aplicar sin recargar.

### F0-8 · Colores por `colorCategory` (Fitzgerald)

**Spec:** reemplazar la heurística `getAutoColor()` (listas de labels hardcodeadas) por un mapeo del campo nativo. Tabla inicial (hexes tomados de la paleta actual de la app; ajustar visualmente contra AsTeRICS Grid en el test):

| colorCategory | Color | Hex |
|---|---|---|
| CC_PRONOUN_PERSON_NAME | amarillo | `#fff176` |
| CC_VERB | verde | `#81c784` |
| CC_DESCRIPTOR | azul | `#64b5f6` |
| CC_NOUN | naranja | `#ffb74d` |
| CC_IMPORTANT | rojo/rosa | `#ff8a80` |
| CC_SOCIAL_EXPRESSIONS | rosa | `#f48fb1` |
| CC_PLACE | violeta | `#ba68c8` |
| CC_OTHERS / null | gris | `#9e9e9e` |

Prioridad de color de celda: `elData.backgroundColor` explícito > `colorCategory` > sin color. Mantener `getAutoColor()` solo como fallback si no hay ninguno de los dos. Respetar `hidden: true` (no renderizar la celda como interactiva).

### F0-9 · Spans multi-celda

**Spec:** en `renderGrid`, usar `width`/`height` del elemento:

```js
cell.style.gridColumn = `${x + 1} / span ${elData.width || 1}`;
cell.style.gridRow = `${y + 1} / span ${elData.height || 1}`;
```

Ajustar la matriz de ocupación para no generar `empty-cell` debajo de un span. **Test:** un grid de AsTeRICS con celdas 2×1 se ve idéntico en MiraVoz.

### F0-10 · Limpieza y seguridad

- Eliminar `calibDataY` (variable muerta) y la rama inalcanzable `else if (currentCell)` al final de `handleGazeInteraction`.
- Unificar estados: `HOME`, `BOARD`, `CALIB_PENDING`, `CALIB_COUNTDOWN`, `CALIB_SAMPLING` (un solo idioma).
- Definir `CONFIG.ENABLE_CLICK_SOUND = false` e implementar `playClickSound()` (beep corto por WebAudio, ~50 ms, 880 Hz) o eliminar ambas referencias.
- XSS: en las cards de tableros, `bundle.name` y `previewText` van con `textContent`, no `innerHTML` (reestructurar el `infoDiv` con `createElement`).
- Corregir comentario final obsoleto ("cámara prendida por defecto").

### F0-11 · Iris a flag experimental

**Spec:** `CONFIG.EXPERIMENTAL_IRIS = false`. Si es `false`, la opción "Modo Iris" no se renderiza en `mode-select` (removerla del DOM al iniciar). El código de OJOS no se borra. Activable por consola o query param `?iris=1` para investigación.

### Criterios de aceptación — Fase 0

1. Checklist de humo completo (0.7), incluyendo el punto 5 que hoy falla.
2. `.obz` con imágenes embebidas funciona en modo avión (post-carga).
3. En modo Rostro, componer "yo quiero" + 2 ítems en `nuclear.grd` sin selecciones falsas, con dwell en 1.2 s.
4. Cerrar sesión no borra nada.
5. Prueba de usuario: Leticia **con anteojos** — registrar si la calibración funciona (insumo para F1, no bloqueante de F0).

---

## FASE 1 — Motor de acceso de calidad clínica (modo Rostro)

**Objetivo:** pasar de "anda en demo" a "confiable 30 minutos". Se optimiza y mide **solo el modo Rostro (CARA)**; Iris se beneficia de rebote pero no se mide.

### F1-1 · Refactor a módulos ES (prerequisito de la fase)

Partir `app-v4.js` en módulos ES nativos (`<script type="module">`), sin bundler:

```
web/js/
├── main.js          # bootstrap, wiring de eventos
├── config.js        # CONFIG + settings persistidos (miravoz_settings)
├── state.js         # máquina de estados de la app (único mutador de `state`)
├── tracking.js      # MediaPipe, extractFeatures, predicción → emite (rawX, rawY)
├── calibration.js   # flujo 9 puntos, ridge, calidad, persistencia de perfiles
├── filters.js       # OneEuroFilter (F1-2)
├── dwell.js         # histéresis + dwell + cooldown → emite "select(element)"
├── boards.js        # import GRD/OBZ, bundles, renderGrid, navegación
├── speech.js        # TTS: selección de voz, cola, speak()
├── auth.js          # Supabase (bypass actual encapsulado acá hasta F4)
└── ui.js            # modales, toasts, cards, acumulador
```

Reglas: `tracking.js`/`dwell.js` no tocan el DOM del tablero directamente — se comunican por callbacks/eventos (`onGazeMove(x,y)`, `onSelect(el)`). Prohibido el estado global suelto: todo estado compartido vive en `state.js` o `config.js`. **No** agregar framework ni build step en esta fase.

### F1-2 · 1 Euro Filter

Reemplazar el filtro actual (exponencial adaptativo mal llamado Kalman) por 1 Euro (Casiez et al. 2012), el estándar en punteros. Implementación de referencia:

```js
// filters.js
class LowPass {
  constructor() { this.y = null; }
  filter(x, alpha) { this.y = (this.y === null) ? x : alpha * x + (1 - alpha) * this.y; return this.y; }
}
export class OneEuroFilter {
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.xLP = new LowPass(); this.dxLP = new LowPass(); this.tPrev = null; this.xPrev = null;
  }
  alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(x, tMs) {
    const t = tMs / 1000;
    if (this.tPrev === null) { this.tPrev = t; this.xPrev = x; this.xLP.filter(x, 1); this.dxLP.filter(0, 1); return x; }
    const dt = Math.max(t - this.tPrev, 1e-3); this.tPrev = t;
    const dx = (x - this.xPrev) / dt; this.xPrev = x;
    const edx = this.dxLP.filter(dx, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xLP.filter(x, this.alpha(cutoff, dt));
  }
  reset() { this.xLP = new LowPass(); this.dxLP = new LowPass(); this.tPrev = null; this.xPrev = null; }
}
```

Un filtro por eje. Punto de partida: `minCutoff = 1.0`, `beta = 0.02` para CARA. Exponer ambos en `config.js` para tuning. Resetear al iniciar calibración y al cambiar de modo.

### F1-3 · Calibración polinómica de 2º grado + eliminar escalado fijo

**Problema actual:** regresión lineal `[1, fx, fy]` + escalado post-hoc `×1.5/×2.0` hardcodeado (causa del "no puedo bajar" observado con Leticia: amplifica el error sistemático en vez de corregir la no-linealidad).

**Spec:**

1. Función de features compartida entre calibración y predicción:

```js
// tracking.js
export function phi(fx, fy) { return [1, fx, fy, fx * fx, fy * fy, fx * fy]; }
```

Para CARA, `(fx, fy)` = nariz normalizada (landmark 1) como hoy. Para OJOS (experimental), el vector pupila normalizado como hoy.
2. `trainRidgeRegression` opera sobre matrices de 6 columnas. Ridge se mantiene: `lambda = 0.1` para CARA (ajustar empíricamente; con features cuadráticas puede requerir más regularización — probar 0.1, 0.5, 1.0 contra el residual).
3. La predicción es producto punto genérico `dot(weights, phi(fx, fy))` — **eliminar por completo el bloque de escalado** `rawX = cx + (rawX - cx) * 1.5` de `onResults`.
4. Clamp del resultado a `[0, innerWidth] × [0, innerHeight]`.
5. Los perfiles guardados cambian de shape (6 pesos): versionar la clave — `miravoz_calibration_v2` — e ignorar (no migrar) perfiles v1.

### F1-4 · Muestreo de calibración robusto

En `CALIB_SAMPLING` por punto: descartar las muestras de los primeros **200 ms** (sacada de llegada) y, al cerrar el punto, descartar outliers a **>2σ** de la media del punto (por eje, sobre las features). Mínimo 10 muestras válidas por punto; si quedan menos, repetir ese punto automáticamente.

### F1-5 · Métrica de calidad y re-calibración selectiva

Al entrenar: predecir sobre las propias muestras de cada punto y calcular el **error medio por punto** en px. Reglas:

- Score global = media de los 9 errores. UI: "Calibración: Buena (<4% diag) / Regular (<8%) / Mala (≥8%)" (diag = diagonal del viewport).
- Si un punto individual supera el 8% de la diagonal → ofrecer "repetir solo ese punto" (re-samplear y re-entrenar).
- Persistir el score junto a los pesos para mostrarlo en la UI ("calibrado hace 3 días · calidad: buena").

### F1-6 · Cache de bounding boxes

`handleGazeInteraction` llama `getBoundingClientRect()` por elemento por frame. **Spec:** construir `hitRects` (array `{rect, obj}`) al final de `renderGrid`/`loadSavedBoards`; invalidar y reconstruir en `resize`, scroll y cambios de vista. El hit-testing itera sobre el cache.

### F1-7 · Arnés de métricas del motor

Modo test accesible por query param `?benchmark=1`: presenta secuencialmente 20 objetivos aleatorios en grilla 3×3 y luego 4×4 (celdas numeradas); registra por objetivo: acierto/fallo, tiempo hasta selección, celda errónea si la hubo. Al terminar, muestra y persiste el resumen JSON en localforage (`miravoz_benchmarks`, append):

```js
{ ts, mode: "CARA", grid: "3x3", targets: 20, correct: 19, meanTimeMs: 2350, calibScore: 0.031 }
```

Esta métrica es también el **criterio de re-entrada del modo Iris** (si algún día supera 90% en 3×3, se reconsidera).

### Criterios de aceptación — Fase 1

1. Benchmark modo Rostro (usuario sin discapacidad, 5 min): **≥95% en 3×3 y ≥85% en 4×4**.
2. El cursor alcanza las 4 esquinas y el borde inferior sin escalado artificial (verificar visualmente y con el benchmark: los objetivos de la fila inferior no fallan más que el resto).
3. Repetir un punto malo de calibración funciona sin rehacer los 9.
4. Sesión continua de 30 min en modo Rostro sin recalibración forzada.
5. El refactor no rompe el checklist de humo; `app-v4.js` queda eliminado (redirigido a `js/main.js`).
6. Prueba de usuario: repetir el caso "anteojos" de Leticia y comparar score de calibración con/sin.

---

## FASE 2 — Modo Barrido (scanning)

**Objetivo:** tercer modo de acceso, para usuarios sin control de cabeza ni motricidad fina. **Cero hardware:** los switches comerciales (AbleNet Jelly Bean/Big Mack, pulsadores Bluetooth de Mercado Libre, fabricantes 3D locales) emulan un click de mouse o una tecla — MiraVoz solo necesita escuchar un evento de activación.

### F2-1 · Motor de barrido (`scanning.js`)

Nuevo módulo con máquina de estados propia. Dos patrones (los que usa Leticia en Grid/Tobii):

- **`LINEAR`** (elemento por elemento): resalta secuencialmente cada elemento activo; la activación selecciona el elemento resaltado.
- **`ROW_COLUMN`** (fila → elemento): primero resalta filas completas; la activación entra a la fila y barre sus elementos; la segunda activación selecciona. Un "escape" implícito: al terminar la fila sin selección, vuelve al barrido de filas.

```
Estados: SCAN_IDLE → SCAN_GROUPS (filas) → SCAN_ITEMS (dentro de fila) → (select) → SCAN_GROUPS
```

Reglas de temporización y control:

- `scanIntervalMs` (default **1200**), rango 500–4000, por perfil.
- `scanCycles` (default **3**): vueltas completas sin activación → pausa en `SCAN_IDLE` (overlay "tocá para continuar"); cualquier activación retoma.
- Primer elemento de cada ciclo: mantener resaltado un 50% más de tiempo (aterrizaje).
- El orden de barrido es el orden visual (fila por fila, izquierda→derecha). Los **botones del acumulador (play, borrar último, limpiar, atrás, casa) forman el último grupo** del ciclo — imprescindible: sin esto el usuario compone pero no puede reproducir.

### F2-2 · Entrada de activación unificada

```js
// input.js — un solo punto de entrada
function onSwitchActivate(e) { /* debounce 250 ms; delega a scanning.js o dwell según modo */ }
// Fuentes: keydown (Space, Enter), mousedown en cualquier parte, touchstart en cualquier parte
```

- En modo BARRIDO, el click/touch en cualquier punto de la pantalla es activación (los switches USB/BT emulan click o tecla; no hay que distinguir de dónde viene).
- `preventDefault` en Space/Enter para evitar scroll/submit.
- Debounce de 250 ms (los switches 3D locales rebotan — dato de campo de Leticia).

### F2-3 · Resaltado accesible

Clase `.scan-highlight`: borde de **6 px** color `#00ff88` + overlay semitransparente + `transform: scale(1.03)`. Para grupos (filas), un overlay que cubre toda la fila. Alto contraste verificado sobre celdas de cualquier color de fondo (borde doble blanco/verde). Sin depender solo del color (WCAG).

### F2-4 · Feedback auditivo opcional

Por perfil: `scanAudio: "none" | "beep" | "speak"`. `beep` = WebAudio 880 Hz/60 ms al avanzar. `speak` = decir el label del elemento/fila resaltado con la voz TTS a volumen reducido (`utterance.volume = 0.5`), cancelando la anterior (en barrido la cola no sirve: siempre interesa el actual). Al **seleccionar**, el speak normal de la celda funciona como siempre.

### F2-5 · Settings de barrido

Extender `miravoz_settings`:

```js
{ ..., scan: { pattern: "ROW_COLUMN", intervalMs: 1200, cycles: 3, audio: "none" } }
```

UI de configuración junto al selector de modo (los presets de dwell de F0-7 se agrupan en el mismo panel "Opciones de entrada" — referencia: el panel de AsTeRICS que Leticia valoró).

### F2-6 · Accesibilidad estructural

- Celdas: `role="button"`, `aria-label` = label de la celda, `tabindex="0"`; grid container `role="grid"`.
- Toda la app operable por teclado (Tab/Enter) como base — el barrido se monta sobre esa misma capa de activación.

### Criterios de aceptación — Fase 2

1. Con **una sola tecla** (Espacio), un usuario compone y reproduce una frase de 3 pictogramas en `nuclear.grd`, navegando a un sub-tablero y volviendo. Ambos patrones.
2. Funciona con un switch Bluetooth físico real (comprar uno para el test; presupuestado).
3. Tras 3 ciclos sin activación, pausa; una activación retoma.
4. Leticia lo compara contra el barrido del Grid 3 de su paciente: sin bloqueantes funcionales.
5. El barrido incluye acumulador y navegación, no solo celdas.

---

## FASE 3 — Editor de tableros

**Objetivo:** que la profesional cree y edite tableros en MiraVoz sin pasar por AsTeRICS ("me la paso editando: no hay un tablero igual al otro"). **Regla de oro: el modelo de datos del editor ES el formato GRD nativo** (0.5) — se edita el JSON GridData directamente. Así el export es serialización, no traducción.

### F3-1 · Gestión de tableros (home)

Sobre las cards actuales: **Nuevo tablero** (nombre + dimensiones, default 3×4), **Duplicar**, **Renombrar**, **Eliminar** (existe), **Exportar** (F3-5). Crear genera un bundle con un grid vacío GridData válido (con `id`, `label.es`, `rowCount`, `minColumnCount`, `gridElements: []`, `lastUpdateTime`).

### F3-2 · Modo edición de un tablero

Toggle "Editar" dentro del tablero (visible solo para rol profesional desde F4; hasta entonces, siempre visible). En modo edición: el tracking/dwell se pausa; la grilla muestra celdas vacías como slots punteados.

Operaciones: click en slot vacío → crear celda; click en celda → panel de edición; drag & drop para mover celdas (actualiza `x`/`y`); redimensionar grilla (agregar/quitar filas/columnas — al achicar, avisar si hay celdas fuera de rango); handles de span (`width`/`height`).

### F3-3 · Panel de edición de celda

Campos → mapeo GRD:

| Campo UI | GRD |
|---|---|
| Texto (label) | `label.es` |
| Pictograma (búsqueda ARASAAC, F3-4) | `image.url` + `author`/`authorURL`/`searchProviderName: "ARASAAC"` |
| Imagen propia (upload) | `image.data` (Base64, comprimir a WebP ≤ 100 KB) |
| Color | `colorCategory` (selector de 8 categorías Fitzgerald) o `backgroundColor` libre |
| **Hablar**: label / texto custom / silencio | acciones: `GridActionSpeak` / `GridActionSpeakCustom {speakText:{es}}` / sin acción de speak |
| Navegar a… | `GridActionNavigate {toGridId, navType}` — selector de tableros del bundle + "crear tablero nuevo" al vuelo |
| Nivel de vocabulario | `vocabularyLevel` (int, F3-6) |
| Oculta | `hidden` |

**Cambio de runtime asociado (F3-3b):** `handleCellClick` hoy habla siempre el label. Nueva semántica interoperable: si la celda tiene `GridActionSpeakCustom` → hablar `speakText.es`; si tiene `GridActionSpeak` → hablar label; si no tiene ninguna acción de speak **y** el bundle fue creado/editado en MiraVoz → silencio; para bundles importados legacy sin editar, mantener el comportamiento actual (hablar label) para no romper tableros existentes. Flag por bundle: `speechModel: "actions" | "legacy"`.

### F3-4 · Búsqueda ARASAAC integrada

- Search: `GET https://api.arasaac.org/api/pictograms/es/search/{término}` → array con `_id`; imagen: `https://api.arasaac.org/api/pictograms/{_id}?download=false&color=true` (patrón ya presente en los GRD importados). Verificar contrato exacto en `arasaac.org/developers` al implementar.
- Grid de resultados (~20), click para asignar. Guardar SIEMPRE la atribución (`author: "Sergio Palao / ARASAAC"`, `authorURL`) como hace AsTeRICS.
- Cachear la imagen elegida en `image.data` además de `url` (pre-trabajo del offline de F5).
- Mostrar la atribución ARASAAC en un "Acerca de" de la app (obligación CC BY-NC-SA).

### F3-5 · Export `.grd` y `.obz`

- **`.grd`:** serializar `{grids: [...bundle.boards]}` tal cual (por eso el copy-on-write del invariante 0.3: los campos preservados hacen el archivo re-importable en AsTeRICS). Actualizar `lastUpdateTime` de los grids modificados. Descargar como `<nombre>.grd`.
- **`.obz`:** transformación inversa del import: `manifest.json` (`root`, `format: "open-board-0.1"`, `paths`), un `.obf` por grid (buttons/grid.order/images), imágenes embebidas en `images/`. Las capacidades sin equivalente OBF (wordForms, youtube, etc.) se omiten — documentar la pérdida en el modal de export.
- **Test automatizado de round-trip** (script Node en `tools/roundtrip-test.mjs`): import(export(import(nuclear.grd))) y deep-compare de campos esenciales (labels, posiciones, spans, colores, acciones speak/navigate, imágenes). Correr en CI o a mano antes de cerrar la fase.

### F3-6 · Niveles de dificultad (diferencial)

Usar el campo **nativo** `vocabularyLevel` (ya existe en GridElement — interopera con AsTeRICS):

- En edición: cada celda tiene nivel 1–3 (1 = esencial). En el panel del tablero, selector "Nivel activo".
- En runtime: se renderizan solo las celdas con `vocabularyLevel <= nivelActivo` (null = siempre visible). **Re-layout automático**: las celdas visibles se redistribuyen centradas en una grilla reducida (algoritmo: mantener orden de lectura, elegir la grilla más cuadrada que las contenga, escalar celdas al máximo). Las posiciones originales no se tocan (el re-layout es solo de presentación).
- El nivel activo es parte del perfil del usuario (F4) — "el mismo tablero, 3 celdas grandes para Bruno y completo para Mateo" sin duplicar.

### F3-7 · Decisión de framework (evaluación, no mandato)

El editor es la primera UI compleja (drag & drop, formularios, undo). Opciones aceptadas: (a) seguir vanilla con módulos + `<template>`; (b) isla Vue 3 / Svelte SOLO para editor y home. Condiciones duras: runtime del tablero + tracking + barrido permanecen vanilla y sin build obligatorio para el resto de la app; si se introduce build (Vite), el output debe seguir siendo estático-deployable en Vercel. Documentar la decisión en `CHANGELOG.md`.

### Criterios de aceptación — Fase 3

1. Leticia crea desde cero un tablero de actividad real (grilla custom, pictogramas ARASAAC, colores, una celda silenciosa, una con texto custom, navegación a un sub-tablero creado al vuelo) **sin tocar AsTeRICS**, y le toma menos que el mismo flujo en AsTeRICS.
2. Round-trip automatizado en verde + verificación manual: el export `.grd` abre en AsTeRICS Grid con enlaces, colores e imágenes intactos; el `.obz` abre en Cboard.
3. Un tablero con niveles 1/2/3 alterna entre 3 celdas grandes y grilla completa sin re-edición.
4. Undo de al menos la última operación destructiva (borrar celda / borrar tablero → papelera o confirm).

---

## FASE 4 — Usuarios, perfiles y asignación

**Objetivo:** el flujo profesional↔usuarios que en AsTeRICS es "un chino": la profesional trabaja siempre desde su cuenta, asigna tableros con permisos y ve quién tiene qué. Diferencial de producto principal.

### F4-1 · Reactivar autenticación (y salir del bypass)

- **Profesionales:** email + password de Supabase Auth (evita el rate-limit del OTP por email que motivó el bypass). Opcional: mantener OTP como alternativa con SMTP propio (Resend/Postmark, ~gratis en el volumen actual). Eliminar el mock de `handleAuthChange`; `auth.js` expone `getSessionUser()` real.
- **Usuarios (los chicos): no tienen email.** Acceso por **código de dispositivo**: la profesional genera un código/QR de 8 caracteres por usuario; en la tablet del chico se ingresa una vez y el dispositivo queda vinculado (token persistido en localforage). Implementación: tabla `access_codes` + Edge Function que canjea código por un JWT custom (rol `aac_user`, claims con `user_id`), o alternativa más simple: usuarios anónimos de Supabase Auth vinculados por el canje del código. Elegir la más simple que satisfaga RLS.
- **Modo sin cuenta sigue existiendo:** la app debe seguir funcionando 100% local sin login (como hoy). El login agrega sync y asignaciones, no condiciona el uso.

### F4-2 · Esquema de datos (Postgres, reemplaza el bucket Storage)

Los tableros pasan de Supabase Storage a **tablas con JSONB** (querying + RLS real; hoy el bucket `boards` tiene la anon key expuesta y políticas sin auditar — cerrar ese hueco: bucket privado o eliminado).

```sql
create table professionals (
  id uuid primary key references auth.users(id),
  display_name text not null
);

create table aac_users (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id),
  display_name text not null,
  home_board_id uuid,            -- "la casita"
  settings jsonb not null default '{}',  -- modo acceso, dwellMs, scan{}, voz, nivel vocabulario
  created_at timestamptz default now()
);

create table boards (
  id uuid primary key default gen_random_uuid(),
  owner_professional_id uuid not null references professionals(id),
  name text not null,
  bundle jsonb not null,          -- el bundle completo (0.4)
  updated_at timestamptz not null default now()
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id),        -- original de la profesional
  aac_user_id uuid not null references aac_users(id),
  copy_bundle jsonb not null,     -- COPIA asignada (la divergencia es deseable en CAA)
  permission text not null check (permission in ('read_only','editable')),
  copy_updated_at timestamptz not null default now(),
  assigned_at timestamptz default now(),
  unique (board_id, aac_user_id)
);

create table access_codes (
  code text primary key,
  aac_user_id uuid not null references aac_users(id),
  expires_at timestamptz not null,
  redeemed_at timestamptz
);
```

**RLS (esquema, afinar al implementar):** `professionals`: cada uno ve/edita solo su fila. `aac_users`, `boards`, `assignments`: acceso total para el profesional dueño (`professional_id = auth.uid()` / vía join); el rol `aac_user` solo **lee** sus `assignments` y **actualiza** `copy_bundle` únicamente si `permission = 'editable'`; `access_codes`: solo el dueño crea, el canje pasa por Edge Function con service role.

### F4-3 · Modelo de asignación (decisiones de producto, de la sesión con Leticia)

1. Asignar = **copiar**: `copy_bundle` es un snapshot independiente. Cada usuario diverge legítimamente (todo es a medida).
2. **Republicar** (opcional y explícito): botón en el tablero original "actualizar a los asignados" → lista con checkboxes de a quiénes pisar. **Nunca automático.** Advertir que pisa cambios locales de la copia.
3. La profesional **edita cualquier copia asignada desde su propia cuenta** (el editor de F3 abre `assignments.copy_bundle` directamente).
4. **Vista de asignaciones** (nueva pantalla "Mis usuarios"): lista de usuarios → tableros asignados de cada uno (permiso, última edición); y vista inversa en cada tablero ("asignado a: Mateo ✏️, Bruno 🔒").

### F4-4 · Experiencia del usuario final (el chico)

Dispositivo vinculado → la app abre **directo en su casita** (home_board_id): sin login visible, sin gestión, sin botón de importar; solo sus tableros asignados y los controles del acumulador. Sus `settings` (modo de acceso, dwell, barrido, voz, nivel de vocabulario de F3-6) se aplican al arrancar. La calibración sigue siendo local al dispositivo (no sincroniza: depende de cámara/pantalla/postura físicas).

### F4-5 · Sincronización (simple, no CRDT)

- Estrategia: **last-write-wins por tablero** usando `updated_at`/`copy_updated_at` + `lastUpdateTime` interno de los grids.
- Cliente: cola de cambios pendientes en localforage (`miravoz_sync_queue`); al reconectar, push; al abrir la app, pull de lo más nuevo.
- Conflicto (editado en dos lados desde el último sync): gana el más nuevo y se notifica con toast persistente "El tablero X fue actualizado desde otro dispositivo — ver detalles", guardando la versión pisada en una clave de respaldo (`miravoz_conflict_backup_<id>`, retener las últimas 3) para rescate manual.
- CRDTs quedan explícitamente fuera del alcance: solo si la edición concurrente real aparece como problema de campo.

### F4-6 · Settings por perfil

Mover `miravoz_settings` (F0-7/F2-5) a `aac_users.settings` cuando hay sesión, manteniendo copia local como cache. Shape unificado:

```js
{
  accessMode: "MANUAL" | "FACE" | "SCAN",
  dwellMs: 1200, hysteresisMs: 150,
  scan: { pattern: "ROW_COLUMN", intervalMs: 1200, cycles: 3, audio: "none" },
  tts: { voiceName: null, rate: 1.0 },
  vocabularyLevel: 3
}
```

### Criterios de aceptación — Fase 4

1. Flujo completo de Leticia cronometrado contra AsteRICS: crear 3 usuarios → asignarles un tablero grupal → corregir la copia de uno desde su cuenta → ver el mapa de asignaciones. Debe ser drásticamente más corto (sin export/import ni cambios de cuenta).
2. Tablet vinculada por código: abre en la casita del usuario con sus settings; no puede ver ni editar nada ajeno (verificar RLS con requests manuales).
3. Republicar actualiza las copias elegidas y solo esas.
4. Permiso `read_only`: la copia no es editable desde el dispositivo del usuario; `editable`: sí (caso padres).
5. Dos dispositivos del mismo usuario convergen tras sync; el conflicto genera toast + backup.
6. La app sigue funcionando 100% sin cuenta (modo local puro).
7. Auditoría de seguridad mínima: bucket Storage legado cerrado, RLS probada con anon key, ninguna clave de servicio en el cliente.

---

## Apéndice A — Orden de dependencias entre fases

```
F0 (estabilización) ──► F1 (motor + refactor a módulos)
                          │
                          ├──► F2 (barrido; usa dwell/input refactorizados)
                          └──► F3 (editor; usa boards.js refactorizado)
                                  │
                                  └──► F4 (usuarios; usa editor para copias asignadas)
```

F2 y F3 pueden desarrollarse en paralelo tras F1 si hay capacidad; F4 requiere F3 terminada.

## Apéndice B — Deuda de repositorio (hacer en F0, sin ID formal)

- `.gitignore`: agregar `venv/`, `weights/`, `.DS_Store`, `*.log`.
- Renombrar `error.log` → `asterics/ayuda-backup.grd` (es un volcado GRD de 2 MB, no un log).
- Mover el prototipo Python (`*.py`, `requirements.txt`) a `legacy/`.
- Crear `CHANGELOG.md`.

## Apéndice C — Temas abiertos (no bloquean F0–F4, no olvidar)

1. **Licencia ARASAAC (CC BY-NC-SA):** si MiraVoz cobra, resolver convenio con Gobierno de Aragón o estrategia alternativa ANTES del lanzamiento comercial. El uso actual (desarrollo/investigación, atribución incluida) está en regla.
2. **Voces TTS:** la calidad de Web Speech varía por navegador/OS; en F4+ evaluar voces neuronales por API con fallback local. `lang` hoy fijo en `es-ES` — al elegir voz, respetar su locale real (es-AR/es-MX).
3. **PWA/offline completo** (ex Fase 5) y **diferenciadores IA** (ex Fase 6): en `ROADMAP.md`.

