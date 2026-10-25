---
description: 'CI workflow 撰寫規約——外部 GitHub Action 的 uses: MUST SHA-pin、CI 三層分工（PR 只跑必要、e2e 在合併後、commit 前 0-A）；動 .github/workflows 或 .github/actions 時載入'
paths: ['.github/workflows/**', '.github/actions/**']
---
<!-- Clade native rule; source: rules/core/ci-workflow.md; edit canonical source -->
<!-- clade-targets: claude,agents -->
# CI Workflow 撰寫規約

## External action MUST SHA-pin

`.github/workflows/**/*.yml`、`.github/actions/**/action.yml` 裡任何指向 **外部** repo 的
`uses:` 步驟，**MUST** 釘住完整 40 碼 commit SHA，並在同一行用 `# <semver-tag>` 註解人類可讀
的版本：

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

**NEVER** 用 floating tag（`@v4`、`@main`、`@latest`）——可被上游改寫指向。SHA 旁的 `# <tag>` 註解是唯一人類可讀的版本訊號，標錯比不標更糟。

**適用範圍**：外部 `uses:`（`owner/repo@ref` 或 `owner/repo/path@ref` 形式）。**不適用**：
本 repo 內的 local action（`uses: ./.github/actions/<name>`）——那些沒有外部引用可被改寫的風險。

**升版時**：解析目標 semver tag 對應的 commit SHA、換掉 SHA 與註解，**MUST** 反驗
（`git ls-remote` 或 `gh api` 查那個 SHA 確實對應該 tag，不要用記憶或猜測）。操作範本見
`vendor/snippets/ci-workflow-sha-pin/README.md`。

機械偵測：`node scripts/audit-ci-workflow-safety.ts`（warn-only；
掃 `.github/workflows/**/*.yml` 與 `.github/actions/**/action.yml`，check #1 對**每一個**外部 `uses:` 檢查 ref 是否為
40 碼十六進位字串；同支的 check #2 / #3 管 deploy 私鑰與 host key，規約在 [[self-hosted-runner]] § 11）。

## CI / test workflow MUST cancel superseded runs on the same ref

**適用範圍**：lint、typecheck、test、validate 這類**驗證** workflow。**不適用**：會部署 staging / production、或被另一條 workflow 用「同 SHA success」當 gate 的 workflow。

單槽 self-hosted runner 上，同 ref 連續 push 若每條 run 都跑完，**最新 SHA 會排在已過期 SHA 後面**，HEAD 可能要等半小時才開始跑。過期 SHA 的結果不能當最新 candidate 的綠燈。

**每一個** CI / test / validate workflow **MUST** 有：

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event_name }}-${{ (github.event_name == 'push' || github.event_name == 'pull_request') && github.ref || github.run_id }}
  cancel-in-progress: ${{ github.event_name == 'push' || github.event_name == 'pull_request' }}
