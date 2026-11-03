import { renderTableSkeleton } from './tableSkeleton.js'
import { ARCHIVE_CONTENT_TYPES } from '../services/arsipService.js'

const statusLabels = {
  terverifikasi: 'Terverifikasi',
  menunggu_verifikasi: 'Menunggu verifikasi',
  perlu_perbaikan: 'Perlu perbaikan',
  inaktif: 'Inaktif',
  dimusnahkan: 'Dimusnahkan',
}

function makeFilter(label, name, initialOptions) {
  const wrapper = document.createElement('label')
  wrapper.className = 'filter-control'
  const labelText = document.createElement('span')
  labelText.textContent = label
  const select = document.createElement('select')
  select.name = name
  select.setAttribute('aria-label', label)
  initialOptions.forEach(({ label: optionLabel, value }) => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = optionLabel
    select.append(option)
  })
  wrapper.append(labelText, select)
  return { wrapper, select }
}

function makeInputFilter(label, name, type, placeholder = '') {
  const wrapper = document.createElement('label')
  wrapper.className = 'filter-control'
  const labelText = document.createElement('span')
  labelText.textContent = label
  const input = document.createElement('input')
  input.type = type
  input.name = name
  input.setAttribute('aria-label', label)
  input.placeholder = placeholder
  wrapper.append(labelText, input)
  return { wrapper, input }
}

function makeRetryButton(onRetry) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'button button-outline state-retry'
  button.textContent = 'Coba lagi'
  button.addEventListener('click', onRetry)
  return button
}

function formatDate(value) {
  if (!value) return 'Tidak tersedia'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Tanggal tidak valid'
    : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(date)
}

