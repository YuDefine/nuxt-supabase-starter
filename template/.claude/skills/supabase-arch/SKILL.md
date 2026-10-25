---
name: supabase-arch
description: >-
  Supabase 架構決策：RPC vs Edge Function 選型、新功能的技術路線取捨。NOT for 撰寫 migration SQL
  或 debug 既有 RLS policy，NOT for 前端狀態管理（走 pinia-store）。
---


# Supabase 架構決策指南

本 skill 只做架構選型：新功能該走 Server API、Postgres RPC、Edge Function、Trigger、pg_cron 或 Realtime。資料存取路徑（寫入走 Server API；client 直讀是否合法取決於 `modules.auth`）以 db-runtime 規約與 `server-api` skill 為準；migration SQL 交 `supabase-migration`，policy 內容交 `supabase-rls`。

# SOP

## Phase 1 -- 收斂需求特徵

1. READ 讀取功能需求，以及 consumer manifest（`.clade/manifest.json`）的 `modules.auth` 與 `modules.db-runtime`。
2. THINK 列出需求的特徵：是否呼叫第三方 API、是否接收外部 Webhook、是否處理檔案、是否碰金鑰、是否批次、是否跨表寫入、是否需要即時更新或排程。

## Phase 2 -- 判定技術路線

1. THINK 讀取 `rules/功能路由決策樹.md`，依 Phase 1 的特徵由上而下比對，第一個命中的分支即採用，並記下被跳過的較前分支與跳過理由。

## Phase 3 -- 輸出建議並做安全檢查

1. READ 讀取 `rules/Schema邊界與安全檢查判準.md`。
2. WRITE 輸出選定路線、命中的分支編號、schema 落點與已載入規則的逐條安全檢查結果；不符的項目寫成要修的設計點，不帶過。
