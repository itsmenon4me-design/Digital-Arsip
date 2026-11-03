import { supabase } from '../lib/supabase.js'
import { clearReadCache, getReadCache, loadReadRequest, setReadCache } from './readCache.js'

const ARCHIVE_SELECT =
  'id, nomor_arsip, judul, kategori, status, unit_pencipta, masa_retensi_tahun, tanggal_retensi, tingkat_akses, file_path, nama_berkas, ukuran_file, tipe_file, file_status, created_at, tanggal_publikasi, kanal_publikasi, nama_kegiatan, jenis_konten, penulis, tautan_publikasi, kata_kunci, klasifikasi(nama)'

const MAX_ARCHIVE_FILE_BYTES = 50 * 1024 * 1024
export const ARCHIVE_CONTENT_TYPES = [
  'siaran pers',
  'berita',
  'foto kegiatan',
  'video',
  'infografis',
  'postingan media sosial',
  'lainnya',
]
let classificationManagementAvailable = null
let classificationDeletionAvailable = null
const FILE_TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  png: 'image/png',
  mp4: 'video/mp4',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

function requireClient() {
  if (!supabase) throw new Error('Koneksi aplikasi belum dikonfigurasi.')
}

function notifyArchiveDataUpdated() {
  window.dispatchEvent(new Event('archive-data-updated'))
}

function jakartaDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function isRetentionDue(date) {
  return Boolean(date && date <= jakartaDateString())
}

function quotePostgrestValue(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}

function friendlyReadError(error, resource) {
  const code = String(error?.code ?? '').toLowerCase()
  const message = String(error?.message ?? '').toLowerCase()
  const details = [message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const publicationColumns = ['jenis_konten', 'penulis', 'tautan_publikasi', 'kata_kunci', 'tipe_file']
  if (
    (code === '42703' || code === 'pgrst204')
    && publicationColumns.some((column) => details.includes(column))
  ) {
    return 'Metadata publikasi belum tersedia. Minta administrator menerapkan migration 20261103180000_publication_metadata.sql, lalu coba lagi.'
  }
  if (code === 'pgrst202' && message.includes('search_arsip_by_publication')) {
    return 'Pencarian publikasi belum tersedia. Minta administrator menerapkan migration 20261103180000_publication_metadata.sql, lalu coba lagi.'
  }
  if (code === '42703' || code === 'pgrst204') {
    if (resource === 'arsip klasifikasi') {
      return 'Struktur data arsip belum diperbarui. Minta administrator memeriksa migrasi SQL 015 dan 016, lalu coba lagi.'
    }
    return resource === 'kategori' || resource === 'arsip'
      ? 'Struktur data arsip belum diperbarui. Minta administrator memeriksa migrasi SQL 014 dan 015, lalu coba lagi.'
      : 'Struktur data klasifikasi belum diperbarui. Minta administrator memeriksa migrasi SQL 017, lalu coba lagi.'
  }
  if (resource === 'arsip klasifikasi' && code === 'pgrst200') {
    return 'Relasi arsip dan klasifikasi belum terbaca oleh API Supabase. Minta administrator memeriksa relasi database dan cache skema.'
  }
  if (code === '42501' || message.includes('row-level security') || message.includes('permission denied')) {
    return `Akun Anda tidak memiliki izin untuk membaca ${resource}. Minta administrator memeriksa hak akses, lalu coba lagi.`
  }
  if (error instanceof TypeError || /fetch|network|timeout|timed out/.test(message)) {
    return `Koneksi ke layanan ${resource} terganggu. Periksa jaringan, lalu coba lagi.`
  }
  return `Daftar ${resource} gagal dimuat. Periksa koneksi dan hak akses, lalu coba lagi.`
}

function isMissingClassificationActiveColumn(error) {
  const code = String(error?.code ?? '').toLowerCase()
  const message = String(error?.message ?? '').toLowerCase()
  return code === '42703'
    || code === 'pgrst204'
    || (message.includes('aktif') && (message.includes('column') || message.includes('schema cache')))
}

function isMissingArchiveClassificationRelationship(error) {
  const code = String(error?.code ?? '').toLowerCase()
  const message = String(error?.message ?? '').toLowerCase()
  return code === 'pgrst200'
    || message.includes('relationship')
    || message.includes('foreign key')
}

export function escapeIlikeValue(value) {
  return quotePostgrestValue(value.replace(/([%_\\])/g, '\\$1'))
}

function normalizeKeywords(value) {
  const keywords = Array.isArray(value)
    ? value
    : String(value ?? '').split(',')
  return [...new Set(keywords.map((keyword) => String(keyword).trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'id'))
}

function archiveSearchQuery(search, options) {
  return search
    ? supabase
        .rpc('search_arsip_by_publication', { p_search: search })
        .select(ARCHIVE_SELECT, options)
    : supabase.from('arsip').select(ARCHIVE_SELECT, options)
}

export function fetchArchiveCategories() {
  requireClient()
  return loadReadRequest('archive-categories', null, async () => {
    let result
    try {
      result = await supabase
        .from('arsip')
        .select('kategori')
        .not('kategori', 'is', null)
        .eq('file_status', 'tersedia')
        .is('deleted_at', null)
        .order('kategori')
        .limit(1000)
    } catch (error) {
      throw new Error(friendlyReadError(error, 'kategori'))
    }

    if (result.error) {
      throw new Error(friendlyReadError(result.error, 'kategori'))
    }

    return [...new Set((result.data ?? []).map((row) => row.kategori).filter(Boolean))]
  })
}

export function fetchClassifications({ includeInactive = false } = {}) {
  requireClient()
  const cacheParams = includeInactive ? { includeInactive: true } : null
  const cached = getReadCache('classifications', cacheParams)
  if (cached) return cached

  return loadReadRequest('classifications', cacheParams, async () => {
    let result
    try {
      if (classificationManagementAvailable === false) {
        result = await supabase
          .from('klasifikasi')
          .select('id, kode, nama, keterangan, arsip(count)')
          .order('kode')
      } else {
        let query = supabase
          .from('klasifikasi')
          .select('id, kode, nama, keterangan, aktif, arsip(count)')
          .order('kode')
        if (!includeInactive) query = query.eq('aktif', true)
        result = await query

        if (result.error && isMissingClassificationActiveColumn(result.error)) {
          classificationManagementAvailable = false
          result = await supabase
            .from('klasifikasi')
            .select('id, kode, nama, keterangan, arsip(count)')
            .order('kode')
        } else if (!result.error) {
          classificationManagementAvailable = true
        }
      }
    } catch (error) {
      throw new Error(friendlyReadError(error, 'klasifikasi'))
    }

    if (result.error) {
      throw new Error(friendlyReadError(result.error, 'klasifikasi'))
    }
    return (result.data ?? []).map((item) => ({
      ...item,
      keterangan: item.keterangan ?? '',
      aktif: item.aktif ?? true,
      jumlah_arsip: Array.isArray(item.arsip)
        ? Number(item.arsip[0]?.count ?? 0)
        : Number(item.arsip?.count ?? 0),
    }))
  })
}

export async function fetchClassificationArchives({
  classificationId,
  page = 1,
  pageSize = 12,
} = {}) {
  requireClient()
  if (!classificationId) throw new Error('Pilih klasifikasi untuk melihat daftar arsip.')

  const safePage = Math.max(1, Math.floor(page))
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)))
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1
  const cacheParams = { classificationId, page: safePage, pageSize: safePageSize }
  const cached = getReadCache('classification-archives', cacheParams)
  if (cached) return cached

  let result
  try {
    result = await supabase
      .from('arsip')
      .select(ARCHIVE_SELECT, { count: 'exact' })
      .eq('klasifikasi_id', classificationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(from, to)
  } catch (error) {
    throw new Error(friendlyReadError(error, 'arsip klasifikasi'))
  }
  if (result.error) throw new Error(friendlyReadError(result.error, 'arsip klasifikasi'))

  const archives = {
    records: result.data ?? [],
    total: result.count ?? 0,
    page: safePage,
    pageSize: safePageSize,
  }
  setReadCache('classification-archives', cacheParams, archives)
  return archives
}

