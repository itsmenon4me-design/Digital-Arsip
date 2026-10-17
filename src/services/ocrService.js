import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_PDF_PAGES = 20
const MAX_IMAGE_DIMENSION = 3000
const MAX_IMAGE_PIXELS = 12_000_000
const OCR_ASSET_BASE = `${import.meta.env.BASE_URL}ocr/`

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('Pemrosesan OCR dibatalkan.', 'AbortError')
  }
}

function waitWithAbort(promise, signal) {
  if (!signal) return promise
  throwIfAborted(signal)

  let onAbort
  const aborted = new Promise((resolve, reject) => {
    onAbort = () => reject(new DOMException('Pemrosesan OCR dibatalkan.', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([promise, aborted])
    .finally(() => signal.removeEventListener('abort', onAbort))
}

async function getArchiveFormat(blob, fileName) {
  const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
  const extension = fileName.toLowerCase().split('.').pop()
  const isPdf = signature[0] === 0x25
    && signature[1] === 0x50
    && signature[2] === 0x44
    && signature[3] === 0x46
    && signature[4] === 0x2d
  const isPng = signature[0] === 0x89
    && signature[1] === 0x50
    && signature[2] === 0x4e
    && signature[3] === 0x47
    && signature[4] === 0x0d
    && signature[5] === 0x0a
    && signature[6] === 0x1a
    && signature[7] === 0x0a
  const isJpeg = signature[0] === 0xff
    && signature[1] === 0xd8
    && signature[2] === 0xff

  if (isPdf && extension === 'pdf') return 'pdf'
  if (isPng && extension === 'png') return 'image'
  if (isJpeg && ['jpg', 'jpeg'].includes(extension)) return 'image'
  throw new Error('OCR mendukung berkas PDF, JPG, JPEG, dan PNG yang valid.')
}

function createScaledCanvas(sourceWidth, sourceHeight) {
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight),
    Math.sqrt(MAX_IMAGE_PIXELS / (sourceWidth * sourceHeight)),
  )
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(sourceWidth * scale))
  canvas.height = Math.max(1, Math.floor(sourceHeight * scale))
  return canvas
}

async function recognizeImage(blob, worker, signal, onProgress) {
  const bitmapPromise = createImageBitmap(blob)
  bitmapPromise.then(
    (result) => {
      if (signal?.aborted) result.close()
    },
    () => {},
  )
  const bitmap = await waitWithAbort(bitmapPromise, signal)
  const canvas = createScaledCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('Browser tidak dapat menyiapkan gambar untuk OCR.')
  }

  try {
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    throwIfAborted(signal)
    onProgress({ status: 'recognizing', progress: 0 })
    const result = await waitWithAbort(
      worker.recognize(canvas, { rotateAuto: true }),
      signal,
    )
    throwIfAborted(signal)
    return result.data.text.trim()
  } finally {
    bitmap.close()
    canvas.width = 0
    canvas.height = 0
  }
}

