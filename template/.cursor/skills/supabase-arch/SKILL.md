---
name: supabase-arch
description: >-
  Supabase 架構決策：RPC vs Edge Function 選型、新功能的技術路線取捨。NOT for 撰寫 migration SQL
  或 debug 既有 RLS policy，NOT for 前端狀態管理（走 pinia-store）。
---

<!-- clade-skill-scope: project -->

# Supabase 架構決策指南

資料存取路徑（寫入走 Server API；client 直讀是否合法取決於 `modules.auth`）以 db-runtime 規約與 `server-api` skill 為準，本 skill 只做架構選型。

## Schema 邊界

- **core / auth**: 授權相關（user_roles、allowed_emails、user_preferences、enum、函式）
- **app / 專案名稱**: 業務資料表
- **public**: 不存放業務資料；SDK 查詢使用 `client.schema('core')` 或 `client.schema('app')`

## 快速決策表

| 場景                 | 方案                        |
| -------------------- | --------------------------- |
| 簡單 CRUD            | Server API（client 直讀依 `modules.auth`） |
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

需要更詳細的決策指引？→ [references/decision-tree.md](references/decision-tree.md)

## 檢查清單

### 安全性

- [ ] RLS First：所有 Table 預設開啟 RLS
- [ ] Never Trust Client：前端資料在 DB/Edge 層驗證
- [ ] Service Role：僅在 Edge Function 或 RPC 內部使用
