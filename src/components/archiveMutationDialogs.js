import {
  ARCHIVE_CONTENT_TYPES,
  fetchClassifications,
  permanentlyDeleteArchive,
  updateArchive,
} from '../services/arsipService.js'
import { showToast } from './toast.js'
import { getReadCache } from '../services/readCache.js'

const ACCESS_LEVELS = [
  ['publik', 'Publik'],
  ['internal', 'Internal'],
  ['terbatas', 'Terbatas'],
  ['rahasia', 'Rahasia'],
]

function makeButton(label, className, type = 'button') {
  const button = document.createElement('button')
  button.type = type
  button.className = className
  button.textContent = label
  return button
}

function makeField(labelText, name, type = 'text') {
  const label = document.createElement('label')
  label.className = 'archive-mutation-field'
  const caption = document.createElement('span')
  caption.textContent = labelText
  const control = type === 'select'
    ? document.createElement('select')
    : document.createElement('input')
  if (type !== 'select') control.type = type
  control.name = name
  control.id = `archive-mutation-${name}`
  control.setAttribute('aria-describedby', `${control.id}-error`)
  const error = document.createElement('span')
  error.className = 'archive-field-error'
  error.id = `${control.id}-error`
  error.setAttribute('aria-live', 'polite')
  label.append(caption, control, error)
  return { label, control, error }
}

function setFieldError(field, message) {
  field.error.textContent = message
  if (message) field.control.setAttribute('aria-invalid', 'true')
  else field.control.removeAttribute('aria-invalid')
}

function setOptions(select, options) {
  select.replaceChildren()
  options.forEach(([value, label]) => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    select.append(option)
  })
}

function classificationOptions(classifications, currentId) {
  return [
    ['', 'Pilih klasifikasi'],
    ...classifications
      .filter((item) => item.aktif || item.id === currentId)
      .map((item) => [
        item.id,
        `${item.kode} · ${item.nama}${item.aktif ? '' : ' (nonaktif, arsip ini)'}`,
      ]),
  ]
}

function normalizeKeywords(value) {
  return [...new Set(
    String(value ?? '')
      .split(',')
      .map((keyword) => keyword.trim())
      .filter(Boolean),
  )].sort()
}

function mutationMessage(error) {
  const code = String(error?.code ?? '').toUpperCase()
  if (code === '42501') return 'Akses administrator diperlukan untuk tindakan ini.'
  return error?.message || 'Tindakan gagal. Coba lagi atau hubungi administrator.'
}

