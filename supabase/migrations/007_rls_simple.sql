-- Jalankan sesudah 006_archive_file_workflow.sql. Hanya mengatur RLS arsip dan log_audit.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

revoke all on function private.current_profile_role() from public, anon;
grant execute on function private.current_profile_role() to authenticated;

alter table public.arsip enable row level security;
alter table public.log_audit enable row level security;

revoke all on table public.arsip, public.log_audit from public, anon;
grant select, insert, update, delete on table public.arsip to authenticated;
grant select on table public.log_audit to authenticated;

drop policy if exists arsip_read_authenticated on public.arsip;
create policy arsip_read_authenticated
  on public.arsip for select to authenticated
  using (true);

drop policy if exists arsip_insert_archivist_or_admin on public.arsip;
create policy arsip_insert_archivist_or_admin
  on public.arsip for insert to authenticated
  with check (
    diunggah_oleh = (select auth.uid())
    and coalesce(private.current_profile_role(), '') in ('admin', 'petugas_arsip')
  );

drop policy if exists arsip_update_archivist_or_admin on public.arsip;
create policy arsip_update_archivist_or_admin
  on public.arsip for update to authenticated
  using (
    coalesce(private.current_profile_role(), '') in ('admin', 'petugas_arsip')
  )
  with check (
    coalesce(private.current_profile_role(), '') in ('admin', 'petugas_arsip')
  );

drop policy if exists arsip_delete_admin on public.arsip;
create policy arsip_delete_admin
  on public.arsip for delete to authenticated
  using (coalesce(private.current_profile_role(), '') = 'admin');

drop policy if exists log_audit_read_admin on public.log_audit;
create policy log_audit_read_admin
  on public.log_audit for select to authenticated
  using (coalesce(private.current_profile_role(), '') = 'admin');

-- Tidak ada policy INSERT/UPDATE/DELETE untuk log_audit; trigger/RPC definer yang mencatat.
-- Rollback kebijakan RLS:
-- alter table public.arsip disable row level security;
-- alter table public.log_audit disable row level security;
