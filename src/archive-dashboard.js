const ROLE_LABELS = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}

const ARCHIVE_COLUMNS =
  'id, judul, kategori, tanggal_publikasi, deskripsi, file_url, created_at'
const NEW_CATEGORY_OPTION = '__new_category_option__'
const ARCHIVE_REQUEST_TIMEOUT_MS = 15000

function getErrorMessage(error, action) {
  if (error?.code === '42501') {
    return `Akses ${action} ditolak oleh database. Periksa role staf dan policy RLS.`
  }

  if (error?.code === 'PGRST301' || error?.status === 401 || error?.status === 403) {
    return `Sesi tidak memiliki izin untuk ${action}. Masuk kembali atau hubungi administrator.`
  }

  if (error instanceof TypeError) {
    return `Tidak dapat ${action} karena koneksi ke Supabase gagal. Periksa koneksi lalu coba lagi.`
  }

  return `Gagal ${action}. Silakan coba lagi.`
}

function formatDate(value, includeTime = false) {
  if (!value) return 'Tidak tersedia'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Tanggal tidak valid'

  return new Intl.DateTimeFormat('id-ID', includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date)
}

function makeButton(label, className, action) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = label
  button.addEventListener('click', action)
  return button
}

export function createArchiveDashboard(root, supabase) {
  const identity = root.querySelector('#staff-identity')
  const searchInput = root.querySelector('#archive-search')
  const categoryFilter = root.querySelector('#category-filter')
  const publishedFrom = root.querySelector('#published-from')
  const publishedTo = root.querySelector('#published-to')
  const summary = root.querySelector('#archive-summary')
  const archiveCount = root.querySelector('#archive-count')
  const categorySummary = root.querySelector('#category-summary')
  const createButton = root.querySelector('#archive-create')
  const navCreateButton = root.querySelector('#nav-create')
  const navItems = [...root.querySelectorAll('[data-nav-item]')]
  const status = root.querySelector('#archive-status')
  const emptyState = root.querySelector('#archive-empty')
  const tableScroll = root.querySelector('#archive-table-scroll')
  const tableHead = root.querySelector('.archive-table thead tr')
  const rowsContainer = root.querySelector('#archive-rows')
  const form = root.querySelector('#archive-form')
  const formTitle = root.querySelector('#archive-form-title')
  const titleInput = root.querySelector('#archive-title')
  const categoryInput = root.querySelector('#archive-category')
  const newCategoryLabel = root.querySelector('#archive-category-new-label')
  const newCategoryInput = root.querySelector('#archive-category-new')
  const dateInput = root.querySelector('#archive-date')
  const descriptionInput = root.querySelector('#archive-description')
  const fileUrlInput = root.querySelector('#archive-file-url')
  const saveButton = root.querySelector('#archive-save')
  const cancelButton = root.querySelector('#archive-cancel')
  const formStatus = root.querySelector('#archive-form-status')

  let session = null
  let role = null
  let records = []
  let editingId = null
  let requestVersion = 0
  let busy = false

  function setNotice(message) {
    status.textContent = message
  }

  function setActiveNavigation(activeItem) {
    navItems.forEach((item) => {
      if (item.dataset.navItem === activeItem) {
        item.setAttribute('aria-current', 'page')
      } else {
        item.removeAttribute('aria-current')
      }
    })
  }

  function setBusy(value) {
    busy = value
    createButton.disabled = value || !['admin', 'editor'].includes(role)
    searchInput.disabled = value
    categoryFilter.disabled = value
    publishedFrom.disabled = value
    publishedTo.disabled = value
    cancelButton.disabled = value
    saveButton.disabled = value
    form.querySelectorAll('input, select, textarea').forEach((input) => {
      input.disabled = value
    })
    rowsContainer.querySelectorAll('button').forEach((button) => {
      button.disabled = value
    })
  }

  function updateCategoryOptions() {
    const selected = categoryFilter.value
    const categories = [...new Set(records.map((record) => record.kategori).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'id'))

    categoryFilter.replaceChildren(new Option('Semua kategori', ''))
    categories.forEach((category) => {
      categoryFilter.add(new Option(category, `category:${category}`))
    })
    categoryFilter.value = categories.some((category) => `category:${category}` === selected)
      ? selected
      : ''
  }

  function updateFormCategoryOptions(selectedCategory = '') {
    const categories = [...new Set(records.map((record) => record.kategori).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'id'))

    categoryInput.replaceChildren(new Option('Pilih kategori', ''))
    categoryInput.options[0].disabled = true
    categories.forEach((category) => {
      categoryInput.add(new Option(category, `category:${category}`))
    })
    categoryInput.add(new Option('Tambah kategori baru', NEW_CATEGORY_OPTION))

    categoryInput.value = selectedCategory
      ? `category:${selectedCategory}`
      : categories.length
        ? ''
        : NEW_CATEGORY_OPTION
    syncNewCategoryInput()
  }

  function syncNewCategoryInput() {
    const isNewCategory = categoryInput.value === NEW_CATEGORY_OPTION
    newCategoryLabel.hidden = !isNewCategory
    newCategoryInput.hidden = !isNewCategory
    newCategoryInput.required = isNewCategory
    if (!isNewCategory) newCategoryInput.value = ''
  }

  function updateSummary() {
    const categoryCounts = new Map()
    records.forEach(({ kategori }) => {
      categoryCounts.set(kategori, (categoryCounts.get(kategori) ?? 0) + 1)
    })

    archiveCount.textContent =
      `${new Intl.NumberFormat('id-ID').format(records.length)} arsip dapat diakses`
    categorySummary.replaceChildren()

    const categories = [...categoryCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'id'))

    if (!categories.length) {
      const item = document.createElement('li')
      item.textContent = 'Belum ada kategori arsip.'
      categorySummary.append(item)
    } else {
      categories.forEach(([category, count]) => {
        const item = document.createElement('li')
        item.textContent = `${category}: ${new Intl.NumberFormat('id-ID').format(count)}`
        categorySummary.append(item)
      })
    }
    summary.hidden = false
  }

  function renderRows() {
    const search = searchInput.value.trim().toLocaleLowerCase('id')
    const category = categoryFilter.value.startsWith('category:')
      ? categoryFilter.value.slice('category:'.length)
      : ''
    const fromDate = publishedFrom.value
    const toDate = publishedTo.value
    const invalidDateRange = fromDate && toDate && fromDate > toDate
    const filtered = records.filter((record) => {
      const matchesTitle = record.judul.toLocaleLowerCase('id').includes(search)
      const matchesCategory = !category || record.kategori === category
      const publicationDate = record.tanggal_publikasi ?? ''
      const matchesFromDate = !fromDate || (publicationDate && publicationDate >= fromDate)
      const matchesToDate = !toDate || (publicationDate && publicationDate <= toDate)
      return !invalidDateRange && matchesTitle && matchesCategory && matchesFromDate && matchesToDate
    })

    rowsContainer.replaceChildren()
    tableScroll.hidden = filtered.length === 0
    emptyState.hidden = filtered.length !== 0

    if (filtered.length === 0) {
      emptyState.textContent = records.length === 0
        ? 'Belum ada arsip yang dapat Anda baca.'
        : invalidDateRange
          ? 'Rentang tanggal tidak valid. Tanggal awal harus sebelum atau sama dengan tanggal akhir.'
          : 'Tidak ada arsip yang sesuai dengan pencarian dan filter.'
      return
    }

    filtered.forEach((record) => {
      const row = document.createElement('tr')
      const values = [
        record.judul,
        record.kategori,
        formatDate(record.tanggal_publikasi),
        record.deskripsi?.trim() || 'Tidak ada deskripsi',
      ]

      values.forEach((value) => {
        const cell = document.createElement('td')
        cell.textContent = value
        row.append(cell)
      })

      const linkCell = document.createElement('td')
      if (record.file_url?.trim()) {
        let safeUrl = null
        try {
          const parsedUrl = new URL(record.file_url)
          if (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:') {
            safeUrl = parsedUrl.href
          }
        } catch {
          safeUrl = null
        }

        if (safeUrl) {
          const link = document.createElement('a')
          link.href = safeUrl
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          link.textContent = 'Buka konten'
          linkCell.append(link)
        } else {
          linkCell.textContent = record.file_url
        }
      } else {
        linkCell.textContent = 'Tidak ada tautan'
      }
      row.append(linkCell)

      const createdCell = document.createElement('td')
      createdCell.textContent = formatDate(record.created_at, true)
      row.append(createdCell)

      if (['admin', 'editor'].includes(role)) {
        const actions = document.createElement('td')
        actions.className = 'archive-actions'
        actions.append(makeButton('Edit', 'secondary-button', () => openEditForm(record)))

        if (role === 'admin') {
          actions.append(makeButton('Hapus', 'danger-button', () => deleteRecord(record)))
        }

        row.append(actions)
      }

      rowsContainer.append(row)
    })
  }

  function closeForm() {
    form.hidden = true
    form.reset()
    syncNewCategoryInput()
    formStatus.textContent = ''
    editingId = null
    setActiveNavigation('list')
  }

  function openCreateForm() {
    if (!['admin', 'editor'].includes(role) || busy) return
    closeForm()
    updateFormCategoryOptions()
    formTitle.textContent = 'Tambah arsip publikasi'
    form.hidden = false
    setActiveNavigation('create')
    titleInput.focus()
  }

  function openEditForm(record) {
    if (!['admin', 'editor'].includes(role) || busy) return
    closeForm()
    editingId = record.id
    updateFormCategoryOptions(record.kategori)
    formTitle.textContent = 'Edit arsip publikasi'
    titleInput.value = record.judul
    dateInput.value = record.tanggal_publikasi ?? ''
    descriptionInput.value = record.deskripsi ?? ''
    fileUrlInput.value = record.file_url ?? ''
    form.hidden = false
    setActiveNavigation('create')
    titleInput.focus()
  }

  async function loadRecords(version) {
    setNotice('Memuat arsip...')
    emptyState.hidden = true
    tableScroll.hidden = true
    summary.hidden = true

    const allRecords = []
    const pageSize = 1000
    let requestController

    try {
      for (let offset = 0; ; offset += pageSize) {
        requestController = new AbortController()
        const timeoutId = window.setTimeout(
          () => requestController.abort(),
          ARCHIVE_REQUEST_TIMEOUT_MS,
        )
        let result
        try {
          result = await supabase
            .from('arsip_publikasi')
            .select(ARCHIVE_COLUMNS)
            .order('created_at', { ascending: false })
            .range(offset, offset + pageSize - 1)
            .abortSignal(requestController.signal)
        } finally {
          window.clearTimeout(timeoutId)
        }

        if (version !== requestVersion) return false
        if (requestController.signal.aborted) {
          throw new Error('Archive request timed out')
        }

        const { data, error } = result
        if (error) {
          throw error
        }

        allRecords.push(...(data ?? []))
        if ((data?.length ?? 0) < pageSize) break
      }
    } catch (error) {
      if (version !== requestVersion) return false
      records = []
      updateCategoryOptions()
      setNotice(requestController?.signal.aborted
        ? 'Permintaan arsip terlalu lama. Periksa koneksi lalu coba lagi.'
        : getErrorMessage(error, 'memuat arsip'))
      return false
    } finally {
      if (version === requestVersion && status.textContent === 'Memuat arsip...') {
        setNotice('Pemuatan arsip tidak selesai. Silakan coba lagi.')
      }
    }

    if (version !== requestVersion) return false
    records = allRecords
    updateCategoryOptions()
    updateFormCategoryOptions()
    updateSummary()
    setNotice('')
    renderRows()
    return true
  }

  async function getTrustedRole() {
    const checks = await Promise.all(
      ['admin', 'editor', 'viewer'].map((candidate) =>
        supabase.rpc('has_arsip_role', { required_roles: [candidate] }),
      ),
    )

    const errorResult = checks.find(({ error }) => error)
    if (errorResult) throw errorResult.error

    const roleIndex = checks.findIndex(({ data }) => data === true)
    return roleIndex < 0 ? null : ['admin', 'editor', 'viewer'][roleIndex]
  }

  function renderRoleControls() {
    createButton.hidden = !['admin', 'editor'].includes(role)
    navCreateButton.hidden = createButton.hidden
    tableHead.lastElementChild.hidden = !['admin', 'editor'].includes(role)
  }

  async function submitForm(event) {
    event.preventDefault()
    if (!['admin', 'editor'].includes(role) || busy) return

    const title = titleInput.value.trim()
    const category = categoryInput.value === NEW_CATEGORY_OPTION
      ? newCategoryInput.value.trim()
      : categoryInput.value.startsWith('category:')
        ? categoryInput.value.slice('category:'.length).trim()
        : ''
    if (!title || !category) {
      formStatus.textContent = 'Judul dan kategori wajib diisi. Pilih kategori yang ada atau masukkan kategori baru.'
      return
    }

    const rawFileUrl = fileUrlInput.value.trim()
    let fileUrl = null
    if (rawFileUrl) {
      try {
        const parsedUrl = new URL(rawFileUrl)
        if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
          throw new Error('Unsupported URL protocol')
        }
        fileUrl = parsedUrl.href
      } catch {
        formStatus.textContent = 'Tautan konten harus berupa URL HTTP atau HTTPS yang valid.'
        return
      }
    }

    const payload = {
      judul: title,
      kategori: category,
      tanggal_publikasi: dateInput.value || null,
      deskripsi: descriptionInput.value.trim() || null,
      file_url: fileUrl,
    }
    const isEditing = Boolean(editingId)
    const targetId = editingId

    setBusy(true)
    formStatus.textContent = 'Menyimpan arsip...'
    try {
      const result = isEditing
        ? await supabase.from('arsip_publikasi').update(payload).eq('id', targetId).select('id').maybeSingle()
        : await supabase.from('arsip_publikasi').insert(payload).select('id').single()

      if (result.error) {
        formStatus.textContent = getErrorMessage(result.error, 'menyimpan arsip')
        return
      }
      if (!result.data?.id) {
        formStatus.textContent = 'Arsip tidak ditemukan atau perubahan tidak diizinkan.'
        return
      }

      closeForm()
      if (await loadRecords(requestVersion)) {
        setNotice(isEditing ? 'Arsip berhasil diperbarui.' : 'Arsip berhasil ditambahkan.')
      } else {
        setNotice(
          `Arsip berhasil ${isEditing ? 'diperbarui' : 'ditambahkan'}, tetapi daftar gagal dimuat ulang. ${status.textContent}`,
        )
      }
    } catch (error) {
      formStatus.textContent = getErrorMessage(error, 'menyimpan arsip')
    } finally {
      setBusy(false)
    }
  }

  async function deleteRecord(record) {
    if (role !== 'admin' || busy) return
    const confirmed = window.confirm(`Hapus arsip "${record.judul}"? Tindakan ini tidak dapat dibatalkan.`)
    if (!confirmed) return

    setBusy(true)
    setNotice('Menghapus arsip...')
    try {
      const { data, error } = await supabase
        .from('arsip_publikasi')
        .delete()
        .eq('id', record.id)
        .select('id')
        .maybeSingle()

      if (error) {
        setNotice(getErrorMessage(error, 'menghapus arsip'))
        return
      }
      if (!data) {
        setNotice('Arsip tidak ditemukan atau penghapusan tidak diizinkan.')
        return
      }

      if (await loadRecords(requestVersion)) {
        setNotice('Arsip berhasil dihapus.')
      } else {
        setNotice(`Arsip berhasil dihapus, tetapi daftar gagal dimuat ulang. ${status.textContent}`)
      }
    } catch (error) {
      setNotice(getErrorMessage(error, 'menghapus arsip'))
    } finally {
      setBusy(false)
    }
  }

  searchInput.addEventListener('input', renderRows)
  categoryFilter.addEventListener('change', renderRows)
  publishedFrom.addEventListener('change', renderRows)
  publishedTo.addEventListener('change', renderRows)
  navItems.filter((item) => item instanceof HTMLAnchorElement).forEach((item) => {
    item.addEventListener('click', () => setActiveNavigation(item.dataset.navItem))
  })
  categoryInput.addEventListener('change', syncNewCategoryInput)
  createButton.addEventListener('click', openCreateForm)
  navCreateButton.addEventListener('click', openCreateForm)
  cancelButton.addEventListener('click', closeForm)
  form.addEventListener('submit', submitForm)

  return {
    setBusy,
    setNotice,
    async setSession(nextSession) {
      const version = ++requestVersion
      session = nextSession
      role = null
      records = []
      closeForm()
      setActiveNavigation('dashboard')
      rowsContainer.replaceChildren()
      tableScroll.hidden = true
      emptyState.hidden = true
      summary.hidden = true
      searchInput.value = ''
      publishedFrom.value = ''
      publishedTo.value = ''
      categoryFilter.replaceChildren(new Option('Semua kategori', ''))
      updateFormCategoryOptions()
      createButton.hidden = true
      navCreateButton.hidden = true
      tableHead.lastElementChild.hidden = true

      if (!session?.user) {
        identity.textContent = ''
        setNotice('')
        return
      }

      identity.textContent = `${session.user.email ?? 'Akun staf'} · Memeriksa role...`
      setNotice('Memeriksa izin staf...')
      try {
        const trustedRole = await getTrustedRole()
        if (version !== requestVersion) return
        role = trustedRole
        identity.textContent =
          `${session.user.email ?? 'Akun staf'} · ${role ? ROLE_LABELS[role] : 'Tanpa role staf'}`
        renderRoleControls()
        if (!role) {
          setNotice('Akun ini belum memiliki role staf. Hubungi administrator untuk meminta akses.')
          return
        }
        await loadRecords(version)
      } catch (error) {
        if (version !== requestVersion) return
        identity.textContent = `${session.user.email ?? 'Akun staf'} · Role tidak dapat diverifikasi`
        setNotice(getErrorMessage(error, 'memeriksa role staf'))
      }
    },
  }
}
