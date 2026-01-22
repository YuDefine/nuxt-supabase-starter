# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 📑 目錄導覽

| 章節                                                     | 說明                                    | 重要性  |
| -------------------------------------------------------- | --------------------------------------- | ------- |
| [語言偏好](#-語言偏好-language-preference)               | 繁體中文規範                            | 🔴 必讀 |
| [Standards](#-standards)                                 | 核心技術規範                            | 🔴 必讀 |
| [Development Workflow](#-development-workflow)           | TDD 開發流程                            | 🔴 必讀 |
| [AI Skills](#-ai-skills)                                 | 技術 Skills 與情境 Skills               | 🔴 必讀 |
| [Database Guidelines](#-database--supabase-guidelines)   | Supabase 存取策略、認證、Migration、RLS | 🔴 必讀 |
| [Vue Component Conventions](#-vue-component-conventions) | 元件撰寫規範                            | 🟡 參考 |
| [Git Commit Conventions](#-git-commit-conventions)       | Commit 格式                             | 🟡 參考 |
| [Architecture](#-architecture)                           | 專案結構                                | 🟢 背景 |

> **詳細規範**：認證流程見 `docs/verify/AUTH_INTEGRATION.md`，Migration 見 `docs/verify/SUPABASE_MIGRATION_GUIDE.md`

---

## 🗣️ 語言偏好 (Language Preference)

> Claude 必須**一律使用繁體中文（Traditional Chinese, zh-TW）**與開發者溝通，除非使用者有在單次對話中特別要求使用其他語言。
>
> **絕對禁止使用簡體中文（Simplified Chinese, zh-CN）**。

---

## 📋 Project Overview

<!-- TODO: 替換為你的專案說明 -->

[專案名稱] 是一個使用 Nuxt 4 和 Nuxt UI 建構的 [專案類型] 系統。

### Key Objectives

- [目標 1]
- [目標 2]
- [目標 3]

---

## 🚀 Development Commands

```bash
# Install dependencies (uses pnpm)
pnpm install

# Development server (opens browser automatically)
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview

# Type checking
pnpm typecheck

# Linting
pnpm lint

# Testing
pnpm test              # Run all tests with coverage
pnpm test:unit         # Run unit tests only
pnpm test:watch        # Run tests in watch mode

# Run single test file
pnpm vitest run test/unit/specific-file.test.ts

# Run tests matching pattern
pnpm vitest run -t "pattern"
```

---

## ⚠️ Standards

**MUST FOLLOW THESE RULES, NO EXCEPTIONS**

### Core Technologies

- **Stack**: Nuxt 4, Vue 3, TypeScript, Tailwind CSS, Nuxt UI
- **Patterns**: ALWAYS use Composition API + `<script setup>`, NEVER use Options API
- **Type Safety**: Keep types alongside your code, use TypeScript for type safety, prefer `interface` over `type` for defining types

### Code Style

- **Styling**: ALWAYS use TailwindCSS classes rather than manual CSS
- **Colors**: DO NOT hard code colors, use Tailwind's color system and theme tokens
- **Comments**: ONLY add meaningful comments that explain why something is done, not what it does
- **Functions**: ALWAYS use named functions when declaring methods, use arrow functions only for callbacks
- **Exports**: ALWAYS prefer named exports over default exports

### Development Environment

- **Dev Server**: Dev server is already running with HMR enabled. NEVER launch it yourself
- **Test-Driven Development**: 全部開發作業一律遵循 **TDD**：先寫會失敗的測試、觀察失敗訊息、完成最小實作並保持測試綠燈、最後重構

---

## 🏗️ Architecture

### Tech Stack

- **Framework:** Nuxt 4.x with SSR disabled (`ssr: false`)
- **UI Library:** Nuxt UI 4.x (dashboard components)
- **State Management:** Pinia (`@pinia/nuxt`) + Pinia Colada (`@pinia/colada-nuxt`)
- **Database:** Supabase (PostgreSQL) via `@nuxtjs/supabase`
- **Authentication:** `@onmax/nuxt-better-auth` (OAuth)
- **Charts:** `nuxt-charts` (Unovis)
- **Validation:** Zod
- **Utilities:** VueUse (`@vueuse/nuxt`)
- **Error Tracking:** Sentry (`@sentry/nuxt`)
- **Deployment:** Cloudflare Workers (`nitro.preset: 'cloudflare_module'`)
- **Icons:** @iconify-json/lucide
- **Package Manager:** pnpm
- **TypeScript:** Project uses TypeScript with Vue type checking

### Project Structure

```
app/
├── app.vue                 # Root component with UApp wrapper
├── app.config.ts           # UI theme config
├── layouts/
│   └── default.vue         # Dashboard layout with collapsible sidebar
├── pages/                  # File-based routing
├── components/             # 按功能分類的元件
│   └── common/             # 共用元件
├── composables/            # Vue composables
├── stores/                 # Pinia stores
├── queries/                # Pinia Colada queries
├── types/                  # TypeScript types (database.types.ts)
└── assets/css/
    └── main.css            # Custom styles

server/
├── api/                    # API endpoints
│   ├── v1/                # 版本化業務 API
│   ├── auth/              # 認證 API
│   └── admin/             # 管理員 API
├── middleware/             # Server middleware
├── routes/auth/            # OAuth routes
├── types/                  # Server types (auth.d.ts)
└── utils/                  # Server utilities (supabase, logger)

test/
├── unit/                   # 單元測試 (*.test.ts, *.spec.ts)
├── nuxt/                   # Nuxt 環境測試 (*.nuxt.test.ts)
└── helpers/                # 測試輔助函式

supabase/
└── migrations/             # Database migrations (使用 CLI 建立，禁止手動建立)

shared/
└── types/
    └── index.d.ts          # Shared TypeScript types
```

### Key Architecture Patterns

#### Dashboard Layout

The application uses a collapsible sidebar layout (`UDashboardSidebar`) with:

- **Header**: Logo and system title
- **Navigation**: Menu items using `NavigationMenuItem` type
- **Footer**: User menu component
- The layout is resizable and uses the `UDashboardGroup` with "rem" units

#### Page Structure

Pages follow Nuxt UI dashboard pattern with:

- `UDashboardPanel` as the main container
- `UDashboardNavbar` for page headers with title and actions
- `UDashboardToolbar` for additional controls
- `UDashboardSidebarCollapse` toggle in navbar leading slot

---

## 🎨 UI/UX Patterns

### Icons

Use Lucide icons via `i-lucide-*` pattern (e.g., `i-lucide-house`, `i-lucide-settings`, `i-lucide-box`)

### Navigation

Use `NavigationMenuItem` type from `@nuxt/ui` for menu items with proper structure including label, icon, to, and onSelect handlers for mobile closure

### Theming

<!-- TODO: 設定你的主題顏色 -->

Primary color is [color], neutral color is [color] (set in app.config.ts)

### Responsive Design

Dashboard components handle both desktop and mobile with sidebar collapse state management

---

## 🔄 Development Workflow

**ALWAYS follow this workflow when implementing a new feature or fixing a bug.** This ensures consistency, quality, and maintainability of the codebase.

### Workflow Steps

1. **Plan**: Plan your tasks, review them with user. Include tests when possible
2. **Design**: 設計測試案例、資料邊界與 mock 策略，並確認符合 [project structure](#project-structure) 與 [standards](#standards)
3. **Red**: 先撰寫並執行失敗測試，釐清需求與邏輯邊界
4. **Green**: 撰寫最小實作讓測試轉為綠燈，禁止跳過測試或僅覆蓋快樂路徑
5. **Refactor**: 在測試維持綠燈的前提下重構程式碼與測試
6. **Stage**: 只有在測試全部通過後才能 `git add`
7. **Review**: Review changes and analyze the need for additional coverage

### 測試原則

- 所有功能與修正皆須新增或更新測試，涵蓋成功、失敗與邊界案例
- `pnpm test` 必須在提交前保持綠燈；必要時補充 `pnpm test:unit`、`pnpm test:watch`
- 嚴禁提交被忽略、註解或暫時跳過（`it.skip`、`describe.skip`）的測試

---

## 🤖 自動化工作流程

**Claude 必須在適當時機自動執行以下流程，無需使用者手動觸發。**

### 自動觸發規則

| 觸發時機                | 自動執行                        | 說明                                               |
| ----------------------- | ------------------------------- | -------------------------------------------------- |
| 完成任何程式碼實作後    | `pnpm check`                    | 執行 format → lint → typecheck → test              |
| `pnpm check` 全部通過後 | 詢問是否 commit                 | 分析變更並建議 commit 分組                         |
| 使用者同意 commit 後    | 依功能分組 commit               | 遵循 commitlint 規範，逐一建立 commit              |
| 所有 commit 完成後      | 版本升級 + deploy commit + tag  | 詢問升級類型（minor/patch）→ `pnpm tag`            |
| 建立/修改 migration 後  | `supabase db reset` + `db lint` | 驗證 migration 正確性                              |
| migration 驗證通過後    | 重新產生 TypeScript 類型        | `supabase gen types typescript --local \| tee ...` |
| 修改資料庫 schema 後    | 更新 `docs/verify/` 相關文件    | 同步相關文件                                       |
| 新功能開發時            | TDD 流程                        | 先寫測試（紅燈）→ 實作（綠燈）→ 重構               |

### 自動檢查流程

當完成實作後，Claude 自動執行：

```
┌─────────────────────────────────────────────────────────┐
│  1. pnpm format                                         │
│     ↓ 失敗 → 自動修復 → 重試                             │
│  2. pnpm lint                                           │
│     ↓ 失敗 → 分析錯誤 → 修復 → 重試                      │
│  3. pnpm typecheck                                      │
│     ↓ 失敗 → 分析類型錯誤 → 修復 → 重試                  │
│  4. pnpm test                                           │
│     ↓ 失敗 → 分析測試失敗原因 → 修復 → 重試              │
│  5. 全部通過                                             │
│     ↓                                                   │
│  6. 詢問：「檢查全部通過，是否要 commit？」               │
│     ↓ 使用者同意                                         │
│  7. 分析變更 → 建議分組 → 逐一 commit                    │
└─────────────────────────────────────────────────────────┘
```

### 自動 Commit 流程

當使用者同意 commit 時，Claude 自動執行：

1. **分析變更**：`git status` + `git diff --stat`
2. **依功能分組**：將相關檔案分組（例如：元件 + 測試 + 類型）
3. **建議分組**：向使用者展示分組結果
4. **逐一 commit**：
   - 每組使用適當的 emoji type（✨ feat / 🐛 fix / 🔨 refactor 等）
   - Commit message 使用繁體中文
   - 加上 `Co-Authored-By: Claude <noreply@anthropic.com>`
5. **版本升級**（所有 commit 完成後）：
   - 詢問：「是否要升級版本？（minor / patch / 否）」
   - 執行 `pnpm version <type> --no-git-tag-version`
   - 建立 deploy commit：`🚀 deploy: v<version>`
   - 執行 `pnpm tag` 建立並推送 Git tag

### 自動 Migration 驗證

建立或修改 migration 後，Claude 自動執行：

```bash
# 1. 重置資料庫測試 migration
supabase db reset

# 2. 安全檢查（search_path、RLS 等）
supabase db lint --level warning

# 3. 重新產生 TypeScript 類型
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null

# 4. 類型檢查
pnpm typecheck
```

### TDD 自動流程

開發新功能時，Claude 自動遵循：

1. **Red**：先寫測試，執行確認失敗
2. **Green**：寫最小實作，執行確認通過
3. **Refactor**：重構程式碼，確保測試仍通過
4. **Check**：執行 `pnpm check` 確認所有檢查通過

---

## 🧠 AI Skills

本專案使用兩種類型的 AI Skills 來輔助開發。

### 技術 Skills（自動更新）

由 [nuxt-skills](https://github.com/onmax/nuxt-skills) plugin 自動維護，透過 GitHub Actions 定期同步最新版本。

| Skill              | 用途                  |
| ------------------ | --------------------- |
| `nuxt`             | Nuxt 4 框架開發       |
| `nuxt-ui`          | Nuxt UI 4 元件使用    |
| `nuxt-better-auth` | 認證整合              |
| `nuxt-content`     | 內容管理              |
| `nuxt-modules`     | 模組開發              |
| `nuxthub`          | NuxtHub 部署          |
| `vue`              | Vue 3 Composition API |
| `vueuse`           | VueUse composables    |
| `reka-ui`          | Headless UI 元件      |
| `motion`           | Motion 動畫           |
| `ts-library`       | TypeScript 函式庫開發 |
| `document-writer`  | 文件撰寫              |

> **更新機制**：這些 skills 存放在 `.claude/skills/` 目錄，由 CI 定期從 nuxt-skills repo 拉取更新。

### 情境 Skills（本地維護）

當特定開發情境發生時自動載入，提供專案特定的最佳實踐。

| Skill                | 觸發時機            | 說明                                 |
| -------------------- | ------------------- | ------------------------------------ |
| `supabase-rls`       | 建立 RLS Policy 時  | RLS 設計規範，包含 service_role 繞過 |
| `supabase-migration` | 建立 migration 時   | Local-First 流程、search_path 規範   |
| `server-api`         | 建立 Server API 時  | Zod 驗證、權限檢查、錯誤處理         |
| `pinia-store`        | 建立 Pinia Store 時 | Composition API、readonly 保護       |
| `supabase-arch`      | 架構決策時          | RPC vs Edge Function 決策樹          |

> **維護方式**：這些 skills 在 `.claude/skills/` 目錄下獨立管理，需手動更新以符合專案需求。

---

## 📚 Documentation Guidelines

### docs/verify/ Directory - CRITICAL PURPOSE

`docs/verify/` 目錄用於記錄**專案當下的清晰狀態（current state）**，而非迭代過程（iteration history）。

#### 寫作原則

1. **使用現在式**：描述「系統目前是什麼」，而非「我們做了什麼」
2. **移除時間標記**：不要寫「2025-11-10 更新」或「本次修改」
3. **專注於狀態**：記錄配置、設定、架構，而非操作步驟
4. **直接覆寫**：狀態改變時直接覆寫舊描述，不保留歷史（Git 已記錄）

#### ❌ 錯誤 vs ✅ 正確

| ❌ 錯誤寫法             | ✅ 正確寫法           |
| ----------------------- | --------------------- |
| 本次更新：修正了 X 問題 | 目前 X 功能的配置狀態 |
| 2025-11-10 更新         | （無時間標記）        |
| 原本是 A，現在改成 B    | 目前是 B              |

---

## 🗄️ Database & Supabase Guidelines

### 📊 Supabase 資料存取策略

**專案採用「讀 Client，寫 Server」的分層策略**

#### ✅ Client 端可以直接存取（`useSupabaseClient`）

| 使用場景               | 說明                |
| ---------------------- | ------------------- |
| 下拉選單選項查詢       | `app/queries/` 目錄 |
| Dashboard 統計資料     | 唯讀查詢            |
| 列表資料查詢（帶分頁） | 帶 RLS 保護         |
| 表單載入現有資料       | 編輯前的資料載入    |

```typescript
// ✅ CORRECT - Client 端唯讀查詢
const client = useSupabaseClient<Database>();
const { data } = await client.schema("your_schema").from("table").select("id, name").order("name");
```

#### ❌ Client 端禁止執行寫入操作

```typescript
// ❌ FORBIDDEN - 禁止在 Client 端直接寫入
const client = useSupabaseClient<Database>();
await client.schema("your_schema").from("table").insert({ name: "New" }); // 禁止！
await client.schema("your_schema").from("table").update({ name: "Updated" }); // 禁止！
await client.schema("your_schema").from("table").delete(); // 禁止！
```

#### ✅ 所有寫入操作必須走 Server API

```typescript
// ✅ CORRECT - 透過 Server API 執行寫入
await $fetch("/api/v1/resources", { method: "POST", body: { name: "New" } });
await $fetch(`/api/v1/resources/${id}`, { method: "PATCH", body: { name: "Updated" } });
await $fetch(`/api/v1/resources/${id}`, { method: "DELETE" });
```

#### 為什麼採用此策略？

1. **RLS 已完善**：讀取操作受到 RLS 政策保護
2. **讀多寫少**：Dashboard、下拉選單、列表查詢佔大宗，直連減少延遲
3. **寫入集中管理**：所有 CUD 操作在 Server 端統一處理權限檢查、日誌記錄、業務邏輯
4. **未來擴展性**：Server API 易於加入快取、rate limiting、審計日誌

#### 檢查清單

開發新功能時，確認：

- [ ] Client 端只使用 `.select()` 查詢
- [ ] 所有 `.insert()` / `.update()` / `.delete()` / `.upsert()` 在 Server API 中
- [ ] Pinia Colada mutations 透過 `$fetch` 呼叫 Server API
- [ ] 表單提交使用 `$fetch('/api/v1/...')` 而非直接操作 Supabase

---

### ⚠️ 認證架構 - CRITICAL

**本專案使用 `@onmax/nuxt-better-auth` 認證，`@nuxtjs/supabase` 僅作資料庫存取！**

#### 核心原則

```typescript
// ❌ FORBIDDEN - 舊的 Supabase Auth（絕對禁止）
const user = useSupabaseUser();
const user = await serverSupabaseUser(event);

// ✅ CORRECT - nuxt-better-auth
const { user, loggedIn, signIn, signOut } = useUserSession(); // Client 端
// Server 端使用 better-auth 提供的方式取得 session
```

#### 快速檢查清單

- [ ] Client: `useUserSession()` 而非 `useSupabaseUser()`
- [ ] 資料庫: `useSupabaseClient<Database>()` 加上型別泛型

---

### Migration Files - CRITICAL RULES

#### Local-First 原則

**所有 migration 必須先在本地建立、測試通過後，再 push 到 remote！**

```bash
# ✅ 正確流程
supabase migration new <description>           # 1. 本地建立
# 編輯 migration 檔案
supabase db reset                              # 2. 本地測試
supabase db lint --level warning               # 3. 安全檢查
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null
supabase db push                               # 4. 最後才 push

# ❌ 禁止
# - 不要用 mcp__remote-supabase__apply_migration 建立 migration
# - 不要用 Write tool 或 touch 手動建立 .sql 檔案
```

#### 不可變原則

**已套用的 migration 絕對不可修改或刪除！** 需修正請建立新的 migration。

---

### ⚠️ SECURITY: Function search_path

**所有 database function 必須使用 `SET search_path = ''`（空字串）！**

```sql
-- ✅ CORRECT
CREATE OR REPLACE FUNCTION core.my_function()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''  -- 必須是空字串！
AS $$ BEGIN
  SELECT * FROM core.users WHERE id = auth.uid();  -- 使用完整 schema 名稱
END; $$;

-- ❌ FORBIDDEN
SET search_path = public, pg_temp  -- 絕對禁止！
```

#### Migration 提交前檢查

```bash
supabase db lint --level warning    # 必須零警告
grep -r "SET search_path = public" supabase/migrations/  # 必須無結果
```

---

### ⚠️ RLS Policy - CRITICAL

**API 寫入操作的 RLS policy 必須包含 `service_role` 繞過！**

```sql
CREATE POLICY "Allow manager update" ON your_schema.table FOR UPDATE
USING (
  (SELECT auth.role()) = 'service_role'  -- ⚠️ 必須加這行！
  OR core.current_user_role() IN ('admin', 'manager')
);
```

#### 常見問題

- Toast 成功但資料沒變 → 缺少對應的 RLS policy
- API 回傳 HTML → 路由衝突（避免同目錄下同時用 `[id].ts` 和 `[id]/xxx.ts`）

---

## 🚨 Error Handling 規範

### API 錯誤回應格式

```typescript
// Server API 錯誤
throw createError({
  statusCode: 400, // 400, 401, 403, 404, 500
  statusMessage: "Bad Request",
  message: "具體錯誤訊息（給開發者看）",
});

// Client 端處理
try {
  await $fetch("/api/v1/...");
} catch (error) {
  if (error.statusCode === 401) {
    navigateTo("/login");
  } else {
    toast.add({ title: "操作失敗", description: error.message, color: "red" });
  }
}
```

### Toast 通知標準

| 情境 | Color    | 範例                 |
| ---- | -------- | -------------------- |
| 成功 | `green`  | 「已儲存」「已刪除」 |
| 警告 | `yellow` | 「資料可能不完整」   |
| 錯誤 | `red`    | 「操作失敗：...」    |
| 資訊 | `blue`   | 「正在處理...」      |

### Sentry 整合

- 錯誤會自動上報到 Sentry，不需手動呼叫
- Composable 中的錯誤使用 `try/catch` 但不重新拋出，讓 Sentry 追蹤

---

## 🔑 環境變數快速參考

### 必要變數

```bash
# Supabase
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<Publishable_key>
SUPABASE_SECRET_KEY=<Secret_key>  # 僅 server 端

# OAuth（根據需要選擇）
NUXT_OAUTH_GOOGLE_CLIENT_ID=<client_id>
NUXT_OAUTH_GOOGLE_CLIENT_SECRET=<client_secret>

# Session
NUXT_SESSION_PASSWORD=<至少32字元的隨機字串>
```

### 命名規則

- `NUXT_PUBLIC_*`：會暴露給 Client 端
- `NUXT_*`：僅 Server 端可用
- 敏感資訊（SECRET、SERVICE*ROLE）絕不加 `PUBLIC*`

---

## 🧪 Testing Workflow

### Unit and Integration Tests

- Test critical logic first
- Split the code if needed to make it testable
- Unit tests go in `test/unit/` (Node environment, fast)
- E2E tests go in `test/nuxt/` (full Nuxt environment)
- Keep unit and integration tests in `test/` directory

---

## 🔍 Research & Documentation

- **NEVER hallucinate or guess URLs**
- ALWAYS try accessing the `llms.txt` file first to find relevant documentation. EXAMPLE: `https://pinia-colada.esm.dev/llms.txt`
  - If it exists, it will contain other links to the documentation for the LLMs used in this project
- ALWAYS follow existing links in table of contents or documentation indices
- Verify examples and patterns from documentation before using

---

## 🎯 Vue Component Conventions

### Naming and Structure

- Name files consistently using PascalCase (`UserProfile.vue`) OR kebab-case (`user-profile.vue`)
- ALWAYS use PascalCase for component names in source code
- Compose names from the most general to the most specific: `SearchButtonClear.vue` not `ClearSearchButton.vue`

### Props and Emits

- ALWAYS define props with `defineProps<{ propOne: number }>()` and TypeScript types, WITHOUT `const props =`
- Use `const props =` ONLY if props are used in the script block
- Destructure props to declare default values
- ALWAYS define emits with `const emit = defineEmits<{ eventName: [argOne: type]; otherEvent: [] }>()` for type safety
- ALWAYS use camelCase in JS for props and emits, even if they are kebab-case in templates
- ALWAYS use kebab-case in templates for props and emits

### Templates and Bindings

- ALWAYS use the prop shorthand if possible: `<MyComponent :count />` instead of `<MyComponent :count="count" />` (when value has the same name as the prop)
- ALWAYS use the shorthand for slots: `<template #default>` instead of `<template v-slot:default>`
- ALWAYS use explicit `<template>` tags for ALL used slots

### v-model Bindings

- ALWAYS use `defineModel<type>()` to define v-model bindings
- This avoids defining `modelValue` prop and `update:modelValue` event manually

```vue
<script setup lang="ts">
const title = defineModel<string>(); // 基本用法
const firstName = defineModel<string>("firstName"); // 具名 v-model
</script>

<UserForm v-model:first-name="user.firstName" />
```

---

## 🛣️ Routes and Page Components

`app/pages` folder contains the routes of the application. The routes are defined in a file-based manner using Nuxt's file-based routing, meaning that the structure of the files and folders directly corresponds to the routes of the application.

### Route Conventions

- **AVOID** files named `index.vue`, instead use a group and give them a meaningful name like `pages/(home).vue`
- ALWAYS use explicit names for route params: prefer `[userId]` over `[id]`, `[toolId]` over `[id]`, etc.
- Use `.` in filenames to create `/` without route nesting: `users.edit.vue` → `/users/edit`
- Use double brackets `[[paramName]]` for optional route parameters
- Use the `+` modifier after a closing bracket `]` to make a parameter repeatable: `posts.[[slug]]+.vue` matches `/posts/some-posts` and `/posts/some/post`
- Within a page component, use `definePage()` to customize the route's properties like `meta`, `name`, `path`, `alias`, etc
- Prefer named route locations for type safety and clarity, e.g., `router.push({ name: '/users/[userId]', params: { userId } })`
- Pass the name of the route to `useRoute('/path/[param]')` to get stricter types

### Route Groups

Route groups (using parentheses) give more descriptive names to routes and can create shared layouts without interfering with the generated URL:

```
app/pages/
├── (home).vue          # 首頁（比 index.vue 更具描述性）
├── [...path].vue       # Catch-all route for not found pages
├── settings.vue        # Layout for all routes in settings/
├── settings/
│   ├── (general).vue   # /settings
│   └── members.vue     # /settings/members
└── resources/
    ├── (list).vue      # /resources
    └── [resourceId].vue # /resources/:resourceId
```

---

## 🌐 Native Browser API Usage Priority

1. **First**: Check Nuxt documentation for built-in solutions
2. **Second**: Use VueUse composables (if @vueuse/nuxt is installed)
3. **Last Resort**: Use native APIs with SSR guards

**Example:**

```typescript
// ❌ Bad - Direct window usage
if (typeof window !== "undefined") {
  window.addEventListener("resize", handleResize);
}

// ✅ Good - Use VueUse (if available)
import { useWindowSize } from "@vueuse/core";
const { width, height } = useWindowSize();
```

---

## 📝 Git Commit Conventions

Commits must follow this format:

```
<emoji type>: <description>
```

### Supported Types

| Emoji | Type     | Description    |
| ----- | -------- | -------------- |
| ✨    | feat     | New feature    |
| 🐛    | fix      | Bug fix        |
| 🧹    | chore    | Maintenance    |
| 🔨    | refactor | Refactoring    |
| 🧪    | test     | Testing        |
| 🎨    | style    | Styling        |
| 📝    | docs     | Documentation  |
| 📦    | build    | Build system   |
| 👷    | ci       | CI/CD          |
| ⏪    | revert   | Revert         |
| 🚀    | deploy   | Deployment     |
| 🎉    | init     | Initialization |

**Example:** `✨ feat: 加入使用者管理頁面`

---

## 📌 Quick Reference

### Common Commands

```bash
# Development (dev server 已在背景執行，勿重複啟動)
pnpm typecheck                    # 型別檢查
pnpm lint                         # 程式碼檢查
pnpm check                        # 完整檢查

# Testing
pnpm test                         # 全部測試 + coverage
pnpm test:unit                    # 僅單元測試
pnpm vitest run path/to/file.ts  # 單一檔案

# Database
supabase start                    # 啟動本地 Supabase
supabase db reset                 # 重置並套用所有 migration
supabase db lint --level warning  # 檢查安全問題
supabase migration new <name>     # 建立新 migration（禁止手動建立 .sql）
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null
```

### Key Principles

1. Use TypeScript + Composition API + `<script setup>`
2. Follow TDD workflow (Red → Green → Refactor)
3. Prefer TailwindCSS over custom CSS
4. Use named exports
5. Never modify applied migrations
6. Always use `search_path = ''` in database functions
7. Use `@onmax/nuxt-better-auth` for auth, NOT Supabase Auth
8. Client reads, Server writes
