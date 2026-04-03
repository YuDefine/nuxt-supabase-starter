# 快速開始

從零開始建立一個包含完整 Tech Stack 和 AI 開發工具的專案。

**照著這份指南做，你會得到完整的開發環境——包含 Nuxt 4 + Supabase + AI 開發工具的最佳實踐配置。**

---

## 先用這條路徑：直接產生乾淨新專案（推薦）

這條流程會直接輸出可開發的乾淨專案，支援：

- 互動式決定專案名稱
- Auth 二選一（Better Auth / nuxt-auth-utils）
- 其他功能模組選配
- 不殘留 demo 或 Nuxt Supabase Starter 關鍵字

### 互動式（推薦）

```bash
git clone https://github.com/YuDefine/nuxt-supabase-starter temp-starter
cd temp-starter

# 安裝 CLI 依賴（僅第一次）
pnpm --dir template/packages/create-nuxt-starter install

# 啟動互動式 scaffold — 第一步就會問你專案名稱
pnpm --dir template/packages/create-nuxt-starter dev
```

CLI 會依序引導你填寫：專案名稱 → Auth → 資料庫 → UI → 渲染模式 → 額外功能 → 測試 → 部署目標等。

### 最短路徑（給 agent 或腳本）

```bash
git clone https://github.com/YuDefine/nuxt-supabase-starter temp-starter
cd temp-starter
bash scripts/create-fast-project.sh temp/my-product
```

說明：

- 這條命令會自動安裝 scaffold 依賴
- 使用非互動建立（預設 auth=nuxt-auth-utils）
- 自動移除 `testing-full` 以縮短建立時間
- 建完後會自動跑一次關鍵字掃描

### 非互動（可腳本化）

```bash
pnpm --dir template/packages/create-nuxt-starter dev temp/my-product \
	--yes \
	--fast \
	--auth better-auth \
	--with charts,monitoring,image \
	--without testing-full
```

參數說明：

- 專案名稱：最後一段路徑就是專案名稱（例如 `temp/my-product`）
- Auth：`--auth nuxt-auth-utils`、`--auth better-auth`、`--auth none`
- 快速預設：`--fast`（等同 `--preset fast`，會移除 testing）
- 功能新增：`--with <feature1,feature2>`
- 功能移除：`--without <feature1,feature2>`
- 最小起始：`--minimal`（從空白功能集開始）

常用 feature id：

- `database`, `ui`, `pinia`, `charts`, `seo`, `security`, `image`, `vueuse`
- `testing-full`, `testing-vitest`, `monitoring`
- `deploy-cloudflare`, `deploy-vercel`, `deploy-node`
- `quality`, `git-hooks`

### 驗證沒有預設關鍵字殘留

```bash
rg -ni "nuxt[- ]supabase starter|nuxt-supabase-starter|demo" temp/my-product
```

若沒有輸出，代表沒有殘留關鍵字。

---

## 想先看 Demo？

Scaffold CLI 預設產出 clean 專案。如果你想先體驗完整功能展示：

```bash
git clone https://github.com/YuDefine/nuxt-supabase-starter temp-starter
cd temp-starter/template
pnpm install
pnpm run setup
pnpm dev          # 開啟 http://localhost:3000 看 Demo
```

看完後回到 repo root 執行 scaffold CLI 產生你的乾淨專案。

> 現有專案整合：[INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md)

---

## 前置條件

在開始之前，請確認已安裝：

| 工具         | 版本               | 安裝方式                                                           |
| ------------ | ------------------ | ------------------------------------------------------------------ |
| Node.js      | 18+（建議 24 LTS） | [nodejs.org](https://nodejs.org/)                                  |
| pnpm         | 9+                 | `corepack enable && corepack prepare pnpm@latest --activate`       |
| Docker       | -                  | [docker.com](https://www.docker.com/)                              |
| Supabase CLI | -                  | macOS: `brew install supabase/tap/supabase`                        |
|              |                    | Windows: `scoop install supabase`（[Scoop](https://scoop.sh/)）    |
|              |                    | Linux: `brew install supabase/tap/supabase` 或 [GitHub Releases][] |
| Claude Code  | -                  | `curl -fsSL https://claude.ai/install.sh \| sh`                    |

[GitHub Releases]: https://github.com/supabase/cli/releases

---

## Scaffold 後：設定開發環境

Scaffold 完成後，進入你的新專案：

```bash
cd <你的專案路徑>
pnpm run setup    # 檢查環境 → 選擇 Auth → 安裝依賴 → 啟動 Supabase → 產生型別
pnpm dev          # 開啟 http://localhost:3000
```

### 設定 Claude Code

```bash
bash scripts/install-skills.sh
```

安裝 46 個通用 Skills 到 `.claude/skills/`，命令權限和 MCP Servers 已在 `.claude/settings.json` 中預先配置。

> 📖 關於 Supabase MCP：[SUPABASE_MCP.md](../template/docs/SUPABASE_MCP.md)

---

## 下一步

### 建立你的第一個功能

跟著 15 分鐘教學，從資料庫到 UI 完成一個完整的 CRUD 功能：

> 📖 **推薦**：[FIRST_CRUD.md](./FIRST_CRUD.md) — 書籤管理功能（Migration → RLS → API → Pinia → Vue → Test）

或者自行建立第一個資料表：

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

### 建立設計脈絡

在開發第一個 UI 功能之前，先建立專案的設計方向：

```bash
claude

# 建立設計脈絡（產出 .impeccable.md，所有 design skills 的前提）
> /teach-impeccable
```

這會互動式地收集你的設計偏好（風格方向、色彩、字型、間距），並存入 `.impeccable.md`。後續所有 design skills（`/design`、`/colorize`、`/typeset` 等）都會讀取這個檔案。

### 用 AI 開發第一個功能

```bash
# 使用 Spectra 工作流程
> /spectra-propose
> 我需要一個待辦事項功能，使用者可以新增、編輯、刪除待辦事項...
```

> 📖 詳細說明：[OPENSPEC.md](../template/docs/OPENSPEC.md)
>
> UI 功能的 tasks 會自動包含 Design Review 區塊，spectra-apply 執行時會觸發 `/design improve` + targeted design skills。

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

| 文件                                           | 說明                        |
| ---------------------------------------------- | --------------------------- |
| [CLAUDE_CODE_GUIDE.md](./CLAUDE_CODE_GUIDE.md) | Claude Code 配置指南        |
| [SUPABASE_MCP.md](../template/docs/SUPABASE_MCP.md) | Supabase MCP 整合      |
| [SUPABASE_GUIDE.md](./SUPABASE_GUIDE.md)       | Supabase 入門與 RLS         |
| [WORKFLOW.md](../template/docs/WORKFLOW.md)    | TDD 開發流程                |
| [OPENSPEC.md](../template/docs/OPENSPEC.md)    | Spectra 工作流程            |
| [API_PATTERNS.md](../template/docs/API_PATTERNS.md) | Server API 設計模式    |
| [DEPLOYMENT.md](../template/docs/DEPLOYMENT.md) | Cloudflare Workers 部署指南 |

---

## 遇到問題？

設定過程中遇到問題，請參考 [TROUBLESHOOTING.md](../template/docs/TROUBLESHOOTING.md) 查找解決方案。
