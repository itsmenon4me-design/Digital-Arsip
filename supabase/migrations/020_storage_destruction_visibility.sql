drop policy if exists arsip_storage_read_authenticated on storage.objects;
create policy arsip_storage_read_authenticated
  on storage.objects for select to authenticated
  using (
    bucket_id = 'arsip'
    and coalesce(private.current_profile_role()::text, '') = 'admin'
    and exists (
      select 1
      from public.arsip as archive
      where archive.file_path = name
        and archive.file_status in ('tersedia', 'penghapusan_tertunda')
        and archive.deleted_at is null
    )
  );

drop policy if exists arsip_storage_gate_select on storage.objects;
create policy arsip_storage_gate_select
  on storage.objects as restrictive for select to public
  using (
    bucket_id <> 'arsip'
    or case
      when (select auth.uid()) is null then false
      else coalesce(private.current_profile_role()::text, '') = 'admin'
        and exists (
          select 1
          from public.arsip as archive
          where archive.file_path = name
            and archive.file_status in ('tersedia', 'penghapusan_tertunda')
            and archive.deleted_at is null
        )
    end
  );
