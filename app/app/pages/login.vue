<template>
  <div class="login-page">
    <div class="login-main">
      <v-card
        class="login-card pa-6"
        elevation="3"
      >
        <div class="text-center mb-6">
          <div class="text-h5 font-weight-bold">
            🔧 工具・機材貸出管理
          </div>

          <div class="text-body-2 text-medium-emphasis mt-2">
            管理者ログイン
          </div>
        </div>

        <v-form @submit.prevent="submit">
          <v-text-field
            v-model="username"
            label="ID"
            autocomplete="username"
            :disabled="loading"
            class="mb-3"
          />

          <v-text-field
            v-model="password"
            label="パスワード"
            type="password"
            autocomplete="current-password"
            :disabled="loading"
            class="mb-2"
          />

          <v-alert
            v-if="errorMessage"
            type="error"
            variant="tonal"
            class="mb-4"
          >
            {{ errorMessage }}
          </v-alert>

          <v-btn
            type="submit"
            color="primary"
            size="large"
            block
            :loading="loading"
          >
            ログイン
          </v-btn>
        </v-form>
      </v-card>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: false,
})

const config = useRuntimeConfig()
const auth = useAuth()
const router = useRouter()

const username = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')

onMounted(() => {
  document.documentElement.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'
})

onBeforeUnmount(() => {
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
})

const syncCredentialsFromInputs = () => {
  if (!import.meta.client) {
    return
  }

  const usernameInput =
    document.querySelector<HTMLInputElement>(
      'input[autocomplete="username"]',
    )

  const passwordInput =
    document.querySelector<HTMLInputElement>(
      'input[autocomplete="current-password"]',
    )

  if (usernameInput) {
    username.value = usernameInput.value
  }

  if (passwordInput) {
    password.value = passwordInput.value
  }
}

const submit = async () => {
  syncCredentialsFromInputs()

  errorMessage.value = ''

  if (!username.value || !password.value) {
    errorMessage.value =
      'IDとパスワードを入力してください'
    return
  }

  loading.value = true

  try {
    const response = await $fetch<{
      token: string
      expires_at: number
      role: 'admin' | 'staff'
    }>('/auth/login', {
      baseURL: config.public.apiBaseUrl,
      method: 'POST',
      body: {
        username: username.value,
        password: password.value,
      },
    })

    auth.login(response.token,response.role,)

    await router.push('/')
  } catch (error: any) {
    errorMessage.value =
      error?.data?.detail ??
      'ログインに失敗しました'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  width: 100%;
  height: 100dvh;
  min-height: 100dvh;
  overflow: hidden;
}

.login-main {
  width: 100%;
  height: 100dvh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: hidden;
}

.login-card {
  width: 100%;
  max-width: 420px;
}
</style>
