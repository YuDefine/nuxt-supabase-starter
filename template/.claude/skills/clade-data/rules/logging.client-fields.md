---
description: evlog client transport 規範與 typed fields 採用判斷全文（setIdentity／clearIdentity、_evlog/ingest 保護、minLevel、typed fields 五核心欄位）；常駐 pointer 在 [[logging]]，觸發時機是「寫 client-side logging、typed fields schema 或 _evlog/ingest endpoint 之前」，由 [[logging]] 的 MUST-Read 指針叫醒
paths:
  - 'app/**/*.ts'
  - 'app/**/*.vue'
  - 'packages/**/app/**/*.ts'
  - 'packages/**/app/**/*.vue'
  - 'server/utils/**/*.ts'
  - 'packages/**/server/utils/**/*.ts'
  - 'server/api/**/*.ts'
  - 'packages/**/server/api/**/*.ts'
  - 'nuxt.config.ts'
  - 'packages/**/nuxt.config.ts'
---
<!-- Clade native rule; source: rules/modules/capabilities/evlog/logging.client-fields.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Logging — Client transport 與 typed fields（全文）

> 本檔是 [[logging]] 的下推全文之一。本檔管 client transport 規範與 typed fields 採用判斷——兩個都是「採用與否」要先判對的區塊。

## Client logging 規範

client transport **MUST** 走 evlog/nuxt module 內建 transport + `evlog/client` runtime helper。高量 consumer 才轉自家 `createHttpLogDrain`。

### 安裝

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['evlog/nuxt'],
  evlog: {
    transport: {
      enabled: true,
      endpoint: '/api/_evlog/ingest',
      credentials: 'same-origin',
    },
  },
})
```

### setIdentity / clearIdentity

login 成功後 **MUST** 呼叫 `setIdentity({ userId, tenantId })`，logout 時呼叫 `clearIdentity()`。否則 client event 無法跟 server `requireAuth()` 後的 user 對齊。

```ts
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
| CSRF | ✅ | module 自動註冊的 endpoint 接 client POST；需由 consumer 的安全 middleware / platform policy 保護 |
| rate-limit | ✅ | 建議 100 req/min/user；防 client bug 暴量 |
| body schema validation | module 內建 | client 端可能誤送 password / token |
| `evlog.redact` 二次套用 | ✅ | 信任邊界：client 送來的 event 必須再過一次 redaction |

### `minLevel` / `suppressConsole`

- `setMinLevel('warn')`：production 可用；info 不送 server（量太大 + 大多無價值）
- `console: false`：由 nuxt module config 控制 console suppression
- dev 階段可 `setMinLevel('debug')`，方便 debug

反模式：
- 自寫 `app/plugins/evlog-client.client.ts` 包 `createHttpLogDrain` + `initLog({ drain })`
- 自寫 `server/api/_evlog/ingest.post.ts` 跟 module handler 搶同一路徑

### 不該用 client transport 的場景

- 純 SPA / 純 SSG — 沒 server endpoint 可以 ingest
- Edge-only worker — 沒 nuxt client plugin

## Typed fields 何時用

evlog typed fields 是「在 build time 確認 wide event 欄位 schema」的機制。evlog（floor ^2.17.0，見 [[evlog-adoption.catalogs]]）用 plain TypeScript `interface` + `useLogger<T>(event)` generic 達成；**不**強制全用，但跨 endpoint 共用的 5 個核心欄位**建議**typed：

```ts
// server/utils/evlog-fields.ts
// 真實 evlog API（floor ^2.17.0）：plain interface（無 defineFields factory）
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

> 反模式：`import { defineFields } from 'evlog/typed'` — 該 API 不存在於 evlog（floor ^2.17.0，見 [[evlog-adoption.catalogs]]）。

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
