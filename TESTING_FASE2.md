# Fase 2 — Walkthrough y checklist: Modo Barrido

**Implementada por Claude · commit `fd112ac` · 04/07/2026**

## Qué hay de nuevo

- **"Modo Barrido"** en el selector de modos. Sin cámara: resalta las opciones secuencialmente y se selecciona con **cualquier activación**: barra espaciadora, Enter, click del mouse, tap en la pantalla — o un pulsador/switch comercial (que emula exactamente eso).
- Dos patrones (en Configuración ⚙): **Fila → Elemento** (activás para entrar a la fila resaltada en amarillo, después activás sobre el elemento resaltado en verde) y **Elemento por elemento**.
- Si una fila se recorre entera sin selección, vuelve al barrido de filas (escape implícito). Tras 3 vueltas completas sin actividad, pausa ("Barrido en pausa — activá para continuar").
- Los botones de la barra (reproducir, borrar, atrás, casa) barren como **último grupo** del ciclo.
- Configurable en ⚙: patrón, velocidad (0.6 a 3 s), sonido al barrer (silencioso / beep / decir cada opción).

## Checklist

### Básico (con barra espaciadora como "pulsador")
- [ ] Elegir Modo Barrido en un tablero → la primera fila se resalta en amarillo
- [ ] Espacio sobre una fila → entra y barre elemento por elemento (verde)
- [ ] Espacio sobre un elemento → lo dice y lo suma al acumulador
- [ ] Dejar pasar una fila completa sin activar → vuelve a barrer filas
- [ ] Componer y **reproducir** una frase de 3 pictogramas usando SOLO la barra espaciadora (incluye llegar al botón play en el grupo del acumulador)
- [ ] Navegar a un sub-tablero y volver, solo con Espacio
- [ ] 3 vueltas sin tocar nada → pausa; un Espacio la despierta

### Variantes
- [ ] Cambiar a "Elemento por elemento" en ⚙ → barre todo de corrido
- [ ] Velocidad 0.6s y 3s → se nota la diferencia; el ajuste persiste tras refresh
- [ ] Sonido "beep" y "decir cada opción" → suenan al barrer
- [ ] Tap/click en cualquier parte de la pantalla funciona igual que Espacio
- [ ] En el HOME también barre (elegir un tablero con el pulsador)
- [ ] El modo Barrido persiste tras refresh

### Con hardware real (cuando esté)
- [ ] Pulsador Bluetooth (Mercado Libre / AbleNet): emparejar y probar el flujo completo
- [ ] 🔬 Anotar: ¿el debounce de 250 ms alcanza o el switch rebota?

### Prueba clínica (Leticia)
- [ ] Compararlo contra el barrido del Grid 3 / Tobii de su paciente → ¿qué falta que sea bloqueante? (feedback directo para F2.1)
- [ ] ¿Los colores/contraste del resaltado se ven bien? ¿La velocidad default (1.2 s) es razonable?

## Criterio de cierre (SPEC F2)

Un usuario con un solo movimiento voluntario puede componer y reproducir una frase de 3 pictogramas navegando entre tableros. Si el checklist básico pasa, la fase está funcionalmente completa; el test con switch físico puede cerrar después sin bloquear la Fase 3.

## Registro

| Dato | Valor |
|---|---|
| Frase de 3 pictos solo con Espacio: ¿completada? | |
| Tiempo aproximado de la tarea | |
| Velocidad preferida | |
| Feedback de Leticia vs Grid 3 | |
| Switch físico probado (modelo) | |
