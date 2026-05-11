<!--
🔒 LOCKED — managed by clade
Source: rules/core/logging.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Server / client logging 與錯誤記錄規範（evlog）
globs:
  - 'server/api/**/*.ts'
  - 'server/plugins/evlog-*.ts'
  - 'app/plugins/evlog-*.ts'
  - 'nuxt.config.ts'
  - 'packages/**/server/api/**/*.ts'
  - 'packages/**/server/plugins/evlog-*.ts'
  - 'packages/**/app/plugins/evlog-*.ts'
---

# Logging

evlog（https://www.evlog.dev/）是 wide-event-style structured logger。clade 5 consumer 全跑 Nuxt + Cloudflare Workers，本 rule 是其上 14 區塊功能的最低治理線。完整 adoption plan 見 `docs/evlog-master-plan.md`。

## Logger 選擇

- **API handler** → `const log = useLogger(event)` from `evlog`（第一行）
- **Utils（無 event）** → `consola.withTag('...')`
- **NEVER** 在 `server/api/` 使用 `consola` — 遷移至 `useLogger`

## log.error 使用時機

**只記錄非預期錯誤**，不記錄正常業務分支：

```typescript
// ✅ 非預期 — 要 log.error
if (error) {
  log.error(error as Error, { step: 'db-insert' })
  const result = handleDbError(error)
  throw createError({
    status: result.statusCode,
    message: result.message,
    why: result.why,
    fix: result.fix,
  })
}

// ❌ 預期 — 不要 log.error
if (error?.code === 'PGRST116') {
  // 404 是正常情況，直接 throw
  throw createError({ status: 404, message: '找不到資料' })
}
```

**判斷標準**：如果這個錯誤代表 caller 的錯誤（404、422）或已知業務狀態，不記錄。只記錄代表系統異常的錯誤（5xx、非預期 DB error）。

## log.error 只呼叫一次

每個錯誤路徑只能有 **一個** `log.error` 呼叫。重複記錄 = 重複告警 = 告警疲勞。

## handleDbError 注意事項

此專案的 `handleDbError` **returns**（不 throw），必須自行 throw：

```typescript
// ✅ 正確 — log + handle + throw
if (error) {
  log.error(error as Error, { step: 'db-insert' })
  const result = handleDbError(error)
  throw createError({
    status: result.statusCode,
    message: result.message,
    why: result.why,
    fix: result.fix,
  })
}

// ❌ 忘記 throw — 錯誤被吞掉，程式繼續執行
if (error) {
  handleDbError(error) // returns but doesn't throw!
}
```

## createError 必帶 why（structured error 必填欄位）

> 新增 endpoint 應改走 catalog factory（`throw billingErrors.PAYMENT_DECLINED({ ... })`）；catalog 內的 `why` / `fix` / `link` 預先宣告，呼叫端不需重複。詳見 `evlog-adoption.md` 「Catalogs 採用」段。本節規則套用在 catalog 尚未涵蓋的場景與既存未遷移的 ad-hoc createError。

`server/api/**` 的非預期錯誤路徑，`throw createError(...)` **MUST** 帶 `why`，視情況補 `fix` / `link` / `cause` / `code` / `internal`：

| 欄位 | 必填？ | 用途 |
| --- | --- | --- |
| `status` | ✅ | HTTP status code |
| `message` | ✅ | 給使用者看的中文訊息（i18n-ready） |
| `why` | ✅（5xx） | 給排障的英文說明（為什麼會走到這裡） |
| `fix` | ⬜ 建議 | 給開發者的下一步（怎麼修） |
| `link` | ⬜ 選用 | 對應 docs / runbook URL |
| `cause` | ✅（有 wrap） | 原始 error 物件，evlog 自動 unwrap |
| `code` | ⬜ 建議 | 機器可讀錯誤代號（例：`PG_UNIQUE_VIOLATION`、`AUDIT_HASH_DRIFT`） |
| `internal` | ⬜ 選用 | 標記不送 client 的欄位（debug-only） |

```typescript
// ✅ 結構化錯誤
throw createError({
  status: 500,
  message: '稽核紀錄寫入失敗',
  why: 'business mutation must commit with audit row in same transaction',
  fix: '檢查 audit_logs RLS、trigger、hash advisory lock 與 service_role 設定',
  link: 'https://internal/runbook/audit-failure',
  code: 'AUDIT_TX_FAIL',
  cause: error,
  internal: { auditEventId: result.auditEventId, prevHash: result.prevHash },
})

// ❌ 只給 message
throw createError({ status: 500, message: '失敗' })
```

