-- MiraVoz — Revisión de cuentas antes de pasar a "solo Google" (SOLO LECTURA)
-- Muestra, para cada cuenta que no es de una tablet: email, si está confirmado y con qué métodos entra.
-- Una cuenta que solo tiene "email" (y cuyo correo NO es de Google) no va a poder entrar con el botón de Google.
select u.email,
       u.email_confirmed_at is not null as email_confirmado,
       u.raw_app_meta_data->'providers' as metodos,
       (select count(*) from public.boards b where b.owner_professional_id = u.id) as tableros,
       (select count(*) from public.aac_users a where a.professional_id = u.id) as usuarios,
       u.last_sign_in_at
from auth.users u
where not coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false)
order by u.last_sign_in_at desc nulls last;
