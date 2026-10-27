export default defineNuxtRouteMiddleware((to) => {
  console.log(
    '[auth.global]',
    to.fullPath,
    import.meta.server ? 'server' : 'client',
  )

  if (to.path === '/login') {
    return
  }

  if (import.meta.server) {
    return
  }

  const auth = useAuth()

  auth.initialize()

  console.log(
    '[auth.global] auth state',
    {
      initialized: auth.initialized.value,
      authenticated: !!auth.token.value,
      tokenExists: !!auth.token.value,
      role: auth.role.value,
    },
  )

  if (!auth.initialized.value) {
    return
  }

  if (!auth.token.value) {
    return navigateTo('/login')
  }

  const adminOnlyPaths = [
    '/settings/account',
  ]

  const isAdminOnlyPath = adminOnlyPaths.some(
    path =>
      to.path === path ||
      to.path.startsWith(`${path}/`),
  )

  if (
    isAdminOnlyPath &&
    !auth.isAdmin.value
  ) {
    return navigateTo('/')
  }
})
