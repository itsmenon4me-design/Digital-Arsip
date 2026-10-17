begin;

insert into public.profiles (id, nama_lengkap, role)
select
  auth_user.id,
  nullif(pg_catalog.btrim(coalesce(auth_user.raw_user_meta_data ->> 'nama_lengkap', '')), ''),
  'staf'::public.profile_role
from auth.users as auth_user
left join public.profiles as profile on profile.id = auth_user.id
where profile.id is null
on conflict (id) do nothing;

drop policy if exists arsip_read_authenticated on public.arsip;
create policy arsip_read_authenticated
  on public.arsip for select to authenticated
  using (
    deleted_at is null
    and (
      tingkat_akses <> 'rahasia'::public.arsip_tingkat_akses
      or coalesce(private.current_profile_role()::text, '') in ('admin', 'petugas_arsip')
    )
  );

drop policy if exists arsip_admin_gate_select on public.arsip;
create policy arsip_admin_gate_select
  on public.arsip as restrictive for select to authenticated
  using (
    deleted_at is null
    and (
      tingkat_akses <> 'rahasia'::public.arsip_tingkat_akses
      or coalesce(private.current_profile_role()::text, '') in ('admin', 'petugas_arsip')
    )
  );

drop policy if exists arsip_insert_archivist_or_admin on public.arsip;
create policy arsip_insert_archivist_or_admin
  on public.arsip for insert to authenticated
  with check (
    diunggah_oleh = (select auth.uid())
    and coalesce(private.current_profile_role()::text, '') in ('admin', 'petugas_arsip')
  );

drop policy if exists arsip_admin_gate_insert on public.arsip;
create policy arsip_admin_gate_insert
  on public.arsip as restrictive for insert to authenticated
  with check (
    diunggah_oleh = (select auth.uid())
    and coalesce(private.current_profile_role()::text, '') in ('admin', 'petugas_arsip')
  );

drop policy if exists arsip_storage_read_authenticated on storage.objects;
create policy arsip_storage_read_authenticated
  on storage.objects for select to authenticated
  using (
    bucket_id = 'arsip'
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
      else exists (
        select 1
        from public.arsip as archive
        where archive.file_path = name
          and archive.file_status in ('tersedia', 'penghapusan_tertunda')
          and archive.deleted_at is null
          and (
            (
              archive.file_status = 'tersedia'
              and (
                archive.tingkat_akses <> 'rahasia'::public.arsip_tingkat_akses
                or coalesce(private.current_profile_role()::text, '') in ('admin', 'petugas_arsip')
              )
            )
            or (
              archive.file_status = 'penghapusan_tertunda'
              and coalesce(private.current_profile_role()::text, '') = 'admin'
            )
          )
      )
    end
  );

drop policy if exists arsip_storage_upload_staff on storage.objects;
create policy arsip_storage_upload_staff
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'arsip'
    and coalesce(private.current_profile_role()::text, '') in ('admin', 'petugas_arsip')
  );

drop policy if exists arsip_storage_gate_insert on storage.objects;
create policy arsip_storage_gate_insert
  on storage.objects as restrictive for insert to public
  with check (
    bucket_id <> 'arsip'
    or case
      when (select auth.uid()) is null then false
      else coalesce(private.current_profile_role()::text, '') in ('admin', 'petugas_arsip')
    end
  );

create or replace function public.rollback_archive_upload(p_archive_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') not in ('admin', 'petugas_arsip') then
    return false;
  end if;

  delete from public.arsip as archive
  where archive.id = p_archive_id
    and archive.diunggah_oleh = actor_id
    and archive.created_at >= pg_catalog.now() - interval '10 minutes'
    and archive.created_at <= pg_catalog.now()
    and archive.file_status = 'mengunggah'
    and not exists (
      select 1
      from storage.objects as object_row
      where object_row.bucket_id = 'arsip'
        and object_row.name = archive.file_path
    );

  return found;
end;
$$;

create or replace function public.complete_archive_upload(p_archive_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') not in ('admin', 'petugas_arsip') then
    return false;
  end if;

  update public.arsip as archive
  set file_status = 'tersedia'
  where archive.id = p_archive_id
    and archive.diunggah_oleh = actor_id
    and archive.created_at >= pg_catalog.now() - interval '10 minutes'
    and archive.created_at <= pg_catalog.now()
    and archive.file_status = 'mengunggah'
    and exists (
      select 1
      from storage.objects as object_row
      where object_row.bucket_id = 'arsip'
        and object_row.name = archive.file_path
    );

  return found;
end;
$$;

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
  actor_role text := coalesce(private.current_profile_role()::text, '');
  archive_row public.arsip%rowtype;
begin
  if actor_id is null
    or actor_role not in ('admin', 'petugas_arsip', 'staf')
    or p_action is null
    or p_action not in ('buka', 'unduh') then
    return false;
  end if;

  select archive.*
    into archive_row
  from public.arsip as archive
  where archive.id = p_archive_id
    and archive.deleted_at is null
    and (
      archive.tingkat_akses <> 'rahasia'::public.arsip_tingkat_akses
      or actor_role in ('admin', 'petugas_arsip')
    )
  for share;

  if not found or archive_row.file_status <> 'tersedia' then
    return false;
  end if;

  if not exists (
    select 1
    from storage.objects as object_row
    where object_row.bucket_id = 'arsip'
      and object_row.name = archive_row.file_path
  ) then
    return false;
  end if;

  insert into public.log_audit (user_id, aksi, arsip_id, detail)
  values (
    actor_id,
    p_action,
    p_archive_id,
    pg_catalog.jsonb_build_object(
      'nomor_arsip', archive_row.nomor_arsip,
      'judul', archive_row.judul
    )
  );

  return true;
end;
$$;

create or replace function public.admin_update_arsip_with_publication(
  p_id uuid,
  p_judul text,
  p_klasifikasi_id uuid,
  p_unit_pencipta text,
  p_tingkat_akses text,
  p_tanggal_publikasi date,
  p_kanal_publikasi text,
  p_nama_kegiatan text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text := coalesce(private.current_profile_role()::text, '');
  archive_row public.arsip%rowtype;
  clean_title text := pg_catalog.btrim(coalesce(p_judul, ''));
  clean_unit text := pg_catalog.btrim(coalesce(p_unit_pencipta, ''));
  clean_access text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_tingkat_akses, '')));
  clean_channel text := nullif(pg_catalog.btrim(coalesce(p_kanal_publikasi, '')), '');
  clean_event text := nullif(pg_catalog.btrim(coalesce(p_nama_kegiatan, '')), '');
