---
name: cf-crawl
description: "Use when 要爬整個網站、匯入文件站、批次擷取 web content；需 CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN。NOT for 單頁或需登入互動（agent-browser）、部署（void）、KV/R2/D1（cf-cli）。"
---


# Cloudflare Website Crawler

經 Cloudflare Browser Rendering 的 `/crawl` endpoint 爬整站，存成本機 markdown。建立與輪詢走 `cf` CLI（`cf-cli` skill）；分頁下載是 script 內的 HTTP client（`cloudflare-workers.md` § 8）。`scripts/crawl.py` 以本 skill 目錄為基準。

# SOP

## Phase 1 -- 解析引數與前置檢查

1. READ 讀取 `/cf-crawl <url> …` 的引數；缺 URL 就問使用者。
2. DELEGATE `command -v cf`；不存在就請使用者依 `cf-cli` skill Phase 1 經 mise 安裝（NEVER `npm i -g`）並停止。
3. READ 讀取 `rules/引數對應與終態判準.md`；要查 API 欄位或預設值時，讀取 `references/crawl-API參數表.md`。

## Phase 2 -- 建立 crawl job

1. DELEGATE `uv run scripts/crawl.py start --url <url> [--limit N] [--depth N] [--include p1,p2] [--exclude p1,p2] [--no-render] [--source all|sitemaps|links] [--since <日期|Unix 秒>]`，只帶使用者給的旗標；印出的結果是 job ID。exit 3 表示缺憑證：轉告缺少的變數、請使用者補進專案 `.env` 後停止；exit 1 且訊息指向 token 權限時，請使用者給 token 加上 `Browser Rendering - Edit` 權限後停止。

## Phase 3 -- 輪詢至終態

1. DELEGATE 每 5 秒跑 `uv run scripts/crawl.py status --job <JOB_ID>`（印 `{"status","finished","total"}`，憑證與 `start` 同源），直到 status 不再是 `running`。
2. THINK 依已載入規則判讀終態，決定取回或回報失敗。

## Phase 4 -- 取回並保存

1. DELEGATE `uv run scripts/crawl.py fetch --job <JOB_ID> [--output <dir>] [--merge]`（`--output` 預設 `.crawl-output`；`--merge` 合併成 `<dir>/crawl.md`）。
2. WRITE 依 script 印出的 JSON 回報 `saved`、`skipped`、`disallowed` 與 `output` 路徑。

## Description 原文（E1 搬入）

> frontmatter description 上限 250 字元（白名單 300）；被縮掉的觸發詞、流程敘述與 NOT for 全文留在這裡，不刪內容。

> Use when 要爬整個網站、匯入文件站、抓 knowledge base、或批次擷取 web content。需 CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN。NOT for 單頁抓取或需要登入 / 點擊互動的頁面（走 agent-browser），NOT for 部署 Workers（照 cloudflare-workers 規約走 void）或管理 KV/R2/D1（走 cf-cli）。
