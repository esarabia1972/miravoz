-- MiraVoz — Auditoría del esquema real de Supabase (SOLO LECTURA: no modifica nada)
-- Cómo usarlo: Supabase → SQL Editor → pegar todo → Run.
-- Copiar los resultados de cada bloque (o exportar como CSV) y pasárselos a Claude.
-- Objetivo (F4-2 / EQUIPO.md regla 4): versionar el esquema real y verificar RLS antes de seguir con F4.

-- 1. Tablas del esquema public y si tienen RLS activada
select c.relname                as tabla,
       c.relrowsecurity         as rls_activada,
       c.relforcerowsecurity    as rls_forzada
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

-- 2. Columnas, tipos, nulabilidad y defaults (¿boards.id es text o uuid? ¿hay triggers en updated_at?)
select table_name   as tabla,
       column_name  as columna,
       data_type    as tipo,
       is_nullable  as nullable,
       column_default as default_
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- 3. Políticas RLS existentes (quién puede leer/escribir qué)
select tablename as tabla, policyname as politica, cmd as operacion,
       roles, qual as condicion_using, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

-- 4. Claves foráneas y comportamiento al borrar (¿borrar un tablero asignado falla o cascadea?)
select tc.table_name as tabla, kcu.column_name as columna,
       ccu.table_name as referencia, ccu.column_name as columna_ref,
       rc.delete_rule as al_borrar
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name
join information_schema.constraint_column_usage ccu on tc.constraint_name = ccu.constraint_name
join information_schema.referential_constraints rc on tc.constraint_name = rc.constraint_name
where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public';

-- 5. Triggers (un trigger que reescriba updated_at rompe la concurrencia optimista de sync.js)
select event_object_table as tabla, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where trigger_schema in ('public')
order by 1;

-- 6. Bucket legado de Storage (el spec F4-2 pide cerrarlo o eliminarlo)
select id, name, public from storage.buckets;
select bucket_id, count(*) as objetos from storage.objects group by bucket_id;

-- 7. Volumen (sin datos personales)
select 'boards' as tabla, count(*) from public.boards
union all select 'aac_users', count(*) from public.aac_users
union all select 'assignments', count(*) from public.assignments
union all select 'access_codes', count(*) from public.access_codes;
