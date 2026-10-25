---
name: nuxt-data-audit
description: >-
  Use when auditing Nuxt data-fetching, performance, or client-server pagination
  schema boundaries. NOT for 非 Nuxt 專案，NOT for general code review。
metadata:
  author: clade
  version: '1.0'
  clade:
    permission_tier: read-only
effort: medium
---


# Nuxt Data Audit

只稽核與回報（`permission_tier` 是政策標記，不是原生權限）；修正依本次任務既有授權處理。入口：`/nuxt-data-audit [<consumer 路徑>]`、`/nuxt-data-audit --fleet`、`/nuxt-data-audit schema <files>`。`<clade-vendor>` 指 `~/offline/clade/vendor`。

# SOP

## Phase 1 -- 收斂稽核範圍與資料堆疊

1. READ 讀取呼叫引數（無參數＝當前 cwd、consumer 路徑、`--fleet`、`schema <files>`）；`--fleet` 時從 clade home 讀 `registry/consumers.json` 與 `consumers.local` 列出 Nuxt consumer。
2. READ 讀取 reference rule `nuxt-data-perf`（clade `rules/core/nuxt-data-perf.md`，或 runtime 已交付的同名規約；cookbook 在 `<clade-vendor>/snippets/nuxt-data-perf/`）；取不到則報告標 `incomplete`。
3. THINK 引數為 `schema` 時跳到 Phase 5；其餘繼續。
4. DELEGATE `node <clade-vendor>/scripts/audit-data-sanity.ts --candidates --consumer-path <path> --json`，取得 `stack`（Colada／non-Colada、`notApplicable`）與 E1–E19 候選命中 `file:line`。

## Phase 2 -- 逐項查核

1. READ 讀取 `rules/稽核項E1至E19判定判準.md`。
2. THINK 對每個適用項從候選出發，先用 codebase graph 工具、再以 shell 搜尋補充，讀實際呼叫鏈與資料路徑，依已載入規則評 pass／fail／partial／N/A／unknown，每項保留適用範圍、位置與判定證據。

## Phase 3 -- 評分

1. THINK 讀取 `rules/評分等級判準.md`，依安全缺陷 → 查核完整性 → HR／SR 的順序判 grade。

## Phase 4 -- 產出報告

1. WRITE 單一 consumer：讀取 `templates/nuxt-data-audit-report.md` 與 `templates/nuxt-data-audit-report.example.md`，依骨架輸出報告。
2. WRITE `--fleet`：每個 consumer 依序跑 Phase 1 step 4 至 Phase 3，再讀取 `templates/nuxt-data-audit-fleet-report.md` 與 `templates/nuxt-data-audit-fleet-report.example.md` 輸出彙總；輸出即 baseline，不另存。

## Phase 5 -- 執行 schema mode

1. READ 讀取 `rules/schema模式結果處置判準.md`。
2. DELEGATE `node <clade-vendor>/scripts/audit-data-sanity.ts --consumer-path . [--files <本次已授權的檔，逗號分隔>] --json`。
3. THINK 依已載入規則處置 exit code、violations 與 advisory。


