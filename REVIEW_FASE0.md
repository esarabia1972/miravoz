# Code Review — Fase 0 (auditoría contra SPEC_FASES_0-4.md)

## ✅ SEGUNDA PASADA (04/07/2026): APROBADO

Verificación de la re-entrega, ítem por ítem del checklist:

- ✅ Colores: mapa exacto `CC_*` (verificado contra los valores reales de `nuclear.grd`), fallback `getAutoColor()` restaurado, prioridad `backgroundColor` > categoría > fallback correcta.
- ✅ `hidden: true` respetado (la celda se renderiza como `empty-cell`, no interactiva).
- ✅ Navegación: `modelName === 'GridActionNavigate'` en `handleCellClick` (~964) y duplicado muerto de la inferencia de raíz eliminado.
- ✅ Histéresis 2.0: esquema `candidateCell`/`candidateSince` implementado según lo pedido — cubre salida a vacío Y a celda vecina con la regla única de persistencia.
- ✅ Presets 3 s y 5 s presentes.
- ✅ `calibDataY`, rama muerta final y `ENABLE_CLICK_SOUND`/`playClickSound`: eliminados por completo.
- ✅ Iris: `<option>` removido del DOM vía JS (compatible Safari), restaurable con `?iris=1`.
- ✅ `node --check` en verde.

**Fase 0 cerrada. Habilitado para pruebas de usuario.** Pendiente anotado (no bloqueante): migrar `miravoz_dwell` de localStorage al objeto `miravoz_settings` a más tardar en F2 (SPEC F2-5).

---

## Primera pasada (histórico)

**Fecha:** 04/07/2026 · **Revisor:** Claude · **Veredicto: NO aprobado todavía** — 8 de 11 ítems bien resueltos, pero hay 1 regresión crítica y 2 fixes incompletos que deben corregirse antes de las pruebas de usuario.

---

## ✅ Aprobado

| Ítem | Verificación |
|---|---|
| F0-1 Cámara al alternar modos | Correcto: `isMediaPipeRunning = false` en el stop, y el flag se setea después de `camera.start()`. |
| F0-2 Regex OBZ | Correcto: `/\.(png\|jpe?g\|gif\|svg\|webp)$/i`. |
| F0-4 Logout no destructivo | Correcto: `localforage.clear()` eliminado. |
| F0-5 Acumulador | Correcto: texto bajo la imagen (`span` + CSS con ellipsis), sin límite de 8, auto-scroll conservado. |
| F0-9 Spans multi-celda | Bien resuelto: `renderedCells` evita empty-cells debajo de spans, `gridColumn/gridRow` con `span`. |
| F0-10 (parcial) | XSS de cards resuelto con `textContent` ✓ · estados unificados a `CALIBRATING_*` ✓ · comentario obsoleto eliminado ✓. |
| F0-11 Iris oculto | Funciona con `?iris=1`. Ver observación menor abajo. |
| Apéndice B | Completo: `.gitignore`, `legacy/`, `ayuda-backup.grd`, `CHANGELOG.md`. |

`node --check` en verde. La sintaxis y la estructura general están limpias.

---

## 🔴 Bloqueante 1 — F0-8: regresión de colores (el fix no funciona con datos reales)

`getCategoryColor()` mapea claves inventadas (`'nouns'`, `'verbs'`, `'subjects'`…), pero los valores reales del formato GRD son `CC_NOUN`, `CC_VERB`, `CC_IMPORTANT`, `CC_DESCRIPTOR`, `CC_PRONOUN_PERSON_NAME`, `CC_PLACE`, `CC_SOCIAL_EXPRESSIONS`, `CC_OTHERS` (tabla en SPEC §0.5 y §F0-8, extraída de `nuclear.grd`).

**Test ejecutado:** las 8 categorías reales devuelven `null`. Y como además se eliminó el fallback `getAutoColor()`, el resultado neto es que **los tableros que antes mostraban colores ahora no muestran ninguno**. Peor que antes del cambio.

**Fix requerido:**

```js
const colors = {
  'CC_PRONOUN_PERSON_NAME': '#fff176',
  'CC_VERB': '#81c784',
  'CC_DESCRIPTOR': '#64b5f6',
  'CC_NOUN': '#ffb74d',
  'CC_IMPORTANT': '#ff8a80',
  'CC_SOCIAL_EXPRESSIONS': '#f48fb1',
  'CC_PLACE': '#ba68c8',
  'CC_OTHERS': '#9e9e9e'
};
return colors[category] || null;   // sin toLowerCase(); los valores son case-exactos
```

