---
description: Consumer dev server port 中央分配 + audit（避免跨 consumer 撞號）
paths: ['package.json', 'nuxt.config.ts', 'registry/consumers.json', 'registry/consumers.schema.json']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/dev-port-allocation.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Dev Port 中央分配

**核心命題**：consumer 越來越多，dev server port 撞號是 cross-cutting concern — 不集中分配必然撞。本規約把 dev port 變成 clade 標準層治理：registry 集中分配、規約強制宣告、audit 偵測漂移與衝突。

> SoT：`registry/consumers.json` 每個 consumer entry 的 `dev_ports` object。
>
> Audit signal：`scripts/dev-port-audit.ts`。
>
> Cookbook 範本：`vendor/snippets/dev-port/`。

## MUST

### 1. 顯式宣告 port

- **MUST** consumer `package.json` 的 `dev` script 必須顯式帶 `--port <registry.dev_ports.nuxt>`
- **NEVER** 裸 `nuxt dev`（吃 Nuxt default 3000）
- **NEVER** 省略 `--port` flag

### 2. Tunnel port 對齊

- **MUST** consumer `nuxt.config.ts` 若使用 `vite-plugin-cloudflare-tunnel`，plugin 的 `port:` 必須等於 registry `dev_ports.nuxt`
- 寫法可為 hard-code number 或 `Number(process.env.NUXT_DEV_PORT ?? <registry-value>)`，audit 兩種都接受

### 2.5. Dev tunnel zone & token convention（vite-plugin-cloudflare-tunnel）

凡 consumer 用 `vite-plugin-cloudflare-tunnel` 開 dev tunnel：

- **MUST** Hostname 走 `<consumer-id>-dev.<maintainer-domain>`（org convention；既有對齊：`<consumer-k>-dev` / `<consumer-b>-dev` / `<consumer-a>-shared-dev` / `<consumer-i>-dev`）
- **NEVER** 自由發揮挑其他 zone（如 `bigbyteedu.com` / 個人域名）— 即使 DNS / tunnel 建得起來，plugin 仍會因 token-zone account 不匹配 403 crash Nuxt
- **MUST** `.env.local` 設三件套：

  ```env
  TUNNEL_HOSTNAME=<consumer-id>-dev.<maintainer-domain>
  TUNNEL_NAME=<consumer-id>-dev
  CLOUDFLARE_API_KEY=<cfat_*-token>
  ```

- **MUST** Token 用 `cfat_*` account API token，**絕非** `cfut_*`（Worker token）或 `r_*`（cert.pem 簽發的 tunnel-scoped token）
  - 來源 1：<consumer-k> `.env.local` 的 `CLOUDFLARE_API_KEY`（既有可用）
  - 來源 2：Notion `Scrects` → Cloudflare → YuDefine（待補；目前只列 cfut_）
  - 必備權限：`Cloudflare Tunnel:Edit`（account）+ `SSL and Certificates:Edit`（zone）+ `DNS:Edit`（zone）
  - **必要**：`SSL and Certificates:Edit` — plugin `dist/index.mjs:617` 必跑 `/zones/<id>/ssl/certificate_packs` GET 確認 edge cert，403 會 re-throw crash Nuxt（即使 Cloudflare Universal SSL 已涵蓋）

#### 三種錯誤 token 來源 + 為什麼不能用

| Token 來源 | 為什麼不行 |
| --- | --- |
| `~/.cloudflared/cert.pem`（`cloudflared tunnel login` 簽發的 `r_*` token） | 只有 Tunnel + DNS scope，無 SSL；且綁定登入時選的 account zone（多數情況不是 yudefine） |
| Notion `Scrects` 的 `cfut_*`「YuDefine - for Worker 通用」 | 設計給 wrangler deploy / Worker 用，無 SSL:Edit |
| user 自行透過 dashboard 建的 limited-scope token | 多半漏 SSL 或漏 Tunnel；要建 token 一定要對齊上面 3 條權限 |

