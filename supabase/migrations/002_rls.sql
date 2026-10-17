-- Mengaktifkan RLS dan hak tabel; periksa pg_tables.rowsecurity serta daftar policy di pg_policies.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_user_role()
returns public.profile_role
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.profiles as profile
  where profile.id = (select auth.uid())
$$;

revoke all on function private.current_user_role() from public, anon;
grant execute on function private.current_user_role() to authenticated;

create or replace function public.prevent_non_admin_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role is distinct from new.role
    and (select auth.uid()) is not null
    and private.current_user_role() is distinct from 'admin'::public.profile_role then
    raise exception 'Hanya admin yang dapat mengubah role profil'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_non_admin_role_change() from public, anon, authenticated;

drop trigger if exists prevent_non_admin_profile_role_change on public.profiles;
create trigger prevent_non_admin_profile_role_change
  before update on public.profiles
  for each row execute function public.prevent_non_admin_role_change();

alter table public.profiles enable row level security;
alter table public.klasifikasi enable row level security;
alter table public.arsip enable row level security;
alter table public.log_audit enable row level security;

revoke all on table public.profiles, public.klasifikasi, public.arsip, public.log_audit
  from public, anon;
grant select on table public.profiles to authenticated;
grant update (nama_lengkap, role, unit) on table public.profiles to authenticated;
grant select, insert, update, delete on table public.klasifikasi to authenticated;
grant select, insert, update, delete on table public.arsip to authenticated;
grant select, insert on table public.log_audit to authenticated;
grant usage, select on sequence public.log_audit_id_seq to authenticated;

drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or private.current_user_role() = 'admin'::public.profile_role
  );

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin
  on public.profiles for update to authenticated
  using (
    id = (select auth.uid())
    or private.current_user_role() = 'admin'::public.profile_role
  )
  with check (
    id = (select auth.uid())
    or private.current_user_role() = 'admin'::public.profile_role
  );

drop policy if exists klasifikasi_read_authenticated on public.klasifikasi;
create policy klasifikasi_read_authenticated
  on public.klasifikasi for select to authenticated
  using (true);

drop policy if exists klasifikasi_manage_admin on public.klasifikasi;
create policy klasifikasi_manage_admin
  on public.klasifikasi for all to authenticated
  using (private.current_user_role() = 'admin'::public.profile_role)
  with check (private.current_user_role() = 'admin'::public.profile_role);

drop policy if exists arsip_read_authenticated on public.arsip;
create policy arsip_read_authenticated
  on public.arsip for select to authenticated
  using (
    tingkat_akses <> 'rahasia'::public.arsip_tingkat_akses
    or private.current_user_role() in (
      'admin'::public.profile_role,
      'petugas_arsip'::public.profile_role
    )
  );

drop policy if exists arsip_insert_archivist_or_admin on public.arsip;
create policy arsip_insert_archivist_or_admin
  on public.arsip for insert to authenticated
  with check (
    private.current_user_role() in (
      'admin'::public.profile_role,
      'petugas_arsip'::public.profile_role
    )
  );

drop policy if exists arsip_update_archivist_or_admin on public.arsip;
create policy arsip_update_archivist_or_admin
  on public.arsip for update to authenticated
  using (
    private.current_user_role() in (
      'admin'::public.profile_role,
      'petugas_arsip'::public.profile_role
    )
  )
  with check (
    private.current_user_role() in (
      'admin'::public.profile_role,
      'petugas_arsip'::public.profile_role
    )
  );

drop policy if exists arsip_delete_admin on public.arsip;
create policy arsip_delete_admin
  on public.arsip for delete to authenticated
  using (private.current_user_role() = 'admin'::public.profile_role);

drop policy if exists log_audit_read_admin on public.log_audit;
create policy log_audit_read_admin
  on public.log_audit for select to authenticated
  using (private.current_user_role() = 'admin'::public.profile_role);

drop policy if exists log_audit_insert_self on public.log_audit;
create policy log_audit_insert_self
  on public.log_audit for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Tidak dibuat policy update/delete; hak tabel untuk kedua operasi itu juga tidak diberikan.
