<!--
🔒 LOCKED — managed by clade
Source: rules/core/logging.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Server API logging 與錯誤記錄規範（evlog）
globs: ['server/api/**/*.ts']
---

# Logging

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
