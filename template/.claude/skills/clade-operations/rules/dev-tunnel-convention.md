---
description: Dev tunnel（vite-plugin-cloudflare-tunnel / cloudflared）跨 consumer convention — § 1–4 zone/hostname、token scope、restart-loop 防護、冷/熱載入量測規約本體（自 dev-port-allocation 搬入）；§ 6 要掛 dev tunnel 就必須掛 Cloudflare Access，否則撤 tunnel；§ 7 linked worktree 不得接上共用 named tunnel
paths: ['nuxt.config.*', '.env', '.env.local', 'package.json']
---
<!-- Clade native rule; source: rules/core/dev-tunnel-convention.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Dev Tunnel Convention

Dev tunnel（`vite-plugin-cloudflare-tunnel` 或手動 `cloudflared`）的 org convention 與失敗模式；§ 1–§4 是 zone／token／resilient wrapper／冷熱載入量測的規約本體（自 `dev-port-allocation` §2.5–2.7 搬入，那邊不再留副本），§ 5–§ 7 是 CDN 快取、Access、worktree。dev port 的分配見 [[dev-port-allocation]]。

## § 1 — Hostname／zone 必在當前 account 內（multi-account misdirection）

凡 consumer 用 `vite-plugin-cloudflare-tunnel` 開 dev tunnel：

- **MUST** Hostname 走 `<consumer-id>-dev.<maintainer-domain>`（org convention）
- **NEVER** 自由發揮挑其他 zone（如 `bigbyteedu.com`／個人域名）— 即使 DNS／tunnel 建得起來，plugin 仍會因 token-zone account 不匹配 403 crash Nuxt
- **MUST** `.env.local` 設三件套：

  ```env
  TUNNEL_HOSTNAME=<consumer-id>-dev.<maintainer-domain>
  TUNNEL_NAME=<consumer-id>-dev
  CLOUDFLARE_API_KEY=<cfat_*-token>
  ```

多 account 環境下 `cloudflared tunnel route dns` 對不在 `cert.pem` 所綁 account 的 zone **不會 fail-loud**：它把整段 hostname 當 prefix 附加到該 account 第一個 zone，CLI exit 0 但 DNS 永遠 resolve 不到。改用 `~/offline/clade/vendor/snippets/vite-tunnel/bin/dev-tunnel-setup.sh`（顯式比對 account／zone、route 後回讀 DNS），見同目錄 README § 多 Cloudflare account 使用情境。

**Pitfall**：[[pitfall-cloudflared-multi-account-cname-misdirection]]

## § 2 — Token scope：必用 cfat_*（含 SSL:Edit）

- **MUST** Token 用 `cfat_*` account API token，**絕非** `cfut_*`（Worker token）或 `r_*`（cert.pem 簽發的 tunnel-scoped token）
  - 來源：某 consumer `.env.local` 的 `CLOUDFLARE_API_KEY`
  - 必備權限：`Cloudflare Tunnel:Edit`（account）＋`SSL and Certificates:Edit`（zone）＋`DNS:Edit`（zone）
  - **必要**：`SSL and Certificates:Edit` — plugin 必跑 `/zones/<id>/ssl/certificate_packs` GET 確認 edge cert，403 會 re-throw crash Nuxt（即使 Cloudflare Universal SSL 已涵蓋）

錯誤來源：`cert.pem` 的 `r_*`（無 SSL scope、綁錯 account）、`cfut_*` Worker token（無 SSL:Edit）、dashboard 自建的 limited-scope token（常漏 SSL 或 Tunnel）。

**Pitfall**：[[pitfall-vite-plugin-cloudflare-tunnel-token-scope]]

## § 3 — Resilient wrapper：防 restart loop → CF 10502 lockout

凡 consumer 用 `vite-plugin-cloudflare-tunnel` 開 dev tunnel：

- **MUST** 透過 **pre-flight token probe＋try-catch wrapper** 呼叫 `viteCloudflareTunnel`，probe 失敗／network 失敗／hostname 缺漏時 fallback 純 localhost，**NEVER** 讓 plugin throw 進 Nuxt
- **NEVER** 在 `nuxt.config.ts` 內**裸呼叫** `viteCloudflareTunnel({...})`（即 plugin call 不在 try-catch／async fn／pre-flight probe 之內）— 此寫法視為 anti-pattern
- **MUST** pre-flight probe 用 `AbortController` 設 ≤ 3s timeout，避免 Cloudflare 10502 lockout 期 API 阻塞拉長 dev startup time
- **MUST** probe endpoint 用 `GET /accounts`（plugin 真正會跑的第一支 call），**NEVER** 用 `/user/tokens/verify`（後者需 token 含 `User Details:Read` permission，多數 Tunnel-only token 沒給 → 會把好 token 誤判 invalid，wrapper 永遠 fallback localhost、tunnel 永遠起不來）

