---
audience: both
applies-to: pre-scaffold
related:
  - QUICK_START.md
  - AGENTS.md
---

# CLI Scaffold（create-nuxt-starter）

互動式 CLI 工具，用於從 starter template 建立客製化的 Nuxt 專案。

---

## 概述

`create-nuxt-starter` 是一個互動式 CLI，讓使用者透過選單選擇需要的功能，自動組裝出客製化的 Nuxt 專案。

## 安裝與使用

> **注意**：此 CLI 尚未發布至 npm，目前僅能從 repo 內使用。

### 最快入口（零先備知識）

```bash
bash scripts/create-fast-project.sh temp/my-app
```

這個腳本會自動安裝依賴、使用非互動建立、略過 `testing-full`，並在結束後做關鍵字掃描。

### 從 repo 內執行（開發模式）

```bash
# 在 repo 根目錄
pnpm --dir template/packages/create-nuxt-starter dev temp/my-app

# 非互動模式（使用預設配置）
pnpm --dir template/packages/create-nuxt-starter dev temp/my-app --yes

# 非互動模式（用 stack preset 一行直達）
pnpm --dir template/packages/create-nuxt-starter dev temp/my-app \
    --yes \
    --preset cloudflare-nuxthub-ai

# 非互動模式（自訂微調）
pnpm --dir template/packages/create-nuxt-starter dev temp/my-app \
    --yes \
    --auth better-auth \
    --with charts,monitoring \
    --without testing-full,testing-vitest
```

### 非互動參數

- `--preset`：`cloudflare-supabase`（預設）| `cloudflare-nuxthub-ai` | `vercel-supabase` | `self-hosted-node` | `minimal`
- `--auth`：`nuxt-auth-utils` | `better-auth` | `none`（覆蓋 preset 的 auth 預設）
- `--ci`：`simple` | `advanced`（覆蓋 preset 的 ci 預設）
- `--db`：`supabase` | `nuxthub-d1`（覆蓋 preset 的 dbStack）
- `--evlog-preset`：`none` | `baseline` | `d-pattern-audit` | `nuxthub-ai`（覆蓋 preset 的 evlog）
- `--with`：逗號分隔 feature id，加入功能
- `--without`：逗號分隔 feature id，移除功能（含跳過 testing：`--without testing-full,testing-vitest`）
- `--minimal`：從空白功能集開始（新版改用 `--preset minimal` 更明確）

#### 破壞性變更（舊版使用者）

| 舊用法                  | 新用法                                            |
| ----------------------- | ------------------------------------------------- |
| `--preset default`      | `--preset cloudflare-supabase`（或不帶 flag）     |
| `--preset fast`         | `--preset cloudflare-supabase --without testing-full,testing-vitest` |
| `--fast`                | `--without testing-full,testing-vitest`           |

CLI 傳入舊值時會 fail 並提示等價寫法。

## 互動選單流程

第一步是 **stack preset picker**，6 個選項（5 個 preset + custom 逃生口）：

| 選項                       | 行為                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `cloudflare-supabase`      | Cloudflare + Supabase + baseline evlog（預設）                          |
| `cloudflare-nuxthub-ai`    | NuxtHub D1 + nuxthub-ai evlog + Better Auth（強制）                     |
| `vercel-supabase`          | Vercel + Supabase + baseline evlog                                     |
| `self-hosted-node`         | Node 部署 + Supabase + ci-advanced                                     |
| `minimal`                  | 最小起手：純 Nuxt + Cloudflare，無 auth / db / monitoring / extras     |
| `custom`                   | 走完整 15-prompt wizard，完全不受 preset 影響                          |

選 preset（非 custom）後 wizard 只問 **8 個非 preset 決策**：

1. 專案名稱
2. 認證系統（preset 提供 default，使用者可改）
3. UI 框架（Nuxt UI / 不需要）
4. 渲染模式（SPA / SSR）
5. 額外功能（多選：圖表、SEO、安全性、影像最佳化、VueUse）
6. 狀態管理（Pinia / 不需要）
7. 測試框架（Vitest + Playwright / 僅 Vitest / 不需要）
8. AI runtime（多選：claude-code / codex / cursor）

被 preset 決定的 prompt（資料庫 / 部署目標 / 監控 / CI 模式 / evlog preset / DB stack）會直接跳過。

選 `custom` 時走完整 15-prompt 路徑：

