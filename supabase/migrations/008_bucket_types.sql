-- Opsional: jalankan hanya jika bucket privat arsip akan menerima PNG dan MP4.
-- Batas 50 MiB dipertahankan agar sesuai batas unggah yang sudah ada di frontend.
update storage.buckets
set
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = array[
    'application/pdf',
    'image/jpeg',
    'image/tiff',
    'image/png',
    'video/mp4'
  ]::text[]
where id = 'arsip';