範本＋verify helper：`vendor/snippets/dev-tunnel-resilient/`；`scripts/dev-port-audit.ts` 的 `readTunnelResilientWrapper` 報裸呼叫。

成因：plugin（1.0.12）的 `GET /accounts` 無 retry，token invalid → throw → Nuxt auto-restart spin loop → 觸發 CF `10502` lockout（15–60 分鐘），期間連有效新 token 都回 `code 1000 Invalid API Token`。

**Pitfall**：[[pitfall-vite-plugin-cloudflare-tunnel-restart-loop-lockout]]

## § 4 — 冷/熱載入量測：別把 cold 誤判成 hang

凡量測透過 `vite-plugin-cloudflare-tunnel` 開的 dev tunnel 頁面載入效能（人工或 agent CDP）：

- **NEVER** 量測前 `clearBrowserCache`／`setCacheDisabled(true)`——一個 Nuxt＋@nuxt/ui v4 dev 頁面有 ~300–950 個 ES module，cold 經 tunnel 要 30–60s，看似 hang
- **MUST** 量「warm」：第一次載入 populate 快取（不計時）→ 第二次不清快取量 hydrate（約 6s 為正常）
- **NEVER** 把 cold 載入慢判成 tunnel 壞掉而去試 CF cache rule／`--protocol http2`／`keepAliveConnections`／移 plugin／降版（實證全無效）
- **MAY** 減少 cold-load 模組數：`import { x } from '@nuxt/ui/locale'` barrel import 會拉進整包語言檔；改公開 subpath deep-import（`import x from '@nuxt/ui/runtime/locale/<lang>.js'`）只載需要的 locale

範本：`vendor/snippets/dev-tunnel-perf/`。判準看症狀：慢但最終會載完 = 本節（`cache:false` 無效）；白畫面＋strict MIME 錯 = § 5（`cache:false` 是唯一解）。

**Pitfall**：[[pitfall-vite-dev-over-tunnel-cold-load-misdiagnosis]]

## § 5 — CDN 不得快取 dev tunnel（否則 Vite 的 CSS 會被當成 module script）

**Convention**：dev tunnel hostname **MUST** 用 `<name>-dev.<zone>` 後綴（bypass 規則靠它匹配），且 zone 上 **MUST** 有一條 Cache Rule 讓這批 hostname 完全 bypass CDN 快取。Consumer 端 `nuxt.config.ts` **MUST** 在走 tunnel 時回 `Cache-Control: no-store` + `Vary: Accept`（defence in depth，單靠它擋不住既有 CDN 條目）。

**為什麼**：Vite dev 對同一個 `.css` URL 依 `Accept` 回真 CSS 或 JS wrapper，但 `Vary` 只有 `Origin`；Cloudflare 對 `.css` 套 4 小時 Browser Cache TTL，`text/css` 那份被快取後 module import 命中它，strict MIME 拒收 → **白畫面**。全部請求 200、curl 驗不到、local dev 正常。

**規則落地**（zone 層一條規則涵蓋全 fleet）：

```bash
# cf CLI 未覆蓋 zone 層 ruleset（只有 account-rulesets；見 cloudflare-workers § 8），故走 HTTP API
# ruleset id 從 http_request_cache_settings entrypoint 取，再 POST 一條 rule
curl -s -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/rulesets/$RULESET/rules" \
  -d '{"expression":"(ends_with(http.host, \"-dev.<maintainer-domain>\"))","action":"set_cache_settings","action_parameters":{"cache":false},"enabled":true,"description":"Dev tunnels: bypass CDN cache"}'
```

生效約 10-15 秒，**不需要**先 purge。

**驗證**（**MUST 用瀏覽器驗，curl 不算**）：

```js
p.on('response', r => {
  const ct = r.headers()['content-type'] || ''
  if (r.request().resourceType() === 'script' && !/javascript/i.test(ct))
    console.log('BAD MIME', ct, r.url())
})
```

**權威來源**：
- Consumer 端 header 範本：`vite.server.headers = { 'Cache-Control': 'no-store', Vary: 'Accept, Origin' }`（只在 `TUNNEL_HOSTNAME` 有值時套用）
- Hostname convention：§ 1

