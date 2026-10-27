<template>
  <v-container
    class="pa-0"
    max-width="720"
  >
    <v-card
      class="rounded-xl"
      elevation="1"
    >
      <v-card-title class="pa-6 pb-2">
        <div class="text-h5 font-weight-bold">
          全体設定
        </div>
      </v-card-title>

      <v-card-text class="pa-6">
        <v-alert
          v-if="errorMessage"
          type="error"
          variant="tonal"
          class="mb-6"
        >
          {{ errorMessage }}
        </v-alert>

        <v-alert
          v-if="successMessage"
          type="success"
          variant="tonal"
          class="mb-6"
        >
          {{ successMessage }}
        </v-alert>



        <div class="text-subtitle-1 font-weight-bold mb-2">
          通知設定
        </div>

        <div class="text-body-2 text-medium-emphasis mb-4">
          貸出期限・全体返却時刻の通知先を設定します。
        </div>

        <v-radio-group
          v-model="notificationChannel"
          inline
          :disabled="notificationLoading || notificationTesting"
        >
          <v-radio
            label="通知しない"
            value="none"
          />
          <v-radio
            label="Discord"
            value="discord"
          />
          <v-radio
            label="LINE"
            value="line"
          />
        </v-radio-group>

        <template v-if="notificationChannel === 'discord'">
          <v-text-field
            v-model="discordWebhookUrl"
            label="Discord Webhook URL"
            type="password"
            autocomplete="off"
            :disabled="notificationLoading || notificationTesting"
            hint="変更する場合だけ入力してください。既存設定は再表示されません。"
            persistent-hint
            class="mb-2"
          />

          <v-alert
            v-if="discordConfigured"
            type="info"
            variant="tonal"
            class="mb-4"
          >
            Discord Webhook URLは設定済みです。
          </v-alert>
        </template>

        <template v-if="notificationChannel === 'line'">
          <v-text-field
            v-model="lineChannelAccessToken"
            label="LINE Channel Access Token"
            type="password"
            autocomplete="off"
            :disabled="
              notificationLoading ||
              notificationTesting
            "
            hint="変更する場合だけ入力してください。既存トークンは再表示されません。"
            persistent-hint
            class="mb-2"
          />

          <v-text-field
            v-model="lineChannelSecret"
            label="LINE Channel Secret"
            type="password"
            autocomplete="off"
            :disabled="
              notificationLoading ||
              notificationTesting
            "
            hint="LINE Developers Consoleのチャネル基本設定から取得します。"
            persistent-hint
            class="mb-2"
          />

          <v-alert
            v-if="lineConfigured"
            type="info"
            variant="tonal"
            class="mb-4"
          >
            LINEの認証情報は設定済みです。
          </v-alert>

          <v-alert
            type="info"
            variant="tonal"
            class="mb-4"
          >
            LINE公式アカウントにメッセージを送ると、そのユーザー・グループ・複数人トークが自動的に候補へ追加されます。
          </v-alert>

          <div class="d-flex align-center justify-space-between mb-2">
            <div class="text-subtitle-2 font-weight-bold">
              送信先
            </div>

            <v-btn
              variant="text"
              size="small"
              :loading="lineDestinationsLoading"
              :disabled="
                notificationLoading ||
                notificationTesting
              "
              @click="loadLineDestinations"
            >
              送信先を更新
            </v-btn>
          </div>

          <v-select
            v-model="lineSelectedDestinationId"
            label="通知を送るLINEトーク"
            :items="lineDestinationOptions"
            item-title="title"
            item-value="value"
            :disabled="
              notificationLoading ||
              notificationTesting ||
              lineDestinationsLoading
            "
            clearable
            class="mb-2"
          />

          <v-alert
            v-if="!lineDestinations.length"
            type="warning"
            variant="tonal"
            class="mb-4"
          >
            まだ送信先がありません。LINE公式アカウントが参加しているトークから、Botへメッセージを送ってください。
          </v-alert>

          <div
            v-else
            class="text-caption text-medium-emphasis mb-4"
          >
            {{ lineDestinations.length }}件の送信先を検出しています。
          </div>
        </template>
        <div class="d-flex flex-column flex-sm-row ga-3 mt-4">
          <v-btn
            color="primary"
            size="large"
            :loading="notificationLoading"
            :disabled="notificationLoading || notificationTesting"
            @click="saveNotificationSettings"
          >
            通知設定を保存
          </v-btn>

          <v-btn
            variant="outlined"
            size="large"
            :loading="notificationTesting"
            :disabled="
              notificationLoading ||
              notificationTesting ||
              notificationChannel === 'none' ||
              (
                notificationChannel === 'line' &&
                (
                  !lineConfigured ||
                  !lineSelectedDestinationId
                )
              )
            "
            @click="sendNotificationTest"
          >
            テスト通知
          </v-btn>
        </div>

        <v-divider class="my-8" />

        <div class="text-subtitle-1 font-weight-bold mb-2">
          全体返却時刻
        </div>

        <div class="text-body-2 text-medium-emphasis mb-4">
          設定した時刻になると、まだ返却されていない工具・機材をクラスごとにまとめて通知します。
          複数の返却時刻を設定できます。設定しない場合は通知されません。
        </div>

        <v-alert
          v-if="returnTimeError"
          type="error"
          variant="tonal"
          class="mb-4"
        >
          {{ returnTimeError }}
        </v-alert>

        <v-alert
          v-if="returnTimeSuccess"
          type="success"
          variant="tonal"
          class="mb-4"
        >
          {{ returnTimeSuccess }}
        </v-alert>

        <div
          v-for="(returnTime, index) in universalReturnTimes"
          :key="index"
          class="d-flex align-center ga-3 mb-3"
        >
          <input
            v-model="universalReturnTimes[index]"
            type="time"
            step="60"
            :disabled="returnTimeLoading"
            class="return-time-input"
          />

          <v-btn
            icon="mdi-delete"
            variant="text"
            color="error"
            :disabled="returnTimeLoading"
            aria-label="返却時刻を削除"
            @click="removeReturnTime(index)"
          />
        </div>

        <v-btn
          variant="text"
          prepend-icon="mdi-plus"
          :disabled="returnTimeLoading"
          class="mb-4"
          @click="addReturnTime"
        >
          返却時刻を追加
        </v-btn>

        <div>
          <v-btn
            color="primary"
            :loading="returnTimeLoading"
            :disabled="returnTimeLoading"
            @click="saveUniversalReturnTimes"
          >
            全体返却時刻を保存
          </v-btn>
        </div>

        <v-divider class="my-8" />

        <div class="text-subtitle-1 font-weight-bold mb-2">
          チーフ用 全体返却時刻
        </div>

        <div class="text-body-2 text-medium-emphasis mb-4">
          チーフの貸出について、設定した時刻になると、まだ返却されていない工具・機材をまとめて通知します。
          複数の返却時刻を設定できます。設定しない場合は通知されません。
        </div>

        <v-alert
          v-if="chiefReturnTimeError"
          type="error"
          variant="tonal"
          class="mb-4"
        >
          {{ chiefReturnTimeError }}
        </v-alert>

        <v-alert
          v-if="chiefReturnTimeSuccess"
          type="success"
          variant="tonal"
          class="mb-4"
        >
          {{ chiefReturnTimeSuccess }}
        </v-alert>

        <div
          v-for="(returnTime, index) in chiefUniversalReturnTimes"
          :key="index"
          class="d-flex align-center ga-3 mb-3"
        >
          <input
            v-model="chiefUniversalReturnTimes[index]"
            type="time"
            step="60"
            :disabled="chiefReturnTimeLoading"
            class="return-time-input"
          />

          <v-btn
            icon="mdi-delete"
            variant="text"
            color="error"
            :disabled="chiefReturnTimeLoading"
            aria-label="チーフ用返却時刻を削除"
            @click="removeChiefReturnTime(index)"
          />
        </div>

        <v-btn
          variant="text"
          prepend-icon="mdi-plus"
          :disabled="chiefReturnTimeLoading"
          class="mb-4"
          @click="addChiefReturnTime"
        >
          返却時刻を追加
        </v-btn>

        <div>
          <v-btn
            color="primary"
            :loading="chiefReturnTimeLoading"
            :disabled="chiefReturnTimeLoading"
            @click="saveChiefUniversalReturnTimes"
          >
            チーフ用全体返却時刻を保存
          </v-btn>
        </div>

        <v-divider class="my-8" />

        <div class="text-subtitle-1 font-weight-bold mb-2">
          アカウント管理
        </div>

        <div class="text-body-2 text-medium-emphasis mb-4">
          貸出管理を利用するアカウントを作成できます。
          管理者は設定変更やアカウント管理を行えます。
        </div>

        <v-alert
          v-if="accountError"
          type="error"
          variant="tonal"
          class="mb-4"
        >
          {{ accountError }}
        </v-alert>

        <v-alert
          v-if="accountSuccess"
          type="success"
          variant="tonal"
          class="mb-4"
        >
          {{ accountSuccess }}
        </v-alert>

        <v-form @submit.prevent="createUser">
          <v-text-field
            v-model="newAccountUsername"
            label="ID"
            autocomplete="off"
            maxlength="50"
            counter="50"
            :disabled="accountLoading"
            required
          />

          <v-text-field
            v-model="newAccountPassword"
            label="パスワード"
            type="password"
            autocomplete="new-password"
            hint="8文字以上で入力してください。"
            persistent-hint
            :disabled="accountLoading"
            required
            class="mb-2"
          />

          <v-select
            v-model="newAccountRole"
            label="権限"
            :items="accountRoleOptions"
            item-title="title"
            item-value="value"
            :disabled="accountLoading"
          />

          <v-btn
            type="submit"
            color="primary"
            :loading="accountLoading"
            :disabled="
              accountLoading ||
              !newAccountUsername.trim() ||
              !newAccountPassword
            "
          >
            アカウントを作成
          </v-btn>
        </v-form>

        <div class="text-subtitle-2 font-weight-bold mt-6 mb-3">
          登録済みアカウント
        </div>

        <v-progress-linear
          v-if="accountsLoading"
          indeterminate
          class="mb-4"
        />

        <v-list
          v-if="accounts.length"
          border
          rounded="lg"
          class="pa-0"
        >
          <v-list-item
            v-for="account in accounts"
            :key="account.id"
            class="py-2"
          >
            <template #prepend>
              <v-icon icon="mdi-account-circle-outline" />
            </template>

            <v-list-item-title>
              {{ account.username }}
            </v-list-item-title>

            <v-list-item-subtitle>
              {{
                account.role === 'admin'
                  ? '管理者'
                  : 'スタッフ'
              }}
            </v-list-item-subtitle>

            <template #append>
              <div class="d-flex align-center ga-2">
                <v-chip
                  size="small"
                  :color="
                    account.role === 'admin'
                      ? 'primary'
                      : undefined
                  "
                >
                  {{
                    account.role === 'admin'
                      ? '管理者'
                      : 'スタッフ'
                  }}
                </v-chip>

                <v-btn
                  icon="mdi-pencil-outline"
                  size="small"
                  variant="text"
                  :disabled="accountActionLoading"
                  @click="openEditAccount(account)"
                />

                <v-btn
                  v-if="account.id !== currentUserId"
                  icon="mdi-delete-outline"
                  size="small"
                  color="error"
                  variant="text"
                  :disabled="accountActionLoading"
                  @click="openDeleteAccount(account)"
                />
              </div>
            </template>
          </v-list-item>
        </v-list>

        <v-alert
          v-else-if="!accountsLoading"
          type="info"
          variant="tonal"
        >
          登録されているアカウントがありません。
        </v-alert>

        <v-dialog
          v-model="editAccountDialog"
          max-width="500"
        >
          <v-card>
            <v-card-title>
              アカウントを編集
            </v-card-title>

            <v-card-text>
              <v-alert
                v-if="editAccountError"
                type="error"
                variant="tonal"
                class="mb-4"
              >
                {{ editAccountError }}
              </v-alert>

              <v-text-field
                v-model="editAccountUsername"
                label="ID"
                autocomplete="off"
                maxlength="50"
                counter="50"
                :disabled="accountActionLoading"
              />

              <v-text-field
                v-model="editAccountPassword"
                label="新しいパスワード"
                type="password"
                autocomplete="new-password"
                hint="変更しない場合は空欄にしてください。変更する場合は8文字以上。"
                persistent-hint
                :disabled="accountActionLoading"
              />

              <v-select
                v-model="editAccountRole"
                label="権限"
                :items="accountRoleOptions"
                item-title="title"
                item-value="value"
                :disabled="accountActionLoading"
                class="mt-4"
              />
            </v-card-text>

            <v-card-actions>
              <v-spacer />

              <v-btn
                variant="text"
                :disabled="accountActionLoading"
                @click="editAccountDialog = false"
              >
                キャンセル
              </v-btn>

              <v-btn
                color="primary"
                :loading="accountActionLoading"
                :disabled="
                  !editAccountUsername.trim() ||
                  (editAccountPassword.length > 0 &&
                    editAccountPassword.length < 8)
                "
                @click="updateAccount"
              >
                保存
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <v-dialog
          v-model="deleteAccountDialog"
          max-width="450"
        >
          <v-card>
            <v-card-title>
              アカウントを削除
            </v-card-title>

            <v-card-text>
              <div class="mb-2">
                次のアカウントを削除します。
              </div>

              <strong>
                {{ selectedAccount?.username }}
              </strong>

              <div class="text-body-2 text-medium-emphasis mt-4">
                この操作は取り消せません。
              </div>

              <v-alert
                v-if="deleteAccountError"
                type="error"
                variant="tonal"
                class="mt-4"
              >
                {{ deleteAccountError }}
              </v-alert>
            </v-card-text>

            <v-card-actions>
              <v-spacer />

              <v-btn
                variant="text"
                :disabled="accountActionLoading"
                @click="deleteAccountDialog = false"
              >
                キャンセル
              </v-btn>

              <v-btn
                color="error"
                :loading="accountActionLoading"
                @click="deleteAccount"
              >
                削除する
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <v-divider class="my-8" />

        <div class="text-subtitle-1 font-weight-bold mb-2">
          貸出履歴
        </div>

        <div class="text-body-2 text-medium-emphasis mb-4">
          返却済みの貸出履歴をすべて削除できます。現在貸出中の履歴は削除されません。
        </div>

        <v-btn
          color="error"
          variant="outlined"
          :loading="historyDeleteLoading"
          :disabled="historyDeleteLoading"
          @click="deleteLoanHistory"
        >
          返却済みの貸出履歴を削除
        </v-btn>


      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
