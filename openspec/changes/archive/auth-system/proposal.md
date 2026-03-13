## Why

認證是所有 web application 的基礎。目前只有 better-auth 的配置檔，但沒有登入頁面、auth middleware、或 user store。使用者 clone 下來無法立即測試認證流程，也沒有保護路由的範例可參考。TDMS 的 `auth.global.ts` 已驗證了完整的認證模式。

## What Changes

### Infrastructure（clean 版保留）

- 建立 `app/middleware/auth.global.ts`：全域認證 middleware
  - 區分 public / protected 頁面（透過 `definePageMeta({ auth: false })`）
  - 未登入時重導至 `/auth/login`
  - 支援登入後重導回原頁面（query param `redirect`）
  - 角色檢查基礎（預留 `requiredRole` meta）
- 建立 `app/stores/user.ts`：User profile store
  - `hydrateFromSession()` 從 session 初始化
  - `displayName` computed 含 fallback 邏輯
  - `role` 與 `isAdmin` / `isManager` computed
  - `loadProfile()` 從 API 載入完整 profile
- 建立 `app/composables/useAuthError.ts`：認證錯誤處理

### Demo（clean 版移除）

- 建立 `app/pages/auth/login.vue`：Email + Password 登入 + OAuth buttons（Google, GitHub, LINE）
- 建立 `app/pages/auth/register.vue`：註冊頁面
- 建立 `app/pages/auth/forgot-password.vue`：忘記密碼頁面
- 建立 `app/pages/auth/callback.vue`：OAuth callback 處理

## Capabilities

### New Capabilities

- `auth-middleware`: 全域認證 middleware，保護路由 + 角色檢查
- `user-store`: 使用者狀態管理，session hydration + profile 載入
- `auth-pages`: Login / Register / Forgot Password / OAuth Callback 頁面
- `auth-error-handling`: 認證錯誤的統一處理

### Modified Capabilities

(none)

## Impact

- 新增 `app/middleware/auth.global.ts` (infrastructure)
- 新增 `app/stores/user.ts` (infrastructure)
- 新增 `app/composables/useAuthError.ts` (infrastructure)
- 新增 `app/pages/auth/login.vue` (demo)
- 新增 `app/pages/auth/register.vue` (demo)
- 新增 `app/pages/auth/forgot-password.vue` (demo)
- 新增 `app/pages/auth/callback.vue` (demo)
- 依賴：layouts-and-error-page（使用 auth layout）
- 不需要 migration（better-auth 管理自己的 session）
