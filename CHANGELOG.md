# Changelog

Todas las versiones y cambios notables del proyecto MiraVoz serán documentados en este archivo.

## [0.8.1m] - 2026-10-17

- **Changed**: en el inicio se filtra por **una sola etiqueta por vez** (antes se combinaban y quedaba confuso). Tocar la etiqueta elegida vuelve a "Todos".

## [0.8.1l] - 2026-10-17

- **Changed**: "Dar copia": para quien ya tiene su copia, el orden es nombre, "Editar copia", estado ("Actualizado" / "Con cambios"), "Copiar mi versión" y "Traer sus cambios".

## [0.8.1k] - 2026-10-17

- **Changed**: barra de edición: "Filas" y "Columnas" cada uno en su recuadro, con − y + a los lados de la cantidad actual, y más aire entre grupos. "Espacio" pasa a llamarse "Espaciado".

## [0.8.1j] - 2026-10-17

- **Added**: **Rehacer** en la edición (Cmd/Ctrl+Shift+Z). Deshacer y Rehacer pasan a ser íconos de flecha curva, grisados cuando no hay nada para deshacer o rehacer.
- **Changed**: la barra de celdas seleccionadas es azul (como "Seleccionar"), va en una sola línea y "Listo" queda a la derecha, más separado.

## [0.8.1i] - 2026-10-17

- **Fixed**: al estirar una celda desde el borde, el soltar se tomaba como un toque y abría el editor de la celda.

## [0.8.1h] - 2026-10-17

- **Changed**: "Dar copia" muestra el mismo cartel que "Tableros de <usuario>" ("Actualizado" en verde, "Con cambios" en naranja; el detalle de cuál cambió queda al pasar el mouse) y "Editar su copia" pasa a la derecha.

## [0.8.1g] - 2026-10-17

Más facilidad para editar tableros.

- **Changed**: el arrastre de celdas usa eventos de puntero (mouse, lápiz y dedo, también en el iPad) y muestra la **celda entera** siguiendo al puntero y dónde va a caer (verde si entra, rojo si no). Con el dedo: mantener apretado un instante para levantarla; mantener y soltar sin mover abre el menú de la celda.
- **Added**: **selección múltiple** ("Seleccionar" en la barra, Shift/Cmd + clic o recuadro desde un lugar vacío): arrastrar una mueve todas; barra con Duplicar, Ocultar/Mostrar y Eliminar; flechas, Supr, Esc y Cmd/Ctrl+A.
- **Added**: **estirar desde el borde** derecho (ancho), el de abajo (alto) o la esquina.
- **Added**: **insertar o eliminar filas y columnas intermedias** (botón "···" de cada fila y columna, o botón derecho sobre una celda). Solo se elimina si está vacía.
- **Added**: botón **Deshacer** y Cmd/Ctrl+Z en edición (hasta 20 pasos).
- **Changed**: tarjetas de "Tableros de <usuario>": "Permisos:", "Sincronización:" y "Con cambios".

## [0.8.1f] - 2026-10-17

- **Fixed**: "Copiar mi versión" y "Traer sus cambios" fallaban al guardar la versión de respaldo de una copia (permiso de la base): ahora usan la misma función del servidor que Claude.
- **Changed**: tarjeta del inicio con Asignar y Etiquetas a la izquierda y "…" a la derecha.
- **Changed**: "Tableros de <usuario>": textos más chicos para que el permiso y la sincronización se lean enteros.

## [0.8.1e] - 2026-10-17

- **Changed**: "Tableros de <usuario>": arriba a la derecha se elige el **tablero de inicio** (uno o ninguno). Cada tarjeta: tocarla abre la copia para editar (al volver al inicio se vuelve a esta pantalla), tacho para quitar, **Permisos** ("Solo visualización" / "Modificable"), **Sincronización** ("Actualizado" / "Versiones con cambios") y "Copiar mi versión" / "Traer sus cambios" (grisados si están iguales).
- **Changed**: tarjeta del inicio más liviana: Asignar, Etiquetas y un menú "…" con Exportar, Duplicar y Eliminar.
- **Changed**: el lápiz de editar es amarillo siempre (más fuerte al editar); el cartel "Estás editando la copia de…" va abajo de la grilla.
- **Removed**: botón "Copiar para Claude" de la barra de edición.

## [0.8.1d] - 2026-10-17

Devolución de Leti en producción.

- **Fixed**: en el editor no se llegaba a las filas de abajo de tableros grandes: la grilla se ajusta a la pantalla y, si no entra, se desplaza.
- **Changed**: barra de edición en dos filas (Tablero, páginas y Dificultad arriba; Filas, Columnas, Espacio, Fondo y "Copiar para Claude" abajo a la derecha) y color de edición amarillo más fuerte, igual al lápiz.
- **Added**: **sincronizar copias**: cada copia muestra si está igual al original o cuál cambió, con "Enviar mi versión" y "Traer sus cambios" (antes de pisar se guarda la versión anterior). Están en "Tableros de <usuario>" y en el diálogo de asignar, que además es más ancho y tiene "Editar su copia".
- **Changed**: "Tableros de <usuario>" con tarjetas y miniaturas como el inicio.
- **Changed**: inicio con la barra en una sola línea (etiquetas con flechitas si no entran), más ancho y tarjetas más compactas.

## [0.8.1c] - 2026-10-12

Mejoras de la demo con Leti.

- **Fixed**: en Rostro con Modo protegido no había cómo volver a calibrar: ahora hay "Calibrar" junto a "Alinear" y, dentro del tablero, un candado en la barra de la frase con Alinear, Calibrar de nuevo, Ir al inicio y Salir (no es objetivo de la mirada ni del barrido).
- **Fixed**: en Barrido con sonido "Decir", el anuncio del siguiente resaltado cortaba la palabra elegida ("elegís batido y no dice batido"): después de elegir se espera a que se diga.
- **Fixed**: la barra de edición se desbordaba en el iPad (ahora pasa a otra línea) y el color de fondo no se aplicaba con el selector del iPad.
- **Changed**: al crear un usuario (en la app o desde Claude) el **registro de uso viene activado**, con la declaración de consentimiento visible y destildable.
- **Added**: con color de fondo, las **celdas vacías son transparentes** (separadores); **espacio entre celdas** por página (Automático, Chico, Normal, Grande, Muy grande); **"Mostrar el texto en la celda"** (solo imagen); **agrandar/achicar una celda arrastrando su esquina**.
- **Added**: **recuadro del barrido** configurable (normal, grueso o muy grueso; amarillo, rojo, azul o negro).

## [0.8.1b] - 2026-10-12

