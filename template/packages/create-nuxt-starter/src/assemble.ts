import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
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

  // 7. Copy shared template assets first so scaffold inherits template updates.
  copyTemplateClaudeAssets(targetDir)
  copyTemplateGitHubAssets(targetDir)

  // 8. Layer feature-gated assets and generated settings on top.
  copyClaudeCodeAssets(targetDir, selectedFeatureIds)
  copyRules(targetDir, selectedFeatureIds)
  copyHooks(targetDir, selectedFeatureIds)
  copyCommands(targetDir, selectedFeatureIds)
  generateSettings(targetDir, selectedFeatureIds)
  copyGuardSystem(targetDir)
  copyScripts(targetDir, selectedFeatureIds)
  copyWorkflows(targetDir, selectedFeatureIds)
  copyVerifyDocs(targetDir, selectedFeatureIds)

  // 9. Copy Spectra ecosystem files
  copySpectraWorkflows(targetDir)
  copySpectraConfig(targetDir)

  // 10. Replace template placeholders
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

function copyTemplateClaudeAssets(targetDir: string): void {
  copyDirectory(join(STARTER_ROOT, '.claude'), join(targetDir, '.claude'))
}

function copyTemplateGitHubAssets(targetDir: string): void {
  const githubDir = join(STARTER_ROOT, '.github')
  if (existsSync(githubDir)) {
    copyDirectory(githubDir, join(targetDir, '.github'))
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

  // Add feature-specific scripts (vite-plus unified toolchain)
  if (
    selectedFeatureIds.includes('testing-full') ||
    selectedFeatureIds.includes('testing-vitest')
  ) {
    basePkg.scripts.test = 'vp test --coverage'
    basePkg.scripts['test:unit'] = 'vp test test/unit'
    basePkg.scripts['test:watch'] = 'vp test --watch'
  }
  if (selectedFeatureIds.includes('testing-full')) {
    basePkg.scripts['test:e2e'] = 'playwright test'
  }
  if (selectedFeatureIds.includes('quality')) {
    basePkg.scripts.lint = 'vp lint'
    basePkg.scripts.format = 'vp fmt'
    basePkg.scripts['format:check'] = 'vp fmt --check'
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
      '*.{js,ts,vue}': ['vp lint --fix', 'vp fmt'],
    }
  }
  // Prepare script: vp config (if quality) + husky (if git-hooks) + nuxt prepare
  const prepareParts: string[] = []
  if (selectedFeatureIds.includes('quality')) {
    prepareParts.push('vp config')
  }
  if (selectedFeatureIds.includes('git-hooks')) {
    prepareParts.push('husky')
  }
  prepareParts.push('nuxt prepare')
  basePkg.scripts.prepare = prepareParts.join(' && ')
  if (selectedFeatureIds.includes('database')) {
    basePkg.scripts['db:reset'] = 'bash ./scripts/db-reset.sh && pnpm db:types'
    basePkg.scripts['db:lint'] = 'supabase db lint --level warning'
    basePkg.scripts['db:types'] = 'bash ./scripts/db-types.sh'
    basePkg.scripts['db:backup'] = 'bash ./scripts/backup-supabase.sh'
    basePkg.scripts['supabase:sync'] = 'bash ./scripts/supabase-sync.sh'
    basePkg.scripts['supabase:check'] = 'bash ./scripts/supabase-tunnel.sh'
  }

  // Always add
  basePkg.scripts.typecheck = 'nuxt typecheck'
  basePkg.scripts.setup = 'bash scripts/setup.sh'
  basePkg.scripts['skills:install'] = 'bash ./scripts/install-skills.sh'
  basePkg.scripts['skills:list'] = 'bash ./scripts/check-skills.sh'
  basePkg.scripts['skills:update'] = 'bash ./scripts/install-skills.sh'

  // Spectra UX completeness (always needed)
  basePkg.scripts['audit:ux-drift'] = 'npx tsx scripts/audit-ux-drift.mts'
  basePkg.scripts['spectra:roadmap'] = 'npx tsx scripts/spectra-ux/roadmap-sync.mts'

  // Sort dependencies
  basePkg.dependencies = sortObject(basePkg.dependencies)
  basePkg.devDependencies = sortObject(basePkg.devDependencies)

  writeFileSync(pkgPath, JSON.stringify(basePkg, null, 2) + '\n')
}

