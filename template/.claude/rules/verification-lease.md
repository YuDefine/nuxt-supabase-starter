<!--
🔒 LOCKED — managed by clade
Source: rules/core/verification-lease.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

# Verification Lease

**核心命題**：dev server + browser profile + cookie namespace + env file + session identity 是一組**綁定資源**，任意時刻只能由一個 holder 持有。把這組綁定收成一個明確物件叫 **verification lease**，任何要動其中之一的工具/規則都先 claim、衝突就 refuse。

> 為什麼這條獨立成 rule：dev server contention、browser profile pollution、cookie cross-port leakage、env file drift 看似各自獨立，實際是同一個「驗證資源所有權」問題。散落處理 → 工具各自實作 → 容易誤判。收成一等概念後 [`rules/core/proactive-skills.md`](./proactive-skills.md) § Dev Server Auto-Spawn、`vendor/scripts/dev-singleton.mjs`、`vendor/snippets/dev-auth/`、`vendor/snippets/wt-helper/` 都引用同一份語意。

## Lease 的五元組

一份 lease 綁定下列五項，動其中任何一項都要先 claim：

| Slot | 內容 | 為什麼綁進 lease |
|---|---|---|
| **dev server** | `{ pid, cwd, port, url }` | port 排他 + cwd 決定 serve 哪 worktree 的 code |
| **browser profile** | `{ buName, cdpUrl, userDataDir }` | BH Chrome / browser-use profile 含登入 cookie，profile 切換 = session 切換 |
| **cookie namespace** | `string` | localhost cookie 不看 port，跨 port worktree 互相污染 session；namespace 隔離靠 cookie name suffix 或 per-worktree browser profile |
| **env file** | `{ path, sha256 }` | dev server 啟動時讀取的 `.env.local` 內容指紋；變動 = 應該重啟才生效 |
| **holder** | `{ kind, sessionId, label }` | 誰拿到這個 lease（claude / codex / human / subagent） |

## Lease 檔位置

`/tmp/<consumer_id>-verification-lease.json`

- 路徑用 consumer_id（見 [`rules/core/consumer-meta.md`](./consumer-meta.md)），不用任意字串
- `/tmp` reboot 清空，跨 session 可讀，不被 git track
- 任何 user / agent 都能讀（沒 ACL）；寫入要走 `vendor/scripts/dev-singleton.mjs` 之類 lease-aware 工具，不要直接 `echo > /tmp/...`

## Lease 檔 schema

```jsonc
{
  "schemaVersion": "1",
  "consumerId": "TDMS",
  "claimedAt": "2026-05-19T12:18:00Z",
  "holder": {
    "kind": "claude",                 // claude | codex | human | subagent
    "sessionId": "abc-123",           // 來自 CLAUDE_SESSION_ID / CODEX_SESSION_ID / 或 "human"
    "label": "verifying #178 fix"     // 自由文字，給人看
  },
  "devServer": {
    "pid": 78363,
    "cwd": "/Users/charles/offline/TDMS-wt/fix-vending-part-name-display",
    "port": 3000,
    "url": "http://127.0.0.1:3000"
  },
  "browserProfile": {
    "buName": "default",
    "cdpUrl": "http://127.0.0.1:9333",
    "userDataDir": "/Users/charles/Library/Application Support/Google/Chrome-BH"
  },
  "cookieNamespace": "tdms-fix-vending-part-name-display",
  "envFile": {
    "path": "/Users/charles/offline/TDMS-wt/fix-vending-part-name-display/.env.local",
    "sha256": "e3b0c44..."
  },
  "auditLog": [
    { "at": "2026-05-19T12:18:00Z", "event": "claimed", "by": "claude:abc-123" },
    { "at": "2026-05-19T13:05:14Z", "event": "takeover", "by": "human", "prev": "claude:abc-123", "reason": "manual override" }
  ]
}
```

部分 slot 可缺（如未啟瀏覽器 → `browserProfile: null`），但 `devServer` + `holder` + `claimedAt` 必填。

## Operations

| Op | 誰可呼 | 行為 |
|---|---|---|
| **status** | 任何人（含 read-only） | 讀 lease 檔；無檔 = 無 holder；印 holder + uptime + 五元組摘要 |
| **claim** | lease-aware 工具 | 嘗試取得 lease：無檔 → write；有檔且 PID dead → 視為 stale，覆寫；有檔且同 holder kind+sessionId → reuse（no-op）；其他 → **refuse** |
| **release** | 持有者 | 刪 lease 檔；非持有者呼叫 = no-op + warn |
| **force-takeover** | 任何 lease-aware 工具，需顯式 flag（`--takeover`） | 不管現有 holder，覆寫 lease；prev holder 寫進 auditLog；同步 kill 對方 dev server PID（如可達） |

**Stale 偵測**：claim 時若現有 lease 的 `devServer.pid` 死了（`kill -0 <pid>` fail）→ 自動視為 stale，silent overwrite。不要要求 `--takeover`。

**並行 race**：兩個工具同時 claim，靠 `fs.writeFile` with `O_EXCL` flag（`{ flag: 'wx' }`）做檔案級 atomic check，後到者 fail → 視為 conflict → 跑 status + refuse。