**Pitfall**：[[pitfall-cdn-cache-ignores-accept-breaks-vite-css-module-mime]]

## § 6 — 要掛 dev tunnel 就必須掛 Cloudflare Access，否則撤 tunnel

**Convention**：**每一個** consumer 的 dev server 要掛 tunnel，前提是該 tunnel hostname 掛了 Cloudflare Access；沒有 Access 就先撤掉 dev server tunnel（Charles 2026-10-07）。合法狀態只有兩種——「hostname 有 Access」或「沒有 tunnel」，**NEVER** 有「先開著之後再補 Access」。

**為什麼**：tunnel 會把偽造 `Origin: http://localhost:<port>` 的外部請求送進 dev server；Nuxt DevTools v4（devframe）的 node 端工具在授權開著時仍讀得到 `runtimeConfig` 裡的 secret。Access 在 Cloudflare 邊緣就把沒登入的請求轉走，請求到不了 origin。

**判定（只認邊緣探測）**：「有沒有 Access」**MUST** 只用 `vendor/snippets/agent-devtools/access-probe.mjs` 的 `probeAccess(hostname)` 判定——對 `https://<hostname>/__devtools/__mcp` 與 `https://<hostname>/` 各發一個不帶憑證、不跟轉址的請求，**兩條**都轉址到 `*.cloudflareaccess.com` 才是 `access`。其餘一律當作沒有：`530`、`200`、`403`（含 service-token-only policy）、逾時、DNS 失敗。**NEVER** 用人工宣告的旗標、設定檔註記或「我記得有掛」代替探測。

**撤 tunnel 的可觀察結果**：consumer 的 `.env*` 不再有 `TUNNEL_HOSTNAME` 等 tunnel 設定，dev server 啟動時不開 tunnel，dev 走 localhost。Cloudflare 端的 tunnel 物件與 DNS record 要不要一併刪除不在本節範圍。

**webhook bypass**：Access app 只替外部 webhook 路徑（例如 LINE）開 bypass 算符合本節。**每一個** tunnel hostname 的 bypass **MUST** 只涵蓋外部 webhook 路徑，DevTools 端點（`/__devtools/**`）與站台根路徑 **NEVER** 在 bypass 內——蓋到其中之一，探測就不是 `access`。bypass 路徑上的端點 **MUST** 自己驗證來源（例如 webhook 簽章）。需要 webhook 的 consumer **NEVER** 以此為由保留未掛 Access 的 tunnel。手機一樣經 Access 登入使用，**NEVER** 為手機另開 bypass。

**執行期兜底（Nuxt DevTools v4）**：`TUNNEL_HOSTNAME` 有值、tunnel 真的要開時，`nuxt.config.ts` 在啟動前探一次（≤ 3s，NEVER throw）；不是 `access` 就 `vite.devtools: false` 並印原因與兩個處置（補 Access／撤 tunnel）。這是**唯一**的關閉條件：**每一個** consumer 的範本 **NEVER** 以「綁非 loopback host（`--host`／`NUXT_HOST`）」關 DevTools——沒有 tunnel 的區網由 token 授權與 MCP bearer 承擔（[[agent-devtools]]）。resilient wrapper fallback 純 localhost 時視為沒有 tunnel，不探測。範本：`vendor/snippets/agent-devtools/`。

**綁定 host 與 opt-out**：`dev-session.ts start` 起 server 時預設補 `HOST=127.0.0.1 NUXT_HOST=127.0.0.1`（不聽 `*`）。consumer 已宣告綁定就**不蓋**，下列任一成立即略過：process env 已有 `HOST`／`NUXT_HOST`、`CLADE_DEV_BIND_ALL=1`、dev 命令帶 `--host`／`-H`、cwd 的 `.env`／`.env.local`／`.env.development(.local)` 設了 `HOST`／`NUXT_HOST`、`package.json` 的 `scripts.dev` 含 `--host`。靠 LAN／tailnet 綁定的 consumer 在 `.env` 宣告 `NUXT_HOST` 即可，不必每次帶旗標。判定在 `vendor/scripts/lib/dev-runtime.ts` 的 `shouldForceLoopback`。

