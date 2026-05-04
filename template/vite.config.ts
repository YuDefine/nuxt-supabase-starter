import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '#shared': resolve(__dirname, 'shared'),
    },
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', '.nuxt/**', '.output/**'],
    coverage: {
      provider: 'v8',
    },
  },
  lint: {
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
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-undef': 'off',
      eqeqeq: ['error', 'always'],
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
      '.agent/',
      '.codex/',
      '*.d.ts',
    ],
  },
  fmt: {
    semi: false,
    singleQuote: true,
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    trailingComma: 'es5',
    quoteProps: 'as-needed',
    arrowParens: 'always',
    endOfLine: 'lf',
    htmlWhitespaceSensitivity: 'css',
    vueIndentScriptAndStyle: true,
    experimentalTailwindcss: {
      stylesheet: './app/assets/css/main.css',
      attributes: ['class'],
      functions: [],
      preserveDuplicates: false,
      preserveWhitespace: false,
    },
    experimentalSortPackageJson: {
      sortScripts: true,
    },
    ignorePatterns: [
      'coverage/**',
      '.nuxt/**',
      '.output/**',
      'dist/**',
      'node_modules/**',
      '**/database.types.ts',
      'pnpm-lock.yaml',
      '.claude/**',
      '.agents/**',
      '.agent/**',
      '.codex/**',
      '.github/**',
    ],
  },
  staged: {
    '*.{js,ts,vue}': ['vp lint --fix', 'vp fmt'],
    // .md 過濾 clade LOCKED 投影路徑（.claude/{rules,skills,hooks,agents,commands}、
    // .agents/、.codex/）；這些檔案被 fmt.ignorePatterns 全部 filter 後給 vp fmt 會以
    // 'All matched files may have been excluded by ignore rules' 失敗（vp 0.1.20 仍在）。
    // 但 lint-staged transform 回傳 [] 又會觸發 vp staged「Expected at least one target file」，
    // 兩個 vp 行為都搞不定空陣列；折衷：0 target 時回傳 ['true'] noop bash 命令避開。
    '*.md': (files) => {
      const allowed = files.filter(
        (f) =>
          !f.includes('/.claude/rules/') &&
          !f.includes('/.claude/skills/') &&
          !f.includes('/.claude/hooks/') &&
          !f.includes('/.claude/agents/') &&
          !f.includes('/.claude/commands/') &&
          !f.includes('/.agents/') &&
          !f.includes('/.codex/')
      )
      return allowed.length > 0 ? [`vp fmt ${allowed.join(' ')}`] : ['true']
    },
  },
})
