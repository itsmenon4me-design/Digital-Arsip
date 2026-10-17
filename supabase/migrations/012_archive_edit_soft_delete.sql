begin;

-- Jalankan setelah 011_admin_user_directory.sql.
-- Menambah edit admin dan soft delete; berkas di Storage tidak dihapus.
alter table public.arsip
  add column if not exists deleted_at timestamptz;

alter table public.arsip
  add column if not exists deleted_by uuid
    references auth.users (id) on delete set null;

-- Perubahan arsip hanya boleh melalui RPC admin, bukan UPDATE langsung dari browser.
revoke update on table public.arsip from public, anon, authenticated;

drop policy if exists arsip_update_archivist_or_admin on public.arsip;

drop policy if exists arsip_read_authenticated on public.arsip;
create policy arsip_read_authenticated
  on public.arsip for select to authenticated
  using (deleted_at is null);

-- Kedua policy SELECT Storage tetap memakai EXISTS ke public.arsip.
-- RLS arsip_read_authenticated menyaring arsip terhapus pada subquery tersebut.

create or replace function public.audit_arsip_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  affected public.arsip%rowtype;
  action_name public.log_audit_aksi;
  linked_arsip_id uuid;
begin
  if tg_op = 'DELETE' then
    affected := old;
    if old.file_status = 'mengunggah' then
      return old;
    end if;
    action_name := 'hapus';
    linked_arsip_id := null;
  elsif tg_op = 'INSERT' then
    affected := new;
    if new.file_status = 'mengunggah' then
      return new;
    end if;
    action_name := 'unggah';
    linked_arsip_id := new.id;
  else
    affected := new;
    if old.deleted_at is null and new.deleted_at is not null then
      action_name := 'hapus';
    elsif old.file_status = 'mengunggah' and new.file_status = 'tersedia' then
      action_name := 'unggah';
    else
      action_name := 'ubah';
    end if;
    linked_arsip_id := new.id;
  end if;

  if actor_id is not null then
    insert into public.log_audit (user_id, aksi, arsip_id, detail)
    values (
      actor_id,
      action_name,
      linked_arsip_id,
      pg_catalog.jsonb_build_object(
        'arsip_id', affected.id,
        'nomor_arsip', affected.nomor_arsip,
        'judul', affected.judul
      )
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_arsip_write()
  from public, anon, authenticated;

create or replace function public.admin_update_arsip(
  p_id uuid,
  p_judul text,
  p_klasifikasi_id uuid,
  p_unit_pencipta text,
  p_tingkat_akses text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  archive_row public.arsip%rowtype;
  clean_title text := pg_catalog.btrim(coalesce(p_judul, ''));
  clean_unit text := pg_catalog.btrim(coalesce(p_unit_pencipta, ''));
  clean_access text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_tingkat_akses, '')));
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') <> 'admin' then
    raise exception 'Akses administrator diperlukan'
      using errcode = '42501';
  end if;

  if p_id is null then
    raise exception 'Arsip tidak valid.'
      using errcode = '22023';
  end if;
  if clean_title = '' or pg_catalog.length(clean_title) > 500 then
    raise exception 'Judul wajib diisi dan maksimal 500 karakter.'
      using errcode = '22023';
  end if;
  if p_klasifikasi_id is null or not exists (
    select 1
    from public.klasifikasi as classification
    where classification.id = p_klasifikasi_id
  ) then
    raise exception 'Pilih klasifikasi yang tersedia.'
      using errcode = '22023';
  end if;
  if clean_unit = '' or pg_catalog.length(clean_unit) > 255 then
    raise exception 'Unit pencipta wajib diisi dan maksimal 255 karakter.'
      using errcode = '22023';
  end if;
  if clean_access not in ('publik', 'internal', 'terbatas', 'rahasia') then
    raise exception 'Pilih tingkat akses yang valid.'
      using errcode = '22023';
  end if;

  select archive.*
    into archive_row
  from public.arsip as archive
  where archive.id = p_id
    and archive.deleted_at is null
  for update;

  if not found then
    raise exception 'Arsip tidak ditemukan atau sudah dihapus.'
      using errcode = 'P0002';
  end if;

  if archive_row.judul is distinct from clean_title
    or archive_row.klasifikasi_id is distinct from p_klasifikasi_id
    or archive_row.unit_pencipta is distinct from clean_unit
    or archive_row.tingkat_akses::text is distinct from clean_access then
    update public.arsip as archive
    set
      judul = clean_title,
      klasifikasi_id = p_klasifikasi_id,
      unit_pencipta = clean_unit,
      tingkat_akses = clean_access::public.arsip_tingkat_akses
    where archive.id = p_id
      and archive.deleted_at is null
    returning archive.* into archive_row;
  end if;

  return pg_catalog.to_jsonb(archive_row);
end;
$$;

