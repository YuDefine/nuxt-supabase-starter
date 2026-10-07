---
name: verify-notes
description: "Use when 要 live 驗證 notes app 的 user-facing 功能（開 dev server、登入、操作 note、取證）。NOT for 修產品 code。"
---

# Verify Notes

Launch、drive 與取證 notes app 的使用者功能，給下一個冷啟動 agent 直接照做。

## Launch

- Command：`pnpm dev --port 4310`
- Ready signal：stdout 出現 `Local: http://localhost:4310`
- Lease：server/UI 一次一個 leased instance，`.verify/lease` 記 pid 與 port
- Teardown：`kill "$(cat .verify/lease | jq -r .pid)"`

## Doctor

- Command：`curl -fsS http://localhost:4310/api/_health`
- 判讀：回傳 `{"ok":true,"rev":"<git short sha>","user":"verify@test.local"}`，rev 等於 `git rev-parse --short HEAD`
- 何時重跑：first drive、fresh session、surprising failure 之後

## Drive

- Harness：既有 Playwright（`e2e/playwright.config.ts`）
- Stable handles：`getByRole('button', { name: 'New note' })`、route `/notes/:id`
- Feature map：`features/README.md`

## Evidence

- User path：從 toolbar 進入，不直接打 API
- Action + result：每個動作後截圖並記 DOM observation
- Side-effect proof：從列表重開 note，確認 title 與 body
- Artifact location：`artifacts/verify/<timestamp>/`
- Recorder：尚未接 control-plane recorder，寫 artifacts ＋ `manifest.json`

## Cleanup

- 清除：本次建立的 note（以 `verify-` 前綴標題篩選）、`.verify/lease`、Playwright profile
- 確認：cleanup 後 `artifacts/verify/<timestamp>/` 仍在

## Helpers

- `scripts/seed-notes.sh`：invocation `bash scripts/seed-notes.sh 3`；inputs 筆數；outputs 建立的 note id 清單；executable bit 有

