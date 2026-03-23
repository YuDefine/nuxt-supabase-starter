import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'pathe'
import { getModuleById } from './features'

const TEMPLATES_DIR = resolve(import.meta.dirname, '..', 'templates')
const STARTER_ROOT = resolve(import.meta.dirname, '..', '..', '..')

export function assembleProject(
  targetDir: string,
  selectedFeatureIds: string[],
  projectName: string
): void {
  // 1. Copy base template
  copyDirectory(join(TEMPLATES_DIR, 'base'), targetDir)

  // 2. Apply feature overlays in dependency order
  const orderedFeatures = orderByDependency(selectedFeatureIds)
  for (const featureId of orderedFeatures) {
    const mod = getModuleById(featureId)
    if (!mod) continue
    const overlayDir = join(TEMPLATES_DIR, mod.templateDir)
    if (existsSync(overlayDir)) {
      copyDirectory(overlayDir, targetDir)
    }
  }

  // 3. Generate package.json
  generatePackageJson(targetDir, selectedFeatureIds, projectName)

  // 4. Generate nuxt.config.ts
  generateNuxtConfig(targetDir, selectedFeatureIds)

  // 5. Generate .env.example
  generateEnvExample(targetDir, selectedFeatureIds)

  // 6. Generate CLAUDE.md
  generateClaudeMd(targetDir, selectedFeatureIds)

  // 7. Copy skills, agents, and review rules
  copyClaudeCodeAssets(targetDir, selectedFeatureIds)

  // 8. Replace template placeholders
  replacePlaceholders(targetDir, projectName)
}

function copyDirectory(src: string, dest: string): void {
  if (!existsSync(src)) return

  const entries = readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)

    if (entry.name === '.gitkeep') continue

    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true })
      copyDirectory(srcPath, destPath)
    } else {
      mkdirSync(dirname(destPath), { recursive: true })
      cpSync(srcPath, destPath)
    }
  }
}

function copyDirectoryFiltered(src: string, dest: string, exclude: Set<string>): void {
  if (!existsSync(src)) return

  const entries = readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.gitkeep' || exclude.has(entry.name)) continue
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)

    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true })
      copyDirectoryFiltered(srcPath, destPath, exclude)
    } else {
      mkdirSync(dirname(destPath), { recursive: true })
      cpSync(srcPath, destPath)
    }
  }
}

function orderByDependency(featureIds: string[]): string[] {
  const ordered: string[] = []
  const visited = new Set<string>()

  function visit(id: string): void {
    if (visited.has(id)) return
    visited.add(id)

    const mod = getModuleById(id)
    if (mod?.dependencies) {
      for (const dep of mod.dependencies) {
        if (featureIds.includes(dep)) {
          visit(dep)
        }
      }
    }
    ordered.push(id)
  }

  for (const id of featureIds) {
    visit(id)
  }

  return ordered
}

// --- package.json generation ---

