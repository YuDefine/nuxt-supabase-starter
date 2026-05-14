# Nuxt + Supabase Starter

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 這是什麼？

如果你已經熟悉 Nuxt，想要快速建立**有後端、有資料庫、有認證、可部署**的完整專案，這個範本能幫你在幾天內完成通常需要幾週的工作。

這不只是一個 boilerplate——它包含了實際中型企業系統的開發經驗：

- 預設認證、CRUD、RLS、CI/CD、部署等完整流程
- 與 Claude Code 協作的最佳實踐與工作流程
- 踩過的坑、驗證過的模式、避免的反模式

**目標讀者**：有 Nuxt/Vue 經驗，想嘗試 Supabase 或想要一套可靠的全端開發工作流程的開發者。

---

## 快速開始

👉 **[QUICK_START.md](docs/QUICK_START.md)**：從 clone 到跑起來的完整步驟

> 整合至現有專案：[INTEGRATION_GUIDE.md](docs/INTEGRATION_GUIDE.md)

---

## 費用與時間

### 開發時間

| 階段           | 時間     | 說明                                              |
| -------------- | -------- | ------------------------------------------------- |
| Clone → 可運行 | ~15 分鐘 | `pnpm run setup` 一鍵完成                         |
| 第一個功能     | ~20 分鐘 | 跟著 [FIRST_CRUD.md](docs/FIRST_CRUD.md)          |
| 部署上線       | ~30 分鐘 | 跟著 [DEPLOYMENT.md](template/docs/DEPLOYMENT.md) |

### 月費估算

| 規模       | Supabase | Cloudflare | Claude Code（主力）                   | 總計                 |
| ---------- | -------- | ---------- | ------------------------------------- | -------------------- |
| 開發 / MVP | 免費     | 免費       | Max 5x（$100 級）/ Max 20x（$200 級） | **$100/月**      |
| 小型產品   | Pro $25  | $5         | Max 5x（$100 級）/ Max 20x（$200 級） | **$125~$225/月** |
| 成長期     | Pro $25+ | $5+        | Max 5x（$100 級）/ Max 20x（$200 級） | **$225+/月**     |

> 以上為去敏感化後的量級估算，實際費用會依地區、實際流量、用量尖峰與方案調整而變動。

> 免費方案包含：500MB 資料庫、5GB 頻寬、10 萬次 Workers 請求/天。對大多數 MVP 足夠。
>
> Supabase 是開源的，可以免費 [Self-host](template/docs/verify/SELF_HOSTED_SUPABASE.md) 在自己的伺服器上，不受 Cloud 免費方案限制。
>
> 本專案以 Claude Code 作為主力開發模式，最低建議 Max 5x 等級，推薦 Max 20x 等級。方案細節可參考 [CLAUDE_CODE_GUIDE.md](docs/CLAUDE_CODE_GUIDE.md)。

### 效率實證（去敏感化）

以同技術棧的實戰專案為例，在約 5 個月的開發週期中，達到：

- 提交頻率：千筆級提交、接近每日高頻更新
- 版本節奏：百次級發布，維持持續交付
- 系統規模：API/資料庫 migration 為數百檔級，頁面為數十檔級
- 品質覆蓋：測試與文件皆達百份級，非一次性 Demo 產物

這代表這套「Claude Code 主導 + Nuxt + Supabase」流程，在真實專案中能同時維持開發速度與可維護性。

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
| 測試   | Vite+ (Vitest) + Playwright        |
| 部署   | Cloudflare Workers                 |
| 品質   | Vite+ (OXLint + OXFmt + Hooks)     |

> 完整技術棧與選型理由：[TECH_STACK.md](docs/TECH_STACK.md)

---

## 專案結構

```
├── template/                         # Nuxt + Supabase starter template
│   ├── app/                          # Frontend (pages, components, composables)
│   ├── server/                       # Backend (API, utils, plugins)
│   ├── supabase/                     # Database (migrations, seed, config)
│   ├── packages/create-nuxt-starter/ # CLI scaffolding tool
│   ├── docs/                         # 開發知識文件
│   └── .claude/                      # Claude Code 配置
├── docs/                             # Starter 展示文件
├── scripts/                          # Meta 維護腳本
├── README.md
├── CLAUDE.md
└── LICENSE
```

---

## 文件導覽

