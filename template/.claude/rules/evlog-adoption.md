<!--
🔒 LOCKED — managed by clade
Source: rules/core/evlog-adoption.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: evlog 14 區塊全功能採用治理（template 選擇、preset、depth 自評、migration 順序）
globs:
  - 'nuxt.config.ts'
  - 'server/plugins/evlog-*.ts'
  - 'app/plugins/evlog-*.ts'
  - 'packages/**/server/plugins/evlog-*.ts'
  - 'packages/**/app/plugins/evlog-*.ts'
  - 'openspec/changes/evlog-*/**'
---

# evlog Adoption

clade 對 evlog（https://www.evlog.dev/）的 cross-consumer 採用治理。決策已定：以 cookbook（`docs/evlog-master-plan.md`）+ ready-to-apply spectra change templates（M2）+ starter preset library（M3b）三層結構治理，consumer 端 apply 重工降到接近零，跨 consumer 認知差異被 LOCKED rules 與 decision matrix 壓平。

Reference：
- `docs/evlog-master-plan.md`（SoT，§ 1-§ 13 全細節）
- `docs/evlog-consumer-stack-matrix.md`（5 consumer 探測結果）
- `rules/core/logging.md`（baseline 規範，本 rule 之上的細部 wiring）
- `rules/core/audit-pattern.md`（D-pattern audit；本 rule O1 overlay 是其上的 evlog hash chain）

## 三層治理結構

1. **Cookbook**：`docs/evlog-master-plan.md` 是跨 consumer SoT，決策 + 失敗模式 + per-consumer plan
2. **Ready-to-apply templates**：`~/offline/clade/openspec/templates/evlog-*/`（M2 階段建立）— consumer 端 `cp -r` 進 `openspec/changes/` 即可 `spectra-apply`
3. **Starter preset library**：`~/offline/nuxt-supabase-starter/template/presets/evlog-*/`（M3b 階段建立）— 新 consumer 透過 scaffolder `--evlog-preset` flag 一次拿到

任何 evlog 採用問題先查這三層；consumer 自家 fork 出去的 wiring 是反模式（見最後一節）。

## Stack decision matrix

依 (runtime × db × auth × audit 需求 × AI 需求) 收斂到 5 條 spectra template + 3 個 starter preset：

| Runtime | DB | Audit 需求 | AI 需求 | → spectra template | → starter preset |
| --- | --- | --- | --- | --- | --- |
| cf-workers | Supabase | baseline | — | T1 | `evlog-baseline` |
| cf-workers | Supabase | hardening | — | T2 | （無；新 consumer 從 baseline 走） |
| cf-workers | Supabase | D-pattern audit | — | T2 + O1 | `evlog-d-pattern-audit` |
| cf-workers | Supabase（multi-package） | hardening 或 D-pattern | — | T2 + T4（+O1 視需要） | （無；perno-specific） |
| cf-workers | NuxtHub D1 | partial | ✅ | T3 | `evlog-nuxthub-ai` |

對應 5 consumer：

| Consumer | apply 順序 | 預估工時 |
| --- | --- | --- |
| yuntech-usr-sroi | T1 | 0.5 天 |
| TDMS | T2（O1 可選） | 0.5 天 |
| perno | T2 + T4 + O1 | 1-2 天 |
| nuxt-edge-agentic-rag | T3 | 1 天 |
| starter（自身 template） | T2（pre-applied） | 1-2 天（M3b） |

## 5 個 spectra change template overview

對應 `openspec/templates/evlog-<id>/`（M2 後可用），每個 template 含 `proposal.md` / `tasks.md` / `design.md` / `README.md`。

### T1 — `evlog-adopt-cfworkers-supabase-baseline`

depth 1 → 5。target：yuntech-usr-sroi。內含：
- Sentry drain + drain pipeline（batch + retry + overflow handling）
- 5 件套 enricher（UA / RequestSize / Geo / TraceContext / tenant）
- sampling + redaction policy
- structured errors guard
- **client transport**（5 consumer 共同 gap，必補）

### T2 — `evlog-adopt-cfworkers-supabase-hardening`

depth 5 → 6+。targets：starter（template 自身）、TDMS、perno（不含 multi-package overlay）。內含：
- typed fields schema（5 個跨 endpoint 共用核心欄位）
- source location enricher（vite plugin）
- **client transport**
- Postgres drain（optional 自家 `evlog_events` table）
- `nuxt-auth-utils` identity 整合

### T3 — `evlog-adopt-cfworkers-nuxthub-ai`

NuxtHub D1 完整版。target：nuxt-edge-agentic-rag。內含：
- `@evlog/nuxthub` drain
- Workers AI enricher
- `createAILogger`：cost / token / tool / embed / moderation 子事件
- MCP / SSE child logger
- Better Auth `createAuthMiddleware` 整合

### T4 — `evlog-adopt-multi-package-paths`

