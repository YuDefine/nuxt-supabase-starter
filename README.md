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

## 文件導覽

| 文件 | 說明 | 適合閱讀時機 |
|------|------|-------------|
| **[README.md](./README.md)** | 快速開始、核心概念 | 剛接觸這個範本 |
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

### 1. 建立專案

```bash
git clone https://github.com/anthropics/nuxt-supabase-starter my-project
cd my-project
pnpm install
cp .env.example .env
```

### 2. 啟動 Supabase

```bash
supabase start
# 會輸出 API URL 和 keys，填入 .env
```

### 3. 開始開發

```bash
pnpm dev
```

### 4. 建立第一個資料表

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
├── .github/                  # GitHub Agent/Prompts
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
