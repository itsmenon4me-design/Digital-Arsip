insert into public.unit (id, kode, nama)
values
  ('10000000-0000-4000-8000-000000000001', 'UNIT-CONTOH-01', '[CONTOH] Unit Humas'),
  ('10000000-0000-4000-8000-000000000002', 'UNIT-CONTOH-02', '[CONTOH] Unit Pelayanan'),
  ('10000000-0000-4000-8000-000000000003', 'UNIT-CONTOH-03', '[CONTOH] Unit Administrasi')
on conflict (kode) do nothing;

insert into public.klasifikasi (
  id, kode, nama, retensi_aktif_tahun, retensi_inaktif_tahun, nasib_akhir
)
values
  ('20000000-0000-4000-8000-000000000001', 'KLAS-CONTOH-01', '[CONTOH] Publikasi kegiatan', 2, 3, 'permanen'),
  ('20000000-0000-4000-8000-000000000002', 'KLAS-CONTOH-02', '[CONTOH] Siaran pers', 2, 3, 'permanen'),
  ('20000000-0000-4000-8000-000000000003', 'KLAS-CONTOH-03', '[CONTOH] Dokumentasi foto', 1, 4, 'permanen'),
  ('20000000-0000-4000-8000-000000000004', 'KLAS-CONTOH-04', '[CONTOH] Materi informasi', 1, 2, 'musnah'),
  ('20000000-0000-4000-8000-000000000005', 'KLAS-CONTOH-05', '[CONTOH] Publikasi layanan', 2, 3, 'permanen'),
  ('20000000-0000-4000-8000-000000000006', 'KLAS-CONTOH-06', '[CONTOH] Materi internal', 1, 2, 'musnah')
on conflict (kode) do nothing;

insert into public.arsip (
  id,
  nomor_arsip,
  judul,
  uraian,
  klasifikasi_id,
  unit_id,
  tanggal_arsip,
  status,
  tingkat_akses,
  kata_kunci
)
values
  (
    '30000000-0000-4000-8000-000000000001',
    'CONTOH-2025-0001',
    '[CONTOH] Dokumentasi kegiatan masyarakat',
    'Data contoh untuk menguji daftar dan pencarian arsip.',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '2025-01-15',
    'terverifikasi',
    'publik',
    array['contoh', 'kegiatan']
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    'CONTOH-2025-0002',
    '[CONTOH] Siaran pers simulasi',
    'Konten placeholder, bukan siaran pers yang benar-benar diterbitkan.',
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '2025-02-10',
    'menunggu',
    'internal',
    array['contoh', 'siaran pers']
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    'CONTOH-2025-0003',
    '[CONTOH] Dokumentasi foto simulasi',
    'Metadata contoh tanpa berkas foto.',
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '2025-03-04',
    'terverifikasi',
    'internal',
    array['contoh', 'foto']
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    'CONTOH-2025-0004',
    '[CONTOH] Materi informasi publik',
    'Data contoh untuk validasi filter status.',
    '20000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000002',
    '2025-04-18',
    'ditolak',
    'publik',
    array['contoh', 'informasi']
  ),
  (
    '30000000-0000-4000-8000-000000000005',
    'CONTOH-2025-0005',
    '[CONTOH] Publikasi layanan simulasi',
    'Metadata placeholder untuk uji tampilan.',
    '20000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000002',
    '2025-05-21',
    'terverifikasi',
    'publik',
    array['contoh', 'layanan']
  ),
  (
    '30000000-0000-4000-8000-000000000006',
    'CONTOH-2025-0006',
    '[CONTOH] Materi rapat internal',
    'Arsip simulasi dengan tingkat akses rahasia.',
    '20000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000003',
    '2025-06-02',
    'inaktif',
    'rahasia',
    array['contoh', 'internal']
  ),
  (
    '30000000-0000-4000-8000-000000000007',
    'CONTOH-2025-0007',
    '[CONTOH] Dokumentasi kegiatan simulasi',
    'Contoh data tambahan untuk menguji pagination.',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    '2025-07-12',
    'menunggu',
    'internal',
    array['contoh', 'dokumentasi']
  ),
  (
    '30000000-0000-4000-8000-000000000008',
    'CONTOH-2025-0008',
    '[CONTOH] Informasi publik simulasi',
    'Data placeholder yang tidak memuat informasi pribadi.',
    '20000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000001',
    '2025-08-25',
    'terverifikasi',
    'publik',
    array['contoh', 'informasi publik']
  )
on conflict (id) do nothing;
