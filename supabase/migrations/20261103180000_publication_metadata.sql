begin;

alter table public.arsip
  add column if not exists jenis_konten text,
  add column if not exists penulis text,
  add column if not exists tautan_publikasi text,
  add column if not exists kata_kunci text[],
  add column if not exists tipe_file text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.arsip'::regclass
      and conname = 'arsip_jenis_konten_check'
  ) then
    alter table public.arsip
      add constraint arsip_jenis_konten_check
      check (
        jenis_konten is null
        or jenis_konten in (
          'siaran pers',
          'berita',
          'foto kegiatan',
          'video',
          'infografis',
          'postingan media sosial',
          'lainnya'
        )
      );
  end if;
end;
$$;

update public.arsip
set tipe_file = case lower(substring(nama_berkas from '\.([^.]+)$'))
  when 'pdf' then 'application/pdf'
  when 'jpg' then 'image/jpeg'
  when 'jpeg' then 'image/jpeg'
  when 'tif' then 'image/tiff'
  when 'tiff' then 'image/tiff'
  when 'png' then 'image/png'
  when 'mp4' then 'video/mp4'
  when 'xls' then 'application/vnd.ms-excel'
  when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  when 'doc' then 'application/msword'
  when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  when 'ppt' then 'application/vnd.ms-powerpoint'
  when 'pptx' then 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
end
where tipe_file is null
  and lower(substring(nama_berkas from '\.([^.]+)$')) in (
    'pdf', 'jpg', 'jpeg', 'tif', 'tiff', 'png', 'mp4',
    'xls', 'xlsx', 'doc', 'docx', 'ppt', 'pptx'
  );

create index if not exists arsip_tanggal_publikasi_idx
  on public.arsip (tanggal_publikasi);
create index if not exists arsip_jenis_konten_idx
  on public.arsip (jenis_konten);
create index if not exists arsip_kanal_publikasi_idx
  on public.arsip (kanal_publikasi);
create index if not exists arsip_penulis_idx
  on public.arsip (penulis);
create index if not exists arsip_kata_kunci_gin_idx
  on public.arsip using gin (kata_kunci);

create function public.search_arsip_by_publication(p_search text)
returns setof public.arsip
language sql
stable
security invoker
set search_path = ''
as $$
  with query_term as (
    select pg_catalog.lower(pg_catalog.btrim(coalesce(p_search, ''))) as value
  )
  select archive.*
  from public.arsip as archive
  cross join query_term
  where query_term.value <> ''
    and (
      pg_catalog.strpos(
        pg_catalog.lower(pg_catalog.concat_ws(
          ' ',
          archive.nomor_arsip,
          archive.judul,
          archive.nama_kegiatan,
          archive.kanal_publikasi,
          archive.penulis
        )),
        query_term.value
      ) > 0
      or exists (
        select 1
        from pg_catalog.unnest(coalesce(archive.kata_kunci, '{}'::text[])) as keyword(value)
        where pg_catalog.strpos(pg_catalog.lower(keyword.value), query_term.value) > 0
      )
      or pg_catalog.to_tsvector(
        'pg_catalog.simple'::pg_catalog.regconfig,
        pg_catalog.concat_ws(
          ' ',
          archive.nomor_arsip,
          archive.judul,
          archive.nama_kegiatan,
          archive.kanal_publikasi,
          archive.penulis,
          pg_catalog.array_to_string(archive.kata_kunci, ' ')
        )
      ) @@ pg_catalog.plainto_tsquery(
        'pg_catalog.simple'::pg_catalog.regconfig,
        query_term.value
      )
    );
$$;

revoke all on function public.search_arsip_by_publication(text)
  from public, anon;
grant execute on function public.search_arsip_by_publication(text)
  to authenticated;

create function public.admin_update_arsip_publication_v2(
  p_id uuid,
  p_judul text,
  p_klasifikasi_id uuid,
  p_unit_pencipta text,
  p_tingkat_akses text,
  p_tanggal_publikasi date,
  p_kanal_publikasi text,
  p_nama_kegiatan text,
  p_jenis_konten text,
  p_penulis text,
  p_tautan_publikasi text,
  p_kata_kunci text[]
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
  clean_content_type text := nullif(pg_catalog.btrim(coalesce(p_jenis_konten, '')), '');
  clean_author text := nullif(pg_catalog.btrim(coalesce(p_penulis, '')), '');
  clean_publication_url text := nullif(pg_catalog.btrim(coalesce(p_tautan_publikasi, '')), '');
  clean_keywords text[];
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
    or pg_catalog.length(coalesce(clean_author, '')) > 255
    or pg_catalog.length(coalesce(clean_publication_url, '')) > 2048
    or p_klasifikasi_id is null
    or not exists (
      select 1 from public.klasifikasi
      where id = p_klasifikasi_id
    ) then
    raise exception 'Periksa kembali metadata arsip.' using errcode = '22023';
  end if;

  if clean_content_type is not null
    and clean_content_type not in (
      'siaran pers',
      'berita',
      'foto kegiatan',
      'video',
      'infografis',
      'postingan media sosial',
      'lainnya'
    ) then
    raise exception 'Jenis konten tidak dikenal.' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.array_agg(cleaned.keyword order by cleaned.keyword), '{}'::text[])
    into clean_keywords
  from (
    select distinct pg_catalog.btrim(keyword.value) as keyword
    from pg_catalog.unnest(coalesce(p_kata_kunci, '{}'::text[])) as keyword(value)
    where pg_catalog.btrim(keyword.value) <> ''
  ) as cleaned;

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
    or archive_row.nama_kegiatan is distinct from clean_event
    or archive_row.jenis_konten is distinct from clean_content_type
    or archive_row.penulis is distinct from clean_author
    or archive_row.tautan_publikasi is distinct from clean_publication_url
    or archive_row.kata_kunci is distinct from clean_keywords then
    update public.arsip as archive
    set
      judul = clean_title,
      klasifikasi_id = p_klasifikasi_id,
      unit_pencipta = clean_unit,
      tingkat_akses = clean_access::public.arsip_tingkat_akses,
      tanggal_publikasi = p_tanggal_publikasi,
      kanal_publikasi = clean_channel,
      nama_kegiatan = clean_event,
      jenis_konten = clean_content_type,
      penulis = clean_author,
      tautan_publikasi = clean_publication_url,
      kata_kunci = clean_keywords,
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

revoke all on function public.admin_update_arsip_publication_v2(
  uuid, text, uuid, text, text, date, text, text, text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.admin_update_arsip_publication_v2(
  uuid, text, uuid, text, text, date, text, text, text, text, text, text[]
) to authenticated;

commit;
