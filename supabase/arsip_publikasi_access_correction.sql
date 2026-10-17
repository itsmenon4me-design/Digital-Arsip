begin;

alter table public.arsip_publikasi enable row level security;
alter table public.arsip_staff_roles enable row level security;

revoke all on table public.arsip_publikasi from public, anon, authenticated;
grant select, insert, update, delete on table public.arsip_publikasi to authenticated;

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

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'arsip_publikasi'
  loop
    execute format(
      'drop policy %I on public.arsip_publikasi',
      existing_policy.policyname
    );
  end loop;
end;
$$;

create policy arsip_publikasi_staff_select
on public.arsip_publikasi
for select
to authenticated
using (public.has_arsip_role(array['viewer', 'editor', 'admin']::text[]));

create policy arsip_publikasi_staff_insert
on public.arsip_publikasi
for insert
to authenticated
with check (public.has_arsip_role(array['editor', 'admin']::text[]));

create policy arsip_publikasi_staff_update
on public.arsip_publikasi
for update
to authenticated
using (public.has_arsip_role(array['editor', 'admin']::text[]))
with check (public.has_arsip_role(array['editor', 'admin']::text[]));

create policy arsip_publikasi_staff_delete
on public.arsip_publikasi
for delete
to authenticated
using (public.has_arsip_role(array['admin']::text[]));

commit;
