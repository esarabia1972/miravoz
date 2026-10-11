# Validación en iPad — sesión del 11/10/2026

Protocolo: `PROTOCOLO_VALIDACION_IPAD.md`. Persona: quien desarrolla (Esteban). Sin video ni textos guardados.

| Dato | Valor |
|---|---|
| iPad | iPad Air 4ª gen. (cámara frontal en el borde corto: al costado con el iPad apaisado) |
| Navegador | Safari, www.miravoz.com.ar |
| Versiones probadas | 1.0.0 → 1.2.1 (cambios surgidos de esta sesión) |
| Modo / motor | Rostro · FaceLandmarker (tasks), hilo principal, GPU · ~30 resultados/s, inferencia p50/p95 ≈ 15/21 ms |
| Orientación | Horizontal (así se va a usar) |

## Resultados por paso

1. **Preparación:** vinculación por código OK, voz OK, "Preparado para usar sin conexión" OK.
2. **Calibración:** con 1.0.x la verificación fallaba (mediana 131 → 174 → 201 px; señal válida 100%). Diagnóstico: el modelo usaba la posición de la nariz (cambia si la persona se corre) y la verificación era a ciegas (la cabeza baja 3-4° en vertical en menos de un minuto; todo el alto de la pantalla son ~9°). Se corrigió en 1.1.0 (ángulos de la cabeza) y 1.2.0 (verificación con cursor visible). Con 1.2.0: **aceptada**.
3. **Benchmark:** 3×3 **20/20 (100%)**, 0 errores, 0 omisiones, mediana 2,8 s, p90 4,1 s, 0 activaciones en el descanso. 4×4 **20/20 (100%)**, mediana 2,6 s, p90 3,4 s, 0 activaciones. Comentario: "en algún momento se mostraba inestable, pero pude hacerlo".
4. **Comunicación:** frases, borrar, navegar páginas y diálogos solo con la cabeza: OK.
5. **Descanso de 2 min:** sin activaciones no deseadas.
6. **Robustez** (tapar cámara, ojos cerrados, girar, cambiar de app): 0 selecciones indebidas.
7. **Sin internet:** abre, tableros y pictogramas OK, cursor OK. La voz se trababa después de la primera celda → corregido en 1.2.1 (cada frase cancela la anterior, vigilante de 1,5 s, voces locales).
8. **Sesión de 20 min:** pendiente.
9. **Worker (`?vision=worker`):** pendiente.

## Pendientes que salen de la sesión

- Revisar el suavizado del cursor ("inestable en algún momento") con el diagnóstico `miravoz-diag-2026-10-11-14-21.json` (carpeta MiraVoz, no versionado).
- Confirmar la voz sin conexión con 1.2.1.
- Pasos 8 y 9.
