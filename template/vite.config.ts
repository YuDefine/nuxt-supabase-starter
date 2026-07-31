import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'
import { fmtBase, lintBase, PROJECTION_EXCLUDES } from './vendor/oxc-shared/preset.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

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
    ignorePatterns: [...(lintBase.ignorePatterns ?? []), '.agent/'],
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
    ignorePatterns: [
      ...fmtBase.ignorePatterns,
      'dist/**',
      'node_modules/**',
      '**/database.types.ts',
      '.claude/**',
      '.agents/**',
      '.agent/**',
      '.codex/**',
      '.github/**',
    ],
  },
  staged: {
    '*.{js,ts,vue}': (files) => {
      // 投影層（LOCKED、chmod 444）已在共用 preset 的 ignorePatterns 內，而 vp 對
      // 「輸入路徑全被 ignore」回 exit 1 —— staged 這裡若手寫一份平行清單，只要 preset
      // 多排除一個目錄、這裡沒跟上，那個目錄的檔一進 staged 就整個 pre-commit 掛掉。
      // clade 的 v1.4.388 / v1.4.389 / v1.4.409 三次交付都是被這個洞擋下的（漏的是
      // `vendor/`）。改成直接讀 preset 匯出的 PROJECTION_EXCLUDES，消掉漂移本身。
      const projectionPrefixes = PROJECTION_EXCLUDES.map((p) => p.replace(/\/\*\*$/, '/'))
      const isProjection = (f: string) => projectionPrefixes.some((d) => f.includes(`/${d}`))
      const lintable = files.filter(
        (f) =>
          !f.endsWith('.d.ts') &&
          !isProjection(f) &&
          !f.includes('/.agents/') &&
          !f.includes('/.codex/'),
      )
      const fmtable = files.filter(
        (f) => !isProjection(f) && !f.includes('/.agents/') && !f.includes('/.codex/'),
      )
      const cmds: string[] = []
      if (lintable.length > 0) cmds.push(`vp lint --fix ${lintable.join(' ')}`)
      if (fmtable.length > 0) cmds.push(`vp fmt ${fmtable.join(' ')}`)
      return cmds.length > 0 ? cmds : ['true']
    },
  },
})
