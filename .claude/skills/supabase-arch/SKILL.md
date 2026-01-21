# Supabase 架構決策指南

當規劃新功能、決定技術方案、或詢問「該用 RPC 還是 Edge Function」時，自動載入此規範。

---

## Schema 邊界建議

- **`core` 或 `auth`**: 授權相關物件（`user_roles`、`allowed_emails`、`user_preferences`、enum、函式）
- **`app` 或專案名稱**: 業務資料表
- **`public`**: 不存放業務資料；SDK 查詢使用 `client.schema('core')` 或 `client.schema('app')`

---

## 功能路由決策樹

依照由上而下的順序檢查需求，一旦符合條件即採用該方案。

### 1. 外部整合 (External Integration)

**IF** 需要整合第三方 API **AND** 需要寫入資料庫：

- **Action**: Hybrid 模式（Edge Function 協調 → RPC 寫入）
- **Constraint**: 必須實作冪等性與錯誤補償

**IF** 僅整合第三方 API（發送 Email、呼叫 OpenAI）：

- **Action**: Edge Function
- **Constraint**: 設定合理的 Timeout 與 Retry

### 2. Webhook 處理

**IF** 接收外部 Webhook：

- **Action**: Edge Function
- **Security**: 驗證簽名 → 快速回傳 200 OK → 非同步處理

### 3. 檔案操作

**IF** 涉及檔案處理（壓縮、轉檔、浮水印）：

- **Action**: Edge Function（採用 Stream 串流處理）

**IF** 單純上傳/下載：

- **Action**: Client SDK 直連 Storage
- **Security**: 嚴格設定 Storage Bucket RLS

### 4. 敏感資料

**IF** 操作涉及敏感金鑰（API Keys、Secrets）：

- **Action**: Edge Function（從環境變數讀取）
- **Security**: 嚴禁在前端暴露任何 Secret Key

### 5. 批次處理

**IF** 資料源來自資料庫內部（每日結算）：

- **Action**: Postgres RPC

**IF** 資料源來自外部匯入（CSV Import）：

- **Action**: Edge Function（分批寫入）

### 6. 交易一致性

**IF** 需要跨多張表寫入（Atomic Operations）：

- **Action**: Postgres RPC
- **Logic**: 使用 SQL `BEGIN ... COMMIT`

### 7. 資料連動

**IF** 寫入後需自動觸發簡單欄位更新（`updated_at`、計算總數）：

- **Action**: Database Trigger
- **Warning**: 避免 Trigger 呼叫 Trigger（Cascade）

### 8. 複雜統計

**IF** 涉及大量數據聚合（Sum、Count、Avg over large tables）：

- **Action**: Materialized View 或 RPC
- **Optimization**: 配合 `pg_cron` 定期刷新

### 9. 權限繞過

**IF** 業務邏輯必須繞過 RLS（Admin Dashboard 統計）：

- **Action**: RPC (Security Definer)
- **Security**: 必須在 SQL 函數內部手動執行權限檢查

### 10. 複雜查詢

**IF** 動態參數 JOIN / 遞迴查詢 (CTE)：

- **Action**: RPC

**IF** 固定的複雜關聯表：

- **Action**: 建立 View，前端透過 SDK 查詢

**IF** 單純過濾/全文檢索：

- **Action**: Client SDK（`.ilike()`、`.textSearch()`）

### 11. 標準 CRUD & Realtime

**IF** 需要即時更新（Chat、Notifications）：

- **Action**: SDK + Realtime Channel

**IF** 標準增刪改查：

- **Action**: Client SDK
- **Constraint**: 必須依賴 RLS 保護資料

### 12. 排程任務

**IF** 資料庫內部維護（清理 Logs、刷新 View）：

- **Action**: pg_cron

**IF** 觸發外部業務邏輯：

- **Action**: Edge Function（透過 Cron 觸發）

---

## 效能評估

在開始任何功能實作前，先評估預期流量：

### High Concurrency (>100 req/s)

- **讀取密集**: 必須在 Infra 層加入 Redis 或 CDN 快取
- **寫入密集**: 必須使用 Message Queue 進行削峰填谷

### Standard

遵循上方的功能路由決策

---

## 實作檢核清單

### 安全性

- [ ] **RLS First**: 所有 Table 預設必須開啟 RLS
- [ ] **Never Trust Client**: 前端傳來的資料必須在 DB 層或 Edge 層驗證
- [ ] **Service Role**: 僅在 Edge Function 或 RPC 內部必要時使用

### 效能

- [ ] **Index**: 用於 Filter 或 Join 的欄位必須建立 Index
- [ ] **Select Specific**: SDK 查詢時避免使用 `select('*')`，應明確指定欄位
- [ ] **Timeout**: 所有外部請求都必須設定 Timeout

### 可維護性

- [ ] **Comments**: 複雜的 SQL 或 Edge Function 邏輯必須包含註解
- [ ] **Types**: 前端與 Edge Function 必須全面使用 TypeScript

---

## 快速決策表

| 場景                 | 方案                        |
| -------------------- | --------------------------- |
| 簡單 CRUD            | Client SDK + RLS            |
| 跨表交易             | Postgres RPC                |
| 第三方 API           | Edge Function               |
| Webhook              | Edge Function               |
| 排程任務（DB 內部）  | pg_cron                     |
| 排程任務（外部邏輯） | Edge Function + Cron        |
| 即時更新             | SDK + Realtime              |
| 複雜統計             | Materialized View + pg_cron |
| 權限繞過             | RPC (Security Definer)      |
| 檔案處理             | Edge Function (Stream)      |
| 敏感金鑰             | Edge Function (環境變數)    |

---

## 推薦架構：讀 Client，寫 Server

建議採用「讀 Client，寫 Server」策略：

- **Client 端**：可直接使用 `useSupabaseClient` 執行 `.select()` 查詢
- **Server 端**：所有 `.insert()` / `.update()` / `.delete()` 必須走 Server API

這樣設計的原因：

1. RLS 已完善，讀取操作受到保護
2. 讀多寫少，直連減少延遲
3. 寫入集中管理，便於權限檢查、日誌記錄、業務邏輯
