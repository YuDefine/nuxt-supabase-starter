---
description: 新專案選 auth 模組、Auth 策略與資料存取路徑一致性——防止混合 auth 狀態導致 silent 權限降級
paths: ['drizzle.config.ts', 'packages/*/drizzle.config.ts', 'app/**/*.ts', 'packages/*/app/**/*.ts', 'app/**/*.vue', 'packages/*/app/**/*.vue', 'supabase/migrations/**/*.sql', 'server/api/**/*.ts', 'server/utils/**/*.ts', 'packages/*/server/api/**/*.ts', 'packages/*/server/utils/**/*.ts']
---
<!-- Clade native rule; source: rules/core/auth-data-path-consistency.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Auth–Data Path 一致性

## 核心命題

瀏覽器的 Supabase client（`useSupabaseClient()`）向 PostgREST 發 request 時，身分來自 **Supabase Auth 的 JWT**，不來自應用程式自己的 Cookie Session。若應用程式已移除或未使用 Supabase Auth（改用 `nuxt-auth-utils`、Better Auth 等），瀏覽器的 Supabase client **永遠以 `anon` role 存取**，無論使用者是否已登入。

此規則防止「session 層已換、但 client 端仍直連 PostgREST」的混合狀態——它在 production 表現為看似隨機的 401。

## Trigger

- 新專案選 identity 來源（auth 模組），或既有專案決定更換 auth 策略
- 更換或移除 auth 策略（Supabase Auth → nuxt-auth-utils / Better Auth，或反向）
- 新增 client-side `useSupabaseClient().from('table')` 直連查詢
- 新增 migration 含 RLS policy（`CREATE POLICY ... TO authenticated`）
- 新增 table 並決定 client 端存取方式

## MUST

1. **換 auth 策略時全面 audit call sites**——列舉全部 `useSupabaseClient()` 在 `app/` 的使用點，逐一歸類：
   - 改走 server API（`$fetch` / `useFetch`）
   - 確認為純 Storage（`supabase.storage.from()`）——Storage 有獨立 bucket policy，不受此規則約束
   - 確認仍有 Supabase Auth JWT 支撐（identity 來源未變）
2. **Migration 建 RLS policy 時同時驗證 GRANT**——PostgreSQL 先查 table-level privilege 再評估 RLS policy。只建 `TO authenticated` policy 但沒有 `GRANT SELECT ON <table> TO authenticated`，結果是 `42501`（permission denied），RLS policy 完全不被評估。Migration 內 **MUST** 顯式 GRANT 或註明 table 已有既存 GRANT。
3. **新增繞過 server 的資料路徑時標註 evlog 盲區**——client-side PostgREST 直連不經 Nitro，evlog middleware 看不到。新增此類路徑 **MUST** 在 PR description 標註「此路徑在 evlog 觀測範圍外」。

## NEVER

1. **NEVER** 用 `GRANT ... TO anon` 修 401——等於把資料公開給任何持有 publishable key 的人。401 的正解是修身分鏈，不是放寬權限。
2. **NEVER** 留「session 層用 Cookie，但 DB policy 假設 Supabase JWT 存在」的混合狀態——瀏覽器不會因為帶著 Cookie Session 就自動變成 `authenticated` role。
3. **NEVER** 為了取得 `authenticated` role 而自行簽 PostgREST JWT——同時維護 Cookie Session + JWT 兩套 session lifecycle（rotation、logout、角色同步）的複雜度通常比完整採用 Supabase Auth 更差。

## Server 側：RLS policy 的前提條件

上面幾節管的是「瀏覽器直連 PostgREST」。本節管的是**同一個身分鏈斷裂在 server 側的形態**——它不會回 401，不會有任何錯誤，policy 靜靜地不放行或整個被繞過。

### 命題

RLS policy 裡的 `auth.uid()` 能取到值，前提是**該 request 攜帶 Supabase Auth 簽發的 JWT**。consumer 的 identity 來源若不是 Supabase Auth（Better Auth / nuxt-auth-utils / 自建 session），`auth.uid()` **靜默回 null**——policy 語法正確、`ENABLE ROW LEVEL SECURITY` 也開著，但沒有任何 row 會通過。

若 server 端又是 service-role 連線（`SUPABASE_SECRET_KEY`），情況反過來：service_role 具 `BYPASSRLS`，policy 連評估都不評估，整表放行。

兩者疊加就是最危險的形態：**RLS 已啟用、policy 檔案完整、實際授權為零**。

### MUST

