# 截圖取證 brief：{{BRIEF_TITLE}}

你是 `review` skill screenshot lane 的取證 worker（`screenshot-review-verify`）。開工前完整讀取 `{{WORKER_CONTRACT_PATH}}`，照其中的工具選擇、前置條件、截圖存放、Evidence Manifest 與（`mode: verify` 時）Verify Mode 執行；不再轉派，不代簽符合性 gate。

## Setup

- 種類：{{CAPTURE_KIND}}
- mode：{{MODE}}
- Consumer root：`{{CONSUMER_ROOT}}`
- Dev server：{{DEV_SERVER}}
- env：`{{ENV}}`
- work／change：`{{WORK_REF}}`
- Approved Tools：{{APPROVED_TOOLS}}
- Hard budget：{{HARD_BUDGET}}

## Items

- [ ] #{{ITEM_ID}} {{ITEM_TEXT}}
  - URL：`{{ITEM_URL}}`
  - ready signal：{{READY_SIGNAL}}
  - 允許操作：{{ALLOWED_ACTIONS}}
  - 截圖輸出：`{{SCREENSHOT_OUTPUT_PATH}}`

## Output format

- 每個 item 一行：`#<id> <PASS|FAIL|UNCERTAIN> — <DOM observation>. Final: <截圖路徑>`
- Evidence manifest：每張圖含 `discriminating` 欄與理由；不可達的分支標 UNREACHABLE。
- progress.json：`{{PROGRESS_JSON_PATH}}`
- 報告檔：`screenshots/{{ENV}}/{{TOPIC}}/review.md`