### 2.6. Dev tunnel resilient pattern（防 Nuxt restart loop → CF 10502 lockout）

凡 consumer 用 `vite-plugin-cloudflare-tunnel` 開 dev tunnel：

- **MUST** 透過 **pre-flight token probe + try-catch wrapper** 呼叫 `viteCloudflareTunnel`，probe 失敗 / network 失敗 / hostname 缺漏時 fallback 純 localhost、**NEVER** 讓 plugin throw 進 Nuxt
- **NEVER** 在 `nuxt.config.ts` 內**裸呼叫** `viteCloudflareTunnel({...})`（即 plugin call 不在 try-catch / async fn / pre-flight probe 之內）— 此寫法視為 anti-pattern
- **MUST** pre-flight probe 用 `AbortController` 設 ≤ 3s timeout，避免 Cloudflare 10502 lockout 期 API 阻塞拉長 dev startup time
- **MUST** probe endpoint 用 `GET /accounts`（plugin 真正會跑的第一支 call），**NEVER** 用 `/user/tokens/verify`（後者需 token 含 `User Details:Read` permission，多數 Tunnel-only token 沒給 → 會把好 token 誤判 invalid，wrapper 永遠 fallback localhost、tunnel 永遠起不來）

範本 + verify helper 見 [`vendor/snippets/dev-tunnel-resilient/`](../../vendor/snippets/dev-tunnel-resilient/)。直接抄 `nuxt.config.ts.template` 改少數 placeholder（port、env key name）即可。

#### 為什麼需要這層 wrapper

`vite-plugin-cloudflare-tunnel@1.0.12` 的 `retryWithBackoff`（`dist/index.mjs:286-304`）**只包 SSL cert 端點**，第一支 auth API call `GET /accounts`（line 520）裸跑無 retry。token invalid 時：

1. Plugin throw `Error("[cloudflare-tunnel] API request failed: ...")`
2. Nuxt dev 把 plugin throw 當 fatal → auto-restart
3. 重啟 → plugin 重新 setup → 又打 `/accounts` → 又 throw → 無延遲 spin loop
4. 十幾秒內可累積數十次 auth attempt → 觸發 Cloudflare `code 10502 Too many authentication failures` lockout（經驗值 15–60 分鐘）
5. Lockout 期內**任何** token verify（含貼有效新 token）都回 `code 1000 Invalid API Token`（防 enumeration）— 誤導 user 以為「新 token 也壞」

Wrapper 把這條鏈在第一步切斷：token verify 失敗 → log warn → 回 `plugins: []` → Nuxt 走純 localhost、不 throw、不 restart。

詳見 [[pitfall-vite-plugin-cloudflare-tunnel-restart-loop-lockout]]。

### 2.7. Dev-over-tunnel 冷/熱載入量測（防誤判 hang）

凡量測透過 `vite-plugin-cloudflare-tunnel` 開的 dev tunnel 頁面載入效能（人工或 agent CDP）：

- **NEVER** 量測前 `clearBrowserCache` / `setCacheDisabled(true)` — 會強制走全新冷載入，把瀏覽器本機快取的 immutable dep 全部重抓。Vite dev 對 `?v=<hash>` 的 node_modules dep 送 `Cache-Control: max-age=31536000, immutable`；一個 Nuxt + @nuxt/ui v4 dev 頁面拆成 ~300–950 個 ES module 請求，cold 經 tunnel 逐一往返受 cloudflared 並發吞吐限制 → 30–60s，量測窗內看似 `pending` / hang
- **MUST** 量「warm」反映日常情境：第一次載入 populate 瀏覽器快取（不計時）→ 第二次載入（不清快取）量 hydrate 時間。warm 數秒內 hydrate（實測 <consumer-i> 6.3s）= 正常；只有全新裝置 / 快取過期 / 無痕才會慢
- **NEVER** 把 cold 載入慢判成 tunnel 壞掉 → 一路試 CF cache rule `cache:false` / cloudflared `--protocol http2` / `keepAliveConnections` / 移 plugin / 降版（實證全無效）。慢 vs 快是 cache-warmth 連續譜，不是 broken 二元判斷
- **MAY** 減少 cold-load 模組數：`import { x } from '@nuxt/ui/locale'` barrel import 會拉進整包 62 語言檔；改公開 subpath deep-import（`import x from '@nuxt/ui/runtime/locale/<lang>.js'`）只載需要的 locale

