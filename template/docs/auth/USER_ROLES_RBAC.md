# 使用者角色與授權作業手冊

此文件統整專案的認證/授權模型：資料表、函式、API、日常維運與疑難排解。所有角色/偏好相關物件均位於 `app` schema。

---

## 1. 資料模型

| 表/函式                                | 說明                                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `app.allowed_emails`                   | 白名單，決定誰可以登入、預設角色、顯示名稱、部門。Email 會先經 `app.normalize_email()`（trim + lower），必須唯一。               |
| `app.user_roles`                       | 單一來源的角色資訊，`id` 永遠等於 `auth.users.sub`。欄位含 `role`, `display_name`, `department`, `authorized_at`, `authorized_by`。 |
| `app.user_preferences`                 | 以 `auth.users.sub` 為 PK，觸發器會在 auth UUID 改變時自動搬移。                                                                |
| `app.apply_user_authorization()`       | 依白名單、現有記錄、Google metadata 決定最終角色並 upsert `app.user_roles`。                                                     |
| `app.sync_user_info_from_auth()`       | 掛在 `auth.users` insert/update：呼叫 `app.apply_user_authorization()`，必要時把舊 `app.user_preferences.user_id` 更新為新 UUID。 |
| `app.get_manageable_users()` 等 helper | 提供 API 查詢用的資料表函式，並內建 RLS 權限判斷。                                                                               |

### 角色階層

```
admin   → 可以管理所有人
editor  → 可以管理 viewer / pending
viewer  → 僅能管理自己
pending → 登入但未授權
```

### Email 白名單

`app.allowed_emails` 表作為登入許可的閘道，決定誰可以進入系統：

| 欄位           | 說明                                                     |
| -------------- | -------------------------------------------------------- |
| `email`        | 經 `app.normalize_email()` 標準化（trim + lower），唯一 |
| `default_role` | `app.user_role` enum，預設 `viewer`，首次登入時套用      |
| `reason/notes` | 紀錄加入白名單原因或其他備註                             |
| `added_by`     | 追蹤操作者，引用 `auth.users.id`                         |

自動化機制：

- `trg_allowed_emails_set_updated_at` 會自動更新 `updated_at`
- `app.apply_user_authorization()` 讀取 `app.allowed_emails.default_role`，自動 upsert `app.user_roles`
- RLS 僅允許 admin／editor 維護白名單

---

## 2. 流程描述

### 登入 + 角色授權流程

1. 使用者透過 Google OAuth 登入，Supabase 產生 `auth.users` 記錄（或更新 email）。
2. `app.sync_user_info_from_auth()` 觸發：
   - 正規化 email，尋找同 email 的 `app.user_roles` 舊資料。
   - 呼叫 `app.apply_user_authorization()` → 判斷預設角色：
     - 若 `app.allowed_emails` 有 `default_role` → 套用。
     - 若 `app.user_roles` 已存在且管理員手動調整過 → 以既有角色為最高優先。
   - 若 `app.user_roles.id` 與新 auth UUID 不同，會更新為新 UUID，並搬移 `app.user_preferences.user_id`。
   - `app.get_or_create_user_preferences(NEW.sub)` 確保偏好存在。
3. Nuxt middleware `auth.global.ts` 讀取 `user_roles`，若仍為 `pending` 則導向 `/forbidden`。
4. Admin 可透過 API 或 SQL 調整 `user_roles`，RLS 會檢查 `can_manage_user()` + `can_authorize_role()`。

### 白名單登入流程

```
使用者 Google OAuth 登入
        ↓
app.normalize_email(email)
        ↓
檢查 app.allowed_emails 是否存在
        ↓
  ✘ 不存在 → 立即登出 → /forbidden?reason=not_in_whitelist
  ✔ 存在   → 讀取 default_role
        ↓
寫入/更新 app.user_roles（使用 default_role）
        ↓
完成登入，取得對應權限
```

---

## 3. API 介面

| Method | Path                     | 說明                                                                  |
| ------ | ------------------------ | --------------------------------------------------------------------- |
| GET    | `/api/check-access`      | 回傳登入者角色與基本資料（來源 `app.user_roles`）。                   |
| GET    | `/api/admin/user-roles`  | 依當前使用者權限回傳可管理名單（使用 `app.get_manageable_users()`）。 |
| POST   | `/api/admin/user-roles`  | 新增/調整角色。Body：`user_sub`, `role`, `display_name?`, `department?`。 |
| DELETE | `/api/admin/user-roles`  | 撤銷授權（將角色改為 `pending`）。                                    |
| GET    | `/api/admin/whitelist`   | 回傳全量白名單（依 `created_at` DESC），需 admin 身份。               |
| POST   | `/api/admin/whitelist`   | `emails[]` 批次 upsert，支援覆寫 `default_role`/`notes` 等。          |
| DELETE | `/api/admin/whitelist`   | 移除單一 email。                                                      |

伺服器端所有 API 皆使用 `getUserSession(event)` 取得使用者身份（nuxt-auth-utils），並以 `session.user.id` 當作使用者 ID。

---

## 4. 常用 SQL / 維運作業

### 授權第一位管理員

```sql
UPDATE app.user_roles
SET role = 'admin',
    authorized_at = now(),
    authorized_by = id
WHERE email = 'admin@example.com';
```

### 變更角色（保持其他欄位）

```sql
UPDATE app.user_roles
SET role = 'editor',
    authorized_at = now(),
    authorized_by = '<admin uuid>',
    updated_at = now()
WHERE sub = '<user uuid>';
```

### 撤銷授權 / 封存帳號

```sql
UPDATE app.user_roles
SET role = 'pending',
    authorized_at = NULL,
    authorized_by = NULL,
    updated_at = now()
WHERE email = 'former@example.com';
```

