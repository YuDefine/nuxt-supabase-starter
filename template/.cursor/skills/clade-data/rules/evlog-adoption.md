---
description: evlog 14 區塊全功能採用治理（template 選擇、preset、depth 自評、migration 順序）
paths:
  - 'nuxt.config.ts'
  - 'server/plugins/evlog-*.ts'
  - 'app/plugins/evlog-*.ts'
  - 'packages/**/server/plugins/evlog-*.ts'
  - 'packages/**/app/plugins/evlog-*.ts'
  - 'specs/plans/*evlog*/**'
---
<!-- Clade native rule; source: rules/modules/capabilities/evlog/evlog-adoption.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# evlog Adoption

clade 對 evlog（https://www.evlog.dev/）的 cross-consumer 採用治理。Reference：`docs/evlog-master-plan.md`（SoT）、`rules/modules/capabilities/evlog/logging.md`（baseline wiring）、`rules/core/audit-pattern.md`（D-pattern audit；O1 overlay 是其上的 evlog hash chain）。

## 強制載入指針（thin pointer；全文在三支 path-scoped detail）

命中下表左欄的具名時機時 **MUST 先讀對應 detail**（detail 檔的 `paths:` 只涵蓋各自觸發面的子集，不能靠順帶載入賭它在場）。

| 觸發時機（具名） | MUST 讀 | 搬走的段 |
| --- | --- | --- |
| 為 consumer 選 plan package template / starter preset / drain，或排 migration 順序之前 | [[evlog-adoption.decision]] | Stack decision matrix、5 個 template（T1–T4 + O1）、3 個 preset、Drain 選擇指引、Migration 順序建議 |
| 評估某 consumer 的 adoption depth、看 `evlog map` 分數、或判 entry point gate 之前 | [[evlog-adoption.depth-gate]] | Depth 1-6 自評表、Coverage 維度（MUST / MUST NOT）、分數不是品質證明、Gate 兩道、Review 檢查 |
| 新增 catalog、把 ad-hoc `createError` 遷進 catalog、或寫 catalog 測試之前 | [[evlog-adoption.catalogs]] | Catalogs 採用全部：命名規約、結構原則、internal 合併、sharding 路徑、audit signal（**evlog floor `^2.17.0` SoT 在這支**） |

## 三層治理結構

1. **Cookbook**：`docs/evlog-master-plan.md`，跨 consumer SoT
2. **Ready-to-apply templates**：`~/offline/clade/vendor/evlog-templates/evlog-*/`，`cp -r` 進 `specs/plans/` 即可 `/implement`
3. **Starter preset library**：`~/offline/nuxt-supabase-starter/template/presets/evlog-*/`，scaffolder `--evlog-preset`

## MUST

- evlog 採用 **MUST** 走 cookbook + plan package template + starter preset 三層治理；**MUST NOT** consumer 自家從零摸索 wiring
- 每個使用 evlog 的 consumer **MUST** 配一個 queryable durable drain（Supabase 系 = Postgres drain；NuxtHub 系 = @evlog/nuxthub），見 [[evlog-adoption.decision]] § Drain 選擇指引
- 任何自家 drain **MUST** 經 `createDrainPipeline(opts)(drain)` 包覆（見 [[logging.drain-pipeline]] § Drain pipeline 規範）
- production sampling **MUST** 滿足 error 100% / audit forceKeep 100% / warn ≥ 50% / info ≥ 10%（下限表與 wiring 見 [[logging.sampling-redaction]]）
- production **MUST** 開 `evlog.redact`，至少涵蓋 password 與 token / authorization（見 [[logging.sampling-redaction]] § Redaction 強制條件）
- 5 件套 enricher（UA / RequestSize / Geo / TraceContext + multi-tenant 加 tenant）**MUST** 全裝（見 [[logging.drain-pipeline]] § Enricher stack 標準）
- client transport **MUST** 開，endpoint **MUST** 套 CSRF + rate-limit + redaction（見 [[logging.client-fields]] § Client logging 規範）
- O1 overlay **MUST** 不取代 D-pattern DB canonical truth；evlog signed chain 是 derived stream
- `signed()` secret **MUST** 與 DB hash secret 分開（避免單點失效）
- plan package template / starter preset **MUST** 由 clade 治理；consumer fork 出自家版 = drift

## MUST NOT

- **MUST NOT** 在 `server/api/` 使用 `consola`（遷至 `useLogger`）
- **MUST NOT** 新增或保留 `consola` runtime dependency 作為 evlog fallback；非 request path 用 evlog standalone API，drain failure fallback 用帶註解的 `console.error`
- **MUST NOT** 用 raw drain（沒 `createDrainPipeline`）— Workers subrequest budget 會被吃光
- **MUST NOT** sample `error` < 100% 或 `audit` 不 forceKeep
- **MUST NOT** 在 `redact.paths` 缺 `password` 或 `token|authorization`；`redact: true` 視為啟用 builtins
- **MUST NOT** 把 `auditEventId` 漏掉（evlog audit event 沒 `auditEventId` = D-pattern source 找不回）
- **MUST NOT** 把 evlog signed chain 當 audit canonical truth — DB row 才是
- **MUST NOT** 在 enricher 內 await DB query — 拖慢 hot path；resolve 函式要 sync 或 cache
- **MUST NOT** 把 `cf-ip*` headers 進 enricher（IP 是 PII）
- **MUST NOT** 把 LLM raw prompt / output 進 audit chain（短 TTL server log 可，audit 不可）
- **MUST NOT** 在 consumer 自家 fork plan package template — 改回中央倉

## 反模式列表（MUST NOT 之外的）

| 反模式 | 怎麼改 |
| --- | --- |
| sampling rate 用 0.1（evlog rates 是 0-100，error 會被誤 sample） | `rates.error: 100`，audit consumer 另 wire `evlog:emit:keep` |
| `redact` 只列 paths 沒 patterns / builtins（API key 漏 redact） | 加 `patterns`（sk- / Bearer / JWT）或 `redact: true` |
| typed fields 塞整個 request body | typed 只用於跨 endpoint 共用核心欄位 |
| audit drain 不套 `auditRedactPreset`（PII 進 audit chain 不可逆） | drain pipeline 對 audit event 額外套 preset |
| enricher 內 await DB 抓 tenant tier | enricher 只 resolve sync 欄位，tier 在 handler `log.set` |

## Review 檢查

```bash
# Depth marker（自評用）
rg -n "useLogger\\(event\\)" server packages/**/server | wc -l
rg -n "createDrainPipeline\\(" server/plugins packages/**/server/plugins | wc -l
rg -nM "rates:\\s*\\{[\\s\\S]*error:\\s*100" nuxt.config.ts packages/**/nuxt.config.ts
rg -n "redact:\\s*(true|\\{)" nuxt.config.ts packages/**/nuxt.config.ts
rg -nM "transport:\\s*\\{[\\s\\S]{0,200}?enabled:\\s*true" nuxt.config.ts packages/**/nuxt.config.ts

# 反模式
rg -n "createSentryDrain\\(" server packages/**/server | rg -v "createDrainPipeline" # raw drain
rg -n "error:\\s*[0-9]+" nuxt.config.ts packages/**/nuxt.config.ts # 檢查 error rate 是否 < 100
rg -n "consola" server package.json packages/**/server packages/**/package.json # consola 遷移漏網
```

完整 static audit：`scripts/evlog-adoption-audit.ts`。