| 我想要...        | 閱讀這份                                          |
| ---------------- | ------------------------------------------------- |
| 新專案快速開始   | [QUICK_START.md](docs/QUICK_START.md)             |
| 現有專案整合配置 | [INTEGRATION_GUIDE.md](docs/INTEGRATION_GUIDE.md) |
| 了解開發流程     | [WORKFLOW.md](template/docs/WORKFLOW.md)          |
| 查詢常見問題     | [FAQ.md](template/docs/FAQ.md)                    |
| 了解 AI 配置     | [CLAUDE_CODE_GUIDE.md](docs/CLAUDE_CODE_GUIDE.md) |
| 查閱系統狀態     | [docs/verify/](template/docs/verify/)             |

<details>
<summary>完整文件清單</summary>

**Starter 展示文件**（`docs/`）

| 文件                                                | 說明                         |
| --------------------------------------------------- | ---------------------------- |
| [QUICK_START.md](docs/QUICK_START.md)               | 新專案安裝與設定步驟         |
| [INTEGRATION_GUIDE.md](docs/INTEGRATION_GUIDE.md)   | 現有專案整合 Claude/Supabase |
| [FIRST_CRUD.md](docs/FIRST_CRUD.md)                 | 第一個 CRUD 功能教學         |
| [VISUAL_GUIDE.md](docs/VISUAL_GUIDE.md)             | 視覺化系統導覽               |
| [SKILL_UPDATE_GUIDE.md](docs/SKILL_UPDATE_GUIDE.md) | Skills 更新指南              |
| [CLAUDE_CODE_GUIDE.md](docs/CLAUDE_CODE_GUIDE.md)   | Claude Code 配置指南         |

**開發知識文件**（`template/docs/`）

| 文件                                             | 說明                      |
| ------------------------------------------------ | ------------------------- |
| [WORKFLOW.md](template/docs/WORKFLOW.md)         | SDD、TDD、自動化檢查、Git 規範 |
| [FAQ.md](template/docs/FAQ.md)                   | 常見疑問集                |
| [DEPLOYMENT.md](template/docs/DEPLOYMENT.md)     | 部署指南                  |
| [TECH_STACK.md](docs/TECH_STACK.md)              | 技術棧與選型理由          |
| [SUPABASE_GUIDE.md](docs/SUPABASE_GUIDE.md)      | Supabase 入門與 RLS 詳解  |
| [API_PATTERNS.md](template/docs/API_PATTERNS.md) | Server API 設計模式       |
| [OPENSPEC.md](template/docs/OPENSPEC.md)         | Spectra 工作流程詳解      |

</details>

---

## CLI Tool

`create-nuxt-starter` 目前以 repo 內執行為主：

```bash
# 互動模式 — 第一步 picker 選 stack preset，後續只問 8 個非 preset 決策
pnpm --filter create-nuxt-starter dev -- /path/to/my-app

# 非互動 — 一行直達指定 preset
pnpm --filter create-nuxt-starter dev -- /path/to/my-app \
  --yes --preset cloudflare-supabase
```

Stack preset：`cloudflare-supabase`（預設）/ `cloudflare-nuxthub-ai` / `vercel-supabase` / `self-hosted-node` / `minimal`。

> 詳細說明請看 [CLI_SCAFFOLD.md](docs/CLI_SCAFFOLD.md)

---

## 常見問題

**Q: 我需要付費嗎？** 若依本專案推薦流程（Claude Code 主力開發），建議至少預算 Claude Code Max 5x（$100/月）；基礎雲端成本可從 Supabase/Cloudflare 免費方案起步。

**Q: 我可以不用 Claude Code 嗎？** 技術上可以，但不建議。本專案的流程與效率設計是以 Claude Code 為主力前提。

**Q: 如何部署到 Production？** 在 [Supabase Dashboard](https://supabase.com/dashboard) 建立專案 → `supabase link` → `supabase db push` → 部署到 Cloudflare Workers。

> 更多問題：[FAQ.md](template/docs/FAQ.md)

---

## 下一步

### 新專案

1. **[快速開始](docs/QUICK_START.md)**：clone、跑起來
2. **[Supabase 入門](docs/SUPABASE_GUIDE.md)**：建立第一個資料表
3. **[API 設計](template/docs/API_PATTERNS.md)**：寫你的第一個 CRUD API
4. **[Spectra](template/docs/OPENSPEC.md)**：用 AI 輔助開發一個功能
5. **[部署指南](template/docs/DEPLOYMENT.md)**：部署到 Cloudflare Workers

### 現有專案

1. **[整合指南](docs/INTEGRATION_GUIDE.md)**：將 Claude/Supabase 配置注入現有專案
2. 根據需要選擇整合項目（Claude 配置、Supabase、Better Auth）

有問題歡迎開 issue。

---

## License

[MIT](LICENSE) © [YuDefine - 域定資訊工作室](https://github.com/YuDefine)
