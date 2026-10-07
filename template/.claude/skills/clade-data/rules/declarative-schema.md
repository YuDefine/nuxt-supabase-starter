---
description: Supabase 宣告式 schema（supabase/schemas + pg-delta）的採用判定與 sync 產出的處置義務
paths: ['supabase/schemas/**', 'supabase/config.toml']
---
<!-- Clade native rule; source: rules/modules/db-schema/supabase/declarative-schema.md; edit canonical source -->
<!-- clade-targets: claude,codex -->

# 宣告式 schema（pg-delta）

fleet 標準仍是 `supabase migration new` 手寫 migration；宣告式 schema 是 **experimental** variant
（`registry/conventions.json` 的 `supabase-schema-authoring`，理由與重評條件在 `docs/conventions/supabase-schema-authoring.md`）。
操作步驟與指令在 `vendor/snippets/supabase-declarative/README.md`，本檔只放判準。

## 採用判定

| 可觀察 predicate | 判定 |
| --- | --- |
| `supabase/schemas/` 存在，**且** `docs/decisions/` 有採用紀錄 | 已採用：schema 檔是 source of truth，走本檔 |
| config.toml 有 `[experimental.pgdelta] enabled = true` 但沒有 `supabase/schemas/` | **未採用**——新版 `supabase init` 樣板會自帶這段。照 `migration.md` 走 `supabase migration new` |
| `supabase/schemas/` 存在但沒有採用紀錄 | 停下問 owner；**NEVER** 自行當成 source of truth 或自行刪除 |

既有專案改採宣告式是 owner 的決定。**NEVER** 為了「用新功能」在 consumer 起 `supabase/schemas/`。

## sync 產出是草稿，不是 migration

`supabase db schema declarative sync` 產出的是「能到達目標狀態的 DDL」，**不是**「對 production 安全的 DDL」
（實測證據見 `docs/conventions/supabase-schema-authoring.md` § 證據）。

**每一支** sync 產生的 migration，commit 前 MUST 依序過：

1. `--no-apply --strict-coverage` 產生，**NEVER** 用 `--apply` 直接套進共享 DB
2. 當下（不等 deploy 前）依 `migration.md` § Pending Migration 分類 跑分類器
3. 產出含下節「不能用 sync 產生的變更」任一種 → 刪掉這支產出，改用 `supabase migration new` 手寫；其餘分類不是 `online_safe` 的 → 補 `lock_timeout` 與風險 header（`migration.md` § Zero-Downtime Migration Checklist）
4. 第 3 步有改檔或改用手寫 migration 時，重跑 `sync --no-apply`：**`supabase/migrations/` 沒有多出新檔**才算 schema 檔與 migration 等價（exit code 不可信：有 drift 也回 0）
5. 照常 reset → lint → gen types → typecheck → advisors

**NEVER** commit 帶 `Found destructive changes in schema diff` 警告、卻沒逐條處理過的產出。

## 不能用 sync 產生的變更

下列變更 **MUST** 用 `supabase migration new` 手寫，再把 schema 檔改成同一個終態，最後跑第 4 步確認無新檔：

| 變更 | pg-delta 的行為 | 手寫依據 |
| --- | --- | --- |
| rename（欄、表、type、enum value） | 判成 drop + add | ZDM #6 expand-contract |
| 改欄位型別 | 一步到位 | ZDM #6 expand-contract |
| 既有欄改 `NOT NULL` | 一步到位 | ZDM #5 |
| 既有表加 `NOT NULL` 欄 | 一步 `ADD COLUMN ... NOT NULL`（rename 實測即此形） | ZDM #5 三段式 |
| 刪欄、刪表 | 直接 `DROP` | ZDM #6 expand-contract：線上程式不再引用後，另一次部署才 drop |
| 既有表加 FK / CHECK | 一步加 validated constraint | ZDM #4 |
| 既有表建 index | 不帶 `CONCURRENTLY` | ZDM #3；單獨一支檔、首行 `-- pg-delta: transaction=false` |
| 改 function 簽名、drop function / view | drop 再 create | ZDM #6 |
| 任何 DML（backfill、data-transform、`storage.buckets` row） | 不追蹤；schema 檔裡放 DML 是錯誤 | § Data-Transform Migration Disposition |
| `auth` / `storage` 等 managed schema 內的物件 | 跳過 | — |
| casts、operators、text search 設定等未追蹤種類 | 只警告不產出 | sync MUST 帶 `--strict-coverage`，並讀輸出：有 coverage 警告就停（exit code 行為未實測，不可信） |

ZDM 編號指 `migration.md` § Zero-Downtime Migration Checklist。

## GRANT 展開

產生的 migration 會把 default privileges 展開成顯式 `GRANT ... TO anon, authenticated`（含 `TRUNCATE`）。
**每一條** GRANT MUST 對照 `migration.md` § Schema 暴露策略 與 `rls-policy.md` § GRANT 先於 RLS 審；
暴露的表 MUST 在同一支 migration 內 `enable row level security`。

## Cloud 專用指令

`declarative generate --linked`、`supabase pull`、`supabase config pull/push` 只對 `supabase link` 過的 Supabase Cloud project 有效。
self-hosted variant **NEVER** 為了用它們去 `supabase link`，從 DB 產宣告式檔用 `--local`（migrations 回放後的本機 DB）或 `--db-url`；
cloud variant 的 link 規約見 `db-runtime/supabase-cloud/database.md`。

## 混用兩個引擎

pg-delta 下 `supabase db diff` **不讀** `supabase/schemas/`；legacy migra 下宣告式產生器是 `supabase stop && supabase db diff -f`。
已採用的 repo **NEVER** 混用兩套產生方式，也 **NEVER** 把 `[db.migrations].schema_paths` 當排序手段（pg-delta 忽略它）。

## config.toml 的 experimental 段落

- `[experimental.pgdelta] enabled = true` 是新版 `supabase init` 樣板自帶的，**不代表**已採用（見 § 採用判定）
- `[experimental] stack = true` 與 `SUPABASE_EXPERIMENTAL_STACK=1`（native runtime，alpha）**NEVER** 進 committed config 或共用 `.env`（理由見 `docs/conventions/supabase-schema-authoring.md`）
- config.toml 出現新 key 之前，**每一個**會讀它的 CLI（CI pin、部署 runner、本機）MUST 已升到能解析它的版本——舊 CLI 讀到不認得的 key 直接中止
