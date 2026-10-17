-- Membuat ekstensi, tabel, dan indeks; verifikasi tabel dengan pg_tables dan indeks dengan pg_indexes.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.unit (
  id uuid primary key default gen_random_uuid(),
  kode text not null unique,
  nama text not null,
  created_at timestamptz not null default now(),
  constraint unit_kode_not_blank check (length(trim(kode)) > 0),
  constraint unit_nama_not_blank check (length(trim(nama)) > 0)
);

create table if not exists public.klasifikasi (
  id uuid primary key default gen_random_uuid(),
  kode text not null unique,
  nama text not null,
  retensi_aktif_tahun integer not null check (retensi_aktif_tahun >= 0),
  retensi_inaktif_tahun integer not null check (retensi_inaktif_tahun >= 0),
  nasib_akhir text not null check (nasib_akhir in ('musnah', 'permanen')),
  created_at timestamptz not null default now(),
  constraint klasifikasi_kode_not_blank check (length(trim(kode)) > 0),
  constraint klasifikasi_nama_not_blank check (length(trim(nama)) > 0)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nama text,
  role text not null default 'viewer' check (role in ('admin', 'petugas', 'viewer')),
  unit_id uuid references public.unit (id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.immutable_array_to_string(text[], text)
returns text
language sql
immutable
parallel safe
as $$
  select array_to_string($1, $2)
$$;

create table if not exists public.arsip (
  id uuid primary key default gen_random_uuid(),
  nomor_arsip text not null unique,
  judul text not null,
  uraian text,
  klasifikasi_id uuid not null references public.klasifikasi (id) on delete restrict,
  unit_id uuid not null references public.unit (id) on delete restrict,
  tanggal_arsip date not null default current_date,
  status text not null default 'menunggu'
    check (status in ('menunggu', 'terverifikasi', 'inaktif', 'ditolak')),
  tingkat_akses text not null default 'internal'
    check (tingkat_akses in ('publik', 'internal', 'rahasia')),
  file_path text,
  file_nama text,
  file_tipe text,
  file_ukuran bigint check (file_ukuran is null or file_ukuran >= 0),
  file_checksum text,
  kata_kunci text[] not null default '{}',
  search tsvector generated always as (
    to_tsvector(
      'simple'::regconfig,
      coalesce(judul, '') || ' ' ||
      coalesce(uraian, '') || ' ' ||
      coalesce(
        public.immutable_array_to_string(kata_kunci, ' '),
        ''
      )
    )
  ) stored,
  dibuat_oleh uuid references public.profiles (id) on delete set null,
  verifikator_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arsip_nomor_not_blank check (length(trim(nomor_arsip)) > 0),
  constraint arsip_judul_not_blank check (length(trim(judul)) > 0),
  constraint arsip_file_path_not_blank check (
    file_path is null or length(trim(file_path)) > 0
  )
);

create table if not exists public.audit_log (
  id bigserial primary key,
  user_id uuid references auth.users (id) on delete set null,
  aksi text not null check (
    aksi in ('lihat', 'unduh', 'buat', 'ubah', 'hapus', 'verifikasi', 'tolak')
  ),
  arsip_id uuid references public.arsip (id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists arsip_search_gin_idx
  on public.arsip using gin (search);
create index if not exists arsip_status_idx on public.arsip (status);
create index if not exists arsip_klasifikasi_id_idx on public.arsip (klasifikasi_id);
create index if not exists arsip_unit_id_idx on public.arsip (unit_id);
create index if not exists arsip_tanggal_arsip_idx on public.arsip (tanggal_arsip);
create index if not exists arsip_created_at_idx on public.arsip (created_at desc);
create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);
create index if not exists audit_log_user_aksi_idx on public.audit_log (user_id, aksi);

do $$
declare
  trgm_schema text;
begin
  select namespace.nspname
    into trgm_schema
  from pg_catalog.pg_extension as extension
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = extension.extnamespace
  where extension.extname = 'pg_trgm';

  if trgm_schema is null then
    raise exception 'Ekstensi pg_trgm belum tersedia setelah perintah CREATE EXTENSION';
  end if;

  execute format(
    'create index if not exists arsip_judul_trgm_gin_idx on public.arsip using gin (judul %I.gin_trgm_ops)',
    trgm_schema
  );
end;
$$;
