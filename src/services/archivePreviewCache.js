const MAX_PREVIEW_CACHE_BYTES = 24 * 1024 * 1024
const previews = new Map()
let cachedBytes = 0

export function getArchivePreviewUrl(archiveId) {
  const cached = previews.get(archiveId)
  if (!cached) return null

  previews.delete(archiveId)
  previews.set(archiveId, cached)
  return cached.url
}

export function cacheArchivePreview(archiveId, blob) {
  if (blob.size > MAX_PREVIEW_CACHE_BYTES) return null

  const existing = previews.get(archiveId)
  if (existing) {
    URL.revokeObjectURL(existing.url)
    cachedBytes -= existing.size
    previews.delete(archiveId)
  }

  while (cachedBytes + blob.size > MAX_PREVIEW_CACHE_BYTES) {
    const [oldestId, oldest] = previews.entries().next().value
    URL.revokeObjectURL(oldest.url)
    cachedBytes -= oldest.size
    previews.delete(oldestId)
  }

  const url = URL.createObjectURL(blob)
  previews.set(archiveId, { url, size: blob.size })
  cachedBytes += blob.size
  return url
}

export function removeArchivePreview(archiveId) {
  const cached = previews.get(archiveId)
  if (!cached) return

  URL.revokeObjectURL(cached.url)
  cachedBytes -= cached.size
  previews.delete(archiveId)
}

export function clearArchivePreviewCache() {
  for (const { url } of previews.values()) URL.revokeObjectURL(url)
  previews.clear()
  cachedBytes = 0
}
