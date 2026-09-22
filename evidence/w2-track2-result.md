# W2 / Track 2 — Starter intake（create-nuxt-starter）consumer update-policy

- work: `W-2026-09-19-consumer-update-policy`（本 pane：`W-2026-09-20-consumer-policy-w2-track2-starter-intake`）
- worktree: `/home/charles/offline/nuxt-supabase-starter-wt/consumer-update-policy`
- branch: `session/2026-09-20-0139-consumer-update-policy`
- 驗收契約：`/home/charles/offline/clade-wt/consumer-update-policy/specs/truth/{contracts,data}/consumer-update-policy.md`（readonly，未改動）

## 結果

**本 worker 的驗收面全綠**：catalog 契約、normalizer 語意、CLI process 邊界（25 tests）。
全 package 測試 222 pass / 1 fail / 2 skip；唯一失敗是 **pre-existing 環境缺檔**（見下），與本 diff 無關。

## 實跑指令與 exit code（在 `template/packages/create-nuxt-starter/` 下）

| 指令 | exit | 結果 |
| --- | --- | --- |
| `pnpm run typecheck`（`tsc --noEmit`） | 0 | 過 |
| `pnpm run build`（`tsdown src/cli.ts --format esm --out-dir dist`） | 0 | `dist/cli.js` 185.66 kB |
| `pnpm exec vp test run test/consumer-update-policy.test.ts` | 0 | 25/25 pass（10.9s） |
| `pnpm exec vp test run test/question-catalog.test.ts` | 0 | 7/7 pass |
| `pnpm test`（`vp test run`，全 package 19 files） | 1 | 222 pass / **1 fail** / 2 skip（僅 scaffold.test.ts codex 環境缺檔） |
| `pnpm exec vp fmt --check packages/create-nuxt-starter/{src,test}` | 1→0 | 先標出 2 檔，`vp fmt --write` 修正後 check 過 |
| `pnpm exec vp lint --deny-warnings packages/create-nuxt-starter/{src,test}` | 0 | 0 warnings / 0 errors |

> 註：`pnpm test` 的 exit 1 完全來自 scaffold.test.ts 的 pre-existing 環境失敗（下節）。

## CLI／AI parity 實跑證據

`test/consumer-update-policy.test.ts` 的 parity 案例**分別 spawn 真發行物**
`dist/cli.js`（`spawnSync(process.execPath, [CLI, ...args])`，非 synthetic wrapper）：

- flags 路徑：`node dist/cli.js parity-app --yes --preset cloudflare-supabase --db-host existing-server --no-install --no-clone-clade --no-wire-pre-commit --register-consumer --repo-id fixture/project --workflow-model trunk-based --business-activity pre-production --dev-port auto --deploy-track none --release 1.0.0 --release-store <store> --registry-path <reg> --no-push --offline` → exit 0
- answers-file 路徑：同 target，無 `--yes`，`--answers-file <f>`（`{schemaVersion:1, answers:{db-host, register-fleet:yes, repo-id, workflow-model, business-activity, dev-port:auto, deploy-track:none}}`）＋同組執行控制旗標 → exit 0
- 比對：兩路對 fake clade 的**最後一次受管理呼叫**（`bootstrap-project.ts`，排除 `--preflight`）argv 在路徑正規化後 **deep equal**；`--update-policy pinned`；產出檔案樹（排除 `.git`）**deep equal**。

受管理交付 argv（recorder 實錄，路徑已正規化）：
`bootstrap-project.ts --consumer <target> --repo-id fixture/project --consumer-id parity-app --workflow-model trunk-based --business-activity pre-production --dev-port auto --deploy-track none --db-runtime cf-workers --update-policy pinned --release 1.0.0 --release-store <store> --registry-path <reg> --json --no-push --offline`

## Source SHA 與 artifact digest

- starter source SHA（worktree HEAD，本 diff 尚未 commit）：`3c07e20f19a147c29b085b068a3cf9c11ec5619c`
- build artifact：`template/packages/create-nuxt-starter/dist/cli.js`
  `sha256 = d5133901f7c3d1d9b1aaa07f5852e246991338f842443ce9286d8b7c678c1862`
