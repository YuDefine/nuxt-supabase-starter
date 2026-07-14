---
description: Playwright E2E webServer MUST CI-safe — 優先 @nuxt/test-utils golden 或 CI-conditional nuxt preview，NEVER 讓 CI 路徑跑依賴本地 .env / tunnel / 多程序的 dev script
paths: ['playwright.config.ts', 'playwright.config.mts', 'playwright.config.js', '**/playwright.config.ts', '**/playwright.config.mts']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/playwright-webserver.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Playwright webServer 必 CI-safe

**核心命題**：E2E 的 webServer 啟動 command 會在 **CI 乾淨環境**跑 —— `actions/checkout`
的 repo 沒有 `.env`、沒有 tunnel creds、port 配置可能跟本地不同。webServer 的 **CI 路徑
MUST 能在這個環境起來**，不可依賴任何本地 dev-only 條件。違反時 Playwright 只會回不透明
的 `Process from config.webServer was not able to start. Exit code: 1`（**webServer 子程序
的 stderr 被 Playwright 吞掉**），現場無 stack，極難判讀。

> 真相層：本檔規範 `playwright*.config.ts` 的 `webServer` / `use.nuxt` 啟動契約。dev
> 環境本身的 tunnel / port convention 是 [[dev-tunnel-convention]] / [[dev-port-allocation]]
> 的事；test 內容反模式（mock 濫用、boundary）是 [[testing-anti-patterns]] 的事。三者不重疊。
>
> 對應 pitfall：`pitfall-playwright-webserver-pnpm-dev-tunnel-ci-exit1`
> （`~/offline/clade/docs/pitfalls/2026-06-11-playwright-webserver-pnpm-dev-tunnel-ci-exit1.md`）。

## MUST

1. **webServer 的 CI 路徑走 production-ish server**：用 `@nuxt/test-utils` 的
   `use.nuxt.dev: false`（CI 自動 build + 起 server）或手動 `webServer.command` 在 CI 分支跑
   `nuxt preview`。**NEVER** 在 CI 路徑碰 dev tunnel / 多程序 dev script。
2. **`reuseExistingServer: !process.env.CI`**（手動 webServer 時）。CI 一律全新啟動，本地才
   重用已開的 server。
3. **port 對齊**：`webServer.url` / `baseURL` 的 port 必須跟 server 實際聽的 port 一致
   （手動 command 顯式帶 `--port <N>`）。Nuxt `preview` 預設聽 3000，consumer 多半不是 3000
   → 不顯式帶 port 會 connect 不到 → timeout。port 來源見 [[dev-port-allocation]]。

## NEVER

- ❌ **`webServer.command: 'pnpm dev'`**（或任何 dev script），**當該 command 沒有
  `process.env.CI ?` 分支把 CI 導向非-dev 啟動方式時**。尤其 dev script 經
  `concurrently -k` 包了 tunnel / migration / 多個子程序：CI 缺 `.env` / creds → 子程序
  `process.exit(1)` → `concurrently -k`（kill-others-on-fail）連坐打掉整組 → webServer
  exit 1，約 2 秒內快速失敗，stderr 被吞，無從判讀。
- ❌ `reuseExistingServer: true`（無條件重用）。CI 沒有「既有 server」可重用，且本地殘留的
  舊 server 會讓 E2E 跑在過時 build 上。
- ❌ 把 E2E 紅燈當「之後再看」——`workflow_run` 觸發 + 非 required check 的 E2E job 紅燈
  長期被忽略 = **false confidence**（以為有 E2E gate，實際從未綠過）。webServer 起不來的
  紅燈要當天 root-cause。

## Canonical patterns

兩種 pattern **皆為合法 CI-safe 解**。新專案優先 A；既有專案用 B 也不必遷（見下方 § Fleet）。

### A. @nuxt/test-utils golden（推薦，新專案 default）

