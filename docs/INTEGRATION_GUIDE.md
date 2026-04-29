# 整合指南

將 Claude Code 配置和 Supabase 整合注入現有 Nuxt 專案。

**適用情境**：你已經有一個 Nuxt 專案，想要加入本 Starter 的 AI 開發工具和 Supabase 整合。

> 如果你想從零開始，請使用 [QUICK_START.md](QUICK_START.md)。

---

## 整合項目總覽

| 類別        | 內容                                                  | 必要性 |
| ----------- | ----------------------------------------------------- | ------ |
| Clade       | 中央倉的 rules / skills / hooks / scripts 投影到 `.claude/` | 推薦   |
| Claude 配置 | CLAUDE.md、commands、agents、settings.json（本地）    | 推薦   |
| Supabase    | 資料庫整合、TypeScript 類型                           | 選用   |
| 開發工具    | 品質檢查腳本、commitlint                              | 推薦   |
| Better Auth | OAuth 認證                                            | 選用   |

---

## 1. Claude Code 配置（Claude Code First + clade）

本 starter 採「**Claude Code First + clade 中央倉**」架構：

```
clade（~/offline/clade）         ← 跨專案共用：rules / skills / hooks / scripts
  └→ 你的專案/.claude/            ← 投影目標 + 你的 settings.json / hub.json
       └→ .codex/ / .agents/ / AGENTS.md    ← sync-to-agents 投影
```

### 1.1 安裝 clade 中央倉（首次）

```bash
git clone https://github.com/YuDefine/clade.git ~/offline/clade
# 或設 CLADE_HOME 到自訂路徑
```

### 1.2 把現有專案註冊為 clade consumer

進入你現有 Nuxt 專案根目錄，跑 clade 的 `init-consumer.mjs` 一鍵建立：

```bash
cd /path/to/your-existing-nuxt-app

node ~/offline/clade/scripts/init-consumer.mjs \
  --auth better-auth \
  --db-schema supabase \
  --db-runtime cf-workers \
  --runtime cf-workers \
  --framework nuxt
```

參數說明（依專案實況調整）：

| Flag           | 可選值                                           | 說明                                |
| -------------- | ------------------------------------------------ | ----------------------------------- |
| `--auth`       | `better-auth` / `nuxt-auth-utils` / `supabase-self-hosted` | 認證機制                            |
| `--db-schema`  | `supabase` / `supabase-self-hosted`              | DB schema 來源                      |
| `--db-runtime` | `cf-workers` / `supabase-self-hosted`            | DB 連線 runtime                     |
| `--runtime`    | `cf-workers` / `vercel-node` / `nitro-self-hosted` | 部署 runtime                        |
| `--framework`  | `nuxt` / `next` / `sveltekit`                    | 框架（本 starter 的場景固定 `nuxt`） |
| `--local-hooks` | 例如 `post-migration-gen-types.sh`              | 你自家保留的 `.claude/hooks/*.sh`（逗號分隔） |
| `--force`      | —                                                | 覆寫既有 `.claude/hub.json`         |

`init-consumer.mjs` 會做：

1. 寫 `.claude/hub.json`（manifest）
2. Vendor `.claude/hooks/_bootstrap-check.sh`（SessionStart 自動 drift 偵測）
3. Patch `.claude/settings.json` — 加 SessionStart hook、清掉 stale hook 引用
4. Patch `package.json` — 加 `postinstall` + `hub:bootstrap` / `hub:check` / `hub:sync` / `hub:doctor` / `hub:prune` / `hub:vendor` 等 scripts
5. 跑 `bootstrap-hub.mjs` — 從 clade 拉所有 rules / skills / hooks / scripts 進 `.claude/`

### 1.3 投影到 Codex / Cursor 等 runtime（可選）

若你也用 Codex / Cursor / 其他 AI runtime，`.codex/`、`.agents/`、`AGENTS.md` 都是從 `.claude/` sync-to-agents 投影出來的：