### 查詢可授權角色（供 UI 下拉使用）

```sql
SELECT * FROM app.get_authorizable_roles();
```

### 白名單維護

```sql
-- 新增或更新單筆（保留既有欄位）
INSERT INTO app.allowed_emails (
  email, default_role, reason, notes, added_by
) VALUES (
  'newuser@example.com', 'viewer', '新進人員', NULL, auth.uid()
)
ON CONFLICT (email) DO UPDATE SET
  default_role = EXCLUDED.default_role,
  reason = EXCLUDED.reason,
  notes = EXCLUDED.notes,
  updated_at = now();

-- 查詢最新狀態
SELECT id, email, default_role, reason, notes, created_at
FROM app.allowed_emails
ORDER BY created_at DESC;

-- 撤銷白名單
DELETE FROM app.allowed_emails WHERE email = 'former@example.com';

UPDATE app.user_roles
SET role = 'pending', authorized_at = NULL, authorized_by = NULL
WHERE email = 'former@example.com';
```

---

## 5. 權限矩陣

| 動作                       | admin          | editor                    | viewer                      | pending |
| -------------------------- | -------------- | ------------------------- | --------------------------- | ------- |
| 查看所有 `app.user_roles`  | ✅             | ✅（僅 viewer/pending）   | ❌                          | ❌      |
| 更新 `app.user_roles`      | ✅（任意角色） | ✅（僅 viewer/pending）   | 僅可更新自己的 display/dept | ❌      |
| 呼叫 `/api/admin/whitelist`| ✅             | ✅（可選，視 API 限制）   | ❌                          | ❌      |
| 刪除 `app.allowed_emails`  | ✅             | ✅                        | ❌                          | ❌      |
| 授權 editor                | ✅             | ❌                        | ❌                          | ❌      |

RLS 仍是最終防線，API 只是 UX 限制；若要開放 editor 更多權限，請先調整 API，再確認 `can_manage_user` 與 `can_authorize_role` 是否允許。

---

## 6. `sync_user_info_from_auth()` 重點

- 觸發條件：`auth.users` 的 INSERT / UPDATE (email)。
- 目的：讓 `user_roles.sub` 與 `user_preferences.user_sub` 永遠對應最新的 auth UUID。
- 若同一 email 之前已登入（舊 UUID），函式會：
  1. 把舊 `user_roles.sub` 更新為新 UUID。
  2. 將 `user_preferences` 的 `user_sub` 改為新 UUID 並更新 `updated_at`。
  3. 如未找到偏好記錄則建立預設值。
- 因此 `session.user.id` 可以放心作為資料庫唯一鍵；網址 slug 請改用 email 或客製欄位。

---

## 7. 白名單常見情境

### 新使用者直接登入並取得預設角色

1. 在白名單中新增 `email + default_role = 'viewer'`
2. 使用者第一次登入 → 觸發器自動建立 `app.user_roles` 記錄
3. 若需要更高權限，再由 `/api/admin/user-roles` 授權

### 預先授權管理者

1. 在 `app.allowed_emails` 新增 email，設定 `default_role = 'editor'`
2. 首次登入時會直接成為 editor，無需額外授權

### 稽核與監控

```sql
-- 最近 30 天新增
SELECT email, default_role, added_by, created_at
FROM app.allowed_emails
WHERE created_at >= now() - interval '30 days'
ORDER BY created_at DESC;

-- 白名單但尚未授權 (仍為 pending)
SELECT ae.email
FROM app.allowed_emails ae
LEFT JOIN app.user_roles ur ON ur.email = ae.email
WHERE ur.role = 'pending';
```

---

## 8. 疑難排解

| 症狀                                        | 可能原因                                                                 | 解法                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 白名單已有資料，但登入後仍是 `pending`      | 尚未授權、`default_role` 為 `pending`、或 `normalize_email` 結果不一致   | 檢查 `allowed_emails` 是否真正存在，並確認 email 小寫；必要時使用 SQL upsert                                 |
| `user_preferences` 多出一筆舊 UUID          | seed 中保留舊資料但未登入                                                | `DELETE FROM app.user_preferences WHERE user_id NOT IN (SELECT id FROM auth.users);`，再讓使用者重新登入      |
| `type user_role already exists` 在 push 時  | 遠端仍有舊 schema                                                        | 先 `supabase migration repair --status reverted <timestamp>` 或在基線中加 `IF NOT EXISTS`                    |
| 管理員無法授權 editor                       | API 限制 + RLS 雙層保護                                                  | 需同時修改 `/api/admin/user-roles`（允許 editor）與確認 `can_authorize_role()` 是否回傳 true                 |
| 加入白名單後仍被導向 `/forbidden`？          | Google 登入的 email 大小寫不一致                                          | 檢查 `normalize_email` 結果，確認 email 小寫                                                                |
| 想一次新增多位同部門使用者？                 | —                                                                        | 使用 `/api/admin/whitelist` POST，帶入 `department` 與 `default_role`                                        |
| 誰修改了白名單？                             | —                                                                        | 查詢 `added_by` 欄位或使用 Supabase Studio 的 Row Level History                                              |

---

## 9. 檢查清單（發 PR 前）

- [ ] 任何授權流程調整有更新本文件。
- [ ] 若新增角色/欄位，記得同步 `user_role` enum、RLS policy、`apply_user_authorization()`。
- [ ] 使用者相關的 migrations 皆已通過 `supabase db reset`、lint 驗證。
- [ ] 新 API 已在 `server/api/`、`app/components` 中更新呼叫方式與錯誤處理。

讓授權流程保持透明，才能在大量新使用者或遠端重建時維持可信狀態。任何流程變更請立即回寫此手冊。
