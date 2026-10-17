import { supabase } from '../lib/supabase.js'
import { loadReadRequest } from './readCache.js'

export function fetchAdminUserDirectory() {
  if (!supabase) throw new Error('Koneksi aplikasi belum dikonfigurasi.')

  return loadReadRequest('admin-users', null, async () => {
    let result
    try {
      result = await supabase.rpc('admin_user_directory')
    } catch (error) {
      const message = String(error?.message ?? '').toLowerCase()
      throw new Error(error instanceof TypeError || /fetch|network|timeout|timed out/.test(message)
        ? 'Koneksi terganggu. Periksa jaringan, lalu coba lagi.'
        : 'Daftar pengguna gagal dimuat. Coba lagi atau hubungi administrator.')
    }

    if (result.error) {
      const code = String(result.error.code ?? '')
      const message = String(result.error.message ?? '').toLowerCase()
      if (code === '42501') {
        throw new Error('Anda tidak memiliki akses untuk melihat daftar pengguna.')
      }
      if (code === 'PGRST202') {
        throw new Error('Fitur daftar pengguna belum tersedia. Minta administrator menjalankan migrasi SQL 011.')
      }
      if (errorIsNetworkFailure(result.error)) {
        throw new Error('Koneksi terganggu. Periksa jaringan, lalu coba lagi.')
      }
      throw new Error(message.includes('permission denied')
        ? 'Akun Anda tidak memiliki izin untuk melihat daftar pengguna.'
        : 'Daftar pengguna gagal dimuat. Coba lagi atau hubungi administrator.')
    }
    return result.data ?? []
  })
}

function errorIsNetworkFailure(error) {
  const message = String(error?.message ?? '').toLowerCase()
  return /fetch|network|timeout|timed out/.test(message)
}
