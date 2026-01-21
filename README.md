# Nuxt + Supabase 快速開發範本

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 這是什麼？

如果你已經熟悉 Nuxt，想要快速建立**有後端、有資料庫、有認證、可部署**的完整專案，這個範本能幫你在幾天內完成通常需要幾週的工作。

這不只是一個 boilerplate——它包含了我在 2.5 個月內開發一個中型企業系統的所有經驗：
- 426 次 commit、80 個 API 端點、100 個資料庫 migration
- 與 Claude Opus 4.5 協作的 2,500+ 次對話
- 踩過的坑、驗證過的模式、避免的反模式

**目標讀者**：有 Nuxt/Vue 經驗，想嘗試 Supabase 或想要一套可靠的全端開發工作流程的開發者。

---

## Tech Stack

### 核心框架

| 技術 | 版本 | 說明 |
|------|------|------|
| [Nuxt](https://nuxt.com/) | 4.x | Vue 全端框架 |
| [Vue](https://vuejs.org/) | 3.x | 前端框架（Composition API） |
| [TypeScript](https://www.typescriptlang.org/) | 5.x | 型別安全 |
| [Supabase](https://supabase.com/) | - | PostgreSQL + Auth + Realtime |

### UI 與樣式

| 技術 | 說明 |
|------|------|
| [Nuxt UI](https://ui.nuxt.com/) | 官方 UI 元件庫（基於 Tailwind） |
| [Nuxt UI Charts](https://ui.nuxt.com/charts) | 圖表元件（基於 Reka UI） |
| [Tailwind CSS](https://tailwindcss.com/) | Utility-first CSS |
| [Nuxt Image](https://image.nuxt.com/) | 圖片最佳化 |
| [Lucide Icons](https://lucide.dev/) | 圖示庫 |

### 認證與狀態

| 技術 | 說明 |
|------|------|
| [nuxt-better-auth](https://github.com/onmax/nuxt-better-auth) | OAuth 認證（33+ providers） |
| [Pinia](https://pinia.vuejs.org/) | 狀態管理 |
| [Pinia Colada](https://pinia-colada.esm.dev/) | 非同步資料管理（類似 TanStack Query） |
| [VueUse](https://vueuse.org/) | Vue Composition Utilities |

### 開發工具

| 技術 | 說明 |
|------|------|
| [Vitest](https://vitest.dev/) | 單元測試 |
| [OXLint](https://oxc.rs/docs/guide/usage/linter) + [OXFmt](https://oxc.rs/docs/guide/usage/formatter) | 程式碼品質（Rust 實作，極快） |
| [Supabase CLI](https://supabase.com/docs/guides/cli) | 本地開發、Migration |
| [Zod](https://zod.dev/) | Schema 驗證 |
| [Commitlint](https://commitlint.js.org/) + [Husky](https://typicode.github.io/husky/) | Git hooks 與 commit 規範 |
| [VitePress](https://vitepress.dev/) | 文件網站產生器 |

### 部署與監控

| 平台 | 說明 |
|------|------|
| [Cloudflare Workers](https://workers.cloudflare.com/) | Edge 部署 |
| [NuxtHub](https://hub.nuxt.com/) | SQL、KV、Blob 存儲與快取（Cloudflare 整合） |
| [Sentry](https://sentry.io/) | 錯誤追蹤與效能監控 |

### AI 輔助開發

| 工具 | 說明 |
|------|------|
| [Claude Code](https://claude.ai/code) | AI 編程助手 |
| Commands（13 個） | `/tdd`、`/commit`、`/db-migration`、`/speckit.*` 等 |
| SubAgents（3 個） | `check-runner`、`post-implement`、`db-backup` |
| [nuxt-skills](https://github.com/onmax/nuxt-skills)（12 個） | `nuxt`、`nuxt-ui`、`vue`、`vueuse` 等 AI Skills |

---

## 文件導覽

| 文件 | 說明 | 適合閱讀時機 |
|------|------|-------------|
| **[README.md](./README.md)** | 快速開始、Tech Stack | 剛接觸這個範本 |
| **[docs/SUPABASE_GUIDE.md](./docs/SUPABASE_GUIDE.md)** | Supabase 入門、RLS 詳解、Migration | 第一次用 Supabase |
| **[docs/WORKFLOW.md](./docs/WORKFLOW.md)** | TDD、自動化檢查、Git 規範 | 想了解開發流程 |
| **[docs/SPEC_KIT.md](./docs/SPEC_KIT.md)** | spec-kit 命令詳解 | 要用 AI 輔助開發 |
| **[docs/API_PATTERNS.md](./docs/API_PATTERNS.md)** | Server API 設計模式 | 要寫後端 API |
| **[CLAUDE.md](./CLAUDE.md)** | AI 開發規範（給 Claude Code） | 要客製化 AI 行為 |

---

## 為什麼選這套 Stack？

### Supabase：不只是「Firebase 替代品」

| 你需要 | Supabase 提供 | 傳統做法 |
|--------|--------------|----------|
| 資料庫 | PostgreSQL（業界標準） | 自己架、管理、備份 |
| 權限控制 | Row Level Security (RLS) | 每個 API 都要寫權限檢查 |
| 即時更新 | Realtime subscriptions | 自己架 WebSocket |
| 本地開發 | Docker 容器，一鍵啟動 | 設定開發環境 |

### RLS：權限控制的革命

**傳統做法**：每個 API 都要寫權限檢查
```typescript
app.get('/posts/:id', async (req, res) => {
  const post = await db.posts.findById(req.params.id)
  if (post.userId !== req.user.id) {
    return res.status(403).send('Forbidden')
  }
  // ...
})
```

**RLS 做法**：在資料庫層定義一次，所有查詢自動套用
```sql
CREATE POLICY "Users can view own posts"
  ON posts FOR SELECT
  USING (user_id = auth.uid());
```

> 📖 詳細說明見 [docs/SUPABASE_GUIDE.md](./docs/SUPABASE_GUIDE.md)

---

## 快速開始

### 前置條件

- Node.js 20+
- pnpm（`corepack enable`）
- Docker（給 Supabase 本地開發用）
- [Supabase CLI](https://supabase.com/docs/guides/cli)

### 方法一：使用此範本建立新專案

```bash
# 1. 從 GitHub 複製範本
git clone https://github.com/Charles5277/nuxt-supabase-starter my-project
cd my-project

# 2. 移除原始 git 歷史，建立自己的
rm -rf .git
git init

# 3. 安裝依賴
pnpm install

# 4. 設定環境變數
cp .env.example .env
# 編輯 .env，填入必要的值

# 5. 啟動 Supabase 本地開發環境
supabase start
# 會輸出 API URL 和 keys，填入 .env

# 6. 啟動開發伺服器
pnpm dev
```

### 方法二：整合到現有專案

如果你已有 Nuxt 專案，可以只複製需要的部分：

```bash
# 複製 AI 開發配置
cp -r nuxt-supabase-starter/.claude your-project/
cp -r nuxt-supabase-starter/.specify your-project/
cp nuxt-supabase-starter/CLAUDE.md your-project/

# 複製文件（可選）
cp -r nuxt-supabase-starter/docs your-project/
```

### 環境變數設定

`.env.example` 已包含所有需要的變數：

```bash
# 必要
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon_key>              # supabase start 會輸出
SUPABASE_SECRET_KEY=<service_role>   # supabase start 會輸出
NUXT_SESSION_PASSWORD=<32字元隨機字串>  # openssl rand -base64 32

# OAuth（選擇需要的）
NUXT_OAUTH_GOOGLE_CLIENT_ID=
NUXT_OAUTH_GOOGLE_CLIENT_SECRET=
# ... 其他 providers
```

### 建立第一個資料表

```bash
supabase migration new create_todos_table
# 編輯產生的 SQL 檔案
supabase db reset
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null
```

> 📖 完整步驟見 [docs/SUPABASE_GUIDE.md](./docs/SUPABASE_GUIDE.md)

---

## 核心概念

### 資料存取：Client 讀、Server 寫

這是本範本最重要的架構決策。

```typescript
// ✅ Client 端直接查詢（RLS 保護）
const client = useSupabaseClient<Database>()
const { data } = await client.schema('app').from('todos').select('*')

// ✅ 寫入走 Server API
await $fetch('/api/v1/todos', {
  method: 'POST',
  body: { title: 'Buy milk' }
})
```

> 📖 API 設計模式見 [docs/API_PATTERNS.md](./docs/API_PATTERNS.md)

### 認證：nuxt-better-auth

本範本使用 `@onmax/nuxt-better-auth`，支援 33+ OAuth providers：

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@onmax/nuxt-better-auth'],
  routeRules: {
    '/dashboard/**': { auth: 'user' },
  },
})

// 在元件中使用
const { user, loggedIn, signIn, signOut } = useUserSession()
await signIn('google')
```

---

## 開發工作流程

### TDD + AI 輔助

```
1. Red    → 先寫測試（會失敗）
2. Green  → 寫最少的程式碼讓測試通過
3. Refactor → 改善程式碼品質
```

當你用 AI 輔助開發時，測試就是「驗收標準」——AI 寫的程式碼能不能用？跑一次測試就知道。

### spec-kit 工作流程

對於較複雜的功能：

```
/speckit.specify   # 從自然語言產生規格
/speckit.plan      # 產生實作計畫
/speckit.tasks     # 產生任務清單
/speckit.implement # 逐步執行
```

> 📖 詳細說明見 [docs/SPEC_KIT.md](./docs/SPEC_KIT.md)

### 自動化檢查

```bash
pnpm check  # format → lint → typecheck → test
```

### 自動串接

Skills 會自動串接，減少手動操作：

| 完成 | 自動觸發 |
|------|---------|
| `/tdd` | check-runner → 詢問 commit |
| `/commit` | **先**執行 check-runner |
| `/db-migration` | 產生 TypeScript 類型 |
| `/speckit.implement` | check-runner → 詢問 commit |

> 📖 完整工作流程見 [docs/WORKFLOW.md](./docs/WORKFLOW.md)

---

## 目錄結構

```
├── CLAUDE.md                 # AI 開發規範
├── docs/                     # 詳細文件
│   ├── SUPABASE_GUIDE.md    # Supabase 入門
│   ├── WORKFLOW.md          # 開發工作流程
│   ├── SPEC_KIT.md          # spec-kit 使用指南
│   └── API_PATTERNS.md      # API 設計模式
│
├── .claude/                  # Claude Code 配置
│   ├── commands/            # 13 個命令
│   ├── agents/              # 3 個 SubAgent
│   └── skills/              # 12 個 AI Skills (nuxt-skills)
│
├── .specify/                 # spec-kit 工作流程
│   ├── memory/              # 專案原則
│   ├── templates/           # 文件範本
│   └── scripts/             # 自動化腳本
│
├── .github/                  # GitHub prompts
│
└── server/utils/
    └── supabase.ts.example  # Server 端工具函式
```

---

## 常見問題

### Q: 我需要付費嗎？

本地開發完全免費。Supabase 免費方案：500MB 資料庫、50K 月活躍使用者。

### Q: RLS 會影響效能嗎？

如果用 `(SELECT ...)` 包裝函式呼叫，不會。詳見 [SUPABASE_GUIDE.md](./docs/SUPABASE_GUIDE.md#效能優化)。

### Q: 這套流程適合團隊嗎？

適合。CLAUDE.md 是共享規範，Migration 有版本控制。

### Q: 我可以不用 Claude Code 嗎？

可以。`.claude/` 配置是可選的，核心的 Nuxt + Supabase 結構不依賴任何 AI 工具。

### Q: 如何部署到 Production？

1. 在 [Supabase Dashboard](https://supabase.com/dashboard) 建立專案
2. `supabase link --project-ref <your-project-ref>`
3. `supabase db push`
4. 部署到 Cloudflare Workers（使用 `wrangler deploy` 或 CI/CD）

---

## 參考專案數據

這套工作流程在 <consumer-b> 專案中的實際表現：

| 指標 | 數值 |
|------|------|
| 開發時長 | 2.5 個月 |
| API 端點 | 80 個 |
| Migration 檔案 | 100 個 |
| RLS 政策 | 114 個 |
| Claude Code 對話 | 2,514 次 |

**AI 輔助效率**：

| 任務類型 | AI 幫助程度 |
|----------|------------|
| CRUD API | ⭐⭐⭐⭐⭐ 幾乎全自動 |
| Migration | ⭐⭐⭐⭐ 需人工審查安全性 |
| 測試撰寫 | ⭐⭐⭐⭐ 案例需人工設計 |
| 架構決策 | ⭐⭐⭐ 需人工主導 |

---

## 下一步

1. **[快速開始](#快速開始)**：clone、跑起來
2. **[Supabase 入門](./docs/SUPABASE_GUIDE.md)**：建立第一個資料表
3. **[API 設計](./docs/API_PATTERNS.md)**：寫你的第一個 CRUD API
4. **[spec-kit](./docs/SPEC_KIT.md)**：用 AI 輔助開發一個功能

有問題歡迎開 issue。

---

## License

MIT
