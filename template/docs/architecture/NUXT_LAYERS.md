# Nuxt Layers 架構

## 概覽

本專案使用 Nuxt Layers 將多個截然不同的使用介面整合在同一個 codebase 中。多個 layer 共享 `app/` 目錄中的核心程式碼（API、stores、composables、utils、共用元件），同時各自維護獨立的 layout、pages、components 與 composables。

```
nuxt.config.ts
  extends: ['./layers/admin', './layers/portal', './layers/public']
```

這個架構的核心好處：

- **單一部署產出**：多個介面共享同一份 build，無需分別部署
- **共用業務邏輯**：API endpoints、Pinia stores、shared schemas 只寫一次
- **獨立 UI 關注點**：每個 layer 有自己的 layout、路由、專屬元件，互不干擾

## 目錄結構

```
layers/
├── admin/
│   ├── nuxt.config.ts
│   ├── layouts/
│   │   └── admin.vue               # 管理後台 layout，側邊欄導航
│   ├── pages/
│   │   └── admin/
│   │       ├── index.vue            # 管理儀表板
│   │       ├── users.vue            # 使用者管理
│   │       └── settings.vue         # 系統設定
│   ├── components/
│   │   ├── AdminUserTable.vue       # 使用者管理表格
│   │   └── AdminSettingsForm.vue    # 設定表單
│   └── composables/
│       └── useAdminNav.ts           # 管理端導航邏輯
│
├── portal/
│   ├── nuxt.config.ts
│   ├── layouts/
│   │   └── portal.vue               # Mobile-first layout，底部 Tab Bar
│   ├── pages/
│   │   └── my/
│   │       ├── index.vue            # 使用者首頁（問候 + 快速入口）
│   │       ├── profile.vue          # 個人資料
│   │       └── settings.vue         # 個人設定
│   ├── components/
│   │   ├── PortalProfileForm.vue    # 個人資料表單
│   │   └── PortalSettingsForm.vue   # 個人設定表單
│   └── composables/
│       └── usePortalI18n.ts         # 多語系
│
└── public/
    ├── nuxt.config.ts
    ├── layouts/
    │   └── public.vue                # 公開頁面 layout
    └── pages/
        └── public/
            └── index.vue             # 公開首頁
```

## Layer 說明

### Admin（管理後台）

- **目標使用者**：系統管理員
- **使用情境**：桌面瀏覽器的管理後台
- **UI 特色**：側邊欄導航、資料表格密集型
- **路由前綴**：`/admin/*`
- **Layout**：`admin` — 側邊欄 + 頂部標題列
- **主要功能**：
  - 使用者管理與角色授權
  - 系統設定
  - 資料管理（CRUD）

### Portal（使用者端）

- **目標使用者**：一般使用者
- **使用情境**：個人手機或桌面瀏覽器
- **UI 特色**：Mobile-first 設計、底部 Tab 導航列、多語系支援
- **路由前綴**：`/my/*`
- **Layout**：`portal` — 頂部標題列含語系切換與深色模式切換，底部固定 Tab Bar
- **主要功能**：
  - 個人資料管理
  - 個人設定
- **特殊機制**：`usePortalI18n` composable 提供輕量 i18n，語系偏好同步儲存至 cookie + localStorage + 資料庫 `user_preferences`

### Public（公開頁面）

- **目標使用者**：所有訪客
- **使用情境**：公開存取，不需登入
- **UI 特色**：簡潔版面
- **路由前綴**：`/public/*`
- **Layout**：`public` — 精簡 layout

## 路由策略

每個 layer 透過 **目錄命名慣例** 取得獨立的路由命名空間：

| Layer      | Pages 目錄                       | 產生的路由                                        |
| ---------- | -------------------------------- | ------------------------------------------------- |
| admin      | `layers/admin/pages/admin/`      | `/admin`, `/admin/users`, `/admin/settings`       |
| portal     | `layers/portal/pages/my/`        | `/my`, `/my/profile`, `/my/settings`              |
| public     | `layers/public/pages/public/`    | `/public`                                         |
| app (core) | `app/pages/`                     | `/`, `/items`, `/categories` 等核心路由           |

Nuxt 在 build 時自動合併所有 layer 的 `pages/` 目錄，產生統一的路由表。不需要額外的路由配置。

### 權限控管

`app/middleware/auth.global.ts` 負責所有路由的存取控制：

- **`viewer` 角色**：只能存取 `/my/*`（Portal）與公開頁面。嘗試存取管理端路由會被自動導向 `/my`
- **`editor` 以上角色**：可存取所有路由。行動裝置預設導向 `/my`，桌面裝置預設導向 `/`
- **未登入**：導向 `/login`，登入後依 `redirect` query 參數或角色預設路由跳轉

路由分類由 `isCoreRoute()` 函式判斷：以 `/my`、`/admin`、`/public`、`/login`、`/forbidden`、`/auth`、`/confirm` 開頭的路由皆為「非 Core 路由」，其餘為核心路由。

## Layout 選擇機制

每個 layer 的頁面透過 `definePageMeta` 指定所屬 layout：

