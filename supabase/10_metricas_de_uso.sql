-- MiraVoz — Métricas de uso de la tablet, granulares (11/10/2026)
-- Decisión de Esteban: se registran los EVENTOS de uso (cada selección, frase, página, pausa, calibración…),
-- no solo resúmenes, para no perder riqueza de análisis. Como la secuencia de selecciones equivale a lo que la
-- persona comunicó, se registra SOLO si la cuenta registrada declaró tener el consentimiento del usuario o de su
-- familia (aac_users.settings.metrics.enabled = true). La tablet puede pausar el registro.
-- La tablet escribe solo a través de device_log_events() (valida el token y el consentimiento); la cuenta dueña
-- lee y borra los de sus usuarios (RLS). Se conservan 24 meses. Se puede correr más de una vez.

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  aac_user_id uuid not null references public.aac_users(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  device_hash text,
  session_id text,
  ts timestamptz not null,
  kind text not null,
  board_id text,
  assignment_id uuid,
  page_id text,
  cell_id text,
  label text,
  method text,
  duration_ms integer,
  data jsonb,
  received_at timestamptz not null default now()
);
create index if not exists usage_events_user_ts_idx on public.usage_events (aac_user_id, ts desc);
create index if not exists usage_events_prof_idx on public.usage_events (professional_id, ts desc);

alter table public.usage_events enable row level security;
revoke all on public.usage_events from anon;

drop policy if exists "Uso: ver los de mis usuarios" on public.usage_events;
create policy "Uso: ver los de mis usuarios" on public.usage_events
  for select to authenticated using (professional_id = auth.uid());
drop policy if exists "Uso: borrar los de mis usuarios" on public.usage_events;
create policy "Uso: borrar los de mis usuarios" on public.usage_events
  for delete to authenticated using (professional_id = auth.uid());
-- (sin insert/update desde la API: solo device_log_events)

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
                                   assignment_id, page_id, cell_id, label, method, duration_ms, data)
  select v_t.aac_user_id, v_t.professional_id, left(v_t.token_hash, 12),
         left(e ->> 'session', 40),
         greatest(least(coalesce((e ->> 'ts')::timestamptz, now()), now() + interval '1 day'), now() - interval '60 days'),
         left(e ->> 'kind', 30), left(e ->> 'board', 80),
         case when (e ->> 'assignment') ~ '^[0-9a-f-]{36}$' then (e ->> 'assignment')::uuid end,
         left(e ->> 'page', 80), left(e ->> 'cell', 80), left(e ->> 'label', 200), left(e ->> 'method', 20),
         case when (e ->> 'ms') ~ '^[0-9]{1,9}$' then (e ->> 'ms')::integer end,
         case when jsonb_typeof(e -> 'data') = 'object' and length((e -> 'data')::text) <= 4000 then e -> 'data' end
  from (select value as e from jsonb_array_elements(p_events) limit 500) x
  where coalesce(e ->> 'kind', '') in ('sesion_inicio', 'sesion_fin', 'seleccion', 'cancelada', 'frase', 'borrar', 'borrar_todo',
                                       'pagina', 'tablero', 'pausa', 'calibracion', 'alineacion', 'practica', 'modo', 'registro_pausado', 'registro_reanudado');
  get diagnostics v_n = row_count;

  -- Conservación: 24 meses (se limpia de a poco, solo para este usuario)
  delete from public.usage_events where aac_user_id = v_t.aac_user_id and ts < now() - interval '24 months';
  return json_build_object('ok', true, 'saved', v_n);
end;
$$;
revoke all on function public.device_log_events(text, jsonb) from public;
grant execute on function public.device_log_events(text, jsonb) to anon, authenticated;

-- Verificación
select (select relrowsecurity from pg_class where oid = 'public.usage_events'::regclass) as rls,
       (select count(*) from pg_proc where proname = 'device_log_events') = 1 as funcion_ok;