## Holder identity

```
kind         sessionId source                            label
─────────────────────────────────────────────────────────────────────────────────
claude       process.env.CLAUDE_SESSION_ID 或 cwd hash    --label flag
codex        process.env.CODEX_SESSION_ID 或 cwd hash     --label flag
subagent     parent claude session + agent name           Agent tool prompt
human        固定字串 "human"                             不可缺，至少傳「what for」
```

`sessionId` 拿不到時 fallback 到 cwd-derived hash（不同 worktree 至少能分），但記 warning 到 auditLog。

## 工具行為契約

下列工具/規則**必須**讀寫 lease：

| 工具 | 何時 claim | 何時 release |
|---|---|---|
| `vendor/scripts/dev-singleton.mjs` | spawn 前；reuse 前讀 lease 對 cwd | dev server 被 kill 時 |
| `vendor/snippets/dev-auth/templates/server-api-dev-signin.ts.template` | endpoint 第一次被打時 | lease 有 holder 才允許簽 cookie（防 CSRF） |
| `vendor/snippets/wt-helper/`（建立 worktree） | bootstrap .env.local 前 | env file 寫完後 |
| `browser-harness` daemon wrapper（future） | 開瀏覽器 + load profile 前 | daemon shutdown 時 |

下列工具**只讀**：

- `vendor/scripts/audit-*.mjs`（稽核）
- `vendor/scripts/review-gui.mts`（UI 看 lease 狀態）
- `scripts/sync-consumer-meta.mjs`（aggregate snapshot）

## Claim 衝突的標準訊息

```
[lease:<consumer>] cannot claim — already held by <holder.kind>:<holder.sessionId>
  since:        2026-05-19T12:18:00Z (8m 32s ago)
  dev server:   PID 78363, cwd=/Users/charles/offline/TDMS-wt/fix-vending-part-name-display, port=3000
  browser:      BU_NAME=default
  cookie ns:    tdms-fix-vending-part-name-display
  env file:     .env.local (sha256:e3b0c44...)

To force takeover, re-run with --takeover (logs previous holder + reason).
To inspect, run: dev:status
```

訊息要含 holder 識別 + 五元組摘要，讓使用者**不必再額外 dev:status** 就能判斷要不要搶。

## Agent 行為契約

Claude / Codex 在這條規則之下：

- **NEVER** 用 raw `nuxt dev` / `node server.mjs` / `playwright start` 之類 bypass lease 的方式啟動 dev server
- **NEVER** 直接 `lsof + kill` 別 holder 的 PID（即使它是另一個自己的 session）；要殺一律走 `dev-singleton.mjs --takeover` 或 `release` op
- **NEVER** 在 lease 衝突訊息出來時自行決定 `--takeover`，**MUST** 把 message 原樣呈給 user 讓 user 決定
- **NEVER** 在 autonomous mode（background subagent、scheduled task、/loop）下執行 `--takeover`，autonomous = 永遠 refuse + 在 chat 報告
- **MUST** 在 claim 時帶可辨識的 `--label`（如「verifying #178」「reproducing TD-099」）
- **MUST** 在 dev server / browser session 結束時主動 `release`（task 結束 / session 收尾 / kill subagent 前）

## 與 Consumer Manifest 的關係

Lease 的「該不該強制走 singleton wrapper」由 consumer 自宣告：

```jsonc
// .claude/consumer-meta.json 片段
{
  "auth": {
    "provider": "supabase-google",
    "portPinned": true                  // OAuth pin 該 consumer 到固定 port
  },
  "dev": {
    "ports": [{ "port": 3000, "alias": "main" }],
    "leaseMode": "strict"               // strict | advisory
  }
}
```

- `leaseMode: strict` + `portPinned: true` → singleton wrapper **必須**用，cwd-mismatch 預設 refuse
- `leaseMode: advisory` → singleton wrapper 仍 claim lease，但 cwd-mismatch 印 warning 後 reuse（不阻擋）
- `portPinned: false` → 走 [`proactive-skills.md`](./proactive-skills.md) § Dev Server Auto-Spawn 既有的「scan 3001-3050」邏輯，lease 仍 claim（只是 port 是 dynamic）

## Audit log retention

`auditLog` 保留最多 50 條，FIFO。長期紀錄需求走 `vendor/scripts/improvement-digest.mjs` 拉 lease 檔的 snapshot 進 digest，本檔不負責長期持久。

## Why（root cause）

過去（2026-05 之前）四個資源各自獨立規範：

- dev server port → `proactive-skills.md § Dev Server Auto-Spawn`（scan 3001-3050）
- browser profile → `browser-harness` skill（隱性，沒文件化）
- cookie namespace → 沒人規範（撞了才知道）
- env file → consumer wt-helper（每家自己寫）

問題：四個資源**實際是綁定的**（解一個會影響其他三個），但散規範散實作 → 兩個 session 同時驗證時不同層各自 hold 對方資源 → 出現「dev server 是 A 的，cookie 是 B 的，瀏覽器 profile 是 C 的」這種 inconsistent state。

把它變一等概念後：claim 一次拿一組、release 一次釋一組，atomicity 由 lease 檔保證。
