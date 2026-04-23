import { consola } from 'consola'
import type { AgentRuntime, UserSelections } from './types'
import { featureModules, resolveFeatureDependencies } from './features'

function normalizePromptValues(values: unknown): string[] {
  if (!Array.isArray(values)) return []

  return values
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'value' in item) {
        return String((item as { value: unknown }).value)
      }
      return ''
    })
    .filter(Boolean)
}

export async function promptUser(defaultProjectName?: string): Promise<UserSelections> {
  consola.log('')
  consola.box('Create Nuxt Starter')

  // 1. Project name
  const projectName =
    defaultProjectName ||
    ((await consola.prompt('專案名稱：', {
      type: 'text',
      default: 'nuxt-app',
      placeholder: 'nuxt-app',
    })) as string)

  if (typeof projectName === 'symbol') process.exit(0)

  // 2. Auth
  const authChoice = (await consola.prompt('認證系統？', {
    type: 'select',
    options: [
      {
        label: 'nuxt-auth-utils（推薦）— Cookie session，適用所有部署環境',
        value: 'auth-nuxt-utils',
      },
      {
        label: 'Better Auth — 需要 DB 連線，Workers + 自架 DB 需 Hyperdrive',
        value: 'auth-better-auth',
      },
      { label: '不需要', value: 'none' },
    ],
  })) as string

  if (typeof authChoice === 'symbol') process.exit(0)

  // 3. Database
  const dbChoice = (await consola.prompt('資料庫？', {
    type: 'select',
    options: [
      { label: 'Supabase（推薦）', value: 'database' },
      { label: '不需要', value: 'none' },
    ],
  })) as string

  if (typeof dbChoice === 'symbol') process.exit(0)

  // 4. UI
  const uiChoice = (await consola.prompt('UI 框架？', {
    type: 'select',
    options: [
      { label: 'Nuxt UI（推薦）', value: 'ui' },
      { label: '不需要', value: 'none' },
    ],
  })) as string

  if (typeof uiChoice === 'symbol') process.exit(0)

  // 5. Rendering mode
  const renderingChoice = (await consola.prompt('渲染模式？', {
    type: 'select',
    options: [
      { label: 'SPA（ssr: false）— 預設', value: 'spa' },
      { label: 'SSR（ssr: true）— 需要 Node.js 或 Workers 環境', value: 'ssr' },
    ],
  })) as string

  if (typeof renderingChoice === 'symbol') process.exit(0)

  const ssrEnabled = renderingChoice === 'ssr'

  // 6. Extras (multiselect)
  const extrasOptions = [
    { label: '圖表 (nuxt-charts)', value: 'charts' },
    { label: 'SEO（robots / sitemap / schema.org，需要 SSR）', value: 'seo' },
    { label: '安全性 Headers (nuxt-security)', value: 'security' },
    { label: '影像最佳化 (@nuxt/image)', value: 'image' },
    { label: 'VueUse 工具庫', value: 'vueuse' },
  ]
  const defaultExtras = ['charts', 'security', 'image', 'vueuse']
  const extrasRaw = await consola.prompt('額外功能？（空白鍵選擇）', {
    type: 'multiselect',
    options: extrasOptions,
    initial: defaultExtras,
  })

  if (typeof extrasRaw === 'symbol') process.exit(0)

  const extras = normalizePromptValues(extrasRaw)

  // 6. State management
  const stateChoice = (await consola.prompt('狀態管理？', {
    type: 'select',
    options: [
      { label: 'Pinia + Colada（推薦）', value: 'pinia' },
      { label: '不需要', value: 'none' },
    ],
  })) as string

  if (typeof stateChoice === 'symbol') process.exit(0)

  // 7. Testing
  const testingChoice = (await consola.prompt('測試框架？', {
    type: 'select',
    options: [
      { label: 'Vitest + Playwright（推薦）', value: 'full' },
      { label: '僅 Vitest', value: 'vitest-only' },
      { label: '不需要', value: 'none' },
    ],
  })) as string as 'full' | 'vitest-only' | 'none'

  if (typeof testingChoice === 'symbol') process.exit(0)

  // 8. Monitoring
  const monitoringChoice = (await consola.prompt('監控與錯誤追蹤？', {
    type: 'select',
    options: [
      { label: 'Sentry + Evlog', value: 'monitoring' },
      { label: '不需要', value: 'none' },
    ],
  })) as string

  if (typeof monitoringChoice === 'symbol') process.exit(0)

  // 9. Deployment
  const deployChoice = (await consola.prompt('部署目標？', {
    type: 'select',
    options: [
      { label: 'Cloudflare Workers（推薦）', value: 'cloudflare' },
      { label: 'Vercel', value: 'vercel' },
      { label: 'Node.js Server', value: 'node' },
    ],
  })) as string as 'cloudflare' | 'vercel' | 'node'

  if (typeof deployChoice === 'symbol') process.exit(0)

  // 10. Quality
  const qualityChoice = (await consola.prompt('程式碼品質工具？', {
    type: 'select',
    options: [
      { label: 'OXLint + OXFmt（推薦）', value: 'quality' },
      { label: '不需要', value: 'none' },
    ],
  })) as string

  if (typeof qualityChoice === 'symbol') process.exit(0)

  // 11. Git hooks
  const gitChoice = (await consola.prompt('Git Hooks？', {
    type: 'select',
    options: [
      { label: 'Husky + Commitlint（推薦）', value: 'git-hooks' },
      { label: '不需要', value: 'none' },
    ],
  })) as string

  if (typeof gitChoice === 'symbol') process.exit(0)

  // 12. CI mode
  const ciChoice = (await consola.prompt('GitHub Actions CI 模式？', {
    type: 'select',
    options: [
      {
        label: 'Simple（推薦）— Push/PR 跑 format/lint/typecheck/test',
        value: 'ci-simple',
      },
      {
        label: 'Advanced — GitHub Flow 嚴謹版：PR gate + path filter + CI→E2E 鏈 + artifact',
        value: 'ci-advanced',
      },
    ],
  })) as string

  if (typeof ciChoice === 'symbol') process.exit(0)

  // 13. AI runtimes
  const agentTargetOptions: Array<{ label: string; value: AgentRuntime }> = [
    { label: 'Claude Code（預設）', value: 'claude-code' },
    { label: 'Codex', value: 'codex' },
    { label: 'Cursor', value: 'cursor' },
  ]
  const agentTargetsRaw = await consola.prompt('要產出哪些 AI runtime 設定？（空白鍵選擇）', {
    type: 'multiselect',
    options: agentTargetOptions,
    initial: ['claude-code'],
  })

  if (typeof agentTargetsRaw === 'symbol') process.exit(0)

  const agentTargets = normalizePromptValues(agentTargetsRaw) as AgentRuntime[]
  const resolvedAgentTargets =
    agentTargets.length > 0 ? agentTargets : (['claude-code'] satisfies AgentRuntime[])

  // Collect features
  const features: string[] = []
  if (ssrEnabled) features.push('ssr')
  if (authChoice !== 'none') features.push(authChoice)
  if (dbChoice !== 'none') features.push(dbChoice)
  if (uiChoice !== 'none') features.push(uiChoice)
  features.push(...extras)
  if (stateChoice !== 'none') features.push(stateChoice)
  if (testingChoice === 'full') features.push('testing-full')
  else if (testingChoice === 'vitest-only') features.push('testing-vitest')
  if (monitoringChoice !== 'none') features.push(monitoringChoice)
  features.push(`deploy-${deployChoice}`)
  if (qualityChoice !== 'none') features.push(qualityChoice)
  if (gitChoice !== 'none') features.push(gitChoice)
  features.push(ciChoice)

  // Resolve dependencies
  const resolved = resolveFeatureDependencies(features)

  // Check if dependencies were auto-added
  const autoAdded = resolved.filter((f) => !features.includes(f))
  if (autoAdded.length > 0) {
    const names = autoAdded.map((id) => featureModules.find((m) => m.id === id)?.name || id)
    consola.info(`自動加入相依功能：${names.join(', ')}`)
  }

  return {
    projectName,
    features: resolved,
    ssr: ssrEnabled,
    deploymentTarget: deployChoice,
    testingLevel: testingChoice,
    agentTargets: resolvedAgentTargets,
  }
}