export function isClassificationManagementAvailable() {
  return classificationManagementAvailable !== false
}

export async function fetchClassificationUsage() {
  requireClient()
  let result
  try {
    result = await supabase.rpc('admin_list_classification_usage')
  } catch (error) {
    classificationDeletionAvailable = false
    console.error('RPC penggunaan klasifikasi gagal:', error)
    throw new Error('Status penggunaan klasifikasi belum dapat diperiksa. Penghapusan permanen dinonaktifkan.')
  }
  if (result.error) {
    classificationDeletionAvailable = false
    console.error('RPC penggunaan klasifikasi gagal:', result.error)
    if (String(result.error.code ?? '').toUpperCase() === 'PGRST202') {
      throw new Error('Pemeriksaan penggunaan belum tersedia. Minta administrator menerapkan migrasi SQL 018.')
    }
    throw new Error('Status penggunaan klasifikasi gagal dimuat. Penghapusan permanen dinonaktifkan.')
  }
  if (!Array.isArray(result.data)) {
    classificationDeletionAvailable = false
    throw new Error('Status penggunaan klasifikasi tidak valid. Penghapusan permanen dinonaktifkan.')
  }

  classificationDeletionAvailable = true
  return result.data
}

export function isClassificationDeletionAvailable() {
  return classificationDeletionAvailable === true
}

