import { consola } from 'consola'
import {
  DB_STACKS_WITHOUT_SUPABASE,
  DEFAULT_DB_STACK,
  type AgentRuntime,
  type DbHost,
  type DbStack,
  type EvlogPreset,
  type UserSelections,
} from './types'
import { questionById, usesSupabaseDatabase } from './question-catalog'
import { featureModules, getModuleById, resolveFeatureDependencies } from './features'
import { PRESETS, applyPreset, getPresetById, type PresetDefinition } from './presets'

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

/**
 * dbStack × auth 的相容矩陣。**這是 backstop，不是主要防線**——wizard 應該一開始就
 * 不把不相容的選項端到使用者面前（見 `authOptionsForDbStack()` / `dbStackOptionsForAuth()`）。
 * 走到這裡代表選項過濾漏了。
 */
function assertWizardAuthCompatible(authChoice: string, dbStack: DbStack): void {
  if (dbStack === 'nuxthub-d1' && authChoice === 'auth-nuxt-utils') {
    throw new Error('dbStack nuxthub-d1 只支援 Better Auth 或不啟用 auth；不支援 nuxt-auth-utils')
  }

  // void-d1 走的是 void 託管的 D1，Supabase feature 會被濾掉，Better Auth 會缺它要的 DB。
  // 理由三條寫在 presets.ts 的 void-cloud 註解，強制執行在 cli.ts 的
  // validateDeployDbStackCompatibility()。
  if (dbStack === 'void-d1' && authChoice === 'auth-better-auth') {
    throw new Error(
      'dbStack void-d1 不支援 Better Auth（Better Auth 需要自己的 DB，void-d1 會把 Supabase 濾掉）；' +
        '請改用 nuxt-auth-utils 或不啟用 auth',
    )
  }
}

interface WizardOption {
  label: string
  value: string
}

const AUTH_OPTION_NUXT_UTILS: WizardOption = {
  label: 'nuxt-auth-utils — Cookie session，適用所有部署環境',
  value: 'auth-nuxt-utils',
}
const AUTH_OPTION_BETTER_AUTH: WizardOption = {
  label: 'Better Auth — 需要 DB 連線，Workers + 自架 DB 需 Hyperdrive',
  value: 'auth-better-auth',
}
const AUTH_OPTION_NONE: WizardOption = { label: '不需要', value: 'none' }

/** 只端出與該 dbStack 相容的 auth 選項，並說明少掉的那個為什麼不在。 */
function authOptionsForDbStack(dbStack: DbStack): WizardOption[] {
  if (dbStack === 'nuxthub-d1') {
    consola.info('dbStack nuxthub-d1：auth 選項只列 Better Auth（nuxt-auth-utils 不相容）。')
    return [AUTH_OPTION_BETTER_AUTH, AUTH_OPTION_NONE]
  }

  if (dbStack === 'void-d1') {
    consola.info(
      'dbStack void-d1：auth 選項不列 Better Auth——它需要自己的資料庫，' +
        '而 void 託管 D1 這條軌不會帶 Supabase。',
    )
    return [AUTH_OPTION_NUXT_UTILS, AUTH_OPTION_NONE]
  }

  return [AUTH_OPTION_NUXT_UTILS, AUTH_OPTION_BETTER_AUTH, AUTH_OPTION_NONE]
}

/** custom wizard 先問 auth、後問 dbStack，所以反過來過濾 dbStack 選項。 */
function dbStackOptionsForAuth(authChoice: string): WizardOption[] {
  const options: WizardOption[] = [
    { label: 'Supabase（預設）', value: 'supabase' },
    { label: 'NuxtHub D1', value: 'nuxthub-d1' },
    { label: 'void 託管 D1（需搭配 void.cloud 部署）', value: 'void-d1' },
  ]

  if (authChoice === 'auth-better-auth') {
    consola.info('auth 選了 Better Auth：dbStack 不列 void-d1（那條軌沒有 Better Auth 要的 DB）。')
    return options.filter((o) => o.value !== 'void-d1')
  }

  if (authChoice === 'auth-nuxt-utils') {
    consola.info(
      'auth 選了 nuxt-auth-utils：dbStack 不列 nuxthub-d1（該 stack 只支援 Better Auth）。',
    )
    return options.filter((o) => o.value !== 'nuxthub-d1')
  }

  return options
}

