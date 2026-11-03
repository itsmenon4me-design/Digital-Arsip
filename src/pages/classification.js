import {
  deleteClassification,
  createArchiveAccessUrl,
  fetchClassificationArchives,
  fetchClassifications,
  fetchClassificationUsage,
  isClassificationDeletionAvailable,
  isClassificationManagementAvailable,
  saveClassification,
  setClassificationActive,
} from '../services/arsipService.js'
import { getReadCache } from '../services/readCache.js'
import { renderTableSkeleton } from '../components/tableSkeleton.js'
import { showToast } from '../components/toast.js'

const MAX_CACHED_ARCHIVE_PREVIEWS = 24

function makeButton(label, className, onClick) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = label
  button.addEventListener('click', onClick)
  return button
}

function makeRetryButton(onClick) {
  return makeButton('Coba lagi', 'button button-outline', onClick)
}

function fileExtension(archive) {
  const fileName = archive?.nama_berkas || archive?.file_path || ''
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

function fileTypeLabel(extension) {
  const labels = {
    pdf: 'PDF',
    jpg: 'JPEG',
    jpeg: 'JPEG',
    tif: 'TIFF',
    tiff: 'TIFF',
    png: 'PNG',
    mp4: 'MP4',
    xls: 'XLS',
    xlsx: 'XLSX',
    doc: 'DOC',
    docx: 'DOCX',
    ppt: 'PPT',
    pptx: 'PPTX',
  }
  return labels[extension] ?? (extension ? extension.toUpperCase() : 'BERKAS')
}

function formatArchiveDate(value) {
  if (!value) return 'Tanggal tidak tersedia'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Tanggal tidak valid'
    : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(date)
}

function formatFileSize(value) {
  if (!Number.isFinite(value) || value < 0) return ''
  if (value < 1024) return `${value} byte`
  const units = ['KB', 'MB', 'GB']
  let size = value / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(size)} ${units[unit]}`
}

export function createClassificationPage({ role = null } = {}) {
  const canManage = role === 'admin'
  const root = document.createElement('div')
  root.className = 'reference-page'

  const heading = document.createElement('section')
  heading.className = 'page-heading'
  const copy = document.createElement('div')
  const kicker = document.createElement('p')
  kicker.className = 'section-kicker'
  kicker.textContent = 'REFERENSI ARSIP'
  const title = document.createElement('h2')
  title.textContent = 'Klasifikasi'
  const description = document.createElement('p')
  description.textContent = 'Kelola kelompok arsip berdasarkan klasifikasi dan telusuri arsip yang terkait.'
  copy.append(kicker, title, description)
  heading.append(copy)

  const panel = document.createElement('section')
  panel.className = 'panel reference-panel'
  const panelHeader = document.createElement('div')
  panelHeader.className = 'panel-header'
  const panelTitle = document.createElement('h2')
  panelTitle.textContent = 'Daftar klasifikasi'
  const addButton = makeButton('+ Tambah Klasifikasi', 'button button-primary', () => openEditor())
  addButton.hidden = !canManage
  panelHeader.append(panelTitle, addButton)

  const migrationNotice = document.createElement('p')
  migrationNotice.className = 'reference-note classification-migration-notice'
  migrationNotice.textContent = 'Data klasifikasi tampil, tetapi pengelolaan belum tersedia. Administrator perlu menerapkan migrasi SQL 017 ke Supabase.'
  migrationNotice.hidden = true
  const usageNotice = document.createElement('p')
  usageNotice.className = 'reference-note classification-migration-notice'
  usageNotice.hidden = true

  const state = document.createElement('div')
  state.className = 'data-state table-state'
  state.setAttribute('role', 'status')
  const tableContainer = document.createElement('div')
  tableContainer.className = 'table-scroll'
  tableContainer.hidden = true
  const table = document.createElement('table')
  table.className = 'archive-table reference-table classification-table'
  table.setAttribute('aria-label', 'Daftar klasifikasi arsip')
  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')
  ;['Kode', 'Nama', 'Keterangan', 'Jumlah arsip', 'Status', 'Tindakan'].forEach((label) => {
    const cell = document.createElement('th')
    cell.scope = 'col'
    cell.textContent = label
    headerRow.append(cell)
  })
  thead.append(headerRow)
  const tbody = document.createElement('tbody')
  table.append(thead, tbody)
  tableContainer.append(table)

  const editorDialog = document.createElement('dialog')
  editorDialog.className = 'archive-mutation-dialog classification-dialog'
  editorDialog.setAttribute('aria-labelledby', 'classification-editor-title')
  const editorForm = document.createElement('form')
  editorForm.className = 'archive-mutation-form'
  const editorTitle = document.createElement('h2')
  editorTitle.id = 'classification-editor-title'
  const editorNote = document.createElement('p')
  editorNote.className = 'archive-mutation-note'
  editorNote.textContent = 'Kode klasifikasi dibuat otomatis saat klasifikasi baru disimpan.'

  function makeField(labelText, inputName, maxLength, multiline = false) {
    const label = document.createElement('label')
    label.className = 'archive-mutation-field'
    const caption = document.createElement('span')
    caption.textContent = labelText
    const input = multiline ? document.createElement('textarea') : document.createElement('input')
    input.name = inputName
    if (!multiline) {
      input.type = 'text'
      input.autocomplete = 'off'
    } else {
      input.rows = 4
    }
    input.required = !multiline
    input.maxLength = maxLength
    label.append(caption, input)
    return { label, input }
  }

  const nameField = makeField('Nama klasifikasi', 'nama', 150)
  const descriptionField = makeField('Keterangan', 'keterangan', 2000, true)
  const editorStatus = document.createElement('p')
  editorStatus.className = 'archive-mutation-status'
  editorStatus.setAttribute('role', 'status')
  editorStatus.setAttribute('aria-live', 'polite')
  const editorActions = document.createElement('div')
  editorActions.className = 'archive-mutation-actions'
  const cancelButton = makeButton('Batal', 'button button-outline', () => editorDialog.close())
  const saveButton = document.createElement('button')
  saveButton.type = 'submit'
  saveButton.className = 'button button-primary'
  saveButton.textContent = 'Simpan'
  editorActions.append(cancelButton, saveButton)
  editorForm.append(
    editorTitle,
    editorNote,
    nameField.label,
    descriptionField.label,
    editorStatus,
    editorActions,
  )
  editorDialog.append(editorForm)

  const deleteDialog = document.createElement('dialog')
  deleteDialog.className = 'archive-mutation-dialog classification-dialog'
  deleteDialog.setAttribute('aria-labelledby', 'classification-delete-title')
  const deleteForm = document.createElement('form')
  deleteForm.className = 'archive-mutation-form'
  const deleteTitle = document.createElement('h2')
  deleteTitle.id = 'classification-delete-title'
  deleteTitle.textContent = 'Hapus klasifikasi'
  const deleteMessage = document.createElement('p')
  deleteMessage.className = 'archive-mutation-note'
  const deleteStatus = document.createElement('p')
  deleteStatus.className = 'archive-mutation-status'
  deleteStatus.setAttribute('role', 'status')
  deleteStatus.setAttribute('aria-live', 'polite')
  const deleteActions = document.createElement('div')
  deleteActions.className = 'archive-mutation-actions'
  const cancelDeleteButton = makeButton('Batal', 'button button-outline', () => deleteDialog.close())
  const confirmDeleteButton = document.createElement('button')
  confirmDeleteButton.type = 'submit'
  confirmDeleteButton.className = 'button button-danger'
  confirmDeleteButton.textContent = 'Hapus permanen'
  deleteActions.append(cancelDeleteButton, confirmDeleteButton)
  deleteForm.append(deleteTitle, deleteMessage, deleteStatus, deleteActions)
  deleteDialog.append(deleteForm)

  const archivesDialog = document.createElement('dialog')
  archivesDialog.className = 'archive-mutation-dialog classification-archives-dialog'
  archivesDialog.setAttribute('aria-labelledby', 'classification-archives-title')
  const archivesContent = document.createElement('div')
  archivesContent.className = 'classification-archives-content'
  const archivesHeader = document.createElement('div')
  archivesHeader.className = 'dialog-header'
  const archivesTitle = document.createElement('h2')
  archivesTitle.id = 'classification-archives-title'
  const closeArchivesButton = makeButton('Tutup', 'button button-outline dialog-close', () => {
    archivesDialog.close()
  })
  archivesHeader.append(archivesTitle, closeArchivesButton)
  const archivesDescription = document.createElement('p')
  archivesDescription.className = 'archive-mutation-note'
  const archivesState = document.createElement('div')
  archivesState.className = 'classification-archives-state'
  archivesState.setAttribute('role', 'status')
  archivesState.setAttribute('aria-live', 'polite')
  const archivesGrid = document.createElement('div')
  archivesGrid.className = 'classification-archive-grid'
  archivesGrid.hidden = true
  const archivesPagination = document.createElement('div')
  archivesPagination.className = 'classification-archives-pagination'
  const archivesPageSummary = document.createElement('p')
  archivesPageSummary.setAttribute('aria-live', 'polite')
  const previousArchivesButton = makeButton(
    'Sebelumnya',
    'button button-outline',
    () => loadClassificationArchives(archivesPage - 1),
  )
  const nextArchivesButton = makeButton(
    'Berikutnya',
    'button button-outline',
    () => loadClassificationArchives(archivesPage + 1),
  )
  const archivesPageActions = document.createElement('div')
  archivesPageActions.className = 'classification-archives-page-actions'
  archivesPageActions.append(previousArchivesButton, nextArchivesButton)
  archivesPagination.append(archivesPageSummary, archivesPageActions)
  archivesPagination.hidden = true
  archivesContent.append(
    archivesHeader,
    archivesDescription,
    archivesState,
    archivesGrid,
    archivesPagination,
  )
  archivesDialog.append(archivesContent)

  const archiveDetailDialog = document.createElement('dialog')
  archiveDetailDialog.className = 'archive-mutation-dialog classification-archive-detail-dialog'
  archiveDetailDialog.setAttribute('aria-labelledby', 'classification-archive-detail-title')
  const archiveDetailContent = document.createElement('div')
  archiveDetailContent.className = 'classification-detail-content'
  const archiveDetailHeader = document.createElement('div')
  archiveDetailHeader.className = 'dialog-header'
  const archiveDetailTitle = document.createElement('h2')
  archiveDetailTitle.id = 'classification-archive-detail-title'
  const closeArchiveDetailButton = makeButton(
    'Tutup',
    'button button-outline dialog-close',
    () => archiveDetailDialog.close(),
  )
  archiveDetailHeader.append(archiveDetailTitle, closeArchiveDetailButton)
  const archiveDetailList = document.createElement('dl')
  archiveDetailList.className = 'detail-list classification-archive-detail-list'
  const archiveAccessStatus = document.createElement('p')
  archiveAccessStatus.className = 'panel-note detail-message'
  archiveAccessStatus.setAttribute('role', 'status')
  archiveAccessStatus.setAttribute('aria-live', 'polite')
  const archiveAccessActions = document.createElement('div')
  archiveAccessActions.className = 'detail-actions'
  const openArchiveButton = makeButton('Buka berkas', 'button button-primary', () => {
    void openSelectedArchive()
  })
  const downloadArchiveButton = makeButton('Unduh', 'button button-outline', () => {
    void downloadSelectedArchive()
  })
  archiveAccessActions.append(openArchiveButton, downloadArchiveButton)
  archiveDetailContent.append(
    archiveDetailHeader,
    archiveDetailList,
    archiveAccessActions,
    archiveAccessStatus,
  )
  archiveDetailDialog.append(archiveDetailContent)

  panel.append(panelHeader, migrationNotice, usageNotice, state, tableContainer)
  root.append(heading, panel, editorDialog, deleteDialog, archivesDialog, archiveDetailDialog)

  let records = []
  let active = true
  let saving = false
  let requestVersion = 0
  let archivesRequestVersion = 0
  const cachedArchivePreviews = new Map()
  let editingId = null
  let deletingRecord = null
  let deleting = false
  let selectedClassification = null
  let archivesPage = 1
  let openingArchivesTrigger = null
  let selectedArchive = null
  let archiveAccessBusy = false
  let usageError = ''
  let usageCheckPending = canManage && isClassificationManagementAvailable()
  const pendingIds = new Set()

  function showLoading() {
    state.className = 'visually-hidden'
    state.textContent = 'Memuat daftar klasifikasi.'
    state.hidden = false
    state.setAttribute('role', 'status')
    state.setAttribute('aria-label', 'Daftar klasifikasi sedang diperbarui')
    panel.setAttribute('aria-busy', 'true')
    renderTableSkeleton(tbody, headerRow.childElementCount)
    tableContainer.hidden = false
  }

  function showError(message, preserveRecords = false) {
    panel.removeAttribute('aria-busy')
    state.replaceChildren()
    state.hidden = false
    state.setAttribute('role', 'alert')
    state.setAttribute('aria-label', 'Gagal memuat klasifikasi')
    const text = document.createElement('p')
    text.textContent = message
    state.append(text, makeRetryButton(load))
    tableContainer.hidden = !preserveRecords
  }

  function renderRecords(nextRecords) {
    records = nextRecords
    panel.removeAttribute('aria-busy')
    const managementAvailable = isClassificationManagementAvailable()
    addButton.disabled = !managementAvailable
    migrationNotice.hidden = !canManage || managementAvailable
    const deletionAvailable = managementAvailable
      && !usageCheckPending
      && !usageError
      && isClassificationDeletionAvailable()
    if (!canManage || !managementAvailable) {
      usageNotice.hidden = true
    } else if (usageCheckPending) {
      usageNotice.hidden = true
    } else if (!deletionAvailable) {
      usageNotice.textContent = usageError
        || 'Pemeriksaan arsip yang memakai klasifikasi belum tersedia. Penghapusan permanen dinonaktifkan sampai migrasi SQL 018 diterapkan.'
      usageNotice.hidden = false
    } else {
      usageNotice.hidden = true
    }
    tbody.replaceChildren()
    if (records.length === 0) {
      state.replaceChildren()
      state.className = 'empty-state'
      const emptyHeading = document.createElement('strong')
      emptyHeading.textContent = 'Belum ada klasifikasi'
      const emptyDescription = document.createElement('p')
      emptyDescription.textContent = 'Tambahkan klasifikasi agar dapat dipilih saat mengunggah arsip.'
      state.append(emptyHeading, emptyDescription)
      state.hidden = false
      state.setAttribute('aria-label', 'Daftar klasifikasi kosong')
      tableContainer.hidden = true
      return
    }

    state.replaceChildren()
    state.className = 'data-state table-state'
    state.hidden = true
    records.forEach((record) => {
      const row = document.createElement('tr')
      const code = document.createElement('td')
      code.textContent = record.kode ?? ''
      const name = document.createElement('td')
      const nameButton = makeButton(
        record.nama ?? '',
        'classification-name-link',
        () => openClassificationArchives(record, nameButton),
      )
      nameButton.setAttribute('aria-label', `Lihat arsip klasifikasi ${record.kode}, ${record.nama}`)
      name.append(nameButton)
      const descriptionCell = document.createElement('td')
      descriptionCell.className = 'classification-description-cell'
      descriptionCell.textContent = record.keterangan || 'Belum ada keterangan.'
      const countCell = document.createElement('td')
      countCell.className = 'classification-count-cell'
      countCell.textContent = new Intl.NumberFormat('id-ID').format(record.jumlah_arsip ?? 0)
      const statusCell = document.createElement('td')
      const status = document.createElement('span')
      status.className = record.aktif ? 'classification-status is-active' : 'classification-status'
      status.textContent = record.aktif ? 'Aktif' : 'Nonaktif'
      statusCell.append(status)

      const actions = document.createElement('td')
      actions.className = 'classification-actions'
      const viewArchivesButton = makeButton(
        'Lihat arsip',
        'button button-outline',
        () => openClassificationArchives(record, viewArchivesButton),
      )
      actions.append(viewArchivesButton)
      if (canManage) {
        const editButton = makeButton('Ubah', 'button button-outline', () => openEditor(record))
        editButton.disabled = !managementAvailable || pendingIds.has(record.id)
        const toggleButton = makeButton(
          record.aktif ? 'Nonaktifkan' : 'Aktifkan',
          record.aktif ? 'button button-outline' : 'button button-primary',
          () => toggleActive(record),
        )
        toggleButton.disabled = !managementAvailable || pendingIds.has(record.id)
        actions.append(editButton, toggleButton)
      }
      if (canManage) {
        const canDelete = record.dipakai === false
        const deleteButton = makeButton('Hapus', 'button button-danger', () => openDelete(record))
        deleteButton.disabled = !deletionAvailable || !canDelete || pendingIds.has(record.id)
        if (!deletionAvailable) {
          deleteButton.title = usageCheckPending
            ? 'Sedang memeriksa arsip yang memakai klasifikasi.'
            : usageError || 'Status penggunaan belum dapat dipastikan.'
        } else if (!canDelete) {
          deleteButton.title = record.dipakai === true
            ? 'Tidak dapat dihapus karena masih dipakai arsip.'
            : 'Status penggunaan belum dapat dipastikan.'
        }
        if (deleteButton.disabled) {
          deleteButton.setAttribute('aria-label', `Hapus ${record.kode}: ${deleteButton.title}`)
        }
        actions.append(deleteButton)
      }
      row.append(code, name, descriptionCell, countCell, statusCell, actions)
      tbody.append(row)
    })
    tableContainer.hidden = false
    void warmClassificationArchivePages(records)
  }

  async function warmClassificationArchivePages(classifications) {
    const pending = classifications.filter((record) => Number(record.jumlah_arsip) > 0)
    let nextIndex = 0
    const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (active && nextIndex < pending.length) {
        const record = pending[nextIndex]
        nextIndex += 1
        try {
          await fetchClassificationArchives({
            classificationId: record.id,
            page: 1,
            pageSize: 12,
          })
        } catch (error) {
          console.error(`Gagal menyiapkan arsip klasifikasi ${record.kode}:`, error)
        }
      }
    })
    await Promise.all(workers)
  }

  function openEditor(record = null) {
    if (saving) return
    editingId = record?.id ?? null
    editorTitle.textContent = editingId ? 'Ubah klasifikasi' : 'Tambah klasifikasi'
    editorNote.textContent = editingId
      ? 'Kode klasifikasi dipertahankan. Perbarui nama atau keterangannya.'
      : 'Kode klasifikasi dibuat otomatis saat klasifikasi baru disimpan.'
    nameField.input.value = record?.nama ?? ''
    descriptionField.input.value = record?.keterangan ?? ''
    editorStatus.textContent = ''
    editorStatus.setAttribute('role', 'status')
    editorDialog.showModal()
    nameField.input.focus()
  }

  function openDelete(record) {
    if (deleting || usageCheckPending || usageError
      || !isClassificationManagementAvailable()
      || !isClassificationDeletionAvailable()
      || record.dipakai !== false) return
    deletingRecord = record
    deleteMessage.textContent = `Klasifikasi ${record.kode} · ${record.nama} akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.`
    deleteStatus.textContent = ''
    deleteStatus.setAttribute('role', 'status')
    deleteDialog.showModal()
    cancelDeleteButton.focus()
  }

  function setArchiveState(message, role = 'status', retry = null) {
    archivesState.replaceChildren()
    archivesState.setAttribute('role', role)
    const text = document.createElement('p')
    text.textContent = message
    archivesState.append(text)
    if (retry) archivesState.append(makeRetryButton(retry))
    archivesState.hidden = false
  }

  function makeArchivePreview(archive) {
    const extension = fileExtension(archive)
    const typeLabel = fileTypeLabel(extension)
    const preview = document.createElement('div')
    preview.className = 'classification-archive-preview'

    const fileIcon = document.createElement('span')
    fileIcon.className = 'classification-file-icon'
    fileIcon.textContent = typeLabel
    preview.append(fileIcon)

    if (extension === 'mp4') {
      const playMarker = document.createElement('span')
      playMarker.className = 'classification-video-marker'
      playMarker.textContent = 'Video'
      preview.append(playMarker)
    }

    return { preview, extension }
  }

  function showArchivePreviewError(preview, message) {
    const unavailable = document.createElement('span')
    unavailable.className = 'classification-preview-status'
    unavailable.setAttribute('role', 'status')
    unavailable.textContent = message
    preview.append(unavailable)
  }

  function cacheArchivePreview(archiveId, image) {
    cachedArchivePreviews.delete(archiveId)
    cachedArchivePreviews.set(archiveId, image)
    while (cachedArchivePreviews.size > MAX_CACHED_ARCHIVE_PREVIEWS) {
      const [oldestArchiveId, oldestImage] = cachedArchivePreviews.entries().next().value
      cachedArchivePreviews.delete(oldestArchiveId)
      if (!oldestImage.isConnected) oldestImage.removeAttribute('src')
    }
  }

  function appendArchiveImage(archive, preview, imageOrUrl, request, cached = false) {
    const image = typeof imageOrUrl === 'string'
      ? document.createElement('img')
      : imageOrUrl
    image.alt = ''
    image.loading = 'lazy'
    image.dataset.previewRequest = String(request)
    image.addEventListener('load', () => {
      if (active && archivesDialog.open && request === archivesRequestVersion) {
        preview.querySelector('.classification-file-icon')?.remove()
        image.classList.remove('is-loading')
        cacheArchivePreview(archive.id, image)
      }
    }, { once: true })
    image.addEventListener('error', () => {
      if (!active || !archivesDialog.open || request !== archivesRequestVersion) return
      image.remove()
      if (cached) {
        if (cachedArchivePreviews.get(archive.id) === image) {
          cachedArchivePreviews.delete(archive.id)
        }
        void loadArchivePreview(archive, preview, fileExtension(archive), request)
        return
      }
      showArchivePreviewError(preview, 'Pratinjau gambar tidak tersedia.')
    }, { once: true })
    if (cached) {
      preview.querySelector('.classification-file-icon')?.remove()
      image.classList.remove('is-loading')
    } else {
      image.classList.add('is-loading')
    }
    preview.append(image)
    if (typeof imageOrUrl === 'string') image.src = imageOrUrl
  }

  async function loadArchivePreview(archive, preview, extension, request) {
    const isImage = ['jpg', 'jpeg', 'png', 'tif', 'tiff'].includes(extension)
    try {
      const url = await createArchiveAccessUrl(archive, 'buka', 300)
      if (!active || !archivesDialog.open || request !== archivesRequestVersion) return

      if (isImage) {
        appendArchiveImage(archive, preview, url, request)
      } else if (extension === 'mp4') {
        const video = document.createElement('video')
        video.muted = true
        video.playsInline = true
        video.preload = 'metadata'
        video.src = url
        video.setAttribute('aria-label', `Pratinjau video ${archive.nama_berkas || archive.judul}`)
        video.addEventListener('error', () => {
          if (!active || !archivesDialog.open || request !== archivesRequestVersion) return
          showArchivePreviewError(preview, 'Pratinjau video tidak tersedia.')
        }, { once: true })
        preview.append(video)
      }
    } catch (error) {
      if (!active || !archivesDialog.open || request !== archivesRequestVersion) return
      console.error(`Pratinjau arsip ${archive.id} gagal dimuat:`, error)
      showArchivePreviewError(preview, 'Pratinjau tidak tersedia.')
    }
  }

  function makeArchiveCard(archive, request) {
    const extension = fileExtension(archive)
    const typeLabel = fileTypeLabel(extension)
    const card = makeButton('', 'classification-archive-card', () => {
      void openArchiveDetail(archive)
    })
    card.setAttribute('aria-label', `Buka detail arsip ${archive.judul}, berkas ${archive.nama_berkas || typeLabel}`)
    const supportsPreview = archive.file_path && archive.file_status === 'tersedia'
      && ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'mp4'].includes(extension)
    const { preview, extension: previewExtension } = makeArchivePreview(archive)
    const body = document.createElement('span')
    body.className = 'classification-archive-card-body'
    const title = document.createElement('strong')
    title.className = 'classification-archive-card-title'
    title.textContent = archive.judul || 'Judul tidak tersedia'
    const fileName = document.createElement('span')
    fileName.className = 'classification-archive-file-name'
    fileName.textContent = archive.nama_berkas || 'Nama berkas tidak tersedia'
    const metadata = document.createElement('span')
    metadata.className = 'classification-archive-card-meta'
    const date = document.createElement('span')
    date.textContent = formatArchiveDate(archive.created_at)
    const type = document.createElement('span')
    type.className = 'classification-archive-type'
    type.textContent = typeLabel
    metadata.append(date, type)
    const sizeText = formatFileSize(Number(archive.ukuran_file))
    if (sizeText) {
      const size = document.createElement('span')
      size.className = 'classification-archive-file-size'
      size.textContent = sizeText
      body.append(title, fileName, metadata, size)
    } else {
      body.append(title, fileName, metadata)
    }
    card.append(preview, body)
    if (supportsPreview) {
      const cachedImage = cachedArchivePreviews.get(archive.id)
      if (cachedImage?.complete && cachedImage.naturalWidth > 0) {
        cachedArchivePreviews.delete(archive.id)
        cachedArchivePreviews.set(archive.id, cachedImage)
        appendArchiveImage(archive, preview, cachedImage, request, true)
        void createArchiveAccessUrl(archive, 'buka', 300).catch((error) => {
          if (cachedArchivePreviews.get(archive.id) === cachedImage) {
            cachedArchivePreviews.delete(archive.id)
          }
          console.error(`Pemeriksaan akses arsip ${archive.id} gagal:`, error)
          if (!active || !archivesDialog.open || request !== archivesRequestVersion
            || cachedImage.dataset.previewRequest !== String(request)) return
          cachedImage.remove()
          showArchivePreviewError(preview, 'Akses pratinjau gagal diperiksa.')
          showToast(error.message || 'Akses arsip gagal diperbarui.')
        })
      } else {
        void loadArchivePreview(archive, preview, previewExtension, request)
      }
    }
    return card
  }

  function openClassificationArchives(record, trigger) {
    openingArchivesTrigger?.removeAttribute('aria-busy')
    openingArchivesTrigger = trigger
    selectedClassification = record
    archivesPage = 1
    archivesTitle.textContent = `${record.kode} · ${record.nama}`
    archivesDescription.textContent = record.keterangan
      || 'Belum ada keterangan untuk klasifikasi ini.'
    archivesState.hidden = true
    archivesGrid.replaceChildren()
    archivesGrid.hidden = true
    archivesPagination.hidden = true
    if (!archivesDialog.open) archivesDialog.showModal()
    closeArchivesButton.focus()
    trigger?.setAttribute('aria-busy', 'true')
    void loadClassificationArchives(1)
  }

  function renderClassificationArchives(result, request) {
    archivesGrid.replaceChildren(...result.records.map((archive) => makeArchiveCard(archive, request)))
    archivesState.hidden = true
    archivesGrid.hidden = result.records.length === 0
    const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize))
    archivesPage = result.page
    archivesPageSummary.textContent = result.total === 0
      ? 'Belum ada arsip.'
      : `Halaman ${result.page} dari ${pageCount} · ${new Intl.NumberFormat('id-ID').format(result.total)} arsip`
    previousArchivesButton.disabled = result.page <= 1
    nextArchivesButton.disabled = result.page >= pageCount
    archivesPagination.hidden = result.total <= result.pageSize
    if (result.records.length === 0) {
      setArchiveState('Belum ada arsip yang terhubung ke klasifikasi ini. Arsip baru yang memilih klasifikasi ini akan tampil di sini.')
    }
  }

  async function loadClassificationArchives(page = 1) {
    if (!selectedClassification || !active) return
    const request = ++archivesRequestVersion
    const safePage = Math.max(1, page)
    const params = {
      classificationId: selectedClassification.id,
      page: safePage,
      pageSize: 12,
    }
    const cached = getReadCache('classification-archives', params)
    archivesPage = safePage
    archivesDialog.setAttribute('aria-busy', 'true')
    if (cached) {
      renderClassificationArchives(cached, request)
      archivesDialog.removeAttribute('aria-busy')
      return
    }
    setArchiveState(`Memuat arsip untuk ${selectedClassification.kode}.`)
    archivesGrid.hidden = true
    archivesPagination.hidden = true
    try {
      const result = await fetchClassificationArchives(params)
      if (!active || request !== archivesRequestVersion) return

      renderClassificationArchives(result, request)
    } catch (error) {
      if (!active || request !== archivesRequestVersion) return
      console.error('Gagal memuat arsip berdasarkan klasifikasi:', error)
      setArchiveState(error.message || 'Arsip gagal dimuat. Coba lagi.', 'alert', () => {
        void loadClassificationArchives(safePage)
      })
    } finally {
      if (request === archivesRequestVersion) {
        archivesDialog.removeAttribute('aria-busy')
        openingArchivesTrigger?.removeAttribute('aria-busy')
        openingArchivesTrigger = null
      }
    }
  }

  function setArchiveDetailRows(archive) {
    const rows = [
      ['Nomor arsip', archive.nomor_arsip],
      ['Klasifikasi', selectedClassification
        ? `${selectedClassification.kode} · ${selectedClassification.nama}`
        : 'Tidak tersedia'],
      ['Tanggal unggah', formatArchiveDate(archive.created_at)],
      ['Jenis berkas', fileTypeLabel(fileExtension(archive))],
      ['Nama berkas', archive.nama_berkas || 'Tidak tersedia'],
      ['Ukuran berkas', formatFileSize(Number(archive.ukuran_file)) || 'Tidak tersedia'],
      ['Kategori', archive.kategori],
      ['Status', archive.status],
      ['Unit pencipta', archive.unit_pencipta],
      ['Tingkat akses', archive.tingkat_akses],
    ]
    archiveDetailList.replaceChildren(...rows.map(([label, value]) => {
      const row = document.createElement('div')
      row.className = 'detail-row'
      const term = document.createElement('dt')
      term.textContent = label
      const description = document.createElement('dd')
      description.textContent = value || 'Tidak tersedia'
      row.append(term, description)
      return row
    }))
  }

  function openArchiveDetail(summary) {
    selectedArchive = summary
    archiveDetailTitle.textContent = summary.judul || 'Detail arsip'
    setArchiveDetailRows(summary)
    const fileAvailable = summary.file_status === 'tersedia' && Boolean(summary.file_path)
    archiveAccessStatus.setAttribute('role', 'status')
    archiveAccessStatus.textContent = fileAvailable
      ? ''
      : 'Berkas belum tersedia untuk dibuka atau diunduh.'
    openArchiveButton.disabled = !fileAvailable
    downloadArchiveButton.disabled = !fileAvailable
    if (!archiveDetailDialog.open) archiveDetailDialog.showModal()
    closeArchiveDetailButton.focus()
  }

  async function openSelectedArchive() {
    if (!selectedArchive || archiveAccessBusy) return
    const previewTab = window.open('about:blank', '_blank')
    if (!previewTab) {
      archiveAccessStatus.setAttribute('role', 'alert')
      archiveAccessStatus.textContent = 'Tab berkas diblokir browser. Izinkan pop-up lalu coba lagi.'
      return
    }
    previewTab.opener = null
    archiveAccessBusy = true
    openArchiveButton.disabled = true
    downloadArchiveButton.disabled = true
    archiveAccessStatus.setAttribute('role', 'status')
    archiveAccessStatus.textContent = 'Memeriksa izin dan mencatat akses.'
    try {
      const url = await createArchiveAccessUrl(selectedArchive, 'buka')
      previewTab.location.replace(url)
      archiveDetailDialog.close()
      showToast('Berkas dibuka. Tautan sementara berlaku selama 60 detik.')
    } catch (error) {
      previewTab.close()
      archiveAccessStatus.setAttribute('role', 'alert')
      archiveAccessStatus.textContent = error.message
    } finally {
      archiveAccessBusy = false
      openArchiveButton.disabled = !(selectedArchive?.file_path && selectedArchive.file_status === 'tersedia')
      downloadArchiveButton.disabled = openArchiveButton.disabled
    }
  }

  async function downloadSelectedArchive() {
    if (!selectedArchive || archiveAccessBusy) return
    archiveAccessBusy = true
    openArchiveButton.disabled = true
    downloadArchiveButton.disabled = true
    archiveAccessStatus.setAttribute('role', 'status')
    archiveAccessStatus.textContent = 'Memeriksa izin dan menyiapkan unduhan.'
    try {
      const url = await createArchiveAccessUrl(selectedArchive, 'unduh')
      const link = document.createElement('a')
      link.href = url
      link.download = selectedArchive.nama_berkas || 'arsip'
      link.rel = 'noopener'
      document.body.append(link)
      link.click()
      link.remove()
      archiveDetailDialog.close()
      showToast('Unduhan dimulai.')
    } catch (error) {
      archiveAccessStatus.setAttribute('role', 'alert')
      archiveAccessStatus.textContent = error.message
    } finally {
      archiveAccessBusy = false
      openArchiveButton.disabled = !(selectedArchive?.file_path && selectedArchive.file_status === 'tersedia')
      downloadArchiveButton.disabled = openArchiveButton.disabled
    }
  }

  async function confirmDelete() {
    if (deleting || !deletingRecord) return
    const record = deletingRecord
    deleting = true
    pendingIds.add(record.id)
    confirmDeleteButton.disabled = true
    cancelDeleteButton.disabled = true
    deleteDialog.setAttribute('aria-busy', 'true')
    deleteStatus.setAttribute('role', 'status')
    deleteStatus.textContent = 'Menghapus klasifikasi.'
    try {
      await deleteClassification(record.id)
      if (!active) return
      records = records.filter((item) => item.id !== record.id)
      renderRecords(records)
      deleteDialog.close()
      showToast(`Klasifikasi ${record.kode} dihapus.`)
    } catch (error) {
      if (!active) return
      console.error(`Gagal menghapus klasifikasi ${record.kode}:`, error)
      if (error.message.includes('masih digunakan oleh arsip')) {
        records = records.map((item) => item.id === record.id
          ? { ...item, dipakai: true }
          : item)
        renderRecords(records)
      }
      deleteStatus.setAttribute('role', 'alert')
      deleteStatus.textContent = error.message
    } finally {
      deleting = false
      pendingIds.delete(record.id)
      deleteDialog.removeAttribute('aria-busy')
      if (active) {
        confirmDeleteButton.disabled = false
        cancelDeleteButton.disabled = false
      }
    }
  }

  async function toggleActive(record) {
    if (pendingIds.has(record.id)) return
    pendingIds.add(record.id)
    renderRecords(records)
    let updated = null
    let failureMessage = ''
    try {
      updated = await setClassificationActive(record.id, !record.aktif)
    } catch (error) {
      console.error(`Gagal mengubah status klasifikasi ${record.kode}:`, error)
      failureMessage = error.message
    } finally {
      pendingIds.delete(record.id)
      if (active) {
        if (updated) {
          records = records.map((item) => item.id === updated.id
            ? { ...updated, dipakai: item.dipakai }
            : item)
        }
        renderRecords(records)
        if (failureMessage) {
          state.className = 'classification-action-status'
          state.setAttribute('role', 'alert')
          state.textContent = failureMessage
          state.hidden = false
        }
      }
    }
    if (active && updated) {
      showToast(updated.aktif
        ? `${updated.kode} diaktifkan.`
        : `${updated.kode} dinonaktifkan. Arsip lama tetap terhubung.`)
    }
  }

  editorForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (saving || !editorForm.reportValidity()) return

    const nama = nameField.input.value.trim()
    const keterangan = descriptionField.input.value.trim()
    if (!nama) {
      editorStatus.setAttribute('role', 'alert')
      editorStatus.textContent = 'Nama klasifikasi wajib diisi.'
      nameField.input.focus()
      return
    }

    saving = true
    saveButton.disabled = true
    cancelButton.disabled = true
    editorStatus.setAttribute('role', 'status')
    editorStatus.textContent = 'Menyimpan klasifikasi.'
    editorDialog.setAttribute('aria-busy', 'true')
    try {
      const saved = await saveClassification({ id: editingId, nama, keterangan })
      if (!active) return
      const exists = records.some((record) => record.id === saved.id)
      const nextRecords = exists
        ? records.map((record) => record.id === saved.id
          ? { ...saved, dipakai: record.dipakai, jumlah_arsip: record.jumlah_arsip }
          : record)
        : [...records, { ...saved, dipakai: false, jumlah_arsip: 0 }]
      renderRecords(nextRecords.sort((left, right) => left.kode.localeCompare(right.kode)))
      editorDialog.close()
      showToast(editingId ? 'Perubahan klasifikasi tersimpan.' : 'Klasifikasi ditambahkan.')
    } catch (error) {
      if (!active) return
      console.error('Gagal menyimpan klasifikasi:', error)
      editorStatus.setAttribute('role', 'alert')
      editorStatus.textContent = error.message
    } finally {
      saving = false
      editorDialog.removeAttribute('aria-busy')
      if (active) {
        saveButton.disabled = false
        cancelButton.disabled = false
      }
    }
  })

  editorDialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (!saving) editorDialog.close()
  })
  editorDialog.addEventListener('cancel', (event) => {
    if (saving) event.preventDefault()
  })
  editorDialog.addEventListener('click', (event) => {
    if (event.target === editorDialog && !saving) editorDialog.close()
  })

  deleteForm.addEventListener('submit', (event) => {
    event.preventDefault()
    void confirmDelete()
  })
  deleteDialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (!deleting) deleteDialog.close()
  })
  deleteDialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    if (!deleting) deleteDialog.close()
  })
  deleteDialog.addEventListener('click', (event) => {
    if (event.target === deleteDialog && !deleting) deleteDialog.close()
  })
  archivesDialog.addEventListener('click', (event) => {
    if (event.target === archivesDialog) archivesDialog.close()
  })
  archiveDetailDialog.addEventListener('click', (event) => {
    if (event.target === archiveDetailDialog && !archiveAccessBusy) archiveDetailDialog.close()
  })

  async function load() {
    const request = ++requestVersion
    const cacheParams = { includeInactive: true }
    const cached = getReadCache('classifications', cacheParams)
    usageCheckPending = canManage && isClassificationManagementAvailable()
    usageError = ''
    if (cached) renderRecords(cached)
    else showLoading()
    try {
      let nextRecords = await fetchClassifications(cacheParams)
      if (!active || request !== requestVersion) return
      if (selectedClassification) {
        selectedClassification = nextRecords.find((record) => record.id === selectedClassification.id)
          ?? selectedClassification
      }
      if (canManage && isClassificationManagementAvailable()) {
        try {
          const usage = await fetchClassificationUsage()
          if (!active || request !== requestVersion) return
          usageCheckPending = false
          usageError = ''
          const usageById = new Map(usage.map((item) => [item.id, item.dipakai]))
          nextRecords = nextRecords.map((record) => ({
            ...record,
            dipakai: usageById.get(record.id) ?? true,
          }))
        } catch (error) {
          if (!active || request !== requestVersion) return
          console.error('Gagal memeriksa penggunaan klasifikasi:', error)
          usageCheckPending = false
          usageError = error.message
        }
      }
      renderRecords(nextRecords)
    } catch (error) {
      if (!active || request !== requestVersion) return
      console.error('Gagal memuat klasifikasi:', error)
      usageCheckPending = false
      usageError = 'Status penggunaan klasifikasi belum dapat diperiksa. Penghapusan permanen dinonaktifkan.'
      if (cached) renderRecords(cached)
      if (cached) showError(error.message, true)
      else showError(error.message)
    }
  }

  function onArchiveDataUpdated() {
    void load()
    if (archivesDialog.open) void loadClassificationArchives(archivesPage)
  }

  window.addEventListener('archive-data-updated', onArchiveDataUpdated)
  load()

  return {
    element: root,
    destroy() {
      active = false
      requestVersion += 1
      archivesRequestVersion += 1
      window.removeEventListener('archive-data-updated', onArchiveDataUpdated)
      if (editorDialog.open) editorDialog.close()
      if (deleteDialog.open) deleteDialog.close()
      if (archivesDialog.open) archivesDialog.close()
      if (archiveDetailDialog.open) archiveDetailDialog.close()
    },
  }
}
