-- 15_quitar_etiqueta_copia.sql — MiraVoz 0.8.2a · Quitar la etiqueta "Copia de prueba" de la cuenta de Esteban
--
-- Saca solo esa etiqueta (las demás quedan) de los tableros de esteban.sarabia@gmail.com y de las copias de sus
-- usuarios. No toca la marca interna copiadoDe (sigue sirviendo para el PASO 3 de 13_copiar_cuenta.sql) ni
-- ninguna otra cuenta. Actualiza la fecha de modificación para que los dispositivos tomen la versión nueva.
--
-- PASO 1: vista previa (no cambia nada). PASO 2: quitar (todo o nada). Se puede correr más de una vez.

-- =====================================================================
-- PASO 1 — Vista previa
-- =====================================================================
with yo as (select id from auth.users where lower(email) = lower('esteban.sarabia@gmail.com'))
select
  (select count(*) from public.boards b, yo where b.owner_professional_id = yo.id and b.bundle->'tags' ? 'Copia de prueba') as tableros_con_la_etiqueta,
  (select count(*) from public.assignments a, yo where a.professional_id = yo.id and a.copy_bundle->'tags' ? 'Copia de prueba') as copias_con_la_etiqueta;


-- =====================================================================
-- PASO 2 — Quitar la etiqueta
-- =====================================================================
do $$
declare
  v_me uuid;
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_b int; v_a int;
begin
  select id into v_me from auth.users where lower(email) = lower('esteban.sarabia@gmail.com');
  if v_me is null then raise exception 'No existe la cuenta esteban.sarabia@gmail.com'; end if;

  update public.boards b
  set bundle = jsonb_set(jsonb_set(b.bundle, '{tags}',
                 coalesce((select jsonb_agg(t) from jsonb_array_elements(b.bundle->'tags') t where t <> to_jsonb('Copia de prueba'::text)), '[]'::jsonb)),
                 '{updatedAt}', to_jsonb(v_now_ms)),
      updated_at = now()
  where b.owner_professional_id = v_me and b.bundle->'tags' ? 'Copia de prueba';
  get diagnostics v_b = row_count;

  update public.assignments a
  set copy_bundle = jsonb_set(a.copy_bundle, '{tags}',
                 coalesce((select jsonb_agg(t) from jsonb_array_elements(a.copy_bundle->'tags') t where t <> to_jsonb('Copia de prueba'::text)), '[]'::jsonb)),
      copy_updated_at = now()
  where a.professional_id = v_me and a.copy_bundle->'tags' ? 'Copia de prueba';
  get diagnostics v_a = row_count;

  raise notice 'Etiqueta "Copia de prueba" quitada de % tableros y % copias.', v_b, v_a;
end $$;

-- Verificación: tiene que dar 0 y 0
with yo as (select id from auth.users where lower(email) = lower('esteban.sarabia@gmail.com'))
select
  (select count(*) from public.boards b, yo where b.owner_professional_id = yo.id and b.bundle->'tags' ? 'Copia de prueba') as tableros_con_la_etiqueta,
  (select count(*) from public.assignments a, yo where a.professional_id = yo.id and a.copy_bundle->'tags' ? 'Copia de prueba') as copias_con_la_etiqueta;
