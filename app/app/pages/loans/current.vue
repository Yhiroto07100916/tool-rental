<template>
  <div>
    <div class="d-flex flex-wrap align-center ga-3 mb-6">
      <div>
        <div class="page-title">
          現在貸出中
        </div>

        <div class="page-subtitle">
          現在返却されていない工具・機材を確認します。
        </div>
      </div>

      <v-spacer />

      <v-btn
        prepend-icon="mdi-refresh"
        variant="outlined"
        :loading="loading"
        @click="loadLoans"
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
            md="4"
          >
            <v-select
              v-model="toolId"
              :items="tools"
              item-title="name"
              item-value="id"
              label="工具・機材"
              placeholder="工具・機材を選択"
              clearable
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
              @click="loadLoans"
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
                !className && toolId === null
              "
              @click="clearFilters"
            >
              条件をクリア
            </v-btn>
          </v-col>
        </v-row>
      </v-card-text>

      <v-divider />

      <div class="page-table">
        <v-table fixed-header>
        <thead>
          <tr>
            <th>クラス</th>
            <th>氏名</th>
            <th>工具・機材</th>
            <th>管理番号</th>
            <th>貸出日時</th>
            <th>返却期限</th>
            <th>操作</th>
          </tr>
        </thead>

        <tbody>
          <template
            v-for="loan in loans"
            :key="loan.id"
          >
            <tr
              v-for="item in loan.tool_items"
              :key="item.loan_item_id"
            >
              <td>{{ loan.class_name }}</td>

              <td class="font-weight-medium">
                {{ loan.borrower_name }}
              </td>

              <td>{{ loan.tool_name }}</td>

              <td class="font-weight-medium">
                {{ item.management_number }}
              </td>

              <td>{{ formatDate(loan.borrowed_at) }}</td>

              <td>
                <span v-if="loan.due_at">
                  {{ formatDate(loan.due_at) }}
                </span>
                <span
                  v-else-if="
                    loan.universal_return_enabled &&
                    universalReturnTime
                  "
                >
                  {{ universalReturnTime }}
                </span>
                <span v-else class="text-medium-emphasis">
                  -
                </span>
              </td>

              <td>
                <v-btn
                  v-if="
                    loan.class_name === 'チーフ'
                      ? loan.loan_duration_minutes_per_chief !== null
                      : loan.loan_duration_minutes !== null
                  "
                  size="small"
                  variant="outlined"
                  color="primary"
                  @click="openExtendDialog(loan, item)"
                >
                  延長
                </v-btn>
              </td>
            </tr>
          </template>

          <tr v-if="!loading && loans.length === 0">
            <td
              colspan="7"
              class="table-empty"
            >
              現在貸出中の工具・機材はありません。
            </td>
          </tr>
        </tbody>
      </v-table>
      </div>
    </v-card>

    <v-dialog
      v-model="extendDialog"
      max-width="500"
    >
      <v-card>
        <v-card-title>
          貸出を延長しますか？
        </v-card-title>

        <v-card-text>
          <div v-if="selectedLoan">
            <div class="mb-2">
              <strong>工具・機材：</strong>
              {{ selectedLoan.tool_name }}
            </div>

            <div class="mb-2">
              <strong>管理番号：</strong>
              {{ selectedLoanManagementNumbers }}
            </div>

            <div class="mb-4">
              <strong>クラス：</strong>
              {{ selectedLoan.class_name }}
            </div>

            <v-text-field
              v-model="extendName"
              label="延長する方の氏名"
              placeholder="氏名を入力"
              autofocus
              hide-details
            />
          </div>
        </v-card-text>

        <v-card-actions>
          <v-spacer />

          <v-btn
            variant="text"
            :disabled="extending"
            @click="closeExtendDialog"
          >
            キャンセル
          </v-btn>

          <v-btn
            color="primary"
            :loading="extending"
            :disabled="!extendName.trim()"
            @click="extendLoan"
          >
            延長する
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-alert
      type="info"
      variant="tonal"
      class="mt-4"
    >
      返却処理は「返却」画面から行ってください。
    </v-alert>

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
import type { Loan, Tool } from '~/types'
import { classOptions } from '~/constants/classes'

