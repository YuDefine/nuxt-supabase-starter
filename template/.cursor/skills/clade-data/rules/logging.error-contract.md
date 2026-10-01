---
description: Server handler 錯誤契約全文（log.error 時機與單次呼叫、handleDbError、createError 必帶 why／internal／code 欄位契約 SoT、log.error 參數非 null、搜尋字串消毒）；常駐 pointer 在 [[logging]]，觸發時機是「在 server handler 寫 throw createError / log.error / handleDbError / .or() 搜尋之前」，由 [[logging]] 的 MUST-Read 指針叫醒
paths:
  - 'server/api/**/*.ts'
  - 'server/routes/**/*.ts'
  - 'server/middleware/**/*.ts'
  - 'server/utils/**/*.ts'
  - 'packages/**/server/api/**/*.ts'
  - 'packages/**/server/routes/**/*.ts'
  - 'packages/**/server/middleware/**/*.ts'
  - 'packages/**/server/utils/**/*.ts'
---
<!-- Clade native rule; source: rules/modules/capabilities/evlog/logging.error-contract.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Logging — Error contract（全文）

> 本檔是 [[logging]] 的下推全文之一。[[logging]] 常駐 Logger 選擇、log.set 時機與 Review 檢查；本檔管 server handler 層的錯誤寫法。

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

此專案的 `handleDbError` **returns**（不 throw），必須自行 throw（上例的寫法）；只呼叫 `handleDbError(error)` 而不 throw = 錯誤被吞掉、程式繼續執行。

## createError 必帶 why（structured error 必填欄位）

> 新增 endpoint 應改走 catalog factory（`throw billingErrors.PAYMENT_DECLINED({ ... })`）；catalog 內的 `why` / `fix` / `link` 預先宣告，呼叫端不需重複。詳見 [[evlog-adoption.catalogs]]。本節規則套用在 catalog 尚未涵蓋的場景與既存未遷移的 ad-hoc createError。

`server/api/**` 的非預期錯誤路徑，`throw createError(...)` **MUST** 帶 `why`；其餘欄位依下表必填/建議/選用。本表是 `why` / `fix` 欄位契約的 SoT；受眾（已驗證使用者 / pre-auth caller / 只有維運者）如何影響這兩欄的**措辭與去處**見 [[evlog-error-exposure]]。

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

`internal` 內欄位會進 evlog wide event（debug 用），但**不**序列化進 HTTP response（`message` / `why` / `fix` / `link` / `code` 仍會送 client；`cause` 由 evlog unwrap 但不入 response body）。敏感 / 內部 metadata（upstream request id、actor id）放這裡。

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