只給 `message` = 浪費 evlog `error.data.why` / `error.data.fix` 結構化錯誤的核心特色。
review 時 grep 抓 `createError\(\{[^}]*\}\)` 不含 `why:` 一律列 🟠 Major。

### `internal` 機制

`internal` 內欄位會進 evlog wide event（debug 用），但**不**會被序列化進 HTTP response。用於把敏感 / 內部 metadata 送進 observability 卻不洩漏給 client：

```ts
throw createError({
  status: 500,
  message: '操作失敗',
  why: 'downstream service rejected payload',
  internal: {
    upstreamRequestId: result.requestId,
    upstreamStatus: result.upstreamStatus,
    actorId: user.id, // 不送 client，但需要進 evlog
  },
})
```

`message` / `why` / `fix` / `link` / `code` 仍會送 client。`cause` 由 evlog unwrap 但不入 response body。

### `code` 欄位

`code` 是機器可讀錯誤代號，client 用以做 i18n / 行為分支。命名規則：

- 全大寫 + underscore：`AUDIT_HASH_DRIFT`、`RATE_LIMIT_EXCEEDED`
- 不含 status code（已在 `status` 欄位）
- 跨 endpoint 共用代號（例：`UNIQUE_VIOLATION` 不分 table）

## log.error 參數必須非 null

```typescript
// ✅ 安全
if (fetchError.value) {
  log.error(fetchError.value as Error)
}

// ❌ fetchError.value 可能是 null
log.error(fetchError.value as Error) // null → runtime error or no-op
```

## 搜尋字串消毒

所有 `.or()` / `.ilike` 搜尋 **MUST** 使用 `sanitizePostgrestSearch()`：

```typescript
// ✅ 消毒後插值
const s = sanitizePostgrestSearch(search.trim())
query.or(`name.ilike.%${s}%,code.ilike.%${s}%`)

// ❌ 直接插值 — filter injection + ILIKE 萬用字元注入
query.or(`name.ilike.%${search}%`)
```

`sanitizePostgrestSearch` 處理 `,` `.` `(` `)` `%` `_` 六種特殊字元。

## log.set 時機

| 時機                 | 設定內容                             |
| -------------------- | ------------------------------------ |
| `requireAuth()` 之後 | `{ user: { id }, operation, table }` |
| 成功回傳前           | `{ result: { id, ...key fields } }`  |

GET endpoint 可省略 `log.set`，只需初始化 `useLogger(event)` + 錯誤時 `log.error`。

## Drain pipeline 規範

**MUST**：所有 drain 都必須走 `pipeline.wrap`，**禁止** raw drain 直接 ship event。

```ts
// ✅ 正確 — pipeline 包覆
import { createPipeline } from 'evlog'
import { createSentryDrain } from 'evlog/sentry'

const pipeline = createPipeline({
  batch: { maxSize: 50, maxAgeMs: 1000 },
  retry: { attempts: 3, backoffMs: [200, 1000, 3000] },
  onOverflow: 'drop-oldest',
  onError: (err, batch) => {
    console.error('[evlog drain pipeline error]', err.message, batch.length)
  },
})

const drain = pipeline.wrap(createSentryDrain({ dsn: process.env.SENTRY_DSN }))

// ❌ 錯誤 — raw drain
const drain = createSentryDrain({ dsn: process.env.SENTRY_DSN })
```

### 為什麼強制 pipeline

- Workers 50 subrequest budget — 沒 batch 一次 request 50 個 event 就用光
- Sentry / Axiom 限速會 429 — 沒 retry = drop = wide event 信號斷
- pipeline 失敗本身要可觀測 — 否則只看到「event 怎麼少了」沒線索

### 必要 hook（Cloudflare Workers）

```ts
// server/plugins/evlog-drain.ts
nitroApp.hooks.hook('request:end', (event) => {
  event.waitUntil?.(drain.flush())
})
```

`waitUntil` **MUST** wire — 否則 worker 結束時 in-memory batch 會被丟掉。

### 三條 meta-event 必接

drain pipeline emit 以下 meta-event，consumer **MUST** 接這三個並 ship 到 Sentry meta-channel：

| Event | 觸發 | 處理 |
| --- | --- | --- |
| `pipeline.overflow` | batch 滿 + onOverflow 啟動 | warn channel；> 10/min 必告警 |
| `pipeline.retry_exhausted` | retry 用光仍失敗 | error channel；ship 到自家 `evlog_dropped` 留底 |
| `pipeline.memory_warning` | batch buffer >1MB | warn channel；review batch size |

review 抓 `createSentryDrain\(` 不被 `pipeline.wrap` 包 → 🟠 Major。

