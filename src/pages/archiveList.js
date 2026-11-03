import {
  fetchArchiveCategories,
  fetchArchiveDetail,
  fetchArchivePage,
  fetchClassifications,
} from '../services/arsipService.js'
import { createArsipTable } from '../components/arsipTable.js'
import { createDetailPanel } from '../components/detailPanel.js'
import { createArchiveMutationDialogs } from '../components/archiveMutationDialogs.js'
import { createArchiveWorkflowDialogs } from '../components/archiveWorkflowDialogs.js'
import { getReadCache } from '../services/readCache.js'

export function createArchiveListPage({ role = null } = {}) {
  const canEdit = role === 'admin'
  const canDelete = role === 'admin'
  const canVerify = role === 'admin'
  const root = document.createElement('div')
  root.className = 'archive-list-page'

  const heading = document.createElement('section')
  heading.className = 'page-heading'
  const headingCopy = document.createElement('div')
  const eyebrow = document.createElement('p')
  eyebrow.className = 'section-kicker'
  eyebrow.textContent = 'PENELUSURAN ARSIP'
  const title = document.createElement('h2')
  title.textContent = 'Daftar Arsip'
  const description = document.createElement('p')
  description.textContent = 'Cari arsip berdasarkan nomor, judul, kegiatan, kanal publikasi, penulis, atau kata kunci. Gunakan filter jenis konten dan tanggal unggah atau publikasi.'
  headingCopy.append(eyebrow, title, description)
  heading.append(headingCopy)

  let active = true
  let requestVersion = 0
  let detailVersion = 0
  let categoriesLoaded = false
  let classificationsLoaded = false
  let categoriesRequest = null
  let classificationsRequest = null
  let categoriesGeneration = 0
  let classificationsGeneration = 0
  let currentFilters = { page: 1 }
  let mutations
  let grid
  const detail = createDetailPanel({
    onEdit: canEdit ? (archive) => mutations?.openEdit(archive) : null,
    onDelete: canDelete ? (archive) => mutations?.openDelete(archive) : null,
    onVerify: canVerify ? (archive) => workflows?.openReview(archive) : null,
  })
  let workflows
  const table = createArsipTable({
    titleText: 'Semua Arsip',
    showFilters: true,
    showAdvancedFilters: true,
    showSearch: true,
    showClassification: true,
    showPagination: true,
    onFilter: (filters) => loadArchives(filters),
    onPageChange: (page, filters) => loadArchives({ ...filters, page }),
    onSelect: (id) => selectArchive(id),
    onRetry: () => loadArchives(),
  })
  grid = document.createElement('div')
  grid.className = 'archive-list-grid'
  detail.element.hidden = true
  grid.append(table.element, detail.element)
  root.append(heading, grid)

  mutations = createArchiveMutationDialogs({
    onUpdated(record) {
      table.updateRecord(record.id, record)
      detail.render(record)
    },
    async onDeleted(id) {
      table.removeRecord(id)
      detail.render(null)
      invalidateFilterOptions()
      await loadArchives({ ...currentFilters, page: Math.min(currentFilters.page, table.getPageCount()) })
      detail.focusHeading()
    },
  })
  workflows = createArchiveWorkflowDialogs({
    onReviewed(record) {
      table.updateRecord(record.id, record)
      detail.render(record)
    },
  })

  function invalidateFilterOptions() {
    categoriesLoaded = false
    classificationsLoaded = false
    categoriesRequest = null
    classificationsRequest = null
    categoriesGeneration += 1
    classificationsGeneration += 1
  }

  function loadCategories() {
    if (categoriesLoaded) return Promise.resolve()
    const cached = getReadCache('archive-categories')
    if (cached) {
      table.setCategories(cached)
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

  function loadClassifications() {
    if (classificationsLoaded) return Promise.resolve()
    const classificationParams = { includeInactive: role === 'admin' }
    const cached = getReadCache('classifications', classificationParams)
    if (cached) {
      table.setClassifications(cached)
      classificationsLoaded = true
      return Promise.resolve()
    }
    if (!classificationsRequest) {
      const generation = classificationsGeneration
      classificationsRequest = fetchClassifications(classificationParams)
        .then((classifications) => {
          if (active && generation === classificationsGeneration) {
            table.setClassifications(classifications)
            classificationsLoaded = true
          }
          return classifications
        })
        .catch((error) => {
          if (generation === classificationsGeneration) classificationsRequest = null
          throw error
        })
    }
    return classificationsRequest
  }

  async function loadArchives(filters = currentFilters) {
    currentFilters = { ...currentFilters, ...filters }
    const request = ++requestVersion
    const pageOptions = {
      ...currentFilters,
      pageSize: table.pageSize,
    }
    const cacheParams = {
      page: pageOptions.page ?? 1,
      pageSize: pageOptions.pageSize,
      category: pageOptions.category ?? '',
      status: pageOptions.status ?? '',
      search: pageOptions.search ?? '',
      classificationId: pageOptions.classificationId ?? '',
      contentType: pageOptions.contentType ?? '',
      channel: pageOptions.channel ?? '',
      fromDate: pageOptions.fromDate ?? '',
      toDate: pageOptions.toDate ?? '',
      publicationFromDate: pageOptions.publicationFromDate ?? '',
      publicationToDate: pageOptions.publicationToDate ?? '',
      unit: pageOptions.unit ?? '',
    }
    const cachedResult = getReadCache('archive-page', cacheParams)
    const searchActive = Object.entries(currentFilters)
      .some(([key, value]) => key !== 'page' && Boolean(value))
    if (cachedResult) {
      table.setRecords(cachedResult.records, {
        total: cachedResult.total,
        page: cachedResult.page,
        searchActive,
      })
    } else {
      table.showLoading()
    }
    const invalidUploadDateRange = currentFilters.fromDate
      && currentFilters.toDate
      && currentFilters.fromDate > currentFilters.toDate
    const invalidPublicationDateRange = currentFilters.publicationFromDate
      && currentFilters.publicationToDate
      && currentFilters.publicationFromDate > currentFilters.publicationToDate
    if (invalidUploadDateRange || invalidPublicationDateRange) {
      table.showError('Rentang tanggal tidak valid. Tanggal mulai harus sama dengan atau sebelum tanggal akhir.')
      return
    }

    let pageRecordsDisplayed = Boolean(cachedResult)
    const filterPromise = Promise.allSettled([loadCategories(), loadClassifications()])
    let pageError = ''

    try {
      const result = await fetchArchivePage(pageOptions)
      if (!active || request !== requestVersion) return
      pageRecordsDisplayed = true
      table.setRecords(result.records, {
        total: result.total,
        page: result.page,
        searchActive,
      })
    } catch (error) {
      if (!active || request !== requestVersion) return
      console.error('Gagal memuat daftar arsip:', error)
      pageError = error.message
      table.showError(pageError, { preserveRecords: pageRecordsDisplayed })
    }

    const filterResults = await filterPromise
    if (!active || request !== requestVersion) return
    const filterErrors = filterResults
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason.message)
    if (filterErrors.length) {
      const message = [pageError, ...filterErrors].filter(Boolean).join(' ')
      table.showError(message, { preserveRecords: pageRecordsDisplayed })
    }
  }

  async function selectArchive(id) {
    const request = ++detailVersion
    detail.element.hidden = !id
    grid?.classList.toggle('has-selected-archive', Boolean(id))
    if (!id) {
      detail.render(null)
      return
    }

    const cached = getReadCache('archive-detail', id)
    if (cached) detail.render(cached)
    else detail.showLoading()
    try {
      const record = await fetchArchiveDetail(id)
      if (active && request === detailVersion) detail.render(record)
    } catch (error) {
      if (!active || request !== detailVersion) return
      console.error('Gagal memuat detail arsip:', error)
      detail.showError()
    }
  }

  const onGlobalSearch = (event) => table.setSearch(event.detail)
  const onUploadComplete = () => {
    invalidateFilterOptions()
    loadArchives({ page: 1 })
  }
  window.addEventListener('archive-search', onGlobalSearch)
  window.addEventListener('archive-upload-complete', onUploadComplete)
  loadArchives()

  return {
    element: root,
    destroy() {
      active = false
      requestVersion += 1
      detailVersion += 1
      window.removeEventListener('archive-search', onGlobalSearch)
      window.removeEventListener('archive-upload-complete', onUploadComplete)
      table.destroy()
      mutations.destroy()
      workflows.destroy()
    },
  }
}
