# Maintainer Tech Debt Register

> 本檔追蹤 **starter 維護倉本身** 的技術債（CI workflow、scaffolder、meta scripts），不會被 scaffold 帶到新建專案。
> 新建專案使用的 follow-up register 在 `template/docs/tech-debt.md`；兩者不要混。
>
> 2026-09-06 那輪清理把當時已結案的 6 條移到 `docs/archives/tech-debt-closed-2026-09.md`，
> 留下當時仍需行動的 6 條。**這兩個數字是那一天的快照，之後有增有減**——現況一律以下方 Index
> 為準，不要拿這行對帳。編號不重用。

## Index

| ID     | Title                                                                                                    | Priority | Status      | Discovered |
| ------ | -------------------------------------------------------------------------------------------------------- | -------- | ----------- | ---------- |
| TD-004 | Spectra roadmap drift check 在 CI 的 structural diff                                                     | mid      | in-progress | 2026-05-10 |
| TD-005 | meta-monorepo 下 pre-push checks 靜默 no-op                                                              | high     | in-progress | 2026-08-19 |
| TD-008 | `validate-starter` 維護工具會被 scaffold 帶走                                                            | mid      | in-progress | 2026-08-19 |
| TD-010 | 參考 app email 登入被 nuxt-security CSRF 擋下                                                            | mid      | in-progress | 2026-08-24 |
| TD-011 | clade 投影 auth 文件仍寫舊套件名                                                                         | low      | open        | 2026-08-24 |
| TD-012 | `lint` script guard 吃不掉 pnpm 附加參數                                                                 | mid      | done        | 2026-08-29 |
| TD-014 | clade capability plugin 尚未通過 PUBLIC consumer 的 runtime projection 契約                              | low      | open        | 2026-09-09 |
| TD-016 | Cloudflare 上 `useRuntimeConfig()` 的 module-eval snapshot 是否讀得到注入的 `NUXT_APP_ENV`               | mid      | done        | 2026-09-11 |
| TD-017 | `validate-starter` 留下的 `temp/` scaffold 產物會讓 doctor gate 轉紅                                     | low      | in-progress | 2026-09-11 |
| TD-018 | auto-commit 失敗會把 clade projection state 卡在半套用，後續 propagate 一律誤報 conflict                 | high     | done        | 2026-09-11 |
| TD-019 | `scaffold-smoke` 自 2026-08-24 起持續紅，剩餘 blocker 是 clade 投影未去識別化                            | mid      | open        | 2026-09-11 |
| TD-020 | 選了 codex 的 scaffold 輸出靜默少掉 `.codex/` 與 `.agents/`                                              | high     | in-progress | 2026-09-11 |
| TD-021 | Template CI `UX drift audit` 既有紅燈：`shared/types` 沒有 enum-like 定義就 fail                         | mid      | open        | 2026-09-28 |
| TD-022 | repo root 的 Claude session 載不到 `commit-0a-reviewer` seat                                             | mid      | open        | 2026-09-28 |
| TD-023 | Codex deferred 指令寫死 `init-consumer.ts`，沒走 `.mjs` fallback                                         | low      | done        | 2026-09-28 |
| TD-024 | Template CI evlog map gate 暫掛 `ratchet`，須推到 `strict`                                               | mid      | done        | 2026-09-30 |
| TD-025 | scaffold receipt 收錄未進 initial commit 的 `.claude/settings.local.json`，`scaffold-receipt.test.ts` 紅 | mid      | done        | 2026-09-29 |
| TD-026 | aixbdd B3 逆向基準線只展開 profiles，其餘模組與 Gherkin runner 接線未做                                  | mid      | open        | 2026-10-03 |

### 2026-09-27 origin/main 收斂接手 brief

- 工作指針：本次基準 `origin/main` 為 `2679369d`；根目錄無 `HANDOFF.md`，`template/HANDOFF.md` 無未勾 checkbox。以下只以已合入 main 的內容判定，OPEN PR 不計入下降。
- 已驗證：TD-018 的上游修正在 clade PR #233（`f4f310585`）合入；starter 升版提交 `830c992e`、`f1f211cf` 先後帶入投影。TD-012 已由本 repo PR #6（`8a78c687`）合入。

| 仍未結案 | main 證據與接手條件                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TD-004   | PR #7（`6b04da7f`）只合入失效診斷；`template-ci.yml` 仍呼叫退役的 roadmap task。PR #10 尚未合入；由 workflow owner 核對 Spectra 退役決定及 PR #10 落地結果。 |
| TD-005   | `CLADE_PROJECT_ROOT` 接線仍由尚未合入的 PR #10 處理；合入後按本條 Acceptance 驗收。                                                                          |
| TD-008   | 維護腳本已搬到 root `scripts/validate-starter-scaffold.mjs`、`validate:starter` command 已刪、hygiene 防線已上線；實作在 draft PR #28，合入後依 Acceptance 結案。 |
| TD-010   | `template/nuxt.config.ts` 尚無 `/api/auth/**` CSRF 例外；實作 PR #9 尚未合入，合入後仍需真實登入驗收。                                                       |
| TD-011   | `template/.cursor/skills/clade-security/rules/auth.md` 仍寫舊套件名；須從 clade source 修正並散播。                                                          |
| TD-014   | `template/.cursor/skills/design/SKILL.md` 仍有無解析說明的 `<maintainer-domain>`；須由 clade source 收斂。                                                   |
| TD-016   | 缺真實 Cloudflare 部署的 Sentry `environment` 讀數；需現場驗證後才可判定。                                                                                   |
| TD-017   | `template/scripts/validate-starter.mjs` 只在開始與生成單一 fixture 前清理，結束後沒有清理；PR #5 尚未合入。                                                  |
| TD-019   | `scaffold-smoke` 在 main `2679369d` 的 run `36298330400` 仍失敗；須修投影去識別化並重驗。                                                                    |
| TD-020   | PR #13 已移除 `copyTemplateCodexAssets()`；Q160 已選 A，最小三件檔實作在 draft PR #14，待 PR 驗證與合入。                                                    |

- 2026-09-28 更新：Q160 選 A 的開箱三件檔與 TD-004 診斷步驟移除已在 draft PR #14；TD-016 的既有 consumer 讀數不等價，Charles 答 Q164「B」後已用獨立 Workers 驗證部署直接實測，原「零參數 snapshot 恆為 unknown」推論不成立。詳見本條的部署、讀數與拆除證據。
- 剩餘步驟：主持者追蹤 PR #5／#8／#9／#10 與 clade source 工作；各自合入後重新讀 `origin/main`，逐條核對 Acceptance、同步 Index 與 entry body，再量測 HANDOFF 未勾及 literal open TD。
- 檔案所有權：PR #14 0-A r1 修補由本輪 worker 修改根目錄 `HANDOFF.md`、`template/HANDOFF.md` 與 `docs/tech-debt.md`；程式碼、migration、`.claude/**`、`vendor/**`、其他 worktree、production 與 PR merge 由各自 owner 處理。

## In-flight PR 對帳（2026-09-27）

以下條目的本文與 Index 行由各 PR 持有，本次不修改；PR 未合併不算完成。

| TD     | 狀態              | 證據與剩餘事項                                                                                                                                                                                                |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TD-008 | IN-FLIGHT — PR #28 | 落點計畫已由 PR #8 合入；程式實作（搬移、workflow、audit 訊號、輸出斷言）在 [draft PR #28](https://github.com/YuDefine/nuxt-supabase-starter/pull/28)，合入後依 Acceptance 結案。 |
| TD-010 | IN-FLIGHT — PR #9 | Better Auth CSRF 例外及本機測試在 [PR #9](https://github.com/YuDefine/nuxt-supabase-starter/pull/9)；有效帳號與部署 host 驗收仍待補。                                                                         |
| TD-017 | IN-FLIGHT — PR #5 | `validate-starter` 的 fixture 清理與 `--keep` 在 [PR #5](https://github.com/YuDefine/nuxt-supabase-starter/pull/5)；未合併前不結案。                                                                          |

### 後續交接（PR #10）

