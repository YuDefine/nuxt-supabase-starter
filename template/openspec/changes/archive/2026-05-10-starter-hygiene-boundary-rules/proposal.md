## Why

`template/` 同時是正在維護的 Nuxt + Supabase 專案，也是使用者 scaffold / degit 後會直接帶走的 starter seed。現在缺少成文邊界與自動化檢查，dogfood 業務碼、私人環境檔、未標記 starter-only 文件一旦進入 `template/`，會直接污染所有新專案。

這條 change 先建立防污染三層治理的防線 A：meta vs template 邊界。後續 strip manifest 與 validate-starter CI gate 需要先有這層規則作為判準。

## What Changes

- 新增 `starter-hygiene` capability，定義 root meta repo 與 `template/` starter seed 的責任邊界。
- 新增 root 層 `.claude/rules/starter-hygiene.md`，作為維護 starter 時的行為規範 source of truth。
- 新增或更新 root 層 `.husky/pre-commit`，在 staged files 進入 git history 前阻擋 `template/` 污染。
- 補 root `CLAUDE.md` 的「Meta vs Template 邊界」指引，讓 Claude session 先判斷要改 root meta 還是 `template/` seed。
- 新增 root 層 `scripts/audit-template-hygiene.sh` 與 fixture-based shell test，提供離線稽核與未來 CI gate 可重用的檢查入口。
- 新增 `template/docs/decisions/2026-05-10-starter-meta-template-boundary.md` ADR，記錄治理決策與後續防線 B/C 的銜接。

## Non-Goals

- 不做 strip manifest 統一化；該工作屬 `scaffolder-strip-manifest-and-validation-gate`。
- 不修改 scaffolder CLI 內部邏輯或 `packages/create-nuxt-starter/src/*.ts`。
- 不導入 NuxtHub D1 first-class scaffold；該工作屬已 parked 的 `nuxthub-d1-stack-as-first-class-scaffold`。
- 不修改 `template/.claude/rules/`；那些是 clade-managed LOCKED projection，本 change 只規劃 root meta repo 的治理規則。
- 不做 UI、runtime、schema、migration、auth、RLS、billing 或 production deployment 變更。

## Affected Entity Matrix

### Entity: root .claude/rules/starter-hygiene.md

| Dimension     | Values                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| Files touched | `../.claude/rules/starter-hygiene.md` (new)                                                          |
| Roles         | starter maintainer, Claude session, release reviewer                                                 |
| Actions       | read boundary rule, classify root vs template work, report violations                                |
| States        | clean, suspected dogfood pollution, suspected secret pollution, starter-only artifact missing marker |
| Surfaces      | CLI / editor only; no browser UI                                                                     |

### Entity: root .husky/pre-commit

| Dimension     | Values                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Files touched | `../.husky/pre-commit` (new or modified)                                                                                            |
| Roles         | contributor, starter maintainer, Claude session                                                                                     |
| Actions       | inspect staged `template/` files, block `.env` / `.env.local`, block secret patterns, warn or block starter-only document pollution |
| States        | clean staged diff, blocked private env, blocked secret-like content, blocked unmarked starter-only content                          |
| Surfaces      | Git pre-commit stderr only; no browser UI                                                                                           |

### Entity: root CLAUDE.md

| Dimension     | Values                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Files touched | `../CLAUDE.md` (modified)                                                                                                              |
| Roles         | Claude session, maintainer onboarding                                                                                                  |
| Actions       | decide whether a change belongs in root meta repo, `template/`, or a future change; identify cross-layer paths in Spectra design/tasks |
| States        | clear boundary, cross-layer change, out-of-scope follow-up                                                                             |
| Surfaces      | Agent instruction document; no browser UI                                                                                              |

### Entity: root scripts/audit-template-hygiene.sh

| Dimension     | Values                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files touched | `../scripts/audit-template-hygiene.sh` (new)                                                                                                        |
| Roles         | starter maintainer, CI integrator, Claude session                                                                                                   |
| Actions       | scan `template/` for private env files, secret-like strings, real email / tenant identifiers, unmarked starter-only docs, dogfood schema/page hints |
| States        | exit 0 clean, non-zero findings, scanner failure                                                                                                    |
| Surfaces      | CLI report only; no browser UI                                                                                                                      |

## User Journeys

**No user-facing journey (backend-only)**

理由：本 change 只新增治理規則 + git hook + 維護腳本，終端使用者不會在瀏覽器走任何新 journey；驗收重點是維護者改錯時 hook 會擋下、Claude session 改 starter 時能讀到清楚邊界規則、`audit-template-hygiene.sh` 能找出潛在污染。

### Maintainer validation journey

- **Maintainer** staged `template/.env.local` → 執行 commit → pre-commit 以 `[Starter Hygiene] private env file 不通過` 阻擋，stderr 顯示修正方式。
- **Maintainer** staged 乾淨的 starter 文件或程式碼 → 執行 commit → pre-commit 通過，不引入額外 Node 啟動成本。
- **Claude session** 要修改 starter 行為 → 先讀 root `CLAUDE.md` 與 `.claude/rules/starter-hygiene.md` → 在 Spectra `design.md` / `tasks.md` 標明 root path 或 `template/` path → 避免把 meta 維護腳本放進 `template/scripts/`。

## Implementation Risk Plan

- Truth layer / invariants: `.claude/rules/starter-hygiene.md` 是行為規範 SoT；pre-commit hook 是 enforcement；`audit-template-hygiene.sh` 是離線稽核（可在 CI 跑）。invariants：違反規則的 commit 不能進 git history；rule 內容與 hook 邏輯必須對齊（rule 改 → hook 同步）。
- Review tier: Tier 1。
- Contract / failure paths: hook fail-closed（檢查失敗 → block commit）；rule violation 在 hook stderr 用既有 rule 違反回報格式 surface；audit script exit code 0 = 乾淨、非 0 = 有 finding。
- Test plan: unit test for `audit-template-hygiene.sh`（fixtures：模擬 dogfood / 乾淨 template）；hook 手動測試（commit 一個 fake `.env`、commit 一個乾淨檔案）；rule 透過實際 commit 流程驗證；無需 e2e / screenshot。
- Artifact sync: 本 change archive 後，更新 `template/openspec/ROADMAP.md` MANUAL `## Done` 區塊；補 `template/docs/decisions/2026-05-10-starter-meta-template-boundary.md`（ADR 記錄治理決策）；本 change 完成後 Change 2 `scaffolder-strip-manifest-and-validation-gate` 即可起跑。

## Capabilities

### New Capabilities

- `starter-hygiene`: 定義 starter monorepo 的 meta vs template 邊界規則、pre-commit enforcement、離線 audit 與 root agent 指引。

### Modified Capabilities

(none)

## Impact

- Affected specs: `starter-hygiene` (new)
- Affected code:
  - New: `../.claude/rules/starter-hygiene.md`, `../.husky/pre-commit`, `../scripts/audit-template-hygiene.sh`, `../scripts/audit-template-hygiene.test.sh`, `docs/decisions/2026-05-10-starter-meta-template-boundary.md`
  - Modified: `../CLAUDE.md`, `openspec/ROADMAP.md`
  - Removed: (none)
- Affected runtime: none
- Affected UI: none
- Affected database / migration / auth / RLS: none
