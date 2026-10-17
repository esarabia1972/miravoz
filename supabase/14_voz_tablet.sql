-- MiraVoz 0.8.1n — Voces de MiraVoz desde la tablet vinculada
-- El servidor de voces (/api/voz) necesita saber si un token de tablet es válido. Esta función solo responde
-- true/false (no devuelve datos del usuario ni de sus tableros). Hasta que se corra, el servidor usa
-- device_fetch, que también sirve pero es más pesada. Se puede correr más de una vez.

create or replace function public.device_valid(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.device_tokens d where d.token_hash = public._device_token_hash(p_token));
$$;
revoke execute on function public.device_valid(text) from public;
grant execute on function public.device_valid(text) to anon, authenticated;

-- Verificación: la función existe y un token inventado no es válido
select (select count(*) from pg_proc where proname = 'device_valid') = 1 as funcion_ok,
       public.device_valid(repeat('0', 64)) = false as token_falso_rechazado;