export function generatePackageJson(
  targetDir: string,
  selectedFeatureIds: string[],
  projectName: string
): void {
  const pkgPath = join(targetDir, 'package.json')
  const basePkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

  basePkg.name = projectName

  // Merge feature packages
  for (const featureId of selectedFeatureIds) {
    const mod = getModuleById(featureId)
    if (!mod) continue

    // Merge dependencies
    for (const [pkg, ver] of Object.entries(mod.packages)) {
      basePkg.dependencies = basePkg.dependencies || {}
      basePkg.dependencies[pkg] = ver
    }

    // Merge devDependencies
    if (mod.devPackages) {
      for (const [pkg, ver] of Object.entries(mod.devPackages)) {
        basePkg.devDependencies = basePkg.devDependencies || {}
        basePkg.devDependencies[pkg] = ver
      }
    }
  }

  // Add feature-specific scripts
  if (
    selectedFeatureIds.includes('testing-full') ||
    selectedFeatureIds.includes('testing-vitest')
  ) {
    basePkg.scripts.test = 'vitest run --coverage'
    basePkg.scripts['test:unit'] = 'vitest run test/unit'
    basePkg.scripts['test:watch'] = 'vitest watch'
  }
  if (selectedFeatureIds.includes('testing-full')) {
    basePkg.scripts['test:e2e'] = 'playwright test'
  }
  if (selectedFeatureIds.includes('quality')) {
    basePkg.scripts.lint = 'oxlint --deny-warnings .'
    basePkg.scripts.format = 'oxfmt .'
    basePkg.scripts['format:check'] = 'oxfmt --check .'
    basePkg.scripts.check = 'pnpm format && pnpm lint && pnpm typecheck'
    if (
      selectedFeatureIds.includes('testing-full') ||
      selectedFeatureIds.includes('testing-vitest')
    ) {
      basePkg.scripts.check += ' && pnpm test'
    }
  }
  if (selectedFeatureIds.includes('quality') && selectedFeatureIds.includes('git-hooks')) {
    basePkg['lint-staged'] = {
      '*.{js,ts,vue}': ['oxlint --fix', 'oxfmt'],
    }
  }
  if (selectedFeatureIds.includes('git-hooks')) {
    basePkg.scripts.prepare = selectedFeatureIds.includes('git-hooks')
      ? 'husky && nuxt prepare'
      : 'nuxt prepare'
  }
  if (selectedFeatureIds.includes('database')) {
    basePkg.scripts['db:reset'] = 'supabase db reset'
    basePkg.scripts['db:lint'] = 'supabase db lint --level warning'
    basePkg.scripts['db:types'] =
      'supabase gen types --lang=typescript --local | tee app/types/database.types.ts > /dev/null'
  }

  basePkg.scripts.typecheck = 'nuxt typecheck'

  // Sort dependencies
  basePkg.dependencies = sortObject(basePkg.dependencies)
  basePkg.devDependencies = sortObject(basePkg.devDependencies)

  writeFileSync(pkgPath, JSON.stringify(basePkg, null, 2) + '\n')
}

function sortObject(obj: Record<string, string> | undefined): Record<string, string> {
  if (!obj) return {}
  return Object.fromEntries(Object.entries(obj).toSorted(([a], [b]) => a.localeCompare(b)))
}

// --- nuxt.config.ts generation ---

