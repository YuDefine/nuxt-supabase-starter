import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'pathe'
import { consola } from 'consola'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assembleProject } from '../src/assemble'
import { buildSelectionsFromArgs } from '../src/cli'
import { promptUser } from '../src/prompts'

const TEST_DIR = join(import.meta.dirname, '.tmp-cli-test')

function cleanTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
}

beforeEach(() => {
  cleanTestDir()
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanTestDir()
})

describe('CLI dbStack selection', () => {
  it('defaults to Supabase', () => {
    const selections = buildSelectionsFromArgs({ projectName: 'default-app' })

    expect(selections.dbStack).toBe('supabase')
    expect(selections.features).toContain('database')
    expect(selections.features).toContain('auth-nuxt-utils')
  })

  it('supports explicit NuxtHub D1 with compatible implicit auth default', () => {
    const selections = buildSelectionsFromArgs({
      projectName: 'd1-app',
      db: 'nuxthub-d1',
    })

    expect(selections.dbStack).toBe('nuxthub-d1')
    expect(selections.features).toContain('auth-better-auth')
    expect(selections.features).not.toContain('auth-nuxt-utils')
    expect(selections.features).not.toContain('database')
  })

  it('nuxthub-ai auto-implies NuxtHub D1', () => {
    const selections = buildSelectionsFromArgs({
      projectName: 'ai-app',
      evlogPreset: 'nuxthub-ai',
    })

    expect(selections.evlogPreset).toBe('nuxthub-ai')
    expect(selections.dbStack).toBe('nuxthub-d1')
    expect(selections.features).toContain('auth-better-auth')
    expect(selections.features).toContain('monitoring')
    expect(selections.features).not.toContain('database')
  })

  it('rejects explicit Supabase with nuxthub-ai', () => {
    expect(() =>
      buildSelectionsFromArgs({
        projectName: 'mixed-app',
        db: 'supabase',
        evlogPreset: 'nuxthub-ai',
      })
    ).toThrow(/nuxthub-ai.*--db supabase/)
  })

  it('rejects nuxt-auth-utils with NuxtHub D1', () => {
    expect(() =>
      buildSelectionsFromArgs({
        projectName: 'invalid-auth-app',
        auth: 'nuxt-auth-utils',
        db: 'nuxthub-d1',
      })
    ).toThrow(/better-auth.*none.*nuxt-auth-utils/)
  })

  it('allows better-auth and none with NuxtHub D1', () => {
    const betterAuth = buildSelectionsFromArgs({
      projectName: 'better-auth-d1',
      auth: 'better-auth',
      db: 'nuxthub-d1',
    })
    const noAuth = buildSelectionsFromArgs({
      projectName: 'no-auth-d1',
      auth: 'none',
      db: 'nuxthub-d1',
    })

    expect(betterAuth.dbStack).toBe('nuxthub-d1')
    expect(betterAuth.features).toContain('auth-better-auth')
    expect(noAuth.dbStack).toBe('nuxthub-d1')
    expect(noAuth.features).not.toContain('auth-better-auth')
    expect(noAuth.features).not.toContain('auth-nuxt-utils')
  })

  it('assembles explicit NuxtHub D1 without Supabase layout', () => {
    const selections = buildSelectionsFromArgs({
      projectName: 'assembled-d1',
      auth: 'better-auth',
      db: 'nuxthub-d1',
      evlogPreset: 'nuxthub-ai',
    })
    const targetDir = join(TEST_DIR, 'assembled-d1')

    assembleProject(
      targetDir,
      selections.features,
      'assembled-d1',
      selections.agentTargets,
      selections.evlogPreset,
      selections.dbStack
    )

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')

    expect(existsSync(join(targetDir, 'server/database/schema/index.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'server/db'))).toBe(false)
    expect(pkg.scripts['hub:db:migrations:apply']).toBeDefined()
    expect(pkg.scripts['db:drizzle:pull']).toBeUndefined()
    expect(pkg.dependencies['@nuxthub/core']).toBeDefined()
    expect(pkg.dependencies['@nuxtjs/supabase']).toBeUndefined()
    expect(config).toContain('@nuxthub/core')
    expect(config).toContain('@evlog/nuxthub')
    expect(config).not.toContain('@nuxtjs/supabase')
  })
})

describe('wizard dbStack selection', () => {
  it('auto-selects NuxtHub D1 for nuxthub-ai without prompting for DB stack', async () => {
    const responses: unknown[] = [
      'auth-better-auth',
      'database',
      'none',
      'spa',
      [],
      'none',
      'none',
      'none',
      'cloudflare',
      'none',
      'none',
      'ci-simple',
      ['claude-code'],
      'nuxthub-ai',
    ]
    const prompt = vi.spyOn(consola, 'prompt').mockImplementation(async () => responses.shift())

    const selections = await promptUser('wizard-ai')

    expect(selections.dbStack).toBe('nuxthub-d1')
    expect(selections.features).toContain('auth-better-auth')
    expect(selections.features).not.toContain('database')
    expect(prompt.mock.calls.map(([message]) => message)).not.toContain('Database stack？')
  })

  it('rejects wizard NuxtHub D1 with nuxt-auth-utils', async () => {
    const responses: unknown[] = [
      'auth-nuxt-utils',
      'database',
      'none',
      'spa',
      [],
      'none',
      'none',
      'none',
      'cloudflare',
      'none',
      'none',
      'ci-simple',
      ['claude-code'],
      'nuxthub-ai',
    ]
    vi.spyOn(consola, 'prompt').mockImplementation(async () => responses.shift())

    await expect(promptUser('wizard-invalid')).rejects.toThrow(/nuxthub-d1.*Better Auth/)
  })
})