function classificationMutationError(error, rpcName = '') {
  const code = String(error?.code ?? '').toUpperCase()
  const message = String(error?.message ?? '').toLowerCase()
  if (code === '42501' || message.includes('permission denied') || message.includes('row-level security')) {
    return 'Anda tidak memiliki izin administrator untuk mengelola klasifikasi.'
  }
  if (code === 'PGRST202') {
    if (rpcName === 'admin_save_classification_details') {
      return 'Fitur detail klasifikasi belum tersedia. Minta administrator menerapkan migrasi SQL 019.'
    }
    if (rpcName === 'admin_delete_classification') {
      return 'Penghapusan klasifikasi belum tersedia. Minta administrator menerapkan migrasi SQL 018.'
    }
    return 'Fitur pengelolaan klasifikasi belum tersedia. Minta administrator menerapkan migrasi SQL 017.'
  }
  if (code === '23503' && message.includes('dipakai oleh arsip')) {
    return 'Klasifikasi ini masih digunakan oleh arsip dan tidak dapat dihapus. Nonaktifkan jika tidak ingin dipakai lagi.'
  }
  if (code === '23505') {
    return message.includes('nama klasifikasi')
      || message.includes('klasifikasi_nama_normalized_uidx')
      ? 'Nama klasifikasi tersebut sudah digunakan. Gunakan nama yang berbeda.'
      : 'Kode klasifikasi tersebut sudah digunakan. Gunakan kode yang berbeda.'
  }
  if (code === 'P0002') return 'Klasifikasi tidak ditemukan. Muat ulang halaman, lalu coba lagi.'
  if (code === '22023') return error?.message || 'Periksa kembali kode dan nama klasifikasi.'
  if (error instanceof TypeError || /fetch|network|timeout|timed out/.test(message)) {
    return 'Koneksi terganggu. Periksa jaringan, lalu coba lagi.'
  }
  return 'Perubahan klasifikasi gagal disimpan. Coba lagi atau hubungi administrator.'
}

async function callClassificationMutation(rpcName, params) {
  requireClient()
  let result
  try {
    result = await supabase.rpc(rpcName, params)
  } catch (error) {
    console.error(`RPC ${rpcName} gagal:`, error)
    throw new Error(classificationMutationError(error, rpcName))
  }
  if (result.error) {
    console.error(`RPC ${rpcName} gagal:`, result.error)
    throw new Error(classificationMutationError(result.error, rpcName))
  }
  if (!result.data || typeof result.data !== 'object') {
    throw new Error('Perubahan belum dapat dikonfirmasi. Muat ulang halaman sebelum mencoba lagi.')
  }

  clearReadCache()
  window.dispatchEvent(new Event('classifications-updated'))
  return result.data
}

export async function saveClassification({ id = null, nama, keterangan = '' }) {
  return callClassificationMutation('admin_save_classification_details', {
    p_id: id,
    p_nama: nama,
    p_keterangan: keterangan,
  })
}

export async function setClassificationActive(id, active) {
  return callClassificationMutation('admin_set_classification_active', {
    p_id: id,
    p_aktif: active,
  })
}

export async function deleteClassification(id) {
  return callClassificationMutation('admin_delete_classification', {
    p_id: id,
  })
}

export async function updateClassificationDescription(id, description) {
  requireClient()
  let result
  try {
    result = await supabase.rpc('admin_update_classification_description', {
      p_id: id,
      p_keterangan: description,
    })
  } catch (error) {
    console.error('RPC keterangan klasifikasi gagal:', error)
    throw new Error(classificationMutationError(error))
  }
  if (result.error) {
    console.error('RPC keterangan klasifikasi gagal:', result.error)
    throw new Error(classificationMutationError(result.error))
  }
  if (!result.data || typeof result.data !== 'object') {
    throw new Error('Keterangan belum dapat dikonfirmasi. Muat ulang halaman sebelum mencoba lagi.')
  }

  clearReadCache()
  window.dispatchEvent(new Event('classifications-updated'))
  return result.data
}

export async function fetchArchiveDetail(id) {
  requireClient()

  const joinedResult = await supabase
    .from('arsip')
    .select('*, klasifikasi(*)')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (!joinedResult.error) {
    setReadCache('archive-detail', id, joinedResult.data)
    return joinedResult.data
  }
  if (!isMissingArchiveClassificationRelationship(joinedResult.error)) {
    throw joinedResult.error
  }

  const archiveResult = await supabase
    .from('arsip')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (archiveResult.error) throw archiveResult.error

  const classificationResult = await supabase
    .from('klasifikasi')
    .select('*')
    .eq('id', archiveResult.data.klasifikasi_id)
    .maybeSingle()
  if (classificationResult.error) throw classificationResult.error

  const archive = {
    ...archiveResult.data,
    klasifikasi: classificationResult.data,
  }
  setReadCache('archive-detail', id, archive)
  return archive
}

export function validateArchiveFile(file) {
  if (!file) throw new Error('Pilih berkas yang akan diunggah.')
  if (file.size > MAX_ARCHIVE_FILE_BYTES) {
    throw new Error('Ukuran berkas melebihi batas 50 MB.')
  }

  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const expectedMime = FILE_TYPES[extension]
  if (!expectedMime || (file.type && file.type !== expectedMime)) {
    throw new Error(
      'Format berkas tidak didukung. Pilih PDF, JPG/JPEG, TIFF, PNG, MP4, Excel, Word, atau PowerPoint.',
    )
  }
  return expectedMime
}

