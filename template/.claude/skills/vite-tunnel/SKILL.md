---
name: vite-tunnel
description: 建 Cloudflare Named Tunnel 給本機 dev server（跨裝置 OAuth / webhook 測試用）。
metadata:
  clade:
    invocation: explicit
disable-model-invocation: true
effort: medium
---


本 skill 由使用者明確要求建立／設定 tunnel 時啟動，包含本機配置與外部 Cloudflare 資源修改；不屬唯讀稽核。原生叫用方式由各 target adapter 交付，取得 skill 不代表已授權 DNS、token、OAuth provider 或對外開放資源。依本次既有授權執行，缺的是資源決策或帳號授權時才詢問。

對應 cookbook：`~/offline/clade/vendor/snippets/vite-tunnel/`

## 何時用 vs 何時不用

**用這個 skill**：
- 真實 OAuth provider flow 必須跑（Apple Sign In、不能 mock、要驗 production-like cookie flow）
- 手機 / 平板 / 另一台筆電要連 dev server 跑 OAuth callback / webhook
- 對外人秀 dev preview，需要穩定 hostname

**改走其他做法**：
- 單機開發 + agent 並行驗證 → 用 `vendor/snippets/dev-auth/` cookbook 繞 OAuth（更快、不依賴外部網路）
- 不需固定 callback 的臨時 webhook 測試 → `cloudflared tunnel --url http://localhost:<實際-port>` 拿 quick tunnel；需要預先註冊固定 URL 時使用下方 named tunnel
- 多 worktree 並行 dev server → dev-auth + cookie namespace 比 tunnel 簡單
- 給產品加**公開** hostname（例 `<consumer-e>.<client-b>.tw`）到 **remotely-managed** tunnel（`cloudflared tunnel run --token`）→ **不是本 skill**。走 `~/offline/clade/vendor/snippets/cloudflare-tunnel-hostname/`（API／CLI；dashboard 404 不是停工理由）

## Step 1: 偵測專案部署 target

讀 `package.json` / `wrangler.toml` / `wrangler.jsonc`：

| 偵測信號 | 路線 | 後續 |
| --- | --- | --- |
| 已安裝並在 Vite config 啟用支援 tunnel 的 `@cloudflare/vite-plugin` | **官方 Vite 路線** | 設定 named tunnel，啟動後按 `t + Enter` |
| 一般 Vite 專案且本次採用第三方整合 | **第三方路線** | 安裝並設定 `vite-plugin-cloudflare-tunnel` |
| Nuxt／Nitro 或其他已有 dev server、未使用上列整合 | **獨立 cloudflared 路線** | 依 cookbook 將 named tunnel ingress 指到實際 local dev URL，分別啟動 dev server 與 tunnel |

