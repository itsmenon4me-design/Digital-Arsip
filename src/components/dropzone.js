export function createDropzone({ onUpload } = {}) {
  const section = document.createElement('section')
  section.className = 'dropzone-panel'
  section.setAttribute('aria-labelledby', 'upload-stage-title')

  const title = document.createElement('strong')
  title.id = 'upload-stage-title'
  title.textContent = 'Tarik & lepas berkas di sini'
  const description = document.createElement('span')
  description.textContent = 'PDF, JPG, TIFF, PNG, MP4, Excel, Word, PowerPoint · Maksimal 50 MB · Bucket privat.'
  const uploadButton = document.createElement('button')
  uploadButton.type = 'button'
  uploadButton.className = 'button button-outline'
  uploadButton.textContent = 'Pilih berkas'
  uploadButton.addEventListener('click', () => onUpload?.())
  section.append(title, description, uploadButton)

  section.addEventListener('dragover', (event) => {
    event.preventDefault()
    section.classList.add('is-dragging')
  })
  section.addEventListener('dragleave', (event) => {
    if (!section.contains(event.relatedTarget)) section.classList.remove('is-dragging')
  })
  section.addEventListener('drop', (event) => {
    event.preventDefault()
    section.classList.remove('is-dragging')
    const [file] = event.dataTransfer?.files ?? []
    if (file) onUpload?.(file)
  })
  return section
}
