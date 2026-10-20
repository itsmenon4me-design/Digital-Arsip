import { createBerandaPage } from './pages/beranda.js'
import { createArchiveListPage } from './pages/archiveList.js'
import { createClassificationPage } from './pages/classification.js'
import { createRetentionSchedulePage } from './pages/retentionSchedule.js'
import { createUploadPage } from './pages/upload.js'
import { createAccessManagementPage } from './pages/accessManagement.js'
import { createAuditLogPage } from './pages/auditLog.js'
import {
  fetchArchiveCategories,
  fetchArchivePage,
  fetchClassifications,
  fetchRecentArchives,
  fetchRetentionPage,
} from './services/arsipService.js'
import { fetchAdminUserDirectory } from './services/adminService.js'
import { fetchAuditPage } from './services/auditService.js'
import { fetchDashboardStats } from './services/statService.js'
import { getReadCache } from './services/readCache.js'
import { canAccessRoute } from './services/accessControl.js'

const pages = {
  '/beranda': { title: 'Ringkasan Arsip', render: createBerandaPage },
  '/arsip': { title: 'Daftar Arsip', render: createArchiveListPage },
  '/unggah': { title: 'Unggah & Digitalisasi', render: createUploadPage },
  '/klasifikasi': { title: 'Klasifikasi', render: createClassificationPage },
  '/retensi': { title: 'Jadwal Retensi', render: createRetentionSchedulePage },
  '/akses': { title: 'Hak Akses', render: createAccessManagementPage },
  '/audit': { title: 'Log Audit', render: createAuditLogPage },
}

