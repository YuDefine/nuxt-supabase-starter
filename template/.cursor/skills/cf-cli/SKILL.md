---
name: cf-cli
description: 'Use when 查詢或異動 Cloudflare 帳號資源（D1/KV/R2/DNS/zone/tunnel/Worker secret/cache/browser-run），或把 wrangler / curl 帳號操作改寫成 cf。NOT for deploy / dev / tail / types（走 wrangler）。'
---

<!-- clade-skill-scope: project -->

# cf CLI

帳號資源操作一律走官方 `cf` CLI（npm `cf`，`github.com/cloudflare/cf`）。哪些操作**不**走 `cf`（deploy、dev、CI 步驟、程式碼內 API client、cf 未覆蓋端點）見 `cloudflare-workers.md` § 8。`cf` 仍是 beta，本檔只寫已實測的語意差，**NEVER** 把這裡或記憶中的指令當權威。

## 起手

- 安裝：`mise use -g npm:cf@1.0.0-beta.5`（**NEVER** `npm i -g`；**MUST** 指定版本——beta 期 `mise latest npm:cf` 解析到舊的 `0.15.0`，不是本檔實測的版本），`cf --version` 確認
- 認證：`CLOUDFLARE_API_TOKEN`（account 用 `CLOUDFLARE_ACCOUNT_ID`），或 `cf auth login` / `--profile`。多帳號時異動前 **MUST** `cf auth whoami`
- 找指令：第一次用某個子指令、或指令失敗時，`cf cli search "<動作 + 資源類型>"` → `<指令> --help`；API 欄位用 `cf schema <指令去掉開頭 cf>`。查詢字串 **NEVER** 帶 domain、account / zone / resource ID、email、token
- 輸出：成功時 stdout 是 API 回應的 `result` 本體（**沒有** `.result` 外層），API 錯誤時 exit 非 0；`jq` 路徑照此寫
- `--dry-run`：異動類指令 **MUST** 先跑。它只在本機印出將送出的 request，**不**經 API 驗證。其他檔（skill、snippet、runbook）的異動範例為了簡潔省略這一步，**NEVER** 讀成可跳過

## 跟 wrangler 不同、會出事的語意

| 面向 | wrangler | `cf` |
|---|---|---|
| D1 指令目標 | database **name** | database **UUID**（`cf d1 list --name <name>` 取得） |
| D1 預設打哪裡 | 本機（遠端要 `--remote`） | **遠端 production** |
| `--local` | 專案 dev server 的本機 state | cf 自己的 state（`~/.config/cloudflare/state`），**看不到** dev server 的資料——查 dev 資料用 `wrangler d1 execute <db> --local`，dev server 的 state 不在 wrangler 預設目錄（例如 NuxtHub dev）時加 `--persist-to <該目錄>` |
| D1 migrations 目錄 | wrangler config `migrations_dir` | `--dir`（預設 `./migrations`）；Drizzle 巢狀 layout 加 `--pattern "<dir>/*/migration.sql"` |

把 `wrangler d1 execute <name>`（本機）直接換成 `cf d1 query <uuid>` 等於改打 production。改寫舊指令時逐列對照上表。

## Worker secret

手動推 secret 只限 `secrets.md` § 唯一例外的情境。推的時候值不進 argv：

```bash
( f="$(mktemp)"; trap 'rm -f "$f"' EXIT; trap 'exit 130' INT TERM; chmod 600 "$f"
  "${EDITOR:-vi}" "$f"
  #   {"<NAME>": {"type": "secret_text", "text": "<值>"}, ...}   ← JSON merge patch，key 是 secret 名稱
  cf workers secrets bulk --worker <worker-name> --file "$f" )
```

- 包在 subshell 裡是為了讓 `trap` 在這段結束時就刪檔，而不是等互動 shell 關掉；Ctrl-C／TERM 會中止整段，不會帶著已刪的檔去跑 `cf`
- 編輯器會在暫存檔旁留 swap／backup／undo 副本，那些是明文：vim 用 `vim -n -i NONE -c 'set nobackup nowritebackup noundofile'`，其他編輯器先確認同等設定

- **NEVER** `cf workers secrets update --text <值>`——明文進 argv 與 shell history
- 物件欄位取自 `cf workers secrets update --help` 的 `--type` / `--text`，`bulk` 的 schema 未列欄位；第一次用先對非 production worker 驗
- 刪除：`cf workers secrets delete <NAME> --worker <worker-name>`
