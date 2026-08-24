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
      // sync-to-cursor 的生成物，與 .agents/.codex 同類
      '.cursor/**',
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
      // `.agents/` `.codex/` `.cursor/` 三個 agent 投影目錄都還不在 PROJECTION_EXCLUDES
      // 裡（那份清單目前只收 .claude / .clade / .spectra / vendor），所以暫時仍需這條
      // 手寫過濾。`.cursor/` 自 clade 的 sync-to-cursor 上線後也是**生成物**，不再是
      // 人工快照 —— 它一進 staged，vp lint 就會對投影進去的第三方 skill script
      // （例：.cursor/skills/impeccable/scripts/live-browser.js）報數百條錯而擋掉 commit。
      // 正解是把這三個併進 clade 的 PROJECTION_EXCLUDES 並同時清掉各 consumer 的手寫
      // 清單（要一起動，否則 audit-governance-drift check 10 會抓到 re-inline）。
      const AGENT_PROJECTION_DIRS = ['/.agents/', '/.codex/', '/.cursor/']
      const isAgentProjection = (f: string) => AGENT_PROJECTION_DIRS.some((d) => f.includes(d))
      const lintable = files.filter(
        (f) => !f.endsWith('.d.ts') && !isProjection(f) && !isAgentProjection(f),
      )
      const fmtable = files.filter((f) => !isProjection(f) && !isAgentProjection(f))
      const cmds: string[] = []
      if (lintable.length > 0) cmds.push(`vp lint --fix ${lintable.join(' ')}`)
      if (fmtable.length > 0) cmds.push(`vp fmt ${fmtable.join(' ')}`)
      return cmds.length > 0 ? cmds : ['true']
    },
  },
})
