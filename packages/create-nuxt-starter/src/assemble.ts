import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'pathe'
import { getModuleById } from './features'

const TEMPLATES_DIR = resolve(import.meta.dirname, '..', 'templates')

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

  // 6. Replace template placeholders
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
  if (selectedFeatureIds.includes('auth')) {
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
