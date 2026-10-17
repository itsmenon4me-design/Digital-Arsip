begin;

create index if not exists arsip_tanggal_retensi_aktif_idx
  on public.arsip (tanggal_retensi)
  where deleted_at is null and status <> 'dimusnahkan';

drop policy if exists arsip_read_authenticated on public.arsip;
create policy arsip_read_authenticated
  on public.arsip for select to authenticated
  using (
    deleted_at is null
    and coalesce(private.current_profile_role()::text, '') = 'admin'
  );

drop policy if exists arsip_admin_gate_select on public.arsip;
create policy arsip_admin_gate_select
  on public.arsip as restrictive for select to authenticated
  using (
    deleted_at is null
    and coalesce(private.current_profile_role()::text, '') = 'admin'
  );

drop policy if exists arsip_insert_archivist_or_admin on public.arsip;
create policy arsip_insert_archivist_or_admin
  on public.arsip for insert to authenticated
  with check (
    diunggah_oleh = (select auth.uid())
    and coalesce(private.current_profile_role()::text, '') = 'admin'
  );

drop policy if exists arsip_admin_gate_insert on public.arsip;
create policy arsip_admin_gate_insert
  on public.arsip as restrictive for insert to authenticated
  with check (coalesce(private.current_profile_role()::text, '') = 'admin');

drop policy if exists arsip_delete_admin on public.arsip;
create policy arsip_delete_admin
  on public.arsip for delete to authenticated
  using (
    coalesce(private.current_profile_role()::text, '') = 'admin'
    and status <> 'dimusnahkan'
    and (tanggal_retensi is null
      or tanggal_retensi > (pg_catalog.now() at time zone 'Asia/Jakarta')::date)
  );

drop policy if exists arsip_admin_gate_delete on public.arsip;
create policy arsip_admin_gate_delete
  on public.arsip as restrictive for delete to authenticated
  using (
    coalesce(private.current_profile_role()::text, '') = 'admin'
    and status <> 'dimusnahkan'
    and (tanggal_retensi is null
      or tanggal_retensi > (pg_catalog.now() at time zone 'Asia/Jakarta')::date)
  );

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
        and archive.file_status = 'tersedia'
        and archive.deleted_at is null
    )
  );

drop policy if exists arsip_storage_upload_staff on storage.objects;
create policy arsip_storage_upload_staff
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'arsip'
    and coalesce(private.current_profile_role()::text, '') = 'admin'
  );

drop policy if exists arsip_storage_delete_admin on storage.objects;
create policy arsip_storage_delete_admin
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'arsip'
    and coalesce(private.current_profile_role()::text, '') = 'admin'
    and not exists (
      select 1
      from public.arsip as archive
      where archive.file_path = name
        and archive.deleted_at is null
        and archive.status <> 'dimusnahkan'
        and archive.tanggal_retensi <= (pg_catalog.now() at time zone 'Asia/Jakarta')::date
        and archive.file_status <> 'penghapusan_tertunda'
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
            and archive.file_status = 'tersedia'
            and archive.deleted_at is null
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
      else coalesce(private.current_profile_role()::text, '') = 'admin'
    end
  );

drop policy if exists arsip_storage_gate_delete on storage.objects;
create policy arsip_storage_gate_delete
  on storage.objects as restrictive for delete to public
  using (
    bucket_id <> 'arsip'
    or case
      when (select auth.uid()) is null then false
      else coalesce(private.current_profile_role()::text, '') = 'admin'
        and not exists (
          select 1
          from public.arsip as archive
          where archive.file_path = name
            and archive.deleted_at is null
            and archive.status <> 'dimusnahkan'
            and archive.tanggal_retensi <= (pg_catalog.now() at time zone 'Asia/Jakarta')::date
            and archive.file_status <> 'penghapusan_tertunda'
        )
    end
  );

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
    raise exception 'Akses administrator diperlukan' using errcode = '42501';
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
  if archive_row.status = 'dimusnahkan'
    or (archive_row.tanggal_retensi is not null
      and archive_row.tanggal_retensi <= (pg_catalog.now() at time zone 'Asia/Jakarta')::date) then
    raise exception 'Arsip yang melewati retensi harus melalui proses pemusnahan tercatat.'
      using errcode = '22023';
  end if;

  update public.arsip as archive
  set
    deleted_at = pg_catalog.now(),
    deleted_by = actor_id
  where archive.id = p_id;

  return true;
