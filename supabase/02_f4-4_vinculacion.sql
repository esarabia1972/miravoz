-- MiraVoz — Migración F4-4: vincular la tablet del chico con un código (09/10/2026)
-- Requiere 01_schema_f4.sql aplicado. Idempotente. Corre en una transacción.
--
-- ORDEN IMPORTANTE: correr ESTA migración ANTES de activar "Allow anonymous sign-ins" en
-- Authentication → Sign In / Providers. (Ajusta el trigger para que una tablet anónima
-- NO se convierta en profesional.)
--
-- Modelo:
--  - La tablet del chico inicia una sesión ANÓNIMA de Supabase (sin email ni contraseña).
--  - La profesional genera un código (8 caracteres, un solo uso, vence en 7 días) con la
--    función create_access_code(). Ya no se insertan códigos desde el cliente.
--  - La tablet canjea el código con redeem_access_code(): límite de intentos, marca el código
--    como usado y vincula ese dispositivo con el usuario (tabla device_links).
--  - La tablet vinculada solo puede LEER su usuario y sus copias asignadas, y solo puede
--    GUARDAR una copia si el permiso es 'editable' (vía save_assignment_copy()).
--  - Ninguna política para el rol anon: todo pasa por sesión (anónima o de profesional).

begin;

-- =====================================================================
-- 1. Las sesiones anónimas (tablets) NO son profesionales
-- =====================================================================
create or replace function public.ensure_professional()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- to_jsonb: funciona aunque la versión de auth no tenga la columna is_anonymous
  if coalesce((to_jsonb(new)->>'is_anonymous')::boolean, false) then
    return new; -- tablet de un usuario: no crear fila de profesional
  end if;
  insert into public.professionals (id, display_name)
  values (new.id, coalesce(nullif(split_part(new.email, '@', 1), ''), 'Profesional'))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Limpieza por si ya se crearon profesionales para sesiones anónimas
delete from public.professionals p
using auth.users u
where u.id = p.id and coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false);

-- =====================================================================
-- 2. Dispositivos vinculados
-- =====================================================================
create table if not exists public.device_links (
  device_uid uuid primary key references auth.users(id) on delete cascade, -- sesión anónima de la tablet
  aac_user_id uuid not null references public.aac_users(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  linked_at timestamptz not null default now()
);
alter table public.device_links enable row level security;

-- La profesional ve y puede desvincular los dispositivos de SUS usuarios
drop policy if exists "Profesionales ven dispositivos de sus usuarios" on public.device_links;
create policy "Profesionales ven dispositivos de sus usuarios" on public.device_links
  for select to authenticated using (auth.uid() = professional_id);
drop policy if exists "Profesionales desvinculan dispositivos" on public.device_links;
create policy "Profesionales desvinculan dispositivos" on public.device_links
  for delete to authenticated using (auth.uid() = professional_id);
-- La tablet ve su propio vínculo
drop policy if exists "Dispositivo ve su vinculo" on public.device_links;
create policy "Dispositivo ve su vinculo" on public.device_links
  for select to authenticated using (auth.uid() = device_uid);
-- (Sin políticas de insert/update: el vínculo solo lo crea redeem_access_code)

-- Intentos de canje (para limitar fuerza bruta). Sin políticas: solo lo usan las funciones.
create table if not exists public.redeem_attempts (
  id bigint generated always as identity primary key,
  device_uid uuid not null,
  attempted_at timestamptz not null default now()
);
alter table public.redeem_attempts enable row level security;
create index if not exists redeem_attempts_device_idx on public.redeem_attempts (device_uid, attempted_at);

-- =====================================================================
-- 3. Lecturas de la tablet: su usuario y sus copias
-- =====================================================================
drop policy if exists "Dispositivo ve su usuario" on public.aac_users;
create policy "Dispositivo ve su usuario" on public.aac_users
  for select to authenticated
  using (exists (select 1 from public.device_links d
                 where d.device_uid = auth.uid() and d.aac_user_id = aac_users.id));

drop policy if exists "Dispositivo ve sus copias" on public.assignments;
create policy "Dispositivo ve sus copias" on public.assignments
  for select to authenticated
  using (exists (select 1 from public.device_links d
                 where d.device_uid = auth.uid() and d.aac_user_id = assignments.aac_user_id));
-- (Sin política de update para la tablet: si no, podría cambiarse el permiso a sí misma.
--  Guarda con save_assignment_copy, que verifica permission = 'editable'.)

-- =====================================================================
-- 4. Códigos: solo los genera el servidor
-- =====================================================================
-- La profesional puede VER y BORRAR los códigos de sus usuarios, pero ya no insertarlos a mano
-- (evita códigos débiles y el "oráculo" de códigos existentes por error de clave duplicada).
drop policy if exists "Profesionales gestionan códigos de acceso" on public.access_codes;
drop policy if exists "Profesionales ven códigos de sus usuarios" on public.access_codes;
create policy "Profesionales ven códigos de sus usuarios" on public.access_codes
  for select to authenticated
  using (exists (select 1 from public.aac_users u
                 where u.id = aac_user_id and u.professional_id = auth.uid()));
drop policy if exists "Profesionales borran códigos de sus usuarios" on public.access_codes;
create policy "Profesionales borran códigos de sus usuarios" on public.access_codes
  for delete to authenticated
  using (exists (select 1 from public.aac_users u
                 where u.id = aac_user_id and u.professional_id = auth.uid()));

-- Códigos del formato viejo (6 dígitos XXX-XXX, 10 años de vigencia): se eliminan los no usados
delete from public.access_codes
where redeemed_at is null and code !~ '^[A-HJ-NP-Z2-9]{8}$';

-- Genera un código nuevo para un usuario (invalida los anteriores no usados).
-- 8 caracteres de un alfabeto de 32 sin ambiguos (sin 0/O ni 1/I): 32^8 ≈ 1,1 billones, sin sesgo (256 % 32 = 0).
drop function if exists public.create_access_code(uuid);
create or replace function public.create_access_code(p_aac_user_id uuid)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea;
  new_code text;
  i int;
  tries int := 0;
begin
  if auth.uid() is null or not exists (
       select 1 from public.aac_users u where u.id = p_aac_user_id and u.professional_id = auth.uid()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  delete from public.access_codes c where c.aac_user_id = p_aac_user_id and c.redeemed_at is null;

  loop
    bytes := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
    new_code := '';
    for i in 0..7 loop
      new_code := new_code || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.access_codes c where c.code = new_code);
    tries := tries + 1;
    if tries > 5 then raise exception 'No se pudo generar un código único'; end if;
  end loop;

  insert into public.access_codes (code, aac_user_id, expires_at)
  values (new_code, p_aac_user_id, now() + interval '7 days');

  return json_build_object('code', new_code, 'expires_at', now() + interval '7 days');
end;
$$;

-- =====================================================================
-- 5. Canje del código desde la tablet
-- =====================================================================
drop function if exists public.redeem_access_code(text);
create or replace function public.redeem_access_code(p_code text)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_row public.access_codes%rowtype;
  v_user public.aac_users%rowtype;
begin
  if v_uid is null then
    raise exception 'Hace falta una sesión' using errcode = '42501';
  end if;
  if exists (select 1 from public.professionals p where p.id = v_uid) then
    raise exception 'Esta sesión es de una profesional: cerrá sesión para vincular la tablet' using errcode = '42501';
  end if;

  -- Límite: 5 intentos cada 15 minutos por dispositivo (lock para que requests en paralelo no lo salteen)
  perform pg_advisory_xact_lock(hashtext(v_uid::text));
  if (select count(*) from public.redeem_attempts a
      where a.device_uid = v_uid and a.attempted_at > now() - interval '15 minutes') >= 5 then
    raise exception 'Demasiados intentos. Esperá unos minutos y probá de nuevo.' using errcode = 'P0001';
  end if;
  insert into public.redeem_attempts (device_uid) values (v_uid);

  select * into v_row from public.access_codes c
  where c.code = v_code and c.redeemed_at is null and c.expires_at > now()
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'Código inválido, vencido o ya usado.');
  end if;

  update public.access_codes set redeemed_at = now() where code = v_row.code;

  select * into v_user from public.aac_users u where u.id = v_row.aac_user_id;

  insert into public.device_links (device_uid, aac_user_id, professional_id)
  values (v_uid, v_user.id, v_user.professional_id)
  on conflict (device_uid) do update
    set aac_user_id = excluded.aac_user_id,
        professional_id = excluded.professional_id,
        linked_at = now();

  delete from public.redeem_attempts a where a.device_uid = v_uid; -- canje exitoso: limpiar

  return json_build_object(
    'ok', true,
    'aac_user_id', v_user.id,
    'display_name', v_user.display_name,
    'home_board_id', v_user.home_board_id,
    'settings', v_user.settings
  );
