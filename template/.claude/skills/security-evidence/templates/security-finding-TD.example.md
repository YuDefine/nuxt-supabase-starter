<!-- 虛構範例：承接 finding-evidence-review.example.md 那則 IDOR -->

## TD-412 — GET /api/orders/:id 未檢查訂單擁有者

**Class**: security
**Status**: open
**Priority**: P1
**Discovered**: 2026-10-05 — security-scan full .security-scan/2026-10-05，security-evidence finding verdict=needs more validation
**Owner**: Owner Missing
**Location**: `src/server/api/orders/[id].get.ts:14`

### 要做什麼

handler 取出訂單後比對 `order.user_id` 與 session 使用者，不符回 404；查詢改用使用者 client 讓 RLS 生效。

### 自驗

- Proof Gap：production 是否對外暴露 `/api/orders/*` → 請 owner 截圖 gateway route 清單（遮掉 token）
- 通過條件：staging 以帳號 B 請求帳號 A 的訂單回 404
- 修完：node $CLADE_HOME/scripts/security-scan.ts verify --finding F-3
