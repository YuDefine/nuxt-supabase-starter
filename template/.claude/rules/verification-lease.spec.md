---
description: verification lease 的機制規格——五元組欄位、lease 檔位置與 schema、claim / release / force-takeover 的行為、holder identity 解析、哪些工具必須讀寫 lease、與 consumer-meta leaseMode 的關係
paths: ['.claude/consumer-meta.json', 'scripts/dev-session*', 'scripts/dev-singleton*', 'nuxt.config.*', 'packages/**/nuxt.config.*']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/verification-lease.spec.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Verification Lease — 機制規格

> 從 [[verification-lease]] 抽出（2026-07-31）。那份是 always-load 的行為契約（核心命題 + Agent 行為契約）；本檔是**實作面規格** —— 動 `dev-session` / `dev-singleton` / consumer manifest 的 lease 設定，或要新寫一個 lease-aware 工具時才需要。

## Lease 的五元組

一份 lease 綁定下列五項，動其中任何一項都要先 claim：

| Slot | 內容 | 為什麼綁進 lease |
|---|---|---|
| **dev server** | `{ pid, cwd, port, url }` | port 排他 + cwd 決定 serve 哪 worktree 的 code |
| **browser profile** | `{ sessionName, userDataDir }` | agent-browser persistent profile（`--session` + profile dir）含登入 cookie，profile 切換 = session 切換 |
| **cookie namespace** | `string` | localhost cookie 不看 port，跨 port worktree 互相污染 session；namespace 隔離靠 cookie name suffix 或 per-worktree browser profile |
| **env file** | `{ path, sha256 }` | dev server 啟動時讀取的 `.env.local` 內容指紋；變動 = 應該重啟才生效 |
| **holder** | `{ kind, sessionId, label }` | 誰拿到這個 lease（claude / codex / human / subagent） |

## Lease 檔位置

`/tmp/<consumer_id>-verification-lease.json`

- 路徑用 consumer_id（見 [`consumer-meta.md`](./consumer-meta.md)），不用任意字串
- `/tmp` reboot 清空，跨 session 可讀，不被 git track
- 任何 user / agent 都能讀（沒 ACL）；寫入要走 lease-aware 工具（dev-session / dev-singleton），不要直接 `echo > /tmp/...`
- **consumer_id MUST 解析自 main worktree，不是當前 worktree 的目錄名**。在 linked worktree 內
  `git rev-parse --show-toplevel` 回的是該 worktree 路徑，basename 會變成 slug（`td-279-...`）而非
  consumer 名 → 算出 `/tmp/<slug>-verification-lease.json`，跟 main 用的檔**不是同一個**。後果是
  從 worktree 跑又沒帶 `--consumer-meta` 的指令靜默操作錯的 lease：release 釋放不到、conflict
  偵測不到，跨 worktree 隔離形同虛設。正解是 `git rev-parse --git-common-dir`（main 回
  `<repo>/.git`、linked worktree 回 `<main-repo>/.git/worktrees/<slug>`），截到 `.git` 的父層即
  main worktree（2026-07-26 <consumer-a> 實證：worktree 內 `stop` 後 main 的 lease 檔原封不動殘留）

## Lease 檔 schema

schema 全例見 `~/offline/clade/vendor/snippets/dev-session/lease-schema.jsonc`。欄位必填規則：

- `devServer` + `holder` + `claimedAt` 必填；其餘 slot 可缺（如未啟瀏覽器 → `browserProfile: null`）
- `devSession` 由 `dev-session.mjs` 寫入（dev process 掛哪個 zellij session）；缺 = 非 dev-session 起（legacy / 手動）
- Durability：dev process 掛獨立 zellij server 下才不被 agent harness reap；`devServer.pid` 是 zellij 內的 nuxt/vite process，kill lease 連帶收掉 zellij session（見 [`proactive-skills.md`](./proactive-skills.md) § Dev Server Auto-Spawn）

## Operations

| Op | 誰可呼 | 行為 |
|---|---|---|
| **status** | 任何人（含 read-only） | 讀 lease 檔；無檔 = 無 holder；印 holder + uptime + 五元組摘要 |
| **claim** | lease-aware 工具 | 嘗試取得 lease：無檔 → write；有檔且 PID dead → 視為 stale，覆寫；有檔且同 holder kind+sessionId → reuse（no-op）；其他 → **refuse** |
| **release** | 持有者 | 刪 lease 檔；非持有者呼叫 = no-op + warn |
| **force-takeover** | 任何 lease-aware 工具，需顯式 flag（`--takeover`） | 不管現有 holder，覆寫 lease；prev holder 寫進 auditLog；同步 kill 對方 dev server PID（如可達） |

**Stale 偵測**：claim 時現有 lease 的 `devServer.pid` 死了（`kill -0` fail）→ 視為 stale，silent overwrite，不要求 `--takeover`。
**並行 race**：同時 claim 靠 `fs.writeFile({ flag: 'wx' })` 檔案級 atomic check，後到者 fail → conflict → 跑 status + refuse。

### Ownership 與 served code 是兩個獨立判準

lease gate **MUST** 分開問兩件事，**NEVER** 讓其中一個短路掉另一個：

