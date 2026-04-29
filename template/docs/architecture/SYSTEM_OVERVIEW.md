---
audience: both
applies-to: architecture
---

# 系統架構概觀

## 技術堆疊

| 層級     | 技術                                               |
| -------- | -------------------------------------------------- |
| 框架     | Nuxt 4（Vue 3 Composition API + `<script setup>`） |
| 語言     | TypeScript                                         |
| 樣式     | Tailwind CSS + Nuxt UI                             |
| 狀態管理 | Pinia + Pinia Colada（server state）               |
| 工具庫   | VueUse                                             |
| 資料庫   | Supabase（PostgreSQL）                             |
| 認證     | nuxt-auth-utils（Cookie Session）                  |
| 部署     | Cloudflare Workers / Pages（或其他 Nitro preset）  |

## 核心架構決策

### Supabase 作為純資料庫

本專案將 Supabase 定位為 **PostgreSQL 資料庫 + RLS 存取控制層**，不使用：

- ~~Supabase Auth~~ → 改用 nuxt-auth-utils 的 Cookie Session
- ~~Supabase Realtime~~ → 基礎版不包含，需要時再啟用
- ~~Supabase Storage~~ → 依需求選擇，非預設啟用

這個決策讓認證邏輯完全在 Nuxt server 端控制，避免 Supabase Auth 的 JWT refresh 複雜度。

### Cookie-Based Session（非 JWT）

使用 `nuxt-auth-utils` 管理 session：

- OAuth provider 登入（Google 等）→ Nuxt server 驗證 → 寫入 encrypted cookie
- Server API 透過 `getUserSession(event)` 取得使用者資訊
- **不使用** `useSupabaseUser()` 或任何 Supabase Auth API

### Client 讀、Server 寫

| 操作        | 方式                            | 說明                               |
| ----------- | ------------------------------- | ---------------------------------- |
| Client READ | `useSupabaseClient<Database>()` | 僅限 RLS `TO public` 的表          |
| Server READ | `/api/v1/*` endpoints           | RLS `TO authenticated` 的表        |
| ALL WRITES  | `/api/v1/*` endpoints           | insert/update/delete 一律走 server |

Client 端 **永遠不做** `.insert()` / `.update()` / `.delete()` / `.upsert()`。

### Role-Based Access Control

角色資訊儲存在 `app.user_roles` 表：

- Server API 透過 `requireRole(event, 'admin')` 檢查權限
- 角色檢查在所有 business logic 之前執行
- RLS policy 的 write 規則包含 `service_role` bypass

### Nuxt Layers 多介面架構

使用 Nuxt Layers 支援多個前端介面共享同一後端：

```
base/           ← 共用：API routes、composables、types、utils
├── app-a/      ← 介面 A（extends base）
├── app-b/      ← 介面 B（extends base）
└── ...
```

每個 layer 可以有自己的 pages、components、layouts，共享 server API 和商業邏輯。

## 資料流

```
┌─────────────┐
│   Browser    │
│  (Vue SPA)   │
└──────┬───────┘
       │
       │ Cookie Session（encrypted）
       │
┌──────▼───────┐
│  Nuxt Server │
│              │
│  ┌─────────┐ │
│  │ API     │ │ ← requireRole() + Zod validation
│  │ Routes  │ │
│  └────┬────┘ │
└───────┼──────┘
        │
        │ request-scoped client（`getSupabaseWithContext`）
        │
┌───────▼──────┐
│   Supabase   │
│  PostgreSQL  │
│              │
│  ┌─────────┐ │
│  │  RLS    │ │ ← Row Level Security policies
│  │ Policies│ │
│  └─────────┘ │
└──────────────┘
```

### 請求生命週期

1. **Browser** → 發送請求，cookie 自動附帶
2. **Nuxt Server** → `getUserSession(event)` 解析 cookie，取得使用者身份
3. **API Route** → `requireRole()` 檢查權限 → Zod schema 驗證輸入
4. **Supabase** → 透過 request-scoped client 執行查詢；只有 audit、backfill、修復腳本等系統任務才直接用 `service_role`
5. **Response** → 統一格式 `{ data, pagination? }` 回傳

### Client 直讀路徑（SELECT only）

```
Browser → useSupabaseClient → Supabase（anon key + RLS TO public）
```

僅用於不需要認證的公開資料讀取。`anon` 角色只能存取 `TO public` 的 RLS policy。

## 目錄結構

```
server/
├── api/v1/          ← RESTful API endpoints
├── middleware/       ← Server middleware
└── utils/           ← Server utilities（DB helpers、auth、logging）

app/
├── components/      ← Vue components
├── composables/     ← Client composables
├── pages/           ← File-based routing
├── layouts/         ← Page layouts
└── utils/           ← Client utilities

shared/
├── schemas/         ← Zod schemas（server + client 共用）
└── types/           ← TypeScript types

supabase/
├── migrations/      ← SQL migrations
└── seed.sql         ← Development seed data
```

## 相關文件

- [API 設計指南](../api/README.md)
- [認證整合](../auth/README.md)
- [資料庫指南](../database/README.md)
- [Gotchas](../gotchas/README.md)