function archiveMutationError(error) {
  const code = String(error?.code ?? '').toUpperCase()
  const message = String(error?.message ?? '').toLowerCase()
  if (code === '42501' || message.includes('permission denied') || message.includes('row-level security')) {
    return 'Anda tidak memiliki izin administrator untuk mengubah arsip.'
  }
  if (code === 'PGRST202') {
    return 'Fitur ini belum tersedia. Pastikan migration 20261103180000_publication_metadata.sql sudah diterapkan.'
  }
  if (code === '23514') {
    return 'Klasifikasi tidak aktif. Pilih klasifikasi aktif, lalu coba lagi.'
  }
  if (code === 'P0002') return 'Arsip tidak ditemukan atau sudah dihapus.'
  if (code === '22023') return error?.message || 'Periksa kembali isian yang dimasukkan.'
  if (error instanceof TypeError || /fetch|network|timeout|timed out/.test(message)) {
    return 'Koneksi terganggu. Periksa jaringan, lalu coba lagi.'
  }
  return 'Perubahan arsip gagal disimpan. Coba lagi atau hubungi administrator.'
}

function archiveAccessError(error) {
  if (String(error?.code ?? '').toUpperCase() === 'P0002') {
    return 'Arsip sudah dihapus dan tidak dapat dibuka atau diunduh. Muat ulang daftar arsip.'
  }
  return 'Berkas belum dibuka karena pencatatan audit gagal. Coba lagi atau hubungi administrator.'
}

export async function updateArchive({
  id,
  judul,
  klasifikasiId,
  unitPencipta,
  tingkatAkses,
  tanggalPublikasi = null,
  kanalPublikasi = '',
  namaKegiatan = '',
  jenisKonten = null,
  penulis = '',
  tautanPublikasi = '',
  kataKunci = [],
}) {
  requireClient()
  let result
  try {
    result = await supabase.rpc('admin_update_arsip_publication_v2', {
      p_id: id,
      p_judul: judul.trim(),
      p_klasifikasi_id: klasifikasiId,
      p_unit_pencipta: unitPencipta.trim(),
      p_tingkat_akses: tingkatAkses,
      p_tanggal_publikasi: tanggalPublikasi || null,
      p_kanal_publikasi: kanalPublikasi.trim(),
      p_nama_kegiatan: namaKegiatan.trim(),
      p_jenis_konten: jenisKonten || null,
      p_penulis: penulis.trim(),
      p_tautan_publikasi: tautanPublikasi.trim(),
      p_kata_kunci: normalizeKeywords(kataKunci),
    })
  } catch (error) {
    console.error('RPC edit arsip gagal:', error)
    throw new Error(archiveMutationError(error))
  }
  if (result.error) {
    console.error('RPC edit arsip gagal:', result.error)
    throw new Error(archiveMutationError(result.error))
  }
  if (!result.data || typeof result.data !== 'object') {
    throw new Error('Perubahan arsip belum dapat dikonfirmasi. Muat ulang daftar sebelum mencoba lagi.')
  }
  clearReadCache()
  notifyArchiveDataUpdated()
  return result.data
}

export async function reviewArchive({ id, result, note = '' }) {
  requireClient()
  let response
  try {
    response = await supabase.rpc('admin_review_archive', {
      p_id: id,
      p_result: result,
      p_note: note.trim(),
    })
  } catch (error) {
    console.error('RPC verifikasi arsip gagal:', error)
    throw new Error(archiveMutationError(error))
  }
  if (response.error) {
    console.error('RPC verifikasi arsip gagal:', response.error)
    throw new Error(archiveMutationError(response.error))
  }
  if (!response.data || typeof response.data !== 'object') {
    throw new Error('Hasil verifikasi belum dapat dikonfirmasi. Muat ulang daftar sebelum mencoba lagi.')
  }
  clearReadCache()
  notifyArchiveDataUpdated()
  return response.data
}

async function archiveFileExists(filePath) {
  const cleanPath = filePath.replace(/^\/+/, '')
  const separator = cleanPath.lastIndexOf('/')
  const folder = separator < 0 ? '' : cleanPath.slice(0, separator)
  const fileName = separator < 0 ? cleanPath : cleanPath.slice(separator + 1)
  let listResult
  try {
    listResult = await supabase.storage.from('arsip').list(folder, {
      limit: 100,
      search: fileName,
    })
  } catch (error) {
    console.error('Gagal memeriksa berkas Storage sebelum pemusnahan:', error)
    throw new Error('Status berkas di Storage belum dapat diperiksa. Muat ulang lalu coba lanjutkan lagi.')
  }
  if (listResult.error) {
    console.error('Gagal memeriksa berkas Storage sebelum pemusnahan:', listResult.error)
    throw new Error('Status berkas di Storage belum dapat diperiksa. Muat ulang lalu coba lanjutkan lagi.')
  }
  return (listResult.data ?? []).some((entry) => entry.name === fileName)
}

