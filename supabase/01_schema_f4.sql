-- MiraVoz — Migración F4: esquema versionado + correcciones de seguridad (09/10/2026)
-- Basada en la auditoría real (00_auditoria.sql). Idempotente: se puede correr más de una vez.
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run. Corre en una transacción:
-- si algo falla, no se aplica nada.
--
-- Qué corrige:
--  A. assignments: un profesional podía asignar SU tablero a un usuario de OTRO profesional
--     (la política solo miraba el dueño del tablero, no el del usuario).
--  B. assignments: borrar el tablero original borraba en cascada todas las copias asignadas
--     (contradice el modelo de F4-3: la copia es independiente). Ahora la copia sobrevive.
--  C. professionals: garantizar que cada cuenta nueva tenga su fila (si falta, subir un tablero
--     falla por la FK boards.owner_professional_id → professionals.id).
--  D. aac_users.home_board_id: queda vinculado a una copia asignada (assignments.id).
--  E. access_codes: el código debe ser único.
--  F. Storage: se quitan las políticas del bucket legado "boards" (vacío, 0 objetos).
-- Hoy assignments tiene 0 filas: es el momento más seguro para cambiar su estructura.

begin;

-- =====================================================================
-- 0. Esquema actual (documentación versionada; no hace nada si ya existe)
-- =====================================================================
create table if not exists public.professionals (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null
);

create table if not exists public.aac_users (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  display_name text not null,
  home_board_id uuid,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.boards (
  id text primary key,                       -- ids del cliente: 'bundle_<ms>'
  owner_professional_id uuid not null references public.professionals(id) on delete cascade,
  name text not null,
  bundle jsonb not null,
  updated_at timestamptz not null default now()  -- lo escribe el cliente; SIN trigger (concurrencia optimista)
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  board_id text,
  aac_user_id uuid not null references public.aac_users(id) on delete cascade,
  copy_bundle jsonb not null,
  permission text not null,
  copy_updated_at timestamptz not null default now(),
  assigned_at timestamptz default now()
);

create table if not exists public.access_codes (
  code text primary key,
  aac_user_id uuid not null references public.aac_users(id) on delete cascade,
  expires_at timestamptz not null,
  redeemed_at timestamptz
);

alter table public.professionals enable row level security;
alter table public.aac_users     enable row level security;
alter table public.boards        enable row level security;
alter table public.assignments   enable row level security;
alter table public.access_codes  enable row level security;

-- =====================================================================
-- C. Fila de professionals para cada cuenta (trigger + backfill)
-- =====================================================================
create or replace function public.ensure_professional()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.professionals (id, display_name)
  values (new.id, coalesce(nullif(split_part(new.email, '@', 1), ''), 'Profesional'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_professional on auth.users;
create trigger on_auth_user_created_professional
  after insert on auth.users
  for each row execute procedure public.ensure_professional();

insert into public.professionals (id, display_name)
select u.id, coalesce(nullif(split_part(u.email, '@', 1), ''), 'Profesional')
from auth.users u
where not coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false) -- las tablets anónimas no son profesionales
on conflict (id) do nothing;

-- =====================================================================
-- A + B. assignments: dueño explícito, copia que sobrevive al original
-- =====================================================================
-- Dueño de la asignación. Default auth.uid(): el cliente actual no necesita mandarlo.
alter table public.assignments add column if not exists professional_id uuid;
alter table public.assignments alter column professional_id set default auth.uid();

update public.assignments a
set professional_id = u.professional_id
from public.aac_users u
where u.id = a.aac_user_id and a.professional_id is null;

alter table public.assignments alter column professional_id set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'assignments_professional_id_fkey') then
    alter table public.assignments
      add constraint assignments_professional_id_fkey
      foreign key (professional_id) references public.professionals(id) on delete cascade;
  end if;
end $$;

-- Borrar el tablero original ya NO borra las copias: board_id queda en null ("original eliminado")
alter table public.assignments alter column board_id drop not null;
alter table public.assignments drop constraint if exists assignments_board_id_fkey;
alter table public.assignments
  add constraint assignments_board_id_fkey
  foreign key (board_id) references public.boards(id) on delete set null;

-- Permisos válidos (F4-3)
alter table public.assignments drop constraint if exists assignments_permission_check;
alter table public.assignments
  add constraint assignments_permission_check check (permission in ('read_only', 'editable'));

-- Un tablero se asigna una sola vez a cada usuario (null = original borrado, no cuenta)
create unique index if not exists assignments_board_user_key
  on public.assignments (board_id, aac_user_id) where board_id is not null;

-- Política nueva: el profesional solo ve/edita SUS asignaciones, y solo puede crear
-- asignaciones de SUS tableros a SUS usuarios.
drop policy if exists "Profesionales gestionan asignaciones" on public.assignments;
create policy "Profesionales gestionan asignaciones" on public.assignments
  for all to authenticated
  using (auth.uid() = professional_id)
  with check (
    auth.uid() = professional_id
    and exists (select 1 from public.aac_users u
                where u.id = aac_user_id and u.professional_id = auth.uid())
    and (board_id is null or exists (select 1 from public.boards b
                where b.id = board_id and b.owner_professional_id = auth.uid()))
  );

-- =====================================================================
-- Políticas del resto: mismas reglas, explícitas y solo para usuarios logueados
-- =====================================================================
drop policy if exists "Profesionales gestionan sus tableros" on public.boards;
create policy "Profesionales gestionan sus tableros" on public.boards
  for all to authenticated
  using (auth.uid() = owner_professional_id)
  with check (auth.uid() = owner_professional_id);

drop policy if exists "Profesionales gestionan sus usuarios" on public.aac_users;
create policy "Profesionales gestionan sus usuarios" on public.aac_users
  for all to authenticated
  using (auth.uid() = professional_id)
  with check (
    auth.uid() = professional_id
    -- la casita tiene que ser una copia asignada a ESTE usuario
    and (home_board_id is null or exists (select 1 from public.assignments a
                                          where a.id = home_board_id and a.aac_user_id = aac_users.id))
  );

drop policy if exists "Profesionales gestionan códigos de acceso" on public.access_codes;
create policy "Profesionales gestionan códigos de acceso" on public.access_codes
  for all to authenticated
  using (exists (select 1 from public.aac_users u
                 where u.id = aac_user_id and u.professional_id = auth.uid()))
  with check (exists (select 1 from public.aac_users u
                 where u.id = aac_user_id and u.professional_id = auth.uid()));

-- professionals: ver y actualizar el propio perfil (las filas las crea el trigger)
drop policy if exists "Profesionales pueden ver su perfil" on public.professionals;
create policy "Profesionales pueden ver su perfil" on public.professionals
  for select to authenticated using (auth.uid() = id);
drop policy if exists "Profesionales pueden actualizar su perfil" on public.professionals;
create policy "Profesionales pueden actualizar su perfil" on public.professionals
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- =====================================================================
-- D. Casita del usuario = una de sus copias asignadas
-- =====================================================================
-- Valores viejos que no apunten a una asignación existente quedan en null (hoy no hay asignaciones)
update public.aac_users set home_board_id = null
where home_board_id is not null
  and home_board_id not in (select id from public.assignments);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'aac_users_home_board_id_fkey') then
    alter table public.aac_users
      add constraint aac_users_home_board_id_fkey
      foreign key (home_board_id) references public.assignments(id) on delete set null;
  end if;
