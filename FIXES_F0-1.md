# Fase 0.1 — Hallazgos de las pruebas de usuario (04/07/2026)

Resultados de la primera sesión de pruebas sobre el build de Fase 0. Diagnóstico previo hecho contra los datos reales de `nuclear.grd`.

---

## Causa raíz #1 (explica la mayoría de los síntomas): cache-busting no actualizado

`index.html` sigue cargando `app-v4.js?v=15` y `style.css?v=6` — **los mismos version params de antes de la Fase 0**, pese a que ambos archivos cambiaron. Los navegadores que ya visitaron la app (demo del 27/06) sirven el JS y CSS viejos desde caché, sobre el HTML nuevo.

Síntomas observados que esto explica:

- "Alimentos" todo en blanco (los datos tienen `CC_NOUN` en las 45 celdas → con el JS nuevo serían naranjas; el JS viejo cacheado coloreaba por labels y "ENSALADA" no estaba en las listas — por eso el tablero principal SÍ se veía bien: "YO", "QUIERO", "COMIDA" estaban hardcodeados).
- Acumulador sin el estilo nuevo (texto bajo pictograma).
- Menú de fijación "en otro formato" (markup nuevo + CSS/JS viejos).
- Posiblemente la entrada intermitente al tablero con dwell (JS viejo sin histéresis 2.0).

### Fix F0.1-1 (obligatorio)

1. Bumpear a `app-v4.js?v=16` y `style.css?v=7` en `index.html`. **Regla permanente: todo cambio en JS/CSS bumpea su `?v=`.** (Mejor aún: usar un hash o timestamp de build.)
2. Redesplegar a Vercel (verificar que producción tenga el commit de Fase 0 — confirmar visualmente que el selector de fijación tiene 5 presets incluido 5.0s, que solo existe en el build nuevo).
3. **Protocolo de re-test:** ventana de incógnito o hard-refresh (Ctrl+Shift+R) antes de reportar bugs.

**→ Re-correr `TESTING_FASE0.md` después de esto.** Varios hallazgos deberían desaparecer solos.

---

## Bugs/reportes a atender (independientes del caché)

### F0.1-2 · Radio sin imágenes — DIAGNOSTICADO: bundle envenenado por el import viejo

Verificado tras el hard-reload (04/07): las imágenes de Radio siguen rotas, pero **el código actual NO es el culpable**. Cadena confirmada con los archivos reales:

1. En `nuclear.obz`, las imágenes de Radio son **solo `path` interno** (`images/xxx.jpg`), sin `url` externa de fallback (verificado en el zip).
2. El tablero fue **importado cuando corría el JS viejo** (regex rota) → `imageMap` quedó vacío → el bundle se guardó en IndexedDB con `image.url = undefined`.
3. Ese bundle envenenado persiste; el fix del regex no lo repara retroactivamente.

**Solución inmediata (tester):** eliminar el tablero "nuclear" en la app y **re-importar** `nuclear.obz` con el build nuevo. Las imágenes de Radio deben aparecer (los 15 Base64 del archivo validan OK).

**Tarea de código (prevención):** agregar `importerVersion: <int>` al bundle en el momento del import. Al abrir un bundle con `importerVersion` menor a la actual (o ausente), mostrar aviso "Este tablero fue importado con una versión anterior — reimportalo para corregir posibles errores". Barato ahora, invaluable cuando haya usuarios reales con tableros persistidos.

Nota adicional de la captura: las 10 celdas superiores de Radio no tienen label (logos de emisoras con `label: {}` vacío) — **eso es fiel al archivo original, no es bug**.

### F0.1-3 · Rediseño del acumulador (feedback de UX, no regresión)

Dos pedidos de Esteban sobre la barra de frases:

1. **Fondo blanco de los ítems:** el `background: rgba(255,255,255,0.9)` de `.sentence-item` no convence. Cambiar a un estilo integrado al tema oscuro (ej. fondo translúcido oscuro `rgba(255,255,255,0.12)` con borde sutil, texto claro; los pictogramas ARASAAC tienen fondo blanco propio — contenerlos en un recuadro blanco SOLO alrededor de la imagen, no de todo el ítem).
2. **Que entren más ítems sin scroll:** hoy con `min-width: 120px` entran ~3-4 y después scrollea. Objetivo: que entren al menos 8 visibles en una notebook. Achicar `min-width` a ~64-72px, imagen arriba y texto abajo más compacto. El scroll queda como fallback para frases largas (no eliminar el contenido, solo postergarlo — decisión ya tomada en F0-5: nunca perder el inicio de la frase).

### F0.1-4 · Entrada al tablero con dwell intermitente ("a veces entra, a veces no")

Si persiste tras el cache-bust, hay un candidato real en el código actual: **`loadSavedBoards()` se ejecuta múltiples veces al iniciar** (la llamada top-level + `handleAuthChange` vía `checkSession()` + `onAuthStateChange` que Supabase dispara también al inicio). Cada corrida reconstruye las cards y reemplaza `activeHomeElements`; si el dwell está en curso durante una reconstrucción, `currentCell` queda apuntando a un nodo DOM huérfano (rect = 0,0,0,0) y la selección "se pierde".

**Fix:** (a) eliminar la llamada redundante — dejar UNA sola fuente de verdad para el render inicial (el `onAuthStateChange` basta; borrar el `loadSavedBoards()` suelto y el de `handleAuthChange`, o al revés); (b) en `loadSavedBoards`, si `currentCell`/`candidateCell` referencian elementos que se van a descartar, resetearlos (`currentCell = null; candidateCell = null;`) antes de reemplazar `activeHomeElements`.

### F0.1-5 · Selector de fijación: verificar formato tras cache-bust

Esteban reporta que en la pantalla principal el menú se ve "en otro formato" con un texto tipo "fijación 12082". Probable víctima del CSS cacheado. Tras el fix de caché, verificar que se vea como el selector de modo (misma clase `glass-select`, mismo alto). Si persiste, capturar screenshot y revisar el CSS aplicado. Mejora opcional mientras se toca: tooltip o label "Tiempo de fijación" para que se entienda qué es (Esteban no supo para qué servía a primera vista — si él no lo entiende, un padre tampoco).

### F0.1-6 · Colores de "Alimentos": confirmar contra AsTeRICS

Tras el cache-bust, las 45 celdas de Alimentos deben verse **naranja** (`CC_NOUN` → `#ffb74d`). Esteban debe confirmar visualmente contra AsTeRICS Grid (dudó de cuál era el color correcto). Si AsTeRICS muestra otro tono para sustantivos, ajustar SOLO el hex de la tabla, no la lógica.

---

## Orden de trabajo sugerido

1. F0.1-1 (caché/deploy) — 10 minutos, desbloquea todo lo demás.
2. Re-test completo de `TESTING_FASE0.md` en incógnito.
3. F0.1-4 (limpieza del arranque) — hacerlo aunque el síntoma desaparezca: es un bug latente real.
4. F0.1-3 (acumulador) — diseño, con captura de antes/después.
5. F0.1-2, F0.1-5, F0.1-6 — verificar tras el re-test; arreglar solo lo que persista.
