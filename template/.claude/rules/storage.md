---
description: Supabase Storage 使用規範（上傳、signed URL、policy、清理）
globs: ['server/api/**/*.ts', 'supabase/migrations/**/*.sql']
---

# Storage

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。

Template 預設**未使用** Supabase Storage。若專案要引入檔案上傳功能，先評估：

- 檔案類型、大小、使用者量？
- 公開還是私密？
- 是否需要 CDN / image transformation？
- Supabase Storage vs **Cloudflare R2**：
  - R2：與 Workers 整合原生、無 egress fee、可直傳
  - Supabase Storage：與 Supabase Auth / RLS 整合、內建 image transformation

## 上傳路徑與責任分離

- **Client 直接上傳**：**NEVER** — 所有上傳必須經過 `server/api/**/upload.post.ts`，由 server 用 service_role 代寫
- **Server 上傳模式**：`supabase.storage.from(bucket).upload(path, file, { contentType, upsert })`
- **檔名產生**：**MUST** 用 server 端產生（`{entity_id}/{timestamp}-{random}.{ext}`），**NEVER** 信任前端傳來的檔名 — 防止 path traversal 與覆寫攻擊
- **MIME 驗證**：**MUST** 在 server 端驗證 `file.type` + `file.size`，不要只靠 bucket 設定
- **Cloudflare Workers 上傳限制**：單一 request body ≤100MB，大檔需改用 resumable upload（TUS 協定）或直傳 R2

## Public vs Signed URL

| 場景                    | 用法                               | 說明                 |
| ----------------------- | ---------------------------------- | -------------------- |
| Public bucket 永久連結  | `getPublicUrl(path)`               | 只能用在**公開**資料 |
| Private bucket 臨時讀取 | `createSignedUrl(path, expiresIn)` | 所有**敏感**資料     |

### Signed URL Expiry 策略

| 資料類型                      | 建議 expiry | 理由                               |
| ----------------------------- | ----------- | ---------------------------------- |
| 使用者即時瀏覽（list/detail） | **1 小時**  | 夠用一次 session，離開後自動失效   |
| 下載按鈕（一次性）            | **5 分鐘**  | 產生後立即點擊，縮小洩漏窗口       |
| Email / 通知內嵌連結          | **24 小時** | 讓收件人有時間開信                 |
| **禁止** 1 個月以上           | —           | 等同公開連結，違反 signed URL 意圖 |

## Bucket Policy（RLS on `storage.objects`）

Storage 的 RLS 跑在 `storage.objects` 表上，與一般表規則相同：

- **Upsert 需要 INSERT + SELECT + UPDATE 三個 policy** — 少一個就靜默失敗
- **Delete 需要 DELETE policy**
- **Bucket 隔離**：policy 必須 `bucket_id = 'xxx'` 過濾 — 否則 cross-bucket 權限洩漏
- **資料夾層級權限**：用 `(storage.foldername(name))[1] = <user_id>` 強制使用者只能存取自己的資料夾

### Service Role Bypass

Server 端用 `getSupabaseWithContext(event)` 或 `useServiceClient()` 取得的 client 具備 `service_role`，**bypass 所有 storage policy**。所有上傳邏輯在 API handler 中明確檢查權限（`requireAuth()` + 業務邏輯），policy 是最後一道防線。

## 上傳失敗的 Rollback

Storage upload 與 DB insert 是**獨立操作**，沒有 transaction 保證。正確順序：

```typescript
// 1. 先 upload 到 storage
const { data: uploadData, error: uploadError } = await supabase.storage
  .from(BUCKET)
  .upload(path, file, { contentType, upsert: false })

if (uploadError) {
  log.error(uploadError as Error, { step: 'storage-upload' })
  throw createError({ status: 500, message: '檔案上傳失敗' })
}

// 2. 再寫 DB
const { error: dbError } = await supabase.from('table').insert({ ... })

if (dbError) {
  // Rollback: 刪掉剛剛上傳的檔案
  await supabase.storage.from(BUCKET).remove([uploadData.path])
  log.error(dbError as Error, { step: 'db-insert' })
  throw createError({ status: 500, message: '資料寫入失敗' })
}
```

**NEVER** 先寫 DB 再 upload — DB insert 成功後若 upload 失敗，會留下無檔案的 row。

## 檔案清理（避免孤兒檔案）

Delete 流程必須**同時清理 DB row 與 storage 檔案**：

```typescript
// 1. 先從 DB 取出 path
const { data: row } = await supabase.from('table').select('file_path').eq('id', id).single()

// 2. 刪 DB row
const { error } = await supabase.from('table').delete().eq('id', id)

// 3. 刪 storage 檔案（即使失敗也不 rollback — DB 是 source of truth）
if (row?.file_path) {
  await supabase.storage.from(BUCKET).remove([row.file_path])
}
```

### 週期性清理

新增 bucket 時在 proposal 明確記錄「清理責任」— 由誰、何時、如何清理。可用的清理機制：

- Cloudflare Workers Cron Trigger 掃 storage 找孤兒檔案
- 手動 script 定期執行
- Delete trigger（但 trigger 在大量刪除時效能差）

## 檔案大小與 MIME 限制

- **MUST** 在 bucket 設定 `file_size_limit`
- **MUST** 在 bucket 設定 `allowed_mime_types` — 限制 `image/jpeg`, `image/png`, `application/pdf` 等
- **Server 端再次驗證** — bucket 限制是最後防線，API handler 應先檢查並給友善錯誤

## 檔名合法字元

Supabase Storage 接受的檔名字元有限（alphanumeric + `_-.,'!*&$@=;:+?()` + 空白）。**MUST** slugify / normalize 後再用，**NEVER** 直接使用使用者原檔名（可能含中文、`/`、`\` 等）作為 path。
