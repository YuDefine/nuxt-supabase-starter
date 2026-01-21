# 快速開始

從零開始建立一個包含完整 Tech Stack 和 AI 開發工具的專案。

**照著這份指南做，你會得到與 <consumer-b> 專案相同的開發環境——在 2.5 個月內產出 80 個 API、100 個 migration、2,500+ 次 Claude Code 協作。**

## 前置條件

在開始之前，請確認已安裝：

| 工具 | 版本 | 安裝方式 |
|------|------|----------|
| Node.js | 20+ | [nodejs.org](https://nodejs.org/) |
| pnpm | 9+ | `curl -fsSL https://get.pnpm.io/install.sh \| sh -` |
| Docker | - | [docker.com](https://www.docker.com/) |
| Supabase CLI | - | `brew install supabase/tap/supabase` |
| Claude Code | - | `curl -fsSL https://claude.ai/install.sh \| sh` |

---

## Step 1：建立專案

```bash
# 從 GitHub 複製範本
git clone https://github.com/Charles5277/nuxt-supabase-starter my-project
cd my-project

# 移除原始 git 歷史，建立自己的
rm -rf .git
git init
git add .
git commit -m "🎉 init: 從 nuxt-supabase-starter 建立專案"
```

**你得到了什麼**：

```
my-project/
├── CLAUDE.md              # AI 開發規範
├── .claude/               # Claude Code 配置
│   ├── commands/          # 13 個自定義指令
│   ├── agents/            # 3 個 SubAgents
│   └── skills/            # 17 個 AI Skills（12 通用 + 5 情境）
├── .specify/              # spec-kit 工作流程
├── app/                   # Nuxt 應用程式
├── server/                # API 端點
├── supabase/              # Migration 檔案
├── docs/                  # 專案文件
└── docs/verify/           # 系統狀態文件（Auth、API、DB）
```

---

## Step 2：安裝依賴

```bash
pnpm install
```

這會安裝完整的 Tech Stack：

**核心框架**
- **Nuxt 4** + Vue 3 + TypeScript
- **Nuxt UI 4** + Tailwind CSS
- **Nuxt Charts**（基於 Unovis）

**狀態與資料**
- **Pinia** + **Pinia Colada**（非同步資料管理）
- **VueUse**（Vue Composition Utilities）
- **Supabase**（PostgreSQL + Auth + Realtime）

**認證**
- **nuxt-better-auth**（33+ OAuth providers）

**測試與品質**
- **Vitest** + **@nuxt/test-utils**
- **OXLint** + **OXFmt**（Rust 實作，極快）
- **Commitlint** + **Husky**（Git hooks）

**部署**
- **Cloudflare Workers**（via NuxtHub）
- **Sentry**（錯誤追蹤）

---

## Step 3：設定環境變數

```bash
# 複製範例檔案
cp .env.example .env
```

編輯 `.env`，填入必要的值：

```bash
# Supabase（Step 4 會取得這些值）
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon_key>
SUPABASE_SECRET_KEY=<service_role_key>

# Session（必填）
# 使用 openssl rand -base64 32 產生
NUXT_SESSION_PASSWORD=<32字元隨機字串>
```

---

## Step 4：啟動 Supabase

```bash
# 啟動本地 Supabase（需要 Docker）
supabase start
```

**成功後會看到**：

```
         API URL: http://127.0.0.1:54321
     GraphQL URL: http://127.0.0.1:54321/graphql/v1
  S3 Storage URL: http://127.0.0.1:54321/storage/v1/s3
          DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
      Studio URL: http://127.0.0.1:54323
    Inbucket URL: http://127.0.0.1:54324
      JWT secret: super-secret-jwt-token-...
        anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6...
service_role key: eyJhbGciOiJIUzI1NiIsInR5cCI6...
```

**更新 `.env`**：

```bash
SUPABASE_KEY=<上面的 anon key>
SUPABASE_SECRET_KEY=<上面的 service_role key>
```

---

## Step 5：設定 Claude Code

```bash
# 複製 Claude Code 設定
cp .claude/settings.local.json.example .claude/settings.local.json
```

這個設定檔定義了：
- Claude 可以執行的命令權限
- 啟用的 MCP Servers（包含 `local-supabase`）

> 📖 關於 Supabase MCP：[SUPABASE_MCP.md](./SUPABASE_MCP.md)

---

## Step 6：啟動開發伺服器

```bash
pnpm dev
```

打開 http://localhost:3000，你應該會看到初始頁面。

---

## Step 7：驗證 Claude Code

開啟新的終端機視窗：

```bash
# 啟動 Claude Code
claude
```

試試看這些指令：

```bash
# 檢查專案狀態
> 專案有哪些測試？

# 執行 TDD 流程
> /tdd 幫我寫一個計算稅金的函式

# 執行檢查
> 執行 pnpm check
```

---

## 完成！你得到了什麼？

**照著上述步驟，你已經得到與原始專案相同的開發環境。**

### Tech Stack（已配置）

| 類別 | 技術 |
|------|------|
| 前端框架 | Nuxt 4 + Vue 3 + TypeScript |
| UI 元件 | Nuxt UI 4 + Tailwind CSS |
| 狀態管理 | Pinia + Pinia Colada |
| 資料庫 | Supabase（PostgreSQL + Realtime） |
| 認證 | @onmax/nuxt-better-auth（OAuth） |
| 測試 | Vitest + @nuxt/test-utils |
| 部署 | Cloudflare Workers |

### AI 開發工具（已配置）

| 類型 | 數量 | 說明 |
|------|------|------|
| Commands | 13 個 | `/tdd`、`/commit`、`/speckit.*` 等 |
| SubAgents | 3 個 | `check-runner`、`post-implement`、`db-backup` |
| 通用 Skills | 12 個 | `nuxt`、`nuxt-ui`、`vue`、`vueuse` 等（自動更新） |
| 情境 Skills | 5 個 | `supabase-rls`、`server-api`、`pinia-store` 等 |

### 開發規範（已定義）

| 規範 | 功能 |
|------|------|
| CLAUDE.md | AI 開發規範，確保 AI 遵循專案標準 |
| TDD 工作流程 | Red → Green → Refactor |
| 自動化檢查 | `pnpm check`：format → lint → typecheck → test |
| Git 規範 | emoji type + commitlint |
| docs/verify/ | 系統狀態文件，確保文件與程式碼同步 |

---

## 下一步

### 建立第一個資料表

```bash
# 建立 migration
supabase migration new create_todos_table

# 編輯產生的 SQL 檔案（在 supabase/migrations/ 下）

# 套用 migration
supabase db reset

# 產生 TypeScript 類型
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null
```

> 📖 詳細說明：[SUPABASE_GUIDE.md](./SUPABASE_GUIDE.md)

### 設定 OAuth 登入

編輯 `.env`，填入 OAuth Provider 的 credentials：

```bash
# Google OAuth
NUXT_OAUTH_GOOGLE_CLIENT_ID=<client_id>
NUXT_OAUTH_GOOGLE_CLIENT_SECRET=<client_secret>
```

### 用 AI 開發第一個功能

```bash
# 啟動 Claude Code
claude

# 使用 spec-kit 工作流程
> /speckit.specify
> 我需要一個待辦事項功能，使用者可以新增、編輯、刪除待辦事項...
```

> 📖 詳細說明：[SPEC_KIT.md](./SPEC_KIT.md)

---

## 常用命令

```bash
# 開發
pnpm dev              # 啟動開發伺服器
pnpm build            # 建置生產版本

# 品質檢查
pnpm check            # format → lint → typecheck → test
pnpm test             # 執行測試
pnpm typecheck        # TypeScript 類型檢查

# 資料庫
supabase start        # 啟動本地 Supabase
supabase stop         # 停止本地 Supabase
supabase db reset     # 重置資料庫（套用所有 migration）
supabase migration new <name>  # 建立新 migration
```

---

## 相關文件

| 文件 | 說明 |
|------|------|
| [CLAUDE_CODE_GUIDE.md](./CLAUDE_CODE_GUIDE.md) | Claude Code 配置指南 |
| [SUPABASE_MCP.md](./SUPABASE_MCP.md) | Supabase MCP 整合 |
| [SUPABASE_GUIDE.md](./SUPABASE_GUIDE.md) | Supabase 入門與 RLS |
| [WORKFLOW.md](./WORKFLOW.md) | TDD 開發流程 |
| [SPEC_KIT.md](./SPEC_KIT.md) | spec-kit 工作流程 |
| [API_PATTERNS.md](./API_PATTERNS.md) | Server API 設計模式 |
