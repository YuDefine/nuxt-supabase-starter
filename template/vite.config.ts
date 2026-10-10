import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'
import { fmtBase, lintBase, testBase, toRepoRelative } from './vendor/oxc-shared/preset.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

// lint / fmt 的 ignorePatterns 提到 config 外面，讓底下的 `staged` 讀**同一份值**。
// 為什麼不能只濾投影層：`vp lint` / `vp fmt` 對「輸入路徑全被 ignore」回 exit 1
// （訊息 `Expected at least one target file.`），而觸發它的不只是 PROJECTION_EXCLUDES
// —— 本檔自己追加的 `**/database.types.ts` 同樣是空輸入的來源。2026-09-03：
// packages/create-nuxt-starter/templates/features/database/app/types/database.types.ts
// 一進 staged 就讓整個 pre-commit 掛掉，連續擋掉 clade v1.12.8 / v1.12.9 兩趟 propagate。
// 原本的 staged filter 只比對 PROJECTION_EXCLUDES，看不到這一格。
const lintIgnorePatterns = [
  ...(lintBase.ignorePatterns ?? []),
  '.agent/',
  // `presets/` 下所有 lintable 檔都是 clade sync-evlog-presets 的 LOCKED 投影
  // （source 端在 clade 就列 CLADE_VENDOR_EXCLUDES 不 lint）；違規只能回 clade 修，
  // 與 PROJECTION_EXCLUDES 收 `.github/actions/**` 同判準。`.sql`/`.json` 非 lint
  // 目標，不排除也不影響。
  'presets/**',
]
const fmtIgnorePatterns = [
  ...fmtBase.ignorePatterns,
  'dist/**',
  '.wrangler/**',
  'node_modules/**',
  '**/database.types.ts',
  // `.claude/` `.agents/` `.codex/` `.cursor/` 全部由 preset 的 PROJECTION_EXCLUDES
  // 帶入（clade TD-626）—— 這裡 NEVER 再 inline 一次。`.agent/`（單數）不是投影。
  '.agent/**',
  '.github/**',
]

/**
 * staged 檔是否被該工具的 ignorePatterns 蓋到。
 *
 * 只支援 ignorePatterns 實際用到的三種形狀：目錄前綴（`dir/` / `dir/**`）、
 * basename（`**\/name.ts`）、副檔名（`*.d.ts` / `**\/*.md`）。多的形狀出現時
 * 回 false（不濾），症狀是 loud 的 lint 失敗而不是無聲放行。
 *
 * 先 `toRepoRelative` 再比對：lint-staged 餵進來的是**絕對路徑**（本機實測），
 * 對原始字串做 `includes('/' + dir)` 會被 repo 外的同名祖先目錄誤殺（clade TD-770）。
 */
function isIgnored(file: string, patterns: readonly string[]): boolean {
  const rel = toRepoRelative(file)
  if (rel.startsWith('/')) return false
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  return patterns.some((raw) => {
    const p = raw.replace(/\/(?:\*\*)?$/, '')
    if (p.startsWith('**/')) {
      const tail = p.slice(3)
      return tail.startsWith('*') ? base.endsWith(tail.slice(1)) : base === tail
    }
    if (p.startsWith('*')) return base.endsWith(p.slice(1))
    if (p.includes('*')) return false
    return rel === p || rel.startsWith(`${p}/`) || rel.includes(`/${p}/`)
  })
}

/** 逐檔加引號：lint-staged 把回傳字串交給 string-argv 依空白拆（clade TD-770）。 */
function quoteArgs(files: readonly string[]): string {
  return files.map((f) => JSON.stringify(f)).join(' ')
}