```typescript
// layers/admin/pages/admin/index.vue
definePageMeta({
  layout: 'admin',
})

// layers/portal/pages/my/index.vue
definePageMeta({
  layout: 'portal',
})

// layers/public/pages/public/index.vue
definePageMeta({
  layout: 'public',
})
```

未指定 layout 的頁面（如 `app/pages/` 中的核心頁面）使用 `app/layouts/default.vue`。

可用的 layouts：

| Layout    | 來源                                 | 用途                |
| --------- | ------------------------------------ | ------------------- |
| `default` | `app/layouts/default.vue`            | 核心側邊欄 layout   |
| `admin`   | `layers/admin/layouts/admin.vue`     | 管理後台            |
| `portal`  | `layers/portal/layouts/portal.vue`   | 使用者端 Mobile-first |
| `public`  | `layers/public/layouts/public.vue`   | 公開頁面            |
| `auth`    | `app/layouts/auth.vue`               | 登入頁              |
| `mobile`  | `app/layouts/mobile.vue`             | 行動版              |

## 元件覆寫機制

每個 layer 的 `nuxt.config.ts` 設定 `components` 目錄且 `pathPrefix: false`：

```typescript
// layers/admin/nuxt.config.ts
export default defineNuxtConfig({
  components: [{ path: './components', pathPrefix: false }],
})
```

這代表 layer 內的元件可以直接用名稱引用，不需要加路徑前綴（例如 `<AdminUserTable />` 而非 `<AdminAdminUserTable />`）。

元件解析優先順序：**layer 元件 > app 元件**。若 layer 中定義了與 `app/components/` 同名的元件，該 layer 的頁面會優先使用 layer 版本。但實務上建議 layer 元件都使用獨特的命名（如 `PortalProfileForm`、`AdminUserTable`），避免命名衝突。

## 程式碼共享模式

### app/ 目錄（共享核心）

所有 layer 共享 `app/` 中的程式碼：

| 目錄               | 內容                                                     |
| ------------------ | -------------------------------------------------------- |
| `app/components/`  | 共用 UI 元件（表格、表單、對話框等）                     |
| `app/composables/` | 共用 composables（`useUserRole` 等）                     |
| `app/stores/`      | Pinia stores（`useUserStore`、`useUserPreferencesStore`） |
| `app/utils/`       | 工具函式                                                 |
| `app/queries/`     | Pinia Colada query 定義                                  |
| `app/middleware/`  | 全域 middleware（`auth.global.ts`）                      |
| `app/pages/`       | 核心頁面                                                 |

### layers/ 目錄（專屬 UI）

layer 內放置只有該介面需要的程式碼：

- **Layout**：每個 layer 必須有自己的 layout
- **Pages**：該介面的頁面路由
- **Components**：該介面專屬的 UI 元件（如 Admin 的 `AdminUserTable`、Portal 的 `PortalProfileForm`）
- **Composables**：該介面專屬的邏輯（如 Portal 的 `usePortalI18n`）
- **i18n**：翻譯檔案（視需要）

### 引用路徑慣例

- Layer 頁面引用 app 程式碼：使用 `~/` 前綴（例如 `import { toastError } from '~/utils/error'`）
- Layer 頁面引用 shared schemas：使用 `~~/` 前綴（例如 `import type { ... } from '~~/shared/schemas/...'`）
- Layer composable 引用 layer 內 i18n：使用 `~~/layers/portal/i18n/...` 絕對路徑

## 如何新增頁面到特定 Layer

以在 Portal 新增「公告」頁面為例：

### 1. 建立頁面檔案

```
layers/portal/pages/my/announcements/index.vue
```

### 2. 指定 layout

```vue
<script setup lang="ts">
  definePageMeta({
    layout: 'portal',
  })

  const { t } = usePortalI18n()
</script>

<template>
  <div class="p-4">
    <h1 class="text-2xl font-bold text-highlighted">{{ t('portal.announcements.title') }}</h1>
    <!-- 頁面內容 -->
  </div>
</template>
```

### 3.（若需要）新增翻譯 key

在 `layers/portal/i18n/` 對應的語系檔案中加入翻譯。

### 4.（若需要）新增 Tab 導航項目

在 `layers/portal/layouts/portal.vue` 的 `tabs` 陣列中新增：

```typescript
{ labelKey: 'portal.tab.announcements', icon: 'i-lucide-megaphone', to: '/my/announcements' },
```

### 5. 完成

新路由 `/my/announcements` 自動生效，不需要修改 `nuxt.config.ts` 或路由配置。

## nuxt.config.ts 配置

根目錄的 `nuxt.config.ts` 透過 `extends` 陣列引入所有 layer：

```typescript
export default defineNuxtConfig({
  extends: ['./layers/admin', './layers/portal', './layers/public'],
  // ...其餘配置
})
```

每個 layer 的 `nuxt.config.ts` 只包含最小化的配置（目前各 layer 的配置完全相同，只設定 `components` 目錄）：

```typescript
export default defineNuxtConfig({
  components: [{ path: './components', pathPrefix: false }],
})
```

Layer 會繼承根 `nuxt.config.ts` 的所有設定（modules、runtimeConfig、vite 等），無需重複宣告。如有需要，layer 可以在自己的 `nuxt.config.ts` 中覆寫或擴展特定配置。
