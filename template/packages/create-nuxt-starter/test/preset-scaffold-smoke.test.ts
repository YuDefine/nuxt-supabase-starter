import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleProject } from '../src/assemble'
import { buildSelectionsFromArgs } from '../src/cli'
import { PRESETS, type PresetId } from '../src/presets'

const TEST_DIR = mkdtempSync(join(tmpdir(), 'preset-smoke-'))

function cleanTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
}

function scaffold(presetId: PresetId, projectName: string) {
  const selections = buildSelectionsFromArgs({
    projectName,
    preset: presetId,
  })
  const targetDir = join(TEST_DIR, projectName)
  assembleProject(
    targetDir,
    selections.features,
    projectName,
    selections.agentTargets,
    selections.evlogPreset,
    selections.dbStack,
  )
  return { targetDir, selections }
}

beforeEach(() => cleanTestDir())
afterEach(() => cleanTestDir())

describe('preset smoke: 5 個 stack preset 各跑 assembleProject', () => {
  it('cloudflare-supabase produces Supabase + Cloudflare + evlog baseline', () => {
    const { targetDir } = scaffold('cloudflare-supabase', 'cf-sb')
    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')

    expect(pkg.dependencies['@nuxtjs/supabase']).toBeDefined()
    expect(pkg.dependencies['@nuxthub/core']).toBeDefined()
    expect(pkg.dependencies['wrangler']).toBeDefined()
    expect(pkg.dependencies['evlog']).toBeDefined()
    expect(config).toContain('@nuxtjs/supabase')
    expect(config).toContain('evlog/nuxt')
  })

  it('cloudflare-nuxthub-ai produces NuxtHub D1 + Better Auth + nuxthub-ai evlog', () => {
    const { targetDir } = scaffold('cloudflare-nuxthub-ai', 'cf-ai')
    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')

    expect(pkg.dependencies['@nuxthub/core']).toBeDefined()
    expect(pkg.dependencies['@nuxtjs/supabase']).toBeUndefined()
    expect(pkg.dependencies['better-auth']).toBeDefined()
    expect(pkg.scripts['hub:db:migrations:apply']).toBeDefined()
    expect(config).toContain('@evlog/nuxthub')
    expect(config).not.toContain('@nuxtjs/supabase')
  })

  it('void-cloud 帶 void dep、NEVER 帶 @nuxthub/core，且產出兩段式 deploy workflow', () => {
    const { targetDir } = scaffold('void-cloud', 'void-sb')
    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))

    expect(pkg.dependencies['@nuxtjs/supabase']).toBeDefined()
    // cloudflare-workers.md § 1 矩陣第三列：void track MUST NOT 帶 @nuxthub/core
    expect(pkg.dependencies['@nuxthub/core']).toBeUndefined()
    expect(pkg.dependencies['void'] ?? pkg.devDependencies?.['void']).toBeDefined()
    expect(pkg.scripts['void:deploy']).toBe('void deploy')

    const staging = readFileSync(join(targetDir, '.github/workflows/deploy-staging.yml'), 'utf-8')
    const production = readFileSync(
      join(targetDir, '.github/workflows/deploy-production.yml'),
      'utf-8',
    )

    // deploy 走 void CLI，不是 wrangler-action
    expect(staging).toContain('void deploy --project')
    expect(production).toContain('void deploy --project')
    expect(staging).not.toContain('wrangler-action')
    expect(production).not.toContain('wrangler-action')

    // main → staging、tag → production
    expect(staging).toContain('branches: [main]')
    expect(production).toContain("tags: ['v*']")

    // OIDC，不存長期 token
    expect(staging).toContain('id-token: write')
    expect(production).toContain('id-token: write')
    // 禁的是「使用長期 token」，不是註解裡提到它為何不需要
    expect(staging).not.toContain('secrets.VOID_TOKEN')
    expect(production).not.toContain('secrets.VOID_TOKEN')

    // void deploy 內部自做 provisioning，沒有 migrate job 的位置
    expect(staging).not.toContain('supabase db push')

    // config 交給 `void init`，starter 不產快照
    expect(existsSync(join(targetDir, 'void.json'))).toBe(false)
  })

  it('self-hosted-node produces Supabase + Node deploy + ci-advanced workflow', () => {
    const { targetDir } = scaffold('self-hosted-node', 'sh-node')
    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))

    expect(pkg.dependencies['@nuxtjs/supabase']).toBeDefined()
    expect(pkg.dependencies['@nuxthub/core']).toBeUndefined()
    expect(pkg.dependencies['wrangler']).toBeUndefined()
    // ci-advanced workflow file should be scaffolded under .github/workflows
    expect(existsSync(join(targetDir, '.github', 'workflows'))).toBe(true)
  })

  it('minimal scaffolds project without auth / database / monitoring / ui', () => {
    const { targetDir } = scaffold('minimal', 'min')
    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')

    expect(pkg.dependencies['@nuxtjs/supabase']).toBeUndefined()
    expect(pkg.dependencies['nuxt-auth-utils']).toBeUndefined()
    expect(pkg.dependencies['better-auth']).toBeUndefined()
    expect(pkg.dependencies['@nuxt/ui']).toBeUndefined()
    expect(pkg.dependencies['@sentry/nuxt']).toBeUndefined()
    expect(pkg.dependencies['evlog']).toBeUndefined()
    // Cloudflare deploy is still selected (every project needs a deploy target)
    expect(pkg.dependencies['@nuxthub/core']).toBeDefined()
    expect(config).not.toContain('@nuxtjs/supabase')
    expect(config).not.toContain('evlog/nuxt')
    expect(config).not.toContain('@nuxt/ui')
  })

  // 這條在單一 test body 內連跑 5 次完整 scaffold（每次都是實際 file I/O），
  // 預設的 5s timeout 在 CI 機器慢一點時就不夠 —— 它不是卡住，是真的要這麼久。
  it('每個 preset 都產出基本必要檔', { timeout: 30_000 }, () => {
    for (const preset of PRESETS) {
      const { targetDir } = scaffold(preset.id, `req-${preset.id}`)
      expect(existsSync(join(targetDir, 'package.json'))).toBe(true)
      expect(existsSync(join(targetDir, 'nuxt.config.ts'))).toBe(true)
      expect(existsSync(join(targetDir, 'tsconfig.json'))).toBe(true)
      expect(existsSync(join(targetDir, 'app', 'app.vue'))).toBe(true)
      expect(existsSync(join(targetDir, '.env.example'))).toBe(true)
      expect(existsSync(join(targetDir, '.claude', 'settings.json'))).toBe(true)
    }
  })
})
