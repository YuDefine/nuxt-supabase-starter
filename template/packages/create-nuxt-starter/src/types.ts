export type AgentRuntime = 'claude-code' | 'codex' | 'cursor'

export type EvlogPreset = 'none' | 'baseline' | 'd-pattern-audit' | 'nuxthub-ai'

export type DbStack = 'supabase' | 'nuxthub-d1' | 'void-d1'

export const EVLOG_PRESETS: readonly EvlogPreset[] = [
  'none',
  'baseline',
  'd-pattern-audit',
  'nuxthub-ai',
] as const

export const DB_STACKS: readonly DbStack[] = ['supabase', 'nuxthub-d1', 'void-d1'] as const

export const DEFAULT_DB_STACK: DbStack = 'supabase'

/**
 * 不使用 Supabase 的 dbStack —— 這些一律排除 `database` feature（`@nuxtjs/supabase`
 * 與整套 supabase 腳本）。收成一個具名集合，是因為這個判斷散在 cli / prompts / assemble
 * 三處，各自列舉的話新增一個 dbStack 就會漏掉其中一處，而漏掉的那處會安靜地把
 * Supabase 拉進一個根本不用它的專案。
 */
export const DB_STACKS_WITHOUT_SUPABASE: ReadonlySet<DbStack> = new Set<DbStack>([
  'nuxthub-d1',
  'void-d1',
])

export interface FeatureModule {
  id: string
  name: string
  description: string
  default: boolean
  group:
    | 'auth'
    | 'database'
    | 'ui'
    | 'extras'
    | 'state'
    | 'testing'
    | 'monitoring'
    | 'deployment'
    | 'quality'
    | 'git'
    | 'rendering'
    | 'ci'
  dependencies?: string[]
  incompatible?: string[]
  packages: Record<string, string>
  devPackages?: Record<string, string>
  nuxtModules?: string[]
  envVars?: Record<string, string>
  templateDir: string
}

export interface UserSelections {
  projectName: string
  features: string[]
  ssr: boolean
  deploymentTarget: 'cloudflare' | 'void' | 'node'
  testingLevel: 'full' | 'vitest-only' | 'none'
  agentTargets: AgentRuntime[]
  evlogPreset: EvlogPreset
  dbStack: DbStack
}
