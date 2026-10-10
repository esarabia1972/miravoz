# supabase/ — Esquema y seguridad de la base

La anon key de MiraVoz es pública (va en el cliente). Por eso la seguridad depende **solo** de las políticas RLS de cada tabla, y toda tabla nueva tiene que tener su SQL versionado acá (regla 4 de `EQUIPO.md`).

## Estado al 09/10/2026 (actualizado)

- ✅ `00_auditoria.sql` corrido. ✅ `01_schema_f4.sql` aplicado (verificación: assignments_ok=true, profesionales_sin_fila=0, políticas de storage eliminadas).
- ✅ Prueba con anon key sin sesión: 0 filas en todas las tablas (RLS OK para anónimos).
- Triggers en auth.users: `on_auth_user_created → handle_new_user` (legado) y `on_auth_user_created_professional → ensure_professional`.
- Pendiente: borrar el bucket `boards` desde el panel; probar RLS con la sesión de OTRA cuenta; F4-4 (canje de código por RPC security definer, sin políticas para anon).

### Estado inicial

- La base real tiene las tablas `boards`, `aac_users`, `access_codes` y `assignments`, que crearon la F4.1 y la F4.2. **Ninguna de ellas está versionada.**
- `../supabase_schema.sql` (raíz del repo) es el script viejo de junio, con el bucket de Storage y `user_settings`. Queda como histórico. No volver a correrlo.
- Desde el sandbox de Claude no hay acceso a `supabase.co`, así que la auditoría la tiene que correr Esteban.

## Pasos pendientes

1. Correr `00_auditoria.sql` en el SQL Editor. Es solo lectura. Después pasarle los resultados a Claude.
2. Con esos resultados, Claude escribe `01_schema_f4.sql`: el esquema real más las políticas RLS revisadas. Esteban lo aplica.
3. Hacer la prueba de RLS con la anon key, sin sesión y con la sesión de otra cuenta. Criterio 7 de F4.
4. Cerrar o eliminar el bucket `boards` de Storage, que es legado.

## Requisitos del cliente (`web/js/sync.js`) que el esquema tiene que cumplir

| Requisito | Por qué |
|---|---|
| `boards.id` de tipo `text` | El cliente usa ids `bundle_<ms>` |
| `boards.updated_at` lo escribe el cliente, **sin trigger que lo reescriba** | `sync.js` hace concurrencia optimista con `update … where updated_at = <leído>` |
| RLS de `boards`: el profesional dueño puede hacer select, insert, update y delete donde `owner_professional_id = auth.uid()` | Nadie más tiene acceso |
| `assignments.board_id → boards.id` con `on delete` definido | Que no impida borrar un tablero ya asignado. Decidir entre cascade y conservar la copia. |
| `access_codes`: lectura solo para el profesional dueño del `aac_user`; canje solo por Edge Function | F4-1 |
