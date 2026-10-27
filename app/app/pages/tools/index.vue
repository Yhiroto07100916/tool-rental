<template>
  <div>
    <div class="d-flex flex-wrap align-center ga-3 mb-6">
      <div>
        <div class="page-title">
          工具・機材管理
        </div>

        <div v-if="auth.isAdmin.value" class="page-subtitle">
          工具・機材の種類・在庫・貸出状況の管理、追加・編集・個体の管理ができます。
        </div>
        <div v-else class="page-subtitle">
          工具・機材の種類・在庫・貸出状況を確認できます。
        </div>
      </div>

      <v-spacer />

      <v-btn
        v-if="auth.isAdmin.value"
        color="primary"
        prepend-icon="mdi-plus"
        @click="openCreateDialog"
      >
        工具・機材を登録
      </v-btn>
    </div>

    <v-card elevation="1">
      <v-card-text>
        <v-text-field
          v-model="search"
          prepend-inner-icon="mdi-magnify"
          label="工具・機材を検索"
          placeholder="工具・機材名・カテゴリ・場所"
          clearable
          hide-details
          autocomplete="off"
          inputmode="search"
        />
      </v-card-text>

      <v-divider />

      <div class="page-table">
        <v-table fixed-header>
        <thead>
          <tr>
            <th>工具・機材名</th>
            <th>カテゴリ</th>
            <th>場所</th>
            <th>在庫</th>
            <th>状態</th>
            <th class="text-right">操作</th>
          </tr>
        </thead>

        <tbody>
          <tr
            v-for="tool in filteredTools"
            :key="tool.id"
            :draggable="
              auth.isAdmin.value &&
              !search.trim()
            "
            :class="{
              'tool-row-draggable':
                auth.isAdmin.value &&
                !search.trim(),
              'tool-row-dragging':
                draggingToolId === tool.id,
              'tool-row-drag-over-before':
                dragOverToolId === tool.id &&
                dragOverPosition === 'before',
              'tool-row-drag-over-after':
                dragOverToolId === tool.id &&
                dragOverPosition === 'after',
            }"
            @dragstart="handleDragStart(tool.id)"
            @dragover.prevent="
              handleDragOver($event, tool.id)
            "
            @drop="handleDrop(tool.id)"
            @dragend="handleDragEnd"
          >
            <td>
              <div class="font-weight-medium">
                {{ tool.name }}
              </div>

              <div
                v-if="tool.description"
                class="text-caption text-medium-emphasis"
              >
                {{ tool.description }}
              </div>
            </td>

            <td>
              {{ tool.category || '-' }}
            </td>

            <td>
              {{ tool.location || '-' }}
            </td>

            <td>
              <strong>{{ tool.available_quantity }}</strong>
              / {{ tool.quantity }}
            </td>

            <td>
              <v-chip
                :color="
                  tool.available_quantity > 0
                    ? 'success'
                    : 'error'
                "
                size="small"
                variant="tonal"
              >
                {{
                  tool.available_quantity > 0
                    ? '貸出可能'
                    : '在庫なし'
                }}
              </v-chip>
            </td>

            <td class="text-right">
              <template v-if="auth.isAdmin.value">
                <v-btn
                  icon="mdi-pencil"
                  variant="text"
                  size="small"
                  @click="openEditDialog(tool)"
                />

                <v-btn
                  icon="mdi-delete-outline"
                  variant="text"
                  size="small"
                  color="error"
                  :disabled="
                    tool.available_quantity < tool.quantity
                  "
                  @click="openDeleteDialog(tool)"
                />
              </template>

              <span
                v-else
                class="text-medium-emphasis"
              >
                -
              </span>
            </td>
          </tr>

          <tr v-if="filteredTools.length === 0">
            <td
              colspan="6"
              class="table-empty"
            >
              工具・機材がありません。
            </td>
          </tr>
        </tbody>
      </v-table>
      </div>
    </v-card>

    <v-dialog
      v-if="auth.isAdmin.value"
      v-model="dialog"
      max-width="650"
    >
      <v-card>
        <v-card-title>
          {{ editingTool ? '工具・機材を編集' : '工具・機材を登録' }}
        </v-card-title>

        <v-card-text>
          <v-form @submit.prevent="saveTool">
            <v-text-field
              v-model="form.name"
              label="工具・機材名"
              required
              class="mb-2"
            />

            <v-text-field
              v-model="form.category"
              label="カテゴリ"
              class="mb-2"
            />

            <v-text-field
              v-model="form.location"
              label="保管場所"
              class="mb-2"
            />

            <v-textarea
              v-model="form.description"
              label="説明"
              rows="3"
              class="mb-4"
            />

            <div class="text-subtitle-1 font-weight-medium mb-1">
              貸出ルール
            </div>

            <div class="text-body-2 text-medium-emphasis mb-3">
              工具・機材ごとの貸出条件を設定します。
            </div>

            <v-text-field
              :model-value="form.maxQuantityPerClass"
            @update:model-value="setMaxQuantityPerClass"
              label="クラスごとの最大貸出数"
              type="number"
              min="1"
              placeholder="制限なし"
              hint="空欄にすると制限なし"
              persistent-hint
              class="mb-4"
            />

            <v-text-field
              :model-value="form.loanDurationMinutes"
            @update:model-value="setLoanDurationMinutes"
              label="貸出時間（分）"
              type="number"
              min="1"
              placeholder="制限なし"
              hint="空欄にすると時間制限なし"
              persistent-hint
              class="mb-4"
            />

            <v-text-field
              :model-value="form.maxQuantityPerChief"
              @update:model-value="setMaxQuantityPerChief"
              label="チーフの最大貸出数"
              type="number"
              min="1"
              placeholder="制限なし"
              hint="空欄にするとチーフの個数制限なし"
              persistent-hint
              class="mb-4"
            />

            <v-text-field
              :model-value="form.loanDurationMinutesPerChief"
              @update:model-value="setLoanDurationMinutesPerChief"
              label="チーフの貸出時間（分）"
              type="number"
              min="1"
              placeholder="制限なし"
              hint="空欄にするとチーフの時間制限なし"
              persistent-hint
              class="mb-4"
            />

            <v-switch
              v-model="form.dueNoticeEnabled"
              label="返却期限5分前に通知する"
              color="primary"
              hide-details
              class="mb-4"
            />

            <v-switch
              v-model="form.universalReturnEnabled"
              label="全体返却の対象にする"
              color="primary"
              hint="有効にすると、全体返却時刻5分前の通知対象になります。"
              persistent-hint
              class="mb-4"
            />

            <v-switch
              v-model="form.universalReturnEnabledForChief"
              label="チーフの全体返却の対象にする"
              color="primary"
              hint="有効にすると、チーフ用の全体返却時刻5分前の通知対象になります。"
              persistent-hint
              class="mb-4"
            />

            <div class="text-subtitle-1 font-weight-medium mb-1">
              個体・管理番号
            </div>

            <div class="text-body-2 text-medium-emphasis mb-3">
              実際の工具・機材1個ごとの管理番号を入力してください。
            </div>

            <div
              v-for="(item, index) in form.toolItems"
              :key="item.key"
              class="d-flex align-center ga-2 mb-2"
            >
              <v-text-field
                v-model="item.management_number"
                :label="`管理番号 ${index + 1}`"
                placeholder="例：TD-001"
                hide-details
                density="comfortable"
              />

              <v-btn
                icon="mdi-minus-circle-outline"
                variant="text"
                color="error"
                :disabled="
                  form.toolItems.length <= 1 ||
                  item.status !== 'available'
                "
                @click="removeToolItem(index)"
              />
            </div>

            <v-btn
              variant="tonal"
              prepend-icon="mdi-plus"
              class="mt-2"
              @click="addToolItem"
            >
              個体を追加
            </v-btn>

            <v-alert
              v-if="editingTool"
              type="info"
              variant="tonal"
              class="mt-4"
            >
              貸出中でない工具・機材は基本情報を編集できます。ただし、貸出履歴のある個体は管理番号の変更・削除ができません。
            </v-alert>

            <v-alert
              v-if="formError"
              type="error"
              variant="tonal"
              class="mt-4"
            >
              {{ formError }}
            </v-alert>

            <div class="d-flex justify-end ga-2 mt-5">
              <v-btn
                variant="text"
                @click="dialog = false"
              >
                キャンセル
              </v-btn>

              <v-btn
                type="submit"
                color="primary"
                :loading="saving"
              >
                {{ editingTool ? '保存' : '登録' }}
              </v-btn>
            </div>
          </v-form>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog
      v-if="auth.isAdmin.value"
      v-model="deleteDialog"
      max-width="480"
    >
      <v-card>
        <v-card-title>
          工具・機材を削除
        </v-card-title>

        <v-card-text>
          「{{ deletingTool?.name }}」を削除しますか？
          <br />
          <br />
          <strong>
            現在貸出中でなければ削除できます。過去の貸出履歴は残ります。
          </strong>
        </v-card-text>

        <v-card-actions>
          <v-spacer />

          <v-btn @click="deleteDialog = false">
            キャンセル
          </v-btn>

          <v-btn
            color="error"
            :loading="deleting"
            @click="deleteTool"
          >
            削除する
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar
      v-model="snackbar"
      :color="snackbarColor"
      timeout="3000"
    >
      {{ snackbarText }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import type { Tool, ToolItem } from '~/types'

const { request } = useApi()
const auth = useAuth()

const tools = ref<Tool[]>([])
const search = ref('')

const dialog = ref(false)
const deleteDialog = ref(false)

const editingTool = ref<Tool | null>(null)
const deletingTool = ref<Tool | null>(null)

const saving = ref(false)
const deleting = ref(false)
const formError = ref('')

const snackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref('success')

const draggingToolId = ref<number | null>(null)
const dragOverToolId = ref<number | null>(null)
const dragOverPosition = ref<'before' | 'after' | null>(null)

interface FormToolItem {
  key: string
  id: number | null
  management_number: string
  status: string
  hasHistory: boolean
}

const form = reactive<{
  name: string
  category: string
  description: string
  location: string
  maxQuantityPerClass: number | null
  loanDurationMinutes: number | null
  maxQuantityPerChief: number | null
  loanDurationMinutesPerChief: number | null
  dueNoticeEnabled: boolean
  universalReturnEnabled: boolean
  universalReturnEnabledForChief: boolean
  toolItems: FormToolItem[]
}>({
  name: '',
  category: '',
  description: '',
  location: '',
  maxQuantityPerClass: null,
  loanDurationMinutes: null,
  maxQuantityPerChief: null,
  loanDurationMinutesPerChief: null,
  dueNoticeEnabled: true,
  universalReturnEnabled: true,
  universalReturnEnabledForChief: true,
  toolItems: [],
})

const setMaxQuantityPerClass = (value: string | number | null) => {
  if (value === '' || value === null) {
    form.maxQuantityPerClass = null
    return
  }

  const numberValue = Number(value)

  form.maxQuantityPerClass =
    Number.isFinite(numberValue) ? numberValue : null
}

const setLoanDurationMinutes = (value: string | number | null) => {
  if (value === '' || value === null) {
    form.loanDurationMinutes = null
    return
  }

  const numberValue = Number(value)

  form.loanDurationMinutes =
    Number.isFinite(numberValue) ? numberValue : null
}

const setMaxQuantityPerChief = (
  value: string | number | null,
) => {
  if (value === '' || value === null) {
    form.maxQuantityPerChief = null
    return
  }

  const numberValue = Number(value)

  form.maxQuantityPerChief =
    Number.isFinite(numberValue) ? numberValue : null
}

const setLoanDurationMinutesPerChief = (
  value: string | number | null,
) => {
  if (value === '' || value === null) {
    form.loanDurationMinutesPerChief = null
    return
  }

  const numberValue = Number(value)

  form.loanDurationMinutesPerChief =
    Number.isFinite(numberValue) ? numberValue : null
}

let itemKey = 0

const createFormItem = (
  item?: Partial<FormToolItem>,
): FormToolItem => ({
  key: `tool-item-${++itemKey}`,
  id: item?.id ?? null,
  management_number: item?.management_number ?? '',
  status: item?.status ?? 'available',
  hasHistory: item?.hasHistory ?? false,
})

const filteredTools = computed(() => {
  const keyword = search.value.trim().toLowerCase()

  if (!keyword) {
    return tools.value
  }

  return tools.value.filter((tool) =>
    [
      tool.name,
      tool.category,
      tool.description,
      tool.location,
    ]
      .filter(Boolean)
      .some((value) =>
        value!.toLowerCase().includes(keyword),
      ),
  )
})

const loadTools = async () => {
  tools.value = await request<Tool[]>('/tools')
}

const handleDragStart = (toolId: number) => {
  if (!auth.isAdmin.value || search.value.trim()) {
    return
  }

  draggingToolId.value = toolId
  dragOverToolId.value = null
  dragOverPosition.value = null
}

const handleDragOver = (
  event: DragEvent,
  targetToolId: number,
) => {
  if (
    draggingToolId.value === null ||
    draggingToolId.value === targetToolId ||
    !auth.isAdmin.value ||
    search.value.trim()
  ) {
    return
  }

  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()

  dragOverToolId.value = targetToolId
  dragOverPosition.value =
    event.clientY < rect.top + rect.height / 2
      ? 'before'
      : 'after'
}

const handleDrop = async (
  targetToolId: number,
) => {
  if (
    draggingToolId.value === null ||
    dragOverToolId.value === null ||
    dragOverPosition.value === null ||
    draggingToolId.value === targetToolId ||
    !auth.isAdmin.value ||
    search.value.trim()
  ) {
    return
  }

  const fromIndex = tools.value.findIndex(
    tool => tool.id === draggingToolId.value,
  )

  const targetIndex = tools.value.findIndex(
    tool => tool.id === targetToolId,
  )

  if (
    fromIndex === -1 ||
    targetIndex === -1
  ) {
    return
  }

  const newTools = [...tools.value]
  const [movedTool] = newTools.splice(
    fromIndex,
    1,
  )

  if (!movedTool) {
    return
  }

  let insertIndex = targetIndex

  if (dragOverPosition.value === 'after') {
    insertIndex++
  }

  if (fromIndex < insertIndex) {
    insertIndex--
  }

  newTools.splice(
    insertIndex,
    0,
    movedTool,
  )

  tools.value = newTools

  try {
    await request('/tools/order', {
      method: 'PATCH',
      body: {
        tool_ids: tools.value.map(
          tool => tool.id,
        ),
      },
    })

    showSnackbar(
      '並び順を更新しました。',
    )
  } catch (error) {
    console.error(error)

    await loadTools()

    showSnackbar(
      '並び順の更新に失敗しました。',
      'error',
    )
  }
}

const handleDragEnd = () => {
  draggingToolId.value = null
  dragOverToolId.value = null
  dragOverPosition.value = null
}

const resetForm = () => {
  form.name = ''
  form.category = ''
  form.description = ''
  form.location = ''
  form.maxQuantityPerClass = null
  form.loanDurationMinutes = null
  form.maxQuantityPerChief = null
  form.loanDurationMinutesPerChief = null
  form.dueNoticeEnabled = true
  form.universalReturnEnabled = true
  form.universalReturnEnabledForChief = true
  form.toolItems = [
    createFormItem(),
  ]
  formError.value = ''
}

const addToolItem = () => {
  form.toolItems.push(createFormItem())
}

const removeToolItem = (index: number) => {
  const item = form.toolItems[index]

  if (
    !item ||
    form.toolItems.length <= 1 ||
    item.hasHistory ||
    item.status !== 'available'
  ) {
    return
  }

  form.toolItems.splice(index, 1)
}

const loadToolItems = async (
  toolId: number,
) => {
  const items = await request<ToolItem[]>(
    `/tools/${toolId}/items`,
  )

  return items.map(item =>
    createFormItem({
      id: item.id,
      management_number: item.management_number,
      status: item.status,
      hasHistory: item.has_history,
    }),
  )
}

const openCreateDialog = () => {
  editingTool.value = null
  resetForm()
  dialog.value = true
}

const openEditDialog = async (tool: Tool) => {
  editingTool.value = tool
  formError.value = ''

  try {
    const items = await request<ToolItem[]>(
      `/tools/${tool.id}/items`,
    )

    form.name = tool.name
    form.category = tool.category || ''
    form.description = tool.description || ''
    form.location = tool.location || ''
    form.maxQuantityPerClass = tool.max_quantity_per_class
    form.loanDurationMinutes = tool.loan_duration_minutes
    form.maxQuantityPerChief = tool.max_quantity_per_chief
    form.loanDurationMinutesPerChief =
      tool.loan_duration_minutes_per_chief
    form.dueNoticeEnabled = tool.due_notice_enabled === 1
    form.universalReturnEnabled =
      tool.universal_return_enabled === 1
    form.universalReturnEnabledForChief =
      tool.universal_return_enabled_for_chief === 1

    form.toolItems = items.map(item =>
      createFormItem({
        id: item.id,
        management_number: item.management_number,
        status: item.status,
        hasHistory: item.has_history,
      }),
    )

    if (form.toolItems.length === 0) {
      form.toolItems = [createFormItem()]
    }

    dialog.value = true
  } catch (error: any) {
    console.error(error)

    showSnackbar(
      error?.data?.detail ||
      '工具・機材個体の取得に失敗しました。',
      'error',
    )
  }
}

const saveTool = async () => {
  if (!form.name.trim()) {
    formError.value = '工具・機材名を入力してください。'
    return
  }

  if (form.toolItems.length === 0) {
    formError.value =
      '工具・機材個体を1つ以上登録してください。'
    return
  }

  if (
    form.maxQuantityPerClass !== null &&
    (!Number.isInteger(form.maxQuantityPerClass) ||
      form.maxQuantityPerClass <= 0)
  ) {
    formError.value =
      'クラスごとの最大貸出数は1以上で指定してください。'
    return
  }

  if (
    form.loanDurationMinutes !== null &&
    (!Number.isInteger(form.loanDurationMinutes) ||
      form.loanDurationMinutes <= 0)
  ) {
    formError.value =
      '貸出時間は1分以上で指定してください。'
    return
  }

    if (
    form.maxQuantityPerChief !== null &&
    (!Number.isInteger(form.maxQuantityPerChief) ||
      form.maxQuantityPerChief <= 0)
  ) {
    formError.value =
      'チーフの最大貸出数は1以上で指定してください。'
    return
  }

  if (
    form.loanDurationMinutesPerChief !== null &&
    (!Number.isInteger(form.loanDurationMinutesPerChief) ||
      form.loanDurationMinutesPerChief <= 0)
  ) {
    formError.value =
      'チーフの貸出時間は1分以上で指定してください。'
    return
  }

  const managementNumbers =
    form.toolItems.map(item =>
      item.management_number.trim(),
    )

  if (
    managementNumbers.some(
      number => !number,
    )
  ) {
    formError.value =
      'すべての個体に管理番号を入力してください。'
    return
  }

  if (
    new Set(managementNumbers).size !==
    managementNumbers.length
  ) {
    formError.value =
      '同じ管理番号を重複して登録することはできません。'
    return
  }

  saving.value = true
  formError.value = ''

  try {
    const body = {
      name: form.name.trim(),
      category: form.category.trim() || null,
      description: form.description.trim() || null,
      location: form.location.trim() || null,
      max_quantity_per_class:
        form.maxQuantityPerClass,
      loan_duration_minutes:
        form.loanDurationMinutes,
      max_quantity_per_chief:
        form.maxQuantityPerChief,
      loan_duration_minutes_per_chief:
        form.loanDurationMinutesPerChief,
      due_notice_enabled:
        form.dueNoticeEnabled,
      universal_return_enabled:
        form.universalReturnEnabled,
      universal_return_enabled_for_chief:
        form.universalReturnEnabledForChief,
      tool_items: form.toolItems.map(item => ({
        id: item.id,
        management_number:
          item.management_number.trim(),
      })),
    }

    if (editingTool.value) {
      await request<Tool>(
        `/tools/${editingTool.value.id}`,
        {
          method: 'PATCH',
          body,
        },
      )

      showSnackbar('工具・機材を更新しました。')
    } else {
      await request<Tool>('/tools', {
        method: 'POST',
        body,
      })

      showSnackbar('工具・機材を登録しました。')
    }

    dialog.value = false
    await loadTools()
  } catch (error: any) {
    console.error(error)

    formError.value =
      error?.data?.detail ||
      '保存に失敗しました。'
  } finally {
    saving.value = false
  }
}

const openDeleteDialog = (tool: Tool) => {
  deletingTool.value = tool
  deleteDialog.value = true
}

const deleteTool = async () => {
  if (!deletingTool.value) {
    return
  }

  deleting.value = true

  try {
    await request(
      `/tools/${deletingTool.value.id}`,
      {
        method: 'DELETE',
      },
    )

    deleteDialog.value = false
    deletingTool.value = null
    showSnackbar('工具・機材を削除しました。')
    await loadTools()
  } catch (error: any) {
    console.error(error)

    showSnackbar(
      error?.data?.detail ||
      '削除に失敗しました。',
      'error',
    )
  } finally {
    deleting.value = false
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
  loadTools()
})
</script>

<style scoped>

.tool-row-draggable {
  cursor: grab;
}

.tool-row-draggable:active {
  cursor: grabbing;
}

.tool-row-dragging {
  opacity: 0.5;
}

.tool-row-drag-over-before > td {
  box-shadow:
    inset 0 4px 0 rgb(var(--v-theme-primary));
}

.tool-row-drag-over-after > td {
  box-shadow:
    inset 0 -4px 0 rgb(var(--v-theme-primary));
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