export async function promptUser(defaultProjectName?: string): Promise<UserSelections> {
  consola.log('')
  consola.box('Create Nuxt Starter')

  // 0. Preset picker — 5 個 stack preset + custom 逃生口（完整 15-prompt wizard）
  const presetChoice = (await consola.prompt('選擇 stack preset？', {
    type: 'select',
    options: [
      ...PRESETS.map((p) => ({ label: `${p.label} — ${p.description}`, value: p.id as string })),
      {
        label: 'custom — 走完整 wizard（15 個 prompt 自由組合，不套用任何 preset 預設）',
        value: 'custom',
      },
    ],
    initial: 'cloudflare-supabase',
  })) as string

  if (typeof presetChoice === 'symbol') process.exit(0)

  if (presetChoice !== 'custom') {
    const preset = getPresetById(presetChoice)
    if (!preset) {
      throw new Error(`未知的 preset id：${presetChoice}`)
    }
    return promptUserPreset(preset, defaultProjectName)
  }

  return promptUserCustom(defaultProjectName)
}

// Short wizard for preset path (8 prompts vs custom's 15):
// preset already decides dbStack / evlogPreset / deploy / monitoring / ci, so we
// only ask for projectName / auth / ui / ssr / extras / state / testing / agentTargets.
async function promptUserPreset(
  preset: PresetDefinition,
  defaultProjectName?: string,
): Promise<UserSelections> {
  // 1. Project name
  const projectName =
    defaultProjectName ||
    ((await consola.prompt('專案名稱：', {
      type: 'text',
      default: 'nuxt-app',
      placeholder: 'nuxt-app',
    })) as string)

  if (typeof projectName === 'symbol') process.exit(0)

  // 2. Auth — preset.authDefault 為 initial 值，使用者可調整
  const authChoice = (await consola.prompt('認證系統？', {
    type: 'select',
    options: authOptionsForDbStack(preset.dbStack),
    initial: preset.authDefault,
  })) as string

  if (typeof authChoice === 'symbol') process.exit(0)
  assertWizardAuthCompatible(authChoice, preset.dbStack)

  // 3. UI
  const uiChoice = (await consola.prompt('UI 框架？', {
    type: 'select',
    options: [
      { label: 'Nuxt UI（推薦）', value: 'ui' },
      { label: '不需要', value: 'none' },
    ],
  })) as string

  if (typeof uiChoice === 'symbol') process.exit(0)

  // 4. Rendering mode
  const renderingChoice = (await consola.prompt('渲染模式？', {
    type: 'select',
    options: [
      { label: 'SPA（ssr: false）— 預設', value: 'spa' },
      { label: 'SSR（ssr: true）— 需要 Node.js 或 Workers 環境', value: 'ssr' },
    ],
  })) as string

  if (typeof renderingChoice === 'symbol') process.exit(0)
  const ssrEnabled = renderingChoice === 'ssr'

  // 5. Extras (multiselect)
  const extrasOptions = [
    { label: '圖表 (nuxt-charts)', value: 'charts' },
    { label: 'SEO（robots / sitemap / schema.org，需要 SSR）', value: 'seo' },
    { label: '安全性 Headers (nuxt-security)', value: 'security' },
    { label: '影像最佳化 (@nuxt/image)', value: 'image' },
    { label: 'VueUse 工具庫', value: 'vueuse' },
  ]
  const defaultExtras = preset.startEmpty ? [] : ['charts', 'security', 'image', 'vueuse']
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
    initial: preset.startEmpty ? 'none' : 'pinia',
  })) as string

  if (typeof stateChoice === 'symbol') process.exit(0)

  // 7. Testing
  const testingChoice = parsePromptChoice(
    await consola.prompt('測試框架？', {
      type: 'select',
      options: [
        { label: 'Vitest + Playwright（推薦）', value: 'full' },
        { label: '僅 Vitest', value: 'vitest-only' },
        { label: '不需要', value: 'none' },
      ],
      initial: preset.startEmpty ? 'none' : 'full',
    }),
    ['full', 'vitest-only', 'none'] as const,
  )

  if (typeof testingChoice === 'symbol') process.exit(0)

  // 8. AI runtimes
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

  // 組裝 features：起手用 preset 套出的 base set，蓋掉 auth / 補 extras / state / testing。
  const selected = applyPreset(preset)

  // auth 覆蓋 preset 預設
  selected.delete('auth-nuxt-utils')
  selected.delete('auth-better-auth')
  if (authChoice === 'auth-nuxt-utils') selected.add('auth-nuxt-utils')
  if (authChoice === 'auth-better-auth') {
    selected.add('auth-better-auth')
    // dependency: better-auth 需要 database（resolveFeatureDependencies 會補上）
  }

  // UI / state / SSR
  if (uiChoice === 'ui') selected.add('ui')
  else selected.delete('ui')

  if (ssrEnabled) selected.add('ssr')
  else selected.delete('ssr')

  if (stateChoice === 'pinia') selected.add('pinia')
  else selected.delete('pinia')

  // Extras：clear group, 加 user 勾選的（保留 ssr 若已加）
  for (const mod of featureModules) {
    if (mod.group === 'extras' && mod.id !== 'ssr') selected.delete(mod.id)
  }
  for (const id of extras) selected.add(id)

  // Testing
  selected.delete('testing-full')
  selected.delete('testing-vitest')
  if (testingChoice === 'full') selected.add('testing-full')
  else if (testingChoice === 'vitest-only') selected.add('testing-vitest')

  // evlog → monitoring 與 cli.ts 對齊
  if (preset.evlogPreset !== 'none') {
    selected.add('monitoring')
  }

  const resolvedWithDependencies = resolveFeatureDependencies([...selected])
  // nuxthub-d1 與 void-d1 都不走 Supabase：前者用 NuxtHub helper，後者用 void/db。
  const resolved = DB_STACKS_WITHOUT_SUPABASE.has(preset.dbStack)
    ? resolvedWithDependencies.filter((id) => id !== 'database')
    : resolvedWithDependencies

  // 自動補的 dependencies 提示
  const autoAdded = resolved.filter((f) => !selected.has(f))
  if (autoAdded.length > 0) {
    const names = autoAdded.map((id) => getModuleById(id)?.name || id)
    consola.info(`自動加入相依功能：${names.join(', ')}`)
  }

  return promptCatalogTail({
    projectName,
    features: resolved,
    ssr: ssrEnabled,
    deploymentTarget: preset.deploy,
    testingLevel: testingChoice,
    agentTargets: resolvedAgentTargets,
    evlogPreset: preset.evlogPreset,
    dbStack: preset.dbStack,
  })
}