path layout overlay（不是 evlog feature）。targets：perno（必）、starter scaffolder（選）。內含：
- `packages/*/server/**` 偵測
- per-client env split（`.env.bigbyte` / `.env.shared`）
- scaffolder template hooks

可疊加 T2。

### O1 — `evlog-overlay-d-pattern-audit-signed`

evlog audit overlay（疊在 D-pattern 之上）。target：perno。內含：
- evlog `signed()` hash chain（與 DB hash chain **不**共用 secret）
- `auditEnricher()` 把 DB row 的 `auditEventId` / `prev_hash` / `hash` 帶進 evlog event
- `auditOnly()` drain pipeline 分支
- `auditDiff()` cron：DB row vs evlog row 比對，差異 emit `audit.chain_drift`

**MUST**：O1 不取代 D-pattern；DB row 永遠是 audit canonical truth。evlog signed chain 是 derived stream，提供 cross-process verify + drift detection。

## 3 個 starter preset overview

starter scaffolder（M3b 後支援 `--evlog-preset <name>` flag）：

| Preset | 內含 = 哪些 T pre-applied | 適用情境 |
| --- | --- | --- |
| `evlog-baseline` | T1 全套（含 client transport） | 內部工具 / SROI 報告 / 教學系統 |
| `evlog-d-pattern-audit` | T1 + O1（baseline + D-pattern + signed chain + outbox） | 多租戶 SaaS / 高合規（refund / billing / 政府報告） |
| `evlog-nuxthub-ai` | T3 全套 | AI agent / RAG / agentic workflow |

不獨立 preset 的：

- T2 hardening：新 consumer 從 T1 直接開始就是 hardening 後狀態
- T4 multi-package：multi-package 是 perno-specific 演進路徑，新 consumer 預設 single-package

## Adoption depth 1-6 自評表

每個 consumer 對照下表自評：

| Depth | 條件 | 對應 |
| --- | --- | --- |
| **1** | `evlog/nuxt` 套件裝、`useLogger(event)` 在 server endpoint 採用 | yuntech-usr-sroi 現況 |
| **2** | 1 + 自家 Sentry drain（無 pipeline） | — |
| **3** | 2 + drain pipeline（batch + retry） | — |
| **4** | 3 + 5 件套 enricher | — |
| **5** | 4 + sampling + redaction policy + structured errors | starter / TDMS / perno 現況 |
| **6** | 5 + client transport + typed fields + source location | T2 完成後 |
| **6+O1** | 6 + D-pattern audit + evlog signed chain + auditDiff | perno T2+O1 完成後 |
| **AI variant** | 1 + AI SDK + MCP/SSE child logger（與 6 並行軸） | agentic-rag 現況；T3 拉到 NuxtHub D1 完整版 |

review 時 grep 出對應 marker：

```bash
# Depth 1：useLogger 採用
rg -n "useLogger\\(event\\)" server | wc -l

# Depth 3：drain pipeline
rg -n "createPipeline\\(|pipeline\\.wrap" server/plugins

# Depth 4：5 件套 enricher
rg -n "userAgentEnricher\\(|geoEnricher\\(|traceContextEnricher\\(|requestSizeEnricher\\(|tenantEnricher\\(" server/plugins

# Depth 5：sampling + redaction
rg -nM "sampling:\\s*\\{[\\s\\S]*?rates:" nuxt.config.ts packages/**/nuxt.config.ts
rg -n "redact:\\s*(?:true|\\{)" nuxt.config.ts packages/**/nuxt.config.ts

# Depth 6：client transport + typed fields
rg -nM "transport:\\s*\\{[\\s\\S]{0,200}?enabled:\\s*true" nuxt.config.ts
rg -n "interface .*EvlogFields" server/utils packages/**/server/utils

# O1：audit signed
rg -n "signed\\(\\{|auditEnricher\\(|auditOnly\\(" server/plugins packages/**/server/plugins
```

## Migration 順序建議

### 從 depth 0/1 → 5（T1）

1. 先裝 evlog 套件 + 改 `useLogger(event)`
2. 加 drain pipeline（batch + retry + overflow handling）
3. 套 Sentry drain
4. 加 5 件套 enricher
5. 加 sampling + redaction policy
6. 加 structured error guard（review createError 必帶 why）
7. 加 client transport + setIdentity / clearIdentity wiring

不可跳：drain 沒 pipeline 包覆 = Workers subrequest budget 用光 → 其他 fetch 失敗。

### 從 depth 5 → 6（T2）

1. 加 typed fields schema（5 個核心欄位）
2. 加 source location vite plugin + sourceMaps upload
3. 加 client transport（若 T1 沒含）
4. （optional）加 Postgres drain（自家 `evlog_events`）

### 從 depth 6 → 6+O1（perno）

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

## MUST

