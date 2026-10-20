import {
  fetchArchiveDetail,
  fetchDestroyedArchivePage,
  fetchRetentionPage,
} from '../services/arsipService.js'
import { createArsipTable } from '../components/arsipTable.js'
import { createDetailPanel } from '../components/detailPanel.js'
import { createArchiveMutationDialogs } from '../components/archiveMutationDialogs.js'
import { createArchiveWorkflowDialogs } from '../components/archiveWorkflowDialogs.js'
import { getReadCache } from '../services/readCache.js'

export function createRetentionSchedulePage() {
  const root = document.createElement('div')
  root.className = 'reference-page retention-page'

  const heading = document.createElement('section')
  heading.className = 'page-heading'
  const copy = document.createElement('div')
  const kicker = document.createElement('p')
  kicker.className = 'section-kicker'
  kicker.textContent = 'PENGELOLAAN RETENSI'
  const title = document.createElement('h2')
  title.textContent = 'Jadwal Retensi'
  const description = document.createElement('p')
  description.textContent = 'Tinjau arsip yang sudah melewati tanggal retensi sebelum pemusnahan.'
  copy.append(kicker, title, description)
  heading.append(copy)

  let active = true
  let archiveRequest = 0
  let destroyedRequest = 0
  let detailRequest = 0
  let currentPage = 1
  let destroyedPage = 1
  let mutations
  let workflows
  const detail = createDetailPanel({
    onEdit: (archive) => mutations?.openEdit(archive),
    onDelete: (archive) => mutations?.openDelete(archive),
    onVerify: (archive) => workflows?.openReview(archive),
    onDestroy: (archive) => workflows?.openDestruction(archive),
  })
  detail.element.hidden = true
  const grid = document.createElement('div')
  grid.className = 'archive-list-grid'
  const table = createArsipTable({
    titleText: 'Arsip melewati masa retensi',
    showFilters: false,
    showClassification: true,
    showPagination: true,
    dateField: 'tanggal_retensi',
    dateHeading: 'Batas retensi',
    emptyTitle: 'Tidak ada arsip yang jatuh tempo',
    emptyDescription: 'Arsip yang melewati tanggal retensi akan muncul di sini untuk ditinjau admin.',
    onPageChange: (page) => loadArchives(page),
    onSelect: (id) => selectArchive(id),
    onRetry: () => loadArchives(currentPage),
  })
  const destroyedTable = createArsipTable({
    titleText: 'Riwayat arsip dimusnahkan',
    showFilters: false,
    showClassification: true,
    showPagination: true,
    dateField: 'tanggal_pemusnahan',
    dateHeading: 'Dimusnahkan',
    emptyTitle: 'Belum ada arsip dimusnahkan',
    emptyDescription: 'Arsip yang dimusnahkan akan tercatat di sini bersama metadata dan berita acaranya.',
    onPageChange: (page) => loadDestroyedArchives(page),
    onSelect: (id) => selectArchive(id),
    onRetry: () => loadDestroyedArchives(destroyedPage),
  })
  grid.append(table.element, detail.element)
  root.append(heading, grid, destroyedTable.element)

  mutations = createArchiveMutationDialogs({
    onUpdated(record) {
      table.updateRecord(record.id, record)
      detail.render(record)
    },
    async onDeleted(id) {
      table.removeRecord(id)
      detail.render(null)
      await loadArchives(Math.min(currentPage, table.getPageCount()))
      detail.focusHeading()
    },
  })
  workflows = createArchiveWorkflowDialogs({
    onReviewed(record) {
      table.updateRecord(record.id, record)
      detail.render(record)
    },
    async onDestroyed(record) {
      table.removeRecord(record.id)
      detail.render(null)
      await loadArchives(Math.min(currentPage, table.getPageCount()))
      await loadDestroyedArchives(destroyedPage)
      detail.focusHeading()
    },
  })

  async function loadArchives(page = 1) {
    currentPage = page
    const request = ++archiveRequest
    const pageOptions = { page, pageSize: table.pageSize }
    const cachedResult = getReadCache('retention-page', pageOptions)
    if (cachedResult) {
      table.setRecords(cachedResult.records, {
        total: cachedResult.total,
        page: cachedResult.page,
      })
    } else {
      table.showLoading()
    }
    try {
      const result = await fetchRetentionPage(pageOptions)
      if (!active || request !== archiveRequest) return
      table.setRecords(result.records, {
        total: result.total,
        page: result.page,
      })
    } catch (error) {
      if (!active || request !== archiveRequest) return
      console.error('Gagal memuat arsip mendekati masa retensi:', error)
      table.showError(error.message, { preserveRecords: Boolean(cachedResult) })
    }
  }

  async function loadDestroyedArchives(page = 1) {
    destroyedPage = page
    const request = ++destroyedRequest
    const pageOptions = { page, pageSize: destroyedTable.pageSize }
    const cachedResult = getReadCache('destroyed-archive-page', pageOptions)
    if (cachedResult) {
      destroyedTable.setRecords(cachedResult.records, {
        total: cachedResult.total,
        page: cachedResult.page,
      })
    } else {
      destroyedTable.showLoading()
    }
    try {
      const result = await fetchDestroyedArchivePage(pageOptions)
      if (!active || request !== destroyedRequest) return
      destroyedTable.setRecords(result.records, {
        total: result.total,
        page: result.page,
      })
    } catch (error) {
      if (!active || request !== destroyedRequest) return
      console.error('Gagal memuat riwayat pemusnahan arsip:', error)
      destroyedTable.showError(error.message, { preserveRecords: Boolean(cachedResult) })
    }
  }

  async function selectArchive(id) {
    const request = ++detailRequest
    detail.element.hidden = !id
    grid.classList.toggle('has-selected-archive', Boolean(id))
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
      if (!active || request !== detailRequest) return
      console.error('Gagal memuat detail arsip:', error)
      detail.showError()
    }
  }

  const onUploadComplete = () => loadArchives(currentPage)
  window.addEventListener('archive-upload-complete', onUploadComplete)
  loadArchives()
  loadDestroyedArchives()

  return {
    element: root,
    destroy() {
      active = false
      archiveRequest += 1
      destroyedRequest += 1
      detailRequest += 1
      window.removeEventListener('archive-upload-complete', onUploadComplete)
      table.destroy()
      destroyedTable.destroy()
      mutations.destroy()
      workflows.destroy()
    },
  }
}
