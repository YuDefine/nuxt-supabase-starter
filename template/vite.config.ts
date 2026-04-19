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
      '.github/**',
    ],
  },
  staged: {
    '*.{js,ts,vue}': ['vp lint --fix', 'vp fmt'],
  },
})
