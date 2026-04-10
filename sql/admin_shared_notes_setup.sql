-- ==========================================================
-- Conquiguias | Admin Shared Notes (Supabase)
-- ==========================================================
-- Este script crea la tabla usada por:
--   /api/social?action=get-admin-notes
--   /api/social?action=save-admin-notes
--
-- Nota de seguridad:
-- La API ya usa SUPABASE_KEY (service role), por lo que el backend
-- puede operar aunque RLS esté activo.
-- Aun así dejamos RLS bien configurado para acceso directo seguro.
-- ==========================================================

begin;

create table if not exists public.admin_shared_notes (
  id text primary key,
  html text not null default '',
  file_name text not null default 'Sin título',
  zoom integer not null default 100,
  wrap boolean not null default true,
  tab_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

alter table public.admin_shared_notes
  add column if not exists tab_order integer not null default 0;

alter table public.admin_shared_notes
  add constraint admin_shared_notes_zoom_check
  check (zoom between 50 and 300);

alter table public.admin_shared_notes
  add constraint admin_shared_notes_tab_order_check
  check (tab_order >= 0);

create index if not exists admin_shared_notes_updated_at_idx
  on public.admin_shared_notes (updated_at desc);

create index if not exists admin_shared_notes_tab_order_idx
  on public.admin_shared_notes (tab_order asc, updated_at desc);

create or replace function public.set_admin_shared_notes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_admin_shared_notes_updated_at on public.admin_shared_notes;

create trigger trg_admin_shared_notes_updated_at
before update on public.admin_shared_notes
for each row
execute function public.set_admin_shared_notes_updated_at();

insert into public.admin_shared_notes (id, html, file_name, zoom, wrap, updated_by)
values ('global', '', 'Sin título', 100, true, 'system')
on conflict (id) do nothing;

alter table public.admin_shared_notes enable row level security;

drop policy if exists admin_shared_notes_select_policy on public.admin_shared_notes;
create policy admin_shared_notes_select_policy
on public.admin_shared_notes
for select
to authenticated
using (false);

drop policy if exists admin_shared_notes_update_policy on public.admin_shared_notes;
create policy admin_shared_notes_update_policy
on public.admin_shared_notes
for update
to authenticated
using (false)
with check (false);

drop policy if exists admin_shared_notes_insert_policy on public.admin_shared_notes;
create policy admin_shared_notes_insert_policy
on public.admin_shared_notes
for insert
to authenticated
with check (false);

-- Evita borrado accidental desde cliente autenticado.
drop policy if exists admin_shared_notes_delete_policy on public.admin_shared_notes;
create policy admin_shared_notes_delete_policy
on public.admin_shared_notes
for delete
to authenticated
using (false);

commit;

-- ==========================================================
-- Acceso recomendado:
-- Solo backend (/api/social) con service role de Supabase.
-- Ahí ya validamos propietario/admin con Firebase ID Token.
-- ==========================================================
