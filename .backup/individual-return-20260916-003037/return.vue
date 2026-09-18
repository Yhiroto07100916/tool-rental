<template>
  <div>
    <div class="mb-6">
      <div class="page-title">
        工具・機材・機材・機材返却
      </div>

      <div class="page-subtitle">
        クラスから貸出中の工具・機材・機材を検索し、返しに来た人を記録して返却します。
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
            <v-text-field
              v-model="searchClassName"
              label="検索するクラス"
              placeholder="例：31R"
              @keyup.enter="searchLoans"
            />

            <v-btn
              color="primary"
              size="large"
              block
              prepend-icon="mdi-magnify"
              :loading="loading"
              @click="searchLoans"
            >
              貸出中の工具・機材・機材を検索
            </v-btn>
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
            <v-text-field
              v-model="returnerClassName"
              label="クラス"
              placeholder="例：31R"
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
            返却する工具・機材・機材
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
            <div
              v-for="loan in loans"
              :key="loan.id"
              class="d-flex align-center py-3"
            >
              <v-checkbox
                v-model="selectedLoanIds"
                :value="loan.id"
                hide-details
                density="comfortable"
                class="flex-grow-0"
              />

              <div class="flex-grow-1">
                <div class="font-weight-bold">
                  {{ loan.tool_name }}
                </div>

                <div class="text-body-2">
                  借りた人：{{ loan.borrower_name }}
                </div>

                <div class="text-body-2 text-medium-emphasis">
                  数量：{{ loan.quantity }}個
                  ・貸出：{{ formatDate(loan.borrowed_at) }}
                </div>
              </div>
            </div>

            <v-divider class="my-3" />

            <v-btn
              color="success"
              size="large"
              block
              prepend-icon="mdi-check-circle"
              :disabled="selectedLoanIds.length === 0"
              :loading="returning"
              @click="returnSelected"
            >
              選択した工具・機材を返却する
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

const { request } = useApi()

const searchClassName = ref('')

const returnerClassName = ref('')
const returnerName = ref('')

const loans = ref<Loan[]>([])
const selectedLoanIds = ref<number[]>([])

const searched = ref(false)
const loading = ref(false)
const returning = ref(false)

const snackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref('success')

const formatDate = (value: string) => {
  return new Date(value).toLocaleString('ja-JP')
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
  selectedLoanIds.value = []

  try {
    const params = new URLSearchParams({
      class_name: searchClassName.value.trim(),
    })

    loans.value = await request<Loan[]>(
      `/loans/current?${params.toString()}`,
    )

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
  if (selectedLoanIds.value.length === 0) {
    return
  }

  if (
    !returnerClassName.value.trim() ||
    !returnerName.value.trim()
  ) {
    showSnackbar(
      '返しに来た人のクラスと氏名を入力してください。',
      'error',
    )
    return
  }

  returning.value = true

  try {
    const returner = {
      class_name: returnerClassName.value.trim(),
      name: returnerName.value.trim(),
    }

    const selectedCount = selectedLoanIds.value.length

    await request('/loans/return', {
      method: 'POST',
      body: {
        loan_ids: selectedLoanIds.value,
        ...returner,
      },
    })

    selectedLoanIds.value = []

    showSnackbar(
      `${selectedCount}件の返却処理が完了しました。`,
    )

    await searchLoans()
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
</script>
