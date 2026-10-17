create table if not exists public.arsip_staff_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('viewer', 'editor', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.arsip_staff_roles enable row level security;
alter table public.arsip_publikasi enable row level security;

revoke all on table public.arsip_staff_roles from public, anon, authenticated;

create or replace function public.has_arsip_role(required_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.arsip_staff_roles as staff
    where staff.user_id = (select auth.uid())
      and staff.role = any (required_roles)
  );
$$;

revoke all on function public.has_arsip_role(text[]) from public, anon;
grant execute on function public.has_arsip_role(text[]) to authenticated;

revoke all on table public.arsip_publikasi from public, anon;
grant select, insert, update, delete on table public.arsip_publikasi to authenticated;

drop policy if exists arsip_publikasi_staff_select on public.arsip_publikasi;
create policy arsip_publikasi_staff_select
on public.arsip_publikasi
for select
to authenticated
using (public.has_arsip_role(array['viewer', 'editor', 'admin']::text[]));

drop policy if exists arsip_publikasi_staff_insert on public.arsip_publikasi;
create policy arsip_publikasi_staff_insert
on public.arsip_publikasi
for insert
to authenticated
with check (public.has_arsip_role(array['editor', 'admin']::text[]));

drop policy if exists arsip_publikasi_staff_update on public.arsip_publikasi;
create policy arsip_publikasi_staff_update
on public.arsip_publikasi
for update
to authenticated
using (public.has_arsip_role(array['editor', 'admin']::text[]))
with check (public.has_arsip_role(array['editor', 'admin']::text[]));

drop policy if exists arsip_publikasi_staff_delete on public.arsip_publikasi;
create policy arsip_publikasi_staff_delete
on public.arsip_publikasi
for delete
to authenticated
using (public.has_arsip_role(array['admin']::text[]));

-- Provision staff only from the Supabase Dashboard SQL Editor or another trusted
-- administrative channel. Replace the placeholder with a real auth.users.id.
-- Never expose role assignment through an untrusted frontend request.
--
-- insert into public.arsip_staff_roles (user_id, role)
-- values ('<AUTH_USER_UUID>', 'admin')
-- on conflict (user_id) do update set role = excluded.role;
