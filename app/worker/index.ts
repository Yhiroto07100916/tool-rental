import { DurableObject } from 'cloudflare:workers'

interface Env {
  NOTIFICATION_SCHEDULER: DurableObjectNamespace
  DB: D1Database
  AUTH_USERNAME: string
  AUTH_PASSWORD_HASH: string
  AUTH_SESSION_SECRET: string
  DISCORD_WEBHOOK_URL: string
}

interface Tool {
  id: number
  name: string
  category: string | null
  description: string | null
  location: string | null
  quantity: number
  available_quantity: number
  max_quantity_per_class: number | null
  loan_duration_minutes: number | null
  max_quantity_per_chief: number | null
  loan_duration_minutes_per_chief: number | null
  due_notice_enabled: number
  universal_return_enabled: number
  universal_return_enabled_for_chief: number
  is_active: number
  created_at: string
  updated_at: string
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

const SESSION_TTL_SECONDS = 8 * 60 * 60


const JST_OFFSET_MS = 9 * 60 * 60 * 1000

const formatJstDateTime = (date = new Date()): string => {
  return new Date(date.getTime() + JST_OFFSET_MS)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ')
}

const getJstDateParts = (date = new Date()) => {
  const jst = new Date(date.getTime() + JST_OFFSET_MS)

  return {
    date: jst.toISOString().slice(0, 10),
    time: jst.toISOString().slice(11, 16),
  }
}

async function getNextUniversalReturnDueAt(
  db: D1Database,
  borrowedAt: Date,
  isChief: boolean,
): Promise<string | null> {
  const tableName = isChief
    ? 'universal_return_times_chief'
    : 'universal_return_times'

  const result = await db
    .prepare(`
      SELECT return_time
      FROM ${tableName}
      ORDER BY return_time ASC
    `)
    .all<{
      return_time: string
    }>()

  if (result.results.length === 0) {
    return null
  }

  const { date } = getJstDateParts(borrowedAt)

  // 貸出時刻以降で、その日に最初に来る全体返却時刻を探す
  for (const returnTime of result.results) {
    const returnAt = new Date(
      `${date}T${returnTime.return_time}:00+09:00`,
    )

    if (returnAt.getTime() >= borrowedAt.getTime()) {
      return `${date} ${returnTime.return_time}:00`
    }
  }

  // 当日に残っていなければ、翌日の最初の全体返却時刻
  const nextDate = new Date(
    `${date}T00:00:00+09:00`,
  )
  nextDate.setTime(
    nextDate.getTime() + JST_DAY_MS,
  )

  const { date: nextJstDate } =
    getJstDateParts(nextDate)

  return `${nextJstDate} ${result.results[0].return_time}:00`
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error('Invalid hex')
  }

  const bytes = new Uint8Array(hex.length / 2)

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(
      hex.slice(i * 2, i * 2 + 2),
      16,
    )
  }

  return bytes
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  const padded =
    base64 + '='.repeat((4 - (base64.length % 4)) % 4)

  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

function timingSafeEqual(
  a: Uint8Array,
  b: Uint8Array,
): boolean {
  if (a.length !== b.length) {
    return false
  }

  let result = 0

  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i]
  }

  return result === 0
}

async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split(':')

  if (parts.length !== 3) {
    return false
  }

  const [saltHex, hashHex, iterationsText] = parts
  const iterations = Number(iterationsText)

  if (
    !Number.isInteger(iterations) ||
    iterations <= 0 ||
    !saltHex ||
    !hashHex
  ) {
    return false
  }

  try {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    )

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: hexToBytes(saltHex),
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      256,
    )

    return timingSafeEqual(
      new Uint8Array(derivedBits),
      hexToBytes(hashHex),
    )
  } catch {
    return false
  }
}

async function hashPassword(
  password: string,
): Promise<string> {
  const salt = crypto.getRandomValues(
    new Uint8Array(16),
  )

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  )

  return `${bytesToHex(salt)}:${bytesToHex(
    new Uint8Array(derivedBits),
  )}:100000`
}

async function createSession(
  userId: number,
  username: string,
  sessionVersion: number,
  role: string,
  secret: string,
): Promise<{
  token: string
  expires_at: number
  role: string
}> {
  const expiresAt =
    Math.floor(Date.now() / 1000) +
    SESSION_TTL_SECONDS

  const payload = {
    user_id: userId,
    username,
    session_version: sessionVersion,
    role,
    expires_at: expiresAt,
  }

  const payloadBytes = new TextEncoder().encode(
    JSON.stringify(payload),
  )

  const payloadEncoded =
    base64UrlEncode(payloadBytes)

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payloadEncoded),
  )

  return {
    token:
      `${payloadEncoded}.${base64UrlEncode(
        new Uint8Array(signature),
      )}`,
    expires_at: expiresAt,
    role,
  }
}

interface AdminUser {
  id: number
  username: string
  password_hash: string
  session_version: number
  role: string
}

function isAdmin(user: AdminUser): boolean {
  return user.role === 'admin'
}

function requireAdmin(user: AdminUser): Response | null {
  if (!isAdmin(user)) {
    return json(
      {
        detail: '管理者権限が必要です',
      },
      403,
    )
  }

  return null
}

async function verifySession(
  request: Request,
  env: Env,
): Promise<AdminUser | null> {
  const authorization =
    request.headers.get('Authorization') ?? ''

  if (!authorization.startsWith('Bearer ')) {
    return null
  }

  const token = authorization.slice(7).trim()
  const parts = token.split('.')

  if (parts.length !== 2) {
    return null
  }

  const [payloadEncoded, signatureEncoded] = parts

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(
        base64UrlDecode(payloadEncoded),
      ),
    ) as {
      user_id?: unknown
      username?: unknown
      session_version?: unknown
      role?: unknown
      expires_at?: unknown
    }

    if (
      typeof payload.user_id !== 'number' ||
      !Number.isInteger(payload.user_id) ||
      typeof payload.username !== 'string' ||
      typeof payload.session_version !== 'number' ||
      !Number.isInteger(payload.session_version) ||
      typeof payload.role !== 'string' ||
      !['admin', 'staff'].includes(payload.role) ||
      typeof payload.expires_at !== 'number' ||
      payload.expires_at <=
        Math.floor(Date.now() / 1000)
    ) {
      return null
    }

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(
        env.AUTH_SESSION_SECRET,
      ),
      {
        name: 'HMAC',
        hash: 'SHA-256',
      },
      false,
      ['verify'],
    )

    const validSignature =
      await crypto.subtle.verify(
        'HMAC',
        key,
        base64UrlDecode(signatureEncoded),
        new TextEncoder().encode(payloadEncoded),
      )

    if (!validSignature) {
      return null
    }

    const user = await env.DB
      .prepare(`
        SELECT
          id,
          username,
          password_hash,
          session_version,
          role
        FROM admin_users
        WHERE id = ?
        LIMIT 1
      `)
      .bind(payload.user_id)
      .first<AdminUser>()

    if (!user) {
      return null
    }

    if (
      user.username !== payload.username ||
      user.session_version !==
        payload.session_version ||
      user.role !== payload.role
    ) {
      return null
    }

    return user
  } catch {
    return null
  }
}

function getToolPayload(body: any) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''

  if (!name) {
    throw new Error('工具・機材名を入力してください')
  }

  const rawItems = Array.isArray(body.tool_items)
    ? body.tool_items
    : []

  if (rawItems.length === 0) {
    throw new Error('工具・機材個体を1つ以上登録してください')
  }

  const toolItems = rawItems.map((item: any) => {
    const id =
      item?.id === undefined ||
      item?.id === null ||
      item?.id === ''
        ? null
        : Number(item.id)

    const managementNumber =
      typeof item?.management_number === 'string'
        ? item.management_number.trim()
        : ''

    if (
      id !== null &&
      (!Number.isInteger(id) || id <= 0)
    ) {
      throw new Error('工具・機材個体IDが正しくありません')
    }

    if (!managementNumber) {
      throw new Error('管理番号を入力してください')
    }

    return {
      id,
      management_number: managementNumber,
    }
  })

  const managementNumbers = toolItems.map(
    (item: { management_number: string }) =>
      item.management_number,
  )

  if (
    new Set(managementNumbers).size !==
    managementNumbers.length
  ) {
    throw new Error('同じ管理番号を重複して登録することはできません')
  }

  const maxQuantityPerClass =
    body.max_quantity_per_class === null ||
    body.max_quantity_per_class === undefined ||
    body.max_quantity_per_class === ''
      ? null
      : Number(body.max_quantity_per_class)

  if (
    maxQuantityPerClass !== null &&
    (!Number.isInteger(maxQuantityPerClass) ||
      maxQuantityPerClass <= 0)
  ) {
    throw new Error(
      'クラスごとの最大貸出数は1以上の整数で指定してください',
    )
  }

    const loanDurationMinutes =
    body.loan_duration_minutes === null ||
    body.loan_duration_minutes === undefined ||
    body.loan_duration_minutes === ''
      ? null
      : Number(body.loan_duration_minutes)

  if (
    loanDurationMinutes !== null &&
    (!Number.isInteger(loanDurationMinutes) ||
      loanDurationMinutes <= 0)
  ) {
    throw new Error(
      '貸出時間は1分以上の整数で指定してください',
    )
  }

  const maxQuantityPerChief =
    body.max_quantity_per_chief === null ||
    body.max_quantity_per_chief === undefined ||
    body.max_quantity_per_chief === ''
      ? null
      : Number(body.max_quantity_per_chief)

  if (
    maxQuantityPerChief !== null &&
    (!Number.isInteger(maxQuantityPerChief) ||
      maxQuantityPerChief <= 0)
  ) {
    throw new Error(
      'チーフの最大貸出数は1以上の整数で指定してください',
    )
  }

  const loanDurationMinutesPerChief =
    body.loan_duration_minutes_per_chief === null ||
    body.loan_duration_minutes_per_chief === undefined ||
    body.loan_duration_minutes_per_chief === ''
      ? null
      : Number(body.loan_duration_minutes_per_chief)

  if (
    loanDurationMinutesPerChief !== null &&
    (!Number.isInteger(loanDurationMinutesPerChief) ||
      loanDurationMinutesPerChief <= 0)
  ) {
    throw new Error(
      'チーフの貸出時間は1分以上の整数で指定してください',
    )
  }

  const dueNoticeEnabled =
    body.due_notice_enabled === undefined
      ? true
      : Boolean(body.due_notice_enabled)

  const universalReturnEnabled =
    body.universal_return_enabled === undefined
      ? true
      : Boolean(body.universal_return_enabled)

  const universalReturnEnabledForChief =
    body.universal_return_enabled_for_chief === undefined
      ? true
      : Boolean(body.universal_return_enabled_for_chief)

  return {
    name,
    category: body.category ?? null,
    description: body.description ?? null,
    location: body.location ?? null,
    tool_items: toolItems,
    max_quantity_per_class: maxQuantityPerClass,
    loan_duration_minutes: loanDurationMinutes,
    max_quantity_per_chief: maxQuantityPerChief,
    loan_duration_minutes_per_chief:
      loanDurationMinutesPerChief,
    due_notice_enabled: dueNoticeEnabled ? 1 : 0,
    universal_return_enabled:
      universalReturnEnabled ? 1 : 0,
    universal_return_enabled_for_chief:
      universalReturnEnabledForChief ? 1 : 0,
  }
}

async function getTool(
  db: D1Database,
  toolId: number,
): Promise<Tool | null> {
  return await db
    .prepare(`
      SELECT
        tools.id,
        tools.name,
        tools.category,
        tools.description,
        tools.location,
        tools.max_quantity_per_class,
        tools.loan_duration_minutes,
        tools.max_quantity_per_chief,
        tools.loan_duration_minutes_per_chief,
        tools.due_notice_enabled,
        tools.universal_return_enabled,
        tools.universal_return_enabled_for_chief,
        tools.is_active,
        COUNT(tool_items.id) AS quantity,
        COALESCE(
          SUM(
            CASE
              WHEN tool_items.status = 'available' THEN 1
              ELSE 0
            END
          ),
          0
        ) AS available_quantity,
        tools.created_at,
        tools.updated_at
      FROM tools
      LEFT JOIN tool_items
        ON tool_items.tool_id = tools.id
        AND tool_items.management_number NOT LIKE 'DELETED-%'
      WHERE tools.id = ?
        AND tools.is_active = 1
      GROUP BY
        tools.id,
        tools.name,
        tools.category,
        tools.description,
        tools.location,
        tools.max_quantity_per_class,
        tools.loan_duration_minutes,
        tools.max_quantity_per_chief,
        tools.loan_duration_minutes_per_chief,
        tools.due_notice_enabled,
        tools.universal_return_enabled,
        tools.universal_return_enabled_for_chief,
        tools.is_active,
        tools.created_at,
        tools.updated_at
    `)
    .bind(toolId)
    .first<Tool>()
}

const NOTIFICATION_SCHEDULER_NAME = 'global'
const NOTIFICATION_RETRY_DELAY_MS = 15 * 1000
const NOTIFICATION_WINDOW_MS = 5 * 60 * 1000
const JST_DAY_MS = 24 * 60 * 60 * 1000

const parseJstDateTime = (value: string): number => {
  return new Date(
    `${value.replace(' ', 'T')}+09:00`,
  ).getTime()
}

async function scheduleNotificationAlarm(env: Env): Promise<void> {
  const id = env.NOTIFICATION_SCHEDULER.idFromName(
    NOTIFICATION_SCHEDULER_NAME,
  )
  const stub = env.NOTIFICATION_SCHEDULER.get(id)

  const response = await stub.fetch(
    'https://notification-scheduler/schedule',
  )

  if (!response.ok) {
    throw new Error(
      `NotificationScheduler /schedule failed: ${response.status}`,
    )
  }
}

export class NotificationScheduler extends DurableObject {
  private readonly env: Env
  private readonly ctx: DurableObjectState

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.ctx = ctx
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/schedule') {
      const alarmAt = await this.findNextAlarm()

      if (alarmAt === null) {
        this.ctx.storage.deleteAlarm()

        return Response.json({
          scheduled: false,
        })
      }

      const safeAlarmAt = Math.max(
        alarmAt,
        Date.now() + 1000,
      )

      this.ctx.storage.setAlarm(safeAlarmAt)

      console.log(
        `[Alarm] next notification alarm: ${new Date(safeAlarmAt).toISOString()}`,
      )

