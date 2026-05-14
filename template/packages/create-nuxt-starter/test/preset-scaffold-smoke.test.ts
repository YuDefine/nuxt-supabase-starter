import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleProject } from '../src/assemble'
import { buildSelectionsFromArgs } from '../src/cli'
import { PRESETS, type PresetId } from '../src/presets'

const TEST_DIR = join(import.meta.dirname, '.tmp-preset-smoke')

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
    selections.dbStack
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

  it('vercel-supabase produces Supabase but no Cloudflare/wrangler', () => {
    const { targetDir } = scaffold('vercel-supabase', 'vc-sb')
    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))

    expect(pkg.dependencies['@nuxtjs/supabase']).toBeDefined()
    expect(pkg.dependencies['@nuxthub/core']).toBeUndefined()
    expect(pkg.dependencies['wrangler']).toBeUndefined()
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

  it('每個 preset 都產出基本必要檔', () => {
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
