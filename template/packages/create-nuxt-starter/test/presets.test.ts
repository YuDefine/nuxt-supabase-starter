import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRESET_ID,
  PRESETS,
  PRESET_IDS,
  applyPreset,
  getPresetById,
  isPresetId,
} from '../src/presets'

describe('PRESETS manifest', () => {
  it('5 個 stack preset 都有唯一 id', () => {
    const ids = PRESETS.map((p) => p.id)
    expect(ids).toEqual([
      'cloudflare-supabase',
      'cloudflare-nuxthub-ai',
      'vercel-supabase',
      'self-hosted-node',
      'minimal',
    ])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('cloudflare-supabase 是預設', () => {
    expect(DEFAULT_PRESET_ID).toBe('cloudflare-supabase')
    expect(getPresetById(DEFAULT_PRESET_ID)).toBeDefined()
  })

  it('cloudflare-nuxthub-ai 強制 dbStack=nuxthub-d1 + evlogPreset=nuxthub-ai + better-auth', () => {
    const preset = getPresetById('cloudflare-nuxthub-ai')!
    expect(preset.dbStack).toBe('nuxthub-d1')
    expect(preset.evlogPreset).toBe('nuxthub-ai')
    expect(preset.authDefault).toBe('auth-better-auth')
  })

  it('minimal 標記 startEmpty + evlogPreset=none + auth=none', () => {
    const preset = getPresetById('minimal')!
    expect(preset.startEmpty).toBe(true)
    expect(preset.evlogPreset).toBe('none')
    expect(preset.authDefault).toBe('none')
  })

  it('self-hosted-node 帶 ci-advanced + Node deploy', () => {
    const preset = getPresetById('self-hosted-node')!
    expect(preset.ci).toBe('ci-advanced')
    expect(preset.deploy).toBe('node')
  })

  it('PRESET_IDS 與 PRESETS 對齊', () => {
    expect(PRESET_IDS).toEqual(PRESETS.map((p) => p.id))
  })

  it('isPresetId 對未知 id 回 false', () => {
    expect(isPresetId('cloudflare-supabase')).toBe(true)
    expect(isPresetId('default')).toBe(false)
    expect(isPresetId('fast')).toBe(false)
    expect(isPresetId('unknown')).toBe(false)
  })
})

describe('applyPreset', () => {
  it('cloudflare-supabase 後 features 含 deploy-cloudflare、不含 deploy-vercel / deploy-node', () => {
    const features = applyPreset(getPresetById('cloudflare-supabase')!)
    expect(features.has('deploy-cloudflare')).toBe(true)
    expect(features.has('deploy-vercel')).toBe(false)
    expect(features.has('deploy-node')).toBe(false)
  })

  it('cloudflare-nuxthub-ai 後 auth 預設變 better-auth（避開 nuxthub-d1 + nuxt-auth-utils 不相容）', () => {
    const features = applyPreset(getPresetById('cloudflare-nuxthub-ai')!)
    expect(features.has('auth-better-auth')).toBe(true)
    expect(features.has('auth-nuxt-utils')).toBe(false)
  })

  it('vercel-supabase 後 features 含 deploy-vercel、不含 deploy-cloudflare', () => {
    const features = applyPreset(getPresetById('vercel-supabase')!)
    expect(features.has('deploy-vercel')).toBe(true)
    expect(features.has('deploy-cloudflare')).toBe(false)
  })

  it('self-hosted-node 後 features 含 deploy-node + ci-advanced、不含 ci-simple', () => {
    const features = applyPreset(getPresetById('self-hosted-node')!)
    expect(features.has('deploy-node')).toBe(true)
    expect(features.has('ci-advanced')).toBe(true)
    expect(features.has('ci-simple')).toBe(false)
  })

  it('minimal 從空集合起手，不含 default features 也不含 auth / database / monitoring', () => {
    const features = applyPreset(getPresetById('minimal')!)
    expect(features.has('database')).toBe(false)
    expect(features.has('ui')).toBe(false)
    expect(features.has('auth-nuxt-utils')).toBe(false)
    expect(features.has('auth-better-auth')).toBe(false)
    expect(features.has('monitoring')).toBe(false)
    // 仍會含 preset 自帶的 deploy + ci（minimal 也得選一個部署目標）
    expect(features.has('deploy-cloudflare')).toBe(true)
    expect(features.has('ci-simple')).toBe(true)
  })
})
