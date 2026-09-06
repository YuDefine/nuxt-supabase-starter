# Scaffold quality readiness (TD-685)

Scope: generator, seed manifests and regression tests in this isolated worktree. No clade/<consumer-e> edits, fleet registration, remote project creation or deployment. Preserve unrelated WIP.

1. Done: verify generation paths, CLI dependencies and heavy admission contract.
2. Done: repair generator/base sources and whole-template diagnostics; add behavioral scaffold regression coverage.
3. Done: fresh install and Doctor, format, lint, check, typecheck, coverage test and build; argument/exit probes cover helper and CI fallback branches.
4. In progress: final checks, independent review, security scan, normal batch landing, push and safe cleanup.

Evidence: assemble.generatePackageJson overwrites test and typecheck with bare commands; templates/base/package.json defines bare build. Outer template manifest is a separate surface.

Dispatch: 5a43a6e4-b50d-46f6-a132-de2bcff808d0; ambient pane w24:p1. Result file currently absent; canonical helper validates identity before accepting outcome.

## Expanded acceptance (coordinator instructions)

All 10 errors / 5 warnings from the initial whole-template doctor run are in scope. Resolve them and missing clean-worktree Codex projection; continue through normal landing/push/cleanup, not just checkpoint. Keep clade source and <consumer-e> untouched. Index via canonical cbm-index.sh wrapper. Generated check runs guarded vp check and Nuxt typecheck sequentially, each with the typecheck label and forwarded arguments. Coverage remains an independent command.

## Verification evidence

- Fresh project: `/tmp/starter-quality-final-20260906-1339`; CLI selections: minimal, quality, testing-vitest, deploy-node, evlog none. No fleet registration, remote repository or database was created.
- `/tmp/starter-quality-v2-results.json`: Doctor, format:check, lint, check, check --help, typecheck, coverage test --run and build all exit 0. A deliberate Vue template type error fails check with TS2551/exit 2; removing that probe restores exit 0 (`starter-quality-v2-negative-vue.log`, `starter-quality-v2-check-restored.log`).
- Candidate readiness from the specified Clade integration passes heavy-gate typecheck/check/test/build and Doctor dependency/installed checks. Its only finding is absent consumer-meta, consistent with the unregistered temporary project (`/tmp/starter-quality-v2-readiness.json`).
- Generator tests: 196 passed, 2 skipped. Whole-template tests reached 343 passed, 2 skipped; final rerun is pending after the process-matrix timeout adjustment. Whole-template Doctor reached 0 errors/0 warnings; full build passed. Nuxt emits missing Supabase configuration notices because this seed has no credentials; build reports chunk-size and Wrangler override notices.
- Standalone generator frozen installation passes using its own lockfile with `--ignore-workspace` (`/tmp/starter-quality-generator-frozen.log`). Workspace and standalone lockfiles are distinct inputs.
- Clean-worktree Codex projection was regenerated with the canonical user-level sync shim. Starter hygiene full-tree audit passes. Audit guide references were checked against the migration and utility source (`/tmp/starter-quality-doc-alignment.json`).
- Manual reuse/simplification/efficiency/scope review is recorded separately from Pi. This uses the explicit one-time TD-685 substitute authorization; no absent simplify/Fable tool invocation is claimed. Initial Pi findings on the standalone lockfile and Vue typecheck entry were repaired; final independent review remains required.

Real helper execution is waiting for the shared heavy slot; stub tests already verify labels, argument boundaries and exit propagation, but do not substitute for that execution. Security scan and formal batch gates remain in progress.

## 0-S security scan: PASS (2026-09-06T08:33:53Z)

Bounded working-tree scan over the 37 owned paths completed with complete coverage and zero findings.