- clade 端被呼叫的入口（唯讀參考，未改動）：`/home/charles/offline/clade-wt/consumer-update-policy/scripts/bootstrap-project.ts`

## 變更檔案清單

新增：
- `template/packages/create-nuxt-starter/src/answers-file.ts` — `--answers-file` loader（schemaVersion=1、未知 id、非純量拒絕）＋ `mergeAnswersIntoFlags`（answers↔flag 衝突偵測、register-fleet yes|no 值域）＋ `IntakeError`（具名 diagnostic code）
- `template/packages/create-nuxt-starter/test/consumer-update-policy.test.ts` — 25 tests（catalog 契約 / normalizer / process 邊界 / scaffold-only 零管理 / 寫前拒絕 / --json / CLADE_HOME）
- `evidence/w2-track2-result.md`（本檔）

修改：
- `src/types.ts` — `UpdatePolicy`、`UPDATE_POLICIES`、`UserSelections.updatePolicy`
- `src/question-catalog.ts` — `update-policy` 題（`when: register`、`--update-policy`、options pinned|subscribed、`defaultValue: 'pinned'`）；`CatalogQuestion.defaultValue`；`missingYesFlags` 略過有 default 的題
- `src/prompts.ts` — `promptCatalogTail` 問 update-policy；select prompt 支援 `defaultValue` 作 `initial`
- `src/cli.ts` — 新旗標 `--update-policy --answers-file --json --release --release-store --registry-path --push/--no-push --offline`；answers-file 載入＋衝突偵測＋自動非互動；`applyCatalogFlags`（值域驗證、register-only 矛盾拒絕、policy 由 catalog default 套 pinned）；`buildCompletionReport`；`--json` 模式把 fd1 攔到 fd2、stdout 只留最終一個 JSON object；`--offline` 拒絕 install 與缺本機 clade 的 managed；managed-only 旗標撞上 `--no-register-consumer` 寫前拒絕；preflight 傳 `--registry-path`
- `src/post-scaffold.ts` — `postScaffold` 回傳 `PostScaffoldOutcome`；`runManagedBootstrap`/`buildBootstrapProjectArgs`（managed 單一入口 `bootstrap-project.ts`，argv 為純函式）；`findCladeRoot`：`CLADE_HOME` 指定但不存在 → `undefined`，**不 fallback** 真 home；`runInitConsumer` 加 `--offline` 禁 clone gate；scaffold-only 零 clade 呼叫（init-consumer 也略過）＋剝除 assemble 拷入的 starter 自有 `.claude/hub.json`；managed bootstrap 成功但無可驗證身分 → outcome 如實回報（不捏造 ready）；pre-commit wire 改為只在 managed 成功後執行；`pnpm install/typecheck/format` 在 `--json` 下轉 stderr
- `test/question-catalog.test.ts` — register 題清單釘入 `update-policy`（對齊新 catalog，非弱化）

## 前置 RED（诚实記錄，非本 worker 可解）

- **真 clade `bootstrap-project.ts` 尚未接受本輪旗標**：現行 `VALUE_FLAGS` 只有
  `--consumer --repo-id --consumer-id --workflow-model --business-activity --dev-port --deploy-track --verify-channels --dev-login --db-runtime`，
  `BOOL_FLAGS` 只有 `--json --skip-registry`，未知旗標 fail-closed（exit 1）。
  本 worker 產出的 argv 含 `--update-policy --release --release-store --registry-path --no-push --offline`
  → 對**真** clade 的 managed 交付呼叫會在 parse 階段 exit 1，starter 如實回報
  `BOOTSTRAP_FAILED`（`status: failed`，具名 diagnostics，絕不宣稱 ready）。
  這是 Wave 3 的 bootstrap 擴充責任；本檔 process 測試用 argv recorder 驗 seam 形狀，
  不代驗 registry/manifest 寫入語意。
- 同理，`register-consumer.ts --preflight` 對 `--registry-path` 的支援未確認；
  starter 端已對 `unknown flag: --registry-path` 做 skipped 降級（與既有 `--preflight` 相容路徑一致）。

## 已知非本 diff 的失敗（pre-existing）

