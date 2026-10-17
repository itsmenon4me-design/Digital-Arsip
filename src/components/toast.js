let activeToast = null
let dismissTimer = null

export function showToast(message, type = 'success') {
  if (activeToast) activeToast.remove()
  window.clearTimeout(dismissTimer)

  const toast = document.createElement('div')
  toast.className = `app-toast app-toast-${type}`
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status')
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite')
  toast.textContent = message
  document.body.append(toast)
  activeToast = toast
  dismissTimer = window.setTimeout(() => {
    if (activeToast === toast) activeToast = null
    toast.remove()
  }, 5000)
}
