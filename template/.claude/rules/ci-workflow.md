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

機械偵測：`node scripts/audit-actions-sha-pin.ts`（warn-only；掃 `.github/workflows/**/*.yml`
與 `.github/actions/**/action.yml`，對**每一個**外部 `uses:` 檢查 ref 是否為 40 碼十六進位字串）。

**與 `audit-ci-toolchain-parity.ts` 的分工**：那支只檢查三個 toolchain 入口 action
（`voidzero-dev/setup-vp` / `pnpm/action-setup` / `actions/setup-node`）的 SHA-pin，是它「fleet
toolchain 一致性」多維度稽核（node 版本一致性等）裡的其中一項——範圍是本檔的子集。本檔規約與
`audit-actions-sha-pin.ts` 才是**全部**外部 action 的權威來源（見 [[ci-toolchain-parity]]）。
兩支稽核刻意不合併：一支管「這個 repo 的 CI 安不安全」，一支管「這個 repo 跟 fleet 其他家一不一致」，
發現需要再合併時先讀兩邊 registry entry 的 `trigger`，不要各自為政再開第三支。
