begin;

alter table public.klasifikasi
  add column if not exists aktif boolean not null default true;

create or replace function public.enforce_active_archive_classification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1
      from public.klasifikasi as classification
      where classification.id = new.klasifikasi_id
        and classification.aktif
    ) then
      raise exception 'Arsip baru hanya dapat menggunakan klasifikasi aktif.'
        using errcode = '23514';
    end if;
  elsif new.klasifikasi_id is distinct from old.klasifikasi_id then
    if not exists (
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

drop trigger if exists arsip_require_active_classification on public.arsip;
create trigger arsip_require_active_classification
  before insert or update on public.arsip
  for each row
  execute function public.enforce_active_archive_classification();

revoke insert, update, delete on table public.klasifikasi
  from public, anon, authenticated;

create or replace function public.admin_save_classification(
  p_id uuid,
  p_kode text,
  p_nama text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  classification_row public.klasifikasi%rowtype;
  clean_code text := nullif(pg_catalog.btrim(coalesce(p_kode, '')), '');
  clean_name text := nullif(pg_catalog.btrim(coalesce(p_nama, '')), '');
  operation_name text;
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') <> 'admin' then
    raise exception 'Akses administrator diperlukan' using errcode = '42501';
  end if;
  if clean_code is null or pg_catalog.length(clean_code) > 50 then
    raise exception 'Kode wajib diisi dan maksimal 50 karakter.' using errcode = '22023';
  end if;
  if clean_name is null or pg_catalog.length(clean_name) > 150 then
    raise exception 'Nama wajib diisi dan maksimal 150 karakter.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.klasifikasi (kode, nama)
    values (clean_code, clean_name)
    returning * into classification_row;
    operation_name := 'buat';
  else
    select classification.*
      into classification_row
    from public.klasifikasi as classification
    where classification.id = p_id
    for update;

    if not found then
      raise exception 'Klasifikasi tidak ditemukan.' using errcode = 'P0002';
    end if;

    if classification_row.kode is distinct from clean_code
      or classification_row.nama is distinct from clean_name then
      update public.klasifikasi as classification
      set kode = clean_code,
          nama = clean_name
      where classification.id = p_id
      returning classification.* into classification_row;
      operation_name := 'ubah';
    end if;
  end if;

  if operation_name is not null then
    insert into public.log_audit (user_id, aksi, arsip_id, detail)
    values (
      actor_id,
      'ubah',
      null,
      pg_catalog.jsonb_build_object(
        'entitas', 'klasifikasi',
        'operasi', operation_name,
        'klasifikasi_id', classification_row.id,
        'kode', classification_row.kode,
        'nama', classification_row.nama
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'id', classification_row.id,
    'kode', classification_row.kode,
    'nama', classification_row.nama,
    'aktif', classification_row.aktif
  );
end;
$$;

create or replace function public.admin_set_classification_active(
  p_id uuid,
  p_aktif boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  classification_row public.klasifikasi%rowtype;
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') <> 'admin' then
    raise exception 'Akses administrator diperlukan' using errcode = '42501';
  end if;
  if p_id is null or p_aktif is null then
    raise exception 'Klasifikasi dan status wajib dipilih.' using errcode = '22023';
  end if;

  select classification.*
    into classification_row
  from public.klasifikasi as classification
  where classification.id = p_id
  for update;

  if not found then
    raise exception 'Klasifikasi tidak ditemukan.' using errcode = 'P0002';
  end if;

  if classification_row.aktif is distinct from p_aktif then
    update public.klasifikasi as classification
    set aktif = p_aktif
    where classification.id = p_id
    returning classification.* into classification_row;

    insert into public.log_audit (user_id, aksi, arsip_id, detail)
    values (
      actor_id,
      'ubah',
      null,
      pg_catalog.jsonb_build_object(
        'entitas', 'klasifikasi',
        'operasi', case when p_aktif then 'aktifkan' else 'nonaktifkan' end,
        'klasifikasi_id', classification_row.id,
        'kode', classification_row.kode,
        'nama', classification_row.nama,
        'aktif', classification_row.aktif
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'id', classification_row.id,
    'kode', classification_row.kode,
    'nama', classification_row.nama,
    'aktif', classification_row.aktif
  );
end;
$$;

revoke all on function public.admin_save_classification(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_save_classification(uuid, text, text)
  to authenticated;

revoke all on function public.admin_set_classification_active(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_set_classification_active(uuid, boolean)
  to authenticated;

commit;
