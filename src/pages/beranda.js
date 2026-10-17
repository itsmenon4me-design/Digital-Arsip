import {
  fetchArchiveCategories,
  fetchArchiveDetail,
  fetchRecentArchives,
} from '../services/arsipService.js'
import { fetchDashboardStats, formatStorageBytes } from '../services/statService.js'
import { createStatCards } from '../components/statCards.js'
import { createArsipTable } from '../components/arsipTable.js'
import { createDropzone } from '../components/dropzone.js'
import { createDetailPanel } from '../components/detailPanel.js'
import { createUploadModal } from '../components/uploadModal.js'
import { getReadCache } from '../services/readCache.js'
import { createArchiveMutationDialogs } from '../components/archiveMutationDialogs.js'
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
  const canDelete = role === 'admin'
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
  grid.className = 'dashboard-grid'

  let mutations
  const detail = createDetailPanel({
    onEdit: canManage ? (archive) => mutations?.openEdit(archive) : null,
    onDelete: canDelete ? (archive) => mutations?.openDelete(archive) : null,
  })
  let table
  let active = true
  let categoriesLoaded = false
  let categoriesRequest = null
  let categoriesGeneration = 0
  let search = ''
  let archiveRequest = 0
  let detailRequest = 0

  async function selectArchive(id) {
    const request = ++detailRequest
    if (!id) {
      detail.render(null)
      return
    }

    const cached = getReadCache('archive-detail', id)
    if (cached) detail.render(cached)
    else detail.showLoading()
    try {
      const record = await fetchArchiveDetail(id)
      if (active && request === detailRequest) detail.render(record)
    } catch (error) {
      if (active && request === detailRequest) {
        console.error('Gagal memuat detail arsip:', error)
        detail.showError()
      }
    }
  }

  function invalidateCategories() {
    categoriesLoaded = false
    categoriesRequest = null
    categoriesGeneration += 1
  }

  function loadCategories() {
    if (categoriesLoaded) return Promise.resolve()
    const cachedCategories = getReadCache('archive-categories')
    if (cachedCategories) {
      table.setCategories(cachedCategories)
      categoriesLoaded = true
      return Promise.resolve()
    }
    if (!categoriesRequest) {
      const generation = categoriesGeneration
      categoriesRequest = fetchArchiveCategories()
        .then((categories) => {
          if (active && generation === categoriesGeneration) {
            table.setCategories(categories)
            categoriesLoaded = true
          }
          return categories
        })
        .catch((error) => {
          if (generation === categoriesGeneration) categoriesRequest = null
          throw error
        })
    }
    return categoriesRequest
  }

  async function loadArchives() {
    const request = ++archiveRequest
    const { category, status } = table.getFilters()
    const filters = { category, status, search }
    const cachedRecords = getReadCache('recent-archives', filters)
    if (cachedRecords) {
      table.setRecords(cachedRecords, { searchActive: Boolean(search) })
    } else {
      table.showLoading()
    }

    let categoryError = ''
    let archiveError = ''
    let recordsDisplayed = Boolean(cachedRecords)
    const categoriesTask = loadCategories().catch((error) => {
      if (!active || request !== archiveRequest) return
      categoryError = error.message
      console.error('Gagal memuat kategori arsip:', error)
    })

    try {
      const records = await fetchRecentArchives(filters)
      if (active && request === archiveRequest) {
        table.setRecords(records, { searchActive: Boolean(search) })
        recordsDisplayed = true
        if (categoryError) table.showError(categoryError, { preserveRecords: true })
      }
    } catch (error) {
      if (active && request === archiveRequest) {
        archiveError = error.message
        table.showError(archiveError, { preserveRecords: recordsDisplayed })
      }
    }
    await categoriesTask
    if (active && request === archiveRequest && (categoryError || archiveError)) {
      table.showError(
        [archiveError, categoryError].filter(Boolean).join(' '),
        { preserveRecords: recordsDisplayed },
      )
    }
  }

  table = createArsipTable({
    onFilter: loadArchives,
    onSelect: selectArchive,
    onRetry: loadArchives,
  })

  mutations = createArchiveMutationDialogs({
    onUpdated(record) {
      table.updateRecord(record.id, record)
      detail.render(record)
    },
    async onDeleted(id) {
      table.removeRecord(id)
      detail.render(null)
      invalidateCategories()
      await Promise.allSettled([loadStats(), loadArchives()])
      detail.focusHeading()
    },
  })

  const uploadModal = createUploadModal({
    onComplete: async () => {
      invalidateCategories()
      await Promise.allSettled([loadStats(), loadArchives()])
    },
  })
  const openUpload = (event) => uploadModal.open(event.detail?.file ?? null)
  window.addEventListener('archive-upload-request', openUpload)

  const rightColumn = document.createElement('div')
  rightColumn.className = 'dashboard-side-column'
  const dropzone = createDropzone({ onUpload: (file) => uploadModal.open(file) })
  dropzone.hidden = !canManage
  rightColumn.append(
    dropzone,
    detail.element,
  )
  grid.append(table.element, rightColumn)
  root.append(heading, stats.element, grid)

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
      detailRequest += 1
      window.removeEventListener('archive-search', onSearch)
      window.removeEventListener('archive-upload-request', openUpload)
      uploadModal.destroy()
      mutations.destroy()
    },
  }
}
