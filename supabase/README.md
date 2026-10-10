# supabase/ — Esquema y seguridad de la base

La anon key de MiraVoz es pública (va en el cliente). Por eso la seguridad depende **solo** de las políticas RLS de cada tabla, y toda tabla nueva tiene que tener su SQL versionado acá (regla 4 de `EQUIPO.md`).

## Estado al 09/10/2026 (actualizado)

- ✅ `00_auditoria.sql` corrido. ✅ `01_schema_f4.sql` aplicado (verificación: assignments_ok=true, profesionales_sin_fila=0, políticas de storage eliminadas).
- ✅ Prueba con anon key sin sesión: 0 filas en todas las tablas (RLS OK para anónimos).
- Triggers en auth.users: `on_auth_user_created → handle_new_user` (legado) y `on_auth_user_created_professional → ensure_professional`.
- ✅ `02_f4-4_vinculacion.sql` aplicado (funciones_ok, device_links_rls, codigos_solo_por_servidor = true; profesionales_anonimos = 0). Anonymous sign-ins activado.
- ✅ Bucket legado `boards` eliminado de Storage (no quedan buckets).
- ✅ `05_limpiar_cuentas_de_prueba.sql` corrido (10/10): queda solo esteban.sarabia@gmail.com con 3 tableros.
- ✅ `03_tokens_de_tablet.sql` aplicado (10/10): todas las verificaciones en true y 0 usuarios anónimos. Comprobado desde el navegador con la anon key: `device_fetch` con un token falso da `{ok:false, unlinked:true}`; `device_tokens` da 401; `_device_token_hash` da 401; la RPC vieja da 404.
- ✅ Google OAuth configurado (proyecto MiraVoz en Google Cloud, modo Testing con 2 usuarios de prueba). Verificado en `/auth/v1/settings`: google=true, anonymous_users=false. Site URL y Redirect URLs cargadas.
- Pendiente: probar RLS con dos cuentas de Google; política de privacidad para publicar la app en Google (salir de Testing).

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
