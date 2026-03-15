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

### Better Auth vs Supabase Auth

本專案使用 Supabase 作為資料庫，但**認證系統刻意不使用 Supabase Auth**，而是選擇 [Better Auth](https://www.better-auth.com/)。

| 面向         | Supabase Auth                   | Better Auth                        |
| ------------ | ------------------------------- | ---------------------------------- |
| OAuth 支援   | ~10 providers                   | 33+ providers（含 LINE、微信等）   |
| 部署耦合     | 綁定 Supabase 服務              | 獨立運作，不依賴特定 BaaS          |
| Session 管理 | JWT token（需處理 refresh）     | Server-side session（更簡單安全）  |
| Nuxt 整合    | `@nuxtjs/supabase` 混合 Auth+DB | `@onmax/nuxt-better-auth` 專職認證 |
| 遷移彈性     | 遷移需重寫認證邏輯              | 換資料庫不影響認證                 |

**選擇原因**：

1. **關注點分離**：Supabase 負責資料庫，Better Auth 負責認證，各司其職
2. **Provider 覆蓋**：Better Auth 支援更多 OAuth provider，特別是亞洲市場常用的 LINE Login
3. **遷移自由**：未來若從 Supabase 遷移到其他資料庫，認證系統不需要重寫

### OXLint + OXFmt vs ESLint + Prettier

| 面向     | ESLint + Prettier      | OXLint + OXFmt             |
| -------- | ---------------------- | -------------------------- |
| 語言     | JavaScript             | Rust                       |
| 速度     | 基準                   | Lint 快 50-100x、Format 快 |
| 設定檔   | 需要 eslint.config.js  | 零設定或極少設定           |
| 生態系   | 龐大（數千 plugins）   | 成長中，涵蓋主流規則       |
| Vue 支援 | 需要 eslint-plugin-vue | 內建                       |

**選擇原因**：

1. **速度**：OXC 工具鏈用 Rust 編寫，lint 速度是 ESLint 的 50-100 倍，開發體驗更流暢
2. **簡化配置**：不需要維護複雜的 ESLint 配置和 plugin 組合
3. **趨勢**：Vue/Nuxt 生態正在擁抱 OXC 工具鏈，Nuxt 官方已開始支援

### Pinia Colada vs TanStack Query

| 面向     | 直接用 Pinia | Pinia Colada                    | TanStack Query       |
| -------- | ------------ | ------------------------------- | -------------------- |
| 定位     | 狀態管理     | Pinia 的非同步資料層            | 獨立的非同步資料管理 |
| Vue 整合 | 原生         | 原生（基於 Pinia）              | 透過 adapter         |
| 快取策略 | 手動實作     | 自動（staleTime、gcTime）       | 自動                 |
| Mutation | 手動實作     | `useMutation` + 自動 invalidate | `useMutation`        |
| 與 Pinia | 本身就是     | 無縫整合，共享 DevTools         | 獨立系統，需橋接     |
| SSR 支援 | 原生         | 原生                            | 需額外設定           |

**選擇原因**：

1. **生態一致性**：Pinia Colada 由 Pinia 作者（Eduardo San Martin Morote）開發，與 Pinia 無縫整合
2. **DevTools 統一**：在 Vue DevTools 中可同時查看 Pinia store 和 Colada 的查詢狀態
3. **學習曲線**：如果已經會 Pinia，Colada 的 API 風格一致，上手更快
4. **功能足夠**：提供自動快取、stale 管理、mutation、query invalidation 等非同步資料管理所需的核心功能

### SPA 模式（SSR 關閉）

本專案設定 `ssr: false`，以 SPA（Single Page Application）模式運行。

| 面向       | SSR 模式                         | SPA 模式（本專案）            |
| ---------- | -------------------------------- | ----------------------------- |
| 首次載入   | Server 渲染 HTML，較快           | Client 端渲染，需載入 JS      |
| SEO        | 天然友好                         | 需 prerender 或爬蟲支援       |
| 部署目標   | 需要 Node.js runtime             | 純靜態 + API，適合 Edge       |
| 複雜度     | 需處理 hydration、SSR 相容性     | 不需要，開發更簡單            |
| Cloudflare | Workers 有 CPU 限制（10ms 免費） | 靜態資源 + API 分離，更省資源 |

**選擇原因**：

1. **部署目標**：Cloudflare Workers 的免費方案 CPU 時間僅 10ms，SSR 會消耗寶貴的 CPU quota
2. **應用類型**：本範本定位為「登入後使用的管理系統」，不需要 SEO；Landing page 可另外用靜態站處理
3. **開發簡化**：避免 hydration mismatch、SSR 相容性等問題，降低開發門檻
4. **效能取捨**：登入後的管理系統首次載入稍慢可接受，後續頁面切換更快

> **注意**：如果你的專案需要 SEO（如部落格、電商），可將 `ssr` 改為 `true` 並調整部署設定。

### Cloudflare Workers vs 其他部署平台

| 面向      | Vercel           | Netlify        | Cloudflare Workers       |
| --------- | ---------------- | -------------- | ------------------------ |
| 免費方案  | 100GB 頻寬       | 100GB 頻寬     | 10 萬次請求/天           |
| Edge      | Edge Functions   | Edge Functions | 原生 Edge                |
| 冷啟動    | 有               | 有             | 幾乎沒有                 |
| Nuxt 支援 | 透過 preset      | 透過 preset    | 透過 preset              |
| 額外服務  | KV、Blob（付費） | Blob（付費）   | KV、R2、D1（有免費額度） |
| 費用      | Pro $20/月       | Pro $19/月     | Workers Paid $5/月       |

**選擇原因**：

1. **成本優勢**：付費方案僅 $5/月（無限請求），遠低於 Vercel/Netlify
2. **Edge 原生**：Cloudflare Workers 是原生 Edge runtime，冷啟動極快
3. **生態整合**：搭配 NuxtHub 可使用 KV、R2、D1 等 Cloudflare 服務
4. **全球網路**：Cloudflare 在全球 300+ 個節點部署，延遲極低
