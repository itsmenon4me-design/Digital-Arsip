import { fetchAuditPage } from '../services/auditService.js'
import { getReadCache } from '../services/readCache.js'
import { renderTableSkeleton } from '../components/tableSkeleton.js'

const actionLabels = {
  unggah: 'Unggah',
  ubah: 'Ubah',
  hapus: 'Hapus',
  buka: 'Buka',
  unduh: 'Unduh',
  verifikasi: 'Verifikasi',
  pemusnahan: 'Pemusnahan',
}

const auditStatusLabels = {
  terverifikasi: 'terverifikasi',
  menunggu_verifikasi: 'menunggu verifikasi',
  perlu_perbaikan: 'perlu perbaikan',
  inaktif: 'inaktif',
  dimusnahkan: 'dimusnahkan',
}

function classificationName(detail) {
  return [detail?.kode, detail?.nama]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' · ')
}

function auditActivity(record) {
  const detail = record.detail ?? {}
  if (detail.entitas === 'klasifikasi') {
    if (detail.operasi === 'buat') return 'Klasifikasi ditambahkan'
    if (detail.operasi === 'hapus') return 'Klasifikasi dihapus'
    if (detail.operasi === 'aktifkan' || detail.operasi === 'nonaktifkan') {
      return 'Klasifikasi diperbarui'
    }
    return 'Klasifikasi diubah'
  }

  const labels = {
    unggah: 'Arsip diunggah',
    ubah: 'Arsip diubah',
    hapus: 'Arsip dihapus',
    buka: 'Arsip dibuka',
    unduh: 'Arsip diunduh',
    verifikasi: 'Arsip diverifikasi',
    pemusnahan: 'Pemusnahan arsip',
  }
  return labels[record.aksi] ?? 'Aktivitas arsip'
}

function auditArchiveNumber(record) {
  const number = record.detail?.nomor_arsip
  return typeof number === 'string' && number.trim() ? number : '—'
}

function auditSummary(record) {
  const detail = record.detail ?? {}
  if (detail.entitas === 'klasifikasi') {
    const name = classificationName(detail)
    const action = {
      buat: 'ditambahkan',
      hapus: 'dihapus',
      aktifkan: 'diaktifkan',
      nonaktifkan: 'dinonaktifkan',
    }[detail.operasi] ?? 'diperbarui'
    return name ? `${name} ${action}.` : `Klasifikasi ${action}.`
  }

  if (record.aksi === 'buka') return 'Berkas arsip dibuka.'
  if (record.aksi === 'unduh') return 'Berkas arsip diunduh.'
  if (record.aksi === 'verifikasi') {
    const status = auditStatusLabels[detail.hasil]
    return status
      ? `Status arsip diubah menjadi ${status}.`
      : 'Status arsip diverifikasi.'
  }
  if (record.aksi === 'pemusnahan') {
    return detail.tahap === 'selesai'
      ? 'Pemusnahan arsip diselesaikan.'
      : 'Proses pemusnahan arsip dimulai.'
  }
  if (record.aksi === 'unggah') return 'Arsip baru ditambahkan.'
  if (record.aksi === 'hapus') return 'Arsip dihapus.'
  if (record.aksi === 'ubah') return 'Informasi arsip diperbarui.'
  return 'Aktivitas tercatat.'
}

function makeFilter(labelText, name, type = 'text') {
  const label = document.createElement('label')
  label.className = 'audit-filter-field'
  const caption = document.createElement('span')
  caption.textContent = labelText
  let control
  if (type === 'select') {
    control = document.createElement('select')
    control.name = name
    const all = document.createElement('option')
    all.value = ''
    all.textContent = 'Semua aksi'
    control.append(all)
    Object.entries(actionLabels).forEach(([value, text]) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = text
      control.append(option)
    })
  } else {
    control = document.createElement('input')
    control.type = type
    control.name = name
  }
  label.append(caption, control)
  return { label, control }
}

function makeButton(text, className, onClick) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = text
  button.addEventListener('click', onClick)
  return button
}

