# SOP 03 — Google OAuth redirect / origin

**Todo id**：`gate-03-oauth`  
**路徑**：`docs/playbooks/03-google-oauth.md`  
**看板 id**：`google-oauth`

開場白：「現在跑 `gate-03-oauth`（本檔）。Ready 綠才動 client。callback **不是** `/callback`。」

## Ready

| probe | 真 |
| --- | --- |
| 本 repo 用 `nuxt-auth-utils` 或同等 Google OAuth | `package.json` 有對應 dep |
| `server/routes/auth/google*` **不存在**（契約仍是 `/auth/google`） | 與姐妹系統 `google.get.ts` 對照過 |
| `.env.example` 已寫 `{{OAUTH_ORIGIN}}/auth/google` 且不含 `/callback` | `grep auth/google .env.example` |

要加的 URI（只**加**，不改 {{NEVER_TOUCH_PEER}} 既有 URI）：

```
Authorized JavaScript origin:  {{OAUTH_ORIGIN}}
Authorized redirect URI:       {{OAUTH_ORIGIN}}/auth/google
```

共用 client 時用保管處既有 `NUXT_OAUTH_GOOGLE_CLIENT_ID`（只報 length+prefix）。**NEVER** 新開第二顆。

## NEVER

- **NEVER** 新開第二顆 client。
- **NEVER** 加 `/auth/google/callback`。
- **NEVER** 改掉 {{NEVER_TOUCH_PEER}} 既有 origin / redirect。
- **NEVER** 第一手叫人開 Console。先 CLI。
- **NEVER** 在 Cursor 環境用 `agent-browser` / Playwright / headless 開 Console（見 [README § Browser 分流](./README.md#browser-分流cursor-vs-非-cursor)）。
- **NEVER** 把「開 Console 並加上 URI」派給沒有 `cursor-ide-browser` 的 subagent。Console 是公網 HTTPS，主線 `open_resource` 開在 Mac。**NEVER** 叫人開 Browser 面板。

## Turns

### Turn 1 — 本機契約

**跑**：`grep -n 'auth/google' .env.example`  
錯 → agent 改 `.env.example`，不要等。看板 `waiting`。

### Turn 2 — CLI 路徑（依序）

**跑**（每步記 exit + 原文）：`gcloud` / 保管處 client id / IAP Client 更新 API。  
**等**：API 回 200 且 client 的 redirectUris 含 `{{OAUTH_ORIGIN}}/auth/google`。

### Turn 3 — 無 CLI 時用瀏覽器載體（仍是 agent）

**跑**：依 [README § Browser 分流](./README.md#browser-分流cursor-vs-非-cursor) 開 Credentials（`https://console.cloud.google.com/apis/credentials`）。這是**公網 HTTPS**。有 `cursor-ide-browser` 才去點**既有共用 client**加兩條 URI。OAuth 完成後瀏覽器打 `{{OAUTH_ORIGIN}}/auth/google` 才需要 Mac→遠端 {{DEV_PORT}} forward。

**失敗且必須人點**（captcha / 帳號選擇／2FA／passkey）：把 Turn 2+3 全部失敗原文與活的 Console URL 寫進 PROGRESS。這是唯一可停的人類項。

### Turn 4 — Success probe

```bash
grep -n 'auth/google' .env.example
# 真：{{DEV_PORT}}/auth/google，無 /callback
```

通過 → 看板 `verified`，todo completed。
