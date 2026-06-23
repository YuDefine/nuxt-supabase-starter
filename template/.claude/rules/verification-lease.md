<!--
🔒 LOCKED — managed by clade
Source: rules/core/verification-lease.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->

# Verification Lease

**核心命題**：dev server + browser profile + cookie namespace + env file + session identity 是一組**綁定資源**，任意時刻只能由一個 holder 持有。把這組綁定收成一個明確物件叫 **verification lease**，任何要動其中之一的工具/規則都先 claim、衝突就 refuse。

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
- `scripts/sync-consumer-meta.mjs`（aggregate snapshot）

## Claim 衝突的標準訊息

訊息要含 holder 識別 + 五元組摘要，讓使用者**不必再額外 dev:status** 就能判斷要不要搶。標準訊息 block 範例見 `~/offline/clade/vendor/snippets/dev-session/README.md`。

## Agent 行為契約

Claude / Codex 在這條規則之下：

- **NEVER** 用 raw `nuxt dev` / `node server.mjs` / `playwright start` 之類 bypass lease 的方式啟動 dev server
- **NEVER** 直接 `lsof + kill` 別 holder 的 PID（即使它是另一個自己的 session）；要殺一律走 `dev-session.mjs stop` / `--takeover`（或 legacy `dev-singleton.mjs`）的 op
- **NEVER** 在 lease 衝突訊息出來時自行決定 `--takeover`，**MUST** 把 message 原樣呈給 user 讓 user 決定
- **NEVER** 在 autonomous mode（background subagent、scheduled task、/loop）下執行 `--takeover`，autonomous = 永遠 refuse + 在 chat 報告
- **MUST** 在 claim 時帶可辨識的 `--label`（如「verifying #178」「reproducing TD-099」）
- **MUST** 在 dev server / browser session 結束時主動 `release`（task 結束 / session 收尾 / kill subagent 前）

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
