---
description: 'CI workflow 撰寫規約——外部 GitHub Action 的 uses: MUST SHA-pin；動 .github/workflows 或 .github/actions 時載入'
paths: ['.github/workflows/**', '.github/actions/**']
---
<!-- Clade native rule; source: rules/core/ci-workflow.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
# CI Workflow 撰寫規約

## External action MUST SHA-pin

`.github/workflows/**/*.yml`、`.github/actions/**/action.yml` 裡任何指向 **外部** repo 的
`uses:` 步驟，**MUST** 釘住完整 40 碼 commit SHA，並在同一行用 `# <semver-tag>` 註解人類可讀
的版本：

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

**NEVER** 用 floating tag（`@v4`、`@main`、`@latest`）或裸 major（`@v4` 這種只到 major 的
tag）——它們可被上游改寫指向，等於把 CI 的程式碼執行權交給一個你事後改不了的第三方引用。
實測 `setup-vp` 的 `v1` 曾指向 `v1.15.0`、`pnpm/action-setup` 的 `v6` 曾指向 `v6.0.10`，
與 changelog 上的最新版不一致——SHA 旁的 `# <tag>` 註解是唯一人類可讀的版本訊號，標錯比不標更糟。

**適用範圍**：外部 `uses:`（`owner/repo@ref` 或 `owner/repo/path@ref` 形式）。**不適用**：
本 repo 內的 local action（`uses: ./.github/actions/<name>`）——那些沒有外部引用可被改寫的風險。

**升版時**：解析目標 semver tag 對應的 commit SHA、換掉 SHA 與註解，**MUST** 反驗
（`git ls-remote` 或 `gh api` 查那個 SHA 確實對應該 tag，不要用記憶或猜測）。操作範本見
`vendor/snippets/ci-workflow-sha-pin/README.md`。

機械偵測：`node scripts/audit-ci-workflow-safety.ts`（原 `audit-actions-sha-pin.ts`，2026-09-17 改名；warn-only；
掃 `.github/workflows/**/*.yml` 與 `.github/actions/**/action.yml`，check #1 對**每一個**外部 `uses:` 檢查 ref 是否為
40 碼十六進位字串；同支的 check #2 / #3 管 deploy 私鑰與 host key，規約在 [[self-hosted-runner]] § 11）。

## CI / test workflow MUST cancel superseded runs on the same ref

**適用範圍**：lint、typecheck、test、validate 這類**驗證** workflow（本 repo 的 `validate.yml` 是原型）。**不適用**：會部署 staging / production、或被另一條 workflow 用「同 SHA success」當 gate 的 workflow。

單槽 self-hosted runner 上，同 ref 連續 push 若每條 run 都跑完，**最新 SHA 會排在已過期 SHA 後面**。2026-09-14 `YuDefine/clade`：`main` 先 push `e28c18898`、六分鐘後 squash `4817dc670`；`validate.yml` 沒有 `concurrency`，兩條 run 搶同一台 `gh-runner-lxc`，HEAD 等了約 30 分鐘才開始跑。過期 SHA 的結果不能當最新 candidate 的綠燈。

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

`gh-ci-watch` 在 run 被取消時會改追 superseding run（同 workflow + 同 branch、較新 `createdAt`）。那是監看側的補救，**不能**代替 workflow 自己取消過期 run。

**與 `audit-ci-toolchain-parity.ts` 的分工**：那支只檢查三個 toolchain 入口 action
（`voidzero-dev/setup-vp` / `pnpm/action-setup` / `actions/setup-node`）的 SHA-pin，是它「fleet
toolchain 一致性」多維度稽核（node 版本一致性等）裡的其中一項——範圍是本檔的子集。本檔規約與
`audit-ci-workflow-safety.ts` 才是**全部**外部 action 的權威來源（見 [[ci-toolchain-parity]]）。
兩支稽核刻意不合併：一支管「這個 repo 的 CI 安不安全」，一支管「這個 repo 跟 fleet 其他家一不一致」，
發現需要再合併時先讀兩邊 registry entry 的 `trigger`，不要各自為政再開第三支。