1. 專案名稱
2. 認證系統（nuxt-auth-utils / Better Auth / 不需要）
3. 資料庫（Supabase / 不需要）
4. UI 框架（Nuxt UI / 不需要）
5. 渲染模式（SPA / SSR）
6. 額外功能（多選：圖表、SEO、安全性、影像最佳化、VueUse）
7. 狀態管理（Pinia / 不需要）
8. 測試框架（Vitest + Playwright / 僅 Vitest / 不需要）
9. 監控（Sentry + Evlog / 不需要）
10. 部署目標（Cloudflare / Vercel / Node.js）
11. 程式碼品質（OXLint + OXFmt / 不需要）
12. Git Hooks（Husky + Commitlint / 不需要）
13. CI 模式（Simple / Advanced）
14. AI runtime（多選）
15. evlog preset + DB stack

## 功能模組一覽

| 模組 ID           | 名稱                | 說明                                | 預設 | 依賴     |
| ----------------- | ------------------- | ----------------------------------- | ---- | -------- |
| auth-nuxt-utils   | nuxt-auth-utils     | Cookie session 認證                 | ✓    | —        |
| auth-better-auth  | Better Auth         | 認證系統（Email/Password + OAuth）  | —    | database |
| database          | Supabase            | Supabase PostgreSQL 資料庫整合      | ✓    | —        |
| ui                | Nuxt UI             | Nuxt UI 元件庫 + Tailwind CSS       | ✓    | —        |
| charts            | 圖表                | Nuxt Charts（Unovis）圖表元件       | —    | —        |
| seo               | SEO                 | SEO 最佳化（Meta、Robots、Sitemap） | ✓    | —        |
| security          | 安全性              | nuxt-security（CSP headers、CSRF）  | ✓    | —        |
| image             | 影像最佳化          | @nuxt/image 自動圖片壓縮            | —    | —        |
| pinia             | Pinia               | Pinia 狀態管理 + Colada 查詢快取    | ✓    | —        |
| vueuse            | VueUse              | VueUse 響應式工具庫                 | ✓    | —        |
| testing-full      | Vitest + Playwright | 完整測試（單元 + E2E）              | ✓    | —        |
| testing-vitest    | 僅 Vitest           | 僅單元測試（無 E2E）                | —    | —        |
| monitoring        | Sentry + Evlog      | 錯誤追蹤與事件日誌                  | —    | —        |
| deploy-cloudflare | Cloudflare          | Cloudflare Workers 部署             | ✓    | —        |
| deploy-vercel     | Vercel              | Vercel 部署                         | —    | —        |
| deploy-node       | Node.js             | Node.js Server 部署                 | —    | —        |
| quality           | OXLint + OXFmt      | 程式碼品質工具（Rust 實作，極快）   | ✓    | —        |
| git-hooks         | Husky + Commitlint  | Git Hooks 與 Commit 規範            | ✓    | —        |

## 功能依賴關係

- `auth` 依賴 `database`：選擇認證系統會自動啟用 Supabase
- 部署目標互斥：cloudflare / vercel / node 只能選一個
- 測試框架互斥：testing-full / testing-vitest 只能選一個

## Template 架構

```
packages/create-nuxt-starter/
├── src/
│   ├── cli.ts          # CLI 入口（citty）
│   ├── types.ts        # FeatureModule 介面
│   ├── features.ts     # 功能模組定義
│   ├── prompts.ts      # 互動式選單
│   ├── assemble.ts     # Template 組裝引擎
│   └── post-scaffold.ts # 後置處理
├── templates/
│   ├── base/           # 基礎 Nuxt 4 模板
│   └── features/       # 功能 overlay 模板
└── test/
    └── scaffold.test.ts # Integration tests
```

## 組裝流程

1. 複製 base template 至目標目錄
2. 依序套用選定功能的 overlay 檔案
3. 合併 package.json（依賴 + scripts）
4. 生成 nuxt.config.ts（注入選定的 modules 和配置）
5. 生成 .env.example 與 .env（附加功能所需的環境變數）
6. 替換模板佔位符（{{projectName}}）
7. 安裝依賴 + Git 初始化

## 新增功能模組

在 `packages/create-nuxt-starter/src/features.ts` 中新增 `FeatureModule` 物件，並在 `templates/features/<id>/` 建立 overlay 檔案。
