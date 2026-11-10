---
name: "clade-operations"
description: "Runtime, deployment, local service, and infrastructure rules. Use when changing Cloudflare, Nitro, APIs, tunnels, ports, service URLs, or operational configuration. Also use when: 要打第三方服務 API、開它的 dashboard、或要人登入／給 OTP 之前."
---

# SOP

## Phase 1 -- 用任務挑出要讀的 rule

1. READ 逐條對照接下來要做的事：條件成立才把該 rule 列入候選，NEVER 整批讀。
   - `rules/api-patterns.md`：Server API 設計規範；且碰 `server/api/**/*.ts`、`packages/*/server/api/**/*.ts`
   - `rules/cloudflare-workers.md`：Cloudflare Workers 單軌規約（void 優先、cf CLI 補位、禁用 wrangler）。Workers 部署 / 本機 dev / 型別 / secret / D1 migration 一律走 `void`（自有 CF 帳號），void 做不到的帳號資源操作才走 `cf` CLI；依 DB 選擇分派 NuxtHub gating（D1 + 舊派 → `@nuxthub/core`；void 自帶 `void/db` → 禁帶），並定義遷移期對 wrangler 殘留的處置；且碰 `void.config.ts`、`void.lock.json`、`wrangler.{toml,jsonc}` 等 6 處
   - `rules/deploy-env-identity.md`：決定「這份執行中的程式跑在哪個部署目標」時——標 Sentry / evlog 的 environment、選告警路由、開關環境專屬 feature、擋 destructive endpoint——判斷該讀哪個值；症狀是 staging 的事件混進 production 的判讀；且碰 `sentry*.config.*`、`**/sentry*.ts`、`nuxt.config.*` 等 10 處
   - `rules/dev-port-allocation.md`：Consumer dev server port 中央分配 + audit（避免跨 consumer 撞號）；且碰 `package.json`、`nuxt.config.ts`、`supabase/config.toml` 等 5 處
   - `rules/dev-tunnel-convention.md`：Dev tunnel（vite-plugin-cloudflare-tunnel / cloudflared）跨 consumer convention — § 1–4 zone/hostname、token scope、restart-loop 防護、冷/熱載入量測規約本體（自 dev-port-allocation 搬入）；§ 6 要掛 dev tunnel 就必須掛 Cloudflare Access，否則撤 tunnel；§ 7 linked worktree 不得接上共用 named tunnel；且碰 `nuxt.config.*`、`.env`、`.env.local` 等 4 處
   - `rules/service-access.md`：要碰第三方服務（打它的 API、開它的 dashboard、要人登入或給 OTP）之前先讀存取卡，照卡上量過的最省路徑走；沒有卡就探索一次並寫卡；或要打第三方服務 API、開它的 dashboard、或要人登入／給 OTP 之前
   - `rules/service-url-locality.md`：app 與它的 backing service（Supabase / PostgREST / storage）跑在同一個內網、而該 service 另有對外域名時，決定 server 端與 client 端各該讀哪個 URL；症狀是每支碰 DB 的 API 都慢一點（全部 200、只是慢），或圖片只有外部使用者載不到；且碰 `nuxt.config.*`、`server/**/*.ts`、`packages/*/server/**/*.ts` 等 7 處
   - `rules/vite-doctor.md`：動到 nuxt.config / vite.config / package.json scripts / doctor preset 時的 vite-doctor 配置判準（devDependency 必裝、module 必啟用、`pnpm run doctor` 的 run 不可省）；且碰 `nuxt.config.*`、`vite.config.*`、`package.json` 等 6 處

## Phase 2 -- 只讀候選 rule 中與任務相關的段落

1. READ `rules/_sections.md` 中候選 rule 的區塊（首行 `<file> — `、空行結束；用 Grep 加 `-A 40` 取（區塊最長約 38 行，讀到空行為止，其後是下一份 rule 的區塊），NEVER 整份讀索引），只挑與任務相關的段落，用 Read 的 offset／limit 讀該行號區間。
2. READ 標題看不出相關與否的 rule 才整份讀；NEVER 用條件清單或段落索引代替 rule 內文。