export function createArsipTable({
  onFilter,
  onSelect,
  onRetry,
  onPageChange = () => {},
  titleText = 'Arsip Terbaru',
  showFilters = true,
  showAdvancedFilters = false,
  showSearch = false,
  showClassification = false,
  showPagination = false,
  selectable = true,
  dateField = 'created_at',
  dateHeading = 'Diunggah',
  emptyTitle = 'Belum ada arsip',
  emptyDescription = 'Arsip akan tampil di sini setelah tersedia untuk akun Anda.',
}) {
  const section = document.createElement('section')
  section.className = 'panel archive-panel'

  const header = document.createElement('div')
  header.className = 'panel-header archive-panel-header'
  const titleGroup = document.createElement('div')
  const eyebrow = document.createElement('p')
  eyebrow.className = 'section-kicker'
  eyebrow.textContent = 'INDEKS ARSIP'
  const title = document.createElement('h2')
  title.textContent = titleText
  titleGroup.append(eyebrow, title)

  const filters = document.createElement('div')
  filters.className = 'archive-filters'
  const categoryFilter = makeFilter('Kategori', 'category', [
    { label: 'Semua kategori', value: '' },
  ])
  const statusFilter = makeFilter('Status', 'status', [
    { label: 'Semua status', value: '' },
    { label: 'Terverifikasi', value: 'terverifikasi' },
    { label: 'Menunggu verifikasi', value: 'menunggu_verifikasi' },
    { label: 'Perlu perbaikan', value: 'perlu_perbaikan' },
    { label: 'Inaktif', value: 'inaktif' },
  ])
  const classificationFilter = makeFilter('Klasifikasi', 'classificationId', [
    { label: 'Semua klasifikasi', value: '' },
  ])
  const contentTypeFilter = makeFilter('Jenis konten', 'contentType', [
    { label: 'Semua jenis konten', value: '' },
    ...ARCHIVE_CONTENT_TYPES.map((value) => ({ label: value, value })),
  ])
  const channelFilter = makeInputFilter('Kanal publikasi', 'channel', 'search', 'Kanal atau media')
  const fromDateFilter = makeInputFilter('Tanggal unggah mulai', 'fromDate', 'date')
  const toDateFilter = makeInputFilter('Tanggal unggah sampai', 'toDate', 'date')
  const publicationFromDateFilter = makeInputFilter(
    'Tanggal publikasi mulai',
    'publicationFromDate',
    'date',
  )
  const publicationToDateFilter = makeInputFilter(
    'Tanggal publikasi sampai',
    'publicationToDate',
    'date',
  )
  const unitFilter = makeInputFilter('Unit pencipta', 'unit', 'text', 'Nama unit')
  const advancedFilters = document.createElement('div')
  advancedFilters.className = 'archive-additional-filters'
  const advancedToggle = document.createElement('button')
  advancedToggle.type = 'button'
  advancedToggle.className = 'archive-additional-filter-toggle'
  advancedToggle.textContent = 'Filter lainnya'
  advancedToggle.setAttribute('aria-expanded', 'false')
  advancedToggle.setAttribute('aria-controls', 'archive-additional-filter-panel')
  const advancedForm = document.createElement('form')
  advancedForm.className = 'archive-additional-filter-form'
  advancedForm.id = 'archive-additional-filter-panel'
  advancedForm.hidden = true
  const advancedFields = document.createElement('div')
  advancedFields.className = 'archive-additional-filter-fields'
  advancedFields.append(
    classificationFilter.wrapper,
    contentTypeFilter.wrapper,
    channelFilter.wrapper,
    fromDateFilter.wrapper,
    toDateFilter.wrapper,
    publicationFromDateFilter.wrapper,
    publicationToDateFilter.wrapper,
    unitFilter.wrapper,
  )
  const advancedActions = document.createElement('div')
  advancedActions.className = 'archive-additional-filter-actions'
  const applyAdvancedFilters = document.createElement('button')
  applyAdvancedFilters.type = 'submit'
  applyAdvancedFilters.className = 'button button-primary'
  applyAdvancedFilters.textContent = 'Terapkan filter'
  const resetFilters = document.createElement('button')
  resetFilters.type = 'button'
  resetFilters.className = 'button button-outline'
  resetFilters.textContent = 'Reset semua filter'
  advancedActions.append(applyAdvancedFilters, resetFilters)
  advancedForm.append(advancedFields, advancedActions)
  advancedFilters.append(advancedToggle, advancedForm)
  if (showFilters) filters.append(categoryFilter.wrapper, statusFilter.wrapper)
  if (showAdvancedFilters) filters.append(advancedFilters)
  let searchInput = null
  let searchTimer = null
  if (showSearch) {
    searchInput = document.createElement('input')
    searchInput.type = 'search'
    searchInput.className = 'archive-list-search'
    searchInput.placeholder = 'Cari nomor, judul, kegiatan, kanal, penulis, atau kata kunci'
    searchInput.setAttribute('aria-label', 'Cari arsip berdasarkan metadata publikasi')
    filters.prepend(searchInput)
  }
  header.append(titleGroup, filters)
  let currentPage = 1
  let totalRecords = 0
  let loading = false
  let pendingFilterUpdate = false
  const pageSize = 20

  const tableContainer = document.createElement('div')
  tableContainer.className = 'table-scroll'
  tableContainer.hidden = true
  const table = document.createElement('table')
  table.className = 'archive-table'
  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')
  ;[
    'No. Arsip',
    'Judul',
    'Kategori',
    ...(showClassification ? ['Klasifikasi'] : []),
    'Status',
    dateHeading,
  ].forEach((label) => {
    const th = document.createElement('th')
    th.scope = 'col'
    th.textContent = label
    headerRow.append(th)
  })
  thead.append(headerRow)
  const tbody = document.createElement('tbody')
  tbody.addEventListener('click', (event) => {
    if (!selectable || !onSelect) return
    const row = event.target.closest('tr[data-id]')
    if (!row || !tbody.contains(row)) return

    tbody.querySelectorAll('tr.terpilih').forEach((selectedRow) => {
      selectedRow.classList.remove('terpilih')
      selectedRow.querySelector('.table-select')?.setAttribute('aria-pressed', 'false')
    })
    row.classList.add('terpilih')
    row.querySelector('.table-select')?.setAttribute('aria-pressed', 'true')
    onSelect(row.dataset.id)
  })
  table.append(thead, tbody)
  tableContainer.append(table)

  const pagination = document.createElement('div')
  pagination.className = 'archive-pagination'
  pagination.hidden = !showPagination
  const pageSummary = document.createElement('p')
  pageSummary.setAttribute('aria-live', 'polite')
  const pageActions = document.createElement('div')
  pageActions.className = 'archive-pagination-actions'
  const previousButton = document.createElement('button')
  previousButton.type = 'button'
  previousButton.className = 'button button-outline'
  previousButton.textContent = 'Sebelumnya'
  const nextButton = document.createElement('button')
  nextButton.type = 'button'
  nextButton.className = 'button button-outline'
  nextButton.textContent = 'Berikutnya'
  pageActions.append(previousButton, nextButton)
  pagination.append(pageSummary, pageActions)

  const state = document.createElement('div')
  state.className = 'data-state table-state'
  state.setAttribute('role', 'status')

  function getFilters() {
    return {
      category: showFilters ? categoryFilter.select.value : '',
      status: showFilters ? statusFilter.select.value : '',
      search: searchInput?.value.trim() ?? '',
      classificationId: showAdvancedFilters ? classificationFilter.select.value : '',
      contentType: showAdvancedFilters ? contentTypeFilter.select.value : '',
      channel: showAdvancedFilters ? channelFilter.input.value.trim() : '',
      fromDate: showAdvancedFilters ? fromDateFilter.input.value : '',
      toDate: showAdvancedFilters ? toDateFilter.input.value : '',
      publicationFromDate: showAdvancedFilters ? publicationFromDateFilter.input.value : '',
      publicationToDate: showAdvancedFilters ? publicationToDateFilter.input.value : '',
      unit: showAdvancedFilters ? unitFilter.input.value.trim() : '',
    }
  }

  function updateFilters() {
    if (loading) {
      pendingFilterUpdate = true
      return
    }
    pendingFilterUpdate = false
    currentPage = 1
    onFilter({ ...getFilters(), page: currentPage })
  }

  function setAdvancedFiltersVisible(visible) {
    advancedForm.hidden = !visible
    advancedToggle.setAttribute('aria-expanded', String(visible))
  }

  function runPendingFilterUpdate() {
    if (!pendingFilterUpdate) return
    window.setTimeout(updateFilters, 0)
  }

  function updatePagination() {
    const pageCount = Math.max(1, Math.ceil(totalRecords / pageSize))
    pageSummary.textContent = `Halaman ${currentPage} dari ${pageCount}. Total ${new Intl.NumberFormat('id-ID').format(totalRecords)} arsip.`
    previousButton.disabled = currentPage <= 1
    nextButton.disabled = currentPage >= pageCount
  }

  previousButton.addEventListener('click', () => {
    if (loading || currentPage <= 1) return
    currentPage -= 1
    onPageChange(currentPage, getFilters())
  })
  nextButton.addEventListener('click', () => {
    const pageCount = Math.max(1, Math.ceil(totalRecords / pageSize))
    if (loading || currentPage >= pageCount) return
    currentPage += 1
    onPageChange(currentPage, getFilters())
  })
  searchInput?.addEventListener('input', () => {
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(updateFilters, 300)
  })

  function setCategories(categories) {
    const selected = categoryFilter.select.value
    const options = [{ label: 'Semua kategori', value: '' }, ...categories.map((value) => ({
      label: value,
      value,
    }))]
    categoryFilter.select.replaceChildren()
    options.forEach(({ label, value }) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      categoryFilter.select.append(option)
    })
    categoryFilter.select.value = options.some((option) => option.value === selected)
      ? selected
      : ''
  }

  function setClassifications(classifications) {
    const selected = classificationFilter.select.value
    const options = [
      { label: 'Semua klasifikasi', value: '' },
      ...classifications.map((item) => ({
        label: `${item.kode} · ${item.nama}${item.aktif ? '' : ' (nonaktif)'}`,
        value: item.id,
      })),
    ]
    classificationFilter.select.replaceChildren()
    options.forEach(({ label, value }) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      classificationFilter.select.append(option)
    })
    classificationFilter.select.value = options.some((option) => option.value === selected)
      ? selected
      : ''
  }

  function showLoading() {
    loading = true
    section.setAttribute('aria-busy', 'true')
    categoryFilter.select.disabled = true
    statusFilter.select.disabled = true
    classificationFilter.select.disabled = true
    contentTypeFilter.select.disabled = true
    channelFilter.input.disabled = true
    fromDateFilter.input.disabled = true
    toDateFilter.input.disabled = true
    publicationFromDateFilter.input.disabled = true
    publicationToDateFilter.input.disabled = true
    unitFilter.input.disabled = true
    applyAdvancedFilters.disabled = true
    resetFilters.disabled = true
    if (searchInput) searchInput.disabled = true
    previousButton.disabled = true
    nextButton.disabled = true
    pagination.hidden = true
    if (selectable) onSelect?.(null)
    state.replaceChildren()
    if (tbody.childElementCount === 0) {
      renderTableSkeleton(tbody, headerRow.childElementCount, 5)
      state.className = 'visually-hidden'
      state.hidden = false
      state.textContent = 'Memuat daftar arsip.'
    } else {
      state.hidden = true
    }
    state.setAttribute('role', 'status')
    state.setAttribute('aria-label', 'Daftar arsip sedang diperbarui')
    tableContainer.hidden = false
  }

  function showError(message, { preserveRecords = false } = {}) {
    loading = false
    section.removeAttribute('aria-busy')
    categoryFilter.select.disabled = false
    statusFilter.select.disabled = false
    classificationFilter.select.disabled = false
    contentTypeFilter.select.disabled = false
    channelFilter.input.disabled = false
    fromDateFilter.input.disabled = false
    toDateFilter.input.disabled = false
    publicationFromDateFilter.input.disabled = false
    publicationToDateFilter.input.disabled = false
    unitFilter.input.disabled = false
    applyAdvancedFilters.disabled = false
    resetFilters.disabled = false
    if (searchInput) searchInput.disabled = false
    tableContainer.hidden = !preserveRecords
    state.replaceChildren()
    state.setAttribute('aria-label', 'Gagal memuat daftar arsip')
    state.setAttribute('role', 'alert')
    const text = document.createElement('p')
    text.textContent = message
    state.append(text, makeRetryButton(onRetry))
    state.hidden = false
    if (preserveRecords) pagination.hidden = false
    runPendingFilterUpdate()
  }

  function setRecords(records, { searchActive = false, total = records.length, page = currentPage } = {}) {
    loading = false
    section.removeAttribute('aria-busy')
    categoryFilter.select.disabled = false
    statusFilter.select.disabled = false
    classificationFilter.select.disabled = false
    contentTypeFilter.select.disabled = false
    channelFilter.input.disabled = false
    fromDateFilter.input.disabled = false
    toDateFilter.input.disabled = false
    publicationFromDateFilter.input.disabled = false
    publicationToDateFilter.input.disabled = false
    unitFilter.input.disabled = false
    applyAdvancedFilters.disabled = false
    resetFilters.disabled = false
    if (searchInput) searchInput.disabled = false
    tbody.replaceChildren()
    state.replaceChildren()
    state.hidden = true
    state.setAttribute('role', 'status')
    tableContainer.hidden = records.length === 0
    currentPage = page
    totalRecords = total
    updatePagination()
    if (selectable) onSelect?.(null)

    if (!records.length) {
      const empty = document.createElement('div')
      empty.className = 'empty-state'
      const heading = document.createElement('strong')
      const hasSearchCriteria = searchActive
        || Object.values(getFilters()).some(Boolean)
      heading.textContent = hasSearchCriteria
        ? 'Tidak ada arsip yang cocok'
        : emptyTitle
      const description = document.createElement('p')
      description.textContent = hasSearchCriteria
        ? 'Coba ubah pencarian atau filter yang dipilih.'
        : emptyDescription
      empty.append(heading, description)
      state.append(empty)
      state.hidden = false
      state.setAttribute('aria-label', 'Daftar arsip kosong')
      runPendingFilterUpdate()
      return
    }

    records.forEach((record) => {
      const row = document.createElement('tr')
      row.dataset.id = record.id
      const numberCell = document.createElement('td')
      numberCell.className = 'archive-number'
      numberCell.dataset.column = 'number'
      const number = selectable
        ? document.createElement('button')
        : document.createElement('span')
      if (selectable) {
        number.type = 'button'
        number.className = 'table-select'
        number.setAttribute('aria-label', `Pilih arsip ${record.nomor_arsip}`)
        number.setAttribute('aria-pressed', 'false')
      }
      number.textContent = record.nomor_arsip

      const titleCell = document.createElement('td')
      titleCell.dataset.column = 'title'
      titleCell.textContent = record.judul ?? ''
      const categoryCell = document.createElement('td')
      categoryCell.dataset.column = 'category'
      categoryCell.textContent = record.kategori ?? ''
      numberCell.append(number)
      row.append(numberCell, titleCell, categoryCell)
      if (showClassification) {
        const classificationCell = document.createElement('td')
        classificationCell.dataset.column = 'classification'
        const classification = Array.isArray(record.klasifikasi)
          ? record.klasifikasi[0]
          : record.klasifikasi
        classificationCell.textContent = classification?.nama ?? 'Klasifikasi dihapus'
        row.append(classificationCell)
      }
      const statusCell = document.createElement('td')
      statusCell.dataset.column = 'status'
      const badge = document.createElement('span')
      const statusClass = Object.hasOwn(statusLabels, record.status)
        ? `status-${record.status}`
        : 'status-unknown'
      badge.className = `status-badge ${statusClass}`
      badge.textContent = statusLabels[record.status] ?? 'Status tidak dikenal'
      statusCell.append(badge)
      const dateCell = document.createElement('td')
      dateCell.dataset.column = 'date'
      dateCell.textContent = formatDate(record[dateField])
      row.append(statusCell, dateCell)
      tbody.append(row)
    })
    tableContainer.hidden = false
    pagination.hidden = !showPagination || records.length === 0
    runPendingFilterUpdate()
  }

  categoryFilter.select.addEventListener('change', updateFilters)
  statusFilter.select.addEventListener('change', updateFilters)
  advancedToggle.addEventListener('click', () => {
    setAdvancedFiltersVisible(advancedForm.hidden)
  })
  advancedForm.addEventListener('submit', (event) => {
    event.preventDefault()
    updateFilters()
  })
  resetFilters.addEventListener('click', () => {
    categoryFilter.select.value = ''
    statusFilter.select.value = ''
    classificationFilter.select.value = ''
    contentTypeFilter.select.value = ''
    channelFilter.input.value = ''
    fromDateFilter.input.value = ''
    toDateFilter.input.value = ''
    publicationFromDateFilter.input.value = ''
    publicationToDateFilter.input.value = ''
    unitFilter.input.value = ''
    if (searchInput) searchInput.value = ''
    setAdvancedFiltersVisible(false)
    updateFilters()
  })
  section.append(header, state, tableContainer, pagination)
  showLoading()

  return {
    element: section,
    getFilters,
    setCategories,
    setClassifications,
    setRecords,
    updateRecord(id, record) {
      const row = [...tbody.querySelectorAll('tr[data-id]')]
        .find((candidate) => candidate.dataset.id === id)
      if (!row) return false
      row.querySelector('[data-column="title"]').textContent = record.judul ?? ''
      row.querySelector('[data-column="category"]').textContent = record.kategori ?? ''
      const statusBadge = row.querySelector('[data-column="status"] .status-badge')
      if (statusBadge) {
        const statusClass = Object.hasOwn(statusLabels, record.status)
          ? `status-${record.status}`
          : 'status-unknown'
        statusBadge.className = `status-badge ${statusClass}`
        statusBadge.textContent = statusLabels[record.status] ?? 'Status tidak dikenal'
      }
      const classification = Array.isArray(record.klasifikasi)
        ? record.klasifikasi[0]
        : record.klasifikasi
      const classificationCell = row.querySelector('[data-column="classification"]')
      if (classificationCell) classificationCell.textContent = classification?.nama ?? 'Klasifikasi dihapus'
      return true
    },
    removeRecord(id) {
      const row = [...tbody.querySelectorAll('tr[data-id]')]
        .find((candidate) => candidate.dataset.id === id)
      if (!row) return false
      row.remove()
      totalRecords = Math.max(0, totalRecords - 1)
      updatePagination()
      return true
    },
    getCurrentPage() {
      return currentPage
    },
    getPageCount() {
      return Math.max(1, Math.ceil(totalRecords / pageSize))
    },
    setSearch(value) {
      if (!searchInput) return
      searchInput.value = value
      updateFilters()
    },
    setFilters(filters) {
      if (showFilters) {
        categoryFilter.select.value = filters.category ?? ''
        statusFilter.select.value = filters.status ?? ''
      }
      if (showAdvancedFilters) {
        classificationFilter.select.value = filters.classificationId ?? ''
        contentTypeFilter.select.value = filters.contentType ?? ''
        channelFilter.input.value = filters.channel ?? ''
        fromDateFilter.input.value = filters.fromDate ?? ''
        toDateFilter.input.value = filters.toDate ?? ''
        publicationFromDateFilter.input.value = filters.publicationFromDate ?? ''
        publicationToDateFilter.input.value = filters.publicationToDate ?? ''
        unitFilter.input.value = filters.unit ?? ''
      }
      if (searchInput) searchInput.value = filters.search ?? ''
    },
    pageSize,
    showLoading,
    showError,
    destroy() {
      window.clearTimeout(searchTimer)
    },
  }
}