      return Response.json({
        scheduled: true,
        alarm_at: safeAlarmAt,
      })
    }

    return new Response('Not Found', {
      status: 404,
    })
  }

  async alarm(): Promise<void> {
    console.log('[Alarm] notification scheduler started')

    try {
      await Promise.all([
        sendDueNotices(this.env),
        sendUniversalReturnNotices(this.env),
        sendUniversalReturnOverdueNotices(this.env),
      ])
    } catch (error) {
      console.error(
        '[Alarm] notification processing failed',
        error,
      )
    } finally {
      try {
        const nextAlarm = await this.findNextAlarm()

        if (nextAlarm === null) {
          this.ctx.storage.deleteAlarm()
        } else {
          this.ctx.storage.setAlarm(
            Math.max(nextAlarm, Date.now() + 1000),
          )

          console.log(
            `[Alarm] next alarm scheduled: ${new Date(
              Math.max(nextAlarm, Date.now() + 1000),
            ).toISOString()}`,
          )
        }
      } catch (error) {
        console.error(
          '[Alarm] failed to schedule next alarm',
          error,
        )

        this.ctx.storage.setAlarm(
          Date.now() + NOTIFICATION_RETRY_DELAY_MS,
        )
      }
    }
  }

  private async findNextAlarm(): Promise<number | null> {
    const notificationSettings =
      await getNotificationSettings(this.env)

    if (notificationSettings.channel === 'none') {
      return null
    }

    const now = new Date()
    const nowMs = now.getTime()

    let nextAlarm: number | null = null

    const dueResult = await this.env.DB
      .prepare(`
        SELECT
          loans.due_at,
          loans.due_notice_sent_at,
          loans.due_at_notification_sent_at
        FROM loans
        INNER JOIN tools
          ON tools.id = loans.tool_id
        WHERE loans.status = 'borrowed'
          AND loans.due_at IS NOT NULL
          AND tools.due_notice_enabled = 1
          AND (
            loans.due_notice_sent_at IS NULL
            OR loans.due_at_notification_sent_at IS NULL
          )
          AND datetime(loans.due_at) >= datetime('now', '+9 hours', '-5 minutes')
        ORDER BY loans.due_at ASC
      `)
      .all<{
        due_at: string
        due_notice_sent_at: string | null
        due_at_notification_sent_at: string | null
      }>()

    for (const loan of dueResult.results) {
      const dueAtMs = parseJstDateTime(loan.due_at)

      if (loan.due_notice_sent_at === null) {
        const dueNoticeAtMs =
          dueAtMs - NOTIFICATION_WINDOW_MS

        const candidate =
          dueNoticeAtMs > nowMs
            ? dueNoticeAtMs
            : nowMs + NOTIFICATION_RETRY_DELAY_MS

        if (
          dueAtMs > nowMs ||
          dueAtMs >= nowMs - NOTIFICATION_WINDOW_MS
        ) {
          nextAlarm =
            nextAlarm === null
              ? candidate
              : Math.min(nextAlarm, candidate)
        }
      }

      if (loan.due_at_notification_sent_at === null) {
        const candidate =
          dueAtMs > nowMs
            ? dueAtMs
            : nowMs + NOTIFICATION_RETRY_DELAY_MS

        if (
          dueAtMs > nowMs ||
          dueAtMs >= nowMs - NOTIFICATION_WINDOW_MS
        ) {
          nextAlarm =
            nextAlarm === null
              ? candidate
              : Math.min(nextAlarm, candidate)
        }
      }
    }

    const returnTimeSources = [
      {
        type: 'class' as const,
        tableName: 'universal_return_times',
        toolFlag: 'universal_return_enabled',
        borrowerCondition: "borrowers.class_name != 'チーフ'",
      },
      {
        type: 'chief' as const,
        tableName: 'universal_return_times_chief',
        toolFlag: 'universal_return_enabled_for_chief',
        borrowerCondition: "borrowers.class_name = 'チーフ'",
      },
    ]

    const { date: jstDate } = getJstDateParts(now)

    for (const source of returnTimeSources) {
      const timesResult = await this.env.DB
        .prepare(`
          SELECT
            id,
            return_time
          FROM ${source.tableName}
          ORDER BY return_time ASC
        `)
        .all<{
          id: number
          return_time: string
        }>()

      for (const returnTime of timesResult.results) {
        const returnAt = new Date(
          `${jstDate}T${returnTime.return_time}:00+09:00`,
        )

        const scheduledAt = new Date(
          returnAt.getTime() - NOTIFICATION_WINDOW_MS,
        )

        if (
          nowMs >= scheduledAt.getTime() &&
          nowMs < returnAt.getTime()
        ) {
          const pendingResult = await this.env.DB
            .prepare(`
              SELECT 1 AS pending
              FROM loan_items
              INNER JOIN loans
                ON loans.id = loan_items.loan_id
              INNER JOIN tools
                ON tools.id = loans.tool_id
              INNER JOIN borrowers
                ON borrowers.id = loans.borrower_id
              WHERE loans.status = 'borrowed'
                AND loan_items.returned_at IS NULL
                AND tools.${source.toolFlag} = 1
                AND ${source.borrowerCondition}
                AND NOT EXISTS (
                  SELECT 1
                  FROM loan_return_notices
                  WHERE loan_return_notices.loan_id = loans.id
                    AND loan_return_notices.return_time_id = ?
                    AND loan_return_notices.return_time_type = ?
                    AND loan_return_notices.notice_date = ?
                )
              LIMIT 1
            `)
            .bind(
              returnTime.id,
              source.type,
              jstDate,
            )
            .first<{
              pending: number
            }>()

          if (pendingResult) {
            const candidate =
              nowMs + NOTIFICATION_RETRY_DELAY_MS

            nextAlarm =
              nextAlarm === null
                ? candidate
                : Math.min(nextAlarm, candidate)
          } else {
            const candidate =
              returnAt.getTime() + JST_DAY_MS -
              NOTIFICATION_WINDOW_MS

            nextAlarm =
              nextAlarm === null
                ? candidate
                : Math.min(nextAlarm, candidate)
          }

          continue
        }

        if (nowMs >= returnAt.getTime()) {
          const overdueResult = await this.env.DB
            .prepare(`
              SELECT 1 AS pending
              FROM loan_items
              INNER JOIN loans
                ON loans.id = loan_items.loan_id
              INNER JOIN tools
                ON tools.id = loans.tool_id
              INNER JOIN borrowers
                ON borrowers.id = loans.borrower_id
              LEFT JOIN loan_return_notices
                ON loan_return_notices.loan_id = loans.id
                AND loan_return_notices.return_time_id = ?
                AND loan_return_notices.return_time_type = ?
                AND loan_return_notices.notice_date = ?
              WHERE loans.status = 'borrowed'
                AND loan_items.returned_at IS NULL
                AND tools.${source.toolFlag} = 1
                AND ${source.borrowerCondition}
                AND (
                  loan_return_notices.id IS NULL
                  OR loan_return_notices.overdue_notified_at IS NULL
                )
              LIMIT 1
            `)
            .bind(
              returnTime.id,
              source.type,
              jstDate,
            )
            .first<{
              pending: number
            }>()

          if (overdueResult) {
            const candidate =
              nowMs + NOTIFICATION_RETRY_DELAY_MS

            nextAlarm =
              nextAlarm === null
                ? candidate
                : Math.min(nextAlarm, candidate)
          } else {
            const candidate =
              returnAt.getTime() + JST_DAY_MS -
              NOTIFICATION_WINDOW_MS

            nextAlarm =
              nextAlarm === null
                ? candidate
                : Math.min(nextAlarm, candidate)
          }

          continue
        }

        const candidate = scheduledAt.getTime()

        nextAlarm =
          nextAlarm === null
            ? candidate
            : Math.min(nextAlarm, candidate)
      }
    }

    return nextAlarm
  }
}



type NotificationChannel =
  | 'none'
  | 'discord'
  | 'line'

type LineDestinationType =
  | 'user'
  | 'group'
  | 'room'

interface NotificationSettings {
  channel: NotificationChannel
  discordWebhookUrl: string | null
  lineChannelAccessToken: string | null
  lineChannelSecret: string | null
  lineDestinationType: LineDestinationType | null
  lineDestinationId: string | null
}

interface NotificationSendResult {
  ok: boolean
  status: number
  errorBody?: string
  skipped?: boolean
}

async function getNotificationCryptoKey(
  env: Env,
): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      env.AUTH_SESSION_SECRET,
    ),
  )

  return crypto.subtle.importKey(
    'raw',
    digest,
    {
      name: 'AES-GCM',
    },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptNotificationSecret(
  env: Env,
  value: string,
): Promise<string> {
  const key =
    await getNotificationCryptoKey(env)

  const iv = crypto.getRandomValues(
    new Uint8Array(12),
  )

  const encrypted =
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      new TextEncoder().encode(value),
    )

  return `${bytesToHex(iv)}:${bytesToHex(
    new Uint8Array(encrypted),
  )}`
}

async function decryptNotificationSecret(
  env: Env,
  value: string | null,
): Promise<string | null> {
  if (!value) {
    return null
  }

  try {
    const separator = value.indexOf(':')

    if (separator <= 0) {
      return null
    }

    const iv = hexToBytes(
      value.slice(0, separator),
    )
    const encrypted = hexToBytes(
      value.slice(separator + 1),
    )

    const key =
      await getNotificationCryptoKey(env)

    const decrypted =
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv,
        },
        key,
        encrypted,
      )

    return new TextDecoder().decode(
      decrypted,
    )
  } catch (error) {
    console.error(
      '[Notification] failed to decrypt secret',
      error,
    )

    return null
  }
}

async function getNotificationSettings(
  env: Env,
): Promise<NotificationSettings> {
  const row = await env.DB
    .prepare(`
      SELECT
        channel,
        discord_webhook_encrypted,
        line_channel_access_token_encrypted,
        line_channel_secret_encrypted,
        line_destination_type,
        line_destination_id
      FROM notification_settings
      WHERE id = 1
      LIMIT 1
    `)
    .first<{
      channel: NotificationChannel
      discord_webhook_encrypted: string | null
      line_channel_access_token_encrypted: string | null
      line_channel_secret_encrypted: string | null
      line_destination_type:
        | LineDestinationType
        | null
      line_destination_id: string | null
    }>()

  if (!row) {
    return {
      channel: 'discord',
      discordWebhookUrl:
        env.DISCORD_WEBHOOK_URL || null,
      lineChannelAccessToken: null,
      lineChannelSecret: null,
      lineDestinationType: null,
      lineDestinationId: null,
    }
  }

  const discordWebhookUrl =
    await decryptNotificationSecret(
      env,
      row.discord_webhook_encrypted,
    )

  const lineChannelAccessToken =
    await decryptNotificationSecret(
      env,
      row.line_channel_access_token_encrypted,
    )

  const lineChannelSecret =
    await decryptNotificationSecret(
      env,
      row.line_channel_secret_encrypted,
    )

  return {
    channel: row.channel,
    discordWebhookUrl:
      discordWebhookUrl ??
      env.DISCORD_WEBHOOK_URL ??
      null,
    lineChannelAccessToken,
    lineChannelSecret,
    lineDestinationType:
      row.line_destination_type,
    lineDestinationId:
      row.line_destination_id,
  }
}


function uint8ArrayToBase64(
  bytes: Uint8Array,
): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

function base64ToUint8Array(
  value: string,
): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

function constantTimeEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.length !== right.length) {
    return false
  }

  let difference = 0

  for (let i = 0; i < left.length; i += 1) {
    difference |= left[i] ^ right[i]
  }

  return difference === 0
}

async function verifyLineWebhookSignature(
  body: string,
  signature: string,
  channelSecret: string,
): Promise<boolean> {
  try {
    const key =
      await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(
          channelSecret,
        ),
        {
          name: 'HMAC',
          hash: 'SHA-256',
        },
        false,
        ['sign'],
      )

    const expected =
      await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(body),
      )

    return constantTimeEqual(
      base64ToUint8Array(signature),
      new Uint8Array(expected),
    )
  } catch {
    return false
  }
}

interface LineProfileResponse {
  displayName?: string
}

interface LineGroupSummaryResponse {
  groupName?: string
}

async function getLineDestinationDisplayName(
  token: string,
  type: 'user' | 'group' | 'room',
  destinationId: string,
  sourceUserId: string | null,
): Promise<string | null> {
  try {
    if (type === 'group') {
      const response = await fetch(
        `https://api.line.me/v2/bot/group/${encodeURIComponent(
          destinationId,
        )}/summary`,
        {
          headers: {
            Authorization:
              `Bearer ${token}`,
          },
        },
      )

      if (response.ok) {
        const data =
          await response.json<LineGroupSummaryResponse>()

        if (data.groupName) {
          return data.groupName
        }
      }

      return `グループ（${destinationId.slice(
        0,
        8,
      )}…）`
    }

    if (type === 'user') {
      const response = await fetch(
        `https://api.line.me/v2/bot/profile/${encodeURIComponent(
          destinationId,
        )}`,
        {
          headers: {
            Authorization:
              `Bearer ${token}`,
          },
        },
      )

      if (response.ok) {
        const data =
          await response.json<LineProfileResponse>()

        if (data.displayName) {
          return data.displayName
        }
      }

      return `ユーザー（${destinationId.slice(
        0,
        8,
      )}…）`
    }

    if (sourceUserId) {
      const response = await fetch(
        `https://api.line.me/v2/bot/room/${encodeURIComponent(
          destinationId,
        )}/member/${encodeURIComponent(
          sourceUserId,
        )}`,
        {
          headers: {
            Authorization:
              `Bearer ${token}`,
          },
        },
      )

      if (response.ok) {
        const data =
          await response.json<LineProfileResponse>()

        if (data.displayName) {
          return `複数人トーク（${data.displayName}）`
        }
      }
    }

    return `複数人トーク（${destinationId.slice(
      0,
      8,
    )}…）`
  } catch {
    return null
  }
}

async function saveLineDestination(
  env: Env,
  type: 'user' | 'group' | 'room',
  destinationId: string,
  displayName: string | null,
): Promise<void> {
  const now = formatJstDateTime()

  await env.DB
    .prepare(`
      INSERT INTO line_notification_destinations (
        destination_type,
        destination_id,
        display_name,
        last_seen_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(destination_id)
      DO UPDATE SET
        destination_type = excluded.destination_type,
        display_name =
          COALESCE(
            excluded.display_name,
            line_notification_destinations.display_name
          ),
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
    `)
    .bind(
      type,
      destinationId,
      displayName,
      now,
      now,
      now,
    )
    .run()
}

async function handleLineWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await request.text()

  const signature =
    request.headers.get(
      'x-line-signature',
    )

  if (!signature) {
    return json(
      {
        detail: 'LINE署名がありません',
      },
      401,
    )
  }

  const settings =
    await getNotificationSettings(env)

  if (!settings.lineChannelSecret) {
    return json(
      {
        detail:
          'LINE Channel Secretが設定されていません',
      },
      503,
    )
  }

  const valid =
    await verifyLineWebhookSignature(
      body,
      signature,
      settings.lineChannelSecret,
    )

  if (!valid) {
    return json(
      {
        detail:
          'LINE webhookの署名が正しくありません',
      },
      401,
    )
  }

  let payload: any

  try {
    payload = JSON.parse(body)
  } catch {
    return json(
      {
        detail:
          'LINE webhookのJSONが正しくありません',
      },
      400,
    )
  }

  if (!Array.isArray(payload?.events)) {
    return json({
      ok: true,
    })
  }

  if (!settings.lineChannelAccessToken) {
    return json(
      {
        detail:
          'LINE Channel Access Tokenが設定されていません',
      },
      503,
    )
  }

  for (const event of payload.events) {
    const source =
      event?.source

    if (!source || typeof source.type !== 'string') {
      continue
    }

    let destinationType:
      | 'user'
      | 'group'
      | 'room'
      | null = null

    let destinationId: string | null = null

    if (
      source.type === 'user' &&
      typeof source.userId === 'string'
    ) {
      destinationType = 'user'
      destinationId = source.userId
    }

    if (
      source.type === 'group' &&
      typeof source.groupId === 'string'
    ) {
      destinationType = 'group'
      destinationId = source.groupId
    }

    if (
      source.type === 'room' &&
      typeof source.roomId === 'string'
    ) {
      destinationType = 'room'
      destinationId = source.roomId
    }

    if (
      !destinationType ||
      !destinationId
    ) {
      continue
    }

    const existing =
      await env.DB
        .prepare(`
          SELECT
            display_name
          FROM line_notification_destinations
          WHERE destination_id = ?
          LIMIT 1
        `)
        .bind(destinationId)
        .first<{
          display_name: string | null
        }>()

    let displayName =
      existing?.display_name ?? null

    if (!displayName) {
      displayName =
        await getLineDestinationDisplayName(
          settings.lineChannelAccessToken,
          destinationType,
          destinationId,
          typeof source.userId === 'string'
            ? source.userId
            : null,
        )
    }

    await saveLineDestination(
      env,
      destinationType,
      destinationId,
      displayName,
    )
  }

  return json({
    ok: true,
  })
}


async function sendConfiguredNotification(
  env: Env,
  message: string,
): Promise<NotificationSendResult> {
  try {
    const settings =
      await getNotificationSettings(env)

    if (settings.channel === 'none') {
      return {
        ok: true,
        status: 204,
        skipped: true,
      }
    }

    if (settings.channel === 'discord') {
      if (!settings.discordWebhookUrl) {
        return {
          ok: false,
          status: 400,
          errorBody:
            'Discord Webhook URLが設定されていません',
        }
      }

      const response = await fetch(
        settings.discordWebhookUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: message,
          }),
        },
      )

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          errorBody:
            await response.text(),
        }
      }

      return {
        ok: true,
        status: response.status,
      }
    }

    if (
      settings.channel === 'line'
    ) {
      if (
        !settings.lineChannelAccessToken ||
        !settings.lineDestinationType ||
        !settings.lineDestinationId
      ) {
        return {
          ok: false,
          status: 400,
          errorBody:
            'LINEの設定が不足しています',
        }
      }

      const response = await fetch(
        'https://api.line.me/v2/bot/message/push',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
            Authorization:
              `Bearer ${settings.lineChannelAccessToken}`,
          },
          body: JSON.stringify({
            to: settings.lineDestinationId,
            messages: [
              {
                type: 'text',
                text: message,
              },
            ],
          }),
        },
      )

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          errorBody:
            await response.text(),
        }
      }

      return {
        ok: true,
        status: response.status,
      }
    }

    return {
      ok: false,
      status: 400,
      errorBody:
        '通知先設定が不正です',
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      errorBody:
        error instanceof Error
          ? error.message
          : '通知送信に失敗しました',
    }
  }
}


async function sendDueNotices(env: Env): Promise<void> {
  console.log('[Notification] sendDueNotices started')

  const notificationSettings =
    await getNotificationSettings(env)

  if (notificationSettings.channel === 'none') {
    console.log(
      '[Notification] notifications are disabled',
    )
    return
  }

  const latestUniversalReturnTimeResult = await env.DB
    .prepare(`
      SELECT return_time
      FROM universal_return_times
      ORDER BY return_time DESC
      LIMIT 1
    `)
    .all<{
      return_time: string
    }>()

  let latestUniversalReturnFiveMinutesBefore: number | null = null

  if (latestUniversalReturnTimeResult.results.length > 0) {
    const now = new Date()
    const { date: noticeDate } = getJstDateParts(now)

    const latestUniversalReturnAt = new Date(
      `${noticeDate}T${latestUniversalReturnTimeResult.results[0].return_time}:00+09:00`,
    )

    latestUniversalReturnFiveMinutesBefore =
      latestUniversalReturnAt.getTime() - NOTIFICATION_WINDOW_MS

    console.log(
      `[Notification] individual notification cutoff: ${new Date(latestUniversalReturnFiveMinutesBefore).toISOString()}`,
    )
  }

  const result = await env.DB
    .prepare(`
      SELECT
        loans.id,
        loans.borrowed_at,
        loans.due_at,
        loans.due_notice_sent_at,
        loans.due_at_notification_sent_at,
        borrowers.class_name,
        borrowers.name AS borrower_name,
        tools.name AS tool_name,
        GROUP_CONCAT(
          DISTINCT tool_items.management_number
        ) AS management_numbers
      FROM loans
      INNER JOIN borrowers
        ON borrowers.id = loans.borrower_id
      INNER JOIN tools
        ON tools.id = loans.tool_id
      LEFT JOIN loan_items
        ON loan_items.loan_id = loans.id
      LEFT JOIN tool_items
        ON tool_items.id = loan_items.tool_item_id
      WHERE loans.status = 'borrowed'
        AND loans.due_at IS NOT NULL
        AND tools.due_notice_enabled = 1
        AND (
          (
            loans.due_notice_sent_at IS NULL
            AND datetime(loans.due_at) >= datetime('now', '+9 hours', '+4 minutes')
            AND datetime(loans.due_at) <= datetime('now', '+9 hours', '+6 minutes')
          )
          OR
          (
            loans.due_at_notification_sent_at IS NULL
            AND datetime(loans.due_at) <= datetime('now', '+9 hours')
            AND datetime(loans.due_at) >= datetime('now', '+9 hours', '-5 minutes')
          )
        )
      GROUP BY
        loans.id,
        loans.borrowed_at,
        loans.due_at,
        loans.due_notice_sent_at,
        loans.due_at_notification_sent_at,
        borrowers.class_name,
        borrowers.name,
        tools.name
      ORDER BY loans.due_at ASC
    `)
    .all<{
      id: number
      borrowed_at: string
      due_at: string
      due_notice_sent_at: string | null
      due_at_notification_sent_at: string | null
      class_name: string
      borrower_name: string
      tool_name: string
      management_numbers: string | null
    }>()

  console.log(
    `[Cron] sendDueNotices now: ${new Date().toISOString()}`,
  )

  console.log(`[Cron] target loans: ${result.results.length}`)

  for (const loan of result.results) {
    const now = Date.now()
    const dueAt = parseJstDateTime(loan.due_at)
    const fiveMinutesBefore = dueAt - NOTIFICATION_WINDOW_MS

    const isFiveMinuteNotice =
      loan.due_notice_sent_at === null &&
      now >= fiveMinutesBefore &&
      now < dueAt

    const isDeadlineNotice =
      loan.due_at_notification_sent_at === null &&
      now >= dueAt

    if (!isFiveMinuteNotice && !isDeadlineNotice) {
      continue
    }

    const individualNotificationAt = isDeadlineNotice
      ? dueAt
      : fiveMinutesBefore

    if (
      latestUniversalReturnFiveMinutesBefore !== null &&
      individualNotificationAt >
        latestUniversalReturnFiveMinutesBefore
    ) {
      console.log(
        `[Notification] skipping individual notification for loan ${loan.id} because it is after the universal return notification cutoff`,
      )
      continue
    }

    const message = isDeadlineNotice
      ? [
          '⚠️ 貸出期限のお知らせ',
          '',
          `クラス: ${loan.class_name}`,
          `氏名: ${loan.borrower_name}`,
          `工具・機材: ${loan.tool_name}`,
          `管理番号: ${loan.management_numbers ?? 'なし'}`,
          `返却期限: ${loan.due_at}`,
        ].join('\n')
      : [
          '🔔 貸出期限5分前のお知らせ',
          '',
          `クラス: ${loan.class_name}`,
          `氏名: ${loan.borrower_name}`,
          `工具・機材: ${loan.tool_name}`,
          `管理番号: ${loan.management_numbers ?? 'なし'}`,
          `返却期限: ${loan.due_at}`,
        ].join('\n')

    console.log(
      `[Cron] sending ${isDeadlineNotice ? 'deadline' : '5-minute'} notification for loan ${loan.id}`,
    )

    const notificationResult =
      await sendConfiguredNotification(
        env,
        message,
      )

    console.log(
      `[Notification] loan ${loan.id} response: ${notificationResult.status}`,
    )

    if (!notificationResult.ok) {
      console.error(
        `[Notification] loan ${loan.id} failed: ${notificationResult.status} ${notificationResult.errorBody ?? ''}`,
      )

      continue
    }

    if (notificationResult.skipped) {
      continue
    }

    if (isDeadlineNotice) {
      await env.DB
        .prepare(`
          UPDATE loans
          SET due_at_notification_sent_at = datetime('now', '+9 hours')
          WHERE id = ?
            AND due_at_notification_sent_at IS NULL
        `)
        .bind(loan.id)
        .run()

      console.log(
        `[Cron] due_at_notification_sent_at updated for loan ${loan.id}`,
      )
    } else {
      await env.DB
        .prepare(`
          UPDATE loans
          SET due_notice_sent_at = datetime('now', '+9 hours')
          WHERE id = ?
            AND due_notice_sent_at IS NULL
        `)
        .bind(loan.id)
        .run()

      console.log(
        `[Cron] due_notice_sent_at updated for loan ${loan.id}`,
      )
    }
  }

  console.log('[Cron] sendDueNotices finished')
}