- `test/scaffold.test.ts > agent runtime selection > supports codex + cursor multi-select`
  失敗：斷言產出 `.codex/config.toml`，但 `template/.codex/` 自 commit `34385d9a`
  「Codex 投影層移出版控」起**不在版控**，由 `sync-to-codex` 本機產生；本 worktree
  未跑過 sync → 檔不存在 → 測試必敗。主 checkout（`~/offline/nuxt-supabase-starter`）
  有該目錄故那裡可過。與本 diff 無交集（該測只呼叫 `assembleProject`）。

## 鎖／CAS 選擇（dispatch 要求說明）

**N/A —— starter 不寫 registry。** 本設計把所有 managed 寫入（registry entry、
consumer-meta、gate mint、vendor sync、readiness）收進 clade `bootstrap-project.ts`
單一入口；starter 只產 argv。需要 lock/CAS 的是 bootstrap 內部（Wave 3），
屆時應重用 `vendor/scripts/claude-workspace-admission.ts` 的 directory-lock protocol，
不要另寫一套。

## 沒有做到的事

- 未對**真** clade 跑 managed E2E（前置 RED，見上；fake recorder 只驗 argv seam）。
- 互動模式（TTY prompt）的 update-policy 題只在 `promptCatalogTail` 接上，
  無 process 級覆蓋（測試環境無 TTY）。
- `--json` 下 managed 的 `ready` 路徑只在 bootstrap 回傳含
  `consumerId/effectivePolicy/release` 的 JSON object 時成立；fake recorder 不回報 →
  測試覆蓋的是 `BOOTSTRAP_RESULT_UNVERIFIED` 降級路徑，真 `ready` 要等 Wave 3。
- `writeScaffoldAnswers` 仍只記 `dbHost`（既有行為），update-policy 的持久化
  由 registry/manifest 承載，不在此檔。
- `.clade/ai-control-plane/runtime-events.jsonl` 與 `.clade/flow/events.jsonl`
  的 diff 是 herdr/flow runtime 在 dispatch 時自動 append 的 telemetry，
  非本 worker 產物。

## Landing（2026-09-22）

- origin/main：`b96a67a0..d88f67a6` fast-forward push（無 force、無 PR；origin/main 無 branch protection，與 registry 宣告的 trunk-based 一致）
- feature commit 在 origin 上的 SHA：`6da1c9e8`（← 6897fffd）、`54ef74f2`（← b70d1741 telemetry，保留：`.clade/*.jsonl` 是 tracked 的 append-only 控制面紀錄）、`d88f67a6`（← d740d9a6）
- 本機 main 分岔收斂：33 筆本機 commit rebase 到 origin/main；`a22908c6` 與 origin `b96a67a0`（PR #2）patch 等價而略過，其餘 32 筆重放；rebase 後 tree 與原本機 main 相同（`824c6b00`）
- `git rev-list --left-right --count origin/main...main` → `0	0`
- `template/packages/create-nuxt-starter/dist/cli.js`：被 `template/.gitignore` 的 `dist/` 忽略、未 tracked，需要 `pnpm build`；已在本機 main checkout 建出（188 kB），`--help` 有列出 `--update-policy` / `--answers-file`
- 驗證：tsc 0、build 0、hygiene audit 0 findings；vitest 222 pass / 1 fail。失敗的是 `scaffold.test.ts` 的「codex + cursor multi-select」，不含 feature 的 base（`df9efb60`）上一樣會失敗，原因是乾淨 worktree 沒有 `template/.codex` 投影（被 gitignore）
- lifecycle：已移除 worktree `consumer-update-policy` 並刪除 branch（`git cherry` 全部等價）；worktree 內未提交的 1 行 dispatch telemetry 已接到 main checkout 的 `.clade/flow/events.jsonl`
- 殘工（clade 主線負責）：`vendor/specformula-clade/src/consumer-policy-fixtures.ts` 的 starter 路徑還指向已移除的 `…-wt/consumer-update-policy`，要改成 `~/offline/nuxt-supabase-starter`，之後重跑 `pnpm test:bdd -- --tags @surface:consumer-policy` 確認原本紅的 7 個轉綠
