// profiles 模組的 wire-oriented step definitions（specs/truth/features/backend/profiles/dsl.md）
//
// 這些句型無法由 SpecFormula 六個內建指令表達（延遲 fixture 落地、別名綁定
// dev-login 實際回傳的 user.id、cookie 會話、故障注入、fetch 觀測斷言），
// 依 rules/core/specformula.md 以 custom step 承接；NEVER 複寫內建指令句型。
//
// 世界觀（每個 scenario 一份）：
//   aliases        別名 → UUID。出現在 呼叫者是使用者 的別名綁定 dev-login 回傳的
//                  真實 user.id；其餘別名在落地時產生 RFC 4122 uuid。
//   pending*       資料庫中有以下 profiles / 資料庫中沒有 profile 的落地延遲到
//                  第一個 呼叫 GET（此時所有呼叫者別名已綁定）。
//   cookie         呼叫者 session cookie；未登入時為 null。
//   response       最近一次 HTTP 回應 {status, body}。
//   dbLogSince     請求發出前的時間戳，供 /test/db-log 斷言切割「這次請求」。
//   faultInjected  讀取失敗注入已啟用（整表 REVOKE，或只留 id/role 欄位
//                  grant）；After 負責復原，中斷殘留由下一輪 BeforeAll 自愈。

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { After, AfterAll, Before, BeforeAll, Given, Then, When } from '@cucumber/cucumber'
import type { DataTable } from '@cucumber/cucumber'
import { Client } from 'pg'

import { SPECFORMULA_BASE_URL, SPECFORMULA_DB } from '../support/environment.js'
import { SEED_PROFILES } from '../support/seed-profiles.js'

const DEV_LOGIN_PASSWORD = 'password123'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// session 角色字串（DSL 值域）→ DB profiles.role 值域（admin/user）。
// TD-026 D3：授權只讀 DB；dev-login 的 `as` 不參與授權，固定不帶。
const ROLE_MAP: Record<string, string> = {
  admin: 'admin',
  user: 'user',
  member: 'user',
  guest: 'user',
}

interface ProfileRow {
  id: string
  display_name: string
  avatar_url: string | null
  role: string
  created_at: string
  updated_at: string | null
}

interface ProfilesWorld {
  aliases: Map<string, string>
  pendingInserts: ProfileRow[]
  pendingDeletes: string[]
  callerRoles: Map<string, string>
  cookie: string | null
  response: { status: number; body: unknown } | null
  dbLogSince: number
  faultInjected: boolean
}

let dbClient: Client | null = null

async function db(): Promise<Client> {
  if (!dbClient) {
    // 注意：Client 的欄位是 `user`，SpecFormula 的 JdbcDataSourceConfig 是
    // `username` —— 直接 spread 會掉到 OS user 然後 password auth failed。
    const client = new Client({
      host: SPECFORMULA_DB.host,
      port: SPECFORMULA_DB.port,
      database: SPECFORMULA_DB.database,
      user: SPECFORMULA_DB.username,
      password: SPECFORMULA_DB.password,
    })
    await client.connect()
    dbClient = client
  }
  return dbClient
}

function world(self: unknown): ProfilesWorld {
  const holder = self as { profilesWorld?: ProfilesWorld }
  if (!holder.profilesWorld) {
    holder.profilesWorld = {
      aliases: new Map(),
      pendingInserts: [],
      pendingDeletes: [],
      callerRoles: new Map(),
      cookie: null,
      response: null,
      dbLogSince: 0,
      faultInjected: false,
    }
  }
  return holder.profilesWorld
}

/** `"<使用者甲>"` → `使用者甲`；字面 UUID 原樣回傳（不建別名）。 */
function aliasName(raw: string): string {
  const m = /^<(.+)>$/.exec(raw)
  return m ? m[1] : raw
}

/**
 * 把 `<別名>` 解析成 UUID；未綁定的別名即場產生一個合法 UUID 並記住。
 * 不是 `<…>` 語法的一律當字面值原樣回傳（含字面 UUID）——display_name
 * 之類的中文字串走這條，不會被當別名。
 */
