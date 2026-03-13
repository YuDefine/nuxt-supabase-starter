## Why

目前 `server/api/v1/` 是空的。使用者需要參考範例才知道如何正確建立 API endpoint，包括：Zod 驗證、Supabase context client、db-errors 處理、cachedEventHandler、分頁回應、權限檢查。TDMS 的 API pattern 已經過 80+ endpoints 驗證，但 starter 缺乏展示。

## What Changes

### Demo（clean 版移除）

- 建立 Profile CRUD API（以 profiles table 為範例）：
  - `server/api/v1/profiles/index.get.ts` — 列表 + 分頁 + 搜尋
    - 使用 `cachedEventHandler`（stale-while-revalidate）
    - 使用 `getValidatedQuery()` + Zod schema
    - 使用 `requireRole()` 權限檢查
    - 使用 `createPaginatedResponse()` 統一回應
  - `server/api/v1/profiles/[id].get.ts` — 取得單筆
  - `server/api/v1/profiles/[id].patch.ts` — 更新
    - 使用 `getValidatedBody()` + Zod schema
    - 使用 `handleDbError()` 錯誤處理
    - 使用 `getSupabaseWithContext()` RLS context
  - `server/api/v1/profiles/me.get.ts` — 取得當前使用者 profile
- 建立 shared types：
  - `shared/types/profiles.ts` — request/response 型別
  - `shared/schemas/profiles.ts` — Zod validation schemas

## Capabilities

### New Capabilities

- `api-crud-example`: 完整的 CRUD API 範例，展示所有 server pattern
- `shared-types-pattern`: Client/Server 共用的型別與驗證 schema

### Modified Capabilities

(none)

## Impact

- 新增 `server/api/v1/profiles/` (4 files, demo)
- 新增 `shared/types/profiles.ts` (demo)
- 新增 `shared/schemas/profiles.ts` (demo)
- 依賴：server-foundation（utils）, database-example（profiles table）
- 不需要額外 migration