1. **每一條**引用 `auth.uid()` 的 policy，其所在 repo 的 identity 來源 **MUST** 是 Supabase Auth。（**範圍是所有含 `supabase/migrations/**` 的 consumer 的每一條 policy，不是只檢查新加的那條**——換 auth 策略時既有 policy 會整批失效，而它們不會在 diff 裡出現。）
2. identity 來源不是 Supabase Auth 時，授權 **MUST** 上移 handler 層（`requireAuth` + ownership 比對 / `requireRole` / 以 `user.id` 夾住查詢條件），RLS **MUST** 改為「啟用 + 零 policy」的 deny-all，並在 migration 內用註解寫明這是 deny-all by design、以及授權在哪一層。
3. server helper 的**命名 MUST 反映它實際做的事**。回傳 service-role client 的 helper 叫 `getSupabaseWithContext` 這種名字，會讓 handler 作者以為資料範圍已被限縮，實際上 service_role 讓 policy 整表放行（見上方）。

### NEVER

1. **NEVER** 用 `set_app_context` 這類 RPC 寫 GUC 供 policy 讀。`set_config(..., true)` 是 **transaction-local**，而 PostgREST 每個 request 是獨立 transaction——GUC 在 RPC 回傳的當下就失效，policy 裡的 `current_setting('app.*')` 永遠讀不到它。**恆定無效**。

2. **NEVER** 把「policy 存在」當成「授權存在」。判斷授權是否生效要同時回答三件事：identity 來源是不是 Supabase Auth、連線角色是不是 service_role、policy 依賴的是 `auth.uid()` 還是 GUC。三者任一錯位，policy 就是死碼。

3. **NEVER** 因為 policy 看起來沒生效就加 `TO service_role` 的 bypass policy。service_role 本來就有 `BYPASSRLS`，那條 policy 是裝飾品，只會讓後續讀者更難判斷真正的授權在哪。

## Auth 策略與資料路徑的合法組合

| Auth 策略 | Client 直連 table | Client 直連 Storage | Server API (service_role) | RLS policy 可用 `auth.uid()` |
| --- | --- | --- | --- | --- |
| Supabase Auth（JWT 存在） | ✅ 需正確 GRANT + RLS | ✅ Bucket policy | ✅ | ✅ |
| nuxt-auth-utils / Better Auth（無 JWT） | ❌ 永遠 anon | ✅ Bucket policy 獨立 | ✅ 授權 MUST 在 handler | ❌ 恆 null → policy 死碼 |
| 無 auth | ❌ | ⚠️ 只限公開 bucket | ✅ | ❌ |

最後一欄是 server 側的判準，與第一欄**互相獨立**：一個 consumer 可以完全不做 client 直連（第一欄 n/a），但只要 migration 裡有 `auth.uid()` policy 而 identity 不是 Supabase Auth，那些 policy 就是死碼。

## Auth 選型

**適用時刻**：新專案選 identity 來源，或既有專案決定更換 auth 策略時。已上線的專案不因本節被要求遷移；需求後來命中下表的條件，只代表值得評估升級。

三種選項是 nuxt-auth-utils、better-auth、Supabase Auth（manifest `modules.auth` 為 `supabase-self-hosted`）。照順序查，由上往下第一個命中的條件就停：

| 順序 | 需求（從需求文件、spec 或 repo 判定） | 選 |
| --- | --- | --- |
| 1 | 前端（瀏覽器）直連資料表或使用 Realtime，且授權靠 RLS policy（policy 用 `auth.uid()`） | Supabase Auth |
| 2 | 下列任一條成立：① 使用者以帳號密碼登入；② 需要第二因子（TOTP 等）；③ 有組織概念（多組織成員、邀請、組織內角色）；④ 需要可撤銷 session（管理端或使用者能讓單一或全部既有 session 立即失效） | better-auth |
| 3 | 前兩列（Supabase Auth、better-auth）都沒命中 | nuxt-auth-utils（預設） |

Supabase Auth 那列排在 better-auth 那列前面：better-auth 與 nuxt-auth-utils 都不簽發 Supabase JWT，RLS 的 `auth.uid()` 對它們恆為 null（§ Server 側：RLS policy 的前提條件 MUST 的「auth.uid() policy 要求 identity 來源是 Supabase Auth」那條、§ Auth 策略與資料路徑的合法組合），瀏覽器直連與 RLS 授權做不到。兩列同時命中時選 Supabase Auth。

沒有使用者身分的專案（`modules.auth: none`）不在本表裡：無 auth 不是 identity 來源的選項，資料路徑直接查 § 資料存取層選型。

選定之後，server 端資料路徑查 § 資料存取層選型 的順序表；決定更換 auth 策略的既有專案另照 § Server 側：RLS policy 的前提條件 MUST 的「auth.uid() policy 要求 identity 來源是 Supabase Auth」那條盤點 call sites。

### 推薦的依據

