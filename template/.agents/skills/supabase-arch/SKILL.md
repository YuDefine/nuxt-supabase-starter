---
name: supabase-arch
description: >-
  Supabase 架構決策指南。Use when planning new features, deciding
  between RPC vs Edge Function, choosing tech approaches, or
  asking architecture questions. Always use this skill for
  Supabase architecture decisions and technology routing.
---

# Supabase 架構決策指南

資料存取模式已定義在 AGENTS.md（Client 讀、Server 寫）。本 skill 提供架構決策指引。

## Schema 邊界

- **core / auth**: 授權相關（user_roles、allowed_emails、user_preferences、enum、函式）
- **app / 專案名稱**: 業務資料表
- **public**: 不存放業務資料；SDK 查詢使用 `client.schema('core')` 或 `client.schema('app')`

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

需要更詳細的決策指引？→ [references/decision-tree.md](references/decision-tree.md)

## 效能評估

- **High Concurrency (>100 req/s)**：讀取密集加 Redis/CDN 快取，寫入密集用 Message Queue
- **Standard**：遵循快速決策表

## 檢查清單

### 安全性

- [ ] RLS First：所有 Table 預設開啟 RLS
- [ ] Never Trust Client：前端資料在 DB/Edge 層驗證
- [ ] Service Role：僅在 Edge Function 或 RPC 內部使用

### 效能

- [ ] Filter/Join 欄位建立 Index
- [ ] 避免 `select('*')`，明確指定欄位
- [ ] 外部請求設定 Timeout