async function removeArchiveFileIfPresent(filePath, { force = false } = {}) {
  const cleanPath = filePath.replace(/^\/+/, '')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!force && !await archiveFileExists(cleanPath)) return

    let removeResult
    try {
      removeResult = await supabase.storage.from('arsip').remove([cleanPath])
    } catch (error) {
      console.error('Gagal menghapus berkas Storage setelah proses pemusnahan dimulai:', error)
      throw new Error('Pemusnahan sudah dimulai, tetapi berkas belum terhapus. Periksa izin Storage admin, lalu coba lagi.')
    }
    if (removeResult.error) {
      console.error('Gagal menghapus berkas Storage setelah proses pemusnahan dimulai:', removeResult.error)
      throw new Error(`Pemusnahan sudah dimulai, tetapi berkas belum terhapus: ${removeResult.error.message}`)
    }

    force = false
    await new Promise((resolve) => window.setTimeout(resolve, 300))
  }

  throw new Error('Pemusnahan sudah dimulai, tetapi berkas masih tercatat di Storage. Periksa izin hapus Storage untuk akun admin.')
}

export async function destroyRetentionArchive({ id, recordNumber, note = '' }) {
  requireClient()
  if (!recordNumber?.trim()) throw new Error('Nomor berita acara wajib diisi.')
  let beginResult
  try {
    beginResult = await supabase.rpc('admin_begin_archive_destruction', {
      p_id: id,
      p_berita_acara: recordNumber.trim(),
      p_catatan: note.trim(),
    })
  } catch (error) {
    console.error('RPC awal pemusnahan arsip gagal:', error)
    throw new Error(archiveMutationError(error))
  }
  if (beginResult.error) {
    console.error('RPC awal pemusnahan arsip gagal:', beginResult.error)
    throw new Error(archiveMutationError(beginResult.error))
  }
  if (!beginResult.data || typeof beginResult.data !== 'object') {
    throw new Error('Pemusnahan belum dapat dimulai. Muat ulang daftar sebelum mencoba lagi.')
  }

  const archive = beginResult.data
  clearReadCache()
  notifyArchiveDataUpdated()
  if (archive.file_path) {
    await removeArchiveFileIfPresent(archive.file_path)
  }

  let completeResult
  try {
    completeResult = await supabase.rpc('admin_complete_archive_destruction', {
      p_id: id,
    })
  } catch (error) {
    console.error('RPC penyelesaian pemusnahan arsip gagal:', error)
    throw new Error(`Berkas sudah dihapus, tetapi pencatatan pemusnahan belum selesai: ${error.message || 'kesalahan koneksi'}`)
  }
  if (completeResult.error) {
    console.error('RPC penyelesaian pemusnahan arsip gagal:', completeResult.error)
    const code = String(completeResult.error.code ?? '')
    const message = String(completeResult.error.message ?? '')
    if (archive.file_path
      && code === '22023'
      && message.toLowerCase().includes('berkas masih ada di storage')) {
      await removeArchiveFileIfPresent(archive.file_path, { force: true })
      try {
        completeResult = await supabase.rpc('admin_complete_archive_destruction', {
          p_id: id,
        })
      } catch (error) {
        console.error('RPC penyelesaian ulang pemusnahan arsip gagal:', error)
        throw new Error(`Berkas sudah dihapus, tetapi pencatatan pemusnahan belum selesai: ${error.message || 'kesalahan koneksi'}`)
      }
      if (!completeResult.error && completeResult.data && typeof completeResult.data === 'object') {
        clearReadCache()
        notifyArchiveDataUpdated()
        return completeResult.data
      }
      if (completeResult.error) {
        console.error('RPC penyelesaian ulang pemusnahan arsip gagal:', completeResult.error)
        const retryCode = String(completeResult.error.code ?? '')
        const retryMessage = String(completeResult.error.message ?? '')
        if (retryCode === '22023'
          && retryMessage.toLowerCase().includes('berkas masih ada di storage')) {
          throw new Error('Storage masih mendeteksi berkas. Pastikan migrasi 020_storage_destruction_visibility.sql sudah diterapkan, lalu coba lanjutkan pemusnahan lagi.')
        }
      }
    }
    const completionMessage = completeResult.error?.message
      || 'hasil pemusnahan belum dapat dikonfirmasi'
    throw new Error(`Berkas sudah dihapus, tetapi pencatatan pemusnahan belum selesai: ${completionMessage}`)
  }
  if (!completeResult.data || typeof completeResult.data !== 'object') {
    throw new Error('Berkas sudah dihapus, tetapi hasil pemusnahan belum dapat dikonfirmasi. Muat ulang daftar retensi untuk melanjutkan.')
  }
  clearReadCache()
  notifyArchiveDataUpdated()
  return completeResult.data
}