`wrangler.*` 存在只表示有 Cloudflare 配置，不證明正在使用 Vite plugin。先查 lockfile 安裝版本、實際載入的 config 與該版本 API；Nuxt 專案的 Vite 配置由 Nuxt 承接，不假定根 `vite.config.ts` 會被讀取。官方選項依 [Cloudflare local-dev tunnel 文件](https://developers.cloudflare.com/workers/local-development/local-dev-tunnels/) 核對。

## Step 2: 前置檢查

先查專案文件、已授權帳號配置與當前工具能力：

1. 取得 hostname、tunnel name 與實際 dev URL，確認目標 zone 與帳號識別。
2. 驗 `cloudflared` 可執行性；缺少時依目前作業系統的官方安裝方式處理。
3. 使用 locally-managed tunnel 的 setup 腳本需要有效 account certificate。檔案存在只證明有檔；核對選定 credential 的帳號與目標 zone。需要登入時依既有授權執行 `cloudflared tunnel login`，人類 OAuth 操作另列待辦。
4. 多帳號時以實際 account／zone ID 與 credential binding 查證。Tunnel 名稱前綴不承載帳號身分。

選用 locally-managed setup helper 時，依 cookbook 提供明確的 account／zone 與 certificate 路徑。Helper 比對 certificate 的 account ID **及 zone ID**，再核對 API 的 zone ownership、tunnel UUID 與 DNS target；查詢失敗或不一致時停止資源寫入。Credential 的檔案存在、名稱前綴與命令 exit 0 均不取代此配對。

## Step 3: 取得 API token

- **官方 Vite／獨立 cloudflared 路線**：依該版本與 tunnel 管理模式的認證方式執行。若使用下方 locally-managed helper，其 API preflight 另外需要 `CLOUDFLARE_API_KEY`；這個變數不表示採用了第三方 plugin。
- **第三方 named tunnel 路線**：依 [plugin prerequisites](https://github.com/eastlondoner/vite-plugin-cloudflare-tunnel#prerequisites)，需要 Account `Cloudflare Tunnel:Edit` 與目標 Zone 的 `DNS:Edit`、`SSL and Certificates:Edit`。若另用腳本查 zone，該查詢還需對應的讀取權限。

憑證由專案指定且已授權的 secret store 取得；若指定 Notion，使用可用的 `ntn api` 讀取。沒有可用憑證時列出精確缺少的 account／zone 權限，由使用者完成需要本人操作的授權。Token 值不輸出到對話、log、commit 或報告；保存到專案指定的本機 secret 載體前先確認不被版控追蹤。既有 scope 已足夠就沿用；新 scope 限於本次目標資源。

## Step 4: 建立或重用 locally-managed tunnel

本節只在選定 locally-managed helper 時執行；官方整合若使用其他管理模式，依該模式文件設定，不混用 credential。

先由已授權的 secret store 注入 `CLOUDFLARE_API_KEY`，並提供 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_ZONE_NAME`。選用非預設 certificate 時另設 `TUNNEL_ORIGIN_CERT`。API token 需能讀取該 zone、tunnel 與 DNS 記錄；執行 cloudflared 的 certificate 另有資源寫入授權。

```bash
~/offline/clade/vendor/snippets/vite-tunnel/bin/dev-tunnel-setup.sh \
  <hostname> <tunnel-name>
```

約定 tunnel-name = `<project>-dev`。Helper 需要 Python 3、curl 與 cloudflared；不自動登入。

1. 驗證 hostname／zone 邊界、certificate account／zone 與 API 身分。
2. 依結構化 API 查明 tunnel，確認不存在時才建立；既有 DNS 只接受指向同一 UUID 的 CNAME。
3. DNS route 執行後再查實際 target，符合才回報 ready。
4. 在 `.env.local` 保留既有內容、補非秘密的 `TUNNEL_HOSTNAME`／`TUNNEL_NAME`／`TUNNEL_ID`；設定衝突、被追蹤或 symlink 時停止。不保存 API token。

遠端操作後失敗時先查現有資源，再決定重跑；不要自行刪除 tunnel／DNS 作為回滾。

## Step 5: 填 token + patch vite.config

### 第三方路線

1. 設 token：由已授權的 secret store 注入 `CLOUDFLARE_API_KEY`；若寫入 `.env.local`，先確認未被追蹤且已 ignored。Helper 只寫非秘密設定，沒有待填 token 行。
2. 安裝 plugin：
   ```bash
   pnpm add -D vite-plugin-cloudflare-tunnel
   ```
3. 抄範本：把 `~/offline/clade/vendor/snippets/vite-tunnel/templates/vite.config.generic.snippet.ts.template` 對應段合進 `vite.config.ts`。重點兩塊：
   - `plugins: [..., cloudflareTunnel({ hostname, tunnelName, apiToken })]`
   - `server: { allowedHosts: [hostname] }`

   不要直接覆蓋使用者既有 `vite.config.ts`——只 merge 必要兩塊。

### 官方 Vite 路線

抄範本：`~/offline/clade/vendor/snippets/vite-tunnel/templates/vite.config.workers.snippet.ts.template`，重點是 `cloudflare({ tunnel: { name: '<tunnel-name>' } })`。`vite dev` 模式 plugin 會自動處理 host 驗證；`vite preview` 才要手動補 `preview.allowedHosts`。

### 獨立 cloudflared 路線

依 locally-managed tunnel 的實際 config 將 ingress 指到已驗證的 dev URL，再以選定 credential 啟動該 named tunnel。既有 Nuxt／Nitro dev command 照專案配置執行；沒有 Vite plugin 整合時不新增用不到的 `vite.config.ts`。記錄這次啟動的 process handle，驗收結束後按既有保留需求關閉或交接。

## Step 6: OAuth provider 註冊 callback

依既有授權與可用工具補 provider callback；需要使用者本人登入或授權時才交給本人操作。常見設定入口如下：

| Provider | 通常路徑 |
| --- | --- |
| Google OAuth | Google Cloud Console → APIs & Services → Credentials → OAuth client → Authorized redirect URIs |
| GitHub OAuth App | GitHub Settings → Developer settings → OAuth Apps → Authorization callback URL |
| Supabase Auth | Supabase dashboard → Authentication → URL Configuration → Redirect URLs |
| Apple Sign In | Apple Developer → Identifiers → Services IDs → Return URLs |

先查專案實際 callback route，再以 `https://<hostname>/<實際-callback-path>` 註冊；`/auth/callback` 僅是常見範例。保留仍需使用的 localhost callback。

## Step 7: 啟動 + 驗證

```bash
pnpm dev
# 官方路線：按 t + Enter 拉 tunnel
# 第三方路線：plugin 自動拉，等 ready log
curl -I https://<hostname>   # 預期 200 / 301
```

驗收：
- [ ] `curl -I https://<hostname>` 通
- [ ] 桌面瀏覽器開 `https://<hostname>` 看到 dev server 頁面
- [ ] 手機 / 另一裝置開 `https://<hostname>` 跑完 OAuth flow，登入成功
- [ ] 登入後 reload 頁面 session 還在（cookie Secure 正常）

任一條沒過，去看 cookbook 的 Gotchas 表（`vendor/snippets/vite-tunnel/README.md`）。

## 共用 tunnel 模型

**每專案各建一條 tunnel**（不要把多專案 hostname route 到同一 tunnel）：
- tunnel-name 跟專案 name 綁定（`<consumer-a>-dev` / `<consumer-b>-dev`）
- A 專案 dev 關閉時 B 不會被牽連 502
- `cloudflared tunnel list` 一目了然

憑證依專案指定的 custody 與目標 account／zone scope 管理；是否跨專案共用不由此 skill 預設。

## Gotchas（精簡版，完整看 cookbook）

- `server.allowedHosts` 漏 hostname → Vite 回 "Blocked request"；第三方路線**必加**
- OAuth callback 仍指 localhost → provider 回 `redirect_uri_mismatch`
- Cookie 沒 `Secure` flag → 跨裝置登入後 session 立刻丟
- 第三方 token 權限不足 → 核對失敗 API、account／zone 與所需 scope；cloudflared certificate 與第三方 token 分開診斷
- Domain 不在 Cloudflare DNS → `route dns` 報 zone not found
- 用 `cloudflared tunnel --url` 拉 quick tunnel → hostname 隨機，OAuth 註冊壞掉；這 skill **MUST** 用 named tunnel
- 對外人分享 dev URL → 用 `vite preview` 而非 `vite dev`（HMR / source files 不對外洩）

完整解法看 `~/offline/clade/vendor/snippets/vite-tunnel/README.md#gotchas`。


