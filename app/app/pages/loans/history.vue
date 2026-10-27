<template>
  <div>
    <div class="d-flex flex-wrap align-center ga-3 mb-6">
      <div>
        <div class="page-title">
          貸出履歴
        </div>

        <div class="page-subtitle">
          返却済みを含む貸出記録を確認します。
        </div>
      </div>

      <v-spacer />

      <v-btn
        prepend-icon="mdi-refresh"
        variant="outlined"
        :loading="loading"
        @click="loadHistory"
      >
        更新
      </v-btn>
    </div>

    <v-card elevation="1">
      <v-card-text>
        <v-row>
          <v-col
            cols="12"
            md="4"
          >
            <v-select
              v-model="className"
              :items="classOptions"
              label="クラス"
              placeholder="クラスを選択"
              clearable
              hide-details
            />
          </v-col>

          <v-col
            cols="12"
            md="3"
          >
            <v-select
              v-model="statusFilter"
              :items="statusOptions"
              label="状態"
              hide-details
            />
          </v-col>

          <v-col
            cols="12"
            md="2"
            class="d-flex align-center"
          >
            <v-btn
              color="primary"
              block
              :loading="loading"
              @click="loadHistory"
            >
              検索
            </v-btn>
          </v-col>

          <v-col
            cols="12"
            md="2"
            class="d-flex align-center"
          >
            <v-btn
              variant="outlined"
              block
              :disabled="
                (!className && statusFilter === 'all') ||
                loading
              "
              @click="clearFilters"
            >
              フィルターをクリア
            </v-btn>
          </v-col>
        </v-row>
      </v-card-text>

      <v-divider />

      <div
        v-if="auth.isAdmin.value"
        class="d-flex justify-end pa-3"
      >
        <v-btn
          color="error"
          variant="outlined"
          prepend-icon="mdi-delete-outline"
          :disabled="
            selectedLoanItemIds.length === 0 ||
            loading
          "
          @click="deleteSelectedHistory"
        >
          選択した履歴を削除
          <span
            v-if="selectedLoanItemIds.length > 0"
            class="ml-1"
          >
            ({{ selectedLoanItemIds.length }}件)
          </span>
        </v-btn>
      </div>

      <div class="page-table">
        <v-table fixed-header>
  <thead>
    <tr>
      <th v-if="auth.isAdmin.value" class="text-center　whitespace-nowrap">
        選択
      </th>
      <th>貸出ID</th>
      <th>クラス</th>
      <th>借りた人</th>
      <th>工具・機材</th>
      <th>管理番号</th>
      <th>貸出日時</th>
      <th>返却期限</th>
      <th>超過時間</th>
      <th>返却日時</th>
      <th>返却者</th>
      <th>状態</th>
    </tr>
  </thead>

  <tbody>
    <tr
      v-for="loan in loans"
      :key="loan.loan_item_id"
      :class="getHistoryRowClass(loan)"
    >
      <td
        v-if="auth.isAdmin.value"
        class="text-center"
      >
        <v-checkbox
          v-if="loan.returned_at"
          :model-value="isSelected(loan.loan_item_id)"
          hide-details
          density="compact"
          color="error"
          @update:model-value="
            toggleLoanSelection(loan)
          "
        />
      </td>

      <td>
        {{ loan.loan_item_id }}
      </td>

      <td>
        {{ loan.class_name }}
      </td>

      <td class="font-weight-medium">
        {{ loan.borrower_name }}
      </td>

      <td>
        {{ loan.tool_name }}
      </td>

      <td>
        <v-chip
          size="small"
          variant="tonal"
        >
          {{ loan.management_number }}
        </v-chip>
      </td>

      <td>
        {{ formatDate(loan.borrowed_at) }}
      </td>

      <td>
        {{
          loan.due_at
            ? formatDate(loan.due_at)
            : '-'
        }}
      </td>

      <td>
              <template v-if="!loan.returned_at">
                <span v-if="isCurrentlyOverdue(loan)">
                  超過中
                </span>
                <span v-else>-</span>
              </template>

              <template v-else>
                <template v-if="loan.overdue_seconds > 0">
                  {{
                    `${Math.floor(loan.overdue_seconds / 3600)
                      .toString()
                      .padStart(2, '0')}:${Math.floor(
                      (loan.overdue_seconds % 3600) / 60,
                    )
                      .toString()
                      .padStart(2, '0')}:${(
                      loan.overdue_seconds % 60
                    )
                      .toString()
                      .padStart(2, '0')}`
                  }}
                </template>
                <span v-else>-</span>
              </template>
            </td>

      <td>
        {{
          loan.returned_at
            ? formatDate(loan.returned_at)
            : '-'
        }}
      </td>

      <td>
        <template
          v-if="
            loan.returned_by_class_name &&
            loan.returned_by_name
          "
        >
          {{ loan.returned_by_class_name }}
          {{ loan.returned_by_name }}
        </template>

        <span v-else>-</span>
      </td>

      <td>
        <v-chip
          v-if="loan.status === 'returned'"
          color="success"
          size="small"
          variant="tonal"
        >
          返却済み
        </v-chip>

        <v-chip
          v-else
          color="warning"
          size="small"
          variant="tonal"
        >
          貸出中
        </v-chip>
      </td>
    </tr>

    <tr v-if="!loading && loans.length === 0">
      <td
        colspan="9"
        class="table-empty"
      >
        貸出履歴はありません。
      </td>
    </tr>
  </tbody>
