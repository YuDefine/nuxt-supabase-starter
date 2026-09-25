---
description: 專案目前未使用的 Supabase 功能 — 引入前的決策與規約
paths: ['supabase/migrations/**/*.sql', 'server/**/*.ts', 'packages/*/server/**/*.ts', 'app/**/*.{ts,vue}', 'packages/*/app/**/*.{ts,vue}']
---
<!-- Clade native rule; source: rules/modules/db-runtime/cf-workers/unused-features.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Unused Features Guardrails

> 本檔是 clade 投影，**NEVER** 就地編輯。專案特化寫進自家 `.claude/rules/local/`；要改本檔請回 clade 源檔並 propagate。

Template 預設**不啟用**以下 Supabase feature。引入任一項前 **MUST**：列出觸發需求與為何現有工具（server API + polling、Cloudflare Workers Cron Trigger / Queues）不夠 → 評估替代方案 → 記錄 `docs/decisions/YYYY-MM-DD-<feature>.md` → 把章節從本檔移除或移到對應主題的 rule 檔。

## Supabase Storage

現況：未使用。先回答檔案類型 / 大小 / 使用者量、公開或私密；部署在 Workers 時優先評估 Cloudflare R2（原生整合、無 egress fee）。引入規約見 `storage.md`。

## Realtime（WebSocket subscriptions）

現況：未使用（走 polling / `refetch`）。傳統 Workers **無法代理 WebSocket**：需要時讓前端直連 Supabase Realtime（設好 CORS + RLS），或 server 側 fan-out 改用 Durable Objects。引入時 **MUST** `config: { private: true }` 並關閉 "Allow public access"、在 `realtime.messages` 寫 SELECT + INSERT policy；**NEVER** 用 `postgres_changes` 監聽敏感表（replication stream 不套 RLS）；channel 命名 `<entity>:<id>`；`onUnmounted` **必須** `channel.unsubscribe()`。

## Supabase Edge Functions（Deno）

部署到 Cloudflare Workers（預設）時 **NEVER** 引入 Supabase Edge Functions（兩套 runtime、兩套部署管線），server logic 一律寫 Nuxt server API；Vercel / Node 同樣不必要。唯一合理用途是 DB trigger 經 `pg_net` 呼叫、且應用層無法處理的 webhook 邏輯（cold start ~500ms、只能 import Deno-compatible module、secrets 用 `Deno.env.get()` + `supabase secrets set`、logging 與 evlog 不通）。

## Queues（`pgmq` extension）

現況：未使用。先回答為何不用 Cloudflare Queues 或 Workers Cron Trigger、工作是否真的需要 async（> 5 秒 + 可重試）。真要用：`create extension pgmq with schema extensions;`、queue 命名 `<entity>_<action>`、依任務調 visibility timeout、**MUST** 設最大 retry、consumer 必須冪等（見 `api-patterns.md`）。

## Cron（`pg_cron`）+ pg_net

現況：未使用。**優先使用應用層 cron**（Workers `wrangler.toml` `[triggers] crons`、Vercel Cron、Nuxt Hub Scheduled Tasks），只有排程以 DB state 為中心或需存取應用層碰不到的內網資源時才考慮 `pg_cron + pg_net`。引入時 schedule 寫 UTC 並註解當地時間、job 名建立後不改（`cron.schedule` 以名稱 upsert）、pg_net 是 fire-and-forget 不 retry（另查 `net._http_response`）、**NEVER** 在 RLS policy 內呼叫 `net.http_*`、每週掃 `cron.job_run_details`。

## Vector / pgvector

現況：未使用。先回答要 embed 什麼、`tsvector` 是否就夠、embedding 來源；部署在 Workers 時評估 Cloudflare Vectorize。真要用：dimension 固定、index 在資料填完後建、embedding API **NEVER** 從 client 呼叫、vector 欄位仍要寫 RLS。

## Supabase Vault / 欄位加密

現況：未使用。先回答哪些欄位要加密、誰能解密、key rotation 流程；優先評估應用層加解密，key 不寫進 migration，由 env / KMS 管。

## Auth Hooks（Custom Access Token 等）

現況：未使用。要在 JWT 注入 claims 時 hook function **MUST** 是 `SECURITY DEFINER` 且 `SET search_path = ''`；**NEVER** 在 hook 內做昂貴 query（每次 token refresh 都跑）；**NEVER** 覆寫 required claims（`iss`, `aud`, `exp`, `iat`, `sub`, `role`, `aal`, `session_id`, `email`, `phone`, `is_anonymous`）。

## Custom Database Schema

現況：只用 `public`；private schema 規約見 `migration.md`。
