-- MiraVoz — Versiones también de las COPIAS asignadas a usuarios (11/10/2026, servidor MCP etapa 3)
-- Antes de cambiar o quitar la copia de un usuario desde Claude se guarda la versión anterior en board_versions
-- con board_id = 'copia:<id de la asignación>'. Requiere 07_versiones_de_tableros.sql. Se puede correr más de una vez.

drop policy if exists "Versiones: guardar de tableros propios" on public.board_versions;
create policy "Versiones: guardar de tableros propios" on public.board_versions
  for insert to authenticated with check (
    owner_professional_id = auth.uid()
    and (
      exists (select 1 from public.boards b where b.id = board_id and b.owner_professional_id = auth.uid())
      or (
        board_id like 'copia:%'
        and exists (select 1 from public.assignments a
                    where a.id::text = substr(board_id, 7) and a.professional_id = auth.uid())
      )
    )
  );

-- Verificación: la política existe
select count(*) = 1 as politica_ok from pg_policies
where schemaname = 'public' and tablename = 'board_versions' and policyname = 'Versiones: guardar de tableros propios';