async function sendUniversalReturnNotices(
  env: Env,
): Promise<void> {
  console.log(
    '[Notification] sendUniversalReturnNotices started',
  )

  const notificationSettings =
    await getNotificationSettings(env)

  if (notificationSettings.channel === 'none') {
    console.log(
      '[Notification] notifications are disabled',
    )
    return
  }

  const returnTimeSources = [
    {
      type: 'class' as const,
      tableName: 'universal_return_times',
      toolFlag: 'universal_return_enabled',
      borrowerCondition: "borrowers.class_name != 'チーフ'",
      label: 'クラス',
    },
    {
      type: 'chief' as const,
      tableName: 'universal_return_times_chief',
      toolFlag: 'universal_return_enabled_for_chief',
      borrowerCondition: "borrowers.class_name = 'チーフ'",
      label: 'チーフ',
    },
  ]

  const now = new Date()
  const { date: noticeDate } = getJstDateParts(now)

  for (const source of returnTimeSources) {
    const timesResult = await env.DB
      .prepare(`
        SELECT
          id,
          return_time
        FROM ${source.tableName}
        ORDER BY return_time ASC
      `)
      .all<{
        id: number
        return_time: string
      }>()

    console.log(
      `[Cron] ${source.type} universal return times: ${timesResult.results.length}`,
    )

    for (const returnTime of timesResult.results) {
      const returnAt = new Date(
        `${noticeDate}T${returnTime.return_time}:00+09:00`,
      )

      const scheduledAt = new Date(
        returnAt.getTime() - NOTIFICATION_WINDOW_MS,
      )

      if (now < scheduledAt || now >= returnAt) {
        continue
      }

      console.log(
        `[Cron] processing ${source.type} universal return time ${returnTime.return_time}`,
      )

      const result = await env.DB
        .prepare(`
          SELECT
            loans.id AS loan_id,
            borrowers.class_name,
            borrowers.name AS borrower_name,
            tools.name AS tool_name,
            COUNT(loan_items.id) AS unreturned_quantity,
            GROUP_CONCAT(
              DISTINCT tool_items.management_number
            ) AS management_numbers
          FROM loan_items
          INNER JOIN loans
            ON loans.id = loan_items.loan_id
          INNER JOIN borrowers
            ON borrowers.id = loans.borrower_id
          INNER JOIN tools
            ON tools.id = loans.tool_id
          LEFT JOIN tool_items
            ON tool_items.id = loan_items.tool_item_id
          WHERE loans.status = 'borrowed'
            AND loan_items.returned_at IS NULL
            AND tools.${source.toolFlag} = 1
            AND ${source.borrowerCondition}
            AND NOT EXISTS (
              SELECT 1
              FROM loan_return_notices
              WHERE loan_return_notices.loan_id = loans.id
                AND loan_return_notices.return_time_id = ?
                AND loan_return_notices.return_time_type = ?
                AND loan_return_notices.notice_date = ?
            )
          GROUP BY
            loans.id,
            borrowers.class_name,
            borrowers.name,
            tools.id,
            tools.name
          ORDER BY
            borrowers.class_name,
            tools.name,
            loans.id
        `)
        .bind(
          returnTime.id,
          source.type,
          noticeDate,
        )
        .all<{
          loan_id: number
          class_name: string
          borrower_name: string
          tool_name: string
          unreturned_quantity: number
          management_numbers: string | null
        }>()

      console.log(
        `[Cron] ${source.type} universal return target rows for ${returnTime.return_time}: ${result.results.length}`,
      )

      if (result.results.length === 0) {
        continue
      }

      const grouped = new Map<string, string[]>()

      for (const item of result.results) {
        if (!grouped.has(item.class_name)) {
          grouped.set(item.class_name, [])
        }

        grouped.get(item.class_name)!.push(
          [
            `・${item.tool_name} × ${item.unreturned_quantity}`,
            `  氏名: ${item.borrower_name}`,
            `  管理番号: ${item.management_numbers ?? 'なし'}`,
          ].join('\n'),
        )
      }

      const messageLines = [
        source.type === 'chief'
          ? '🔔 チーフ用全体返却時刻5分前のお知らせ'
          : '🔔 全体返却時刻5分前のお知らせ',
        '',
        '以下の工具・機材がまだ返却されていません。',
        '',
      ]

      for (const [className, tools] of grouped) {
        messageLines.push(className)
        messageLines.push(...tools)
        messageLines.push('')
      }

      const message = messageLines.join('\n').trim()

      console.log(
        `[Cron] sending ${source.type} universal return notification for ${returnTime.return_time}`,
      )

      const notificationResult =
        await sendConfiguredNotification(
          env,
          message,
        )

      console.log(
        `[Notification] ${source.type} universal return ${returnTime.return_time} response: ${notificationResult.status}`,
      )

      if (!notificationResult.ok) {
        console.error(
          `[Notification] ${source.type} universal return ${returnTime.return_time} failed: ${notificationResult.status} ${notificationResult.errorBody ?? ''}`,
        )
        continue
      }

      if (notificationResult.skipped) {
        continue
      }

      const loanIdsResult = await env.DB
        .prepare(`
          SELECT DISTINCT loans.id
          FROM loan_items
          INNER JOIN loans
            ON loans.id = loan_items.loan_id
          INNER JOIN borrowers
            ON borrowers.id = loans.borrower_id
          INNER JOIN tools
            ON tools.id = loans.tool_id
          WHERE loans.status = 'borrowed'
            AND loan_items.returned_at IS NULL
            AND tools.${source.toolFlag} = 1
            AND ${source.borrowerCondition}
            AND NOT EXISTS (
              SELECT 1
              FROM loan_return_notices
              WHERE loan_return_notices.loan_id = loans.id
                AND loan_return_notices.return_time_id = ?
                AND loan_return_notices.return_time_type = ?
                AND loan_return_notices.notice_date = ?
            )
        `)
        .bind(
          returnTime.id,
          source.type,
          noticeDate,
        )
        .all<{
          id: number
        }>()

      if (loanIdsResult.results.length === 0) {
        continue
      }

      const noticeStatements = loanIdsResult.results.map(
        (loan) =>
          env.DB
            .prepare(`
              INSERT OR IGNORE INTO loan_return_notices (
                loan_id,
                return_time_id,
                return_time_type,
                notice_date,
                notified_at
              )
              VALUES (?, ?, ?, ?, datetime('now', '+9 hours'))
            `)
            .bind(
              loan.id,
              returnTime.id,
              source.type,
              noticeDate,
            ),
      )

      await env.DB.batch(noticeStatements)

      console.log(
        `[Cron] ${source.type} universal return notice marked for ${loanIdsResult.results.length} loans at ${returnTime.return_time}`,
      )
    }
  }

  console.log('[Cron] sendUniversalReturnNotices finished')
}

