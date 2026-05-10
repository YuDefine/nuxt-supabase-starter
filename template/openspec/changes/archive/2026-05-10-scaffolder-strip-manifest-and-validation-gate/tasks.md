## 1. Strip manifest SoT

- [x] 1.1 Implement Decision 1: Single strip-manifest.json as SoT by creating `presets/_base/strip-manifest.json` with `schema_version`, `entries`, `path` or `glob`, `reason`, `consumers`, and `required` fields.
- [x] 1.2 Cover Requirement: Shared strip manifest source of truth by listing current meta-only candidates from `../scripts/create-clean.sh` and scaffolder output, including `packages/create-nuxt-starter/`, `presets/_base/strip-manifest.json`, starter-only Spectra runtime state, and root maintenance projection artifacts that must not remain in clean output.
- [x] 1.3 Implement Decision 5: Manifest schema follows overlay-manifest discipline by aligning manifest reasons with Change 1 vocabulary where applicable: `private-env-file`, `secret-like-content`, `real-email-identifier`, `real-tenant-identifier`, `unmarked-starter-only-doc`, `dogfood-business-code`, `dogfood-schema-hint`, `maintenance-script-misplacement`, plus explicit meta-only reasons such as `scaffolder-package` and `projection-metadata`.
- [x] 1.4 Implement Decision 6: Strip cleanup fails closed but absent paths are allowed by adding parser validation for missing manifest, malformed JSON, unknown schema version, absolute paths, path traversal, missing consumers, and unknown consumers.
- [x] 1.5 Add focused tests for Requirement: Strip manifest schema and reporting contract, including valid entry parsing, unknown consumer rejection, path traversal rejection, and absent optional path skipping.

## 2. create-clean.sh 整合

- [x] 2.1 Implement Decision 2: create-clean.sh and scaffolder both source the manifest by modifying `../scripts/create-clean.sh` to resolve `template/presets/_base/strip-manifest.json` before cleanup starts.
- [x] 2.2 Cover Requirement: create-clean manifest consumption by replacing duplicate hardcoded meta-only strip logic with manifest-driven removal for entries whose consumers include `create-clean`.
- [x] 2.3 Ensure `../scripts/create-clean.sh --yes` reports stripped and skipped manifest entries without printing misleading success when manifest parsing fails.
- [x] 2.4 Add or update shell/fixture coverage proving create-clean exits non-zero when the manifest is missing or malformed, and exits 0 when optional manifest paths are absent but manifest schema is valid.

## 3. Scaffolder 整合

- [x] 3.1 Implement Decision 2: create-clean.sh and scaffolder both source the manifest by adding `packages/create-nuxt-starter/src/strip-manifest.ts` for manifest loading, validation, consumer filtering, path normalization, and strip execution.
- [x] 3.2 Cover Requirement: Scaffolder manifest consumption by invoking strip cleanup from `packages/create-nuxt-starter/src/assemble.ts` after base, feature overlays, shared agent assets, scripts, Spectra config, dbStack overlay, placeholder replacement, and evlog preset application.
- [x] 3.3 Update `packages/create-nuxt-starter/test/scaffold.test.ts` so generated projects assert manifest-declared scaffolder meta-only paths are absent while starter runtime files still required by users remain present.
- [x] 3.4 Add failure-path tests showing malformed manifest blocks scaffold generation before a partial project is accepted.
- [x] 3.5 Verify existing NuxtHub D1 overlay behavior still passes after strip cleanup, including `nuxthub-ai` output with NuxtHub D1 files present and Supabase DB layout absent.

## 4. validate-starter 整合