- **預設 nuxt-auth-utils**：依據是 fleet 正式專案的採用（2026-10 快照 5 家，重跑：`node scripts/audit-auth-data-path.ts --json` 各家 `drizzle.declaredAuth`）與 clade 主線的判斷，未另行實測。「預設」是可依實測結果更換的標記，不是定案。
- **better-auth**：可撤銷 session、組織、2FA（TOTP 與備援碼）在 nuxt-supabase-starter 以長駐 Node server ＋ Drizzle ＋ Supabase Postgres 實測，如預期（2026-10-13，報告在 clade `specs/plans/W-2026-10-13-data-access-layer-by-auth/evidence/2026-10-13-better-auth-experiment.md`）。下列項目沒有測過，不算已驗證：開啟 `session.cookieCache` 後的撤銷延遲、2FA 失敗鎖定、真實寄送邀請信、Cloudflare Workers 部署形態。
- **Supabase Auth**：依據是 fleet 正式專案的採用（2026-10 快照 1 家），未另行實測。

### 選 better-auth 的前提

1. **MUST** 明確設定 better-auth 的資料庫。公版預設沒有接資料庫，session 與帳號會退到記憶體，process 重啟就全部失效、多個 instance 之間也不共享。
2. better-auth 的**每一張**資料表 **MUST** 以 `supabase/migrations/` 下的 SQL 為準，從 better-auth 的 schema 手工轉寫；Drizzle schema 只是對照，不由 `drizzle-kit` 產正式變更（§ 資料存取層選型 四條條件中的「migration 歸 Supabase CLI」與「`drizzle-kit` 只做唯讀用途」）。

## 資料存取層選型

**適用範圍**：manifest `modules["db-schema"]` 以 `supabase` 開頭的**每一個** consumer（資料庫是 Supabase Postgres）。資料庫是 Cloudflare D1 的 consumer 讀 `rules/modules/db-schema/cf-d1/data-layer-d1.md`，本節的每一條都不套用到它。

選型看兩件事：部署 runtime 與 identity 來源。專案規模（表數、端點數、團隊人數）不是選型依據。照順序查，由上往下第一個命中的條件就停：

| 順序 | 條件（讀 manifest） | server 端預設資料路徑 | Drizzle 的定位 |
| --- | --- | --- | --- |
| 1 | `modules.runtime` 是 `cf-workers` | `supabase-js` 走 HTTP | 不使用。fleet 的 Workers 部署不直連 Postgres（不採用 Hyperdrive），本列不看 identity 來源 |
| 2 | `modules.auth` 是 `supabase-self-hosted`（Supabase Auth） | `supabase-js` ＋ RLS | 選用層：只用在跨表 transaction 與複雜報表查詢。Drizzle 的連線不經 RLS，用到它的**每一個** handler 都要自己以 `user.id` 夾住查詢條件 |
| 3 | `modules.auth` 是 `nuxt-auth-utils`、`better-auth` 或 `none` | Drizzle 可作預設 | 可作預設，四條條件要同時成立（見下） |

`supabase-self-hosted` 與 `nuxt-auth-utils`／`better-auth`／`none` 那兩列的前提是 server 以長駐 Node process 部署。同一個 repo 同時裝了 Supabase Auth 與另一套 auth 時，先依 § Server 側：RLS policy 的前提條件 MUST 的「auth.uid() policy 要求 identity 來源是 Supabase Auth」那條把 identity 來源收斂成一個，再回來查表。

### Drizzle 作預設的四條條件（`nuxt-auth-utils`／`better-auth`／`none` 那列，四條同時成立）

1. **單一連線池**：整個 server process 只在 `server/utils/drizzle.ts` 建立一個 client，**每一個** handler 與 service 都從那裡取用。
2. **授權在 handler 層**：依 § Server 側：RLS policy 的前提條件 MUST 的「identity 來源不是 Supabase Auth 時授權上移 handler 層」那條，RLS 是啟用加零 policy 的 deny-all。`modules.auth` 是 `none` 的 consumer 沒有使用者身分，這一條讀作：**每一個**端點是否公開由 handler 明確決定。
3. **migration 歸 Supabase CLI**：**每一筆** schema 變更都是 `supabase/migrations/` 下的 SQL 檔。
4. **`drizzle-kit` 只做唯讀用途**：`pull` 與 `studio` 可以用。schema 變更後以 `drizzle-kit pull` 更新 Drizzle 的 schema 定義。

### NEVER

**NEVER** 讓 `drizzle-kit generate`、`drizzle-kit push`、`drizzle-kit migrate` 出現在 `package.json` scripts 或 `.github/workflows/` 的任何一個檔。範圍是表內**每一列**：Drizzle 是選用層的 consumer 同樣受這條約束。

### 獨立 Backend Framework