## Sampling 強制下限

production sampling **MUST** 滿足以下下限：

| Level | 預設 | 強制最低 | 備註 |
| --- | --- | --- | --- |
| `error` | 100% | **100%** | 永遠不 sample |
| `audit` | 100% | **100%**（forceKeep） | audit 是合規剛需 |
| `warn` | 100% | 50% | 高量 warn route 可降到 50% |
| `info` | 50% | 10% | 預設 50%；無價值 info（health check）可降到 10% |
| `debug` | 0%（production） | — | production 不送 |

```ts
import { samplingPolicy } from 'evlog/sampling'

const sampling = samplingPolicy({
  default: 0.5,
  byLevel: {
    error: 1.0,
    warn: 1.0,
    info: 0.5,
    debug: 0,
  },
  byRoute: {
    'GET /api/health': 0.01,
    'POST /api/_evlog/ingest': 1.0, // client transport 不 sample
  },
  forceKeep: (event) => event.kind === 'audit',
})
```

review 抓 `samplingPolicy` 內 `error` 不為 1.0 或 `forceKeep` 漏 audit → 🔴 Critical。

## Redaction 強制條件

production **MUST** 開 `redactionPolicy`，至少包含 6 類 secret + audit drain `auditRedactPreset`：

```ts
import { redactionPolicy } from 'evlog/redaction'
import { auditRedactPreset } from 'evlog/audit'

const redaction = redactionPolicy({
  keys: [
    'password', 'token', 'apiKey', 'secret',
    'authorization', 'cookie',
    'access_token', 'refresh_token', 'id_token',
    'sessionId',
  ],
  patterns: [
    /sk-[A-Za-z0-9_-]{20,}/, // OpenAI / Anthropic API keys
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, // JWT
    /Bearer\s+[A-Za-z0-9._-]{20,}/,
  ],
  replace: '[REDACTED]',
  presets: { audit: auditRedactPreset },
})
```

### PII 分層

| 欄位 | server log | audit chain | client log |
| --- | --- | --- | --- |
| password / token / API key | ❌ redact | ❌ redact | ❌ redact |
| email | ✅ 可保留 | ❌ redact | ❌ redact |
| `client.ua` | ✅ 保留 | ❌ redact（PII） | ✅ 保留 |
| `req.geo.country` | ✅ 保留 | ✅ 保留（非 PII） | ✅ 保留 |
| `cf-ip*` headers | ❌ enricher 不准抓 | ❌ | ❌ |
| LLM raw prompt / output | ✅ 保留（短 TTL） | ❌ redact | — |

review 抓 `redactionPolicy` 不存在或 `keys` 缺 `password` / `token` / `authorization` → 🔴 Critical。

## Client logging 規範

client transport **MUST** 走 evlog 內建 `evlog/client` plugin（5 consumer 預設），高量 consumer 才轉 `createHttpLogDrain`。

### 安裝

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  evlog: {
    client: {
      enabled: true,
      endpoint: '/api/_evlog/ingest',
      minLevel: 'warn', // 預設只送 warn 以上；dev 可降 info
      suppressConsole: false, // dev 留著看；production 可開
      identity: { cookieName: 'evlog_identity' },
    },
  },
})
```

### setIdentity / clearIdentity

login 成功後 **MUST** 呼叫 `setIdentity({ userId, tenantId })`，logout 時呼叫 `clearIdentity()`。否則 client event 無法跟 server `requireAuth()` 後的 user 對齊。

```ts
// app/plugins/evlog-client.client.ts（pseudocode）
import { setIdentity, clearIdentity } from 'evlog/client'

watch(() => useUserSession().user, (user) => {
  if (user) {
    setIdentity({ userId: user.id, tenantId: user.tenantId })
  } else {
    clearIdentity()
  }
}, { immediate: true })
```

### `/api/_evlog/ingest` 必要保護

| 保護 | 強制？ | 為什麼 |
| --- | --- | --- |
| CSRF | ✅ | endpoint 接 client POST，沒 CSRF 等於開放放任意 ingest |
| rate-limit | ✅ | 建議 100 req/min/user；防 client bug 暴量 |
| body schema validation | ✅ | client 端可能誤送 password / token |
| `redactionPolicy` 二次套用 | ✅ | 信任邊界：client 送來的 event 必須再過一次 redaction |

### `minLevel` / `suppressConsole`

- `minLevel: 'warn'`：production 預設；info 不送 server（量太大 + 大多無價值）
- `suppressConsole: true`：production 可開，避免使用者打開 devtools 看到內部欄位
- dev 階段 `minLevel: 'debug'` + `suppressConsole: false`，方便 debug

### 不該用 client transport 的場景

- 純 SPA / 純 SSG — 沒 server endpoint 可以 ingest
- Edge-only worker — 沒 nuxt client plugin

## Typed fields 何時用

evlog typed fields 是「在 build time 確認 wide event 欄位 schema」的機制。evlog 2.16 用 plain TypeScript `interface` + `useLogger<T>(event)` generic 達成；**不**強制全用，但跨 endpoint 共用的 5 個核心欄位**建議**typed：

```ts
// server/utils/evlog-fields.ts
// 真實 evlog 2.16 API：plain interface（無 defineFields factory）
export interface EvlogFields {
  tenant?: { id: string }
  actor?: { id: string; role?: string }
  target?: { type: string; id: string }
  outcome?: 'success' | 'denied' | 'failure'
  auditEventId?: string
}