// Full 15-prompt wizard — 走 custom 逃生口時使用。完全不受 preset 影響。
async function promptUserCustom(defaultProjectName?: string): Promise<UserSelections> {
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
  const testingChoice = parsePromptChoice(
    await consola.prompt('測試框架？', {
      type: 'select',
      options: [
        { label: 'Vitest + Playwright（推薦）', value: 'full' },
        { label: '僅 Vitest', value: 'vitest-only' },
        { label: '不需要', value: 'none' },
      ],
    }),
    ['full', 'vitest-only', 'none'] as const,
  )

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
  const deployChoice = parsePromptChoice(
    await consola.prompt('部署目標？', {
      type: 'select',
      options: [
        { label: 'Cloudflare Workers（推薦）', value: 'cloudflare' },
        { label: 'void.cloud（VoidZero，建在 Cloudflare 上）', value: 'void' },
        { label: 'Node.js Server', value: 'node' },
      ],
    }),
    ['cloudflare', 'void', 'node'] as const,
  )

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

  // 14. evlog preset
  const evlogPresetChoice = (await consola.prompt('evlog preset？（wide event logging tier）', {
    type: 'select',
    options: [
      {
        label:
          'baseline（推薦）— T1: drain pipeline + 5 件套 enricher + sampling/redaction + client transport',
        value: 'baseline',
      },
      {
        label: 'd-pattern-audit — baseline + O1 D-pattern audit chain (HMAC-signed audit log)',
        value: 'd-pattern-audit',
      },
      {
        label: 'nuxthub-ai — NuxtHub D1 drain + AI agent context (cost tracking + SSE/MCP child)',
        value: 'nuxthub-ai',
      },
      {
        label: 'none — 不套 evlog（純 Nuxt + Supabase starter）',
        value: 'none',
      },
    ],
    initial: 'baseline',
  })) as EvlogPreset

  if (typeof evlogPresetChoice === 'symbol') process.exit(0)

  // 15. DB stack
  let dbStack: DbStack
  if (evlogPresetChoice === 'nuxthub-ai') {
    dbStack = 'nuxthub-d1'
    consola.info('evlog preset nuxthub-ai 已自動選用 NuxtHub D1 database stack。')
  } else {
    dbStack = (await consola.prompt('Database stack？', {
      type: 'select',
      options: dbStackOptionsForAuth(authChoice),
      initial: DEFAULT_DB_STACK,
    })) as DbStack
  }

  if (typeof dbStack === 'symbol') process.exit(0)
  assertWizardAuthCompatible(authChoice, dbStack)

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
  // evlog preset (≠ 'none') 必須帶 monitoring feature wire `evlog/nuxt` module；
  // user 在 step 9 選「不需要 monitoring」但 step 9.5 選非 none preset 時自動補上。
  if (evlogPresetChoice !== 'none' && !features.includes('monitoring')) {
    features.push('monitoring')
  }
  features.push(`deploy-${deployChoice}`)
  if (qualityChoice !== 'none') features.push(qualityChoice)
  if (gitChoice !== 'none') features.push(gitChoice)
  features.push(ciChoice)

  // Resolve dependencies
  const resolvedWithDependencies = resolveFeatureDependencies(features)
  const resolved = DB_STACKS_WITHOUT_SUPABASE.has(dbStack)
    ? resolvedWithDependencies.filter((featureId) => featureId !== 'database')
    : resolvedWithDependencies

  // Check if dependencies were auto-added
  const autoAdded = resolved.filter((f) => !features.includes(f))
  if (autoAdded.length > 0) {
    const names = autoAdded.map((id) => featureModules.find((m) => m.id === id)?.name || id)
    consola.info(`自動加入相依功能：${names.join(', ')}`)
  }

  return promptCatalogTail({
    projectName,
    features: resolved,
    ssr: ssrEnabled,
    deploymentTarget: deployChoice,
    testingLevel: testingChoice,
    agentTargets: resolvedAgentTargets,
    evlogPreset: evlogPresetChoice,
    dbStack,
  })
}