Prioridad de color (spec): `backgroundColor` explícito > `colorCategory` > `getAutoColor()` como fallback legacy (restaurarlo, no borrarlo).
**Falta también de F0-8:** respetar `hidden: true` (no renderizar la celda como interactiva).
**Test de aceptación:** importar `nuclear.grd` → las celdas se ven coloreadas como en AsTeRICS Grid.

## 🔴 Bloqueante 2 — F0-3: el fix se aplicó en el lugar equivocado

Se agregó el check de `modelName === 'GridActionNavigate'` en la **inferencia del tablero raíz** (que ya lo tenía desde antes — ahora hay un `else if` duplicado muerto en esa zona), pero **no en `handleCellClick`** (~línea 967), que era exactamente donde el spec lo pedía. Los GRD antiguos (solo `modelName`, sin `navType`) siguen sin navegar al hacer click.

**Fix requerido en `handleCellClick`:**

```js
if ((action.navType === 'navigateToGrid' || action.modelName === 'GridActionNavigate') && action.toGridId) {
```

Y limpiar el `else if` duplicado en la inferencia de raíz (~547).

## 🟡 Bloqueante 3 — F0-6: histéresis incompleta (protege el caso raro, no el común)

La implementación con `leaveTime` solo aplica histéresis cuando el cursor sale a **espacio vacío** (`hoveredCellObj === null`). Pero cuando el jitter cruza a la **celda vecina** —el caso más frecuente en tableros densos, donde las celdas son adyacentes— el cambio es inmediato y el progreso se resetea igual que antes.

**Fix requerido:** el cambio a otra celda también debe esperar. Esquema:

```js
// candidateCell/candidateSince como estado adicional
if (hoveredCellObj !== currentCell) {
    if (hoveredCellObj !== candidateCell) { candidateCell = hoveredCellObj; candidateSince = now; }
    if (now - candidateSince > CONFIG.HYSTERESIS_MS) {
        /* recién acá: soltar currentCell y adoptar candidateCell (o null) */
    }
    // mientras tanto, currentCell conserva su progreso
} else {
    candidateCell = null;
}
```

Esto unifica ambos casos (salida a vacío y a vecina) con una sola regla: *la nueva situación debe persistir HYSTERESIS_MS antes de aceptarse*.
**Test:** oscilar el cursor sobre el borde compartido de dos celdas a ~5 Hz: el progreso de la celda original avanza.

## 🟠 Menores (corregir en el mismo pase)

1. **F0-10 restos:** `calibDataY` sigue declarada (línea ~251); la rama muerta `else if (currentCell)` al final de `handleGazeInteraction` sigue ahí (~1218); `CONFIG.ENABLE_CLICK_SOUND` se sigue referenciando (~1210) sin estar definido ni existir `playClickSound()` — definir ambos o borrar la referencia (bomba latente).
2. **F0-7:** faltan los presets de 3 s y 5 s del spec — clínicamente importantes: Leticia tenía el dwell en ~5 s con usuarios iniciales. Agregar `3000` y `5000` al select.
3. **F0-11:** `style="display:none"` sobre un `<option>` **no funciona en Safari** (iPad es target real). Reemplazar por remover/insertar el nodo `<option>` desde JS.
4. Anotación (no exige cambio ahora): el dwell se guardó en `localStorage` con clave suelta `miravoz_dwell`; el spec define el objeto `miravoz_settings` en localforage, que F2 (barrido) y F4 (perfiles) van a necesitar. Migrar a más tardar en F2.

---

## Checklist de re-entrega

- [ ] `nuclear.grd` muestra colores Fitzgerald (verificar visual contra AsTeRICS Grid)
- [ ] Celdas `hidden: true` no se muestran
- [ ] GRD viejo (solo `modelName`) navega al click
- [ ] Jitter sobre borde entre celdas vecinas no resetea el progreso
- [ ] Presets 3 s / 5 s presentes
- [ ] Sin referencias a símbolos indefinidos (`ENABLE_CLICK_SOUND`/`playClickSound` resueltos)
- [ ] Iris invisible también en Safari
- [ ] Checklist de humo completo (SPEC §0.7)

Tras la re-entrega, segunda pasada de revisión (rápida, solo sobre estos puntos) y recién entonces pruebas de usuario con Leticia.