- Wrapper: `security-scan.ts working-tree --target . --paths-file <37 owned paths> --timeout-sec 5400 --max-cost 25`
- Scanner `codex-security` 0.1.25, model `gpt-5.6-sol`, effort `xhigh`; scanId `bc7b8925-6e5e-4351-bacf-197d17e80862`
- `exit_code: 0`, `failure_class: none`, `coverage_completeness: complete`, `artifact_completeness: complete`, `artifact_issues: []`
- Findings 0 across all severities (`findings.json` findings array empty); 7 coverage surfaces all `no_issue_found`; `deferred: []`, `openQuestions: []`
- Elapsed 26m18s, estimated cost $16.254585, snapshot digest `12a23c2c99318467adbfdd0302d7dfee36dec154d6932daa1105e1c72343b0e7`
- Output dir `hook-2026-09-06T08-07-32-608Z`; ledger row appended to `docs/evidence/security-scan-ledger.jsonl`

Coverage accounting for the 37 owned paths: 23 entered the source inventory and were reviewed in full;
the remaining 14 are recorded in `coverage.json` `explicitExclusions` as non-executable
(`tasks/**`, `docs/**`, `template/docs/**`, `**/pnpm-lock.yaml`, `**/test/**`, `**/.gitignore`, `**/.oxfmtignore`)
and were inspected as supporting evidence. No file outside the 37 owned paths entered the reviewed set.

### Why the previous attempt failed

The earlier run was already bounded to the same 37 paths (its ledger row records the identical
`snapshot_paths`); it was killed by the wrapper's default `--timeout-sec 900` at exactly 15m00s.
The measured cost shape is that preflight plus threat model run against the whole snapshot tree
(2,879 files) as fixed overhead, while per-file review is comparatively cheap — so splitting the
batch would pay that overhead once per batch. A single run with a larger timeout is the cheaper shape.

### Gates re-verified at this snapshot

- `pnpm test --run`: 341 passed / 2 skipped (33 test files passed / 1 skipped)
- `pnpm format:check`, `pnpm lint`, `pnpm check`, `pnpm doctor`: all exit 0

Note: this section is appended to `tasks/**`, which `coverage.json` classifies outside the source
inventory. No reviewed source file changed after the scan snapshot was taken.

### Landing 已完成（2026-09-06）

在 main worktree 落地為 `ef94e035`，已 push 至 `origin/main`（`02c721b2..ef94e035`）。
worktree 內的 `commit.detail.md` 衝突以「不在 session worktree 內 land」解掉：改動內容
已在 main worktree 就位，直接在 main 以 `git commit --only -- <34 paths>` 提交，
34 個檔全數落地，未觸及 `.clade/**` runtime journal 與範圍外檔案。

`session/2026-09-06-1256-scaffold-quality-readiness` 上的 `6d38429e` 與本次落地內容
等價，未合併進 main；該 branch 與其 worktree 可另行清理。

安全掃描沿用上一節 08:33:53Z 的 PASS：那次掃描的 snapshot digest 覆蓋的就是本次提交
的 34 個 owned path 內容，這些檔在掃描後未再變動；main 期間新增的 commit
（`98248766`、`f5882b82`、`4f3ee86f`）不在 owned paths 內。

落地快照重跑的 gates：

- `pnpm test --run`（template）：345 passed / 2 skipped（33 檔 passed / 1 skipped）
- `pnpm test --run`（create-nuxt-starter）：196 passed / 2 skipped
- `pnpm format:check`、`pnpm lint`、`pnpm check`、`pnpm doctor`：皆 exit 0
- `bash scripts/audit-template-hygiene.sh`：full-tree 無 finding

### 生成器 gate 缺口（clade 主線 2026-09-06 回報）

回報內容是 `generatePackageJson` 的 testing-full / testing-vitest 分支把 `test`
覆寫成未包 gate 的 `vp test --coverage`。那份查證讀的是當時的 HEAD；本批改動新增的
admission loop 在 feature scripts 組完後才套用，`test` / `build` / `typecheck` /
`check:tools` / `test:mutation` 五條都會被包成 `clade-gate run <label>` 形狀並保留
arg-safe 的 fallback 分支。缺口隨 `ef94e035` 一併關閉，不另開登記。

`lint` 維持未包 gate：clade `scripts/audit-gate-coverage.ts` 的 `HEAVY_SCRIPTS`
不含 lint，它只在 REQUIRED script 存在性那一層被檢查，因此不構成 gate coverage 缺口。