- [x] 4.1 Implement Decision 3: validate-starter wraps the four audit regression paths by adding `scripts/validate-starter.mjs` and `package.json` script `validate:starter`.
- [x] 4.2 Cover Requirement: validate-starter audit regression gate by generating fresh scaffold fixtures for baseline, d-pattern-audit, nuxthub-ai, and none, then running the audit command against each fixture.
- [x] 4.3 Make audit script unavailability a validate-starter failure, not a silent skip from `describe.skipIf(!existsSync(AUDIT_SCRIPT))`.
- [x] 4.4 Encode expected audit signals for all four paths: blocked = 0 for every path; baseline / d-pattern-audit / none preserve Supabase default path; nuxthub-ai has NuxtHub module installed, drain pipeline wraps = 1, enrichers installed = 5, and no Supabase DB layout.
- [x] 4.5 Reuse or update `packages/create-nuxt-starter/test/scaffold-audit-regression.test.ts` so focused Vitest coverage and validate-starter expectations stay aligned.
- [x] 4.6 Ensure validate-starter reports preset, generated path, signal name, expected value, and actual value for every regression.

## 5. CI gate

- [x] 5.1 Implement Decision 4: GitHub Actions is the CI gate by adding `.github/workflows/validate-starter.yml` that runs on pull_request and main push.
- [x] 5.2 Configure the workflow to checkout, set up the repo's Node/pnpm pattern, install dependencies, and run `pnpm validate:starter`.
- [x] 5.3 Cover Requirement: CI validate-starter gate by ensuring non-zero validate-starter exit fails the job and job logs include the failing preset and audit signal summary.
- [x] 5.4 Run a workflow syntax pass with a local parser or `gh workflow view` equivalent available in the environment, and record the evidence in section 6.

## 6. Backend Verification Evidence

> 由 apply 階段 Claude 自跑、自貼證據；非使用者人工檢查項目。每條 task 完成時 Claude MUST 在 task 下貼出實際 command output 節錄作為 evidence，archive 前確認 task 已勾且有證據。

- [x] 6.1 Run validate-starter for baseline, d-pattern-audit, nuxthub-ai, and none; paste summary proving blocked = 0 and expected audit signals match. (verified: `pnpm validate:starter` → `[validate-starter] 4 fresh scaffold path(s) passed`，全部 4 條 path 的 audit signals 對齊預期)
- [x] 6.2 Run focused manifest parser and strip behavior tests; paste pass summary and any failure-path assertion names. (verified: `pnpm test strip-manifest.test.ts` → 1 file / 6 tests passed — valid entry / unknown consumer rejection / path traversal rejection / absent optional path skipping / malformed json rejection / consumer filter)
- [x] 6.3 Run create-clean manifest integration in a disposable fixture; paste evidence that manifest-declared create-clean entries are stripped and optional absent paths are skipped. (verified: `bash scripts/create-clean.sh --dry-run` 列出 6 個 would-strip entries：packages/create-nuxt-starter (scaffolder-package), presets/\_base/strip-manifest.json (projection-metadata), .spectra/claims, .spectra/spectra.db, .clade, .agent (projection-metadata))
- [x] 6.4 Run scaffolder generation after manifest strip; paste file-tree assertions proving manifest-declared scaffolder entries are absent and required runtime files remain. (verified: `pnpm test scaffold.test.ts` → 2 files / 18 tests passed — 含 strip-aware assertions、malformed manifest fail-closed test、nuxthub-ai NuxtHub D1 不回歸 test)
- [x] 6.5 Run CI workflow syntax validation for `.github/workflows/validate-starter.yml`; paste tool output or parser result. (verified: `python3 -c "yaml.safe_load(open('.github/workflows/validate-starter.yml'))"` → `YAML valid`)
- [x] 6.6 Run `pnpm check` or the repo's equivalent quality gate after implementation; paste pass/fail summary and blockers. (verified: `pnpm check` exit 0 — lint / format / vue-component-resolution / typecheck 全綠)
- [x] 6.7 Implement Decision 7: CI evidence stays backend-only by confirming this section contains CLI, audit, fixture, workflow syntax, and quality-gate evidence only, with no screenshot or browser UI task. (confirmed: 6.1–6.6 evidence 全部是 CLI / audit / fixture / yaml / quality-gate — 無 screenshot 或 browser UI；對齊 backend-only 宣告)

## 7. 人工檢查

_本 change 為 backend-only，所有驗證由 apply 階段 Claude 自跑（見 `## 6. Backend Verification Evidence`）；deploy 前無使用者人工檢查項目。_
