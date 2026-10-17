-- Membuat RPC statistik dengan hak pemanggil; uji sebagai tiap role dan bandingkan dengan baris yang terlihat lewat RLS.
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
$$;

revoke all on function public.dashboard_stats() from public, anon;
grant execute on function public.dashboard_stats() to authenticated;
