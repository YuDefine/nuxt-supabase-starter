import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleProject } from '../src/assemble'
import { getDefaultSelections } from '../src/prompts'
import { resolveFeatureDependencies } from '../src/features'

const TEST_DIR = join(import.meta.dirname, '.tmp-test')

function cleanTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
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
    expect(pkg.dependencies['@nuxtjs/seo']).toBeDefined()
    expect(pkg.dependencies['nuxt-security']).toBeDefined()
    expect(pkg.devDependencies['vitest']).toBeDefined()
    expect(pkg.devDependencies['@playwright/test']).toBeDefined()
    expect(pkg.devDependencies['oxlint']).toBeDefined()
    expect(pkg.devDependencies['husky']).toBeDefined()

    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')
    expect(config).toContain('@nuxt/ui')
    expect(config).toContain('nuxt-auth-utils')
    expect(config).toContain('@nuxtjs/supabase')
    expect(config).toContain('ssr: true')

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
    // SEO not in defaults because SSR is off by default
    expect(selections.features).not.toContain('seo')
  })
})

describe('SSR and SEO coupling', () => {
  it('ssr: false 時不應包含 @nuxtjs/seo', () => {
    const targetDir = join(TEST_DIR, 'spa-no-seo')
    assembleProject(targetDir, ['ui'], 'spa-no-seo')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies?.['@nuxtjs/seo']).toBeUndefined()

    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')
    expect(config).toContain('ssr: false')
    expect(config).not.toContain('@nuxtjs/seo')
  })

  it('ssr: true 時 nuxt.config 包含 ssr: true 和 @nuxtjs/seo', () => {
    const features = resolveFeatureDependencies(['ssr', 'seo'])
    const targetDir = join(TEST_DIR, 'ssr-with-seo')
    assembleProject(targetDir, features, 'ssr-with-seo')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies['@nuxtjs/seo']).toBeDefined()

    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')
    expect(config).toContain('ssr: true')
    expect(config).toContain('@nuxtjs/seo')
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
