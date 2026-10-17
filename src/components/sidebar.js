import { canAccessRoute } from '../services/accessControl.js'

const menuItems = [
  { path: '/beranda', label: 'Beranda' },
  { path: '/arsip', label: 'Daftar Arsip' },
  { path: '/unggah', label: 'Unggah & Digitalisasi' },
  { path: '/klasifikasi', label: 'Klasifikasi' },
  { path: '/retensi', label: 'Jadwal Retensi' },
  { path: '/akses', label: 'Hak Akses' },
  { path: '/audit', label: 'Log Audit' },
]

export function createSidebar() {
  const element = document.createElement('aside')
  element.className = 'sidebar'
  element.setAttribute('aria-label', 'Panel navigasi')

  const brand = document.createElement('a')
  brand.className = 'sidebar-brand'
  brand.href = '#/beranda'

  const institution = document.createElement('span')
  institution.className = 'brand-institution'
  institution.textContent = 'Humas Polres Metro Kota Bekasi'

  brand.append(institution)

  const navigation = document.createElement('nav')
  navigation.className = 'sidebar-navigation'
  navigation.setAttribute('aria-label', 'Menu utama')

  menuItems.forEach(({ path, label }) => {
    const link = document.createElement('a')
    link.href = `#${path}`
    link.dataset.route = path
    link.textContent = label
    navigation.append(link)
  })

  const footer = document.createElement('p')
  footer.className = 'sidebar-footer'
  footer.textContent = 'Sesi pengguna aktif'

  element.append(brand, navigation, footer)

  let backdrop = document.querySelector('.sidebar-backdrop')
  if (!backdrop) {
    backdrop = document.createElement('button')
    backdrop.type = 'button'
    backdrop.className = 'sidebar-backdrop'
    backdrop.setAttribute('aria-label', 'Tutup menu')
    document.body.append(backdrop)
  }

  const sidebar = {
    element,
    navigation,
    onNavigate: null,
    onClose: null,
    setRole(role) {
      navigation.querySelectorAll('a[data-route]').forEach((link) => {
        link.hidden = !canAccessRoute(role, link.dataset.route)
      })
      footer.textContent = role === 'admin'
        ? 'Sesi admin aktif'
        : role === 'petugas_arsip'
          ? 'Sesi petugas arsip aktif'
          : role === 'staf'
            ? 'Sesi staf aktif'
            : 'Fitur akun sedang dimuat'
    },
    open() {
      element.classList.add('is-open')
      backdrop.classList.add('is-visible')
      document.body.classList.add('menu-open')
    },
    close() {
      element.classList.remove('is-open')
      backdrop.classList.remove('is-visible')
      document.body.classList.remove('menu-open')
      sidebar.onClose?.()
    },
    toggle() {
      if (element.classList.contains('is-open')) sidebar.close()
      else sidebar.open()
    },
  }

  sidebar.setRole(null)

  const onNavigationClick = (event) => {
    if (event.target.closest('a[data-route]')) sidebar.onNavigate?.()
  }
  const onBackdropClick = () => sidebar.close()
  const onEscape = (event) => {
    if (event.key === 'Escape') sidebar.close()
  }
  navigation.addEventListener('click', onNavigationClick)
  backdrop.addEventListener('click', onBackdropClick)
  document.addEventListener('keydown', onEscape)

  sidebar.destroy = () => {
    navigation.removeEventListener('click', onNavigationClick)
    backdrop.removeEventListener('click', onBackdropClick)
    document.removeEventListener('keydown', onEscape)
    backdrop.remove()
  }

  return sidebar
}
