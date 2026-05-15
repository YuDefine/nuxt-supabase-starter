<!--
🔒 LOCKED — managed by clade
Source: rules/modules/db-runtime/cf-workers/unused-features.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: 專案目前未使用的 Supabase 功能 — 引入前的決策與規約
paths: ['supabase/migrations/**/*.sql', 'server/**/*.ts', 'app/**/*.{ts,vue}']
---

# Unused Features Guardrails

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。

Template 預設**不啟用**以下 Supabase feature。從 template 衍生出的新專案應保持保守，引入前先通過決策點。

引入前 checklist：

1. 列出觸發需求（哪個 user journey 需要、為何現有工具不夠）
2. 評估替代方案（通常 server API + polling、或 Cloudflare Workers Cron Trigger / Queues 夠用）
3. 記錄到 `docs/decisions/YYYY-MM-DD-<feature>.md`
4. 更新本檔：把章節移除或移到對應主題的 rule 檔

---

## Supabase Storage

**現況**：未使用。

### 引入前必須回答

- 檔案類型、大小、使用者量？
- 公開還是私密？
- **Supabase Storage vs Cloudflare R2**：若部署到 Cloudflare Workers，R2 整合更原生、無 egress fee

### 引入規約

見 `storage.md`（template 預先提供）。

---

## Realtime（WebSocket subscriptions）

**現況**：未使用。資料更新走 polling / `refetch`。

### Cloudflare Workers 的特殊限制

傳統 Cloudflare Workers **無法代理 WebSocket**（僅 Durable Objects 支援）。若部署到 Workers 而需要 Realtime：

- **Client → Supabase 直連**：前端直接連 Supabase Realtime（不經 Workers），需正確設定 CORS + RLS
- **Cloudflare Durable Objects**：若需 server 側 fan-out，改用 Durable Objects + WebSocket

### 引入前必須回答

- 為何 polling 不夠？可接受的延遲是多少？
- 是 `postgres_changes`、`broadcast` 還是 `presence`？
- 需要多少 concurrent connection？

### 引入規約

- **Private channel 強制**：`config: { private: true }`，Realtime Settings 關閉 "Allow public access"
- **Authorization via RLS on `realtime.messages`**：寫 SELECT + INSERT policy
- **NEVER** 用 `postgres_changes` 監聽敏感表 — RLS 不會套用在 replication stream，改用 broadcast + server 主動推
- **Channel 命名**：`<entity>:<id>` — 避免 wildcard 訂閱造成 broadcast storm
- **Unsubscribe 強制**：`onUnmounted` 必須 `channel.unsubscribe()`

---

## Supabase Edge Functions（Deno）

**現況**：未使用。

### 規則

若部署到 **Cloudflare Workers**（預設）→ **NEVER** 引入 Supabase Edge Functions，角色重疊會造成兩套 runtime、兩套部署管線。所有 server logic 一律寫 Nuxt server API。

若部署到 **Vercel / Node**：Edge Functions 仍不必要（已有 server API runtime）。

唯一合理用途：從 DB trigger 經 `pg_net` 呼叫的 webhook 邏輯，且該邏輯無法在應用層處理。

### 引入規約（若真要用）

- **Cold start**：首次呼叫 ~500ms，不適合 user-facing 即時操作
- **Dependency 限制**：只能 import Deno-compatible module
- **Secrets**：用 `Deno.env.get()` + `supabase secrets set`
- **CORS**：每個 function 自己處理
- **Logging**：`console.log` / `console.error` 經 Supabase log 收集 — 與 evlog 不通

---

## Queues（`pgmq` extension）

**現況**：未使用。背景工作可用 Cloudflare Workers Cron Trigger / Queue 或 Vercel Cron。

### 引入前必須回答

- 為何不用 **Cloudflare Queues**？（原生整合 Workers 生態系）
- 為何不用 **Workers Cron Trigger**？
- 工作是否真的需要 async？（> 5 秒 + 可重試）

### 若真的要用 pgmq

- **MUST** 啟用 extension：`create extension pgmq with schema extensions;`
- **Queue 命名**：`<entity>_<action>`
- **Visibility timeout**：預設 30 秒，長任務需調整
- **Dead letter queue**：**MUST** 設最大 retry 次數
- **Consumer 必須冪等**（見 `api-patterns.md`）

---

## Cron（`pg_cron`）+ pg_net

**現況**：未使用。週期性工作改用 Cloudflare Workers Cron Trigger（原生支援）。

### 規則

**優先使用應用層 cron**：

- Cloudflare Workers → `wrangler.toml` 的 `[triggers] crons = [...]`
- Vercel → Vercel Cron
- Nuxt Hub → Scheduled Tasks

只有以下情境才考慮 `pg_cron + pg_net`：

- 排程必須以 DB state 為中心（如 `delete from tasks where expired_at < now()`）
- 應用層無法存取的內網資源

### 若真的要引入 pg_cron / pg_net

- **MUST** 啟用 extensions：`create extension pg_cron; create extension pg_net;`
- **Timezone 陷阱**：pg_cron 使用 server timezone，schedule 寫 UTC + 註解當地時間
- **Job 名一旦建立就不改**：`cron.schedule` 用名稱做 upsert
- **pg_net fire-and-forget**：**不會 block**、**無法即時取得 response**，需另查 `net._http_response` 表
- **NEVER** 在 RLS policy 內呼叫 `net.http_*` — per-row 執行會發 N 次 HTTP
- **pg_net 不 retry** — 失敗需業務邏輯自行處理
- **監控**：每週掃 `cron.job_run_details` 找失敗 job

---

## Vector / pgvector

**現況**：未使用。

### 引入前必須回答

- 要 embed 什麼資料？大小與更新頻率？
- 傳統 full-text search `tsvector` 是否夠用？
- Embedding 從哪來？
- **pgvector vs Cloudflare Vectorize**：若部署到 Workers，Vectorize 整合更原生

### 若真的用 pgvector

- **MUST** 啟用 extension：`create extension vector with schema extensions;`
- **Dimension 固定**：`vector(1536)` — 選定 model 後不能隨便改
- **Index 必須在資料填完後建** — 空表建 ivfflat index 會退化
- **Embedding API 呼叫在 server 端** — **NEVER** 從 client 呼叫（會洩漏 API key）
- **RLS 仍要寫** — vector 欄位不自動 bypass RLS

---

## Supabase Vault / 欄位加密

**現況**：未使用。

### 引入前必須回答

- 哪些欄位需要加密？（法規要求 / 外洩風險）
- 誰能解密？
- Key rotation 流程？

### 規約

- 優先評估應用層加解密（避免 DB log 洩漏）
- Key 不落地：不寫進 migration，由 env / KMS 管

---

## Auth Hooks（Custom Access Token 等）

**現況**：未使用。

若要在 JWT 注入額外 claims：

- **MUST** 驗證 hook function 為 `SECURITY DEFINER` 且 `SET search_path = ''`
- **NEVER** 在 hook 內做昂貴 query — 每次 token refresh 都會跑
- **NEVER** 覆寫 required claims（`iss`, `aud`, `exp`, `iat`, `sub`, `role`, `aal`, `session_id`, `email`, `phone`, `is_anonymous`）

---

## Custom Database Schema

**現況**：只用 `public`。

引入 private schema（`core` / `internal`）的規約見 `migration.md`。