</v-table>
      </div>
    </v-card>

    <v-snackbar
      v-model="snackbar"
      :color="snackbarColor"
      timeout="3500"
    >
      {{ snackbarText }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import type { LoanHistoryItem } from '~/types'
import { classOptions } from '~/constants/classes'

const { request } = useApi()
const auth = useAuth()

const loans = ref<LoanHistoryItem[]>([])
const selectedLoanItemIds = ref<number[]>([])
const className = ref<string | null>(null)

const statusFilter = ref('all')

const statusOptions = [
  {
    title: 'すべて',
    value: 'all',
  },
  {
    title: '貸出中',
    value: 'borrowed',
  },
  {
    title: '返却済み',
    value: 'returned',
  },
]

const loading = ref(false)

const snackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref('success')

const formatDate = (value: string) => {
  const normalized = value.replace(' ', 'T')

  const date =
    /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)
      ? new Date(normalized)
      : new Date(`${normalized}+09:00`)

  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const get = (type: string) =>
    parts.find(part => part.type === type)?.value ?? ''

  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

const clearFilters = async () => {
  className.value = ''
  statusFilter.value = 'all'
  await loadHistory()
}

const now = ref(Date.now())

let nowTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  nowTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (nowTimer) {
    clearInterval(nowTimer)
  }
})

const isCurrentlyOverdue = (loan: LoanHistoryItem) => {
  if (loan.returned_at || !loan.due_at) {
    return false
  }

  return now.value > new Date(loan.due_at).getTime()
}

const getHistoryRowClass = (loan: LoanHistoryItem) => {
  // 返却前
  if (!loan.returned_at) {
    return isCurrentlyOverdue(loan)
      ? 'history-row-overdue'
      : 'history-row-ontime'
  }

  // 返却済み
  return loan.overdue_seconds > 0
    ? 'history-row-late'
    : 'history-row-ontime'
}

const toggleLoanSelection = (
  loan: LoanHistoryItem,
) => {
  if (!auth.isAdmin.value || loan.returned_at === null) {
    return
  }

  const index =
    selectedLoanItemIds.value.indexOf(
      loan.loan_item_id,
    )

  if (index === -1) {
    selectedLoanItemIds.value.push(
      loan.loan_item_id,
    )
  } else {
    selectedLoanItemIds.value.splice(index, 1)
  }
}

const isSelected = (loanItemId: number) => {
  return selectedLoanItemIds.value.includes(
    loanItemId,
  )
}

const deleteSelectedHistory = async () => {
  if (
    !auth.isAdmin.value ||
    selectedLoanItemIds.value.length === 0
  ) {
    return
  }

  const confirmed = window.confirm(
    `${selectedLoanItemIds.value.length}件の貸出履歴を削除しますか？\nこの操作は元に戻せません。`,
  )

  if (!confirmed) {
    return
  }

  loading.value = true

  try {
    await request('/loans/history/delete', {
      method: 'POST',
      body: {
        loan_item_ids:
          selectedLoanItemIds.value,
      },
    })

    selectedLoanItemIds.value = []

    showSnackbar(
      '選択した貸出履歴を削除しました',
    )

    await loadHistory()
  } catch (error) {
    console.error(error)

    showSnackbar(
      '貸出履歴の削除に失敗しました。',
      'error',
    )
  } finally {
    loading.value = false
  }
}

const loadHistory = async () => {
  loading.value = true

  try {
    const classValue =
      className.value?.trim() ?? ''

    const params = new URLSearchParams()

    if (classValue) {
      params.set('class_name', classValue)
    }

    if (statusFilter.value !== 'all') {
      params.set('status', statusFilter.value)
    }

    const query = params.toString()

    const path = query
      ? `/loans/history?${query}`
      : '/loans/history'

loans.value =
  await request<LoanHistoryItem[]>(path)
  } catch (error) {
    console.error(error)

    showSnackbar(
      '貸出履歴の取得に失敗しました。',
      'error',
    )
  } finally {
    loading.value = false
  }
}

const showSnackbar = (
  text: string,
  color = 'success',
) => {
  snackbarText.value = text
  snackbarColor.value = color
  snackbar.value = true
}

onMounted(() => {
  loadHistory()
})
</script>
<style scoped>
.history-row-ontime > td {
  background-color: rgba(76, 175, 80, 0.12);
}

.history-row-overdue > td {
  background-color: rgba(255, 152, 0, 0.16);
}

.history-row-late > td {
  background-color: rgba(244, 67, 54, 0.14);
}

.page-table {
  max-height: calc(100vh - 220px);
  overflow-y: auto;
}

:deep(.v-table__wrapper) {
  overflow: visible;
}

:deep(thead th) {
  position: sticky;
  top: 0;
  z-index: 3;
  background: rgb(var(--v-theme-surface));
}
</style>