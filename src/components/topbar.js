import { signOut } from '../services/authService.js'
import { canManageArchives } from '../services/accessControl.js'
import { setTheme } from '../services/themeService.js'

function makeButton(label, className, onClick) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = label
  if (onClick) button.addEventListener('click', onClick)
  return button
}

function createThemeIcon(pathData, isSun = false) {
  const namespace = 'http://www.w3.org/2000/svg'
  const icon = document.createElementNS(namespace, 'svg')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('aria-hidden', 'true')
  icon.setAttribute('focusable', 'false')
  if (isSun) {
    const center = document.createElementNS(namespace, 'circle')
    center.setAttribute('cx', '12')
    center.setAttribute('cy', '12')
    center.setAttribute('r', '3')
    center.setAttribute('fill', 'currentColor')
    icon.append(center)

    const rays = document.createElementNS(namespace, 'path')
    rays.setAttribute('d', 'M12 2v2m0 16v2m10-10h-2M4 12H2m17.07-7.07-1.42 1.42M6.35 17.65l-1.42 1.42m14.14 0-1.42-1.42M6.35 6.35 4.93 4.93')
    rays.setAttribute('fill', 'none')
    rays.setAttribute('stroke', 'currentColor')
    rays.setAttribute('stroke-linecap', 'round')
    rays.setAttribute('stroke-width', '2')
    icon.append(rays)
  } else {
    const crescent = document.createElementNS(namespace, 'path')
    crescent.setAttribute('d', pathData)
    crescent.setAttribute('fill', 'none')
    crescent.setAttribute('stroke', 'currentColor')
    crescent.setAttribute('stroke-linecap', 'round')
    crescent.setAttribute('stroke-linejoin', 'round')
    crescent.setAttribute('stroke-width', '1.8')
    icon.append(crescent)
  }
  return icon
}

function getDisplayName(profile, email) {
  return profile?.nama_lengkap?.trim() || profile?.nama?.trim() || email || 'Akun'
}

function getInitials(profile, email) {
  const name = getDisplayName(profile, email)
  const parts = name === email ? [email.split('@')[0]] : name.split(/\s+/).filter(Boolean)
  return parts.length > 1
    ? `${parts[0][0]}${parts[1][0]}`.toLocaleUpperCase('id')
    : (parts[0]?.slice(0, 2) || '?').toLocaleUpperCase('id')
}

