---
name: supabase-rls
description: >-
  Supabase RLS 政策規範：CREATE POLICY / ALTER POLICY、Row Level Security、角色存取控制。NOT for schema DDL 與 migration 檔規範（走 supabase-migration）；policy 寫在 migration 檔裡時，內容設計仍走本 skill。
---


# Supabase RLS 政策規範

本 skill 只寫**自家慣例**。Supabase 官方 `supabase` skill（`supabase/agent-skills@supabase`）
已涵蓋的通用 RLS 陷阱不在此重複：UPDATE 需搭配 SELECT policy、Storage upsert 需
INSERT + SELECT + UPDATE 三個 policy、`user_metadata` 不可用於授權判斷、刪除 user 不會
使既有 access token 失效、view 預設繞過 RLS、`SECURITY DEFINER` 繞過 RLS、`TO authenticated`
只是認證不是授權。**遇到上述主題 MUST 讀官方 skill，本檔不是它的替代品。**

自家的 policy 撰寫規範（GRANT 先於 RLS、`AS RESTRICTIVE` 疊加、`FORCE ROW LEVEL SECURITY`、
JWT staleness、service_role isolation）在 rule `db-schema/supabase/rls-policy.md`，那是 paths-gated 規約，改
`supabase/migrations/**/*.sql` 時自動載入。

# SOP

## Phase 1 -- 界定 policy 需求與分工

1. READ 讀取目標表、會讀寫它的角色、每個 operation（SELECT／INSERT／UPDATE／DELETE）的存取需求，以及這張表由 client 直讀還是只由 server 讀；需求碰到上方導言列的通用陷阱時，讀取官方 `supabase` skill 對應段落。
2. READ 讀取 module rule `db-schema/supabase/rls-policy.md`（改 `supabase/migrations/**/*.sql` 時已自動載入就不重讀）。

## Phase 2 -- 撰寫 policy

1. READ 讀取 `rules/Policy自家慣例判準.md`。
2. WRITE 讀取 `templates/rls-policies.md` 與 `templates/rls-policies.example.md`，在同一支 migration 中寫 ENABLE（FORCE 依 `rls-policy.md` 的條件）、GRANT 與每個 operation 的 policy。

## Phase 3 -- 驗證

1. DELEGATE 跑 `pnpm db:lint`，輸出非空就修正後重跑。
2. READ 走一遍官方 `supabase` skill 的 Security checklist（views／SECURITY DEFINER／storage／JWT），再逐條對照已載入規則；不符就回 Phase 2 修正。
