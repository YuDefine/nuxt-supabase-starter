---
description: evlog 採用路徑選型全文（stack decision matrix、5 個 plan package template、3 個 starter preset、drain 選擇指引、migration 順序建議）；常駐 pointer 在 [[evlog-adoption]]，觸發時機是「為 consumer 選 evlog template / preset / drain，或排 migration 順序之前」，由 [[evlog-adoption]] 的 MUST-Read 指針叫醒
paths:
  - 'specs/plans/**'
  - 'nuxt.config.ts'
  - 'packages/**/nuxt.config.ts'
  - 'server/plugins/evlog-*.ts'
  - 'packages/**/server/plugins/evlog-*.ts'
---
<!-- Clade native rule; source: rules/modules/capabilities/evlog/evlog-adoption.decision.md; edit canonical source -->
<!-- clade-targets: claude,codex -->

# evlog Adoption — 選型與 migration 順序（全文）

> 本檔是 [[evlog-adoption]] 的下推全文之一。本檔管「走哪條路徑、什麼順序」：stack matrix、plan package template、starter preset、drain 選擇、migration 順序。

## Stack decision matrix

依 (runtime × db × auth × audit 需求 × AI 需求) 收斂到 5 條 plan package template + 3 個 starter preset：

| Runtime | DB | Audit 需求 | AI 需求 | → plan package template | → starter preset |
| --- | --- | --- | --- | --- | --- |
| cf-workers | Supabase | baseline | — | T1 | `evlog-baseline` |
| cf-workers | Supabase | hardening | — | T2 | （無；新 consumer 從 baseline 走） |
| cf-workers | Supabase | D-pattern audit | — | T2 + O1 | `evlog-d-pattern-audit` |
| cf-workers | Supabase（multi-package） | hardening 或 D-pattern | — | T2 + T4（+O1 視需要） | （無；multi-package consumer 專屬） |
| cf-workers | NuxtHub D1 | partial | ✅ | T3 | `evlog-nuxthub-ai` |

## 5 個 plan package template overview

對應 `vendor/evlog-templates/evlog-<id>/`，每個 template 含 `proposal.md` / `tasks.md` / `design.md` / `README.md`。

### T1 — `evlog-adopt-cfworkers-supabase-baseline`

depth 1 → 5。target：<consumer-1>。內含：
- **queryable durable drain + drain pipeline**（Supabase 系 = Postgres drain；見 § Drain 選擇指引）
- 5 件套 enricher（UA / RequestSize / Geo / TraceContext / tenant）
- sampling + redaction policy
- structured errors guard
- **client transport**（必補）
- Sentry drain（選配；需要 alerting/triage 時加）

### T2 — `evlog-adopt-cfworkers-supabase-hardening`

depth 5 → 6+。targets：starter（template 自身）、<consumer-2>、<consumer-3>（不含 multi-package overlay）。內含：
- typed fields schema（5 個跨 endpoint 共用核心欄位）
- source location enricher（vite plugin）
- **client transport**
- `nuxt-auth-utils` identity 整合

### T3 — `evlog-adopt-cfworkers-nuxthub-ai`

NuxtHub D1 完整版。target：<consumer-4>。內含：
- `@evlog/nuxthub` drain
- Workers AI enricher
- `createAILogger`：cost / token / tool / embed / moderation 子事件
- MCP / SSE child logger
- Better Auth `createAuthMiddleware` 整合

### T4 — `evlog-adopt-multi-package-paths`

path layout overlay（不是 evlog feature）。targets：<consumer-3>（必）、starter scaffolder（選）。內含：
- `packages/*/server/**` 偵測
- per-client env split（`.env.<client-1>` / `.env.shared`）
- scaffolder template hooks

可疊加 T2。

### O1 — `evlog-overlay-d-pattern-audit-signed`

evlog audit overlay（疊在 D-pattern 之上）。target：<consumer-3>。內含：
- evlog `signed()` hash chain（與 DB hash chain **不**共用 secret）
- `auditEnricher()` 把 DB row 的 `auditEventId` / `prev_hash` / `hash` 帶進 evlog event
- `auditOnly()` drain pipeline 分支
- `auditDiff()` cron：DB row vs evlog row 比對，差異 emit `audit.chain_drift`

