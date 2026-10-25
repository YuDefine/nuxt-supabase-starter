---
name: rls-performance
description: >-
  RLS 效能診斷：EXPLAIN ANALYZE、PGRST003 pool timeout、connection pool 耗盡、API 變慢。NOT for RLS policy 的正確性設計（走 supabase-rls）。
---


# RLS Performance Playbook

RLS 效能問題的診斷操作手冊：新增 policy join 或改 policy WHERE、新增含 pagination／filter 的 endpoint、`PGRST003`、pool 耗盡、特定頁面變慢。量測模板、plan 判讀、index、延遲基準在 `db-schema/<variant>/query-optimization.md` 與 `rls-policy.md`，連線池預算與 PGRST003 處置在 `db-runtime/<variant>/database.md`；本 skill 只串起診斷流程並補規約沒有的判讀訊號。

# SOP

## Phase 1 -- 收斂症狀

1. READ 讀取症狀描述與 `log.error`：是否有 `PGRST003`（pool 耗盡，REST 504）、哪個頁面或 endpoint 變慢、最近是否新增或修改 policy join／WHERE、是否新增含分頁的 endpoint。

## Phase 2 -- 量測與判讀

1. DELEGATE 在目標主機量測：慢 query 依 `query-optimization.md` § 效能測量（`pg_stat_statements`）找出 total／mean 最高者，再依 § EXPLAIN ANALYZE 模板以**目標角色**（`set local role`，superuser 會 bypass RLS）跑 `EXPLAIN ANALYZE`；self-hosted 連線問題依 db-runtime `database.md` § Connection Pool Runbook 的 `pg_stat_activity` 查詢按 `usename`／`state` 分組。
2. THINK 讀取 `rules/連線池與RLS診斷判準.md`，搭配 `query-optimization.md` § 讀 plan 的重點，判定是 policy 寫法、缺 index、N+1 還是 pool 問題。

## Phase 3 -- 修正與驗證

1. WRITE 依判定修正：改 policy 寫法（`rls-policy.md` § RLS 效能）、加 index（`query-optimization.md` § Index 設計原則）、N+1 改 `select(*, related(*))` embed 或 RPC，或縮小交易批次（db-runtime `database.md` § Transaction 與批次寫入安全）。pool 問題照 Runbook 處置，**NEVER** 對 pool timeout 盲目 retry。
2. DELEGATE 以相同角色重跑 `EXPLAIN ANALYZE`，比較修正前後與有／無 policy 的 Execution Time 與 `Seq Scan`，依已載入規則判定是否仍超標；仍超標就回 Phase 2。
