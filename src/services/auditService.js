import { supabase } from '../lib/supabase.js'
import { loadReadRequest } from './readCache.js'

function readErrorMessage(error) {
  const code = String(error?.code ?? '').toUpperCase()
  const message = String(error?.message ?? '').toLowerCase()
  if (code === '42501' || message.includes('permission denied') || message.includes('row-level security')) {
    return 'Anda tidak memiliki izin untuk membaca log audit.'
  }
  if (code === 'PGRST204' || code === '42P01') {
    return 'Log audit belum tersedia. Minta administrator memeriksa migrasi SQL dan hak akses.'
  }
  if (error instanceof TypeError || /fetch|network|timeout|timed out/.test(message)) {
    return 'Koneksi terganggu. Periksa jaringan, lalu coba lagi.'
  }
  return 'Log audit gagal dimuat. Coba lagi atau hubungi administrator.'
}

export function fetchAuditPage({
  page = 1,
  pageSize = 20,
  action = '',
  fromDate = '',
  toDate = '',
} = {}) {
  if (!supabase) throw new Error('Koneksi aplikasi belum dikonfigurasi.')

  const safePage = Math.max(1, Math.floor(page))
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)))
  const params = { page: safePage, pageSize: safePageSize, action, fromDate, toDate }
  return loadReadRequest('audit-page', params, async () => {
    const from = (safePage - 1) * safePageSize
    const to = from + safePageSize - 1
    let query = supabase
      .from('log_audit')
      .select('id, user_id, aksi, arsip_id, detail, waktu', { count: 'exact' })
      .order('waktu', { ascending: false })
      .range(from, to)

    if (action) query = query.eq('aksi', action)
    if (fromDate) query = query.gte('waktu', `${fromDate}T00:00:00Z`)
    if (toDate) {
      const until = new Date(`${toDate}T00:00:00Z`)
      until.setUTCDate(until.getUTCDate() + 1)
      query = query.lt('waktu', until.toISOString())
    }

    let result
    try {
      result = await query
    } catch (error) {
      throw new Error(readErrorMessage(error))
    }
    if (result.error) throw new Error(readErrorMessage(result.error))

    return {
      records: result.data ?? [],
      total: result.count ?? 0,
      page: safePage,
      pageSize: safePageSize,
    }
  })
}