```

操作步驟與例外表見 `vendor/snippets/ci-workflow-concurrency/README.md`。

- **MUST** `group` 含 `github.workflow` 與 `github.event_name`。`push` / `pull_request` 再加 `github.ref`，讓同 ref 的新 run 取消舊 run。`schedule` / `workflow_dispatch` / `merge_group` 改用 `github.run_id`：GitHub 會取消同一 group 裡**排隊中**的 run，即使 `cancel-in-progress: false`；用 run_id 才不會讓兩次手動 shard 或 nightly 互殺
- **MUST** 只對 `push` 與 `pull_request` 開 `cancel-in-progress`。其餘 event 維持跑完——nightly 不得取消正在測的 HEAD，merge queue 的 landing run 也不得被下一筆 push 殺掉
- **NEVER** 把 `cancel-in-progress: true` 抄到 staging / production deploy、或「另一條 workflow 用同 SHA success 當放行條件」的 workflow。那個組合會讓發版 gate 看到 cancelled、誤判沒過 staging。反面實證：[[pitfall-deploy-gate-vs-cancel-in-progress]]
- **NEVER** 用同一個 concurrency group 蓋住 callee 自己也會被獨立 trigger 的 reusable workflow——會互殺。見 [[pitfall-reusable-ci-concurrency-collision]]
- 同一條 run 裡的 matrix shard（例如 `test-lanes` 1/6…6/6）**不是**「前面步驟」，**NEVER** 為了縮短排隊取消其他 shard。它們測的是不同檔；concurrency 取消的是**過期 SHA 的整條 run**

**例外——只限 clade 自身的 `.github/workflows/validate.yml`**：`push`（`main`／`integration/**`）不開 `cancel-in-progress`，只有 `pull_request` 開；`group` 照上方不變。clade 的 main 連續落地的間隔短於一趟 validate，push 一取消，每一趟都在跑到一半時被下一趟殺掉，main 上沒有任何一趟跑完；而它的 affected lane 以「該 branch 上一次綠燈的 push」為 base，綠燈不前進，要測的範圍只會越滾越大。`group` 仍含 `github.ref`，所以同 ref 一次只跑一趟、排隊中的舊 run 仍被最新一趟頂掉，HEAD 最多等一趟。這個例外成立的前提是沒有任何 workflow 以同 SHA 的 validate success 當放行條件。consumer 的驗證 workflow **不適用**本例外，照上方 YAML。

`gh-ci-watch` 在 run 被取消時會改追 superseding run（同 workflow + 同 branch、較新 `createdAt`）。那是監看側的補救，**不能**代替 workflow 自己取消過期 run。

`audit-ci-toolchain-parity.ts`（[[ci-toolchain-parity]]）只檢查三個 toolchain 入口 action 的 SHA-pin，是本檔的子集；全部外部 action 的權威來源是本檔與 `audit-ci-workflow-safety.ts`。

## CI 三層分工

**每一個** repo（clade 與**每一個** registry consumer）的驗證分三層，各層跑什麼由觸發時刻決定：

| 層 | 時刻 | 跑什麼 |
| --- | --- | --- |
| commit 前 | agent 下 `git commit` 之前 | commit 0-A：fresh-context reviewer，見 [[commit]]（`commit.detail.md`）與 `.claude/scripts/claude-review-safe.sh` |
| 合併前 | `pull_request`，或不限 branch 的 `push` | lint、typecheck、unit test。consumer 跑**全量** unit（實測 1–8 分）；clade 的範圍見 [[github-flow]] § 各事件的 test-lane |
| 合併後 | `push` 到 `main`（含由它接出的 `workflow_run`，`branches: [main]`） | 全量 unit 與 e2e。tag／deploy、`schedule` 可以**再**跑一次，但不能是唯一一次 |

- **每一個**合併前會跑的 workflow 組合 **MUST** 含 lint 與 typecheck 步驟
- **測試碼的型別檢查**：repo 在 `test/`、`tests/`、`e2e/`、`features/` 底下有 TS（`test(s)/nuxt/` 與 `.d.ts` 除外）時，合併前 lane 的 typecheck **MUST** 涵蓋它們——給測試碼一份自己寫 `include` 的 tsconfig，用 `vue-tsc -p <dir>/tsconfig.json --noEmit` 接進 typecheck script。Nuxt 生成的 tsconfig 只含 `app/`、`server/`、`shared/`、`test/nuxt/`，`nuxt typecheck` 綠不代表測試碼型別正確（2026-10-18 盤點：9 個 Nuxt consumer 只有一個有擋，最大的一個有 900 多支測試檔從沒被型別檢查過）
  - 接上 gate **之前** MUST 先跑一次量存量 error：非零 → 先接 ratchet（總 error 數 ≤ baseline、baseline 只降不升），清零後才換成 exit 0 的 gate（可達的驗收形狀見 [[agent-self-verification]]）。**NEVER** 存量非零就直接上 exit 0 的 gate——部署 `workflow_call` 同一份 CI 時，測試碼的存量型別錯誤會連帶擋住正式上線，即使網站程式本身沒問題
  - **NEVER** 為了讓 typecheck 綠，把測試碼移出所有會被 CI 跑的 tsconfig
- **部署 MUST 掛在檢查之後**：私有 repo 在 GitHub 免費方案沒有 branch protection，CI 紅擋不住 merge，部署是型別錯誤上線前最後一道。deploy／release workflow **MUST** 二擇一：`uses: ./.github/workflows/<ci>.yml` 並讓部署 job `needs` 它，或部署 job 之前在同一條 workflow 自跑 lint 與 typecheck。用 `workflow_run` 接 CI 時 **MUST** 在部署 job 的 `if:` 寫 `github.event.workflow_run.conclusion == 'success'`——`workflow_run` 在 CI 失敗時也會觸發，只有 trigger 等於沒擋
- 上面兩條的成因與量測：`docs/rule-rationale/ci-workflow.md`
- 合併前 lane **NEVER** 跑 e2e——`playwright test`、`test:e2e`、`test:bdd`、`cypress run`、要起 server 或 DB 的 BDD 都算。它是整條 CI 最慢、最常 flaky 的一段，放在 PR 上每次 push 都付一次
- repo 有 unit test（`package.json` 的 `test` script＋`*.test.*`／`*.spec.*`）時，**每一個** consumer **MUST** 在合併前與 push `main` 各跑一次全量；沒有 unit test 不必為了 CI 補寫（何時寫見 [[testing-anti-patterns]] § unit test 何時寫）
- repo 有 e2e 設定（`playwright.config.*`、`cucumber.cjs`）時，**MUST** 有 push `main` 觸發得到的 job 跑它——只接在 tag／deploy 之後，等於每次合併都沒驗；`workflow_run` 接 e2e 時 **MUST** 寫 `branches: [main]`——沒寫的話 PR 那一趟 CI 完成也會觸發它，e2e 等於又回到合併前
- 本節只管**哪一層跑什麼**：把 e2e／全量 unit 換到合併後時，job 的 `timeout-minutes` 與測試逾時照搬原值，**NEVER** 趁搬家放寬逾時

機械偵測：`node scripts/audit-ci-three-tier.ts`（單 repo 有 finding exit 1；`--all-consumers` warn-only，接在 `/clade-health` enforcement 段）。workflow 是 consumer 自治區，命中 relay 給該 consumer 的 session 修。

| REQUIRED 欄位 | `pr-missing-test-typecheck`／`deploy-ungated` |
| --- | --- |
| 觸發條件 | 有任一支測試碼不在合併前 typecheck 範圍內／有部署 workflow 沒被 typecheck 擋住 → finding；單 repo exit 1，`--all-consumers` warn-only |
| 消費端 | `/clade-health` enforcement 段；`convention-conformance-audit.ts --live` 的 `test-code-typecheck`／`deploy-ci-gating` 兩欄（宣告與實況不符判 drift）；命中 relay 給該 consumer 的 session |
| 觸發點 | 失敗輸出：兩個 finding 的 detail 直接印本檔判準位置（`rules/core/ci-workflow.md` § CI 三層分工） |

## job 內 step 並行（`parallel`／`background`）：建議，不是預設

GitHub Actions 2026-06-25 起可在單一 job 內並行 step（`parallel:` 區塊、`background: true`＋`wait:`／`wait-all`／`cancel:`）。**未並行不算缺口**；要在**任一** workflow 改寫成並行時，先照下面三段判。

**前提**：runner ≥ actions/runner 2.335.0（被 `cancel` 的 background step 不影響 job 結果要 ≥ 2.336.0）。版本下限來自公開來源，不是對舊 runner 實測：fleet self-hosted 只實測過 2.337.0（3 個槽），其他槽版本沒有逐一核對；推論舊版 runner 不認得這些關鍵字、job 在驗證階段失敗，失敗形態未實測。

**何時值得**：只有「彼此獨立、且可並行部分佔 job 執行時間大半、且不搶同一份 CPU」的 step 才有感。2026-10-09 的兩個試點（排除主機差異後）都只縮短一成多：clade `vp-check` −10.2%（可並行的 Lint＋Format 只佔 job 15–21%）、某 consumer 的 `pr-ci` −12.8%（Typecheck 與 Run tests 都吃 CPU，並行時各自慢近一倍，群組耗時≈兩者串列相加）。

**量效益的口徑**：
- 只比 job 執行時間（不含排隊），前後各 ≥ 5 筆
- **MUST** 排除主機差異：runner 由排程指派、主機間差到一倍，兩組中位數直接比會被主機組合左右（`vp-check` 字面 −26.7%，同趟對照只有 −10.2%）。做法是同一趟內由 step 時間推回串列時間，或每筆除以同 runner 的串列中位數
- **NEVER** 用「群組耗時 vs 各步耗時加總」當效益——並行時各步被 CPU 競爭拖慢，加總會高估

**改寫時的限制**（實測於 self-hosted Linux runner，另註公開文件者）：
- **NEVER** 在 `wait` 之前用 `steps.<id>.outputs` 引用 background step——整支 workflow 檔被判無效、不啟動
- 群組進行中 `GITHUB_ENV`／`GITHUB_OUTPUT`／`GITHUB_PATH` 互相看不到，群組結束後才可見
- `wait` 等的是 step 結束，不是服務就緒：shell `&` 改 `background: true` 時 health 輪詢要保留
- 群組內一個 step 失敗，其餘照跑完、群組與 job 失敗、後續一般 step 跳過——檢查效力不變
- composite action 內不能宣告 `background`／`parallel`；單一 job 最多 10 個 background step（公開文件）
- actionlint（至 v1.7.12）不認得這些關鍵字，會報 `unexpected key`；有跑 actionlint 的 repo 先處理 lint 流程
- **NEVER** 在 Windows runner 的 job 改並行：actions/runner #4641（`parallel` 的 action step 因 `event.json` 被鎖而失敗）、#4766（`cancel:` 會打斷其他正在跑的 step）（公開 issue：#4641 回報於 2.336.0、#4766 在 2.337.0 重現；2026-10-09 查證時皆 open）
- 改寫既有串列 step 時 `run:` 命令文字不變，避免逐字對帳的測試與腳本（例如 clade `scripts/check.ts` 的 `CHECK_STEPS`）漂移
