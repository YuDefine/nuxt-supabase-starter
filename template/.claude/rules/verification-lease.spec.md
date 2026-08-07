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
| **cookie namespace** | `string` | localhost cookie 不看 port，跨 port worktree 互相污染 session。三種隔離手法，由弱到強：(1) **用不同 host 名** —— `localhost` 與 `127.0.0.1` 對瀏覽器是不同 host、不同 cookie jar，開發那台走一個、review slot 走另一個，零改 code；(2) cookie name suffix（要改 consumer 的 session 設定）；(3) per-worktree browser profile |
| **env file** | `{ path, sha256 }` | dev server 啟動時讀取的 `.env.local` 內容指紋；變動 = 應該重啟才生效 |
| **holder** | `{ kind, sessionId, label }` | 誰拿到這個 lease（claude / codex / human / subagent） |

## Lease 檔位置

Lease identity 是 **(consumer_id, port)**，不是 consumer_id 單獨一個：

| 這次的 port | 檔名 |
| --- | --- |
| `dev.ports[0].port`（primary），或 port 解不出來 | `/tmp/<consumer_id>-verification-lease.json` |
| 其他 port（多 app 的第二支 / review slot） | `/tmp/<consumer_id>-<port>-verification-lease.json` |

**為什麼不是 per consumer**：一個 consumer 可以同時有多台合法、互不相干的 dev server —— <consumer-a> 的
`dev:<client-a>`(3040) 與 `dev:shared`(3045) 是兩個不同 app，再加上為了「一邊開發一邊人工檢查」開的
review slot 就有三台。共用一個 lease 檔時第二台一律被判衝突（strict → refuse），而那個衝突是**假的**：
它們根本沒共用 port。

**為什麼 primary 沿用舊檔名**：規約、`vendor/snippets/dev-session/`、dev-signin template、wt-helper
的殘留清理都寫死那個路徑，而它們讀的正是最常用的那一台。改掉等於一次性讓所有既有讀者對不上。

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

## 有界性：agent 租約 vs 人類租約

lease 原本是 session-scoped 且**無界**——誰先起就持有到 session 結束。無界所有權的必然推論鏈是：

```
另一個 agent 永遠不會自己放手 → 想用只能砍掉他 → 砍是破壞性動作 → 所以必須問 user
```

「必須問 user」不是規約訂太保守，是無界所有權的**數學結果**。因此解法**不是**放寬規約讓 agent
自行 takeover（那會變成 agent 互砍），而是讓所有權**有界**——同意這一步才會在機制上消失：

| holder | TTL | 回收 |
| --- | --- | --- |
| agent（`holder.kind ≠ human`，或 `--agent`） | **必有**，預設 10m | 過期或心跳斷 → 下一個 agent 自動接管，不問 user |
| 人類（`holder.kind = human`） | **無界**（`expiresAt: null`） | **NEVER** 自動回收；agent 要用一律 refuse + 把訊息呈給 user |

**人類租約無界是整個設計的安全閥。** `detectHolderKind()` 在偵測不到任何 agent runtime 時回的
就是 `human`——也就是「user 自己在 terminal 跑 `pnpm dev`」的情形。把判不出來的 holder 當成
agent 會讓 user 的 dev server 被自動回收，安全閥就此失效，而症狀是 user 的畫面莫名其妙變成
別的 worktree 的 code。

### Liveness：兩條判準都要看

```
1. expiresAt < now                     → expired
2. heartbeatAt < now − 180s            → heartbeat-dead（agent 崩潰）
```

任一成立**且該 lease 是 agent 租約** → 可回收。只看 (1) 的話，崩潰的 agent 會把 slot 佔滿整個
TTL；只看 (2) 的話，還活著但早該放手的 agent 永遠不會被回收。舊格式 lease（無這三個欄位）恆
**不可回收**——升級不會回頭吃掉既有 holder。

回收 **MUST 走既有的 `dev-session.ts` stop / start 路徑**（takeover 分支），**NEVER** 自組
`lsof + kill`。

### 佇列

檔案化，放在 lease 檔旁：`/tmp/<lease-id>-verification-lease.queue.json`，FIFO。

```jsonc
{ "schemaVersion": "1",
  "entries": [ { "holderKind": "claude", "sessionId": "…", "task": "collect verify:ui evidence",
                 "enqueuedAt": "2026-08-07T…Z", "polledAt": "2026-08-07T…Z" } ] }
```

排隊者自己 poll（`dev-session.ts wait`，預設 5s 一次、`--wait-timeout` 預設 15m）；超過 **180s**
沒 poll 的項自動剔除——**與 lease liveness 同一套判準，NEVER 另發明一套**。撞上**人類租約**時
`wait` 立刻 refuse 而不排隊：它無界，排了也永遠等不到。

