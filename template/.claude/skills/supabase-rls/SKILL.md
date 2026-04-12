---
name: supabase-rls
description: >-
  Supabase RLS 政策規範。Use when creating or modifying RLS policies
  (CREATE POLICY, ALTER POLICY), setting up Row Level Security,
  or working with database access control. Always use this skill
  for RLS design, policy templates, and role-based access patterns.
---

# Supabase RLS 政策規範

`service_role` 繞過規則已定義在 CLAUDE.md。本 skill 提供完整 RLS 實作指引。

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

## 常見問題

| 症狀                          | 原因                                 | 解法                                                     |
| ----------------------------- | ------------------------------------ | -------------------------------------------------------- |
| Toast 成功但資料沒變          | 缺少 `service_role` 繞過             | 加上 `(SELECT auth.role()) = 'service_role'`             |
| 查詢回傳空陣列                | RLS 未開放讀取                       | 檢查 SELECT policy                                       |
| UPDATE 回傳 0 rows 無報錯     | UPDATE 需要搭配 SELECT policy        | 補上對應的 SELECT policy（Postgres RLS 限制）            |
| Storage upsert 靜默失敗       | 只有 INSERT policy，缺 SELECT/UPDATE | Storage upsert 需要 INSERT + SELECT + UPDATE 三個 policy |
| RLS policy 用 `user_metadata` | `user_metadata` 使用者可自行修改     | 改用 `app_metadata`（`raw_app_meta_data`）               |
| 刪除 user 後仍能存取          | JWT 未失效                           | 先 revoke sessions，縮短 JWT expiry                      |

## 參考資料

| 檔案                                               | 內容                   |
| -------------------------------------------------- | ---------------------- |
| [references/templates.md](references/templates.md) | Policy 模板 + 角色階層 |

## 檢查清單

- [ ] 包含 `(SELECT auth.role()) = 'service_role'` 繞過
- [ ] 使用 helper 函式而非直接查表
- [ ] INSERT/UPDATE/DELETE 都有對應 policy
- [ ] **有 UPDATE policy 的表必須同時有 SELECT policy**（否則 UPDATE 靜默失敗）
- [ ] **Storage bucket 的 upsert 場景需 INSERT + SELECT + UPDATE 三個 policy**
- [ ] Policy 中 **NEVER** 使用 `user_metadata` / `raw_user_meta_data` 做授權判斷
- [ ] `supabase db lint --level warning` 無警告
