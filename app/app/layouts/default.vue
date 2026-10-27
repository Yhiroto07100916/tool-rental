<template>
  <v-app-bar
    elevation="1"
    color="white"
    height="64"
  >
    <v-app-bar-nav-icon
      class="d-md-none"
      @click="drawer = !drawer"
    />

    <v-toolbar-title class="font-weight-bold">
      🔧 工具・機材貸出管理
    </v-toolbar-title>

    <v-spacer />

    <div class="d-none d-md-flex align-center ga-1">
      <v-btn
        v-for="item in visibleMenuItems"
        :key="item.to"
        :to="item.to"
        :prepend-icon="item.icon"
        :color="item.color"
        variant="text"
        rounded="lg"
      >
        {{ item.title }}
      </v-btn>

      <v-btn
        v-if="auth.isAdmin.value"
        to="/settings/account"
        prepend-icon="mdi-account-cog-outline"
        color="deep-purple"
        variant="text"
        rounded="lg"
      >
        全体設定
      </v-btn>

      <v-btn
        prepend-icon="mdi-logout"
        color="error"
        variant="text"
        rounded="lg"
        @click="logout"
      >
        ログアウト
      </v-btn>
    </div>
  </v-app-bar>

  <v-navigation-drawer
    v-model="drawer"
    temporary
    class="d-md-none"
  >
    <v-list nav>
      <v-list-subheader>
        管理メニュー
      </v-list-subheader>

      <v-list-item
        v-for="item in visibleMenuItems"
        :key="item.to"
        :to="item.to"
        :prepend-icon="item.icon"
        :title="item.title"
        rounded="lg"
        @click="drawer = false"
      />

      <v-divider class="my-2" />

      <v-list-item
        v-if="auth.isAdmin.value"
        prepend-icon="mdi-account-cog-outline"
        title="全体設定"
        rounded="lg"
        to="/settings/account"
        @click="drawer = false"
      />

      <v-list-item
        prepend-icon="mdi-logout"
        title="ログアウト"
        rounded="lg"
        @click="logout"
      />
    </v-list>
  </v-navigation-drawer>

  <v-main>
    <div class="page-container pa-4 pa-md-8">
      <slot />
    </div>
  </v-main>

  <v-dialog
    v-model="adminReauthDialog"
    max-width="420"
    persistent
  >
    <v-card>
      <v-card-title class="pa-6 pb-2">
        管理者認証
      </v-card-title>

      <v-card-text class="pa-6">
        <div class="text-body-2 text-medium-emphasis mb-4">
          このページを開くには、現在ログインしている管理者のパスワードを入力してください。
        </div>

        <v-alert
          v-if="adminReauthError"
          type="error"
          variant="tonal"
          class="mb-4"
        >
          {{ adminReauthError }}
        </v-alert>

        <v-text-field
          v-model="adminReauthPassword"
          label="現在のパスワード"
          type="password"
          autocomplete="current-password"
          autofocus
          :disabled="adminReauthLoading"
          @keyup.enter="verifyAdminPassword"
        />
      </v-card-text>

      <v-card-actions class="px-6 pb-6">
        <v-spacer />

        <v-btn
          variant="text"
          :disabled="adminReauthLoading"
          @click="cancelAdminReauth"
        >
          キャンセル
        </v-btn>

        <v-btn
          color="primary"
          :loading="adminReauthLoading"
          :disabled="!adminReauthPassword"
          @click="verifyAdminPassword"
        >
          認証する
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
console.log(
  '[default.vue] setup',
  import.meta.server
    ? 'server'
    : 'client',
  import.meta.client
    ? window.location.href
    : 'SSR',
)

const drawer = ref(false)

const auth = useAuth()
const api = useApi()
const route = useRoute()

const adminReauthDialog = ref(false)
const adminReauthPassword = ref('')
const adminReauthError = ref('')
const adminReauthLoading = ref(false)
const pendingAdminPath = ref('')

const adminOnlyPaths = [
  '/settings/account',
]

const isAdminOnlyPath = (path: string) =>
  adminOnlyPaths.some(
    adminPath =>
      path === adminPath ||
      path.startsWith(`${adminPath}/`),
  )

const openAdminReauth = (path: string) => {
  pendingAdminPath.value = path
  adminReauthPassword.value = ''
  adminReauthError.value = ''
  adminReauthDialog.value = true
}

const cancelAdminReauth = async () => {
  adminReauthDialog.value = false
  adminReauthPassword.value = ''
  adminReauthError.value = ''

  if (
    pendingAdminPath.value &&
    route.path === pendingAdminPath.value
  ) {
    await navigateTo('/')
  }

  pendingAdminPath.value = ''
}

const verifyAdminPassword = async () => {
  if (
    adminReauthLoading.value ||
    !adminReauthPassword.value
  ) {
    return
  }

  adminReauthLoading.value = true
  adminReauthError.value = ''

  try {
    await api.request<{
      detail: string
    }>(
      '/auth/reauth',
      {
        method: 'POST',
        body: {
          password: adminReauthPassword.value,
        },
      },
      {
        redirectOnUnauthorized: false,
      },
    )

    auth.adminReauthenticated.value = true

    adminReauthDialog.value = false
    adminReauthPassword.value = ''

    const target = pendingAdminPath.value
    pendingAdminPath.value = ''

    if (
      target &&
      route.path !== target
    ) {
      await navigateTo(target)
    }
  } catch (error: any) {
    adminReauthError.value =
      error?.data?.detail ??
      'パスワードが正しくありません'
  } finally {
    adminReauthLoading.value = false
  }
}

watch(
  () => route.path,
  path => {
    if (!auth.isAdmin.value) {
      return
    }

    // 管理者専用ページへ移動したら、毎回再認証を要求する
    if (isAdminOnlyPath(path)) {
      auth.adminReauthenticated.value = false

      openAdminReauth(path)
      return
    }

    // 管理者専用ページを離れたら認証状態をリセット
    auth.adminReauthenticated.value = false
    adminReauthDialog.value = false
    adminReauthPassword.value = ''
    adminReauthError.value = ''
    pendingAdminPath.value = ''
  },
  { immediate: true },
)

const menuItems = [
  {
    title: 'ホーム',
    icon: 'mdi-view-dashboard-outline',
    to: '/',
    adminOnly: false,
  },
  {
    title: '工具・機材管理',
    icon: 'mdi-tools',
    to: '/tools',
    adminOnly: false,
    color: 'primary',
  },
  {
    title: '貸出',
    color: 'primary',
    icon: 'mdi-arrow-right-bold-circle-outline',
    to: '/loans',
    adminOnly: false,
  },
  {
    title: '予約',
    color: 'warning',
    icon: 'mdi-calendar-clock-outline',
    to: '/reservations',
    adminOnly: false,
  },
  {
    title: '返却',
    color: 'success',
    icon: 'mdi-arrow-left-bold-circle-outline',
    to: '/loans/return',
    adminOnly: false,
  },
  {
    title: '貸出中',
    color: 'info',
    icon: 'mdi-clipboard-clock-outline',
    to: '/loans/current',
    adminOnly: false,
  },
  {
    title: '履歴',
    color: 'secondary',
    icon: 'mdi-history',
    to: '/loans/history',
    adminOnly: false,
  },
]

const visibleMenuItems = computed(() =>
  menuItems.filter(
    item =>
      !item.adminOnly ||
      auth.isAdmin.value,
  ),
)

const logout = async () => {
  auth.logout()
  drawer.value = false
  await navigateTo('/login')
}
</script>