async function promptCatalogSelect(id: string): Promise<string> {
  const q = questionById(id)
  if (!q.options) throw new Error(`catalog ${id} 沒有 options`)
  if (q.hint) consola.info(q.hint)
  const value = (await consola.prompt(q.prompt, {
    type: 'select',
    options: q.options.map((option) => ({ label: option.label, value: option.value })),
  })) as string
  if (typeof value === 'symbol') process.exit(0)
  return value
}

async function promptCatalogText(id: string, placeholder: string): Promise<string> {
  const q = questionById(id)
  if (q.hint) consola.info(q.hint)
  const value = (await consola.prompt(q.prompt, {
    type: 'text',
    placeholder,
  })) as string
  if (typeof value === 'symbol') process.exit(0)
  return value
}

/**
 * CLI 與 AI 共用的問題樹尾巴。preset / custom wizard 問完 stack 之後，
 * 仍要問「資料庫跑在哪」與「要不要登記」——這些不是 preset 能代替的。
 */
async function promptCatalogTail(partial: UserSelections): Promise<UserSelections> {
  let dbHost: DbHost | undefined
  if (usesSupabaseDatabase(partial.dbStack, partial.features)) {
    dbHost = (await promptCatalogSelect('db-host')) as DbHost
  }

  const registerChoice = await promptCatalogSelect('register-fleet')
  if (registerChoice !== 'yes') {
    return { ...partial, dbHost, registerFleet: false }
  }

  let repoId = (await promptCatalogText('repo-id', 'owner/專案名')).trim()
  while (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoId)) {
    consola.error('格式必須是 owner/專案名，例如 acme/my-app')
    repoId = (await promptCatalogText('repo-id', 'owner/專案名')).trim()
  }

  const workflowModel = (await promptCatalogSelect('workflow-model')) as
    | 'trunk-based'
    | 'pr-merge-based'
  const businessActivity = (await promptCatalogSelect('business-activity')) as
    | 'pre-production'
    | 'active'
    | 'maintenance'
    | 'paused'
  const portChoice = await promptCatalogSelect('dev-port')
  let devPort: number | 'auto' = 'auto'
  if (portChoice === 'custom') {
    const raw = (await consola.prompt('請輸入 port（1024–65535）：', {
      type: 'text',
      placeholder: '3090',
    })) as string
    if (typeof raw === 'symbol') process.exit(0)
    const parsed = Number(raw)
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
      consola.error('port 必須是 1024 到 65535 的整數')
      process.exit(1)
    }
    devPort = parsed
  }
  const deployTrack = (await promptCatalogSelect('deploy-track')) as
    | 'wrangler-action'
    | 'void-cloud'
    | 'node-server'
    | 'none'

  return {
    ...partial,
    dbHost,
    registerFleet: true,
    repoId,
    workflowModel,
    businessActivity,
    devPort,
    deployTrack,
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
  consola.log(`   DB stack：${selections.dbStack}`)
  if (selections.dbHost) {
    consola.log(
      `   開發資料庫：${selections.dbHost === 'this-machine' ? '這台電腦' : '已在跑的伺服器'}`,
    )
  }
  consola.log(`   evlog preset：${selections.evlogPreset}`)
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
    evlogPreset: 'baseline',
    dbStack: DEFAULT_DB_STACK,
  }
}

export function parsePromptChoice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value === 'symbol') process.exit(0)
  const choice = choices.find((candidate) => candidate === value)
  if (choice === undefined) throw new Error('Unexpected prompt selection')
  return choice
}
