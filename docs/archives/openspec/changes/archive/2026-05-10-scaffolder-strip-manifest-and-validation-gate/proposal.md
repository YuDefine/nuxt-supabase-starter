## Why

`create-clean.sh` 與 scaffolder 目前各自決定哪些 starter meta-only 檔案不能進入乾淨輸出，strip 清單與投影行為容易 drift。Change 1 已建立 starter hygiene 的 A 防線，Change 3 已讓 NuxtHub D1 成為 first-class scaffold path；現在需要 B 防線把 strip 判準集中成 single source of truth，並用 C 防線讓 fresh scaffold 產物每次 PR 都自我驗證。

沒有 validate-starter gate 時，baseline、d-pattern-audit、nuxthub-ai、none 四條 scaffold path 只能靠 maintainer 手動跑 audit regression；任一 preset、overlay、agent asset、script copy 行為回歸，都可能在 release 後才污染使用者新專案。

## What Changes

- Add `presets/_base/strip-manifest.json` 作為 strip / projection cleanup 的 single source of truth，集中描述 meta-only path、pattern、reason、適用 consumer 與 fail-closed 規則。
- Modify root `../scripts/create-clean.sh` 讀取同一份 strip manifest，不再用獨立硬編清單處理 starter-only / meta-only cleanup。
- Modify scaffolder assembly path under `packages/create-nuxt-starter/src/` 讀取同一份 strip manifest，在 fresh scaffold output 產出後統一移除 meta-only 檔案。
- Add 或擴充 `scripts/validate-starter` 入口，把 baseline、d-pattern-audit、nuxthub-ai、none 四條 fresh scaffold audit regression 整合成固定 exit-code contract。
- Add GitHub Actions workflow `.github/workflows/validate-starter.yml`，在 PR/CI 跑 fresh scaffold + audit gate，阻擋 strip manifest drift 與 scaffold audit signal regression。
- Keep existing `../scripts/audit-template-hygiene.sh` 的 8 個 check names 與報告語彙不擴張；本 change 只把 scaffold output self-test 納入 gate。

## Non-Goals

- 不採用 evlog adoption，也不修改 evlog runtime logging 行為。
- 不做 auth migration、RLS policy、database migration、seed data 或 production deployment 變更。
- 不擴張 `../scripts/audit-template-hygiene.sh` 的 check names、regex 規則或 reporting format；Change 1 的 8 個 check names 維持不變。
- 不重新設計 NuxtHub D1 overlay、dbStack validation 或 `nuxthub-ai` preset implied behavior；Change 3 的 first-class scaffold 行為只作為 validation path。
- 不新增或修改 browser UI、Vue component、page、layout、CSS、screenshot review scope。
- 不在 propose 階段實作 strip manifest、validator 或 workflow；本輪只建立 Spectra artifacts 並 park。

## Affected Entity Matrix

### Entity: strip manifest source of truth

| Dimension     | Values                                                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Files touched | `presets/_base/strip-manifest.json` (new)                                                                                                      |
| Roles         | starter maintainer, scaffolder maintainer, CI validator, Claude apply session                                                                  |
| Actions       | declare meta-only paths, declare patterns, explain strip reason, classify create-clean vs scaffolder applicability, fail on malformed manifest |
| States        | valid manifest, malformed manifest, missing manifest, unknown schema version, stale manifest entry                                             |
| Surfaces      | internal CLI / CI only; no browser UI                                                                                                          |

### Entity: create-clean strip consumer

| Dimension     | Values                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Files touched | `../scripts/create-clean.sh` (modified)                                                                                        |
| Roles         | starter maintainer, new project maintainer using clean demo output                                                             |
| Actions       | resolve template manifest, strip manifest-declared paths, preserve project runtime files, report missing or malformed manifest |
| States        | clean output, manifest missing, strip path absent, strip path removed, strip failure                                           |
| Surfaces      | CLI stdout/stderr only; no browser UI                                                                                          |

### Entity: scaffolder strip consumer

| Dimension     | Values                                                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files touched | `packages/create-nuxt-starter/src/assemble.ts` (modified), `packages/create-nuxt-starter/src/strip-manifest.ts` (new), `packages/create-nuxt-starter/test/scaffold.test.ts` (modified) |
| Roles         | starter adopter, scaffolder maintainer, CI validator                                                                                                                                   |
| Actions       | load manifest, remove meta-only output after asset copy, reject malformed manifest, assert stripped files are absent in generated project                                              |
| States        | scaffold clean, scaffold blocked by invalid manifest, stripped path not present, unexpected meta-only artifact leaked                                                                  |
| Surfaces      | scaffolder CLI / generated file tree / unit tests; no browser UI                                                                                                                       |

