---
description: MUST 11 的結構查詢與分頁兩種 negative-search 形態（graph／LSP 的 callers・references・in-degree 恆 0 與「真的沒有」同形；has_more 分頁的第一頁不是全集），以及 MUST 20 常駐義務的 exhibit 指針（三組對照見 TD-1059）
paths: ['scripts/audit-reference-query-oracle.ts', 'test/fixtures/reference-oracle/**', 'packages/*/test/fixtures/reference-oracle/**', 'test/audit-reference-query-oracle.test.ts', 'packages/*/test/audit-reference-query-oracle.test.ts', 'vendor/scripts/run-evidence.ts', 'vendor/scripts/evidence-hook.ts', 'docs/pitfalls/2026-09-10-nuxt-autoimport-callers-have-zero-in-degree.md']
---
<!-- Clade native rule; source: rules/core/agent-self-verification.structural-and-exit-evidence.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# 結構查詢與 exit-code 證據（MUST 11 的下推全文 ＋ MUST 20 exhibit 指針）

> **本檔的兩半載入保證不同，NEVER 混讀。** § 結構查詢 與 § 分頁 是 always-load 的
> [[agent-self-verification]] MUST 11 的下推全文——那條常駐，本檔只補實證與反開脫逐字。
> § exit code／fatal 已於 2026-09-10 Charles 拍板（span `02eda52ec273c05a`，Q1A）升為 always-load
> [[agent-self-verification]] MUST 20。義務本身在常駐層；本檔這一節只留常駐層沒放的 exhibit 指針，
> **NEVER** 再複述 MUST 20 正文（命中 `paths:` 時同一段會載兩次）。
>
> **下負結論前、或手打任何輸出過濾器之前 MUST 先讀本檔。**

## MUST 11 · 結構查詢

**結構查詢**（graph / LSP / ast 工具的 `callers`、`references`、`trace_path`、in-degree）同受本條約束，而它最容易被漏掉，因為它回的是一個**數字**而不是空清單——`callers_total: 0` 讀起來像一份測量結果，不像「我 grep 沒找到」。下「這個符號沒有 caller／沒有引用／可以刪」之前 **MUST** 先對一個**已知會命中的引用**驗過同一個查詢入口。**逐字禁令：定義命中 NEVER 構成引用查詢的 control**——同一個後端內部就有這個落差（Serena 1.7.0 實證：`find_symbol` 找到定義、`find_referencing_symbols` 回空）。Nuxt 專案的 control 已經做成可跑的：`node scripts/audit-reference-query-oracle.ts`（2026-09-10 實測 CBM 0.10.8：`categorySlug` 有 4 個真實引用點，`search_graph` in-degree=0、`trace_path` callers_total=0，而 `search_code` 全數命中並給對行號——**落差在 edge 不在 node**，`.vue` 有 Module 節點但沒有 Module→Function 的 CALLS edge）。所以對 Nuxt autoimport **NEVER** 拿結構層的 0 下負結論，改用 `search_code` 取候選再逐個確認。

## MUST 11 · 分頁

**分頁是本條的另一種形態，而它不長得像 negative search**：工具回的是一份看起來完整的清單。2026-09-10 在寫本條的過程中實際踩到——`list_projects` 預設 `limit: 50` 而 `total: 2725`、`has_more: true`，拿第一頁判定「CBM 沒有索引這個 project」是假陰性，與「從未索引」輸出完全同形。每一個回 `has_more` / `nextCursor` / `truncated` 的工具，**MUST** 翻完分頁、或改用針對單一對象的查詢入口（該例的正解是 `index_status --project <name>`，不是掃清單）。**NEVER** 把第一頁當全集。（機制與實錄見 [[pitfall-nuxt-autoimport-callers-have-zero-in-degree]]）

## exit code／fatal 的原始 receipt

義務在 always-load [[agent-self-verification]] MUST 20，本節不再複述。命中本檔 `paths:` 時
MUST 20 已經在常駐層。常駐層沒放的 exhibit：三組對照與機制見 [[TD-1059]]。
