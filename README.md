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

| 技術                                          | 版本 | 說明                         |
| --------------------------------------------- | ---- | ---------------------------- |
| [Nuxt](https://nuxt.com/)                     | 4.x  | Vue 全端框架                 |
| [Vue](https://vuejs.org/)                     | 3.x  | 前端框架（Composition API）  |
| [TypeScript](https://www.typescriptlang.org/) | 5.x  | 型別安全                     |
| [Supabase](https://supabase.com/)             | -    | PostgreSQL + Auth + Realtime |

### UI 與樣式

| 技術                                     | 說明                            |
| ---------------------------------------- | ------------------------------- |
| [Nuxt UI](https://ui.nuxt.com/)          | 官方 UI 元件庫（基於 Tailwind） |
| [Nuxt Charts](https://nuxtcharts.com/)   | 圖表元件（基於 Unovis）         |
| [Tailwind CSS](https://tailwindcss.com/) | Utility-first CSS               |
| [Nuxt Image](https://image.nuxt.com/)    | 圖片最佳化                      |
| [Lucide Icons](https://lucide.dev/)      | 圖示庫                          |

### 認證與狀態

| 技術                                                          | 說明                                  |
| ------------------------------------------------------------- | ------------------------------------- |
| [nuxt-better-auth](https://github.com/onmax/nuxt-better-auth) | OAuth 認證（33+ providers）           |
| [Pinia](https://pinia.vuejs.org/)                             | 狀態管理                              |
| [Pinia Colada](https://pinia-colada.esm.dev/)                 | 非同步資料管理（類似 TanStack Query） |
| [VueUse](https://vueuse.org/)                                 | Vue Composition Utilities             |

### 開發工具

| 技術                                                                                                  | 說明                          |
| ----------------------------------------------------------------------------------------------------- | ----------------------------- |
| [Vitest](https://vitest.dev/) + [@nuxt/test-utils](https://nuxt.com/docs/getting-started/testing)     | 單元與整合測試                |
| [OXLint](https://oxc.rs/docs/guide/usage/linter) + [OXFmt](https://oxc.rs/docs/guide/usage/formatter) | 程式碼品質（Rust 實作，極快） |
| [Supabase CLI](https://supabase.com/docs/guides/cli)                                                  | 本地開發、Migration           |
| [Zod](https://zod.dev/)                                                                               | Schema 驗證                   |
| [Commitlint](https://commitlint.js.org/) + [Husky](https://typicode.github.io/husky/)                 | Git hooks 與 commit 規範      |
| [VitePress](https://vitepress.dev/)                                                                   | 文件網站產生器                |

### 部署與監控

| 平台                                                  | 說明                                        |
| ----------------------------------------------------- | ------------------------------------------- |
| [Cloudflare Workers](https://workers.cloudflare.com/) | Edge 部署                                   |
| [NuxtHub](https://hub.nuxt.com/)                      | SQL、KV、Blob 存儲與快取（Cloudflare 整合） |
| [Sentry](https://sentry.io/)                          | 錯誤追蹤與效能監控                          |

### AI 輔助開發

| 工具                                                                 | 說明                                          |
| -------------------------------------------------------------------- | --------------------------------------------- |
| [Claude Code](https://claude.ai/code)                                | AI 編程助手                                   |
| [Supabase MCP](https://supabase.com/docs/guides/getting-started/mcp) | 讓 AI 直接操作資料庫                          |
| Commands（6 個）                                                     | `/commit`、`/db-migration`、`/opsx:*` 等      |
| SubAgents（3 個）                                                    | `check-runner`、`post-implement`、`db-backup` |
| [Skills](https://skills.sh)（通用 + 專案）                           | `nuxt-ui`、`vue`、`vueuse` 等 AI Skills       |
| 情境 Skills（5 個）                                                  | `supabase-rls`、`supabase-migration` 等       |

---

## 這套配置帶來什麼成功？

這不只是 boilerplate——而是經過驗證的開發環境。照做，你也能得到相同的成效。

### 實際專案數據

| 指標             | 數值      |
| ---------------- | --------- |
| 開發時長         | 2.5 個月  |
| API 端點         | 80 個     |
| Migration 檔案   | 100 個    |
| RLS 政策         | 114 個    |
| Claude Code 對話 | 2,500+ 次 |

### 配置與效果對應

| 配置             | 帶來的效果                    |
| ---------------- | ----------------------------- |
| **CLAUDE.md**    | AI 遵循專案規範，減少修正成本 |
| **TDD 工作流程** | AI 生成的程式碼有測試保護     |
| **自動化檢查**   | 每次提交都通過品質門檻        |
| **AI Skills**    | AI 能正確使用框架 API         |
| **OpenSpec**     | 複雜功能有結構化開發流程      |
| **情境 Skills**  | AI 遵循 Supabase 安全規範     |

### 照做你也能得到

1. 相同的 Tech Stack 配置
2. 相同的 AI 開發工作流程
3. 相同的程式碼品質保證
4. 相同的開發效率提升

---

## Skills 更新機制

### 兩種 Skill 類型

| 類型     | 來源                                                                    | 更新方式             |
| -------- | ----------------------------------------------------------------------- | -------------------- |
| 通用技術 | [skills.sh](https://skills.sh)（`nuxt/ui`、`supabase/agent-skills` 等） | `pnpm skills:update` |
| 情境觸發 | 本地 `.claude/skills/`                                                  | 手動維護             |

### 通用技術 Skills（14 個）

來自 [skills.sh](https://skills.sh) 和專案本地，包含：

- `nuxt-ui`（官方 `nuxt/ui`）、`supabase-postgres-best-practices`、`find-skills`
- `test-driven-development`（`obra/superpowers`）
- `nuxt-better-auth`、`vue`、`vueuse`、`reka-ui`、`motion`
- `nuxthub`、`nuxt-content`、`nuxt-modules`
- `ts-library`、`document-writer`

使用 `pnpm skills:update` 更新通用 skills。

### 情境觸發 Skills（6 個，本地維護）

當特定情境發生時自動載入：

- `supabase-rls`：建立 RLS Policy 時
- `supabase-migration`：建立 migration 時
- `server-api`：建立 Server API 時
- `pinia-store`：建立 Pinia Store 時
- `supabase-arch`：架構決策時
- OpenSpec skills：規劃中大型功能時

這些 skills 是本範本的在地化規範，確保 AI 遵循專案的安全與架構決策。

---

## 文件導覽

**不知道從哪開始？** 參考 [文件導讀指南](./docs/READING_GUIDE.md)。

| 我想要...               | 閱讀這份                                            |
| ----------------------- | --------------------------------------------------- |
| 🆕 **新專案**快速開始   | [QUICK_START.md](./docs/QUICK_START.md)             |
| 🔧 **現有專案**整合配置 | [INTEGRATION_GUIDE.md](./docs/INTEGRATION_GUIDE.md) |
| 了解開發流程            | [WORKFLOW.md](./docs/WORKFLOW.md)                   |
| 查詢常見問題            | [FAQ.md](./docs/FAQ.md)                             |
| 了解 AI 配置            | [CLAUDE_CODE_GUIDE.md](./docs/CLAUDE_CODE_GUIDE.md) |
| 查閱系統狀態            | [docs/verify/](./docs/verify/)                      |

<details>
<summary>完整文件清單</summary>

| 文件                                                         | 說明                               | 適合閱讀時機       |
| ------------------------------------------------------------ | ---------------------------------- | ------------------ |
| **[README.md](./README.md)**                                 | Tech Stack、核心概念               | 剛接觸這個範本     |
| **[docs/READING_GUIDE.md](./docs/READING_GUIDE.md)**         | 文件分類與閱讀順序                 | 不知道從哪開始     |
| **[docs/FAQ.md](./docs/FAQ.md)**                             | 常見疑問集                         | 有具體問題         |
| **[docs/QUICK_START.md](./docs/QUICK_START.md)**             | 新專案安裝與設定步驟               | 要從零開始         |
| **[docs/INTEGRATION_GUIDE.md](./docs/INTEGRATION_GUIDE.md)** | 現有專案整合 Claude/Supabase       | 要整合到現有專案   |
| **[docs/SUPABASE_GUIDE.md](./docs/SUPABASE_GUIDE.md)**       | Supabase 入門、RLS 詳解、Migration | 第一次用 Supabase  |
| **[docs/WORKFLOW.md](./docs/WORKFLOW.md)**                   | TDD、自動化檢查、Git 規範          | 想了解開發流程     |
| **[docs/OPENSPEC.md](./docs/OPENSPEC.md)**                   | OpenSpec 工作流程詳解              | 要用 AI 輔助開發   |
| **[docs/CLAUDE_CODE_GUIDE.md](./docs/CLAUDE_CODE_GUIDE.md)** | Claude Code 配置指南               | 要了解 AI 工具     |
| **[docs/SUPABASE_MCP.md](./docs/SUPABASE_MCP.md)**           | Supabase MCP 整合                  | 要讓 AI 操作資料庫 |
| **[docs/API_PATTERNS.md](./docs/API_PATTERNS.md)**           | Server API 設計模式                | 要寫後端 API       |
| **[CLAUDE.md](./CLAUDE.md)**                                 | AI 開發規範（給 Claude Code）      | 要客製化 AI 行為   |
| **[docs/verify/](./docs/verify/)**                           | 系統狀態文件（Auth、API、DB）      | 要了解架構細節     |

</details>

---

## 為什麼選這套 Stack？

### Supabase：不只是「Firebase 替代品」

| 你需要   | Supabase 提供            | 傳統做法                |
| -------- | ------------------------ | ----------------------- |
| 資料庫   | PostgreSQL（業界標準）   | 自己架、管理、備份      |
| 權限控制 | Row Level Security (RLS) | 每個 API 都要寫權限檢查 |
| 即時更新 | Realtime subscriptions   | 自己架 WebSocket        |
| 本地開發 | Docker 容器，一鍵啟動    | 設定開發環境            |

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
  body: { title: 'Buy milk' },
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

### OpenSpec 工作流程

對於較複雜的功能：

```
/opsx:new          # 建立變更提案（產生 proposal, design, tasks）
/opsx:apply        # 執行任務清單
/opsx:archive      # 歸檔完成的變更
```

> 📖 詳細說明見 [docs/OPENSPEC.md](./docs/OPENSPEC.md)

### 自動化檢查

```bash
pnpm check  # format → lint → typecheck → test
```

### 自動串接

Skills 會自動串接，減少手動操作：

| 完成            | 自動觸發                   |
| --------------- | -------------------------- |
| TDD 流程完成    | check-runner → 詢問 commit |
| `/commit`       | **先**執行 check-runner    |
| `/db-migration` | 產生 TypeScript 類型       |
| `/opsx:apply`   | check-runner → 詢問 commit |

> 📖 完整工作流程見 [docs/WORKFLOW.md](./docs/WORKFLOW.md)

---

## 目錄結構

```
├── CLAUDE.md                 # AI 開發規範
├── docs/                     # 詳細文件
│   ├── SUPABASE_GUIDE.md    # Supabase 入門
│   ├── WORKFLOW.md          # 開發工作流程
│   ├── OPENSPEC.md          # OpenSpec 工作流程
│   └── API_PATTERNS.md      # API 設計模式
│
├── .claude/                  # Claude Code 配置
│   ├── commands/            # 自定義命令（含 opsx/）
│   ├── agents/              # SubAgents
│   ├── hooks/               # 自動化腳本
│   ├── skills/              # AI Skills
│   └── settings.local.json.example
│
├── openspec/                 # OpenSpec 工作流程
│   ├── project.md           # 專案上下文
│   ├── specs/               # 系統規格（真相來源）
│   └── changes/             # 變更提案區
│
├── .github/                  # GitHub prompts
│
└── server/utils/
    └── supabase.ts          # Server 端 Supabase client
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

## AI 輔助效率

| 任務類型  | AI 幫助程度               |
| --------- | ------------------------- |
| CRUD API  | ⭐⭐⭐⭐⭐ 幾乎全自動     |
| Migration | ⭐⭐⭐⭐ 需人工審查安全性 |
| 測試撰寫  | ⭐⭐⭐⭐ 案例需人工設計   |
| 架構決策  | ⭐⭐⭐ 需人工主導         |

---

## 下一步

### 新專案

1. **[快速開始](./docs/QUICK_START.md)**：clone、跑起來
2. **[Supabase 入門](./docs/SUPABASE_GUIDE.md)**：建立第一個資料表
3. **[API 設計](./docs/API_PATTERNS.md)**：寫你的第一個 CRUD API
4. **[OpenSpec](./docs/OPENSPEC.md)**：用 AI 輔助開發一個功能

### 現有專案

1. **[整合指南](./docs/INTEGRATION_GUIDE.md)**：將 Claude/Supabase 配置注入現有專案
2. 根據需要選擇整合項目（Claude 配置、Supabase、Better Auth）

有問題歡迎開 issue。

---

## License

[MIT](./LICENSE) © [YuDefine - 域定資訊工作室](https://github.com/YuDefine)