```bash
node ~/.claude/scripts/sync-to-agents.mjs
```

**禁止**直接編輯 `.codex/` 或 `AGENTS.md` — 要改先回 `.claude/` 改、再 sync。

### 1.4 修改 CLAUDE.md 對齊你的專案

```bash
curl -o CLAUDE.md https://raw.githubusercontent.com/YuDefine/nuxt-supabase-starter/main/template/CLAUDE.md
```

替換 `## Project` / `## Stack` 區塊：

```markdown
## Project

[專案名稱] 是一個使用 Nuxt 4 和 Nuxt UI 建構的 [專案類型] 系統。

## Stack

Nuxt 4, Vue 3 (Composition API + <script setup>), TypeScript, Tailwind CSS, Nuxt UI, Pinia, VueUse, Supabase (PostgreSQL)
```

### 1.5 設定 Claude Code 權限

編輯 `.claude/settings.json`，根據你的需求調整權限：

```json
{
  "permissions": {
    "allow": [
      "Bash(ls:*)",
      "Bash(node:*)",
      "Bash(cat:*)",
      "Bash(find:*)",
      "Bash(tree:*)",
      "Bash(jq:*)",
      "Bash(curl:*)",
      "Bash(supabase:*)",
      "Bash(pnpm check:*)",
      "Bash(pnpm test:*)",
      "Bash(pnpm lint:*)",
      "Bash(pnpm format:*)",
      "Bash(pnpm typecheck:*)",
      "Bash(pnpm build:*)",
      "Bash(pnpm dev:*)",
      "Bash(pnpm add:*)",
      "Bash(pnpm db:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git diff:*)",
      "Bash(git status:*)",
      "Bash(git log:*)",
      "Bash(git push:*)",
      "Bash(git fetch:*)",
      "Bash(git stash:*)",
      "Bash(git checkout:*)",
      "Bash(git restore:*)"
    ]
  }
}
```

如果不使用 Supabase，移除以下權限和設定：

```json
// permissions.allow 中移除：
"mcp__local-supabase__list_tables",
"mcp__local-supabase__list_migrations",
"mcp__local-supabase__execute_sql",
"mcp__local-supabase__search_docs",
"mcp__local-supabase__get_advisors",
"mcp__local-supabase__apply_migration",
"Bash(supabase:*)",
"Bash(pnpm db:*)"

// 頂層移除：
"enabledMcpjsonServers": ["local-supabase"]
```

---

## 2. 開發工具整合

### 2.1 加入 package.json scripts

將以下腳本加入你的 `package.json`：

```json
{
  "scripts": {
    "check": "vp check && pnpm typecheck",
    "format": "vp fmt",
    "format:check": "vp fmt --check",
    "lint": "vp lint",
    "test": "vp test --coverage",
    "test:unit": "vp test test/unit",
    "test:watch": "vp test --watch",
    "typecheck": "nuxt typecheck",
    "prepare": "vp config && bash scripts/restore-hooks.sh && nuxt prepare"
  }
}
```

### 2.2 安裝開發依賴

```bash
pnpm add -D vite-plus @nuxt/test-utils happy-dom
```

### 2.3 設定 Vite+

建立 `vite.config.ts`（統一管理 test / lint / fmt / staged）：

```typescript
import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    exclude: ['e2e/**', 'node_modules/**', '.nuxt/**', '.output/**'],
    coverage: {
      provider: 'v8',
    },
  },
  lint: {
    categories: {
      correctness: 'error',
      suspicious: 'warn',
      pedantic: 'off',
      perf: 'warn',
      style: 'off',
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
  fmt: {
    semi: false,
    singleQuote: true,
    printWidth: 100,
    trailingComma: 'es5',
    experimentalTailwindcss: {
      stylesheet: './app/assets/css/main.css',
    },
  },
  staged: {
    '*.{js,ts,vue}': ['vp lint --fix', 'vp fmt'],
  },
})
```