function resolveId(w: ProfilesWorld, raw: string): string {
  const m = /^<(.+)>$/.exec(raw)
  if (!m) return raw
  const name = m[1]
  if (UUID_RE.test(name)) return name
  let id = w.aliases.get(name)
  if (!id) {
    id = randomUUID()
    w.aliases.set(name, id)
  }
  return id
}

/** 別名 → 穩定 email（落在 DEV_LOGIN_EMAIL_DOMAINS 預設的 test.local）。 */
function aliasEmail(alias: string): string {
  return `bdd-${Buffer.from(alias, 'utf8').toString('hex')}@test.local`
}

/**
 * nuxt-security csurf 的 double-submit handshake：GET 一個 HTML 頁拿
 * `csrf` cookie（secret）與 `<meta name="csrf-token">`（派生 token），
 * POST 時兩者一起帶。cookie+token 對可重用，整個 run 取一次。
 */
let csrfPair: { cookie: string; token: string } | null = null

async function fetchCsrfPair(): Promise<{ cookie: string; token: string }> {
  if (csrfPair) return csrfPair
  const response = await fetch(`${SPECFORMULA_BASE_URL}/auth/login`)
  const setCookie = response.headers.get('set-cookie')
  const secret = /csrf=[^;]+/.exec(setCookie ?? '')?.[0]
  const token = /<meta name="csrf-token" content="([^"]+)"/.exec(await response.text())?.[1]
  if (!secret || !token) {
    throw new Error('無法取得 csrf cookie / token（GET /auth/login）')
  }
  csrfPair = { cookie: secret, token }
  return csrfPair
}

/**
 * 第一個 When 前的延遲落地：把 pendingInserts 寫進 profiles、
 * pendingDeletes 的 id 確保不存在，並把 caller 角色套進其 profile 列。
 */
async function flushFixtures(w: ProfilesWorld): Promise<void> {
  const client = await db()

  for (const alias of w.pendingDeletes) {
    await client.query('DELETE FROM public.profiles WHERE id = $1', [resolveId(w, alias)])
  }

  for (const row of w.pendingInserts) {
    const id = resolveId(w, row.id)
    // 呼叫者角色參數與資料列 role 不一致是 spec bug，直接失敗
    const expectedDbRole = w.callerRoles.get(aliasName(row.id))
    if (expectedDbRole && row.role !== expectedDbRole) {
      throw new Error(
        `profile 列 role=${row.role} 與 呼叫者角色 ${expectedDbRole} 不一致（TD-026 D3：授權只讀 DB）`,
      )
    }
    await client.query(
      `INSERT INTO public.profiles (id, display_name, avatar_url, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url,
         role = EXCLUDED.role,
         created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at`,
      [id, row.display_name, row.avatar_url, row.role, row.created_at, row.updated_at],
    )
  }

  w.pendingInserts = []
  w.pendingDeletes = []
}

/**
 * service_role 對 profiles 的權限正規態：只有 table-level SELECT、沒有
 * column-level grant。兩種故障注入（整表 REVOKE、只留 id/role）都收斂回
 * 這裡；BeforeAll 也呼叫它，補救「上一輪在 REVOKE 與 After 之間被中斷」
 * 留下的殘缺權限（中斷後不必手動 GRANT）。
 */
async function resetProfileReadGrants(client: Client): Promise<void> {
  // REVOKE 欄位級 grant 在權限不存在時只產生 warning，不會 error。
  await client.query('REVOKE SELECT (id, role) ON public.profiles FROM service_role')
  await client.query('GRANT SELECT ON public.profiles TO service_role')
}

/**
 * 補回 seed.sql 的三列種子（ON CONFLICT 只校正 role —— TD-026 D3 起授權
 * 只讀 profiles.role；display_name 等欄位保留 dev 端可能的修改）。
 */
