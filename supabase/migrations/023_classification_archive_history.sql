begin;

alter table public.arsip
  alter column klasifikasi_id drop not null;

alter table public.arsip
  drop constraint if exists arsip_klasifikasi_id_fkey;

alter table public.arsip
  add constraint arsip_klasifikasi_id_fkey
  foreign key (klasifikasi_id)
  references public.klasifikasi (id)
  on delete set null;

create or replace function public.enforce_active_archive_classification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.klasifikasi_id is null or not exists (
      select 1
      from public.klasifikasi as classification
      where classification.id = new.klasifikasi_id
        and classification.aktif
    ) then
      raise exception 'Arsip baru hanya dapat menggunakan klasifikasi aktif.'
        using errcode = '23514';
    end if;
  elsif new.klasifikasi_id is distinct from old.klasifikasi_id then
    if new.klasifikasi_id is null then
      if new.deleted_at is null
        and new.status is distinct from 'dimusnahkan'::public.arsip_status
        and new.file_status is distinct from 'dimusnahkan' then
        raise exception 'Klasifikasi arsip aktif tidak dapat dilepas.'
          using errcode = '23514';
      end if;
    elsif not exists (
      select 1
      from public.klasifikasi as classification
      where classification.id = new.klasifikasi_id
        and classification.aktif
    ) then
      raise exception 'Klasifikasi nonaktif hanya dapat dipertahankan pada arsip yang sudah menggunakannya.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_active_archive_classification()
  from public, anon, authenticated;

create or replace function public.admin_list_classification_usage()
returns table (id uuid, dipakai boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') <> 'admin' then
    raise exception 'Akses administrator diperlukan' using errcode = '42501';
  end if;

  return query
  select
    classification.id,
    exists (
      select 1
      from public.arsip as archive
      where archive.klasifikasi_id = classification.id
        and archive.deleted_at is null
        and archive.status is distinct from 'dimusnahkan'::public.arsip_status
        and archive.file_status is distinct from 'dimusnahkan'
    ) as dipakai
  from public.klasifikasi as classification
  order by classification.kode;
end;
$$;

create or replace function public.admin_delete_classification(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  classification_row public.klasifikasi%rowtype;
  detached_archives jsonb;
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') <> 'admin' then
    raise exception 'Akses administrator diperlukan' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'Pilih klasifikasi yang akan dihapus.' using errcode = '22023';
  end if;

  select classification.*
    into classification_row
  from public.klasifikasi as classification
  where classification.id = p_id
  for update;

  if not found then
    raise exception 'Klasifikasi tidak ditemukan.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.arsip as archive
    where archive.klasifikasi_id = classification_row.id
      and archive.deleted_at is null
      and archive.status is distinct from 'dimusnahkan'::public.arsip_status
      and archive.file_status is distinct from 'dimusnahkan'
  ) then
    raise exception 'Klasifikasi masih dipakai oleh arsip aktif.'
      using errcode = '23503';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', archive.id,
        'nomor_arsip', archive.nomor_arsip,
        'judul', archive.judul
      )
      order by archive.nomor_arsip
    ),
    '[]'::jsonb
  )
    into detached_archives
  from public.arsip as archive
  where archive.klasifikasi_id = classification_row.id
    and (
      archive.deleted_at is not null
      or archive.status = 'dimusnahkan'::public.arsip_status
      or archive.file_status = 'dimusnahkan'
    );

  update public.arsip as archive
  set klasifikasi_id = null
  where archive.klasifikasi_id = classification_row.id
    and (
      archive.deleted_at is not null
      or archive.status = 'dimusnahkan'::public.arsip_status
      or archive.file_status = 'dimusnahkan'
    );

  insert into public.log_audit (user_id, aksi, arsip_id, detail)
  values (
    actor_id,
    'ubah',
    null,
    pg_catalog.jsonb_build_object(
      'entitas', 'klasifikasi',
      'operasi', 'hapus',
      'klasifikasi_id', classification_row.id,
      'kode', classification_row.kode,
      'nama', classification_row.nama,
      'arsip_riwayat_dilepas', detached_archives
    )
  );

  delete from public.klasifikasi as classification
  where classification.id = classification_row.id;

  return pg_catalog.jsonb_build_object(
    'id', classification_row.id,
    'kode', classification_row.kode,
    'nama', classification_row.nama
  );
end;
$$;

revoke all on function public.admin_list_classification_usage()
  from public, anon, authenticated;
grant execute on function public.admin_list_classification_usage()
  to authenticated;

revoke all on function public.admin_delete_classification(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_delete_classification(uuid)
  to authenticated;

commit;
