---
description: 寫角色判斷、superuser 放行、首位管理員 bootstrap、per-record 權限表時的判準（平台角色與組織角色分層、bootstrap 防搶、權限表帶 org 與同源動作字彙）
paths: ['server/api/**/*.ts', 'server/routes/**/*.ts', 'server/utils/**/*.ts', 'server/middleware/**/*.ts', 'server/db/**/*.ts', 'server/database/**/*.ts', 'packages/*/server/api/**/*.ts', 'packages/*/server/routes/**/*.ts', 'packages/*/server/utils/**/*.ts', 'packages/*/server/middleware/**/*.ts', 'packages/*/server/db/**/*.ts', 'packages/*/server/database/**/*.ts']
---
<!-- Clade native rule; source: rules/core/auth-roles.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Auth Roles（角色分層、bootstrap、資源層權限）

適用：專案有組織／租戶概念，或有平台管理員。單租戶且只有一種登入者的專案只看 § Bootstrap。各 auth 模組的 API 寫法（better-auth `createAccessControl`、active org）在該模組的 `auth.md`。

## 兩層角色

| 層 | 存哪 | 管什麼 |
| --- | --- | --- |
| 平台角色 | user 表的 `role`（例：`user`／`superuser`） | 跨租戶的平台操作（建立租戶、看全部組織、停用帳號） |
| 組織角色 | membership 表的 `role`（例：`owner`／`admin`／`member`） | 單一組織內的操作 |

- 兩層 **MUST** 分欄存。**NEVER** 把組織角色寫進 user 的 `role`——同一人在 A 組織是 owner、在 B 組織是 member，單欄裝不下，最後會以「任一組織的最高角色」放行全部組織
- 組織角色 **MUST** 以 `(user id, active org id)` 當下查 membership 取得，**NEVER** 用 session 裡快取的角色
- superuser 是**唯一**能跨租戶的身分。放行只寫在 canonical guard 開頭一處（是 superuser → 直接通過），handler 內 **NEVER** 另寫 superuser 例外分支——散落的例外分支無法盤點，漏寫一處就是一處 superuser 被擋、多寫一處就是一個非 superuser 的旁路

## Bootstrap（首位 superuser）

「第一個註冊的人自動成為 superuser」只在空系統成立：

- 判定 **MUST** 在 server 的 user create hook 內做，role **NEVER** 取自註冊請求的 body
- 「目前沒有 superuser」的檢查與升級 **MUST** 是同一個原子操作（單一條件式 SQL，或 transaction 內先取 advisory lock）；兩人同時註冊時只能有一人拿到
- 上線前 **MUST** 收掉自動 bootstrap：改成只升級 env 指定的 email（例：`BOOTSTRAP_SUPERUSER_EMAIL`），或在已有 superuser 後整段停用。**NEVER** 讓「誰先註冊誰是 superuser」留在 production——部署後到第一位管理員註冊前，任何人搶註就拿到全平台權限

## Resource-level（per-record 權限表）

角色表不夠細、要對單筆資源授權（某人可編輯某份文件）時：

- 權限表的**每一列** **MUST** 帶 `organization_id NOT NULL`，查詢同樣以 active org 夾住。沒有 org 欄的 grant 在使用者被移出組織後仍然有效，也能指向別的組織的資源
- 動作欄位的字彙 **MUST** 與角色權限定義同源：從同一份動作表匯出型別，DB 端以 CHECK constraint 或 enum 對齊。**NEVER** 在 API 驗證另寫一份字串清單——API 收 `edit`、權限表定義 `update`，授權判斷不是永遠 false 就是被另一條路繞過

```ts
// Good：動作字彙只有一份來源
export const projectActions = ['read', 'update', 'delete'] as const
const grantBody = z.object({ action: z.enum(projectActions), userId: z.string() })
// Bad：z.enum(['view', 'edit', 'remove'])——與角色表的 read/update/delete 是兩套字
```

handler 是否真的掛上 guard 的偵測見 [[auth-data-path-consistency]] § 偵測；角色變更的保護與稽核見 [[user-lifecycle]]。