async function sendUniversalReturnOverdueNotices(
  env: Env,
): Promise<void> {
  console.log(
    '[Notification] sendUniversalReturnOverdueNotices started',
  )

  const notificationSettings =
    await getNotificationSettings(env)

  if (notificationSettings.channel === 'none') {
    console.log(
      '[Notification] notifications are disabled',
    )
    return
  }

  const returnTimeSources = [
    {
      type: 'class' as const,
      tableName: 'universal_return_times',
      toolFlag: 'universal_return_enabled',
      borrowerCondition: "borrowers.class_name != 'チーフ'",
    },
    {
      type: 'chief' as const,
      tableName: 'universal_return_times_chief',
      toolFlag: 'universal_return_enabled_for_chief',
      borrowerCondition: "borrowers.class_name = 'チーフ'",
    },
  ]

  const now = new Date()
  const { date: noticeDate } = getJstDateParts(now)

  for (const source of returnTimeSources) {
    const timesResult = await env.DB
      .prepare(`
        SELECT
          id,
          return_time
        FROM ${source.tableName}
        ORDER BY return_time ASC
      `)
      .all<{
        id: number
        return_time: string
      }>()

    for (const returnTime of timesResult.results) {
      const returnAt = new Date(
        `${noticeDate}T${returnTime.return_time}:00+09:00`,
      )

      if (now < returnAt) {
        continue
      }

      const result = await env.DB
        .prepare(`
          SELECT
            loans.id AS loan_id,
            borrowers.class_name,
            borrowers.name AS borrower_name,
            tools.name AS tool_name,
            COUNT(loan_items.id) AS unreturned_quantity,
            GROUP_CONCAT(
              DISTINCT tool_items.management_number
            ) AS management_numbers
          FROM loan_items
          INNER JOIN loans
            ON loans.id = loan_items.loan_id
          INNER JOIN borrowers
            ON borrowers.id = loans.borrower_id
          INNER JOIN tools
            ON tools.id = loans.tool_id
          LEFT JOIN tool_items
            ON tool_items.id = loan_items.tool_item_id
          LEFT JOIN loan_return_notices
            ON loan_return_notices.loan_id = loans.id
            AND loan_return_notices.return_time_id = ?
            AND loan_return_notices.return_time_type = ?
            AND loan_return_notices.notice_date = ?
          WHERE loans.status = 'borrowed'
            AND loan_items.returned_at IS NULL
            AND tools.${source.toolFlag} = 1
            AND ${source.borrowerCondition}
            AND (
              loan_return_notices.id IS NULL
              OR loan_return_notices.overdue_notified_at IS NULL
            )
          GROUP BY
            loans.id,
            borrowers.class_name,
            borrowers.name,
            tools.id,
            tools.name
          ORDER BY
            borrowers.class_name,
            tools.name,
            loans.id
        `)
        .bind(
          returnTime.id,
          source.type,
          noticeDate,
        )
        .all<{
          loan_id: number
          class_name: string
          borrower_name: string
          tool_name: string
          unreturned_quantity: number
          management_numbers: string | null
        }>()

      console.log(
        `[Cron] ${source.type} universal return overdue target rows for ${returnTime.return_time}: ${result.results.length}`,
      )

      if (result.results.length === 0) {
        continue
      }

      const grouped = new Map<string, string[]>()

      for (const item of result.results) {
        if (!grouped.has(item.class_name)) {
          grouped.set(item.class_name, [])
        }

        grouped.get(item.class_name)!.push(
          [
            `・${item.tool_name} × ${item.unreturned_quantity}`,
            `  氏名: ${item.borrower_name}`,
            `  管理番号: ${item.management_numbers ?? 'なし'}`,
          ].join('\n'),
        )
      }

      const messageLines = [
        source.type === 'chief'
          ? '⚠️ チーフ用全体返却時刻を過ぎています'
          : '⚠️ 全体返却時刻を過ぎています',
        '',
        `全体返却時刻: ${returnTime.return_time}`,
        '',
        '以下の工具・機材がまだ返却されていません。',
        '',
      ]

      for (const [className, tools] of grouped) {
        messageLines.push(className)
        messageLines.push(...tools)
        messageLines.push('')
      }

      const message = messageLines.join('\n').trim()

      console.log(
        `[Cron] sending ${source.type} universal return overdue notification for ${returnTime.return_time}`,
      )

      const notificationResult =
        await sendConfiguredNotification(
          env,
          message,
        )

      console.log(
        `[Notification] ${source.type} universal return overdue ${returnTime.return_time} response: ${notificationResult.status}`,
      )

      if (!notificationResult.ok) {
        console.error(
          `[Notification] ${source.type} universal return overdue ${returnTime.return_time} failed: ${notificationResult.status} ${notificationResult.errorBody ?? ''}`,
        )
        continue
      }

      if (notificationResult.skipped) {
        continue
      }

      const loanIdsResult = await env.DB
        .prepare(`
          SELECT DISTINCT loans.id
          FROM loan_items
          INNER JOIN loans
            ON loans.id = loan_items.loan_id
          INNER JOIN borrowers
            ON borrowers.id = loans.borrower_id
          INNER JOIN tools
            ON tools.id = loans.tool_id
          LEFT JOIN loan_return_notices
            ON loan_return_notices.loan_id = loans.id
            AND loan_return_notices.return_time_id = ?
            AND loan_return_notices.return_time_type = ?
            AND loan_return_notices.notice_date = ?
          WHERE loans.status = 'borrowed'
            AND loan_items.returned_at IS NULL
            AND tools.${source.toolFlag} = 1
            AND ${source.borrowerCondition}
            AND (
              loan_return_notices.id IS NULL
              OR loan_return_notices.overdue_notified_at IS NULL
            )
        `)
        .bind(
          returnTime.id,
          source.type,
          noticeDate,
        )
        .all<{
          id: number
        }>()

      const statements = loanIdsResult.results.map(
        (loan) =>
          env.DB
            .prepare(`
              INSERT INTO loan_return_notices (
                loan_id,
                return_time_id,
                return_time_type,
                notice_date,
                notified_at,
                overdue_notified_at
              )
              VALUES (
                ?,
                ?,
                ?,
                ?,
                datetime('now', '+9 hours'),
                datetime('now', '+9 hours')
              )
              ON CONFLICT(loan_id, return_time_id, notice_date)
              DO UPDATE SET
                overdue_notified_at =
                  datetime('now', '+9 hours'),
                return_time_type = excluded.return_time_type
            `)
            .bind(
              loan.id,
              returnTime.id,
              source.type,
              noticeDate,
            ),
      )

      await env.DB.batch(statements)

      console.log(
        `[Cron] ${source.type} universal return overdue notice marked for ${loanIdsResult.results.length} loans at ${returnTime.return_time}`,
      )
    }
  }

  console.log(
    '[Cron] sendUniversalReturnOverdueNotices finished',
  )
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      scheduleNotificationAlarm(env).catch((error) => {
        console.error(
          '[Cron] failed to synchronize notification alarm',
          error,
        )
      }),
    )
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          },
        })
      }


      if (url.pathname === '/health' && request.method === 'GET') {
        return json({
          status: 'ok',
        })
      }

      if (
        url.pathname === '/auth/login' &&
        request.method === 'POST'
      ) {
        let body: any

        try {
          body = await request.json()
        } catch {
          return json(
            {
              detail: 'リクエストが正しくありません',
            },
            400,
          )
        }

        const username =
          typeof body?.username === 'string'
            ? body.username.trim()
            : ''

        const password =
          typeof body?.password === 'string'
            ? body.password
            : ''

        if (!username || !password) {
          return json(
            {
              detail: 'IDとパスワードを入力してください',
            },
            400,
          )
        }

        let user = await env.DB
          .prepare(`
            SELECT
              id,
              username,
              password_hash,
              session_version,
              role
            FROM admin_users
            WHERE username = ?
            LIMIT 1
          `)
          .bind(username)
          .first<AdminUser>()

        if (!user) {
          if (username !== env.AUTH_USERNAME) {
            return json(
              {
                detail:
                  'IDまたはパスワードが正しくありません',
              },
              401,
            )
          }

          const passwordValid =
            await verifyPassword(
              password,
              env.AUTH_PASSWORD_HASH,
            )

          if (!passwordValid) {
            return json(
              {
                detail:
                  'IDまたはパスワードが正しくありません',
              },
              401,
            )
          }

          await env.DB
            .prepare(`
              INSERT OR IGNORE INTO admin_users (
                username,
                password_hash,
                session_version,
                role
              )
              VALUES (?, ?, 1, 'admin')
            `)
            .bind(
              env.AUTH_USERNAME,
              env.AUTH_PASSWORD_HASH,
            )
            .run()

          user = await env.DB
            .prepare(`
              SELECT
                id,
                username,
                password_hash,
                session_version,
                role
              FROM admin_users
              WHERE username = ?
              LIMIT 1
            `)
            .bind(username)
            .first<AdminUser>()
        }

        if (!user) {
          return json(
            {
              detail:
                'ログイン情報の登録に失敗しました',
            },
            500,
          )
        }

        const passwordValid =
          await verifyPassword(
            password,
            user.password_hash,
          )

        if (!passwordValid) {
          return json(
            {
              detail:
                'IDまたはパスワードが正しくありません',
            },
            401,
          )
        }

        const session = await createSession(
          user.id,
          user.username,
          user.session_version,
          user.role,
          env.AUTH_SESSION_SECRET,
        )

        return json(session)
      }


      if (
        url.pathname === '/auth/users' &&
        request.method === 'GET'
      ) {
        const tokenUser =
          await verifySession(
            request,
            env,
          )

        if (!tokenUser) {
          return json(
            {
              detail: '認証が必要です',
            },
            401,
          )
        }

        const adminError = requireAdmin(tokenUser)
        if (adminError) {
          return adminError
        }

        const users =
          await env.DB
            .prepare(`
              SELECT
                id,
                username,
                role,
                created_at
              FROM admin_users
              ORDER BY id ASC
            `)
            .all<{
              id: number
              username: string
              role: string
              created_at: string
            }>()

        return json({
          users: users.results,
          current_user_id: tokenUser.id,
        })
      }


      if (
        url.pathname === '/auth/users' &&
        request.method === 'POST'
      ) {
        const tokenUser =
          await verifySession(
            request,
            env,
          )

        if (!tokenUser) {
          return json(
            {
              detail: '認証が必要です',
            },
            401,
          )
        }

        const adminError = requireAdmin(tokenUser)
        if (adminError) {
          return adminError
        }

        let body: any

        try {
          body = await request.json()
        } catch {
          return json(
            {
              detail:
                'リクエストが正しくありません',
            },
            400,
          )
        }

        const username =
          typeof body?.username === 'string'
            ? body.username.trim()
            : ''

        const password =
          typeof body?.password === 'string'
            ? body.password
            : ''

        const role =
          typeof body?.role === 'string'
            ? body.role
            : ''

        if (!username) {
          return json(
            {
              detail: 'IDを入力してください',
            },
            400,
          )
        }

        if (username.length > 50) {
          return json(
            {
              detail:
                'IDは50文字以内で入力してください',
            },
            400,
          )
        }

        if (!password) {
          return json(
            {
              detail:
                'パスワードを入力してください',
            },
            400,
          )
        }

        if (password.length < 8) {
          return json(
            {
              detail:
                'パスワードは8文字以上で入力してください',
            },
            400,
          )
        }

        if (!['admin', 'staff'].includes(role)) {
          return json(
            {
              detail:
                '権限はadminまたはstaffを指定してください',
            },
            400,
          )
        }

        const existingUser =
          await env.DB
            .prepare(`
              SELECT id
              FROM admin_users
              WHERE username = ?
              LIMIT 1
            `)
            .bind(username)
            .first<{ id: number }>()

        if (existingUser) {
          return json(
            {
              detail:
                'そのIDはすでに使用されています',
            },
            400,
          )
        }

        const passwordHash =
          await hashPassword(password)

        await env.DB
          .prepare(`
            INSERT INTO admin_users (
              username,
              password_hash,
              session_version,
              role
            )
            VALUES (?, ?, 1, ?)
          `)
          .bind(
            username,
            passwordHash,
            role,
          )
          .run()

        return json(
          {
            detail: 'アカウントを作成しました',
            username,
            role,
          },
          201,
        )
      }



      const authUserMatch =
        url.pathname.match(/^\/auth\/users\/(\d+)$/)

      if (
        authUserMatch &&
        request.method === 'PATCH'
      ) {
        const tokenUser =
          await verifySession(
            request,
            env,
          )

        if (!tokenUser) {
          return json(
            {
              detail: '認証が必要です',
            },
            401,
          )
        }

        const adminError = requireAdmin(tokenUser)
        if (adminError) {
          return adminError
        }

        const userId =
          Number(authUserMatch[1])

        if (!Number.isInteger(userId) || userId <= 0) {
          return json(
            {
              detail:
                'アカウントIDが正しくありません',
            },
            400,
          )
        }

        let body: any

        try {
          body = await request.json()
        } catch {
          return json(
            {
              detail:
                'リクエストが正しくありません',
            },
            400,
          )
        }

        const targetUser =
          await env.DB
            .prepare(`
              SELECT
                id,
                username,
                password_hash,
                session_version,
                role
              FROM admin_users
              WHERE id = ?
              LIMIT 1
            `)
            .bind(userId)
            .first<AdminUser>()

        if (!targetUser) {
          return json(
            {
              detail:
                'アカウントが見つかりません',
            },
            404,
          )
        }

        const usernameProvided =
          Object.prototype.hasOwnProperty.call(
            body ?? {},
            'username',
          )

        const passwordProvided =
          Object.prototype.hasOwnProperty.call(
            body ?? {},
            'password',
          )

        const roleProvided =
          Object.prototype.hasOwnProperty.call(
            body ?? {},
            'role',
          )

        const username =
          usernameProvided
            ? typeof body?.username === 'string'
              ? body.username.trim()
              : ''
            : targetUser.username

        const password =
          passwordProvided
            ? typeof body?.password === 'string'
              ? body.password
              : ''
            : ''

        const role =
          roleProvided
            ? typeof body?.role === 'string'
              ? body.role
              : ''
            : targetUser.role

        if (!username) {
          return json(
            {
              detail: 'IDを入力してください',
            },
            400,
          )
        }

        if (username.length > 50) {
          return json(
            {
              detail:
                'IDは50文字以内で入力してください',
            },
            400,
          )
        }

        if (!['admin', 'staff'].includes(role)) {
          return json(
            {
              detail:
                '権限はadminまたはstaffを指定してください',
            },
            400,
          )
        }

        if (
          passwordProvided &&
          password.length < 8
        ) {
          return json(
            {
              detail:
                'パスワードは8文字以上で入力してください',
            },
            400,
          )
        }

        if (username !== targetUser.username) {
          const existingUser =
            await env.DB
              .prepare(`
                SELECT id
                FROM admin_users
                WHERE username = ?
                  AND id != ?
                LIMIT 1
              `)
              .bind(
                username,
                userId,
              )
              .first<{ id: number }>()

          if (existingUser) {
            return json(
              {
                detail:
                  'そのIDはすでに使用されています',
              },
              400,
            )
          }
        }

        let passwordHash =
          targetUser.password_hash

        if (passwordProvided) {
          passwordHash =
            await hashPassword(password)
        }

        const sessionVersion =
          passwordProvided
            ? targetUser.session_version + 1
            : targetUser.session_version

        await env.DB
          .prepare(`
            UPDATE admin_users
            SET
              username = ?,
              password_hash = ?,
              session_version = ?,
              role = ?
            WHERE id = ?
          `)
          .bind(
            username,
            passwordHash,
            sessionVersion,
            role,
            userId,
          )
          .run()

        return json({
          detail:
            'アカウントを更新しました',
          id: userId,
          username,
          role,
        })
      }


      if (
        authUserMatch &&
        request.method === 'DELETE'
      ) {
        const tokenUser =
          await verifySession(
            request,
            env,
          )

        if (!tokenUser) {
          return json(
            {
              detail: '認証が必要です',
            },
            401,
          )
        }

        const adminError = requireAdmin(tokenUser)
        if (adminError) {
          return adminError
        }

        const userId =
          Number(authUserMatch[1])

        if (!Number.isInteger(userId) || userId <= 0) {
          return json(
            {
              detail:
                'アカウントIDが正しくありません',
            },
            400,
          )
        }

        if (userId === tokenUser.id) {
          return json(
            {
              detail:
                '現在ログインしているアカウントは削除できません',
            },
            400,
          )
        }

        const targetUser =
          await env.DB
            .prepare(`
              SELECT id
              FROM admin_users
              WHERE id = ?
              LIMIT 1
            `)
            .bind(userId)
            .first<{ id: number }>()

        if (!targetUser) {
          return json(
            {
              detail:
                'アカウントが見つかりません',
            },
            404,
          )
        }

        await env.DB
          .prepare(`
            DELETE FROM admin_users
            WHERE id = ?
          `)
          .bind(userId)
          .run()

        return json({
          detail:
            'アカウントを削除しました',
          id: userId,
        })
      }


      if (
        url.pathname === '/line/webhook' &&
        request.method === 'POST'
      ) {
        return await handleLineWebhook(
          request,
          env,
        )
      }


      const authenticated =
        await verifySession(
          request,
          env,
        )

      if (!authenticated) {
        const accept = request.headers.get('Accept') ?? ''

        if (
          request.method === 'GET' &&
          accept.includes('text/html')
        ) {
          return Response.redirect(
            'https://tool-rental.pages.dev/login',
            302,
          )
        }

        return json(
          {
            detail: '認証が必要です',
          },
          401,
        )
      }


      if (
        url.pathname === '/settings/notifications' &&
        request.method === 'GET'
      ) {
        const settings =
          await getNotificationSettings(env)

        return json({
          channel: settings.channel,
          discord_configured:
            !!settings.discordWebhookUrl,
          line_configured:
            !!settings.lineChannelAccessToken &&
            !!settings.lineDestinationType &&
            !!settings.lineDestinationId,
          line_destination_type:
            settings.lineDestinationType,
          line_destination_id:
            settings.lineDestinationId,
        })
      }


      if (
        url.pathname === '/settings/notifications/line-destinations' &&
        request.method === 'GET'
      ) {
        const result = await env.DB
          .prepare(`
            SELECT
              destination_type,
              destination_id,
              display_name,
              last_seen_at
            FROM line_notification_destinations
            ORDER BY last_seen_at DESC, id DESC
          `)
          .all<{
            destination_type:
              | 'user'
              | 'group'
              | 'room'
            destination_id: string
            display_name: string | null
            last_seen_at: string
          }>()

        return json({
          destinations: result.results,
        })
      }

      if (
        url.pathname === '/settings/notifications' &&
        request.method === 'PATCH'
      ) {
        let body: any

        try {
          body = await request.json()
        } catch {
          return json(
            {
              detail:
                'リクエストが正しくありません',
            },
            400,
          )
        }

        const channel =
          body?.channel === 'none' ||
          body?.channel === 'discord' ||
          body?.channel === 'line'
            ? body.channel
            : null

        if (!channel) {
          return json(
            {
              detail:
                '通知先が正しくありません',
            },
            400,
          )
        }

        const current =
          await getNotificationSettings(env)

        let discordWebhookUrl =
          current.discordWebhookUrl

        if (
          typeof body?.discord_webhook_url ===
          'string'
        ) {
          const value =
            body.discord_webhook_url.trim()

          if (value) {
            try {
              const webhookUrl =
                new URL(value)

              if (
                webhookUrl.protocol !==
                  'https:' ||
                ![
                  'discord.com',
                  'discordapp.com',
                ].includes(
                  webhookUrl.hostname,
                )
              ) {
                return json(
                  {
                    detail:
                      'Discord Webhook URLが正しくありません',
                  },
                  400,
                )
              }
            } catch {
              return json(
                {
                  detail:
                    'Discord Webhook URLが正しくありません',
                },
                400,
              )
            }

            discordWebhookUrl = value
          }
        }

        let lineChannelAccessToken =
          current.lineChannelAccessToken

        let lineChannelSecret =
          current.lineChannelSecret

        if (
          typeof body?.line_channel_secret ===
          'string'
        ) {
          const value =
            body.line_channel_secret.trim()

          if (value) {
            lineChannelSecret = value
          }
        }

        if (
          typeof body?.line_channel_access_token ===
          'string'
        ) {
          const value =
            body.line_channel_access_token.trim()

          if (value) {
            lineChannelAccessToken = value
          }
        }

        let lineDestinationType =
          current.lineDestinationType

        if (
          body?.line_destination_type ===
            'user' ||
          body?.line_destination_type ===
            'group' ||
          body?.line_destination_type ===
            'room'
        ) {
          lineDestinationType =
            body.line_destination_type
        }

        let lineDestinationId =
          current.lineDestinationId

        if (
          typeof body?.line_destination_id ===
          'string'
        ) {
          const value =
            body.line_destination_id.trim()

          if (value) {
            lineDestinationId = value
          }
        }

        if (
          channel === 'discord' &&
          !discordWebhookUrl
        ) {
          return json(
            {
              detail:
                'Discord Webhook URLを設定してください',
            },
            400,
          )
        }

        if (
          channel === 'line' &&
          (
            !lineChannelAccessToken ||
            !lineChannelSecret
          )
        ) {
          return json(
            {
              detail:
                'LINEのChannel Access Token、送信先種別、送信先IDを設定してください',
            },
            400,
          )
        }

        let encryptedDiscordWebhook:
          string | null = null

        let encryptedLineToken:
          string | null = null

        let encryptedLineSecret:
          string | null = null

        if (
          discordWebhookUrl &&
          typeof body?.discord_webhook_url ===
            'string' &&
          body.discord_webhook_url.trim()
        ) {
          encryptedDiscordWebhook =
            await encryptNotificationSecret(
              env,
              discordWebhookUrl,
            )
        } else {
          const row = await env.DB
            .prepare(`
              SELECT
                discord_webhook_encrypted
              FROM notification_settings
              WHERE id = 1
              LIMIT 1
            `)
            .first<{
              discord_webhook_encrypted:
                string | null
            }>()

          encryptedDiscordWebhook =
            row?.discord_webhook_encrypted ??
            null
        }

        if (
          lineChannelAccessToken &&
          typeof body?.line_channel_access_token ===
            'string' &&
          body.line_channel_access_token.trim()
        ) {
          encryptedLineToken =
            await encryptNotificationSecret(
              env,
              lineChannelAccessToken,
            )
        } else {
          const row = await env.DB
            .prepare(`
              SELECT
                line_channel_access_token_encrypted
              FROM notification_settings
              WHERE id = 1
              LIMIT 1
            `)
            .first<{
              line_channel_access_token_encrypted:
                string | null
            }>()

          encryptedLineToken =
            row?.line_channel_access_token_encrypted ??
            null
        }

        if (
          lineChannelSecret &&
          typeof body?.line_channel_secret ===
            'string' &&
          body.line_channel_secret.trim()
        ) {
          encryptedLineSecret =
            await encryptNotificationSecret(
              env,
              lineChannelSecret,
            )
        } else {
          const row = await env.DB
            .prepare(`
              SELECT
                line_channel_secret_encrypted
              FROM notification_settings
              WHERE id = 1
              LIMIT 1
            `)
            .first<{
              line_channel_secret_encrypted:
                string | null
            }>()

          encryptedLineSecret =
            row?.line_channel_secret_encrypted ??
            null
        }

        await env.DB
          .prepare(`
            UPDATE notification_settings
            SET
              channel = ?,
              discord_webhook_encrypted = ?,
              line_channel_access_token_encrypted = ?,
              line_channel_secret_encrypted = ?,
              line_destination_type = ?,
              line_destination_id = ?,
              updated_at = datetime('now', '+9 hours')
            WHERE id = 1
          `)
          .bind(
            channel,
            encryptedDiscordWebhook,
            encryptedLineToken,
            encryptedLineSecret,
            lineDestinationType,
            lineDestinationId,
          )
          .run()

        return json({
          detail: '通知設定を保存しました',
          channel,
          discord_configured:
            !!discordWebhookUrl,
          line_configured:
            !!lineChannelAccessToken &&
            !!lineDestinationType &&
            !!lineDestinationId,
          line_destination_type:
            lineDestinationType,
          line_destination_id:
            lineDestinationId,
        })
      }

      if (
        url.pathname === '/settings/notifications/test' &&
        request.method === 'POST'
      ) {
        const result =
          await sendConfiguredNotification(
            env,
            '🔔 工具・機材貸出管理のテスト通知です。',
          )

        if (!result.ok) {
          return json(
            {
              detail:
                result.errorBody ??
                'テスト通知に失敗しました',
            },
            400,
          )
        }

        if (result.skipped) {
          return json(
            {
              detail:
                '通知先が「通知しない」になっています',
            },
            400,
          )
        }

        return json({
          detail:
            'テスト通知を送信しました',
        })
      }

      if (
        url.pathname === '/auth/account' &&
        request.method === 'PATCH'
      ) {
        const adminError = requireAdmin(authenticated)
        if (adminError) {
          return adminError
        }

        let body: any

        try {
          body = await request.json()
        } catch {
          return json(
            {
              detail:
                'リクエストが正しくありません',
            },
            400,
          )
        }

        const currentPassword =
          typeof body?.current_password === 'string'
            ? body.current_password
            : ''

        const newUsername =
          body?.username === undefined
            ? undefined
            : typeof body.username === 'string'
              ? body.username.trim()
              : ''

        const newPassword =
          body?.new_password === undefined
            ? undefined
            : typeof body.new_password === 'string'
              ? body.new_password
              : ''

        if (!currentPassword) {
          return json(
            {
              detail:
                '現在のパスワードを入力してください',
            },
            400,
          )
        }

        if (
          newUsername === undefined &&
          newPassword === undefined
        ) {
          return json(
            {
              detail:
                '変更するIDまたはパスワードを指定してください',
            },
            400,
          )
        }

        if (
          newUsername !== undefined &&
          !newUsername
        ) {
          return json(
            {
              detail:
                '新しいIDを入力してください',
            },
            400,
          )
        }

        if (
          newUsername !== undefined &&
          newUsername.length > 50
        ) {
          return json(
            {
              detail:
                'IDは50文字以内で入力してください',
            },
            400,
          )
        }

        if (
          newPassword !== undefined &&
          newPassword.length < 8
        ) {
          return json(
            {
              detail:
                '新しいパスワードは8文字以上で入力してください',
            },
            400,
          )
        }

        const currentPasswordValid =
          await verifyPassword(
            currentPassword,
            authenticated.password_hash,
          )

        if (!currentPasswordValid) {
          return json(
            {
              detail:
                '現在のパスワードが正しくありません',
            },
            401,
          )
        }

        if (
          newUsername !== undefined &&
          newUsername !== authenticated.username
        ) {
          const existingUser = await env.DB
            .prepare(`
              SELECT id
              FROM admin_users
              WHERE username = ?
                AND id != ?
              LIMIT 1
            `)
            .bind(
              newUsername,
              authenticated.id,
            )
            .first<{ id: number }>()

          if (existingUser) {
            return json(
              {
                detail:
                  'そのIDはすでに使用されています',
              },
              400,
            )
          }
        }

        const usernameToSave =
          newUsername ?? authenticated.username

        const passwordHashToSave =
          newPassword !== undefined
            ? await hashPassword(newPassword)
            : authenticated.password_hash

        await env.DB
          .prepare(`
            UPDATE admin_users
            SET
              username = ?,
              password_hash = ?,
              session_version = session_version + 1,
              updated_at = datetime('now', '+9 hours')
            WHERE id = ?
          `)
          .bind(
            usernameToSave,
            passwordHashToSave,
            authenticated.id,
          )
          .run()

        return json({
          detail:
            'ID・パスワードを変更しました。再度ログインしてください',
          username: usernameToSave,
        })
      }


      if (
        url.pathname === '/auth/reauth' &&
        request.method === 'POST'
      ) {
        const authenticated = await verifySession(
          request,
          env,
        )

        if (!authenticated) {
          return json(
            {
              detail: '認証が必要です',
            },
            401,
          )
        }

        const adminError = requireAdmin(authenticated)
        if (adminError) {
          return adminError
        }

        let body: any

        try {
          body = await request.json()
        } catch {
          return json(
            {
              detail: 'リクエストが正しくありません',
            },
            400,
          )
        }

        const password =
          typeof body?.password === 'string'
            ? body.password
            : ''

        if (!password) {
          return json(
            {
              detail: 'パスワードを入力してください',
            },
            400,
          )
        }

        const passwordValid =
          await verifyPassword(
            password,
            authenticated.password_hash,
          )

        if (!passwordValid) {
          return json(
            {
              detail: 'パスワードが正しくありません',
            },
            401,
          )
        }

        return json({
          detail: '管理者認証に成功しました',
        })
      }


      if (
        url.pathname === '/reservations' &&
        request.method === 'GET'
      ) {
        const status =
          url.searchParams.get('status')?.trim() ||
          'waiting'

        const toolIdParam =
          url.searchParams.get('tool_id')?.trim()

        if (
          !['waiting', 'completed', 'cancelled'].includes(
            status,
          )
        ) {
          return json(
            {
              detail: '予約状態が正しくありません',
            },
            400,
          )
        }

        let query = `
          SELECT
            reservations.id,
            reservations.tool_id,
            reservations.class_name,
            reservations.name,
            reservations.quantity,
            reservations.status,
            reservations.created_at,
            reservations.updated_at,
            tools.name AS tool_name,
            (
              SELECT COUNT(*)
              FROM reservations AS previous_reservations
              WHERE previous_reservations.tool_id = reservations.tool_id
                AND previous_reservations.status = 'waiting'
                AND (
                  previous_reservations.created_at < reservations.created_at
                  OR (
                    previous_reservations.created_at = reservations.created_at
                    AND previous_reservations.id < reservations.id
                  )
                )
            ) + 1 AS queue_position
          FROM reservations
          INNER JOIN tools
            ON tools.id = reservations.tool_id
          WHERE reservations.status = ?
        `

        const bindings: (string | number)[] = [status]

        if (toolIdParam) {
          const toolId = Number(toolIdParam)

          if (!Number.isInteger(toolId) || toolId <= 0) {
            return json(
              {
                detail: '工具・機材IDが正しくありません',
              },
              400,
            )
          }

          query += ' AND reservations.tool_id = ?'
          bindings.push(toolId)
        }

        query += `
          ORDER BY
            reservations.tool_id ASC,
            reservations.created_at ASC,
            reservations.id ASC
        `

        const result = await env.DB
          .prepare(query)
          .bind(...bindings)
          .all<{
            id: number
            tool_id: number
            class_name: string
            name: string
            quantity: number
            status: string
            created_at: string
            updated_at: string
            tool_name: string
            queue_position: number
          }>()

        return json(result.results)
      }

      const reservationIdMatch =
        url.pathname.match(/^\/reservations\/(\d+)$/)

      if (
        reservationIdMatch &&
        request.method === 'GET'
      ) {
        const reservationId = Number(
          reservationIdMatch[1],
        )

        if (
          !Number.isInteger(reservationId) ||
          reservationId <= 0
        ) {
          return json(
            {
              detail: '予約IDが正しくありません',
            },
            400,
          )
        }

        const reservation = await env.DB
          .prepare(`
            SELECT
              reservations.id,
              reservations.tool_id,
              reservations.class_name,
              reservations.name,
              reservations.quantity,
              reservations.status,
              reservations.created_at,
              reservations.updated_at,
              tools.name AS tool_name
            FROM reservations
            INNER JOIN tools
              ON tools.id = reservations.tool_id
            WHERE reservations.id = ?
          `)
          .bind(reservationId)
          .first<{
            id: number
            tool_id: number
            class_name: string
            name: string
            quantity: number
            status: string
            created_at: string
            updated_at: string
            tool_name: string
          }>()

        if (!reservation) {
          return json(
            {
              detail: '予約が見つかりません',
            },
            404,
          )
        }

        return json(reservation)
      }

      if (
        url.pathname === '/reservations' &&
        request.method === 'POST'
      ) {
        const body = await request.json()

        const className =
          typeof body?.class_name === 'string'
            ? body.class_name.trim()
            : ''

        const name =
          typeof body?.name === 'string'
            ? body.name.trim()
            : ''

        const toolId = Number(body?.tool_id)
        const quantity = Number(body?.quantity)

        if (!className) {
          return json(
            {
              detail: 'クラスを入力してください',
            },
            400,
          )
        }

        if (!name) {
          return json(
            {
              detail: '氏名を入力してください',
            },
            400,
          )
        }

        if (
          !Number.isInteger(toolId) ||
          toolId <= 0
        ) {
          return json(
            {
              detail: '工具・機材を指定してください',
            },
            400,
          )
        }

        if (
          !Number.isInteger(quantity) ||
          quantity <= 0
        ) {
          return json(
            {
              detail: '予約数量は1個以上で指定してください',
            },
            400,
          )
        }

        const tool = await env.DB
          .prepare(`
            SELECT
              id,
              name,
              quantity,
              available_quantity,
              max_quantity_per_class,
              max_quantity_per_chief
            FROM tools
            WHERE id = ?
          `)
          .bind(toolId)
          .first<{
            id: number
            name: string
            quantity: number
            available_quantity: number
            max_quantity_per_class: number | null
            max_quantity_per_chief: number | null
          }>()

        if (!tool) {
          return json(
            {
              detail: '工具・機材が見つかりません',
            },
            404,
          )
        }

        if (tool.available_quantity > 0) {
          return json(
            {
              detail:
                'この工具・機材は現在貸出可能です。予約ではなく通常の貸出を行ってください。',
            },
            400,
          )
        }

        if (quantity > tool.quantity) {
          return json(
            {
              detail:
                `予約数量は総在庫数（${tool.quantity}個）以下にしてください`,
            },
            400,
          )
        }

        const isChief = className === 'チーフ'

        const maxQuantity = isChief
          ? tool.max_quantity_per_chief
          : tool.max_quantity_per_class

        if (
          maxQuantity !== null &&
          quantity > maxQuantity
        ) {
          return json(
            {
              detail: isChief
                ? `チーフの最大貸出数は${maxQuantity}個です`
                : `1クラスあたりの最大貸出数は${maxQuantity}個です`,
            },
            400,
          )
        }

        const duplicateReservation = await env.DB
          .prepare(`
            SELECT id
            FROM reservations
            WHERE tool_id = ?
              AND class_name = ?
              AND name = ?
              AND status = 'waiting'
            LIMIT 1
          `)
          .bind(toolId, className, name)
          .first<{
            id: number
          }>()

        if (duplicateReservation) {
          return json(
            {
              detail:
                '同じクラス・氏名ですでに予約されています',
            },
            400,
          )
        }

        const result = await env.DB
          .prepare(`
            INSERT INTO reservations (
              tool_id,
              class_name,
              name,
              quantity,
              status,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, 'waiting', datetime('now', '+9 hours'), datetime('now', '+9 hours'))
          `)
          .bind(
            toolId,
            className,
            name,
            quantity,
          )
          .run()

        const reservationId =
          Number(result.meta.last_row_id)

        const reservation = await env.DB
          .prepare(`
            SELECT
              reservations.id,
              reservations.tool_id,
              reservations.class_name,
              reservations.name,
              reservations.quantity,
              reservations.status,
              reservations.created_at,
              reservations.updated_at,
              tools.name AS tool_name
            FROM reservations
            INNER JOIN tools
              ON tools.id = reservations.tool_id
            WHERE reservations.id = ?
          `)
          .bind(reservationId)
          .first()

        return json(reservation, 201)
      }

      const reservationCancelMatch =
        url.pathname.match(
          /^\/reservations\/(\d+)\/cancel$/,
        )

      if (
        reservationCancelMatch &&
        request.method === 'POST'
      ) {
        const reservationId = Number(
          reservationCancelMatch[1],
        )

        if (
          !Number.isInteger(reservationId) ||
          reservationId <= 0
        ) {
          return json(
            {
              detail: '予約IDが正しくありません',
            },
            400,
          )
        }

        const result = await env.DB
          .prepare(`
            UPDATE reservations
            SET
              status = 'cancelled',
              updated_at = datetime('now', '+9 hours')
            WHERE id = ?
              AND status = 'waiting'
          `)
          .bind(reservationId)
          .run()

        if (result.meta.changes === 0) {
          return json(
            {
              detail:
                '予約が見つからないか、すでに処理されています',
            },
            404,
          )
        }

        return json({
          success: true,
        })
      }

      const reservationCompleteMatch =
        url.pathname.match(
          /^\/reservations\/(\d+)\/complete$/,
        )

      if (
        reservationCompleteMatch &&
        request.method === 'POST'
      ) {
        const reservationId = Number(
          reservationCompleteMatch[1],
        )

        if (
          !Number.isInteger(reservationId) ||
          reservationId <= 0
        ) {
          return json(
            {
              detail: '予約IDが正しくありません',
            },
            400,
          )
        }

        const result = await env.DB
          .prepare(`
            UPDATE reservations
            SET
              status = 'completed',
              updated_at = datetime('now', '+9 hours')
            WHERE id = ?
              AND status = 'waiting'
          `)
          .bind(reservationId)
          .run()

        if (result.meta.changes === 0) {
          return json(
            {
              detail:
                '予約が見つからないか、すでに処理されています',
            },
            404,
          )
        }

        return json({
          success: true,
        })
      }

      if (
        url.pathname === '/reservations/next' &&
        request.method === 'GET'
      ) {
        const toolId = Number(
          url.searchParams.get('tool_id'),
        )

        if (
          !Number.isInteger(toolId) ||
          toolId <= 0
        ) {
          return json(
            {
              detail: '工具・機材IDが正しくありません',
            },
            400,
          )
        }

        const tool = await env.DB
          .prepare(`
            SELECT
              id,
              available_quantity
            FROM tools
            WHERE id = ?
          `)
          .bind(toolId)
          .first<{
            id: number
            available_quantity: number
          }>()

        if (!tool) {
          return json(
            {
              detail: '工具・機材が見つかりません',
            },
            404,
          )
        }

        const reservation = await env.DB
          .prepare(`
            SELECT
              reservations.id,
              reservations.tool_id,
              reservations.class_name,
              reservations.name,
              reservations.quantity,
              reservations.status,
              reservations.created_at,
              reservations.updated_at,
              tools.name AS tool_name
            FROM reservations
            INNER JOIN tools
              ON tools.id = reservations.tool_id
            WHERE reservations.tool_id = ?
              AND reservations.status = 'waiting'
            ORDER BY
              reservations.created_at ASC,
              reservations.id ASC
            LIMIT 1
          `)
          .bind(toolId)
          .first()

        return json({
          reservation: reservation ?? null,
          available_quantity: tool.available_quantity,
        })
      }

      if (url.pathname === '/tools' && request.method === 'GET') {
        const result = await env.DB
          .prepare(`
            SELECT
              tools.id,
              tools.name,
              tools.category,
              tools.description,
              tools.location,
              tools.max_quantity_per_class,
              tools.loan_duration_minutes,
              tools.max_quantity_per_chief,
              tools.loan_duration_minutes_per_chief,
              tools.due_notice_enabled,
              tools.universal_return_enabled,
              tools.universal_return_enabled_for_chief,
              tools.display_order,
              tools.is_active,
              COUNT(tool_items.id) AS quantity,
              COALESCE(
                SUM(
                  CASE
                    WHEN tool_items.status = 'available' THEN 1
                    ELSE 0
                  END
                ),
                0
              ) AS available_quantity,
              tools.created_at,
              tools.updated_at
            FROM tools
            LEFT JOIN tool_items
              ON tool_items.tool_id = tools.id
              AND tool_items.management_number NOT LIKE 'DELETED-%'
            WHERE tools.is_active = 1
            GROUP BY
              tools.id,
              tools.name,
              tools.category,
              tools.description,
              tools.location,
              tools.max_quantity_per_class,
              tools.loan_duration_minutes,
              tools.max_quantity_per_chief,
              tools.loan_duration_minutes_per_chief,
              tools.due_notice_enabled,
              tools.universal_return_enabled,
              tools.universal_return_enabled_for_chief,
              tools.display_order,
              tools.is_active,
              tools.created_at,
              tools.updated_at
            ORDER BY tools.display_order ASC, tools.id ASC
          `)
          .all<Tool>()

        return json(result.results)
      }

      if (url.pathname === '/tools' && request.method === 'POST') {
        const adminError = requireAdmin(authenticated)
        if (adminError) {
          return adminError
        }

        const body = await request.json()
        const payload = getToolPayload(body)

        const result = await env.DB
          .prepare(`
            INSERT INTO tools (
              name,
              category,
              description,
              location,
              quantity,
              available_quantity,
              max_quantity_per_class,
              loan_duration_minutes,
              max_quantity_per_chief,
              loan_duration_minutes_per_chief,
              due_notice_enabled,
              universal_return_enabled,
              universal_return_enabled_for_chief,
              is_active,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', '+9 hours'), datetime('now', '+9 hours'))
          `)
          .bind(
            payload.name,
            payload.category,
            payload.description,
            payload.location,
            payload.max_quantity_per_class,
            payload.loan_duration_minutes,
            payload.max_quantity_per_chief,
            payload.loan_duration_minutes_per_chief,
            payload.due_notice_enabled,
            payload.universal_return_enabled,
            payload.universal_return_enabled_for_chief,
          )
          .run()

        const toolId = Number(result.meta.last_row_id)

        if (!toolId) {
          return json(
            {
              detail: '工具・機材の登録に失敗しました',
            },
            500,
          )
        }

        await env.DB
          .prepare(`
            UPDATE tools
            SET display_order = (
              SELECT COALESCE(MAX(display_order), -1) + 1
              FROM tools
              WHERE id != ?
            )
            WHERE id = ?
          `)
          .bind(toolId, toolId)
          .run()

        try {
          const statements = payload.tool_items.map(
            (item: {
              id: number | null
              management_number: string
            }) =>
              env.DB
                .prepare(`
                  INSERT INTO tool_items (
                    tool_id,
                    management_number,
                    status,
                    created_at,
                    updated_at
                  )
                  VALUES (?, ?, 'available', datetime('now', '+9 hours'), datetime('now', '+9 hours'))
                `)
                .bind(
                  toolId,
                  item.management_number,
                ),
          )

          await env.DB.batch(statements)

          const tool = await getTool(env.DB, toolId)

          return json(tool, 201)
        } catch (error) {
          await env.DB.batch([
            env.DB
              .prepare(
                'DELETE FROM tool_items WHERE tool_id = ?',
              )
              .bind(toolId),
            env.DB
              .prepare('DELETE FROM tools WHERE id = ?')
              .bind(toolId),
          ])

          throw error
        }
      }

      const toolItemsMatch = url.pathname.match(/^\/tools\/(\d+)\/items$/)

      if (toolItemsMatch && request.method === 'GET') {
        const toolId = Number(toolItemsMatch[1])

        if (!Number.isInteger(toolId) || toolId <= 0) {
          return json(
            {
              detail: '工具・機材IDが正しくありません',
            },
            400,
          )
        }

        const tool = await getTool(env.DB, toolId)

        if (!tool) {
          return json(
            {
              detail: '工具・機材が見つかりません',
            },
            404,
          )
        }

        const result = await env.DB
          .prepare(`
            SELECT
              tool_items.id,
              tool_items.tool_id,
              tool_items.management_number,
              tool_items.status,
              tool_items.created_at,
              tool_items.updated_at,
              EXISTS (
                SELECT 1
                FROM loan_items
                WHERE loan_items.tool_item_id = tool_items.id
              ) AS has_history
            FROM tool_items
            WHERE tool_items.tool_id = ?
              AND tool_items.management_number NOT LIKE 'DELETED-%'
            ORDER BY tool_items.management_number ASC
          `)
          .bind(toolId)
          .all<{
            id: number
            tool_id: number
            management_number: string
            status: string
            created_at: string
            updated_at: string
            has_history: number
          }>()

        return json(
          result.results.map(item => ({
            ...item,
            has_history: Boolean(item.has_history),
          })),
        )
      }

      if (url.pathname === '/loans' && request.method === 'POST') {
        const body = await request.json()

        const className =
          typeof body.class_name === 'string'
            ? body.class_name.trim()
            : ''

        const borrowerName =
          typeof body.name === 'string'
            ? body.name.trim()
            : ''

        const toolId = Number(body.tool_id)

        const rawToolItemIds = Array.isArray(body.tool_item_ids)
          ? body.tool_item_ids
          : []

        const toolItemIds = rawToolItemIds.map(Number)

        const rawReservationId =
          body.reservation_id

        const reservationId =
          rawReservationId === undefined ||
          rawReservationId === null ||
          rawReservationId === ''
            ? null
            : Number(rawReservationId)

        if (
          reservationId !== null &&
          (!Number.isInteger(reservationId) ||
            reservationId <= 0)
        ) {
          return json(
            {
              detail: '予約IDが正しくありません',
            },
            400,
          )
        }

        if (!className) {
          return json(
            {
              detail: 'クラスを入力してください',
            },
            400,
          )
        }

        if (!borrowerName) {
          return json(
            {
              detail: '氏名を入力してください',
            },
            400,
          )
        }

        if (!Number.isInteger(toolId) || toolId <= 0) {
          return json(
            {
              detail: '工具・機材IDを指定してください',
            },
            400,
          )
        }

        if (
          toolItemIds.length === 0 ||
          toolItemIds.some(
            (id: number) => !Number.isInteger(id) || id <= 0,
          )
        ) {
          return json(
            {
              detail: '貸し出す工具・機材個体を1つ以上選択してください',
            },
            400,
          )
        }

        const uniqueToolItemIds = [...new Set(toolItemIds)]

        if (uniqueToolItemIds.length !== toolItemIds.length) {
          return json(
            {
              detail: '同じ工具・機材個体を重複して選択することはできません',
            },
            400,
          )
        }

        const quantity = uniqueToolItemIds.length

        const tool = await getTool(env.DB, toolId)

        if (!tool) {
          return json(
            {
              detail: '工具・機材が見つかりません',
            },
            404,
          )
        }

        const firstReservation = await env.DB
          .prepare(`
            SELECT
              reservations.id,
              reservations.class_name,
              reservations.name,
              reservations.quantity
            FROM reservations
            WHERE reservations.tool_id = ?
              AND reservations.status = 'waiting'
            ORDER BY
              reservations.created_at ASC,
              reservations.id ASC
            LIMIT 1
          `)
          .bind(toolId)
          .first<{
            id: number
            class_name: string
            name: string
            quantity: number
          }>()

        if (firstReservation) {
          if (reservationId === null) {
            return json(
              {
                detail:
                  `この工具・機材には予約があります。` +
                  `${firstReservation.class_name} ${firstReservation.name} ` +
                  `さんの予約を先に処理してください`,
              },
              400,
            )
          }

          if (reservationId !== firstReservation.id) {
            return json(
              {
                detail:
                  '指定された予約は現在の先頭予約ではありません',
              },
              400,
            )
          }

          if (
            firstReservation.class_name !== className ||
            firstReservation.name !== borrowerName
          ) {
            return json(
              {
                detail:
                  '予約のクラス・氏名と貸出先が一致していません',
              },
              400,
            )
          }

          if (quantity !== firstReservation.quantity) {
            return json(
              {
                detail:
                  `予約数量は${firstReservation.quantity}個です。` +
                  `予約数量と同じ個数を貸し出してください`,
              },
              400,
            )
          }
        } else if (reservationId !== null) {
          return json(
            {
              detail: '指定された予約は待機中ではありません',
            },
            400,
          )
        }

        const isChief = className === 'チーフ'

        const maxQuantity = isChief
          ? tool.max_quantity_per_chief
          : tool.max_quantity_per_class

        if (maxQuantity !== null) {
          const classLoanResult = await env.DB
            .prepare(`
              SELECT
                COUNT(*) AS quantity
              FROM loan_items
              INNER JOIN loans
                ON loans.id = loan_items.loan_id
              INNER JOIN borrowers
                ON borrowers.id = loans.borrower_id
              WHERE loans.tool_id = ?
                AND borrowers.class_name = ?
                AND loans.status = 'borrowed'
                AND loan_items.returned_at IS NULL
            `)
            .bind(toolId, className)
            .first<{
              quantity: number
            }>()

          const currentClassQuantity =
            Number(classLoanResult?.quantity ?? 0)

          if (
            currentClassQuantity + quantity >
            maxQuantity
          ) {
            const targetName = isChief
              ? 'チーフ'
              : '1クラスあたり'

            return json(
              {
                detail:
                  `この工具・機材は${targetName}${maxQuantity}個までです。` +
                  `現在${currentClassQuantity}個貸出中のため、` +
                  `今回${quantity}個を貸し出すことはできません`,
              },
              400,
            )
          }
        }

        if (tool.available_quantity < quantity) {
          return json(
            {
              detail: `在庫が不足しています。現在貸出可能なのは${tool.available_quantity}個です`,
            },
            400,
          )
        }

        const placeholders = uniqueToolItemIds
          .map(() => '?')
          .join(', ')

        const toolItemsResult = await env.DB
          .prepare(`
            SELECT
              id,
              tool_id,
              management_number,
              status
            FROM tool_items
            WHERE id IN (${placeholders})
              AND tool_id = ?
          `)
          .bind(...uniqueToolItemIds, toolId)
          .all<{
            id: number
            tool_id: number
            management_number: string
            status: string
          }>()

        const toolItems = toolItemsResult.results

        if (toolItems.length !== uniqueToolItemIds.length) {
          return json(
            {
              detail: '指定された工具・機材個体の一部が見つかりません',
            },
            404,
          )
        }

        const unavailableItem = toolItems.find(
          item => item.status !== 'available',
        )

        if (unavailableItem) {
          return json(
            {
              detail: `工具・機材個体 ${unavailableItem.management_number} は現在貸出できません`,
            },
            400,
          )
        }

        let borrower = await env.DB
          .prepare(`
            SELECT
              id,
              class_name,
              name
            FROM borrowers
            WHERE class_name = ?
              AND name = ?
            LIMIT 1
          `)
          .bind(className, borrowerName)
          .first<{
            id: number
            class_name: string
            name: string
          }>()

        if (!borrower) {
          const borrowerResult = await env.DB
            .prepare(`
              INSERT INTO borrowers (
                class_name,
                name,
                created_at,
                updated_at
              )
              VALUES (?, ?, datetime('now', '+9 hours'), datetime('now', '+9 hours'))
            `)
            .bind(className, borrowerName)
            .run()

          const borrowerId = Number(borrowerResult.meta.last_row_id)

          if (!borrowerId) {
            return json(
              {
                detail: '借用者の登録に失敗しました',
              },
              500,
            )
          }

          borrower = {
            id: borrowerId,
            class_name: className,
            name: borrowerName,
          }
        }

        const loanDurationMinutes = isChief
          ? tool.loan_duration_minutes_per_chief
          : tool.loan_duration_minutes

        const universalReturnEnabled =
          isChief
            ? tool.universal_return_enabled_for_chief
            : tool.universal_return_enabled

        let dueAt: string | null = null

        if (universalReturnEnabled === 1) {
          dueAt = await getNextUniversalReturnDueAt(
            env.DB,
            new Date(),
            isChief,
          )
        } else if (loanDurationMinutes !== null) {
          dueAt = formatJstDateTime(
            new Date(
              Date.now() +
                loanDurationMinutes * 60 * 1000,
            ),
          )
        }

        const loanResult = await env.DB
          .prepare(`
            INSERT INTO loans (
              borrower_id,
              tool_id,
              quantity,
              borrowed_at,
              returned_quantity,
              status,
              due_at
            )
            VALUES (?, ?, ?, datetime('now', '+9 hours'), 0, 'borrowed', ?)
          `)
          .bind(
            borrower.id,
            toolId,
            quantity,
            dueAt,
          )
          .run()

        const loanId = Number(loanResult.meta.last_row_id)

        if (!loanId) {
          return json(
            {
              detail: '貸出記録の登録に失敗しました',
            },
            500,
          )
        }

        const statements: D1PreparedStatement[] = []

        statements.push(
          env.DB
            .prepare(`
              UPDATE tools
              SET
                available_quantity = available_quantity - ?,
                updated_at = datetime('now', '+9 hours')
              WHERE id = ?
                AND available_quantity >= ?
            `)
            .bind(quantity, toolId, quantity),
        )

        for (const toolItemId of uniqueToolItemIds) {
          statements.push(
            env.DB
              .prepare(`
                UPDATE tool_items
                SET
                  status = 'borrowed',
                  updated_at = datetime('now', '+9 hours')
                WHERE id = ?
                  AND tool_id = ?
                  AND status = 'available'
              `)
              .bind(toolItemId, toolId),
          )

          statements.push(
            env.DB
              .prepare(`
                INSERT INTO loan_items (
                  loan_id,
                  tool_item_id,
                  created_at
                )
                VALUES (?, ?, datetime('now', '+9 hours'))
              `)
              .bind(loanId, toolItemId),
          )
        }

        if (reservationId !== null) {
          statements.push(
            env.DB
              .prepare(`
                UPDATE reservations
                SET
                  status = 'completed',
                  updated_at = datetime('now', '+9 hours')
                WHERE id = ?
                  AND status = 'waiting'
              `)
              .bind(reservationId),
          )
        }

        await env.DB.batch(statements)

        const latestLoan = await env.DB
          .prepare(`
            SELECT
              loans.id,
              loans.borrower_id,
              loans.tool_id,
              loans.quantity,
              loans.returned_quantity,
              loans.borrowed_at,
              loans.due_at,
              loans.returned_at,
              loans.returned_by_id,
              loans.status,
              borrowers.class_name,
              borrowers.name AS borrower_name,
              tools.name AS tool_name
            FROM loans
            INNER JOIN borrowers
              ON borrowers.id = loans.borrower_id
            INNER JOIN tools
              ON tools.id = loans.tool_id
            WHERE loans.id = ?
          `)
          .bind(loanId)
          .first()

        const loanToolItems = await env.DB
          .prepare(`
            SELECT
              tool_items.id,
              tool_items.tool_id,
              tool_items.management_number,
              tool_items.status,
              loan_items.id AS loan_item_id,
              loan_items.returned_at
            FROM loan_items
            INNER JOIN tool_items
              ON tool_items.id = loan_items.tool_item_id
            WHERE loan_items.loan_id = ?
            ORDER BY tool_items.management_number ASC
          `)
          .bind(loanId)
          .all()

        await scheduleNotificationAlarm(env)

        return json(
          {
            ...latestLoan,
            tool_items: loanToolItems.results,
          },
          201,
        )
      }