const api = useApi()
const auth = useAuth()


const errorMessage = ref('')
const successMessage = ref('')

type NotificationChannel =
  | 'none'
  | 'discord'
  | 'line'

const notificationChannel =
  ref<NotificationChannel>('discord')

const discordWebhookUrl = ref('')
const discordConfigured = ref(false)

const lineChannelAccessToken = ref('')
const lineChannelSecret = ref('')
const lineConfigured = ref(false)

interface LineDestination {
  destination_type:
    | 'user'
    | 'group'
    | 'room'
  destination_id: string
  display_name: string | null
  last_seen_at: string
}

const lineDestinations =
  ref<LineDestination[]>([])

const lineDestinationOptions = computed(() =>
  lineDestinations.value.map(destination => ({
    title: `${destination.display_name ?? '名称不明'}（${destination.destination_type}）`,
    value: destination.destination_id,
  })),
)

const lineSelectedDestinationId =
  ref('')

const notificationLoading = ref(false)
const notificationTesting = ref(false)

const lineDestinationsLoading = ref(false)

const historyDeleteLoading = ref(false)

const universalReturnTimes = ref<string[]>([])
const returnTimeLoading = ref(false)
const returnTimeError = ref('')
const returnTimeSuccess = ref('')

const chiefUniversalReturnTimes = ref<string[]>([])
const chiefReturnTimeLoading = ref(false)
const chiefReturnTimeError = ref('')
const chiefReturnTimeSuccess = ref('')