end $$;

-- =====================================================================
-- E. Códigos únicos
-- =====================================================================
create unique index if not exists access_codes_code_key on public.access_codes (code);

commit;

-- =====================================================================
-- F. Storage legado: quitar políticas del bucket "boards" (vacío)
--    Va FUERA de la transacción: si Supabase no permite tocar storage.objects desde el editor,
--    falla solo esto y el resto ya quedó aplicado.
--    El bucket en sí se borra desde el panel: Storage → boards → Delete bucket
--    (Supabase no permite borrarlo por SQL).
-- =====================================================================
drop policy if exists "Permitir borrado de tableros propios" on storage.objects;
drop policy if exists "Permitir lectura de tableros propios" on storage.objects;
drop policy if exists "Permitir subida de tableros a dueños" on storage.objects;


-- Verificación rápida (una fila): debería decir assignments_ok = true y profesionales_sin_fila = 0
select
  (select count(*) from pg_policies where tablename = 'assignments'
     and policyname = 'Profesionales gestionan asignaciones' and with_check like '%aac_users%') = 1 as assignments_ok,
  (select count(*) from auth.users u left join public.professionals p on p.id = u.id where p.id is null) as profesionales_sin_fila,
  (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'Permitir%tableros%') as politicas_storage_restantes,
  (select string_agg(tgname || ' → ' || tgfoid::regproc::text, ', ') from pg_trigger
     where tgrelid = 'auth.users'::regclass and not tgisinternal) as triggers_auth_users;
