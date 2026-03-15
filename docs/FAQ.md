# 常見疑問集（FAQ）

開發過程中常見問題的集中解答。

---

## 工具選擇類

### Spectra vs Plan Mode：何時使用哪個？

**Spectra** 適合複雜功能（3+ 個檔案變更、需追蹤規格演進、多人協作），提供三階段流程（propose → apply → archive）與完整歸檔。**Plan Mode** 適合小修改、需求明確的場景。Bug 修復或緊急部署可直接實作。

詳細比較與指令說明請參考 [OPENSPEC.md](OPENSPEC.md)。

---

### VitePress 在專案中的意義？

**用途**：將 `docs/` 目錄的 Markdown 轉換為可瀏覽的文件網站。

**為什麼要用？**

- 方便分享給團隊成員
- 提供搜尋功能
- 更好的閱讀體驗

**命令**：

```bash
pnpm docs:dev    # 本地預覽（http://localhost:5173）
pnpm docs:build  # 建置靜態網站
```

**目前狀態**：使用 VitePress 預設配置。如需客製化，可建立 `.vitepress/config.ts`。

---

### nuxt-skills 如何自動更新？

**兩種 Skill 類型**：

| 類型        | 數量  | 更新方式                                  |
| ----------- | ----- | ----------------------------------------- |
| 通用 Skills | 26 個 | 全部第三方，`pnpm skills:update` 自動更新 |
| 情境 Skills | 5 個  | 本地維護，手動更新                        |
| SDD Skills  | 12 個 | Spectra（`spectra-*`）                    |

**第三方 Skills 更新流程**：

