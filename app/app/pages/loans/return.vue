<template>
  <div>
    <div class="mb-6">
      <div class="page-title">
        工具・機材返却
      </div>

      <div class="page-subtitle">
        クラスから貸出中の工具・機材を検索し、返却する個体を選択して返却します。
      </div>
    </div>

    <v-row>
      <v-col
        cols="12"
        lg="5"
      >
        <v-card elevation="1">
          <v-card-title>
            返却するクラスを検索
          </v-card-title>

          <v-divider />

          <v-card-text>
                        <div class="class-selection">
              <div
                v-for="grade in classGrades"
                :key="grade.label"
                class="class-grade-group"
              >
                <div class="text-body-2 font-weight-bold mb-2">
                  {{ grade.label }}
                </div>

                <div class="class-button-grid">
                  <v-btn
                    v-for="className in grade.classes"
                    :key="className"
                    size="large"
                    variant="outlined"
                    class="class-button"
                    :class="{
                      'class-button-selected':
                        searchClassName === className,
                    }"
                    :disabled="!hasLoans(className) || loading"
                    :loading="
                      loading &&
                      searchClassName === className
                    "
                    @click="
                      searchClassName = className;
                      searchLoans()
                    "
                  >
                    {{ className }}
                  </v-btn>
                </div>
              </div>
            </div>
          </v-card-text>
        </v-card>

        <v-card
          class="mt-4"
          elevation="1"
        >
          <v-card-title>
            返しに来た人
          </v-card-title>

          <v-divider />

          <v-card-text>
            <v-select
              v-model="returnerClassName"
              :items="classOptions"
              label="クラス"
              placeholder="クラスを選択"
              required
              clearable
              hide-details
            />

            <v-text-field
              v-model="returnerName"
              label="氏名"
              placeholder="例：佐藤花子"
            />

            <div class="text-body-2 text-medium-emphasis">
              ※貸出時の借用者とは別に、実際に返しに来た人を記録します。
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col
        cols="12"
        lg="7"
      >
        <v-card elevation="1">
          <v-card-title>
            返却する工具・機材
          </v-card-title>

          <v-divider />

          <v-card-text v-if="!searched">
            <div class="table-empty">
              クラスを入力して検索してください。
            </div>
          </v-card-text>

          <v-card-text
            v-else-if="loans.length === 0"
          >
            <div class="table-empty">
              現在貸出中の工具・機材はありません。
            </div>
          </v-card-text>

          <v-card-text v-else>
            <v-list>
              <div
                v-for="loan in loans"
                :key="loan.id"
              >
                <div class="text-subtitle-1 font-weight-bold mt-2">
                  {{ loan.tool_name }}
                </div>

                <div class="text-body-2 text-medium-emphasis mb-2">
                  借りた人：{{ loan.borrower_name }}
                  ・貸出：{{ formatDate(loan.borrowed_at) }}
                </div>

                <v-list-item
                  v-for="item in loan.tool_items || []"
                  :key="item.loan_item_id"
                  class="border rounded mb-2"
                >
                  <template #prepend>
                    <v-checkbox
                      v-model="selectedLoanItemIds"
                      :value="item.loan_item_id"
                      hide-details
                      density="comfortable"
                      class="flex-grow-0"
                    />
                  </template>

                  <v-list-item-title class="font-weight-bold">
                    {{ item.management_number }}
                  </v-list-item-title>

                  <v-list-item-subtitle>
                    個体ID：{{ item.tool_item_id }}
                  </v-list-item-subtitle>

                  <template #append>
                    <v-chip
                      size="small"
                      color="warning"
                      variant="tonal"
                    >
                      貸出中
                    </v-chip>
                  </template>
                </v-list-item>

                <div
                  v-if="loan.tool_items?.length === 0"
                  class="text-body-2 text-medium-emphasis mb-3"
                >
                  個体情報がありません。
                </div>
              </div>
            </v-list>

            <v-divider class="my-4" />

            <div class="text-body-1 mb-3">
              選択数：
              <strong>
                {{ selectedLoanItemIds.length }}
              </strong>
              個
            </div>

            <v-btn
              color="success"
              size="large"
              block
              prepend-icon="mdi-check-circle"
              :disabled="selectedLoanItemIds.length === 0"
              :loading="returning"
              @click="returnSelected"
            >
              選択した個体を返却する
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

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
import type { Loan } from '~/types'
import { classOptions } from '~/constants/classes'