export function generateNuxtConfig(targetDir: string, selectedFeatureIds: string[]): void {
  const configPath = join(targetDir, 'nuxt.config.ts')
  let config = readFileSync(configPath, 'utf-8')

  // Collect nuxt modules
  const modules: string[] = []
  for (const featureId of selectedFeatureIds) {
    const mod = getModuleById(featureId)
    if (mod?.nuxtModules) {
      modules.push(...mod.nuxtModules)
    }
  }

  const modulesStr = modules.map((m) => `    '${m}',`).join('\n')
  config = config.replace('    // __MODULES__', modulesStr)

  // Runtime config
  const runtimeLines: string[] = []
  const publicLines: string[] = []

  if (selectedFeatureIds.includes('database')) {
    runtimeLines.push(`    supabase: {`)
    runtimeLines.push(`      secretKey: process.env.SUPABASE_SECRET_KEY,`)
    runtimeLines.push(`    },`)
    publicLines.push(`      supabase: {`)
    publicLines.push(`        url: process.env.SUPABASE_URL,`)
    publicLines.push(`        key: process.env.SUPABASE_KEY,`)
    publicLines.push(`      },`)
  }
  if (selectedFeatureIds.includes('auth-nuxt-utils')) {
    runtimeLines.push(`    oauth: {`)
    runtimeLines.push(`      google: {`)
    runtimeLines.push(`        clientId: process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID,`)
    runtimeLines.push(`        clientSecret: process.env.NUXT_OAUTH_GOOGLE_CLIENT_SECRET,`)
    runtimeLines.push(`      },`)
    runtimeLines.push(`    },`)
    runtimeLines.push(`    session: {`)
    runtimeLines.push(`      maxAge: 60 * 60 * 24 * 7,`)
    runtimeLines.push(`      password: process.env.NUXT_SESSION_PASSWORD || '',`)
    runtimeLines.push(`    },`)
  }
  if (selectedFeatureIds.includes('auth-better-auth')) {
    runtimeLines.push(`    oauth: {`)
    runtimeLines.push(`      google: {`)
    runtimeLines.push(`        clientId: process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID,`)
    runtimeLines.push(`        clientSecret: process.env.NUXT_OAUTH_GOOGLE_CLIENT_SECRET,`)
    runtimeLines.push(`      },`)
    runtimeLines.push(`      github: {`)
    runtimeLines.push(`        clientId: process.env.NUXT_OAUTH_GITHUB_CLIENT_ID,`)
    runtimeLines.push(`        clientSecret: process.env.NUXT_OAUTH_GITHUB_CLIENT_SECRET,`)
    runtimeLines.push(`      },`)
    runtimeLines.push(`    },`)
    runtimeLines.push(`    session: {`)
    runtimeLines.push(`      maxAge: 60 * 60 * 24 * 7,`)
    runtimeLines.push(`      password: process.env.NUXT_SESSION_PASSWORD || '',`)
    runtimeLines.push(`    },`)
  }
  if (selectedFeatureIds.includes('monitoring')) {
    publicLines.push(`      sentry: {`)
    publicLines.push(`        dsn: process.env.NUXT_PUBLIC_SENTRY_DSN || '',`)
    publicLines.push(`      },`)
  }

  config = config.replace('    // __RUNTIME_CONFIG__', runtimeLines.join('\n'))
  config = config.replace('      // __RUNTIME_CONFIG_PUBLIC__', publicLines.join('\n'))

  // Config blocks
  const configBlocks: string[] = []

  if (selectedFeatureIds.includes('image')) {
    configBlocks.push(`  image: {`)
    configBlocks.push(`    quality: 80,`)
    configBlocks.push(`    format: ['webp', 'jpg', 'png'],`)
    configBlocks.push(`  },`)
  }
  if (selectedFeatureIds.includes('seo')) {
    configBlocks.push(`  site: {`)
    configBlocks.push(`    url: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000',`)
    configBlocks.push(`    name: '{{projectName}}',`)
    configBlocks.push(`    description: 'Built with Nuxt Starter',`)
    configBlocks.push(`    defaultLocale: 'zh-TW',`)
    configBlocks.push(`  },`)
    configBlocks.push(`  robots: {`)
    configBlocks.push(`    disallow: ['/auth/', '/api/'],`)
    configBlocks.push(`  },`)
  }
  if (selectedFeatureIds.includes('security')) {
    configBlocks.push(`  security: {`)
    configBlocks.push(`    rateLimiter: false,`)
    configBlocks.push(`    headers: {`)
    configBlocks.push(`      crossOriginEmbedderPolicy: false,`)
    configBlocks.push(`      contentSecurityPolicy: {`)
    configBlocks.push(`        'base-uri': ["'none'"],`)
    configBlocks.push(`        'font-src': ["'self'", 'https:', 'data:'],`)
    configBlocks.push(`        'form-action': ["'self'"],`)
    configBlocks.push(`        'frame-ancestors': ["'none'"],`)
    configBlocks.push(`        'img-src': ["'self'", 'data:', 'https:'],`)
    configBlocks.push(`        'object-src': ["'none'"],`)
    configBlocks.push(`        'script-src-attr': ["'none'"],`)
    configBlocks.push(`        'style-src': ["'self'", "'unsafe-inline'"],`)
    configBlocks.push(`        'upgrade-insecure-requests': true,`)
    configBlocks.push(`      },`)
    configBlocks.push(`      xFrameOptions: 'DENY',`)
    configBlocks.push(`    },`)
    configBlocks.push(`    csrf: true,`)
    configBlocks.push(`  },`)
  }
  if (selectedFeatureIds.includes('database')) {
    configBlocks.push(`  supabase: {`)
    configBlocks.push(`    useSsrCookies: true,`)
    configBlocks.push(`    redirect: false,`)
    configBlocks.push(`  },`)
  }
  if (selectedFeatureIds.includes('monitoring')) {
    configBlocks.push(`  sentry: {`)
    configBlocks.push(`    org: process.env.SENTRY_ORG,`)
    configBlocks.push(`    project: process.env.SENTRY_PROJECT,`)
    configBlocks.push(`    authToken: process.env.SENTRY_AUTH_TOKEN,`)
    configBlocks.push(`  },`)
    configBlocks.push(`  sourcemap: {`)
    configBlocks.push(`    client: 'hidden',`)
    configBlocks.push(`  },`)
    configBlocks.push(`  evlog: {`)
    configBlocks.push(`    env: { service: '{{projectName}}' },`)
    configBlocks.push(`    include: ['/api/**'],`)
    configBlocks.push(`  },`)
  }

  config = config.replace('  // __CONFIG_BLOCKS__', configBlocks.join('\n'))

  // Nitro config
  const nitroLines: string[] = []
  if (selectedFeatureIds.includes('deploy-cloudflare')) {
    nitroLines.push(`  nitro: {`)
    nitroLines.push(`    preset: 'cloudflare_module',`)
    nitroLines.push(`    cloudflare: {`)
    nitroLines.push(`      deployConfig: true,`)
    nitroLines.push(`      nodeCompat: true,`)
    nitroLines.push(`    },`)
    nitroLines.push(`  },`)
  } else if (selectedFeatureIds.includes('deploy-vercel')) {
    nitroLines.push(`  nitro: {`)
    nitroLines.push(`    preset: 'vercel',`)
    nitroLines.push(`  },`)
  }
  // Node.js uses default preset, no nitro config needed

  config = config.replace('  // __NITRO_CONFIG__', nitroLines.join('\n'))

  writeFileSync(configPath, config)
}