1. 執行 `pnpm skills:update`（使用 [skills.sh](https://skills.sh) CLI）
2. 從各 GitHub repo 拉取最新版本
3. 更新到 `.claude/skills/` 目錄
4. 重啟 Claude Code CLI

**情境 Skills 何時需要更新？**

- 專案架構變更時
- 發現更好的實踐模式時
- RLS/Migration 規則調整時

---

### Claude Code 需要付費嗎？推薦什麼方案？

**推薦方案**：[Claude Code Max](https://claude.ai/code)（每月 $100 美元起）

**為什麼？**

本範本大量使用 Claude Opus 模型進行：

- 複雜的程式碼生成與重構
- 多檔案同時編輯
- 資料庫 migration 設計
- Spectra 結構化開發

| 方案       | 每月費用 | Opus 用量 | 適合                 |
| ---------- | -------- | --------- | -------------------- |
| Pro        | $20      | 有限      | 輕度使用、學習       |
| **Max 5x** | **$100** | **充足**  | **日常開發**（推薦） |
| Max 20x    | $200     | 大量      | 密集開發、團隊共用   |

> **實際經驗**：密集開發時 Pro 方案會頻繁遇到 Opus 配額限制，被迫切換到 Sonnet 模型。Max 5x 方案足以支撐日常開發。

---

### Commands、Agents、Skills 的差別？

| 類型         | 觸發方式                  | 用途         | 範例                                           |
| ------------ | ------------------------- | ------------ | ---------------------------------------------- |
| **Commands** | 使用者輸入 `/xxx`         | 執行特定流程 | `/commit`, `/db-migration`, `/spectra:propose` |
| **Agents**   | 自動觸發或被 Command 呼叫 | 執行子任務   | check-runner, code-review, db-backup           |
| **Skills**   | 自動偵測情境載入          | 提供專業知識 | supabase-rls, server-api                       |

**類比**：

- Commands = 你下達的指令
- Agents = 執行指令的機器人
- Skills = 機器人的專業知識

---

## 開發實務類

### Client 和 Server 如何分工？

**核心原則**：**Client 讀、Server 寫**

| 操作     | 位置   | 方式                                                    |
| -------- | ------ | ------------------------------------------------------- |
| **讀取** | Client | `useSupabaseClient<Database>().from('table').select()`  |
| **寫入** | Server | `$fetch('/api/v1/resources', { method: 'POST', body })` |

**為什麼？**

1. RLS 已保護讀取操作
2. 寫入需要集中管理（權限檢查、日誌、業務邏輯）
3. 讀多寫少，Client 直連減少延遲

**詳細說明**：見 [CLAUDE.md](../CLAUDE.md#-supabase-資料存取策略)

---

### 認證該用什麼 API？

**正確方式**：

```typescript
// Client 端
const { user, loggedIn, signIn, signOut } = useUserSession()

// Server 端
// 使用 better-auth 提供的方式取得 session
```

**錯誤方式**（絕對禁止）：

```typescript
// ❌ 這是舊的 Supabase Auth，本專案不使用
const user = useSupabaseUser()
const user = await serverSupabaseUser(event)
```

**詳細說明**：見 [AUTH_INTEGRATION.md](verify/AUTH_INTEGRATION.md)

---

### Migration 怎麼建立？

**Local-First 原則**：所有 migration 必須先在本地建立、測試通過後，再 push 到 remote。

```bash
# 1. 建立 migration
supabase migration new add_user_roles

# 2. 編輯 migration 檔案（在 supabase/migrations/ 下）

# 3. 本地測試
supabase db reset

# 4. 安全檢查
supabase db lint --level warning

# 5. 重新產生類型
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null

# 6. 最後才 push
supabase db push
```

**禁止事項**：

- ❌ 不要手動建立 `.sql` 檔案
- ❌ 不要用 `mcp__remote-supabase__apply_migration`
- ❌ 不要修改已套用的 migration

**詳細說明**：見 [SUPABASE_MIGRATION_GUIDE.md](verify/SUPABASE_MIGRATION_GUIDE.md)

---

### RLS Policy 要注意什麼？

**關鍵重點**：API 寫入操作的 RLS policy 必須包含 `service_role` 繞過！

```sql
CREATE POLICY "Allow manager update" ON your_schema.table FOR UPDATE
USING (
  (SELECT auth.role()) = 'service_role'  -- ⚠️ 必須加這行！
  OR your_schema.current_user_role() IN ('admin', 'manager')
);
```

**詳細說明**：見 [RLS_BEST_PRACTICES.md](verify/RLS_BEST_PRACTICES.md)

---

### Function 的 search_path 要怎麼設定？

**必須使用空字串**：

```sql
CREATE OR REPLACE FUNCTION your_schema.my_function()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''  -- 必須是空字串！
AS $$ BEGIN
  SELECT * FROM your_schema.users WHERE id = auth.uid();
END; $$;
```

**禁止**：`SET search_path = public, pg_temp`

---

## 疑難排解類

### Toast 成功但資料沒變

**原因**：缺少對應的 RLS policy

**解決**：

1. 檢查是否有該操作（INSERT/UPDATE/DELETE）的 RLS policy
2. 確認 policy 包含 `service_role` 繞過
3. 使用 `supabase db lint --level warning` 檢查

> 📖 完整診斷：[TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

### API 回傳 HTML 而非 JSON

**原因**：路由衝突

**常見情況**：同目錄下同時存在 `[id].ts` 和 `[id]/xxx.ts`

**解決**：調整路由結構，避免衝突

> 📖 完整診斷：[TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

### pnpm check 失敗

**原因**：可能是 format、lint、typecheck 或 test 任一環節失敗

**解決**：

1. 看錯誤訊息判斷是哪個環節
2. 逐一修復
3. 重新執行 `pnpm check`

**各環節單獨執行**：

```bash
pnpm format     # 格式化
pnpm lint       # Lint 檢查
pnpm typecheck  # 類型檢查
pnpm test       # 測試
```

> 📖 完整診斷：[TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

### Supabase 本地環境連不上

**檢查清單**：

1. Docker 是否在運行？
2. 執行 `supabase status` 確認服務狀態
3. 檢查 `.env` 的 `SUPABASE_URL` 是否正確（應為 `http://127.0.0.1:54321`）

**重啟方式**：

```bash
supabase stop
supabase start
```

> 📖 完整診斷：[TROUBLESHOOTING.md](TROUBLESHOOTING.md#1-supabase-start-失敗)

---

### 類型錯誤：找不到 Database 類型

**原因**：`app/types/database.types.ts` 可能過時或不存在

**解決**：

```bash
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null
```

> 📖 完整診斷：[TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## 架構決策類

### 該用 RPC 還是 Edge Function？

**快速決策**：

| 情境              | 推薦          |
| ----------------- | ------------- |
| 純資料庫操作      | RPC           |
| 需要外部 API 呼叫 | Edge Function |
| 需要複雜業務邏輯  | Edge Function |
| 效能敏感的查詢    | RPC           |
| 需要檔案處理      | Edge Function |

**詳細決策樹**：見 `.claude/skills/supabase-arch/SKILL.md`

---

### Pinia Store 該怎麼設計？

**核心原則**：

- 使用 Composition API 風格
- State 使用 `readonly()` 保護
- 透過 actions 修改 state

**範例**：見 [PINIA_ARCHITECTURE.md](verify/PINIA_ARCHITECTURE.md)

---

---

## 技術選型類

### SSR 為什麼關掉了？

本專案設定 `ssr: false`（SPA 模式），原因：

1. **部署目標**：Cloudflare Workers 免費方案 CPU 時間僅 10ms，SSR 會消耗寶貴資源
2. **應用類型**：定位為「登入後的管理系統」，不需要 SEO
3. **開發簡化**：避免 hydration mismatch、SSR 相容性等問題

如果你的專案需要 SEO（如部落格、電商），可將 `nuxt.config.ts` 中的 `ssr` 改為 `true`。

> 📖 詳細比較：[TECH_STACK.md](TECH_STACK.md#spa-模式ssr-關閉)

---

### 為什麼用 OXLint 不用 ESLint？

**速度**。OXLint 用 Rust 編寫，lint 速度是 ESLint 的 50-100 倍。

| 面向 | ESLint + Prettier       | OXLint + OXFmt       |
| ---- | ----------------------- | -------------------- |
| 速度 | 基準                    | 快 50-100x           |
| 設定 | 需維護 config + plugins | 零設定或極少設定     |
| 生態 | 龐大                    | 成長中，涵蓋主流規則 |

Vue/Nuxt 生態正在擁抱 OXC 工具鏈。如果你需要特定 ESLint plugin 的功能，兩者可以並存。

> 📖 詳細比較：[TECH_STACK.md](TECH_STACK.md#oxlint--oxfmt-vs-eslint--prettier)

---

### Pinia Colada 和普通 Pinia 有什麼不同？

**Pinia** 是狀態管理（類似 Vuex），**Pinia Colada** 是 Pinia 的非同步資料管理層（類似 TanStack Query）。

- **Pinia**：管理本地狀態（使用者偏好、UI 狀態等）
- **Pinia Colada**：管理 Server 資料（自動快取、stale 管理、mutation + invalidation）

本專案兩者搭配使用：Pinia 管理 client state，Colada 管理 server state。Colada 由 Pinia 作者開發，API 風格一致，與 Vue DevTools 無縫整合。

> 📖 詳細比較：[TECH_STACK.md](TECH_STACK.md#pinia-colada-vs-tanstack-query)

---

### Nuxt UI v3 和 v4 有什麼差？

本專案使用 **Nuxt UI v3**（`@nuxt/ui` v3.x，基於 Tailwind CSS v4 + Reka UI）。

| 面向     | Nuxt UI v2      | Nuxt UI v3（本專案） |
| -------- | --------------- | -------------------- |
| CSS 框架 | Tailwind CSS v3 | Tailwind CSS v4      |
| 底層元件 | Headless UI     | Reka UI              |
| 主題系統 | `app.config.ts` | CSS 變數 + Tailwind  |
| Vue 版本 | Vue 3           | Vue 3                |

**注意**：v2 和 v3 的元件 API 有差異，搜尋教學時請確認是 v3 版本的文件。Nuxt UI 官方文件：[ui.nuxt.com](https://ui.nuxt.com/)

---

## 客製化類

### 如何移除不需要的功能？

本 Starter 的功能是模組化的，可按需移除：

**不需要 Supabase（純前端）**：

1. 移除 `@nuxtjs/supabase` 和 `@supabase/supabase-js`
2. 從 `nuxt.config.ts` 移除 supabase 模組
3. 刪除 `supabase/` 目錄和 `server/utils/supabase.ts`
4. 刪除 `app/types/database.types.ts`

**不需要認證**：

1. 移除 `better-auth` 和 `@onmax/nuxt-better-auth`
2. 從 `nuxt.config.ts` 移除 betterAuth 模組
3. 刪除 `app/auth.config.ts` 和 `server/auth.config.ts`

**不需要 AI 工具**：

1. 刪除 `.claude/` 目錄
2. 刪除 `.agents/` 目錄
3. 刪除 `openspec/` 和 `.spectra/` 目錄
4. 核心 Nuxt + Supabase 功能不受影響

**不需要 Sentry**：

1. 移除 `@sentry/nuxt`
2. 從 `nuxt.config.ts` 移除 sentry 模組配置

---

## 環境設定類

### Windows 上怎麼開發？

**推薦方式**：使用 [WSL 2](https://learn.microsoft.com/zh-tw/windows/wsl/install)（Windows Subsystem for Linux）。

**原因**：

- Docker（Supabase 需要）在 WSL 2 上運行最穩定
- Shell 腳本（`setup.sh` 等）原生支援
- 與 Linux/macOS 開發環境一致

**步驟**：

1. 安裝 WSL 2：`wsl --install`
2. 安裝 Docker Desktop 並啟用 WSL 2 整合
3. 在 WSL 中安裝 Node.js、pnpm、Supabase CLI
4. 按照 [QUICK_START.md](QUICK_START.md) 正常操作

**不用 WSL 也可以嗎？** `scripts/setup.sh` 有偵測 Windows 環境的邏輯，但某些功能可能需要手動調整。建議優先使用 WSL 2。

> 📖 故障排除：[TROUBLESHOOTING.md](TROUBLESHOOTING.md)

### `pnpm run setup` 做了什麼？

執行 `scripts/setup.sh`，自動完成：

1. 檢查先決條件（Node 20+、pnpm、Docker、Supabase CLI）
2. 安裝依賴（`pnpm install`）
3. 複製 `.env.example` → `.env`（若不存在）
4. 啟動本地 Supabase
5. 產生資料庫型別

> 📖 故障排除：[TROUBLESHOOTING.md](TROUBLESHOOTING.md)

### Docker 在 Apple Silicon（M1/M2/M3）上有問題嗎？

Supabase 的 Docker 映像已支援 ARM64 架構，但偶爾可能遇到：

- **映像下載慢**：正常現象，首次下載需較長時間
- **記憶體不足**：Docker Desktop → Settings → Resources → 至少分配 4GB RAM
- **容器啟動失敗**：嘗試 `docker system prune` 清理後重新 `supabase start`

> 📖 診斷步驟：[TROUBLESHOOTING.md](TROUBLESHOOTING.md#1-supabase-start-失敗)

### 可以只用 Email 登入，不設定 OAuth 嗎？

可以。只需設定 `BETTER_AUTH_SECRET` 和 `NUXT_SESSION_PASSWORD`，OAuth 相關的環境變數留空即可。登入頁面會自動隱藏未設定的 OAuth 按鈕。

### CLI 工具 `create-nuxt-starter` 是什麼？

互動式 CLI，讓你選擇需要的功能來建立客製化專案。支援 17 個可選模組（認證、資料庫、UI、測試、部署等）。目前尚未發布至 npm，僅能從 repo 內使用：

```bash
# 在 repo 根目錄
pnpm --filter create-nuxt-starter dev -- /path/to/my-app
```

> 📖 詳細說明：[CLI_SCAFFOLD.md](verify/CLI_SCAFFOLD.md)

---

## 效能與規模

### RLS 會拖慢查詢嗎？

不會明顯影響。RLS 政策在 PostgreSQL 內部以 `WHERE` 子句形式執行，走索引路徑。實測 RLS 開啟/關閉的差異通常在 1-2ms 以內。

**最佳化建議**：

- 確保 RLS 條件欄位有索引（例如 `user_id`）
- 避免在 RLS 政策中使用子查詢，改用 `auth.uid()` 直接比較
- 使用 `EXPLAIN ANALYZE` 確認查詢計畫

> 📖 詳細說明：[DATABASE_OPTIMIZATION.md](verify/DATABASE_OPTIMIZATION.md)

### 怎麼偵測 N+1 查詢？

N+1 問題通常出現在逐筆查詢關聯資料。偵測方式：

```bash
# 檢查 Supabase 慢查詢 log
supabase db lint --level warning
```

**修復模式**：使用 `.select('*, relation(*)')` 一次取回關聯資料，避免迴圈中逐筆查詢。

> 📖 診斷步驟：[TROUBLESHOOTING.md](TROUBLESHOOTING.md#14-n1-查詢問題)

### Supabase 免費方案能撐多大規模？

| 資源           | 免費方案限制     |
| -------------- | ---------------- |
| 資料庫大小     | 500 MB           |
| 頻寬           | 5 GB / 月        |
| 儲存空間       | 1 GB             |
| Edge Functions | 500K 次調用 / 月 |
| 同時連線數     | 60               |

對大多數 MVP 和小型產品足夠。超過限制時可升級到 Pro 方案（$25/月），或 [Self-host](../docs/verify/SELF_HOSTED_SUPABASE.md) Supabase（開源免費），完全不受以上限制。

### 超過免費方案限制怎麼辦？

- **Supabase Cloud**：升級到 Pro（$25/月），包含 8GB 資料庫、250GB 頻寬、100GB 儲存
- **Supabase Self-hosted**：Supabase 是開源的，可以免費自架在自己的伺服器上，不受任何方案限制。詳見 [Self-hosted 部署指南](../docs/verify/SELF_HOSTED_SUPABASE.md)
- **Cloudflare Workers**：免費方案包含 10 萬次請求/天，超過後 $5/月（無限請求）
- **漸進升級**：先用免費方案開發，接近限制時再升級或改用 Self-hosted，無需改動程式碼

### Cloudflare Workers 有費用嗎？

免費方案包含：

- 每天 100,000 次請求
- 每次請求 10ms CPU 時間
- 全球邊緣部署

對大多數小型應用完全足夠。付費方案（$5/月）提供無限請求和更多 CPU 時間。

---

## 團隊協作

### 多人開發怎麼避免 migration 衝突？

**規則**：

1. 每個功能在獨立 branch 開發，各自建立 migration
2. Migration 檔名帶時間戳（`supabase migration new` 自動處理）
3. 合併前執行 `supabase db reset` 確認所有 migration 可正常套用
4. 若遠端已有衝突的 migration，使用 `supabase migration repair --status reverted <version>` 處理

> 📖 診斷步驟：[TROUBLESHOOTING.md](TROUBLESHOOTING.md#11-migration-repair)

### Code Review 要注意什麼？

**檢查清單**：

- [ ] Migration 檔案包含 `SET search_path = ''`（如有函式）
- [ ] RLS 政策包含 `service_role` bypass
- [ ] Client 端只有 `.select()` 讀取，寫入走 Server API
- [ ] 新增環境變數同步更新 `.env.example`
- [ ] `pnpm check` 通過（format + lint + typecheck + test）
- [ ] docs/verify/ 相關文件已更新

### 新成員如何快速上手？

建議閱讀順序（約 2 小時）：

1. **README.md**（5 分鐘）— 了解專案定位
2. **QUICK_START.md**（15 分鐘）— 環境設定
3. **FIRST_CRUD.md**（15 分鐘）— 動手做第一個功能
4. **WORKFLOW.md**（10 分鐘）— 開發流程
5. **FAQ.md**（10 分鐘）— 常見問題

之後按需查閱 `docs/verify/` 的參考手冊。

> 📖 完整路徑：[READING_GUIDE.md](READING_GUIDE.md)

---

## 還有問題？

1. 搜尋 `docs/` 目錄的其他文件
2. 查看 [CLAUDE.md](../CLAUDE.md) 的相關章節
3. 使用 Claude Code 詢問（它會參考專案的 Skills 和規範）
