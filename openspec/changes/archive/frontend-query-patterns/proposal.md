## Why

前端的 Pinia Colada queries、composables、以及 Supabase client 讀取 pattern 目前完全空白。TDMS 使用 query key factory + mutation + cache invalidation 的成熟模式，但 starter 沒有任何範例。使用者需要知道如何正確搭配 Pinia Colada 與 server API。

## What Changes

### Infrastructure（clean 版保留）

- 建立 `app/composables/usePageLoading.ts`：
  - 頁面 loading 狀態管理
  - Timeout presets（quick / normal / long）
  - `withLoading()` wrapper function
- 建立 `app/composables/useUserRole.ts`：
  - 角色檢查 helpers（`isAdmin`, `isManager`, `hasRole()`）
  - 基於 user store 的 computed

### Demo（clean 版移除）

- 建立 `app/queries/profiles.ts`：
  - Query key factory pattern（`profileKeys.all`, `.list()`, `.detail(id)`）
  - `useProfileListQuery(filters)` — 列表查詢 + staleTime
  - `useProfileDetailQuery(id)` — 單筆查詢
  - `useMyProfileQuery()` — 當前使用者 profile
  - `useUpdateProfileMutation()` — 更新 + cache invalidation
- 建立範例頁面展示 query 使用：
  - `app/pages/profile/index.vue` — 顯示當前使用者 profile + 編輯表單
  - `app/pages/admin/users.vue` — Admin 使用者列表（展示分頁 + 搜尋 + 角色篩選）
- 建立範例元件：
  - `app/components/demo/ProfileForm.vue` — Profile 編輯表單（展示 Nuxt UI form + Zod validation）
  - `app/components/demo/UserTable.vue` — 使用者列表表格（展示 Nuxt UI Table + 分頁）

## Capabilities

### New Capabilities

- `query-key-factory`: Pinia Colada query key factory pattern
- `query-mutation-pattern`: Query + Mutation + Cache invalidation 範例
- `page-loading`: 頁面 loading 狀態管理 composable
- `role-check`: 角色檢查 composable

### Modified Capabilities

(none)

## Impact

- 新增 `app/composables/usePageLoading.ts` (infrastructure)
- 新增 `app/composables/useUserRole.ts` (infrastructure)
- 新增 `app/queries/profiles.ts` (demo)
- 新增 `app/pages/profile/index.vue` (demo)
- 新增 `app/pages/admin/users.vue` (demo)
- 新增 `app/components/demo/ProfileForm.vue` (demo)
- 新增 `app/components/demo/UserTable.vue` (demo)
- 依賴：auth-system（user store）, api-crud-pattern（API endpoints）
