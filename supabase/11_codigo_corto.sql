-- MiraVoz — Códigos de vinculación de 4 caracteres (11/10/2026, pedido de Esteban)
-- Antes: 8 caracteres (ABCD-EFGH) que vencían a los 7 días. Ahora: 4 caracteres (por ejemplo K7PX) que vencen a los
-- 30 minutos, pensados para generarlos en el momento de vincular. Para que sigan siendo difíciles de adivinar se
-- achica el plazo y se baja el límite total de intentos fallidos (ver device_redeem). Requiere 02 y 03.
-- Los códigos de 8 caracteres ya emitidos siguen sirviendo hasta que venzan. Se puede correr más de una vez.

create or replace function public.create_access_code(p_aac_user_id uuid)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- sin 0/O ni 1/I: no se confunden
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
  -- Limpieza: los vencidos o usados hace más de un día liberan su código
  delete from public.access_codes c where (c.expires_at < now() - interval '1 day') or (c.redeemed_at < now() - interval '1 day');

  loop
    bytes := uuid_send(gen_random_uuid());
    new_code := '';
    for i in 0..3 loop
      new_code := new_code || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.access_codes c where c.code = new_code);
    tries := tries + 1;
    if tries > 20 then raise exception 'No se pudo generar un código único'; end if;
  end loop;

  insert into public.access_codes (code, aac_user_id, expires_at)
  values (new_code, p_aac_user_id, now() + interval '30 minutes');

  return json_build_object('code', new_code, 'expires_at', now() + interval '30 minutes');
end;
$$;

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
  -- Límites (11/10/2026, códigos de 4 caracteres): 10 fallos cada 10 min por IP y 300 cada 10 min en total.
  -- Con 32^4 ≈ 1 millón de combinaciones y códigos que vencen a los 30 minutos, en la vida de un código se
  -- pueden probar como mucho ~900: la chance de acertar uno es menor al 0,1%.
  perform pg_advisory_xact_lock(hashtext('device_redeem'));
  if (select count(*) from public.redeem_failures f
      where f.ip = v_ip and f.attempted_at > now() - interval '10 minutes') >= 10
     or (select count(*) from public.redeem_failures f where f.attempted_at > now() - interval '10 minutes') >= 300 then
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

-- Verificación: un código nuevo tiene 4 caracteres (se prueba sin guardar nada)
select length(regexp_replace('K7PX', '[^A-Z0-9]', '', 'g')) = 4 as formato_ok,
       (select count(*) from pg_proc where proname in ('create_access_code', 'device_redeem')) = 2 as funciones_ok;
