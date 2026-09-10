---
name: data-sanity
description: >-
  Use when running Design Review, before delivering a work item for manual
  review, or ad-hoc on changes touching paginated queries. Detects client-server
  schema mismatch. NOT for 一般 code review（走 review-rules）。
metadata:
  author: clade
  version: '1.0'
  clade:
    permission_tier: read-only
effort: medium
---


`data-sanity` — Layer C static data-shape audit。依當前產品已安裝的 skill 入口呼叫，或讀取本文件後使用下列 CLI。

本 skill 執行唯讀稽核與回報；發現問題後，修正依本次任務既有授權處理。`metadata.clade.permission_tier` 記錄這項政策，不是原生權限控制。

Born from <consumer-a> `app-status-badge-extraction`（2026-05-24）: `attendance/amendments.vue` 用 `useEmployeeListQuery({ perPage: 200 })`，但 server schema 是 `perPage: z....max(100)` → API 400 → `employeeNameMap` empty → 員工 column 整列「-」。typecheck / lint / design review / verify:ui 全沒抓到，因為它是**資料形狀**問題，不是型別或視覺問題。

這是 clade 自有 skill（**不是** `/impeccable` 的 sub-command — impeccable 是第三方 npx-managed skill，clade 不擁有）。

## 何時跑

- **Design Checkpoint 期間**（[[proactive-skills.design-checkpoint]]）：對本次工作觸及的 paginated query + lookup-resolved column 跑一次。
- **交付人工檢查之前**：data-shape 防線。
- **Ad-hoc**：任何改到 `useXxxQuery({ <param>: <literal> })` 或 lookup map 的工作。

## 怎麼跑

從 clade central 呼叫（`<clade-vendor>` = `~/offline/clade/vendor`，與其他 vendor script 同慣例）：

```bash
node <clade-vendor>/scripts/audit-data-sanity.ts \
  --consumer-path . \
  [--files <comma-separated-touched-files>] \
  --json
```

- 不給 `--files` → walk 整個 consumer（skip node_modules/.nuxt/dist）。
- 給 `--files` → 掃指定的既有檔；route 關聯可額外讀取它匯入的 schema。範圍以傳入路徑為準，此參數不提供目錄隔離；只傳本次已授權的路徑。

## 偵測項

1. **PARAM_BOUNDARY（Critical — blocks archive）**：client 端 pagination-ish param literal（`perPage` / `per_page` / `pageSize` / `page_size` / `limit` / `take` / `first` / `count` / `top` / `size`）超過（max）或低於（min）同名 server zod bound（`.max(N)` / `.min(N)` / `.length(N)`）。對應 UI-INV-2（lookup-resolved column 解析率 100%）。
2. **LOOKUP_MAP_RISK（advisory / warn）**：偵測 `xxxMap` / `xxxLookup` / `xxxById` 從 query data（`.reduce(` / `Object.fromEntries(` / `new Map(`）建的 lookup map。提醒：來源 query 若失敗，此 map empty → 對應 column uniform fallback。確認來源 query param 在 schema bound 內。
3. **SUBQUERY_ALIAS_COLLISION（advisory / warn）**：同一 serverish 檔案中重複使用 `.as('alias')` 時回報，供查核是否屬同一 SQL query 的衝突；不改 exit code。

> **限制（heuristic，非完整資料契約驗證）**：audit 使用 regex 掃描。可解析的明確 `/api` 呼叫會對應 route schema；無明確 route 時，僅在同名 bound 可收斂時比對。無法解析的明確 route 會略過；同名 fallback 仍可能 false-link。Bound extractor 只處理 `z...` chain，不覆蓋 Valibot bound、動態參數或所有 schema 寫法。PARAM_BOUNDARY 命中後查核實際 endpoint 與 schema；零命中不代表這些未覆蓋路徑已驗過。

## 結果處置

- **exit 0 `status: "pass"`** → 通過。lookupRisks／aliasCollisions 為 advisory，不 block。JSON 模式從 stdout 讀這兩個陣列；人讀模式在 pass 時將 advisory 印到 stderr。
- **exit 1 `status: "fail"`**（含 PARAM_BOUNDARY）→ **Critical，MUST block**：root-cause 修 client literal 到 bound 內（典型：`perPage: 200` → `100`），或若新 bound 是有意則調 server schema。**NEVER** 標 phase / archive done、**NEVER** 留給 user 在 manual review 抓。
- JSON schema：`{ status: "pass"|"fail", violations: [{param, clientValue, kind, bound, clientFile, clientLine, clientRoute: string|null, serverFile, serverLine}], lookupRisks: [{name, file, line}], aliasCollisions: [{alias, count, lines, file}], scanned: N }`。

## 與其他 Layer 的關係

- **Layer B**（`refactor-invariant-check.ts`）：runtime 偵測「column 整欄 fallback」（症狀）。Layer C 是 static 偵測「param 超界」（root cause）。兩者互補。
- **Layer D**（`UI-INVARIANTS.md`）：UI-INV-2 是本 skill 的契約來源。
- **Layer E.1**（pre-handoff self-analysis）：D4 維度（API contract boundary）可直接引用本 audit 結果。


