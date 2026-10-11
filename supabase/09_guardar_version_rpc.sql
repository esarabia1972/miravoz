-- MiraVoz — Guardar versiones con una función (11/10/2026, servidor MCP etapa 3)
-- Reemplaza la dependencia de la política de INSERT de board_versions (que en producción rechazaba las copias con
-- 42501): el servidor llama a save_board_version(), que verifica en el servidor que el tablero, o la asignación de
-- la copia, sea de la cuenta, y recién ahí guarda. Requiere 07. Se puede correr más de una vez.

create or replace function public.save_board_version(p_board_id text, p_bundle jsonb, p_note text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ok boolean := false;
  v_id bigint;
begin
  if v_uid is null then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_board_id like 'copia:%' then
    select exists (
      select 1 from public.assignments a
      left join public.aac_users u on u.id = a.aac_user_id
      where a.id::text = substr(p_board_id, 7)
        and (a.professional_id = v_uid or u.professional_id = v_uid)
    ) into v_ok;
  else
    select exists (select 1 from public.boards b where b.id = p_board_id and b.owner_professional_id = v_uid) into v_ok;
  end if;
  if not v_ok then raise exception 'No autorizado: el tablero o la copia no es de esta cuenta' using errcode = '42501'; end if;
  insert into public.board_versions (board_id, owner_professional_id, bundle, source, note)
  values (p_board_id, v_uid, p_bundle, 'claude', left(p_note, 200))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.save_board_version(text, jsonb, text) from public, anon;
grant execute on function public.save_board_version(text, jsonb, text) to authenticated;

-- Diagnóstico (solo lectura): función creada y asignaciones sin dueño explícito
select
  (select count(*) from pg_proc where proname = 'save_board_version') = 1 as funcion_ok,
  (select count(*) from public.assignments where professional_id is null) as asignaciones_sin_profesional;
