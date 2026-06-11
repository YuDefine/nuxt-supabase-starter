import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineVitestProject } from '@nuxt/test-utils/config'
import { defineConfig } from 'vite-plus'

const rootDir = dirname(fileURLToPath(import.meta.url))

/**
 * Test-only env defaults. `defineVitestProject()` boots the real Nuxt build to
 * extract its vite config, which runs every module's setup — some (better-auth,
 * session) hard-fail without a secret when Nuxt is not in dev mode. These are
 * obvious non-production placeholders (≥32 chars where required) and use `??=`
 * so a real `.env` always wins. Keeps `pnpm test` working straight after
 * scaffold without provisioning real secrets.
 */
process.env.BETTER_AUTH_SECRET ??= 'test-only-better-auth-secret-0000000000000000'
process.env.NUXT_SESSION_PASSWORD ??= 'test-only-session-password-0000000000000000'

/**
 * Vitest config — read by `vp test` in preference to `vite.config.ts`
 * (vite-plus config resolution order: vitest.config.* → vite.config.*).
 *
 * Two-project split mirrors the three-layer testing strategy
 * (`docs/guide/TESTING_STRATEGY.md`):
 *   - `unit`  → plain Vitest (Node), fast logic / composable / util tests.
 *   - `nuxt`  → `@nuxt/test-utils` Nuxt runtime, component tests via
 *               `mountSuspended()`. `defineVitestProject()` loads the real
 *               Nuxt build so `environmentOptions.nuxt` (rootId, runtimeConfig,
 *               auto-imports …) is injected — without it the `nuxt` environment
 *               crashes at `setupWindow` reading `undefined.rootId`.
 *
 * Nuxt only loads here (test path), not in `vite.config.ts`, so `vp fmt` /
 * `vp lint` / `vp build` stay free of the Nuxt resolve cost.
 */
export default defineConfig(async () => ({
  test: {
    coverage: {
      provider: 'v8',
    },
    projects: [
      {
        // `#shared` is a Nuxt built-in alias; the `nuxt` project gets it from
        // the resolved Nuxt config, but the plain-Node `unit` project must
        // declare it so server handlers importing `#shared/**` resolve.
        resolve: {
          alias: {
            '#shared': resolve(rootDir, 'shared'),
          },
        },
        test: {
          name: 'unit',
          // Default include (`**/*.{test,spec}.*`) catches the starter's
          // `test/unit/**` plus the scaffolder package tests
          // (`packages/create-nuxt-starter/test/**`). `*.nuxt.test.ts` is
          // excluded here and owned by the `nuxt` project below.
          environment: 'node',
          exclude: [
            'e2e/**',
            'node_modules/**',
            '.nuxt/**',
            '.output/**',
            'temp/**',
            '**/*.nuxt.test.ts',
          ],
          setupFiles: ['./test/setup-env.ts'],
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          include: ['test/nuxt/**/*.nuxt.test.ts'],
          environment: 'nuxt',
          setupFiles: ['./test/setup-env.ts'],
        },
      }),
    ],
  },
}))