test-utils 自動 build + 啟動 Nuxt server + 分配 port，**免手動 webServer**，CI 路徑由
`dev: !process.env.CI` 自動走 production build：

```ts
// playwright.config.ts
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import type { ConfigOptions } from '@nuxt/test-utils/playwright'

export default defineConfig<ConfigOptions>({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    nuxt: {
      rootDir: fileURLToPath(new URL('.', import.meta.url)),
      // CI 走 production build（避免 dev mode 為每個 spec 重啟 Nuxt 累積 timeout）；
      // 本地保 dev mode 利於 HMR debug。
      dev: !process.env.CI,
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
```

spec 改用 test-utils fixture：

```ts
import { test, expect } from '@nuxt/test-utils/playwright'
// await goto('/', { waitUntil: 'hydration' })
```

CI workflow **不需**獨立 `nuxt build` step（test-utils `dev:false` 自行 build）；test:e2e step
補齊 build 需要的 env（如 `SUPABASE_KEY`）。

權威 golden ref：`~/offline/nuxt-supabase-starter/template/playwright.config.ts`。

### B. CI-conditional `nuxt preview --port`（合法替代，既有專案）

手動 webServer，但用 `process.env.CI ?` 三元把 CI 導向 `nuxt preview`：

```ts
const E2E_PORT = 3100
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${E2E_PORT}`

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: BASE_URL },
  webServer: {
    // CI 已在 workflow build 過 → 只 preview；本地需先 build 再 preview。
    command: process.env.CI
      ? `npx nuxt preview --port ${new URL(BASE_URL).port}`
      : `npx nuxt build && npx nuxt preview --port ${new URL(BASE_URL).port}`,
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
})
```

要點：CI 分支**不碰 dev script**、顯式帶 `--port`、`reuseExistingServer: !process.env.CI`。
本地分支即使 fallback 到 dev server（如 <consumer-a> 的 `pnpm dev:<client-a>`）也安全 —— 因為 CI 不走
那條。權威 ref：`~/offline/<consumer-b>/playwright.config.ts`、`~/offline/<consumer-a>/playwright.config.ts`。

## Fleet pattern 決策（並存，不強制遷）

fleet 內 **test-utils golden（A）與 CI-conditional preview（B）並存皆合法**，兩者都 CI-safe。
A 為推薦 golden（新專案 default），B 為合法替代（既有專案）。**既有 consumer 不強制從 B 遷
到 A** —— 遷不遷是 consumer 自治區決定，clade 不替 consumer 規劃此類 config 重寫。

Workers runtime（如 <consumer-c> 用 `wrangler dev --local`）不適用本 pattern 表，
但同一條 MUST 仍成立：webServer CI 路徑不可依賴本地 `.env` / creds。

## 自我檢查（寫 / 改 playwright config 時）

問一句：**「這個 `webServer.command`（或 `use.nuxt.dev`）在沒有 `.env`、沒有 tunnel
creds、port 可能不同的乾淨 CI 機器上，會起來嗎？」**

- 走 test-utils + `dev: !process.env.CI` → 會（A）
- 有 `process.env.CI ?` 分支把 CI 導向 `nuxt preview --port` → 會（B）
- `command` 直接是 `pnpm dev` / dev script 且**無 CI 分支** → **不會，STOP 改成 A 或 B**

## Audit signal

`~/offline/clade/scripts/playwright-webserver-audit.mjs`（cross-consumer，diagnostic-only，
exit 0）掃每個 consumer 的 playwright config，語意感知 CI 條件分支：`webServer.command` 含
dev-server 反模式關鍵字（`pnpm dev` / `concurrently` / `dev-tunnel` / `tunnel`）**且無
`process.env.CI ?` 分支** → 報 `playwright.webserver_ci_unsafe`；`reuseExistingServer: true`
→ 次級 warn。落地由 consumer 自家 session 處理（per [[clade-role-and-todo-discipline]]）。