// --- .env.example generation ---

export function generateEnvExample(targetDir: string, selectedFeatureIds: string[]): void {
  const envPath = join(targetDir, '.env.example')
  const lines = [
    '# ============================================',
    '# 環境變數範本',
    '# 複製此檔案為 .env 並填入實際值',
    '# ============================================',
    '',
  ]

  for (const featureId of selectedFeatureIds) {
    const mod = getModuleById(featureId)
    if (!mod?.envVars || Object.keys(mod.envVars).length === 0) continue

    lines.push(`# --- ${mod.name} ---`)
    for (const [key, comment] of Object.entries(mod.envVars)) {
      if (comment.startsWith('#')) {
        lines.push(comment)
      }
      lines.push(`${key}=${comment.startsWith('#') ? '' : comment}`)
    }
    lines.push('')
  }

  writeFileSync(envPath, lines.join('\n'))
}

// --- Skills, agents, and review rules ---

function copyClaudeCodeAssets(targetDir: string, selectedFeatureIds: string[]): void {
  const starterSkills = join(STARTER_ROOT, '.claude', 'skills')
  const starterAgents = join(STARTER_ROOT, '.claude', 'agents')
  const targetSkills = join(targetDir, '.claude', 'skills')
  const targetAgents = join(targetDir, '.claude', 'agents')

  // Build skill list based on selected features
  const skills: string[] = [
    // Always included — core development
    'vue',
    'vue-best-practices',
    'vue-testing-best-practices',
    'nuxt',
    'vitest',
    'test-driven-development',
    'review-rules',
    'browser-use-screenshot',
  ]

  // Auth
  if (selectedFeatureIds.includes('auth-nuxt-utils')) skills.push('nuxt-auth-utils')
  if (selectedFeatureIds.includes('auth-better-auth')) skills.push('nuxt-better-auth')

  // Database
  if (selectedFeatureIds.includes('database')) {
    skills.push(
      'server-api',
      'supabase-migration',
      'supabase-rls',
      'supabase-arch',
      'supabase-postgres-best-practices'
    )
  }

  // UI — components + design skills
  if (selectedFeatureIds.includes('ui')) {
    skills.push(
      'nuxt-ui',
      'reka-ui',
      'motion',
      // Design orchestration + sub-skills
      'design',
      'frontend-design',
      'animate',
      'arrange',
      'audit',
      'bolder',
      'clarify',
      'colorize',
      'critique',
      'delight',
      'distill',
      'extract',
      'harden',
      'normalize',
      'onboard',
      'optimize',
      'overdrive',
      'polish',
      'quieter',
      'teach-impeccable',
      'typeset',
      'adapt'
    )
  }

  // State management
  if (selectedFeatureIds.includes('pinia')) skills.push('pinia', 'pinia-store')

  // VueUse
  if (selectedFeatureIds.includes('vueuse')) skills.push('vueuse', 'vueuse-functions')

  // Files to exclude from skill copies (prevent nested CLAUDE.md conflicts)
  const skillExclude = new Set(['CLAUDE.md', 'AGENTS.md'])

  // Copy each skill directory (skip if not found in starter)
  for (const skill of skills) {
    const src = join(starterSkills, skill)
    if (existsSync(src)) {
      const dest = join(targetSkills, skill)
      mkdirSync(dest, { recursive: true })
      copyDirectoryFiltered(src, dest, skillExclude)
    }
  }

  // Copy agents: code-review + check-runner + references (skip db-backup — starter-specific)
  for (const agent of ['code-review.md', 'check-runner.md']) {
    const src = join(starterAgents, agent)
    if (existsSync(src)) {
      mkdirSync(targetAgents, { recursive: true })
      cpSync(src, join(targetAgents, agent))
    }
  }

  // Copy review rules
  const reviewRulesSrc = join(starterAgents, 'references', 'project-review-rules.md')
  if (existsSync(reviewRulesSrc)) {
    const dest = join(targetAgents, 'references')
    mkdirSync(dest, { recursive: true })
    cpSync(reviewRulesSrc, join(dest, 'project-review-rules.md'))
  }
}