interface AdminAccount {
  id: number
  username: string
  role: 'admin' | 'staff'
  created_at: string
}

const accounts = ref<AdminAccount[]>([])
const accountsLoading = ref(false)
const accountLoading = ref(false)
const accountActionLoading = ref(false)
const accountError = ref('')
const accountSuccess = ref('')

const currentUserId = ref<number | null>(null)

const newAccountUsername = ref('')
const newAccountPassword = ref('')
const newAccountRole =
  ref<'admin' | 'staff'>('staff')

const accountRoleOptions = [
  {
    title: 'スタッフ',
    value: 'staff',
  },
  {
    title: '管理者',
    value: 'admin',
  },
]

const editAccountDialog = ref(false)
const deleteAccountDialog = ref(false)

const selectedAccount =
  ref<AdminAccount | null>(null)

const editAccountUsername = ref('')
const editAccountPassword = ref('')
const editAccountRole =
  ref<'admin' | 'staff'>('staff')

const editAccountError = ref('')
const deleteAccountError = ref('')

const loadAccounts = async () => {
  accountsLoading.value = true
  accountError.value = ''

  try {
    const result = await api.request<{
      users: AdminAccount[]
      current_user_id: number
    }>('/auth/users')

    accounts.value = result.users
    currentUserId.value =
      result.current_user_id
  } catch (error: any) {
    accountError.value =
      error?.data?.detail ??
      'アカウント一覧の取得に失敗しました'
  } finally {
    accountsLoading.value = false
  }
}