- 工作指針：[PR #10](https://github.com/YuDefine/nuxt-supabase-starter/pull/10) 承接 TD-004/005；
  TD-018 的實作入口在 clade `scripts/lib/runtime-artifact-apply.ts` 與 auto-commit rescue/revert flow。
- 已驗證：`23fbbff6` 移除無效 CI 步驟並接通兩份 hook；PR #10 的 draft CI
  [run 36260052169](https://github.com/YuDefine/nuxt-supabase-starter/actions/runs/36260052169)
  Format / Lint / Typecheck 成功、Unit tests skipped；本機 `vp check`、shellcheck 與實際
  Vite+ pre-push dispatcher 均 exit 0。外部 PR #1 已以目前 `better-auth` `^1.7.1` 的
  `template/package.json` 證據[留言](https://github.com/YuDefine/nuxt-supabase-starter/pull/1#issuecomment-5848381621)並關閉。
- 剩餘步驟：coordinator 審查 PR #10 並在落地後核對 main Template CI，才將 TD-004 結案；
  TD-005 須建立可追溯的 ratchet baseline 並驗證違規會擋 push；TD-018 由 clade 修復後取得
  連續兩趟 propagate 非 `failed` 的證據。PR #5/#8/#9 依各自 owner 審查，不在此 PR 重做。
- 檔案所有權：PR #10 只持有 `.github/workflows/template-ci.yml`、兩份 pre-push hook 與
  `docs/tech-debt.md` 中 TD-004/005/018 及本對帳段；PR #5/#8/#9 分別持有 TD-017/008/010
  條目及各自程式檔；clade 持有 TD-018 的修復程式。`template/.husky/pre-push` 舊 hook 是否移除
  待後續維護者處理，本 PR 不動。

## TD-004 — Spectra roadmap drift check 在 CI 的 structural diff

**Status**: in-progress — [PR #10](https://github.com/YuDefine/nuxt-supabase-starter/pull/10) 的 `23fbbff6` 已移除失效診斷；draft CI [run 36260052169](https://github.com/YuDefine/nuxt-supabase-starter/actions/runs/36260052169) 的 Format / Lint / Typecheck 成功，待合併及 main CI 後結案
**Priority**: mid
**Discovered**: 2026-05-10 — v0.31.0 release 後 Template CI 反覆報 stale
**Location**: `.github/workflows/template-ci.yml`（原 `template/scripts/spectra-advanced/roadmap-sync.ts` 已退役）

### Problem

CI 執行 `vp run spectra:roadmap --check` 時曾持續報 stale，即使 local 已同步並提交 `ROADMAP.md`。
當時已驗證 timestamp normalization、Spectra CLI 不在 PATH、`.spectra/claims/` 缺失，以及 manual drift input
都不足以重現差異；working tree、shallow clone、Node 24 且 CLI 不在 PATH 的本機模擬均 PASS。
原始 structural diff 的 collect/render 根因尚未取得 CI 證據。

### 2026-09-26 診斷紀錄

- 讀取 Template CI main push runs `36214643821`、`36210379044`、`36198126577`、`36184362683`、`36098821814`
  的 job/step 狀態與 log：Unit tests 先失敗，`Spectra roadmap drift check (diagnostic, non-blocking)` 全為
  `skipped`。抽查較早的 `35953306353`、`34777720412`、`32481166558` 同樣 `skipped`。
  **unified diff 摘要：沒有 diff 輸出；不能據此判定原始 stale 已修復。**
- `693bf454`（2026-09-07）刪除 LOCKED 的 `roadmap-sync.ts` 投影；`67503a36` 同日移除
  `template/package.json` 的 `spectra:*` scripts；`28a39971` 同日刪除 `template/openspec/ROADMAP.md`。
  目前在 `template/` 執行 `vp run spectra:roadmap --check` 回 `Task "spectra:roadmap" not found`。
- 現行 workflow 仍先 `cp openspec/ROADMAP.md`，再呼叫已不存在的 task。**目前診斷路徑失效的根因是
  workflow 未隨 Spectra 投影退役同步更新**；沒有可執行的 collect/render path，也無 CI diff 可構造
  修正前紅、修正後綠的回歸測試。本輪因此只記錄診斷，不復活已退役腳本或手改 roadmap。

### 歷史 Workaround

`23fbbff6` 之前，`.github/workflows/template-ci.yml` 保留 `continue-on-error: true` 與 stale 時的
diff 指令；前置測試失敗使步驟跳過，即使走到該步驟，roadmap 檔與 task 也已不存在。

### 歷史 Fix approach

1. 依 CI 實際 unified diff 定位 structural difference。
2. 修正 `roadmap-sync.ts` 的對應 collect/render path。
3. 連續 5 次 main push 的 check 都 PASS 後，移除 `continue-on-error`，恢復真正 gate。

上述步驟是歷史方案，已不能套用到退役後的樹。2026-09-27 依退役後的現況選擇移除無效診斷：
`23fbbff6` 刪除 `.github/workflows/template-ci.yml` 原 145–168 行；舊 `ROADMAP.md`、
`spectra:roadmap` task 與同步器的退役證據見上方三筆 commit。這不是證明原始 structural drift
已修復，也不再把 skipped run 當 PASS。draft CI run `36260052169` 的機械檢查成功，Unit tests
因 draft 狀態 skipped；合併後仍須確認 main workflow。

### 2026-09-28 處置

依本次派工確認退役方向，從 `.github/workflows/template-ci.yml` 移除整段 Spectra roadmap
診斷步驟。原方案要求的 5 次 main push 已沒有輸入與 task，不能作為現行驗收。

### Acceptance

- 合併 [PR #10](https://github.com/YuDefine/nuxt-supabase-starter/pull/10) 後，main 的 Template CI
  不再引用已退役的 roadmap 檔、`spectra:roadmap` task、診斷 diff 或該診斷的
  `continue-on-error` 步驟（程式證據：`23fbbff6`）。
- 變更 PR 的 Template CI 完成，合入後以 main 的 workflow 再核對機械檢查成功；
  PR draft run `36260052169` 的機械檢查已成功、Unit tests skipped，main 尚待驗。

## TD-005 — meta-monorepo 下 pre-push checks 靜默 no-op

耐久 brief（含完整重現與判準）：`~/.cache/clade/briefs/td-005-prepush-project-root.md`。

**Status**: in-progress — [PR #10](https://github.com/YuDefine/nuxt-supabase-starter/pull/10) 的 `23fbbff6` 已接通 hook；ratchet 阻擋驗收仍未完成
**Priority**: high
**Discovered**: 2026-08-19 — clade convention 對齊掃描
**Location**: clade 的 `vendor/scripts/pre-push/runner.sh` 與各 `checks/*.sh`；consumer 端 `template/.vite-hooks/pre-push` 與 `template/scripts/templates/vite-hooks/pre-push`

### Problem

修正前，runner 與每支 check 都以 `git rev-parse --show-toplevel` 當 project root。scaffold 後專案這樣做正確，
但在此 meta-monorepo 會跳到 repo root；Nuxt app 實際在 `template/`，所以 9 支 check 全部判定不適用、
exit 0 且無輸出。實測 `bash template/scripts/pre-push/runner.sh` 為 exit 0、stdout 0 bytes。

### Fix approach

1. 在 runner 與各支 check 使用 `PROJECT_ROOT="${CLADE_PROJECT_ROOT:-$(git rev-parse --show-toplevel)}"`。
2. 由 `template/.vite-hooks/pre-push` 傳入 `CLADE_PROJECT_ROOT="$PWD"`。
3. 這是 clade vendor source 與 starter consumer wiring 的跨 repo 工作；先在 clade source 修正並 publish/propagate，
   再在本 repo 驗收，並檢查 `.husky` 是否留下不會被呼叫的重複 hook。

### 2026-09-27 接線與驗收

- clade 已投影的 `template/scripts/pre-push/runner.sh:61` 與 9 支 `checks/*.sh`（含 `tag-position.sh`）都讀取
  `CLADE_PROJECT_ROOT`；本次 `23fbbff6` 在實際 hook 及 scaffold 用模板傳入 `"$PWD"`
  （`template/.vite-hooks/pre-push:12`、`template/scripts/templates/vite-hooks/pre-push:12`）。
- `core.hooksPath=template/.vite-hooks/_`；安裝後的 dispatcher `template/.vite-hooks/_/pre-push`
  呼叫此 hook。本機實跑 dispatcher exit 0，有 Nuxt typecheck、ratchet 及 Vue checker 輸出；
  首次 branch push 的 pre-push hook 亦 exit 0。`vp check` exit 0。
- **尚未達成阻擋驗收**：`template/review-rules-baseline.json` 不在 `origin/main`，ratchet 輸出
  `bootstrap warn-only 模式`，目前無法證明違規會擋 push。owner：starter/coordinator；解除條件是
  依 ratchet 的既有存量程序建立可追溯 baseline，並以受控違規驗證 pre-push 非零退出。
- 舊 `.husky/pre-push` 仍在版控，但 `core.hooksPath` 指向 Vite+ dispatcher，Git 不會呼叫它；
  它不在本次 hook 接線的執行路徑，是否移除由後續維護者另案處理。

### Acceptance

- `CLADE_PROJECT_ROOT="$PWD/template" bash template/scripts/pre-push/runner.sh` 有輸出，9 支 check（含 `tag-position.sh`）
  各自有可辨識結果或明示跳過原因。
- 對 `template/**` 置入 review-rules-ratchet 可識別的違規時，pre-push 會阻擋。
- 未設 `CLADE_PROJECT_ROOT` 時，既有 consumer 行為維持不變。

## TD-008 — `validate-starter` 維護工具會被 scaffold 帶走

**Status**: in-progress（程式實作完成並送 draft PR；本機驗收全綠，待 PR 合入與 CI 終態後結案）
**Priority**: mid
**Discovered**: 2026-08-19 — starter public hygiene L3 commands 審查
**Location**: `scripts/validate-starter-scaffold.mjs`、`.github/workflows/validate-starter.yml`、`template/package.json`、`scripts/audit-template-hygiene.sh`

### Problem

`validate-starter` 只服務維護倉：它會找上一層 `REPO_ROOT`、執行 `packages/create-nuxt-starter` scaffold simulation，
並把 fixture 寫入 `template/temp/validate-starter/`。但 script 與 `validate:starter` command 會被帶進 scaffold output；
新專案沒有這些路徑，因此該公開 command 必然失敗。現有 hygiene audit 與 strip manifest 都沒涵蓋它。

### Fix approach

已選定**移到 root**；實作順序、task→file、audit fixture 與驗收指令見
[`tasks/2026-09-26-td-008-validate-starter-placement-plan.md`](../tasks/2026-09-26-td-008-validate-starter-placement-plan.md)。
先整合會修改同一支腳本的 TD-017 draft PR #5，再搬移它的最新版本，保留 fixture 清理與 `--keep`。
本條狀態仍為 open，以下 acceptance 須等後續程式實作驗證。

搬到 `scripts/validate-starter-scaffold.mjs`，調整腳本相對路徑與 workflow 入口／path filter，
移除 `template/package.json` 的 `validate:starter`。scaffolder 的輸出 package 另由 base package 產生；
目前 strip manifest 只支援檔案刪除，create-clean 另有 parser，因此不為單一維護 command 擴充 rewrite 契約。

同時在 `scripts/audit-template-hygiene.sh` 與 fixture test 補上 `maintenance-script-misplacement` 覆蓋。

### Implementation（2026-10-03）

以 TD-017 合入後（PR #22，`99c9d970`）的版本搬移，保留 fixture 預設清理與 `--keep`：

- `template/scripts/validate-starter.mjs` → `scripts/validate-starter-scaffold.mjs`；`SCRIPT_DIR` 落在 root
  `scripts/`，`REPO_ROOT` 改指 repo root，`TEMPLATE_ROOT` 指 `root/template`，其餘派生路徑不變。
- workflow 入口改為 `template/` 工作目錄下 `node ../scripts/validate-starter-scaffold.mjs`，
  PR/push path filter 由舊檔改指 root 新檔。
- 刪除 `template/package.json` 的 `validate:starter`；`verify:starter` 不動。
- `maintenance-script-misplacement` 補兩層內容訊號：meta repo 佈局 token（`TEMPLATE_ROOT`／
  `FIXTURE_ROOT`／`temp/validate-starter`）單獨命中即擋；`REPO_ROOT` 與 `create-nuxt-starter`
  因各有正當 consumer 用法（`.vite-hooks` 的 `_REPO_ROOT`、`verify-starter.mjs` 的 starter-self
  偵測）採複合判定，同時出現才算維護用途。fixture 正／負例含 `CLADE:VENDOR-SCRIPT` 例外。
- scaffold 輸出斷言補在 `scaffold.test.ts`（無 `scripts/validate-starter.mjs`、無
  `validate:starter` script）與 `strip-manifest.test.ts`（template seed 不再帶腳本與 command）。
- TD-017 兩支回歸測試的路徑同步修正：`test/unit/scripts/validate-starter.test.ts`、
  `packages/create-nuxt-starter/test/scaffold-audit-regression.test.ts`。
- 附帶修正一個 2026-08-19 起即恆紅的既有 fixture：`<consumer-a>` 是 registry 內真實 consumer，
  負向斷言改用不在 registry 的 `<consumer-x>`（僅 test fixture，未動 check 邏輯）。
- CI 第一輪 `Fresh Scaffold Audit Gate` 紅：舊入口 `vp run` 會把 vp env 管理的 pnpm 注入 PATH，
  `node` 直跑時 `pnpm --dir … exec tsdown` spawn 失敗（status null）。改為直接呼叫
  `packages/create-nuxt-starter/node_modules/.bin/tsdown`（tsdown 是該 package 的 direct
  devDep，install 後 .bin 必存在），不再依賴 ambient pnpm；lifecycle test 的 `bin/pnpm`
  shim 同步改為在同一位置寫 tsdown stub。

### Verification（2026-10-03，本機）

- `bash scripts/audit-template-hygiene.test.sh`：10/10 PASS（新增 2 案）。
- `bash scripts/audit-template-hygiene.sh`：PASS，template/ 無 finding。
- `vp test run packages/create-nuxt-starter/test/strip-manifest.test.ts`：7/7 PASS。
- `vp test run packages/create-nuxt-starter/test/scaffold.test.ts`：34/34 PASS；
  `test/unit/scripts/validate-starter.test.ts`：8/8 PASS；
  `packages/create-nuxt-starter/test/scaffold-audit-regression.test.ts`：5/5 PASS。
- `pnpm typecheck`：PASS。`vp check`：PASS（242 fmt、270 lint）。
- `node ../scripts/validate-starter-scaffold.mjs`（於 `template/`）：4 preset 全過；
  跑完 `temp/validate-starter/` 不存在，`--keep` 後保留 4 個 fixture；scaffold 輸出的
  `scripts/` 無 `validate-starter.mjs`、`package.json.scripts` 無 `validate:starter`。
- `.bin/tsdown` 直叫修正後上述全部重跑仍 PASS（lifecycle 8/8、4 preset、audit 10/10、
  hygiene、vp check 242/270）。
- PR CI 與 create-clean dry-run 另記於實作 PR；合入後依 Acceptance 結案。

### Acceptance

- scaffold output 沒有 `scripts/validate-starter.mjs`，且 package.json 沒有指向它的 `validate:starter`。
- `.github/workflows/validate-starter.yml` 仍可完成 preset scaffold simulation。
- strip-manifest test 與 `bash scripts/audit-template-hygiene.test.sh` 都 PASS。

## TD-010 — 參考 app email 登入被 nuxt-security CSRF 擋下

**Status**: in-progress（參考 app／scaffolder 修復與本機回歸已完成；有效帳號登入與部署 host 驗收待補）
**Priority**: mid
**Discovered**: 2026-08-24 — TD-009 遷移後實測發現；根因與遷移無關
**Location**: `template/nuxt.config.ts` 的 `security.csrf`、`template/app/pages/auth/login.vue`

### Problem

`security.csrf: true` 會擋住 Better Auth client 的 `POST /api/auth/sign-in/email`，因該 fetch 沒有 nuxt-security
CSRF token；已觀察到 `403 CSRF Token Mismatch`。CI 目前漏測，因真實登入缺少 `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`
時會 skip，而 auth setup 使用 server-side `/api/_dev/login`。

### Fix approach

方案裁決與實作、驗收步驟見 [2026-09-26 TD-010 CSRF decision](evidence/2026-09-26-td-010-csrf-decision.md)。
已在參考 app 加 `routeRules['/api/auth/**'].csurf = false`，scaffolder 僅於同時選 Better Auth 與
security 時輸出同一設定；兩者均維持全域 `security.csrf: true`。Better Auth 獨佔此路徑，
由其自身 origin、cookie、Fetch Metadata 防護接手；`server/auth.config.ts` 未開
`advanced.disableCSRFCheck`／`disableOriginCheck`，也未另設 `trustedOrigins`，故使用 Better Auth
以 base URL 推導可信來源及預設的 `SameSite=Lax`、`HttpOnly` cookie（HTTPS 下 Secure）。
這是依 [Better Auth security 文件](https://better-auth.com/docs/reference/security) 與本機套件設定確認的
機制；實際部署 host 與 cookie 屬性仍需驗證。

本機 `pnpm test:nuxt`（6 tests）通過：錯誤帳密 `POST /api/auth/sign-in/email` 到達 Better Auth
並回 401，無 nuxt-csurf 403；`POST /api/_dev/login` 帶 CSRF cookie 但無 token 回 403
`CSRF Token not found`，帶無效 token 回 403 `CSRF Token invalid`。這兩個訊息是目前
nuxt-csurf 的實際輸出，比先前決策稿預期的 `CSRF Token Mismatch` 更精確。
scaffolder 三種 feature 組合測試通過：Better Auth + security 產生限定例外、單獨 security
保留全域 CSRF、單獨 Better Auth 不產生例外。有效帳密登入尚未驗證，不能把 401 當登入成功。
scaffolder 整包 `pnpm test` 仍因既有 `consumer-update-policy.test.ts` 的 `npx tsdown`
啟動失敗及 `agent runtime selection` 缺 `.codex/config.toml` 投影而紅；本次新增三案的
定向測試是綠的。本機 Playwright 因 Ubuntu 26.04 不受所裝版本支援而缺 Chromium，
`e2e/auth.spec.ts` 尚未執行成功；CI 須覆核該 E2E。

Better Auth 1.7.1 在 `NODE_ENV=test` 且未明設 `advanced.disableOriginCheck` 時，套件內部
`isTest()` 預設跳過 origin check；因此本機 Nuxt test 不作跨來源拒絕的證據。部署模式須另驗
不可信 Origin／Fetch Metadata 的有效形狀請求，以及實際 host 的 `trustedOrigins`／cookie。

### Acceptance

- dev server 使用有效帳密由登入頁完成登入，不再出現 CSRF token error。
- 至少一條其他 `POST /api/**` 在無 token 時仍回 403。
- 有測試帳號時 `e2e/auth.spec.ts` 的真實登入路徑 PASS。

### Follow-up brief

工作指針：本條、上方決策文件、`template/nuxt.config.ts`、
`template/packages/create-nuxt-starter/src/assemble.ts` 與兩處對應測試。已驗證的本機
HTTP 證據如上；正式驗收仍需具 `E2E_USER_EMAIL`／`E2E_USER_PASSWORD` 的隔離測試帳號，
用登入頁完成登入，並在非 test 模式以不可信 Origin 測 Better Auth 拒絕、檢查部署 host 的
`SameSite`／`HttpOnly`／`Secure` cookie。這些工作限由主持者另派持有環境與驗收檔案
所有權的 pane 執行；本 pane 僅持有本 brief 所列的參考 app、scaffolder 設定與測試檔。

## TD-011 — clade 投影 auth 文件仍寫舊套件名

**Status**: open（clade scope）
**Priority**: low
**Discovered**: 2026-08-24 — TD-009 收尾掃殘留
**Location**: clade-managed `template/.claude/rules/auth.md`、`template/.claude/skills/document-writer/SKILL.md`、對應 `template/.cursor/` 投影

### Problem

投影文件仍提到 `@onmax/nuxt-better-auth`，與目前 `@nuxtjs/better-auth@0.1.x` 參考 app 及 scaffold API 不一致。
這些檔案由 clade checksum 管理，直接在 starter 改會被下一次 `hub:sync` 覆蓋。

### Fix approach

在 `~/offline/clade` 的 source rule/skill 修正舊套件名與相應 API，完成 clade 自家驗證後 publish + propagate；
starter 端只驗收到貨的投影，不直接修改 managed files。

### Acceptance

- starter 的 auth rule、document-writer skill、cursor projection 不再出現舊套件名。
- `hub:check` 與 clade checksum audit PASS，且 `@nuxtjs/better-auth` / 0.1.x API 說明一致。

## TD-012 — `lint` script guard 吃不掉 pnpm 附加參數

與 `dd2b122e`（heavy gate guard 改 `sh -c` 形式）同型；修法照那筆。

**Status**: done（2026-09-26 驗證；script 已於 `c86c3bad7` 修正）
**Priority**: mid
**Discovered**: 2026-08-29 — TD-685 heavy gate guard 回歸修正時發現
**Location**: `template/package.json` 的 `lint` script

### Problem

`lint` 原是裸 `if … fi` shell guard；pnpm 將 `pnpm lint <args>` 的附加參數接在整條 script 尾端，造成
`sh: 1: Syntax error: word unexpected`。`pnpm lint` 不帶參數才正常；typecheck、test、build 已用同形狀修正，
lint 因原工作 scope 刻意留下。`c86c3bad7` 已將 lint 改為下方形式。

### Fix approach

把整條 script 包進 `sh -c '…' --`，兩個分支都把 `"$@"` 傳給底層命令，並使用 `exec` 穿透 exit code 與 signal：

```json
"lint": "sh -c 'if test -x .clade/bin/clade-gate; then exec .clade/bin/clade-gate run lint -- vp lint --deny-warnings \"$@\"; else exec vp lint --deny-warnings \"$@\"; fi' --"
```

### Acceptance

- `pnpm lint --help` 顯示 `vp lint` help，沒有 shell syntax error。
- `pnpm lint` 不帶參數仍 exit 0。
- 刻意造成 lint failure 時 exit code 為非零，證明 `exec` 穿透。

### Verification（2026-09-26，`template/` cwd）

- `pnpm lint --help` → exit 0；輸出 `Usage: [-c=<./.oxlintrc.json>] [PATH]...` 與 Oxlint 選項，沒有 shell syntax error。
- `pnpm lint` → exit 0；`Found 0 warnings and 0 errors.`，掃描 253 檔。
- 暫存 `td012-lint-probe.ts` 內容為 `debugger;`，再跑 `pnpm lint` → exit 1；輸出 `eslint(no-debugger)` 與 `Found 1 warning and 0 errors.`。刪除暫存檔後重跑 `pnpm lint` → exit 0，`Found 0 warnings and 0 errors.`。
- 額外本機檢查：`pnpm typecheck` → exit 0；`vp check` → exit 0（286 檔格式正確、253 檔 lint 無警告／錯誤）。本 repo 沒有 `tsconfig.clade.json`，型別檢查使用既有 `pnpm typecheck`。

### 落地證據

- `c86c3bad7` 修正 `template/package.json` 的 lint script；PR #6 於 `8a78c687` 合入 main，帶入上方驗收紀錄。此項已結案，沒有待處理的 draft PR。

## TD-014 — clade capability plugin 尚未通過 PUBLIC consumer 的 runtime projection 契約

**Status**: open — **範圍已收斂到只剩 `<maintainer-domain>` 佔位符無解析說明**（2026-09-11）
**Priority**: low — 原本的 24 條 blocked error 已全數清除，剩下的是文件可讀性，不擋任何 gate
**Discovered**: 2026-09-09 — P7 宣告 `specformula` + `aixbdd` capability 後
**Location**: clade `plugins/hub-capabilities-{aixbdd,specformula}/skills/**`、`plugins/hub-core/scripts/{codex-review-safe,gh-ci-watch}.sh`、`plugins/hub-core/skills/subagent-dev/SKILL.md`

### Problem

宣告雙 capability 後，canonical 投影入口對本 repo 回 blocked：

```bash
node ~/offline/clade/scripts/project-runtime-capabilities.ts \
  --clade-root ~/offline/clade --targets claude,codex,cursor --visibility public --dry-run
# status=blocked appliedChanges=0
```

24 條 error，分三類：

1. **21 支 capability skill 缺 `clade-targets` 宣告** → `native delivery is unavailable`
   （`aixbdd` 17 支、`specformula` 4 支）。其中 `sdd-start/SKILL.md` 另有
   `common skill frontmatter key homepage is runtime-specific`。
2. **`hub-core/scripts/{codex-review-safe,gh-ci-watch}.sh`** → `Resource source is not safe for
this visibility profile`（PUBLIC）。此二條與 capability 無關，宣告前即存在。
3. **`hub-core/skills/subagent-dev/SKILL.md`** → `permission_tier` 放錯層。

實際投影仍由較舊的 `sync-rules` + `sync-to-{codex,cursor}` 路徑完成，Claude 端 skill 可被發現
（`sdd-start` / `specformula-*` 已出現在 skill 清單）；Codex / Cursor 的 native delivery 未驗證。

另兩條同源的 PUBLIC 洩漏面（由 0-A.2 裁決者指出，皆 HEAD 既存、非本次引入）：

- clade `hub-core/skills/design/SKILL.md` 硬寫維護者網域；投影去識別化成
  `https://review-gui.<maintainer-domain>/decisions` 後，scaffold 出去的使用者沒有解析步驟。
  同形問題在本 repo HEAD 已有 7 個 tracked rule 檔 / 14 處。
- clade `hub-core/skills/yudefine-deploy/SKILL.md:216-217` 的 `CLOUDFLARE_ACCOUNT_ID` /
  `CLOUDFLARE_ZONE_ID` 是可反查的真實 identifier，`audit-template-hygiene.sh` 目前不抓 32-hex。

### Fix approach

全部三類都是 clade 標準層，**本 repo 不修**。在 clade 補 `clade-targets` 宣告、把
runtime-specific frontmatter 移進 adapter fragment、處理 PUBLIC visibility 的 resource 安全宣告，
再 propagate。`<maintainer-domain>` 需要在 clade 源檔給出解析說明（或改成 consumer 可設定的值）；
CF identifier 需去識別化並補 32-hex 掃描規則。**NEVER** 為了讓本 repo 綠而還原真實網域或 identifier。

### Acceptance

- ~~上述 `project-runtime-capabilities … --visibility public --dry-run` 對本 repo 回非 blocked。~~ **已達成**
- ~~`node scripts/audit-public-hygiene.mjs` 與 `bash scripts/audit-template-hygiene.sh` 維持 0 violation。~~ **已達成**
- scaffold 出去的專案讀得懂 `<maintainer-domain>` 該填什麼。**仍未達成**

### 2026-09-11 實測：三類 error 全清，CF identifier 那條已在 clade 修掉

```bash
cd template && node ~/offline/clade/scripts/project-runtime-capabilities.ts \
  --clade-root ~/offline/clade --targets claude,codex,cursor --visibility public --dry-run
# {"status":"dry-run","plannedArtifacts":815,"appliedChanges":0,"diagnostics":[]}
```

`status` 從 `blocked` 變 `dry-run`、**24 條 error 歸零**。兩支 audit 也都 0 violation
（public-hygiene PASS 0 violations / 115 warnings；template-hygiene no findings）。

三類的去向：

| 類                                                                               | 去向                                                                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 21 支 capability skill 缺 `clade-targets` ＋ `subagent-dev` 的 `permission_tier` | clade 已補，隨 v1.12.46 到位                                                                     |
| `hub-core/scripts/{codex-review-safe,gh-ci-watch}.sh` 的 PUBLIC resource         | clade **TD-1019** 已解：實證註解搬進 `docs/pitfalls/`、原地留 pointer，並補了一條 invariant test |
| CF `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_ZONE_ID` 可反查 identifier              | clade **TD-1066** 已解                                                                           |

**CF 那條的實情比本條原本記的嚴重，值得留著**：它不只是「`audit-template-hygiene.sh` 不抓
32-hex」，而是**已經洩漏**——`template/.cursor/skills/yudefine-deploy/SKILL.md` 自
`efa40c4f`（2026-08-24）起在公開 repo 存在約三週。已隨 `1220f672`（523 deletions / 0 additions）
移出 `origin/main`；依維護者裁示只移除 HEAD、不改寫歷史。clade 端修法有三層：源檔 ID 改指向
secrets 存放處、新增 skill 級 `<!-- clade-visibility: private -->` 讓投影層對 public consumer
整支略過、以及對 public 算繪產物的不透明 ID fail-closed 判定。

**為什麼 hygiene audit 當初沒抓到**：它掃的是**具名字串**，而 32 碼 hex 不在任何名冊上。
同一行的 `<maintainer-domain>` 被正確改寫成 `<maintainer-domain>`、緊鄰的 ID 原封不動。
**「sanitizer 輸出乾淨」NEVER 等於「沒有 private 識別碼」。**

### 剩下的唯一一項

`<maintainer-domain>` 佔位符在 `template/.claude/` + `template/.cursor/` 的 **22 個檔、58 處**
出現，且**沒有任何一處說明該填什麼**（實測 grep 無命中）。scaffold 出去的使用者會看到一個
自己解不開的佔位符。修在 clade 源檔（給解析說明，或改成 consumer 可設定的值），本 repo 只驗收。

## TD-016 — Cloudflare 上 `useRuntimeConfig()` 的 module-eval snapshot 是否讀得到注入的 `NUXT_APP_ENV`

**Status**: done — Q164 獨立 Cloudflare Workers 實測否證「零參數 snapshot 讀不到部署時的 `NUXT_APP_ENV`」；證據在下方，隨 draft PR #14 待合入
**Priority**: mid — 若成立，Sentry 與 evlog 的 `environment` 在所有 Cloudflare 部署上恆為 `'unknown'`
**Discovered**: 2026-09-11 — TD-015 的 delta review 順出來的
**Location**: `template/server/plugins/sentry-cloudflare.ts`、`template/server/plugins/evlog-drain.ts`、`template/server/plugins/evlog-sentry-drain.ts`（後兩者為 clade-LOCKED 投影）

### 2026-09-28 Q161 唯讀探測

Charles 指示用**現有** Cloudflare consumer 的線上讀數。`clade/registry/consumers.json` 的
`deploy-track=wrangler-action` 只有 `nuxt-supabase-starter` 與 `<consumer-k>`：前者宣告
`evlog-stack=baseline`，但 GitHub `deploy.yml` 最近可查的 run 是 2026-03-14 的失敗紀錄，
不足以證明目前有可讀的線上事件；後者的 production `deploy.yml` 在 2026-09-26 成功，
但 registry 為 `evlog-stack=none`，專案設定沒有 Sentry 接線。本機 `sentry-cli info` 回
`Auth token is required`，所以沒有讀到任何線上 Sentry `environment` 值。

### 2026-09-28 RUSH-69 補充讀數與等價性核對

主持者指定現有 Cloudflare Workers／NuxtHub consumer `<consumer-c>`。唯讀執行
`wrangler d1 execute <consumer-c>-db --remote --config wrangler.jsonc --command
"SELECT environment, timestamp FROM evlog_events ORDER BY timestamp DESC LIMIT 1" --json`：
production D1 的一筆事件是 `environment=production`、`timestamp=2026-09-28T06:18:16.095Z`，
查詢回 `success=true`、`rows_written=0`。同樣唯讀查 staging D1 最新事件為
`environment=production`、`timestamp=2026-09-28T06:16:27.114Z`；staging 的
`wrangler.staging.jsonc` 卻設定 `NUXT_KNOWLEDGE_ENVIRONMENT=staging`。這是 D1 事件欄位
的實值；事件的 `service` 欄位為空，無法由該列證明它走了哪一條標籤設定路徑。

機制核對以該 consumer 最近成功 production deploy 的 source SHA
`0c4ca38fc4886c68040e55a8eb3f9af988fc8708` 為準：`wrangler.jsonc` 注入
`NUXT_KNOWLEDGE_ENVIRONMENT=production`，`nuxt.config.ts` 把它讀入
`runtimeConfig.knowledge.environment`；但 evlog 的 `env` 只設定 `service`，未將該
runtimeConfig 值接到 `environment`。已安裝的 evlog `initLogger` 在未設定
`env.environment` 時回退到 `detectEnvironment()`，後者取 `process.env.NODE_ENV`
（或預設 production/development）。因此 D1 的 `environment=production` **不是**
`NUXT_KNOWLEDGE_ENVIRONMENT` 經零參數 `useRuntimeConfig()` 的驗證讀數；該 consumer 的
`server/utils/knowledge-runtime.ts` 主要入口則是 `useRuntimeConfig(event)`，與 starter
三支 plugin 的零參數呼叫不同。

**當時結論：雖取得線上事件值，候選機制不等價，仍無法判定 TD-016。**
Charles 隨後在 Q164 答「B」授權獨立驗證部署；下段才是本條的等價實測證據。
既有 consumer 沒有被部署或修改，D1 讀數不拿來驗收 starter 路徑。

### 2026-09-28 Q164 獨立 Workers 實測

使用本 repo 的 Nuxt 4.4.2／Nitropack 2.13.3（`template/node_modules` 與 lockfile），
在 gitignored `template/temp/td016-verify/` 建最小 probe，沿用 starter 的
`runtimeConfig.appEnv = process.env.NUXT_APP_ENV || 'unknown'`、
`nitro.preset = 'cloudflare_module'`、`cloudflare.deployConfig = true`、
`nodeCompat = true`，以及 `compatibility_date: 2025-05-15`／`nodejs_compat`。
probe 的 server route 與 starter 三支 plugin 一樣從
`nitropack/runtime/config` 引入零參數 `useRuntimeConfig()`，並在 module 頂層取 snapshot：

```text
const moduleEvalAppEnv = useRuntimeConfig().appEnv
const moduleEvalProcessEnv = process.env.NUXT_APP_ENV || null

export default defineEventHandler(event => ({
  moduleEvalAppEnv,
  requestZeroArgAppEnv: useRuntimeConfig().appEnv,
  requestEventAppEnv: useRuntimeConfig(event).appEnv,
  moduleEvalProcessEnv,
  requestProcessEnv: process.env.NUXT_APP_ENV || null,
}))
```

build 指令 `env -u NUXT_APP_ENV node_modules/.bin/nuxt build` exit 0；產出的
`.output/server/chunks/nitro/nitro.mjs` 明含 `appEnv:"unknown"`，證明 build 期
沒有預先寫入 `staging`。Nitro 生成的 `.output/server/wrangler.json` 只有
`ASSETS` 與 `NUXT_APP_ENV=staging` 兩個 binding，`workers_dev=true`、無 route／自訂網域、
無 D1 或 secret；Worker 名稱 `starter-td016-verify-822797f7`。部署前以
`wrangler deployments list --name starter-td016-verify-822797f7 --json` 查回
`This Worker does not exist on your account. [code: 10007]`，避免覆寫既有 Worker。

```text
$ wrangler deploy --config .output/server/wrangler.json
env.NUXT_APP_ENV ("staging")      Environment Variable
Uploaded starter-td016-verify-822797f7
Deployed starter-td016-verify-822797f7 triggers

$ curl --fail-with-body --silent --show-error --location --max-time 20 \
    --write-out '\nHTTP_STATUS=%{http_code}\nEFFECTIVE_URL=%{url_effective}\n' \
    https://starter-td016-verify-822797f7.<account>.workers.dev/api/td016
{"moduleEvalAppEnv":"staging","requestZeroArgAppEnv":"staging","requestEventAppEnv":"staging","moduleEvalProcessEnv":"staging","requestProcessEnv":"staging"}
HTTP_STATUS=200
EFFECTIVE_URL=https://starter-td016-verify-822797f7.<account>.workers.dev/api/td016

$ wrangler delete starter-td016-verify-822797f7 --force --config .output/server/wrangler.json
Successfully deleted starter-td016-verify-822797f7

$ wrangler deployments list --name starter-td016-verify-822797f7 --json
This Worker does not exist on your account. [code: 10007]
```

`curl` 的 status 與 final URL 都是 probe endpoint，沒有被導向其他頁。刪除後的
同一條 Wrangler 查詢 exit 1／10007；它對已知存在的 Worker 唯讀查詢 exit 0，
因此「不存在」不是 CLI／權限失效造成的空輸出。原始 run-evidence receipts：
build `/tmp/clade-evidence-iWtLpG/receipt.json`、deploy
`/tmp/clade-evidence-sSCMXl/receipt.json`、curl
`/tmp/clade-evidence-mLmt8s/receipt.json`、delete
`/tmp/clade-evidence-1gtopy/receipt.json`、刪後查詢
`/tmp/clade-evidence-mQXI7r/receipt.json`（`/tmp` 會清除，上面輸出為 durable evidence）。

**判定：TD-016 的「Cloudflare module-eval snapshot 恆讀不到 runtime 注入值」假說不成立。**
build inline 為 `unknown`，實際 Workers 的零參數 snapshot 卻是 `staging`；
因此此相容日期、flag、preset 與版本組合下，現行 `config.appEnv || 'unknown'`
不會因本條推測的時序而落到 `unknown`。這是最小 probe 對 Nitro／runtimeConfig
接線的等價驗證，**未發送 Sentry 事件，也未執行完整 starter app**；
不能把它擴張成每種 Cloudflare 相容日期、依賴版本或所有 Sentry 故障的保證。

### Problem

`deploy-env-identity` 規約指名 server / nitro plugin 讀 runtime config 的 `config.appEnv`，理由是
「runtime 注入，改值不必重 build」。但 nitro 2.13.3 的 `runtime/internal/config.mjs` 裡：

```js
const _sharedRuntimeConfig = _deepFreeze(applyEnv(klona(_inlineRuntimeConfig), envOptions))
export function useRuntimeConfig(event) {
  if (!event) return _sharedRuntimeConfig      // ← module 載入當下就凍結的 snapshot
  ...                                          // 帶 event 才會 per-request 重跑 applyEnv
}
```

零引數版本回傳的是 **module evaluation 當下**算好的值。而 Cloudflare preset 是在每次 invocation
才把 env 掛上 `globalThis.__env__`（nitropack 的 `presets/cloudflare/runtime/_module-handler.mjs`，就在呼叫
`nitroApp.localFetch` 之前）。若 workerd 在 module 頂層還沒有 populate 原生 `process.env`，
那 `applyEnv` 在那個時點就看不到 wrangler 注入的 `NUXT_APP_ENV`，`config.appEnv` 會恆為
build 期的值 → 落到 `'unknown'`。

三件已釘死的事實：

- Sentry 的 options callback **每個 request 都跑**（包在 `nitroApp.localFetch` 的 Proxy `apply` 內），
  所以呼叫時 `__env__` 一定已經在了 —— 時機不對的是 `useRuntimeConfig()` 那一半，不是 callback。
- `wrangler.jsonc` 是 `compatibility_date: 2025-05-15` + `nodejs_compat`；
  Q164 probe 已量到 module 頂層的 `process.env.NUXT_APP_ENV=staging`。
- 同一個 repo 內另外兩支 evlog plugin 做一樣的零引數呼叫，只是因為檔頭帶 generated header
  被 vite-doctor 跳過，所以沒被這條規則打到 —— 它們有同樣的曝險。

### Resolution

**NEVER** 為了繞過這條就把 `config.appEnv` 換成 `process.env.NUXT_APP_ENV` —— `deploy-env-identity`
指名了 runtime config 那條路徑，這是 clade 標準層的接線，consumer 不能自行偏離。

在本條測試條件下，runtime 注入值於 module evaluation 已可讀；無需改三支 plugin
或偏離 `deploy-env-identity` 接線。若將來升級 Nitro／改 Cloudflare compatibility flags
或觀測到真實 Sentry 標籤異常，應另以相同 build-vs-runtime 分岔 probe 重驗，
不能用這一次讀數推斷所有未來部署。

### Acceptance

- 同版 Nuxt／Nitro、相同 Cloudflare preset／compatibility 條件，build inline
  `appEnv=unknown`、部署時只注入 `NUXT_APP_ENV=staging`，真實 Workers route 回傳
  module-eval 與 request 零參數值均為 `staging`。
- 驗證 Worker 為獨立名稱、無既有 binding／自訂網域；讀數後刪除並由 Cloudflare API 查回 10007。

## TD-017 — `validate-starter` 留下的 `temp/` scaffold 產物會讓 doctor gate 轉紅

**Status**: in-progress（2026-09-30：fixture 清理、`--keep` 與回歸測試已實作並通過本機驗證；待 draft PR 合併後結案）
**Priority**: low — 有明確的手動解法（刪掉 `template/temp/`），但會浪費下一個人一輪除錯
**Discovered**: 2026-09-11 — TD-015 收尾時實際踩到
**Location**: `template/scripts/validate-starter.mjs`、`template/vendor/doctor-shared/run.mjs`（clade-LOCKED）

### Problem

`node scripts/validate-starter.mjs` 會在 `template/temp/validate-starter/` 下產出 4 份完整的
scaffold 專案並**保留**（`temp/` 在 `.gitignore` 內）。vite-doctor 不跳過它，於是接著跑
`pnpm run doctor` 會多出 3 條 `NUXT0054 no-secret-in-public-config` error（來自 generated
`nuxt.config.ts` 的 `runtimeConfig.public.key`），doctor 從 exit 0 變 exit 1。

實測序列：`doctor` clean → 跑 `validate-starter` → `doctor` 3 errors → `rm -rf temp/validate-starter`
→ `doctor` clean。

因為錯誤訊息指向的是 generated 檔的路徑，第一眼很容易誤讀成「我剛才改壞了 scaffold 輸出」。
這與 TD-013 順手修掉的 `.pi/**` 是同一類：gate 掃到了不屬於本 repo 原始碼的產物。

### Fix approach

兩條路擇一（或都做）：

1. `scripts/validate-starter.mjs` 收尾時清掉 `temp/validate-starter/`（或改用 mkdtemp 到系統暫存區）。
   保留產物對除錯有用，那就加一個 `--keep` 旗標，預設清掉。
2. 讓 doctor 跳過 `temp/**`。落點是 consumer 自有的 doctor.config.json 宣告檔，
   **NOT** clade-LOCKED 的 `vendor/doctor-shared/`。

本次採第一條：在既有驗證流程的 `finally` 清掉 `temp/validate-starter/`，涵蓋成功、
regression、build／audit 例外與 preflight 失敗；只清理該腳本的 fixture 目錄。
需要保留完整或部分產物時執行 `pnpm run validate:starter --keep`，終端會列出保留路徑。
TD-008 的工具搬移是獨立工作，搬移時須保留本條的清理行為與回歸測試。

### Acceptance

- 跑完 `validate-starter` 之後，`pnpm run doctor` 仍是 exit 0。

### Verification（2026-09-30）

- `pnpm test:file test/unit/scripts/validate-starter.test.ts packages/create-nuxt-starter/test/scaffold-audit-regression.test.ts`：13 tests 通過。
  新增 8 案執行真實 CLI 與檔案清理，隔離 build／scaffold／audit 依賴；修正前 5 個預設清理案例均失敗。
- 改動腳本與測試的 `pnpm format:check`、`pnpm lint`，以及 `pnpm typecheck` 均 exit 0。
- 實跑 `pnpm run validate:starter` → `--keep` → 預設模式：每趟四種 preset 均通過；
  `--keep` 保留四份 fixture，預設模式結束後目錄不存在，`pnpm run doctor` 為 clean（0 errors／warnings、exit 0）。

## TD-018 — auto-commit 失敗會把 clade projection state 卡在半套用，後續 propagate 一律誤報 conflict

**Status**: done（2026-09-27 核對 origin/main；clade PR #233 修正、starter 連續升版落地）
**Priority**: high — 一次 pre-commit 失敗就讓這台**永久**掉出 fleet，且錯誤訊息指向錯的方向
**Discovered**: 2026-09-11 — v1.12.47 propagate 對本 consumer failed 時追出來
**Location**: clade `scripts/lib/runtime-artifact-apply.ts`（conflict 判定）、clade auto-commit flow 的 rescue/revert 路徑

### Problem

clade 的 projection state 分兩層存放，而且**歸屬不同**：

| 層                                                    | 路徑                                         | git       |
| ----------------------------------------------------- | -------------------------------------------- | --------- |
| runtime projection state（conflict 判定實際讀的那份） | `template/.clade/projections/*.json`         | untracked |
| 投影出來的內容檔                                      | `template/.claude/**`、`template/.cursor/**` | tracked   |

`applyRuntimeArtifactPlan()` 把兩者放在同一個 manifest transaction 裡寫，所以 apply 本身是原子的。
問題出在**之後**：auto-commit flow 的 `git commit` 若失敗，rescue 路徑會存下 patch
（`template/.clade/rescue/auto-commit-<ts>.patch`）並回捲 worktree。回捲是 git 層的，
**只還原 tracked 檔**——`.clade/projections/*.json` 是 untracked，原地留在新版 hash。

於是 state 記著新內容、磁碟是舊內容，下一趟 `hub-sync` 走到

```js
} else if (!previousHash || hashContent(before) !== previousHash) {
  throw new Error(`local or modified file conflict: ${rel}`)
}
```

就報 `local or modified file conflict`。這個標籤是錯的：沒有人在 consumer 端改過那個檔，
它就是 HEAD 的內容。訊息把人導向「找誰覆寫了投影」，而真正的狀態是「state 跑到磁碟前面了」。

實測（2026-09-11，v1.12.47）：

- `.claude/rules/session-tasks.operations.md` 磁碟 `70896178…`（= HEAD）
- `.clade/projections/claude.rules.json` 記 `b94a2f96…`
- 用 clade **新** source 重跑投影轉換（插 native-rule 註解 → `<consumer-b>`→`<consumer-b>` → clade 絕對路徑→`<clade-central-repo>`）得到的 sha 逐位等於 `b94a2f96…`，證明 state 是 v1.12.47 的預期輸出，不是 consumer 改動。
- 同一趟共 4 個檔卡住（claude.rules 1、claude.capabilities 2、cursor.rules 1；codex 兩份 0，因為 codex 投影 gitignored 所以沒被回捲）。

**這不是單次意外**。本 consumer 從 v1.12.38 到 v1.12.45 連續 8 趟 propagate 都是同一形狀的
`projection unavailable`，中間只有 v1.12.46 綠過一次。觸發 `git commit` 失敗的原因每次不同——

| run             | 觸發 commit 失敗的原因                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| v1.12.45 16:05Z | root `.husky/pre-commit` 的 `[Starter Hygiene] real-tenant-identifier` 擋下 clade 自己未去識別化的投影（TD-006 ratchet） |
| v1.12.47 19:24Z | pre-commit 以 **134 / SIGABRT** 結束（見下）                                                                             |

——但**後果永遠相同**：wedge 住，而且要人手動復原。

### 134 那一格

`✘ commit failed: Aborted (core dumped) | VITE+ - pre-commit script failed (code 134)`
是 `template/.vite-hooks/_/h` 這支 dispatcher 印的，代表 `template/.vite-hooks/pre-commit`
本身被 SIGABRT 打死。**沒有重現**：事後用同一組 staged 檔（7 個 .md/.json）手跑
`sh -e template/.vite-hooks/pre-commit`、真跑 `git commit`、以及 propagate `--resume`
的那趟 commit，三次都 rc=0（`commit_ms` 1.8s）。

沒有留下 core：apport 對同一個 `ExecutablePath` 只保留一份報告，`/var/crash` 現存三份都不是這次。
兩條**未證實**但值得下次帶著看的線索：

- `/usr/bin/timeout` 在這台是 uutils `rust-coreutils 0.8.0`，`/var/crash` 有它的
  `Signal: 6 / SIGABRT` 實例（2026-09-06，`timeout … vp check`）。目前查不到 pre-commit 路徑上有用到它。
- `NODE_COMPILE_CACHE=~/.cache/node-compile-cache` 是**全域單一目錄**，而
  `vp` 的 shim 明確呼叫 `module.enableCompileCache()`；propagate 跑 `concurrency: 4`，
  等於 4 個 consumer 的 node 併發讀寫同一份 V8 compile cache。

所以 134 目前只能當**間歇性 trigger**看，不是本條的 root cause——root cause 是「任何一次
commit 失敗都會 wedge」。修好 wedge，134 再發生也只會浪費一趟 propagate，不會擋住 fleet。

### Fix approach

落點在 clade，本 repo 不自行實作。三條擇一：

1. rescue/revert 路徑一起回捲 `.clade/projections/*.json`（存 patch 前先備份該目錄，回捲時一併還原）。
   最貼近「transaction 要嘛全成要嘛全退」的語義。
2. `applyRuntimeArtifactPlan()` 在 `hashContent(before) !== previousHash` 時多問一句：
   磁碟內容是否等於 `git show HEAD:<path>`。是 → 這是 state 跑在前面，改成重新投影而不是 throw；
   否 → 才是真的 consumer 覆寫，維持現在的訊息。
3. 至少把訊息分成兩種 —— `local or modified file conflict`（真覆寫）與
   `projection state ahead of worktree`（半套用），後者附上復原指令。

順帶：`--resume` 目前**不會**重試 `status: "failed"` 的 consumer 以外的東西，這點是對的；
但 failed 的 journal entry 留著不會自己好，所以 wedge 一旦形成就一定要人介入。

### 本 repo 的復原程序（已驗證）

已寫進 [`HUB_DRIFT_RUNBOOK.md`](HUB_DRIFT_RUNBOOK.md) 場景 F。摘要：找最新的
`template/.clade/rescue/auto-commit-*.patch` → `git apply` → 驗 projections 與磁碟 0 mismatch →
commit → 跑 `hub-sync` 確認綠。

### 復發：v1.13.25（2026-09-24，RUSH-11 relay）——第二條觸發路徑

v1.13.25 propagate 對本 consumer failed：`capability-ownership-conflict`，點名
`.claude/skills/clarify/rules/Context與選項題撰寫判準.md`。這次**不是** commit 失敗觸發，而是
auto-commit flow 的 **pre-sync reset**（clade `scripts/propagate.ts` `propagateAutoCommitFlow` 第 4 步：
clade-managed dirty → `dumpRescuePatch` → `resetPathsToHead`）：

1. v1.13.24 propagate 寫出新投影並更新 receipts，但 TD-1130（不帶 `-z` 的 porcelain）讓中文檔名的 ` M` 沒進 commit，留在 working tree。
2. v1.13.25 的 auto-commit flow 把這批殘留當 clade-managed dirty：存成 `template/.clade/rescue/auto-commit-2026-09-23T16-06-31-626Z.patch`（168 筆）後 reset 回 HEAD。
3. receipts（gitignored）留在新 hash → 44 筆（`.claude`／`.cursor` 下 aixbdd 的 clarify／implement／specify／system-analysis／work-route `.workflow` 規則檔，全是中文檔名）磁碟 = HEAD、receipt = clade 源 → apply throw。以 clarify 那檔為例：兩者只差第 1 行 aixbdd mirror SHA（`db46b1dd…` → `bc8fdebe…`）。

本 repo 是 `consumers.local` 裡唯一 `flow=auto-commit` 的 consumer，所以這趟只有它失敗。

**未照場景 F 復原**：rescue patch 蓋 168 筆、mismatch 只有 44 筆，且 `git apply --check` 有多個 hunk 套不上
（例：`.claude/skills/spec-by-example/rules/gherkin-驗收句型與結構判準.md`）→ 依 runbook 判準不套，交 clade 端裁決。
同一趟已先把 36 筆 TD-1130 遺留的 aixbdd 舊投影 ` D` 補 commit（`8d038af2`；36/36 與 clade 源 byte 一致、不在任何 receipt）。

**歷史待辦已收斂**：clade PR #233（`f4f310585`）證明「commit 失敗 → 下一趟 pre-sync reset」與本節復發是同一形狀，改為磁碟 hash 等於 receipt 的自產殘留不回捲；clade PR #327（`3bc9c4f65`）另外讓乾淨的 HEAD 內容可重新對齊過期 receipt。starter 的 `830c992e`（v1.13.30）、`f1f211cf`（v1.13.31）先後合入 manifest 與投影；`81eb192f` 已升到 v1.13.37。因此先前「停在 v1.13.24」的敘述僅是 2026-09-24 快照，不再是現況。

### Acceptance

- clade 端：任一 consumer 的 auto-commit commit 失敗後，下一趟 propagate **不再**出現
  `local or modified file conflict`（而是重投影成功，或給出指名半套用狀態的訊息）。
- 本 repo：連續兩趟 propagate 對 `nuxt-supabase-starter/template` 不是 `failed`。

### 結案證據

- clade PR #233（`f4f310585`）的回歸測試覆蓋 commit 失敗後的自產殘留與真正的 consumer 手改；PR #327（`3bc9c4f65`）覆蓋乾淨 HEAD／過期 receipt 的重新對齊。
- starter main 的 `830c992e` 與 `f1f211cf` 是連續兩次帶投影的 clade 升版提交，均晚於 PR #233；後續 `81eb192f` 升至 v1.13.37。這些是合入 main 的證據，不以未合 PR 或派工紀錄代替。

## TD-019 — `scaffold-smoke` 自 2026-08-24 起持續紅，剩餘 blocker 是 clade 投影未去識別化

**Status**: open — 兩層 blocker，第一層已修，第二層落點在 clade
**Priority**: mid — gate 紅了三週，實質上沒有人在讀它的結果
**Discovered**: 2026-09-11 — 修 setup-vp 那兩支時順帶查出來
**Location**: `scripts/smoke-scaffold.sh`（`scan_placeholders()`）、`template/vendor/**`、`template/scripts/**`

### Problem

`scaffold-smoke` 最後一次綠是 2026-08-18（`383e2408`），之後每一趟都紅。堆了兩層：

**第一層（已修，`50f001cd`；CI 實測已越過此關，改停在第二層）**：`scripts/smoke-scaffold.sh` 的必備資產清單還在斷言
scaffold 輸出要有 `.claude/commands/validate-starter.md`，但 `17f080cf` 依 L3 commands hygiene
把它判成 `starter-owned-relocate` 並移出 `template/`。斷言沒跟著改，gate 就永遠停在這裡，
**後面每一關都沒被執行過** —— 包含下面這層。

**第二層（未修）**：拿掉第一層之後，`placeholder scan` 接著紅。本機實跑 25 個命中，
**全部**落在 clade 投影出來的 `vendor/**` 與 `scripts/**`，app 程式碼零命中：

| 命中                         | 數量 | 例子                                                                                                  |
| ---------------------------- | ---- | ----------------------------------------------------------------------------------------------------- |
| 字面 `nuxt-supabase-starter` | 18   | `vendor/snippets/pitfalls/TEMPLATE.md`、`vendor/oxc-shared/preset.ts`、`scripts/pre-push/checks/*.sh` |
| `demo`                       | 7    | 其中數個是子字串誤判：`demonstrably`、`demonstrate` 也會中                                            |

兩個成因要分開看：

1. **真訊號** —— clade 投影把 starter 自己的 consumer id 寫進了會被 scaffold 帶走的
   `vendor/**`。這就是 `clade-starter-sanitization` / TD-006 的存量去識別化，
   落點在 clade（bootstrap 把 starter 自己當 consumer 投影）。
2. **scanner 缺陷** —— `scan_placeholders()` 的 pattern 裡 `demo` 沒有詞界，
   `demonstrate` / `demonstrably` 一律誤判。另外它 exclude 了 `.claude/**` 卻沒 exclude
   `vendor/**` 與 `scripts/**`，而這三者同樣都是 clade 投影面 —— 這個不對稱沒有寫下理由。

### Fix approach

**NEVER** 把 `vendor/**` / `scripts/**` 加進 exclude 名單來讓 CI 轉綠 —— 第 1 點是真訊號，
遮掉它等於用暫時修法繞過 root cause，而且遮掉的正好是唯一會被 scaffold 帶走的那半。

順序應該是：

1. `demo` 改成有詞界的 pattern（`\bdemo\b`），先把誤判從真訊號裡分離出來。分完之後
   剩下的命中數才是這條債的真實大小。
2. 等 `clade-starter-sanitization` 把 `vendor/**` 的存量去識別化做完（clade 側）。
3. 若確認 `.claude/**` 被 exclude 是有意的治理決定（那層由 audit-template-hygiene 與
   public-hygiene 各自守），就把同樣的理由寫進 `scan_placeholders()` 上方，讓下一個人
   看得出 exclude 名單的判準是什麼，而不是逐案累加。

### Acceptance

- `bash scripts/smoke-scaffold.sh temp/<name>` 跑到 `[PASS] placeholder scan clean` 之後才停。
- `scaffold-smoke` workflow 在 main 上轉綠。

### 2026-09-29 root cause 複核（main `36546488912`，clade v1.13.44）

- 死在 `[FAIL] placeholder scan found unexpected hits`，比 2026-09-11 那次少：`vendor/**` 已無命中，剩 10 個命中、9 個檔，
  **全部**是 `template/scripts/` 下標了 `🔒 LOCKED — managed by clade` 的投影檔：`preservation-profiles.ts:74`
  （consumer 名冊一列）、`wt-batch.ts:196`（consumer → repo 對照一列）、`pre-push/runner.sh:54` 與
  `pre-push/checks/{nuxt-typecheck,utable-slots,mutation-loading,data-perf-check,review-rules-ratchet,native-picker-ban,nuxt-ui-mixed-slot}.sh`
  各一行註解。
- 落點在 clade 源檔 `vendor/scripts/`（同名同行，v1.13.44 仍在）：註解型 9 處可改成 `<consumer>`；名冊／對照型 2 處
  （`preservation-profiles.ts`、`wt-batch.ts`）是真資料，要 clade 決定「投影時去識別化」或「名冊改由 registry 讀入」。
  starter 端改投影檔會被下次 propagate 覆寫，加 exclude 又違反上面的 NEVER，因此本 repo 沒有可落地的修法。
- scan 之後的 `typecheck`／`test:unit`／`test`／`check` 四關至今沒在 CI 跑到過；去識別化落地後仍可能各自露出新的紅燈。

## TD-020 — 選了 codex 的 scaffold 輸出靜默少掉 `.codex/` 與 `.agents/`

**Status**: in-progress — Q160 已選 A，scaffold 最小投影實作待 PR 驗證與合入
**Priority**: high — 使用者選了 codex 卻拿到不完整的專案，而且沒有任何錯誤訊息
**Discovered**: 2026-09-11 — 修好 setup-vp 之後 Template CI 第一次跑到 Unit tests 才露出來
**Location**: `template/packages/create-nuxt-starter/src/assemble.ts`、
`template/packages/create-nuxt-starter/test/scaffold.test.ts`、`template/.gitignore`

下方 Problem／Fix approach 是 2026-09-11 根因紀錄；PR #13 已移除當時的
`copyTemplateCodexAssets()`，但只在 managed 安裝後由 Clade 補完整投影。
本次 Q160 的差額是讓 scaffold-only／`--no-install` 也立即有最小三件檔。

### Problem

`copyTemplateCodexAssets()` 用 `existsSync` 守著兩個來源目錄再 copy：

```ts
const codexDir = join(STARTER_ROOT, '.codex')
if (existsSync(codexDir)) {
  copyDirectory(codexDir, join(targetDir, '.codex'))
}
const agentsDir = join(STARTER_ROOT, '.agents')
if (existsSync(agentsDir)) {
  copyDirectory(agentsDir, join(targetDir, '.agents'))
}
```

但 `template/.codex/` 與 `template/.agents/` 都在 `template/.gitignore` 內（第 81、87 行）——
它們是 `sync-to-codex` 從 `.claude/` 產生的可重生投影，**不進版控**。

後果：在**乾淨 clone 或 degit** 出來的樹上，兩個來源都不存在，`existsSync` 直接讓兩個 copy
變 no-op。使用者選了 codex，拿到的專案只有 `AGENTS.md`，沒有 `.codex/`、沒有 `.agents/`，
**而且沒有任何 warning 或 error**。在跑過 `sync-to-codex` 的開發機上則一切正常——這就是為什麼
`scaffold.test.ts:255` 在本機綠、在 CI 紅。

CI 實測（`50f001cd`，343 passed / 1 failed）：

```
❯ test/scaffold.test.ts:255:66
  expect(existsSync(join(targetDir, '.codex', 'config.toml'))).toBe(true)
  AssertionError: expected false to be true
```

第 256 行的 `.agents/skills/commit/SKILL.md` 是同一個成因，只是斷言在 255 就先掛了所以沒顯示。
`assemble.ts:1195` 的 `.agents/commands/spectra` 也屬同一類。

**這不只是測試過期**。測試斷言的是這個 case 自己宣告的行為（`supports codex + cursor
multi-select while keeping claude source assets`），實作則把「來源不存在」靜默降級成部分輸出。
先前 Template CI 死在 setup 那格，所以這條從來沒被執行到。

### Fix approach

**已收斂（2026-09-11，grok-4.6 / xai high 唯讀顧問，label `td020-codex-scaffold`，主線逐條核實過）。**
原本列的三條**全部否決**，採第四條。

#### 採用：從 target 的 `.claude/` 做薄投影

`assemble` 不再抄 starter 的 gitignore 快照，改成在 prune + `generateSettings` **之後**，
從**已經拷進 target** 的 `.claude/` 生成 `.agents/skills/` 與 `.codex/config.toml`。
不搬 clade 的 converter，也不把那兩棵樹收進版控。選了 `codex` 而源 `.claude/skills` 不存在 → throw。

決定性的證據是**同一支檔裡的不對稱**（已核實）：

| 函式                       | 行                    | 寫法                                                            |
| -------------------------- | --------------------- | --------------------------------------------------------------- |
| `copyTemplateClaudeAssets` | `assemble.ts:207-209` | 直接 `copyDirectory`，**沒有** `existsSync` —— 「這個源是契約」 |
| `copyTemplateCodexAssets`  | `assemble.ts:251-263` | 兩個 `existsSync` 守門 —— 「有就拷、沒有算了」                  |

使用者顯式 `--agents codex` 時，optional 模式就是錯的模式。而且 `.agents/skills/` 的內容
**本來就推導得出來**：`template/.claude/skills/` 的 83 個目錄全部出現在 `.agents/skills/` 內，
測試第 256 行要的 `template/.claude/skills/commit/SKILL.md` 是 **tracked**（已 `git ls-files` 核實）。
`.codex/config.toml` 則是 `.claude/settings.json` 那組欄位的 TOML 視圖，不是獨立的源。

順帶修正本 TD 原文三處不精準（顧問指出、主線核實）：
`copyTemplateCodexAssets` 是 **251-263** 不是 251-262；`.gitignore` 的「可重生投影」註解在
**第 86 行、只屬 `.agents/`**，`.codex/` 在第 81 行夾在 `.clade/runtime/` 旁邊、沒有那句註解；
`assemble.ts:1195` 的 `.agents/commands/spectra` 是 **prune（`rmSync`）不是 copy**，同一棵樹、方向相反。

#### 三條原文為什麼都輸

- **原文 1（搬 converter 進 seed）**：要搬的不是一支檔。clade `scripts/sync-to-codex.ts` 是
  **2506 行**、還 import 一串 `project-runtime-*` 內部模組（已核實）；`~/.claude/scripts/sync-to-codex.ts`
  那支 45 行 shim 自己就寫明它只負責定位 clade，理由是「避免 user-level 放一份會漂移、且無版控的副本」。
- **原文 2（收進版控）**：本機實測 `.agents/` 1111 檔 / 12M、`.codex/` 167 檔 / 2.1M，等於 `.claude/`
  的第三份副本；直接打臉 hygiene 前提且必須擴大 L3 掃描範圍，不擴大就是開洞。更糟的是抄出去的仍是
  **starter 快照**，會把還沒剝掉的 `local-supabase` MCP 烤進沒選 database 的專案——正是
  `post-scaffold.ts:879-881` 註解在防的那件事。
- **原文 3（改成大聲失敗）**：`post-scaffold.ts:1589-1593` **已經**在 warn 了，問題是文案寫
  「這代表專案不會有 Codex / Cursor 的投影檔。**只用 Claude Code 的話可以忽略。**」——對剛選了
  codex 的人這句是錯的。而且測試第 255-256 行斷的是**檔在**、不是 throw，改成 throw 不會讓 CI 綠。
  這是診斷，不是修法。

#### 真正的生成點綁錯機器（新發現）

`post-scaffold.ts` 的 `runSyncToAgents()`（1585-1604）找 `~/.claude/scripts/` 的 shim，
找不到就 warn 然後 return；`post-scaffold.ts:882-888` 在 pnpm 沒裝好時同樣直接略過。
也就是說**現有生成路徑預設使用者有 Claude Code ＋ clade**——而「選了 Codex、機器上沒有 clade」
的人正是這個選項的目標使用者。這條路對他們本來就過不去。

### Codex 開箱契約決策紀錄

2026-09-28 Charles 對 Q160 答 A：scaffold 直接保證 `AGENTS.md`、
`.codex/config.toml`、`.agents/skills/`。落地前用 Codex CLI 0.157.1 在只有這三類檔案、
沒有 `.codex/rules` 的隔離目錄實跑 `codex exec --ephemeral --ignore-user-config`，
成功載入 `.agents/skills/probe/SKILL.md` 並輸出 `CODEX_MINIMAL_OK`（exit 0）。
完整 clade 投影仍可在 managed bootstrap 後覆蓋最小投影。

**這是產品格不是技術格**，落地形狀完全不同：

|                   | 意思                                                                                                                                                | 後果                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **A**（顧問預設） | assemble 保證 `.codex/config.toml` + `.agents/skills/**`（含 `commit/SKILL.md`）+ tracked `AGENTS.md`；`.codex/rules` 等完整語義轉換有 clade 才升級 | 不改 hygiene 掃描範圍、不搬 converter、CI 單測可綠                                                            |
| **B**             | 選了 `codex` 就必須等同開發機跑過 `sync-to-codex`（含 `.codex/rules` 全部）                                                                         | `runSyncToAgents` 在缺 shim/clade 時 **throw**；等於宣告「Codex scaffold 需要本機 clade」。**仍然不走原文 2** |

**未驗證的那一格**：沒有人驗過 Codex CLI 在只有 `AGENTS.md` + `.codex/config.toml` + `.agents/skills`、
**沒有** `.codex/rules` 時算不算可用專案。A 若在這格是假的，交付出去的會是「看起來有、實際不能用」的
codex 專案——比現在這個 bug 更安靜。**拍板前不實作。**

落地 A 之後要順帶改的一句話：`.claude/rules/starter-hygiene.md` § 掃描範圍 的
「不進版控 = **不會被 scaffold 帶走**」會半真半假——「不進版控」仍真，「不會被帶走」變假
（輸出裡會有，但是 scaffolder 生成的，不是 template 樹帶走的）。意思要改成「template git 樹仍不掃；
scaffold 輸出由 assemble 生成，不屬 L3 掃 template 的範圍」。**NEVER** 因此擴大 `SCAN_TARGETS`。

### 顧問 concerns 的處置

顧問以 `DONE_WITH_CONCERNS` 收尾，三條 concerns：

1. 「未獨立重跑 Template CI `50f001cd`」→ **已由主線的 CI log 消化**（343 passed / 1 failed，
   失敗行就是 `scaffold.test.ts:255`）。
2. 「未在乾淨 worktree 實跑 `assembleProject`，靜默 no-op 是從原始碼推的」→ **已由同一份 CI log 消化**：
   CI 的乾淨 clone 就是那個乾淨 worktree，實測結果與推論一致。
3. 「未驗證 Codex CLI 缺 `.codex/rules` 時可用與否」→ **仍然開著**，就是上面 A/B 那一格。

### Acceptance

- 在乾淨 clone（沒跑過 `sync-to-codex`）上以 `--agents codex,cursor` scaffold，輸出必含
  `AGENTS.md`、`.codex/config.toml` 與 `.agents/skills/commit/SKILL.md`；來源缺失須當場失敗。
- `Template CI` 的 Unit tests 在 main 上轉綠。

## TD-021 — Template CI `UX drift audit` 既有紅燈：`shared/types` 沒有 enum-like 定義就 fail

**Discovered**: 2026-09-28 — PR #13（`59adc3cb`）讓 Unit tests job 的 `Unit tests` step 轉綠之後露出來

### Problem

Template CI 的 Unit tests job 在 `Unit tests` step 之後跑 `vp run audit:ux-drift`
（`node scripts/audit-ux-drift.ts`，clade-managed 投影）。它在 starter 上直接 exit 2：

```
✗ No enum-like definitions found in configured types dirs.
  Searched: shared/types
```

`template/shared/types/` 只有 `pagination.ts`、`profiles.ts`，沒有 enum-like 定義；
`template/spectra-advanced.config.json` 存在。main 上這一步一直是 skipped，因為前一步
`Unit tests` 先紅了（run `36357036651` 等）。PR #13 修好那一步之後，這個紅燈才第一次被執行到
（PR run `36357476335`）。在 PR head 本機跑 `vp run audit:ux-drift` 也一樣紅，PR diff 沒碰該 script、
`shared/types` 或 config，所以這是既有問題，不是 PR #13 造成的。coordinator 2026-09-28 裁決視為既有紅燈照樣合入 PR #13。

### Fix approach

先判 root cause 在哪一層，再動手：

- clade `audit-ux-drift.ts` 對「零 enum 的專案」fail-closed：若 starter 沒有 enum 是合法狀態，
  修法在 clade（零 enum 時回報 skip／pass 而非 exit 2），starter 端 **NEVER** 直接改投影檔。
- 若 audit 的前提是「專案必有 enum-like 定義」：修法在 starter 的 `spectra-advanced.config.json`
  `paths.types` 指向或 CI step 條件，另開 change 設計。

### Acceptance

- main 上 Template CI 的 Unit tests job 全綠（`UX drift audit` 不再 exit 2，且不是靠跳過 step 過關）。

### 2026-09-29 root cause 複核

- `gh api` 掃 Template CI 最近 31 趟：19 趟紅，最近 10 趟全是 `UX drift audit` 這一步（最早 `36357476335`，即 PR #13 讓前一步轉綠之後）；
  更早 9 趟是 `Unit tests` 那步，已由 PR #13 修掉。所以現在的 Template CI 紅燈只有這一個 root cause。
- 落點：clade `vendor/scripts/audit-ux-drift.ts` 的 `main()`（`report.enums.length === 0` → `process.exit(2)`，註解明寫
  「Found nothing ≠ no drift」）。它把「零 enum」當成設定壞掉，對從來沒有 enum 的專案沒有出口（無 allow-empty 旗標或 config 欄位）。
- starter 端沒有不作弊的修法：`shared/schemas/` 也沒有 `z.enum`，`paths.types` 改指過去不會多出定義；不能靠條件式跳過 step
  （違反 Acceptance）。唯一實質選項是把 DB 已有的 `profiles.role CHECK (role IN ('admin','user'))`
  建成 `shared/types` 的 enum-like（現在 `profileSchema.role` 是 `z.string()`）——那會改 API 契約與測試，
  且 `server/api/_dev/login.post.ts` 的 `z.enum(['admin','member','guest'])` 與 DB CHECK 已不一致，須先決定角色集合。
- 兩條路都要拍板，專案暫停中不擅動；建議先走 clade 側（零 enum 回報 skip／pass，或提供明確的 allow-empty 設定）。

## TD-022 — repo root 的 Claude session 載不到 `commit-0a-reviewer` seat

**Discovered**: 2026-09-28 — PR #13 的 0-A 在 repo root session 呼叫 `Agent({subagent_type: 'commit-0a-reviewer'})`
回 `Agent type 'commit-0a-reviewer' not found`

### Problem

`commit-0a-reviewer.md` 只投影在 `template/.claude/agents/`；repo root 的 `.claude/` 沒有 `agents/`。
以 repo root 為 cwd 開的 Claude session 不載入 `template/.claude/agents/`，seat 不存在。
`claude-review-safe.sh prepare` 仍會成功並印出 `AGENT_CALL`，到呼叫 Agent 才失敗。
任何在 starter root 跑 `/commit` 的 Claude 主線都會卡在同一處。PR #13 的繞法是改以 `template/` 為 cwd 開 pane。

### Fix approach

修法屬 clade 投影（本 repo **NEVER** 手寫 root agent 定義繞過）：讓 root meta 層也投影
`commit-0a-reviewer`，或 `prepare` 偵測當前 session 載不到 agent 定義時提早報錯並指出要換的 cwd。

### Acceptance

- 在 repo root 開的 Claude session 跑 `prepare medium` → 照 `AGENT_CALL` 呼叫 Agent 能叫出 seat，
  或 `prepare` 當場以明確錯誤拒絕並指出正確 cwd。

## TD-023 — Codex deferred 指令寫死 `init-consumer.ts`，沒走 `.mjs` fallback

**Status**: done（2026-09-30：deferred 指令已共用 initializer resolver，回歸測試通過）
**Discovered**: 2026-09-28 — PR #13 0-A 第二輪（receipt `subagent-a094338120fbabd7e`）的 Minor，非阻擋

### Problem

`template/packages/create-nuxt-starter/src/post-scaffold.ts` 的 `buildDeferredCodexProjectionCommand`
寫死 `scripts/init-consumer.ts`。實際初始化的 `runInitConsumer` 走 `resolveCladeInitScript`，
只有 `init-consumer.mjs` 時會 fallback 過去。本機 Clade 只有舊版 `.mjs` 時，
scaffold-only 印出的延後投影指令會指到不存在的檔案。

### Fix approach

`buildDeferredCodexProjectionCommand` 在 `sourceRoot` 已存在時改用 `resolveCladeInitScript(sourceRoot)`，
不存在（要 clone）時維持 `.ts`；補一條只有 `.mjs` 的 fixture 測試。

### Acceptance

- 只有 `init-consumer.mjs` 的 fixture Clade 下，deferred 指令引用 `.mjs` 且測試綠。

### Verification（2026-09-30）

- 修正前，只有 `.mjs` 的 fixture 測試失敗：deferred 指令仍引用不存在的 `.ts`。
- 修正後，`template/packages/create-nuxt-starter/` 跑 `pnpm test test/post-scaffold.test.ts` → 45 passed；
  涵蓋只有 `.mjs`、兩種 initializer 並存時優先 `.ts`，以及來源尚未 clone 時保留 `.ts`。
- 同目錄 `pnpm typecheck` → exit 0；`template/` 對改動的 source/test 跑 `pnpm lint` 與
  `pnpm format:check` → exit 0。

## TD-024 — Template CI evlog map gate 暫掛 `ratchet`，須推到 `strict`

**Status**: done（2026-09-30：四支 API 插樁補齊，strict 本機驗收通過）
**Discovered**: 2026-09-29 — clade `W-2026-09-29-work-route-evlog-map-ci-parity-runner-task-pre-p`（D3）relay

### Problem

`.github/workflows/template-ci.yml` 的 `evlog map coverage gate` 原本沒寫 `mode:`；action 的 `mode`
沒有預設值，clade 修掉 `@evlog/cli` 偵測 bug（目前整道 gate 靜默 skip）後會以
`--mode must be ratchet | strict (got: )` exit 2，pre-push 同一道 gate 也會擋。2026-09-29 本機量測
`template/` 13 個 entry point、score 39：`ratchet` 通過、strict 不通過，所以先掛 `ratchet`。
evlog-adoption depth-gate § Gate 規定判定走 strict，`ratchet` 只作過渡，**NEVER** 當長期狀態。

### Fix approach

在 `template/` 跑 `npx evlog map --all --no-write` 列出失敗 check，逐個 entry point 補 `log.set` /
error 欄位到零失敗、零 suppression（無法插樁者也不得豁免），更新 `template/evlog.map.json` baseline，
再把 workflow 的 `mode: ratchet` 改成 `mode: strict`（`min-score` 是 gate.ts 的 deprecated 別名，**NEVER** 寫它當終點）。

### Acceptance

- `template-ci.yml` 的 gate 步驟為 `mode: strict`，註解不再指向本條。
- repo 根跑 `node template/.github/actions/evlog-map-gate/local.ts` exit 0（strict 判定）。`local.ts`／`run.sh`
  由含 YuDefine/clade#538 的 clade 版本投影；投影到位前改以 clade 源檔
  `vendor/actions/evlog-map-gate/run.sh` 帶 `INPUT_CWD=template INPUT_MODE=strict` 驗。

### Verification（2026-09-30）

- 三支 profiles API 加入 operation、查詢目標／分頁脈絡；dev-login 改用 request logger，記錄成功、拒絕與失敗 audit，成功事件不收錄 email、密碼或 cookie。
- 四支 API 使用 evlog `createError` 保留 why／fix／cause；測試實跑 h3 錯誤序列化與 NDJSON，並確認不可存取／不存在的 profile 對外錯誤一致。
- `pnpm exec evlog map` 重新產生 baseline：13 個 entry point、score 100、零失敗、零 suppression；workflow 明確切至 `mode: strict`。
- repo 根 `node template/.github/actions/evlog-map-gate/local.ts --print-config` 確認 strict／template；不帶旗標執行 exit 0。
- `template/` 跑 `pnpm test:file test/unit/server/api/v1/profiles test/unit/server/api/_dev/login.post.test.ts test/unit/server/api/_dev/login.observability.dev.test.ts`：6 檔、45 passed；`pnpm run typecheck` 與改動路徑的 `pnpm run lint`／`pnpm run format:check` 全部 exit 0。開發分支與非開發 guard 分屬 Vitest project，無 skip。

## TD-025 — scaffold receipt 收錄未進 initial commit 的 `.claude/settings.local.json`，`scaffold-receipt.test.ts` 紅

**Status**: done（2026-09-30：提交版 receipt 改依 Git index 收錄，回歸驗證通過）
**Discovered**: 2026-09-29 — TD-024 那次 `/commit` 的 0-C（`pnpm test`）；把 TD-024 改動 stash 掉後在 `631418e4` 上同樣重現，非該次引入

### Problem

`template/packages/create-nuxt-starter/test/scaffold-receipt.test.ts` 的 scaffold-only 案例穩定失敗：
`git show HEAD:.claude/settings.local.json` → `fatal: path '.claude/settings.local.json' exists on disk, but not in 'HEAD'`。
receipt（`src/scaffold-receipt.ts`）把磁碟上存在、但被 gitignore 擋在 initial commit 外的檔案也列進去，
違反「committed receipt 等於 initial commit 的 blob」。PR #15 當時 3 passed，推測是之後的 clade 投影開始
在 scaffold 期間產生該檔（未驗證）。

### Fix approach

先查是誰在 scaffold 期間寫出 `.claude/settings.local.json`；receipt 收錄範圍改以 initial commit 實際追蹤的檔案
（或排除 gitignored 路徑）為準，而不是磁碟上的全部投影檔。

### Acceptance

- `cd template/packages/create-nuxt-starter && pnpm exec vp test run test/scaffold-receipt.test.ts` 4 passed（原 3 個案例擴充 ignored-file fixture，另補既有 repo 已追蹤 ignored 檔案例）。

### Resolution / Verification（2026-09-30）

- `assemble.ts` 的 `copyTemplateClaudeAssets()` 經 `copyDirectory()` 從磁碟整包複製 `.claude/`，不套用 Git ignore；來源若有本機的 `settings.local.json` 就會帶進 scaffold。新 worktree 沒有該 ignored 檔時原 3 個測試全過；加入明確 fixture 後，修正前 2 failed / 1 passed，證明 receipt 的磁碟範圍與 commit 範圍不同，而非斷言本身有誤。
- 安裝前 receipt 繼續擔保磁碟上的 agent 檔，維持首投影認領契約。提交前先 `git add -A`，以 `git ls-files -z` 的 index 路徑篩選 receipt，再 stage 刷新的 receipt；避免收錄未追蹤 ignored 檔，並保留已追蹤但符合 ignore 的既有檔。NUL 分隔也保留含空白／中文的路徑。
- 回歸涵蓋安裝時位元組、安裝產生的 tracked 檔、`--no-install`、ignored 目錄與 negation、既有 repo 的 tracked ignored 檔，並逐筆核對 committed blob 的 hash。排序改用工具鏈要求的 `toSorted()`，package tsconfig 補 `ES2023` lib，與 Node 24 runtime 對齊。
- Scaffolder `pnpm test`：236 passed / 2 skipped（既有 skipped 未變更）；package `pnpm run typecheck`、改動路徑 `pnpm run lint`／`pnpm run format:check` 通過；template `pnpm run doctor` 為 clean、零診斷。
- PR #20 轉 ready 後，CI run `36703862581` 的兩個 receipt 案例因 runner 缺少 Git 作者／提交者身分而沒有 initial commit，`git show HEAD:...` 失敗。以 `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1` 本機重現相同 2 failed；Template CI 的 Unit tests 步驟提供 fixture 的 `GIT_AUTHOR_*`／`GIT_COMMITTER_*` 後，同環境原測試 4 passed，未修改測試或斷言。合併 main 後的相關 scaffold／更新策略／receipt 測試另驗 62 passed。

## TD-026 — aixbdd B3 逆向基準線只展開 profiles，其餘模組與 Gherkin runner 接線未做

**Status**: open
**Priority**: mid
**Discovered**: 2026-10-03 — clade `W-2026-10-02-aixbdd-benchmark-standard` B3；work `W-2026-10-02-nuxt-supabase-starter-aixbdd-b3`
**Location**: `template/specs/truth/**`、`template/specs/plans/001-baseline-reverse/`

### Problem

`.clade/manifest.json` 宣告了 `aixbdd` 與 `specformula`，但 `specs/truth/` 原本是空的。B3 逆向基準線已建立 backend 試點模組 `profiles`
（techstack、contracts、data、feature、`dsl.md`、覆蓋矩陣、`tools/`），其餘仍缺：

1. 未展開模組：dev-login、audit、observability、shared-utils（backend）；frontend 整個介面（auth、profile-page、admin-users、shell-and-demo）。清單與盤點葉檔見 `template/specs/plans/001-baseline-reverse/coverage/modules.md`。
2. 沒有 Gherkin runner：repo 內沒有 `isa.yml`、沒有 `test:bdd`，所以 `profiles` 的 feature 全部 `@unverified`；規約 MUST 1–3（runner 讀 truth、預設排除 `@unverified`、`dsl.md` ↔ step 雙向對帳）尚未接線。
3. `profiles` 的九個待釐清問題（`questions.md`）：種子使用者 id 不符 zod 4 `uuid()`（Q-profiles-1）最需要裁決；Q-profiles-8 記錄缺口——`POST /api/_dev/login` 不接受指定 id，`呼叫者是使用者` 句型只能「登入後取回實際 id 並綁定別名」，字面 UUID 的情境要改 dev-login 程式才可行（本 package 不動 `server/**`）；Q-profiles-9 記錄另一個缺口——沒有任何機制讓 session 帶 `user.role`（`syncDevLoginRole` 是 no-op、`auth.config.ts` 無 admin plugin／`additionalFields.role`），所有 `角色為 "admin"` 的 Example 在角色機制決定前無法實作（已標 `[need clarification]`）。
4. 這份 truth 放在 `template/specs/`，會被 scaffold 帶走；是否維持，或改為 meta 層專用，尚未裁決。

### Fix approach

先由使用者在 `/technical-research` 拍板各端 BDD runner（SpecFormula 或手寫 step），接線後依 `expansion-guide.md` 的固定決策逐模組展開；frontend 另開 `002-frontend-reverse`。

### Acceptance

- `coverage/modules.md` 沒有「未展開」列，或每個未展開列都有「刻意不補」理由。
- runner 實跑：無標籤 feature 全綠、`@unverified` 被排除、產出的 scenario 數 > 0；雙向對帳 exit 0。
- Q-profiles-9 有裁決（角色落 session 的機制）後，`dsl.md` 的 `呼叫者是使用者` 句型改寫為可實作並移除 admin Example 的 `[need clarification]`。
- `node template/specs/plans/001-baseline-reverse/tools/check-truth.mjs` exit 0。

## Cross-repo pointers

- `<consumer-c>` `docs/tech-debt.md` **TD-069** 是本 repo scaffolder gap 的 consumer-side 鏡像（該專案手動切完 NuxtHub 但沒跑 `migrations:create`）。本條在該 repo 追蹤，此處只保留入口。