### 2.4 加入 Commitlint（選用）

```bash
pnpm add -D @commitlint/cli @commitlint/config-conventional
```

建立 `commitlint.config.js`（使用 emoji 前綴格式）：

```javascript
export default {
  extends: ['@commitlint/config-conventional'],

  // 自定義解析器：支援 "✨ feat: message" 格式
  parserPreset: {
    parserOpts: {
      headerPattern:
        /^(✨ feat|🐛 fix|🧹 chore|🔨 refactor|🧪 test|🎨 style|📝 docs|📦 build|👷 ci|⏪ revert|🚀 deploy|🎉 init): (.+)$/,
      headerCorrespondence: ['type', 'subject'],
    },
  },

  rules: {
    'type-enum': [
      2,
      'always',
      [
        '✨ feat',
        '🐛 fix',
        '🧹 chore',
        '🔨 refactor',
        '🧪 test',
        '🎨 style',
        '📝 docs',
        '📦 build',
        '👷 ci',
        '⏪ revert',
        '🚀 deploy',
        '🎉 init',
      ],
    ],
    // 關閉 type-case 檢查（type 包含 emoji 和空格）
    'type-case': [0],
    // 關閉 type-empty 檢查（由 type-enum 處理）
    'type-empty': [0],
    'subject-case': [0],
  },
}
```

設定 commit-msg hook：

```bash
# vp config 會建立 .vite-hooks/ 目錄
pnpm prepare
echo '#!/usr/bin/env sh
pnpm commitlint --edit $1' > .vite-hooks/commit-msg
chmod +x .vite-hooks/commit-msg
```

> `restore-hooks.sh` 會在每次 `pnpm prepare` 時從 `scripts/templates/vite-hooks/` 還原自訂 hooks，避免被 `vp config` 覆蓋。

---

## 3. Supabase 整合

### 3.1 安裝依賴

```bash
pnpm add @nuxtjs/supabase @supabase/supabase-js
```

### 3.2 設定 Nuxt 模組

在 `nuxt.config.ts` 加入：

```typescript
export default defineNuxtConfig({
  modules: ['@nuxtjs/supabase'],

  supabase: {
    useSsrCookies: true,
    redirect: false,
    // 使用 Better Auth 時禁用 Supabase Auth 重導向
  },
})
```

### 3.3 建立 Server 工具函式

建立 `server/utils/supabase.ts`：

```typescript
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~~/app/types/database.types'

let serviceClient: SupabaseClient<Database> | null = null

/**
 * 取得 Supabase Service Role Client（Singleton）
 * ⚠️ 此 Client 無 RLS 保護，僅用於 Server 端
 */
export function getServerSupabaseClient(): SupabaseClient<Database> {
  if (serviceClient) return serviceClient

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !serviceKey) {
    throw createError({
      statusCode: 500,
      message: '伺服器設定錯誤：缺少 Supabase 環境變數',
    })
  }

  serviceClient = createClient<Database>(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return serviceClient
}
```

### 3.4 設定環境變數

在 `.env` 加入：

```bash
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<Publishable_key>
SUPABASE_SECRET_KEY=<Secret_key>

# 給 Nuxt 使用
NUXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NUXT_PUBLIC_SUPABASE_KEY=<Publishable_key>
```

### 3.5 加入 Supabase MCP（選用）

如果要讓 Claude 直接操作 Supabase，在 `.claude/settings.json` 加入：

```json
{
  "permissions": {
    "allow": [
      "mcp__local-supabase__list_tables",
      "mcp__local-supabase__list_migrations",
      "mcp__local-supabase__execute_sql",
      "mcp__local-supabase__search_docs",
      "mcp__local-supabase__get_advisors",
      "Bash(supabase migration:*)",
      "Bash(supabase db reset:*)",
      "Bash(supabase db lint:*)",
      "Bash(supabase gen types:*)"
    ]
  },
  "enabledMcpjsonServers": ["local-supabase"]
}
```

