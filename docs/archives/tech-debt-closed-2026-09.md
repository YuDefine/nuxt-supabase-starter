# Closed Tech Debt — 2026-09

本檔是 append-only 的結案索引。編號不重用；原始清理 manifest 與每條 evidence 在
`tasks/2026-09-06-backlog-cleanup.md`。

## TD-001 — Template E2E 跑超過 15 min
**Status**: done（2026-05-07）
**Resolution**: selector/a11y mismatch 已修正，workflow timeout 已調為 15 分鐘。
**Evidence**: commit `de5227d`；runs `25485436035`、`25486587955` both passed in about 6 minutes。

## TD-002 — `nuxthub-ai` preset 與 NuxtHub D1 stack 未對齊
**Status**: done（2026-05-10）
**Resolution**: NuxtHub D1 stack 以 single base + conditional overlay、migration 與 scaffolder integration 完成。
**Evidence**: `decisions/2026-05-10-nuxthub-d1-stack-as-first-class-scaffold.md`；41 e2e/audit tests passed。

## TD-003 — Scaffolder 非 TTY 需要 `script` wrapper
**Status**: done（2026-08-19）
**Resolution**: `--yes` path 已跳過 confirm prompt，非 TTY scaffold 不需 wrapper。
**Evidence**: `cli.ts:542`；`node dist/cli.js test-app-baseline --yes --evlog-preset baseline` exit 0。

## TD-006 — starter 內 install 會讓 clade bootstrap 自我投影
**Status**: done（2026-08-19）
**Resolution**: starter maintainer repo self-detection 已避免 install 產生公開 seed 的 `.claude` 污染。
**Evidence**: `scripts/audit-template-hygiene.test.sh`；template hygiene audits passed。污染實際發生過：`eae5091` 帶進污染，`a351053` 撤回。**覆蓋邊界**：full-tree audit 會 prune `template/.claude`，所以再次污染只有 pre-commit ratchet 攔得到——**NEVER** 把 full audit 綠燈讀成「再污染也會被擋」。

## TD-007 — scaffolder 測試並行與 cwd 判定不安全
**Status**: done（2026-08-19）
**Resolution**: cwd 判定已改用 `process.cwd()` / `INIT_CWD`，fixture 改用隔離暫存目錄。
**Evidence**: `cli.ts`、`post-scaffold.ts`；`pnpm vp test run` 93 tests passed、1 skipped，global check exit 0。

## TD-009 — 參考 app 仍釘在停更的 `@onmax/nuxt-better-auth`
**Status**: done（2026-08-24）
**Resolution**: 參考 app 已遷移至 Better Auth 0.1.x action API 與 providers。
**Evidence**: `21873104`、`template/package.json`；typecheck exit 0，280 unit tests passed，四個 auth pages rendered。

