const THEME_STORAGE_KEY = 'archive-theme'
const THEMES = new Set(['dark', 'light'])
const DEFAULT_THEME = 'dark'

function isTheme(value) {
  return THEMES.has(value)
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

export function initializeTheme() {
  let theme = DEFAULT_THEME
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (isTheme(savedTheme)) theme = savedTheme
  } catch (error) {
    console.error('Preferensi tema tidak dapat dibaca:', error)
  }

  applyTheme(theme)
  return theme
}

export function setTheme(theme) {
  if (!isTheme(theme)) throw new TypeError('Pilihan tema tidak valid.')

  applyTheme(theme)
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    return true
  } catch (error) {
    console.error('Preferensi tema tidak dapat disimpan:', error)
    return false
  }
}