- **Added** (Claude): `editar_pagina` acepta **fondo** (código #rrggbb o nombre como "negro", "celeste"; "ninguno" lo quita) y `ver_tablero` lo muestra.
- **Added** (Claude): `poner_celdas` acepta **oculta** (true/false) e **imagen_url**: imagen propia desde una dirección https pública (PNG, JPEG, GIF o WebP, hasta 1 MB). El servidor la descarga y la guarda dentro del tablero; rechaza direcciones no públicas, SVG y archivos grandes.

## [0.8.1a] - 2026-10-12

- **Added**: **imagen propia** en las celdas ("Subir imagen propia": foto o dibujo, también la cámara del iPad). Se achica a 512 px (PNG si tiene transparencia, JPEG si es foto), queda dentro del tablero y anda sin conexión. "Quitar imagen" la saca.
- **Added**: **celdas grandes**: en el editor de celda, "Tamaño en la grilla" (ancho × alto). Si tapa otras celdas, avisa antes de quitarlas. Mover con arrastre respeta los tamaños (1×1 se intercambian; una grande se mueve solo si entra). Al achicar la grilla, las celdas cortadas se ajustan.
- **Added**: **botón derecho** sobre una celda: Editar, Duplicar, Copiar, Cortar, Pegar, Ocultar/Mostrar y Eliminar (en un lugar vacío: Nueva celda o Pegar). Entra a edición si el tablero se puede editar.
- **Added**: **color de fondo de la página** en la barra de edición ("Fondo" / "Sin fondo").
- Las celdas ocultas se ven atenuadas al editar.

## [0.8.0a] - 2026-10-12

Primera versión de la serie 0.8: Manual, Barrido, Rostro y Mirada; Modo protegido; voz por persona; Favoritas, Deshacer y Detener; respaldo; ayuda para Claude.

- **Fixed**: Configuración sin scroll también en el iPad (Safari deja menos alto): textos de ayuda de una línea, controles más compactos en pantallas bajas, el registro de uso con su botón en la misma línea.
- **Changed**: la sección "Modo Rostro" pasa a **"Fijación (Rostro y Mirada)"**, porque el mismo tiempo se usa en los dos modos.

## [0.7.9f] - 2026-10-12

- **Removed**: el modo **Iris** (seguimiento de la mirada con la cámara, experimental) y todo lo relacionado: su modelo (`gaze-model.js`), el aprendizaje implícito (`?implicit=1`), el parámetro `?iris=1`, sus ramas en la cámara y la calibración, textos y tests. Quedan Manual, Barrido, Rostro y Mirada (Seguimiento ocular del dispositivo). Si un dispositivo tenía guardado Iris, arranca en Manual.

## [0.7.9e] - 2026-10-12

- **Fixed**: lista de tableros con el mismo margen a izquierda y derecha; las flechas de página van centradas (horizontal y verticalmente) en el margen derecho.

## [0.7.9d] - 2026-10-12

- **Fixed**: las flechas de página quedaban pegadas al borde derecho y centradas en la pantalla; ahora van dentro del margen derecho de la lista y centradas sobre ella.

## [0.7.9c] - 2026-10-12

- **Added**: herramienta **`ayuda_miravoz`** en el conector de Claude: guía de uso por tema (modos, Mirada, Barrido, Rostro, parpadeo, Modo protegido, tablero, frase, Favoritas, inicio, editor, Configuración, voz, sin conexión, respaldo, Practicar, Mis usuarios, vinculación, Estadística, versiones). Las instrucciones le piden a Claude consultarla antes de responder preguntas de uso. La guía vive en `web/api/_ayuda.js` y se actualiza con cada publicación. Hay que volver a conectar el conector en Claude para verla.

## [0.7.9b] - 2026-10-12

- **Changed**: en **Mirada** la fijación la hace MiraVoz (su tiempo, la barra de progreso en la celda, la pausa después de elegir y el registro): el puntero del Seguimiento ocular del iPad es el cursor. En el iPad se deja prendido el Seguimiento ocular y se apaga "Control por permanencia". Si el iPad igual elige, no se elige dos veces y se avisa cómo apagarlo.

## [0.7.9a] - 2026-10-12

- **Added**: en Rostro con Modo protegido, botón **Alinear** arriba (junto a "Salir") para quien asiste: vuelve a la posición de la calibración sin perderla (si no hay referencia, calibra). No es un objetivo de la fijación.
- Versionado: desde acá cada publicación lleva letra (0.7.9a, 0.7.9b…) hasta que se decida pasar a 0.7.10.

## [0.7.9] - 2026-10-12

- **Changed**: Barrido, Rostro y Mirada (e Iris, experimental) usan siempre el **Modo protegido**. Solo Manual queda sin protección. "Salir" (con confirmación) vuelve a Manual; para recalibrar Rostro: Salir → elegir Rostro de nuevo.

## [0.7.8c] - 2026-10-12

- **Changed**: orden de los modos: Manual, Barrido, Rostro y Mirada.

## [0.7.8b] - 2026-10-12

- **Changed**: los botones de página están siempre visibles; cuando no hay más para ver en esa dirección quedan grisados (antes aparecían y desaparecían).

## [0.7.8] - 2026-10-12

- **Added**: modo de acceso **Mirada**: para usar MiraVoz con el Seguimiento ocular del propio dispositivo (iPad: Accesibilidad → Seguimiento ocular). Funciona como Manual (MiraVoz no usa su cámara) y activa el **Modo protegido**. Si en unos segundos no se detecta el puntero del sistema, avisa cómo activarlo. Las selecciones quedan registradas como "mirada".
- **Added**: **Modo protegido**: pantalla completa; quedan los tableros, Practicar y las etiquetas. Se ocultan el selector de modo, Recalibrar, Configuración, buscar, ordenar, usuarios y todo lo que edita. Se sale con "Salir" + confirmación.
- **Added**: botones grandes de **página anterior / siguiente** en la lista de tableros, para pasar con la mirada (o con Rostro y Barrido) sin deslizar.

## [0.7.7e] - 2026-10-12

- **Added**: Configuración → Voz: opción "La de Ajustes del dispositivo" (España, México o Argentina). Safari en iPad no lista las voces "Mejoradas" descargadas; con esta opción MiraVoz no elige voz y el sistema usa la configurada en Accesibilidad → Contenido leído.
- **Changed**: las voces que necesitan internet (por ejemplo "Google español" en Chrome) se marcan así en la lista, y sin conexión se usa una voz local.

## [0.7.7d] - 2026-10-12

- **Fixed**: en Configuración → Voz, el nombre de la voz se cortaba (0.7.7c lo ensanchó pero cortaba velocidad y tono): ahora la voz va a lo ancho y debajo velocidad, tono y Probar.

## [0.7.7b] - 2026-10-12

- **Changed**: Configuración sin scroll: a la izquierda Rostro, Barrido y Parpadeo; a la derecha Voz (voz, velocidad y tono en una fila), Sin conexión y respaldo, y Registro. Textos de ayuda de la voz más cortos.
- Versionado: los ajustes chicos llevan letra (0.7.7b) en `appVersion` de package.json, sin gastar número.

## [0.7.7] - 2026-10-12

- **Removed**: la voz natural Piper de 0.7.6 (era demasiado lenta incluso en una MacBook). Se borra el espacio que ocupaba si se había descargado.
- **Changed**: Configuración → Voz: la voz se elige **por persona** (en la tablet vinculada, la de ese usuario), con **velocidad** (lenta a rápida) y **tono** (grave a agudo). En automático se prefieren las voces "mejoradas"/"premium" del dispositivo, y si no hay ninguna se explica cómo bajarlas (iPad, Mac, Android, Windows).

## [0.7.6] - 2026-10-12

- **Added** (prototipo): **voz natural** en Configuración → Voz. Usa Piper, una voz neural que corre en el propio dispositivo (Safari en iPad, Chrome en Android o en la compu): suena mucho menos robótica, es la misma con y sin conexión y el texto nunca sale a internet. Voces: Daniela (Argentina, femenina) y Ald (México, masculina). Se descarga una vez (unos 145 o 95 MB); si falla, se usa la voz del dispositivo. Las palabras de la página se preparan de fondo para que suenen sin demora.
- **Added**: elegir la voz del dispositivo (las "mejoradas" primero) y botón **Probar**, que muestra cuánto tarda la voz natural en este equipo.
- **Added**: `/voz-prueba.html`, página de diagnóstico de la voz natural.

## [0.7.5] - 2026-10-12

Primera tanda del análisis de roadmap (revisión sobre 1.9.7): arreglos de confiabilidad y "comunicar con confianza".

- **Added**: **Deshacer** en la barra de la frase. Aparece después de borrar (último, todo o una letra) y recupera la frase exacta; desaparece al agregar algo nuevo.
- **Added**: **Detener**: mientras se dice la frase, el botón Decir pasa a Detener y corta la voz sin borrar la frase.
- **Added**: **Favoritas**: la estrella de la barra abre las frases guardadas de esa persona ("Guardar la frase", decirla con una sola selección, "Quitar una"). Se eligen con el mismo acceso que el tablero y no reordenan el tablero.
- **Added**: **Respaldo** en Configuración ("Descargar respaldo" / "Restaurar respaldo"): tableros de la cuenta, favoritas y palabras aprendidas. Restaurar nunca reemplaza: agrega tableros nuevos y suma lo demás. No incluye tokens, calibraciones ni el registro de uso.
- **Changed**: la predicción de palabras aprende por persona (antes, una sola para todo el navegador).
- **Changed**: Estadística: "Cansancio" pasa a "Variación del tiempo entre selecciones" (no diagnostica fatiga) y "Celdas que no usó" a "Sin uso registrado en el período". Las instrucciones para Claude ya no sugieren mover celdas por frecuencia ni quitar las que no se usan.
- **Fixed**: el registro de uso pendiente no se envía como si fuera de otro usuario si la tablet se vincula a otra persona; cada evento tiene un id para no duplicarse en reintentos (`supabase/12_registro_sin_duplicados.sql`).
- **Fixed**: en Barrido, el parpadeo elige lo resaltado al empezar a cerrar los ojos (el resaltado se queda quieto durante el gesto).
- **Fixed**: en Practicar → Parpadear se puede salir solo con parpadeo (sobre "Actividades" con el cursor; en Barrido, el globo y "Actividades" se alternan).
- **Fixed**: la voz que esperaba el primer toque en iPad ya no dice una frase que se borró o se detuvo.
- **Fixed**: las opciones de parpadeo ya no se ven cuando el parpadeo está desactivado.

## [0.7.0] - 2026-10-12

- **Changed**: renumeración de versiones. MiraVoz todavía no está en producción, así que pasa a la serie 0.x: esta versión (el mismo código que 1.9.9) es la **0.7.0**. Desde acá cada publicación sube el tercer dígito (0.7.1, 0.7.2…); 0.8 y 0.9 serán releases importantes y la 1.0.0 llega cuando se use en producción. Las entradas 1.0.0–1.9.9 de abajo son la numeración anterior y quedan como historia.

---

_Numeración anterior (1.0.0 – 1.9.9), reemplazada por 0.7.0:_

## [1.9.9] - 2026-10-12

- **Fixed**: el botón "+ Nuevo usuario" de Mis usuarios tenía el ícono desalineado del texto; ahora quedan centrados y con la misma altura que el buscador.

## [1.9.8] - 2026-10-12

- **Changed**: tarjeta de usuario reordenada. Arriba a la derecha, **Tableros** y **Estadística**; abajo, Nuevo código a la izquierda y Desvincular tablet a la derecha. Tableros abre su propia pantalla (como Estadística) en lugar de desplegarse dentro de la tarjeta. Activar/Desactivar registro pasa a la pantalla de Estadística, al lado de Borrar registro.

## [1.9.7] - 2026-10-11

- **Changed**: Mis usuarios en dos columnas. Cada tarjeta muestra el nombre destacado, debajo "Última conexión 11/oct" (sin "vinculada desde"), el código vigente y el registro activo, y abajo Ver tableros y Ver progreso. Desvincular, Nuevo código y Activar/Desactivar registro quedan apilados a la derecha. Buscador siempre abierto en el encabezado, como en la Home.

## [1.9.6] - 2026-10-11

- **Changed**: el código para vincular una tablet pasa a tener **4 caracteres** (por ejemplo K7PX, sin letras ni números que se confundan) y vence a los **30 minutos** (`supabase/11_codigo_corto.sql`). Para que siga siendo difícil de adivinar, el límite total de intentos fallidos baja a 300 cada 10 minutos (sigue el de 10 por dispositivo). Los códigos de 8 caracteres ya emitidos sirven hasta vencer.

## [1.9.5] - 2026-10-11

- **Changed**: Mis usuarios: la tarjeta de cada usuario queda en una sola fila clara: a la izquierda el estado (tablet vinculada y última conexión, código vigente si hay, etiqueta "Registro de uso activo"); a la derecha las acciones (Desvincular tablet, Nuevo código, Activar/Desactivar registro). Ya no se muestra "Sin código vigente…" ni el texto largo del registro.

## [1.9.4] - 2026-10-11

- **Fixed**: Progreso fallaba con "text.trim is not a function" en tableros con textos automáticos de ARASAAC (`autoLabel` es un objeto, no un texto). Corregido también en el registro de uso, en `ver_tablero` y `revisar_tablero` del servidor MCP.

## [1.9.3] - 2026-10-11

- **Fixed**: una tablet que queda abierta días no se enteraba de las versiones nuevas. Al abrir Configuración se consulta la versión publicada y, si hay una más nueva, aparece "Actualizar a la versión X" (con la frase vacía: descarga y recarga).

## [1.9.2] - 2026-10-11

- **Changed**: Mis usuarios: "Ver progreso" pasa al lado de "Ver tableros"; activar y desactivar el registro piden confirmación con botones claros ("Sí, activar" / "Desactivar" / "Cancelar").

## [1.9.1] - 2026-10-11

- **Fixed**: en el iPad, la primera frase no sonaba hasta tocar la pantalla (el navegador exige un primer gesto). Ahora, si una frase no arranca por eso, se guarda y se dice al primer toque, y se avisa "Tocá la pantalla una vez para habilitar la voz". El desbloqueo se reintenta en cada toque hasta que la voz funciona.
- **Fixed**: Progreso quedaba en "Cargando…" si algo fallaba; ahora muestra el motivo (y corta a los 15 s).

## [1.9.0] - 2026-10-11

- **Added**: **registro de uso granular** de la tablet (decisión de Esteban: eventos, no solo resúmenes). Cada selección (celda, página, momento, tiempo desde la anterior, método: fijación/parpadeo/barrido/toque), selecciones abandonadas, frases dichas (con su texto), borrar, páginas y tableros, pausas sin cara, calibraciones, alineaciones, cambios de modo y actividades de Practicar.
  - **Solo con consentimiento**: se activa por usuario desde Mis usuarios ("Activar registro"), declarando el consentimiento de la persona o su familia. La tablet lo puede **pausar** desde Configuración. El servidor rechaza todo si no está activado.
  - Cola en el dispositivo (funciona sin conexión) y subida con el token de la tablet: `device_log_events()` en `supabase/10_metricas_de_uso.sql` (tabla `usage_events`, RLS, 24 meses).
- **Added**: pestaña **Progreso** por usuario (Mis usuarios → Ver progreso): días y minutos de uso, selecciones por día, tiempo por selección, cansancio, correcciones, método de acceso, celdas más usadas, celdas que no usó, frases recientes; botón para borrar el registro. Cálculo en `web/js/metrics-summary.js` (puro, testeado).
- **Added**: servidor MCP, **etapa 4**: `ver_progreso` (el mismo resumen) y `ver_eventos` (detalle filtrable) para que Claude analice el uso y proponga mejoras a la copia del usuario.
- **Changed**: política de privacidad: sección "Registro de uso".

## [1.8.2] - 2026-10-11

- **Fixed**: guardar la versión de respaldo de una copia de usuario fallaba en producción por la política de RLS (42501). Ahora el servidor MCP usa la función `save_board_version()` (`supabase/09_guardar_version_rpc.sql`), que verifica en la base que el tablero o la asignación sea de la cuenta (también por el usuario dueño de la copia) y guarda. Si la función no está, se usa el INSERT directo como antes.

## [1.8.1] - 2026-10-11

- **Fixed**: los errores al guardar una versión de respaldo (MCP) ahora incluyen el detalle de la base, para diagnosticar. La verificación de `08_versiones_de_copias.sql` comprueba que la política nueva esté aplicada (antes solo miraba el nombre, que ya existía desde el 07).

## [1.8.0] - 2026-10-11

- **Added**: **usuarios y asignaciones desde Claude** (servidor MCP, etapa 3): `crear_usuario` (con su código de vinculación), `generar_codigo`, `asignar_tablero` (una copia por usuario, con permiso y opción de tablero de inicio), `quitar_asignacion`, `cambiar_permiso`, `elegir_tablero_inicio`, `actualizar_copia` (manda la versión nueva del original) y `borrar_tablero` (las copias se conservan; se puede recuperar con `restaurar_version`).
  - Las herramientas de páginas y celdas, `ver_tablero`, `revisar_tablero`, `historial_tablero` y `restaurar_version` aceptan `asignacion` para trabajar sobre la **copia de un usuario** sin tocar el original.
  - Antes de cambiar o quitar una copia se guarda su versión (`supabase/08_versiones_de_copias.sql`). Escritura de copias con concurrencia optimista sobre `copy_updated_at` (la tablet detecta el cambio igual que hoy).
  - No se pueden borrar usuarios ni desvincular tablets desde Claude. Las acciones que cambian lo que ve un usuario están marcadas para confirmar.
- **Added**: enlace `?copia=<asignación>` abre la copia de un usuario para editarla en MiraVoz.
- **Changed**: pantalla de autorización y política de privacidad describen el alcance nuevo.

## [1.7.0] - 2026-10-11

- **Added**: **edición de tableros desde Claude** (servidor MCP, etapa 2). Herramientas nuevas: `crear_tablero`, `duplicar_tablero`, `editar_tablero` (nombre y etiquetas), `agregar_pagina`, `editar_pagina` (nombre, tamaño, página de inicio), `borrar_pagina`, `poner_celdas` (en lote: texto, pictograma de ARASAAC por id o por palabra, color Fitzgerald, voz propia, silenciosa, navegación a otra página / volver / inicio / página nueva, tamaño), `mover_celda`, `borrar_celdas`, `revisar_tablero` (vínculos rotos, páginas sueltas, sin pictograma, repetidas, lugares libres), `historial_tablero` y `restaurar_version`.
  - Mismo formato que el editor de MiraVoz (`web/api/_edit.js`, puro y testeado en `tools/test-edit.mjs`).
  - **Ningún dato se pierde**: antes de cada cambio se guarda la versión anterior en `board_versions` (`supabase/07_versiones_de_tableros.sql`, últimas 40 por tablero); si no se puede, el cambio no se hace. Escritura con concurrencia optimista (si otro dispositivo guardó en el medio, se relee y se reintenta).
  - Cada respuesta trae el enlace **abrir en MiraVoz** (`?tablero=…&pagina=…`), que abre ese tablero y página.
- **Added**: en la app, los cambios hechos desde Claude (u otro dispositivo) **aparecen solos** en unos segundos mientras MiraVoz está abierto (consulta liviana de fechas cada 8 s y sincronización solo si algo cambió), con aviso "Se actualizó «…»".
- **Added**: botón **Copiar para Claude** en el editor: copia el nombre y el id del tablero y de la página actual para pedirle cambios a Claude.

## [1.6.0] - 2026-10-11

- **Added**: **servidor MCP de MiraVoz** (etapa 1, solo lectura) en `https://www.miravoz.com.ar/mcp`, para conectar la cuenta registrada con Claude como conector personalizado.
  - Inicio de sesión con el servidor OAuth 2.1 de Supabase: Claude recibe un token a nombre de la cuenta y las reglas RLS de siempre limitan lo que ve. También rige la lista de cuentas habilitadas.
  - Pantalla de autorización propia en `/oauth/consent` (ingreso con Google, qué puede hacer la aplicación, Permitir/Cancelar).
  - Herramientas: `quien_soy`, `listar_tableros`, `ver_tablero` (páginas, grilla y celdas con texto, voz, color, pictograma y navegación), `listar_usuarios`, `ver_usuario` (asignaciones) y `buscar_pictogramas` (ARASAAC). Nunca devuelve códigos, tokens de tablets ni imágenes propias.
  - Funciones de Vercel en `web/api/` (sin dependencias); el núcleo (`_mcp.js`) está testeado (`tools/test-mcp.mjs`). Quedan fuera del modo sin conexión.
- **Changed**: política de privacidad: sección sobre asistentes de inteligencia artificial conectados por la cuenta.

## [1.5.3] - 2026-10-11

- **Changed**: Configuración: sin "Probar voz" ni la leyenda de la voz sin conexión; sin mención a Iris; una explicación breve (hasta dos líneas) por sección; opciones cortas para que no se corten ("Por filas / De a uno", "0,6 s", "Largo / Doble", "Con fijación: Sí / No").
- **Changed**: "Ajustar a esta persona" pasa a llamarse **Ajuste personalizado** y, si el modo es Manual (cámara apagada), enciende la cámara solo durante el ajuste.

## [1.5.2] - 2026-10-11

- **Changed**: Alinear sin voz (solo texto en pantalla) y con textos impersonales que no nombran el dispositivo ("Más cerca de la pantalla", "Mover la cabeza un poco hacia la derecha", "Bien: mantener la posición").
- **Changed**: "Alinear" pasa a ser una opción dentro de **Recalibrar**: con una calibración de Rostro guardada, Recalibrar abre un menú con "Alinear" y "Calibrar de nuevo". Sin calibración, Recalibrar calibra directo.
- **Fixed**: al terminar de alinear desde un tablero se mostraba la barra superior encima del tablero.

## [1.5.1] - 2026-10-11

- **Changed**: Configuración compacta: textos más cortos, tres opciones por fila en Barrido y Parpadeo, "Voz" y "Sin conexión" juntas, versión en el pie. Entra sin scroll en el iPad horizontal y en ventanas de laptop chicas.

## [1.5.0] - 2026-10-11

- **Added**: **Alinear la cara** "tipo antena Starlink" (`web/js/align.js`, puro y testeado). La calibración de Rostro guarda la posición de la cabeza respecto de la cámara (distancia y corrimiento) y hacia dónde apunta al mirar el centro.
  - Al abrir con una calibración guardada, antes de la verificación rápida aparece la guía: un círculo (la cara) que hay que llevar al centro de un aro y con el mismo tamaño (distancia), moviendo la cabeza o la tablet, con indicaciones habladas ("Acercate un poco", "Corré la cabeza un poco a tu derecha").
  - Al quedar alineado, 1,5 s apuntando al punto central **recentran** el cursor: corrige una tablet inclinada o una cabeza algo corrida sin recalibrar. Si la diferencia es muy grande, sugiere recalibrar.
  - Botón **Alinear** arriba (en Rostro) para hacerlo en cualquier momento, y aviso sin pausar ("Te corriste de la posición de la calibración: tocá Alinear") si la cabeza queda corrida más de 3 s.
  - "Seguir sin alinear" y "Recalibrar" siempre disponibles. Las calibraciones anteriores no tienen referencia: hace falta calibrar una vez.
- **Changed**: Configuración más ancha y en dos columnas (sin scroll en el iPad horizontal).
- **Fixed**: en Configuración, el campo "Ojos cerrados durante" se mostraba aunque el parpadeo largo no estuviera elegido.

## [1.4.2] - 2026-10-11

- **Changed**: Practicar → Globos en **Barrido** es un juego propio de tiempo: 2 a 5 globos en fila y uno dorado; hay que elegir justo cuando se ilumina el dorado. Elegir otro no es error (se sacude). Suma un globo cada 4 aciertos. Antes era igual a "Parpadear" (un solo globo).

## [1.4.1] - 2026-10-11

- **Added**: sonido de "click" cuando se reconoce un parpadeo voluntario (sintetizado, funciona sin conexión).
- **Added**: opción de parpadeo largo más corta: 0,3 segundos (rápido).

## [1.4.0] - 2026-10-11

- **Added**: **parpadeo para elegir** (Configuración → Parpadeo), con la cámara y los blendshapes de FaceLandmarker (`web/js/blink.js`, puro y testeado).
  - Dos gestos que no se confunden con el parpadeo reflejo: *parpadeo largo* (ojos cerrados 0,4–1,5 s, por defecto 0,6) o *doble parpadeo*. Histéresis y período refractario: no se encadenan selecciones.
  - En **Barrido** reemplaza al pulsador: la cámara se enciende solo para eso (sin cursor ni calibración).
  - En **Rostro e Iris** elige lo que estaba bajo el cursor justo antes de cerrar los ojos. Se puede usar junto con la permanencia o "solo parpadeo" (la permanencia resalta pero no elige: se termina el efecto Midas).
  - Anillo celeste que se llena mientras los ojos están cerrados y destello al elegir.
  - **Ajustar a esta persona**: 4 s con ojos abiertos (mirando también abajo) y 2,5 s cerrados fijan su umbral; avisa si la cámara no los distingue.
- **Added**: nivel 6 de Practicar, **Parpadear**: un globo grande que se revienta parpadeando, con una barra que muestra cuánto se cierran los ojos y el umbral (para la persona de apoyo).
- **Changed**: el menú de Practicar pasa a 3 columnas (6 tarjetas más grandes).
- El panel de diagnóstico (`?diag=1`) muestra el cierre de ojos y el umbral.

## [1.3.3] - 2026-10-11

- **Removed**: el panel "Configuración de su tablet" de Mis usuarios. El modo de acceso, la permanencia y el barrido se configuran en la propia tablet (Configuración); lo guardado antes desde la cuenta registrada ya no se aplica.

## [1.3.2] - 2026-10-11

- **Changed**: "Cerrar sesión" y "Desvincular tablet" pasan de la barra inferior a Configuración, abajo a la izquierda y en rojo (lejos de "Listo").

## [1.3.1] - 2026-10-11

- **Changed**: "Nuevo tablero" es solo un ícono "+" (sin fondo verde), junto al de Importar.
- **Changed**: Practicar sigue el modo Día/Noche (fondo, textos, dibujo, luciérnaga y opciones).
- **Changed**: Mis usuarios: "Nuevo usuario" es un botón arriba a la derecha que abre un modal para el nombre (antes era un bloque fijo que ocupaba lugar).
- **Changed**: los globos revientan de verdad: onda expansiva y pedazos que salen volando y caen (respeta "reducir movimiento").

## [1.3.0] - 2026-10-11

- **Added**: sección **Practicar** (reemplaza al botón "Tablero de Prueba"): cinco actividades de acceso en orden de dificultad, con aprendizaje sin error y todo sintetizado en el dispositivo (funciona sin conexión).
  1. *Pintar con sonido* (causa y efecto): cualquier movimiento pinta y suena (escala pentatónica).
  2. *Descubrir* (explorar): recorrer toda la pantalla para destapar un dibujo hecho con código.
  3. *Globos* (apuntar): se revientan con permanencia; se achican al acertar y crecen solos si cuesta.
  4. *Elegir*: 2, después 3 y 4 opciones de sonidos; todas las respuestas valen.
  5. *Seguir*: acompañar una luciérnaga lenta; acelera de a poco.
  Usa el mismo cursor, permanencia, barrido y calibración que los tableros (en Barrido: niveles 3 y 4; en Manual: con el dedo). Guarda un registro local por persona (sin textos) para la futura pestaña "Progreso".
- **Changed**: "Nuevo" e "Importar" pasan a la barra del inicio, arriba a la izquierda.
- **Changed**: "Mis usuarios" se abre a pantalla completa.

## [1.2.1] - 2026-10-11

- **Fixed**: sin internet en el iPad la voz decía la primera celda y después quedaba muda (Safari dejaba una frase "en curso" que nunca empezaba y todo se encolaba detrás). Ahora cada frase cancela la anterior, si una frase no empieza en 1,5 s se libera y se reintenta con la voz del sistema, y se prefieren voces locales.
- **Fixed**: Configuración mostraba la última versión publicada aunque el iPad siguiera corriendo una anterior. Ahora muestra la que corre (`web/js/build-info.js`, generado) y avisa si hay una nueva esperando.

## [1.2.0] - 2026-10-11

- **Changed**: la verificación del modo Rostro es a **lazo cerrado**: se ve el cursor (anillo celeste) y la persona lo lleva al punto y lo mantiene, como en el uso real. Los diagnósticos del iPad Air 4 mostraron que, sin cursor, la cabeza se desplaza unos 3-4° hacia abajo en menos de un minuto (sobre todo en vertical: todo el alto de la pantalla son ~9° de cabeceo), y eso hacía fallar la verificación aunque el cursor se pudiera usar. Iris sigue a lazo abierto. La cuenta regresiva de cada punto de verificación en Rostro es de 2,5 s para dar tiempo a acomodar el cursor.

## [1.1.0] - 2026-10-11

- **Changed**: el modo Rostro usa los **ángulos de la cabeza** (giro y cabeceo de FaceLandmarker) en vez de la posición de la nariz en la imagen. La nariz cambia si la persona se corre o se hunde en la silla, y en el iPad Air 4 (cámara al costado en horizontal) eso arruinaba la verificación. Con el diagnóstico real del iPad, los mismos datos dan un error mediano de 46 px con ángulos contra 131 px con la nariz. Los perfiles de Rostro anteriores quedan invalidados: hay que recalibrar una vez. El motor legado (sin pose) sigue usando la nariz.
- **Fixed**: el diagnóstico (`?diag=1`) dejaba de grabar al llenarse y perdía las calibraciones más recientes; ahora conserva los últimos cuadros y no graba pantallas sin cara ni objetivo.

## [1.0.1] - 2026-10-11

- **Fixed**: en modo Rostro, la verificación decía "mirá el punto" (invitaba a mover solo los ojos) y daba errores altos en el iPad. Ahora dice "apuntá al punto con la nariz, como en la calibración".

## [1.0.0] - 2026-10-11

Primera versión numerada, publicada en www.miravoz.com.ar. Incluye todo lo listado abajo (fases 0 a 4, M01–M08, compatibilidad con Asterics Grid, landing con ingreso por Google) y:
- **Added**: cuentas habilitadas (`supabase/06_cuentas_habilitadas.sql`): solo entran los correos de `allowed_emails`; el resto ve el aviso "Cuenta no registrada" en un toast rojo.
- **Added**: versión visible "Versión 1.0.0" en Configuración (el hash del contenido queda como compilación, en el tooltip y en el diagnóstico).

## Historial previo a 1.0.0

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
- **Fixed**:
  - Con varias tarjetas y miniaturas, el home empujaba la barra inferior fuera de la pantalla. Ahora las tarjetas scrollean dentro del home.
  - La tablet también muestra la miniatura de cada tablero.

### Home estilo "Projects" de Claude (10/10/2026, pedido de Esteban)
- **Changed**: el home tiene título "Tableros" y una barra con:
  - pestañas de etiquetas,
  - selector de usuario,
  - lupa que se expande en un buscador (antes estaba en la barra superior),
  - botón de orden con menú: última modificación, fecha de creación, alfabético y "Agrupar por etiqueta" (secciones por etiqueta más "Sin etiqueta"). La elección se recuerda.
- Las tarjetas muestran abajo el tiempo relativo ("hace 3 días") y las etiquetas como labels discretos con ícono.
- La tablet conserva la lupa para buscar entre sus tableros.
- **Ajustes (10/10/2026)**:
  - Se quitó el título "Tableros".
  - Las pestañas muestran contadores ("Todos (8)", "Principal (1)") y "Usuario" queda a la derecha de todo.
  - Las tarjetas quedaban cortadas abajo: las filas de la grilla se achicaban a la altura mínima por `overflow:hidden`. Ahora la grilla usa `grid-auto-rows: max-content` y la tarjeta no achica sus partes.
  - La tablet tiene las mismas opciones (etiquetas con contadores, buscador, orden y agrupar), sin usuarios ni acciones. Hay un único render, `renderHome(bundles, {readOnly})`.


### Tableros con varias páginas (10/10/2026, a partir de un respaldo de Asterics)
Un respaldo de Asterics traía 5 tableros encadenados (preguntas "¿Cuál…?"). MiraVoz los importaba como un tablero con 5 páginas, pero solo se veía y se podía editar la primera.
- **Added**: franja de **páginas** en el editor, con miniaturas. Tocar una página la abre para editarla. "+ Página" agrega una página vacía. En "Esta página" se renombra, se marca "Usar como inicio" o se borra; al borrar pide confirmación, avisa cuántas celdas navegaban a esa página y quedan sin ese vínculo, y se puede deshacer.
- **Added**: al importar un archivo con varios tableros se pregunta si va como **un tablero con N páginas** (se mantienen los vínculos) o como **N tableros separados** (los vínculos se pierden).
- **Added**: los pictogramas de ARASAAC que vienen **sin texto** toman la palabra desde la API de ARASAAC (`el.autoLabel`), con preferencia por la forma rioplatense (por ejemplo, "auto" en lugar de "coche"). Esa palabra se dice en voz alta y va a la frase. En la celda se ve solo si se activa "Mostrar texto de los pictogramas" en el editor. Se completa en segundo plano: la importación no espera a la red. Los tableros que ya estaban importados se completan al abrirlos, y si no hay red se reintenta la próxima vez.
- **Changed**: tocar una celda que navega **dice su texto** antes de pasar de página. En tableros importados, siempre. En tableros editados, si la celda tiene acción de voz.
- **Fixed**: al editar por primera vez un tablero importado, las celdas con texto y sin acción de voz se quedaban mudas (cambio de semántica de F3-3b). Ahora reciben la acción de voz al entrar a editar, antes de cualquier "deshacer", así se sigue diciendo lo mismo que antes de editar.
- **Changed**: la tarjeta del home dice "N celdas · N páginas". Los respaldos de Asterics (`…_asterics-aac-custom-backup`) toman el nombre de su página de inicio y se les quita "(Copy)". El nombre del tablero ya no renombra la página actual cuando hay varias.
- **Fixed**: se tolera el BOM al principio de los `.grd` de Asterics.
- Tests: `tools/test-pages.mjs` (22) y el caso `paginas` en `test-boot.mjs` (21 verificaciones). El total de test-boot es 85. Revisión: deshacer ya no deja mudas las celdas, hay una carrera con la sincronización resuelta al releer antes de guardar, la importación ya no queda bloqueada por la red y las miniaturas usan una clave por tablero.
- **Changed (pedido de Esteban)**: la franja de páginas ocupaba demasiado alto en el editor. Ahora es un selector compacto dentro de la barra del editor, "‹ Página 1 de 5 · Nombre ▾ ›": las flechas pasan de página y al tocar el nombre se despliega un panel con las miniaturas, "+ Página", renombrar, "Usar como inicio", "Borrar página" y "Mostrar texto de los pictogramas". Se cierra al elegir una página, al tocar afuera o con Escape. La barra pasa a dos renglones solo en pantallas de menos de 820 px.
- **Added (pedido de Esteban)**: las celdas que abren otra página muestran una **esquina doblada con una flecha** arriba a la derecha, la convención de "carpeta" en CAA. El lector de pantalla anuncia "(abre otra página)".

### Compatibilidad completa con Asterics Grid (10/10/2026)
Analicé 6 respaldos completos de Leti: 812 tableros y 11.794 celdas. Con eso y con los modelos de AsTeRICS-Grid (`GridElement`, `GridData`, `GridAction*`), MiraVoz ahora contempla todo lo que puede traer un `.grd`, aunque se importe de a un tablero. La lógica nueva está en `web/js/asterics.js`, `prediction.js` y `media.js`.
- **Fixed — textos**: se leen los textos en `es`, en variantes de español (`es-ar`, que antes se veían vacíos) o en otro idioma (`labelText`). Las etiquetas pueden venir como texto plano.
- **Fixed — voz**: "decir texto personalizado" (`SpeakCustom`) ahora funciona también en tableros importados sin editar. Antes un pictograma sin texto que debía decir "ANALÍA" quedaba mudo. Se respeta el idioma de voz de la celda.
- **Added — navegación**: "volver a la página anterior" y "ir al inicio" (231 y 13 celdas en los respaldos). El editor de celda tiene las dos opciones nuevas y conserva "agregar a la frase al navegar".
- **Added — vínculos rotos**: un vínculo a un tablero que no se importó funciona como celda común, no lleva la marca de "abre otra página" y en el editor se ve con borde rojo.
- **Added — botones de la frase**: hablar, hablar y borrar, borrar todo, borrar palabra, borrar letra, copiar, agregar al portapapeles y compartir.
- **Added — teclados**: en páginas con 8 teclas o más, las letras forman palabras, el espacio cierra la palabra y "borrar letra" borra de a un carácter. Las teclas no hablan, como en Asterics. En tableros comunes, "y" u "o" siguen siendo palabras.
- **Added — predicción de palabras**: las celdas de predicción sugieren palabras según lo que se escribe y respetan las mayúsculas del teclado. Las fuentes, de más a menos peso:
  - lo que la persona ya escribió en ese dispositivo;
  - el diccionario que trae el archivo;
  - los textos del tablero;
  - una lista base de palabras frecuentes.
- **Added — celdas de frase**: las que Asterics pone dentro del tablero muestran la frase en vivo y la dicen al tocarlas.
- **Added — multimedia**:
  - radio por internet: iniciar, alternar, siguiente, anterior y volumen, con las emisoras del tablero (solo `http(s)`);
  - abrir una página web en un panel con "Volver al tablero": mientras está abierto, la mirada y el barrido apuntan solo a ese botón, vuelve sola (60 s si no hay tiempo configurado) y nunca abre MiraVoz adentro;
  - audios grabados (`GridActionAudio`);
  - la radio, el audio y la página se cortan al salir del tablero.
- **Added — celdas no disponibles**: lo que MiraVoz no puede hacer (YouTube, domótica AsTeRICS u openHAB, HTTP, puerto serie, Matrix, podcast, formas de palabra, cambio de idioma y acciones o tipos desconocidos) se marca con "No disponible". Al tocar esas celdas aparece un aviso; nunca queda una celda muda sin explicación.
- **Added — informe al importar**: lista qué se adaptó, qué vínculos quedaron rotos y qué no se puede usar.
- **Added — formato**: color y tamaño de letra por celda (`fontColor`, `fontSizePct`, `fontSizePx`), color de fondo de la página, `dontCollect` (no va a la frase) y `toggleInBar` (agregar o sacar de la frase).
- **Changed — respaldo completo**: se usa el inicio declarado (`metadata.homeGridId`) y se descartan el tablero global (MiraVoz ya tiene su barra) y las miniaturas (17% del peso). Si no hay inicio declarado, se elige el tablero sin vínculos entrantes que lleva a más páginas, para no caer en un teclado suelto.
- Tests:
  - `tools/test-asterics.mjs` (13 pruebas).
  - Caso `asterics` en `test-boot.mjs` (31 verificaciones; test-boot pasa a 113 en total).
  - Prueba manual, no versionada, con los 6 respaldos reales: 806 páginas se importan y se dibujan sin errores.
  - Revisión del equipo: se corrigieron la página web sin salida con la mirada, las celdas de una letra en tableros comunes, la tecla espacio en el editor y el sandbox del iframe.

## Especificación técnica de mejoras M01–M08 (11/10/2026)
Implementación de `especificacion-tecnica-miravoz-para-claude.md` (carpeta del proyecto MiraVoz), por etapas.

### Etapa A — referencia y pruebas reproducibles
- `package.json` con `jsdom` fijado como devDependency (`npm install` y después `npm test`). `tools/run-tests.mjs` corre todos los grupos. Vercel no instala nada (`installCommand` en `vercel.json`).

### Etapa B — M01: nunca seleccionar con datos inválidos o viejos · M07: aprendizaje implícito apagado
- **Fixed (M01)**: Rostro e Iris podían seleccionar una celda sin que la persona la mirara. Pasaba en tres casos:
  - en Rostro, sin cara, el cursor quedaba congelado y el dwell seguía corriendo;
  - en Iris, con los ojos cerrados, pasaba lo mismo;
  - al volver de una pérdida de señal, la celda se seleccionaba en el acto porque el tiempo no se había reiniciado.
- **Added (M01)**: cada cuadro de cámara produce una muestra (`TrackingSample`) con sesión, secuencia, momento de captura, validez y motivo. Lo construye `buildSample` en `web/js/selection.js`. Estos casos son inválidos en el acto:
  - sin rostro, parpadeo o sin features;
  - cabeza fuera de pose (modo Iris);
  - sin calibrar o fuera de la pantalla (no se recorta al borde);
  - error del motor, cámara cortada o detenida.
- **Added (M01)**: `PointerController`. El dwell solo avanza con muestras **nuevas, válidas y recientes** (`MAX_SAMPLE_AGE_MS = 250`, a ajustar en el iPad) y usa el reloj de captura.
  - Cualquier invalidez reinicia la permanencia, el candidato y los filtros, y cancela el aprendizaje pendiente.
  - Pestaña oculta, `pagehide`, cambio de modo y calibración nueva cortan todo, y las muestras anteriores a la interrupción no cuentan.
  - Un motor reiniciado (por ejemplo, de GPU a CPU) abre una sesión nueva: los resultados de la anterior se descartan.
  - En el dwell, un hueco entre muestras mayor al límite es una interrupción, no tiempo de permanencia.
- **Changed (M01)**: la calibración toma una muestra por cuadro nuevo de cámara: refrescar la pantalla a 60-120 Hz ya no multiplica observaciones. El aviso de pausa ("No se ve la cara", "La cámara no está enviando imágenes", "Volvé a poner la cabeza…") se muestra sobre el tablero.
- **Changed (M07)**: el aprendizaje implícito del modo Iris queda **apagado por defecto**: un dwell no corregido no demuestra intención. Solo se activa con `?implicit=1`.
- Tests: `tools/test-selection.mjs` (16), que cubre los escenarios T01 a T07 y T16 con el dwell, el filtro y el controlador reales y el reloj controlado.

### Etapa C — M02: perfiles por persona, dispositivo y geometría · M04: calibración verificada aparte
- **Changed (M02)**: los perfiles de calibración se guardan por **ámbito de persona**: `user:<id>` en una tablet vinculada y `prueba` para la profesional, en `miravoz_calibration_v3` (`web/js/profiles.js`). Cada perfil guarda esquema, revisión, tipo de modelo, motor, cámara, viewport, orientación, área calibrada, convención de coordenadas y verificación. `checkCompatibility()` decide si se puede usar:
  - otra persona, otro dispositivo, otra orientación, otro motor (en Iris), otro modelo o un perfil sin verificar no se aplican;
  - cambiar más de 15% el ancho o más de 25% el alto invalida; las barras de Safari no (regla documentada y testeada).
- **Changed (M02)**: los perfiles viejos v2, sin contexto, se **conservan** para recuperación pero no se aplican: piden calibrar.
- **Changed (M02)**: un guardado fallido no pisa lo persistido; el perfil nuevo queda solo en memoria y se avisa.
- **Changed (M02)**: al desvincular la tablet se borran solo los perfiles de ese usuario.
- **Changed (M02)**: girar el iPad o cambiar mucho la pantalla suspende la selección y pide calibrar en la geometría nueva. Si pasa en plena calibración, se reinicia.
- **Added (M02)**: aun con un perfil compatible, al habilitar la cámara se hace una **verificación rápida de 5 puntos** antes de permitir seleccionar.
- **Added (M04)**: después de entrenar, **verificación independiente** con 5 objetivos nuevos (posiciones que no se ajustaron, en otro orden; `web/js/validation.js`).
  - Mide cobertura de señal válida, error mediano, percentil 90 y temblor durante la fijación, comparados con el tamaño de una celda 3×3.
  - Las reglas son provisorias y versionadas (`v1-provisional-2026-10-11`): hay que ajustarlas con mediciones en el iPad.
  - Las muestras de verificación nunca entran al entrenamiento ni al aprendizaje.
- **Changed (M04)**: una calibración que **no pasa** la verificación **no activa el cursor** ni reemplaza a la anterior. Se ofrece repetirla con consejos de luz y de colocación del iPad, sin pedir mover la cabeza.
- **Changed (M04)**: el aviso final informa el error mediano y el p90 de la verificación. El error del entrenamiento queda como `trainingError` (diagnóstico de ajuste) y ya no se muestra como "±N px".
- **Changed (M04)**: la calibración descarta cuadros capturados antes de la fijación de cada punto y toma uno por cuadro nuevo de cámara.
- **Changed (M04)**: el benchmark tiene tiempo máximo por objetivo (las omisiones cuentan), un **descanso** de 10 s antes de cada grilla para medir activaciones involuntarias por minuto, y mediana y p90 de tiempos.
  - Los denominadores incluyen errores y omisiones.
  - Las metas 95% (3×3) y 85% (4×4) quedan rotuladas como metas internas, no como estándar clínico.
- Tests: `tools/test-profiles.mjs` (13, escenarios T08 a T10 y T13 a T15). `test-calibration.mjs` adaptado al formato v3.

### Etapa D — M03: un único contexto de selección para diálogos y superposiciones
- **Added (M03)**: `web/js/contexts.js`, una **pila de contextos**: el tablero o el inicio abajo, y encima los diálogos (alertas, confirmaciones, página web, resultados del benchmark). Solo el contexto de arriba ofrece objetivos al dwell y al barrido.
  - Los botones de los diálogos (Aceptar, Cancelar, Volver, Cerrar) se activan con la mirada o el pulsador y muestran la barra de avance: nunca hace falta tocar para salir de algo abierto con la mirada.
  - Con un diálogo arriba, el fondo queda `inert` (ni teclado, ni lector de pantalla, ni toque).
- **Changed (M03)**: si el tablero se redibuja con un diálogo abierto (sincronización, resize, render), sus objetivos se guardan pero **no se activan**. Al cerrar el diálogo, los objetivos se reconstruyen desde el estado actual, nunca con nodos eliminados, y la permanencia se reinicia: lo que quedó debajo no se activa solo.
  - Se aceptan diálogos anidados y cierres fuera de orden, como el cierre por tiempo de la página web.
- **Changed (M03)**: los paneles del acompañante (configuración, usuarios, importar, editar celda, etiquetas, dar copia) **pausan** la selección por mirada y por pulsador mientras están abiertos.
- **Removed**: el evento suelto `miravoz-overlay`; la página web usa la pila.
- Tests: `tools/test-contexts.mjs` (7, escenarios T11 y T12 con el dwell y el controlador reales). Hay 3 verificaciones nuevas en `test-boot.mjs`: diálogo de confirmación, tablero redibujado detrás y página web con fondo inerte.

### Etapa E — M05: arranque y comunicación sin conexión
- **Added (M05)**: **Service Worker** `web/sw.js`, separado del motor de cámara y de la persistencia de tableros.
  - Instala el conjunto **completo** de `web/offline-manifest.json` (HTML, CSS, módulos, íconos, bibliotecas, MediaPipe con su WASM y el modelo) y **verifica el sha256** de cada archivo.
  - Si algo falta o no coincide (por ejemplo, un deploy a medio publicar), la instalación falla y sigue funcionando la versión anterior. Nunca hay una mezcla de código nuevo con WASM o modelo viejos.
- **Added (M05)**: las versiones se registran como `/sw.js?v=<versión>`. Una actualización se descarga en segundo plano y se **aplica solo en un momento seguro**: al volver al inicio, sin frase en curso y sin calibración. Recién ahí se borra la versión anterior.
- **Added (M05)**: los pictogramas de ARASAAC se guardan en un caché de imágenes. Autenticación, Supabase y pedidos privados **nunca** se guardan: van siempre a la red.
- **Added (M05)**: en Configuración, sección **"Uso sin conexión"**, con el estado y el botón "Preparar para usar sin conexión".
  - El botón pide almacenamiento persistente y guarda los pictogramas de los tableros del dispositivo.
  - "Preparado para usar sin conexión" aparece solo si el Service Worker confirma el conjunto completo y no fallaron imágenes. También avisa si queda poco espacio.
  - La voz sin conexión depende del iPad: se indica probarla en modo avión.
- **Changed (M05)**: las bibliotecas pasan a estar alojadas en el proyecto, en `web/vendor`, con versión y licencia: localforage 1.10.0, JSZip 3.10.1, supabase-js 2.117.3 (se mantiene el SRI), la fuente Inter 5.3.0 y MediaPipe Tasks Vision 1.1.0 (bundle y WASM con y sin SIMD).
  - `index.html` ya no depende de ninguna CDN.
  - El modelo `face_landmarker.task` se descarga de su URL oficial versionada y lo guarda el Service Worker. Su sha256 queda pendiente: no se pudo descargar desde el entorno de desarrollo.
  - El motor legado FaceMesh (respaldo) sigue funcionando solo con conexión.
- **Changed (M05)**: encabezados en `vercel.json`:
  - `sw.js` y el manifiesto: `no-store`;
  - `vendor/` (versionado): `immutable`;
  - el resto: `no-cache` (revalidar), en lugar de `no-store`.
- **Changed (M05)**: sin conexión, el arranque de la profesional ya no espera indefinidamente a Supabase. A los 5 s entra con la sesión guardada a sus tableros locales, y la sincronización vuelve con la red. La tablet ya arrancaba sin cuenta.
- **Removed**: `web/test.js`, un script viejo de Node publicado por error. `web/package.json` marca los módulos como ES.
- Proceso: después de tocar `web/` hay que correr `node tools/build-offline-manifest.mjs`; `npm test` falla si el manifiesto quedó desactualizado (EQUIPO.md).
- Tests: `tools/test-offline.mjs` (10). Corre el Service Worker real en una simulación con CacheStorage y red que se corta, y cubre los escenarios T18 y T19:
  - arranque sin red;
  - pedidos privados sin interceptar;
  - descarga incompleta, archivo alterado y manifiesto cambiado durante la instalación;
  - actualización que espera sin mezclar versiones.
- Pendiente de dispositivo: el comportamiento real en Safari del iPad (cuotas, desalojo, pestaña frente a pantalla de inicio) y la voz sin conexión.

### Etapa F — M06: inferencia separada y rendimiento medido
- **Added (M06)**: motor FaceLandmarker en un **Web Worker** (`web/js/vision-worker.js`), activable con `?vision=worker`. Queda **en evaluación**: el predeterminado sigue siendo el hilo principal, que es lo probado, hasta medir el worker en el iPad.
  - El cuadro viaja como `ImageBitmap` transferido, con la sesión, la secuencia y el **momento de captura del hilo principal**. El reloj del worker no se usa para la validez.
  - Si el worker no inicia, no responde en 2 s o falla, la mirada se **invalida antes** de recuperar y se vuelve al hilo principal con una sesión nueva: nunca se mezclan resultados de los dos motores.
  - Hay una sola instancia de detector activa a la vez.
- **Added (M06)**: `web/js/vision-scheduler.js`. Como máximo **un cuadro en procesamiento y uno pendiente** (el más reciente). Los cuadros descartados se liberan (`bitmap.close()`) y los resultados de otra sesión o de una secuencia superada se descartan; la cola nunca crece.
- **Added (M06)**: mediciones del motor, sin video ni datos personales: inferencia p50 y p95, captura→resultado p50 y p95, resultados por segundo, cuadros descartados y antigüedad de la muestra (`tracking.visionStats()`). Se guardan con cada benchmark para comparar el hilo principal con el worker. Las metas provisorias (≥15 resultados/s, p95 captura→resultado <200 ms) se revisan con datos del iPad.
- Tests: `tools/test-vision.mjs` (5): cola acotada en una sesión larga con un motor lento, descarte por sesión y secuencia (T07), caída por falta de respuesta y métricas.
- Pendiente de dispositivo: que el worker funcione en Safari del iPad (GPU, `OffscreenCanvas`), su latencia frente al hilo principal y su consumo en una sesión de 20 minutos.

### Etapa G — M07 completo, M08 y cierre (informe, protocolo y revisión)
- **Changed (M07)**: el aprendizaje implícito (experimental, solo con `?implicit=1`) ahora trabaja así:
  - el **modelo base verificado es inmutable**;
  - un re-entrenamiento produce un candidato, que se acepta solo si no empeora sobre la **evidencia reservada** (las muestras de la verificación, que nunca se entrenan). Siempre se compara contra la base, así que no hay degradación acumulativa;
  - cada muestra guarda su procedencia, y hay historial y `rollbackModel()`;
  - excluye benchmark, verificación, diálogos, edición, calibración y señal inválida;
  - si cambió la persona o la revisión del perfil, no se escribe nada (T17).
- **Added (M08)**:
  - explicación de Rostro e Iris en Configuración;
  - ayuda de colocación del iPad en la pantalla de calibración, sin pedir mover la cabeza;
  - si la voz falla, la frase se conserva y se avisa cómo reintentar;
  - **panel de diagnóstico** solo con `?diag=1` (versión, modo, motor, latencias, antigüedad de la muestra, motivo de pausa, verificación del perfil);
  - botón **"Rendimiento"**, que descarga solo métricas agregadas;
  - **identificador de entrega** = hash del contenido (`web/version.json`), visible en Configuración.
- **Fixed (revisión del equipo)**:
  - una actualización ya **no recarga la app en pleno uso**: se aplica al arrancar o con "Actualizar ahora";
  - una verificación rápida sin cuadros (cámara o modelo cargando) no cuenta, y una fallida no pisa el perfil aceptado (`lastQuickCheck`);
  - la calibración junta cuadros únicos hasta 3 s por punto (iPad lento) y la cobertura se mide sobre lo que entrega el motor;
  - se agregó el botón "Cancelar y usar Manual" en la pantalla de calibración;
  - hay un perfil **por orientación**, y girar en plena calibración vuelve a decidir con la geometría nueva;
  - la cámara se recupera sola si deja de enviar cuadros, con espera creciente;
  - las imágenes guardadas para usar sin conexión se sirven desde su caché;
  - una actualización reutiliza lo que no cambió en lugar de volver a bajar unos 30 MB;
  - Vercel no publica si el manifiesto quedó desactualizado (`buildCommand`);
  - en Barrido, tocar el fondo de un diálogo activa el pulsador;
  - los diálogos ya no toman foco automático (el Espacio del pulsador podía responderlos);
  - al desvincular por servidor se borran los perfiles de ese usuario;
  - la regla de geometría pasa a 12% de ancho y 15% de alto.
- **Docs**: `INFORME_M01-M08.md` (estado por requisito con evidencia, migración, actualizaciones, diagnóstico, publicación, licencias y lo que NO se afirma) y `PROTOCOLO_VALIDACION_IPAD.md` (planilla y recorrido para el iPad).

### Dominio propio, landing y páginas legales (11/10/2026)
- **Added**: **landing** en la pantalla de ingreso de www.miravoz.com.ar: qué es MiraVoz, los modos de acceso, la compatibilidad con Asterics, el rol de la profesional y la privacidad de la cámara, junto al ingreso con Google y "Vincular tablet".
  - En pantallas angostas el ingreso aparece primero.
  - Quien ya tiene sesión, o una tablet vinculada, entra directo como antes.
- **Added**: `/privacidad` y `/terminos` (`web/privacidad.html`, `web/terminos.html`, `web/legal.css`). Responsable: Esteban Sarabia; contacto: esteban@sarabia.com.
  - La política cubre la Ley 25.326 y el uso limitado de los datos de Google.
  - Funcionan sin conexión (el Service Worker sirve cada página propia en lugar de la app).
- **Changed**: `vercel.json` agrega las direcciones sin `.html` para las páginas legales.
- **Changed (pedido de Esteban)**: textos públicos ajustados.
  - Se quitaron "gratuita", las menciones a la mirada y al seguimiento ocular, y los formatos .grd/.obz de la landing.
  - Nuevo título: "Una voz para cada persona" (también en el título de la página y en el manifest).
  - En lugar de "la profesional" se usa "**cuenta registrada**", también en los mensajes de la tablet: vinculación, desvinculación, tablero actualizado y sin tableros.
  - La política de privacidad y los términos hablan de "titulares de cuentas registradas".

### La frase se mantiene entre tableros, como en Asterics (11/10/2026, pedido de Esteban)
- **Fixed**: la frase se vaciaba cada vez que se abría otro tablero. Ahora, igual que en Asterics (`collectElementService`), se mantiene al cambiar de tablero, de página o al volver al inicio: una frase se arma con palabras de varios tableros. Se vacía solo con "borrar todo", con una celda que la borra, o al cerrar sesión o desvincular la tablet (la app se recarga). El benchmark empieza con la frase vacía.
- **Changed**: detección de teclado igual que en Asterics. Una página es teclado si declara `keyboardMode` o si más del 40% de sus celdas comunes tienen un solo carácter; antes se exigían 8 teclas.
- **Changed**: como en Asterics, en un teclado las letras van a la frase en minúscula, salvo que la celda de frase tenga `convertToLowercase: false`.
- **Fixed**: el benchmark no abría su grilla. Un cambio de la etapa C había movido `buildGridBundle` a `validation.js` por error. Ahora hay una prueba en `test-boot.mjs` que lo cubre.
