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
  deploymentTarget: 'cloudflare' | 'vercel' | 'node'
  testingLevel: 'full' | 'vitest-only' | 'none'
}