const createUser = async () => {
  if (accountLoading.value) {
    return
  }

  accountError.value = ''
  accountSuccess.value = ''

  const username =
    newAccountUsername.value.trim()
  const password =
    newAccountPassword.value

  if (!username) {
    accountError.value =
      'IDを入力してください'
    return
  }

  if (password.length < 8) {
    accountError.value =
      'パスワードは8文字以上で入力してください'
    return
  }

  accountLoading.value = true

  try {
    const result = await api.request<{
      detail: string
      username: string
      role: 'admin' | 'staff'
    }>('/auth/users', {
      method: 'POST',
      body: {
        username,
        password,
        role: newAccountRole.value,
      },
    })

    accountSuccess.value =
      result.detail

    newAccountUsername.value = ''
    newAccountPassword.value = ''
    newAccountRole.value = 'staff'

    await loadAccounts()
  } catch (error: any) {
    accountError.value =
      error?.data?.detail ??
      'アカウントの作成に失敗しました'
  } finally {
    accountLoading.value = false
  }
}

const openEditAccount = (
  account: AdminAccount,
) => {
  selectedAccount.value = account
  editAccountUsername.value =
    account.username
  editAccountPassword.value = ''
  editAccountRole.value = account.role
  editAccountError.value = ''
  editAccountDialog.value = true
}