async function ensureSeedProfiles(client: Client): Promise<void> {
  for (const row of SEED_PROFILES) {
    await client.query(
      `INSERT INTO public.profiles (id, display_name, avatar_url, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
      [row.id, row.display_name, row.avatar_url, row.role],
    )
  }
}

// BDD 與 `SPECFORMULA_TEST=1 pnpm dev` 共用本機 supabase DB。scenario 需要
// clean slate（列表斷言 total），所以每個 scenario 的 Before 仍清空
// profiles —— 但清掉的列不能消失：開局先把整表快照進持久備份表
// specformula_bdd.profiles_backup（不用 pg_temp —— process 被 SIGKILL 時
// temp table 跟著連線消失，持久表讓下一輪開局還能補回殘留），收尾寫回。
BeforeAll({ timeout: 30_000 }, async () => {
  const client = await db()
  await resetProfileReadGrants(client)
  await client.query('CREATE SCHEMA IF NOT EXISTS specformula_bdd')
  await client.query(
    'CREATE TABLE IF NOT EXISTS specformula_bdd.profiles_backup (LIKE public.profiles)',
  )
  // 上一輪中斷留下的備份先補回 public.profiles，再重拍快照
  await client.query(
    `INSERT INTO public.profiles
       SELECT * FROM specformula_bdd.profiles_backup
       ON CONFLICT (id) DO NOTHING`,
  )
  await client.query('TRUNCATE specformula_bdd.profiles_backup')
  // 種子保證存在（含被舊版清空、之後再也沒補回的 DB）再進快照
  await ensureSeedProfiles(client)
  await client.query('INSERT INTO specformula_bdd.profiles_backup SELECT * FROM public.profiles')
})

Before({ timeout: 30_000 }, async function () {
  // 每個 scenario 從乾淨的 profiles 開始。整表已在 BeforeAll 快照、
  // AfterAll 復原——這裡的清空不會吃掉 seed 或 dev 使用者的列。
  await (await db()).query('DELETE FROM public.profiles')
})

After({ timeout: 30_000 }, async function () {
  const w = world(this)
  const client = await db()
  // 故障注入復原：無論 scenario 成敗都把權限正規化
  if (w.faultInjected) {
    await resetProfileReadGrants(client)
    w.faultInjected = false
  }
  // 清掉本 scenario 落地過的列（含 flush 後插入的）
  if (w.aliases.size > 0) {
    await client.query('DELETE FROM public.profiles WHERE id = ANY($1)', [[...w.aliases.values()]])
  }
})

// ── Given ───────────────────────────────────────────────────────────────────

Given('資料庫中有以下 profiles', function (this: unknown, table: DataTable) {
  const w = world(this)
  for (const row of table.hashes() as Record<string, string>[]) {
    w.pendingInserts.push({
      id: row['id'],
      display_name: row['display_name'],
      avatar_url: row['avatar_url'] || null,
      role: row['role'] || 'user',
      created_at: row['created_at'] || new Date().toISOString(),
      updated_at: row['updated_at'] || null,
    })
  }
})

Given('資料庫中沒有 profile {string}', function (this: unknown, id: string) {
  // 保留 <…> 語法，flush 時 resolveId 才解析
  world(this).pendingDeletes.push(id)
})

Given('呼叫者未登入', function (this: unknown) {
  world(this).cookie = null
})

Given(
  '呼叫者是使用者 {string}，角色為 {string}',
  async function (this: unknown, id: string, role: string) {
    const w = world(this)
    const name = aliasName(id)
    const dbRole = ROLE_MAP[role]
    if (!dbRole) throw new Error(`未知角色 "${role}"（DSL 值域：admin/member/guest/user）`)
    w.callerRoles.set(name, dbRole)

    // TD-026 D3：授權只讀 DB profiles.role，session 的 `as` 不參與授權 → 不帶。
    // TD-026 D4：不提供 id —— id 由 Better Auth 簽發，別名綁定實際回傳值。
    const csrf = await fetchCsrfPair()
    const response = await fetch(`${SPECFORMULA_BASE_URL}/api/_dev/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: csrf.cookie,
        'csrf-token': csrf.token,
      },
      body: JSON.stringify({
        email: aliasEmail(name),
        password: DEV_LOGIN_PASSWORD,
        name,
      }),
    })
    if (!response.ok) {
      throw new Error(`dev-login 失敗：${response.status} ${await response.text()}`)
    }
    const payload = (await response.json()) as { user?: { id?: string } }
    const userId = payload.user?.id
    assert.ok(userId, 'dev-login 沒有回傳 user.id')
    w.aliases.set(name, userId)

    const setCookie = response.headers.get('set-cookie')
    assert.ok(setCookie, 'dev-login 沒有回傳 session cookie')
    // 合併 header 可能含多個 cookie；精準取 better-auth 的 session cookie
    const sessionCookie =
      /better-auth\.session_token=[^;,]+/.exec(setCookie)?.[0] ?? setCookie.split(';')[0]
    w.cookie = sessionCookie
  },
)

