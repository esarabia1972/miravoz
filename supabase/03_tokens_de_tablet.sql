-- MiraVoz — Migración 03: vincular la tablet con un TOKEN (sin sesiones anónimas) · 10/10/2026
-- Requiere 01 y 02 aplicadas. Idempotente. Corre en una transacción.
--
-- Por qué: la vinculación con sesión anónima de Supabase falló en la prueba real (depende de que
-- "Allow anonymous sign-ins" esté activo, del límite de sign-ins anónimos por IP y del CAPTCHA, y
-- además una sesión anónima en la tablet se mezcla con la sesión de la profesional en el mismo navegador).
-- Ahora la tablet NO inicia sesión: canjea el código por un token secreto (256 bits) que guarda en el
-- dispositivo, y lee/guarda sus copias solo a través de funciones del servidor que validan ese token.
-- En la base se guarda solo el HASH del token (si alguien leyera la tabla, no podría usarlo).
--
-- Después de correr esto se puede DESACTIVAR "Allow anonymous sign-ins" en Supabase (ya no se usa).

begin;

-- =====================================================================
-- 1. Tokens de tablet
-- =====================================================================
create table if not exists public.device_tokens (
  token_hash text primary key,                       -- sha256 del token, en hex
  aac_user_id uuid not null references public.aac_users(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
alter table public.device_tokens enable row level security;

-- La profesional ve y puede desvincular las tablets de SUS usuarios (el hash no sirve para entrar)
drop policy if exists "Profesionales ven tablets de sus usuarios" on public.device_tokens;
create policy "Profesionales ven tablets de sus usuarios" on public.device_tokens
  for select to authenticated using (auth.uid() = professional_id);
drop policy if exists "Profesionales desvinculan tablets" on public.device_tokens;
create policy "Profesionales desvinculan tablets" on public.device_tokens
  for delete to authenticated using (auth.uid() = professional_id);
-- (sin insert/update: los tokens solo los crea device_redeem)

-- Intentos fallidos de canje (límite GLOBAL: sin sesión no hay identidad por dispositivo)
create table if not exists public.redeem_failures (
  id bigint generated always as identity primary key,
  ip text,
  attempted_at timestamptz not null default now()
);
alter table public.redeem_failures add column if not exists ip text;
alter table public.redeem_failures enable row level security; -- sin políticas: solo las funciones
create index if not exists redeem_failures_at_idx on public.redeem_failures (attempted_at);
create index if not exists redeem_failures_ip_idx on public.redeem_failures (ip, attempted_at);
-- Defensa en profundidad: además de RLS, sin permisos de tabla para quien no inició sesión
revoke all on public.device_tokens from anon;
revoke all on public.redeem_failures from anon, authenticated;

create or replace function public._device_token_hash(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- =====================================================================
-- 2. Canje: código de 8 caracteres → token de la tablet
-- =====================================================================
drop function if exists public.device_redeem(text);
create or replace function public.device_redeem(p_code text)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_row public.access_codes%rowtype;
  v_user public.aac_users%rowtype;
  v_token text;
  v_headers json := nullif(current_setting('request.headers', true), '')::json;
  v_ip text := coalesce(v_headers->>'cf-connecting-ip', split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1), 'desconocida');
begin
  -- Límites: 10 fallos cada 10 min por IP (frena a quien prueba códigos sin bloquear a las demás tablets)
  -- y 2000 cada 10 min en total como respaldo. Con 32^8 combinaciones y códigos que vencen en 7 días,
  -- adivinar uno es inviable.
  perform pg_advisory_xact_lock(hashtext('device_redeem'));
  if (select count(*) from public.redeem_failures f
      where f.ip = v_ip and f.attempted_at > now() - interval '10 minutes') >= 10
     or (select count(*) from public.redeem_failures f where f.attempted_at > now() - interval '10 minutes') >= 2000 then
    raise exception 'Demasiados intentos. Esperá unos minutos y probá de nuevo.' using errcode = 'P0001';
  end if;

  select * into v_row from public.access_codes c
  where c.code = v_code and c.redeemed_at is null and c.expires_at > now()
  for update;

  if not found then
    insert into public.redeem_failures (ip) values (v_ip);
    return json_build_object('ok', false, 'error', 'Código inválido, vencido o ya usado.');
  end if;

  update public.access_codes set redeemed_at = now() where code = v_row.code;
  select * into v_user from public.aac_users u where u.id = v_row.aac_user_id;

  v_token := encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex'); -- 256 bits
  insert into public.device_tokens (token_hash, aac_user_id, professional_id)
  values (public._device_token_hash(v_token), v_user.id, v_user.professional_id);

  delete from public.redeem_failures f where f.attempted_at < now() - interval '1 day'; -- limpieza

  return json_build_object('ok', true, 'token', v_token,
    'aac_user_id', v_user.id, 'display_name', v_user.display_name,
    'home_board_id', v_user.home_board_id, 'settings', v_user.settings);
end;
$$;

-- =====================================================================
-- 3. La tablet trae su usuario y sus copias
-- =====================================================================
drop function if exists public.device_fetch(text);
create or replace function public.device_fetch(p_token text)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_t public.device_tokens%rowtype;
  v_user public.aac_users%rowtype;
begin
  select * into v_t from public.device_tokens d where d.token_hash = public._device_token_hash(p_token);
  if not found then
    return json_build_object('ok', false, 'unlinked', true); -- desvinculada o usuario borrado
  end if;
  update public.device_tokens set last_seen_at = now() where token_hash = v_t.token_hash;
  select * into v_user from public.aac_users u where u.id = v_t.aac_user_id;
  return json_build_object(
    'ok', true,
    'user', json_build_object('aac_user_id', v_user.id, 'display_name', v_user.display_name,
                              'home_board_id', v_user.home_board_id, 'settings', v_user.settings),
    'assignments', coalesce((
      select json_agg(json_build_object('id', a.id, 'board_id', a.board_id, 'copy_bundle', a.copy_bundle,
                                        'permission', a.permission, 'copy_updated_at', a.copy_updated_at))
      from public.assignments a where a.aac_user_id = v_user.id), '[]'::json));
end;
$$;

-- =====================================================================
-- 4. La tablet guarda una copia (solo si es editable), con concurrencia optimista
-- =====================================================================
drop function if exists public.device_save_copy(text, uuid, jsonb, timestamptz);
create or replace function public.device_save_copy(
  p_token text, p_assignment_id uuid, p_copy_bundle jsonb, p_expected_updated_at timestamptz)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_t public.device_tokens%rowtype;
  v_a public.assignments%rowtype;
begin
  select * into v_t from public.device_tokens d where d.token_hash = public._device_token_hash(p_token);
  if not found then
    return json_build_object('ok', false, 'unlinked', true);
  end if;

  select * into v_a from public.assignments a
  where a.id = p_assignment_id and a.aac_user_id = v_t.aac_user_id
  for update;
  if not found then raise exception 'No autorizado' using errcode = '42501'; end if;
  if v_a.permission <> 'editable' then raise exception 'Este tablero es de solo lectura' using errcode = '42501'; end if;
  if jsonb_typeof(p_copy_bundle) <> 'object' or pg_column_size(p_copy_bundle) > 5000000 then
    raise exception 'Tablero inválido o demasiado grande' using errcode = '22023';
  end if;
  if p_expected_updated_at is not null
     and date_trunc('milliseconds', v_a.copy_updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    return json_build_object('ok', false, 'conflict', true,
                             'copy_bundle', v_a.copy_bundle, 'copy_updated_at', v_a.copy_updated_at);
  end if;

  update public.assignments
  set copy_bundle = p_copy_bundle, copy_updated_at = date_trunc('milliseconds', now())
  where id = p_assignment_id
  returning * into v_a;
  return json_build_object('ok', true, 'copy_updated_at', v_a.copy_updated_at);
end;
$$;

-- =====================================================================
-- 5. Permisos: las funciones de tablet las puede llamar cualquiera (validan el código/token adentro)
-- =====================================================================
revoke all on function public._device_token_hash(text) from public, anon, authenticated;
revoke all on function public.device_redeem(text) from public;
revoke all on function public.device_fetch(text) from public;
revoke all on function public.device_save_copy(text, uuid, jsonb, timestamptz) from public;
grant execute on function public.device_redeem(text) to anon, authenticated;
grant execute on function public.device_fetch(text) to anon, authenticated;
grant execute on function public.device_save_copy(text, uuid, jsonb, timestamptz) to anon, authenticated;

-- =====================================================================
-- 6. Retiro del esquema de sesiones anónimas (02): ya no se usa
-- =====================================================================
drop policy if exists "Dispositivo ve su usuario" on public.aac_users;
drop policy if exists "Dispositivo ve sus copias" on public.assignments;
drop policy if exists "Dispositivo ve su vinculo" on public.device_links;
drop function if exists public.redeem_access_code(text);
drop function if exists public.save_assignment_copy(uuid, jsonb, timestamptz);
drop table if exists public.device_links;
drop table if exists public.redeem_attempts;


commit;

-- Limpieza (fuera de la transacción: si el editor no permitiera borrar en auth.users, falla solo esto):
-- sesiones anónimas que quedaron de los intentos de vinculación anteriores (no son personas)
delete from auth.users u where coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false);

-- Verificación (una fila)
select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('device_redeem', 'device_fetch', 'device_save_copy')) = 3 as funciones_ok,
  (select relrowsecurity from pg_class where oid = 'public.device_tokens'::regclass) as tokens_rls,
  (select count(*) from pg_policies where policyname like 'Dispositivo%') = 0 as politicas_viejas_retiradas,
  has_function_privilege('anon', 'public.device_redeem(text)', 'execute') as tablet_puede_canjear,
  not has_function_privilege('anon', 'public._device_token_hash(text)', 'execute') as hash_privado,
  not has_table_privilege('anon', 'public.device_tokens', 'select') as tokens_ocultos_para_anon,
  (select count(*) from auth.users u where coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false)) as usuarios_anonimos;
