import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleProject } from '../src/assemble'
import { getDefaultSelections } from '../src/prompts'
import { resolveFeatureDependencies } from '../src/features'
import { buildSelectionsFromArgs } from '../src/cli'

const TEST_DIR = join(import.meta.dirname, '.tmp-test')

function cleanTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
}

function writeText(path: string, value: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, value)
}

beforeEach(() => cleanTestDir())
afterEach(() => cleanTestDir())

describe('scaffold: base-only (no features)', () => {
  it('produces valid project files', () => {
    const targetDir = join(TEST_DIR, 'base-only')
    assembleProject(targetDir, [], 'base-only')

    expect(existsSync(join(targetDir, 'package.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'nuxt.config.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'tsconfig.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'app', 'app.vue'))).toBe(true)
    expect(existsSync(join(targetDir, 'app', 'pages', 'index.vue'))).toBe(true)
    expect(existsSync(join(targetDir, '.gitignore'))).toBe(true)
    expect(existsSync(join(targetDir, '.env.example'))).toBe(true)
    expect(existsSync(join(targetDir, 'CLAUDE.md'))).toBe(true)
    expect(existsSync(join(targetDir, 'AGENTS.md'))).toBe(false)
    expect(existsSync(join(targetDir, '.cursor'))).toBe(false)
    expect(existsSync(join(targetDir, '.codex'))).toBe(false)
    expect(existsSync(join(targetDir, '.agents'))).toBe(false)
    expect(existsSync(join(targetDir, '.claude', 'settings.json'))).toBe(true)
    expect(existsSync(join(targetDir, '.claude', 'versions.json'))).toBe(true)
    expect(existsSync(join(targetDir, '.claude', 'skills'))).toBe(true)
    expect(existsSync(join(targetDir, '.claude', 'commands', 'validate-starter.md'))).toBe(true)
    expect(existsSync(join(targetDir, '.scaffold-cleanup'))).toBe(false)
    expect(existsSync(join(targetDir, 'scripts', 'compress-skill-descriptions.sh'))).toBe(true)
    expect(existsSync(join(targetDir, 'scripts', 'templates', 'clean', 'README.md'))).toBe(true)

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.name).toBe('base-only')
    expect(pkg.dependencies.nuxt).toBeDefined()
  })

  it('nuxt.config has no feature modules', () => {
    const targetDir = join(TEST_DIR, 'base-only-config')
    assembleProject(targetDir, [], 'base-only-config')

    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')
    expect(config).not.toContain('@nuxt/ui')
    expect(config).not.toContain('better-auth')
    expect(config).not.toContain('@nuxtjs/supabase')
  })

  it('defaults production sourcemaps to false without monitoring', () => {
    const targetDir = join(TEST_DIR, 'base-only-sourcemap')
    assembleProject(targetDir, [], 'base-only-sourcemap')

    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')
    expect(config).toContain('sourcemap: false')
  })

  it('uses template install-skills script without removed vendor skill ids', () => {
    const targetDir = join(TEST_DIR, 'base-only-skills')
    assembleProject(targetDir, [], 'base-only-skills')

    const script = readFileSync(join(targetDir, 'scripts', 'install-skills.sh'), 'utf-8')
    expect(script).toContain('本地 starter design skills 已直接內建於 .claude/skills/')
    expect(script).not.toMatch(
      /for skill in .*\b(arrange|extract|frontend-design|normalize|onboard|teach-impeccable)\b/
    )
  })

  it('uses setup script that never auto-deletes starter repos', () => {
    const targetDir = join(TEST_DIR, 'base-only-setup')
    assembleProject(targetDir, [], 'base-only-setup')

    const script = readFileSync(join(targetDir, 'scripts', 'setup.sh'), 'utf-8')
    expect(script).toContain('setup 已停用自動刪除 starter repo 的行為')
    expect(script).not.toContain('rm -rf "$CLEANUP_PATH"')
  })

  it('strips scaffolder meta-only files while keeping runtime files', () => {
    const targetDir = join(TEST_DIR, 'base-only-strip')
    assembleProject(targetDir, [], 'base-only-strip')

    expect(existsSync(join(targetDir, 'packages', 'create-nuxt-starter'))).toBe(false)
    expect(existsSync(join(targetDir, 'presets', '_base', 'strip-manifest.json'))).toBe(false)
    expect(existsSync(join(targetDir, '.spectra', 'claims'))).toBe(false)
    expect(existsSync(join(targetDir, '.spectra', 'spectra.db'))).toBe(false)
    expect(existsSync(join(targetDir, '.clade'))).toBe(false)

    expect(existsSync(join(targetDir, 'app'))).toBe(true)
    expect(existsSync(join(targetDir, 'server'))).toBe(true)
    expect(existsSync(join(targetDir, 'nuxt.config.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'package.json'))).toBe(true)
  })

  it('fails closed when strip cleanup receives a malformed manifest', () => {
    const manifestPath = join(TEST_DIR, 'malformed-strip-manifest.json')
    const targetDir = join(TEST_DIR, 'malformed-strip')
    writeText(manifestPath, '{ not json }\n')

    expect(() =>
      assembleProject(targetDir, [], 'malformed-strip', undefined, undefined, undefined, {
        stripManifestPath: manifestPath,
      })
    ).toThrow(/strip-manifest.*malformed/i)
  })
})

describe('scaffold: all features', () => {
  it('produces project with all modules', () => {
    const defaults = getDefaultSelections('full-project')
    // Add SSR + SEO (not in defaults since SSR is off by default)
    const features = resolveFeatureDependencies([...defaults.features, 'ssr', 'seo'])
    const targetDir = join(TEST_DIR, 'full-project')
    assembleProject(targetDir, features, 'full-project')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies['@nuxt/ui']).toBeDefined()
    expect(pkg.dependencies['nuxt-auth-utils']).toBeDefined()
    expect(pkg.dependencies['@supabase/supabase-js']).toBeDefined()
    expect(pkg.dependencies['@nuxtjs/sitemap']).toBeDefined()
    expect(pkg.dependencies['@nuxtjs/robots']).toBeDefined()
    expect(pkg.dependencies['nuxt-site-config']).toBeDefined()
    expect(pkg.dependencies['nuxt-security']).toBeDefined()
    expect(pkg.devDependencies['@playwright/test']).toBeDefined()
    expect(pkg.devDependencies['vite-plus']).toBeDefined()
    expect(pkg.devDependencies['husky']).toBeDefined()

    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')
    expect(config).toContain('@nuxt/ui')
    expect(config).toContain('nuxt-auth-utils')
    expect(config).toContain('@nuxtjs/supabase')
    expect(config).toContain('@nuxtjs/sitemap')
    expect(config).toContain('ssr: true')
    expect(config).toContain('sourcemap: false')

    // Auth pages exist
    expect(existsSync(join(targetDir, 'app', 'pages', 'auth', 'login.vue'))).toBe(true)
    // Supabase config exists
    expect(existsSync(join(targetDir, 'supabase', 'config.toml'))).toBe(true)
    // Testing config exists
    expect(existsSync(join(targetDir, 'vitest.config.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'playwright.config.ts'))).toBe(true)
  })
})

describe('feature dependency enforcement', () => {
  it('auth-better-auth auto-enables database', () => {
    const resolved = resolveFeatureDependencies(['auth-better-auth'])
    expect(resolved).toContain('auth-better-auth')
    expect(resolved).toContain('database')
  })

  it('database alone does not add auth', () => {
    const resolved = resolveFeatureDependencies(['database'])
    expect(resolved).toContain('database')
    expect(resolved).not.toContain('auth')
  })
})

describe('non-interactive mode', () => {
  it('getDefaultSelections returns valid defaults', () => {
    const selections = getDefaultSelections('my-app')
    expect(selections.projectName).toBe('my-app')
    expect(selections.features).toContain('auth-nuxt-utils')
    expect(selections.features).toContain('database')
    expect(selections.features).toContain('ui')
    expect(selections.features).toContain('deploy-cloudflare')
    expect(selections.deploymentTarget).toBe('cloudflare')
    expect(selections.ssr).toBe(false)
    expect(selections.agentTargets).toEqual(['claude-code'])
    // SEO not in defaults because SSR is off by default
    expect(selections.features).not.toContain('seo')
  })
})

describe('agent runtime selection', () => {
  it('supports codex + cursor multi-select while keeping claude source assets', () => {
    const targetDir = join(TEST_DIR, 'multi-agent-project')
    assembleProject(targetDir, [], 'multi-agent-project', ['codex', 'cursor'])

    expect(existsSync(join(targetDir, 'CLAUDE.md'))).toBe(false)
    expect(existsSync(join(targetDir, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(targetDir, '.codex', 'config.toml'))).toBe(true)
    expect(existsSync(join(targetDir, '.agents', 'skills', 'commit', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(targetDir, '.cursor', 'hooks.json'))).toBe(true)
    expect(existsSync(join(targetDir, '.claude', 'settings.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'scripts', 'install-skills.sh'))).toBe(false)

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.scripts['skills:install']).toBeUndefined()
    expect(pkg.scripts['skills:list']).toBeUndefined()
    expect(pkg.scripts['skills:update']).toBeUndefined()
  })
})

describe('SSR and SEO coupling', () => {
  it('ssr: false 時不應包含 SEO modules', () => {
    const targetDir = join(TEST_DIR, 'spa-no-seo')
    assembleProject(targetDir, ['ui'], 'spa-no-seo')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies?.['@nuxtjs/sitemap']).toBeUndefined()
    expect(pkg.dependencies?.['nuxt-site-config']).toBeUndefined()

    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')
    expect(config).toContain('ssr: false')
    expect(config).not.toContain('@nuxtjs/sitemap')
  })

  it('ssr: true 時 nuxt.config 包含 ssr: true 和 SEO modules', () => {
    const features = resolveFeatureDependencies(['ssr', 'seo'])
    const targetDir = join(TEST_DIR, 'ssr-with-seo')
    assembleProject(targetDir, features, 'ssr-with-seo')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies['@nuxtjs/sitemap']).toBeDefined()
    expect(pkg.dependencies['nuxt-site-config']).toBeDefined()

    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')
    expect(config).toContain('ssr: true')
    expect(config).toContain('@nuxtjs/sitemap')
    expect(config).toContain('sourcemap: false')
  })

  it('seo 自動拉入 ssr dependency', () => {
    const resolved = resolveFeatureDependencies(['seo'])
    expect(resolved).toContain('seo')
    expect(resolved).toContain('ssr')
  })
})

describe('directory conflict handling', () => {
  it('assembleProject creates directory if not exists', () => {
    const targetDir = join(TEST_DIR, 'new-dir')
    assembleProject(targetDir, [], 'new-dir')
    expect(existsSync(targetDir)).toBe(true)
  })
})

describe('scaffold: nuxthub-ai db stack', () => {
  it('keeps NuxtHub D1 files and omits Supabase DB layout after strip cleanup', () => {
    const projectName = 'nuxthub-ai-strip'
    const selections = buildSelectionsFromArgs({
      projectName,
      evlogPreset: 'nuxthub-ai',
    })
    const targetDir = join(TEST_DIR, projectName)

    assembleProject(
      targetDir,
      selections.features,
      projectName,
      selections.agentTargets,
      selections.evlogPreset,
      selections.dbStack
    )

    expect(existsSync(join(targetDir, 'server/database/migrations/0002_evlog_events.sql'))).toBe(
      true
    )
    expect(existsSync(join(targetDir, 'wrangler.jsonc.template'))).toBe(true)
    expect(existsSync(join(targetDir, 'server/db'))).toBe(false)
  })
})
