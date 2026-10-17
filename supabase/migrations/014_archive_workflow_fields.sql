begin;

alter type public.arsip_status
  add value if not exists 'perlu_perbaikan';
alter type public.arsip_status
  add value if not exists 'dimusnahkan';
alter type public.log_audit_aksi
  add value if not exists 'verifikasi';
alter type public.log_audit_aksi
  add value if not exists 'pemusnahan';

alter table public.arsip
  add column if not exists tanggal_publikasi date,
  add column if not exists kanal_publikasi text,
  add column if not exists nama_kegiatan text,
  add column if not exists diverifikasi_oleh uuid
    references auth.users (id) on delete set null,
  add column if not exists diverifikasi_pada timestamptz,
  add column if not exists catatan_verifikasi text,
  add column if not exists pemusnahan_berita_acara text,
  add column if not exists pemusnahan_catatan text,
  add column if not exists pemusnahan_diminta_oleh uuid
    references auth.users (id) on delete set null,
  add column if not exists pemusnahan_diminta_pada timestamptz,
  add column if not exists dimusnahkan_oleh uuid
    references auth.users (id) on delete set null,
  add column if not exists tanggal_pemusnahan timestamptz;

alter table public.arsip
  drop constraint if exists arsip_file_status_check;

alter table public.arsip
  add constraint arsip_file_status_check
    check (file_status in (
      'mengunggah',
      'tersedia',
      'penghapusan_tertunda',
      'dimusnahkan'
    ));

commit;
