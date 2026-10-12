-- 12_registro_sin_duplicados.sql — MiraVoz 0.7.5
-- 1) Cada evento del registro de uso trae un id generado en la tablet. Si la tablet reintenta un envío cuya
--    respuesta se perdió, el servidor no lo guarda dos veces.
-- 2) Se aceptan los eventos nuevos: 'deshacer' (deshacer un borrado de la frase) y 'voz_detenida'.
-- Se puede correr más de una vez.

alter table public.usage_events add column if not exists event_id text;
create unique index if not exists usage_events_event_uidx
  on public.usage_events (aac_user_id, event_id) where event_id is not null;

create or replace function public.device_log_events(p_token text, p_events jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_t public.device_tokens%rowtype;
  v_settings jsonb;
  v_n integer;
begin
  select * into v_t from public.device_tokens d where d.token_hash = public._device_token_hash(p_token);
  if not found then return json_build_object('ok', false, 'unlinked', true); end if;
  select u.settings into v_settings from public.aac_users u where u.id = v_t.aac_user_id;
  if coalesce((v_settings -> 'metrics' ->> 'enabled')::boolean, false) is not true then
    return json_build_object('ok', false, 'disabled', true); -- sin consentimiento: no se guarda nada
  end if;
  if jsonb_typeof(p_events) <> 'array' then return json_build_object('ok', false, 'error', 'formato'); end if;

  insert into public.usage_events (aac_user_id, professional_id, device_hash, session_id, ts, kind, board_id,
                                   assignment_id, page_id, cell_id, label, method, duration_ms, data, event_id)
  select v_t.aac_user_id, v_t.professional_id, left(v_t.token_hash, 12),
         left(e ->> 'session', 40),
         greatest(least(coalesce((e ->> 'ts')::timestamptz, now()), now() + interval '1 day'), now() - interval '60 days'),
         left(e ->> 'kind', 30), left(e ->> 'board', 80),
         case when (e ->> 'assignment') ~ '^[0-9a-f-]{36}$' then (e ->> 'assignment')::uuid end,
         left(e ->> 'page', 80), left(e ->> 'cell', 80), left(e ->> 'label', 200), left(e ->> 'method', 20),
         case when (e ->> 'ms') ~ '^[0-9]{1,9}$' then (e ->> 'ms')::integer end,
         case when jsonb_typeof(e -> 'data') = 'object' and length((e -> 'data')::text) <= 4000 then e -> 'data' end,
         nullif(left(e ->> 'id', 64), '')
  from (select value as e from jsonb_array_elements(p_events) limit 500) x
  where coalesce(e ->> 'kind', '') in ('sesion_inicio', 'sesion_fin', 'seleccion', 'cancelada', 'frase', 'borrar', 'borrar_todo',
                                       'deshacer', 'voz_detenida',
                                       'pagina', 'tablero', 'pausa', 'calibracion', 'alineacion', 'practica', 'modo', 'registro_pausado', 'registro_reanudado')
  on conflict (aac_user_id, event_id) where event_id is not null do nothing;
  get diagnostics v_n = row_count;

  -- Conservación: 24 meses (se limpia de a poco, solo para este usuario)
  delete from public.usage_events where aac_user_id = v_t.aac_user_id and ts < now() - interval '24 months';
  return json_build_object('ok', true, 'saved', v_n);
end;
$$;
revoke all on function public.device_log_events(text, jsonb) from public;
grant execute on function public.device_log_events(text, jsonb) to anon, authenticated;

-- Verificación: las dos columnas en true
select exists (select 1 from information_schema.columns where table_name = 'usage_events' and column_name = 'event_id') as columna_ok,
       exists (select 1 from pg_indexes where indexname = 'usage_events_event_uidx') as indice_ok;