正確量測方法 + locale deep-import 完整範本見 [`vendor/snippets/dev-tunnel-perf/`](../../vendor/snippets/dev-tunnel-perf/)。

詳見 [[pitfall-vite-dev-over-tunnel-cold-load-misdiagnosis]]。

### 3. Registry 唯一性

- **MUST** 新 consumer 進 `registry/consumers.json` 必須認領未用的 +10 號 port（3000, 3010, 3020, …）
- **NEVER** 兩個 consumer 在 registry 取同 `dev_ports.nuxt` 值
- **MUST** 改 port 必須先在 clade `registry/consumers.json` commit + publish + propagate，再改 consumer 端的 dev script / tunnel config
- **MUST** 新 base 與任一既有 base 相距 **≥10**（`dev-port-audit.ts` 報 `band-spacing` CONFLICT）— 間距不是排版習慣，base+1..base+9 是該 consumer worktree 的 port 池，見 §4

### 4. Worktree 維度

[[worktree-default]] §1 要求任何動 tracked file 的工作都在獨立 worktree 執行，所以「一個 consumer 同時只有一個 dev server」從來不成立。同一 consumer 的 N 個 worktree 各跑 dev，撞的是 §1 那個**唯一**的 registry port。

分配規則：**worktree 的 port = 各宣告 port + 一個 worktree 專屬 offset N**，N 取自 `[1, 9]`。

- **MUST** worktree 內用 `node vendor/scripts/wt-helper.ts dev [<alias>]` 起 dev server，**NEVER** 在 worktree 內跑 `pnpm dev`（那會吃 `package.json` 寫死的 base port，直接撞 main）
- **MUST** main working tree 維持 §1 的顯式宣告不變 — `package.json` 的 `--port <base 字面數字>` 一個字都不改。offset 只存在於 worktree，由 `wt-helper` 在 `wt-helper add` 時分配
- **NEVER** 手動挑 worktree port。offset 由 `pickDevPortOffset` 算，它同時排除三件事：mapped port 超出 `[base, base+9]`（會踩到下一個 consumer 的 base）、mapped port 撞到本 consumer 另一個宣告 port（<consumer-a> 宣告 3040 + 3045，offset 5 會讓 `<client-a>` 蓋掉 `shared`）、offset 已被 sibling worktree 佔用
- 宣告多個 port 的 consumer **帶寬較窄**：天花板由最高的宣告 port 決定（<consumer-a> 只有 N ∈ 1..4，不是 1..9）
- Offset 記錄在 `~/.cache/clade/dev-port/<consumer>/<slug>.json`，**不**寫進 repo（`.clade/` 在多數 consumer 未被 gitignore，寫進去會讓每個 worktree 帶一個 untracked 檔進 merge-back / publish 的 dirty 判定）。worktree 目錄消失即釋放槽位，不需要手動回收
- 帶寬用盡時 `wt-helper dev` **fail-loud 拒絕啟動**，**NEVER** fallback 到 base port — 那正是本節要防的撞車

#### Tunnel 在 worktree 內

Tunnel hostname 是 **per-consumer 單一資源**（§2.5 的 `<consumer-id>-dev.<maintainer-domain>`）。N 個 worktree 共用一個 hostname 比共用一個 port 更糟：dev server 起得來、tunnel 也連得上，只是流量被**後啟動的那個** worktree 劫持，main 的畫面靜默變成別人的。