export function createArchiveMutationDialogs({ onUpdated, onDeleted }) {
  const editDialog = document.createElement('dialog')
  editDialog.className = 'archive-mutation-dialog'
  editDialog.setAttribute('aria-labelledby', 'archive-edit-title')
  const editForm = document.createElement('form')
  editForm.className = 'archive-mutation-form'
  const editHeader = document.createElement('div')
  editHeader.className = 'dialog-header'
  const editTitle = document.createElement('h2')
  editTitle.id = 'archive-edit-title'
  editTitle.textContent = 'Edit arsip'
  const editClose = makeButton('Tutup', 'button button-outline dialog-close')
  editHeader.append(editTitle, editClose)
  const editIntro = document.createElement('p')
  editIntro.className = 'archive-mutation-note'
  editIntro.textContent = 'Berkas tidak dapat diubah di sini.'
  const titleField = makeField('Judul', 'judul')
  titleField.control.required = true
  titleField.control.maxLength = 500
  titleField.control.autocomplete = 'off'
  const classificationField = makeField('Klasifikasi', 'klasifikasi', 'select')
  classificationField.control.required = true
  const unitField = makeField('Unit pencipta', 'unit')
  unitField.control.required = true
  unitField.control.maxLength = 255
  unitField.control.autocomplete = 'organization'
  const contentTypeField = makeField('Jenis konten', 'jenis-konten', 'select')
  setOptions(contentTypeField.control, [
    ['', 'Belum ditentukan'],
    ...ARCHIVE_CONTENT_TYPES.map((value) => [value, value]),
  ])
  const publicationDateField = makeField('Tanggal publikasi (opsional)', 'tanggal-publikasi', 'date')
  const publicationChannelField = makeField('Kanal publikasi (opsional)', 'kanal-publikasi')
  publicationChannelField.control.maxLength = 120
  const eventNameField = makeField('Nama kegiatan (opsional)', 'nama-kegiatan')
  eventNameField.control.maxLength = 255
  const authorField = makeField('Penulis atau pembuat konten (opsional)', 'penulis')
  authorField.control.maxLength = 255
  const publicationUrlField = makeField('Tautan publikasi asli (opsional)', 'tautan-publikasi', 'url')
  publicationUrlField.control.maxLength = 2048
  const keywordsField = makeField('Kata kunci (pisahkan dengan koma, opsional)', 'kata-kunci')
  const accessField = makeField('Hak akses', 'hak-akses', 'select')
  setOptions(accessField.control, ACCESS_LEVELS)
  const editStatus = document.createElement('p')
  editStatus.className = 'archive-mutation-status'
  editStatus.setAttribute('role', 'status')
  editStatus.setAttribute('aria-live', 'polite')
  const editActions = document.createElement('div')
  editActions.className = 'archive-mutation-actions'
  const editCancel = makeButton('Batal', 'button button-outline')
  const saveButton = makeButton('Simpan perubahan', 'button button-primary', 'submit')
  editActions.append(editCancel, saveButton)
  editForm.append(
    titleField.label,
    classificationField.label,
    unitField.label,
    contentTypeField.label,
    publicationDateField.label,
    publicationChannelField.label,
    eventNameField.label,
    authorField.label,
    publicationUrlField.label,
    keywordsField.label,
    accessField.label,
    editIntro,
    editStatus,
    editActions,
  )
  editDialog.append(editHeader, editForm)

  const deleteDialog = document.createElement('dialog')
  deleteDialog.className = 'archive-mutation-dialog archive-delete-dialog'
  deleteDialog.setAttribute('aria-labelledby', 'archive-delete-title')
  const deleteForm = document.createElement('form')
  deleteForm.className = 'archive-mutation-form'
  const deleteHeader = document.createElement('div')
  deleteHeader.className = 'dialog-header'
  const deleteTitle = document.createElement('h2')
  deleteTitle.id = 'archive-delete-title'
  deleteTitle.textContent = 'Hapus arsip ini?'
  const deleteClose = makeButton('Tutup', 'button button-outline dialog-close')
  deleteHeader.append(deleteTitle, deleteClose)
  const deleteSummary = document.createElement('p')
  deleteSummary.className = 'archive-delete-summary'
  const deleteStatus = document.createElement('p')
  deleteStatus.className = 'archive-mutation-status'
  deleteStatus.setAttribute('role', 'status')
  deleteStatus.setAttribute('aria-live', 'polite')
  const deleteActions = document.createElement('div')
  deleteActions.className = 'archive-mutation-actions'
  const deleteCancel = makeButton('Batal', 'button button-outline')
  const confirmDelete = makeButton('Hapus', 'button button-danger', 'submit')
  deleteCancel.autofocus = true
  deleteActions.append(deleteCancel, confirmDelete)
  deleteForm.append(
    deleteSummary,
    deleteStatus,
    deleteActions,
  )
  deleteDialog.append(deleteHeader, deleteForm)
  document.body.append(editDialog, deleteDialog)

  let editArchive = null
  let deleteArchive = null
  let editClassifications = []
  let editLoading = false
  let editSaving = false
  let deleteSaving = false
  let editOpener = null
  let deleteOpener = null

  function editValues() {
    return {
      judul: titleField.control.value.trim(),
      klasifikasiId: classificationField.control.value,
      unitPencipta: unitField.control.value.trim(),
      tingkatAkses: accessField.control.value,
      tanggalPublikasi: publicationDateField.control.value || null,
      kanalPublikasi: publicationChannelField.control.value.trim(),
      namaKegiatan: eventNameField.control.value.trim(),
      jenisKonten: contentTypeField.control.value || null,
      penulis: authorField.control.value.trim(),
      tautanPublikasi: publicationUrlField.control.value.trim(),
      kataKunci: normalizeKeywords(keywordsField.control.value),
    }
  }

  function editHasChanges() {
    if (!editArchive) return false
    const values = editValues()
    return values.judul !== (editArchive.judul ?? '').trim()
      || values.klasifikasiId !== (editArchive.klasifikasi_id ?? '')
      || values.unitPencipta !== (editArchive.unit_pencipta ?? '').trim()
      || values.tingkatAkses !== editArchive.tingkat_akses
      || values.tanggalPublikasi !== (editArchive.tanggal_publikasi ?? null)
      || values.kanalPublikasi !== (editArchive.kanal_publikasi ?? '')
      || values.namaKegiatan !== (editArchive.nama_kegiatan ?? '')
      || values.jenisKonten !== (editArchive.jenis_konten ?? null)
      || values.penulis !== (editArchive.penulis ?? '')
      || values.tautanPublikasi !== (editArchive.tautan_publikasi ?? '')
      || JSON.stringify(values.kataKunci)
        !== JSON.stringify(normalizeKeywords(editArchive.kata_kunci ?? []))
  }

  function updateEditState() {
    const disabled = editLoading || editSaving
    for (const control of editForm.elements) {
      if (control !== editClose) control.disabled = disabled
    }
    editClose.disabled = editSaving
    saveButton.disabled = disabled || !editHasChanges()
    editForm.setAttribute('aria-busy', String(editLoading || editSaving))
  }

  function validateEdit() {
    let valid = true
    const title = titleField.control.value.trim()
    if (!title) {
      setFieldError(titleField, 'Judul wajib diisi.')
      valid = false
    } else if (title.length > 500) {
      setFieldError(titleField, 'Judul maksimal 500 karakter.')
      valid = false
    } else {
      setFieldError(titleField, '')
    }

    if (!classificationField.control.value) {
      setFieldError(classificationField, 'Pilih klasifikasi.')
      valid = false
    } else {
      setFieldError(classificationField, '')
    }

    const unit = unitField.control.value.trim()
    if (!unit) {
      setFieldError(unitField, 'Unit pencipta wajib diisi.')
      valid = false
    } else if (unit.length > 255) {
      setFieldError(unitField, 'Unit pencipta maksimal 255 karakter.')
      valid = false
    } else {
      setFieldError(unitField, '')
    }

    if (!publicationUrlField.control.checkValidity()) {
      setFieldError(publicationUrlField, 'Masukkan URL publikasi yang valid.')
      valid = false
    } else {
      setFieldError(publicationUrlField, '')
    }

    return valid
  }

  async function loadEditClassifications() {
    editLoading = true
    editStatus.setAttribute('role', 'status')
    editStatus.textContent = ''
    updateEditState()
    try {
      editClassifications = await fetchClassifications({ includeInactive: true })
      setOptions(classificationField.control, classificationOptions(
        editClassifications,
        editArchive?.klasifikasi_id,
      ))
      if (editArchive?.klasifikasi_id) {
        classificationField.control.value = editArchive.klasifikasi_id
      }
      editStatus.textContent = editClassifications.length
        ? ''
        : 'Daftar klasifikasi kosong. Tambahkan klasifikasi sebelum menyimpan.'
    } catch (error) {
      console.error('Gagal memuat klasifikasi untuk edit arsip:', error)
      editStatus.setAttribute('role', 'alert')
      const retry = makeButton('Coba lagi', 'button button-outline')
      retry.addEventListener('click', loadEditClassifications)
      editStatus.replaceChildren(
        document.createTextNode(error.message || 'Klasifikasi gagal dimuat. Coba lagi.'),
        retry,
      )
    } finally {
      editLoading = false
      updateEditState()
    }
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close()
  }

  function restoreFocus(dialog) {
    const opener = dialog === editDialog ? editOpener : deleteOpener
    if (opener?.isConnected && !opener.disabled) opener.focus()
  }

  editClose.addEventListener('click', () => closeDialog(editDialog))
  editCancel.addEventListener('click', () => closeDialog(editDialog))
  deleteClose.addEventListener('click', () => closeDialog(deleteDialog))
  deleteCancel.addEventListener('click', () => closeDialog(deleteDialog))
  editDialog.addEventListener('close', () => restoreFocus(editDialog))
  deleteDialog.addEventListener('close', () => restoreFocus(deleteDialog))
  editDialog.addEventListener('cancel', (event) => {
    if (editSaving) event.preventDefault()
  })
  deleteDialog.addEventListener('cancel', (event) => {
    if (deleteSaving) event.preventDefault()
  })
  deleteDialog.addEventListener('click', (event) => {
    if (event.target === deleteDialog && !deleteSaving) closeDialog(deleteDialog)
  })

  ;[
    titleField.control,
    classificationField.control,
    unitField.control,
    publicationDateField.control,
    publicationChannelField.control,
    eventNameField.control,
    contentTypeField.control,
    authorField.control,
    publicationUrlField.control,
    keywordsField.control,
    accessField.control,
  ]
    .forEach((control) => control.addEventListener('input', updateEditState))
  classificationField.control.addEventListener('change', updateEditState)
  accessField.control.addEventListener('change', updateEditState)

  editForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (editSaving || editLoading || !validateEdit()) {
      if (!editLoading && !editSaving) {
        editStatus.setAttribute('role', 'alert')
        editStatus.textContent = 'Perbaiki isian yang ditandai sebelum menyimpan.'
      }
      return
    }
    if (!editHasChanges()) return

    editSaving = true
    editStatus.setAttribute('role', 'status')
    editStatus.textContent = 'Menyimpan perubahan…'
    updateEditState()
    try {
      const values = editValues()
      const saved = await updateArchive({ id: editArchive.id, ...values })
      const classification = editClassifications.find((item) => item.id === values.klasifikasiId)
      const updatedArchive = { ...editArchive, ...saved, klasifikasi: classification ?? null }
      editSaving = false
      closeDialog(editDialog)
      await onUpdated?.(updatedArchive)
      showToast('Perubahan arsip berhasil disimpan.')
      editArchive = null
    } catch (error) {
      console.error('Gagal menyimpan perubahan arsip:', error)
      editStatus.setAttribute('role', 'alert')
      editStatus.textContent = mutationMessage(error)
    } finally {
      editSaving = false
      updateEditState()
    }
  })

  deleteForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (deleteSaving || !deleteArchive) return
    deleteSaving = true
    confirmDelete.disabled = true
    confirmDelete.textContent = 'Menghapus...'
    deleteCancel.disabled = true
    deleteClose.disabled = true
    deleteForm.setAttribute('aria-busy', 'true')
    deleteStatus.setAttribute('role', 'status')
    deleteStatus.textContent = 'Menghapus arsip dan berkas secara permanen...'
    try {
      const archiveId = deleteArchive.id
      const result = await permanentlyDeleteArchive(archiveId)
      closeDialog(deleteDialog)
      deleteArchive = null
      if (result.storageDeleted) showToast('Arsip dihapus')

      let refreshFailed = false
      try {
        await onDeleted?.(archiveId)
      } catch (error) {
        console.error('Arsip sudah dihapus, tetapi tampilan gagal diperbarui:', error)
        refreshFailed = true
      }
      if (!result.storageDeleted) {
        showToast('Arsip terhapus, tetapi file gagal dihapus dari Storage.', 'error')
      } else if (refreshFailed) {
        showToast('Arsip berhasil dihapus, tetapi tampilan gagal diperbarui. Muat ulang halaman.', 'error')
      }
    } catch (error) {
      console.error('Gagal menghapus arsip:', error)
      deleteStatus.setAttribute('role', 'alert')
      deleteStatus.textContent = mutationMessage(error)
    } finally {
      deleteSaving = false
      confirmDelete.textContent = 'Hapus'
      deleteCancel.disabled = false
      deleteClose.disabled = false
      deleteForm.removeAttribute('aria-busy')
    }
  })

  return {
    openEdit(archive) {
      if (!archive || editSaving) return
      editArchive = archive
      editOpener = document.activeElement
      editStatus.setAttribute('role', 'status')
      editStatus.textContent = ''
      setFieldError(titleField, '')
      setFieldError(classificationField, '')
      setFieldError(unitField, '')
      titleField.control.value = archive.judul ?? ''
      unitField.control.value = archive.unit_pencipta ?? ''
      publicationDateField.control.value = archive.tanggal_publikasi ?? ''
      publicationChannelField.control.value = archive.kanal_publikasi ?? ''
      eventNameField.control.value = archive.nama_kegiatan ?? ''
      contentTypeField.control.value = archive.jenis_konten ?? ''
      authorField.control.value = archive.penulis ?? ''
      publicationUrlField.control.value = archive.tautan_publikasi ?? ''
      keywordsField.control.value = Array.isArray(archive.kata_kunci)
        ? archive.kata_kunci.join(', ')
        : ''
      setOptions(accessField.control, ACCESS_LEVELS)
      accessField.control.value = archive.tingkat_akses ?? 'internal'
      const cachedClassifications = getReadCache('classifications', { includeInactive: true })
      if (cachedClassifications) {
        editClassifications = cachedClassifications
        setOptions(classificationField.control, classificationOptions(
          cachedClassifications,
          archive.klasifikasi_id,
        ))
        classificationField.control.value = archive.klasifikasi_id ?? ''
        editStatus.textContent = editClassifications.length
          ? ''
          : 'Daftar klasifikasi kosong. Tambahkan klasifikasi sebelum menyimpan.'
        editLoading = false
      } else {
        setOptions(classificationField.control, [['', 'Pilih klasifikasi']])
        editLoading = true
      }
      if (!editDialog.open) editDialog.showModal()
      titleField.control.focus()
      updateEditState()
      if (!cachedClassifications) loadEditClassifications()
    },
    openDelete(archive) {
      if (!archive || deleteSaving) return
      deleteArchive = archive
      deleteOpener = document.activeElement
      deleteSummary.textContent = `${archive.nomor_arsip} · ${archive.judul}`
      deleteStatus.textContent = ''
      confirmDelete.disabled = false
      confirmDelete.textContent = 'Hapus'
      if (!deleteDialog.open) deleteDialog.showModal()
      deleteCancel.focus()
    },
    destroy() {
      closeDialog(editDialog)
      closeDialog(deleteDialog)
      editDialog.remove()
      deleteDialog.remove()
    },
  }
}
