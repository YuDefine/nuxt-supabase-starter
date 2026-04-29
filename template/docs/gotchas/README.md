---
audience: both
applies-to: post-scaffold
---

# Gotchas

開發過程中踩過的坑與解決方案。這些是實際遇到的問題，不是假設性的風險。

## 索引

| 文件                                                  | 問題摘要                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [CF_WORKERS_BODY_STREAM](./CF_WORKERS_BODY_STREAM.md) | Cloudflare Workers request body stream 只能讀一次，middleware 讀過後 handler 會 hang |
| [CF_WORKERS_SUBREQUEST](./CF_WORKERS_SUBREQUEST.md)   | Cloudflare Workers 限制 subrequest 數量，for-loop 逐一操作會超限                     |
| [PINIA_COLADA_TIMING](./PINIA_COLADA_TIMING.md)       | Mutation 的 cache invalidation 在額外 API 呼叫完成前就觸發                           |
| [USEQUERY_ENABLED_GUARD](./USEQUERY_ENABLED_GUARD.md) | useQuery 在元件 setup 時立即執行，缺少 enabled 守衛會送出無效請求                    |
| [API_RESPONSE_OMISSION](./API_RESPONSE_OMISSION.md)   | API response 手動 .map() 遺漏欄位，靜默顯示空白無報錯                                |

## 文件格式

每份 gotcha 文件遵循統一結構：

- **Problem** — 發生了什麼，有哪些症狀
- **Root Cause** — 為什麼會發生
- **What Didn't Work** — 嘗試過但無效的排查方向（幫助未來避免走冤枉路）
- **Solution** — 具體的修復方式與程式碼範例
- **Prevention** — 如何在 code review 或開發時預防

## 新增 Gotcha

遇到符合以下條件的問題時，新增一份 gotcha 文件：

1. 除錯過程嘗試了 3 種以上方法
2. 問題的根因不直覺（症狀與根因差距大）
3. 其他開發者很可能也會踩到
