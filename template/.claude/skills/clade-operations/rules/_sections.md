<!-- Clade native rule; generated section index of rules/*.md; edit canonical sources -->
行號 1 起算、含端點；Read 用 offset=起、limit=迄-起+1。

api-patterns.md — Server API 設計規範
5-24 前導 — API Patterns
26-28 授權、Mutation 語意、冪等與 Retry
30-57 OpenAPI Metadata Convention
59-63 Runtime 環境差異
65-74 Audit Logs

cloudflare-workers.md — Cloudflare Workers 單軌規約（void 優先、cf CLI 補位、禁用 wrangler）。Workers 部署 / 本機 dev / 型別 / secret / D1 migration 一律走 `void`（自有 CF 帳號），void 做不到的帳號資源操作才走 `cf` CLI；依 DB 選擇分派 NuxtHub gating（D1 + 舊派 → `@nuxthub/core`；void 自帶 `void/db` → 禁帶），並定義遷移期對 wrangler 殘留的處置
5-10 前導 — Cloudflare Workers Configuration
12-29 § 1 — DB × NuxtHub gating（hard rule）
31-44 § 2 — 設定檔歸屬（hard rule）
46-70 § 3 — Deploy command（hard rule，單軌 void）
72-106 § 4 — Binding declaration
108-115 § 5 — 違反偵測
117-127 § 6 — 遷移期現況
129-156 § 7 — Self-hosted runner CI 反 pattern
158-182 § 8 — Cloudflare 操作工具：void 優先，`cf` 補位（hard rule）

deploy-env-identity.md — 決定「這份執行中的程式跑在哪個部署目標」時——標 Sentry / evlog 的 environment、選告警路由、開關環境專屬 feature、擋 destructive endpoint——判斷該讀哪個值；症狀是 staging 的事件混進 production 的判讀
15-18 前導 — Deploy Env Identity（部署身分取自注入，不取自 build mode）
20-27 適用條件（可觀察 predicate）
29-49 不變量
51-59 接線：三個位置各自的正確來源
61-67 測試要求
69-79 反開脫

dev-port-allocation.md — Consumer dev server port 中央分配 + audit（避免跨 consumer 撞號）
5-16 前導 — Dev Port 中央分配
20-26 MUST › 1. 顯式宣告 port
28-33 MUST › 2. Tunnel port 對齊
35-41 MUST › 3. Registry 唯一性
43-79 MUST › 4. Worktree 維度
81-106 MUST › 5. 本機 Supabase 埠區塊
108-111 自治區（規約不強制）
113-120 How to apply
122-124 Anti-pattern
126-129 何時不適用
131-142 dev server runtime 帳本與對帳

dev-tunnel-convention.md — Dev tunnel（vite-plugin-cloudflare-tunnel / cloudflared）跨 consumer convention — § 1–4 zone/hostname、token scope、restart-loop 防護、冷/熱載入量測規約本體（自 dev-port-allocation 搬入）；§ 6 要掛 dev tunnel 就必須掛 Cloudflare Access，否則撤 tunnel；§ 7 linked worktree 不得接上共用 named tunnel
5-10 前導 — Dev Tunnel Convention
12-28 § 1 — Hostname／zone 必在當前 account 內（multi-account misdirection）
30-39 § 2 — Token scope：必用 cfat_*（含 SSL:Edit）
41-54 § 3 — Resilient wrapper：防 restart loop → CF 10502 lockout
56-67 § 4 — 冷/熱載入量測：別把 cold 誤判成 hang
69-101 § 5 — CDN 不得快取 dev tunnel（否則 Vite 的 CSS 會被當成 module script）
103-125 § 6 — 要掛 dev tunnel 就必須掛 Cloudflare Access，否則撤 tunnel
127-147 § 7 — worktree：linked worktree 的 dev server 不得接上共用 named tunnel

service-access.md — 要碰第三方服務（打它的 API、開它的 dashboard、要人登入或給 OTP）之前先讀存取卡，照卡上量過的最省路徑走；沒有卡就探索一次並寫卡
5-21 前導 — 第三方服務存取（先讀卡）
23-32 沒有卡，或卡已過期（`last_verified` 超過 90 天）
34-45 決策樹：同一個操作有多條路徑時
47-55 量測與稽核

service-url-locality.md — app 與它的 backing service（Supabase / PostgREST / storage）跑在同一個內網、而該 service 另有對外域名時，決定 server 端與 client 端各該讀哪個 URL；症狀是每支碰 DB 的 API 都慢一點（全部 200、只是慢），或圖片只有外部使用者載不到
12-18 前導 — Service URL Locality（server 端與 client 端讀的是兩個不同的值）
20-29 適用條件（可觀察 predicate）
31-39 不變量
41-64 三個值，不是兩個
66-74 兩個方向都沒有 failing signal
76-86 驗證（適用條件成立時 MUST 實跑）

vite-doctor.md — 動到 nuxt.config / vite.config / package.json scripts / doctor preset 時的 vite-doctor 配置判準（devDependency 必裝、module 必啟用、`pnpm run doctor` 的 run 不可省）
5-10 前導 — Vite Doctor（framework diagnostic scanner）
12-60 MUST
62-73 CLI
75-77 Baseline 管理
