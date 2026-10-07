<!-- 改寫來源：Codex Security Bridge Kit Prompt 1（Finding Evidence Explainer）；改寫前的逐字版在 `git show bf08778b5c:capabilities/core/skills/security-evidence/references/finding-evidence-explainer.md`，對照上游新版時從那份 diff -->
<!-- 虛構範例：某 Nuxt＋Supabase 訂單系統的一則 IDOR finding -->

## Finding 證據審查：GET /api/orders/:id 未檢查訂單擁有者

### 白話摘要

- 攻擊者：任何一個有帳號、已登入的一般使用者
- 他做了什麼：把網址裡的訂單編號換成別人的編號
- 系統哪裡做錯：伺服器只確認「有登入」，沒確認「這張單是你的」
- 具體後果：可以看到其他客戶的收件姓名、地址、電話與購買品項

### 前提條件

- 需要的存取：一般會員帳號（註冊即得）
- 需要的狀態或時機：知道或猜到他人訂單 id；id 為遞增整數，可枚舉
- 限制攻擊的因素：若 production gateway 只對內網開放 `/api/orders/*`，外部攻擊者無法到達（尚未證實）

### 攻擊路徑

1. Source：`GET /api/orders/:id` 的 `id` 路由參數
2. 跨越的邊界：從「自己的資料」跨到「其他使用者的資料」
3. 預期的 Control：handler 比對 `order.user_id === session.user.id`
4. Control 如何失效：`src/server/api/orders/[id].get.ts:14` 只呼叫 `requireUserSession()`，沒有擁有者比對
5. 抵達的 Sink：第 18 行以 service role client 查 `orders` 整列，RLS 被繞過
6. 影響：跨帳號讀取個資

### 證據帳

| 證據 | 狀態 | 位置或出處 | 證明了什麼 |
| --- | --- | --- | --- |
| handler 只檢查登入 | Independently Verified | `src/server/api/orders/[id].get.ts:14` | 沒有擁有者比對 |
| 查詢使用 service role client | Independently Verified | `src/server/api/orders/[id].get.ts:18`、`server/utils/supabase.ts:6` | RLS 不會介入 |
| id 為遞增整數 | Independently Verified | `supabase/migrations/20260801_orders.sql:3` | 可枚舉 |
| 路由只開內網 | User-Confirmed | 使用者 2026-10-05 口述，未附設定 | 若屬實，攻擊者需內網位置 |

### 既有控制與反證

- `orders_owner_select` RLS policy：handler 用 service role 繞過，對本路徑無效，不構成反證
- 使用者說路由只開內網：若屬實會大幅縮小攻擊面，是目前最強的反證，但沒有設定證據

### Severity 與 Confidence

- Severity：High
- Severity 理由：成立時任何會員可讀全部客戶個資，影響範圍為全表
- Confidence：Medium
- Confidence 理由：code 路徑全段自己查證；唯一未證實的是 production 路由暴露範圍

### Coverage

- 已審查：`[id].get.ts` 與其直接 callee `server/utils/supabase.ts`、`orders` migration
- 排除或無法取得：`PATCH /api/orders/:id`（另一則 finding）、前端頁面
- 未驗證的 production 專屬控制：gateway route 暴露設定

### Proof Gaps

- Gap：production 是否對外暴露 `/api/orders/*`
  - 為什麼重要：決定攻擊者是否需要內網位置，可能把結論從 accept 拉成 unsupported
  - 需要的證據：gateway 的 route 設定截圖
  - 安全的取得方式：請 owner 截圖 route 清單並遮掉 token；不從外部發請求測試

### Verdict

- Verdict：needs more validation
- 理由：code 路徑成立，但 production 暴露範圍與使用者說法衝突，且有一個可決定結論的 Gap
- 這個 verdict 不能證明什麼：不代表其他 `/api/*` 路由都有擁有者檢查；也不代表修掉這支後就沒有 IDOR

### 下一步驗證

1. 請 owner 提供 production gateway 的 `/api/orders/*` route 暴露設定截圖（遮掉 token）