Given('profiles 資料表的讀取會失敗', async function (this: unknown) {
  // 撤銷 service_role 對 profiles 的 SELECT —— app 的所有 PostgREST 讀取
  // （含 TD-026 D3 的角色查詢）都會回 42501。先清 column-level grant 再撤
  // table-level：欄位級 grant 是獨立授權，撤整表不會一併移除它。
  // After hook 負責復原。
  const client = await db()
  await client.query('REVOKE SELECT (id, role) ON public.profiles FROM service_role')
  await client.query('REVOKE SELECT ON public.profiles FROM service_role')
  world(this).faultInjected = true
})

Given('profiles 資料表的資料讀取會失敗', async function (this: unknown) {
  // 撤整表讀權、只留角色查詢需要的 (id, role) 欄位級 grant：角色查詢
  // （select role + eq id）與 count 查詢（select id head）仍通過，但資料
  // 查詢要讀其他欄位 → 42501，蓋到 handler 自己的資料查詢失敗分支。
  // After hook 負責復原。
  const client = await db()
  await client.query('REVOKE SELECT ON public.profiles FROM service_role')
  await client.query('GRANT SELECT (id, role) ON public.profiles TO service_role')
  world(this).faultInjected = true
})

// ── When ────────────────────────────────────────────────────────────────────

When('呼叫 GET {string}', async function (this: unknown, path: string) {
  const w = world(this)
  // dsl.md：fixture 落地延遲到第一個 When（呼叫者別名此時已綁定）
  await flushFixtures(w)

  // 注意：capture group 已去掉 <>，要補回才符合 resolveId 的別名語法
  const resolved = path.replace(/<([^>]+)>/g, (_, name) => resolveId(w, `<${name}>`))
  w.dbLogSince = Date.now()
  const response = await fetch(`${SPECFORMULA_BASE_URL}${resolved}`, {
    headers: w.cookie ? { Cookie: w.cookie } : {},
  })
  w.response = {
    status: response.status,
    body: await response.json().catch(() => null),
  }
})

// ── Then ────────────────────────────────────────────────────────────────────

Then('回應狀態碼為 {int}', function (this: unknown, status: number) {
  assert.equal(
    world(this).response?.status,
    status,
    `body: ${JSON.stringify(world(this).response?.body)}`,
  )
})

Then('回應 data 的 {string} 為 {string}', function (this: unknown, field: string, value: string) {
  const w = world(this)
  const data = (w.response?.body as { data?: Record<string, unknown> })?.data
  const expected = value === 'null' ? null : resolveId(w, value)
  assert.equal(data?.[field], expected)
})

Then('回應 data 的欄位恰為 {string}', function (this: unknown, fields: string) {
  const data = (world(this).response?.body as { data?: Record<string, unknown> })?.data
  assert.ok(data, '回應沒有 data')
  assert.deepEqual(Object.keys(data).toSorted(), fields.split(',').toSorted())
})

