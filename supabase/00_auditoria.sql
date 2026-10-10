-- MiraVoz — Auditoría del esquema real de Supabase (SOLO LECTURA: no modifica nada)
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Devuelve UNA sola fila con una columna "auditoria" (JSON): copiá ese valor y pasáselo a Claude.
-- (Es una sola consulta a propósito: el SQL Editor solo muestra el resultado de la última sentencia.)

select json_build_object(

  -- 1. Tablas de public y si tienen RLS activada
  'tablas', (
    select json_agg(json_build_object('tabla', c.relname, 'rls', c.relrowsecurity, 'rls_forzada', c.relforcerowsecurity) order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'),

  -- 2. Columnas: tipo, nulabilidad, default (¿boards.id es text o uuid?)
  'columnas', (
    select json_agg(json_build_object('tabla', table_name, 'columna', column_name, 'tipo', data_type,
                                      'nullable', is_nullable, 'default', column_default)
                    order by table_name, ordinal_position)
    from information_schema.columns where table_schema = 'public'),

  -- 3. Políticas RLS (public y storage)
  'politicas', (
    select json_agg(json_build_object('esquema', schemaname, 'tabla', tablename, 'politica', policyname,
                                      'operacion', cmd, 'roles', roles, 'using', qual, 'with_check', with_check)
                    order by schemaname, tablename, policyname)
    from pg_policies where schemaname in ('public', 'storage')),

  -- 4. Claves foráneas y qué pasa al borrar
  'claves_foraneas', (
    select json_agg(json_build_object('tabla', conrelid::regclass::text, 'restriccion', conname,
                                      'definicion', pg_get_constraintdef(oid)))
    from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace),

  -- 5. Triggers (uno que reescriba updated_at rompería la concurrencia optimista de sync.js)
  'triggers', (
    select json_agg(json_build_object('tabla', event_object_table, 'trigger', trigger_name,
                                      'momento', action_timing, 'evento', event_manipulation, 'accion', action_statement))
    from information_schema.triggers where trigger_schema = 'public'),

  -- 6. Buckets de Storage (el spec pide cerrar el bucket legado "boards")
  'buckets', (
    select json_agg(json_build_object('id', b.id, 'publico', b.public,
                    'objetos', (select count(*) from storage.objects o where o.bucket_id = b.id)))
    from storage.buckets b),

  -- 7. Cantidad aproximada de filas por tabla (sin datos personales)
  'filas', (
    select json_agg(json_build_object('tabla', relname, 'filas_aprox', n_live_tup) order by relname)
    from pg_stat_user_tables where schemaname = 'public')

) as auditoria;
