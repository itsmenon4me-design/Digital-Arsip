import { clearArchivePreviewCache } from './archivePreviewCache.js'

const readCache = new Map()
const readRequests = new Map()
let readGeneration = 0

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    )
  }
  return value
}

function keyFor(namespace, params) {
  return `${namespace}:${JSON.stringify(normalize(params))}`
}

export function getReadCache(namespace, params = null) {
  return readCache.get(keyFor(namespace, params))
}

export function setReadCache(namespace, params, value) {
  readCache.set(keyFor(namespace, params), value)
}

export function loadReadRequest(namespace, params, loader) {
  const key = keyFor(namespace, params)
  const pending = readRequests.get(key)
  if (pending) return pending

  const generation = readGeneration
  let request
  request = Promise.resolve()
    .then(loader)
    .then((value) => {
      if (generation === readGeneration) readCache.set(key, value)
      return value
    })
    .finally(() => {
      if (readRequests.get(key) === request) readRequests.delete(key)
    })
  readRequests.set(key, request)
  return request
}

export function clearReadCache() {
  readCache.clear()
  readRequests.clear()
  clearArchivePreviewCache()
  readGeneration += 1
}
