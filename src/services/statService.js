import { supabase } from '../lib/supabase.js'
import { loadReadRequest } from './readCache.js'

export function fetchDashboardStats() {
  if (!supabase) throw new Error('Koneksi aplikasi belum dikonfigurasi.')

  return loadReadRequest('dashboard-stats', null, async () => {
    let result
    try {
      result = await supabase.rpc('dashboard_stats')
    } catch {
      throw new Error('Statistik arsip gagal dimuat. Periksa koneksi dan hak akses, lalu coba lagi.')
    }
    if (result.error) {
      throw new Error('Statistik arsip gagal dimuat. Periksa koneksi dan hak akses, lalu coba lagi.')
    }

    const { data } = result
    const row = Array.isArray(data) ? data[0] : data
    if (!row) throw new Error('Statistik arsip belum tersedia. Coba muat ulang.')

    const metrics = [
      row.total_arsip,
      row.menunggu_verifikasi,
      row.mendekati_retensi,
      row.penyimpanan_bytes,
    ].map(Number)
    if (metrics.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error('Format statistik arsip tidak valid. Coba muat ulang.')
    }

    return {
      total: metrics[0],
      waiting: metrics[1],
      retention: metrics[2],
      storageBytes: metrics[3],
    }
  })
}

export function formatStorageBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new Error('Ukuran penyimpanan tidak valid.')
  }
  if (bytes === 0) return '0 B'

  const mb = 1024 ** 2
  const gb = 1024 ** 3
  const divisor = bytes >= gb ? gb : bytes >= mb ? mb : 1
  const unit = bytes >= gb ? 'GB' : bytes >= mb ? 'MB' : 'B'
  const amount = bytes / divisor

  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(amount)} ${unit}`
}
