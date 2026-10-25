---
name: supabase-migration
description: >-
  Supabase migration 檔與 schema DDL 規範。觸發：supabase migration new、CREATE FUNCTION / ALTER TABLE / CREATE INDEX。NOT for RLS policy 的內容設計（走 supabase-rls）。
---


# Supabase Migration 規範

核心規則（`supabase migration new`、search_path、SECURITY DEFINER 不放 exposed schema、view `security_invoker`、不改已 apply 的 migration、timestamp 契約、MCP 禁 DDL、reset → lint → gen types → typecheck、advisors、pending migration 分類、expand-contract）在 `rules/modules/db-schema/supabase/migration.md`，本 skill 不複述，只補實作細節。

> **PR-isolated DB preview env / schema diff gate / production data sanitization** 規約見 `rules/core/db-preview-env.md`（capability + safety contract）與 `rules/modules/db-runtime/supabase-self-hosted/preview-env.md`（self-host 實作層 + image trip-wires）。Cookbook 範本：`vendor/snippets/db-preview-env/`。

# SOP

## Phase 1 -- 建立 migration 檔

1. READ 讀取 module rule `rules/modules/db-schema/supabase/migration.md`（或 runtime 已交付的同名規約；改 `supabase/migrations/**/*.sql` 時已自動載入就不重讀）。
2. DELEGATE 執行 `supabase migration new <topic>` 產生檔名；一個 migration 只放一個主題。

## Phase 2 -- 撰寫 DDL

1. READ 讀取 `rules/DDL撰寫慣例判準.md`。
2. WRITE 需要 `SECURITY DEFINER` 函式時，讀取 `templates/security-definer-function.md` 與 `templates/security-definer-function.example.md` 撰寫；要讓 PostgREST（Data API）呼叫時，再讀取 `templates/public-thin-wrapper.md` 與 `templates/public-thin-wrapper.example.md` 在 `public` 建 wrapper。
3. WRITE 其餘 DDL 依已載入規則撰寫；RLS policy 的內容設計轉 `supabase-rls` skill。

## Phase 3 -- 本機驗證

1. DELEGATE 依 module rule 對**每一個**新增或修改的 migration 跑 reset → lint → gen types → typecheck，再跑 `supabase db advisors` 並逐條處置 security 類 finding。
2. DELEGATE 檢查有沒有 migration 被改名：

   ```bash
   git diff --cached --diff-filter=R -- 'supabase/migrations/' | grep -q . && echo "BLOCK: migration renamed" || echo "OK"
   ```

   印 `BLOCK` 時 STOP，把檔名還原成 main 上的檔名，不 commit 新 timestamp（判準見 `migration.md` § Timestamp 不可變）。

## Phase 4 -- Production 韌性分類與 gate（self-host production）

1. DELEGATE 執行 `node scripts/postgrest-resilience/classify-migration.mjs <migration.sql>`（本 skill 目錄下的投影資源）；找不到投影資源時 **NEVER** 改用其他 runtime 的路徑猜一個，回報標準未送達並保留 evidence 要求。
2. THINK 讀取 `rules/Production韌性分類判準.md`，依分類器的 `overall` 決定 online、expand-contract 或 hard stop。
3. DELEGATE online 路線部署時執行 `node scripts/postgrest-resilience/ready-watch.mjs --url=<admin-ready-url>` 與 `node scripts/postgrest-resilience/smoke-runner.mjs --endpoint=<name=url>`，保存 `/ready`、smoke summary 與 PostgREST logs 作為 evidence。

## Phase 5 -- 疑難排解

1. READ 執行或部署遇錯時，讀取 `rules/疑難排解與Owner修復判準.md` 依症狀處置；owner 修復是 MCP 跑 DDL 的唯一例外，只照該 rule 的四步做。


## Claude host contract

The resource declaration projects helpers under `.claude/skills/supabase-migration/scripts/postgrest-resilience/`. Run each `.mjs` helper with Claude `Bash` and the Node runner from the repository cwd; preserve the returned terminal output as evidence.