function getPdfPageText(items) {
  return items
    .filter((item) => typeof item.str === 'string')
    .map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`)
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

export async function recognizeArchive(blob, fileName, { signal, onProgress = () => {} } = {}) {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error('Berkas arsip kosong atau tidak dapat dibaca.')
  }
  if (blob.size > MAX_FILE_BYTES) {
    throw new Error('Ukuran berkas melebihi batas OCR 50 MB.')
  }

  const format = await getArchiveFormat(blob, fileName)
  throwIfAborted(signal)

  const [{ createWorker, OEM }, pdfjsLib] = await Promise.all([
    import('tesseract.js'),
    format === 'pdf' ? import('pdfjs-dist') : Promise.resolve(null),
  ])
  if (pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

  let worker = null
  let pdfLoadingTask = null
  let currentRenderTask = null
  const abortWork = () => {
    if (worker) void worker.terminate()
    if (currentRenderTask) currentRenderTask.cancel()
    if (pdfLoadingTask) void pdfLoadingTask.destroy()
  }
  signal?.addEventListener('abort', abortWork, { once: true })

  const ensureWorker = async (progressForPage) => {
    if (!worker) {
      onProgress({ status: 'loading-engine', progress: 0 })
      const workerPromise = createWorker(['ind', 'eng'], OEM.LSTM_ONLY, {
        workerPath: `${OCR_ASSET_BASE}worker.min.js`,
        corePath: `${OCR_ASSET_BASE}tesseract-core-lstm.wasm.js`,
        langPath: `${OCR_ASSET_BASE}lang`,
        gzip: true,
        workerBlobURL: false,
        cacheMethod: 'write',
        logger({ status, progress }) {
          onProgress({
            status: status === 'recognizing text' ? 'recognizing' : 'loading-engine',
            progress: progressForPage(progress),
          })
        },
      })
      workerPromise.then((createdWorker) => {
        if (signal?.aborted) void createdWorker.terminate()
      })
      worker = await waitWithAbort(workerPromise, signal)
      if (signal?.aborted) {
        await worker.terminate()
        worker = null
        throwIfAborted(signal)
      }
    }
    return worker
  }

  try {
    throwIfAborted(signal)
    if (format === 'image') {
      const imageWorker = await ensureWorker((progress) => progress)
      return await recognizeImage(blob, imageWorker, signal, onProgress)
    }

    pdfLoadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(await waitWithAbort(blob.arrayBuffer(), signal)),
      isEvalSupported: false,
      useSystemFonts: true,
    })
    const pdf = await waitWithAbort(pdfLoadingTask.promise, signal)
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(`OCR dibatasi hingga ${MAX_PDF_PAGES} halaman per dokumen. PDF ini memiliki ${pdf.numPages} halaman.`)
    }

    const pageTexts = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      throwIfAborted(signal)
      const page = await waitWithAbort(pdf.getPage(pageNumber), signal)
      const textContent = await waitWithAbort(page.getTextContent(), signal)
      const embeddedText = getPdfPageText(textContent.items)
      if (embeddedText.length >= 30) {
        pageTexts.push(`Halaman ${pageNumber}\n${embeddedText}`)
        onProgress({
          status: 'reading-page',
          page: pageNumber,
          totalPages: pdf.numPages,
          progress: pageNumber / pdf.numPages,
        })
        page.cleanup()
        continue
      }

      const progressForPage = (progress) => (
        (pageNumber - 1 + progress) / pdf.numPages
      )
      const pageWorker = await ensureWorker(progressForPage)
      const initialViewport = page.getViewport({ scale: 2 })
      const canvas = createScaledCanvas(initialViewport.width, initialViewport.height)
      const viewport = page.getViewport({
        scale: 2 * (canvas.width / initialViewport.width),
      })
      canvas.width = Math.max(1, Math.floor(viewport.width))
      canvas.height = Math.max(1, Math.floor(viewport.height))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Browser tidak dapat menyiapkan halaman PDF untuk OCR.')
      currentRenderTask = page.render({ canvas, canvasContext: context, viewport })
      await waitWithAbort(currentRenderTask.promise, signal)
      currentRenderTask = null
      throwIfAborted(signal)
      const result = await waitWithAbort(
        pageWorker.recognize(canvas, { rotateAuto: true }),
        signal,
      )
      pageTexts.push(`Halaman ${pageNumber}\n${result.data.text.trim()}`)
      canvas.width = 0
      canvas.height = 0
      page.cleanup()
    }

    throwIfAborted(signal)
    return pageTexts.filter(Boolean).join('\n\n')
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Pemrosesan OCR dibatalkan.', 'AbortError')
    throw error
  } finally {
    signal?.removeEventListener('abort', abortWork)
    if (worker) await worker.terminate()
    if (pdfLoadingTask) await pdfLoadingTask.destroy()
  }
}
