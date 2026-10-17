-- Jalankan sebelum 007_rls_simple.sql. Seed lama dengan file_path NULL tetap berstatus tersedia.
alter table public.arsip
  alter column diunggah_oleh set default auth.uid();

alter table public.arsip
  add column if not exists nama_berkas text;

alter table public.arsip
  add column if not exists file_status text not null default 'tersedia';

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.arsip'::regclass
      and constraint_row.conname = 'arsip_file_status_check'
  ) then
    alter table public.arsip
      add constraint arsip_file_status_check
      check (file_status in ('mengunggah', 'tersedia'));
  end if;
end;
$$;

-- Opsional: tandai metadata lama yang kehilangan objek sebagai belum tersedia.
-- Seed tidak terdampak karena file_path-nya NULL.
-- update public.arsip as archive
-- set file_status = 'mengunggah'
-- where archive.file_path is not null
--   and not exists (
--     select 1
--     from storage.objects as object_row
--     where object_row.bucket_id = 'arsip'
--       and object_row.name = archive.file_path
--   );

create or replace function public.guard_archive_file_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.file_status = 'tersedia'
    and new.file_path is not null
    and not exists (
      select 1
      from storage.objects as object_row
      where object_row.bucket_id = 'arsip'
        and object_row.name = new.file_path
    ) then
    raise exception 'Status berkas tidak dapat diselesaikan sebelum objek tersedia di Storage'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_archive_file_status()
  from public, anon, authenticated;

drop trigger if exists guard_archive_file_status on public.arsip;
create trigger guard_archive_file_status
  before insert or update of file_status, file_path on public.arsip
  for each row execute function public.guard_archive_file_status();

-- Fungsi audit lama juga dipastikan memakai hak definer dan search_path terkunci.
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
    if old.file_status = 'mengunggah' and new.file_status = 'tersedia' then
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

revoke all on function public.audit_arsip_write() from public, anon, authenticated;

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
    or coalesce(private.current_profile_role(), '') not in ('admin', 'petugas_arsip') then
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

revoke all on function public.rollback_archive_upload(uuid)
  from public, anon, authenticated;
grant execute on function public.rollback_archive_upload(uuid) to authenticated;

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
    or coalesce(private.current_profile_role(), '') not in ('admin', 'petugas_arsip') then
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

revoke all on function public.complete_archive_upload(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_archive_upload(uuid) to authenticated;

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
begin
  if actor_id is null
    or coalesce(private.current_profile_role(), '') not in ('admin', 'petugas_arsip')
    or p_action is null
    or p_action not in ('buka', 'unduh') then
    return false;
  end if;

  if not exists (
    select 1
    from public.arsip as archive
    where archive.id = p_archive_id
      and archive.file_status = 'tersedia'
      and exists (
        select 1
        from storage.objects as object_row
        where object_row.bucket_id = 'arsip'
          and object_row.name = archive.file_path
      )
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

-- Signature dan urutan kolom sama dengan 004_stats.sql untuk CREATE OR REPLACE.
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
$$;

revoke all on function public.dashboard_stats() from public, anon;
grant execute on function public.dashboard_stats() to authenticated;
