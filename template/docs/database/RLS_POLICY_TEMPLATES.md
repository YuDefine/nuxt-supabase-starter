---
audience: both
applies-to: post-scaffold
---

# RLS Policy 模板

> Row Level Security 政策撰寫規範，包含 `TO public` 陷阱、Helper 函式、Policy 模板與常見問題排查。

---

## TO public 陷阱（重要）

本專案使用 `nuxt-auth-utils` 進行認證，**不使用 Supabase Auth**。因此前端 `useSupabaseClient()` 的角色是 `anon`，不是 `authenticated`。

| Policy 目標        | 效果                                               |
| ------------------ | -------------------------------------------------- |
| `TO public`        | `anon` + `authenticated` + `service_role` 都可存取 |
| `TO authenticated` | 只有 `authenticated` 和 `service_role` 可存取      |

**關鍵**：前端直接查詢時，`TO authenticated` 的 SELECT policy 會**靜默回傳 0 筆**（不報錯），因為 `anon` 角色不在 `authenticated` 授權範圍內。

```sql
-- ❌ 前端直讀但用了 TO authenticated → 查詢回傳空陣列
CREATE POLICY "Read" ON app.your_table
FOR SELECT TO authenticated USING (true);

-- ✅ 前端直讀 → TO public
CREATE POLICY "Read" ON app.your_table
FOR SELECT TO public USING (true);
```

---

## Helper 函式

使用 `app` schema 的 helper 函式，效能優於直接查表：

| 函式                             | 用途                     |
| -------------------------------- | ------------------------ |
| `app.current_user_role()`        | 取得當前使用者角色       |
| `app.current_user_id()`          | 取得當前使用者 ID        |
| `app.can_manage_user(target_id)` | 檢查是否可管理目標使用者 |
| `app.can_authorize_role(role)`   | 檢查是否可授權該角色     |

---

## Policy 模板

### 讀取（SELECT）— 前端直讀

```sql
CREATE POLICY "Public can read" ON app.your_table
FOR SELECT TO public USING (true);
```

### 讀取（SELECT）— 僅 Server API

```sql
CREATE POLICY "Authenticated can read" ON app.your_table
FOR SELECT USING (
  (SELECT auth.role()) = 'service_role'
  OR (SELECT auth.role()) = 'authenticated'
);
```

### 寫入（INSERT / UPDATE / DELETE）

所有寫入 policy **必須**包含 `service_role` bypass，否則 Server API 的寫入操作會靜默失敗。

```sql
CREATE POLICY "Editor can insert" ON app.your_table
FOR INSERT WITH CHECK (
  (SELECT auth.role()) = 'service_role'
  OR app.current_user_role() IN ('admin', 'editor')
);

CREATE POLICY "Editor can update" ON app.your_table
FOR UPDATE USING (
  (SELECT auth.role()) = 'service_role'
  OR app.current_user_role() IN ('admin', 'editor')
);

CREATE POLICY "Editor can delete" ON app.your_table
FOR DELETE USING (
  (SELECT auth.role()) = 'service_role'
  OR app.current_user_role() IN ('admin', 'editor')
);
```

### 僅限 Admin

```sql
CREATE POLICY "Admin only" ON app.sensitive_table
FOR ALL USING (
  (SELECT auth.role()) = 'service_role'
  OR app.current_user_role() = 'admin'
);
```

---

## 新建表必做

```sql
ALTER TABLE app.new_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.new_table FORCE ROW LEVEL SECURITY;
```

`ENABLE` 啟用 RLS，`FORCE` 確保 table owner 也受 RLS 約束。兩者都必須設定。

---

## 常見問題排查

| 症狀                            | 原因                                   | 解法                                            |
| ------------------------------- | -------------------------------------- | ----------------------------------------------- |
| Toast 顯示成功但資料沒變        | 寫入 policy 缺少 `service_role` bypass | 加上 `(SELECT auth.role()) = 'service_role'`    |
| 前端查詢回傳空陣列              | SELECT policy 用了 `TO authenticated`  | 改為 `TO public`，或改用 `$fetch` 走 Server API |
| Server API 寫入成功但無回傳資料 | `.select()` 的讀取也受 RLS 限制        | 確認 SELECT policy 允許 `service_role`          |

---

## 檢查清單

新增或修改 RLS policy 時，逐項確認：

- [ ] 寫入 policy 包含 `(SELECT auth.role()) = 'service_role'` bypass
- [ ] 使用 `app.current_user_role()` 而非直接查表
- [ ] 前端直讀的表 SELECT policy 用 `TO public`
- [ ] INSERT / UPDATE / DELETE 都有對應 policy
- [ ] `supabase db lint --level warning` 無警告