end;
$$;

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
    or coalesce(private.current_profile_role()::text, '') <> 'admin' then
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
    or coalesce(private.current_profile_role()::text, '') <> 'admin' then
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
  archive_row public.arsip%rowtype;
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') <> 'admin'
    or p_action is null
    or p_action not in ('buka', 'unduh') then
    return false;
  end if;

  select archive.*
    into archive_row
  from public.arsip as archive
  where archive.id = p_archive_id
    and archive.deleted_at is null
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
  archive_row public.arsip%rowtype;
  clean_title text := pg_catalog.btrim(coalesce(p_judul, ''));
  clean_unit text := pg_catalog.btrim(coalesce(p_unit_pencipta, ''));
  clean_access text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_tingkat_akses, '')));
  clean_channel text := nullif(pg_catalog.btrim(coalesce(p_kanal_publikasi, '')), '');
  clean_event text := nullif(pg_catalog.btrim(coalesce(p_nama_kegiatan, '')), '');
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') <> 'admin' then
    raise exception 'Akses administrator diperlukan' using errcode = '42501';
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

create or replace function public.admin_review_archive(
  p_id uuid,
  p_result text,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  archive_row public.arsip%rowtype;
  previous_status public.arsip_status;
  clean_note text := pg_catalog.btrim(coalesce(p_note, ''));
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') <> 'admin' then
    raise exception 'Akses administrator diperlukan' using errcode = '42501';
  end if;
  if p_result is null
    or p_result not in ('terverifikasi', 'perlu_perbaikan')
    or (p_result = 'perlu_perbaikan' and clean_note = '')
    or pg_catalog.length(clean_note) > 2000 then
    raise exception 'Pilih hasil verifikasi yang valid dan isi catatan perbaikan.'
      using errcode = '22023';
  end if;

  select archive.*
    into archive_row
  from public.arsip as archive
  where archive.id = p_id
    and archive.deleted_at is null
    and archive.status in ('menunggu_verifikasi', 'perlu_perbaikan')
    and archive.file_status = 'tersedia'
    and archive.file_path is not null
    and exists (
      select 1 from storage.objects as object_row
      where object_row.bucket_id = 'arsip'
        and object_row.name = archive.file_path
    )
  for update;

  if not found then
    raise exception 'Arsip tidak ditemukan, berkas belum tersedia, atau statusnya tidak dapat diverifikasi.'
      using errcode = 'P0002';
  end if;

  previous_status := archive_row.status;
  update public.arsip as archive
  set
    status = p_result::public.arsip_status,
    diverifikasi_oleh = actor_id,
    diverifikasi_pada = pg_catalog.now(),
    catatan_verifikasi = nullif(clean_note, '')
  where archive.id = p_id
  returning archive.* into archive_row;

  insert into public.log_audit (user_id, aksi, arsip_id, detail)
  values (
    actor_id,
    'verifikasi',
    p_id,
    pg_catalog.jsonb_build_object(
      'nomor_arsip', archive_row.nomor_arsip,
      'judul', archive_row.judul,
      'status_sebelumnya', previous_status,
      'hasil', p_result,
      'catatan', nullif(clean_note, '')
    )
  );

  return pg_catalog.to_jsonb(archive_row);
end;
$$;

create or replace function public.admin_begin_archive_destruction(
  p_id uuid,
  p_berita_acara text,
  p_catatan text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  archive_row public.arsip%rowtype;
  clean_record text := pg_catalog.btrim(coalesce(p_berita_acara, ''));
  clean_note text := pg_catalog.btrim(coalesce(p_catatan, ''));
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') <> 'admin' then
    raise exception 'Akses administrator diperlukan' using errcode = '42501';
  end if;
  if p_id is null
    or clean_record = ''
    or pg_catalog.length(clean_record) > 120
    or pg_catalog.length(clean_note) > 2000 then
    raise exception 'Nomor berita acara wajib diisi dan maksimal 120 karakter.'
      using errcode = '22023';
  end if;

  select archive.*
    into archive_row
  from public.arsip as archive
  where archive.id = p_id
    and archive.deleted_at is null
  for update;

  if not found
    or archive_row.tanggal_retensi is null
    or archive_row.tanggal_retensi > (pg_catalog.now() at time zone 'Asia/Jakarta')::date
    or archive_row.status = 'dimusnahkan' then
    raise exception 'Arsip belum melewati tanggal retensi atau sudah dimusnahkan.'
      using errcode = '22023';
  end if;

  if archive_row.file_status = 'penghapusan_tertunda' then
    if archive_row.pemusnahan_berita_acara is distinct from clean_record then
      raise exception 'Pemusnahan sudah dimulai dengan nomor berita acara yang berbeda.'
        using errcode = '22023';
    end if;
    return pg_catalog.to_jsonb(archive_row);
  end if;

  if archive_row.file_status <> 'tersedia' then
    raise exception 'Status berkas tidak mengizinkan pemusnahan.'
      using errcode = '22023';
  end if;

  update public.arsip as archive
  set
    file_status = 'penghapusan_tertunda',
    pemusnahan_berita_acara = clean_record,
    pemusnahan_catatan = nullif(clean_note, ''),
    pemusnahan_diminta_oleh = actor_id,
    pemusnahan_diminta_pada = pg_catalog.now()
  where archive.id = p_id
  returning archive.* into archive_row;

  insert into public.log_audit (user_id, aksi, arsip_id, detail)
  values (
    actor_id,
    'pemusnahan',
    p_id,
    pg_catalog.jsonb_build_object(
      'tahap', 'dimulai',
      'nomor_arsip', archive_row.nomor_arsip,
      'judul', archive_row.judul,
      'nomor_berita_acara', clean_record,
      'catatan', nullif(clean_note, ''),
      'tanggal_retensi', archive_row.tanggal_retensi
    )
  );

  return pg_catalog.to_jsonb(archive_row);
end;
$$;

create or replace function public.admin_complete_archive_destruction(p_id uuid)
returns jsonb
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
    raise exception 'Akses administrator diperlukan' using errcode = '42501';
  end if;

  select archive.*
    into archive_row
  from public.arsip as archive
  where archive.id = p_id
    and archive.deleted_at is null
    and archive.file_status = 'penghapusan_tertunda'
  for update;

  if not found then
    raise exception 'Tidak ada proses pemusnahan yang menunggu.'
      using errcode = 'P0002';
  end if;
  if archive_row.file_path is not null and exists (
    select 1 from storage.objects as object_row
    where object_row.bucket_id = 'arsip'
      and object_row.name = archive_row.file_path
  ) then
    raise exception 'Berkas masih ada di Storage. Pemusnahan belum dapat diselesaikan.'
      using errcode = '22023';
  end if;

  update public.arsip as archive
  set
    status = 'dimusnahkan',
    file_status = 'dimusnahkan',
    dimusnahkan_oleh = actor_id,
    tanggal_pemusnahan = pg_catalog.now()
  where archive.id = p_id
  returning archive.* into archive_row;

  insert into public.log_audit (user_id, aksi, arsip_id, detail)
  values (
    actor_id,
    'pemusnahan',
    p_id,
    pg_catalog.jsonb_build_object(
      'nomor_arsip', archive_row.nomor_arsip,
      'judul', archive_row.judul,
      'tahap', 'selesai',
      'nomor_berita_acara', archive_row.pemusnahan_berita_acara,
      'catatan', archive_row.pemusnahan_catatan,
      'tanggal_retensi', archive_row.tanggal_retensi,
      'tanggal_pemusnahan', archive_row.tanggal_pemusnahan
    )
  );

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
    count(archive.id) filter (
      where archive.tanggal_retensi >= (pg_catalog.now() at time zone 'Asia/Jakarta')::date
        and archive.tanggal_retensi <= (pg_catalog.now() at time zone 'Asia/Jakarta')::date + 90
    ),
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
revoke all on function public.admin_review_archive(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_review_archive(uuid, text, text)
  to authenticated;
revoke all on function public.admin_begin_archive_destruction(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_begin_archive_destruction(uuid, text, text)
  to authenticated;
revoke all on function public.admin_complete_archive_destruction(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_complete_archive_destruction(uuid)
  to authenticated;
revoke all on function public.dashboard_stats() from public, anon, authenticated;
grant execute on function public.dashboard_stats() to authenticated;

commit;
