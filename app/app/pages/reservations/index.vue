<template>
  <div>
    <div class="d-flex flex-wrap align-center ga-3 mb-6">
      <div>
        <div class="page-title">
          工具・機材予約
        </div>

        <div class="page-subtitle">
          貸出中で現在借りられない工具・機材の予約順を管理します。
        </div>
      </div>

      <v-spacer />

      <v-btn
        prepend-icon="mdi-refresh"
        variant="outlined"
        :loading="loading"
        @click="loadReservations"
      >
        更新
      </v-btn>
    </div>

    <v-alert
      v-if="errorMessage"
      type="error"
      variant="tonal"
      class="mb-4"
    >
      {{ errorMessage }}
    </v-alert>

    <v-alert
      v-if="successMessage"
      type="success"
      variant="tonal"
      class="mb-4"
    >
      {{ successMessage }}
    </v-alert>

    <v-card elevation="1">
      <v-card-title>
        予約待ち
      </v-card-title>

      <v-divider />

      <v-card-text
        v-if="!loading && reservations.length === 0"
      >
        <div class="table-empty">
          現在、予約はありません。
        </div>
      </v-card-text>

      <v-list
        v-else
        lines="two"
      >
        <template
          v-for="(reservation, index) in reservations"
          :key="reservation.id"
        >
          <v-list-item>
            <template #prepend>
              <v-avatar
                color="primary"
                variant="tonal"
              >
                {{ reservation.queue_position ?? index + 1 }}
              </v-avatar>
            </template>

            <v-list-item-title
              class="font-weight-bold"
            >
              {{ reservation.tool_name }}
              × {{ reservation.quantity }}
            </v-list-item-title>

            <v-list-item-subtitle>
              {{ reservation.class_name }}
              {{ reservation.name }}
              <span class="mx-1">・</span>
              受付 {{ formatDate(reservation.created_at) }}
            </v-list-item-subtitle>

            <template #append>
              <div class="d-flex align-center ga-2">
                <v-btn
                  color="primary"
                  variant="tonal"
                  prepend-icon="mdi-arrow-right"
                  @click="goToLend(reservation.id)"
                >
                  貸出画面へ
                </v-btn>

                <v-btn
                  color="error"
                  variant="text"
                  icon="mdi-close"
                  aria-label="予約をキャンセル"
                  :loading="cancellingId === reservation.id"
                  @click="cancelReservation(reservation)"
                />
              </div>
            </template>
          </v-list-item>

          <v-divider
            v-if="index < reservations.length - 1"
          />
        </template>
      </v-list>
    </v-card>

    <v-dialog
      v-model="cancelDialog"
      max-width="420"
    >
      <v-card>
        <v-card-title>
          予約をキャンセル
        </v-card-title>

        <v-card-text>
          <template v-if="selectedReservation">
            {{ selectedReservation.class_name }}
            {{ selectedReservation.name }} さんの
            「{{ selectedReservation.tool_name }} ×
            {{ selectedReservation.quantity }}」の予約を
            キャンセルしますか？
          </template>
        </v-card-text>

        <v-card-actions>
          <v-spacer />

          <v-btn
            variant="text"
            @click="cancelDialog = false"
          >
            戻る
          </v-btn>

          <v-btn
            color="error"
            :loading="cancelling"
            @click="confirmCancelReservation"
          >
            キャンセルする
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import type { Reservation } from '~/types'

const { request } = useApi()

const reservations = ref<Reservation[]>([])
const loading = ref(false)
const cancelling = ref(false)
const cancellingId = ref<number | null>(null)

const cancelDialog = ref(false)
const selectedReservation =
  ref<Reservation | null>(null)

const errorMessage = ref('')
const successMessage = ref('')

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

const loadReservations = async () => {
  loading.value = true
  errorMessage.value = ''

  try {
    reservations.value =
      await request<Reservation[]>(
        '/reservations?status=waiting',
      )
  } catch (error: any) {
    console.error(error)

    errorMessage.value =
      error?.data?.detail ||
      '予約情報の取得に失敗しました。'
  } finally {
    loading.value = false
  }
}

const goToLend = async (
  reservationId: number,
) => {
  await navigateTo(
    `/loans?reservation_id=${reservationId}`,
  )
}

const cancelReservation = (
  reservation: Reservation,
) => {
  selectedReservation.value = reservation
  cancelDialog.value = true
}

const confirmCancelReservation = async () => {
  if (!selectedReservation.value) {
    return
  }

  cancelling.value = true
  cancellingId.value =
    selectedReservation.value.id

  try {
    await request(
      `/reservations/${selectedReservation.value.id}/cancel`,
      {
        method: 'POST',
      },
    )

    cancelDialog.value = false
    selectedReservation.value = null

    successMessage.value =
      '予約をキャンセルしました。'

    await loadReservations()
  } catch (error: any) {
    console.error(error)

    errorMessage.value =
      error?.data?.detail ||
      '予約のキャンセルに失敗しました。'
  } finally {
    cancelling.value = false
    cancellingId.value = null
  }
}

onMounted(loadReservations)
</script>
