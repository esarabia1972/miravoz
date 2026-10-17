// _ayuda.js — Guía de uso de MiraVoz para Claude (herramienta ayuda_miravoz) · 0.7.9c
// Fuente única de la ayuda: actualizar en cada publicación junto con el CHANGELOG (y, más adelante, la Ayuda
// dentro de la app). Textos impersonales, "usuario" (nunca "paciente"), "cuenta registrada" para quien gestiona.

export const AYUDA_VERSION = '0.8.1m';

export const TEMAS = {
    general: {
        titulo: 'Qué es MiraVoz',
        alias: ['miravoz', 'inicio', 'resumen', 'que es'],
        texto: `MiraVoz es una plataforma web de comunicación aumentativa y alternativa (CAA). Funciona en el navegador (Safari en iPad, Chrome en Android o en la compu) y sin conexión una vez preparada.
Hay dos usos:
- Cuenta registrada (profesional o familia, entra con Google): crea y edita tableros, gestiona usuarios en "Mis usuarios", les asigna copias de tableros, vincula tablets y mira la Estadística.
- Tablet vinculada a un usuario: muestra sus tableros para comunicarse; no se edita (salvo copias con permiso "Modificable").
Formas de elegir (modos de acceso): Manual, Barrido, Rostro y Mirada (ver tema "modos").
Temas de esta ayuda: modos, manual, barrido, rostro, mirada, parpadeo, protegido, tablero, frase, favoritas, inicio, editor, configuracion, voz, sin-conexion, respaldo, practicar, usuarios, vinculacion, estadistica, claude, versiones.`
    },
    modos: {
        titulo: 'Modos de acceso',
        alias: ['modo', 'acceso', 'modos de acceso'],
        texto: `Se eligen arriba a la derecha (Manual · Barrido · Rostro · Mirada). Barrido, Rostro y Mirada entran siempre en Modo protegido (ver "protegido").
- Manual: se toca la celda con el dedo (o con un puntero/mouse).
- Barrido: se resaltan las opciones de a una (o por filas) y se elige con un pulsador, la barra espaciadora, tocando la pantalla o con un parpadeo.
- Rostro: la cámara sigue el movimiento de la cabeza; un cursor se mueve por la pantalla y se elige manteniéndolo quieto sobre la celda (fijación). Necesita calibrar.
- Mirada: usa el Seguimiento ocular del propio dispositivo (iPad: Accesibilidad → Seguimiento ocular); MiraVoz toma ese puntero y elige con su fijación.
Cómo orientar: quien puede tocar con precisión → Manual; quien controla bien un movimiento voluntario (botón, pulsador, parpadeo) → Barrido; quien mueve la cabeza → Rostro; en iPad con buena mirada → Mirada. Es una decisión de evaluación individual; conviene probar y comparar.`
    },
    manual: { titulo: 'Modo Manual', alias: ['tocar', 'toque'], texto: 'Se elige tocando la celda. Es el único modo sin Modo protegido: se ven Configuración, modos, edición y gestión. También es el modo al que vuelve "Salir" del Modo protegido.' },
    barrido: {
        titulo: 'Modo Barrido',
        alias: ['scan', 'scanning', 'pulsador', 'switch'],
        texto: `Se resalta de a una opción y se elige con el pulsador, la barra espaciadora, tocando cualquier parte de la pantalla o con un parpadeo (si está activado).
Configuración → Modo Barrido:
- Patrón: "Por filas" (primero la fila, después la celda) o "De a uno".
- Velocidad: cuánto queda resaltada cada opción (0,6 s a 3 s).
- Sonido: silencio, beep o decir la palabra resaltada (después de elegir, espera a que se diga la palabra elegida).
- Recuadro: normal, grueso o muy grueso, en amarillo, rojo, azul o negro (para quien no ve bien el resaltado).
Después de varias vueltas sin elegir, el barrido se pausa; cualquier pulsación lo reanuda. La barra de la frase (Decir, Borrar, etc.) se barre al final.`
    },
    rostro: {
        titulo: 'Modo Rostro',
        alias: ['cabeza', 'cara', 'calibrar', 'calibracion', 'alinear', 'recalibrar', 'camara'],
        texto: `La cámara frontal sigue el movimiento de la cabeza (la imagen nunca sale del dispositivo). Se elige manteniendo el cursor quieto sobre una celda el "tiempo para elegir" (Configuración → Fijación (Rostro y Mirada): 0,8 s a 5 s).
- Calibración: la primera vez se siguen 9 puntos; después alcanza con una verificación rápida. Se guarda por usuario y por orientación de la pantalla.
- Alinear: si la persona o la tablet se movieron, vuelve a la posición de la calibración sin perderla. En Modo protegido, "Alinear" está arriba junto a "Salir" (lo usa quien asiste).
- Recalibrar (fuera del Modo protegido): ofrece Alinear o calibrar de nuevo.
- Si no se ve la cara o la cabeza sale de posición, la selección se pausa sola.
Consejos: tablet fija y apaisada, buena luz de frente, la cara entera en cámara.`
    },
    mirada: {
        titulo: 'Modo Mirada (Seguimiento ocular del dispositivo)',
        alias: ['eye tracking', 'seguimiento ocular', 'ojos', 'ipad'],
        texto: `Usa el Seguimiento ocular del sistema (iPad con chip A12 o más nuevo, iPadOS 18+): el puntero se mueve con los ojos y MiraVoz elige con SU fijación (mismo tiempo de Configuración, barra de progreso en la celda, pausa después de elegir y registro como "mirada").
Preparación en el iPad:
1. Ajustes → Accesibilidad → Atajo de accesibilidad → marcar "Seguimiento ocular" (así se prende y apaga con tres clics en el botón de arriba).
2. Ajustes → Accesibilidad → Seguimiento ocular → activar y seguir los puntos para calibrar.
3. En esa misma pantalla, apagar "Control por permanencia" (la fijación la hace MiraVoz). Si queda prendido, MiraVoz evita elegir dos veces y lo avisa.
4. iPad apoyado y quieto, a unos 45 cm, luz de frente.
Recalibrar: apagarlo y prenderlo (tres clics y tres clics). Una web no puede prender el Seguimiento ocular ni abrir su calibración. Si al entrar en Mirada no se detecta el puntero del sistema, MiraVoz avisa cómo activarlo.`
    },
    parpadeo: {
        titulo: 'Parpadeo para elegir',
        alias: ['blink', 'parpadear', 'ojos cerrados'],
        texto: `Configuración → Parpadeo. Se elige cerrando los ojos un momento; los parpadeos comunes no cuentan.
- Usar: No / Largo (cerrar los ojos la "Duración" elegida, 0,3 a 1,5 s) / Doble (dos parpadeos seguidos).
- Con fijación (en Rostro): "Sí" = se elige por fijación o por parpadeo; "No" = solo por parpadeo (la fijación solo resalta).
- En Barrido el parpadeo reemplaza al pulsador; mientras los ojos están cerrados el resaltado no avanza.
- "Ajuste personalizado" (8 s) adapta la detección a los ojos de la persona.`
    },
    protegido: {
        titulo: 'Modo protegido',
        alias: ['proteger', 'bloqueo', 'kiosco', 'salir', 'acceso guiado'],
        texto: `Barrido, Rostro y Mirada entran siempre en Modo protegido: pantalla completa y solo quedan los tableros, Practicar y las etiquetas (dentro del tablero: la frase, Favoritas, Deshacer y la navegación). Se ocultan el selector de modo, Recalibrar, Configuración, buscar y ordenar, Mis usuarios y todo lo que edita.
Para salir: botón "Salir" (arriba a la derecha) + confirmación → vuelve a Manual. En Rostro también están "Alinear" y "Calibrar". Dentro de un tablero, el candado de la barra de la frase abre las opciones de quien asiste (Alinear, Calibrar de nuevo, Ir al inicio, Salir). Esos botones no son objetivos de la fijación ni del barrido (la persona no los activa sin querer).
Para que tampoco se pueda salir de Safari: Ajustes del iPad → Accesibilidad → Acceso guiado (se activa con tres clics dentro de Safari).`
    },
    tablero: {
        titulo: 'Usar un tablero',
        alias: ['celdas', 'paginas', 'navegar', 'comunicar'],
        texto: `Arriba está la barra de la frase; abajo, las celdas. Al elegir una celda se dice su palabra y se agrega a la frase (si la celda lo indica). Algunas celdas llevan a otra página (tienen una marca) y vuelven con "Atrás" o "Inicio".
Barra de la frase: Inicio · Atrás · [frase] · Favoritas (estrella) · Decir (mientras habla pasa a Detener) · Borrar último · Borrar todo · Deshacer (aparece después de borrar).
La frase no se borra al cambiar de tablero. Compatible con tableros de Asterics Grid (teclado con predicción de palabras, celda de frase, radio, páginas web, audio grabado).`
    },
    frase: {
        titulo: 'Frase: Decir, Detener, Borrar y Deshacer',
        alias: ['deshacer', 'detener', 'borrar', 'decir', 'voz pendiente'],
        texto: `- Decir: dice la frase armada. Mientras habla, el mismo botón pasa a Detener (corta la voz sin borrar la frase).
- Borrar último / Borrar todo: quitan la última palabra o toda la frase.
- Deshacer: aparece después de borrar y recupera la frase exacta (varias veces seguidas); desaparece al agregar algo nuevo.
- En iPad la voz necesita un primer toque en la pantalla después de abrir la app; si alguien elige antes con la cabeza o la mirada, la frase se dice en ese primer toque (si mientras tanto se borró, no se dice).`
    },
    favoritas: {
        titulo: 'Frases favoritas',
        alias: ['favoritos', 'estrella', 'frases guardadas'],
        texto: `La estrella de la barra abre Favoritas: frases guardadas de esa persona para decirlas con una sola selección ("Necesito ayuda", "Me duele").
- "Guardar la frase": guarda la frase armada (hasta 24, sin repetidas).
- Elegir una tarjeta: la pone en la frase y la dice (se puede deshacer).
- "Quitar una": la próxima tarjeta elegida se quita.
Se eligen con el mismo modo de acceso del tablero. No reordenan el tablero. Se guardan en el dispositivo, por usuario, y viajan en el respaldo.`
    },
    inicio: {
        titulo: 'Pantalla de inicio (lista de tableros)',
        alias: ['home', 'lista', 'etiquetas', 'buscar', 'ordenar', 'importar', 'nuevo tablero'],
        texto: `Arriba: + (nuevo tablero), importar (.grd de Asterics Grid u .obz), pestañas de etiquetas con contadores, buscar, ordenar (última modificación, creación, alfabético, agrupar por etiqueta) y filtro por usuario.
Barra en una línea: +, importar, etiquetas (una por vez; tocar la elegida vuelve a Todos; con flechitas si no entran), y a la derecha buscar, ordenar y usuario. Cada tarjeta: abrir tocándola; íconos para asignar a un usuario y etiquetas, y el menú "…" con Exportar .grd, Duplicar y Eliminar.
A la derecha, flechas grandes de página anterior/siguiente para pasar la lista con la mirada o el barrido (grisadas si no hay más).
En la tablet vinculada se ven solo los tableros de ese usuario, sin herramientas de edición.`
    },
    editor: {
        titulo: 'Editar tableros',
        alias: ['editar', 'celda', 'pictograma', 'arasaac', 'niveles'],
        texto: `Con el lápiz del tablero (o con el botón derecho sobre una celda) se entra en edición.
- Editar una celda: tocarla (o botón derecho → Editar). Texto, qué dice, color, nivel de vocabulario, a qué página lleva, TAMAÑO (cuántas columnas y filas ocupa: una celda puede ser grande, como "carne" ocupando tres columnas) e IMAGEN: un pictograma de ARASAAC o una imagen propia ("Subir imagen propia": foto o dibujo; se achica sola para que pese poco y anda sin conexión). "Quitar imagen" la saca.
- Botón derecho sobre una celda: Editar, Duplicar, Copiar, Cortar, Pegar, Ocultar/Mostrar (oculta en uso, visible al editar) y Eliminar. Sobre un lugar vacío: Nueva celda o Pegar.
- Mover: arrastrar una celda (se ve la celda entera y dónde cae: verde si entra, rojo si no). Dos celdas de 1×1 se intercambian; una grande se mueve solo si entra. Con el dedo: mantener apretada un instante y arrastrar (mantener y soltar sin mover abre el menú de la celda).
- Varias celdas juntas: "Seleccionar" en la barra y tocarlas, o Shift/Cmd + clic, o arrastrar un recuadro desde un lugar vacío. Arrastrar una seleccionada mueve todas; la barra de abajo permite Duplicar, Ocultar/Mostrar o Eliminar. Con teclado: flechas para mover, Supr para eliminar, Esc para soltar, Cmd/Ctrl+A para elegir todas.
- Filas y columnas intermedias: el botón "···" de cada fila (a la izquierda) o columna (arriba), o el botón derecho sobre una celda: insertar arriba/abajo o izquierda/derecha, o eliminar (solo si está vacía, para no perder contenido).
- Deshacer y Rehacer: flechas curvas de la barra, o Cmd/Ctrl+Z y Cmd/Ctrl+Shift+Z.
- Barra de edición: nombre, Dificultad (nivel de vocabulario), "Filas" y "Columnas" (− y + con la cantidad en el medio; agregan o quitan al final), "Espaciado" entre celdas de la página (chico a muy grande, para separar estímulos) y "Fondo" (color de fondo de la página; "Sin fondo" lo quita). Con fondo, las celdas vacías quedan transparentes: sirven de separadores.
- Tamaño también arrastrando el borde derecho (ancho), el de abajo (alto) o la esquina de la celda. "Mostrar el texto en la celda" se puede apagar para dejar solo la imagen (la voz sigue diciendo el texto). Páginas en la franja de miniaturas.
- Si una celda más grande tapa otras, se avisa antes de quitarlas; todo se puede deshacer y cada guardado deja una versión restaurable.
Desde Claude: celdas grandes (ancho/alto en poner_celdas), ocultar/mostrar (oculta), imagen propia desde una dirección https pública (imagen_url, hasta 1 MB; las fotos adjuntas en el chat no llegan al conector: esas se suben desde MiraVoz) y color de fondo de la página (fondo en editar_pagina).`
    },
    configuracion: {
        titulo: 'Configuración',
        alias: ['ajustes', 'settings', 'engranaje'],
        texto: `Engranaje abajo a la izquierda (no visible en Modo protegido). Sin scroll, en dos columnas:
- Izquierda: Fijación de Rostro y Mirada (tiempo para elegir), Modo Barrido (patrón, velocidad, sonido), Parpadeo (usar, duración, con fijación, ajuste personalizado).
- Derecha: Voz (voz, velocidad, tono, Probar), Sin conexión y respaldo (Preparar sin conexión, Actualizar ahora cuando hay versión nueva, Descargar/Restaurar respaldo), Registro de uso (en la tablet, si está activado: Pausar).
- Abajo: Cerrar sesión o Desvincular tablet (en rojo) y la versión.`
    },
    voz: {
        titulo: 'Voz',
        alias: ['voces', 'velocidad', 'tono', 'mejorada', 'premium', 'isabela', 'monica'],
        texto: `Configuración → Voz. Se elige por usuario y se guarda en cada dispositivo (cada uno tiene su lista de voces).
- Voz: "Automática" (prefiere las mejoradas), una voz de la lista, o "La de Ajustes del dispositivo (España/México/Argentina)": MiraVoz no elige voz y el sistema usa la configurada en Accesibilidad → Contenido leído.
- Velocidad (lenta a rápida) y Tono (grave a agudo). "Probar" dice una frase.
- Voces "mejoradas/premium": suenan más naturales y funcionan sin conexión. iPad/Mac: Ajustes → Accesibilidad → Contenido leído → Voces → Español. Android: Ajustes → Accesibilidad → Texto a voz → Google → instalar la voz en español.
- Safari en iPad no muestra en la lista las voces mejoradas descargadas: usar "La de Ajustes del dispositivo".
- Las voces marcadas "necesita internet" (p. ej. "Google español" en Chrome) no suenan sin conexión; sin red se usa una local.
- Con el iPad en silencio, Safari puede no emitir la voz.`
    },
    'sin-conexion': {
        titulo: 'Uso sin conexión y actualizaciones',
        alias: ['offline', 'sin internet', 'actualizar', 'preparar'],
        texto: `"Preparar sin conexión" (Configuración) descarga la app, el motor de cámara y los pictogramas de los tableros del dispositivo; después todo funciona sin internet, incluida la voz local.
Cuando hay una versión nueva aparece "Actualizar ahora" (y la versión se ve abajo en Configuración). Los cambios hechos sin conexión se sincronizan solos al volver la red.`
    },
    respaldo: {
        titulo: 'Respaldo',
        alias: ['backup', 'copia de seguridad', 'restaurar', 'exportar'],
        texto: `Configuración → "Descargar respaldo": un archivo .miravoz.json con los tableros de la cuenta, las favoritas y las palabras aprendidas por la predicción de quien usa ese dispositivo. No incluye tokens, calibraciones ni el registro de uso.
"Restaurar respaldo" muestra qué trae y nunca reemplaza: agrega los tableros como nuevos (con "(respaldo)" si el nombre ya existe) y suma favoritas y palabras. En la tablet se respaldan solo las favoritas y palabras de su usuario.`
    },
    practicar: {
        titulo: 'Practicar',
        alias: ['juegos', 'actividades', 'entrenamiento'],
        texto: `Botón "Practicar": actividades opcionales para aprender el modo de acceso (no evalúan ni son requisito):
1. Pintar con sonido (causa y efecto) · 2. Descubrir (explorar) · 3. Globos (apuntar) · 4. Elegir · 5. Seguir · 6. Parpadear (con el parpadeo activado).
Se usan con el mismo modo de acceso; "Actividades" vuelve al menú y se puede salir también con el parpadeo. Algunas actividades son solo para modos con cursor (no Barrido).`
    },
    usuarios: {
        titulo: 'Mis usuarios',
        alias: ['usuario', 'nuevo usuario', 'tarjeta', 'copias', 'asignar'],
        texto: `"Mis usuarios" (abajo a la derecha, solo cuenta registrada): buscador y tarjetas en dos columnas.
Cada tarjeta: nombre, "Última conexión" de su tablet, código vigente y si tiene el registro de uso activo.
- Tableros: arriba a la derecha "Tablero de inicio" (una de sus copias o ninguno: la tablet abre directo ahí o muestra la lista). Cada copia es una tarjeta con miniatura: tocarla abre la copia para editarla (al ir al inicio se vuelve a esta pantalla); tacho para quitarla; "Permisos" ("Solo visualización" o "Modificable"); "Sincronización" ("Actualizado" o "Con cambios"). Al asignar un tablero el usuario recibe una COPIA; el original no cambia.
- Si está "Con cambios": "Copiar mi versión" (la copia queda igual al original) o "Traer sus cambios" (el original queda igual a la copia). Antes de pisar se guarda la versión anterior (se puede restaurar desde Claude con historial_tablero).
- En el ícono de asignar de un tablero, quien ya tiene su copia muestra "Editar copia", el mismo cartel ("Actualizado" o "Con cambios") y los botones "Copiar mi versión" y "Traer sus cambios".
- Estadística: ver tema "estadistica". Al crear un usuario, el registro de uso viene activado (se declara el consentimiento); se puede destildar.
- Nuevo código: para vincular una tablet (ver "vinculacion"). Desvincular tablet.
- Tacho junto al nombre: eliminar el usuario (borra sus copias).`
    },
    vinculacion: {
        titulo: 'Vincular una tablet',
        alias: ['codigo', 'vincular', 'desvincular', 'tablet'],
        texto: `1. En Mis usuarios → tarjeta del usuario → "Nuevo código": 4 caracteres, un solo uso, vence a los 30 minutos (el anterior deja de servir).
2. En la tablet: abrir miravoz.com.ar → "Vincular esta tablet con un código" → escribir el código.
La tablet queda mostrando los tableros de ese usuario (sin cuenta ni edición). Para desvincular: desde la tarjeta del usuario o en la tablet (Configuración → Desvincular tablet, pide escribir DESVINCULAR).`
    },
    estadistica: {
        titulo: 'Estadística y registro de uso',
        alias: ['progreso', 'registro', 'metricas', 'consentimiento'],
        texto: `El registro de uso guarda en el servidor cada selección, frase, página y tiempo de la tablet del usuario, solo si la cuenta lo activó declarando el consentimiento del usuario o su familia. Se activa/desactiva y se borra en Mis usuarios → Estadística; en la tablet se puede pausar. Se conserva 24 meses.
Estadística (7/30/90 días): días con uso, minutos, selecciones, frases, tiempo por selección, correcciones, selecciones por día, celdas más usadas, celdas sin uso registrado, cómo elige (fijación, parpadeo, barrido, toque, mirada), variación del tiempo entre selecciones y frases recientes.
Criterio: son observaciones para conversar, no diagnósticos. Una celda sin uso registrado no significa que sobre; el vocabulario no se mueve por frecuencia.`
    },
    claude: {
        titulo: 'MiraVoz con Claude',
        alias: ['mcp', 'conector', 'ia'],
        texto: `Con el conector, Claude puede leer y editar los tableros de la cuenta registrada (crear, poner celdas con pictogramas de ARASAAC, páginas, revisar, historial y restaurar versiones), gestionar usuarios, asignaciones y códigos, y leer la Estadística. Antes de cambios importantes pide confirmación, y después ofrece el enlace para abrir el tablero en MiraVoz.
Cuando se agregan herramientas nuevas al conector, hay que volver a conectarlo en Claude.`
    },
    versiones: {
        titulo: 'Versiones',
        alias: ['version', 'changelog', 'novedades'],
        texto: `La versión se ve abajo en Configuración. Serie 0.x mientras no esté en producción (1.0.0 al usarse en producción). Cada publicación suma una letra (por ejemplo 0.7.9a, 0.7.9b…) hasta pasar al número siguiente. Si la versión del dispositivo es vieja, Configuración ofrece "Actualizar ahora".`
    }
};

const norm = (s) => String(s || '').toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Devuelve el texto de ayuda para un tema (o el índice si no se encuentra). Pura. */
export function ayuda(tema) {
    const q = norm(tema);
    const indice = () => `Guía de MiraVoz (${AYUDA_VERSION}). Temas: ${Object.entries(TEMAS).map(([k, t]) => `${k} (${t.titulo})`).join(' · ')}.`;
    if (!q) return `${indice()}\n\n${TEMAS.general.texto}`;
    const hit = Object.entries(TEMAS).find(([k, t]) => norm(k) === q || t.alias.some(a => norm(a) === q))
        || Object.entries(TEMAS).find(([k, t]) => norm(k).includes(q) || q.includes(norm(k)) || t.alias.some(a => q.includes(norm(a)) || norm(a).includes(q)));
    if (!hit) return `No hay un tema "${tema}". ${indice()}`;
    const [k, t] = hit;
    return `## ${t.titulo} (tema: ${k}, guía ${AYUDA_VERSION})\n${t.texto}`;
}