const updateAccount = async () => {
  if (
    accountActionLoading.value ||
    !selectedAccount.value
  ) {
    return
  }

  editAccountError.value = ''

  const username =
    editAccountUsername.value.trim()

  if (!username) {
    editAccountError.value =
      'IDを入力してください'
    return
  }

  if (
    editAccountPassword.value &&
    editAccountPassword.value.length < 8
  ) {
    editAccountError.value =
      'パスワードは8文字以上で入力してください'
    return
  }

  accountActionLoading.value = true

  try {
    const body: {
      username: string
      role: 'admin' | 'staff'
      password?: string
    } = {
      username,
      role: editAccountRole.value,
    }

    if (editAccountPassword.value) {
      body.password =
        editAccountPassword.value
    }

    const result =
      await api.request<{
        detail: string
        id: number
        username: string
        role: 'admin' | 'staff'
      }>(
        `/auth/users/${selectedAccount.value.id}`,
        {
          method: 'PATCH',
          body,
        },
      )

    editAccountDialog.value = false
    accountSuccess.value =
      result.detail

    await loadAccounts()
  } catch (error: any) {
    editAccountError.value =
      error?.data?.detail ??
      'アカウントの更新に失敗しました'
  } finally {
    accountActionLoading.value = false
  }
}

const openDeleteAccount = (
  account: AdminAccount,
) => {
  if (account.id === currentUserId.value) {
    return
  }

  selectedAccount.value = account
  deleteAccountError.value = ''
  deleteAccountDialog.value = true
}

