# Tech Stack 詳細說明

完整技術棧介紹與選型理由。

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

| 工具                                                                 | 說明                                       |
| -------------------------------------------------------------------- | ------------------------------------------ |
| [Claude Code](https://claude.ai/code)                                | AI 編程助手                                |
| [Supabase MCP](https://supabase.com/docs/guides/getting-started/mcp) | 讓 AI 直接操作資料庫                       |
| Commands（16 個）                                                    | 4 共用 + 12 Spectra                        |
| SubAgents（3 個）                                                    | `check-runner`、`code-review`、`db-backup` |
| [Skills](https://skills.sh)（通用 26 + 情境 5）                      | `nuxt-ui`、`vue`、`vueuse` 等 AI Skills    |
| SDD Skills（12 個）                                                  | Spectra（`spectra-*`）                     |

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

> 📖 詳細說明見 [docs/SUPABASE_GUIDE.md](./SUPABASE_GUIDE.md)
