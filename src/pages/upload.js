import { createDropzone } from '../components/dropzone.js'
import { createUploadModal } from '../components/uploadModal.js'

export function createUploadPage() {
  const root = document.createElement('div')
  root.className = 'reference-page upload-page'

  const heading = document.createElement('section')
  heading.className = 'page-heading'
  const copy = document.createElement('div')
  const kicker = document.createElement('p')
  kicker.className = 'section-kicker'
  kicker.textContent = 'DIGITALISASI ARSIP'
  const title = document.createElement('h2')
  title.textContent = 'Unggah & Digitalisasi'
  const description = document.createElement('p')
  description.textContent = 'Pilih berkas publikasi untuk melengkapi metadata arsip.'
  copy.append(kicker, title, description)
  heading.append(copy)

  const modal = createUploadModal()
  const dropzone = createDropzone({
    onUpload: (file) => modal.open(file),
  })
  const openUpload = (event) => modal.open(event.detail?.file ?? null)
  window.addEventListener('archive-upload-request', openUpload)

  root.append(heading, dropzone)

  return {
    element: root,
    destroy() {
      window.removeEventListener('archive-upload-request', openUpload)
      modal.destroy()
    },
  }
}
