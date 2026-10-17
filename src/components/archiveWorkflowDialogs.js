import {
  destroyRetentionArchive,
  reviewArchive as saveArchiveReview,
} from '../services/arsipService.js'
import { showToast } from './toast.js'

function makeButton(label, className, type = 'button') {
  const button = document.createElement('button')
  button.type = type
  button.className = className
  button.textContent = label
  return button
}

function makeField(labelText, name, type = 'text', maxLength = null) {
  const label = document.createElement('label')
  label.className = 'archive-mutation-field'
  const caption = document.createElement('span')
  caption.textContent = labelText
  const control = type === 'textarea'
    ? document.createElement('textarea')
    : document.createElement('input')
  if (type !== 'textarea') control.type = type
  control.name = name
  control.id = `archive-workflow-${name}`
  control.setAttribute('aria-describedby', `${control.id}-error`)
  if (maxLength) control.maxLength = maxLength
  const error = document.createElement('span')
  error.className = 'archive-field-error'
  error.id = `${control.id}-error`
  label.append(caption, control, error)
  return { label, control, error }
}

function setFieldError(field, message) {
  field.error.textContent = message
  if (message) field.control.setAttribute('aria-invalid', 'true')
  else field.control.removeAttribute('aria-invalid')
}

export function createArchiveWorkflowDialogs({ onReviewed, onDestroyed } = {}) {
  const reviewDialog = document.createElement('dialog')
  reviewDialog.className = 'archive-mutation-dialog'
  reviewDialog.setAttribute('aria-labelledby', 'archive-review-title')
  const reviewForm = document.createElement('form')
  reviewForm.className = 'archive-mutation-form'
  const reviewTitle = document.createElement('h2')
  reviewTitle.id = 'archive-review-title'
  reviewTitle.textContent = 'Verifikasi arsip'
  const reviewDescription = document.createElement('p')
  reviewDescription.className = 'archive-mutation-note'
  reviewDescription.textContent = 'Periksa file, metadata, klasifikasi, tingkat akses, dan retensi sebelum menyimpan hasil.'
  const resultField = makeField('Hasil pemeriksaan', 'hasil', 'select')
  const verifiedOption = new Option('Terverifikasi', 'terverifikasi')
  const correctionOption = new Option('Perlu perbaikan', 'perlu_perbaikan')
  resultField.control.append(verifiedOption, correctionOption)
  resultField.control.required = true
  const reviewNote = makeField('Catatan pemeriksaan', 'catatan', 'textarea', 2000)
  reviewNote.control.rows = 4
  const reviewStatus = document.createElement('p')
  reviewStatus.className = 'archive-mutation-status'
  reviewStatus.setAttribute('role', 'status')
  reviewStatus.setAttribute('aria-live', 'polite')
  const reviewActions = document.createElement('div')
  reviewActions.className = 'archive-mutation-actions'
  const reviewCancel = makeButton('Batal', 'button button-outline')
  const reviewSubmit = makeButton('Simpan hasil verifikasi', 'button button-primary', 'submit')
  reviewActions.append(reviewCancel, reviewSubmit)
  reviewForm.append(reviewTitle, reviewDescription, resultField.label, reviewNote.label, reviewStatus, reviewActions)
  reviewDialog.append(reviewForm)

  const destructionDialog = document.createElement('dialog')
  destructionDialog.className = 'archive-mutation-dialog archive-destruction-dialog'
  destructionDialog.setAttribute('aria-labelledby', 'archive-destruction-title')
  const destructionForm = document.createElement('form')
  destructionForm.className = 'archive-mutation-form'
  const destructionTitle = document.createElement('h2')
  destructionTitle.id = 'archive-destruction-title'
  destructionTitle.textContent = 'Pemusnahan arsip'
  const destructionDescription = document.createElement('p')
  destructionDescription.className = 'archive-mutation-note'
  destructionDescription.textContent = 'Tindakan ini menghapus berkas dari Storage, tetapi mempertahankan metadata arsip dan catatan audit. Proses hanya dapat dimulai setelah tanggal retensi terlewati.'
  const recordField = makeField('Nomor berita acara', 'berita-acara', 'text', 120)
  recordField.control.required = true
  const destructionNote = makeField('Catatan pemusnahan', 'catatan-pemusnahan', 'textarea', 2000)
  destructionNote.control.rows = 3
  const destructionStatus = document.createElement('p')
  destructionStatus.className = 'archive-mutation-status'
  destructionStatus.setAttribute('role', 'status')
  destructionStatus.setAttribute('aria-live', 'polite')
  const destructionActions = document.createElement('div')
  destructionActions.className = 'archive-mutation-actions'
  const destructionCancel = makeButton('Batal', 'button button-outline')
  const destructionSubmit = makeButton('Hapus berkas dan catat pemusnahan', 'button button-danger', 'submit')
  destructionActions.append(destructionCancel, destructionSubmit)
  destructionForm.append(
    destructionTitle,
    destructionDescription,
    recordField.label,
    destructionNote.label,
    destructionStatus,
    destructionActions,
  )
  destructionDialog.append(destructionForm)
  document.body.append(reviewDialog, destructionDialog)

  let reviewArchive = null
  let destructionArchive = null
  let busy = false
  let reviewOpener = null
  let destructionOpener = null

  function close(dialog) {
    if (dialog.open && !busy) dialog.close()
  }

  function restoreFocus(dialog) {
    const opener = dialog === reviewDialog ? reviewOpener : destructionOpener
    const focusTarget = opener?.isConnected && !opener.disabled && !opener.hidden
      ? opener
      : opener?.closest('.detail-panel')?.querySelector('h2')
    focusTarget?.focus()
  }

  function setBusy(dialog, isBusy) {
    busy = isBusy
    for (const control of dialog.querySelectorAll('input, select, textarea, button')) {
      control.disabled = isBusy
    }
    dialog.setAttribute('aria-busy', String(isBusy))
  }

  function updateReviewNoteRequirement() {
    const required = resultField.control.value === 'perlu_perbaikan'
    reviewNote.control.required = required
    reviewNote.label.querySelector('span').textContent = required
      ? 'Catatan perbaikan (wajib)'
      : 'Catatan pemeriksaan (opsional)'
  }

  resultField.control.addEventListener('change', updateReviewNoteRequirement)
  reviewCancel.addEventListener('click', () => close(reviewDialog))
  destructionCancel.addEventListener('click', () => close(destructionDialog))
  reviewDialog.addEventListener('close', () => restoreFocus(reviewDialog))
  destructionDialog.addEventListener('close', () => restoreFocus(destructionDialog))
  reviewDialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault()
  })
  destructionDialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault()
  })

  reviewForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy || !reviewArchive || !reviewForm.reportValidity()) return
    const note = reviewNote.control.value.trim()
    if (resultField.control.value === 'perlu_perbaikan' && !note) {
      setFieldError(reviewNote, 'Tuliskan bagian yang perlu diperbaiki.')
      reviewNote.control.focus()
      return
    }
    setFieldError(reviewNote, '')
    setBusy(reviewDialog, true)
    reviewStatus.setAttribute('role', 'status')
    reviewStatus.textContent = 'Menyimpan hasil verifikasi…'
    try {
      const saved = await saveArchiveReview({
        id: reviewArchive.id,
        result: resultField.control.value,
        note,
      })
      const record = { ...reviewArchive, ...saved }
      await onReviewed?.(record)
      setBusy(reviewDialog, false)
      reviewDialog.close()
      showToast(resultField.control.value === 'terverifikasi'
        ? 'Arsip ditandai terverifikasi.'
        : 'Catatan perbaikan tersimpan.')
      reviewArchive = null
    } catch (error) {
      console.error('Gagal menyimpan hasil verifikasi:', error)
      reviewStatus.setAttribute('role', 'alert')
      reviewStatus.textContent = error.message || 'Hasil verifikasi gagal disimpan.'
    } finally {
      setBusy(reviewDialog, false)
    }
  })

  destructionForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy || !destructionArchive || !destructionForm.reportValidity()) return
    setBusy(destructionDialog, true)
    destructionStatus.setAttribute('role', 'status')
    destructionStatus.textContent = 'Menghapus berkas dan mencatat pemusnahan…'
    try {
      const saved = await destroyRetentionArchive({
        id: destructionArchive.id,
        recordNumber: recordField.control.value,
        note: destructionNote.control.value,
      })
      const record = { ...destructionArchive, ...saved }
      await onDestroyed?.(record)
      setBusy(destructionDialog, false)
      destructionDialog.close()
      showToast('Berkas dimusnahkan dan metadata audit dipertahankan.')
      destructionArchive = null
    } catch (error) {
      console.error('Gagal menyelesaikan pemusnahan arsip:', error)
      destructionStatus.setAttribute('role', 'alert')
      destructionStatus.textContent = error.message || 'Pemusnahan gagal diselesaikan.'
    } finally {
      setBusy(destructionDialog, false)
    }
  })

  return {
    openReview(archive) {
      if (!archive || busy) return
      reviewArchive = archive
      reviewOpener = document.activeElement
      resultField.control.value = 'terverifikasi'
      reviewNote.control.value = ''
      reviewStatus.textContent = ''
      reviewStatus.setAttribute('role', 'status')
      setFieldError(reviewNote, '')
      updateReviewNoteRequirement()
      reviewDialog.showModal()
      resultField.control.focus()
    },
    openDestruction(archive) {
      if (!archive || busy) return
      destructionArchive = archive
      destructionOpener = document.activeElement
      recordField.control.value = archive.pemusnahan_berita_acara ?? ''
      destructionNote.control.value = archive.pemusnahan_catatan ?? ''
      destructionStatus.textContent = ''
      destructionStatus.setAttribute('role', 'status')
      destructionDialog.showModal()
      recordField.control.focus()
    },
    destroy() {
      busy = false
      reviewDialog.close()
      destructionDialog.close()
      reviewDialog.remove()
      destructionDialog.remove()
    },
  }
}
