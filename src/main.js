import './styles/variables.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'
import { createSidebar } from './components/sidebar.js'
import { createTopbar } from './components/topbar.js'
import { createLoginPage } from './pages/login.js'
import { createRouter } from './router.js'
import { clearReadCache } from './services/readCache.js'
import { isKnownRole } from './services/accessControl.js'
import {
  getCurrentSession,
  getProfile,
  getSupabaseConfigMessage,
  signInWithPassword,
  subscribeToAuthState,
  signOut,
} from './services/authService.js'
import { initializeTheme } from './services/themeService.js'

const app = document.querySelector('#app')
let session = null
let loginPage = null
let shell = null
let authEventVersion = 0
initializeTheme()

function destroyShell() {
  if (!shell) return
  shell.router.destroy()
  shell.topbar.destroy()
  shell.sidebar.close()
  shell.sidebar.destroy()
  shell.layout.remove()
  shell = null
}

function showLogin(initialMessage = '') {
  destroyShell()
  if (!loginPage) {
    loginPage = createLoginPage({
      configMessage: getSupabaseConfigMessage(),
      initialMessage,
      onSubmit: async ({ email, password }) => {
        const result = await signInWithPassword(email, password)
        session = result.session
        window.location.hash = '/beranda'
        loginPage?.remove()
        loginPage = null
        showDashboard()
      },
    })
    app.replaceChildren(loginPage)
  }

  if (window.location.hash !== '#/login') {
    window.location.hash = '/login'
  }
}

function showDashboard() {
  if (!session?.user) {
    showLogin()
    return
  }

  if (shell && shell.userId !== session.user.id) destroyShell()

  if (loginPage) {
    loginPage.remove()
    loginPage = null
  }

  if (!shell) {
    const layout = document.createElement('div')
    layout.className = 'app-layout'

    const sidebar = createSidebar()
    const main = document.createElement('main')
    main.className = 'main-content'
    main.id = 'main-content'
    main.tabIndex = -1

    const topbar = createTopbar({ onLogout: signOut })
    const page = document.createElement('div')
    page.id = 'page-content'
    page.className = 'page-content'
    main.append(topbar.element, page)
    layout.append(sidebar.element, main)
    app.replaceChildren(layout)

    const router = createRouter({
      outlet: page,
      navigation: sidebar.navigation,
      topbar,
      isAuthenticated: () => Boolean(session?.user),
      onUnauthorized: () => showLogin(),
      getRole: () => shell?.userRole ?? null,
      isRoleLoaded: () => Boolean(shell?.profileLoaded),
      onRetryProfile: () => {
        if (shell && session?.user) {
          loadProfileForUser(shell, session.user.id, session.user.email)
        }
      },
    })

    sidebar.onNavigate = () => sidebar.close()
    sidebar.onClose = () => topbar.menuButton.setAttribute('aria-expanded', 'false')
    topbar.menuButton.addEventListener('click', () => {
      sidebar.toggle()
      topbar.menuButton.setAttribute(
        'aria-expanded',
        String(sidebar.element.classList.contains('is-open')),
      )
    })

    shell = {
      layout,
      sidebar,
      topbar,
      render: router.render,
      router,
      userId: session.user.id,
      userRole: null,
      profileLoaded: false,
    }
  }

  const currentShell = shell
  if (currentShell.profileUserId === session.user.id) return
  currentShell.profileUserId = session.user.id
  loadProfileForUser(currentShell, session.user.id, session.user.email)
  currentShell.render()
}

function loadProfileForUser(currentShell, userId, email) {
  currentShell.profileLoaded = false
  currentShell.userRole = null
  currentShell.sidebar.setRole(null)
  currentShell.topbar.setRole(null)
  currentShell.topbar.setUser(null, email)
  currentShell.topbar.setProfileLoading()
  getProfile(userId)
    .then((profile) => {
      if (session?.user?.id === userId && shell === currentShell) {
        const role = profile?.role
        currentShell.userRole = isKnownRole(role) ? role : null
        currentShell.profileLoaded = true
        currentShell.sidebar.setRole(currentShell.userRole)
        currentShell.topbar.setRole(currentShell.userRole)
        currentShell.topbar.setUser(profile, email)
        if (!currentShell.userRole) {
          currentShell.topbar.setProfileError(
            'Profil akun belum terdaftar atau perannya tidak valid. Minta administrator memperbarui profil akun, lalu coba lagi.',
            () => loadProfileForUser(currentShell, userId, email),
          )
        }
        currentShell.render()
      }
    })
    .catch((error) => {
      if (session?.user?.id === userId && shell === currentShell) {
        console.error('Profil pengguna gagal dimuat:', error)
        currentShell.userRole = null
        currentShell.profileLoaded = true
        currentShell.sidebar.setRole(null)
        currentShell.topbar.setRole(null)
        currentShell.topbar.setUser(null, email)
        currentShell.topbar.setProfileError(
          'Peran akun belum dapat dipastikan. Fitur khusus peran tetap dikunci.',
          () => loadProfileForUser(currentShell, userId, email),
        )
        currentShell.render()
      }
    })
}

function handleAuthChange(nextSession) {
  const previousUserId = session?.user?.id
  session = nextSession
  if (previousUserId !== session?.user?.id) clearReadCache()
  if (session?.user && previousUserId === session.user.id && shell) return
  if (session?.user) showDashboard()
  else showLogin()
}

window.addEventListener('hashchange', () => {
  if (session?.user && shell) shell.render()
  else showLogin()
})

if (!app) {
  throw new Error('Elemen aplikasi #app tidak ditemukan.')
}

const bootState = document.createElement('main')
bootState.className = 'app-boot-state'
bootState.setAttribute('role', 'status')
bootState.setAttribute('aria-live', 'polite')
bootState.textContent = 'Memeriksa sesi pengguna…'
app.replaceChildren(bootState)

if (!getSupabaseConfigMessage()) {
  const subscription = subscribeToAuthState((_event, nextSession) => {
    authEventVersion += 1
    handleAuthChange(nextSession)
  })

  const versionBeforeSessionRead = authEventVersion
  getCurrentSession()
    .then((initialSession) => {
      if (authEventVersion === versionBeforeSessionRead) handleAuthChange(initialSession)
    })
    .catch((error) => {
      if (authEventVersion === versionBeforeSessionRead) showLogin(error.message)
    })

  window.addEventListener('pagehide', () => subscription.unsubscribe(), { once: true })
} else {
  showLogin()
}