| 判準 | 問題 | 依據 |
|---|---|---|
| **ownership conflict** | lease 被**別人**持有嗎 | `holder.sessionId` |
| **served-cwd mismatch** | 正在跑的 dev server 服務的是**我要的那份 code** 嗎 | `devServer.cwd` vs 請求的 cwd |

served-cwd 檢查 **MUST 無條件執行、與 holder 是誰無關** —— 同一個 holder 在別的 worktree 起的
dev server，服務的仍然是別的 code，一樣會讓 evidence 拍到錯的版本。

實證：`holderSessionId()` 在沒有 `CLAUDE_SESSION_ID` / `CODEX_SESSION_ID` 時一律回 `'human'`，
所有這類 caller 的身分**塌縮成同一個**；若把 cwd 比對寫在 ownership 判定之後，`if (mine) return null`
會先短路，cwd 比對**永遠走不到**。

兩個配套硬規則：

- **cwd 比對 MUST 正規化後再比**（`resolve()` + `realpathSync()`）。lease 內的 cwd 是寫入當下的值，
  請求端的 `--cwd` 可能是相對路徑、帶結尾斜線、或走 symlink 的等價路徑；裸字串比對兩個方向都會
  出錯 —— strict 模式對自己那台 refuse，或 `--takeover` 誤殺自己剛起的 dev server
- **reuse 路徑 NEVER 跳過 lease gate**。「port 有人聽 → 直接 reuse」的捷徑會讓 caller 傳的 `--cwd`
  被靜默忽略，指令回 exit 0 +「✓ reuse」但服務的是別的 working tree 的 code。任何 agent 照這個
  成功訊號往下收 evidence，拍到的都是錯的版本，且**外觀與成功無異** —— 比直接失敗危險得多

## Holder identity

```
kind      sessionId source                      label
----------------------------------------------------------------
claude    process.env.CLAUDE_SESSION_ID 或 cwd hash  --label flag
codex     process.env.CODEX_SESSION_ID 或 cwd hash   --label flag
subagent  parent claude session + agent name         Agent tool prompt
human     固定字串 "human"                           不可缺，至少傳「what for」
```

`sessionId` 拿不到時 fallback 到 cwd-derived hash（不同 worktree 至少能分），但記 warning 到 auditLog。

## 工具行為契約

下列工具/規則**必須**讀寫 lease：

| 工具 | 何時 claim | 何時 release |
|---|---|---|
| `vendor/scripts/dev-session.mjs`（**durable 主入口**；durability=zellij，取代 dev-singleton 的 spawn 層） | launch 前讀 lease 對 cwd（strict 衝突 refuse）；ready 後寫 lease + `devSession` 欄 | `stop` 時 |
| `vendor/scripts/dev-singleton.mjs`（legacy；spawn 層會被 harness reap，新工作走 dev-session） | spawn 前；reuse 前讀 lease 對 cwd | dev server 被 kill 時 |
| `dev-auth` cookbook `server-api-dev-signin.ts.template` | endpoint 第一次被打時 | lease 有 holder 才允許簽 cookie（防 CSRF） |
| `vendor/snippets/wt-helper/`（建立 worktree） | bootstrap .env.local 前 | env file 寫完後 |
| `agent-browser` daemon wrapper（future） | 開瀏覽器 + load profile 前 | daemon shutdown 時 |

下列工具**只讀**：

- `vendor/scripts/audit-*.mjs`（稽核）
- `vendor/scripts/review-gui.mts`（UI 看 lease 狀態）
- `scripts/sync-consumer-meta.ts`（aggregate snapshot）

## Claim 衝突的標準訊息

訊息要含 holder 識別 + 五元組摘要，讓使用者**不必再額外 dev:status** 就能判斷要不要搶。標準訊息 block 範例見 `~/offline/clade/vendor/snippets/dev-session/README.md`。

## 與 Consumer Manifest 的關係

Lease 的「該不該強制走 singleton wrapper」由 consumer 自宣告：

```jsonc
// .claude/consumer-meta.json 片段
{ "auth": { "provider": "supabase-google", "portPinned": true },   // OAuth pin 到固定 port
  "dev": { "ports": [{ "port": 3000, "alias": "main" }], "leaseMode": "strict" } }  // strict | advisory
```

- `leaseMode: strict` + `portPinned: true` → singleton wrapper **必須**用，cwd-mismatch 預設 refuse
- `leaseMode: advisory` → singleton wrapper 仍 claim lease，但 cwd-mismatch 印 warning 後 reuse（不阻擋）
- `portPinned: false` → 走 [`proactive-skills.md`](./proactive-skills.md) § Dev Server Auto-Spawn 既有的「scan 3001-3050」邏輯，lease 仍 claim（只是 port 是 dynamic）

## Audit log retention

`auditLog` 保留最多 50 條，FIFO。長期紀錄走 `improvement-digest.mjs` 拉 snapshot 進 digest。

## Why（root cause）

2026-05 之前 dev server port / browser profile / cookie namespace / env file 四個資源散規範散實作，但實際是綁定的。
兩個 session 同時驗證 → 不同層各自 hold 對方資源 → inconsistent state。
收成一等概念後：claim 一次拿一組、release 一次釋一組，atomicity 由 lease 檔保證。