Then('回應 data 的 id 依序為 {string}', function (this: unknown, list: string) {
  const w = world(this)
  const data = (w.response?.body as { data?: { id: string }[] })?.data
  assert.ok(Array.isArray(data), '回應 data 不是陣列')
  const expected = list === '' ? [] : list.split(',').map((v) => resolveId(w, v))
  assert.deepEqual(
    data.map((row) => row.id),
    expected,
  )
})

Then(
  /^回應 pagination 為 page (\d+)、perPage (\d+)、total (\d+)、totalPages (\d+)$/,
  function (this: unknown, page: string, perPage: string, total: string, totalPages: string) {
    const pagination = (world(this).response?.body as { pagination?: unknown })?.pagination
    assert.deepEqual(pagination, {
      page: Number(page),
      perPage: Number(perPage),
      total: Number(total),
      totalPages: Number(totalPages),
    })
  },
)

Then('回應錯誤訊息為 {string}', function (this: unknown, message: string) {
  const body = world(this).response?.body as Record<string, unknown> | null
  assert.equal(
    body?.['message'] ?? body?.['statusMessage'],
    message,
    `body: ${JSON.stringify(body)}`,
  )
})

Then('回應不含 PostgREST 診斷欄位', function (this: unknown) {
  // wire 實測：h3 錯誤只序列化 {statusCode,statusMessage,message,...}；
  // evlog 的 why/fix 與 zod issues 走內部日誌，不進 HTTP body。
  // 這句斷言的是「不回漏 PostgREST 原生錯誤形狀」（code/details/hint）——
  // 那才是「不洩漏資料庫診斷文字」在 wire 上的可觀測條件。
  const body = world(this).response?.body as Record<string, unknown> | null
  assert.ok(body && typeof body === 'object', '回應不是物件')
  for (const key of ['code', 'details', 'hint']) {
    assert.ok(!(key in body), `錯誤回應洩漏 PostgREST 欄位 ${key}`)
  }
})

Then('profiles 資料表的資料列沒有被讀取', async function (this: unknown) {
  // TD-026 D3：授權的角色查詢（select=role）是允許的；除此以外的任何
  // profiles 讀取都代表「目標列在授權前就被撈出來」。
  const w = world(this)
  const response = await fetch(`${SPECFORMULA_BASE_URL}/test/db-log?since=${w.dbLogSince}`)
  const { entries } = (await response.json()) as {
    entries: { select: string | null }[]
  }
  const dataReads = entries.filter((e) => e.select !== 'role')
  assert.deepEqual(
    dataReads.map((e) => e.select),
    [],
    '授權之外仍有 profiles 資料列讀取',
  )
})

AfterAll({ timeout: 30_000 }, async () => {
  const client = dbClient
  if (!client) return
  try {
    // 還原 BeforeAll 拍的整表快照。備份表不存在代表 BeforeAll 沒跑到
    // 快照段——直接跳過，免得先 DELETE 才發現沒東西可補。
    const reg = await client.query<{ r: string | null }>(
      `SELECT to_regclass('specformula_bdd.profiles_backup') AS r`,
    )
    if (reg.rows[0]?.r) {
      await client.query('BEGIN')
      try {
        await client.query('DELETE FROM public.profiles')
        await client.query(
          'INSERT INTO public.profiles SELECT * FROM specformula_bdd.profiles_backup',
        )
        await client.query('TRUNCATE specformula_bdd.profiles_backup')
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      }
    }
    await ensureSeedProfiles(client)
    // 驗收點：跑完後 seed admin 仍須是 admin（授權讀 profiles.role，
    // 沒復原就讓整場跑紅，不靜默放過）
    const { rows } = await client.query<{ role: string }>(
      'SELECT role FROM public.profiles WHERE id = $1',
      [SEED_PROFILES[0].id],
    )
    assert.equal(rows[0]?.role, 'admin', 'seed admin profile 未復原')
  } finally {
    await client.end()
    dbClient = null
  }
})