// 用法：
// import { useLogger } from 'evlog'
// const log = useLogger<EvlogFields>(event)
// log.info('action.done', { actor: { id }, target: { type, id }, outcome: 'success' })
```

> 反模式：`import { defineFields } from 'evlog/typed'` — 該 API 不存在於 evlog 2.16（早期 master plan 誤寫）。

### 採用判斷

| 情境 | 建議 |
| --- | --- |
| 跨 endpoint 共用欄位（user / target / tenant） | ✅ typed |
| endpoint-local debug 欄位（步驟 step / 計時 ms） | ⬜ 不需要 typed |
| audit 欄位（`auditEventId` / `prev_hash` / `hash`） | ✅ typed |
| AI 子事件（cost / tokens / tool） | ✅ typed（跨 AI endpoint 共用） |

### 為什麼不全用

- typed fields 增加維護成本（schema 改一處全 endpoint 重 build）
- evlog wide event 本身允許任意欄位；typed 只是給跨 endpoint 共用的核心欄位上鎖

### 反模式

- 把 client request body 整包塞進 typed fields → 失去 wide event 的彈性
- 為單一 endpoint 開 typed schema → 過度工程
- typed fields 與 redaction keys 命名不一致 → redaction 失效（typed 標記不會自動 redact）

## Enricher stack 標準（5 件套）

5 consumer 必裝 enricher（順序重要）：

```ts
// server/plugins/evlog-enrich.ts
nitroApp.hooks.hook('evlog:setup', ({ logger }) => {
  logger.use(userAgentEnricher())
  logger.use(requestSizeEnricher())
  logger.use(geoEnricher())
  logger.use(traceContextEnricher())
  logger.use(tenantEnricher({
    resolve: (event) => event.context.tenantId ?? null,
  }))
})
```

| Enricher | 加什麼欄位 |
| --- | --- |
| `userAgentEnricher()` | `client.ua` / `client.ua_family` / `client.os` / `client.device` |
| `requestSizeEnricher()` | `req.size_bytes` / `req.content_type` |
| `geoEnricher()` | `req.geo.country` / `req.geo.colo` / `req.geo.tz`（從 `cf-*` headers） |
| `traceContextEnricher()` | `trace.trace_id` / `trace.span_id` / `trace.parent_span_id` |
| `tenantEnricher({ resolve })` | `tenant.id` / `tenant.tier`（multi-tenant 必裝） |

`tenantEnricher` 必須在 `nuxt-auth-utils` plugin 之後 register（否則 resolve 拿不到 user context）。

review 抓 `evlog:setup` hook 內缺前 4 個 enricher → 🟠 Major。

## Review 檢查

```bash
# Drain pipeline
rg -n 'createSentryDrain\(' server | rg -v 'pipeline\.wrap'
rg -n 'createPipeline\(' server | wc -l

# Sampling
rg -nB1 -A3 'samplingPolicy\(' server | rg -B5 -A5 'error:\s*1\.0'

# Redaction
rg -n 'redactionPolicy\(' server | wc -l
rg -nA10 'redactionPolicy\(' server | rg "password|token|authorization"

# Client transport
rg -n "client:\\s*\\{[^}]*enabled:\\s*true" nuxt.config.ts

# Structured error（PCRE2 lookahead — rg 預設 Rust regex 引擎不支援，必須 -P）
rg -P -n 'createError\(\{(?![^}]*why)' server packages clients

# Enricher stack
rg -n "userAgentEnricher\\(|geoEnricher\\(|traceContextEnricher\\(" server/plugins
```

完整 review automation 在 M2 階段補：`scripts/evlog-adoption-audit.mjs`（spec 見 `docs/evlog-master-plan.md` § 10）。