// --- CLAUDE.md generation ---

export function generateClaudeMd(targetDir: string, selectedFeatureIds: string[]): void {
  const hasAuthUtils = selectedFeatureIds.includes('auth-nuxt-utils')
  const hasBetterAuth = selectedFeatureIds.includes('auth-better-auth')
  const hasDatabase = selectedFeatureIds.includes('database')

  const authModule = hasAuthUtils
    ? 'nuxt-auth-utils'
    : hasBetterAuth
      ? '@onmax/nuxt-better-auth'
      : null

  const authSkill = hasAuthUtils ? '`nuxt-auth-utils`' : hasBetterAuth ? '`nuxt-better-auth`' : ''

  const sections: string[] = []

  // Header
  sections.push(`# CLAUDE.md`)
  sections.push('')
  sections.push('## Language')
  sections.push('')
  sections.push('**YOU MUST** respond in 繁體中文 (zh-TW). **NEVER** use 簡體中文 (zh-CN).')
  sections.push('')

  // Stack
  const stack = ['Nuxt 4', 'Vue 3 (Composition API + `<script setup>`)', 'TypeScript']
  if (selectedFeatureIds.includes('ui')) stack.push('Tailwind CSS', 'Nuxt UI')
  if (selectedFeatureIds.includes('pinia')) stack.push('Pinia')
  if (selectedFeatureIds.includes('vueuse')) stack.push('VueUse')
  if (hasDatabase) stack.push('Supabase (PostgreSQL)')
  if (authModule) stack.push(authModule)

  sections.push('## Stack')
  sections.push('')
  sections.push(stack.join(', '))
  sections.push('')

  // Commands
  sections.push('## Commands')
  sections.push('')
  sections.push('```bash')
  sections.push('pnpm dev             # Already running. NEVER start')
  if (selectedFeatureIds.includes('quality')) {
    sections.push('pnpm check           # format + lint + typecheck')
    sections.push('pnpm lint            # Lint only')
    sections.push('pnpm format          # Format only')
  }
  sections.push('pnpm typecheck       # Type check only')
  if (
    selectedFeatureIds.includes('testing-full') ||
    selectedFeatureIds.includes('testing-vitest')
  ) {
    sections.push('pnpm test            # All tests + coverage')
  }
  if (hasDatabase) {
    sections.push('supabase db reset    # Reset + apply all migrations')
    sections.push('supabase db lint --level warning  # Security check')
  }
  sections.push('```')
  sections.push('')

  // Critical Rules
  sections.push('## CRITICAL RULES')
  sections.push('')

  if (authModule) {
    sections.push('### Auth')
    sections.push('')
    sections.push(`**USE** \`useUserSession()\` from \`${authModule}\``)
    if (hasDatabase) {
      sections.push('**NEVER** use `useSupabaseUser()` or any Supabase Auth API')
    }
    sections.push('')
  }

  if (hasDatabase) {
    sections.push('### Database Access Pattern')
    sections.push('')
    sections.push('- **Client**: READ only via `useSupabaseClient<Database>()` + `.select()`')
    sections.push('- **Server**: ALL writes via `/api/v1/*` endpoints')
    sections.push('- **NEVER** `.insert()/.update()/.delete()/.upsert()` from client')
    sections.push('')

    sections.push('### Migration')
    sections.push('')
    sections.push('- **MUST** use `supabase migration new <name>` to create')
    sections.push('- **NEVER** create .sql files manually or via Write tool')
    sections.push("- **MUST** `SET search_path = ''` in ALL database functions")
    sections.push('- **NEVER** modify or delete applied migrations')
    sections.push('- After migration: `supabase db reset` → `db lint` → `gen types` → `typecheck`')
    sections.push('')

    sections.push('### RLS Policy')
    sections.push('')
    sections.push('API writes **MUST** include service_role bypass:')
    sections.push('')
    sections.push('```sql')
    sections.push("(SELECT auth.role()) = 'service_role' OR <user_condition>")
    sections.push('```')
    sections.push('')
  }

  sections.push('### Development')
  sections.push('')
  sections.push('- **ALWAYS** TDD: Red → Green → Refactor')
  sections.push('- **NEVER** `.skip` or comment out tests')
  if (selectedFeatureIds.includes('ui')) {
    sections.push('- **ALWAYS** Tailwind classes, NEVER manual CSS')
  }
  sections.push('- **ALWAYS** named exports, NEVER default exports')
  sections.push('- **ALWAYS** Composition API + `<script setup>`, NEVER Options API')
  sections.push('')

  // AI Skills — list all skills that are copied into the project
  const skillRows: string[] = []
  skillRows.push('| Vue components | `vue` |')
  skillRows.push('| Nuxt routing/server | `nuxt` |')
  if (selectedFeatureIds.includes('ui')) {
    skillRows.push('| UI components | `nuxt-ui` |')
    skillRows.push('| UI 設計規劃 | `/design` |')
    skillRows.push('| 建構前端介面 | `/frontend-design` |')
  }
  if (authSkill) skillRows.push(`| Auth | ${authSkill} |`)
  if (selectedFeatureIds.includes('vueuse')) skillRows.push('| VueUse | `vueuse` |')
  if (hasDatabase) {
    skillRows.push('| Server API | `server-api` |')
    skillRows.push('| Migration | `supabase-migration` |')
    skillRows.push('| RLS | `supabase-rls` |')
    skillRows.push('| Postgres | `supabase-arch` |')
  }
  if (selectedFeatureIds.includes('pinia')) skillRows.push('| Pinia Store | `pinia-store` |')
  skillRows.push('| TDD | `test-driven-development` |')
  skillRows.push('| 截圖調試 | `browser-use-screenshot` |')

  if (skillRows.length > 0) {
    sections.push('## AI Skills')
    sections.push('')
    sections.push('| Task | Skill |')
    sections.push('|------|-------|')
    sections.push(...skillRows)
    sections.push('')
  }

  writeFileSync(join(targetDir, 'CLAUDE.md'), sections.join('\n'))
}

// --- Placeholder replacement ---

function replacePlaceholders(dir: string, projectName: string): void {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      replacePlaceholders(fullPath, projectName)
    } else {
      const ext = entry.name.split('.').pop()
      if (
        ['ts', 'js', 'json', 'jsonc', 'vue', 'md', 'toml', 'yaml', 'yml', 'css', 'html'].includes(
          ext || ''
        )
      ) {
        let content = readFileSync(fullPath, 'utf-8')
        if (content.includes('{{projectName}}')) {
          content = content.replaceAll('{{projectName}}', projectName)
          writeFileSync(fullPath, content)
        }
      }
    }
  }
}
