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

## 60 秒快速開始

**方式一：CLI 建立客製化專案**（推薦）

```bash
npx create-nuxt-starter my-app
```

互動式選單讓你選擇需要的功能（認證、資料庫、UI、測試等）。

**方式二：Clone 完整範本**

```bash
git clone https://github.com/YuDefine/nuxt-supabase-starter my-project
cd my-project
pnpm setup    # 一鍵完成環境初始化
```

**方式三：整合至現有專案**

參考 [INTEGRATION_GUIDE.md](docs/INTEGRATION_GUIDE.md)。

> 📖 完整設定步驟：[QUICK_START.md](docs/QUICK_START.md) | 📖 第一個功能：[FIRST_CRUD.md](docs/FIRST_CRUD.md)

---

## 費用與時間

### 開發時間

| 階段           | 時間     | 說明                                     |
| -------------- | -------- | ---------------------------------------- |
| Clone → 可運行 | ~15 分鐘 | `pnpm setup` 一鍵完成                    |
| 第一個功能     | ~20 分鐘 | 跟著 [FIRST_CRUD.md](docs/FIRST_CRUD.md) |
| 部署上線       | ~30 分鐘 | 跟著 [DEPLOYMENT.md](docs/DEPLOYMENT.md) |

### 月費估算

| 規模       | Supabase | Cloudflare | 總計          |
| ---------- | -------- | ---------- | ------------- |
| 開發 / MVP | 免費     | 免費       | **$0**        |
| 小型產品   | Pro $25  | $5         | **~$30/月**   |
| 成長期     | Pro $25+ | $5+        | **~$100+/月** |

> 免費方案包含：500MB 資料庫、5GB 頻寬、10 萬次 Workers 請求/天。對大多數 MVP 足夠。

---

## Tech Stack

Nuxt 4 + Vue 3 + TypeScript + Supabase + Nuxt UI + Tailwind CSS + Pinia + Better Auth

| 類別   | 技術                               |
| ------ | ---------------------------------- |
| 框架   | Nuxt 4, Vue 3, TypeScript          |
| 資料庫 | Supabase (PostgreSQL)              |
| UI     | Nuxt UI, Tailwind CSS, Nuxt Charts |
| 認證   | Better Auth (33+ OAuth providers)  |
| 狀態   | Pinia + Pinia Colada               |
| 測試   | Vitest + Playwright                |
| 部署   | Cloudflare Workers                 |
| 品質   | OXLint + OXFmt + Husky             |

> 📖 完整技術棧與選型理由：[TECH_STACK.md](docs/TECH_STACK.md)

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
| **[docs/OPENSPEC.md](./docs/OPENSPEC.md)**                   | Spectra 工作流程詳解               | 要用 AI 輔助開發   |
| **[docs/CLAUDE_CODE_GUIDE.md](./docs/CLAUDE_CODE_GUIDE.md)** | Claude Code 配置指南               | 要了解 AI 工具     |
| **[docs/SUPABASE_MCP.md](./docs/SUPABASE_MCP.md)**           | Supabase MCP 整合                  | 要讓 AI 操作資料庫 |
| **[docs/API_PATTERNS.md](./docs/API_PATTERNS.md)**           | Server API 設計模式                | 要寫後端 API       |
| **[CLAUDE.md](./CLAUDE.md)**                                 | AI 開發規範（給 Claude Code）      | 要客製化 AI 行為   |
| **[docs/verify/](./docs/verify/)**                           | 系統狀態文件（Auth、API、DB）      | 要了解架構細節     |

</details>

---

## 核心概念

Spec-Driven Development (SDD)、Data Access Pattern（Client 讀 / Server 寫）、TDD。

> 📖 詳細說明：[WORKFLOW.md](docs/WORKFLOW.md)

---

## 開發工作流程

`pnpm check` 一鍵執行 format → lint → typecheck → test。

> 📖 完整流程：[WORKFLOW.md](docs/WORKFLOW.md)

---

## 目錄結構

```
├── CLAUDE.md                 # AI 開發規範
├── docs/                     # 詳細文件
│   ├── SUPABASE_GUIDE.md    # Supabase 入門
│   ├── WORKFLOW.md          # 開發工作流程
│   ├── OPENSPEC.md          # Spectra 工作流程
│   └── API_PATTERNS.md      # API 設計模式
│
├── .claude/                  # Claude Code 配置
│   ├── commands/            # 自定義命令（含 spectra/）
│   ├── agents/              # SubAgents
│   ├── hooks/               # 自動化腳本
│   ├── skills/              # AI Skills
│   └── settings.local.json.example
│
├── openspec/                 # Spectra 工作流程
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

**Q: 我需要付費嗎？** 本地開發完全免費。Supabase 免費方案：500MB 資料庫、50K 月活躍使用者。

**Q: RLS 會影響效能嗎？** 如果用 `(SELECT ...)` 包裝函式呼叫，不會。詳見 [SUPABASE_GUIDE.md](./docs/SUPABASE_GUIDE.md#效能優化)。

**Q: 這套流程適合團隊嗎？** 適合。CLAUDE.md 是共享規範，Migration 有版本控制。

**Q: 我可以不用 Claude Code 嗎？** 可以。`.claude/` 配置是可選的，核心的 Nuxt + Supabase 結構不依賴任何 AI 工具。

**Q: 如何部署到 Production？** 在 [Supabase Dashboard](https://supabase.com/dashboard) 建立專案 → `supabase link` → `supabase db push` → 部署到 Cloudflare Workers。

---

## 下一步

### 新專案

1. **[快速開始](./docs/QUICK_START.md)**：clone、跑起來
2. **[Supabase 入門](./docs/SUPABASE_GUIDE.md)**：建立第一個資料表
3. **[API 設計](./docs/API_PATTERNS.md)**：寫你的第一個 CRUD API
4. **[Spectra](./docs/OPENSPEC.md)**：用 AI 輔助開發一個功能
5. **[部署指南](./docs/DEPLOYMENT.md)**：部署到 Cloudflare Workers

### 現有專案

1. **[整合指南](./docs/INTEGRATION_GUIDE.md)**：將 Claude/Supabase 配置注入現有專案
2. 根據需要選擇整合項目（Claude 配置、Supabase、Better Auth）

有問題歡迎開 issue。

---

## License

[MIT](./LICENSE) © [YuDefine - 域定資訊工作室](https://github.com/YuDefine)