end;
$$;

-- =====================================================================
-- 6. Guardar una copia desde la tablet (solo si es editable)
-- =====================================================================
-- Concurrencia optimista: si p_expected_updated_at no coincide, no guarda y devuelve la versión actual.
drop function if exists public.save_assignment_copy(uuid, jsonb, timestamptz);
create or replace function public.save_assignment_copy(
  p_assignment_id uuid, p_copy_bundle jsonb, p_expected_updated_at timestamptz)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_a public.assignments%rowtype;
begin
  select a.* into v_a from public.assignments a
  join public.device_links d on d.aac_user_id = a.aac_user_id and d.device_uid = auth.uid()
  where a.id = p_assignment_id
  for update of a;

  if not found then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v_a.permission <> 'editable' then
    raise exception 'Este tablero es de solo lectura' using errcode = '42501';
  end if;
  if jsonb_typeof(p_copy_bundle) <> 'object' or pg_column_size(p_copy_bundle) > 5000000 then
    raise exception 'Tablero inválido o demasiado grande' using errcode = '22023';
  end if;
  -- Comparación al milisegundo: el cliente (JS Date) no conserva microsegundos
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
-- 7. Permisos de ejecución: solo sesiones (anónimas o de profesional), nunca anon
-- =====================================================================
revoke all on function public.create_access_code(uuid) from public, anon;
revoke all on function public.redeem_access_code(text) from public, anon;
revoke all on function public.save_assignment_copy(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.create_access_code(uuid) to authenticated;
grant execute on function public.redeem_access_code(text) to authenticated;
grant execute on function public.save_assignment_copy(uuid, jsonb, timestamptz) to authenticated;
revoke all on function public.ensure_professional() from public, anon, authenticated;

commit;

-- Verificación (una fila)
select
  (select count(*) from pg_proc where proname in ('create_access_code', 'redeem_access_code', 'save_assignment_copy')
     and pronamespace = 'public'::regnamespace) = 3 as funciones_ok,
  (select relrowsecurity from pg_class where oid = 'public.device_links'::regclass) as device_links_rls,
  (select count(*) from pg_policies where tablename = 'access_codes' and cmd in ('INSERT', 'ALL')) = 0 as codigos_solo_por_servidor,
  (select count(*) from public.professionals p join auth.users u on u.id = p.id
     where coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false)) as profesionales_anonimos;
