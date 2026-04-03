import { consola } from 'consola'
import type { UserSelections } from './types'
import { featureModules, resolveFeatureDependencies } from './features'

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
    { label: 'SEO (@nuxtjs/seo)（需要 SSR）', value: 'seo' },
    { label: '安全性 Headers (nuxt-security)', value: 'security' },
    { label: '影像最佳化 (@nuxt/image)', value: 'image' },
    { label: 'VueUse 工具庫', value: 'vueuse' },
  ]
  const defaultExtras = ['security', 'vueuse']
  const extrasRaw = await consola.prompt('額外功能？（空白鍵選擇）', {
    type: 'multiselect',
    options: extrasOptions,
    initial: defaultExtras,
  })

  if (typeof extrasRaw === 'symbol') process.exit(0)

  const extras = Array.isArray(extrasRaw)
    ? extrasRaw
        .map((item) => {
          if (typeof item === 'string') return item
          if (item && typeof item === 'object' && 'value' in item) {
            return String((item as { value: unknown }).value)
          }
          return ''
        })
        .filter(Boolean)
    : []

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
  }
}

export function displaySummary(selections: UserSelections): void {
  consola.log('')
  consola.log('📋 專案配置摘要：')
  consola.log(`   專案名稱：${selections.projectName}`)
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
  }
}