const { request } = useApi()

const searchClassName = ref('')

const classGrades = [
  {
    label: '1年',
    classes: classOptions.filter((className) =>
      className.startsWith('1'),
    ),
  },
  {
    label: '2年',
    classes: classOptions.filter((className) =>
      className.startsWith('2'),
    ),
  },
  {
    label: '3年',
    classes: classOptions.filter((className) =>
      className.startsWith('3'),
    ),
  },
  {
    label: 'チーフ',
    classes: classOptions.filter(
      (className) => className === 'チーフ',
    ),
  },
]

const classLoanCounts = ref<Record<string, number>>({})

const returnerClassName = ref('')
const returnerName = ref('')

const loans = ref<Loan[]>([])
const selectedLoanItemIds = ref<number[]>([])

const searched = ref(false)
const loading = ref(false)
const returning = ref(false)

const snackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref('success')

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

const loadClassLoanCounts = async () => {
  try {
    const results = await Promise.all(
      classOptions.map(async (className) => {
        const params = new URLSearchParams({
          class_name: className,
        })

        const classLoans = await request<Loan[]>(
          `/loans/current?${params.toString()}`,
        )

        return {
          className,
          count: classLoans.reduce(
            (total, loan) => total + (loan.tool_items?.length || 0),
            0,
          ),
        }
      }),
    )

    classLoanCounts.value = Object.fromEntries(
      results.map((result) => [
        result.className,
        result.count,
      ]),
    )
  } catch (error) {
    console.error(error)
  }
}

const hasLoans = (className: string) => {
  return (classLoanCounts.value[className] || 0) > 0
}

const searchLoans = async () => {
  if (!searchClassName.value.trim()) {
    showSnackbar(
      '検索するクラスを入力してください。',
      'error',
    )
    return
  }

  loading.value = true
  searched.value = false
  selectedLoanItemIds.value = []

  try {
    const params = new URLSearchParams({
      class_name: searchClassName.value.trim(),
    })

    loans.value = await request<Loan[]>(
      `/loans/current?${params.toString()}`,
    )

    returnerClassName.value = searchClassName.value.trim()

    searched.value = true
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

const returnSelected = async () => {
  if (selectedLoanItemIds.value.length === 0) {
    return
  }

  if (
    !returnerClassName.value.trim() ||
    !returnerName.value.trim()
  ) {
    showSnackbar(
      '返しに来た人のクラスと氏名を選択・入力してください。',
      'error',
    )
    return
  }

  returning.value = true

  try {
    const selectedCount = selectedLoanItemIds.value.length

    await request('/loans/return', {
      method: 'POST',
      body: {
        loan_item_ids: selectedLoanItemIds.value,
        class_name: returnerClassName.value.trim(),
        name: returnerName.value.trim(),
      },
    })

    selectedLoanItemIds.value = []
    searchClassName.value = ''
    returnerClassName.value = ''
    returnerName.value = ''

    showSnackbar(
      `${selectedCount}個の返却処理が完了しました。`,
    )

    loans.value = []
    searched.value = false
    await loadClassLoanCounts()
  } catch (error: any) {
    console.error(error)

    showSnackbar(
      error?.data?.detail ||
      '返却処理に失敗しました。',
      'error',
    )
  } finally {
    returning.value = false
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
  loadClassLoanCounts()
})
</script>

<style scoped>
.class-selection {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.class-grade-group {
  width: 100%;
}

.class-button-grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 8px;
}

@media (max-width: 600px) {
  .class-button-grid {
    display: flex;
    overflow-x: auto;
    gap: 8px;
    padding-bottom: 4px;
  }

  .class-button-grid .class-button {
    flex: 0 0 72px;
  }
}

.class-button {
  width: 100%;
  min-width: 0;
  min-height: 56px;
  padding: 0 4px;
  font-size: 1rem;
  font-weight: 600;
}

.class-button-selected {
  background-color: rgb(var(--v-theme-primary));
  color: white;
}

@media (max-width: 600px) {
  .class-button {
    min-height: 56px;
    font-size: 0.95rem;
  }
}
</style>
