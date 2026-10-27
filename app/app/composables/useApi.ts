export const useApi = () => {
  const config = useRuntimeConfig()
  const auth = useAuth()

  const request = async <T>(
    path: string,
    options: Parameters<typeof $fetch<T>>[1] = {},
    requestOptions: {
      redirectOnUnauthorized?: boolean
    } = {},
  ): Promise<T> => {
    const token = auth.getToken()

    const headers = new Headers(
      (options as any).headers ?? {},
    )

    if (token) {
      headers.set(
        'Authorization',
        `Bearer ${token}`,
      )
    }

    try {
      return await $fetch<T>(path, {
        baseURL: config.public.apiBaseUrl,
        ...options,
        headers,
      })
    } catch (error: any) {
      if (
        error?.response?.status === 401 &&
        import.meta.client &&
        requestOptions.redirectOnUnauthorized !== false
      ) {
        auth.logout()

        if (window.location.pathname !== '/login') {
          await navigateTo('/login')
        }
      }

      throw error
    }
  }

  return {
    request,
  }
}
