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
      'custom', // preset picker → 走完整 15-prompt wizard
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
      'custom', // preset picker → 走完整 15-prompt wizard
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

describe('--preset stack values', () => {
  it('--preset cloudflare-supabase 等同預設行為', () => {
    const defaults = buildSelectionsFromArgs({ projectName: 'default-app' })
    const preset = buildSelectionsFromArgs({
      projectName: 'preset-app',
      preset: 'cloudflare-supabase',
    })

    expect(preset.deploymentTarget).toBe(defaults.deploymentTarget)
    expect(preset.dbStack).toBe(defaults.dbStack)
    expect(preset.evlogPreset).toBe(defaults.evlogPreset)
    expect([...preset.features].toSorted()).toEqual([...defaults.features].toSorted())
  })

  it('--preset cloudflare-nuxthub-ai 自動鎖 dbStack=nuxthub-d1 + evlogPreset=nuxthub-ai + better-auth', () => {
    const selections = buildSelectionsFromArgs({
      projectName: 'nuxthub-ai-app',
      preset: 'cloudflare-nuxthub-ai',
    })

    expect(selections.dbStack).toBe('nuxthub-d1')
    expect(selections.evlogPreset).toBe('nuxthub-ai')
    expect(selections.features).toContain('auth-better-auth')
    expect(selections.features).not.toContain('auth-nuxt-utils')
    expect(selections.features).not.toContain('database')
    expect(selections.features).toContain('monitoring')
  })

  it('--preset vercel-supabase 切到 Vercel deploy', () => {
    const selections = buildSelectionsFromArgs({
      projectName: 'vercel-app',
      preset: 'vercel-supabase',
    })

    expect(selections.deploymentTarget).toBe('vercel')
    expect(selections.features).toContain('deploy-vercel')
    expect(selections.features).not.toContain('deploy-cloudflare')
    expect(selections.features).not.toContain('deploy-node')
  })

  it('--preset self-hosted-node 帶 Node deploy + ci-advanced', () => {
    const selections = buildSelectionsFromArgs({
      projectName: 'node-app',
      preset: 'self-hosted-node',
    })

    expect(selections.deploymentTarget).toBe('node')
    expect(selections.features).toContain('deploy-node')
    expect(selections.features).toContain('ci-advanced')
    expect(selections.features).not.toContain('ci-simple')
  })

  it('--preset minimal 從空集合起手，不含 default features', () => {
    const selections = buildSelectionsFromArgs({
      projectName: 'minimal-app',
      preset: 'minimal',
    })

    expect(selections.features).not.toContain('database')
    expect(selections.features).not.toContain('ui')
    expect(selections.features).not.toContain('auth-nuxt-utils')
    expect(selections.features).not.toContain('auth-better-auth')
    expect(selections.features).not.toContain('monitoring')
    // 但仍含 preset 自帶的 deploy + ci
    expect(selections.features).toContain('deploy-cloudflare')
    expect(selections.features).toContain('ci-simple')
    expect(selections.evlogPreset).toBe('none')
  })

  it('--with auth-better-auth 可覆蓋 preset 的 auth 預設', () => {
    const selections = buildSelectionsFromArgs({
      projectName: 'override-auth',
      preset: 'cloudflare-supabase',
      with: 'auth-better-auth',
    })

    expect(selections.features).toContain('auth-better-auth')
    expect(selections.features).not.toContain('auth-nuxt-utils')
  })

  it('--preset default 已移除，提示改用 cloudflare-supabase', () => {
    expect(() =>
      buildSelectionsFromArgs({ projectName: 'legacy-default', preset: 'default' })
    ).toThrow(/--preset default 已移除.*cloudflare-supabase/s)
  })

  it('--preset fast 已移除，提示改用 --without testing-*', () => {
    expect(() => buildSelectionsFromArgs({ projectName: 'legacy-fast', preset: 'fast' })).toThrow(
      /--preset fast 已移除.*--without testing-full,testing-vitest/s
    )
  })

  it('--fast flag 已移除，提示改用 --without testing-*', () => {
    expect(() => buildSelectionsFromArgs({ projectName: 'legacy-fast-flag', fast: true })).toThrow(
      /--fast 已移除/
    )
  })

  it('未知 preset id 顯示可用值清單', () => {
    expect(() =>
      buildSelectionsFromArgs({ projectName: 'unknown', preset: 'unknown-preset' })
    ).toThrow(/cloudflare-supabase.*cloudflare-nuxthub-ai/s)
  })
})

describe('wizard preset picker', () => {
  it('選 cloudflare-supabase preset 走 short wizard（不問 db/evlog/deploy/monitoring/ci）', async () => {
    const responses: unknown[] = [
      'cloudflare-supabase', // preset picker
      'auth-nuxt-utils', // auth
      'ui', // UI
      'spa', // SSR
      ['charts', 'security', 'image', 'vueuse'], // extras
      'pinia', // state
      'full', // testing
      ['claude-code'], // agent targets
    ]
    const prompt = vi.spyOn(consola, 'prompt').mockImplementation(async () => responses.shift())

    const selections = await promptUser('preset-wizard-app')

    expect(selections.dbStack).toBe('supabase')
    expect(selections.evlogPreset).toBe('baseline')
    expect(selections.deploymentTarget).toBe('cloudflare')
    expect(selections.features).toContain('monitoring')
    expect(selections.features).toContain('ci-simple')
    expect(selections.features).toContain('deploy-cloudflare')

    // short wizard 不該問被 preset 鎖死的 prompt
    const promptLabels = prompt.mock.calls.map(([message]) => message)
    expect(promptLabels).not.toContain('資料庫？')
    expect(promptLabels).not.toContain('部署目標？')
    expect(promptLabels).not.toContain('監控與錯誤追蹤？')
    expect(promptLabels).not.toContain('GitHub Actions CI 模式？')
    expect(promptLabels).not.toContain('Database stack？')
    expect(promptLabels).not.toContain('evlog preset？（wide event logging tier）')
  })

  it('選 minimal preset 後 features 不含 default 套件', async () => {
    const responses: unknown[] = [
      'minimal',
      'none', // auth
      'none', // UI
      'spa',
      [], // extras 全空
      'none', // state
      'none', // testing
      ['claude-code'],
    ]
    vi.spyOn(consola, 'prompt').mockImplementation(async () => responses.shift())

    const selections = await promptUser('minimal-wizard-app')

    expect(selections.evlogPreset).toBe('none')
    expect(selections.features).not.toContain('database')
    expect(selections.features).not.toContain('ui')
    expect(selections.features).not.toContain('monitoring')
    expect(selections.features).toContain('deploy-cloudflare')
  })

  it('選 cloudflare-nuxthub-ai preset 自動鎖 dbStack + better-auth', async () => {
    const responses: unknown[] = [
      'cloudflare-nuxthub-ai',
      'auth-better-auth', // preset 預設就是 better-auth，這裡照樣選
      'ui',
      'spa',
      ['charts'],
      'pinia',
      'full',
      ['claude-code'],
    ]
    vi.spyOn(consola, 'prompt').mockImplementation(async () => responses.shift())

    const selections = await promptUser('nuxthub-wizard-app')

    expect(selections.dbStack).toBe('nuxthub-d1')
    expect(selections.evlogPreset).toBe('nuxthub-ai')
    expect(selections.features).toContain('auth-better-auth')
    expect(selections.features).not.toContain('auth-nuxt-utils')
    expect(selections.features).not.toContain('database') // d1 模式 strip 掉
  })
})
