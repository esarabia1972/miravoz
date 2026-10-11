# Protocolo de validación en el iPad Air (M01–M08)

Para hacer primero con quien desarrolla y, recién después, con personas destinatarias (con consentimiento,
descansos y duración adaptada). **No inventar datos faltantes**: si algo no se midió, se deja en blanco.
No guardar video, fotos ni textos comunicados.

## 1. Planilla de la sesión

| Dato | Valor |
|---|---|
| Fecha / persona (código, sin nombre) | |
| iPad (modelo y generación) | |
| iPadOS y navegador (Safari / pantalla de inicio) | |
| Versión de MiraVoz (Configuración, al pie) | |
| Modo (Rostro / Iris) y motor (`?diag=1`: main / worker, GPU / CPU) | |
| Orientación y distancia aproximada a la cara | |
| Luz (de frente / lateral / contraluz) y anteojos | |

## 2. Recorrido

1. **Preparación:** permiso de cámara, "Probar voz" (gesto del acompañante), Configuración → "Preparar para usar sin conexión" (anotar el estado que muestra).
2. **Calibración** sin pedir movimiento de cabeza en Iris. Anotar el resultado de la **verificación** (error mediano, p90, señal válida) y si hubo que repetir.
3. **Benchmark 3×3** (`?benchmark=1`): anotar correctas/objetivos, errores, omisiones, activaciones en el descanso, mediana y p90 de tiempo. 4×4 solo si 3×3 resultó utilizable.
4. **Comunicación:** armar 3 frases, corregir con "borrar", navegar páginas, abrir y cerrar un diálogo **solo con la mirada**.
5. **Descanso explícito** de 2 minutos sin buscar seleccionar: contar activaciones no deseadas.
6. **Robustez:** tapar la cámara 5 s, cerrar los ojos 3 s, girar el iPad y volver, ir a otra app y volver. Anotar si hubo alguna selección indebida (debe ser 0) y qué pidió la app.
7. **Sin internet:** modo avión, cerrar Safari/la app y volver a abrir. ¿Abre? ¿Abre el tablero? ¿Funciona la mirada? ¿Habla?
8. **Sesión sostenida** de 20 minutos (con pausas): al inicio y al final, botón "Rendimiento" (`?diag=1`) para comparar latencias.
9. **Worker:** repetir 3 y 8 con `?vision=worker` y comparar.

## 3. Resultados a reportar (por persona y sesión, nunca solo un promedio general)

| Métrica | Valor |
|---|---|
| Aciertos / intentos (3×3) | |
| Omisiones / errores | |
| Activaciones no deseadas por minuto de descanso | |
| Tiempo mediano / p90 por selección | |
| Proporción de señal válida (verificación) | |
| Recalibraciones necesarias | |
| Selecciones indebidas en el paso 6 (debe ser 0) | |
| Arranque sin red: abre / tablero / mirada / voz | |
| Latencia captura→resultado p95 (inicio / fin de 20 min) | |
| Resultados por segundo (main / worker) | |

## 4. Criterios para decidir

- Las metas internas (95% en 3×3, 85% en 4×4) no son un estándar clínico: una selección errónea cada veinte puede seguir siendo demasiado costosa. Pesan igual las activaciones no deseadas y el esfuerzo de corrección.
- Si alguien no logra calibrar, se registra como resultado (no se excluye en silencio).
- Con estos datos se ajustan: `MAX_SAMPLE_AGE_MS` (`config.js`), las reglas de verificación (`validation.js`, nueva versión), la regla de geometría (`profiles.js`) y la decisión de usar el Worker por defecto.