- **MUST** worktree 要開 tunnel 就走 `dev.perWorktreeTunnel` opt-in（`consumer-meta.json`），由 `vendor/scripts/wt-env-sync.ts` 改寫成 `<slug>.<host>` / `<name>-<slug>`
- **NEVER** 沒開 opt-in 就在 worktree 內啟 tunnel。`wt-helper add` 會複製 `.env.local`（含 tunnel token，這是 `envSyncPolicy` 的既定行為），所以 token **存在不代表可以用**
- `wt-helper add` 與 `wt-helper dev` 偵測到「有 tunnel key 但沒開 opt-in」會 warn。**warn 不是擋** — 判斷仍在 worktree owner：要嘛 opt-in，要嘛把那幾個 key 在該 worktree 註解掉

## 自治區（規約不強制）

- `.env.example` 是否寫 `NUXT_DEV_PORT=<value>` 由 consumer 自定 — dev script 的 `--port` flag 是 SoT，env 不需重複
- 子 service port（Storybook / Vitest UI / Vite preview / Wrangler）— schema 預留欄位，本輪未分配，consumer 用到時再進 registry

## Why

跨 consumer 同時跑 dev（例：開兩個 IDE / window）必然觸發 Nuxt port auto-increment（3000 → 3001），但 `vite-plugin-cloudflare-tunnel` 的 `port:` 是 hard-coded → tunnel 會打到先啟動的那個 consumer，後啟動的看似跑起來實際不通。這種 silent fail 不會出現在 log，只在「我打 tunnel URL 怎麼看到別的 consumer 的畫面」這種 user-visible symptom 才暴露。中央分配從架構上消除這種狀態。

## How to apply

| 情境 | 動作 |
| --- | --- |
| 新 consumer 進 registry | 取下一個未用 +10 號（目前 3000–3100 已用，下一個是 3110；快照，以 registry/consumers.json dev_ports 為準） |
| 既有 consumer 改 port | 先改 clade registry → publish patch → propagate → 改 consumer 自家 dev script + tunnel port |
| Audit 報 DRIFT | consumer user 在 consumer 自家 session 改 dev script / tunnel port 對齊 registry；clade 主線不替 consumer 執行 |
| Audit 報 CONFLICT（兩 consumer 同 port） | clade 主線立即解：選一個 consumer 改用未用 +10 號，registry commit + publish + propagate |

## 當前分配（snapshot，以 registry 為準）

| consumer | dev_ports.nuxt |
| --- | --- |
| <consumer-a> | 3040 |
| nuxt-supabase-starter | 3020 |
| <consumer-c> | 3010 |
| <consumer-d> | 3060 |
| <consumer-b> | 3000 |
| <consumer-k> | 3050 |
| <consumer-i> | 3070 |
| <consumer-l> | 3080 |
| <consumer-e> | 3090 |
| <consumer-g> | 3100 |
| clade | — (source-of-truth，非 Nuxt consumer) |

下一個可用：**3110**（快照，以 registry/consumers.json dev_ports 為準）。

## Anti-pattern

- ❌ 裸 `nuxt dev`（吃 default 3000，必跟 <consumer-b> 撞）
- ❌ 在 `.env.local` 設 `PORT=3050` 但 dev script 沒帶 `--port` flag — Nuxt 不一定吃 `PORT` env（要 `NITRO_PORT`），且 `.env.local` 是 gitignored，協作者 clone 完不知道
- ❌ 改 consumer 端 port 沒先改 clade registry — 下次 audit 報 DRIFT，且新 consumer 加入時可能撞號

## 何時不適用

- consumer 不跑 Nuxt（例如純 static site、Workers-only） — `dev_ports.nuxt` 可省略，schema 不強制必填
- consumer `business_activity = paused` 仍受規約約束（avoid silent drift），但 audit DRIFT 不視為 hot follow-up
