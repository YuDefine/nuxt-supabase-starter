<!-- Clade native rule; generated section index of rules/*.md; edit canonical sources -->
行號 1 起算、含端點；Read 用 offset=起、limit=迄-起+1。

audit-schema.md — Supabase audit table schema 慣例（audit_logs）
5-10 前導 — Audit Schema Conventions（supabase variant）
12-31 表名與基本欄位
33-41 D-pattern Hash Chain 規約
43-62 Audit helper 接口
64-74 高風險 mutation atomicity
76-90 Audit chain verifier
92-100 evlog signed chain overlay（O1，optional）
102-106 Reference

database-access.md — 資料庫存取模式（Supabase client/server 分工）
5-22 前導 — Database Access Pattern
24-28 MCP 存取
30-34 Seed 資料
36-39 Client 查詢效能
41-83 Connection Pool 與監控
85-90 Transaction 與批次寫入
92-96 Drizzle 使用邊界
98-116 部署目標的連線限制

db-preview-env.md — PR-isolated DB preview environment capability + safety contract（不限工具、不限 topology）
5-16 前導 — DB Preview Environment（capability + safety contract）
18-69 為什麼不規定 topology
73-78 MUST › 1. Schema migration gate（必備）
80-87 MUST › Trigger 由 `workflow_model` 決定
89-95 MUST › 2. Staging isolation（必備）
97-108 MUST › 3. Production data sanitization（必備條件）
110-117 MUST › 4. Preview lifecycle（compose-stack / lxc-stack 才適用）
119-129 MUST › 5. Production migration classification + gate
131-141 MUST › 6. 主幹 deploy gate
143-147 SHOULD
149-188 Managed-platform preview（`shared-preview-db`）
190-203 Capability declaration
205-213 反模式
215-219 相關

declarative-schema.md — Supabase 宣告式 schema（supabase/schemas + pg-delta）的採用判定與 sync 產出的處置義務
5-12 前導 — 宣告式 schema（pg-delta）
14-22 採用判定
24-37 sync 產出是草稿，不是 migration
39-57 不能用 sync 產生的變更
59-63 GRANT 展開
65-69 Cloud 專用指令
71-74 混用兩個引擎
76-80 config.toml 的 experimental 段落

evlog-adoption.catalogs.md — evlog catalogs 採用全文（defineErrorCatalog/defineAuditCatalog、命名規約、結構原則、動態訊息與 internal 合併、sharding 路徑、反模式、review grep；evlog floor ^2.17.0 SoT）；常駐 pointer 在 [[evlog-adoption]]，觸發時機是「新增 catalog、把 ad-hoc createError 遷進 catalog、或寫 catalog 測試之前」，由 [[evlog-adoption]] 的 MUST-Read 指針叫醒
8-13 前導 — evlog Adoption — Catalogs（全文）
15-61 Catalogs 採用（evlog 2.17+）

evlog-adoption.decision.md — evlog 採用路徑選型全文（stack decision matrix、5 個 plan package template、3 個 starter preset、drain 選擇指引、migration 順序建議）；常駐 pointer 在 [[evlog-adoption]]，觸發時機是「為 consumer 選 evlog template / preset / drain，或排 migration 順序之前」，由 [[evlog-adoption]] 的 MUST-Read 指針叫醒
10-15 前導 — evlog Adoption — 選型與 migration 順序（全文）
17-27 Stack decision matrix
29-77 5 個 plan package template overview
79-92 3 個 starter preset overview
94-113 Drain 選擇指引
115-149 Migration 順序建議

evlog-adoption.depth-gate.md — evlog adoption depth 自評與 evlog map coverage gate 全文（depth 1-6 自評表、MUST/MUST NOT、四條 false green、strict gate 兩道、ratchet 退場條件）；常駐 pointer 在 [[evlog-adoption]]，觸發時機是「評估 consumer evlog 覆蓋率、看 evlog map 分數、或判定 entry point gate 之前」，由 [[evlog-adoption]] 的 MUST-Read 指針叫醒
13-18 前導 — evlog Adoption — Depth 自評與 coverage gate（全文）
20-35 Adoption depth 1-6 自評表
37-39 Coverage 維度（evlog map）
41-50 Coverage 維度（evlog map） › MUST
52-60 Coverage 維度（evlog map） › MUST NOT
62-73 Coverage 維度（evlog map） › 分數不是品質證明
75-88 Coverage 維度（evlog map） › Gate（兩道，都走 strict）
90-100 Coverage 維度（evlog map） › Review 檢查

evlog-adoption.md — evlog 14 區塊全功能採用治理（template 選擇、preset、depth 自評、migration 順序）
11-16 前導 — evlog Adoption
18-26 強制載入指針（thin pointer；全文在三支 path-scoped detail）
28-32 三層治理結構
34-45 MUST
47-59 MUST NOT
61-69 反模式列表（MUST NOT 之外的）
71-87 Review 檢查

evlog-error-exposure.md — 寫 createError 的 why / fix / internal 時，判斷哪些內容可以進 HTTP response、哪些必須只留在 log——受眾是已驗證使用者、尚未驗證的 caller、還是只有維運者
13-20 前導 — evlog Error Exposure（why / fix / internal 的去處）
22-33 落點判準
35-41 內部識別字的處置
43-54 完成證明
56-60 相關

evlog-investigate.md — prod runtime 問題用 evlog wide event 調查的協定（消費側；先查 evlog 再從 code 對因）
14-23 前導 — evlog Investigate（prod 問題的調查反射）
25-33 Step 0：先問這是不是自己人做的（症狀是「環境變了」時 MUST 先跑）
35-48 Investigation-first 協定（每一個 prod runtime 症狀都適用）
50-57 evlog = ground truth 的邊界（何時要回 DB canonical）
59-69 Per-backend 查詢入口（recipe 在 cookbook）
71-73 Prod 可查詢 drain 是這條協定的前提
75-82 與寫入側 rule 的分工

evlog-stream-extend.md — evlog 讀端 opt-in 擴充（stream/fs-reader/enricher/tail-sampling）適用時載入
12-18 前導 — evlog Extend 標準（讀端 + 進階 hook）
20-29 何時用
31-35 API surface
37-43 設計原則
45-53 Anti-pattern
55-70 Custom enrichers
72-89 Tail sampling
91-106 Adoption / Reference signal
108-112 反採用條件（明確不採用）

logging.client-fields.md — evlog client transport 規範與 typed fields 採用判斷全文（setIdentity／clearIdentity、_evlog/ingest 保護、minLevel、typed fields 五核心欄位）；常駐 pointer 在 [[logging]]，觸發時機是「寫 client-side logging、typed fields schema 或 _evlog/ingest endpoint 之前」，由 [[logging]] 的 MUST-Read 指針叫醒
15-20 前導 — Logging — Client transport 與 typed fields（全文）
22-80 Client logging 規範
82-123 Typed fields 何時用

logging.drain-pipeline.md — evlog server plugin wiring 全文（drain pipeline 強制包覆、Cloudflare Workers afterResponse flush／waitUntil、三條 meta-event、Enricher stack 5 件套）；常駐 pointer 在 [[logging]]，觸發時機是「動 server/plugins 的 evlog drain / enricher wiring 之前」，由 [[logging]] 的 MUST-Read 指針叫醒
9-14 前導 — Logging — Drain pipeline 與 enricher（全文）
16-39 Drain pipeline 規範
41-45 Drain pipeline 規範 › 為什麼強制 pipeline
47-68 Drain pipeline 規範 › Cloudflare Workers flush
70-80 Drain pipeline 規範 › 三條 meta-event 必接
82-118 Enricher stack 標準（5 件套）

logging.error-contract.md — Server handler 錯誤契約全文（log.error 時機與單次呼叫、handleDbError、createError 必帶 why／internal／code 欄位契約 SoT、log.error 參數非 null、搜尋字串消毒）；常駐 pointer 在 [[logging]]，觸發時機是「在 server handler 寫 throw createError / log.error / handleDbError / .or() 搜尋之前」，由 [[logging]] 的 MUST-Read 指針叫醒
13-18 前導 — Logging — Error contract（全文）
20-44 log.error 使用時機
46-48 log.error 只呼叫一次
50-52 handleDbError 注意事項
54-101 createError 必帶 why（structured error 必填欄位）
103-113 log.error 參數必須非 null
115-128 搜尋字串消毒

logging.md — Server / client logging 與錯誤記錄規範（evlog）
12-17 前導 — Logging
19-28 強制載入指針（thin pointer；全文在四支 path-scoped detail）
30-59 Logger 選擇
61-68 log.set 時機
70-96 Review 檢查

logging.sampling-redaction.md — evlog sampling 強制下限與 redaction 強制條件全文（含 PII 分層表、audit forceKeep wiring）；常駐 pointer 在 [[logging]]，觸發時機是「改 nuxt.config 的 evlog.sampling / evlog.redact 或 audit forceKeep wiring 之前」，由 [[logging]] 的 MUST-Read 指針叫醒
9-14 前導 — Logging — Sampling 與 redaction（全文）
16-60 Sampling 強制下限
62-104 Redaction 強制條件

mcp-remote.md — 遠端 Supabase MCP 使用限制
5-14 前導 — MCP Remote Database
16-23 Production MCP 安全（若有 production MCP）

migration.md — Supabase Migration 操作規範
5-26 前導 — Migration
28-58 Lint 與 advisors 的處置義務
60-108 Timestamp 順序契約
110-128 Pending Migration 分類
130-176 Schema 暴露策略
178-180 DML Data Fix Checklist
182-195 Zero-Downtime Migration Checklist（production）
197-209 Data-Transform Migration Disposition
211-213 Staging Rehearsal（在自然歷史上跑）
215-221 Migration 衛生（防膨脹與誤用共用 DB）

query-optimization.md — 查詢優化、EXPLAIN、index 設計與 RLS 效能測量
5-18 前導 — Query Optimization
20-35 EXPLAIN ANALYZE 模板
37-45 讀 plan 的重點
47-82 Index 設計原則
84-105 效能測量
107-111 Pagination
113-121 效能事故處理
123-134 Supabase Advisors

rls-policy.md — RLS Policy 撰寫規範
5-17 前導 — RLS Policy
19-36 GRANT 先於 RLS——table privilege 驗證
38-43 靜默失敗陷阱
45-53 service_role 與 privileged client isolation
55-62 RLS Hardening（owner bypass / restrictive policy / JWT staleness）
64-68 RLS 效能
70-93 RLS 效能測量

storage.md — Supabase Storage 與 Cloudflare R2 使用規範（上傳、物件 key、signed URL、policy、清理）
5-19 前導 — Storage
21-28 上傳路徑與責任分離
30-44 Public vs Signed URL
46-58 Bucket Policy（RLS on `storage.objects`）
60-88 上傳失敗的 Rollback
90-113 檔案清理（避免孤兒檔案）
115-119 檔案大小與 MIME 限制
121-123 檔名合法字元

trigger.md — Postgres Trigger 撰寫規範
5-19 前導 — Trigger
21-25 命名規約
27-34 核心陷阱
36-44 檢查多 trigger 執行順序
46-63 標準 Template：`updated_at`
65-87 通用 Template：業務 trigger

unused-features.md — 專案目前未使用的 Supabase 功能 — 引入前的決策與規約
5-12 前導 — Unused Features Guardrails
14-16 Supabase Storage
18-20 Realtime（WebSocket subscriptions）
22-24 Supabase Edge Functions（Deno）
26-28 Queues（`pgmq` extension）
30-32 Cron（`pg_cron`）+ pg_net
34-36 Vector / pgvector
38-40 Supabase Vault / 欄位加密
42-44 Auth Hooks（Custom Access Token 等）
46-48 Custom Database Schema