- evlog 採用 **MUST** 走 cookbook + spectra template + starter preset 三層治理；**MUST NOT** consumer 自家從零摸索 wiring
- 任何 drain **MUST** 經 `pipeline.wrap` 包覆（見 `rules/core/logging.md` Drain pipeline 規範）
- production sampling **MUST** 滿足 error 100% / audit forceKeep 100% / warn ≥ 50% / info ≥ 10%
- production **MUST** 開 `redactionPolicy`，至少含 6 類 secret keys + 3 類 patterns（見 logging.md）
- 5 件套 enricher（UA / RequestSize / Geo / TraceContext + multi-tenant 加 tenant）**MUST** 全裝
- client transport **MUST** 開（5 consumer 共同 gap），endpoint **MUST** 套 CSRF + rate-limit + redaction
- O1 overlay **MUST** 不取代 D-pattern DB canonical truth；evlog signed chain 是 derived stream
- `signed()` secret **MUST** 與 DB hash secret 分開（避免單點失效）
- spectra template / starter preset **MUST** 由 clade 治理；consumer fork 出自家版 = drift

## MUST NOT

- **MUST NOT** 在 `server/api/` 使用 `consola`（遷至 `useLogger`）
- **MUST NOT** 用 raw drain（沒 `pipeline.wrap`）— Workers subrequest budget 會被吃光
- **MUST NOT** sample `error` < 100% 或 `audit` 不 forceKeep
- **MUST NOT** 在 `redactionPolicy` 缺 `password` / `token` / `authorization` keys
- **MUST NOT** 把 `auditEventId` 漏掉（evlog audit event 沒 `auditEventId` = D-pattern source 找不回）
- **MUST NOT** 把 evlog signed chain 當 audit canonical truth — DB row 才是
- **MUST NOT** 在 enricher 內 await DB query — 拖慢 hot path；resolve 函式要 sync 或 cache
- **MUST NOT** 把 `cf-ip*` headers 進 enricher（IP 是 PII）
- **MUST NOT** 把 LLM raw prompt / output 進 audit chain（短 TTL server log 可，audit 不可）
- **MUST NOT** 在 consumer 自家 fork spectra template — 改回中央倉

## 反模式列表

| 反模式 | 為什麼壞 | 怎麼改 |
| --- | --- | --- |
| consumer 自家寫 drain（不引用 vendor snippet） | drift；clade 升版 snippet 時 consumer 不會跟上 | `cp -r ~/offline/clade/openspec/templates/evlog-*` 或裝對應 plugin |
| 把 raw drain 直接接 Sentry | Workers 50 subrequest 用光 | 套 `createPipeline` 包覆 |
| sampling = 0.1 全 level（含 error） | error 90% 漏；告警失效 | `byLevel.error: 1.0`，`forceKeep` 加 audit |
| `redactionPolicy` 只 keys 沒 patterns | API key（無共通名稱）漏 redact | 加 `patterns` regex（sk- / Bearer / JWT） |
| typed fields 把整個 request body 塞進去 | 失去 wide event 彈性；schema 改一處全 endpoint 重 build | typed 只用於跨 endpoint 共用核心欄位 |
| client transport endpoint 沒 rate-limit | client bug 暴量打死 endpoint | rate-limit 100 req/min/user + CSRF + redaction |
| 在 enricher 內 await DB query 抓 tenant tier | hot path 拖慢；fail 影響整個 wide event | enricher 只 resolve sync 欄位；tier 由 consumer 在 handler 內 `log.set` |
| O1 用同一個 secret 跑 DB hash + evlog signed | 單點失效；其中一個漏 = 兩條 chain 都 compromise | 兩條 secret 分開儲存與 rotation |
| 在 audit drain 不套 `auditRedactPreset` | PII 進 audit chain（不可逆） | drain pipeline 對 audit event 額外套 preset |
| consumer 從 0 自摸 evlog | 重工 + 跨 consumer 認知差異 | 走 starter preset / spectra template |

## Review 檢查

```bash
# Depth marker（自評用）
rg -n "useLogger\\(event\\)" server | wc -l
rg -n "createPipeline\\(|pipeline\\.wrap" server/plugins | wc -l
rg -n "samplingPolicy\\(|redactionPolicy\\(" server/plugins | wc -l
rg -n "evlog:[\\s\\S]*client:[\\s\\S]*enabled:\\s*true" nuxt.config.ts

# 反模式
rg -n "createSentryDrain\\(" server | rg -v "pipeline\\.wrap" # raw drain
rg -nA10 "samplingPolicy\\(" server/plugins | rg "error:\\s*0\\." # error sampled
rg -nA10 "redactionPolicy\\(" server/plugins | rg -v "password|token|authorization" # 缺核心 keys
rg -n "consola" server/api # consola 遷移漏網
```

完整 static audit script 在 M2 階段補：`scripts/evlog-adoption-audit.mjs`（spec 見 `docs/evlog-master-plan.md` § 10.1）。