export async function permanentlyDeleteArchive(id) {
  requireClient()
  let result
  try {
    result = await supabase
      .from('arsip')
      .select('id, file_path')
      .eq('id', id)
      .maybeSingle()
  } catch (error) {
    console.error('Gagal membaca arsip sebelum penghapusan:', error)
    throw new Error(permanentDeleteError(error))
  }
  if (result.error) {
    console.error('Gagal membaca arsip sebelum penghapusan:', result.error)
    throw new Error(permanentDeleteError(result.error))
  }
  if (!result.data) {
    throw new Error('Arsip tidak ditemukan atau sudah tidak dapat diakses. Muat ulang daftar.')
  }

  if (!result.data.file_path) {
    throw new Error('Path berkas tidak tersedia. Data arsip tetap dipertahankan karena penghapusan Storage tidak dapat dipastikan.')
  }
  let storageResult
  try {
    storageResult = await supabase.storage
      .from('arsip')
      .remove([result.data.file_path])
  } catch (error) {
    console.error('Gagal menghapus berkas sebelum menghapus arsip:', error)
    throw new Error('Berkas gagal dihapus dari Storage. Data arsip tetap dipertahankan.')
  }
  if (storageResult.error) {
    console.error('Gagal menghapus berkas sebelum menghapus arsip:', storageResult.error)
    throw new Error(`Berkas gagal dihapus dari Storage. Data arsip tetap dipertahankan. ${storageResult.error.message}`)
  }
  if (!Array.isArray(storageResult.data) || storageResult.data.length === 0) {
    throw new Error('Berkas tidak ditemukan atau penghapusannya belum dapat dipastikan. Data arsip tetap dipertahankan.')
  }

  let deleteResult
  try {
    deleteResult = await supabase
      .from('arsip')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle()
  } catch (error) {
    console.error('Berkas sudah dihapus, tetapi arsip gagal dihapus dari database:', error)
    throw new Error(`Berkas sudah dihapus, tetapi arsip gagal dihapus dari database. ${permanentDeleteError(error)}`)
  }
  if (deleteResult.error) {
    console.error('Berkas sudah dihapus, tetapi arsip gagal dihapus dari database:', deleteResult.error)
    throw new Error(`Berkas sudah dihapus, tetapi arsip gagal dihapus dari database. ${permanentDeleteError(deleteResult.error)}`)
  }
  if (!deleteResult.data) {
    throw new Error('Berkas sudah dihapus, tetapi arsip tidak terhapus. Pastikan akun Anda admin dan muat ulang daftar.')
  }

  clearReadCache()
  notifyArchiveDataUpdated()
  return { storageDeleted: true }
}

function permanentDeleteError(error) {
  const code = String(error?.code ?? '').toUpperCase()
  const message = String(error?.message ?? '').toLowerCase()
  if (code === '42501' || message.includes('permission denied') || message.includes('row-level security')) {
    return 'Penghapusan ditolak. Hanya admin yang dapat menghapus arsip.'
  }
  if (error instanceof TypeError || /fetch|network|timeout|timed out/.test(message)) {
    return 'Koneksi terganggu sebelum arsip terhapus. Periksa jaringan, lalu coba lagi.'
  }
  return 'Arsip gagal dihapus dari database. File Storage tidak dihapus.'
}

function friendlyArchiveError(error, fallback) {
  const code = String(error?.code ?? '').toLowerCase()
  const message = String(error?.message ?? '').toLowerCase()
  if (code === '23505') return 'Nomor arsip sudah digunakan. Masukkan nomor arsip lain.'
  if (code === '23514') return 'Klasifikasi sudah dinonaktifkan. Pilih klasifikasi aktif, lalu coba lagi.'
  if (code === 'pgrst202' || code === 'pgrst204') {
    return 'Fitur arsip publikasi belum siap. Pastikan migration 20261103180000_publication_metadata.sql sudah diterapkan.'
  }
  if (code === '42501' || message.includes('row-level security') || message.includes('permission denied')) {
    return 'Akun Anda tidak memiliki izin untuk melakukan tindakan ini.'
  }
  if (code === '42703') {
    return 'Struktur data belum diperbarui. Minta administrator menjalankan migrasi SQL 006 terlebih dahulu.'
  }
  if (error instanceof TypeError || /fetch|network|timeout|timed out/.test(message)) {
    return 'Layanan tidak dapat dijangkau. Periksa koneksi internet lalu coba lagi.'
  }
  return fallback
}

