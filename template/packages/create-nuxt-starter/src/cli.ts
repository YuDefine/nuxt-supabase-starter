#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, resolve } from 'pathe'
import { defineCommand, runMain } from 'citty'
import { consola } from 'consola'
import { assembleProject } from './assemble'
import {
  type TargetDirState,
  classifyTargetDir,
  describeAdoption,
  describeRejection,
} from './target-dir'
import { featureModules, getModuleById, resolveFeatureDependencies } from './features'
import { confirmScaffold, displaySummary, getDefaultSelections, promptUser } from './prompts'
import {
  findCladeRoot,
  postScaffold,
  preflightCladeRegistration,
  type CladeModules,
} from './post-scaffold'
import {
  PRESET_IDS,
  applyPreset,
  getPresetById,
  isPresetId,
  type PresetDefinition,
} from './presets'
import {
  DB_STACKS,
  DB_STACKS_WITHOUT_SUPABASE,
  DEFAULT_DB_STACK,
  EVLOG_PRESETS,
  type AgentRuntime,
  type DbStack,
  type EvlogPreset,
  type UserSelections,
} from './types'

type CliAuth = 'nuxt-auth-utils' | 'better-auth' | 'none'
type CliCi = 'simple' | 'advanced'
const VALID_AGENT_TARGETS = ['claude-code', 'codex', 'cursor'] as const
const VALID_AUTH_VALUES: CliAuth[] = ['nuxt-auth-utils', 'better-auth', 'none']
const VALID_CI_VALUES: CliCi[] = ['simple', 'advanced']
const NUXTHUB_D1_ALLOWED_AUTH: CliAuth[] = ['better-auth', 'none']

function isMonorepoRoot(dir: string): boolean {
  return (
    existsSync(resolve(dir, 'template/packages/create-nuxt-starter')) &&
    existsSync(resolve(dir, 'scripts/create-clean.sh'))
  )
}

// NEVER 拿 process.env.PWD 當判準：`PWD` 由 shell 維護，子程序原封繼承呼叫者 shell 的值，
// spawnSync 的 `cwd` 選項不會改寫它。從 starter repo 內用工具呼叫 dist/cli.js 時，CLI 會
// 誤判「在 starter monorepo 裡」並把專案改建到 repo root，而不是呼叫者指定的目錄（TD-007）。
// 真正的 npm / pnpm 呼叫路徑另有 INIT_CWD，那條保留。
function detectMonorepoRoot(): string | undefined {
  const initCwd = process.env.INIT_CWD?.trim()
  if (initCwd && isMonorepoRoot(initCwd)) {
    return initCwd
  }

  const cwd = process.cwd()
  const normalized = cwd.replaceAll('\\', '/')

  if (normalized.endsWith('/template/packages/create-nuxt-starter')) {
    const root = resolve(cwd, '..', '..', '..')
    if (isMonorepoRoot(root)) return root
  }

  if (isMonorepoRoot(cwd)) {
    return cwd
  }

  return undefined
}

