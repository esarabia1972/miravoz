# Checklist de pruebas de usuario — Fase 0

Marcar ✅/❌ y anotar observaciones. Los ítems marcados 🔬 generan datos para la Fase 1: anotar el detalle aunque fallen (es esperado).

**Setup:** app desplegada en Vercel (no local), notebook con webcam, buena luz de frente (no ventana de fondo). Tener a mano: `nuclear.grd`, un `.obz` con imágenes embebidas, y un tablero real de Leticia exportado de AsTeRICS.

---

## 1. Humo básico (modo Manual)

- [ ] Importar `nuclear.grd` → se ve la grilla completa
- [ ] **Colores:** abrir el mismo tablero en AsTeRICS Grid al lado → las celdas tienen los mismos colores por categoría (amarillo pronombres, verde verbos, naranja sustantivos, rojo importante…)
- [ ] Navegar a un sub-tablero y volver (botón atrás)
- [ ] Componer frase de 3 pictogramas → se ven **imagen Y texto** en la barra
- [ ] Componer una frase de **más de 8 pictogramas** → no se pierde el inicio (scrollea)
- [ ] Play habla la frase completa; borrar último y limpiar funcionan
- [ ] Importar el tablero real de Leticia → celdas grandes (multi-celda) se ven como en AsTeRICS, sin huecos raros

## 2. Import OBZ y offline

- [ ] Importar el `.obz` → pictogramas visibles
- [ ] Activar **modo avión** (o cortar WiFi) y recargar la app → los pictogramas del `.obz` siguen visibles
- [ ] (Con red de nuevo) El tablero de prueba 1-9 funciona

## 3. Alternado de modos (el bug de la demo anterior)

- [ ] Manual → Rostro → Manual → Rostro, 3 veces seguidas → el cursor verde aparece SIEMPRE al volver a Rostro
- [ ] Cambiar de modo en medio de un tablero abierto → no se "trula", no queda en estado raro
- [ ] Verificar que **"Modo Iris" NO aparece** en el selector (y que sí aparece agregando `?iris=1` a la URL)

## 4. Modo Rostro — calibración

- [ ] Calibrar Esteban → seleccionar 5 celdas del tablero de prueba 3×3 sin errores
- [ ] Calibrar Leticia **CON anteojos** 🔬 → ¿completa la calibración? ¿el cursor responde? *(si falla, anotar: tipo de luz, reflejo visible, distancia a la pantalla)*
- [ ] Calibrar Leticia sin anteojos → comparar sensación
- [ ] 🔬 **Borde inferior:** intentar seleccionar celdas de la última fila → ¿llega el cursor? *(el "no puedo bajar" es esperado; se corrige en F1 — anotar cuán grave es)*
- [ ] 🔬 **Esquinas:** ¿llega a las 4 esquinas del tablero?
- [ ] Recalibrar desde el botón → funciona sin recargar la página
- [ ] Cerrar la pestaña, volver a abrir, elegir Rostro → usa la calibración guardada (no obliga a recalibrar)

## 5. Modo Rostro — histéresis y dwell (lo nuevo)

- [ ] Apuntar a una celda y "temblar" a propósito sobre el borde con la vecina → la barra de progreso avanza igual (antes se reseteaba a cero)
- [ ] Quedarse quieto en una celda → selecciona exactamente una vez (sin dobles clicks)
- [ ] Cambiar fijación a **0.8 s** → se siente más rápido; a **5 s** → hay que sostener mucho más
- [ ] Recargar la página → el tiempo de fijación elegido se recuerda
- [ ] 🔬 Con Leticia: ¿qué preset le resulta cómodo? ¿cuál usaría con un usuario inicial? *(anotar)*
- [ ] Seleccionar los botones del acumulador (play/borrar) con la cara → funcionan con dwell

## 6. Persistencia y datos

- [ ] "Cerrar sesión" → recargar → **los tableros siguen ahí** (antes se borraba todo)
- [ ] Eliminar un tablero → pide confirmación → desaparece
- [ ] Buscar tablero por nombre en el buscador

## 7. Tarea integradora (simula uso real)

- [ ] En modo Rostro, con el tablero nuclear: componer "yo quiero" + comida + reproducir. Cronometrar. 🔬 *(este tiempo es la línea de base para medir la mejora de F1)*
- [ ] La misma tarea en modo Manual (control)

---

## Registro para Fase 1 (llenar al final)

| Dato | Valor |
|---|---|
| ¿Calibración con anteojos funcionó? | |
| Gravedad del error en borde inferior (1-5) | |
| Preset de dwell preferido (Leticia) | |
| Tiempo tarea integradora en Rostro | |
| Tiempo tarea integradora en Manual | |
| Falsas selecciones en la tarea (cantidad) | |
| Otras observaciones de Leticia | |
