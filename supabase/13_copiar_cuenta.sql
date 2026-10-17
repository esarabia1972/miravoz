-- 13_copiar_cuenta.sql — MiraVoz 0.8.1c · Copiar los datos de una cuenta registrada a otra (para pruebas)
--
-- Copia de la cuenta ORIGEN a la cuenta DESTINO: tableros, usuarios (con sus ajustes y tablero de inicio) y
-- asignaciones (las copias de tableros de cada usuario). Todo se crea NUEVO en la cuenta destino, con ids nuevos.
-- La cuenta origen NO se toca: el script solo hace INSERT en la cuenta destino (ningún UPDATE ni DELETE sobre ella).
--
-- NO se copian: las tablets vinculadas ni los códigos (las tablets siguen siendo de la cuenta origen), el
-- historial de versiones, ni el registro de uso (salvo que se active v_copiar_registro más abajo: son las frases
-- y selecciones de las personas, datos sensibles).
--
-- Todo lo copiado queda marcado (copiadoDe) para poder borrarlo con el PASO 3. Los usuarios copiados llevan
-- " (copia)" en el nombre y los tableros la etiqueta "Copia de prueba".
--
-- Cómo usarlo (Supabase → SQL Editor):
--   PASO 1: correr solo el bloque "PASO 1" (vista previa, no cambia nada).
--   PASO 2: correr el bloque "PASO 2" (copia, todo o nada). Si ya se copió antes, se frena para no duplicar.
--   PASO 3 (opcional, más adelante): borra de la cuenta destino SOLO lo que copió este script.

-- =====================================================================
-- PASO 1 — Vista previa (no cambia nada)
-- =====================================================================
with origen as (select id from auth.users where lower(email) = lower('letialberti@hotmail.com')),
     destino as (select id from auth.users where lower(email) = lower('esteban.sarabia@gmail.com'))
select
  (select count(*) from origen) = 1                                                   as origen_existe,
  (select count(*) from destino) = 1                                                  as destino_existe,
  (select count(*) from public.boards b, origen o where b.owner_professional_id = o.id) as tableros_a_copiar,
  (select count(*) from public.aac_users u, origen o where u.professional_id = o.id)    as usuarios_a_copiar,
  (select count(*) from public.assignments a join public.aac_users u on u.id = a.aac_user_id, origen o
     where u.professional_id = o.id)                                                  as asignaciones_a_copiar,
  (select count(*) from public.usage_events e join public.aac_users u on u.id = e.aac_user_id, origen o
     where u.professional_id = o.id)                                                  as eventos_de_registro_no_se_copian;


-- =====================================================================
-- PASO 2 — Copiar (todo o nada)
-- =====================================================================
do $$
declare
  v_from_email text := 'letialberti@hotmail.com';     -- cuenta ORIGEN (no se modifica)
  v_to_email   text := 'esteban.sarabia@gmail.com';   -- cuenta DESTINO (recibe la copia)
  v_copiar_registro boolean := false;                 -- true = copia también el registro de uso (datos sensibles)
  v_from uuid; v_to uuid; v_stamp text := to_char(now(), 'YYYY-MM-DD HH24:MI');
  v_marca jsonb;
  r record; v_new_id text; v_n_boards int := 0; v_n_users int := 0; v_n_asg int := 0; v_n_ev int := 0;
