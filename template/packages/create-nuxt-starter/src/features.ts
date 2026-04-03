import type { FeatureModule } from './types'

export const featureModules: FeatureModule[] = [
  // Auth - nuxt-auth-utils（推薦）
  {
    id: 'auth-nuxt-utils',
    name: 'nuxt-auth-utils（推薦）',
    description: 'Cookie-based session — 適用所有部署環境（Workers/Vercel/Node）',
    default: true,
    group: 'auth',
    incompatible: ['auth-better-auth'],
    packages: {
      'nuxt-auth-utils': '^0.5.29',
    },
    nuxtModules: ['nuxt-auth-utils'],
    envVars: {
      NUXT_SESSION_PASSWORD: '# 必須至少 32 字元的隨機字串（openssl rand -base64 32）',
      NUXT_OAUTH_GOOGLE_CLIENT_ID: '# Google OAuth Client ID',
      NUXT_OAUTH_GOOGLE_CLIENT_SECRET: '# Google OAuth Client Secret',
    },
    templateDir: 'features/auth-nuxt-utils',
  },

  // Auth - Better Auth
  {
    id: 'auth-better-auth',
    name: 'Better Auth',
    description: '需要 DB 連線 — ⚠️ Workers + 自架 DB 需 Hyperdrive',
    default: false,
    group: 'auth',
    incompatible: ['auth-nuxt-utils'],
    dependencies: ['database'],
    packages: {
      'better-auth': '^1.5.5',
      '@onmax/nuxt-better-auth': '0.0.2-alpha.15',
    },
    nuxtModules: ['@onmax/nuxt-better-auth'],
    envVars: {
      BETTER_AUTH_SECRET: '# 必須至少 32 字元的隨機字串（openssl rand -base64 32）',
      NUXT_SESSION_PASSWORD: '# 必須至少 32 字元的隨機字串（openssl rand -base64 32）',
      NUXT_OAUTH_GOOGLE_CLIENT_ID: '# Google OAuth Client ID',
      NUXT_OAUTH_GOOGLE_CLIENT_SECRET: '# Google OAuth Client Secret',
      NUXT_OAUTH_GITHUB_CLIENT_ID: '# GitHub OAuth Client ID',
      NUXT_OAUTH_GITHUB_CLIENT_SECRET: '# GitHub OAuth Client Secret',
    },
    templateDir: 'features/auth',
  },

  // Database
  {
    id: 'database',
    name: 'Supabase',
    description: 'Supabase PostgreSQL 資料庫整合',
    default: true,
    group: 'database',
    packages: {
      '@supabase/supabase-js': '^2.99.1',
      '@nuxtjs/supabase': '^2.0.4',
    },
    nuxtModules: ['@nuxtjs/supabase'],
    envVars: {
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_KEY: '# Supabase anon/public key',
      SUPABASE_SECRET_KEY: '# Supabase service role key',
    },
    templateDir: 'features/database',
  },

  // UI
  {
    id: 'ui',
    name: 'Nuxt UI',
    description: 'Nuxt UI 元件庫 + Tailwind CSS',
    default: true,
    group: 'ui',
    packages: {
      '@nuxt/ui': '^4.5.1',
      tailwindcss: '^4.2.1',
    },
    devPackages: {
      '@iconify-json/lucide': '^1.2.97',
    },
    nuxtModules: ['@nuxt/ui'],
    templateDir: 'features/ui',
  },

  // Charts
  {
    id: 'charts',
    name: '圖表',
    description: 'Nuxt Charts（Unovis）圖表元件',
    default: true,
    group: 'extras',
    packages: {
      'nuxt-charts': '^2.1.3',
    },
    nuxtModules: ['nuxt-charts'],
    templateDir: 'features/charts',
  },

  // SSR
  {
    id: 'ssr',
    name: 'SSR',
    description: 'Server-Side Rendering（SEO 需要）',
    default: false,
    group: 'rendering',
    packages: {},
    templateDir: 'features/ssr',
  },

  // SEO
  {
    id: 'seo',
    name: 'SEO',
    description: 'SEO 最佳化（Meta、Robots、Sitemap）',
    default: false,
    group: 'extras',
    dependencies: ['ssr'],
    packages: {
      '@nuxtjs/seo': '^3.4.0',
    },
    nuxtModules: ['@nuxtjs/seo'],
    envVars: {
      NUXT_PUBLIC_SITE_URL: 'http://localhost:3000',
    },
    templateDir: 'features/seo',
  },

  // Security
  {
    id: 'security',
    name: '安全性',
    description: 'nuxt-security（CSP headers、CSRF）',
    default: true,
    group: 'extras',
    packages: {
      'nuxt-security': '^2.5.1',
    },
    nuxtModules: ['nuxt-security'],
    templateDir: 'features/security',
  },

  // Image
  {
    id: 'image',
    name: '影像最佳化',
    description: '@nuxt/image 自動圖片壓縮',
    default: true,
    group: 'extras',
    packages: {
      '@nuxt/image': '^2.0.0',
    },
    nuxtModules: ['@nuxt/image'],
    templateDir: 'features/image',
  },

  // State Management
  {
    id: 'pinia',
    name: 'Pinia',
    description: 'Pinia 狀態管理 + Colada 查詢快取',
    default: true,
    group: 'state',
    packages: {
      '@pinia/nuxt': '^0.11.3',
      '@pinia/colada': '^1.0.0',
      '@pinia/colada-nuxt': '^0.3.2',
    },
    nuxtModules: ['@pinia/nuxt', '@pinia/colada-nuxt'],
    templateDir: 'features/pinia',
  },

  // VueUse
  {
    id: 'vueuse',
    name: 'VueUse',
    description: 'VueUse 響應式工具庫',
    default: true,
    group: 'extras',
    devPackages: {
      '@vueuse/nuxt': '^14.2.1',
    },
    packages: {},
    nuxtModules: ['@vueuse/nuxt'],
    templateDir: 'features/vueuse',
  },

  // Testing - Full
  {
    id: 'testing-full',
    name: 'Vitest + Playwright',
    description: '完整測試（單元 + E2E）',
    default: true,
    group: 'testing',
    incompatible: ['testing-vitest'],
    devPackages: {
      vitest: '^4.1.0',
      '@vitest/coverage-v8': '^4.1.0',
      '@nuxt/test-utils': '^4.0.0',
      '@playwright/test': '^1.58.2',
      '@vue/test-utils': '^2.4.6',
      'happy-dom': '^20.8.4',
    },
    packages: {},
    nuxtModules: ['@nuxt/test-utils/module'],
    templateDir: 'features/testing-full',
  },

  // Testing - Vitest only
  {
    id: 'testing-vitest',
    name: '僅 Vitest',
    description: '僅單元測試（無 E2E）',
    default: false,
    group: 'testing',
    incompatible: ['testing-full'],
    devPackages: {
      vitest: '^4.1.0',
      '@vitest/coverage-v8': '^4.1.0',
      '@nuxt/test-utils': '^4.0.0',
      '@vue/test-utils': '^2.4.6',
      'happy-dom': '^20.8.4',
    },
    packages: {},
    nuxtModules: ['@nuxt/test-utils/module'],
    templateDir: 'features/testing-vitest',
  },

  // Monitoring
  {
    id: 'monitoring',
    name: 'Sentry + Evlog',
    description: '錯誤追蹤與事件日誌',
    default: false,
    group: 'monitoring',
    packages: {
      '@sentry/nuxt': '^10.43.0',
      evlog: '^2.5.0',
    },
    nuxtModules: ['@sentry/nuxt/module', 'evlog/nuxt'],
    envVars: {
      NUXT_PUBLIC_SENTRY_DSN: '# Sentry DSN',
      SENTRY_AUTH_TOKEN: '# Sentry Auth Token',
      SENTRY_ORG: '# Sentry Organization',
      SENTRY_PROJECT: '# Sentry Project',
    },
    templateDir: 'features/monitoring',
  },

  // Deployment - Cloudflare
  {
    id: 'deploy-cloudflare',
    name: 'Cloudflare',
    description: 'Cloudflare Workers 部署',
    default: true,
    group: 'deployment',
    incompatible: ['deploy-vercel', 'deploy-node'],
    packages: {
      '@nuxthub/core': '^0.10.7',
      wrangler: '^4.72.0',
    },
    templateDir: 'features/deploy-cloudflare',
  },

  // Deployment - Vercel
  {
    id: 'deploy-vercel',
    name: 'Vercel',
    description: 'Vercel 部署',
    default: false,
    group: 'deployment',
    incompatible: ['deploy-cloudflare', 'deploy-node'],
    packages: {},
    templateDir: 'features/deploy-vercel',
  },

  // Deployment - Node
  {
    id: 'deploy-node',
    name: 'Node.js',
    description: 'Node.js Server 部署',
    default: false,
    group: 'deployment',
    incompatible: ['deploy-cloudflare', 'deploy-vercel'],
    packages: {},
    templateDir: 'features/deploy-node',
  },

  // Code Quality
  {
    id: 'quality',
    name: 'OXLint + OXFmt',
    description: '程式碼品質工具（Rust 實作，極快）',
    default: true,
    group: 'quality',
    devPackages: {
      oxlint: '^1.55.0',
      oxfmt: '^0.40.0',
    },
    packages: {},
    templateDir: 'features/quality',
  },

  // Git Hooks
  {
    id: 'git-hooks',
    name: 'Husky + Commitlint',
    description: 'Git Hooks 與 Commit 規範',
    default: true,
    group: 'git',
    devPackages: {
      husky: '^9.1.7',
      '@commitlint/cli': '^20.4.4',
      '@commitlint/config-conventional': '^20.4.4',
      'lint-staged': '^16.3.3',
    },
    packages: {},
    templateDir: 'features/git-hooks',
  },
]

export function getModuleById(id: string): FeatureModule | undefined {
  return featureModules.find((m) => m.id === id)
}

export function getModulesByGroup(group: FeatureModule['group']): FeatureModule[] {
  return featureModules.filter((m) => m.group === group)
}

export function resolveFeatureDependencies(selectedIds: string[]): string[] {
  const resolved = new Set(selectedIds)
  let changed = true

  while (changed) {
    changed = false
    for (const id of resolved) {
      const mod = getModuleById(id)
      if (mod?.dependencies) {
        for (const dep of mod.dependencies) {
          if (!resolved.has(dep)) {
            resolved.add(dep)
            changed = true
          }
        }
      }
    }
  }

  return [...resolved]
}
