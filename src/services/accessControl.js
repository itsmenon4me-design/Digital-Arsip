const routesByRole = {
  admin: new Set([
    '/beranda',
    '/arsip',
    '/unggah',
    '/klasifikasi',
    '/retensi',
    '/akses',
    '/audit',
  ]),
  petugas_arsip: new Set([
    '/beranda',
    '/arsip',
    '/unggah',
    '/klasifikasi',
  ]),
  staf: new Set([
    '/beranda',
    '/arsip',
    '/klasifikasi',
  ]),
}

export function isKnownRole(role) {
  return Object.hasOwn(routesByRole, role)
}

export function canAccessRoute(role, route) {
  return routesByRole[role]?.has(route) ?? false
}

export function canManageArchives(role) {
  return role === 'admin' || role === 'petugas_arsip'
}
