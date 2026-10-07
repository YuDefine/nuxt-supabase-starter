---
description: 'CI workflow 撰寫規約——外部 GitHub Action 的 uses: MUST SHA-pin、CI 三層分工（PR 只跑必要、e2e 在合併後、commit 前 0-A）；動 .github/workflows 或 .github/actions 時載入'
paths: ['.github/workflows/**', '.github/actions/**']
---
<!-- Clade native rule; source: rules/core/ci-workflow.md; edit canonical source -->
<!-- clade-targets: claude,codex -->
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
- 合併前 lane **NEVER** 跑 e2e——`playwright test`、`test:e2e`、`test:bdd`、`cypress run`、要起 server 或 DB 的 BDD 都算。它是整條 CI 最慢、最常 flaky 的一段，放在 PR 上每次 push 都付一次
- repo 有 unit test（`package.json` 的 `test` script＋`*.test.*`／`*.spec.*`）時，**每一個** consumer **MUST** 在合併前與 push `main` 各跑一次全量；沒有 unit test 不必為了 CI 補寫（何時寫見 [[testing-anti-patterns]] § unit test 何時寫）
- repo 有 e2e 設定（`playwright.config.*`、`cucumber.cjs`）時，**MUST** 有 push `main` 觸發得到的 job 跑它——只接在 tag／deploy 之後，等於每次合併都沒驗；`workflow_run` 接 e2e 時 **MUST** 寫 `branches: [main]`——沒寫的話 PR 那一趟 CI 完成也會觸發它，e2e 等於又回到合併前
- 本節只管**哪一層跑什麼**：把 e2e／全量 unit 換到合併後時，job 的 `timeout-minutes` 與測試逾時照搬原值，**NEVER** 趁搬家放寬逾時

機械偵測：`node scripts/audit-ci-three-tier.ts`（單 repo 有 finding exit 1；`--all-consumers` warn-only，接在 `/clade-health` enforcement 段）。workflow 是 consumer 自治區，命中 relay 給該 consumer 的 session 修。