if (url.pathname === '/loans/current' && request.method === 'GET') {
  const className = url.searchParams.get('class_name')?.trim()
  const toolId = url.searchParams.get('tool_id')?.trim()

  let query = [
    'SELECT',
    '  loans.id,',
    '  loans.borrower_id,',
    '  loans.tool_id,',
    '  loans.quantity,',
    '  loans.returned_quantity,',
    '  loans.borrowed_at,',
    '  loans.due_at,',
    '  loans.returned_at,',
    '  loans.returned_by_id,',
    '  loans.status,',
    '  borrowers.class_name,',
    '  borrowers.name AS borrower_name,',
    '  tools.name AS tool_name,',
    '  tools.universal_return_enabled,',
    '  tools.loan_duration_minutes,',
    '  tools.loan_duration_minutes_per_chief',
    'FROM loans',
    'INNER JOIN borrowers ON borrowers.id = loans.borrower_id',
    'INNER JOIN tools ON tools.id = loans.tool_id',
    "WHERE loans.status = 'borrowed'",
  ].join(' ')

  const bindings: string[] = []

  if (className) {
    query += ' AND borrowers.class_name = ?'
    bindings.push(className)
  }

  if (toolId) {
    query += ' AND loans.tool_id = ?'
    bindings.push(toolId)
  }

  query += ' ORDER BY loans.borrowed_at DESC'

  const result = await env.DB
    .prepare(query)
    .bind(...bindings)
    .all<{
      id: number
      borrower_id: number
      tool_id: number
      quantity: number
      returned_quantity: number
      borrowed_at: string
      due_at: string | null
      returned_at: string | null
      returned_by_id: number | null
      status: string
      class_name: string
      borrower_name: string
      tool_name: string
      universal_return_enabled: number
    }>()

  const loans = result.results

  const loansWithItems = await Promise.all(
    loans.map(async loan => {
      const itemsResult = await env.DB
        .prepare(`
          SELECT
            loan_items.id AS loan_item_id,
            loan_items.loan_id,
            loan_items.tool_item_id,
            loan_items.returned_at,
            tool_items.management_number,
            tool_items.status
          FROM loan_items
          INNER JOIN tool_items
            ON tool_items.id = loan_items.tool_item_id
          WHERE loan_items.loan_id = ?
            AND loan_items.returned_at IS NULL
          ORDER BY tool_items.management_number ASC
        `)
        .bind(loan.id)
        .all<{
          loan_item_id: number
          loan_id: number
          tool_item_id: number
          returned_at: string | null
          management_number: string
          status: string
        }>()

      return {
        ...loan,
        tool_items: itemsResult.results,
      }
    }),
  )

  return json(loansWithItems)
}