**MUST**：O1 不取代 D-pattern；DB row 永遠是 audit canonical truth。evlog signed chain 是 derived stream，提供 cross-process verify + drift detection。

## 3 個 starter preset overview

starter scaffolder 以 `--evlog-preset <name>` flag 選用：

| Preset | 內含 = 哪些 T pre-applied | 適用情境 |
| --- | --- | --- |
| `evlog-baseline` | T1 全套（含 client transport） | 內部工具 / 影響力報告 / 教學系統 |
| `evlog-d-pattern-audit` | T1 + O1（baseline + D-pattern + signed chain + outbox） | 多租戶 SaaS / 高合規（refund / billing / 政府報告） |
| `evlog-nuxthub-ai` | T3 全套 | AI agent / RAG / agentic workflow |

不獨立 preset 的：

- T2 hardening：新 consumer 從 T1 直接開始就是 hardening 後狀態
- T4 multi-package：multi-package 是單一 consumer 的演進路徑，新 consumer 預設 single-package

## Drain 選擇指引

evlog 用於 production 的 consumer **MUST** 配一個 queryable durable drain 作為 investigation 基礎。Sentry drain 為選配的 alerting/triage 補充層。

| Stack | 必配 drain（queryable durable） | 選配 drain（alerting/triage） |
| --- | --- | --- |
| cf-workers + Supabase | Postgres drain（`evlog_events` table，見 `vendor/snippets/evlog-postgres-drain/`） | Sentry drain（見 `vendor/snippets/evlog-sentry-drain/`） |
| cf-workers + NuxtHub D1 | `@evlog/nuxthub`（auto-wired D1 drain） | Sentry drain |

**為什麼 durable drain 必配**：

- Postgres / D1 是 SQL 可查的 durable store，investigation 時可直接 `SELECT ... FROM evlog_events WHERE ...` 撈 wide event
- Sentry 雖然也可查（Explore → Logs），但受 Sentry retention / quota / rate limit 限制，不適合作為唯一的 investigation 基礎
- audit script `drain.noDurableDrain` 偵測違反（block level）

**為什麼 Sentry 選配**：

- Sentry 的價值在 alerting（Issues）、triage（Performance / Tracing）、release tracking — 這些是加值能力
- 量 < 100 events/min 或 internal tool 可只走 durable drain 不加 Sentry
- 需要 Sentry 的 consumer 加上去即可，不影響 investigation baseline

## Migration 順序建議

### 從 depth 0/1 → 5（T1）

1. 先裝 evlog 套件 + 改 `useLogger(event)`
2. 加 drain pipeline（batch + retry + overflow handling）
3. 套 queryable durable drain（Supabase 系 = Postgres drain；NuxtHub 系 = @evlog/nuxthub）
4. （選配）套 Sentry drain（需要 alerting/triage 時加）
5. 加 5 件套 enricher
6. 加 sampling + redaction policy
7. 加 structured error guard（review createError 必帶 why）
8. 加 client transport + setIdentity / clearIdentity wiring

不可跳：drain 沒 pipeline 包覆 = Workers subrequest budget 用光 → 其他 fetch 失敗。

### 從 depth 5 → 6（T2）

1. 加 typed fields schema（5 個核心欄位）
2. 加 source location vite plugin + sourceMaps upload
3. 加 client transport（若 T1 沒含）

### 從 depth 6 → 6+O1（multi-package consumer 實例）

1. 加 `auditEnricher()`（從 D-pattern audit_logs row 帶欄位）
2. 加 `signed()` chain（與 DB hash secret **不**共用）
3. 加 `auditOnly()` drain
4. 加 `auditDiff()` cron + drift table

### 從 depth 1+AI → 完整 NuxtHub stack（T3）

1. 加 `@evlog/nuxthub` drain + pipeline
2. 加 5 件套 enricher + Workers AI enricher
3. 套 `createAILogger`（cost / tokens / tool / embed）
4. 把現有 `createRequestLogger` 改用 evlog `child()` API
5. Better Auth `createAuthMiddleware` 整合
