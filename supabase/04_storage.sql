-- Membuat bucket arsip privat dan policy Storage; verifikasi storage.buckets.public = false serta pg_policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'arsip',
  'arsip',
  false,
  26214400,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/tiff']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists arsip_storage_select on storage.objects;
create policy arsip_storage_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'arsip'
    and exists (
      select 1
      from public.arsip as archive
      where archive.file_path = name
        and private.can_read_arsip(archive.id)
    )
  );

drop policy if exists arsip_storage_insert on storage.objects;
create policy arsip_storage_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'arsip'
    and private.can_upload_arsip_object(name)
  );

drop policy if exists arsip_storage_delete on storage.objects;
create policy arsip_storage_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'arsip'
    and private.can_manage_arsip_object(name)
  );

drop policy if exists arsip_storage_access_gate_select on storage.objects;
create policy arsip_storage_access_gate_select
  on storage.objects as restrictive for select to public
  using (
    bucket_id <> 'arsip'
    or exists (
      select 1
      from public.arsip as archive
      where archive.file_path = name
        and private.can_read_arsip(archive.id)
    )
  );

drop policy if exists arsip_storage_access_gate_insert on storage.objects;
create policy arsip_storage_access_gate_insert
  on storage.objects as restrictive for insert to public
  with check (
    bucket_id <> 'arsip'
    or private.can_upload_arsip_object(name)
  );

drop policy if exists arsip_storage_access_gate_update on storage.objects;
create policy arsip_storage_access_gate_update
  on storage.objects as restrictive for update to public
  using (bucket_id <> 'arsip')
  with check (bucket_id <> 'arsip');

drop policy if exists arsip_storage_access_gate_delete on storage.objects;
create policy arsip_storage_access_gate_delete
  on storage.objects as restrictive for delete to public
  using (
    bucket_id <> 'arsip'
    or private.can_manage_arsip_object(name)
  );
