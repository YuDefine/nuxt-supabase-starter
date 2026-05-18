---
description: PR-isolated DB preview environment capability + safety contract（不限工具、不限 topology）
paths: ['supabase/migrations/**/*.sql', '.github/workflows/**/*.yml', 'docker-compose*.yml', 'infra/**/*']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/db-preview-env.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


# DB Preview Environment（capability + safety contract）

**核心命題**：兩條 PR 同時改 schema 不能在 shared staging 互踩。本檔規約「應該具備什麼能力、應該守住什麼風險邊界」，**不**規定 topology — 用 docker-compose / LXC / cloud preview / 任何方案都可以，只要滿足下列契約。

> Self-host Supabase 的實作細節（compose-per-PR / schema-migration-gate / role password alignment / image quirk）見 `rules/modules/db-runtime/supabase-self-hosted/preview-env.md`。
>
> Cookbook 範本：`~/offline/clade/vendor/snippets/db-preview-env/`。
>
> Audit signal：`vendor/scripts/db-preview-env-audit.mjs`。

## 為什麼不規定 topology

Self-host Supabase 在 platform-only Branching 之外的選項地景已收斂：

- ❌ **Schema-per-branch**（同 PG 多 schema）：Auth/Storage/Realtime/RLS 共用狀態，假隔離
- ❌ **PG TEMPLATE clone**：Postgres `CREATE DATABASE ... TEMPLATE` 不是 CoW、template 期間禁 active conn、且 Auth/Storage 仍共用 → 一旦補 per-branch service stack 就是 compose-per-PR，B 是 dead-end
- ✅ **schema-migration-gate**（CI throwaway-DB replay + diff）：最便宜、立即解 reviewer 漏看，**MUST 第一階段必備**
- ✅ **compose-per-PR**（docker-compose per PR，unique JWT/port/volume）：完整 preview，**可選**升級路徑
- ⏸️ **LXC-per-PR**：LXC 同構在錯的層（OS/Tailscale/DNS/secret 不該每 PR 重建）；rare high-fidelity lane、不自動化

clade 規約管 capability，consumer 在 `registry/consumers.json` 宣告自家當前能力。

## MUST

### 1. Schema migration gate（必備）

- **MUST** PR open / migration change 時 CI 跑 schema diff 或 migration replay
- **MUST** diff 結果以 PR comment / artifact / status 形式可被 reviewer 看到
- **MUST** disposable DB instance 完全脫離 shared staging — 不允許用 staging schema 當 diff baseline

最便宜實作：CI throwaway Postgres → replay PR migrations → `pg_dump --schema-only` diff → PR comment。範本 `vendor/snippets/db-preview-env/schema-migration-gate/`。

### 2. Staging isolation（必備）

- **MUST** staging environment = 「**merge 後**整合環境」，不承擔 PR validation
- **NEVER** 讓任何 PR pipeline 直接對 shared staging schema 套 migration
- **MUST** PR validation 用 disposable / per-PR DB（schema-migration-gate 即可滿足）

如果 consumer 目前 staging 同時當 PR validation 環境，**MUST** 在 `docs/tech-debt.md` 開 TD 追蹤拆分計畫；不能無限延期。

### 3. Production data sanitization（必備條件）

凡 production data subset 進 non-prod 環境（無論是 preview、staging、本機）：

- **MUST** 先 sanitize（PII / secrets / credentials 全 masked）才能離開 production host
- **MUST** sanitization script version-controlled + reviewer-checkable
- **MUST** sanitize 以 `supabase_admin` / postgres super 等 RLS bypass 角色跑（否則 RLS 隱藏的 row 永遠不會 mask，是 leak risk）
- **MUST** masking 是 deterministic（FK / cross-table join 保留）+ type-preserving（email 還是 @-formed、phone 還是 +886-9...）
- **MUST** salt 來自 secret manager、每次 sanitize run 重抽，**NEVER** 把 salt commit 進 repo
- **NEVER** 把 sanitization 留到「preview runner 內」做 — 那已經太晚，raw PII 已進 non-prod

