import { defineConfig } from 'vite-plus'

/**
 * 投影層與 vendored 第三方檔案一律不進 lint / fmt。
 *
 * 這些目錄的內容**不是本專案寫的**：`.claude/` `.agents/` `.codex/` `.cursor/`
 * 是 clade 的投影（多數 chmod 444，改不動），`vendor/snippets/` 是 cookbook 語料
 * （有些刻意示範反模式、有些是含 `<PLACEHOLDER>` 的樣板、根本不是合法 TS）。
 * 不排除的後果不是「多幾條警告」，而是**每一次 `pnpm check` 都紅**：
 * oxfmt 撞到 `vendor/snippets/dev-port/nuxt-config-tunnel.template.ts` 的
 * `port: <DEV_PORT>` 直接 parse error，oxlint 對 `.claude/skills/impeccable/scripts/`
 * 的 UMD bundle 報上百條 warning，而 `--deny-warnings` 會把它們算成失敗。
 *
 * 這份清單刻意寫成**行內字面值**而不是 import clade 的 `PROJECTION_EXCLUDES`：
 * scaffold 出去的專案不保證有 clade（`vendor/oxc-shared/preset.ts` 要 bootstrap
 * 之後才存在），import 一個可能不存在的檔會讓 vite-plus 整個起不來。
 * 有 clade 的 consumer 之後會被 propagate 換成讀 preset 的版本。
 *
 * fmt 另有 `.oxfmtignore`：vite-plus 0.1.x / oxfmt 0.48 的 `fmt.ignorePatterns`
 * 不會套用到 file walking（clade `scripts/lib/oxfmtignore-governance.ts` 有驗證紀錄），
 * 所以 `pnpm format` 要靠 `--ignore-path .oxfmtignore`。兩邊都要維護。
 */
const PROJECTION_AND_VENDOR = [
  '.claude/**',
  '.clade/**',
  '.agents/**',
  '.codex/**',
  '.cursor/**',
  'vendor/**',
  'dist/**',
  '.wrangler/**',
  'node_modules/**',
  '**/database.types.ts',
]

export default defineConfig({
  lint: {
    ignorePatterns: PROJECTION_AND_VENDOR,
  },
  fmt: {
    ignorePatterns: PROJECTION_AND_VENDOR,
  },
  staged: {
    '*': 'vp check --fix',
  },
})
