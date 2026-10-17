export function createPlaceholderPage({ title }) {
  const section = document.createElement('section')
  section.className = 'placeholder-page panel'
  const kicker = document.createElement('p')
  kicker.className = 'section-kicker'
  kicker.textContent = 'TAHAP BERIKUTNYA'
  const heading = document.createElement('h2')
  heading.textContent = title
  const body = document.createElement('p')
  body.textContent = 'Halaman ini akan disambungkan pada tahap integrasi Supabase. Navigasi sudah tersedia untuk pratinjau alur aplikasi.'
  const returnLink = document.createElement('a')
  returnLink.className = 'button button-primary'
  returnLink.href = '#/beranda'
  returnLink.textContent = 'Kembali ke Beranda'
  section.append(kicker, heading, body, returnLink)
  return section
}
