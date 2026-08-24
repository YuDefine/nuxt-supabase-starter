import type { DbStack, EvlogPreset } from './types'
import { featureModules, getModuleById } from './features'

export type PresetId =
  | 'cloudflare-supabase'
  | 'cloudflare-nuxthub-ai'
  | 'void-cloud'
  | 'self-hosted-node'
  | 'minimal'

export type PresetAuthDefault = 'auth-nuxt-utils' | 'auth-better-auth' | 'none'
export type PresetCi = 'ci-simple' | 'ci-advanced'
export type PresetDeploy = 'cloudflare' | 'void' | 'node'

export interface PresetDefinition {
  id: PresetId
  label: string
  description: string
  deploy: PresetDeploy
  dbStack: DbStack
  evlogPreset: EvlogPreset
  authDefault: PresetAuthDefault
  ci: PresetCi
  // Start from empty feature set instead of `featureModules.filter(m => m.default)`.
  // 'minimal' preset uses this; others build on top of default features.
  startEmpty?: boolean
}

export const PRESETS: readonly PresetDefinition[] = [
  {
    id: 'cloudflare-supabase',
    label: 'Cloudflare + Supabase（推薦）',
    description: 'Cloudflare Workers 部署、Supabase 託管資料庫、baseline evlog',
    deploy: 'cloudflare',
    dbStack: 'supabase',
    evlogPreset: 'baseline',
    authDefault: 'auth-nuxt-utils',
    ci: 'ci-simple',
  },
  {
    id: 'cloudflare-nuxthub-ai',
    label: 'Cloudflare + NuxtHub D1 + AI',
    description: 'NuxtHub D1 SQL、AI agent context、SSE/MCP child（強制 Better Auth）',
    deploy: 'cloudflare',
    dbStack: 'nuxthub-d1',
    evlogPreset: 'nuxthub-ai',
    authDefault: 'auth-better-auth',
    ci: 'ci-simple',
  },
  {
    id: 'void-cloud',
    label: 'void.cloud（D1 + R2 全託管）',
    description: 'void.cloud 一鍵部署，D1 與 R2 由 void 託管；schema 走 void/db，不必自備資料庫',
    deploy: 'void',
    dbStack: 'void-d1',
    evlogPreset: 'baseline',
    /**
     * void 軌的 auth **必須**是 `auth-nuxt-utils`，不是沿用預設而已。三條理由：
     *
     * 1. void 內建的 Better Auth 在 Nuxt 上不可用：void 官方 `docs/guide/auth.md`
     *    開頭 warning 明載 Void-managed auth 只支援 Void apps、meta-framework mode
     *    尚未支援，而 `docs/guide/app-types.md` 把 Nuxt 列為 meta-framework。
     * 2. starter 的 `auth-better-auth` feature 宣告 `dependencies: ['database']`
     *    （Supabase），但 `void-d1` dbStack 會把 `database` 過濾掉。兩者湊在一起會
     *    scaffold 出一個「有 better-auth、沒有它要的 DB」的專案——見 cli.ts 的
     *    `validateDeployDbStackCompatibility()`，該組合現在直接 fail。
     * 3. `nuxt-auth-utils` 是 cookie session、不需要 DB、跑得動 Workers，
     *    正是 void 部署的執行環境。
     *
     * NEVER 為了「跟其他 preset 一致」把它改成 `auth-better-auth`。
     */
    authDefault: 'auth-nuxt-utils',
    ci: 'ci-simple',
  },
  {
    id: 'self-hosted-node',
    label: 'Self-hosted Node + Supabase',
    description: 'Node.js Server 自架部署、自架 Supabase、advanced CI（GitHub Flow）',
    deploy: 'node',
    dbStack: 'supabase',
    evlogPreset: 'baseline',
    authDefault: 'auth-nuxt-utils',
    ci: 'ci-advanced',
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: '最小起手：純 Nuxt + Cloudflare 部署，不含 auth / db / evlog / extras',
    deploy: 'cloudflare',
    dbStack: 'supabase',
    evlogPreset: 'none',
    authDefault: 'none',
    ci: 'ci-simple',
    startEmpty: true,
  },
] as const

export const PRESET_IDS: readonly PresetId[] = PRESETS.map((p) => p.id)
export const DEFAULT_PRESET_ID: PresetId = 'cloudflare-supabase'

export function getPresetById(id: string): PresetDefinition | undefined {
  return PRESETS.find((p) => p.id === id)
}

export function isPresetId(id: string): id is PresetId {
  return PRESET_IDS.includes(id as PresetId)
}

// Replace any feature in `group` with `targetId`. If `targetId` is undefined, just clear the group.
function replaceGroupFeature(
  selected: Set<string>,
  group: 'deployment' | 'ci' | 'auth',
  targetId: string | undefined,
): void {
  for (const mod of featureModules) {
    if (mod.group === group) selected.delete(mod.id)
  }
  if (targetId) {
    const mod = getModuleById(targetId)
    if (mod) selected.add(targetId)
  }
}

// Apply a preset to a feature set. Caller controls `--with` / `--without` overrides
// downstream — applyPreset only encodes the preset's own deploy/ci/auth choices and
// preserves dependency resolution. evlog→monitoring coupling is handled by
// `buildSelectionsFromArgs` via the same code path used for the explicit
// `--evlog-preset` flag, so we don't touch monitoring here.
export function applyPreset(preset: PresetDefinition): Set<string> {
  const selected = new Set<string>(
    preset.startEmpty ? [] : featureModules.filter((m) => m.default).map((m) => m.id),
  )

  replaceGroupFeature(selected, 'deployment', `deploy-${preset.deploy}`)
  replaceGroupFeature(selected, 'ci', preset.ci)
  replaceGroupFeature(
    selected,
    'auth',
    preset.authDefault === 'none' ? undefined : preset.authDefault,
  )

  return selected
}