if (
        url.pathname === '/loans/history' &&
        request.method === 'DELETE'
      ) {
        const adminError = requireAdmin(authenticated)

        if (adminError) {
          return adminError
        }

        const countResult = await env.DB
          .prepare(`
            SELECT COUNT(*) AS count
            FROM loans
            WHERE status = 'returned'
          `)
          .first<{
            count: number
          }>()

        const deletedCount =
          Number(countResult?.count ?? 0)

        if (deletedCount === 0) {
          return json({
            detail:
              '削除対象の返却済み貸出履歴はありません',
            deleted_count: 0,
          })
        }

        await env.DB.batch([
          env.DB
            .prepare(`
              DELETE FROM loan_return_notices
              WHERE loan_id IN (
                SELECT id
                FROM loans
                WHERE status = 'returned'
              )
            `),
          env.DB
            .prepare(`
              DELETE FROM loan_items
              WHERE loan_id IN (
                SELECT id
                FROM loans
                WHERE status = 'returned'
              )
            `),
          env.DB
            .prepare(`
              DELETE FROM loans
              WHERE status = 'returned'
            `),
          env.DB
            .prepare(`
              DELETE FROM borrowers
              WHERE NOT EXISTS (
                SELECT 1
                FROM loans
                WHERE loans.borrower_id = borrowers.id
              )
              AND NOT EXISTS (
                SELECT 1
                FROM loans
                WHERE loans.returned_by_id = borrowers.id
              )
            `),
        ])

        const remainingLoans = await env.DB
          .prepare(`
            SELECT COUNT(*) AS count
            FROM loans
          `)
          .first<{
            count: number
          }>()

        if (Number(remainingLoans?.count ?? 0) === 0) {
          await env.DB.batch([
            env.DB.prepare(`
              DELETE FROM sqlite_sequence
              WHERE name = 'loans'
            `),
            env.DB.prepare(`
              DELETE FROM sqlite_sequence
              WHERE name = 'loan_items'
            `),
          ])
        }

        return json({
          detail:
            `${deletedCount}件の返却済み貸出履歴を削除しました`,
          deleted_count: deletedCount,
        })
      }


      if (
        url.pathname === '/loans/history/delete' &&
        request.method === 'POST'
      ) {
        const adminError = requireAdmin(authenticated)

        if (adminError) {
          return adminError
        }

        const body = await request.json()

        if (
          !body ||
          !Array.isArray(body.loan_item_ids) ||
          body.loan_item_ids.length === 0
        ) {
          return json(
            {
              detail:
                '削除する貸出履歴を選択してください',
            },
            400,
          )
        }

        const loanItemIds = body.loan_item_ids.map(
          (id: unknown) => Number(id),
        )

        if (
          loanItemIds.some(
            (id: number) =>
              !Number.isInteger(id) || id <= 0,
          )
        ) {
          return json(
            {
              detail:
                '貸出IDが正しくありません',
            },
            400,
          )
        }

        if (
          new Set(loanItemIds).size !==
          loanItemIds.length
        ) {
          return json(
            {
              detail:
                '同じ貸出IDが重複しています',
            },
            400,
          )
        }

        const placeholders =
          loanItemIds.map(() => '?').join(', ')

        const itemsResult = await env.DB
          .prepare(`
            SELECT
              id,
              loan_id,
              returned_at
            FROM loan_items
            WHERE id IN (${placeholders})
          `)
          .bind(...loanItemIds)
          .all<{
            id: number
            loan_id: number
            returned_at: string | null
          }>()

        if (
          itemsResult.results.length !==
          loanItemIds.length
        ) {
          return json(
            {
              detail:
                '存在しない貸出履歴が含まれています',
            },
            400,
          )
        }

        const unreturnedItems =
          itemsResult.results.filter(
            item => !item.returned_at,
          )

        if (unreturnedItems.length > 0) {
          return json(
            {
              detail:
                '貸出中の履歴は削除できません',
            },
            400,
          )
        }

        const loanDeleteCounts =
          new Map<number, number>()

        for (const item of itemsResult.results) {
          loanDeleteCounts.set(
            item.loan_id,
            (loanDeleteCounts.get(item.loan_id) ?? 0) +
              1,
          )
        }

        const statements = []

        statements.push(
          env.DB
            .prepare(`
              DELETE FROM loan_items
              WHERE id IN (${placeholders})
            `)
            .bind(...loanItemIds),
        )

        for (
          const [
            loanId,
            deleteCount,
          ] of loanDeleteCounts
        ) {
          statements.push(
            env.DB
              .prepare(`
                UPDATE loans
                SET
                  quantity = quantity - ?,
                  returned_quantity =
                    returned_quantity - ?
                WHERE id = ?
              `)
              .bind(
                deleteCount,
                deleteCount,
                loanId,
              ),
          )

          statements.push(
            env.DB
              .prepare(`
                DELETE FROM loan_return_notices
                WHERE loan_id = ?
                  AND NOT EXISTS (
                    SELECT 1
                    FROM loan_items
                    WHERE loan_items.loan_id = ?
                  )
              `)
              .bind(loanId, loanId),
          )

          statements.push(
            env.DB
              .prepare(`
                DELETE FROM loans
                WHERE id = ?
                  AND NOT EXISTS (
                    SELECT 1
                    FROM loan_items
                    WHERE loan_items.loan_id = ?
                  )
              `)
              .bind(loanId, loanId),
          )
        }

        statements.push(
          env.DB
            .prepare(`
              DELETE FROM borrowers
              WHERE NOT EXISTS (
                SELECT 1
                FROM loans
                WHERE loans.borrower_id = borrowers.id
              )
              AND NOT EXISTS (
                SELECT 1
                FROM loans
                WHERE loans.returned_by_id = borrowers.id
              )
              AND NOT EXISTS (
                SELECT 1
                FROM loan_items
                WHERE loan_items.returned_by_id = borrowers.id
              )
            `),
        )

        await env.DB.batch(statements)

        return json({
          detail:
            `${loanItemIds.length}件の貸出履歴を削除しました`,
          deleted_count: loanItemIds.length,
          deleted_loan_item_ids: loanItemIds,
        })
      }

      const historyDeleteMatch =
        url.pathname.match(/^\/loans\/history\/(\d+)$/)

      if (
        historyDeleteMatch &&
        request.method === 'DELETE'
      ) {
        const adminError = requireAdmin(authenticated)

        if (adminError) {
          return adminError
        }

        const loanItemId = Number(
          historyDeleteMatch[1],
        )

        if (
          !Number.isInteger(loanItemId) ||
          loanItemId <= 0
        ) {
          return json(
            {
              detail:
                '貸出IDが正しくありません',
            },
            400,
          )
        }

        const loanItem = await env.DB
          .prepare(`
            SELECT
              loan_items.id,
              loan_items.loan_id,
              loan_items.returned_at,
              loans.quantity,
              loans.returned_quantity
            FROM loan_items
            INNER JOIN loans
              ON loans.id = loan_items.loan_id
            WHERE loan_items.id = ?
          `)
          .bind(loanItemId)
          .first<{
            id: number
            loan_id: number
            returned_at: string | null
            quantity: number
            returned_quantity: number
          }>()

        if (!loanItem) {
          return json(
            {
              detail:
                '指定された貸出履歴が見つかりません',
            },
            404,
          )
        }

        if (!loanItem.returned_at) {
          return json(
            {
              detail:
                '貸出中の履歴は削除できません',
            },
            400,
          )
        }

        const remainingItems = await env.DB
          .prepare(`
            SELECT COUNT(*) AS count
            FROM loan_items
            WHERE loan_id = ?
              AND id != ?
          `)
          .bind(
            loanItem.loan_id,
            loanItemId,
          )
          .first<{
            count: number
          }>()

        const remainingCount =
          Number(remainingItems?.count ?? 0)

        if (remainingCount === 0) {
          await env.DB.batch([
            env.DB
              .prepare(`
                DELETE FROM loan_return_notices
                WHERE loan_id = ?
              `)
              .bind(loanItem.loan_id),

            env.DB
              .prepare(`
                DELETE FROM loan_items
                WHERE id = ?
              `)
              .bind(loanItemId),

            env.DB
              .prepare(`
                DELETE FROM loans
                WHERE id = ?
              `)
              .bind(loanItem.loan_id),
          ])
        } else {
          await env.DB.batch([
            env.DB
              .prepare(`
                DELETE FROM loan_items
                WHERE id = ?
              `)
              .bind(loanItemId),

            env.DB
              .prepare(`
                UPDATE loans
                SET
                  quantity = MAX(quantity - 1, 0),
                  returned_quantity =
                    MAX(returned_quantity - 1, 0)
                WHERE id = ?
              `)
              .bind(loanItem.loan_id),
          ])
        }

        await env.DB.batch([
          env.DB
            .prepare(`
              DELETE FROM borrowers
              WHERE NOT EXISTS (
                SELECT 1
                FROM loans
                WHERE loans.borrower_id = borrowers.id
              )
              AND NOT EXISTS (
                SELECT 1
                FROM loans
                WHERE loans.returned_by_id = borrowers.id
              )
              AND NOT EXISTS (
                SELECT 1
                FROM loan_items
                WHERE loan_items.returned_by_id = borrowers.id
              )
            `),
        ])

        return json({
          detail:
            `貸出ID ${loanItemId} の履歴を削除しました`,
          deleted_loan_item_id: loanItemId,
        })
      }

