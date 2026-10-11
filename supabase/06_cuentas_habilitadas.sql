-- MiraVoz — Cuentas habilitadas (11/10/2026)
-- Solo pueden crear cuenta los correos de public.allowed_emails. Tres piezas:
--   1. Tabla allowed_emails: sin políticas RLS, así que nadie la lee ni la escribe desde la app (solo el panel / SQL).
--   2. Auth Hook "Before User Created": Supabase lo llama antes de crear CADA cuenta nueva. Si el correo no está,
--      rechaza el alta y vuelve a MiraVoz con el mensaje. Hay que activarlo en el panel (paso final, abajo).
--   3. RPC account_enabled(): la app la consulta al entrar, para cortar también a cuentas que ya existían
--      antes de este cambio y no están en la lista.
-- Se puede correr más de una vez.

-- =====================================================================
-- 1. Tabla
-- =====================================================================
create table if not exists public.allowed_emails (
  email      text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  note       text,
  created_at timestamptz not null default now()
);
alter table public.allowed_emails enable row level security;
revoke all on public.allowed_emails from anon, authenticated;

insert into public.allowed_emails (email, note) values
  ('esteban.sarabia@gmail.com', 'Esteban (responsable)'),
  ('letialberti@hotmail.com',   'Leti')
on conflict (email) do nothing;

-- =====================================================================
-- 2. Auth Hook "Before User Created"
-- =====================================================================
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  u       jsonb := event->'user';
  v_email text := lower(btrim(coalesce(u->>'email', '')));
begin
  -- Sesiones anónimas (tablets del esquema viejo): no son cuentas registradas
  if coalesce((u->>'is_anonymous')::boolean, false) then
    return '{}'::jsonb;
  end if;
  if v_email <> '' and exists (select 1 from public.allowed_emails a where a.email = v_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Cuenta no registrada'
  ));
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from authenticated, anon, public;
grant select on public.allowed_emails to supabase_auth_admin;
drop policy if exists "Auth lee cuentas habilitadas" on public.allowed_emails;
create policy "Auth lee cuentas habilitadas" on public.allowed_emails
  for select to supabase_auth_admin using (true);

-- =====================================================================
-- 3. ¿La cuenta de esta sesión está habilitada?
-- =====================================================================
create or replace function public.account_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    join public.allowed_emails a on a.email = lower(btrim(u.email))
    where u.id = auth.uid()
  );
$$;
revoke execute on function public.account_enabled() from public, anon;
grant execute on function public.account_enabled() to authenticated;

-- =====================================================================
-- Verificación (debería dar todo true y la lista de cuentas que NO están habilitadas)
-- =====================================================================
select
  (select count(*) from public.allowed_emails) >= 2                                   as lista_cargada,
  (public.hook_before_user_created('{"user":{"email":"Esteban.Sarabia@gmail.com"}}') = '{}'::jsonb) as habilitado_pasa,
  (public.hook_before_user_created('{"user":{"email":"otro@gmail.com"}}') ? 'error')  as otro_rechazado;

select u.email, u.created_at, u.last_sign_in_at
from auth.users u
left join public.allowed_emails a on a.email = lower(btrim(u.email))
where a.email is null
  and not coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false)
order by u.created_at desc;

-- =====================================================================
-- PASO FINAL (en el panel, no en SQL):
--   Authentication → Auth Hooks → "Before User Created" → Add hook → tipo Postgres →
--   schema public, función hook_before_user_created → Create / Enable.
--
-- Para habilitar a alguien más:
--   insert into public.allowed_emails (email, note) values ('nombre@dominio.com', 'quién es');
-- Para quitarle el acceso:
--   delete from public.allowed_emails where email = 'nombre@dominio.com';
--   (la app la deja afuera en el próximo ingreso; para cortarla ya, borrá la cuenta en Authentication → Users)
-- =====================================================================
