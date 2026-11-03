import {
  fetchRecentArchives,
} from '../services/arsipService.js'
import { fetchDashboardStats, formatStorageBytes } from '../services/statService.js'
import { createStatCards } from '../components/statCards.js'
import { createArsipTable } from '../components/arsipTable.js'
import { createDropzone } from '../components/dropzone.js'
import { createUploadModal } from '../components/uploadModal.js'
import { getReadCache } from '../services/readCache.js'
import { canManageArchives } from '../services/accessControl.js'

function createDashboardHeader() {
  const header = document.createElement('section')
  header.className = 'page-heading'
  const copy = document.createElement('div')
  const kicker = document.createElement('p')
  kicker.className = 'section-kicker'
  kicker.textContent = 'PENGELOLAAN DOKUMEN INSTANSI'
  const title = document.createElement('h2')
  title.textContent = 'Ringkasan Arsip'
  const description = document.createElement('p')
  description.textContent = 'Pantau arsip, status verifikasi, dan masa retensi dalam satu tempat.'
  copy.append(kicker, title, description)
  header.append(copy)
  return header
}

export function createBerandaPage({ role = null } = {}) {
  const canManage = canManageArchives(role)
  const root = document.createElement('div')
  root.className = 'dashboard-page'
  const heading = createDashboardHeader()

  let stats
  async function loadStats() {
    const cached = getReadCache('dashboard-stats')
    if (cached) {
      stats.showData({
        ...cached,
        storage: formatStorageBytes(cached.storageBytes),
      })
    } else {
      stats.showLoading()
    }
    try {
      const result = await fetchDashboardStats()
      if (!active) return
      stats.showData({
        ...result,
        storage: formatStorageBytes(result.storageBytes),
      })
    } catch (error) {
      if (active) {
        if (cached) stats.showRefreshError(error.message)
        else stats.showError(error.message)
      }
    }
  }

  stats = createStatCards(loadStats, { showRetention: role === 'admin' })
  const grid = document.createElement('div')
  grid.className = 'dashboard-archive-grid'

  let table
  let active = true
  let search = ''
  let archiveRequest = 0

  async function loadArchives() {
    const request = ++archiveRequest
    const filters = { category: '', status: '', search }
    const cachedRecords = getReadCache('recent-archives', filters)
    if (cachedRecords) {
      table.setRecords(cachedRecords, { searchActive: Boolean(search) })
    } else {
      table.showLoading()
    }

    let recordsDisplayed = Boolean(cachedRecords)

    try {
      const records = await fetchRecentArchives(filters)
      if (active && request === archiveRequest) {
        table.setRecords(records, { searchActive: Boolean(search) })
        recordsDisplayed = true
      }
    } catch (error) {
      if (active && request === archiveRequest) {
        console.error('Gagal memuat arsip terbaru:', error)
        table.showError(error.message, { preserveRecords: recordsDisplayed })
      }
    }
  }

  table = createArsipTable({
    showFilters: false,
    selectable: false,
    onRetry: loadArchives,
  })

  const uploadModal = createUploadModal({
    onComplete: async () => Promise.allSettled([loadStats(), loadArchives()]),
  })
  const openUpload = (event) => uploadModal.open(event.detail?.file ?? null)
  window.addEventListener('archive-upload-request', openUpload)

  const dropzone = createDropzone({ onUpload: (file) => uploadModal.open(file) })
  dropzone.hidden = !canManage
  grid.append(table.element)
  root.append(heading, stats.element, dropzone, grid)

  const onSearch = (event) => {
    search = event.detail
    loadArchives()
  }
  window.addEventListener('archive-search', onSearch)
  loadStats()
  loadArchives()

  return {
    element: root,
    destroy() {
      active = false
      archiveRequest += 1
      window.removeEventListener('archive-search', onSearch)
      window.removeEventListener('archive-upload-request', openUpload)
      uploadModal.destroy()
    },
  }
}
