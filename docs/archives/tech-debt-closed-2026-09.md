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

## TD-013 — scaffolder ↔ clade registry seam test 撞 manifest schema 收緊
**Status**: done（2026-09-11）
**Resolution**: fixture 不再寫死 `.claude/hub.json`。`template/packages/create-nuxt-starter/src/post-scaffold.ts` 新增匯出的 `buildInitConsumerArgs()`（從 `runInitConsumer` 抽出），seam test 用同一組 argv 呼叫 clade 的 `scripts/init-consumer.ts` 產生 consumer manifest —— 與 scaffold 實跑同一條路徑，schema 再收緊也不需人工追。順帶把 init 這一半 argv 也納進 seam gate（原本只有 register 側有覆蓋）。clade `manifest.schema.json` 未變動。
**Evidence**: `template/packages/create-nuxt-starter/test/clade-registry-seam.test.ts` 4 passed / 1 skipped（skip 的是 `describe.skipIf(seamAvailable)` 的「找不到 clade checkout」互斥分支，有 clade 時本來就該 skip）；套件全量 `vitest run` 198 passed / 2 skipped；`tsc --noEmit` exit 0。

## TD-015 — `pnpm run doctor` gate 因疑似誤判長期紅燈
**Status**: done（2026-09-11，開立同日解決）
**Resolution**: 誤判證實成立，且不是 heuristic 推測 —— `sentryCloudflareNitroPlugin` 的 callback 簽名是 `(nitroApp: NitroApp) => CloudflareOptions`（`@sentry/nuxt` 的 `runtime/plugins/sentry-cloudflare.server.d.ts`），收到的是 NitroApp，整條路徑上沒有任何地方拿得到 H3Event，而規則只看「`server/` 底下有沒有零引數的 `useRuntimeConfig()`」、不分 plugin 與 request handler，所以在這個位置無論如何都滿足不了。（**更正**：初版理由寫「在 Nitro 啟動時只跑一次」是錯的 —— 讀 `sentry-cloudflare.server.js` 可見該 callback 被包在 `nitroApp.localFetch` 的 Proxy `apply` 內，**每個 request 都會跑**。這不影響抑制的結論，但它引出 TD-016。）`vite-doctor` 0.0.10 已是 npm 上的最新版（`npm view vite-doctor versions` 共 13 版，0.0.10 為 latest），升版解決不了。改用 vite-doctor 內建的 inline 抑制 `doctor-disable-next-line <ruleId> -- <reason>`，理由寫在被打的那一行正上方 —— 抑制 token MUST 落在被打那行的**上方 1 或 2 行**（實測：正好 3 行就失效，且是靜默失效，外觀與沒加抑制完全相同；第一版註解寫了 6 行就是這樣失效的，已在該處留下實測數字）。順帶清掉 6 條 `VUE0023` info（`:loading="loading"` → `:loading`，Vue 3.5.31 支援 same-name shorthand），其中 4 條在 scaffolder / scripts template 內。**未動** Sentry plugin 的取值方式，也未改 clade 管理的 `vendor/doctor-shared/`。
**Evidence**: `cd template && pnpm run doctor` → `status: clean`、`blocker:0 error:0 warn:0 info:0`、exit 0（原本 exit 1、`warn:1 info:6`）。