if (url.pathname === '/loans/history' && request.method === 'GET') {
          const className = url.searchParams.get('class_name')?.trim()
          const status = url.searchParams.get('status')?.trim()

          let query = `
            SELECT
              loan_items.id AS loan_item_id,
              loan_items.loan_id,
              loan_items.tool_item_id,
              loan_items.returned_at AS item_returned_at,

              loans.borrower_id,
              loans.tool_id,
              loans.borrowed_at,
              loans.due_at,
              loan_items.overdue_seconds,
              loan_items.returned_by_id,

              borrowers.class_name,
              borrowers.name AS borrower_name,

              returned_borrowers.class_name AS returned_by_class_name,
              returned_borrowers.name AS returned_by_name,

              tools.name AS tool_name,
              CASE
                WHEN tool_items.management_number LIKE 'DELETED-%'
                THEN substr(
                  tool_items.management_number,
                  length('DELETED-' || tool_items.id || '-') + 1
                )
                ELSE tool_items.management_number
              END AS management_number

            FROM loan_items

            INNER JOIN loans
              ON loans.id = loan_items.loan_id

            INNER JOIN borrowers
              ON borrowers.id = loans.borrower_id

            INNER JOIN tools
              ON tools.id = loans.tool_id

            INNER JOIN tool_items
              ON tool_items.id = loan_items.tool_item_id

            LEFT JOIN borrowers AS returned_borrowers
              ON returned_borrowers.id = loan_items.returned_by_id
          `

          const conditions: string[] = []
          const bindings: string[] = []

          if (className) {
            conditions.push('borrowers.class_name = ?')
            bindings.push(className)
          }

          if (status === 'borrowed') {
            conditions.push('loan_items.returned_at IS NULL')
          } else if (status === 'returned') {
            conditions.push('loan_items.returned_at IS NOT NULL')
          }

          if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`
          }

          query += `
            ORDER BY
              loans.borrowed_at DESC,
              loan_items.id DESC
          `

          const result = await env.DB
            .prepare(query)
            .bind(...bindings)
            .all()

          const history = result.results.map((item: any) => ({
            ...item,
            returned_at: item.item_returned_at,
            status:
              item.item_returned_at !== null
                ? 'returned'
                : 'borrowed',
            quantity: 1,
          }))

          return json(history)
        }

        // 貸出延長
        // 管理者権限は不要。認証済みユーザーが実行可能。
        const loanExtendMatch =
          url.pathname.match(
            /^\/loans\/(\d+)\/extend\/(\d+)$/,
          )

        if (
          loanExtendMatch &&
          request.method === 'POST'
        ) {
          const loanId = Number(loanExtendMatch[1])
          const toolItemId = Number(loanExtendMatch[2])

          if (
            !Number.isInteger(loanId) ||
            loanId <= 0 ||
            !Number.isInteger(toolItemId) ||
            toolItemId <= 0
          ) {
            return json(
              {
                detail: '貸出IDが正しくありません',
              },
              400,
            )
          }

          let body: any

          try {
            body = await request.json()
          } catch {
            return json(
              {
                detail: 'リクエストが正しくありません',
              },
              400,
            )
          }

          const borrowerName =
            typeof body.name === 'string'
              ? body.name.trim()
              : ''

          if (!borrowerName) {
            return json(
              {
                detail: '延長する方の氏名を入力してください',
              },
              400,
            )
          }

          const loanResult = await env.DB
            .prepare(`
              SELECT
                loans.id,
                loans.borrower_id,
                loans.tool_id,
                loans.quantity,
                loans.borrowed_at,
                loans.due_at,
                loans.returned_quantity,
                loans.status,
                borrowers.class_name,
                borrowers.name AS borrower_name,
                tools.name AS tool_name,
                tools.loan_duration_minutes,
                tools.loan_duration_minutes_per_chief
              FROM loans
              INNER JOIN borrowers
                ON borrowers.id = loans.borrower_id
              INNER JOIN tools
                ON tools.id = loans.tool_id
              WHERE loans.id = ?
                AND loans.status = 'borrowed'
              LIMIT 1
            `)
            .bind(loanId)
            .first<{
              id: number
              borrower_id: number
              tool_id: number
              quantity: number
              borrowed_at: string
              due_at: string | null
              returned_quantity: number
              status: string
              class_name: string
              borrower_name: string
              tool_name: string
              loan_duration_minutes: number | null
              loan_duration_minutes_per_chief: number | null
            }>()

          if (!loanResult) {
            return json(
              {
                detail: '現在貸出中の貸出情報が見つかりません',
              },
              404,
            )
          }

          const isChief = loanResult.class_name === 'チーフ'

          const loanDurationMinutes = isChief
            ? loanResult.loan_duration_minutes_per_chief
            : loanResult.loan_duration_minutes

          if (loanDurationMinutes === null) {
            return json(
              {
                detail:
                  'この工具・機材には個別の貸出時間制限が設定されていないため、延長できません',
              },
              400,
            )
          }

          const loanItemsResult = await env.DB
            .prepare(`
              SELECT
                loan_items.id AS loan_item_id,
                loan_items.tool_item_id,
                loan_items.returned_at,
                tool_items.management_number,
                tool_items.status AS tool_item_status
              FROM loan_items
              INNER JOIN tool_items
                ON tool_items.id = loan_items.tool_item_id
              WHERE loan_items.loan_id = ?
                AND loan_items.tool_item_id = ?
                AND loan_items.returned_at IS NULL
              ORDER BY tool_items.management_number ASC
            `)
            .bind(loanId, toolItemId)
            .all<{
              loan_item_id: number
              tool_item_id: number
              returned_at: string | null
              management_number: string
              tool_item_status: string
            }>()

          const loanItems = loanItemsResult.results

          if (loanItems.length === 0) {
            return json(
              {
                detail: '延長できる貸出個体がありません',
              },
              400,
            )
          }

          const unavailableItem = loanItems.find(
            item => item.tool_item_status !== 'borrowed',
          )

          if (unavailableItem) {
            return json(
              {
                detail:
                  `${unavailableItem.management_number} は現在の貸出状態ではありません`,
              },
              400,
            )
          }

          let borrower = await env.DB
            .prepare(`
              SELECT
                id,
                class_name,
                name
              FROM borrowers
              WHERE class_name = ?
                AND name = ?
              LIMIT 1
            `)
            .bind(
              loanResult.class_name,
              borrowerName,
            )
            .first<{
              id: number
              class_name: string
              name: string
            }>()

          if (!borrower) {
            const borrowerResult = await env.DB
              .prepare(`
                INSERT INTO borrowers (
                  class_name,
                  name,
                  created_at,
                  updated_at
                )
                VALUES (
                  ?,
                  ?,
                  datetime('now', '+9 hours'),
                  datetime('now', '+9 hours')
                )
              `)
              .bind(
                loanResult.class_name,
                borrowerName,
              )
              .run()

            const borrowerId =
              Number(borrowerResult.meta.last_row_id)

            if (!borrowerId) {
              return json(
                {
                  detail:
                    '延長する借用者の登録に失敗しました',
                },
                500,
              )
            }

            borrower = {
              id: borrowerId,
              class_name: loanResult.class_name,
              name: borrowerName,
            }
          }

          const dueAt = formatJstDateTime(
            new Date(
              Date.now() +
                loanDurationMinutes * 60 * 1000,
            ),
          )

          const newLoanResult = await env.DB
            .prepare(`
              INSERT INTO loans (
                borrower_id,
                tool_id,
                quantity,
                borrowed_at,
                returned_quantity,
                status,
                due_at
              )
              VALUES (
                ?,
                ?,
                ?,
                datetime('now', '+9 hours'),
                0,
                'borrowed',
                ?
              )
            `)
            .bind(
              borrower.id,
              loanResult.tool_id,
              loanItems.length,
              dueAt,
            )
            .run()

          const newLoanId =
            Number(newLoanResult.meta.last_row_id)

          if (!newLoanId) {
            return json(
              {
                detail:
                  '延長後の貸出記録の登録に失敗しました',
              },
              500,
            )
          }

          const statements: D1PreparedStatement[] = []

          for (const item of loanItems) {
            statements.push(
              env.DB
                .prepare(`
                  UPDATE loan_items
                  SET
                    returned_at =
                      datetime('now', '+9 hours'),
                    returned_by_id = ?,
                    overdue_seconds =
                      CASE
                        WHEN ? IS NOT NULL
                          AND datetime('now', '+9 hours')
                            > datetime(?)
                        THEN
                          unixepoch(
                            datetime('now', '+9 hours')
                          )
                          - unixepoch(?)
                        ELSE 0
                      END
                  WHERE id = ?
                    AND returned_at IS NULL
                `)
                .bind(
                  borrower.id,
                  loanResult.due_at,
                  loanResult.due_at,
                  loanResult.due_at,
                  item.loan_item_id,
                ),
            )

            statements.push(
              env.DB
                .prepare(`
                  UPDATE tool_items
                  SET
                    status = 'borrowed',
                    updated_at =
                      datetime('now', '+9 hours')
                  WHERE id = ?
                    AND status = 'borrowed'
                `)
                .bind(item.tool_item_id),
            )

            statements.push(
              env.DB
                .prepare(`
                  INSERT INTO loan_items (
                    loan_id,
                    tool_item_id,
                    created_at
                  )
                  VALUES (
                    ?,
                    ?,
                    datetime('now', '+9 hours')
                  )
                `)
                .bind(
                  newLoanId,
                  item.tool_item_id,
                ),
            )
          }

          statements.push(
            env.DB
              .prepare(`
                UPDATE loans
                SET
                  returned_quantity = returned_quantity + 1,
                  status = CASE
                    WHEN returned_quantity + 1 >= quantity
                    THEN 'returned'
                    ELSE 'borrowed'
                  END,
                  returned_at = CASE
                    WHEN returned_quantity + 1 >= quantity
                    THEN datetime('now', '+9 hours')
                    ELSE NULL
                  END
                WHERE id = ?
                  AND status = 'borrowed'
                  AND returned_quantity < quantity
              `)
              .bind(loanId),
          )

          await env.DB.batch(statements)

          await scheduleNotificationAlarm(env)

          return json(
            {
              detail: '貸出を延長しました',
              previous_loan_id: loanId,
              loan_id: newLoanId,
              class_name: loanResult.class_name,
              borrower_name: borrower.name,
              tool_name: loanResult.tool_name,
              due_at: dueAt,
              management_numbers:
                loanItems.map(
                  item => item.management_number,
                ),
            },
          )
        }

        if (url.pathname === '/loans/return' && request.method === 'POST') {
          const body = await request.json()

          const rawLoanItemIds = Array.isArray(body.loan_item_ids)
            ? body.loan_item_ids
            : body.loan_item_id !== undefined
              ? [body.loan_item_id]
              : []

          const loanItemIds = rawLoanItemIds.map(Number)

          if (
            loanItemIds.length === 0 ||
            loanItemIds.some(
              (id: number) => !Number.isInteger(id) || id <= 0,
            )
          ) {
            return json(
              {
                detail: '返却する個体を指定してください',
              },
              400,
            )
          }

          const uniqueLoanItemIds = [...new Set(loanItemIds)]

          if (uniqueLoanItemIds.length !== loanItemIds.length) {
            return json(
              {
                detail: '同じ個体が重複して選択されています',
              },
              400,
            )
          }

          const returnerClassName =
            typeof body.class_name === 'string'
              ? body.class_name.trim()
              : ''

          const returnerName =
            typeof body.name === 'string'
              ? body.name.trim()
              : ''

          if (!returnerClassName) {
            return json(
              {
                detail: '返却者のクラスを入力してください',
              },
              400,
            )
          }

          if (!returnerName) {
            return json(
              {
                detail: '返却者の氏名を入力してください',
              },
              400,
            )
          }

          const placeholders = uniqueLoanItemIds
            .map(() => '?')
            .join(', ')

          const loanItemsResult = await env.DB
            .prepare(`
              SELECT
                loan_items.id AS loan_item_id,
                loan_items.loan_id,
                loan_items.tool_item_id,
                loan_items.returned_at,
                loans.borrower_id,
                loans.tool_id,
                loans.quantity,
                loans.returned_quantity,
                loans.due_at,
                loans.status AS loan_status,
                borrowers.class_name,
                borrowers.name AS borrower_name,
                tools.name AS tool_name,
                tool_items.management_number,
                tool_items.status AS tool_item_status
              FROM loan_items
              INNER JOIN loans
                ON loans.id = loan_items.loan_id
              INNER JOIN borrowers
                ON borrowers.id = loans.borrower_id
              INNER JOIN tools
                ON tools.id = loans.tool_id
              INNER JOIN tool_items
                ON tool_items.id = loan_items.tool_item_id
              WHERE loan_items.id IN (${placeholders})
            `)
            .bind(...uniqueLoanItemIds)
            .all<{
              loan_item_id: number
              loan_id: number
              tool_item_id: number
              returned_at: string | null
              borrower_id: number
              tool_id: number
              quantity: number
              returned_quantity: number
              due_at: string | null
              loan_status: string
              class_name: string
              borrower_name: string
              tool_name: string
              management_number: string
              tool_item_status: string
            }>()

          const loanItems = loanItemsResult.results

          if (loanItems.length !== uniqueLoanItemIds.length) {
            return json(
              {
                detail: '指定された返却対象の一部が見つかりません',
              },
              404,
            )
          }

          const alreadyReturned = loanItems.find(
            item =>
              item.returned_at !== null ||
              item.tool_item_status !== 'borrowed' ||
              item.loan_status !== 'borrowed',
          )

          if (alreadyReturned) {
            return json(
              {
                detail: `${alreadyReturned.management_number} はすでに返却されています`,
              },
              400,
            )
          }

          const existingReturner = await env.DB
            .prepare(`
              SELECT id
              FROM borrowers
              WHERE class_name = ?
                AND name = ?
              LIMIT 1
            `)
            .bind(returnerClassName, returnerName)
            .first<{ id: number }>()

          let returnerId = existingReturner?.id ?? null

          if (returnerId === null) {
            const inserted = await env.DB
              .prepare(`
                INSERT INTO borrowers (
                  class_name,
                  name,
                  created_at,
                  updated_at
                )
                VALUES (?, ?, datetime('now', '+9 hours'), datetime('now', '+9 hours'))
              `)
              .bind(returnerClassName, returnerName)
              .run()

            returnerId = Number(inserted.meta.last_row_id)

            if (!returnerId) {
              return json(
                {
                  detail: '返却者の登録に失敗しました',
                },
                500,
              )
            }
          }

          const returnStatements: D1PreparedStatement[] = []

          for (const item of loanItems) {
            returnStatements.push(
              env.DB
                .prepare(`
                  UPDATE loan_items
                  SET
                    returned_at = datetime('now', '+9 hours'),
                    returned_by_id = ?,
                    overdue_seconds = CASE
                      WHEN ? IS NOT NULL
                        AND datetime('now', '+9 hours') > datetime(?)
                      THEN unixepoch(datetime('now', '+9 hours'))
                        - unixepoch(?)
                      ELSE 0
                    END
                  WHERE id = ?
                    AND returned_at IS NULL
                `)
                .bind(
                  returnerId,
                  item.due_at,
                  item.due_at,
                  item.due_at,
                  item.loan_item_id,
                ),
            )

            returnStatements.push(
              env.DB
                .prepare(`
                  UPDATE tool_items
                  SET
                    status = 'available',
                    updated_at = datetime('now', '+9 hours')
                  WHERE id = ?
                    AND status = 'borrowed'
                `)
                .bind(item.tool_item_id),
            )

            returnStatements.push(
              env.DB
                .prepare(`
                  UPDATE tools
                  SET
                    available_quantity = available_quantity + 1,
                    updated_at = datetime('now', '+9 hours')
                  WHERE id = ?
                `)
                .bind(item.tool_id),
            )

            returnStatements.push(
              env.DB
                .prepare(`
                  UPDATE loans
                  SET
                    returned_quantity = returned_quantity + 1
                  WHERE id = ?
                    AND status = 'borrowed'
                `)
                .bind(item.loan_id),
            )
          }

          await env.DB.batch(returnStatements)

          const uniqueLoanIds = [
            ...new Set(loanItems.map(item => item.loan_id)),
          ]

          for (const loanId of uniqueLoanIds) {
            await env.DB
              .prepare(`
                UPDATE loans
                SET
                  status = 'returned',
                  returned_at = datetime('now', '+9 hours')
                WHERE id = ?
                  AND status = 'borrowed'
                  AND returned_quantity >= quantity
              `)
              .bind(loanId)
              .run()
          }

          const returnedItemsResult = await env.DB
            .prepare(`
              SELECT
                loan_items.id AS loan_item_id,
                loan_items.loan_id,
                loan_items.tool_item_id,
                loan_items.returned_at,
                loans.borrower_id,
                loans.tool_id,
                loans.quantity,
                loans.returned_quantity,
                loans.borrowed_at,
                loans.returned_at AS loan_returned_at,
                loan_items.returned_by_id,
                loans.status,
                borrowers.class_name,
                borrowers.name AS borrower_name,
                returned_borrowers.class_name AS returned_by_class_name,
                returned_borrowers.name AS returned_by_name,
                tools.name AS tool_name,
                CASE
                  WHEN tool_items.management_number LIKE 'DELETED-%'
                  THEN substr(
                    tool_items.management_number,
                    length('DELETED-' || tool_items.id || '-') + 1
                  )
                  ELSE tool_items.management_number
                END AS management_number
              FROM loan_items
              INNER JOIN loans
                ON loans.id = loan_items.loan_id
              INNER JOIN borrowers
                ON borrowers.id = loans.borrower_id
              INNER JOIN tools
                ON tools.id = loans.tool_id
              INNER JOIN tool_items
                ON tool_items.id = loan_items.tool_item_id
              LEFT JOIN borrowers AS returned_borrowers
                ON returned_borrowers.id = loan_items.returned_by_id
              WHERE loan_items.id IN (${placeholders})
              ORDER BY loan_items.id
            `)
            .bind(...uniqueLoanItemIds)
            .all()

          return json({
            count: returnedItemsResult.results.length,
            items: returnedItemsResult.results,
          })
        }

      if (
        url.pathname === '/settings/return-time' &&
        request.method === 'GET'
      ) {
        const result = await env.DB
          .prepare(`
            SELECT
              id,
              return_time
            FROM universal_return_times
            ORDER BY return_time ASC
          `)
          .all<{
            id: number
            return_time: string
          }>()

        return json({
          universal_return_times: result.results,
        })
      }

      if (
        url.pathname === '/settings/return-time' &&
        request.method === 'PATCH'
      ) {
        const body = await request.json()

        if (!Array.isArray(body.universal_return_times)) {
          return json(
            {
              detail: '返却時刻は配列で指定してください',
            },
            400,
          )
        }

        const values = body.universal_return_times.map(
          (value: unknown) =>
            typeof value === 'string'
              ? value.trim()
              : '',
        )

        if (
          values.some(
            (value: string) =>
              !/^([01]\d|2[0-3]):[0-5]\d$/.test(value),
          )
        ) {
          return json(
            {
              detail: '返却時刻はHH:mm形式で指定してください',
            },
            400,
          )
        }

        const uniqueValues = [...new Set(values)]

        await env.DB
          .prepare(`
            DELETE FROM universal_return_times
          `)
          .run()

        if (uniqueValues.length > 0) {
          const statements = uniqueValues.map(
            (value: string) =>
              env.DB
                .prepare(`
                  INSERT INTO universal_return_times (
                    return_time,
                    created_at
                  )
                  VALUES (?, datetime('now', '+9 hours'))
                `)
                .bind(value),
          )

          await env.DB.batch(statements)
        }

        const result = await env.DB
          .prepare(`
            SELECT
              id,
              return_time
            FROM universal_return_times
            ORDER BY return_time ASC
          `)
          .all<{
            id: number
            return_time: string
          }>()

        return json({
          universal_return_times: result.results,
        })
      }

      if (
        url.pathname === '/settings/return-time-chief' &&
        request.method === 'GET'
      ) {
        const result = await env.DB
          .prepare(`
            SELECT
              id,
              return_time
            FROM universal_return_times_chief
            ORDER BY return_time ASC
          `)
          .all<{
            id: number
            return_time: string
          }>()

        return json({
          universal_return_times: result.results,
        })
      }

      if (
        url.pathname === '/settings/return-time-chief' &&
        request.method === 'PATCH'
      ) {
        const body = await request.json()

        if (!Array.isArray(body.universal_return_times)) {
          return json(
            {
              detail: '返却時刻は配列で指定してください',
            },
            400,
          )
        }

        const values = body.universal_return_times.map(
          (value: unknown) =>
            typeof value === 'string'
              ? value.trim()
              : '',
        )

        if (
          values.some(
            (value: string) =>
              !/^([01]\d|2[0-3]):[0-5]\d$/.test(value),
          )
        ) {
          return json(
            {
              detail: '返却時刻はHH:mm形式で指定してください',
            },
            400,
          )
        }

        const uniqueValues = [...new Set(values)]

        await env.DB
          .prepare(`
            DELETE FROM universal_return_times_chief
          `)
          .run()

        if (uniqueValues.length > 0) {
          const statements = uniqueValues.map(
            (value: string) =>
              env.DB
                .prepare(`
                  INSERT INTO universal_return_times_chief (
                    return_time,
                    created_at
                  )
                  VALUES (?, datetime('now', '+9 hours'))
                `)
                .bind(value),
          )

          await env.DB.batch(statements)
        }

        const result = await env.DB
          .prepare(`
            SELECT
              id,
              return_time
            FROM universal_return_times_chief
            ORDER BY return_time ASC
          `)
          .all<{
            id: number
            return_time: string
          }>()

        return json({
          universal_return_times: result.results,
        })
      }

      if (
        url.pathname === '/tools/order' &&
        request.method === 'PATCH'
      ) {
        const adminError = requireAdmin(authenticated)
        if (adminError) {
          return adminError
        }

        const body = await request.json()

        if (
          !body ||
          !Array.isArray(body.tool_ids)
        ) {
          return json(
            {
              detail:
                '工具・機材の並び順が正しく指定されていません',
            },
            400,
          )
        }

        const toolIds = body.tool_ids
          .map((id: unknown) => Number(id))

        if (
          toolIds.some(
            (id: number) =>
              !Number.isInteger(id) || id <= 0,
          )
        ) {
          return json(
            {
              detail:
                '工具・機材IDが正しくありません',
            },
            400,
          )
        }

        if (
          new Set(toolIds).size !== toolIds.length
        ) {
          return json(
            {
              detail:
                '工具・機材IDが重複しています',
            },
            400,
          )
        }

        const activeToolsResult = await env.DB
          .prepare(`
            SELECT id
            FROM tools
            WHERE is_active = 1
          `)
          .all<{ id: number }>()

        const activeToolIds = activeToolsResult.results
          .map(tool => tool.id)
          .sort((a, b) => a - b)

        const requestedToolIds = [...toolIds]
          .sort((a, b) => a - b)

        if (
          activeToolIds.length !==
            requestedToolIds.length ||
          activeToolIds.some(
            (id, index) =>
              id !== requestedToolIds[index],
          )
        ) {
          return json(
            {
              detail:
                '有効な工具・機材をすべて指定してください',
            },
            400,
          )
        }

        const statements = toolIds.map(
          (toolId: number, index: number) =>
            env.DB
              .prepare(`
                UPDATE tools
                SET
                  display_order = ?,
                  updated_at = datetime('now', '+9 hours')
                WHERE id = ?
                  AND is_active = 1
              `)
              .bind(index + 1, toolId),
        )

        await env.DB.batch(statements)

        return json({
          detail: '工具・機材の並び順を更新しました',
        })
      }

      const toolMatch = url.pathname.match(/^\/tools\/(\d+)$/)

      if (toolMatch) {
        const toolId = Number(toolMatch[1])

        if (!Number.isInteger(toolId) || toolId <= 0) {
          return json(
            {
              detail: '工具・機材IDが正しくありません',
            },
            400,
          )
        }

        const existingTool = await getTool(
          env.DB,
          toolId,
        )

        if (!existingTool) {
          return json(
            {
              detail: '工具・機材が見つかりません',
            },
            404,
          )
        }

        if (request.method === 'PATCH') {
          const adminError = requireAdmin(authenticated)
          if (adminError) {
            return adminError
          }

          const body = await request.json()

          const payload = getToolPayload({
            ...body,
            tool_items:
              body.tool_items === undefined
                ? []
                : body.tool_items,
          })

          const currentItemsResult = await env.DB
            .prepare(`
              SELECT
                id,
                tool_id,
                management_number,
                status
              FROM tool_items
              WHERE tool_id = ?
                AND management_number NOT LIKE 'DELETED-%'
              ORDER BY id
            `)
            .bind(toolId)
            .all<{
              id: number
              tool_id: number
              management_number: string
              status: string
            }>()

          const currentItems = currentItemsResult.results

          if (
            body.tool_items === undefined ||
            !Array.isArray(body.tool_items)
          ) {
            return json(
              {
                detail:
                  '工具・機材個体の情報を指定してください',
              },
              400,
            )
          }

          const requestedIds = new Set(
            payload.tool_items
              .filter(
                (item: {
                  id: number | null
                  management_number: string
                }) => item.id !== null,
              )
              .map(
                (item: {
                  id: number | null
                  management_number: string
                }) => item.id as number,
              ),
          )

          const currentIds = new Set(
            currentItems.map(item => item.id),
          )

          for (const item of payload.tool_items) {
            if (
              item.id !== null &&
              !currentIds.has(item.id)
            ) {
              return json(
                {
                  detail:
                    '指定された工具・機材個体が見つかりません',
                },
                400,
              )
            }
          }

          for (const currentItem of currentItems) {
            if (!requestedIds.has(currentItem.id)) {
              if (currentItem.status !== 'available') {
                return json(
                  {
                    detail:
                      `${currentItem.management_number} は現在貸出中のため削除できません`,
                  },
                  400,
                )
              }
            }
          }

          const requestedNumbers =
            payload.tool_items.map(
              (item: {
                id: number | null
                management_number: string
              }) => item.management_number,
            )

          if (
            new Set(requestedNumbers).size !==
            requestedNumbers.length
          ) {
            return json(
              {
                detail:
                  '同じ管理番号を重複して登録することはできません',
              },
              400,
            )
          }

          const existingNumbers =
            await env.DB
              .prepare(`
                SELECT id, management_number
                FROM tool_items
                WHERE tool_id != ?
              `)
              .bind(toolId)
              .all<{
                id: number
                management_number: string
              }>()

          const otherNumbers = new Set(
            existingNumbers.results.map(
              item => item.management_number,
            ),
          )

          for (const item of payload.tool_items) {
            if (
              otherNumbers.has(
                item.management_number,
              )
            ) {
              return json(
                {
                  detail:
                    `管理番号「${item.management_number}」はすでに使用されています`,
                },
                400,
              )
            }
          }

          const statements: D1PreparedStatement[] = []

          for (const item of payload.tool_items) {
            if (item.id === null) {
              statements.push(
                env.DB
                  .prepare(`
                    INSERT INTO tool_items (
                      tool_id,
                      management_number,
                      status,
                      created_at,
                      updated_at
                    )
                    VALUES (?, ?, 'available', datetime('now', '+9 hours'), datetime('now', '+9 hours'))
                  `)
                  .bind(
                    toolId,
                    item.management_number,
                  ),
              )
            } else {
              statements.push(
                env.DB
                  .prepare(`
                    UPDATE tool_items
                    SET
                      management_number = ?,
                      updated_at = datetime('now', '+9 hours')
                    WHERE id = ?
                      AND tool_id = ?
                  `)
                  .bind(
                    item.management_number,
                    item.id,
                    toolId,
                  ),
              )
            }
          }

          for (const currentItem of currentItems) {
            if (!requestedIds.has(currentItem.id)) {
              const history = await env.DB
                .prepare(`
                  SELECT id
                  FROM loan_items
                  WHERE tool_item_id = ?
                  LIMIT 1
                `)
                .bind(currentItem.id)
                .first<{ id: number }>()

              if (history) {
                statements.push(
                  env.DB
                    .prepare(`
                      UPDATE tool_items
                      SET
                        management_number =
                          'DELETED-' || id || '-' || management_number,
                        updated_at = datetime('now', '+9 hours')
                      WHERE id = ?
                        AND tool_id = ?
                        AND status = 'available'
                    `)
                    .bind(
                      currentItem.id,
                      toolId,
                    ),
                )
              } else {
                statements.push(
                  env.DB
                    .prepare(`
                      DELETE FROM tool_items
                      WHERE id = ?
                        AND tool_id = ?
                        AND status = 'available'
                    `)
                    .bind(
                      currentItem.id,
                      toolId,
                    ),
                )
              }
            }
          }

          statements.push(
            env.DB
              .prepare(`
                UPDATE tools
                SET
                  name = ?,
                  category = ?,
                  description = ?,
                  location = ?,
                  max_quantity_per_class = ?,
                  loan_duration_minutes = ?,
                  max_quantity_per_chief = ?,
                  loan_duration_minutes_per_chief = ?,
                  due_notice_enabled = ?,
                  universal_return_enabled = ?,
                  universal_return_enabled_for_chief = ?,
                  quantity = (
                    SELECT COUNT(*)
                    FROM tool_items
                    WHERE tool_id = ?
                      AND management_number NOT LIKE 'DELETED-%'
                  ),
                  available_quantity = (
                    SELECT COUNT(*)
                    FROM tool_items
                    WHERE tool_id = ?
                      AND management_number NOT LIKE 'DELETED-%'
                      AND status = 'available'
                  ),
                  updated_at = datetime('now', '+9 hours')
                WHERE id = ?
                  AND is_active = 1
              `)
              .bind(
                payload.name,
                payload.category,
                payload.description,
                payload.location,
                payload.max_quantity_per_class,
                payload.loan_duration_minutes,
                payload.max_quantity_per_chief,
                payload.loan_duration_minutes_per_chief,
                payload.due_notice_enabled,
                payload.universal_return_enabled,
                payload.universal_return_enabled_for_chief,
                toolId,
                toolId,
                toolId,
              ),
          )

          await env.DB.batch(statements)

          return json(
            await getTool(
              env.DB,
              toolId,
            ),
          )
        }

        if (request.method === 'DELETE') {
          const adminError = requireAdmin(authenticated)
          if (adminError) {
            return adminError
          }

          const borrowedItem = await env.DB
            .prepare(`
              SELECT
                id,
                management_number
              FROM tool_items
              WHERE tool_id = ?
                AND status != 'available'
              LIMIT 1
            `)
            .bind(toolId)
            .first<{
              id: number
              management_number: string
            }>()

          if (borrowedItem) {
            return json(
              {
                detail:
                  `${borrowedItem.management_number} は現在貸出中のため削除できません`,
              },
              400,
            )
          }

          await env.DB.batch([
            env.DB
              .prepare(`
                UPDATE tool_items
                SET
                  management_number =
                    'DELETED-' || id || '-' || management_number,
                  updated_at = datetime('now', '+9 hours')
                WHERE tool_id = ?
              `)
              .bind(toolId),
            env.DB
              .prepare(`
                UPDATE tools
                SET
                  is_active = 0,
                  updated_at = datetime('now', '+9 hours')
                WHERE id = ?
              `)
              .bind(toolId),
            env.DB
              .prepare(`
                UPDATE reservations
                SET
                  status = 'cancelled',
                  updated_at = datetime('now', '+9 hours')
                WHERE tool_id = ?
                  AND status = 'waiting'
              `)
              .bind(toolId),
          ])

          return json({
            detail: '工具・機材を削除しました',
          })
        }
      }

      return json(
        {
          detail: 'Not Found',
        },
        404,
      )
    } catch (error) {
      console.error(error)

      if (error instanceof SyntaxError) {
        return json(
          {
            detail: 'JSONの形式が正しくありません',
          },
          400,
        )
      }

      if (error instanceof Error) {
        return json(
          {
            detail: error.message,
          },
          400,
        )
      }

      return json(
        {
          detail: 'Internal Server Error',
        },
        500,
      )
    }
  },
}
