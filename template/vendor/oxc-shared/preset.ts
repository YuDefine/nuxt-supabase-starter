// 🔒 LOCKED — managed by clade · Source: vendor/oxc-shared/preset.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/oxc-shared/preset.ts
// vendor/oxc-shared/preset.ts — clade-governed oxlint + oxfmt baseline preset
//
// Single source of truth for `vite.config.ts` lint/fmt rules across:
//   - clade itself
//   - <consumer-a> / <consumer-b> / <consumer-c> / <consumer-d> / nuxt-supabase-starter
//
// Consumer usage:
//
//   import { defineConfig } from 'vite-plus'
//   import { lintBase, fmtBase } from './vendor/oxc-shared/preset.ts'
//
//   export default defineConfig({
//     resolve: { alias: [...] },                         // consumer build config
//     lint: {
//       ...lintBase,
//       rules: { ...lintBase.rules, /* business overrides */ },
//       ignorePatterns: [...lintBase.ignorePatterns, /* extra paths */],
//     },
//     fmt: {
//       ...fmtBase,
//       experimentalTailwindcss: { stylesheet: './app/assets/css/main.css' },
//       ignorePatterns: [...fmtBase.ignorePatterns, /* extra paths */],
//     },
//   })
//
// lint-staged / `staged` hook 的排除清單 MUST 追溯得到 `PROJECTION_EXCLUDES`，NEVER 手寫
// 一份平行的。預設形狀是直接用 preset 匯出的 `stagedBase`（一行，不必自己組 filter）：
//
//   import { fmtBase, lintBase, stagedBase } from './vendor/oxc-shared/preset.ts'
//
//   export default defineConfig({ /* … */ staged: stagedBase })
//
// glob 要客製（例如 `'*': 'vp check --fix'` 那種形狀）時改用 `isProjectionPath`：
//
//   import { isProjectionPath } from './vendor/oxc-shared/preset.ts'
//   staged: {
//     '*': (files) => {
//       const t = files.filter((f) => !isProjectionPath(f))
//       return t.length > 0 ? [`vp check --fix ${t.join(' ')}`] : ['true']
//     },
//   }
//
//   `vp lint` / `vp fmt` 對「輸入路徑全被 ignore」回 **exit 1**，而投影層本來就在上面兩個
//   ignorePatterns 內。所以只要 staged 檔裡有一個投影檔、而 hook 沒把它濾掉，整個
//   pre-commit 就掛 —— 症狀是 `No files found to lint`，看起來像路徑打錯，不像被 ignore。
//   手寫平行清單必然漂移：nuxt-supabase-starter 的 staged filter 排了 `.claude/skills/`
//   `.agents/` `.codex/` 卻漏掉 `vendor/`，連續擋掉 clade v1.4.388 / v1.4.389 / v1.4.409
//   三次交付（TD-310）。這裡的 `PROJECTION_EXCLUDES` 一改，所有讀它的 consumer 自動跟上。
//
//   `.agents/` `.codex/` `.cursor/` 也在這份清單裡（2026-08-24 起），所以 staged filter
//   **NEVER** 再另外維護一份 agent 投影目錄的手寫陣列。
//
// Why a preset (not inline rule duplication):
//   `rules/core/code-style.md` § MUST documents these fields as required, but
//   text-only governance does not lock structure — 5 consumers had drifted
//   (trailingComma 'es5' vs 'all', missing categories/plugins on <consumer-d>, etc.).
//   This preset turns the rule into an importable artifact; changing the
//   baseline = edit this file in clade + propagate.

/**
 * clade-projected paths. In a consumer these are LOCKED copies (chmod 444)
 * written by `scripts/propagate.ts` — a consumer *cannot* fix a lint or fmt
 * hit inside them, because the fix has to land in clade and propagate back.
 * So whether these paths get checked is a decision the shared baseline has to
 * make; leaving it to each consumer means whichever consumer forgets to
 * re-inline the list gets a red CI it has no way to resolve locally.
 *
 * 2026-07-28: that is exactly how `nuxt-supabase-starter` Template CI broke on
 * `vp fmt --check` over `vendor/snippets/manual-review-enforcement/patterns.json`
 * — <consumer-k> and <consumer-i> had each independently patched `vendor/**`
 * into their own vite.config.ts, which hid the gap instead of closing it.
 * `scripts/audit-governance-drift.ts` check 10 now fails on any config that
 * re-inlines one of these, so the next gap surfaces before a consumer does.
 *
 * clade itself is the source of truth for `vendor/`, so its own vite.config.ts
 * filters `vendor/**` back out — that one exception is deliberate and local.
 *
 * 2026-08-24 (TD-626): the three agent projection dirs joined this list. They had
 * been sitting only in lintBase/fmtBase.ignorePatterns, which the `staged` filter
 * never reads — so every consumer hand-wrote its own parallel copy, the exact
 * drift the comment at the top of this file exists to ban.
 */
