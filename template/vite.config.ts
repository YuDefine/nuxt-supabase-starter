import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'
import { fmtBase, lintBase, toRepoRelative } from './vendor/oxc-shared/preset.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

// lint / fmt 的 ignorePatterns 提到 config 外面，讓底下的 `staged` 讀**同一份值**。
// 為什麼不能只濾投影層：`vp lint` / `vp fmt` 對「輸入路徑全被 ignore」回 exit 1
// （訊息 `Expected at least one target file.`），而觸發它的不只是 PROJECTION_EXCLUDES
// —— 本檔自己追加的 `**/database.types.ts` 同樣是空輸入的來源。2026-09-03：
// packages/create-nuxt-starter/templates/features/database/app/types/database.types.ts
// 一進 staged 就讓整個 pre-commit 掛掉，連續擋掉 clade v1.12.8 / v1.12.9 兩趟 propagate。
// 原本的 staged filter 只比對 PROJECTION_EXCLUDES，看不到這一格。
const lintIgnorePatterns = [...(lintBase.ignorePatterns ?? []), '.agent/']
const fmtIgnorePatterns = [
  ...fmtBase.ignorePatterns,
  'dist/**',
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

export default defineConfig({
  resolve: {
    alias: {
      '#shared': resolve(__dirname, 'shared'),
    },
  },
  // Test config lives in `vitest.config.ts` (vp test reads it first); keeping a
  // `test` block here too would be a dead second source of truth.
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
})
