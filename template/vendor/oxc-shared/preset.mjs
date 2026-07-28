// vendor/oxc-shared/preset.mjs — clade-governed oxlint + oxfmt baseline preset
//
// Single source of truth for `vite.config.ts` lint/fmt rules across:
//   - clade itself
//   - <consumer-a> / <consumer-b> / <consumer-c> / <consumer-d> / nuxt-supabase-starter
//
// Consumer usage:
//
//   import { defineConfig } from 'vite-plus'
//   import { lintBase, fmtBase } from './vendor/oxc-shared/preset.mjs'
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
// Why a preset (not inline rule duplication):
//   `rules/core/code-style.md` § MUST documents these fields as required, but
//   text-only governance does not lock structure — 5 consumers had drifted
//   (trailingComma 'es5' vs 'all', missing categories/plugins on <consumer-d>, etc.).
//   This preset turns the rule into an importable artifact; changing the
//   baseline = edit this file in clade + propagate.

/**
 * clade-projected paths. In a consumer these are LOCKED copies (chmod 444)
 * written by `scripts/propagate.mjs` — a consumer *cannot* fix a lint or fmt
 * hit inside them, because the fix has to land in clade and propagate back.
 * So whether these paths get checked is a decision the shared baseline has to
 * make; leaving it to each consumer means whichever consumer forgets to
 * re-inline the list gets a red CI it has no way to resolve locally.
 *
 * 2026-07-28: that is exactly how `nuxt-supabase-starter` Template CI broke on
 * `vp fmt --check` over `vendor/snippets/manual-review-enforcement/patterns.json`
 * — <consumer-h> and <consumer-e> had each independently patched `vendor/**`
 * into their own vite.config.ts, which hid the gap instead of closing it.
 * `scripts/audit-governance-drift.mjs` check 10 now fails on any config that
 * re-inlines one of these, so the next gap surfaces before a consumer does.
 *
 * clade itself is the source of truth for `vendor/`, so its own vite.config.ts
 * filters `vendor/**` back out — that one exception is deliberate and local.
 */
export const PROJECTION_EXCLUDES = ['.claude/**', '.clade/**', '.spectra/**', 'vendor/**']

/**
 * The slice of `vendor/` that stays excluded even in clade, where `vendor/` is
 * real source rather than a projection: snippet corpora are cookbook examples
 * (several deliberately demonstrate the anti-pattern a rule exists to ban), and
 * review-gui.mts embeds an HTML template oxfmt/oxlint both mangle.
 * clade's own vite.config.ts drops `vendor/**` and adds these back.
 */
export const CLADE_VENDOR_EXCLUDES = ['vendor/snippets/**', 'vendor/scripts/review-gui.mts']

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
    // (e.g. `function git` in publish.mjs / wt-helper.mjs) — this rule is
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
    '.claude/skills/',
    '.agents/',
    '.codex/',
    '.clade/',
    '.vite-doctor/',
    '*.d.ts',
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
    '.claude/plugins/cache/**',
    '.spectra/**',
    // Derived projections (LOCKED) by sync-to-codex; mirror lintBase so
    // consumers don't have to re-inline these in fmt.ignorePatterns.
    '.agents/**',
    '.codex/**',
    '.vite-doctor/**',
    ...PROJECTION_EXCLUDES,
  ],
}
