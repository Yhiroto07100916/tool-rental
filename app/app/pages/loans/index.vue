<template>
  <div>
    <div class="mb-6">
      <div class="page-title">
        工具・機材貸出
      </div>

      <div class="page-subtitle">
        来場者から聞いたクラス・氏名・工具・機材を入力して貸し出します。
      </div>
    </div>

    <v-alert
      v-if="selectedReservation"
      type="info"
      variant="tonal"
      class="mb-4"
    >
      <div class="font-weight-bold mb-1">
        予約からの貸出
      </div>

      <div>
        {{ selectedReservation.class_name }}
        {{ selectedReservation.name }}
        ・{{ selectedReservation.tool_name }}
        × {{ selectedReservation.quantity }}
      </div>

      <div class="text-body-2 mt-1">
        予約順を優先して、この予約の数量と同じ個数を貸し出します。
      </div>
    </v-alert>

    <v-alert
      v-if="reservationWaitingError"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ reservationWaitingError }}
    </v-alert>

    <v-row>
      <v-col
        cols="12"
        lg="7"
      >
        <v-card elevation="1">
          <v-card-title>
            貸出情報
          </v-card-title>

          <v-divider />

          <v-card-text class="pa-5">
            <v-form @submit.prevent="lendTool">
              <v-row>
                <v-col cols="12">
                  <div class="text-body-2 mb-2">
                    クラス
                  </div>

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
                              form.className === className,
                          }"
                          :disabled="isReservationLending"
                          @click="form.className = className"
                        >
                          {{ className }}
                        </v-btn>
                      </div>
                    </div>
                  </div>
                </v-col>

                <v-col cols="12">
                  <v-text-field
                    v-model="form.name"
                    label="氏名"
                    placeholder="例：山田太郎"
                    required
                    :disabled="isReservationLending"
                  />
                </v-col>

                <v-col cols="12">
                  <div class="text-subtitle-1 font-weight-bold mb-3">
                    工具・機材を登録
                  </div>

                  <div class="tool-selection-card border rounded pa-4">
                    <v-select
                      v-model="currentToolId"
                      :items="availableTools"
                      item-title="name"
                      item-value="id"
                      label="工具・機材"
                      placeholder="貸し出す工具・機材を選択"
                      required
                      :disabled="isReservationLending"
                      @update:model-value="handleCurrentToolChange"
                    />

                    <template v-if="currentTool">
                      <template v-if="currentTool.available_quantity > 0">
                        <div class="text-subtitle-2 mb-2">
                          貸し出す個体を選択
                        </div>

                        <v-progress-linear
                          v-if="currentToolLoading"
                          indeterminate
                          class="mb-3"
                        />

                        <v-list
                          v-else-if="currentAvailableItems.length > 0"
                          class="border rounded"
                          density="compact"
                        >
                          <v-list-item
                            v-for="item in currentAvailableItems"
                            :key="item.id"
                            :title="item.management_number"
                          >
                            <template #prepend>
                              <v-checkbox
                                v-model="currentItemIds"
                                :value="item.id"
                                hide-details
                                density="compact"
                                color="primary"
                              />
                            </template>

                            <template #append>
                              <v-chip
                                size="small"
                                color="success"
                                variant="tonal"
                              >
                                貸出可能
                              </v-chip>
                            </template>
                          </v-list-item>
                        </v-list>

                        <div
                          v-else-if="!currentToolLoading"
                          class="table-empty border rounded pa-4"
                        >
                          貸し出せる個体がありません。
                        </div>

                        <div class="text-medium-emphasis mt-3">
                          選択数：
                          <strong class="text-high-emphasis">
                            {{ currentItemIds.length }}
                          </strong>
                          個
                          <span>
                            /
                            貸出可能
                            {{ currentTool.available_quantity }}個
                          </span>
                        </div>

                        <v-alert
                          v-if="
                            currentTool &&
                            currentTool.max_quantity_per_class !== null &&
                            currentItemIds.length > currentTool.max_quantity_per_class
                          "
                          type="error"
                          variant="tonal"
                          class="mt-3"
                        >
                          この工具・機材は1クラスにつき最大{{ currentTool.max_quantity_per_class }}個まで登録できます。
                        </v-alert>

                        <v-btn
                          color="primary"
                          size="large"
                          block
                          class="mt-4"
                          prepend-icon="mdi-plus-circle"
                          :disabled="!canRegisterCurrentTool"
                          @click="registerCurrentTool"
                        >
                          工具・機材を登録
                        </v-btn>
                      </template>

                      <template v-else>
                        <v-alert
                          type="warning"
                          variant="tonal"
                        >
                          この工具・機材は現在すべて貸し出されています。
                        </v-alert>

                        <template v-if="!selectedReservation">
                          <div class="text-subtitle-2 mt-4 mb-2">
                            予約する数量
                          </div>

                          <v-text-field
                            v-model.number="reservationQuantity"
                            type="number"
                            min="1"
                            :max="currentTool.quantity"
                            label="数量"
                            suffix="個"
                            :disabled="reserving"
                            hide-details
                          />

                          <v-alert
                            v-if="
                              currentTool &&
                              currentTool.max_quantity_per_class !== null &&
                              reservationQuantity > currentTool.max_quantity_per_class
                            "
                            type="error"
                            variant="tonal"
                            class="mt-3"
                          >
                            この工具・機材は1クラスにつき最大{{ currentTool.max_quantity_per_class }}個まで予約できます。
                          </v-alert>

                          <div class="text-body-2 text-medium-emphasis mt-2">
                            返却された後、この順番で貸し出します。
                          </div>

                          <v-btn
                            color="primary"
                            size="large"
                            block
                            class="mt-4"
                            prepend-icon="mdi-calendar-clock"
                            :loading="reserving"
                            :disabled="!canReserve"
                            @click="reserveTool"
                          >
                            この工具・機材を予約する
                          </v-btn>
                        </template>

                        <template v-else>
                          <div class="text-body-2 text-medium-emphasis mt-4">
                            現在貸出可能な個体が不足しているため、
                            予約数量を揃えるまで貸し出せません。
                          </div>
                        </template>
                      </template>
                    </template>
                  </div>
                </v-col>
              </v-row>

              <v-alert
                v-if="errorMessage"
                type="error"
                variant="tonal"
                class="mt-3"
              >
                {{ errorMessage }}
              </v-alert>

              <v-btn
                v-if="selectedTools.length > 0"
                type="submit"
                color="primary"
                size="large"
                block
                class="mt-5"
                prepend-icon="mdi-arrow-right-bold-circle"
                :loading="loading"
                :disabled="!canLend"
              >
                この内容で貸し出す
              </v-btn>
            </v-form>
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
            選択中の工具・機材
          </v-card-title>

          <v-divider />

          <v-card-text>
            <template v-if="selectedTools.length > 0">
              <div
                v-for="selected in selectedTools"
                :key="selected.toolId"
                class="mb-5"
              >
                <template v-if="getTool(selected.toolId)">
                  <div class="d-flex align-center">
                    <div class="text-h6 font-weight-bold">
                      {{ getTool(selected.toolId)!.name }}
                    </div>

                    <v-spacer />

                    <v-chip
                      :color="
                        selected.type === 'loan'
                          ? 'success'
                          : 'warning'
                      "
                      size="large"
                      variant="tonal"
                      class="mr-2 loan-type-chip"
                    >
                      {{ selected.type === 'loan' ? '貸出' : '予約' }}
                    </v-chip>

                    <v-btn
                      v-if="!isReservationLending"
                      icon="mdi-close"
                      size="small"
                      variant="tonal"
                      color="error"
                      class="remove-tool-button"
                      aria-label="登録した工具・機材を削除"
                      @click="removeTool(selected.toolId)"
                    />
                  </div>

                  <div class="text-medium-emphasis mt-1">
                    {{
                      getTool(selected.toolId)!.category ||
                      'カテゴリ未設定'
                    }}
                  </div>

                  <v-divider class="my-4" />

                  <div class="d-flex justify-space-between mb-3">
                    <span>総在庫</span>
                    <strong>
                      {{ getTool(selected.toolId)!.quantity }}個
                    </strong>
                  </div>

                  <div class="d-flex justify-space-between mb-3">
                    <span>貸出可能</span>
                    <strong
                      :class="
                        getTool(selected.toolId)!.available_quantity > 0
                          ? 'text-success'
                          : 'text-error'
                      "
                    >
                      {{ getTool(selected.toolId)!.available_quantity }}個
                    </strong>
                  </div>

                  <div class="d-flex justify-space-between mb-3">
                    <span>
                      {{ selected.type === 'reservation' ? '予約数量' : '今回選択' }}
                    </span>
                    <strong>
                      {{
                        selected.type === 'reservation'
                          ? selected.quantity
                          : selected.itemIds.length
                      }}個
                    </strong>
                  </div>

                  <div
                    v-if="selected.type === 'loan'"
                    class="mb-3"
                  >
                    <span class="text-medium-emphasis">
                      管理番号
                    </span>
                    <div class="mt-1">
                      <v-chip
                        v-for="itemId in selected.itemIds"
                        :key="itemId"
                        size="small"
                        class="mr-1 mb-1"
                        variant="tonal"
                      >
                        {{
                          selected.items.find(item => item.id === itemId)
                            ?.management_number
                        }}
                      </v-chip>
                    </div>
                  </div>

                  <div class="d-flex justify-space-between">
                    <span>保管場所</span>
                    <strong>
                      {{ getTool(selected.toolId)!.location || '-' }}
                    </strong>
                  </div>
                </template>

                <v-divider
                  v-if="selectedTools.length > 1"
                  class="mt-5"
                />
              </div>
            </template>

            <div
              v-else
              class="table-empty"
            >
              工具・機材を登録すると
              <br />
              ここに表示されます。
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-snackbar
      v-model="snackbar"
      color="success"
      timeout="4000"
    >
      {{ snackbarText }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import type {
  Reservation,
  Tool,
  ToolItem,
} from '~/types'
import { classOptions } from '~/constants/classes'

const classGrades = [
  {
    label: '1年',
    classes: classOptions.filter((className) => className.startsWith('1')),
  },
  {
    label: '2年',
    classes: classOptions.filter((className) => className.startsWith('2')),
  },
  {
    label: '3年',
    classes: classOptions.filter((className) => className.startsWith('3')),
  },
  {
    label: 'チーフ',
    classes: classOptions.filter((className) => className === 'チーフ'),
  },
]

interface SelectedTool {
  toolId: number
  itemIds: number[]
  items: ToolItem[]
  type: 'loan' | 'reservation'
  quantity: number
  loading: boolean
  error: string
}

const route = useRoute()
const router = useRouter()
const { request } = useApi()

const tools = ref<Tool[]>([])

const form = reactive({
  className: '',
  name: '',
})

const selectedTools = ref<SelectedTool[]>([])

const currentToolId = ref<number | null>(null)
const currentItemIds = ref<number[]>([])
const currentItems = ref<ToolItem[]>([])
const currentToolLoading = ref(false)
const currentToolError = ref('')

const selectedReservation = ref<Reservation | null>(null)
const reservationId = ref<number | null>(null)
const reservationQuantity = ref(1)

const loading = ref(false)
const reserving = ref(false)

const errorMessage = ref('')
const reservationWaitingError = ref('')

const snackbar = ref(false)
const snackbarText = ref('')

const availableTools = computed(() => tools.value)

const isReservationLending = computed(
  () => reservationId.value !== null,
)

const currentTool = computed(() =>
  currentToolId.value
    ? getTool(currentToolId.value)
    : null,
)

const currentAvailableItems = computed(() =>
  currentItems.value.filter(item => item.status === 'available'),
)

const canRegisterCurrentTool = computed(() => {
  if (!form.className.trim() || !form.name.trim()) return false
  if (!currentTool.value) return false
  if (currentTool.value.available_quantity <= 0) return false
  if (currentItemIds.value.length < 1) return false
  if (
    currentItemIds.value.length >
    currentTool.value.available_quantity
  ) return false
  if (
    selectedTools.value.some(
      selected => selected.toolId === currentToolId.value,
    )
  ) {
    return false
  }
  return true
})

const getTool = (toolId: number) =>
  tools.value.find(tool => tool.id === toolId) || null

const getSelectedTool = (toolId: number) =>
  selectedTools.value.find(selected => selected.toolId === toolId) || null

const canAddAnotherTool = computed(() =>
  tools.value.some(
    tool =>
      tool.available_quantity > 0 &&
      !selectedTools.value.some(selected => selected.toolId === tool.id),
  ),
)

const loadTools = async () => {
  tools.value = await request<Tool[]>('/tools')
}

const loadCurrentToolItems = async (toolId: number) => {
  currentToolLoading.value = true
  currentToolError.value = ''
  currentItems.value = []
  currentItemIds.value = []

  try {
    currentItems.value = await request<ToolItem[]>(
      `/tools/${toolId}/items`,
    )
  } catch (error: any) {
    console.error(error)
    currentToolError.value =
      error?.data?.detail ||
      '工具・機材の個体情報の取得に失敗しました。'
  } finally {
    currentToolLoading.value = false
  }
}

const handleCurrentToolChange = async (
  toolId: number | null,
) => {
  currentItemIds.value = []
  currentItems.value = []
  currentToolError.value = ''

  if (!toolId) return

  if (
    selectedTools.value.some(
      selected => selected.toolId === toolId,
    )
  ) {
    currentToolError.value =
      'この工具・機材はすでに登録されています。'
    currentToolId.value = null
    return
  }

  await loadCurrentToolItems(toolId)
}

const registerCurrentTool = () => {
  if (!canRegisterCurrentTool.value) return
  if (!currentToolId.value) return

  selectedTools.value.push({
    toolId: currentToolId.value,
    itemIds: [...currentItemIds.value],
    items: [...currentItems.value],
    type: 'loan',
    quantity: currentItemIds.value.length,
    loading: false,
    error: '',
  })

  currentToolId.value = null
  currentItemIds.value = []
  currentItems.value = []
  currentToolError.value = ''
}

const removeTool = (toolId: number) => {
  if (isReservationLending.value) return

  selectedTools.value = selectedTools.value.filter(
    selected => selected.toolId !== toolId,
  )
}

const loadReservation = async (id: number) => {
  try {
    const reservation = await request<Reservation>(
      `/reservations/${id}`,
    )

    if (reservation.status !== 'waiting') {
      reservationWaitingError.value =
        'この予約はすでに処理されています。'
      return
    }

    reservationId.value = reservation.id
    selectedReservation.value = reservation
    form.className = reservation.class_name
    form.name = reservation.name
    reservationQuantity.value = reservation.quantity

    currentToolId.value = reservation.tool_id

    await loadCurrentToolItems(reservation.tool_id)

    if (currentAvailableItems.value.length >= reservation.quantity) {
      currentItemIds.value = currentAvailableItems.value
        .slice(0, reservation.quantity)
        .map(item => item.id)
    }
  } catch (error: any) {
    console.error(error)
    reservationWaitingError.value =
      error?.data?.detail ||
      '予約情報の取得に失敗しました。'
  }
}

const canReserve = computed(() => {
  if (
    !form.className.trim() ||
    !form.name.trim() ||
    !currentTool.value
  ) {
    return false
  }

  if (currentTool.value.available_quantity > 0) return false

  if (
    !Number.isInteger(reservationQuantity.value) ||
    reservationQuantity.value <= 0
  ) {
    return false
  }

  if (reservationQuantity.value > currentTool.value.quantity) {
    return false
  }

  if (
    currentTool.value.max_quantity_per_class !== null &&
    reservationQuantity.value >
      currentTool.value.max_quantity_per_class
  ) {
    return false
  }

  return true
})

const reserveTool = () => {
  if (!canReserve.value) return
  if (!currentTool.value) return

  selectedTools.value.push({
    toolId: currentTool.value.id,
    itemIds: [],
    items: [],
    type: 'reservation',
    quantity: reservationQuantity.value,
    loading: false,
    error: '',
  })

  currentToolId.value = null
  currentItemIds.value = []
  currentItems.value = []
  currentToolError.value = ''
  reservationQuantity.value = 1
}

const canLend = computed(() => {
  if (
    !form.className.trim() ||
    !form.name.trim() ||
    selectedTools.value.length === 0
  ) {
    return false
  }

  for (const selected of selectedTools.value) {
    const tool = getTool(selected.toolId)

    if (!tool) {
      return false
    }

    if (selected.type === 'reservation') {
      if (
        !Number.isInteger(selected.quantity) ||
        selected.quantity <= 0 ||
        selected.quantity > tool.quantity
      ) {
        return false
      }

      if (
        tool.max_quantity_per_class !== null &&
        selected.quantity > tool.max_quantity_per_class
      ) {
        return false
      }

      continue
    }

    if (
      tool.available_quantity <= 0 ||
      selected.itemIds.length < 1 ||
      selected.itemIds.length > tool.available_quantity
    ) {
      return false
    }
  }

  return true
})

const lendTool = async () => {
  if (!canLend.value) return

  loading.value = true
  errorMessage.value = ''

  try {
    for (const selected of selectedTools.value) {
      if (selected.type === 'reservation') {
        await request('/reservations', {
          method: 'POST',
          body: {
            class_name: form.className.trim(),
            name: form.name.trim(),
            tool_id: selected.toolId,
            quantity: selected.quantity,
          },
        })
      } else {
        await request('/loans', {
          method: 'POST',
          body: {
            class_name: form.className.trim(),
            name: form.name.trim(),
            tool_id: selected.toolId,
            tool_item_ids: selected.itemIds,
            reservation_id: reservationId.value,
          },
        })
      }
    }

    form.className = ''
    form.name = ''
    selectedTools.value = []
    currentToolId.value = null
    currentItemIds.value = []
    currentItems.value = []
    selectedReservation.value = null
    reservationId.value = null
    reservationQuantity.value = 1

    await loadTools()

    if (route.query.reservation_id) {
      await router.replace('/loans')
    }

    snackbarText.value = '貸出・予約の登録が完了しました。'
    snackbar.value = true
  } catch (error: any) {
    console.error(error)
    errorMessage.value =
      error?.data?.detail ||
      '貸出・予約の登録に失敗しました。'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await loadTools()

  const rawReservationId = route.query.reservation_id
  const parsedReservationId = Array.isArray(rawReservationId)
    ? Number(rawReservationId[0])
    : Number(rawReservationId)

  if (
    Number.isInteger(parsedReservationId) &&
    parsedReservationId > 0
  ) {
    await loadReservation(parsedReservationId)
  } else {
    const firstAvailableTool = tools.value.find(
      tool => tool.available_quantity > 0,
    )

    if (firstAvailableTool) {
      currentToolId.value = firstAvailableTool.id
      await loadCurrentToolItems(firstAvailableTool.id)
    }
  }
})
</script>

<style scoped>
.class-button-group {
  display: flex;
  flex-wrap: wrap;
  height: auto;
  gap: 6px;
}

.class-button-group .v-btn {
  min-width: 52px;
  margin: 0;
}
.class-button-group .v-btn.class-button-selected {
  background-color: rgb(var(--v-theme-primary));
  border-color: rgb(var(--v-theme-primary));
  color: white;
}
</style>

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
  .class-button-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .class-button {
    min-height: 56px;
    font-size: 0.95rem;
  }
}

.remove-tool-button {
  min-width: 36px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
}

.loan-type-chip {
  min-width: 72px;
  height: 40px;
  justify-content: center;
  font-size: 1.1rem;
  font-weight: 700;
}
</style>
