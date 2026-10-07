# 截圖取證 brief：asset-loans 逾期提醒人工檢查

你是 `review` skill screenshot lane 的取證 worker（`screenshot-review-verify`）。開工前完整讀取 `<clade-central-repo>/capabilities/core/skills/review/references/screenshot-worker-contract.md`，照其中的工具選擇、前置條件、截圖存放、Evidence Manifest 與（`mode: verify` 時）Verify Mode 執行；不再轉派，不代簽符合性 gate。

## Setup

- 種類：Review 截圖（人工檢查）
- mode：一般（非 verify）
- Consumer root：`<home>/offline/<consumer-id>`
- Dev server：`http://localhost:3000`（port 已知）
- env：`local`
- work／change：`W-2026-10-01-asset-loan-overdue-notification`
- Approved Tools：agent-browser（`--session poc-loans`）、`vendor/scripts/safe-screenshot.ts`
- Hard budget：單 item ≤ 5 分鐘、整批 ≤ 20 分鐘；每完成一項寫 progress.json

## Items

- [ ] #1 列表頁顯示逾期標籤，逾期列排在最上方
  - URL：`http://localhost:3000/asset-loans`
  - ready signal：`wait "tbody tr"`，且列數 ≥ 3
  - 允許操作：open、wait、screenshot
  - 截圖輸出：`screenshots/local/asset-loan-overdue-notification/#1-overdue-sorted.png`
- [ ] #2 沒有借用紀錄的使用者看到空狀態說明
  - URL：`http://localhost:3000/asset-loans?as=member`
  - ready signal：`wait --text "目前沒有借用紀錄"`
  - 允許操作：open、wait、screenshot；另拍同頁、同 session 的非空對照圖
  - 截圖輸出：`screenshots/local/asset-loan-overdue-notification/#2-empty-state.png`

## Output format

- 每個 item 一行：`#<id> <PASS|FAIL|UNCERTAIN> — <DOM observation>. Final: <截圖路徑>`
- Evidence manifest：每張圖含 `discriminating` 欄與理由；不可達的分支標 UNREACHABLE。
- progress.json：`screenshots/local/asset-loan-overdue-notification/progress.json`
- 報告檔：`screenshots/local/asset-loan-overdue-notification/review.md`