function getInvocationCwd(monorepoRoot: string | undefined): string {
  const initCwd = process.env.INIT_CWD?.trim()

  // Inside the starter monorepo, prefer the user's actual invocation cwd
  // so relative output paths match the docs and shell expectation.
  if (monorepoRoot) {
    if (initCwd && initCwd.length > 0) {
      return initCwd
    }
    return monorepoRoot
  }

  if (initCwd && initCwd.length > 0) {
    return initCwd
  }

  // 同 detectMonorepoRoot：PWD 會是呼叫者 shell 的值，不是本程序的實際 cwd。
  return process.cwd()
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function inferDeploymentTarget(features: string[]): 'cloudflare' | 'void' | 'node' {
  if (features.includes('deploy-void')) return 'void'
  if (features.includes('deploy-node')) return 'node'
  return 'cloudflare'
}

function inferTestingLevel(features: string[]): 'full' | 'vitest-only' | 'none' {
  if (features.includes('testing-full')) return 'full'
  if (features.includes('testing-vitest')) return 'vitest-only'
  return 'none'
}

export function inferCladeModules(features: string[], dbStack: DbStack): CladeModules {
  const hasBetterAuth = features.includes('auth-better-auth')
  const hasNuxtAuthUtils = features.includes('auth-nuxt-utils')

  let auth: CladeModules['auth']
  if (hasBetterAuth) {
    auth = 'better-auth'
  } else if (hasNuxtAuthUtils) {
    auth = 'nuxt-auth-utils'
  } else {
    auth = 'none'
  }

  const deploy = inferDeploymentTarget(features)
  // void.cloud 建在 Cloudflare Workers 上，所以 clade manifest 的 runtime 仍是 cf-workers；
  // 兩者的差別在部署管道（void CLI vs wrangler-action），不在 runtime。
  const runtime: CladeModules['runtime'] = deploy === 'node' ? 'nitro-self-hosted' : 'cf-workers'

  // db-runtime schema only allows cf-workers / supabase-self-hosted.
  // Self-hosted Node deploy implies self-hosted Supabase; otherwise treat
  // DB connection as cf-workers (Supabase Cloud over HTTP, which both the
  // wrangler and void tracks use).
  const dbRuntime: CladeModules['dbRuntime'] =
    runtime === 'nitro-self-hosted' ? 'supabase-self-hosted' : 'cf-workers'
  // void 託管的 D1 底層就是 Cloudflare D1，clade manifest 的 dbSchema 同樣是 cf-d1；
  // 差別在誰 provision（void 平台 vs NuxtHub），不在 schema 種類。
  const dbSchema: CladeModules['dbSchema'] =
    dbStack === 'nuxthub-d1' || dbStack === 'void-d1'
      ? 'cf-d1'
      : dbRuntime === 'supabase-self-hosted'
        ? 'supabase-self-hosted'
        : 'supabase'

  const localHooks = features.includes('database') ? ['post-migration-gen-types.sh'] : []
  return {
    auth,
    dbSchema,
    dbRuntime,
    runtime,
    framework: 'nuxt',
    localHooks,
  }
}

function parseAgentTargets(value: string | undefined): AgentRuntime[] | undefined {
  if (!value) return undefined

  const parsed = parseCsv(value)
  const invalid = parsed.filter((item) => !VALID_AGENT_TARGETS.includes(item as AgentRuntime))

  if (invalid.length > 0) {
    consola.error(`--agents 只接受：${VALID_AGENT_TARGETS.join(' | ')}`)
    consola.error(`無效值：${invalid.join(', ')}`)
    process.exit(1)
  }

  return [...new Set(parsed)] as AgentRuntime[]
}

function failValidation(message: string): never {
  throw new Error(message)
}

function inferAuthFromFeatures(features: string[]): CliAuth {
  if (features.includes('auth-better-auth')) return 'better-auth'
  if (features.includes('auth-nuxt-utils')) return 'nuxt-auth-utils'
  return 'none'
}

function setAuthFeature(selected: Set<string>, auth: CliAuth): void {
  selected.delete('auth-nuxt-utils')
  selected.delete('auth-better-auth')
  if (auth === 'nuxt-auth-utils') selected.add('auth-nuxt-utils')
  if (auth === 'better-auth') selected.add('auth-better-auth')
}

export function validateAuthDbStackCompatibility(auth: CliAuth, dbStack: DbStack): void {
  if (dbStack !== 'nuxthub-d1' || auth !== 'nuxt-auth-utils') return

  failValidation(
    `dbStack nuxthub-d1 只支援 auth=${NUXTHUB_D1_ALLOWED_AUTH.join(
      ' | ',
    )}；不支援 auth=nuxt-auth-utils`,
  )
}

/**
 * void.cloud track MUST NOT 帶 `@nuxthub/core`（`rules/core/cloudflare-workers.md` § 1
 * 矩陣第三列），而 `nuxthub-d1` dbStack 正是靠它。這兩個湊在一起會產出一個
 * 「宣稱走 void、卻拉進 NuxtHub helper」的專案——helper 在這條軌上沒有對應的 runtime
 * injection，只會污染 type space，而且要到實際呼叫 `hub*()` 才會炸。
 */
export function validateDeployDbStackCompatibility(
  features: readonly string[],
  dbStack: DbStack,
): void {
  const deploysToVoid = features.includes('deploy-void')

  if (deploysToVoid && dbStack === 'nuxthub-d1') {
    failValidation(
      'void.cloud 部署不支援 --db nuxthub-d1：void track 不得帶 @nuxthub/core。\n' +
        'void 自己託管 D1，schema 走 `void/db` + `void/schema-d1`（`void init` 會建好），' +
        '不經 NuxtHub。\n請改用 --db void-d1，或改用 --preset cloudflare-nuxthub-ai。',
    )
  }

  // void-d1 + Better Auth：`auth-better-auth` 宣告 `dependencies: ['database']`（Supabase），
  // 但 void-d1 會把 `database` 從 feature 集合裡濾掉（見 buildSelectionsFromArgs 的
  // DB_STACKS_WITHOUT_SUPABASE 過濾）。於是 better-auth 被 scaffold 出來、它要的 DB 卻不在，
  // 而且要到跑起來連 DB 才炸。void 內建的 Better Auth 也接不上——void 官方 auth 文件明載
  // Void-managed auth 尚未支援 meta-framework（Nuxt 就是），細節見 presets.ts 的 void-cloud 註解。
  if (dbStack === 'void-d1' && features.includes('auth-better-auth')) {
    failValidation(
      '--db void-d1 不能搭配 Better Auth：Better Auth 需要一個它自己的資料庫，' +
        '而 void-d1 走的是 void 託管的 D1，starter 的 Supabase feature 會被濾掉，' +
        '產出的專案會缺 DB。\n' +
        'void 內建的 Better Auth 目前也只支援 Void apps，尚未支援 Nuxt 這類 meta-framework。\n' +
        '請改用 --auth nuxt-auth-utils（cookie session、不需要 DB），' +
        '或改用 --db supabase / nuxthub-d1。',
    )
  }

  // 反向也要擋：void 託管的 D1 是 void 平台在 provision 的，換一個部署目標就沒有那個
  // binding，專案會 build 得起來但 runtime 找不到資料庫。
  if (!deploysToVoid && dbStack === 'void-d1') {
    failValidation(
      '--db void-d1 只能搭配 void.cloud 部署：那個 D1 是 void 平台 provision 的，' +
        '換別的部署目標就沒有對應 binding。\n' +
        '請加 --preset void-cloud（或 --with deploy-void），或改用 --db supabase / nuxthub-d1。',
    )
  }
}

function resolveDbStack(evlogPreset: EvlogPreset, dbArg: DbStack | undefined): DbStack {
  if (evlogPreset === 'nuxthub-ai') {
    if (dbArg === 'supabase') {
      failValidation('--evlog-preset nuxthub-ai 會使用 NuxtHub D1，不能同時指定 --db supabase')
    }
    return 'nuxthub-d1'
  }

  return dbArg ?? DEFAULT_DB_STACK
}

export function buildSelectionsFromArgs(args: {
  projectName: string
  auth?: string
  ci?: string
  db?: string
  with?: string
  without?: string
  minimal?: boolean
  preset?: string
  fast?: boolean
  agents?: string
  evlogPreset?: string
}): UserSelections {
  const availableFeatureIds = new Set(featureModules.map((mod) => mod.id))
  const fromWith = parseCsv(args.with)
  const fromWithout = parseCsv(args.without)
  const unknown = [...fromWith, ...fromWithout].filter((id) => !availableFeatureIds.has(id))

  if (unknown.includes('deploy-vercel')) {
    failValidation(
      'feature `deploy-vercel` 已移除（fleet 內零 consumer 使用 Vercel）。' +
        '請改用 `deploy-cloudflare` 或 `deploy-void`。',
    )
  }
  if (unknown.length > 0) {
    failValidation(
      `未知的 feature id：${unknown.join(', ')}\n可用 feature id：\n${featureModules
        .map((mod) => `  - ${mod.id}`)
        .join('\n')}`,
    )
  }

  const authArg = args.auth as CliAuth | undefined
  if (authArg && !VALID_AUTH_VALUES.includes(authArg)) {
    failValidation(`--auth 只接受：${VALID_AUTH_VALUES.join(' | ')}`)
  }

  const ciArg = args.ci as CliCi | undefined
  if (ciArg && !VALID_CI_VALUES.includes(ciArg)) {
    failValidation(`--ci 只接受：${VALID_CI_VALUES.join(' | ')}`)
  }

  const dbArg = args.db as DbStack | undefined
  if (dbArg && !DB_STACKS.includes(dbArg)) {
    failValidation(`--db 只接受：${DB_STACKS.join(' | ')}`)
  }

  const presetArgRaw = args.preset as string | undefined
  if (presetArgRaw === 'default') {
    failValidation(
      `--preset default 已移除。請改用 --preset cloudflare-supabase（功能等價）。\n可用 preset：${PRESET_IDS.join(' | ')}`,
    )
  }
  if (presetArgRaw === 'fast') {
    failValidation(
      `--preset fast 已移除。請改用 --preset cloudflare-supabase --without testing-full,testing-vitest。\n可用 preset：${PRESET_IDS.join(' | ')}`,
    )
  }
  if (presetArgRaw === 'vercel-supabase') {
    failValidation(
      `--preset vercel-supabase 已移除（fleet 內零 consumer 使用 Vercel）。` +
        `請改用 --preset cloudflare-supabase 或 --preset void-cloud。\n` +
        `可用 preset：${PRESET_IDS.join(' | ')}`,
    )
  }
  if (presetArgRaw && !isPresetId(presetArgRaw)) {
    failValidation(`--preset 只接受：${PRESET_IDS.join(' | ')}`)
  }
  if (args.fast === true) {
    failValidation('--fast 已移除。請改用 --without testing-full,testing-vitest 達到等價效果。')
  }
  const preset: PresetDefinition | undefined = presetArgRaw
    ? getPresetById(presetArgRaw)
    : undefined

  const evlogPresetArg = args.evlogPreset as EvlogPreset | undefined
  if (evlogPresetArg && !EVLOG_PRESETS.includes(evlogPresetArg)) {
    failValidation(`--evlog-preset 只接受：${EVLOG_PRESETS.join(' | ')}`)
  }
  const evlogPreset: EvlogPreset = evlogPresetArg ?? preset?.evlogPreset ?? 'baseline'
  const dbStack = resolveDbStack(evlogPreset, dbArg ?? preset?.dbStack)

  const agentTargets =
    parseAgentTargets(args.agents) ?? getDefaultSelections(args.projectName).agentTargets

  // Base feature set:
  // - --minimal flag (legacy): empty set
  // - --preset <id>: preset's feature set via applyPreset (handles startEmpty)
  // - neither: default features from featureModules
  let selected: Set<string>
  if (args.minimal) {
    selected = new Set()
  } else if (preset) {
    selected = applyPreset(preset)
  } else {
    selected = new Set(getDefaultSelections(args.projectName).features)
  }

  const addFeature = (featureId: string) => {
    const mod = getModuleById(featureId)
    if (!mod) return

    if (mod.incompatible) {
      for (const id of mod.incompatible) {
        selected.delete(id)
      }
    }

    selected.add(featureId)
  }

  // evlog preset (≠ 'none') 必須帶 monitoring feature wire `evlog/nuxt` module
  // 與 `evlog: { ... }` nuxt.config 區塊；single source of truth 仍是 monitoring feature。
  if (evlogPreset !== 'none') {
    addFeature('monitoring')
  }

  if (authArg) {
    selected.delete('auth-nuxt-utils')
    selected.delete('auth-better-auth')
    if (authArg === 'nuxt-auth-utils') addFeature('auth-nuxt-utils')
    if (authArg === 'better-auth') addFeature('auth-better-auth')
  } else if (dbStack === 'nuxthub-d1') {
    setAuthFeature(selected, 'better-auth')
  }

  if (ciArg) {
    selected.delete('ci-simple')
    selected.delete('ci-advanced')
    if (ciArg === 'simple') addFeature('ci-simple')
    if (ciArg === 'advanced') addFeature('ci-advanced')
  }

  for (const featureId of fromWith) {
    addFeature(featureId)
  }

  for (const featureId of fromWithout) {
    selected.delete(featureId)
  }

  const resolvedFeatures = resolveFeatureDependencies([...selected])
  const features = DB_STACKS_WITHOUT_SUPABASE.has(dbStack)
    ? resolvedFeatures.filter((featureId) => featureId !== 'database')
    : resolvedFeatures
  validateAuthDbStackCompatibility(inferAuthFromFeatures(features), dbStack)
  validateDeployDbStackCompatibility([...features], dbStack)

  return {
    projectName: args.projectName,
    features,
    ssr: features.includes('ssr'),
    deploymentTarget: inferDeploymentTarget(features),
    testingLevel: inferTestingLevel(features),
    agentTargets,
    evlogPreset,
    dbStack,
  }
}

const main = defineCommand({
  meta: {
    name: 'create-nuxt-starter',
    version: '0.1.0',
    description: 'Interactive CLI to scaffold a Nuxt + Supabase project',
  },
  args: {
    dir: {
      type: 'positional',
      description: 'Project directory name',
      required: false,
    },
    yes: {
      type: 'boolean',
      alias: 'y',
      description: 'Use default selections (non-interactive)',
      default: false,
    },
    auth: {
      type: 'string',
      description: 'Auth provider: nuxt-auth-utils | better-auth | none',
      required: false,
    },
    ci: {
      type: 'string',
      description: 'CI mode: simple | advanced (default: simple)',
      required: false,
    },
    preset: {
      type: 'string',
      description: `Stack preset: ${PRESET_IDS.join(' | ')}`,
      required: false,
    },
    fast: {
      type: 'boolean',
      description: '[deprecated, removed] 改用 --without testing-full,testing-vitest',
      default: false,
    },
    agents: {
      type: 'string',
      description: 'Comma-separated AI runtimes: claude-code,codex,cursor',
      required: false,
    },
    with: {
      type: 'string',
      description: 'Comma-separated feature ids to add (e.g. charts,monitoring)',
      required: false,
    },
    without: {
      type: 'string',
      description: 'Comma-separated feature ids to remove',
      required: false,
    },
    minimal: {
      type: 'boolean',
      description: 'Start from empty feature set instead of defaults',
      default: false,
    },
    'register-consumer': {
      type: 'boolean',
      description:
        '透過 Clade registry 登記 consumer（需搭配 --repo-id 與 --dev-port；--no-register-consumer 可關閉）',
      default: true,
    },
    'repo-id': {
      type: 'string',
      description: 'Clade fleet repository identity: owner/repo',
      required: false,
    },
    'workflow-model': {
      type: 'string',
      description: 'Clade workflow model: trunk-based | pr-merge-based (default: trunk-based)',
      required: false,
    },
    'business-activity': {
      type: 'string',
      description: 'Clade signal activity: pre-production | active | maintenance | paused | auto',
      required: false,
    },
    'dev-port': {
      type: 'string',
      description: 'Centrally allocated Nuxt development port',
      required: false,
    },
    'wire-pre-commit': {
      type: 'boolean',
      description:
        'wire pre-commit hook 跑 hub:check 擋掉 clade-managed 檔的本地誤改（--no-wire-pre-commit 跳過）',
      default: true,
    },
    'clone-clade': {
      type: 'boolean',
      description:
        '找不到 clade 中央倉時，嘗試 git clone 到 ~/offline/clade（--no-clone-clade 跳過）',
      default: true,
    },
    install: {
      type: 'boolean',
      description: 'scaffold 後執行 pnpm install（--no-install 跳過，CI / e2e 測試用）',
      default: true,
    },
    'evlog-preset': {
      type: 'string',
      description:
        'evlog preset: none | baseline | d-pattern-audit | nuxthub-ai (default: baseline)',
      required: false,
    },
    db: {
      type: 'string',
      description: 'Database stack: supabase | nuxthub-d1 (default: supabase)',
      required: false,
    },
  },
  async run({ args }) {
    const monorepoRoot = detectMonorepoRoot()
    const invocationCwd = getInvocationCwd(monorepoRoot)
    const projectName = args.dir as string | undefined
    const repoId = args['repo-id'] as string | undefined
    const workflowModel = (args['workflow-model'] as string | undefined) ?? 'trunk-based'
    const businessActivity = (args['business-activity'] as string | undefined) ?? 'pre-production'
    const devPortRaw = args['dev-port'] as string | undefined
    // `auto` 由 Clade 依 fleet 慣例配號，本地不解析成數字。
    const devPortAuto = devPortRaw === 'auto'
    const devPort = devPortRaw === undefined || devPortAuto ? undefined : Number(devPortRaw)
    if (repoId && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoId)) {
      consola.error('--repo-id 格式必須是 owner/repo')
      process.exit(1)
    }
    if (!['trunk-based', 'pr-merge-based'].includes(workflowModel)) {
      consola.error('--workflow-model 必須是 trunk-based 或 pr-merge-based')
      process.exit(1)
    }
    if (!['pre-production', 'active', 'maintenance', 'paused', 'auto'].includes(businessActivity)) {
      consola.error('--business-activity 值不合法')
      process.exit(1)
    }
    if (
      devPort !== undefined &&
      (!Number.isInteger(devPort) || devPort < 1024 || devPort > 65535)
    ) {
      consola.error('--dev-port 必須是 1024 到 65535 的整數，或 auto')
      process.exit(1)
    }
    const hasCustomFlags = Boolean(
      args.auth ||
      args.ci ||
      args.with ||
      args.without ||
      args.minimal ||
      args.preset ||
      args.fast ||
      args.agents ||
      args.db ||
      args['evlog-preset'],
    )

    // Validate directory.
    //
    // 「已開好 git repo + 寫好產品 README，還沒有 code」是最常見的起手式之一，
    // 舊行為把它跟「目錄裡已經有一個專案」混為一談，兩者都吐同一句
    // 「已存在且不為空」就 exit 1，使用者沒有任何下一步可循。
    // 現在分成三態：可就地展開 → 說明處置後照走；真的被佔用 → 拒絕但給出路。
    let adoptState: TargetDirState | undefined
    if (projectName) {
      const targetDir = resolve(invocationCwd, projectName)
      adoptState = classifyTargetDir(targetDir)
      if (adoptState.kind === 'occupied') {
        const [headline, ...rest] = describeRejection(projectName, adoptState)
        consola.error(headline)
        for (const line of rest) consola.log(line)
        process.exit(1)
      }
    }

    let selections

    if (args.yes || hasCustomFlags) {
      // Non-interactive mode with defaults/custom flags
      const name = projectName || 'nuxt-app'
      try {
        selections = buildSelectionsFromArgs({
          projectName: name,
          auth: args.auth as string | undefined,
          ci: args.ci as string | undefined,
          db: args.db as string | undefined,
          with: args.with as string | undefined,
          without: args.without as string | undefined,
          minimal: args.minimal as boolean | undefined,
          preset: args.preset as string | undefined,
          fast: args.fast as boolean | undefined,
          agents: args.agents as string | undefined,
          evlogPreset: args['evlog-preset'] as string | undefined,
        })
      } catch (error) {
        consola.error((error as Error).message)
        process.exit(1)
      }

      const displayName = basename(resolve(invocationCwd, name))
      if (hasCustomFlags) {
        consola.info(`使用自訂參數配置建立專案：${displayName}`)
      } else {
        consola.info(`使用預設配置建立專案：${displayName}`)
      }
    } else {
      // Interactive mode
      selections = await promptUser(projectName)
    }

    // Resolve target directory and use basename as project name for package.json.
    // 互動模式的專案名是在 promptUser 才定案的，所以最終判定要以它為準重跑一次
    // ——不能沿用開頭那次 fail-fast 的結果。
    const targetDir = resolve(invocationCwd, selections.projectName)
    const pkgName = basename(targetDir)

    adoptState = classifyTargetDir(targetDir)
    if (adoptState.kind === 'occupied') {
      const [headline, ...rest] = describeRejection(pkgName, adoptState)
      consola.error(headline)
      for (const line of rest) consola.log(line)
      process.exit(1)
    }

    // Display summary and confirm
    displaySummary(selections)

    if (adoptState.kind === 'adoptable') {
      // 顯示解析後的目錄名，不是使用者打的字面值 —— 既有 repo 的正確咒語是
      // 專案名填 `.`，而「偵測到既有 repo「.」」讀起來像是 CLI 搞錯了。
      consola.info(`偵測到既有 repo「${pkgName}」，將就地展開 starter。`)
      for (const line of describeAdoption(adoptState)) {
        consola.log(`  ${line}`)
      }
    }

    if (!args.yes) {
      const confirmed = await confirmScaffold()
      if (!confirmed) {
        consola.info('已取消。')
        process.exit(0)
      }
    }

    // 給了 --repo-id 就是要求登記進 Clade fleet —— 那些約束（fleet base、
    // consumer_id / repo_id 衝突、dev port 撞號）在寫第一個檔之前就問得出來。
    // 不先問的話要等 scaffold + pnpm install 全部跑完才在最後一步 warn，
    // 而專案已經建在錯的位置上了。
    // --no-register-consumer 明示不登記，這時預檢沒有東西要保護。
    if (repoId && args['register-consumer'] !== false) {
      const cladeRoot = findCladeRoot()
      if (cladeRoot) {
        const preflight = preflightCladeRegistration(cladeRoot, targetDir, {
          repoId,
          workflowModel: workflowModel as 'trunk-based' | 'pr-merge-based',
          businessActivity: businessActivity as 'pre-production',
          devPort: devPortAuto ? 'auto' : devPort,
        })
        if (preflight.status === 'rejected') {
          consola.error('Clade fleet 登記預檢未過，未建立任何檔案：')
          consola.log(`  ${preflight.reason}`)
          consola.log('  修正後重跑，或拿掉 --repo-id 先建立不登記的專案。')
          process.exit(1)
        }
        if (preflight.status === 'skipped') {
          consola.warn(`略過 Clade 登記預檢：${preflight.reason}`)
        }
      }
    }

    consola.start(`正在建立專案 ${pkgName}...`)

    try {
      assembleProject(
        targetDir,
        selections.features,
        pkgName,
        selections.agentTargets,
        selections.evlogPreset,
        selections.dbStack,
        { mergeExistingGitignore: adoptState?.kind === 'adoptable' },
      )
      consola.success('專案檔案建立完成！')
    } catch (error) {
      consola.error('建立專案失敗：', error)
      process.exit(1)
    }

    // Post-scaffold
    await postScaffold(
      targetDir,
      pkgName,
      invocationCwd,
      inferCladeModules(selections.features, selections.dbStack),
      {
        yes: args.yes as boolean,
        registerConsumer: args['register-consumer'] as boolean,
        wirePreCommit: args['wire-pre-commit'] as boolean,
        cloneClade: args['clone-clade'] as boolean,
        installDeps: args.install as boolean,
        existingGitRepo: adoptState?.hasGitRepo === true,
        deployTarget: selections.deploymentTarget,
        dbStack: selections.dbStack,
        repoId,
        workflowModel: workflowModel as 'trunk-based' | 'pr-merge-based',
        businessActivity: businessActivity as
          | 'pre-production'
          | 'active'
          | 'maintenance'
          | 'paused'
          | 'auto',
        devPort: devPortAuto ? 'auto' : devPort,
      },
    )
  },
})

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMain(main)
}