const deleteAccount = async () => {
  if (
    accountActionLoading.value ||
    !selectedAccount.value
  ) {
    return
  }

  if (
    selectedAccount.value.id ===
    currentUserId.value
  ) {
    deleteAccountError.value =
      '現在ログインしているアカウントは削除できません'
    return
  }

  accountActionLoading.value = true
  deleteAccountError.value = ''

  try {
    const result =
      await api.request<{
        detail: string
        id: number
      }>(
        `/auth/users/${selectedAccount.value.id}`,
        {
          method: 'DELETE',
        },
      )

    deleteAccountDialog.value = false
    accountSuccess.value =
      result.detail

    selectedAccount.value = null

    await loadAccounts()
  } catch (error: any) {
    deleteAccountError.value =
      error?.data?.detail ??
      'アカウントの削除に失敗しました'
  } finally {
    accountActionLoading.value = false
  }
}

const loadLineDestinations = async () => {
  lineDestinationsLoading.value = true

  try {
    const result = await api.request<{
      destinations: LineDestination[]
    }>(
      '/settings/notifications/line-destinations',
    )

    lineDestinations.value =
      result.destinations

    const selectedExists =
      lineDestinations.value.some(
        destination =>
          destination.destination_id ===
          lineSelectedDestinationId.value,
      )

    if (
      !selectedExists &&
      lineSelectedDestinationId.value
    ) {
      lineSelectedDestinationId.value =
        ''
    }
  } catch (error: any) {
    errorMessage.value =
      error?.data?.detail ??
      'LINE送信先の取得に失敗しました'
  } finally {
    lineDestinationsLoading.value = false
  }
}

const loadNotificationSettings = async () => {
  try {
    const result = await api.request<{
      channel: NotificationChannel
      discord_configured: boolean
      line_configured: boolean
      line_destination_type:
        | 'user'
        | 'group'
        | 'room'
        | null
      line_destination_id: string | null
    }>('/settings/notifications')

    notificationChannel.value =
      result.channel

    discordConfigured.value =
      result.discord_configured

    lineConfigured.value =
      result.line_configured

    lineSelectedDestinationId.value =
      result.line_destination_id ?? ''
  } catch (error: any) {
    errorMessage.value =
      error?.data?.detail ??
      '通知設定の取得に失敗しました'
  }
}

