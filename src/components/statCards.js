const statItems = [
  { key: 'total', label: 'Total arsip', detail: 'Semua arsip yang dapat diakses' },
  { key: 'waiting', label: 'Perlu ditinjau', detail: 'Menunggu verifikasi atau perbaikan' },
  { key: 'retention', label: 'Mendekati masa retensi', detail: 'Dalam 90 hari' },
  { key: 'storage', label: 'Penyimpanan terpakai', detail: 'Berkas arsip' },
]

function makeRetryButton(onRetry) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'button button-outline state-retry'
  button.textContent = 'Coba lagi'
  button.addEventListener('click', onRetry)
  return button
}

export function createStatCards(onRetry, { showRetention = true } = {}) {
  const section = document.createElement('section')
  section.className = 'stat-grid'
  section.setAttribute('aria-label', 'Statistik arsip')
  section.setAttribute('aria-live', 'polite')

  const metrics = new Map()
  statItems
    .filter(({ key }) => showRetention || key !== 'retention')
    .forEach(({ key, label, detail }, index) => {
      const card = document.createElement('article')
      card.className = `stat-card stat-card-${index + 1}`
      const heading = document.createElement('h3')
      heading.textContent = label
      const metric = document.createElement('p')
      metric.className = 'stat-value'
      metric.dataset.metric = key
      const caption = document.createElement('p')
      caption.className = 'stat-detail'
      caption.textContent = detail
      card.append(heading, metric, caption)
      section.append(card)
      metrics.set(key, metric)
    })

  const state = document.createElement('div')
  state.className = 'data-state stat-state'
  state.setAttribute('role', 'alert')
  state.hidden = true
  section.append(state)

  function showLoading() {
    state.hidden = true
    section.setAttribute('aria-busy', 'true')
    metrics.forEach((metric) => {
      metric.textContent = ''
      metric.classList.add('skeleton')
      metric.setAttribute('aria-label', 'Memuat statistik')
    })
  }

  function showData(data) {
    state.hidden = true
    section.removeAttribute('aria-busy')
    metrics.get('total').textContent = new Intl.NumberFormat('id-ID').format(data.total)
    metrics.get('waiting').textContent = new Intl.NumberFormat('id-ID').format(data.waiting)
    if (metrics.has('retention')) {
      metrics.get('retention').textContent = new Intl.NumberFormat('id-ID').format(data.retention)
    }
    metrics.get('storage').textContent = data.storage
    metrics.forEach((metric) => {
      metric.classList.remove('skeleton')
      metric.removeAttribute('aria-label')
    })
  }

  function showError(message) {
    section.removeAttribute('aria-busy')
    metrics.forEach((metric) => {
      metric.textContent = 'Tidak tersedia'
      metric.classList.remove('skeleton')
      metric.removeAttribute('aria-label')
    })
    state.replaceChildren()
    const text = document.createElement('p')
    text.textContent = message
    state.append(text, makeRetryButton(onRetry))
    state.hidden = false
  }

  function showRefreshError(message) {
    state.replaceChildren()
    const text = document.createElement('p')
    text.textContent = message
    state.append(text, makeRetryButton(onRetry))
    state.hidden = false
  }

  showLoading()
  return { element: section, showLoading, showData, showError, showRefreshError }
}
