import { supabase, supabaseConfig } from '../lib/supabase.js'

function requireClient() {
  if (!supabase) {
    throw new Error('Koneksi aplikasi belum dikonfigurasi. Hubungi administrator.')
  }
}

function friendlyAuthError(error) {
  const code = String(error?.code ?? '').toLowerCase()
  const message = String(error?.message ?? '').toLowerCase()

  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'Email belum dikonfirmasi. Minta administrator memeriksa status akun Anda.'
  }

  if (
    code === 'invalid_credentials'
    || message.includes('invalid login credentials')
    || message.includes('invalid credentials')
  ) {
    return 'Email atau kata sandi tidak sesuai.'
  }

  if (error instanceof TypeError || /fetch|network|timeout|timed out/.test(message)) {
    return 'Tidak dapat terhubung ke layanan masuk. Periksa jaringan lalu coba lagi.'
  }

  return 'Proses masuk gagal. Periksa data Anda atau coba lagi beberapa saat.'
}

export async function getCurrentSession() {
  requireClient()
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error('Sesi tidak dapat diperiksa. Muat ulang halaman untuk mencoba lagi.')
  return data.session
}

export function subscribeToAuthState(callback) {
  requireClient()
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    queueMicrotask(() => callback(event, session))
  })
  return data.subscription
}

export async function signInWithPassword(email, password) {
  requireClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })

  if (error) throw new Error(friendlyAuthError(error))
  return data
}

export async function signOut() {
  requireClient()
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(friendlyAuthError(error))
}

export async function getProfile(userId) {
  requireClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('nama_lengkap, role')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.error('Profil akun gagal dibaca dari Supabase:', error)
    throw new Error('Profil akun gagal dibaca. Periksa koneksi atau kebijakan akses tabel profil.')
  }
  return data
}

export function getSupabaseConfigMessage() {
  if (supabaseConfig.invalidUrl) {
    return 'Alamat Supabase belum valid. Periksa konfigurasi Vite.'
  }

  if (supabaseConfig.missingEnvVars.length) {
    return `Konfigurasi belum lengkap: ${supabaseConfig.missingEnvVars.join(', ')}.`
  }

  return ''
}
