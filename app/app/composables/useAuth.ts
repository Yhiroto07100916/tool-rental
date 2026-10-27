const AUTH_TOKEN_KEY = 'tool-rental-auth-token'
const AUTH_ROLE_KEY = 'tool-rental-auth-role'

export const useAuth = () => {
  const token = useState<string | null>(
    'tool-rental-auth-token',
    () => null,
  )

  const role = useState<'admin' | 'staff' | null>(
    'tool-rental-auth-role',
    () => null,
  )

  const initialized = useState(
    'tool-rental-auth-initialized',
    () => false,
  )

  const adminReauthenticated = useState(
    'tool-rental-admin-reauthenticated',
    () => false,
  )

  const initialize = () => {
    if (!import.meta.client || initialized.value) {
      return
    }

    token.value = sessionStorage.getItem(AUTH_TOKEN_KEY)

    const storedRole = sessionStorage.getItem(AUTH_ROLE_KEY)

    if (
      storedRole === 'admin' ||
      storedRole === 'staff'
    ) {
      role.value = storedRole
    } else {
      role.value = null
    }

    initialized.value = true
  }

  const login = (
    newToken: string,
    newRole: 'admin' | 'staff',
  ) => {
    token.value = newToken
    role.value = newRole

    if (import.meta.client) {
      sessionStorage.setItem(
        AUTH_TOKEN_KEY,
        newToken,
      )
      sessionStorage.setItem(
        AUTH_ROLE_KEY,
        newRole,
      )
    }

    initialized.value = true
  }

  const logout = () => {
    token.value = null
    role.value = null
    adminReauthenticated.value = false

    if (import.meta.client) {
      sessionStorage.removeItem(AUTH_TOKEN_KEY)
      sessionStorage.removeItem(AUTH_ROLE_KEY)
    }

    initialized.value = true
  }

  const isAuthenticated = computed(() => {
    initialize()
    return !!token.value
  })

  const isAdmin = computed(() => {
    initialize()
    return role.value === 'admin'
  })

  const isStaff = computed(() => {
    initialize()
    return role.value === 'staff'
  })

  const getToken = () => {
    initialize()
    return token.value
  }

  return {
    token,
    role,
    initialized,
    adminReauthenticated,
    isAuthenticated,
    isAdmin,
    isStaff,
    getToken,
    login,
    logout,
    initialize,
  }
}
