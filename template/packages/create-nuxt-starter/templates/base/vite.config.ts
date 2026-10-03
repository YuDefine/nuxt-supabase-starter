import { closeSync, openSync, readdirSync, readSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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
 * 有 clade 的 consumer 之後會被 propagate 換成讀 preset 的版本；在那之前這份清單 MUST 與 preset 相同，
 * 否則 scaffold 當下的 formatter 會重排 LOCKED 投影，之後 sync-vendor 只把它們當成 consumer 客製
 * 而保留（2026-09-29 <client-a>）。
 *
 * fmt 另有 `.oxfmtignore`：vite-plus 0.1.x / oxfmt 0.48 的 `fmt.ignorePatterns`
 * 不會套用到 file walking（clade `scripts/lib/oxfmtignore-governance.ts` 有驗證紀錄），
 * 所以 `pnpm format` 要靠 `--ignore-path .oxfmtignore`。兩邊都要維護。
 */
const PROJECTION_AND_VENDOR = [
  // ↓ 與 clade preset 的 PROJECTION_EXCLUDES 相同（test/quality-readiness.test.ts 斷言涵蓋）
  '.claude/**',
  '.clade/**',
  '.spectra/**',
  'vendor/**',
  'specs/errors/**',
  '.github/actions/**',
  'commitlint.config.ts',
  '**/utils/assert-never.ts',
  '.agents/**',
  '.codex/**',
  '.cursor/**',
  // ↓ 本專案的建置產物
  'dist/**',
  '.wrangler/**',
  'node_modules/**',
  '**/database.types.ts',
]

/**
 * fmt 的風格選項與 fmt-only 排除，MUST 與 clade preset 的 `fmtBase` 相同
 * （test/quality-readiness.test.ts 斷言涵蓋）。
 *
 * 只帶 ignorePatterns 不夠：oxfmt 會退回自己的預設（雙引號加分號），而 scaffold 出來的程式碼是
 * 單引號無分號，新專案第一次 `pnpm check` 就整片格式不符（2026-10-03 AMMS：151 檔）。
 * `**\/*.md` 等條目與 preset 同理：文件不進 formatter。
 */
const FMT_STYLE = {
  semi: false,
  singleQuote: true,
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  trailingComma: 'all',
  quoteProps: 'as-needed',
  arrowParens: 'always',
  endOfLine: 'lf',
  htmlWhitespaceSensitivity: 'css',
  vueIndentScriptAndStyle: true,
  experimentalSortPackageJson: {
    sortScripts: true,
  },
} as const

const FMT_ONLY_EXCLUDES = [
  '**/*.md',
  'coverage/**',
  '.nuxt/**',
  '.output/**',
  'pnpm-lock.yaml',
  '**/evlog.map.json',
  '.vite-doctor/**',
]

/**
 * `scripts/` 底下 clade 的 🔒 LOCKED 投影（scaffold 從 starter 整棵複製過來，hook 會用到所以不能不帶）。
 * 它們的格式由 clade 那一側的 oxfmt 版本決定，與本專案版本不同時兩邊要求互斥（clade TD-1133）。
 * 與 preset 的 `lockedScriptProjections()` 同邏輯：前 3 行有註解行帶簽名才算；bootstrap 後換成讀 preset。
 * root 由本檔位置推，不靠 cwd（IDE 或子目錄載入 config 時 cwd 不是 repo 根）；單檔讀不到就跳過，
 * NEVER 讓整份 config 載入失敗。
 */
function lockedScriptProjections(): string[] {
  const root = fileURLToPath(new URL('./', import.meta.url))
  const signature = '🔒 LOCKED — managed by clade'
  const out: string[] = []
  const buf = Buffer.alloc(1024)
  const walk = (rel: string): void => {
    let entries
    try {
      entries = readdirSync(root + rel, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = rel + entry.name
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(`${path}/`)
        continue
      }
      if (!entry.isFile()) continue
      let head = ''
      try {
        const fd = openSync(root + path, 'r')
        try {
          head = buf.toString('utf8', 0, readSync(fd, buf, 0, buf.length, 0))
        } finally {
          closeSync(fd)
        }
      } catch {
        continue
      }
      const header = head.split('\n', 3)
      if (header.some((line) => /^\s*(\/\/|#)/.test(line) && line.includes(signature)))
        out.push(path)
    }
  }
  walk('scripts/')
  return out.toSorted()
}

/**
 * 只給 `staged` 過濾用的排除：根目錄 `scripts/` 混放 clade vendor 腳本，`AGENTS.md` 是 LOCKED 投影，
 * 但專案自己也有 `scripts/` 與文件要 lint／fmt。與 preset 的 STAGED_ONLY_EXCLUDES 相同。
 * **NEVER** 併進 `PROJECTION_AND_VENDOR`：那份會進 lint／fmt 的 ignorePatterns 與 `.oxfmtignore`，
 * 專案自己的 `scripts/` 就永遠退出整倉 `vp check` 與 CI（vendor/oxc-shared/preset.ts 同一條禁令）。
 */
const STAGED_ONLY_EXCLUDES = ['scripts/**', 'AGENTS.md']

/**
 * staged 檔是否該濾掉（只支援清單實際用到的形狀：目錄前綴、`**\/name`、單檔）。
 * 投影清單的單檔條目比對任意深度同名路徑（與 oxfmt／oxlint ignore 及 preset 一致）；
 * staged-only 的單檔條目只比 repo root（`docs/AGENTS.md` 是業務檔）。
 */
function isExcluded(file: string): boolean {
  const rel = file.startsWith(process.cwd()) ? file.slice(process.cwd().length + 1) : file
  const matches = (pattern: string, anyDepth: boolean): boolean => {
    if (pattern.endsWith('/**')) {
      const dir = pattern.slice(0, -3)
      return rel === dir || rel.startsWith(`${dir}/`)
    }
    const name = pattern.replace(/^\*\*\//, '')
    return rel === name || (anyDepth && rel.endsWith(`/${name}`))
  }
  return (
    PROJECTION_AND_VENDOR.some((pattern) => matches(pattern, true)) ||
    STAGED_ONLY_EXCLUDES.some((pattern) => matches(pattern, false))
  )
}

export default defineConfig({
  lint: {
    ignorePatterns: PROJECTION_AND_VENDOR,
  },
  fmt: {
    ...FMT_STYLE,
    ignorePatterns: [...PROJECTION_AND_VENDOR, ...FMT_ONLY_EXCLUDES, ...lockedScriptProjections()],
  },
  // 只在 clade bootstrap 之前（還沒有 scripts/pre-commit/runner.sh）由 .husky/pre-commit 使用。
  // 全被濾掉時回空陣列：lint-staged 語義是「這格沒事做」，NEVER 讓 vp 收到空輸入而 exit 1。
  staged: {
    '*.{js,ts,mjs,cjs,vue}': (files: readonly string[]) => {
      const kept = files.filter((file) => !isExcluded(file)).map((file) => JSON.stringify(file))
      return kept.length > 0 ? [`vp check --fix ${kept.join(' ')}`] : []
    },
  },
})
