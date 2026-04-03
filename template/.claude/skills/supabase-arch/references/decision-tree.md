# 功能路由決策樹

依照由上而下順序檢查，符合即採用。

## 1. 外部整合

**IF** 整合第三方 API + 寫入 DB → Hybrid（Edge Function 協調 → RPC 寫入），實作冪等性
**IF** 僅整合第三方 API → Edge Function，設定 Timeout/Retry

## 2. Webhook 處理

**IF** 接收外部 Webhook → Edge Function，驗證簽名 → 200 OK → 非同步處理

## 3. 檔案操作

**IF** 檔案處理（壓縮、轉檔） → Edge Function (Stream)
**IF** 單純上傳/下載 → Client SDK 直連 Storage + Bucket RLS

## 4. 敏感資料

**IF** 操作涉及 API Keys/Secrets → Edge Function（環境變數）

## 5. 批次處理

**IF** 資料源在 DB 內（每日結算） → Postgres RPC
**IF** 外部匯入（CSV） → Edge Function（分批寫入）

## 6. 交易一致性

**IF** 跨多張表寫入 → Postgres RPC（BEGIN...COMMIT）

## 7. 資料連動

**IF** 寫入後觸發欄位更新（updated_at、計數） → Database Trigger，避免 cascade

## 8. 複雜統計

**IF** 大量數據聚合 → Materialized View 或 RPC + pg_cron 定期刷新

## 9. 權限繞過

**IF** 繞過 RLS（Admin 統計） → RPC (Security Definer)，內部手動權限檢查

## 10. 複雜查詢

**IF** 動態 JOIN / CTE → RPC
**IF** 固定複雜關聯 → View + SDK 查詢
**IF** 過濾/全文檢索 → Client SDK（ilike、textSearch）

## 11. 標準 CRUD & Realtime

**IF** 即時更新 → SDK + Realtime Channel
**IF** 標準 CRUD → Client SDK + RLS

## 12. 排程任務

**IF** DB 維護 → pg_cron
**IF** 外部邏輯 → Edge Function + Cron
