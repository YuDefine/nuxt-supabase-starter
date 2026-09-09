# starter: withAdminDrizzle 每請求開新連線 → 改單例連線池

建立：2026-09-06 23:05，由 CPMS session 派出。

## 問題

`template/server/utils/drizzle.ts` 的 `withAdminDrizzle()` 每次呼叫都
`postgres(url, { max: 1 })` 建新連線、用完 `end()`。

每個 API request 一條新連線（含 TLS handshake），加上背景 task，在中量並發下會撞
Postgres `max_connections`（Supabase 預設 100，且自身服務已吃掉一部分）。scaffold 出來的
專案在第一支交易型 API 上線前不會發現，發現時是 production 的 `too many connections`。

## 受影響檔（兩份同源副本，都要改）

- `template/server/utils/drizzle.ts`
- `template/packages/create-nuxt-starter/templates/features/database/server/utils/drizzle.ts`
- `template/test/unit/server/utils/drizzle.test.ts`（現行測試把「每次呼叫建新連線」鎖成契約，必須一併改寫）

## 參考實作（CPMS 已落地並驗過）

`~/offline/CPMS/server/utils/drizzle.ts` 與 `~/offline/CPMS/server/plugins/drizzle-pool.ts`，
測試在 `~/offline/CPMS/test/unit/drizzle-pool.test.ts`。要點：

1. module-level lazy 單例：`useAdminDrizzle()` 首次呼叫才建池，之後回同一個 instance。
2. 池參數：`max` 預設 10、可由 `DATABASE_POOL_MAX` 覆寫（非正整數時 **throw，不靜默 fallback**）；
   `idle_timeout: 30`、`connect_timeout: 10`；`prepare: false` 保留（Supavisor / PgBouncer
   transaction mode 不支援 prepared statements）。
3. `closeAdminDrizzle()` 供 Nitro `close` hook 與測試重建使用。
4. Nitro plugin 只掛 `close` hook 收池，**不在啟動時強制連線**——DB 暫時不可用不該讓 process 起不來。
5. 移除 `createAdminDrizzle` / `withAdminDrizzle`（starter 內無呼叫端；留著等於留一個 footgun）。
   若判斷需要向後相容，改為呼叫單例的 shim 並標 deprecated，**NEVER** 保留原本的每請求開池行為。

CPMS 端的驗收結果：`pnpm typecheck` exit 0、`pnpm lint` exit 0、5 支新單元測試通過。

## 驗收

- 兩份 template 的 drizzle.ts 都改完且內容一致
- 改寫後的 `drizzle.test.ts` 至少涵蓋：重複呼叫回同一 instance、預設 `max` > 1、
  `DATABASE_POOL_MAX` 生效、無效值 throw、缺 URL 時 throw
- 該 repo 自己的 lint / typecheck / test 全綠（先跑一次取 baseline 再比對，**NEVER** 拿
  repo-wide exit 0 當 gate 除非它現在就是 0）
- 用該 repo 既有的 formatter script 格式化，不要換別支

## Approved Tools

- 可讀寫：`~/offline/nuxt-supabase-starter` 內上列檔案，以及為完成本工作必須連帶調整的同 repo 檔
- 可讀（唯讀參考）：`~/offline/CPMS/server/utils/drizzle.ts`、`~/offline/CPMS/server/plugins/drizzle-pool.ts`、`~/offline/CPMS/test/unit/drizzle-pool.test.ts`
- 可跑：該 repo 的 lint / typecheck / test / format script
- 清單外一律回報，NEVER 自取。NEVER 讀或寫任何 `.env`。

## Scope 邊界

只修這個缺陷。途中發現的其他問題**登記不修**（該 repo 的 tech-debt / HANDOFF）。
Commit 走該 repo 既有規約，**NEVER** `git add -A`。

## 回報

以 `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED` 之一收尾，附實跑的驗收輸出。