export function createAuditLogPage({ role, roleLoaded = false } = {}) {
  const root = document.createElement('div')
  root.className = 'reference-page audit-page'

  const heading = document.createElement('section')
  heading.className = 'page-heading'
  const copy = document.createElement('div')
  const kicker = document.createElement('p')
  kicker.className = 'section-kicker'
  kicker.textContent = 'CATATAN AKTIVITAS'
  const title = document.createElement('h2')
  title.textContent = 'Log Audit'
  const description = document.createElement('p')
  description.textContent = 'Riwayat tindakan arsip yang dicatat oleh database.'
  copy.append(kicker, title, description)
  heading.append(copy)

  const form = document.createElement('form')
  form.className = 'audit-filter-form panel'
  const action = makeFilter('Aksi', 'action', 'select')
  const fromDate = makeFilter('Dari tanggal', 'fromDate', 'date')
  const toDate = makeFilter('Sampai tanggal', 'toDate', 'date')
  const filterActions = document.createElement('div')
  filterActions.className = 'audit-filter-actions'
  const applyButton = document.createElement('button')
  applyButton.type = 'submit'
  applyButton.className = 'button button-primary'
  applyButton.textContent = 'Terapkan'
  const resetButton = document.createElement('button')
  resetButton.type = 'reset'
  resetButton.className = 'button button-outline'
  resetButton.textContent = 'Reset'
  filterActions.append(applyButton, resetButton)
  form.append(action.label, fromDate.label, toDate.label, filterActions)

  const panel = document.createElement('section')
  panel.className = 'panel reference-panel'
  const panelTitle = document.createElement('h2')
  panelTitle.textContent = 'Catatan terbaru'
  const state = document.createElement('div')
  state.className = 'data-state table-state'
  state.setAttribute('role', 'status')
  const tableContainer = document.createElement('div')
  tableContainer.className = 'table-scroll'
  tableContainer.hidden = true
  const table = document.createElement('table')
  table.className = 'archive-table audit-table'
  table.setAttribute('aria-label', 'Log audit arsip')
  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')
  ;['Waktu', 'Aktivitas', 'Pengguna', 'Nomor arsip', 'Rincian'].forEach((label) => {
    const cell = document.createElement('th')
    cell.scope = 'col'
    cell.textContent = label
    headerRow.append(cell)
  })
  thead.append(headerRow)
  const tbody = document.createElement('tbody')
  table.append(thead, tbody)
  tableContainer.append(table)

  const pagination = document.createElement('div')
  pagination.className = 'archive-pagination'
  pagination.hidden = true
  const pageSummary = document.createElement('p')
  pageSummary.setAttribute('aria-live', 'polite')
  const pageActions = document.createElement('div')
  pageActions.className = 'archive-pagination-actions'
  const previousButton = makeButton('Sebelumnya', 'button button-outline', () => load(page - 1))
  const nextButton = makeButton('Berikutnya', 'button button-outline', () => load(page + 1))
  pageActions.append(previousButton, nextButton)
  pagination.append(pageSummary, pageActions)
  panel.append(panelTitle, state, tableContainer, pagination)
  root.append(heading, form, panel)

  const pageSize = 20
  let page = 1
  let total = 0
  let active = true
  let requestVersion = 0
  let currentFilters = { action: '', fromDate: '', toDate: '' }
  let loading = false

  function setLoading(isLoading) {
    loading = isLoading
    form.setAttribute('aria-busy', String(isLoading))
    applyButton.disabled = isLoading
    resetButton.disabled = isLoading
    const pageCount = Math.max(1, Math.ceil(total / pageSize))
    previousButton.disabled = isLoading || page <= 1
    nextButton.disabled = isLoading || page >= pageCount
  }

  function showMessage(message, roleName = 'status', retry = false, preserveTable = false) {
    state.replaceChildren()
    state.className = 'data-state table-state'
    state.hidden = false
    state.setAttribute('role', roleName)
    const text = document.createElement('p')
    text.textContent = message
    state.append(text)
    if (retry) state.append(makeButton('Coba lagi', 'button button-outline', () => load(page)))
    tableContainer.hidden = !preserveTable
    pagination.hidden = !preserveTable
  }

  function updatePagination() {
    const pageCount = Math.max(1, Math.ceil(total / pageSize))
    pageSummary.textContent = `Halaman ${page} dari ${pageCount}. Total ${new Intl.NumberFormat('id-ID').format(total)} catatan.`
    previousButton.disabled = page <= 1
    nextButton.disabled = page >= pageCount
    pagination.hidden = total === 0
  }

  function renderRecords(result) {
    total = result.total
    tbody.replaceChildren()
    if (!result.records.length) {
      showMessage('Belum ada catatan audit yang cocok dengan filter ini.')
      return
    }

    result.records.forEach((record) => {
      const row = document.createElement('tr')
      const time = document.createElement('td')
      time.textContent = record.waktu
        ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(record.waktu))
        : 'Tidak tersedia'
      const actionCell = document.createElement('td')
      actionCell.textContent = auditActivity(record)
      const user = document.createElement('td')
      user.textContent = record.user_id
        ? (role === 'admin' ? 'Admin' : 'Pengguna')
        : 'Tidak diketahui'
      const archive = document.createElement('td')
      archive.textContent = auditArchiveNumber(record)
      const detail = document.createElement('td')
      detail.className = 'audit-detail'
      detail.textContent = auditSummary(record)
      row.append(time, actionCell, user, archive, detail)
      tbody.append(row)
    })
    state.replaceChildren()
    state.hidden = true
    tableContainer.hidden = false
    updatePagination()
  }

  async function load(nextPage = 1, filters = currentFilters) {
    if (!active || loading) return
    if (!roleLoaded) {
      state.className = 'visually-hidden'
      state.textContent = 'Menyiapkan log audit.'
      state.hidden = false
      renderTableSkeleton(tbody, headerRow.childElementCount)
      tableContainer.hidden = false
      panel.setAttribute('aria-busy', 'true')
      return
    }
    if (role !== 'admin') {
      panel.removeAttribute('aria-busy')
      showMessage('Anda tidak memiliki akses untuk melihat log audit.', 'alert')
      return
    }

    currentFilters = { ...filters }
    page = Math.max(1, nextPage)
    const request = ++requestVersion
    if (currentFilters.fromDate && currentFilters.toDate && currentFilters.fromDate > currentFilters.toDate) {
      showMessage('Rentang tanggal tidak valid. Tanggal awal harus sama dengan atau sebelum tanggal akhir.', 'alert')
      return
    }

    const cacheParams = {
      page,
      pageSize,
      action: currentFilters.action,
      fromDate: currentFilters.fromDate,
      toDate: currentFilters.toDate,
    }
    const cached = getReadCache('audit-page', cacheParams)
    setLoading(!cached)
    if (cached) renderRecords(cached)
    else {
      panel.setAttribute('aria-busy', 'true')
      state.className = 'visually-hidden'
      state.textContent = 'Memuat log audit.'
      state.hidden = false
      renderTableSkeleton(tbody, headerRow.childElementCount)
      tableContainer.hidden = false
    }
    try {
      const result = await fetchAuditPage({
        ...currentFilters,
        page,
        pageSize,
      })
      if (!active || request !== requestVersion) return
      panel.removeAttribute('aria-busy')
      renderRecords(result)
    } catch (error) {
      if (!active || request !== requestVersion) return
      panel.removeAttribute('aria-busy')
      console.error('Gagal memuat log audit:', error)
      showMessage(error.message, 'alert', true, Boolean(cached))
    } finally {
      if (active && request === requestVersion) {
        panel.removeAttribute('aria-busy')
        setLoading(false)
      }
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    load(1, {
      action: action.control.value,
      fromDate: fromDate.control.value,
      toDate: toDate.control.value,
    })
  })
  form.addEventListener('reset', () => {
    window.setTimeout(() => {
      load(1, { action: '', fromDate: '', toDate: '' })
    }, 0)
  })

  load()

  return {
    element: root,
    destroy() {
      active = false
      requestVersion += 1
    },
  }
}
