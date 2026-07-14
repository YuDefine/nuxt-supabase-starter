---
description: Auth 策略與資料存取路徑一致性——防止混合 auth 狀態導致 silent 權限降級
paths: ['app/**/*.ts', 'app/**/*.vue', 'supabase/migrations/**/*.sql', 'server/api/**/*.ts']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/auth-data-path-consistency.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Auth–Data Path 一致性

## 核心命題

瀏覽器的 Supabase client（`useSupabaseClient()`）向 PostgREST 發 request 時，身分來自 **Supabase Auth 的 JWT**，不來自應用程式自己的 Cookie Session。若應用程式已移除或未使用 Supabase Auth（改用 `nuxt-auth-utils`、Better Auth 等），瀏覽器的 Supabase client **永遠以 `anon` role 存取**，無論使用者是否已登入。

此規則防止「session 層已換、但 client 端仍直連 PostgREST」的混合狀態——<consumer-b> 2026-07-14 production 401 事故的根因。

## Trigger

- 更換或移除 auth 策略（Supabase Auth → nuxt-auth-utils / Better Auth，或反向）
- 新增 client-side `useSupabaseClient().from('table')` 直連查詢
- 新增 migration 含 RLS policy（`CREATE POLICY ... TO authenticated`）
- 新增 table 並決定 client 端存取方式

## MUST

1. **換 auth 策略時全面 audit call sites**——列舉全部 `useSupabaseClient()` 在 `app/` 的使用點，逐一歸類：
   - 改走 server API（`$fetch` / `useFetch`）
   - 確認為純 Storage（`supabase.storage.from()`）——Storage 有獨立 bucket policy，不受此規則約束
   - 確認仍有 Supabase Auth JWT 支撐（identity 來源未變）
2. **Migration 建 RLS policy 時同時驗證 GRANT**——PostgreSQL 先查 table-level privilege 再評估 RLS policy。只建 `TO authenticated` policy 但沒有 `GRANT SELECT ON <table> TO authenticated`，結果是 `42501`（permission denied），RLS policy 完全不被評估。Migration 內 **MUST** 顯式 GRANT 或註明 table 已有既存 GRANT。
3. **新增繞過 server 的資料路徑時標註 evlog 盲區**——client-side PostgREST 直連不經 Nitro，evlog middleware 看不到。新增此類路徑 **MUST** 在 PR description 標註「此路徑在 evlog 觀測範圍外」。

## NEVER

1. **NEVER** 用 `GRANT ... TO anon` 修 401——等於把資料公開給任何持有 publishable key 的人。401 的正解是修身分鏈，不是放寬權限。
2. **NEVER** 留「session 層用 Cookie，但 DB policy 假設 Supabase JWT 存在」的混合狀態——瀏覽器不會因為帶著 Cookie Session 就自動變成 `authenticated` role。
3. **NEVER** 為了取得 `authenticated` role 而自行簽 PostgREST JWT——同時維護 Cookie Session + JWT 兩套 session lifecycle（rotation、logout、角色同步）的複雜度通常比完整採用 Supabase Auth 更差。

## Auth 策略與資料路徑的合法組合

| Auth 策略 | Client 直連 table | Client 直連 Storage | Server API (service_role) |
| --- | --- | --- | --- |
| Supabase Auth（JWT 存在） | ✅ 需正確 GRANT + RLS | ✅ Bucket policy | ✅ |
| nuxt-auth-utils / Better Auth（無 JWT） | ❌ 永遠 anon | ✅ Bucket policy 獨立 | ✅ |
| 無 auth | ❌ | ⚠️ 只限公開 bucket | ✅ |

## 偵測

`scripts/audit-auth-data-path.mjs` 偵測各 consumer 的 client-side Supabase table query 與 auth 策略對齊狀態。已接入 `convention-conformance-audit.mjs`，`/clade-health live` 可檢測。

## 相關規則

- [[rls-policy]]：RLS policy 撰寫規範（含 GRANT 驗證段）
- [[evlog-adoption]]：evlog 結構化 logging
- Auth module variants：`rules/modules/auth/{supabase-self-hosted,better-auth,nuxt-auth-utils}/`