export async function uploadArchive({ file, metadata }) {
  requireClient()
  const contentType = validateArchiveFile(file)
  if (!metadata.tanggalPublikasi || !metadata.kanalPublikasi?.trim()) {
    throw new Error('Tanggal publikasi dan kanal publikasi wajib diisi.')
  }
  if (!ARCHIVE_CONTENT_TYPES.includes(metadata.jenisKonten)) {
    throw new Error('Pilih jenis konten yang tersedia.')
  }
  const id = crypto.randomUUID()
  const extension = file.name.split('.').pop().toLowerCase()
  const filePath = `${id}/${id}.${extension}`
  let userData
  let userError
  try {
    ({ data: userData, error: userError } = await supabase.auth.getUser())
  } catch (error) {
    throw new Error(friendlyArchiveError(
      error,
      'Sesi masuk tidak dapat diperiksa. Masuk kembali sebelum mengunggah.',
    ))
  }
  if (userError || !userData.user) {
    throw new Error('Sesi masuk tidak tersedia. Masuk kembali sebelum mengunggah.')
  }

  const archiveRow = {
    id,
    nomor_arsip: metadata.nomorArsip.trim(),
    judul: metadata.judul.trim(),
    kategori: metadata.kategori.trim(),
    klasifikasi_id: metadata.klasifikasiId,
    unit_pencipta: 'Humas Polres Metro Bekasi Kota',
    masa_retensi_tahun: metadata.masaRetensiTahun,
    tanggal_retensi: metadata.tanggalRetensi,
    tanggal_publikasi: metadata.tanggalPublikasi || null,
    kanal_publikasi: metadata.kanalPublikasi?.trim() || null,
    nama_kegiatan: metadata.namaKegiatan?.trim() || null,
    jenis_konten: metadata.jenisKonten,
    penulis: metadata.penulis?.trim() || null,
    tautan_publikasi: metadata.tautanPublikasi?.trim() || null,
    kata_kunci: normalizeKeywords(metadata.kataKunci),
    tingkat_akses: metadata.tingkatAkses,
    file_path: filePath,
    nama_berkas: file.name,
    tipe_file: contentType,
    file_status: 'mengunggah',
    ukuran_file: file.size,
    diunggah_oleh: userData.user.id,
  }

  let insertResult
  try {
    insertResult = await supabase.from('arsip').insert(archiveRow)
  } catch (error) {
    throw new Error(friendlyArchiveError(error, 'Data arsip gagal disimpan. Periksa isian dan hak akses.'))
  }
  if (insertResult.error) {
    throw new Error(friendlyArchiveError(
      insertResult.error,
      'Data arsip gagal disimpan. Periksa isian dan hak akses.',
    ))
  }

  let uploadError = null
  try {
    const result = await supabase.storage.from('arsip').upload(filePath, file, {
      cacheControl: '3600',
      contentType,
      upsert: false,
    })
    uploadError = result.error
  } catch (error) {
    uploadError = error
  }

  if (uploadError) {
    let rollbackResult
    try {
      rollbackResult = await supabase.rpc('rollback_archive_upload', {
        p_archive_id: id,
      })
    } catch {
      throw new Error(
        `Unggah gagal dan rollback tidak berhasil. Baris arsip ${id} mungkin belum memiliki berkas; minta administrator memeriksanya sebelum mencoba ulang.`,
      )
    }

    if (rollbackResult.error || rollbackResult.data !== true) {
      throw new Error(
        `Unggah gagal dan rollback tidak berhasil. Baris arsip ${id} mungkin belum memiliki berkas; minta administrator memeriksanya sebelum mencoba ulang.`,
      )
    }
    throw new Error(friendlyArchiveError(
      uploadError,
      'Berkas gagal diunggah. Data metadata yang dibuat sementara sudah dibatalkan.',
    ))
  }

  let completionResult
  try {
    completionResult = await supabase.rpc('complete_archive_upload', {
      p_archive_id: id,
    })
  } catch {
    throw new Error(
      `Berkas sudah diunggah, tetapi statusnya belum dapat diselesaikan. Catat ID arsip ${id} dan hubungi administrator.`,
    )
  }

  if (completionResult.error || completionResult.data !== true) {
    throw new Error(
      `Berkas sudah diunggah, tetapi statusnya belum dapat diselesaikan. Catat ID arsip ${id} dan hubungi administrator.`,
    )
  }

  clearReadCache()
  notifyArchiveDataUpdated()
  return id
}

export async function createArchiveAccessUrl(archive, action, expiresIn = 60) {
  requireClient()
  if (!archive?.file_path || archive.file_status !== 'tersedia') {
    throw new Error('Berkas arsip belum tersedia.')
  }

  let signedResult
  try {
    signedResult = await supabase.storage
      .from('arsip')
      .createSignedUrl(
        archive.file_path,
        expiresIn,
        action === 'unduh' ? { download: archive.nama_berkas || true } : undefined,
      )
  } catch (error) {
    throw new Error(friendlyArchiveError(error, 'Berkas tidak dapat dibuka. Periksa izin atau hubungi administrator.'))
  }
  if (signedResult.error || !signedResult.data?.signedUrl) {
    throw new Error(friendlyArchiveError(
      signedResult.error,
      'Berkas tidak ditemukan atau akun Anda tidak memiliki izin untuk membukanya.',
    ))
  }

  let auditResult
  try {
    auditResult = await supabase.rpc('record_archive_access', {
      p_archive_id: archive.id,
      p_action: action,
    })
  } catch (error) {
    console.error('Pencatatan akses arsip gagal:', error)
    throw new Error(archiveAccessError(error))
  }
  if (auditResult.error) {
    console.error('Pencatatan akses arsip gagal:', auditResult.error)
    throw new Error(archiveAccessError(auditResult.error))
  }
  if (auditResult.data !== true) {
    throw new Error(archiveAccessError(null))
  }
  return signedResult.data.signedUrl
}

