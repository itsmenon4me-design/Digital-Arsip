begin;

do $$
begin
  if exists (
    select 1
    from public.klasifikasi as classification
    group by pg_catalog.lower(pg_catalog.btrim(classification.nama))
    having count(*) > 1
  ) then
    raise exception
      'Klasifikasi memiliki nama duplikat tanpa membedakan huruf besar/kecil. Selesaikan duplikat sebelum menerapkan migrasi 019.';
  end if;
end;
$$;

create unique index if not exists klasifikasi_nama_normalized_uidx
  on public.klasifikasi (pg_catalog.lower(pg_catalog.btrim(nama)));

create or replace function public.admin_save_classification_details(
  p_id uuid,
  p_nama text,
  p_keterangan text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  classification_row public.klasifikasi%rowtype;
  clean_name text := nullif(pg_catalog.btrim(coalesce(p_nama, '')), '');
  clean_description text := nullif(pg_catalog.btrim(coalesce(p_keterangan, '')), '');
  code_base text;
  candidate_code text;
  suffix text;
  suffix_number integer := 1;
  operation_name text;
begin
  if actor_id is null
    or coalesce(private.current_profile_role()::text, '') <> 'admin' then
    raise exception 'Akses administrator diperlukan' using errcode = '42501';
  end if;
  if clean_name is null or pg_catalog.length(clean_name) > 150 then
    raise exception 'Nama wajib diisi dan maksimal 150 karakter.' using errcode = '22023';
  end if;
  if pg_catalog.length(coalesce(clean_description, '')) > 2000 then
    raise exception 'Keterangan maksimal 2000 karakter.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.klasifikasi.admin_save_classification_details')
  );

  if exists (
    select 1
    from public.klasifikasi as existing
    where pg_catalog.lower(pg_catalog.btrim(existing.nama))
      = pg_catalog.lower(clean_name)
      and existing.id is distinct from p_id
  ) then
    raise exception 'Nama klasifikasi sudah digunakan.' using errcode = '23505';
  end if;

  if p_id is null then
    code_base := 'KLAS-' || pg_catalog.btrim(
      pg_catalog.regexp_replace(pg_catalog.upper(clean_name), '[^A-Z0-9]+', '-', 'g'),
      '-'
    );
    if code_base = 'KLAS-' then
      code_base := 'KLAS-UMUM';
    end if;
    candidate_code := pg_catalog.left(code_base, 48);

    while exists (
      select 1
      from public.klasifikasi as existing
      where existing.kode = candidate_code
    ) loop
      suffix_number := suffix_number + 1;
      suffix := '-' || suffix_number::text;
      candidate_code := pg_catalog.left(code_base, 50 - pg_catalog.length(suffix)) || suffix;
    end loop;

    insert into public.klasifikasi (kode, nama, keterangan)
    values (candidate_code, clean_name, clean_description)
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

    if classification_row.nama is distinct from clean_name
      or classification_row.keterangan is distinct from clean_description then
      update public.klasifikasi as classification
      set nama = clean_name,
          keterangan = clean_description
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
        'nama', classification_row.nama,
        'keterangan', classification_row.keterangan
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'id', classification_row.id,
    'kode', classification_row.kode,
    'nama', classification_row.nama,
    'keterangan', classification_row.keterangan,
    'aktif', classification_row.aktif
  );
end;
$$;

revoke all on function public.admin_save_classification_details(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_save_classification_details(uuid, text, text)
  to authenticated;

do $$
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'arsip'
  ) then
    raise exception 'Storage bucket arsip tidak ditemukan. Pastikan migrasi storage sebelumnya sudah diterapkan.';
  end if;
end;
$$;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/tiff',
  'image/png',
  'video/mp4',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]::text[]
where id = 'arsip';

commit;
