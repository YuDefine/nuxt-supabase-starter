---
name: "clade-data"
description: "Database, schema, storage, logging, and data-path rules. Use when changing persistence, migrations, queries, RLS, database environments, or application logging; also before running integration tests, needing a test or dev database, running any supabase CLI command, or deciding where the dev DB lives. Also use when: 使用者描述 prod／staging 的 runtime 症狀（5xx、錯誤 toast、變慢、間歇、特定 user 異常）、要開始查原因時，在 grep code／查 codebase／派 Explore 之前."
---

# SOP

## Phase 1 -- 用任務挑出要讀的 rule

1. READ 逐條對照接下來要做的事：條件成立才把該 rule 列入候選，NEVER 整批讀。
   - `rules/audit-schema.md`：Supabase audit table schema 慣例（audit_logs）；且碰 `supabase/migrations/**/*.sql`、`server/utils/audit*.ts`、`packages/*/server/utils/audit*.ts` 等 5 處
   - `rules/database-access.md`：資料庫存取模式（Supabase client/server 分工）；且碰 `app/**/*.{vue,ts}`、`packages/*/app/**/*.{vue,ts}`、`server/**/*.ts` 等 4 處
   - `rules/db-preview-env.md`：PR-isolated DB preview environment capability + safety contract（不限工具、不限 topology）；且碰 `supabase/migrations/**/*.sql`、`.github/workflows/**/*.yml`、`docker-compose*.yml` 等 8 處
   - `rules/declarative-schema.md`：Supabase 宣告式 schema（supabase/schemas + pg-delta）的採用判定與 sync 產出的處置義務；且碰 `supabase/schemas/**`、`supabase/config.toml`
   - `rules/evlog-adoption.catalogs.md`：evlog catalogs 採用全文（defineErrorCatalog/defineAuditCatalog、命名規約、結構原則、動態訊息與 internal 合併、sharding 路徑、反模式、review grep；evlog floor ^2.17.0 SoT）；常駐 pointer 在 [[evlog-adoption]]，觸發時機是「新增 catalog、把 ad-hoc createError 遷進 catalog、或寫 catalog 測試之前」，由 [[evlog-adoption]] 的 MUST-Read 指針叫醒；且碰 `server/**`、`packages/**/server/**`、`specs/plans/*evlog*/**`
   - `rules/evlog-adoption.decision.md`：evlog 採用路徑選型全文（stack decision matrix、5 個 plan package template、3 個 starter preset、drain 選擇指引、migration 順序建議）；常駐 pointer 在 [[evlog-adoption]]，觸發時機是「為 consumer 選 evlog template / preset / drain，或排 migration 順序之前」，由 [[evlog-adoption]] 的 MUST-Read 指針叫醒；且碰 `specs/plans/**`、`nuxt.config.ts`、`packages/**/nuxt.config.ts` 等 5 處
   - `rules/evlog-adoption.depth-gate.md`：evlog adoption depth 自評與 evlog map coverage gate 全文（depth 1-6 自評表、MUST/MUST NOT、四條 false green、strict gate 兩道、ratchet 退場條件）；常駐 pointer 在 [[evlog-adoption]]，觸發時機是「評估 consumer evlog 覆蓋率、看 evlog map 分數、或判定 entry point gate 之前」，由 [[evlog-adoption]] 的 MUST-Read 指針叫醒；且碰 `evlog.map.json`、`packages/**/evlog.map.json`、`specs/plans/**` 等 8 處
   - `rules/evlog-adoption.md`：evlog 14 區塊全功能採用治理（template 選擇、preset、depth 自評、migration 順序）；且碰 `nuxt.config.ts`、`server/plugins/evlog-*.ts`、`app/plugins/evlog-*.ts` 等 6 處
   - `rules/evlog-error-exposure.md`：寫 createError 的 why / fix / internal 時，判斷哪些內容可以進 HTTP response、哪些必須只留在 log——受眾是已驗證使用者、尚未驗證的 caller、還是只有維運者；且碰 `server/api/**`、`server/routes/**`、`server/middleware/**` 等 8 處
   - `rules/evlog-investigate.md`：prod runtime 問題用 evlog wide event 調查的協定（消費側；先查 evlog 再從 code 對因）；或使用者描述 prod／staging 的 runtime 症狀（5xx、錯誤 toast、變慢、間歇、特定 user 異常）、要開始查原因時，在 grep code／查 codebase／派 Explore 之前；且碰 `server/**`、`packages/**/server/**`、`clients/**/server/**` 等 8 處
   - `rules/evlog-stream-extend.md`：evlog 讀端 opt-in 擴充（stream/fs-reader/enricher/tail-sampling）適用時載入；且碰 `server/api/**/*.ts`、`server/plugins/evlog-*.ts`、`app/plugins/evlog-*.ts` 等 7 處
   - `rules/logging.client-fields.md`：evlog client transport 規範與 typed fields 採用判斷全文（setIdentity／clearIdentity、_evlog/ingest 保護、minLevel、typed fields 五核心欄位）；常駐 pointer 在 [[logging]]，觸發時機是「寫 client-side logging、typed fields schema 或 _evlog/ingest endpoint 之前」，由 [[logging]] 的 MUST-Read 指針叫醒；且碰 `app/**/*.ts`、`app/**/*.vue`、`packages/**/app/**/*.ts` 等 10 處
   - `rules/logging.drain-pipeline.md`：evlog server plugin wiring 全文（drain pipeline 強制包覆、Cloudflare Workers afterResponse flush／waitUntil、三條 meta-event、Enricher stack 5 件套）；常駐 pointer 在 [[logging]]，觸發時機是「動 server/plugins 的 evlog drain / enricher wiring 之前」，由 [[logging]] 的 MUST-Read 指針叫醒；且碰 `server/plugins/evlog-*.ts`、`packages/**/server/plugins/evlog-*.ts`、`nuxt.config.ts` 等 4 處
   - `rules/logging.error-contract.md`：Server handler 錯誤契約全文（log.error 時機與單次呼叫、handleDbError、createError 必帶 why／internal／code 欄位契約 SoT、log.error 參數非 null、搜尋字串消毒）；常駐 pointer 在 [[logging]]，觸發時機是「在 server handler 寫 throw createError / log.error / handleDbError / .or() 搜尋之前」，由 [[logging]] 的 MUST-Read 指針叫醒；且碰 `server/api/**/*.ts`、`server/routes/**/*.ts`、`server/middleware/**/*.ts` 等 8 處
   - `rules/logging.md`：Server / client logging 與錯誤記錄規範（evlog）；且碰 `server/api/**/*.ts`、`server/plugins/evlog-*.ts`、`app/plugins/evlog-*.ts` 等 7 處
   - `rules/logging.sampling-redaction.md`：evlog sampling 強制下限與 redaction 強制條件全文（含 PII 分層表、audit forceKeep wiring）；常駐 pointer 在 [[logging]]，觸發時機是「改 nuxt.config 的 evlog.sampling / evlog.redact 或 audit forceKeep wiring 之前」，由 [[logging]] 的 MUST-Read 指針叫醒；且碰 `nuxt.config.ts`、`packages/**/nuxt.config.ts`、`server/plugins/evlog-*.ts` 等 4 處
   - `rules/mcp-remote.md`：遠端 Supabase MCP 使用限制；且碰 `supabase/migrations/**/*.sql`、`server/**/*.ts`、`packages/*/server/**/*.ts`
   - `rules/migration.md`：Supabase Migration 操作規範；且碰 `supabase/migrations/**/*.sql`、`server/**/*.ts`、`packages/*/server/**/*.ts`
   - `rules/query-optimization.md`：查詢優化、EXPLAIN、index 設計與 RLS 效能測量；且碰 `supabase/migrations/**/*.sql`、`server/api/**/*.ts`、`packages/*/server/api/**/*.ts`
   - `rules/rls-policy.md`：RLS Policy 撰寫規範；且碰 `supabase/migrations/**/*.sql`
   - `rules/storage.md`：Supabase Storage 與 Cloudflare R2 使用規範（上傳、物件 key、signed URL、policy、清理）；且碰 `server/api/**/*.ts`、`packages/*/server/api/**/*.ts`、`supabase/migrations/**/*.sql`
   - `rules/trigger.md`：Postgres Trigger 撰寫規範；且碰 `supabase/migrations/**/*.sql`
   - `rules/unused-features.md`：專案目前未使用的 Supabase 功能 — 引入前的決策與規約；且碰 `supabase/migrations/**/*.sql`、`server/**/*.ts`、`packages/*/server/**/*.ts` 等 5 處

## Phase 2 -- 只讀候選 rule 中與任務相關的段落

1. READ `rules/_sections.md` 中候選 rule 的區塊（首行 `<file> — `、空行結束；用 Grep 加 `-A 40` 取（區塊最長約 38 行，讀到空行為止，其後是下一份 rule 的區塊），NEVER 整份讀索引），只挑與任務相關的段落，用 Read 的 offset／limit 讀該行號區間。
2. READ 標題看不出相關與否的 rule 才整份讀；NEVER 用條件清單或段落索引代替 rule 內文。