export const PROJECTION_EXCLUDES = [
  '.claude/**',
  '.clade/**',
  '.spectra/**',
  'vendor/**',
  // Agent 投影面：`.agents/` `.codex/` 由 scripts/sync-to-codex.ts 生成，`.cursor/` 由
  // scripts/sync-to-cursor.ts 生成（2026-08-24 起，先前是人工快照）。三者與上面四條同性質
  // —— consumer 端是產生物，裡面的 lint / fmt 違規只能回 clade 修。先前它們只躺在下面的
  // lintBase / fmtBase.ignorePatterns，沒進這份清單，所以讀 PROJECTION_EXCLUDES 的 staged
  // filter 看不到它們，每個 consumer 只好各自手寫一份平行清單（TD-626）。
  '.agents/**',
  '.codex/**',
  '.cursor/**',
]

/**
 * The slice of `vendor/` that stays excluded even in clade, where `vendor/` is
 * real source rather than a projection: snippet corpora are cookbook examples
 * (several deliberately demonstrate the anti-pattern a rule exists to ban), and
 * review-gui.ts embeds an HTML template oxfmt/oxlint both mangle.
 * clade's own vite.config.ts drops `vendor/**` and adds these back.
 */
// review-gui 本體與其 sibling 全部排除：SPA 的 HTML/CSS/前端 JS 是一整個 template
// string，oxfmt 會重排字串內容、oxlint 會對字串裡的 client-side JS 誤報。用 glob 而非
// 逐一列名 —— 拆檔後新增 sibling 若忘了加，格式化會直接改壞 embedded template。
export const CLADE_VENDOR_EXCLUDES = ['vendor/snippets/**', 'vendor/scripts/review-gui*.ts']

/**
 * `PROJECTION_EXCLUDES` 的目錄前綴形式（`'.clade/**'` → `'.clade/'`），給逐檔比對用。
 * glob 形式餵不了 staged hook —— hook 拿到的是 `git diff --name-only` 的相對路徑字串。
 */
export const projectionPrefixes = PROJECTION_EXCLUDES.map((p) => p.replace(/\/\*\*$/, '/'))

/**
 * 這個 staged 檔路徑是不是投影層（LOCKED、chmod 444、consumer 端改不動）。
 *
 * `startsWith` 接 repo root 的投影（`.clade/vendor/scripts/flow.ts`），`includes('/'+dir)`
 * 接巢狀落點（starter 的 `template/.claude/...`）。兩條缺一都會漏。
 *
 * 型別必須寫成 TS 註記，NEVER 只留 JSDoc `@param {string}`：本檔副檔名是 `.ts`，
 * JSDoc 型別只有 `.js` 檔（allowJs + checkJs）才會被採納。consumer 端跑
 * `noImplicitAny` 的 typecheck 時，未標註的參數一律 TS7006，投影過去就把對方的
 * pre-push 擋死（v1.11.86 實際擋住 <consumer-a>）。
 *
 * @param file staged 檔的相對路徑
 */
export function isProjectionPath(file: string): boolean {
  return projectionPrefixes.some((dir) => file.startsWith(dir) || file.includes(`/${dir}`))
}

/**
 * consumer `vite.config.ts` 的 `staged` 現成值 —— 直接 `staged: stagedBase` 即可，
 * NEVER 再自己抄一份 filter（那正是本檔檔頭那條 MUST 要禁的漂移）。
 *
 * 為什麼一定要濾：`vp lint` / `vp fmt` 對「輸入路徑**全部**被 ignore」回 exit 1，訊息是
 * `No files found to lint`，長得像路徑打錯。而 `propagate.ts` 走
 * `git commit --only -- <clade-paths>`，它 commit 的**必然全是投影檔** —— 沒濾的 consumer
 * 每一趟 propagate 都站在觸發線上（2026-08-26 v1.11.84：<consumer-i> 整個 pre-commit 掛，
 * propagate 回 failed，TD-670）。
 *
 * **NEVER 在這裡加 `'*.md'` 那一格**：`fmtBase.ignorePatterns` 含 `'**\/*.md'`，所以
 * markdown 對 `vp fmt` 永遠是空輸入 → 每次純 md commit 都 exit 1。那不是投影層的洞，
 * 是同一個空輸入語義的另一個入口（2026-08-26 實測 <consumer-c> 就有這一格）。
 *
 * glob 不含 `*.d.ts` 的排除是刻意的：`.d.ts` 在 `lintBase.ignorePatterns` 內、卻不在
 * `fmtBase` 內，所以它要進 fmt、不能進 lint。
 *
 * 需要自訂 glob（例如 `'*': 'vp check --fix'` 那種形狀）時改用 `isProjectionPath`
 * 自己組，一樣算接上這條 MUST。
 */
export const stagedBase = {
  '*.{js,ts,mjs,cjs,vue}': (files: readonly string[]) => {
    const fmtable = files.filter((f) => !isProjectionPath(f))
    const lintable = fmtable.filter((f) => !f.endsWith('.d.ts'))
    const cmds = []
    if (lintable.length > 0) cmds.push(`vp lint --fix ${lintable.join(' ')}`)
    if (fmtable.length > 0) cmds.push(`vp fmt ${fmtable.join(' ')}`)
    // 全被濾掉時回 no-op —— 回空陣列 lint-staged 會當成「這格沒事做」照過，但回
    // `['true']` 語義更明確，且與既有兩台（<consumer-f> / starter template）逐字相同。
    return cmds.length > 0 ? cmds : ['true']
  },
}

