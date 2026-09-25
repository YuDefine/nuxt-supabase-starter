---
description: Playwright E2E webServer MUST CI-safe — 優先 @nuxt/test-utils golden 或 CI-conditional nuxt preview，NEVER 讓 CI 路徑跑依賴本地 .env / tunnel / 多程序的 dev script
paths: ['playwright.config.ts', 'playwright.config.js', '**/playwright.config.ts']
---
<!-- Clade native rule; source: rules/core/playwright-webserver.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Playwright webServer 必 CI-safe

webServer 的 **CI 路徑 MUST 能在乾淨 CI 環境起來**（沒有 `.env`、沒有 tunnel creds、port 可能不同）。違反時 Playwright 只回 `Process from config.webServer was not able to start. Exit code: 1`，子程序 stderr 被吞。見 [[pitfall-playwright-webserver-pnpm-dev-tunnel-ci-exit1]]。

## MUST

1. **webServer 的 CI 路徑走 production-ish server**：用 `@nuxt/test-utils` 的
   `use.nuxt.dev: false`（CI 自動 build + 起 server）或手動 `webServer.command` 在 CI 分支跑
   `nuxt preview`。**NEVER** 在 CI 路徑碰 dev tunnel / 多程序 dev script。
2. **`reuseExistingServer: !process.env.CI`**（手動 webServer 時）。CI 一律全新啟動，本地才
   重用已開的 server。
3. **port 對齊**：`webServer.url` / `baseURL` 的 port 必須跟 server 實際聽的 port 一致
   （手動 command 顯式帶 `--port <N>`，Nuxt `preview` 預設 3000）。port 來源見 [[dev-port-allocation]]。

## NEVER

- ❌ **`webServer.command: 'pnpm dev'`**（或任何 dev script），**當該 command 沒有
  `process.env.CI ?` 分支把 CI 導向非-dev 啟動方式時**（`concurrently -k` 包 tunnel 的 dev script 在 CI 缺 creds 會連坐整組 exit 1）。
- ❌ `reuseExistingServer: true`（無條件重用）。
- ❌ 把 E2E 紅燈當「之後再看」——非 required check 的 E2E 長期紅是 false confidence，webServer 起不來要當天 root-cause。

## Canonical patterns

兩種 pattern **皆為合法 CI-safe 解**。新專案優先 A；既有 consumer 不強制從 B 遷到 A（consumer 自治）。

### A. @nuxt/test-utils golden（推薦，新專案 default）

test-utils 自動 build + 啟動 + 分配 port，CI 路徑由 `dev: !process.env.CI` 走 production build：

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

#### ⚠️ A 的適用邊界：build 必須在 60 秒內完成

`dev: false` 讓 production build 發生在 fixture setup 裡，而 test-utils 的 `FIXTURE_TIMEOUT` 寫死 60s（非 Windows）、外部無法覆寫，預先 build 也不會被重用（buildDir 每次隨機）。超時訊息：`Fixture "_nuxtHooks" timeout of 60000ms exceeded during setup.`

**MUST 在採用 A 之前確認 build 時間**（別假設）：

```bash
time pnpm build     # 在**目標 runner 規格**上量，不是開發者機器
```

- 明顯低於 60s（留足餘裕）→ A 可用
- 接近或超過 60s → **MUST 用 B**（自架 runner 較慢，app 會長大）
- 已經在跑 A 才發現超時 → 遷 B（見下方 § Fleet pattern 決策）

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

要點：CI 分支**不碰 dev script**、顯式帶 `--port`、`reuseExistingServer: !process.env.CI`；本地分支用 dev server 也安全。

## Fleet pattern 決策（並存，不強制遷）

A 與 B 並存皆合法。**反方向（A → B）在 build > 60s 時是必要的**，判準用實測 build 時間。

遷移三步（A → B）：

1. CI workflow 在跑 E2E 的 job 裡加 build step
2. `playwright.config.ts` 從 `use.nuxt` 改成 § B 的 `webServer` + `process.env.CI ?` 分支
3. spec 從 `@nuxt/test-utils/playwright` 的 `{ page, goto }` fixture 改回 `@playwright/test`
   的 `page` + `baseURL`（B 不提供 `goto` fixture 與 `waitUntil: 'hydration'`）

Workers runtime（`wrangler dev --local`）不適用本 pattern 表，但 webServer CI 路徑不可依賴本地 `.env` / creds 仍成立。

## 自我檢查（寫 / 改 playwright config 時）

問一句：**「這個 `webServer.command`（或 `use.nuxt.dev`）在沒有 `.env`、沒有 tunnel
creds、port 可能不同的乾淨 CI 機器上，會起來嗎？」**

- 走 test-utils + `dev: !process.env.CI` → 會（A）
- 有 `process.env.CI ?` 分支把 CI 導向 `nuxt preview --port` → 會（B）
- `command` 直接是 `pnpm dev` / dev script 且**無 CI 分支** → **不會，STOP 改成 A 或 B**

## Audit signal

`~/offline/clade/scripts/playwright-webserver-audit.ts`（cross-consumer，diagnostic-only，
exit 0）掃每個 consumer 的 playwright config，語意感知 CI 條件分支：`webServer.command` 含
dev-server 反模式關鍵字（`pnpm dev` / `concurrently` / `dev-tunnel` / `tunnel`）**且無
`process.env.CI ?` 分支** → 報 `playwright.webserver_ci_unsafe`；`reuseExistingServer: true`
→ 次級 warn。落地 **MUST relay 給該 consumer 的 session**，**NEVER** 讓義務停在「出了 warn」。
