-- OPTIONAL: do not run unless physical deletion through the Data API and
-- Storage API has been explicitly retired. Migration 012 does not depend on this.
drop policy if exists arsip_delete_admin on public.arsip;
revoke delete on table public.arsip from public, anon, authenticated;

drop policy if exists arsip_storage_delete_admin on storage.objects;

-- Rollback:
-- create policy arsip_delete_admin
--   on public.arsip for delete to authenticated
--   using (coalesce(private.current_profile_role(), '') = 'admin');
-- revoke delete on table public.arsip from public, anon, authenticated;
-- grant delete on table public.arsip to authenticated;
--
-- create policy arsip_storage_delete_admin
--   on storage.objects for delete to authenticated
--   using (
--     bucket_id = 'arsip'
--     and private.current_profile_role() = 'admin'
--   );
