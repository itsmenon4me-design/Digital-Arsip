import {
  ARCHIVE_CONTENT_TYPES,
  fetchClassifications,
  uploadArchive,
} from '../services/arsipService.js'
import { getReadCache } from '../services/readCache.js'
import { showToast } from './toast.js'

const ACCESS_LEVELS = [
  ['publik', 'Publik'],
  ['internal', 'Internal'],
  ['terbatas', 'Terbatas'],
  ['rahasia', 'Rahasia'],
]

function appendField(form, labelText, name, type = 'text') {
  const label = document.createElement('label')
  label.className = 'upload-field'
  const title = document.createElement('span')
  title.textContent = labelText
  const input = document.createElement('input')
  input.name = name
  input.type = type
  input.required = true
  input.autocomplete = 'off'
  label.append(title, input)
  form.append(label)
  return input
}

function makeOption(value, labelText) {
  const option = document.createElement('option')
  option.value = value
  option.textContent = labelText
  return option
}

export function createUploadModal({ onComplete = async () => {} } = {}) {
  const dialog = document.createElement('dialog')
  dialog.className = 'upload-dialog'
  dialog.setAttribute('aria-labelledby', 'upload-dialog-title')

  const form = document.createElement('form')
  form.className = 'upload-form'
  const header = document.createElement('div')
  header.className = 'dialog-header'
  const title = document.createElement('h2')
  title.id = 'upload-dialog-title'
  title.textContent = 'Unggah arsip'
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'button button-outline dialog-close'
  closeButton.textContent = 'Tutup'
  closeButton.addEventListener('click', () => dialog.close())
  header.append(title, closeButton)

  const intro = document.createElement('p')
  intro.textContent = 'Lengkapi identitas publikasi dan pilih berkas PDF, gambar, video, Excel, Word, atau PowerPoint hingga 50 MB.'

  const numberInput = appendField(form, 'Nomor arsip', 'nomorArsip')
  numberInput.maxLength = 120
  const titleInput = appendField(form, 'Judul', 'judul')
  titleInput.maxLength = 500
  const categoryInput = appendField(form, 'Kategori', 'kategori')
  categoryInput.maxLength = 120

  const contentTypeField = document.createElement('label')
  contentTypeField.className = 'upload-field'
  const contentTypeLabel = document.createElement('span')
  contentTypeLabel.textContent = 'Jenis konten'
  const contentTypeInput = document.createElement('select')
  contentTypeInput.name = 'jenisKonten'
  contentTypeInput.required = true
  contentTypeInput.append(makeOption('', 'Pilih jenis konten'))
  ARCHIVE_CONTENT_TYPES.forEach((value) => {
    contentTypeInput.append(makeOption(value, value))
  })
  contentTypeField.append(contentTypeLabel, contentTypeInput)
  form.append(contentTypeField)

  const publicationDateInput = appendField(form, 'Tanggal publikasi', 'tanggalPublikasi', 'date')
  const publicationChannelInput = appendField(form, 'Kanal publikasi', 'kanalPublikasi')
  publicationChannelInput.maxLength = 120
  const authorInput = appendField(form, 'Penulis atau pembuat konten (opsional)', 'penulis')
  authorInput.required = false
  authorInput.maxLength = 255
  const publicationUrlInput = appendField(form, 'Tautan publikasi asli (opsional)', 'tautanPublikasi', 'url')
  publicationUrlInput.required = false
  publicationUrlInput.maxLength = 2048
  const keywordsInput = appendField(form, 'Kata kunci (pisahkan dengan koma, opsional)', 'kataKunci')
  keywordsInput.required = false
  const eventNameInput = appendField(form, 'Nama kegiatan (opsional)', 'namaKegiatan')
  eventNameInput.required = false
  eventNameInput.maxLength = 255

  const classificationField = document.createElement('label')
  classificationField.className = 'upload-field'
  const classificationLabel = document.createElement('span')
  classificationLabel.textContent = 'Klasifikasi'
  const classificationSelect = document.createElement('select')
  classificationSelect.name = 'klasifikasiId'
  classificationSelect.required = true
  classificationSelect.append(makeOption('', 'Pilih klasifikasi'))
  classificationSelect.hidden = true
  const classificationSkeleton = document.createElement('span')
  classificationSkeleton.className = 'upload-classification-skeleton'
  classificationSkeleton.setAttribute('aria-hidden', 'true')
  classificationField.append(classificationLabel, classificationSelect)
  classificationField.append(classificationSkeleton)
  form.append(classificationField)

  const classificationState = document.createElement('div')
  classificationState.className = 'upload-lookup-state'
  classificationState.setAttribute('role', 'status')
  classificationState.hidden = true
  const retryClassifications = document.createElement('button')
  retryClassifications.type = 'button'
  retryClassifications.className = 'button button-outline'
  retryClassifications.textContent = 'Coba lagi'
  retryClassifications.hidden = true
  form.append(classificationState, retryClassifications)

  const retentionInput = appendField(form, 'Masa retensi (tahun)', 'masaRetensiTahun', 'number')
  retentionInput.min = '0'
  retentionInput.max = '100'
  retentionInput.step = '1'

  const accessField = document.createElement('label')
  accessField.className = 'upload-field'
  const accessLabel = document.createElement('span')
  accessLabel.textContent = 'Tingkat akses'
  const accessSelect = document.createElement('select')
  accessSelect.name = 'tingkatAkses'
  accessSelect.required = true
  ACCESS_LEVELS.forEach(([value, labelText]) => {
    accessSelect.append(makeOption(value, labelText))
  })
  accessField.append(accessLabel, accessSelect)
  form.append(accessField)

  const fileField = document.createElement('label')
  fileField.className = 'upload-field'
  const fileLabel = document.createElement('span')
  fileLabel.textContent = 'Berkas'
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.name = 'file'
  fileInput.required = true
  fileInput.accept = [
    '.pdf', '.jpg', '.jpeg', '.tif', '.tiff', '.png', '.mp4',
    '.xls', '.xlsx', '.doc', '.docx', '.ppt', '.pptx',
    'application/pdf', 'image/jpeg', 'image/tiff', 'image/png', 'video/mp4',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ].join(',')
  fileField.append(fileLabel, fileInput)
  form.append(fileField)

  const selectedFile = document.createElement('p')
  selectedFile.className = 'selected-file'
  selectedFile.setAttribute('role', 'status')
  const status = document.createElement('p')
  status.className = 'upload-message'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  const buttons = document.createElement('div')
  buttons.className = 'upload-actions'
  const submitButton = document.createElement('button')
  submitButton.type = 'submit'
  submitButton.className = 'button button-primary'
  submitButton.textContent = 'Simpan arsip dan unggah berkas'
  submitButton.disabled = true
  buttons.append(submitButton)

  const progress = document.createElement('div')
  progress.className = 'upload-progress'
  progress.hidden = true
  progress.setAttribute('role', 'status')
  progress.setAttribute('aria-label', 'Unggah berkas sedang berlangsung')
  const progressText = document.createElement('span')
  progressText.textContent = 'Menyimpan metadata dan mengunggah berkas…'
  const progressBar = document.createElement('progress')
  progressBar.setAttribute('aria-label', 'Progres unggah')
  progress.append(progressBar, progressText)

  form.append(selectedFile, status, progress, buttons)
  dialog.append(header, intro, form)
  document.body.append(dialog)

  let classificationsLoaded = false
  let busy = false

  function setClassifications(classifications) {
    const selectedId = classificationSelect.value
    classificationSelect.replaceChildren(makeOption('', 'Pilih klasifikasi'))
    classifications.forEach((classification) => {
      const option = makeOption(classification.id, `${classification.kode} · ${classification.nama}`)
      classificationSelect.append(option)
    })
    if (classifications.some((classification) => classification.id === selectedId)) {
      classificationSelect.value = selectedId
    }
    classificationSelect.hidden = false
    classificationSelect.disabled = false
    classificationSkeleton.hidden = true
    classificationField.removeAttribute('aria-busy')
    classificationsLoaded = classifications.length > 0
    classificationState.className = 'upload-lookup-state'
    classificationState.textContent = classificationsLoaded
      ? ''
      : 'Belum ada klasifikasi aktif. Minta administrator mengaktifkan atau menambahkan klasifikasi sebelum mengunggah.'
    classificationState.hidden = classificationsLoaded
    retryClassifications.hidden = classificationsLoaded
    submitButton.disabled = !classificationsLoaded
  }

  const cachedClassifications = getReadCache('classifications')
  if (cachedClassifications) setClassifications(cachedClassifications)

  async function loadClassifications() {
    retryClassifications.hidden = true
    classificationState.hidden = true
    classificationState.className = 'visually-hidden'
    classificationState.textContent = 'Memuat pilihan klasifikasi.'
    classificationField.setAttribute('aria-busy', 'true')
    classificationSelect.hidden = true
    classificationSelect.disabled = true
    classificationSkeleton.hidden = false
    submitButton.disabled = true
    try {
      const classifications = await fetchClassifications()
      setClassifications(classifications)
    } catch (error) {
      classificationsLoaded = false
      classificationField.removeAttribute('aria-busy')
      classificationSelect.hidden = false
      classificationSelect.disabled = true
      classificationSkeleton.hidden = true
      classificationState.className = 'upload-lookup-state'
      classificationState.textContent = error.message
      classificationState.hidden = false
      retryClassifications.hidden = false
      submitButton.disabled = true
    }
  }

  retryClassifications.addEventListener('click', loadClassifications)
  const onClassificationsUpdated = () => {
    classificationsLoaded = false
    if (dialog.open && !busy) loadClassifications()
  }
  window.addEventListener('classifications-updated', onClassificationsUpdated)
  fileInput.addEventListener('change', () => {
    selectedFile.textContent = fileInput.files?.[0]?.name ?? ''
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy || !classificationsLoaded || !form.reportValidity()) return

    const file = fileInput.files?.[0]
    const retentionYears = Number(retentionInput.value)
    if (!Number.isInteger(retentionYears) || retentionYears < 0 || retentionYears > 100) {
      status.textContent = 'Masa retensi harus berupa bilangan bulat antara 0 dan 100 tahun.'
      status.setAttribute('role', 'alert')
      return
    }
    if (!file) {
      status.textContent = 'Pilih berkas yang akan diunggah.'
      status.setAttribute('role', 'alert')
      return
    }

    const retentionDate = new Date()
    retentionDate.setFullYear(retentionDate.getFullYear() + retentionYears)
    const metadata = {
      nomorArsip: numberInput.value,
      judul: titleInput.value,
      kategori: categoryInput.value,
      jenisKonten: contentTypeInput.value,
      klasifikasiId: classificationSelect.value,
      masaRetensiTahun: retentionYears,
      tanggalRetensi: retentionDate.toISOString().slice(0, 10),
      tanggalPublikasi: publicationDateInput.value || null,
      kanalPublikasi: publicationChannelInput.value.trim(),
      penulis: authorInput.value.trim(),
      tautanPublikasi: publicationUrlInput.value.trim(),
      kataKunci: keywordsInput.value,
      namaKegiatan: eventNameInput.value.trim(),
      tingkatAkses: accessSelect.value,
    }

    busy = true
    status.textContent = ''
    status.setAttribute('role', 'status')
    progress.hidden = false
    for (const control of form.elements) control.disabled = true
    closeButton.disabled = true
    try {
      const archiveId = await uploadArchive({ file, metadata })
      form.reset()
      selectedFile.textContent = ''
      dialog.close()
      showToast(`Arsip berhasil diunggah. ID arsip: ${archiveId}.`)
      window.dispatchEvent(new CustomEvent('archive-upload-complete', {
        detail: { archiveId },
      }))
      void onComplete().catch((error) => {
        console.error('Gagal memperbarui tampilan setelah unggah arsip:', error)
      })
    } catch (error) {
      status.textContent = error.message
      status.classList.remove('is-success')
      status.setAttribute('role', 'alert')
    } finally {
      busy = false
      progress.hidden = true
      closeButton.disabled = false
      for (const control of form.elements) control.disabled = false
      submitButton.disabled = !classificationsLoaded
    }
  })

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && !busy) dialog.close()
  })
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault()
  })

  return {
    open(file = null) {
      status.textContent = ''
      status.classList.remove('is-success')
      fileInput.value = ''
      selectedFile.textContent = ''
      if (file) {
        const transfer = new DataTransfer()
        transfer.items.add(file)
        fileInput.files = transfer.files
        selectedFile.textContent = file.name
      }
      if (!dialog.open) dialog.showModal()
      if (!classificationsLoaded) loadClassifications()
    },
    destroy() {
      window.removeEventListener('classifications-updated', onClassificationsUpdated)
      dialog.remove()
    },
  }
}
