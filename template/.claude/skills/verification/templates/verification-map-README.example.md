# Notes verification map

- Last source reconciliation: 2026-10-05
- Subject revision: 4688ab80b4
- Maintainer outcome: changed

## Baseline preconditions

- URL：`http://localhost:4310`
- Env：`.env.verify`（`DATABASE_URL` 指向 disposable sqlite）
- Seed：`bash scripts/seed-notes.sh 3`
- Auth：dev-login `verify@test.local`
- Doctor：見 `verify-notes/SKILL.md` 的 Doctor 段
- Isolation：每次 run 用獨立 data dir `.verify/data-<timestamp>`
- Lease：server/UI 一次一個 leased instance

## Driving conventions

- Baseline state：登入後的空白列表加 3 筆 seed note
- Stable handles：ARIA role 與 accessible name 優先，其次 route
- Harness：Playwright（`e2e/playwright.config.ts`）
- Reset：刪 data dir 後重跑 seed

## Proof and skip reporting

- Action/result evidence：每個動作一張截圖＋DOM observation
- Side effects：從第二個 view（列表重開）確認寫入
- Unreachable prerequisites：列 attempted route 與缺的前提
- Entry-point honesty：每個 entry point 各自驗，不以一條代替其他

## Feature entry contract

每份 feature 檔以 H1 與一段 user-visible behavior 開頭，接著依序只有 `Sub-features`、`How to get to it (user POV)`、`Driving it with <harness>`、`Gotchas` 四個 H2。

## Features

- [Create a note](./create-note.md)