export function createRouter({
  outlet,
  navigation,
  topbar,
  isAuthenticated,
  onUnauthorized,
  getRole = () => null,
  isRoleLoaded = () => false,
  onRetryProfile = () => {},
}) {
  let cleanupCurrentPage = null
  let currentRoute = null
  const prefetchingRoutes = new Set()

  function prefetchRoute(route) {
    if (!isRoleLoaded() || !canAccessRoute(getRole(), route)) return
    if (prefetchingRoutes.has(route)) return

    const tasks = []
    if (route === '/beranda') {
      if (!getReadCache('dashboard-stats')) tasks.push(fetchDashboardStats())
      if (!getReadCache('archive-categories')) tasks.push(fetchArchiveCategories())
      if (!getReadCache('recent-archives', { category: '', status: '', search: '' })) {
        tasks.push(fetchRecentArchives())
      }
    } else if (route === '/arsip') {
      if (!getReadCache('archive-categories')) tasks.push(fetchArchiveCategories())
      const classificationParams = { includeInactive: getRole() === 'admin' }
      if (!getReadCache('classifications', classificationParams)) {
        tasks.push(fetchClassifications(classificationParams))
      }
      if (!getReadCache('archive-page', defaultArchivePageCacheParams())) {
        tasks.push(fetchArchivePage({ page: 1, pageSize: 20 }))
      }
    } else if (route === '/unggah') {
      if (!getReadCache('classifications')) tasks.push(fetchClassifications())
    } else if (route === '/klasifikasi') {
      const classificationParams = { includeInactive: getRole() === 'admin' }
      if (!getReadCache('classifications', classificationParams)) {
        tasks.push(fetchClassifications(classificationParams))
      }
    } else if (route === '/retensi') {
      if (!getReadCache('retention-page', { page: 1, pageSize: 20 })) {
        tasks.push(fetchRetentionPage({ page: 1, pageSize: 20 }))
      }
    } else if (route === '/akses') {
      if (!getReadCache('admin-users')) tasks.push(fetchAdminUserDirectory())
    } else if (route === '/audit') {
      if (!getReadCache('audit-page', {
        page: 1,
        pageSize: 20,
        action: '',
        fromDate: '',
        toDate: '',
      })) {
        tasks.push(fetchAuditPage({ page: 1, pageSize: 20 }))
      }
    }

    if (!tasks.length) return
    prefetchingRoutes.add(route)
    Promise.all(tasks)
      .catch((error) => console.error(`Gagal menyiapkan data halaman ${route}:`, error))
      .finally(() => prefetchingRoutes.delete(route))
  }

  function defaultArchivePageCacheParams() {
    return {
      page: 1,
      pageSize: 20,
      category: '',
      status: '',
      search: '',
      classificationId: '',
      fromDate: '',
      toDate: '',
      unit: '',
    }
  }

  function onNavigationIntent(event) {
    const link = event.target.closest('a[data-route]')
    if (link) prefetchRoute(link.dataset.route)
  }
  navigation.addEventListener('pointerover', onNavigationIntent)
  navigation.addEventListener('focusin', onNavigationIntent)
  const onUploadIntent = () => prefetchRoute('/unggah')
  topbar.uploadButton.addEventListener('pointerover', onUploadIntent)
  topbar.uploadButton.addEventListener('focus', onUploadIntent)

  function render() {
    const requestedRoute = window.location.hash.replace(/^#/, '') || '/beranda'
    if (!isAuthenticated()) {
      onUnauthorized()
      return
    }
    if (requestedRoute === '/login') {
      window.location.hash = '/beranda'
      return
    }
    if (requestedRoute === '/pencarian') {
      window.location.hash = '/arsip'
      return
    }
    const role = getRole()
    const roleLoaded = isRoleLoaded()
    const route = roleLoaded
      ? canAccessRoute(role, requestedRoute) ? requestedRoute : '/beranda'
      : pages[requestedRoute] ? requestedRoute : '/beranda'
    if (roleLoaded && role && requestedRoute !== route) {
      window.location.hash = route
    }
    const page = pages[route] ?? pages['/beranda']
    if (currentRoute !== route) {
      window.scrollTo(0, 0)
      currentRoute = route
    }
    topbar.setPageTitle(page.title)
    topbar.setSearchVisible(route === '/beranda')
    cleanupCurrentPage?.()
    cleanupCurrentPage = null

    if (!roleLoaded) {
      const state = document.createElement('section')
      state.className = 'profile-loading-state reference-page'
      state.setAttribute('role', 'status')
      state.setAttribute('aria-live', 'polite')
      const heading = document.createElement('section')
      heading.className = 'page-heading'
      const headingCopy = document.createElement('div')
      const kicker = document.createElement('p')
      kicker.className = 'section-kicker'
      kicker.textContent = 'MENYIAPKAN HALAMAN'
      const title = document.createElement('h2')
      title.textContent = page.title
      const description = document.createElement('p')
      description.textContent = 'Memeriksa akses akun sebelum menampilkan isi halaman.'
      headingCopy.append(kicker, title, description)
      heading.append(headingCopy)

      const panel = document.createElement('section')
      panel.className = 'panel profile-loading-panel'
      const panelHeading = document.createElement('div')
      panelHeading.className = 'profile-loading-panel-heading'
      panelHeading.setAttribute('aria-hidden', 'true')
      const titlePlaceholder = document.createElement('span')
      titlePlaceholder.className = 'profile-loading-placeholder profile-loading-placeholder-title'
      const contentPlaceholder = document.createElement('div')
      contentPlaceholder.className = 'profile-loading-placeholder-group'
      contentPlaceholder.setAttribute('aria-hidden', 'true')
      for (let index = 0; index < 5; index += 1) {
        const row = document.createElement('span')
        row.className = `profile-loading-placeholder profile-loading-placeholder-row profile-loading-placeholder-row-${index % 3 + 1}`
        contentPlaceholder.append(row)
      }
      panelHeading.append(titlePlaceholder)
      panel.append(panelHeading, contentPlaceholder)
      state.append(heading, panel)
      outlet.replaceChildren(state)
      return
    }

    if (!role) {
      const state = document.createElement('section')
      state.className = 'panel access-restriction-state'
      state.setAttribute('role', 'status')
      const heading = document.createElement('h2')
      const message = document.createElement('p')
      const retry = document.createElement('button')
      retry.type = 'button'
      retry.className = 'button button-outline'
      retry.textContent = 'Coba lagi'
      retry.addEventListener('click', onRetryProfile)
      heading.textContent = 'Peran akun belum tersedia'
      message.textContent = 'Profil akun belum tersedia atau gagal dibaca. Minta administrator memastikan profil memiliki peran admin atau petugas, lalu coba lagi.'
      state.append(heading, message, retry)
      outlet.replaceChildren(state)
      return
    }

    navigation.querySelectorAll('a[data-route]').forEach((link) => {
      if (link.dataset.route === route) {
        link.setAttribute('aria-current', 'page')
      } else {
        link.removeAttribute('aria-current')
      }
    })

    const renderedPage = page.render({
      title: page.title,
      role,
      roleLoaded,
    })
    if (renderedPage.element instanceof HTMLElement) {
      outlet.replaceChildren(renderedPage.element)
      cleanupCurrentPage = renderedPage.destroy ?? null
      if (window.location.hash !== `#${route}`) {
        window.location.hash = route
      }
    } else {
      outlet.replaceChildren(renderedPage)
      cleanupCurrentPage = null
    }
  }

  return {
    render,
    destroy() {
      cleanupCurrentPage?.()
      cleanupCurrentPage = null
      navigation.removeEventListener('pointerover', onNavigationIntent)
      navigation.removeEventListener('focusin', onNavigationIntent)
      topbar.uploadButton.removeEventListener('pointerover', onUploadIntent)
      topbar.uploadButton.removeEventListener('focus', onUploadIntent)
    },
  }
}
