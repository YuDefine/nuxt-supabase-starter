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
JWT staleness）在 rule `db-schema/supabase/rls-policy.md`，那是 paths-gated 規約，改
`supabase/migrations/**/*.sql` 時自動載入。

## 核心原則

### 使用 Helper 函式

建議建立 helper 函式取代直接查表：

```sql
-- ✅ 使用 helper
your_schema.current_user_role()
your_schema.current_user_id()

-- ❌ 直接查表（效能差）
SELECT role FROM your_schema.user_roles WHERE id = auth.uid()
```

### RLS 開啟原則

```sql
ALTER TABLE your_schema.new_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE your_schema.new_table FORCE ROW LEVEL SECURITY;
```

## 常見問題（自家專屬；通用陷阱見官方 skill）

| 症狀                     | 原因                                    | 解法                                                        |
| ------------------------ | --------------------------------------- | ----------------------------------------------------------- |
| 查詢回傳空陣列           | RLS 未開放讀取                          | 檢查 SELECT policy 與對應 `GRANT`（見 `rls-policy.md`）      |
| privileged 寫入被 RLS 擋 | 誤用 request-scoped user client         | 用專屬 factory 建 service_role client，見下方 § service_role |

## service_role：NEVER 寫進 policy

**NEVER** 在 policy 內加 `(SELECT auth.role()) = 'service_role'` 當 bypass 條件。`service_role`
本身具備 PostgreSQL `BYPASSRLS`，**無條件**略過所有 policy —— 這個條件對它沒有任何實際保護作用，
只會讓後續 agent 誤以為 privileged write path 由 policy 控制。

上游官方 skill 另有一條同向理由：Supabase 已 deprecate `auth.role()`，改用 policy 的 `TO` 子句
指定目標 role。

privileged 寫入的安全邊界靠 server-side isolation（service role key 不出 server、privileged
client 獨立 factory、API handler 明確權限檢查），完整規範見 rule `db-schema/supabase/rls-policy.md`
§ service_role 與 privileged client isolation。

## 參考資料

| 檔案                                               | 內容                   |
| -------------------------------------------------- | ---------------------- |
| [references/templates.md](references/templates.md) | Policy 模板 + 角色階層 |

## 檢查清單

- [ ] Policy 內**沒有** `service_role` bypass 條件（見上節）
- [ ] 使用 helper 函式而非直接查表
- [ ] INSERT/UPDATE/DELETE 都有對應 policy
- [ ] 同一支 migration 有對應的 `GRANT`（RLS 在 table privilege 之後才評估）
- [ ] `pnpm db:lint` 無警告
- [ ] 官方 `supabase` skill 的 Security checklist 走過一遍（views / SECURITY DEFINER / storage / JWT）
