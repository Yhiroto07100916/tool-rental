<template>
  <div>
    <div class="mb-6">
      <div class="page-title">
        ダッシュボード
      </div>

      <div class="page-subtitle">
        工具・機材の貸出状況を確認できます。
      </div>
    </div>

    <v-row>
      <v-col
        cols="12"
        sm="6"
        lg="3"
      >
        <v-card
          class="pa-5 h-100"
          elevation="1"
        >
          <div class="stat-label mb-3">
            登録工具・機材
          </div>

          <div class="stat-value">
            {{ tools.length }}
          </div>

          <div class="text-medium-emphasis mt-2">
            種類
          </div>
        </v-card>
      </v-col>

      <v-col
        cols="12"
        sm="6"
        lg="3"
      >
        <v-card
          class="pa-5 h-100"
          elevation="1"
        >
          <div class="stat-label mb-3">
            総在庫数
          </div>

          <div class="stat-value">
            {{ totalQuantity }}
          </div>

          <div class="text-medium-emphasis mt-2">
            個
          </div>
        </v-card>
      </v-col>

      <v-col
        cols="12"
        sm="6"
        lg="3"
      >
        <v-card
          class="pa-5 h-100"
          elevation="1"
        >
          <div class="stat-label mb-3">
            貸出可能
          </div>

          <div class="stat-value text-success">
            {{ availableQuantity }}
          </div>

          <div class="text-medium-emphasis mt-2">
            個
          </div>
        </v-card>
      </v-col>

      <v-col
        cols="12"
        sm="6"
        lg="3"
      >
        <v-card
          class="pa-5 h-100"
          elevation="1"
        >
          <div class="stat-label mb-3">
            現在貸出中
          </div>

          <div class="stat-value text-warning">
            {{ currentLoanCount }}
          </div>

          <div class="text-medium-emphasis mt-2">
            件
          </div>
        </v-card>
      </v-col>
    </v-row>

    <v-row class="mt-2">
      <v-col
        cols="12"
        lg="7"
      >
        <v-card
          elevation="1"
          class="h-100"
        >
          <v-card-title class="d-flex align-center">
            <span>工具・機材の在庫状況</span>

            <v-spacer />

            <v-btn
              to="/tools"
              variant="text"
              color="primary"
            >
              工具・機材管理
            </v-btn>
          </v-card-title>

          <v-divider />

          <v-card-text>
            <div class="inventory-table">
              <v-table fixed-header height="420">
                <thead>
                  <tr>
                    <th>工具・機材</th>
                    <th>カテゴリ</th>
                    <th>在庫</th>
                    <th>状態</th>
                  </tr>
                </thead>

                <tbody>
                  <tr
                    v-for="tool in tools"
                    :key="tool.id"
                  >
                    <td class="font-weight-medium">
                      {{ tool.name }}
                    </td>

                    <td>
                      {{ tool.category || '-' }}
                    </td>

                    <td>
                      {{ tool.available_quantity }} / {{ tool.quantity }}
                    </td>

                    <td>
                      <v-chip
                        :color="tool.available_quantity > 0 ? 'success' : 'error'"
                        size="small"
                        variant="tonal"
                      >
                        {{ tool.available_quantity > 0 ? '貸出可能' : '在庫なし' }}
                      </v-chip>
                    </td>
                  </tr>

                  <tr v-if="tools.length === 0">
                    <td
                      colspan="4"
                      class="table-empty"
                    >
                      工具・機材が登録されていません。
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col
        cols="12"
        lg="5"
      >
        <v-card
          elevation="1"
          class="h-100"
        >
          <v-card-title>
            クイック操作
          </v-card-title>

          <v-divider />

          <v-card-text>
            <v-btn
              to="/loans"
              color="primary"
              size="large"
              block
              prepend-icon="mdi-arrow-right-bold-circle-outline"
              class="mb-3"
            >
              工具・機材を貸し出す
            </v-btn>

            <v-btn
              to="/loans/return"
              color="success"
              size="large"
              block
              prepend-icon="mdi-arrow-left-bold-circle-outline"
              class="mb-3"
            >
              工具・機材を返却する
            </v-btn>

            <v-btn
              to="/loans/current"
              variant="outlined"
              size="large"
              block
              prepend-icon="mdi-clipboard-clock-outline"
              class="mb-3"
            >
              現在の貸出を確認
            </v-btn>

            <v-btn
              to="/loans/history"
              variant="outlined"
              size="large"
              block
              prepend-icon="mdi-history"
            >
              貸出履歴を見る
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-alert
      v-if="errorMessage"
      type="error"
      variant="tonal"
      class="mt-6"
    >
      {{ errorMessage }}
    </v-alert>
  </div>
</template>

<script setup lang="ts">
console.log(
  '[index.vue] setup',
  import.meta.server ? 'server' : 'client',
  import.meta.client ? window.location.href : 'SSR',
)

import type { Loan, Tool } from '~/types'

const { request } = useApi()

const tools = ref<Tool[]>([])
const currentLoans = ref<Loan[]>([])
const errorMessage = ref('')

const totalQuantity = computed(() =>
  tools.value.reduce((sum, tool) => sum + tool.quantity, 0),
)

const availableQuantity = computed(() =>
  tools.value.reduce((sum, tool) => sum + tool.available_quantity, 0),
)

const currentLoanCount = computed(() => currentLoans.value.length)

const loadDashboard = async () => {
  errorMessage.value = ''

  try {
    const [toolData, loanData] = await Promise.all([
      request<Tool[]>('/tools'),
      request<Loan[]>('/loans/current'),
    ])

    tools.value = toolData
    currentLoans.value = loanData
  } catch (error) {
    console.error(error)
    errorMessage.value =
      'APIに接続できません。FastAPIが起動しているか確認してください。'
  }
}

onMounted(() => {
  console.log('[index.vue] mounted', window.location.href)
  loadDashboard()
})

onBeforeUnmount(() => {
  console.log('[index.vue] unmounted', window.location.href)
})
</script>
<style scoped>
.inventory-table {
  max-height: 420px;
  overflow-y: auto;
}

:deep(thead th) {
  position: sticky;
  top: 0;
  z-index: 2;
  background: rgb(var(--v-theme-surface));
}
</style>