export default defineConfig(async () => {
  /**
   * `defineVitestProject()` 會 boot 完整 Nuxt build 萃取它的 vite config —— 這個
   * 成本只有 test 路徑該付。`vp lint` / `vp fmt` / `vp staged` / `vp build` 同樣
   * 載入本檔，但它們不設 `VITEST` env（vitest 5 在解析 config 前設 `VITEST=true`），
   * 用它把 Nuxt boot 與 `@nuxt/test-utils` 的 import 都限制在 `vp test`。
   *
   * 測試用 env 預設值同理：`defineVitestProject()` 的 Nuxt boot 會跑每個 module 的
   * setup，better-auth / session 在非 dev 模式缺 secret 會直接炸。全部 `??=`，
   * 真實 `.env` 永遠優先，scaffold 後沒配 secret 也能直接 `pnpm test`。
   */
  const isVitest = process.env.VITEST === 'true'
  if (isVitest) {
    process.env.BETTER_AUTH_SECRET ??= 'test-only-better-auth-secret-0000000000000000'
    process.env.NUXT_SESSION_PASSWORD ??= 'test-only-session-password-0000000000000000'
  }

  /**
   * Project split mirrors the three-layer testing strategy
   * (`docs/guide/TESTING_STRATEGY.md`):
   *   - `unit`  → plain Vitest (Node), fast logic / composable / util tests.
   *   - `scaffolder` → package config, including its filesystem/process timeouts.
   *   - `nuxt`  → `@nuxt/test-utils` Nuxt runtime, component tests via
   *               `mountSuspended()`. `defineVitestProject()` loads the real
   *               Nuxt build so `environmentOptions.nuxt` (rootId, runtimeConfig,
   *               auto-imports …) is injected — without it the `nuxt` environment
   *               crashes at `setupWindow` reading `undefined.rootId`.
   */
  const projects = [
    {
      // Vitest v4 compatibility: keep this inline project independent of the root config.
      // Remove to inherit root options, including plugins and setup files.
      // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
      // https://vitest.dev/guide/migration/#inline-projects-inherit-the-root-config-by-default
      extends: false,
      // `#shared` is a Nuxt built-in alias; the `nuxt` project gets it from
      // the resolved Nuxt config, but the plain-Node `unit` project must
      // declare it so server handlers importing `#shared/**` resolve.
      resolve: {
        alias: {
          '#shared': resolve(__dirname, 'shared'),
        },
      },
      test: {
        // Vitest v4 compatibility: preserve mock call history.
        // Remove after tests no longer rely on calls from setup or earlier tests.
        // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
        // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
        clearMocks: false,
        name: 'unit',
        // Package and Nuxt tests use their own project configuration.
        environment: 'node',
        exclude: [
          ...testBase.exclude,
          'e2e/**',
          'packages/create-nuxt-starter/**',
          '.nuxt/**',
          '.output/**',
          'temp/**',
          '**/*.nuxt.test.ts',
          '**/*.dev.test.ts',
        ],
        setupFiles: ['./test/setup-env.ts'],
      },
    },
    {
      // Vitest v4 compatibility: keep this inline project independent of the root config.
      // Remove to inherit root options, including plugins and setup files.
      // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
      // https://vitest.dev/guide/migration/#inline-projects-inherit-the-root-config-by-default
      extends: false,
      // Exercise the dev-only handler while the unit project keeps its production guard.
      define: { 'import.meta.dev': 'true' },
      test: {
        // Vitest v4 compatibility: preserve mock call history.
        // Remove after tests no longer rely on calls from setup or earlier tests.
        // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
        // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
        clearMocks: false,
        name: 'dev-login',
        include: ['test/unit/server/api/_dev/*.dev.test.ts'],
        environment: 'node',
        setupFiles: ['./test/setup-env.ts'],
      },
    },
    {
      extends: resolve(__dirname, 'packages/create-nuxt-starter/vitest.config.ts'),
      root: resolve(__dirname, 'packages/create-nuxt-starter'),
      test: { name: 'scaffolder' },
    },
  ]

  if (isVitest) {
    const { defineVitestProject } = await import('@nuxt/test-utils/config')
    projects.push(
      await defineVitestProject({
        test: {
          name: 'nuxt',
          include: ['test/nuxt/**/*.nuxt.test.ts'],
          exclude: testBase.exclude,
          environment: 'nuxt',
          hookTimeout: 60_000,
          setupFiles: ['./test/setup-env.ts'],
        },
      }),
    )
  }

  return {
    test: {
      // Vitest v4 compatibility: preserve mock call history.
      // Remove after tests no longer rely on calls from setup or earlier tests.
      // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
      // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
      clearMocks: false,
      // Vitest v4 compatibility: keep separate Vite servers for inline projects.
      // Remove when plugins and config hooks can run once for shared projects.
      // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
      // https://vitest.dev/guide/migration/#inline-projects-share-the-vite-server-by-default
      sharedViteServer: false,
      coverage: {
        provider: 'v8',
      },
      projects,
    },
    resolve: {
      alias: {
        '#shared': resolve(__dirname, 'shared'),
      },
    },
    lint: {
      ...lintBase,
      ignorePatterns: lintIgnorePatterns,
    },
    fmt: {
      ...fmtBase,
      experimentalTailwindcss: {
        stylesheet: './app/assets/css/main.css',
        attributes: ['class'],
        functions: [],
        preserveDuplicates: false,
        preserveWhitespace: false,
      },
      ignorePatterns: fmtIgnorePatterns,
    },
    staged: {
      '*.{js,ts,mjs,cjs,vue}': (files: readonly string[]) => {
        const lintable = files.filter((f) => !isIgnored(f, lintIgnorePatterns))
        const fmtable = files.filter((f) => !isIgnored(f, fmtIgnorePatterns))
        const cmds: string[] = []
        if (lintable.length > 0) cmds.push(`vp lint --fix ${quoteArgs(lintable)}`)
        if (fmtable.length > 0) cmds.push(`vp fmt ${quoteArgs(fmtable)}`)
        // 全被濾掉時回**空陣列**：lint-staged 的語義是「這格沒事做」，照過。
        // NEVER 回 `['true']` —— 那是原生 Windows 沒有的 shell 依賴（clade TD-770）。
        return cmds
      },
    },
  }
})