export function displaySummary(selections: UserSelections): void {
  // Use basename for display — projectName may be an absolute path from scripts
  const displayName = selections.projectName.includes('/')
    ? selections.projectName.split('/').pop()!
    : selections.projectName
  consola.log('')
  consola.log('📋 專案配置摘要：')
  consola.log(`   專案名稱：${displayName}`)
  consola.log(`   AI Runtime：${selections.agentTargets.join(', ')}`)
  consola.log(`   功能：`)

  for (const featureId of selections.features) {
    const mod = featureModules.find((m) => m.id === featureId)
    if (mod) {
      consola.log(`     ✓ ${mod.name} — ${mod.description}`)
    }
  }
  consola.log('')
}

export async function confirmScaffold(): Promise<boolean> {
  const confirmed = await consola.prompt('確認建立專案？', {
    type: 'confirm',
    initial: true,
  })
  return confirmed === true
}

export function getDefaultSelections(projectName: string): UserSelections {
  const defaults = featureModules.filter((m) => m.default).map((m) => m.id)
  // Add default deployment
  if (!defaults.some((id) => id.startsWith('deploy-'))) {
    defaults.push('deploy-cloudflare')
  }
  const features = resolveFeatureDependencies(defaults)
  return {
    projectName,
    features,
    ssr: features.includes('ssr'),
    deploymentTarget: 'cloudflare',
    testingLevel: 'full',
    agentTargets: ['claude-code'],
  }
}
