# 整合指南

將 Claude Code 配置和 Supabase 整合注入現有 Nuxt 專案。

**適用情境**：你已經有一個 Nuxt 專案，想要加入本 Starter 的 AI 開發工具和 Supabase 整合。

> 如果你想從零開始，請使用 [QUICK_START.md](QUICK_START.md)。

---

## 整合項目總覽

| 類別        | 內容                                | 必要性 |
| ----------- | ----------------------------------- | ------ |
| Claude 配置 | CLAUDE.md、commands、agents、skills | 推薦   |
| Supabase    | 資料庫整合、TypeScript 類型         | 選用   |
| 開發工具    | 品質檢查腳本、commitlint            | 推薦   |
| Better Auth | OAuth 認證                          | 選用   |

---

## 1. Claude Code 配置

### 1.1 複製 CLAUDE.md

```bash
# 從 Starter 複製 CLAUDE.md 到你的專案根目錄
curl -o CLAUDE.md https://raw.githubusercontent.com/Charles5277/nuxt-supabase-starter/main/CLAUDE.md
```

**重要**：修改 CLAUDE.md 中的以下區塊以符合你的專案：

```markdown
## 📋 Project Overview

<!-- TODO: 替換為你的專案說明 -->

[專案名稱] 是一個使用 Nuxt 4 和 Nuxt UI 建構的 [專案類型] 系統。

### Key Objectives

- [目標 1]
- [目標 2]
- [目標 3]
```

### 1.2 複製 .claude 目錄

```bash
# 複製整個 .claude 目錄
git clone --depth 1 https://github.com/Charles5277/nuxt-supabase-starter.git /tmp/starter
cp -r /tmp/starter/.claude .
rm -rf /tmp/starter

# 建立 settings.local.json
cp .claude/settings.local.json.example .claude/settings.local.json
```

### 1.3 設定 Claude Code 權限

編輯 `.claude/settings.local.json`，根據你的需求調整權限：

```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm typecheck:*)",
      "Bash(pnpm test:*)",
      "Bash(pnpm lint:*)",
      "Bash(pnpm format:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git diff:*)",
      "Bash(git status:*)",
      "Bash(git log:*)"
    ]
  }
}
```

如果不使用 Supabase，移除以下權限：

```json
"mcp__local-supabase__*",
"Bash(supabase *:*)"
```

---

## 2. 開發工具整合

### 2.1 加入 package.json scripts

將以下腳本加入你的 `package.json`：

```json
{
  "scripts": {
    "check": "pnpm format && pnpm lint && pnpm typecheck && pnpm test",
    "format": "oxfmt .",
    "format:check": "oxfmt --check .",
    "lint": "oxlint --deny-warnings .",
    "test": "vitest run --coverage",
    "test:unit": "vitest run test/unit",
    "test:watch": "vitest watch",
    "typecheck": "nuxt typecheck"
  }
}
```

### 2.2 安裝開發依賴

```bash
pnpm add -D oxfmt oxlint vitest @vitest/coverage-v8 @nuxt/test-utils happy-dom
```

### 2.3 設定 Vitest

建立 `vitest.config.ts`：

```typescript
import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['app/**/*.{ts,vue}', 'server/**/*.ts'],
      exclude: ['**/*.d.ts', '**/*.test.ts'],
    },
  },
})
```

### 2.4 加入 Commitlint（選用）

```bash
pnpm add -D @commitlint/cli @commitlint/config-conventional husky lint-staged
```

建立 `commitlint.config.js`：

```javascript
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'chore',
        'refactor',
        'test',
        'style',
        'docs',
        'build',
        'ci',
        'revert',
        'deploy',
        'init',
      ],
    ],
  },
}
```

初始化 Husky：

```bash
npx husky init
echo "npx --no -- commitlint --edit \$1" > .husky/commit-msg
echo "npx lint-staged" > .husky/pre-commit
```

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

如果要讓 Claude 直接操作 Supabase，在 `.claude/settings.local.json` 加入：

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

### 4.1 安裝依賴

```bash
pnpm add @onmax/nuxt-better-auth better-auth
```

### 4.2 設定 Nuxt 模組

在 `nuxt.config.ts` 加入：

```typescript
export default defineNuxtConfig({
  modules: ['@onmax/nuxt-better-auth'],
})
```

### 4.3 建立認證配置

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

### 4.4 設定環境變數

在 `.env` 加入：

```bash
# Better Auth（必填）
BETTER_AUTH_SECRET=<32字元隨機字串>

# Session（必填）
NUXT_SESSION_PASSWORD=<32字元隨機字串>

# 站點配置
NUXT_PUBLIC_SITE_URL=http://localhost:3000

# OAuth（選用）
# NUXT_OAUTH_GOOGLE_CLIENT_ID=<client_id>
# NUXT_OAUTH_GOOGLE_CLIENT_SECRET=<client_secret>
```

產生隨機字串：

```bash
openssl rand -base64 32
```

---

## 5. 目錄結構建議

整合完成後，你的專案應該有以下結構：

```
your-project/
├── CLAUDE.md              # AI 開發規範
├── .claude/
│   ├── settings.local.json
│   ├── commands/          # 自定義指令（/tdd、/commit 等）
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
├── vitest.config.ts
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
> /tdd 幫我寫一個簡單函式
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

只執行第 1 和第 2 節的步驟。在 `.claude/settings.local.json` 中移除 Supabase 相關權限。

### Q: Skills 怎麼更新？

技術 Skills（nuxt、vue 等）由 [nuxt-skills](https://github.com/onmax/nuxt-skills) 自動維護。你可以設定 GitHub Actions 定期同步。

### Q: 可以只用部分 Commands 嗎？

可以。刪除不需要的 `.claude/commands/*.md` 檔案即可。常用的 `/tdd` 和 `/commit` 建議保留。

---

## 相關文件

| 文件                                         | 說明                  |
| -------------------------------------------- | --------------------- |
| [QUICK_START.md](QUICK_START.md)             | 從零開始建立完整專案  |
| [CLAUDE_CODE_GUIDE.md](CLAUDE_CODE_GUIDE.md) | Claude Code 詳細配置  |
| [SUPABASE_MCP.md](SUPABASE_MCP.md)           | Supabase MCP 整合說明 |
| [WORKFLOW.md](WORKFLOW.md)                   | TDD 開發流程          |