function sortObject(obj: Record<string, string> | undefined): Record<string, string> {
  if (!obj) return {}
  const entries = Object.entries(obj) as Array<[string, string]>
  entries.sort(([a], [b]) => a.localeCompare(b))
  return Object.fromEntries(entries)
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

  // SSR mode
  const ssrEnabled = selectedFeatureIds.includes('ssr')
  config = config.replace('ssr: false', `ssr: ${ssrEnabled}`)

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
    configBlocks.push(`    description: '{{projectName}}',`)
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
  if (!selectedFeatureIds.includes('monitoring')) {
    configBlocks.push(`  sourcemap: false,`)
  }
  if (selectedFeatureIds.includes('monitoring')) {
    configBlocks.push(`  sentry: {`)
    configBlocks.push(`    enabled: Boolean(process.env.SENTRY_AUTH_TOKEN),`)
    configBlocks.push(`    telemetry: false,`)
    configBlocks.push(`    org: process.env.SENTRY_ORG,`)
    configBlocks.push(`    project: process.env.SENTRY_PROJECT,`)
    configBlocks.push(`    authToken: process.env.SENTRY_AUTH_TOKEN,`)
    configBlocks.push(`  },`)
    configBlocks.push(`  sourcemap: process.env.SENTRY_AUTH_TOKEN ? {`)
    configBlocks.push(`    client: 'hidden',`)
    configBlocks.push(`  } : false,`)
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
  const envExamplePath = join(targetDir, '.env.example')
  const envPath = join(targetDir, '.env')
  const exampleLines = [
    '# ============================================',
    '# 環境變數範本',
    '# 複製此檔案為 .env 並填入實際值',
    '# ============================================',
    '',
  ]
  const envLines = [
    '# ============================================',
    '# 環境變數（scaffold 自動產生）',
    '# ============================================',
    '',
  ]

  const generatedValues: Record<string, string> = {}
  const shouldGenerateSessionPassword =
    selectedFeatureIds.includes('auth-nuxt-utils') ||
    selectedFeatureIds.includes('auth-better-auth')

  // Supabase CLI 標準 local dev 預設值（公開 demo JWT，非 secret）
  if (selectedFeatureIds.includes('database')) {
    generatedValues.SUPABASE_URL = 'http://127.0.0.1:54321'
    generatedValues.SUPABASE_KEY =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
    generatedValues.SUPABASE_SECRET_KEY =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
  }

  if (selectedFeatureIds.includes('auth-better-auth')) {
    generatedValues.BETTER_AUTH_SECRET = randomBytes(32).toString('base64url')
  }

  if (shouldGenerateSessionPassword) {
    generatedValues.NUXT_SESSION_PASSWORD = randomBytes(32).toString('base64url')
  }

  const seenKeys = new Set<string>()

  for (const featureId of selectedFeatureIds) {
    const mod = getModuleById(featureId)
    if (!mod?.envVars || Object.keys(mod.envVars).length === 0) continue

    exampleLines.push(`# --- ${mod.name} ---`)
    envLines.push(`# --- ${mod.name} ---`)

    for (const [key, comment] of Object.entries(mod.envVars)) {
      if (seenKeys.has(key)) continue
      seenKeys.add(key)

      if (comment.startsWith('#')) {
        exampleLines.push(comment)
      }

      exampleLines.push(`${key}=${comment.startsWith('#') ? '' : comment}`)
      envLines.push(`${key}=${generatedValues[key] ?? ''}`)
    }

    exampleLines.push('')
    envLines.push('')
  }

  writeFileSync(envExamplePath, exampleLines.join('\n'))
  writeFileSync(envPath, envLines.join('\n'))
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
    'review-screenshot',

    // Spectra SDD (Spec-Driven Development)
    'spectra',
    'spectra-propose',
    'spectra-apply',
    'spectra-ask',
    'spectra-discuss',
    'spectra-ingest',
    'spectra-audit',
    'spectra-debug',
    'spectra-archive',
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
      // Design orchestration + sub-skills（impeccable v2.1）
      'design',
      'design-retro',
      'impeccable',
      'adapt',
      'animate',
      'audit',
      'bolder',
      'clarify',
      'colorize',
      'critique',
      'delight',
      'distill',
      'harden',
      'layout',
      'optimize',
      'overdrive',
      'polish',
      'quieter',
      'shape',
      'typeset',
      // UI workflow support
      'review-archive',
      'review-screenshot',
      'subagent-dev'
    )
  }

  // State management
  if (selectedFeatureIds.includes('pinia')) skills.push('pinia', 'pinia-store')

  // VueUse
  if (selectedFeatureIds.includes('vueuse')) skills.push('vueuse', 'vueuse-functions')

  // Monitoring — evlog skills
  if (selectedFeatureIds.includes('monitoring')) {
    skills.push('analyze-logs', 'review-logging-patterns')
  }

  // Files to exclude from skill copies (prevent nested CLAUDE.md conflicts)
  const skillExclude = new Set(['CLAUDE.md'])

  // Copy each skill directory (skip if not found in starter)
  for (const skill of skills) {
    const src = join(starterSkills, skill)
    if (existsSync(src)) {
      const dest = join(targetSkills, skill)
      mkdirSync(dest, { recursive: true })
      copyDirectoryFiltered(src, dest, skillExclude)
    }
  }

  // Copy agents
  const agents = ['code-review.md', 'check-runner.md']
  if (selectedFeatureIds.includes('ui')) agents.push('screenshot-review.md')
  if (selectedFeatureIds.includes('database')) agents.push('db-backup.md')

  for (const agent of agents) {
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

// --- Shared copy helper ---

function copyFilesList(srcDir: string, destDir: string, files: string[]): void {
  mkdirSync(destDir, { recursive: true })
  for (const file of files) {
    const src = join(srcDir, file)
    if (existsSync(src)) {
      cpSync(src, join(destDir, file))
    }
  }
}

// --- Feature flag helpers ---

function has(ids: string[], feature: string): boolean {
  return ids.includes(feature)
}

function hasAny(ids: string[], ...features: string[]): boolean {
  return features.some((f) => ids.includes(f))
}

// --- Rules ---

function copyRules(targetDir: string, feats: string[]): void {
  // Always-included rules (core workflow + quality)
  const files = [
    'testing-anti-patterns.md',
    'development.md',
    'error-handling.md',
    'commit.md',
    'handoff.md',
    'knowledge-and-decisions.md',
    'manual-review.md',
    'review-tiers.md',
    'screenshot-strategy.md',
    'unused-features.md',
    'ux-completeness.md',
    'proactive-skills.md',
  ]

  // Auth-specific rules
  if (hasAny(feats, 'auth-nuxt-utils', 'auth-better-auth')) files.push('auth.md')

  // Database-specific rules
  if (has(feats, 'database')) {
    files.push(
      'database-access.md',
      'migration.md',
      'rls-policy.md',
      'api-patterns.md',
      'mcp-remote.md',
      'query-optimization.md',
      'storage.md',
      'trigger.md'
    )
  }

  // Monitoring-specific rules
  if (has(feats, 'monitoring')) files.push('logging.md')

  copyFilesList(join(STARTER_ROOT, '.claude', 'rules'), join(targetDir, '.claude', 'rules'), files)
}

// --- Hooks ---

function copyHooks(targetDir: string, feats: string[]): void {
  // Always-included hooks (core workflow + Spectra + Design)
  const files = [
    'stop-accumulate.sh',
    'init-code-graph.sh',
    'knowledge-search-reminder.sh',
    'pre-commit-review.sh',
    'post-bash-error-debug.sh',
    'post-edit-ui-qa.sh',
    'post-propose-design-inject.sh',
    'pre-archive-design-gate.sh',
    // Spectra UX hooks
    'post-edit-roadmap-sync.sh',
    'post-propose-journey-check.sh',
    'pre-apply-journey-brief.sh',
    'pre-archive-ux-gate.sh',
    'pre-propose-ux-scan.sh',
    'session-start-roadmap-sync.sh',
  ]

  // Quality-specific hooks
  if (has(feats, 'quality')) files.push('post-edit-typecheck.sh')

  // Database-specific hooks
  if (has(feats, 'database')) files.push('post-migration-gen-types.sh')

  copyFilesList(join(STARTER_ROOT, '.claude', 'hooks'), join(targetDir, '.claude', 'hooks'), files)
}

// --- Commands ---

function copyCommands(targetDir: string, feats: string[]): void {
  const files = [
    'commit.md',
    'ship.md',
    'second-opinion.md',
    'retro.md',
    'sprint-status.md',
    'freeze.md',
    'unfreeze.md',
    'guard.md',
    'doc-sync.md',
  ]
  if (has(feats, 'database')) files.push('db-migration.md')
  if (hasAny(feats, 'deploy-cloudflare', 'deploy-vercel')) files.push('canary.md')

  const starterCommands = join(STARTER_ROOT, '.claude', 'commands')
  const targetCommands = join(targetDir, '.claude', 'commands')
  copyFilesList(starterCommands, targetCommands, files)

  // Copy all spectra commands as a directory
  const spectraDir = join(starterCommands, 'spectra')
  if (existsSync(spectraDir)) {
    const targetSpectra = join(targetCommands, 'spectra')
    mkdirSync(targetSpectra, { recursive: true })
    copyDirectory(spectraDir, targetSpectra)
  }
}

// --- Settings (dynamically generated) ---

function hookEntry(filename: string, timeout: number) {
  return {
    command: `"$CLAUDE_PROJECT_DIR"/.claude/hooks/${filename}`,
    timeout,
    type: 'command' as const,
  }
}

function generateSettings(targetDir: string, feats: string[]): void {
  // --- hooks ---
  const postToolUse: object[] = []
  const preToolUse: object[] = []

  // PostToolUse: database — migration gen types
  if (has(feats, 'database')) {
    postToolUse.push({
      matcher: 'mcp__local-supabase__apply_migration',
      hooks: [hookEntry('post-migration-gen-types.sh', 30)],
    })
  }

  // PostToolUse: Edit|Write — typecheck(quality) + ui-qa(always) + roadmap-sync
  const editWritePostHooks: object[] = []
  if (has(feats, 'quality')) editWritePostHooks.push(hookEntry('post-edit-typecheck.sh', 90))
  editWritePostHooks.push(hookEntry('post-edit-ui-qa.sh', 5))
  editWritePostHooks.push(hookEntry('post-edit-roadmap-sync.sh', 10))
  postToolUse.push({ matcher: 'Edit|Write', hooks: editWritePostHooks })

  // PostToolUse: Bash — bash-error-debug nudge
  postToolUse.push({
    matcher: 'Bash',
    hooks: [hookEntry('post-bash-error-debug.sh', 5)],
  })

  // PostToolUse: Skill — design inject + journey check (always)
  postToolUse.push({
    matcher: 'Skill',
    hooks: [
      hookEntry('post-propose-design-inject.sh', 10),
      hookEntry('post-propose-journey-check.sh', 10),
    ],
  })

  // PreToolUse: Edit|Write — knowledge search + guard
  preToolUse.push({ matcher: 'Edit|Write', hooks: [hookEntry('knowledge-search-reminder.sh', 5)] })
  preToolUse.push({
    matcher: 'Edit|Write',
    hooks: [
      { command: 'node "$CLAUDE_PROJECT_DIR"/.claude/scripts/guard-check.mjs', type: 'command' },
    ],
  })

  // PreToolUse: Bash — commit review (always)
  preToolUse.push({
    matcher: 'Bash',
    hooks: [
      {
        ...hookEntry('pre-commit-review.sh', 10),
        statusMessage: 'Checking commit authorization...',
      },
    ],
  })

  // PreToolUse: Skill — archive design gate + ux gate + journey brief + propose ux scan
  preToolUse.push({
    matcher: 'Skill',
    hooks: [
      hookEntry('pre-archive-design-gate.sh', 10),
      hookEntry('pre-archive-ux-gate.sh', 10),
      hookEntry('pre-apply-journey-brief.sh', 10),
      hookEntry('pre-propose-ux-scan.sh', 10),
    ],
  })

  // --- MCP ---
  const enabledMcp: string[] = []
  if (has(feats, 'database')) enabledMcp.push('local-supabase')

  // --- Permissions ---
  const allow: string[] = [
    // Bash basics — always
    'Bash(ls:*)',
    'Bash(wc:*)',
    'Bash(node:*)',
    'Bash(head:*)',
    'Bash(grep:*)',
    'Bash(cat:*)',
    'Bash(find:*)',
    'Bash(tree:*)',
    'Bash(echo:*)',
    'Bash(sort:*)',
    'Bash(jq:*)',
    'Bash(curl:*)',
    'Bash(test:*)',
    'Bash(fi)',
    'Bash(done)',
    'Bash(openssl rand:*)',
    // pnpm — always
    'Bash(pnpm check:*)',
    'Bash(pnpm test:*)',
    'Bash(pnpm lint:*)',
    'Bash(pnpm format:*)',
    'Bash(pnpm typecheck:*)',
    'Bash(pnpm build:*)',
    'Bash(pnpm dev:*)',
    'Bash(pnpm add:*)',
    'Bash(pnpm skills:*)',
    // npx — always
    'Bash(npx tsx:*)',
    'Bash(npx nuxi:*)',
    'Bash(npx skills:*)',
    'Bash(npx skills add:*)',
    'Bash(claude skills:*)',
    // git — always
    'Bash(git add:*)',
    'Bash(git commit:*)',
    'Bash(git diff:*)',
    'Bash(git status:*)',
    'Bash(git log:*)',
    'Bash(git push:*)',
    'Bash(git fetch:*)',
    'Bash(git stash:*)',
    'Bash(git checkout:*)',
    'Bash(git restore:*)',
    'Bash(git rebase:*)',
    'Bash(git worktree:*)',
    'Bash(gh run:*)',
    // Web — always
    'WebSearch',
    'WebFetch(domain:github.com)',
  ]

  if (has(feats, 'database')) {
    allow.push(
      'Bash(supabase:*)',
      'Bash(pnpm db:*)',
      'mcp__local-supabase__list_tables',
      'mcp__local-supabase__list_migrations',
      'mcp__local-supabase__execute_sql',
      'mcp__local-supabase__search_docs',
      'mcp__local-supabase__get_advisors',
      'mcp__local-supabase__apply_migration',
      'WebFetch(domain:supabase.com)'
    )
  }
  if (has(feats, 'ui')) {
    allow.push('Skill(impeccable)', 'WebFetch(domain:ui.nuxt.com)')
  }
  if (has(feats, 'vueuse')) allow.push('WebFetch(domain:vueuse.org)')
  if (has(feats, 'pinia')) allow.push('WebFetch(domain:pinia-colada.esm.dev)')

  // --- Assemble ---
  const settings: Record<string, unknown> = {
    hooks: {
      PostToolUse: postToolUse,
      PreToolUse: preToolUse,
      SessionStart: [
        {
          hooks: [
            {
              ...hookEntry('init-code-graph.sh', 120),
              statusMessage: 'Initializing code knowledge graph...',
            },
            {
              ...hookEntry('session-start-roadmap-sync.sh', 30),
              statusMessage: 'Syncing Spectra roadmap...',
            },
          ],
        },
      ],
      Stop: [{ hooks: [hookEntry('stop-accumulate.sh', 5)] }],
    },
    includeGitInstructions: false,
    permissions: { allow },
  }
  if (enabledMcp.length > 0) settings.enabledMcpjsonServers = enabledMcp

  const dest = join(targetDir, '.claude')
  mkdirSync(dest, { recursive: true })
  writeFileSync(join(dest, 'settings.json'), JSON.stringify(settings, null, 2) + '\n')
}

// --- Guard system (always copied) ---

function copyGuardSystem(targetDir: string): void {
  const starterClaude = join(STARTER_ROOT, '.claude')
  const targetClaude = join(targetDir, '.claude')

  copyFilesList(starterClaude, targetClaude, ['guard-state.json'])

  const guardScript = join(starterClaude, 'scripts', 'guard-check.mjs')
  if (existsSync(guardScript)) {
    const targetScripts = join(targetClaude, 'scripts')
    mkdirSync(targetScripts, { recursive: true })
    cpSync(guardScript, join(targetScripts, 'guard-check.mjs'))
  }
}

// --- Scripts ---

function copyScripts(targetDir: string, feats: string[]): void {
  // Always-included scripts
  const files = ['check-skills.sh', 'setup.sh', 'restore-hooks.sh', 'audit-ux-drift.mts']

  // Database-specific scripts
  if (has(feats, 'database')) {
    files.push('backup-supabase.sh', 'db-lint.sh', 'db-reset.sh', 'db-types.sh', 'supabase-sync.sh')
  }

  copyFilesList(join(STARTER_ROOT, 'scripts'), join(targetDir, 'scripts'), files)

  // Copy scripts/lib (always needed)
  const libSrc = join(STARTER_ROOT, 'scripts', 'lib')
  const libDest = join(targetDir, 'scripts', 'lib')
  if (existsSync(libSrc)) {
    mkdirSync(libDest, { recursive: true })
    copyDirectory(libSrc, libDest)
  }

  // Generate install-skills.sh dynamically based on selected features
  generateInstallSkillsScript(targetDir, feats)

  // Copy spectra-ux scripts (always needed for Spectra workflow)
  const spectraUxSrc = join(STARTER_ROOT, 'scripts', 'spectra-ux')
  const spectraUxDest = join(targetDir, 'scripts', 'spectra-ux')
  if (existsSync(spectraUxSrc)) {
    mkdirSync(spectraUxDest, { recursive: true })
    copyDirectory(spectraUxSrc, spectraUxDest)
  }

  // Finally sync the full template scripts tree so Quick Start always inherits
  // the latest shared scripts, skill installers, and script templates.
  copyDirectory(join(STARTER_ROOT, 'scripts'), join(targetDir, 'scripts'))
}

function generateInstallSkillsScript(targetDir: string, feats: string[]): void {
  const lines: string[] = [
    '#!/bin/bash',
    '',
    '# Skills 安裝／更新腳本（由 scaffold 依選擇的功能自動產生）',
    '# 統一使用 --agent claude-code --copy：直接寫入 .claude/skills/，不建立 symlink',
    '# 重複執行會覆寫為最新版（等同 update）',
    `# 產生日期：${new Date().toISOString().slice(0, 10)}`,
    '',
    'set -e',
    '',
    'cd "$(dirname "$0")/.."',
    '',
    'COPY_FLAGS="--agent claude-code --copy -y"',
    '',
    'echo "🚀 開始安裝 skills（--copy 模式，直接寫入 .claude/skills/）..."',
    'echo ""',
    '',
  ]

  // Antfu Skills — always: nuxt, vue, vitest, vue-best-practices, vue-testing-best-practices
  const antfuSkills = ['nuxt', 'vue', 'vitest', 'vue-best-practices', 'vue-testing-best-practices']
  // vueuse-functions is useful even without vueuse feature (it's a reference)
  antfuSkills.push('vueuse-functions')
  if (has(feats, 'pinia')) antfuSkills.push('pinia')
  // vitepress for docs (always useful)
  antfuSkills.push('vitepress')

  lines.push('# Antfu Skills')
  lines.push('echo "📦 Antfu Skills..."')
  lines.push(`for skill in ${antfuSkills.join(' ')}; do`)
  lines.push('  npx skills add antfu/skills@$skill $COPY_FLAGS')
  lines.push('done')
  lines.push('echo "  ✓ Antfu Skills 完成"')
  lines.push('echo ""')
  lines.push('')

  // Onmax Nuxt Skills — conditional
  const onmaxSkills: string[] = []
  if (has(feats, 'deploy-cloudflare')) onmaxSkills.push('nuxthub')
  if (has(feats, 'vueuse')) onmaxSkills.push('vueuse')
  if (has(feats, 'ui')) onmaxSkills.push('reka-ui', 'motion')
  if (hasAny(feats, 'auth-better-auth')) onmaxSkills.push('nuxt-better-auth')

  if (onmaxSkills.length > 0) {
    lines.push('# Onmax Nuxt Skills')
    lines.push('echo "📦 Onmax Nuxt Skills..."')
    lines.push(`for skill in ${onmaxSkills.join(' ')}; do`)
    lines.push('  npx skills add onmax/nuxt-skills@$skill $COPY_FLAGS')
    lines.push('done')
    lines.push('echo "  ✓ Onmax Nuxt Skills 完成"')
    lines.push('echo ""')
    lines.push('')
  }

  // 官方 Skills — only if there's something to install
  if (has(feats, 'database') || has(feats, 'ui')) {
    lines.push('# 官方 Skills')
    lines.push('echo "📦 官方 Skills..."')
    if (has(feats, 'database')) {
      lines.push(
        'npx skills add supabase/agent-skills@supabase-postgres-best-practices $COPY_FLAGS'
      )
    }
    if (has(feats, 'ui')) {
      lines.push('npx skills add nuxt/ui $COPY_FLAGS')
    }
    lines.push('echo "  ✓ 官方 Skills 完成"')
    lines.push('echo ""')
    lines.push('')
  }

  // TDD — always
  lines.push('# TDD')
  lines.push('echo "📦 TDD Skill..."')
  lines.push('npx skills add obra/superpowers@test-driven-development $COPY_FLAGS')
  lines.push('echo "  ✓ TDD Skill 完成"')
  lines.push('echo ""')
  lines.push('')

  // Evlog — only review-logging-patterns if monitoring
  if (has(feats, 'monitoring')) {
    lines.push('# Evlog')
    lines.push('echo "📦 Evlog Skills..."')
    lines.push('npx skills add hugorcd/evlog@review-logging-patterns $COPY_FLAGS')
    lines.push('echo "  ✓ Evlog Skills 完成"')
    lines.push('echo ""')
    lines.push('')
  }

  // Impeccable Design Skills — only if ui
  if (has(feats, 'ui')) {
    const impeccableSkills = [
      'impeccable',
      'adapt',
      'animate',
      'audit',
      'bolder',
      'clarify',
      'colorize',
      'critique',
      'delight',
      'distill',
      'harden',
      'layout',
      'optimize',
      'overdrive',
      'polish',
      'quieter',
      'shape',
      'typeset',
    ]
    lines.push('# Impeccable Design Skills（pbakaus/impeccable）')
    lines.push('echo "📦 Impeccable Design Skills..."')
    lines.push(`for skill in ${impeccableSkills.join(' ')}; do`)
    lines.push('  npx skills add pbakaus/impeccable@$skill $COPY_FLAGS')
    lines.push('done')
    lines.push('echo "  ✓ Impeccable Design Skills 完成"')
    lines.push('echo ""')
    lines.push('echo "📝 注意：design orchestrator 為手動管理，位於 .claude/skills/design/"')
    lines.push('echo ""')
    lines.push('')
  }

  // Footer
  lines.push('echo "✅ 所有 skills 安裝完成！"')
  lines.push('echo ""')
  lines.push('echo "💡 提示："')
  lines.push('echo "  - 查看已安裝：pnpm skills:list"')
  lines.push('echo "  - 重新安裝/更新：pnpm skills:install（本腳本）"')
  lines.push('echo "  - 重啟 Claude Code CLI 以載入變更"')
  lines.push('')

  const scriptsDir = join(targetDir, 'scripts')
  mkdirSync(scriptsDir, { recursive: true })
  writeFileSync(join(scriptsDir, 'install-skills.sh'), lines.join('\n'))
}

// --- CI/CD Workflows ---

function copyWorkflows(targetDir: string, feats: string[]): void {
  // CI mode: advanced wins if explicitly selected, otherwise simple is the default.
  const ciMode: 'simple' | 'advanced' = has(feats, 'ci-advanced') ? 'advanced' : 'simple'

  // Pairs of [source filename in templates, destination filename in .github/workflows].
  const files: Array<[string, string]> = [[`ci-${ciMode}.yml`, 'ci.yml']]

  if (has(feats, 'deploy-cloudflare')) {
    files.push(['deploy-staging.yml', 'deploy-staging.yml'])
    files.push(['deploy-production.yml', 'deploy-production.yml'])
  }
  // Vercel uses built-in Git integration — no workflow needed

  if (has(feats, 'testing-full')) {
    files.push([`e2e-${ciMode}.yml`, 'e2e.yml'])
  }

  const srcDir = join(STARTER_ROOT, 'scripts', 'templates', 'github', '.github', 'workflows')
  const destDir = join(targetDir, '.github', 'workflows')
  mkdirSync(destDir, { recursive: true })
  for (const [srcName, destName] of files) {
    const src = join(srcDir, srcName)
    if (existsSync(src)) {
      cpSync(src, join(destDir, destName))
    }
  }
}

// --- docs/verify ---

function copyVerifyDocs(targetDir: string, feats: string[]): void {
  const files = [
    'QUICK_START.md',
    'TEST_DRIVEN_DEVELOPMENT.md',
    'COMPOSABLE_DEVELOPMENT.md',
    'API_DESIGN_GUIDE.md',
    'PRODUCTION_BUG_PATTERNS.md',
    'ENVIRONMENT_VARIABLES.md',
    'README.md',
    'SCREENSHOT_GUIDE.md',
  ]
  if (has(feats, 'database')) {
    files.push(
      'SUPABASE_MIGRATION_GUIDE.md',
      'RLS_BEST_PRACTICES.md',
      'SELF_HOSTED_SUPABASE.md',
      'DATABASE_OPTIMIZATION.md'
    )
  }
  if (hasAny(feats, 'auth-nuxt-utils', 'auth-better-auth'))
    files.push('AUTH_INTEGRATION.md', 'OAUTH_SETUP.md')
  if (has(feats, 'monitoring')) files.push('SENTRY_CONFIGURATION.md')
  if (has(feats, 'deploy-cloudflare')) files.push('CLOUDFLARE_WORKERS_GOTCHAS.md')
  if (has(feats, 'pinia')) files.push('PINIA_ARCHITECTURE.md', 'CACHE_STRATEGY.md')

  copyFilesList(join(STARTER_ROOT, 'docs', 'verify'), join(targetDir, 'docs', 'verify'), files)
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

  // Spectra Instructions
  sections.push('<!-- SPECTRA:START v2.2.3 -->')
  sections.push('')
  sections.push('# Spectra Instructions')
  sections.push('')
  sections.push(
    'This project uses Spectra 2.2.3 for Spec-Driven Development (SDD). Specs live in `openspec/specs/`, change proposals in `openspec/changes/`. Config: `.spectra.yaml`.'
  )
  sections.push('')
  sections.push('## Use `/spectra-*` skills when:')
  sections.push('')
  sections.push('- A discussion needs structure before coding → `/spectra-discuss`')
  sections.push('- User wants to plan, propose, or design a change → `/spectra-propose`')
  sections.push('- Tasks are ready to implement → `/spectra-apply`')
  sections.push("- There's an in-progress change to continue → `/spectra-ingest`")
  sections.push('- User asks about specs or how something works → `/spectra-ask`')
  sections.push('- Implementation is done → `/spectra-archive`')
  sections.push('')
  sections.push('## Workflow')
  sections.push('')
  sections.push('discuss? → propose → apply ⇄ ingest → archive')
  sections.push('')
  sections.push('<!-- SPECTRA:END -->')
  sections.push('')

  // Proactive Skill Orchestra
  sections.push('# Proactive Skill Orchestra')
  sections.push('')
  sections.push(
    '**所有 Spectra sub-skill 與 Design skill 依 `.claude/rules/proactive-skills.md` 自主觸發，不需使用者手動指定。**'
  )
  sections.push('')

  // Header
  sections.push('# CLAUDE.md')
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

  if (hasAuthUtils) {
    sections.push('### 截圖調試')
    sections.push('')
    sections.push(
      '- **Auth**：先導航到 `/auth/_dev-login`（dev-only route，自動建立 session），可帶 `?email=` 指定使用者、`?redirect=` 指定起始頁'
    )
    sections.push('- Dev server 已經在跑，自己用 `ps aux | grep nuxt` 找 port，不要問')
    sections.push('- 截圖完成後 `browser-use close` 關閉瀏覽器')
    sections.push('- **NEVER** patch `auth.global.ts` — 一律用 dev-login route')
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

  // Project Structure
  sections.push('## Project Structure')
  sections.push('')
  sections.push('```')
  sections.push('app/')
  sections.push('├── pages/           # File-based routing')
  sections.push('├── components/      # Vue components')
  sections.push('├── composables/     # Vue composables')
  if (selectedFeatureIds.includes('pinia')) {
    sections.push('├── stores/          # Pinia stores')
    sections.push('├── queries/         # Pinia Colada queries')
  }
  sections.push('└── types/           # TypeScript types')
  sections.push('')
  sections.push('server/')
  if (hasDatabase) {
    sections.push('├── api/v1/          # Business API')
  }
  if (authModule) {
    sections.push('├── api/auth/        # Auth API')
  }
  sections.push('└── utils/           # Server utilities')
  sections.push('')
  if (hasDatabase) {
    sections.push('supabase/migrations/ # DB migrations (CLI only)')
  }
  sections.push('openspec/            # Spectra specs & changes')
  sections.push('test/')
  sections.push('├── unit/            # Unit tests (*.test.ts)')
  sections.push('└── nuxt/            # Nuxt env tests (*.nuxt.test.ts)')
  sections.push('```')
  sections.push('')

  // Automation Triggers
  sections.push('## Automation Triggers')
  sections.push('')
  sections.push('| Trigger | Action |')
  sections.push('|---------|--------|')
  sections.push('| `/commit` | Run `pnpm check` → commit |')
  sections.push('| `/ship` | check → push → create PR |')
  sections.push('| `/spectra:propose` | 建立變更提案 |')
  sections.push('| `/spectra:apply` | 執行任務 |')
  if (hasDatabase) {
    sections.push('| Migration created | `db reset` → `db lint` → `gen types` → `typecheck` |')
  }
  sections.push('| New feature | TDD: Red → Green → Refactor |')
  sections.push('')

  // AI Skills — list all skills that are copied into the project
  const skillRows: string[] = []
  skillRows.push('| Vue components | `vue` |')
  skillRows.push('| Nuxt routing/server | `nuxt` |')
  if (selectedFeatureIds.includes('ui')) {
    skillRows.push('| UI components | `nuxt-ui` |')
    skillRows.push('| UI 設計規劃 | `/design` |')
    skillRows.push('| 建構前端介面 | `/impeccable craft` |')
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
  skillRows.push('| 截圖驗證 | `review-screenshot` |')

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

// --- Spectra ecosystem ---

function copySpectraWorkflows(targetDir: string): void {
  const src = join(STARTER_ROOT, '.agent', 'workflows')
  const dest = join(targetDir, '.agent', 'workflows')
  if (existsSync(src)) {
    mkdirSync(dest, { recursive: true })
    copyDirectory(src, dest)
  }
}

function copySpectraConfig(targetDir: string): void {
  const spectraYaml = join(STARTER_ROOT, '.spectra.yaml')
  if (existsSync(spectraYaml)) {
    cpSync(spectraYaml, join(targetDir, '.spectra.yaml'))
  }

  const skillsLock = join(STARTER_ROOT, 'skills-lock.json')
  if (existsSync(skillsLock)) {
    cpSync(skillsLock, join(targetDir, 'skills-lock.json'))
  }
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
        [
          'ts',
          'js',
          'json',
          'jsonc',
          'vue',
          'md',
          'toml',
          'yaml',
          'yml',
          'css',
          'html',
          'sh',
        ].includes(ext || '')
      ) {
        let content = readFileSync(fullPath, 'utf-8')
        if (/\{\{\s*projectName\s*\}\}/.test(content)) {
          content = content.replace(/\{\{\s*projectName\s*\}\}/g, projectName)
          writeFileSync(fullPath, content)
        }
      }
    }
  }
}
