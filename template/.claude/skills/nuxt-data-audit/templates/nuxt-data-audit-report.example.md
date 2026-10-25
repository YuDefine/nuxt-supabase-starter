
# nuxt-data-audit 單一 consumer 報告（範例：Colada＋useFetch 混用的 SPA consumer）

```markdown
## nuxt-data-audit report: order-hub

Grade: C
Stack: Pinia Colada 1.3.1 + useFetch (mixed), ssr: false
Reference rule: rules/core/nuxt-data-perf.md 已讀

| # | Check | Score | Detail |
|---|-------|-------|--------|
| E1 | setup 無裸 $fetch | ✅ pass | 12 處 $fetch 皆在事件 handler |
| E2 | custom composable useFetch key | ✅ pass | 3/3 composable 有明確 key |
| E3 | 重複請求處理 | ❌ fail | app/pages/orders.vue:18、app/pages/customers.vue:22 搜尋框加 dedupe:'defer' |
| E4 | reference data cache | ✅ pass | 部門／狀態選項 staleTime 5 分鐘 |
| E5 | 大 payload pick／transform | ⚠️ partial | /api/orders 列表回整列含 history，頁面只用 4 欄 |
| E6 | Lazy／hydration strategy | N/A | ssr: false，hydration strategy 不適用；無 Lazy 原子元件 |
| E7 | routeRules performance | N/A | 只有登入後私人 routes |
| E8 | NuxtImg | N/A | 未安裝 @nuxt/image |
| E9 | Colada key factory | ❌ fail | 7 個 magic string key（app/queries/order.ts:12 等） |
| E10 | useMutation invalidation | ✅ pass | 5/5 mutation onSettled invalidate 對應 key |
| E11 | 跨 request state 污染 | N/A | ssr: false，server 不執行 client state |
| E12 | error handling | ⚠️ partial | 9/21 呼叫消費 error |
| E13 | Promise.all | ✅ pass | dashboard 平行載入 3 個 query |
| E14 | watch／immediate | ✅ pass | 報表頁 immediate:false＋手動 execute 符合需求 |
| E15 | Nitro 快取認證邊界 | N/A | server/ 無 cached handler |
| E15-performance | edge cache driver | N/A | 同上 |
| E16 | 字型 weight | ✅ pass | @fontsource/noto-sans-tc/{400,700}.css |
| E17 | routeRules 渲染模式 | N/A | SPA consumer |
| E18 | 取消訊號貫通 | ✅ pass | 14 個 query fn 皆傳 signal，interceptor 合併不覆寫 |
| E19 | 非冪等寫入防重 | ✅ pass | 送出按鈕 loading-disabled＋server idempotency key |

### Grade 依據
HR：E1、E4、E10、E18、E19 pass（5 個），E3、E9 fail → C（至少 3 個 HR pass 且有 HR fail）。

### Top 3 Improvements
1. **E3 重複請求** — 2 個搜尋框誤加 dedupe:'defer'（回傳舊關鍵字） [app/pages/orders.vue:18, app/pages/customers.vue:22]
2. **E9 key factory** — 7 個 magic string key 遷到 orderKeys／customerKeys factory [app/queries/order.ts:12, …]
3. **E5 pick／transform** — 訂單列表改 server 端選欄位 [server/api/orders.get.ts:9]
```
