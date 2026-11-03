export function createLoginPage({ onSubmit, configMessage = '', initialMessage = '' }) {
  const section = document.createElement('main')
  section.className = 'login-page'
  section.setAttribute('aria-labelledby', 'login-title')

  const card = document.createElement('section')
  card.className = 'login-card'
  const brand = document.createElement('p')
  brand.className = 'login-brand'
  brand.textContent = 'Humas Polres Metro Bekasi Kota'
  const title = document.createElement('h1')
  title.id = 'login-title'
  title.textContent = 'Masuk ke Dasbor Arsip'
  const form = document.createElement('form')
  form.className = 'login-form'
  const emailLabel = document.createElement('label')
  emailLabel.htmlFor = 'login-email'
  emailLabel.textContent = 'Email'
  const emailInput = document.createElement('input')
  emailInput.id = 'login-email'
  emailInput.name = 'email'
  emailInput.type = 'email'
  emailInput.autocomplete = 'username'
  emailInput.inputMode = 'email'
  emailInput.required = true
  emailInput.maxLength = 254

  const passwordLabel = document.createElement('label')
  passwordLabel.htmlFor = 'login-password'
  passwordLabel.textContent = 'Kata sandi'
  const passwordInput = document.createElement('input')
  passwordInput.id = 'login-password'
  passwordInput.name = 'password'
  passwordInput.type = 'password'
  passwordInput.autocomplete = 'current-password'
  passwordInput.required = true

  const message = document.createElement('p')
  message.className = 'login-message'
  message.setAttribute('role', 'alert')
  message.textContent = initialMessage
  message.hidden = !initialMessage

  const submit = document.createElement('button')
  submit.className = 'button button-primary login-submit'
  submit.type = 'submit'
  submit.textContent = 'Masuk'
  submit.disabled = Boolean(configMessage)

  const configNote = document.createElement('p')
  configNote.className = 'login-config-note'
  configNote.textContent = configMessage
  configNote.hidden = !configMessage

  form.append(emailLabel, emailInput, passwordLabel, passwordInput, message, submit, configNote)
  card.append(brand, title, form)
  section.append(card)

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!form.reportValidity() || submit.disabled) return

    submit.disabled = true
    submit.textContent = 'Memeriksa akun…'
    message.hidden = true
    message.textContent = ''
    try {
      await onSubmit({ email: emailInput.value, password: passwordInput.value })
    } catch (error) {
      message.textContent = error.message
      message.hidden = false
      submit.disabled = Boolean(configMessage)
      submit.textContent = 'Masuk'
      passwordInput.focus()
    }
  })

  return section
}
