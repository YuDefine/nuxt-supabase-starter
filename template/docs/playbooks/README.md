# {{CONSUMER}} gate playbooks（對話式 SOP）

HANDOFF `## User-gate board` 是狀態 SoT。本目錄是 **AI session 逐步執行** 的腳本，不是丟給人的 URL 手冊。

**Iron Law**：session 做得到的動作 NEVER 交給人。停手條件只有「該動作自己的失敗輸出」＋「人類專屬能力」（生物辨識 / CLI 做不到的外部授權點擊 / 不可逆商業拍板）。

## Cursor Task todos（每個新 session 開工必做）

每個 gate **一支** Todo（`TodoWrite` merge true）。`content` 必須含 playbook 路徑。人在 Cursor 看到的 Task 清單就是這五格：

| todo id | playbook |
| --- | --- |
| `gate-01-lxc-tailscale` | [01-lxc-and-tailscale.md](./01-lxc-and-tailscale.md) |
| `gate-02-ssh-config` | [02-ssh-config.md](./02-ssh-config.md) |
| `gate-03-oauth` | [03-google-oauth.md](./03-google-oauth.md) |
| `gate-04-deploy-prod-db` | [04-deploy-prod-db.md](./04-deploy-prod-db.md) |
| `gate-05-post-verify` | [05-post-gate-verify.md](./05-post-gate-verify.md) |

規則：當步 `in_progress`、後面 `pending`、該 SOP success probe 通過才 `completed`。一次只推進一格（03 可與 01/02 並行）。逐字內容見 [GATE-TODOS.md](./GATE-TODOS.md)。

## 狀態機（看板）

| 狀態 | 意思 | 誰改 |
| --- | --- | --- |
| `ready-for-user` | SOP 已落地、下一步尚未開始（歷史名；執行者仍是 agent） | playbook 剛寫好時 |
| `waiting` | agent 正在跑、或等外部生效（MagicDNS / OAuth API 傳播） | 動手的那一方 |
| `user-done-unverified` | 外部授權剛做完、success probe 還沒跑 | 僅當真的走過人類專屬授權 |
| `verified` | success probe 通過（可分岔） | agent |
| `blocked-unexpected` | 該次指令失敗且失敗分支走完仍卡 | agent（附失敗原文） |

## 每支 SOP 的共同形狀

1. 開頭列 **todo id / 路徑 / Ready checklist**。Ready 沒綠 → 不要開這支，回到上一格。
2. **Numbered turns**：AI 跑什麼、說什麼、等什麼觀測。失敗 = 下一 turn，不是「請你去點」。
3. 每 turn 結束：寫看板狀態 + 往 [PROGRESS.md](./PROGRESS.md) append 一行（日期 · gate id · 指令 · exit · 訊號 · 結果）。

## Browser 分流（Cursor vs 非 Cursor）

開 Tailscale login / Google Console / OAuth callback **之前**先判兩件事：這是不是 Cursor 環境、以及目標是**公網 HTTPS**還是**本機服務**。**不要寫死 `agent-browser`**。01 Turn 4、03 Turn 3、05 若要回 Console，都指回本節。

**NEVER** 把「這個 session 的 MCP catalog 沒有 `cursor-ide-browser`」讀成「遠端開不了 Browser 面板、所以卡住」。缺 MCP 只影響 agent 能不能點頁面，不影響 Mac 能不能開 https。**NEVER** 叫人去 Cursor Settings 開 Browser 面板。**NEVER** 派沒有 browser MCP 的 subagent 假裝操控 Chromium。

### 開頁架構

| 目標 | 怎麼開 | port forward |
| --- | --- | --- |
| Tailscale `https://login.tailscale.com/a/…`、Google Console `https://console.cloud.google.com/apis/credentials` | **Mac 開外部 HTTPS**。主線 `cursor-app-control` `open_resource`（workbench opener，開在 Mac） | **不要**。不要為 HTTPS 轉 443，也不要走遠端 Chromium |
| OAuth 完成後瀏覽器打 `{{OAUTH_ORIGIN}}/auth/google` | **本機服務**。Mac 的 `127.0.0.1:{{DEV_PORT}}` 必須打到這台遠端的 {{DEV_PORT}} | **要**：Cursor SSH Forwarded Ports，或 Mac 上 `ssh -L {{DEV_PORT}}:127.0.0.1:{{DEV_PORT}}`。dev server 還沒聽也先備 forward |

`open_resource` 不是可控 Chromium（不能 snapshot / 點按鈕），但公網 https 已經開在 Mac。帳號選擇／2FA／passkey 才是人類專屬：把**活的** URL 寫進 PROGRESS。過期 URL **不是**行動項。

### 這是不是 Cursor 環境（命中任一即是）

| probe | 真 |
| --- | --- |
| 系統提示自稱 Cursor，或工具清單含 `cursor-app-control` / `cursor-grok*` | 是 |
| env 有 `CURSOR_SESSION_ID` 或 `CURSOR_TRACE_ID` | 是（subagent 的 **shell** 可能兩顆都空；空 ≠ 非 Cursor） |
| `GetDynamicTools` catalog 含 `cursor-ide-browser` **或** `cursor-app-control` | 是 |

### Cursor 環境

- **公網 HTTPS**：主線 `open_resource` 開在 Mac。有 `cursor-ide-browser` 才 `browser_tabs` → `browser_navigate`（**當場 mint** 的 https URL）→ `browser_lock` → snapshot / 點 / 填 → unlock。沒有該 MCP **不要**讀成卡住，也不要叫人開 Browser 面板。
- **NEVER** 呼叫 `agent-browser` / Playwright / headless。Google 會趕到 `accounts.google.com` 且 URL 含 `signin/rejected`（標題 Couldn’t sign you in）。
- **NEVER** 把「開 Google / Tailscale 登入頁並點下去」派給沒有 `cursor-ide-browser` 的 subagent。公網 https 留 **Cursor 主線** `open_resource`。
- **本機 {{DEV_PORT}}**：先備 Mac→遠端 port forward。**NEVER** 複製 `~/.cursor/projects/*/mcps/cursor-ide-browser/`（假陽性）。**NEVER** 寫進 `~/.cursor/mcp.json`（內建 server 寫不出來）。

### 非 Cursor（Claude Code 等）

才走 `agent-browser`（仍是 agent 自己開；**NEVER** 第一手叫人）。

## 誰更新哪一欄

- **agent**：跑每一 turn、改看板、append PROGRESS。
- **人**：只在某 turn 的失敗輸出證明是人類專屬能力時介入；agent 必須貼出指令 + exit + 原文。
- **NEVER** 把過期 Tailscale login URL 當行動項。現場重取。**NEVER** `tailscale logout`。**NEVER** 動 {{NEVER_TOUCH_PEER}}。

## 順序

01 → 02 →（03 可並行）→ 04 套用預設（CI build-only）→ 05。

## Starter contract

`/project-bootstrap` / starter onboarding **MUST** 在任何「請點」之前 mint 本目錄這包。契約 SoT 在 clade `vendor/snippets/new-consumer-gate-playbooks/`。