revoke all on function public.admin_update_arsip(uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_update_arsip(uuid, text, uuid, text, text)
  to authenticated;

create or replace function public.admin_soft_delete_arsip(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  archive_row public.arsip%rowtype;
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') <> 'admin' then
    raise exception 'Akses administrator diperlukan'
      using errcode = '42501';
  end if;

  if p_id is null then
    raise exception 'Arsip tidak valid.'
      using errcode = '22023';
  end if;

  select archive.*
    into archive_row
  from public.arsip as archive
  where archive.id = p_id
    and archive.deleted_at is null
  for update;

  if not found then
    raise exception 'Arsip tidak ditemukan atau sudah dihapus.'
      using errcode = 'P0002';
  end if;

  update public.arsip as archive
  set
    deleted_at = pg_catalog.now(),
    deleted_by = actor_id
  where archive.id = p_id
    and archive.deleted_at is null;

  return true;
end;
$$;

revoke all on function public.admin_soft_delete_arsip(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_soft_delete_arsip(uuid)
  to authenticated;

create or replace function public.record_archive_access(
  p_archive_id uuid,
  p_action public.log_audit_aksi
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  archive_row public.arsip%rowtype;
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') not in ('admin', 'petugas_arsip')
    or p_action is null
    or p_action not in ('buka', 'unduh') then
    return false;
  end if;

  select archive.*
    into archive_row
  from public.arsip as archive
  where archive.id = p_archive_id
  for share;

  if not found then
    return false;
  end if;
  if archive_row.deleted_at is not null then
    raise exception 'Arsip sudah dihapus dan tidak dapat dibuka atau diunduh.'
      using errcode = 'P0002';
  end if;

  if archive_row.file_status <> 'tersedia'
    or not exists (
      select 1
      from storage.objects as object_row
      where object_row.bucket_id = 'arsip'
        and object_row.name = archive_row.file_path
    ) then
    return false;
  end if;

  insert into public.log_audit (user_id, aksi, arsip_id)
  values (actor_id, p_action, p_archive_id);

  return true;
end;
$$;

revoke all on function public.record_archive_access(uuid, public.log_audit_aksi)
  from public, anon, authenticated;
grant execute on function public.record_archive_access(uuid, public.log_audit_aksi)
  to authenticated;

-- Pertahankan definisi live dan signature 004/006; hanya kecualikan arsip terhapus.
create or replace function public.dashboard_stats()
returns table (
  total_arsip bigint,
  menunggu_verifikasi bigint,
  mendekati_retensi bigint,
  penyimpanan_bytes bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(archive.id),
    count(archive.id) filter (
      where archive.status = 'menunggu_verifikasi'::public.arsip_status
    ),
    count(archive.id) filter (
      where archive.tanggal_retensi >= current_date
        and archive.tanggal_retensi <= current_date + 90
    ),
    coalesce(sum(archive.ukuran_file), 0)::bigint
  from public.arsip as archive
  where archive.file_status = 'tersedia'
    and archive.deleted_at is null
$$;

revoke all on function public.dashboard_stats() from public, anon, authenticated;
grant execute on function public.dashboard_stats() to authenticated;

-- Pulihkan arsip yang dihapus secara tidak sengaja:
-- update public.arsip
-- set deleted_at = null, deleted_by = null
-- where id = '<UUID-ARSIP>'
--   and deleted_at is not null;

-- Rollback aplikasi sebelum menjalankan blok rollback berikut.
-- deleted_at/deleted_by sengaja dipertahankan agar metadata penghapusan tidak
-- hilang permanen dan foreign key deleted_by tetap tersedia untuk pemulihan.
-- Arsip yang sudah soft-delete akan muncul kembali setelah policy lama
-- arsip_read_authenticated dipulihkan di atas kolom deleted_at.
--
-- revoke all on function public.admin_update_arsip(uuid, text, uuid, text, text)
--   from public, anon, authenticated;
-- drop function public.admin_update_arsip(uuid, text, uuid, text, text);
-- revoke all on function public.admin_soft_delete_arsip(uuid)
--   from public, anon, authenticated;
-- drop function public.admin_soft_delete_arsip(uuid);
--
-- -- Definisi trigger audit live sebelum migrasi 012:
-- create or replace function public.audit_arsip_write()
-- returns trigger
-- language plpgsql
-- security definer
-- set search_path = ''
-- as $$
-- declare
--   actor_id uuid := (select auth.uid());
--   affected public.arsip%rowtype;
--   action_name public.log_audit_aksi;
--   linked_arsip_id uuid;
-- begin
--   if tg_op = 'DELETE' then
--     affected := old;
--     if old.file_status = 'mengunggah' then
--       return old;
--     end if;
--     action_name := 'hapus';
--     linked_arsip_id := null;
--   elsif tg_op = 'INSERT' then
--     affected := new;
--     if new.file_status = 'mengunggah' then
--       return new;
--     end if;
--     action_name := 'unggah';
--     linked_arsip_id := new.id;
--   else
--     affected := new;
--     if old.file_status = 'mengunggah' and new.file_status = 'tersedia' then
--       action_name := 'unggah';
--     else
--       action_name := 'ubah';
--     end if;
--     linked_arsip_id := new.id;
--   end if;
--
--   if actor_id is not null then
--     insert into public.log_audit (user_id, aksi, arsip_id, detail)
--     values (
--       actor_id,
--       action_name,
--       linked_arsip_id,
--       pg_catalog.jsonb_build_object(
--         'arsip_id', affected.id,
--         'nomor_arsip', affected.nomor_arsip,
--         'judul', affected.judul
--       )
--     );
--   end if;
--
--   if tg_op = 'DELETE' then
--     return old;
--   end if;
--   return new;
-- end;
-- $$;
-- revoke all on function public.audit_arsip_write()
--   from public, anon, authenticated;
--
-- -- Definisi dashboard_stats live dari pg_get_functiondef:
-- create or replace function public.dashboard_stats()
--  RETURNS TABLE(total_arsip bigint, menunggu_verifikasi bigint, mendekati_retensi bigint, penyimpanan_bytes bigint)
--  LANGUAGE sql
--  STABLE
--  SET search_path TO ''
-- AS $function$
--   select
--     count(archive.id),
--     count(archive.id) filter (
--       where archive.status = 'menunggu_verifikasi'::public.arsip_status
--     ),
--     count(archive.id) filter (
--       where archive.tanggal_retensi >= current_date
--         and archive.tanggal_retensi <= current_date + 90
--     ),
--     coalesce(sum(archive.ukuran_file), 0)::bigint
--   from public.arsip as archive
--   where archive.file_status = 'tersedia'
-- $function$;
-- revoke all on function public.dashboard_stats() from public, anon, authenticated;
-- grant execute on function public.dashboard_stats() to authenticated;
--
-- -- Definisi record_archive_access live dari pg_get_functiondef:
-- CREATE OR REPLACE FUNCTION public.record_archive_access(p_archive_id uuid, p_action log_audit_aksi)
--  RETURNS boolean
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- declare
--   actor_id uuid := (select auth.uid());
-- begin
--   if actor_id is null
--     or coalesce(private.current_profile_role(), '') not in ('admin', 'petugas_arsip')
--     or p_action is null
--     or p_action not in ('buka', 'unduh') then
--     return false;
--   end if;
--
--   if not exists (
--     select 1
--     from public.arsip as archive
--     where archive.id = p_archive_id
--       and archive.file_status = 'tersedia'
--       and exists (
--         select 1
--         from storage.objects as object_row
--         where object_row.bucket_id = 'arsip'
--           and object_row.name = archive.file_path
--       )
--   ) then
--     return false;
--   end if;
--
--   insert into public.log_audit (user_id, aksi, arsip_id)
--   values (actor_id, p_action, p_archive_id);
--
--   return true;
-- end;
-- $function$;
-- revoke all on function public.record_archive_access(uuid, public.log_audit_aksi)
--   from public, anon, authenticated;
-- grant execute on function public.record_archive_access(uuid, public.log_audit_aksi)
--   to authenticated;
--
-- -- Kembalikan policy baca dan policy UPDATE live sebelum migrasi 012.
-- drop policy if exists arsip_read_authenticated on public.arsip;
-- create policy arsip_read_authenticated
--   on public.arsip for select to authenticated
--   using (true);
-- create policy arsip_update_archivist_or_admin
--   on public.arsip for update to authenticated
--   using (
--     coalesce(private.current_profile_role(), '') in ('admin', 'petugas_arsip')
--   )
--   with check (
--     coalesce(private.current_profile_role(), '') in ('admin', 'petugas_arsip')
--   );
-- revoke update on table public.arsip from public, anon, authenticated;
-- grant update on table public.arsip to authenticated;

-- Verifikasi setelah commit (jalankan manual; semua query berikut baca-saja):
-- select p.proname, pg_get_userbyid(p.proowner) as owner, owner_role.rolbypassrls
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- join pg_roles owner_role on owner_role.oid = p.proowner
-- where n.nspname = 'public'
--   and p.proname in ('admin_update_arsip', 'admin_soft_delete_arsip');
--
-- select rpc.signature,
--   has_function_privilege('anon', rpc.signature, 'EXECUTE') as anon_can_execute,
--   has_function_privilege('authenticated', rpc.signature, 'EXECUTE') as authenticated_can_execute
-- from (values
--   ('public.admin_update_arsip(uuid,text,uuid,text,text)'::regprocedure),
--   ('public.admin_soft_delete_arsip(uuid)'::regprocedure)
-- ) as rpc(signature);
--
-- select
--   exists (
--     select 1 from pg_policies
--     where schemaname = 'public' and tablename = 'arsip' and cmd = 'UPDATE'
--   ) as update_policy_exists,
--   has_table_privilege('authenticated', 'public.arsip', 'UPDATE') as authenticated_can_update,
--   has_table_privilege('anon', 'public.arsip', 'UPDATE') as anon_can_update;
--
-- select p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner,
--   owner_role.rolbypassrls,
--   has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
--   pg_get_functiondef(p.oid) as definition
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- join pg_roles owner_role on owner_role.oid = p.proowner
-- where n.nspname = 'public'
--   and p.proname in ('complete_archive_upload', 'rollback_archive_upload');

commit;