並確保已安裝 Supabase CLI：

```bash
brew install supabase/tap/supabase
```

### 3.6 加入資料庫腳本

在 `package.json` 加入：

```json
{
  "scripts": {
    "db:reset": "supabase db reset",
    "db:lint": "supabase db lint --level warning",
    "db:types": "supabase gen types --lang=typescript --local | tee app/types/database.types.ts > /dev/null"
  }
}
```

---

## 4. Better Auth 整合（選用）

基本認證設定（安裝、環境變數、模組配置）請參考 [QUICK_START.md](QUICK_START.md)，以下僅說明現有專案整合的差異。

### 4.1 建立認證配置檔

新專案使用 Starter 範本時，這些檔案已內建。現有專案需手動建立：

建立 `app/auth.config.ts`：

```typescript
import { defineClientAuth } from '@onmax/nuxt-better-auth/config'

export default defineClientAuth({
  // 可在此加入 client-side plugins
})
```

建立 `server/auth.config.ts`：

```typescript
import { defineServerAuth } from '@onmax/nuxt-better-auth/config'

export default defineServerAuth({
  emailAndPassword: { enabled: true },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 天
    updateAge: 60 * 60 * 24, // 每 24 小時更新
  },
})
```

---

## 5. 目錄結構建議

整合完成後，你的專案應該有以下結構：

```
your-project/
├── CLAUDE.md              # AI 開發規範
├── .claude/
│   ├── settings.json
│   ├── commands/          # 自定義指令（/commit、/db-migration 等）
│   ├── agents/            # SubAgents（check-runner 等）
│   └── skills/            # AI Skills
├── app/
│   ├── auth.config.ts     # Client 認證配置（選用）
│   └── types/
│       └── database.types.ts  # Supabase 類型（選用）
├── server/
│   ├── auth.config.ts     # Server 認證配置（選用）
│   └── utils/
│       └── supabase.ts    # Supabase 工具（選用）
├── test/
│   └── unit/              # 單元測試
├── vite.config.ts          # Vite+ 統一設定
├── commitlint.config.js   # （選用）
└── package.json
```

---

## 6. 驗證整合

### 6.1 驗證 Claude Code

```bash
# 啟動 Claude Code
claude

# 測試指令
> 執行 pnpm check
> 幫我寫一個簡單函式
```

### 6.2 驗證開發工具

```bash
# 執行完整檢查
pnpm check

# 預期輸出：format → lint → typecheck → test 全部通過
```

### 6.3 驗證 Supabase（如有整合）

```bash
# 啟動本地 Supabase
supabase start

# 測試連線
supabase status
```

---

## 常見問題

### Q: 我只想要 Claude 配置，不要 Supabase

只執行第 1 和第 2 節的步驟。在 `.claude/settings.json` 中移除 Supabase 相關權限。

### Q: Skills 怎麼更新？

技術 Skills（nuxt、vue 等）由 [nuxt-skills](https://github.com/onmax/nuxt-skills) 自動維護。你可以設定 GitHub Actions 定期同步。

### Q: 可以只用部分 Commands 嗎？

可以。刪除不需要的 `.claude/commands/*.md` 檔案即可。常用的 `/commit` 建議保留。TDD 流程已改為 `test-driven-development` skill，會自動觸發。

---

## 相關文件

| 文件                                                | 說明                  |
| --------------------------------------------------- | --------------------- |
| [QUICK_START.md](QUICK_START.md)                    | 從零開始建立完整專案  |
| [CLAUDE_CODE_GUIDE.md](CLAUDE_CODE_GUIDE.md)        | Claude Code 詳細配置  |
| [SUPABASE_MCP.md](../template/docs/SUPABASE_MCP.md) | Supabase MCP 整合說明 |
| [WORKFLOW.md](../template/docs/WORKFLOW.md)         | SDD、TDD 開發流程     |