export function fetchRecentArchives({ category = '', status = '', search = '' } = {}) {
  requireClient()
  return loadReadRequest('recent-archives', { category, status, search }, async () => {
    let query = archiveSearchQuery(search)
      .eq('file_status', 'tersedia')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(10)

    if (category) query = query.eq('kategori', category)
    if (status) query = query.eq('status', status)

    let result
    try {
      result = await query
    } catch (error) {
      throw new Error(friendlyReadError(error, 'arsip'))
    }
    if (result.error) {
      throw new Error(friendlyReadError(result.error, 'arsip'))
    }

    return result.data ?? []
  })
}

export function fetchArchivePage({
  page = 1,
  pageSize = 20,
  category = '',
  status = '',
  search = '',
  classificationId = '',
  fromDate = '',
  toDate = '',
  publicationFromDate = '',
  publicationToDate = '',
  contentType = '',
  channel = '',
  unit = '',
} = {}) {
  requireClient()
  const requestParams = {
    page,
    pageSize,
    category,
    status,
    search,
    classificationId,
    fromDate,
    toDate,
    publicationFromDate,
    publicationToDate,
    contentType,
    channel,
    unit,
  }
  return loadReadRequest('archive-page', requestParams, async () => {
    const safePage = Math.max(1, Math.floor(page))
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)))
    const from = (safePage - 1) * safePageSize
    const to = from + safePageSize - 1
    let query = archiveSearchQuery(search, { count: 'exact' })
      .eq('file_status', 'tersedia')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(from, to)

    if (category) query = query.eq('kategori', category)
    if (status) query = query.eq('status', status)
    if (classificationId) query = query.eq('klasifikasi_id', classificationId)
    if (fromDate) query = query.gte('created_at', `${fromDate}T00:00:00Z`)
    if (toDate) {
      const until = new Date(`${toDate}T00:00:00Z`)
      until.setDate(until.getDate() + 1)
      query = query.lt('created_at', until.toISOString())
    }
    if (contentType) query = query.eq('jenis_konten', contentType)
    if (channel) {
      query = query.ilike('kanal_publikasi', `%${escapeIlikeValue(channel)}%`)
    }
    if (publicationFromDate) query = query.gte('tanggal_publikasi', publicationFromDate)
    if (publicationToDate) query = query.lte('tanggal_publikasi', publicationToDate)
    if (unit) query = query.eq('unit_pencipta', unit)

    let result
    try {
      result = await query
    } catch (error) {
      throw new Error(friendlyReadError(error, 'arsip'))
    }
    if (result.error) throw new Error(friendlyReadError(result.error, 'arsip'))

    return {
      records: result.data ?? [],
      total: result.count ?? 0,
      page: safePage,
      pageSize: safePageSize,
    }
  })
}

export function fetchRetentionPage({ page = 1, pageSize = 20 } = {}) {
  requireClient()
  return loadReadRequest('retention-page', { page, pageSize }, async () => {
    const dueDate = jakartaDateString()
    const safePage = Math.max(1, Math.floor(page))
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)))
    const from = (safePage - 1) * safePageSize
    const to = from + safePageSize - 1

    let result
    try {
      result = await supabase
        .from('arsip')
        .select(ARCHIVE_SELECT, { count: 'exact' })
        .is('deleted_at', null)
        .lte('tanggal_retensi', dueDate)
        .neq('file_status', 'dimusnahkan')
        .order('tanggal_retensi', { ascending: true })
        .range(from, to)
    } catch (error) {
      throw new Error(friendlyReadError(error, 'arsip yang melewati masa retensi'))
    }
    if (result.error) {
      throw new Error(friendlyReadError(result.error, 'arsip yang melewati masa retensi'))
    }

    return {
      records: result.data ?? [],
      total: result.count ?? 0,
      page: safePage,
      pageSize: safePageSize,
    }
  })
}

export async function fetchDestroyedArchivePage({ page = 1, pageSize = 20 } = {}) {
  requireClient()
  const safePage = Math.max(1, Math.floor(page))
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)))
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1

  let result
  try {
    result = await supabase
      .from('arsip')
      .select(ARCHIVE_SELECT, { count: 'exact' })
      .eq('file_status', 'dimusnahkan')
      .is('deleted_at', null)
      .order('tanggal_pemusnahan', { ascending: false })
      .range(from, to)
  } catch (error) {
    throw new Error(friendlyReadError(error, 'riwayat pemusnahan arsip'))
  }
  if (result.error) {
    throw new Error(friendlyReadError(result.error, 'riwayat pemusnahan arsip'))
  }

  const pageResult = {
    records: result.data ?? [],
    total: result.count ?? 0,
    page: safePage,
    pageSize: safePageSize,
  }
  setReadCache('destroyed-archive-page', { page: safePage, pageSize: safePageSize }, pageResult)
  return pageResult
}
