<!--
🔒 LOCKED — managed by clade
Source: rules/core/verification-lease.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Verification Lease

**核心命題**：dev server + browser profile + cookie namespace + env file + session identity 是一組**綁定資源**，任意時刻只能由一個 holder 持有。把這組綁定收成一個明確物件叫 **verification lease**，任何要動其中之一的工具/規則都先 claim、衝突就 refuse。

Lease 檔在 `/tmp/<consumer_id>-verification-lease.json`；`dev-session.mjs status` 讀得到當前 holder。

> 五元組欄位、檔 schema、claim / release / force-takeover 行為、holder identity 解析、哪些工具必須讀寫 lease、consumer-meta `leaseMode` 對照，見 [[verification-lease.spec]]（path-scoped：動 `dev-session*` / `consumer-meta.json` / `nuxt.config.*` 時載入）。

## Agent 行為契約

Claude / Codex 在這條規則之下：

- **NEVER** 用 raw `nuxt dev` / `node server.mjs` / `playwright start` 之類 bypass lease 的方式啟動 dev server
- **NEVER** 直接 `lsof + kill` 別 holder 的 PID（即使它是另一個自己的 session）；要殺一律走 `dev-session.mjs stop` / `--takeover`（或 legacy `dev-singleton.mjs`）的 op
- **NEVER** 在 lease 衝突訊息出來時自行決定 `--takeover`，**MUST** 把 message 原樣呈給 user 讓 user 決定
- **NEVER** 在 autonomous mode（background subagent、scheduled task、/loop）下執行 `--takeover`，autonomous = 永遠 refuse + 在 chat 報告
- **MUST** 在 claim 時帶可辨識的 `--label`（如「verifying #178」「reproducing TD-099」）
- **MUST** 在 dev server / browser session 結束時主動 `release`（task 結束 / session 收尾 / kill subagent 前）