Nitro 的 `/api/v1/*` 就是專案的後端；獨立 Backend Framework（NestJS、Hono 獨立服務、Go／Python 服務）不是預設。下列三條命中任一條，才值得評估拆出獨立服務，提案時寫明命中哪一條與對應紀錄的位置：

1. 有量測紀錄顯示單一背景工作的執行時間或記憶體超過部署 runtime 的上限，且 repo 內有紀錄顯示 Nitro tasks、`pg_cron`、queue 三者都承接不了。
2. repo 或合約文件記載有第二種非 web client（原生 App、第三方系統整合），且對外 API 需要與前端發版解耦的版本化契約。
3. 兩個以上各自獨立部署的前端共用同一份業務邏輯，且有紀錄說明無法以 Nuxt layer 或 workspace package 共用。

三條都沒命中時留在 Nitro。表數、端點數、「之後會變大」都不在這三條裡。

## 偵測

`scripts/audit-auth-data-path.ts` 偵測各 consumer 的 client-side Supabase table query 與 auth 策略對齊狀態。已接入 `convention-conformance-audit.ts`，`/clade-health live` 可檢測。

同一支 script 另對**每一家** consumer 輸出 Drizzle 訊號（`--json` 的 `drizzle` 物件與 `summary.drizzleKitViolations`、`summary.drizzleOnWorkers`）：

| 欄位 | 內容 |
| --- | --- |
| 觸發條件 | `status` 為 `VIOLATION`（§ 資料存取層選型 的 NEVER 命中）或 `WORKERS_RUNTIME`（查表命中 `cf-workers` 那列卻裝了 Drizzle）時，markdown 輸出列出該 consumer 與命中位置。只提示：結束碼不變，不擋 publish 與 propagate |
| 消費端 | 讀 `/clade-health live` 與 propagate 警告輸出的 clade 主線：這兩種 `status` 會讓該 consumer 的 `auth-data-path` 慣例顯示為 drift。讀到就跑本 script 的 markdown 輸出看命中位置，再 relay 給該 consumer 的 session 對齊 |
| 觸發點 | 本 script 的 markdown 輸出在上述兩種 `status` 出現時印本檔 § 資料存取層選型 的位置 |

`status` 的 identity 來源取自 `package.json` 裝了哪些 auth 套件，`declaredAuth` 是 manifest 的 `modules.auth`；兩者不一致時 `status` 為 `NEEDS_MANUAL_CONFIRM`。

這條訊號是靜態檢查：只讀 repo 根的 `package.json` scripts、根的 `server/` 與 `.github/workflows/`，`packages/*` 底下的 `package.json` 與 server 不在掃描範圍；也不檢查四條條件中的單一連線池與 handler 層授權。`summary.drizzleOnWorkers` 計入同時命中 NEVER 的 Workers consumer。

### Guard 覆蓋（handler 層授權有沒有真的掛上）

授權在 handler 層的 consumer（§ Server 側：RLS policy 的前提條件 MUST 的「授權上移 handler 層」那條），**宣告了 guard 不等於掛了 guard**：`requireRole`／`requirePermission` 寫在 `server/utils/`、卻沒有任何 handler 呼叫，實際授權只剩「有 session」。

- **每一支** `server/api/**` 的寫入 handler（`.post`／`.put`／`.patch`／`.delete`）**MUST** 呼叫 canonical guard；刻意公開的端點 **MUST** 列在 `SECURITY.md` 的未認證入口（[[security-policy]]）
- 新增或改寫 guard、以及 review 授權相關 PR 時，跑下面兩段指令；第一段有輸出、或第二段有 guard 呼叫數為 0，review 列 Major

```bash
# 1. 沒有呼叫任何 require* guard 的寫入 handler（逐檔對照 SECURITY.md 未認證入口）
rg --files -g '*.{post,put,patch,delete}.ts' server/api | xargs -r rg --files-without-match 'require[A-Z]\w*\('

# 2. 每支宣告的 guard 被多少個 handler 檔呼叫；0 = 宣告了沒人掛
for g in $(rg -oN --no-filename 'export (?:async )?(?:function|const) (require\w+)' -r '$1' server/utils | sort -u); do
  printf '%s %s\n' "$g" "$(rg -l "\b$g\(" server/api | wc -l)"
done
```

monorepo consumer 把 `server/` 換成 `packages/*/server/` 逐 package 跑。

## 相關規則

- [[rls-policy]]：RLS policy 撰寫規範（含 GRANT 驗證段）
- evlog 結構化 logging：`rules/modules/capabilities/evlog/evlog-adoption.md`（capability 模組，刻意不用 wikilink 以免在沒有 evlog 的 repo 變死鏈）
- Auth module variants：`rules/modules/auth/{supabase-self-hosted,better-auth,nuxt-auth-utils}/`