const saveNotificationSettings = async () => {
  errorMessage.value = ''
  successMessage.value = ''
  notificationLoading.value = true

  try {
    const result = await api.request<{
      detail: string
      channel: NotificationChannel
      discord_configured: boolean
      line_configured: boolean
      line_destination_type:
        | 'user'
        | 'group'
        | 'room'
        | null
      line_destination_id: string | null
    }>('/settings/notifications', {
      method: 'PATCH',
      body: {
        channel:
          notificationChannel.value,
        ...(discordWebhookUrl.value.trim()
          ? {
              discord_webhook_url:
                discordWebhookUrl.value.trim(),
            }
          : {}),
        ...(lineChannelAccessToken.value.trim()
          ? {
              line_channel_access_token:
                lineChannelAccessToken.value.trim(),
            }
          : {}),
        ...(lineChannelSecret.value.trim()
          ? {
              line_channel_secret:
                lineChannelSecret.value.trim(),
            }
          : {}),
        ...(notificationChannel.value === 'line'
          ? (() => {
              const selected =
                lineDestinations.value.find(
                  destination =>
                    destination.destination_id ===
                    lineSelectedDestinationId.value,
                )

              return selected
                ? {
                    line_destination_type:
                      selected.destination_type,
                    line_destination_id:
                      selected.destination_id,
                  }
                : {}
            })()
          : {}),
      },
    })

    discordWebhookUrl.value = ''
    lineChannelAccessToken.value = ''
    lineChannelSecret.value = ''

    discordConfigured.value =
      result.discord_configured

    lineConfigured.value =
      result.line_configured

    lineSelectedDestinationId.value =
      result.line_destination_id ?? ''

    await loadLineDestinations()

    successMessage.value = result.detail
  } catch (error: any) {
    errorMessage.value =
      error?.data?.detail ??
      '通知設定の保存に失敗しました'
  } finally {
    notificationLoading.value = false
  }
}

const deleteLoanHistory = async () => {
  if (historyDeleteLoading.value) {
    return
  }

  const confirmed = window.confirm(
    '返却済みの貸出履歴をすべて削除します。\n\nこの操作は元に戻せません。実行しますか？',
  )

  if (!confirmed) {
    return
  }

  errorMessage.value = ''
  successMessage.value = ''
  historyDeleteLoading.value = true

  try {
    const result = await api.request<{
      detail: string
      deleted_count: number
    }>('/loans/history', {
      method: 'DELETE',
    })

    successMessage.value =
      result.detail
  } catch (error: any) {
    errorMessage.value =
      error?.data?.detail ??
      '貸出履歴の削除に失敗しました'
  } finally {
    historyDeleteLoading.value = false
  }
}

const loadUniversalReturnTimes = async () => {
  returnTimeLoading.value = true
  returnTimeError.value = ''
  returnTimeSuccess.value = ''

  try {
    const result = await api.request<{
      universal_return_times: Array<{
        id: number
        return_time: string
      }>
    }>('/settings/return-time')

    universalReturnTimes.value =
      result.universal_return_times.map(
        item => item.return_time,
      )
  } catch (error: any) {
    returnTimeError.value =
      error?.data?.detail ??
      '全体返却時刻の取得に失敗しました'
  } finally {
    returnTimeLoading.value = false
  }
}

const loadChiefUniversalReturnTimes = async () => {
  chiefReturnTimeLoading.value = true
  chiefReturnTimeError.value = ''
  chiefReturnTimeSuccess.value = ''

  try {
    const result = await api.request<{
      universal_return_times: Array<{
        id: number
        return_time: string
      }>
    }>('/settings/return-time-chief')

    chiefUniversalReturnTimes.value =
      result.universal_return_times.map(
        item => item.return_time,
      )
  } catch (error: any) {
    chiefReturnTimeError.value =
      error?.data?.detail ??
      'チーフ用全体返却時刻の取得に失敗しました'
  } finally {
    chiefReturnTimeLoading.value = false
  }
}

const addChiefReturnTime = () => {
  chiefUniversalReturnTimes.value.push('')
  chiefReturnTimeError.value = ''
  chiefReturnTimeSuccess.value = ''
}

const removeChiefReturnTime = (index: number) => {
  chiefUniversalReturnTimes.value.splice(index, 1)
  chiefReturnTimeError.value = ''
  chiefReturnTimeSuccess.value = ''
}

