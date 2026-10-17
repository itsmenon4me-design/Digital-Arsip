-- Mengaktifkan RLS dan policy tabel; verifikasi dengan pg_tables.rowsecurity dan pg_policies.
alter table public.profiles enable row level security;
alter table public.unit enable row level security;
alter table public.klasifikasi enable row level security;
alter table public.arsip enable row level security;
alter table public.audit_log enable row level security;

revoke all on table public.profiles, public.unit, public.klasifikasi,
  public.arsip, public.audit_log from public, anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.unit, public.klasifikasi to authenticated;
grant select, insert, update, delete on public.arsip to authenticated;
grant select on public.audit_log to authenticated;

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.current_profile_role() = 'admin');

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin
  on public.profiles for update to authenticated
  using (private.current_profile_role() = 'admin')
  with check (private.current_profile_role() = 'admin');

drop policy if exists unit_read_authenticated on public.unit;
create policy unit_read_authenticated
  on public.unit for select to authenticated
  using (true);

drop policy if exists unit_manage_admin on public.unit;
create policy unit_manage_admin
  on public.unit for all to authenticated
  using (private.current_profile_role() = 'admin')
  with check (private.current_profile_role() = 'admin');

drop policy if exists klasifikasi_read_authenticated on public.klasifikasi;
create policy klasifikasi_read_authenticated
  on public.klasifikasi for select to authenticated
  using (true);

drop policy if exists klasifikasi_manage_admin on public.klasifikasi;
create policy klasifikasi_manage_admin
  on public.klasifikasi for all to authenticated
  using (private.current_profile_role() = 'admin')
  with check (private.current_profile_role() = 'admin');

drop policy if exists arsip_read_by_role on public.arsip;
create policy arsip_read_by_role
  on public.arsip for select to authenticated
  using (private.can_read_arsip(id));

drop policy if exists arsip_insert_by_role on public.arsip;
create policy arsip_insert_by_role
  on public.arsip for insert to authenticated
  with check (
    private.current_profile_role() = 'admin'
    or (
      private.current_profile_role() = 'petugas'
      and unit_id = private.current_profile_unit()
      and dibuat_oleh = (select auth.uid())
      and status = 'menunggu'
    )
  );

drop policy if exists arsip_update_by_role on public.arsip;
create policy arsip_update_by_role
  on public.arsip for update to authenticated
  using (private.can_manage_arsip(id))
  with check (
    private.current_profile_role() = 'admin'
    or (
      private.current_profile_role() = 'petugas'
      and unit_id = private.current_profile_unit()
      and dibuat_oleh = (select auth.uid())
      and status in ('menunggu', 'ditolak')
    )
  );

drop policy if exists arsip_delete_admin on public.arsip;
create policy arsip_delete_admin
  on public.arsip for delete to authenticated
  using (private.current_profile_role() = 'admin');

drop policy if exists audit_log_read_admin on public.audit_log;
create policy audit_log_read_admin
  on public.audit_log for select to authenticated
  using (private.current_profile_role() = 'admin');