## Lease 檔 schema

schema 全例見 `~/offline/clade/vendor/snippets/dev-session/lease-schema.jsonc`。欄位必填規則：

- `devServer` + `holder` + `claimedAt` 必填；其餘 slot 可缺（如未啟瀏覽器 → `browserProfile: null`）
- broker 欄位（2026-08-07 加，**往後相容**：舊 lease 缺這些欄位一律視為不可回收）：

  | 欄位 | 型別 | 說明 |
  | --- | --- | --- |
  | `task` | `string \| null` | 這次租用要做什麼（`--task`）。agent 租約 MUST 帶——它是別的 agent 決定要不要排隊的唯一依據 |
  | `ttlMs` | `number \| null` | 租期；人類租約為 `null`。`heartbeat` 用它決定往後推多久 |
  | `expiresAt` | ISO8601 `\| null` | 硬到期時間；`null` = 無界（人類租約） |
  | `heartbeatAt` | ISO8601 | 最後一次心跳；`start` 與 `heartbeat` 都會更新 |
- `devSession` 由 `dev-session.ts` 寫入（dev process 掛哪個 zellij session）；缺 = 非 dev-session 起（legacy / 手動）
- Durability：dev process 掛獨立 zellij server 下才不被 agent harness reap；`devServer.pid` 是 zellij 內的 nuxt/vite process，kill lease 連帶收掉 zellij session（見 [`proactive-skills.md`](./proactive-skills.md) § Dev Server Auto-Spawn）

## Operations

| Op | 誰可呼 | 行為 |
|---|---|---|
| **status** | 任何人（含 read-only） | 讀 lease 檔；無檔 = 無 holder；印 holder + uptime + 五元組摘要 |
| **claim** | lease-aware 工具 | 嘗試取得 lease：無檔 → write；有檔且 PID dead → 視為 stale，覆寫；有檔且同 holder kind+sessionId → reuse（no-op）；其他 → **refuse** |
| **release** | 持有者 | 刪 lease 檔 + 剔除自己的排隊項；非持有者呼叫 = no-op + warn |
| **heartbeat** | **只有持有者** | `heartbeatAt = now`、`expiresAt = now + ttl`。非持有者呼叫 **MUST refuse**——續租別人的租約等於延長不屬於自己的所有權，「過期就能自動接管」這條保證會失效 |
| **wait** | agent | 排隊等 slot；取得後直接接手（含把 dev server 切到本次 cwd）。人類租約 → 立刻 refuse；逾時 → exit 1 |
| **auto-reclaim** | 任何 lease-aware 工具，**無需** flag | 現有 lease 是 agent 租約且 expired / heartbeat-dead → 直接接管、**不問 user**。人類租約永不走這條 |
| **force-takeover** | 任何 lease-aware 工具，需顯式 flag（`--takeover`） | 不管現有 holder，覆寫 lease；prev holder 寫進 auditLog；同步 kill 對方 dev server PID（如可達）。人類租約仍**只有 user 能授權** |

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
| `vendor/scripts/dev-session.ts`（**durable 主入口**；durability=zellij，取代 dev-singleton 的 spawn 層） | launch 前讀 lease 對 cwd（strict 衝突 refuse）；ready 後寫 lease + `devSession` 欄 | `stop` 時 |
| `vendor/scripts/dev-singleton.ts`（legacy；spawn 層會被 harness reap，新工作走 dev-session） | spawn 前；reuse 前讀 lease 對 cwd | dev server 被 kill 時 |
| `dev-auth` cookbook `server-api-dev-signin.ts.template` | endpoint 第一次被打時 | lease 有 holder 才允許簽 cookie（防 CSRF） |
| `vendor/snippets/wt-helper/`（建立 worktree） | bootstrap .env.local 前 | env file 寫完後 |
| `agent-browser` daemon wrapper（future） | 開瀏覽器 + load profile 前 | daemon shutdown 時 |

下列工具**只讀**：

- `vendor/scripts/audit-*.mjs`（稽核）
- `vendor/scripts/review-gui.ts`（UI 看 lease 狀態）
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

`auditLog` 保留最多 50 條，FIFO。長期紀錄走 `improvement-digest.ts` 拉 snapshot 進 digest。

## Why（root cause）

2026-05 之前 dev server port / browser profile / cookie namespace / env file 四個資源散規範散實作，但實際是綁定的。
兩個 session 同時驗證 → 不同層各自 hold 對方資源 → inconsistent state。
收成一等概念後：claim 一次拿一組、release 一次釋一組，atomicity 由 lease 檔保證。
