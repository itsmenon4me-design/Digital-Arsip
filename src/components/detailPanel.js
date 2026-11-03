import { createArchiveAccessUrl, isRetentionDue } from '../services/arsipService.js'
import { recognizeArchive } from '../services/ocrService.js'

const statusLabels = {
  terverifikasi: 'Terverifikasi',
  menunggu_verifikasi: 'Menunggu verifikasi',
  perlu_perbaikan: 'Perlu perbaikan',
  inaktif: 'Inaktif',
  dimusnahkan: 'Dimusnahkan',
}

function makeValueRow(label, value) {
  const row = document.createElement('div')
  row.className = 'detail-row'
  const term = document.createElement('dt')
  term.textContent = label
  const description = document.createElement('dd')
  description.textContent = value
  row.append(term, description)
  return row
}

function makeSkeletonValueRow(label) {
  const row = document.createElement('div')
  row.className = 'detail-row'
  row.setAttribute('aria-hidden', 'true')
  const term = document.createElement('dt')
  term.textContent = label
  const description = document.createElement('dd')
  const placeholder = document.createElement('span')
  placeholder.className = 'detail-skeleton-line'
  description.append(placeholder)
  row.append(term, description)
  return row
}

function formatDateTime(value) {
  if (!value) return 'Tidak tersedia'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Tanggal tidak valid'
    : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function isOcrSupported(archive) {
  const fileName = archive?.nama_berkas || archive?.file_path || ''
  return /\.(pdf|jpe?g|png)$/i.test(fileName)
}

function archiveMimeType(archive) {
  if (archive?.tipe_file) return archive.tipe_file.toLowerCase().split(';', 1)[0].trim()
  const extension = (archive?.nama_berkas || archive?.file_path || '')
    .split('.')
    .pop()
    ?.toLowerCase()
  return {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    png: 'image/png',
    mp4: 'video/mp4',
  }[extension] ?? ''
}

export function createDetailPanel({ onEdit, onDelete, onVerify, onDestroy } = {}) {
  const section = document.createElement('section')
  section.className = 'panel detail-panel'
  section.setAttribute('aria-labelledby', 'selected-archive-title')

  const eyebrow = document.createElement('p')
  eyebrow.className = 'section-kicker'
  eyebrow.textContent = 'PILIHAN ARSIP'
  const title = document.createElement('h2')
  title.id = 'selected-archive-title'
  title.tabIndex = -1
  title.textContent = 'Detail Arsip Terpilih'

  const preview = document.createElement('div')
  preview.className = 'document-preview'
  preview.setAttribute('aria-label', 'Area pratinjau dokumen')
  const previewDialog = document.createElement('dialog')
  previewDialog.className = 'ocr-dialog archive-preview-dialog'
  previewDialog.setAttribute('aria-labelledby', 'archive-preview-title')
  const previewHeader = document.createElement('div')
  previewHeader.className = 'dialog-header'
  const previewTitle = document.createElement('h2')
  previewTitle.id = 'archive-preview-title'
  previewTitle.textContent = 'Pratinjau berkas'
  const previewCloseButton = document.createElement('button')
  previewCloseButton.type = 'button'
  previewCloseButton.className = 'button button-outline'
  previewCloseButton.textContent = 'Tutup'
  previewHeader.append(previewTitle, previewCloseButton)
  const previewStatus = document.createElement('p')
  previewStatus.className = 'panel-note preview-dialog-status'
  previewStatus.setAttribute('role', 'status')
  previewStatus.setAttribute('aria-live', 'polite')
  const previewContent = document.createElement('div')
  previewContent.className = 'preview-dialog-content'
  previewDialog.append(previewHeader, previewStatus, previewContent)

  const metadata = document.createElement('dl')
  metadata.className = 'detail-list'
  const actions = document.createElement('div')
  actions.className = 'detail-actions'
  const openButton = document.createElement('button')
  openButton.type = 'button'
  openButton.className = 'button button-primary'
  openButton.textContent = 'Buka'
  openButton.disabled = true
  const downloadButton = document.createElement('button')
  downloadButton.type = 'button'
  downloadButton.className = 'button button-outline'
  downloadButton.textContent = 'Unduh'
  downloadButton.disabled = true
  actions.append(openButton, downloadButton)

  const mutationActions = document.createElement('div')
  mutationActions.className = 'detail-mutation-actions'
  const editButton = document.createElement('button')
  editButton.type = 'button'
  editButton.className = 'button button-outline'
  editButton.textContent = 'Edit'
  editButton.disabled = true
  editButton.hidden = !onEdit
  const deleteButton = document.createElement('button')
  deleteButton.type = 'button'
  deleteButton.className = 'button button-danger'
  deleteButton.textContent = 'Hapus'
  deleteButton.disabled = true
  deleteButton.hidden = !onDelete
  mutationActions.append(editButton, deleteButton)
  mutationActions.hidden = !onEdit && !onDelete

  const workflowActions = document.createElement('div')
  workflowActions.className = 'detail-mutation-actions'
  const verifyButton = document.createElement('button')
  verifyButton.type = 'button'
  verifyButton.className = 'button button-outline'
  verifyButton.textContent = 'Verifikasi arsip'
  verifyButton.hidden = !onVerify
  const destroyButton = document.createElement('button')
  destroyButton.type = 'button'
  destroyButton.className = 'button button-danger'
  destroyButton.textContent = 'Catat pemusnahan'
  destroyButton.hidden = !onDestroy
  workflowActions.append(verifyButton, destroyButton)

  const ocrActions = document.createElement('div')
  ocrActions.className = 'detail-mutation-actions'
  const ocrButton = document.createElement('button')
  ocrButton.type = 'button'
  ocrButton.className = 'button button-outline'
  ocrButton.textContent = 'Jalankan OCR'
  ocrActions.append(ocrButton)

  const ocrDialog = document.createElement('dialog')
  ocrDialog.className = 'ocr-dialog'
  ocrDialog.setAttribute('aria-labelledby', 'ocr-dialog-title')
  const ocrHeader = document.createElement('div')
  ocrHeader.className = 'dialog-header'
  const ocrTitle = document.createElement('h2')
  ocrTitle.id = 'ocr-dialog-title'
  ocrTitle.textContent = 'Hasil OCR'
  const ocrCloseButton = document.createElement('button')
  ocrCloseButton.type = 'button'
  ocrCloseButton.className = 'button button-outline'
  ocrCloseButton.textContent = 'Tutup'
  ocrHeader.append(ocrTitle, ocrCloseButton)
  const ocrDescription = document.createElement('p')
  ocrDescription.textContent = 'Pemrosesan dilakukan di browser ini. Hasil pengenalan dapat keliru dan tidak disimpan ke arsip.'
  const ocrStatus = document.createElement('p')
  ocrStatus.className = 'panel-note ocr-status'
  ocrStatus.setAttribute('role', 'status')
  ocrStatus.setAttribute('aria-live', 'polite')
  const ocrProgress = document.createElement('progress')
  ocrProgress.max = 1
  ocrProgress.value = 0
  ocrProgress.setAttribute('aria-label', 'Kemajuan OCR')
  const ocrResultLabel = document.createElement('label')
  ocrResultLabel.className = 'ocr-result-label'
  ocrResultLabel.textContent = 'Teks hasil pengenalan'
  const ocrResult = document.createElement('textarea')
  ocrResult.className = 'ocr-result'
  ocrResult.readOnly = true
  ocrResult.placeholder = 'Hasil OCR akan muncul di sini.'
  ocrResultLabel.append(ocrResult)
  const ocrCopyButton = document.createElement('button')
  ocrCopyButton.type = 'button'
  ocrCopyButton.className = 'button button-outline'
  ocrCopyButton.textContent = 'Salin teks'
  ocrCopyButton.disabled = true
  const ocrFooter = document.createElement('div')
  ocrFooter.className = 'ocr-dialog-actions'
  ocrFooter.append(ocrCopyButton)
  ocrDialog.append(ocrHeader, ocrDescription, ocrStatus, ocrProgress, ocrResultLabel, ocrFooter)

  const message = document.createElement('p')
  message.className = 'panel-note detail-message'
  message.setAttribute('role', 'status')
  message.setAttribute('aria-live', 'polite')
  section.append(
    eyebrow,
    title,
    preview,
    metadata,
    actions,
    mutationActions,
    workflowActions,
    ocrActions,
    message,
    previewDialog,
    ocrDialog,
  )

  let selectedArchive = null
  let busy = false
  let loading = false
  let ocrController = null
  let previewRequest = 0
  let previewOpener = null

  function isPreviewSupported(archive) {
    const mimeType = archiveMimeType(archive)
    return mimeType.startsWith('image/')
      || mimeType === 'video/mp4'
      || mimeType === 'application/pdf'
  }

  function showPreviewCard(archive) {
    const page = document.createElement('div')
    page.className = 'preview-page'
    const label = document.createElement('span')
    label.className = 'preview-label'
    label.textContent = archive?.file_path ? 'BERKAS ARSIP' : 'PRATINJAU'
    const name = document.createElement('strong')
    name.textContent = archive?.nama_berkas ?? archive?.judul ?? 'Belum ada dokumen dipilih'
    const number = document.createElement('span')
    number.className = 'preview-number'
    number.textContent = archive?.nomor_arsip ?? 'Pilih arsip dari daftar'
    page.append(label, name, number)
    if (archive?.file_path && archive.file_status === 'tersedia' && isPreviewSupported(archive)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'button button-outline preview-open-button'
      button.textContent = 'Lihat pratinjau'
      button.setAttribute('aria-label', `Lihat pratinjau berkas ${archive.nama_berkas || archive.judul}`)
      button.addEventListener('click', openPreview)
      page.append(button)
    } else if (archive?.file_path) {
      const formatNote = document.createElement('span')
      formatNote.className = 'preview-status'
      formatNote.textContent = 'Gunakan Buka atau Unduh untuk format berkas ini.'
      page.append(formatNote)
    }
    preview.replaceChildren(page)
  }

  async function openPreview(event) {
    const archive = selectedArchive
    if (!archive?.file_path || archive.file_status !== 'tersedia' || !isPreviewSupported(archive)) return

    const request = ++previewRequest
    const mimeType = archiveMimeType(archive)
    previewOpener = event.currentTarget
    previewTitle.textContent = archive.nama_berkas || archive.judul || 'Pratinjau berkas'
    previewStatus.setAttribute('role', 'status')
    previewStatus.textContent = 'Menyiapkan tautan pratinjau...'
    previewContent.replaceChildren()
    previewDialog.showModal()
    try {
      const url = await createArchiveAccessUrl(archive, 'buka', 300)
      if (
        request !== previewRequest
        || selectedArchive?.id !== archive.id
        || !previewDialog.open
      ) return
      let media
      if (mimeType.startsWith('image/')) {
        media = document.createElement('img')
        media.className = 'preview-dialog-media preview-dialog-image'
        media.alt = `Pratinjau ${archive.nama_berkas || archive.judul}`
        media.addEventListener('error', () => {
          if (request === previewRequest) {
            previewStatus.setAttribute('role', 'alert')
            previewStatus.textContent = 'Berkas gambar tidak dapat ditampilkan. Gunakan Buka atau Unduh untuk memeriksa berkas.'
          }
        }, { once: true })
      } else if (mimeType === 'video/mp4') {
        media = document.createElement('video')
        media.className = 'preview-dialog-media preview-dialog-video'
        media.controls = true
        media.playsInline = true
        media.preload = 'metadata'
        media.setAttribute('aria-label', `Pratinjau ${archive.nama_berkas || archive.judul}`)
        media.addEventListener('error', () => {
          if (request === previewRequest) {
            previewStatus.setAttribute('role', 'alert')
            previewStatus.textContent = 'Video tidak dapat diputar. Gunakan Buka atau Unduh untuk memeriksa berkas.'
          }
        }, { once: true })
      } else {
        media = document.createElement('embed')
        media.className = 'preview-dialog-media preview-dialog-pdf'
        media.type = 'application/pdf'
        media.setAttribute('aria-label', `Pratinjau PDF ${archive.nama_berkas || archive.judul}`)
      }
      media.src = url
      previewStatus.textContent = ''
      previewContent.replaceChildren(media)
    } catch (error) {
      if (
        request !== previewRequest
        || selectedArchive?.id !== archive.id
        || !previewDialog.open
      ) return
      previewStatus.setAttribute('role', 'alert')
      previewStatus.textContent = `Pratinjau gagal dimuat: ${error.message}`
    }
  }

  function resetPreview(archive) {
    previewRequest += 1
    previewOpener = null
    if (previewDialog.open) previewDialog.close()
    previewStatus.textContent = ''
    previewContent.replaceChildren()
    showPreviewCard(archive)
  }

  function cancelOcr() {
    if (ocrController) ocrController.abort()
    if (ocrDialog.open) ocrDialog.close()
  }

  function updateActionState() {
    const available = Boolean(
      !loading && selectedArchive?.file_path && selectedArchive.file_status === 'tersedia',
    )
    openButton.disabled = busy || loading || !available
    downloadButton.disabled = busy || loading || !available
    ocrButton.disabled = busy || loading || !available || !isOcrSupported(selectedArchive)
    const canManageRecord = Boolean(
      selectedArchive
      && selectedArchive.file_status === 'tersedia'
      && selectedArchive.status !== 'dimusnahkan',
    )
    const dueForDestruction = isRetentionDue(selectedArchive?.tanggal_retensi)
      && selectedArchive?.status !== 'dimusnahkan'
    editButton.disabled = busy || loading || !canManageRecord
    deleteButton.hidden = dueForDestruction
    deleteButton.disabled = busy || loading || !canManageRecord || dueForDestruction
    const reviewable = Boolean(
      ['menunggu_verifikasi', 'perlu_perbaikan'].includes(selectedArchive?.status)
      && selectedArchive?.file_status === 'tersedia'
      && selectedArchive?.file_path,
    )
    verifyButton.hidden = !onVerify || !reviewable
    verifyButton.disabled = busy || loading || !reviewable
    destroyButton.hidden = !onDestroy || !dueForDestruction
    destroyButton.textContent = selectedArchive?.file_status === 'penghapusan_tertunda'
      ? 'Lanjutkan pemusnahan'
      : 'Catat pemusnahan'
    destroyButton.disabled = busy || loading || !dueForDestruction
  }

  function render(selected) {
    cancelOcr()
    loading = false
    section.removeAttribute('aria-busy')
    selectedArchive = selected
    const classification = Array.isArray(selected?.klasifikasi)
      ? selected.klasifikasi[0]
      : selected?.klasifikasi
    const status = selected && Object.hasOwn(statusLabels, selected.status)
      ? statusLabels[selected.status]
      : selected?.status
    const rows = selected
      ? [
          makeValueRow('Kategori', selected.kategori ?? 'Tidak tersedia'),
          makeValueRow('Status', status ?? 'Tidak tersedia'),
          makeValueRow('Klasifikasi', classification?.nama ?? 'Klasifikasi dihapus'),
          makeValueRow('Unit pencipta', selected.unit_pencipta ?? 'Belum dipilih'),
          makeValueRow('Jenis konten', selected.jenis_konten ?? 'Belum ditentukan'),
          makeValueRow('Tanggal publikasi', selected.tanggal_publikasi ?? 'Belum dicatat'),
          makeValueRow('Kanal publikasi', selected.kanal_publikasi ?? 'Belum dicatat'),
          makeValueRow('Kegiatan', selected.nama_kegiatan ?? 'Belum dicatat'),
          makeValueRow('Penulis atau pembuat konten', selected.penulis ?? 'Belum dicatat'),
          makeValueRow('Tautan publikasi asli', selected.tautan_publikasi ?? 'Belum dicatat'),
          makeValueRow(
            'Kata kunci',
            Array.isArray(selected.kata_kunci) && selected.kata_kunci.length
              ? selected.kata_kunci.join(', ')
              : 'Belum dicatat',
          ),
          makeValueRow('Tipe berkas', selected.tipe_file ?? 'Belum dicatat'),
          makeValueRow(
            'Retensi',
            selected.masa_retensi_tahun == null
              ? 'Belum ditentukan'
              : `${selected.masa_retensi_tahun} tahun${selected.tanggal_retensi ? `, sampai ${selected.tanggal_retensi}` : ''}`,
          ),
          makeValueRow('Hak akses', selected.tingkat_akses ?? 'Belum dipilih'),
          makeValueRow('Tanggal unggah', formatDateTime(selected.created_at)),
          ...(selected.diverifikasi_pada
            ? [
                makeValueRow('Diperiksa pada', formatDateTime(selected.diverifikasi_pada)),
                makeValueRow('Pemeriksa', selected.diverifikasi_oleh ?? 'Tidak tersedia'),
              ]
            : []),
          ...(selected.catatan_verifikasi
            ? [makeValueRow('Catatan verifikasi', selected.catatan_verifikasi)]
            : []),
          ...(selected.pemusnahan_berita_acara
            ? [
                makeValueRow('Berita acara pemusnahan', selected.pemusnahan_berita_acara),
                ...(selected.pemusnahan_catatan
                  ? [makeValueRow('Catatan pemusnahan', selected.pemusnahan_catatan)]
                  : []),
                makeValueRow('Status berkas', selected.file_status === 'penghapusan_tertunda'
                  ? 'Pemusnahan perlu dilanjutkan'
                  : selected.file_status === 'dimusnahkan'
                    ? 'Berkas dimusnahkan'
                    : selected.file_status),
              ]
            : []),
          ...(selected.tanggal_pemusnahan
            ? [makeValueRow('Dimusnahkan pada', formatDateTime(selected.tanggal_pemusnahan))]
            : []),
        ]
      : []
    metadata.replaceChildren(...rows)
    resetPreview(selected)
    message.textContent = selected?.file_status === 'penghapusan_tertunda'
      ? 'Pemusnahan sudah dimulai. Berkas terkunci dan proses perlu dilanjutkan dari halaman Jadwal Retensi.'
      : selected && !selected.file_path
        ? 'Arsip ini belum memiliki berkas digital.'
        : selected?.file_path && !isOcrSupported(selected)
          ? 'OCR hanya mendukung berkas PDF, JPG, JPEG, dan PNG.'
      : ''
    message.setAttribute('role', 'status')
    updateActionState()
  }

  function showLoading() {
    cancelOcr()
    loading = true
    selectedArchive = null
    resetPreview(null)
    section.setAttribute('aria-busy', 'true')
    metadata.replaceChildren(
      ...[
        'Kategori',
        'Status',
        'Klasifikasi',
        'Unit pencipta',
        'Tanggal publikasi',
        'Kanal publikasi',
        'Kegiatan',
        'Retensi',
        'Hak akses',
        'Tanggal unggah',
        'Pemeriksa',
      ].map(makeSkeletonValueRow),
    )
    message.textContent = ''
    message.setAttribute('role', 'status')
    updateActionState()
  }

  function showError() {
    cancelOcr()
    loading = false
    section.removeAttribute('aria-busy')
    selectedArchive = null
    resetPreview(null)
    metadata.replaceChildren()
    message.textContent = 'Detail arsip gagal dimuat. Klik baris untuk mencoba lagi.'
    message.setAttribute('role', 'alert')
    updateActionState()
  }

  ocrButton.addEventListener('click', async () => {
    if (!selectedArchive || busy || !isOcrSupported(selectedArchive)) return
    const archive = selectedArchive
    const controller = new AbortController()
    ocrController = controller
    busy = true
    ocrResult.value = ''
    ocrCopyButton.disabled = true
    ocrProgress.value = 0
    ocrProgress.hidden = false
    ocrStatus.textContent = 'Memeriksa akses berkas...'
    ocrStatus.setAttribute('role', 'status')
    ocrDialog.showModal()
    ocrCloseButton.textContent = 'Batalkan OCR'
    message.textContent = 'Menyiapkan pemrosesan OCR di browser...'
    message.setAttribute('role', 'status')
    updateActionState()

    try {
      const url = await createArchiveAccessUrl(archive, 'buka', 300)
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error('Berkas arsip gagal diambil. Periksa koneksi atau izin akses.')
      const contentLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(contentLength) && contentLength > 50 * 1024 * 1024) {
        throw new Error('Ukuran berkas melebihi batas OCR 50 MB.')
      }
      const blob = await response.blob()
      const text = await recognizeArchive(blob, archive.nama_berkas || archive.file_path, {
        signal: controller.signal,
        onProgress({ status, progress, page, totalPages }) {
          ocrProgress.value = Math.min(1, Math.max(0, progress || 0))
          if (status === 'loading-engine') {
            ocrStatus.textContent = 'Memuat mesin OCR dan bahasa Indonesia...'
          } else if (status === 'reading-page') {
            ocrStatus.textContent = `Membaca teks halaman ${page} dari ${totalPages}...`
          } else {
            ocrStatus.textContent = page
              ? `Mengenali teks halaman ${page} dari ${totalPages}...`
              : 'Mengenali teks pada berkas...'
          }
        },
      })
      if (controller.signal.aborted) return
      ocrResult.value = text
      ocrCopyButton.disabled = !text
      ocrStatus.textContent = text
        ? 'Selesai. Periksa kembali teks karena OCR dapat salah membaca dokumen.'
        : 'Tidak ada teks yang berhasil dikenali dari berkas ini.'
      ocrProgress.value = 1
      message.textContent = 'OCR selesai. Hasil hanya tersedia sementara di dialog ini.'
    } catch (error) {
      if (controller.signal.aborted) {
        ocrStatus.textContent = 'OCR dibatalkan.'
      } else {
        ocrStatus.textContent = error.message || 'OCR gagal diproses.'
        ocrStatus.setAttribute('role', 'alert')
        message.textContent = ocrStatus.textContent
        message.setAttribute('role', 'alert')
      }
      ocrProgress.hidden = true
    } finally {
      if (ocrController === controller) {
        ocrController = null
        busy = false
        ocrCloseButton.textContent = 'Tutup'
        updateActionState()
      }
    }
  })

  ocrCloseButton.addEventListener('click', () => {
    if (ocrController) {
      ocrController.abort()
      return
    }
    ocrDialog.close()
  })

  ocrDialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (ocrController) ocrController.abort()
    else ocrDialog.close()
  })

  ocrDialog.addEventListener('cancel', (event) => {
    if (ocrController) {
      event.preventDefault()
      ocrController.abort()
    }
  })

  ocrDialog.addEventListener('close', () => {
    ocrResult.value = ''
    ocrCopyButton.disabled = true
    ocrStatus.textContent = ''
    ocrProgress.value = 0
  })

  ocrCopyButton.addEventListener('click', async () => {
    if (!ocrResult.value) return
    try {
      await navigator.clipboard.writeText(ocrResult.value)
      ocrStatus.textContent = 'Teks hasil OCR berhasil disalin.'
      ocrStatus.setAttribute('role', 'status')
    } catch (error) {
      ocrStatus.textContent = `Teks tidak dapat disalin: ${error.message}`
      ocrStatus.setAttribute('role', 'alert')
    }
  })

  previewCloseButton.addEventListener('click', () => previewDialog.close())
  previewDialog.addEventListener('close', () => {
    previewRequest += 1
    previewContent.replaceChildren()
    if (previewOpener?.isConnected && !previewOpener.disabled) previewOpener.focus()
    previewOpener = null
  })

  openButton.addEventListener('click', async () => {
    if (!selectedArchive || busy) return
    const previewTab = window.open('about:blank', '_blank')
    if (!previewTab) {
      message.textContent = 'Tab pratinjau diblokir browser. Izinkan pop-up lalu coba lagi.'
      message.setAttribute('role', 'alert')
      return
    }
    previewTab.opener = null
    busy = true
    message.textContent = 'Menyiapkan pratinjau dan mencatat akses…'
    message.setAttribute('role', 'status')
    updateActionState()
    try {
      const url = await createArchiveAccessUrl(selectedArchive, 'buka')
      previewTab.location.replace(url)
      message.textContent = 'Pratinjau dibuka. Tautan bertanda tangan berlaku selama 60 detik.'
    } catch (error) {
      previewTab.close()
      message.textContent = error.message
      message.setAttribute('role', 'alert')
    } finally {
      busy = false
      updateActionState()
    }
  })

  downloadButton.addEventListener('click', async () => {
    if (!selectedArchive || busy) return
    busy = true
    message.textContent = 'Menyiapkan unduhan dan mencatat akses…'
    message.setAttribute('role', 'status')
    updateActionState()
    try {
      const url = await createArchiveAccessUrl(selectedArchive, 'unduh')
      const link = document.createElement('a')
      link.href = url
      link.download = selectedArchive.nama_berkas || 'arsip'
      link.rel = 'noopener'
      document.body.append(link)
      link.click()
      link.remove()
      message.textContent = 'Unduhan dimulai. Tautan bertanda tangan berlaku selama 60 detik.'
    } catch (error) {
      message.textContent = error.message
      message.setAttribute('role', 'alert')
    } finally {
      busy = false
      updateActionState()
    }
  })

  editButton.addEventListener('click', () => {
    if (selectedArchive && !busy) onEdit?.(selectedArchive)
  })
  deleteButton.addEventListener('click', () => {
    if (selectedArchive && !busy) onDelete?.(selectedArchive)
  })
  verifyButton.addEventListener('click', () => {
    if (selectedArchive && !busy) onVerify?.(selectedArchive)
  })
  destroyButton.addEventListener('click', () => {
    if (selectedArchive && !busy) onDestroy?.(selectedArchive)
  })

  render(null)
  return {
    element: section,
    render,
    showLoading,
    showError,
    focusHeading() {
      title.focus()
    },
  }
}