範本：`vendor/snippets/db-preview-env/sanitize/`（pgcrypto-based 因為 `postgresql-anonymizer` 不在 supabase/postgres image）。

### 4. Preview lifecycle（compose-per-PR / lxc-per-PR 才適用）

如果採用 ephemeral preview env（非僅 CI gate）：

- **MUST** 每 preview 有 unique secrets（JWT secret、DB password）— **NEVER** 跨 PR 共用
- **MUST** 有 TTL 或 PR close 觸發的 teardown 機制
- **MUST** 有 reconciliation job 清孤兒 stack（PR 已 close 但 stack 沒砍）
- **MUST** 命名規範 `<consumer>-pr-<n>`，避免跨 consumer 撞名

### 5. Production migration classification + gate

沿用既有 supabase-migration skill 的三分類：

- `online-safe`：直接 push 即可
- `expand-contract`：需 N+1 deploy 流程 + 暫態驗證
- `maintenance-required`：需停機窗口

**MUST** PR 描述標出 migration 風險分類；reviewer **MUST** 對 `expand-contract` / `maintenance-required` 拍板才能 merge。

### 6. 主幹 deploy gate（formalize trunk-based pattern）

- **MUST** `push branches: [main]` 觸發 staging deploy 一條獨立 workflow
- **MUST** `tags: ['v*']` 觸發 production deploy 一條獨立 workflow
- **MUST** production workflow 內有明確 confirm gate（環境變數 / GitHub environment protection / approval reviewer）
- **NEVER** 讓 main push 直接打到 production
- **NEVER** 把 production deploy 跟 staging deploy 寫在同一條 workflow 內共用 trigger

範本：`vendor/snippets/db-preview-env/production-confirm-gate.workflow.yml.template`。

## SHOULD

- **SHOULD** PR comment 包含 schema diff 行數 + lint 結果 + 自動產出的 TypeScript types diff
- **SHOULD** preview env 大小限制（per-host concurrent preview cap）寫進 cookbook，避免 host RAM/disk 爆掉
- **SHOULD** sanitize script 同步維護「reviewer PII checklist」— 每次 schema 加新欄位，checklist 標註是否 PII + masking strategy

## Capability declaration

`registry/consumers.json` 每個 self-host Supabase consumer **MUST** 宣告：

```jsonc
"capabilities": {
  "preview_db": "none | diff-only | compose-stack | lxc-stack",
  "data_branching": "none | synthetic | sanitized-subset"
}
```

`db-preview-env-audit.mjs` 比對宣告 vs 現實 — drift 進 `improvement-digest`，由人判斷是否該升 capability。

## 反模式

- ❌ 「先用 staging 驗 PR，merge 後 staging 跟 prod 同步」：靜默把 staging 變 PR 互踩戰場
- ❌ 「production dump 直接給 dev 同事」：raw PII 出 prod boundary
- ❌ 「自建 image 裝 postgresql-anonymizer」：image 升版會破壞、portable 差；用 pgcrypto-based deterministic SQL
- ❌ 「PR preview 共用 JWT secret」：跨 stack token 互用 = preview env 等於 prod
- ❌ 「migration 改動只跑 lint、不跑 disposable replay」：lint 只看 SQL 文法、不抓「這條 migration 跟既有 schema 衝突」

## 與其他規約關係

- `rules/core/audit-pattern.md`：D-pattern audit 結果**不**等於 schema diff — 兩者都要做
- `rules/modules/db-runtime/supabase-self-hosted/postgrest-resilience.md`：preview env 跑起來時也適用同樣的 PostgREST topology / reload channel 規則
- `plugins/hub-db-schema-supabase/skills/supabase-migration/SKILL.md`：migration 寫作規範（DDL / view security / SECURITY DEFINER 位置）

## 變體

詳細的「self-host Supabase 該選哪一個變體、cookbook 範本怎麼用、image quirk 怎麼繞」見 `rules/modules/db-runtime/supabase-self-hosted/preview-env.md`。Cloud Supabase consumer 規約另寫（暫無 active cloud consumer，留 TD）。