begin
  select id into v_from from auth.users where lower(email) = lower(v_from_email);
  select id into v_to   from auth.users where lower(email) = lower(v_to_email);
  if v_from is null then raise exception 'No existe la cuenta origen %', v_from_email; end if;
  if v_to   is null then raise exception 'No existe la cuenta destino %', v_to_email; end if;
  if v_from = v_to  then raise exception 'Origen y destino son la misma cuenta'; end if;
  if not exists (select 1 from public.professionals where id = v_to) then
    raise exception 'La cuenta destino todavía no entró nunca a MiraVoz (no tiene perfil de profesional)';
  end if;
  -- No duplicar: si ya hay una copia de esta cuenta en el destino, se frena (para repetir, primero el PASO 3)
  if exists (select 1 from public.aac_users where professional_id = v_to and settings->'copiadoDe'->>'cuenta' = v_from::text)
     or exists (select 1 from public.boards where owner_professional_id = v_to and bundle->'copiadoDe'->>'cuenta' = v_from::text) then
    raise exception 'Ya hay una copia de % en %. Para volver a copiar, primero borrala con el PASO 3.', v_from_email, v_to_email;
  end if;
  v_marca := jsonb_build_object('cuenta', v_from::text, 'email', v_from_email, 'fecha', v_stamp);

  create temp table map_boards (old_id text primary key, new_id text not null) on commit drop;
  create temp table map_users  (old_id uuid primary key, new_id uuid not null) on commit drop;
  create temp table map_asg    (old_id uuid primary key, new_id uuid not null) on commit drop;

  -- 1) Tableros: id nuevo (formato del cliente), dueño destino, marca y etiqueta "Copia de prueba"
  for r in select * from public.boards where owner_professional_id = v_from order by updated_at loop
    v_new_id := 'bundle_' || (floor(extract(epoch from clock_timestamp()) * 1000))::bigint::text || '_' || substr(md5(random()::text), 1, 5);
    insert into map_boards values (r.id, v_new_id);
    insert into public.boards (id, owner_professional_id, name, bundle, updated_at)
    values (v_new_id, v_to, r.name,
      jsonb_set(jsonb_set(jsonb_set(jsonb_set(r.bundle,
        '{id}', to_jsonb(v_new_id)),
        '{ownerId}', to_jsonb(v_to::text)),
        '{copiadoDe}', v_marca || jsonb_build_object('tablero', r.id)),
        '{tags}', (select coalesce(jsonb_agg(distinct t), '[]'::jsonb) from (
            select jsonb_array_elements_text(case when jsonb_typeof(r.bundle->'tags') = 'array' then r.bundle->'tags' else '[]'::jsonb end) as t
            union select 'Copia de prueba') s)),
      now());
    v_n_boards := v_n_boards + 1;
  end loop;

  -- 2) Usuarios: id nuevo, nombre con " (copia)", ajustes copiados (sin registro de uso activo) y marca
  for r in select * from public.aac_users where professional_id = v_from order by created_at loop
    insert into map_users values (r.id, gen_random_uuid());
    insert into public.aac_users (id, professional_id, display_name, home_board_id, settings, created_at)
    select m.new_id, v_to, left(r.display_name || ' (copia)', 60), null,
           jsonb_set(coalesce(r.settings, '{}'::jsonb) - 'metrics', '{copiadoDe}', v_marca || jsonb_build_object('usuario', r.id::text)),
           now()
    from map_users m where m.old_id = r.id;
    v_n_users := v_n_users + 1;
  end loop;

  -- 3) Asignaciones (la copia de tablero de cada usuario): ids nuevos, tablero y usuario remapeados
  for r in select a.* from public.assignments a join map_users mu on mu.old_id = a.aac_user_id loop
    insert into map_asg values (r.id, gen_random_uuid());
    insert into public.assignments (id, board_id, aac_user_id, copy_bundle, permission, copy_updated_at, assigned_at, professional_id)
    select ma.new_id, mb.new_id, mu.new_id,
           r.copy_bundle
             || jsonb_build_object('copiadoDe', v_marca)
             || case when mb.new_id is not null and r.copy_bundle ? 'id' and r.copy_bundle->>'id' = r.board_id then jsonb_build_object('id', mb.new_id) else '{}'::jsonb end
             || case when r.copy_bundle ? 'ownerId' then jsonb_build_object('ownerId', v_to::text) else '{}'::jsonb end,
           r.permission, now(), now(), v_to
    from map_asg ma join map_users mu on mu.old_id = r.aac_user_id left join map_boards mb on mb.old_id = r.board_id
    where ma.old_id = r.id;
    v_n_asg := v_n_asg + 1;
  end loop;

  -- 4) Tablero de inicio de cada usuario copiado → su asignación copiada
  update public.aac_users nu set home_board_id = ma.new_id
  from public.aac_users ou join map_users mu on mu.old_id = ou.id join map_asg ma on ma.old_id = ou.home_board_id
  where nu.id = mu.new_id and ou.home_board_id is not null;

  -- 5) Registro de uso (solo si se pidió)
  if v_copiar_registro then
    insert into public.usage_events (aac_user_id, professional_id, device_hash, session_id, ts, kind, board_id, assignment_id, page_id, cell_id, label, method, duration_ms, data, received_at)
    select mu.new_id, v_to, e.device_hash, e.session_id, e.ts, e.kind, coalesce(mb.new_id, e.board_id), ma.new_id, e.page_id, e.cell_id, e.label, e.method, e.duration_ms, e.data, now()
    from public.usage_events e join map_users mu on mu.old_id = e.aac_user_id
    left join map_asg ma on ma.old_id = e.assignment_id left join map_boards mb on mb.old_id = e.board_id;
    get diagnostics v_n_ev = row_count;
  end if;

  raise notice 'Copiado de % a %: % tableros, % usuarios, % asignaciones, % eventos de registro.', v_from_email, v_to_email, v_n_boards, v_n_users, v_n_asg, v_n_ev;
end $$;

-- Verificación: lo copiado en la cuenta destino
select
  (select count(*) from public.boards where bundle->'copiadoDe'->>'email' = 'letialberti@hotmail.com')            as tableros_copiados,
  (select count(*) from public.aac_users where settings->'copiadoDe'->>'email' = 'letialberti@hotmail.com')        as usuarios_copiados,
  (select count(*) from public.assignments where copy_bundle->'copiadoDe'->>'email' = 'letialberti@hotmail.com')  as asignaciones_copiadas;


-- =====================================================================
-- PASO 3 (opcional) — Borrar de la cuenta DESTINO solo lo que copió este script
-- (Descomentar para usar. No toca nada de la cuenta origen ni lo creado a mano en la cuenta destino.)
-- =====================================================================
-- do $$
-- declare v_to uuid; v_from_email text := 'letialberti@hotmail.com';
-- begin
--   select id into v_to from auth.users where lower(email) = lower('esteban.sarabia@gmail.com');
--   delete from public.aac_users where professional_id = v_to and settings->'copiadoDe'->>'email' = v_from_email;   -- borra también sus asignaciones y registro (cascade)
--   delete from public.boards    where owner_professional_id = v_to and bundle->'copiadoDe'->>'email' = v_from_email;
-- end $$;
