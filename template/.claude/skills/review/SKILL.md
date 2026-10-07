---
name: review
description: "Use for review lifecycle work: human-gate checks or UI screenshot evidence. Not for archiving (retired), product code review, or Lighthouse analysis."
---

<!-- clade-skill-scope: both -->

# Review lifecycle（統一入口）

`review` 是 review 支援生命週期的統一入口：查有沒有卡等人判（scan）、UI 截圖取證與判定（screenshot），以及已退役的 archive／screenshots 歸檔。

# SOP

## Phase 1 -- 判定 mode

1. THINK 依使用者請求判 scan（有沒有卡等人判）、screenshot（截圖、看畫面、跑 UI 檢查清單、UI 驗收或除錯截圖）、archive 或 screenshots（已退役，走 Phase 5）；product code review 交設定好的 code-review agent，Lighthouse／performance trace 交 browser-devtools。

## Phase 2 -- scan

1. DELEGATE 在 consumer 根（不帶 `CLADE_HOME`）執行 `node ~/offline/clade/vendor/scripts/flow/flow.ts gates --repo-only --json`，依 gate family 回報每一張卡；`--require-empty` exit 2 表示判不出來，不是「沒有」。

## Phase 3 -- screenshot：取證

1. THINK 先讀取 `rules/截圖取證與判定分工判準.md`，確認本次由 Pi Gemini 取證、Opus 判定，以及各自不可用時的處置。
2. WRITE 先讀取 `templates/截圖取證brief.md` 與 `templates/截圖取證brief.example.md`，依種類（ad-hoc／人工檢查清單／除錯）寫出逐項 item、截圖輸出路徑、URL、ready signal 與允許操作，並指定 worker 讀取 `references/screenshot-worker-contract.md`。
3. DELEGATE 主線直接執行 `node <clade-vendor>/scripts/pi-dispatch.ts --brief <absolute-brief.md> --cwd <consumer-root> --label <descriptive-label> --model gemini --effort high --route routing-table --tier-basis table-row --table-row screenshot-review-verify --workspace-access mutation`，依 agent-routing 的 Pi watch 收割 completion 與 evidence manifest。

## Phase 4 -- screenshot：判定與回報

1. DELEGATE 需要符合性 gate 時，把每張實際圖片路徑與完整 item 交給獨立 Opus 5.5 dispatch（`screenshot-match-analysis`）。
2. THINK 先讀取 `rules/截圖證據可採性判準.md`，逐張覆核 manifest 的 `discriminating`，標 NON-EVIDENCE／UNREACHABLE。
3. WRITE 回報摘要表、需人工確認項與截圖路徑（需要使用者拍板時，向使用者提問並等待回答，不自行補完未決事項）、`screenshots/<env>/<語義>/review.md` 位置；`verify:ui` 由主線依 watch protocol 呼叫 `verify-ui-receipt.ts`。

## Phase 5 -- 已退役的 archive／screenshots

1. THINK 先讀取 `rules/歸檔停寫判準.md`。
2. WRITE archive：確認完成項已在 work package 打 `[x]`，回報「不再寫入 `docs/manual-review-archive.md`；結論在 `<carrier>`」後停止；screenshots：回報已停 rotate，列 `screenshots/<env>/` 頂層 topic，不搬檔。


## 提問載體 — Claude Code

Phase 4 需要使用者拍板時，以 Claude Code `AskUserQuestion` 列出每個有效選項與明確的略過選項，等回答後再往下。這只是共同提問義務在本 runtime 的載體。