/** @type {import('oxlint').OxlintConfig} */
export const lintBase = {
  categories: {
    correctness: 'error',
    suspicious: 'warn',
    pedantic: 'off',
    perf: 'warn',
    style: 'off',
    restriction: 'off',
    nursery: 'off',
  },
  rules: {
    'no-console': 'off',
    'no-debugger': 'warn',
    'no-alert': 'error',
    'no-undef': 'off',
    '@typescript-eslint/no-unused-vars': 'warn',
    eqeqeq: ['error', 'always'],
    'no-await-in-loop': 'off',
    // 2026-05-31: newer oxlint (CI via unpinned setup-vp@v1) surfaces
    // unicorn/consistent-function-scoping in an on-category; local oxlint 1.63.0
    // does not yet. clade/consumer scripts use nested helpers by design
    // (e.g. `function git` in publish.ts / wt-helper.ts) — this rule is
    // stylistic noise here. Explicit pin off prevents CI lint drift on oxlint
    // version bumps (same pattern as no-underscore-dangle below).
    'unicorn/consistent-function-scoping': 'off',
    // <consumer-a> 2026-05-14: oxlint ^0.1.21 patch upgrade flipped this from warn→error.
    // Explicit pin keeps `_serviceClient` / fixture private prefix conventions
    // from breaking CI lint gate on lockfile regen. `allow` covers:
    //   __dirname / __filename — Node ESM reconstructions (via fileURLToPath)
    //   _serviceClient — Supabase admin-client private convention (<consumer-a> / <consumer-d>)
    //   _samples / _corrupt / _evlogFlushPromise — internal audit/digest fields
    //     in vendor/scripts/*, plugins/hub-core/scripts/commit-lock.mjs, and
    //     vendor/snippets/evlog-drain-pipeline/* (all propagate to consumers).
    'no-underscore-dangle': [
      'warn',
      {
        allow: [
          '__dirname',
          '__filename',
          '_serviceClient',
          '_samples',
          '_corrupt',
          '_evlogFlushPromise',
        ],
      },
    ],
    // === Coupling / cohesion gate（規約見 rules/core/coupling-cohesion.md）===
    // 這兩條是「SOLID 在 functional TS 語境」唯一機械可判定的部分：cycle =
    // 兩個模組互相依賴具體實作（DIP），barrel = 隱性依賴聚合。
    //
    // 刻意 NOT 收錄 max-lines-per-function / complexity / max-depth / max-params：
    // 它們量的是分支密度與規模，不是職責內聚，而 microsoft/TypeScript、vuejs/core、
    // vitejs/vite、facebook/react、nuxt/nuxt、antfu/eslint-config、xo 八個對照對象
    // 無一啟用。實測 <consumer-b> 862 violations / 542 檔（其中 88% 近 30 天仍在改），
    // 訊號雜訊比不足以進 gate。
    //
    // no-cycle 依賴 plugins 的 'import'（已在下方啟用），不需 CLI flag。已驗證
    // 它在只 lint 單一 staged 檔時仍能遞迴追出 cycle，且解得到 Nuxt 的 `~/` alias
    // （tsconfig extends chain 與 project references 兩種形狀皆可）。
    'import/no-cycle': 'error',
    'oxc/no-barrel-file': 'error',
  },
  plugins: ['typescript', 'unicorn', 'import', 'promise'],
  env: {
    browser: true,
    node: true,
    es2024: true,
  },
  ignorePatterns: [
    'node_modules/',
    '.nuxt/',
    '.output/',
    'dist/',
    'coverage/',
    'supabase/',
    '.vite-doctor/',
    '*.d.ts',
    // `.claude/` `.clade/` `.agents/` `.codex/` `.cursor/` 全部由 PROJECTION_EXCLUDES 帶入。
    ...PROJECTION_EXCLUDES,
  ],
}

/** @type {import('oxfmt').OxfmtConfig} */
export const fmtBase = {
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
  ignorePatterns: [
    '**/*.md',
    'coverage/**',
    '.nuxt/**',
    '.output/**',
    'pnpm-lock.yaml',
    // evlog map 的產出（tracked 是為了當 ratchet baseline）。工具每次重生都會寫出
    // 非 canonical 形式，不排除的話每次更新 baseline 都要多跑一次 fmt，且 lint-staged
    // 會在 commit 當下偷改內容並 re-stage。與上面的 lockfile 同類：tracked 的產生物。
    '**/evlog.map.json',
    '.vite-doctor/**',
    // 投影面（`.claude/` `.clade/` `.spectra/` `vendor/` `.agents/` `.codex/` `.cursor/`）
    // 一律由 PROJECTION_EXCLUDES 帶入 —— consumer 不必在自己的 fmt.ignorePatterns 再列一次。
    ...PROJECTION_EXCLUDES,
  ],
}
