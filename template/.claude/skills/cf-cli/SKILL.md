---
name: cf-cli
description: 'Use when 查詢或異動 Cloudflare 帳號資源（D1/KV/R2/DNS/zone/tunnel/Worker secret/cache/browser-run），或把 wrangler / curl 帳號操作改寫成 cf。NOT for deploy / dev / tail / types（走 wrangler）。'
---


# cf CLI

帳號資源操作一律走官方 `cf` CLI（npm `cf`，`github.com/cloudflare/cf`）。哪些操作**不**走 `cf`（deploy、dev、CI 步驟、程式碼內 API client、cf 未覆蓋端點）見 `cloudflare-workers.md` § 8。`cf` 仍是 beta，本 skill 只寫已實測的語意差，**NEVER** 把這裡或記憶中的指令當權威。

# SOP

## Phase 1 -- 起手：準備 cf 與身分

1. READ 讀取 `rules/安裝與認證判準.md`。
2. DELEGATE 執行 `cf --version`；未安裝或版本不是已載入規則指定的版本，依規則經 mise 安裝後再確認。
3. DELEGATE 多帳號環境在任何異動前執行 `cf auth whoami`，確認是目標帳號。

## Phase 2 -- 找到正確指令

1. DELEGATE 第一次用某個子指令、或指令失敗時，依已載入規則執行 `cf cli search "<動作 + 資源類型>"` → `<指令> --help`；要查 API 欄位用 `cf schema <指令去掉開頭 cf>`。
2. READ 改寫既有 wrangler 或 curl 指令時，讀取 `rules/wrangler與cf語意差判準.md`，逐列對照後才寫新指令。

## Phase 3 -- 異動

1. DELEGATE 異動類指令先加 `--dry-run` 跑一次。
2. THINK 確認 dry run 印出的 request 指向正確帳號、資源與環境（`--dry-run` 不經 API 驗證，只看 request 本身）後才實跑。

## Phase 4 -- 推送 Worker secret（僅限 `secrets.md` § 唯一例外的情境）

1. READ 讀取 `rules/Secret推送判準.md`。
2. DELEGATE 依已載入規則設定好編輯器後執行下列命令（值不進 argv）：

```bash
( f="$(mktemp)"; trap 'rm -f "$f"' EXIT; trap 'exit 130' INT TERM; chmod 600 "$f"
  "${EDITOR:-vi}" "$f"
  #   {"<NAME>": {"type": "secret_text", "text": "<值>"}, ...}   ← JSON merge patch，key 是 secret 名稱
  cf workers secrets bulk --worker <worker-name> --file "$f" )
```
