---
name: cf-cli
description: 'Use when void 做不到的 Cloudflare 帳號資源查詢或異動（D1/KV/R2/DNS/zone/tunnel/Worker secret/cache/browser-run），或把 curl 帳號操作改寫成 cf；從 wrangler 遷移時，void 能做的先換成 void，只有 void 不涵蓋的才換成 cf。NOT for void 能做的部署、本機 dev、型別、D1 migration、secret sync、網域（走 void）。'
---


# cf CLI

fleet 邊界：部署、本機 dev、型別、D1 migration、secret sync、網域優先用 `void`；void 做不到的帳號資源操作才走官方 `cf` CLI（npm `cf`，`github.com/cloudflare/cf`）。**NEVER** 用 wrangler。哪些操作**不**走 `cf`（CI 步驟、程式碼內 API client、cf 未覆蓋端點）見 `cloudflare-workers.md` § 8。`cf` 仍是 beta，本 skill 只寫已實測的語意差，**NEVER** 把這裡或記憶中的指令當權威。

# SOP

## Phase 1 -- 起手：準備 cf 與身分

1. READ 讀取 `rules/安裝與認證判準.md`。
2. DELEGATE 執行 `cf --version`；未安裝或版本不是已載入規則指定的版本，依規則經 mise 安裝後再確認。
3. DELEGATE 多帳號環境在任何異動前執行 `cf auth whoami`，確認是目標帳號。

## Phase 2 -- 找到正確指令

1. THINK 先判這個動作 void 能不能做（部署、dev、型別、D1 migration／execute、secret、網域、log、rollback）；能做就用 `void`，查指令語法先看專案 `node_modules/void/skills/void/SKILL.md`，本 skill 到此為止。
2. DELEGATE void 做不到才走 `cf`：第一次用某個子指令、或指令失敗時，依已載入規則執行 `cf cli search "<動作 + 資源類型>"` → `<指令> --help`；要查 API 欄位用 `cf schema <指令去掉開頭 cf>`。
3. READ 要改打 `cf`，或要把既有 wrangler／curl 指令改寫時，讀取 `rules/void與cf語意差判準.md`，逐列對照後才寫新指令。

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
