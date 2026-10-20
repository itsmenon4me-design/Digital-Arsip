import { fetchAdminUserDirectory } from '../services/adminService.js'
import { getReadCache } from '../services/readCache.js'
import { renderTableSkeleton } from '../components/tableSkeleton.js'

function createRetryButton(onRetry) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'button button-outline'
  button.textContent = 'Coba lagi'
  button.addEventListener('click', onRetry)
  return button
}

function getRoleLabel(role) {
  if (role === 'admin') return 'Admin'
  if (role === 'petugas_arsip') return 'Petugas'
  return 'Tidak tersedia'
}

export function createAccessManagementPage({ role, roleLoaded = false } = {}) {
  const root = document.createElement('div')
  root.className = 'reference-page access-page'

  const heading = document.createElement('section')
  heading.className = 'page-heading'
  const copy = document.createElement('div')
  const kicker = document.createElement('p')
  kicker.className = 'section-kicker'
  kicker.textContent = 'ADMINISTRASI AKUN'
  const title = document.createElement('h2')
  title.textContent = 'Hak Akses'
  const description = document.createElement('p')
  description.textContent = 'Daftar baca-saja profil dan status akun pengguna.'
  copy.append(kicker, title, description)
  heading.append(copy)

  const panel = document.createElement('section')
  panel.className = 'panel reference-panel'
  const panelTitle = document.createElement('h2')
  panelTitle.textContent = 'Pengguna terdaftar'
  const state = document.createElement('div')
  state.className = 'data-state table-state'
  state.setAttribute('role', 'status')
  const tableContainer = document.createElement('div')
  tableContainer.className = 'table-scroll'
  tableContainer.hidden = true
  const table = document.createElement('table')
  table.className = 'archive-table admin-user-table'
  table.setAttribute('aria-label', 'Daftar pengguna')
  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')
  ;['Email', 'Peran', 'Status', 'Dibuat'].forEach((label) => {
    const cell = document.createElement('th')
    cell.scope = 'col'
    cell.textContent = label
    headerRow.append(cell)
  })
  thead.append(headerRow)
  const tbody = document.createElement('tbody')
  table.append(thead, tbody)
  tableContainer.append(table)
  panel.append(panelTitle, state, tableContainer)
  root.append(heading, panel)

  let active = true
  let requestVersion = 0

  function showMessage(message, roleName = 'status', retry = false, preserveRecords = false) {
    panel.removeAttribute('aria-busy')
    state.replaceChildren()
    state.hidden = false
    state.className = 'data-state table-state'
    state.setAttribute('role', roleName)
    const text = document.createElement('p')
    text.textContent = message
    state.append(text)
    if (retry) state.append(createRetryButton(load))
    tableContainer.hidden = !preserveRecords
  }

  function showLoadingSkeleton() {
    panel.setAttribute('aria-busy', 'true')
    state.className = 'visually-hidden'
    state.setAttribute('role', 'status')
    state.textContent = 'Memuat daftar pengguna.'
    state.hidden = false
    renderTableSkeleton(tbody, headerRow.childElementCount)
    tableContainer.hidden = false
  }

  function renderRecords(records) {
    panel.removeAttribute('aria-busy')
    tbody.replaceChildren()
    if (!records.length) {
      showMessage('Belum ada profil pengguna yang tersedia.')
      return
    }

    records.forEach((record) => {
      const row = document.createElement('tr')
      ;[
        record.email,
        getRoleLabel(record.role),
        record.status,
        record.created_at
          ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(record.created_at))
          : null,
      ].forEach((value) => {
        const cell = document.createElement('td')
        cell.textContent = value ?? 'Tidak tersedia'
        row.append(cell)
      })
      tbody.append(row)
    })
    state.replaceChildren()
    state.hidden = true
    tableContainer.hidden = false
  }

  async function load() {
    if (!roleLoaded) {
      showLoadingSkeleton()
      return
    }
    if (role !== 'admin') {
      panel.removeAttribute('aria-busy')
      showMessage('Anda tidak memiliki akses untuk melihat daftar pengguna.', 'alert')
      return
    }

    const request = ++requestVersion
    const cached = getReadCache('admin-users')
    if (cached) renderRecords(cached)
    else showLoadingSkeleton()
    try {
      const records = await fetchAdminUserDirectory()
      if (!active || request !== requestVersion) return
      renderRecords(records)
    } catch (error) {
      if (!active || request !== requestVersion) return
      panel.removeAttribute('aria-busy')
      console.error('Gagal memuat daftar pengguna:', error)
      showMessage(error.message, 'alert', true, Boolean(cached))
    }
  }

  load()

  return {
    element: root,
    destroy() {
      active = false
      requestVersion += 1
    },
  }
}