begin
  if actor_id is null or actor_role not in ('admin', 'petugas_arsip') then
    raise exception 'Akses petugas arsip atau administrator diperlukan'
      using errcode = '42501';
  end if;
  if p_id is null
    or clean_title = ''
    or pg_catalog.length(clean_title) > 500
    or clean_unit = ''
    or pg_catalog.length(clean_unit) > 255
    or clean_access not in ('publik', 'internal', 'terbatas', 'rahasia')
    or pg_catalog.length(coalesce(clean_channel, '')) > 120
    or pg_catalog.length(coalesce(clean_event, '')) > 255
    or p_klasifikasi_id is null
    or not exists (
      select 1 from public.klasifikasi
      where id = p_klasifikasi_id
    ) then
    raise exception 'Periksa kembali metadata arsip.' using errcode = '22023';
  end if;

  select archive.*
    into archive_row
  from public.arsip as archive
  where archive.id = p_id
    and archive.deleted_at is null
    and archive.file_status = 'tersedia'
  for update;

  if not found then
    raise exception 'Arsip tidak ditemukan atau berkas belum tersedia.'
      using errcode = 'P0002';
  end if;

  if archive_row.judul is distinct from clean_title
    or archive_row.klasifikasi_id is distinct from p_klasifikasi_id
    or archive_row.unit_pencipta is distinct from clean_unit
    or archive_row.tingkat_akses::text is distinct from clean_access
    or archive_row.tanggal_publikasi is distinct from p_tanggal_publikasi
    or archive_row.kanal_publikasi is distinct from clean_channel
    or archive_row.nama_kegiatan is distinct from clean_event then
    update public.arsip as archive
    set
      judul = clean_title,
      klasifikasi_id = p_klasifikasi_id,
      unit_pencipta = clean_unit,
      tingkat_akses = clean_access::public.arsip_tingkat_akses,
      tanggal_publikasi = p_tanggal_publikasi,
      kanal_publikasi = clean_channel,
      nama_kegiatan = clean_event,
      status = 'menunggu_verifikasi',
      diverifikasi_oleh = null,
      diverifikasi_pada = null,
      catatan_verifikasi = null
    where archive.id = p_id
    returning archive.* into archive_row;
  end if;

  return pg_catalog.to_jsonb(archive_row);
end;
$$;

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
      where archive.status in (
        'menunggu_verifikasi'::public.arsip_status,
        'perlu_perbaikan'::public.arsip_status
      )
    ),
    case
      when coalesce(private.current_profile_role()::text, '') = 'admin'
        then count(archive.id) filter (
          where archive.tanggal_retensi >= (pg_catalog.now() at time zone 'Asia/Jakarta')::date
            and archive.tanggal_retensi <= (pg_catalog.now() at time zone 'Asia/Jakarta')::date + 90
        )
      else 0::bigint
    end,
    coalesce(sum(archive.ukuran_file), 0)::bigint
  from public.arsip as archive
  where archive.file_status = 'tersedia'
    and archive.deleted_at is null
    and archive.status <> 'dimusnahkan'::public.arsip_status
$$;

revoke all on function public.rollback_archive_upload(uuid)
  from public, anon, authenticated;
grant execute on function public.rollback_archive_upload(uuid) to authenticated;
revoke all on function public.complete_archive_upload(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_archive_upload(uuid) to authenticated;
revoke all on function public.record_archive_access(uuid, public.log_audit_aksi)
  from public, anon, authenticated;
grant execute on function public.record_archive_access(uuid, public.log_audit_aksi)
  to authenticated;
revoke all on function public.admin_update_arsip_with_publication(
  uuid, text, uuid, text, text, date, text, text
) from public, anon, authenticated;
grant execute on function public.admin_update_arsip_with_publication(
  uuid, text, uuid, text, text, date, text, text
) to authenticated;

commit;
