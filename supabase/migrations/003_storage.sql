-- Membuat bucket arsip privat dan policy akses; periksa storage.buckets.public dan policy storage.objects.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'arsip',
  'arsip',
  false,
  52428800,
  array['application/pdf', 'image/jpeg', 'image/tiff']
)
on conflict (id) do nothing;

drop policy if exists arsip_storage_read_authenticated on storage.objects;
create policy arsip_storage_read_authenticated
  on storage.objects for select to authenticated
  using (
    bucket_id = 'arsip'
    and exists (
      select 1
      from public.arsip as archive
      where archive.file_path = name
    )
  );

drop policy if exists arsip_storage_upload_staff on storage.objects;
create policy arsip_storage_upload_staff
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'arsip'
    and private.current_profile_role() in ('admin', 'petugas_arsip')
  );

drop policy if exists arsip_storage_delete_admin on storage.objects;
create policy arsip_storage_delete_admin
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'arsip'
    and private.current_profile_role() = 'admin'
  );

-- Gate restriktif mencegah policy permisif lain membuka bucket arsip ke role yang tidak berhak.
drop policy if exists arsip_storage_gate_select on storage.objects;
create policy arsip_storage_gate_select
  on storage.objects as restrictive for select to public
  using (
    bucket_id <> 'arsip'
    or case
      when (select auth.uid()) is null then false
      else exists (
        select 1
        from public.arsip as archive
        where archive.file_path = name
      )
    end
  );

drop policy if exists arsip_storage_gate_insert on storage.objects;
create policy arsip_storage_gate_insert
  on storage.objects as restrictive for insert to public
  with check (
    bucket_id <> 'arsip'
    or case
      when (select auth.uid()) is null then false
      else private.current_profile_role() in ('admin', 'petugas_arsip')
    end
  );

drop policy if exists arsip_storage_gate_update on storage.objects;
create policy arsip_storage_gate_update
  on storage.objects as restrictive for update to public
  using (bucket_id <> 'arsip')
  with check (bucket_id <> 'arsip');

drop policy if exists arsip_storage_gate_delete on storage.objects;
create policy arsip_storage_gate_delete
  on storage.objects as restrictive for delete to public
  using (
    bucket_id <> 'arsip'
    or case
      when (select auth.uid()) is null then false
      else private.current_profile_role() = 'admin'
    end
  );
