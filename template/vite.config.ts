import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'
import { fmtBase, lintBase } from './vendor/oxc-shared/preset.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '#shared': resolve(__dirname, 'shared'),
    },
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', '.nuxt/**', '.output/**'],
    setupFiles: ['./test/setup-env.ts'],
    coverage: {
      provider: 'v8',
    },
  },
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
      const lintable = files.filter(
        (f) =>
          !f.endsWith('.d.ts') &&
          !f.includes('/.claude/skills/') &&
          !f.includes('/.agents/') &&
          !f.includes('/.codex/'),
      )
      const fmtable = files.filter(
        (f) => !f.includes('/.claude/') && !f.includes('/.agents/') && !f.includes('/.codex/'),
      )
      const cmds: string[] = []
      if (lintable.length > 0) cmds.push(`vp lint --fix ${lintable.join(' ')}`)
      if (fmtable.length > 0) cmds.push(`vp fmt ${fmtable.join(' ')}`)
      return cmds.length > 0 ? cmds : ['true']
    },
  },
})