### Entity: validate-starter regression runner

| Dimension     | Values                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files touched | `scripts/validate-starter.mjs` (new), `package.json` (modified), `packages/create-nuxt-starter/test/scaffold-audit-regression.test.ts` (modified or reused)          |
| Roles         | starter maintainer, CI runner, Claude apply session                                                                                                                  |
| Actions       | generate fresh scaffold fixtures, run audit for baseline / d-pattern-audit / nuxthub-ai / none, compare expected audit signals, report failures with path and preset |
| States        | all four paths clean, audit script unavailable, scaffold command failed, expected signal mismatch, blocked finding count non-zero                                    |
| Surfaces      | CLI stdout/stderr and test output only; no browser UI                                                                                                                |

### Entity: CI validation gate

| Dimension     | Values                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------- |
| Files touched | `.github/workflows/validate-starter.yml` (new)                                                |
| Roles         | GitHub Actions, pull request author, release reviewer                                         |
| Actions       | install dependencies, run validate-starter, expose failing preset and audit signal in CI logs |
| States        | gate passed, gate failed, workflow syntax invalid, dependency install failed                  |
| Surfaces      | GitHub Actions job logs only; no browser UI                                                   |

## User Journeys

**No user-facing journey (backend-only)**

理由：本 change 只治理 scaffold / clean output 與 CI validation gate，沒有 browser route、Vue component、layout、CSS 或使用者可點擊的 app journey。驗收重點是 maintainer 執行 CLI、validator、CI 時能阻擋 meta-only leak 與 audit signal regression。

### Maintainer validation journey

- Starter maintainer 修改 `.claude/`、`scripts/` 或 `.github/` 的 projection surface 後執行 validate-starter。
- Validator 產生 baseline、d-pattern-audit、nuxthub-ai、none 四個 fresh scaffold fixture。
- 每個 fixture 套用 strip manifest 後執行 audit；blocked count 必須是 0，且 preset-specific audit signal 必須符合預期。
- 若 nuxthub-ai fixture 同時保留 Supabase DB layout 或缺 NuxtHub D1 signal，validator 以非 0 exit code 報出 preset、path、signal。

## Implementation Risk Plan

- Truth layer / invariants: `presets/_base/strip-manifest.json` 是 strip / projection cleanup SoT；Change 1 的 8 個 starter hygiene check names 是污染語彙 SoT；invariant 是 create-clean 與 scaffolder 不得各自維護第二份 meta-only strip 清單。
- Review tier: Tier 2 — touches root maintenance script, scaffolder assembly, validator, package scripts, GitHub Actions; no UI, auth, DB schema, migration, RLS, billing, or production runtime behavior.
- Contract / failure paths: malformed or missing manifest fails closed; validator exit 0 means all four paths pass audit and expected signals; non-zero means scaffold failure, audit failure, expected signal mismatch, workflow syntax failure, or blocked finding.
- Test plan: focused tests for manifest schema parsing and strip behavior; scaffolder unit test for stripped paths; validate-starter run for baseline / d-pattern-audit / nuxthub-ai / none; CI workflow syntax pass; compare create-clean output cleanup against scaffolder strip expectations.
- Artifact sync: keep ADR `docs/decisions/2026-05-10-starter-meta-template-boundary.md` as A/B/C governance reference; archive this change after implementation evidence is attached; do not update clade-managed projections in this change unless apply discovers source-of-truth routing outside the allowed files and records it as a blocker.

## Capabilities

### New Capabilities

- `scaffolder-strip-and-validation`: defines shared strip manifest governance, create-clean/scaffolder manifest consumption, validate-starter audit regression, and CI gate behavior for fresh scaffold output.

### Modified Capabilities

(none)

## Impact

- Affected specs: `scaffolder-strip-and-validation` (new)
- Affected code:
  - New: `presets/_base/strip-manifest.json`, `packages/create-nuxt-starter/src/strip-manifest.ts`, `scripts/validate-starter.mjs`, `.github/workflows/validate-starter.yml`
  - Modified: `../scripts/create-clean.sh`, `packages/create-nuxt-starter/src/assemble.ts`, `packages/create-nuxt-starter/test/scaffold.test.ts`, `packages/create-nuxt-starter/test/scaffold-audit-regression.test.ts`, `package.json`
  - Removed: (none)
- Affected runtime: scaffold / clean maintenance CLI behavior and CI validation only; generated app runtime behavior remains unchanged.
- Affected UI: none.
- Affected database: none; no migration, schema, seed, RLS, auth, or production data change.