export function createTopbar({ onLogout = signOut } = {}) {
  const element = document.createElement('header')
  element.className = 'topbar'

  const menuButton = makeButton('Menu', 'menu-toggle')
  menuButton.setAttribute('aria-label', 'Buka menu navigasi')
  menuButton.setAttribute('aria-expanded', 'false')
  menuButton.setAttribute('aria-controls', 'main-content')

  const title = document.createElement('h1')
  title.className = 'topbar-title'
  title.textContent = 'Ringkasan Arsip'

  const actions = document.createElement('div')
  actions.className = 'topbar-actions'

  const searchForm = document.createElement('form')
  searchForm.className = 'global-search'
  searchForm.setAttribute('role', 'search')
  searchForm.addEventListener('submit', (event) => event.preventDefault())

  const searchInput = document.createElement('input')
  searchInput.type = 'search'
  searchInput.name = 'q'
  searchInput.setAttribute('aria-label', 'Cari nomor arsip atau judul')
  searchInput.placeholder = 'Cari nomor arsip atau judul...'

  let searchTimer = null
  searchInput.addEventListener('input', () => {
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('archive-search', { detail: searchInput.value.trim() }))
    }, 300)
  })
  searchForm.append(searchInput)

  const uploadButton = makeButton('+ Unggah Arsip', 'button button-primary', () => {
    const currentRoute = window.location.hash.replace(/^#/, '') || '/beranda'
    if (currentRoute === '/unggah') {
      window.dispatchEvent(new CustomEvent('archive-upload-request'))
    } else {
      window.location.hash = '/unggah'
    }
  })

  const themeButton = makeButton('', 'theme-toggle')
  themeButton.setAttribute('role', 'switch')
  themeButton.setAttribute('aria-checked', 'true')
  const themeLabel = document.createElement('span')
  themeLabel.className = 'theme-toggle-label'
  themeLabel.textContent = 'Mode'
  const themeTrack = document.createElement('span')
  themeTrack.className = 'theme-toggle-track'
  themeTrack.setAttribute('aria-hidden', 'true')
  const themeThumb = document.createElement('span')
  themeThumb.className = 'theme-toggle-thumb'
  const darkIcon = createThemeIcon('M20.5 15.5A8.5 8.5 0 0 1 8.5 3.5a8.6 8.6 0 1 0 12 12Z')
  darkIcon.classList.add('theme-toggle-moon')
  const lightIcon = createThemeIcon('', true)
  lightIcon.classList.add('theme-toggle-sun')
  themeTrack.append(lightIcon, darkIcon, themeThumb)
  themeButton.append(themeLabel, themeTrack)

  const themeMessage = document.createElement('span')
  themeMessage.className = 'theme-message'
  themeMessage.setAttribute('role', 'status')
  themeMessage.setAttribute('aria-live', 'polite')
  themeMessage.hidden = true

  function updateThemeControl(theme) {
    const dark = theme === 'dark'
    themeButton.setAttribute('aria-checked', String(dark))
    themeButton.setAttribute('aria-label', `Mode ${dark ? 'gelap' : 'terang'}`)
    themeButton.title = `Mode ${dark ? 'gelap' : 'terang'} aktif`
  }

  updateThemeControl(document.documentElement.dataset.theme || 'dark')
  themeButton.addEventListener('click', () => {
    const theme = themeButton.getAttribute('aria-checked') === 'true' ? 'light' : 'dark'
    const saved = setTheme(theme)
    updateThemeControl(theme)
    themeMessage.textContent = saved
      ? ''
      : 'Tema berubah, tetapi pilihan tidak tersimpan untuk kunjungan berikutnya.'
    themeMessage.hidden = saved
  })

  const account = document.createElement('div')
  account.className = 'account-menu'
  const accountButton = makeButton('?', 'avatar-button')
  accountButton.setAttribute('aria-label', 'Menu akun')
  accountButton.setAttribute('aria-expanded', 'false')
  accountButton.setAttribute('aria-controls', 'account-popover')

  const accountPopover = document.createElement('div')
  accountPopover.className = 'account-popover'
  accountPopover.id = 'account-popover'
  accountPopover.hidden = true
  const accountHeading = document.createElement('strong')
  accountHeading.textContent = 'Akun'
  const accountEmail = document.createElement('p')
  accountEmail.className = 'account-email'
  const accountMessage = document.createElement('p')
  accountMessage.className = 'account-message'
  accountMessage.setAttribute('role', 'status')
  const profileRetry = makeButton('Coba lagi', 'button button-outline account-logout')
  profileRetry.hidden = true
  const logoutButton = makeButton('Keluar', 'button button-outline account-logout')

  accountPopover.append(accountHeading, accountEmail, profileRetry, accountMessage, logoutButton)
  accountButton.addEventListener('click', () => {
    const open = accountPopover.hidden
    accountPopover.hidden = !open
    accountButton.setAttribute('aria-expanded', String(open))
  })
  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true
    accountMessage.textContent = 'Mengakhiri sesi…'
    try {
      await onLogout()
    } catch (error) {
      accountMessage.textContent = error.message
      logoutButton.disabled = false
    }
  })
  profileRetry.addEventListener('click', () => profileRetry.onRetry?.())
  account.append(accountButton, accountPopover)

  actions.append(searchForm, uploadButton, themeButton, themeMessage, account)
  element.append(menuButton, title, actions)

  let currentRole = null
  const closeAccountOnOutsideClick = (event) => {
    if (account.contains(event.target)) return
    accountPopover.hidden = true
    accountButton.setAttribute('aria-expanded', 'false')
  }
  document.addEventListener('click', closeAccountOnOutsideClick)

  return {
    element,
    menuButton,
    searchInput,
    uploadButton,
    setPageTitle(value) {
      title.textContent = value
    },
    setSearchVisible(visible) {
      searchForm.hidden = !visible || !currentRole
    },
    setRole(role) {
      currentRole = role
      uploadButton.hidden = !canManageArchives(role)
      searchForm.hidden = !role || window.location.hash.replace(/^#/, '') !== '/beranda'
    },
    setUser(profile, email) {
      const displayName = getDisplayName(profile, email)
      accountButton.textContent = getInitials(profile, email)
      accountButton.setAttribute('aria-label', `Menu akun ${displayName}`)
      accountHeading.textContent = displayName
      accountEmail.textContent = email ?? ''
      accountMessage.textContent = ''
      profileRetry.hidden = true
      profileRetry.disabled = false
    },
    setProfileLoading() {
      accountMessage.textContent = ''
      profileRetry.hidden = true
      profileRetry.disabled = false
    },
    setProfileError(message, onRetry) {
      accountMessage.textContent = message
      profileRetry.hidden = false
      profileRetry.disabled = false
      profileRetry.onRetry = onRetry
    },
    destroy() {
      window.clearTimeout(searchTimer)
      document.removeEventListener('click', closeAccountOnOutsideClick)
    },
  }
}