**稽核**：`node scripts/dev-port-audit.ts --markdown`（clade 端）的「Agent devtools」段逐 consumer 報 tunnel hostname 的探測結果；有 tunnel 而不是 `access` 即 FAIL。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | `dev-port-audit.ts` 對有 `TUNNEL_HOSTNAME` 的 consumer 探測為 `no-access`／`unreachable` → 該列 FAIL、exit 1；dev server 啟動時探測不是 `access` → DevTools 關閉並印一行原因 |
| 消費端 | 主持者（把 FAIL 的 consumer 派出去補 Access 或撤 tunnel、relay 時帶現況列）；設 tunnel 的 consumer session |
| 觸發點 | 本節 paths-gated 於 `nuxt.config.*`、`.env`、`.env.local`（設 tunnel 的那一刻）；`dev-port-audit.ts` 的 FAIL 輸出直接印本節位置 |

## § 7 — worktree：linked worktree 的 dev server 不得接上共用 named tunnel

**Convention**：一個 consumer 只有一個共用 tunnel hostname（§ 1）。linked worktree 的 dev server **MUST** 不帶這個 hostname 啟動——要嘛沒有 tunnel（預設），要嘛走 `dev.perWorktreeTunnel` opt-in 拿自己的 `<slug>.<host>`。**NEVER** 逐字沿用共用的 `TUNNEL_HOSTNAME`／`TUNNEL_NAME` 在 worktree 啟 tunnel。

**為什麼**：worktree 的 `.env.local` 從 main 複製（`wt-helper add` 的 `copyEnvSyncFiles()`，或手動跑 `wt-env-sync`）；逐字沿用時，worktree 的 `nuxt dev` 會對同一個 named tunnel 起 cloudflared，連到它的 connector 與 main 的並存，Cloudflare 把請求分給兩邊（約一分鐘即可能分走 main 的流量）。事件：某 consumer 的 worktree 啟動 dev 後，接上了該 consumer 共用的 dev tunnel hostname（2026-10-12）。

**三層防線**（任一層都不取代其他層）：

| 層 | 行為 | 落點 |
| --- | --- | --- |
| 複製 | 沒開 `dev.perWorktreeTunnel` 時，複製進 worktree 的 `.env*` **MUST** 移除 `TUNNEL_HOSTNAME`／`TUNNEL_NAME` 宣告行（其餘逐字不動）；開了才改寫成 `<slug>.<host>`／`<name>-<slug>` | `vendor/scripts/wt-env-sync.ts`（**尚未涵蓋** `wt-helper add`：它用自己的 `copyEnvSyncFiles()` 逐字複製、不呼叫 `wt-env-sync`，新開的樹仍帶共用 `TUNNEL_*`，只剩啟動層擋；殘工見 `specs/plans/W-2026-10-12-linked-worktree-dev-server-named-tunnel-wt-env-s/followup-wt-helper-env-copy.md`） |
| 啟動 | resilient wrapper 偵測到 linked worktree（往上找到的 `.git` 是檔案且 `gitdir:` 含 `/worktrees/`）而 hostname 不是該樹自己的 `<slug>.<host>`（讀得到 main 的共用 hostname 時只認 `<slug>.<共用 host>`）→ 視同沒有 tunnel（plugin、`allowedHosts`、`origin`、`hmr` 全關）並印一行原因 | `vendor/snippets/dev-tunnel-resilient/` 的 `dev-tunnel-worktree-guard` 段 |
| 規約 | worktree 要 tunnel **MUST** 先確認 consumer 有涵蓋 `*.<host>` 的 DNS 與憑證，再開 opt-in；**NEVER** 為了讓 tunnel 起來而手動把共用 hostname 貼回 worktree 的 `.env*`；**NEVER** 代 consumer 開 opt-in 欄位 | [[dev-port-allocation]] § Tunnel 在 worktree 內 |

**既有與 `wt-helper add` 新開的 worktree**：已複製過的 `.env.local` 不會被事後改寫（`wt-env-sync` 不加 `--force` 會跳過），`wt-helper add` 開的樹在殘工落地前也逐字帶著共用 `TUNNEL_*`。要找出仍帶共用 hostname 的樹，唯讀跑 `node vendor/scripts/worktree-census.ts` 後逐樹 grep `^\s*(export\s+)?TUNNEL_(HOSTNAME|NAME)\s*=`；處置（刪行或 opt-in）由該樹 owner 做，**NEVER** 從別的 session 代改。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | `wt-env-sync` 複製 `.env*` 且 consumer 未 opt-in；或 wrapper 在 linked worktree 讀到非 per-worktree 的 `TUNNEL_HOSTNAME` |
| 消費端 | 開 worktree 跑 dev server 的 session；主持者（掃描既有樹並派 owner 清理） |
| 觸發點 | 本節 paths-gated 於 `nuxt.config.*`、`.env`、`.env.local`；`wt-env-sync` 與 wrapper 在動作當下印一行原因 |
