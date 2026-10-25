---
name: wrangler
description: "Use before running Wrangler deploy, dev, tail, or types for Cloudflare Workers. Account resources (D1, KV, R2, DNS, secrets) use the cf CLI."
---


# Wrangler CLI

模型記得的 Wrangler 旗標、config 欄位與子指令可能已過時；寫或審 Wrangler 指令與 config 前一律先查專案安裝的版本與最新文件，不靠記憶。

# SOP

## Phase 1 -- 確認專案的 wrangler 版本與文件

1. READ 讀取 `package.json`、lockfile 與 deploy scripts，確認專案用的 package manager 與宣告的 wrangler 版本。
2. DELEGATE 用專案本機的 wrangler 查版本與說明（pnpm 專案：`pnpm exec wrangler --version`、`pnpm exec wrangler <子指令> --help`）；已宣告但未安裝就還原專案依賴，未宣告就經專案的依賴流程選定相容版本後再安裝。
3. READ 讀取 Wrangler 文件（`https://developers.cloudflare.com/workers/wrangler/`）、Workers 文件（`https://developers.cloudflare.com/workers/`）與本機 schema `node_modules/wrangler/config-schema.json` 中本次要用的指令或欄位。

## Phase 2 -- 判定操作歸屬

1. THINK 讀取 `rules/工具邊界判準.md`，判定本次操作留在 wrangler 或轉 `cf-cli` skill；帳號資源的查詢與異動轉 `cf-cli` 後，本 skill 只處理剩下的 wrangler 部分。

## Phase 3 -- 修改 config 並驗證

1. READ 讀取 `rules/Config與部署前驗證判準.md`。
2. WRITE 依已載入規則修改 `wrangler.jsonc`。
3. DELEGATE 依已載入規則跑 `wrangler types`、專案 typecheck／tests，以及指定 config 與 environment 的 `wrangler deploy --dry-run`；任一失敗就修正後從本 step 重跑，全過才 deploy；部署後依已載入規則實際呼叫受影響的 endpoint 驗證。
