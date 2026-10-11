-- MiraVoz — Versiones de tableros (11/10/2026, servidor MCP etapa 2)
-- Antes de cada cambio que se hace desde Claude (u otro asistente conectado) se guarda la versión ANTERIOR del
-- tablero acá. Sirve para deshacer (historial_tablero / restaurar_version) y es la regla "ningún dato se pierde":
-- si no se puede guardar la versión, el servidor no hace el cambio.
-- Cada cuenta ve y escribe solo las suyas (RLS). Se conservan las últimas 40 por tablero.
-- Se puede correr más de una vez.

create table if not exists public.board_versions (
  id bigint generated always as identity primary key,
  board_id text not null,
  owner_professional_id uuid not null default auth.uid() references public.professionals(id) on delete cascade,
  bundle jsonb not null,
  source text not null default 'claude' check (source in ('claude', 'app', 'sistema')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists board_versions_board_idx on public.board_versions (board_id, created_at desc);

alter table public.board_versions enable row level security;

drop policy if exists "Versiones: ver las propias" on public.board_versions;
create policy "Versiones: ver las propias" on public.board_versions
  for select to authenticated using (owner_professional_id = auth.uid());

drop policy if exists "Versiones: guardar de tableros propios" on public.board_versions;
create policy "Versiones: guardar de tableros propios" on public.board_versions
  for insert to authenticated with check (
    owner_professional_id = auth.uid()
    and exists (select 1 from public.boards b where b.id = board_id and b.owner_professional_id = auth.uid())
  );

drop policy if exists "Versiones: borrar las propias" on public.board_versions;
create policy "Versiones: borrar las propias" on public.board_versions
  for delete to authenticated using (owner_professional_id = auth.uid());

-- Conservar solo las últimas 40 versiones de cada tablero
create or replace function public.prune_board_versions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.board_versions v
  where v.board_id = new.board_id
    and v.id not in (select id from public.board_versions where board_id = new.board_id order by created_at desc, id desc limit 40);
  return null;
end;
$$;
drop trigger if exists board_versions_prune on public.board_versions;
create trigger board_versions_prune after insert on public.board_versions
  for each row execute procedure public.prune_board_versions();

-- Verificación: debería dar rls = true y 0 filas al principio
select (select relrowsecurity from pg_class where oid = 'public.board_versions'::regclass) as rls,
       (select count(*) from public.board_versions) as versiones;