const saveChiefUniversalReturnTimes = async () => {
  chiefReturnTimeError.value = ''
  chiefReturnTimeSuccess.value = ''

  const values = chiefUniversalReturnTimes.value.map(
    value => String(value).trim(),
  )

  if (values.some(value => value === '')) {
    chiefReturnTimeError.value =
      '返却時刻が未入力の行があります'
    return
  }

  if (
    values.some(
      value =>
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(value),
    )
  ) {
    chiefReturnTimeError.value =
      '返却時刻はHH:mm形式で指定してください'
    return
  }

  const uniqueValues = [...new Set(values)]

  if (uniqueValues.length !== values.length) {
    chiefReturnTimeError.value =
      '同じ返却時刻を複数設定することはできません'
    return
  }

  chiefReturnTimeLoading.value = true

  try {
    const result = await api.request<{
      universal_return_times: Array<{
        id: number
        return_time: string
      }>
    }>('/settings/return-time-chief', {
      method: 'PATCH',
      body: {
        universal_return_times: uniqueValues,
      },
    })

    chiefUniversalReturnTimes.value =
      result.universal_return_times.map(
        item => item.return_time,
      )

    chiefReturnTimeSuccess.value =
      'チーフ用全体返却時刻を保存しました'
  } catch (error: any) {
    chiefReturnTimeError.value =
      error?.data?.detail ??
      'チーフ用全体返却時刻の保存に失敗しました'
  } finally {
    chiefReturnTimeLoading.value = false
  }
}

const addReturnTime = () => {
  universalReturnTimes.value.push('')
  returnTimeError.value = ''
  returnTimeSuccess.value = ''
}

const removeReturnTime = (index: number) => {
  universalReturnTimes.value.splice(index, 1)
  returnTimeError.value = ''
  returnTimeSuccess.value = ''
}

const saveUniversalReturnTimes = async () => {
  returnTimeError.value = ''
  returnTimeSuccess.value = ''

  const values = universalReturnTimes.value.map(
    value => String(value).trim(),
  )

  if (values.some(value => value === '')) {
    returnTimeError.value =
      '返却時刻が未入力の行があります'
    return
  }

  if (
    values.some(
      value =>
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(value),
    )
  ) {
    returnTimeError.value =
      '返却時刻はHH:mm形式で指定してください'
    return
  }

  const uniqueValues = [...new Set(values)]

  if (uniqueValues.length !== values.length) {
    returnTimeError.value =
      '同じ返却時刻を複数設定することはできません'
    return
  }

  returnTimeLoading.value = true

  try {
    const result = await api.request<{
      universal_return_times: Array<{
        id: number
        return_time: string
      }>
    }>('/settings/return-time', {
      method: 'PATCH',
      body: {
        universal_return_times: uniqueValues,
      },
    })

    universalReturnTimes.value =
      result.universal_return_times.map(
        item => item.return_time,
      )

    if (result.universal_return_times.length === 0) {
      returnTimeSuccess.value =
        '全体返却時刻の設定をすべて解除しました。'
    } else {
      returnTimeSuccess.value =
        `全体返却時刻を${result.universal_return_times
          .map(item => item.return_time)
          .join('、')}に設定しました。`
    }
  } catch (error: any) {
    returnTimeError.value =
      error?.data?.detail ??
      '全体返却時刻の保存に失敗しました'
  } finally {
    returnTimeLoading.value = false
  }
}

const sendNotificationTest = async () => {
  errorMessage.value = ''
  successMessage.value = ''
  notificationTesting.value = true

  try {
    const result = await api.request<{
      detail: string
    }>('/settings/notifications/test', {
      method: 'POST',
    })

    successMessage.value = result.detail
  } catch (error: any) {
    errorMessage.value =
      error?.data?.detail ??
      'テスト通知に失敗しました'
  } finally {
    notificationTesting.value = false
  }
}

onMounted(async () => {
  await Promise.all([
    loadNotificationSettings(),
    loadLineDestinations(),
    loadUniversalReturnTimes(),
    loadChiefUniversalReturnTimes(),
    loadAccounts(),
  ])
})


</script>

<style scoped>
.return-time-input {
  width: 180px;
  height: 56px;
  padding: 0 16px;
  border: 1px solid rgba(
    var(--v-border-color),
    var(--v-border-opacity)
  );
  border-radius: 4px;
  font-size: 16px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}
</style>