interface LoanToolItem {
  loan_item_id: number
  loan_id: number
  tool_item_id: number
  returned_at: string | null
  management_number: string
  status: string
}

interface CurrentLoan extends Loan {
  tool_items: LoanToolItem[]
  loan_duration_minutes: number | null
  loan_duration_minutes_per_chief: number | null
}

const { request } = useApi()

const loans = ref<CurrentLoan[]>([])
const tools = ref<Tool[]>([])
const className = ref<string | null>(null)
const toolId = ref<number | null>(null)

const loading = ref(false)

const snackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref('success')
const universalReturnTime = ref<string | null>(null)

const extendDialog = ref(false)
const extending = ref(false)
const selectedLoan = ref<CurrentLoan | null>(null)
const extendName = ref('')

const selectedLoanManagementNumbers = computed(() =>
  selectedLoan.value?.tool_items
    .map(item => item.management_number)
    .join(', ') ?? '',
)

const formatDate = (value: string) => {
  const normalized = value.replace(' ', 'T')

  const date =
    /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)
      ? new Date(normalized)
      : new Date(`${normalized}+09:00`)

  return date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
  })
}

const loadUniversalReturnTime = async () => {
  try {
    const result = await request<{
      universal_return_times: {
        id: number
        return_time: string
      }[]
    }>('/settings/return-time')

    const times = result.universal_return_times ?? []

    universalReturnTime.value =
      times.at(-1)?.return_time ?? null
  } catch (error) {
    console.error(error)
    universalReturnTime.value = null
  }
}

const clearFilters = () => {
  className.value = null
  toolId.value = null

  loadLoans()
}

const loadLoans = async () => {
  loading.value = true

  try {
    const params = new URLSearchParams()

    const selectedClassName =
      className.value?.trim() ?? ''

    if (selectedClassName) {
      params.set('class_name', selectedClassName)
    }

    if (toolId.value !== null) {
      params.set('tool_id', String(toolId.value))
    }

    const query = params.toString()

    const path = query
      ? `/loans/current?${query}`
      : '/loans/current'

    loans.value = await request<CurrentLoan[]>(path)
  } catch (error) {
    console.error(error)

    showSnackbar(
      '貸出情報の取得に失敗しました。',
      'error',
    )
  } finally {
    loading.value = false
  }
}

const openExtendDialog = (
  loan: CurrentLoan,
  item: LoanToolItem,
) => {
  selectedLoan.value = {
    ...loan,
    tool_items: [item],
  }
  extendName.value = loan.borrower_name
  extendDialog.value = true
}

const closeExtendDialog = () => {
  if (extending.value) {
    return
  }

  extendDialog.value = false
  selectedLoan.value = null
  extendName.value = ''
}

const extendLoan = async () => {
  if (!selectedLoan.value) {
    return
  }

  const name = extendName.value.trim()

  if (!name) {
    showSnackbar(
      '延長する方の氏名を入力してください。',
      'error',
    )
    return
  }

  extending.value = true

  try {
    await request(
      `/loans/${selectedLoan.value.id}/extend/${selectedLoan.value.tool_items[0]?.tool_item_id}`,
      {
        method: 'POST',
        body: {
          name,
        },
      },
    )

    extendDialog.value = false
    selectedLoan.value = null
    extendName.value = ''

    showSnackbar(
      '貸出を延長しました。',
      'success',
    )

    await loadLoans()
  } catch (error) {
    console.error(error)

    showSnackbar(
      '貸出の延長に失敗しました。',
      'error',
    )
  } finally {
    extending.value = false
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

const loadTools = async () => {
  try {
    tools.value = await request<Tool[]>('/tools')
  } catch (error) {
    console.error(error)

    showSnackbar(
      '工具・機材一覧の取得に失敗しました。',
      'error',
    )
  }
}

onMounted(async () => {
  await loadTools()
  await loadUniversalReturnTime()
  await loadLoans()
})
</script>


<style scoped>
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
