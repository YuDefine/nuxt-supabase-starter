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
  adoptExistingProject,
  findCladeRoot,
  postScaffold,
  preflightCladeRegistration,
  type CladeModules,
  type PostScaffoldOutcome,
} from './post-scaffold'
import {
  IntakeError,
  loadAnswersFile,
  mergeAnswersIntoFlags,
  type CatalogArgValues,
} from './answers-file'
import {
  PRESET_IDS,
  applyPreset,
  getPresetById,
  isPresetId,
  type PresetDefinition,
} from './presets'
import {
  DB_HOSTS,
  DB_STACKS,
  DB_STACKS_WITHOUT_SUPABASE,
  DEFAULT_DB_STACK,
  EVLOG_PRESETS,
  type AgentRuntime,
  type DbHost,
  type DbStack,
  type EvlogPreset,
  UPDATE_POLICIES,
  type UpdatePolicy,
  type UserSelections,
} from './types'
import {
  flagsPresent,
  formatMissingYesFlags,
  missingYesFlags,
  questionById,
  REPO_ID_PATTERN,
  usesSupabaseDatabase,
} from './question-catalog'

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
    failValidation(
      `--agents 只接受：${VALID_AGENT_TARGETS.join(' | ')}\n無效值：${invalid.join(', ')}`,
    )
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

/**
 * 旗標與 `--answers-file` 共用同一份攤平題值 —— CLI flag 是 `<catalog-flag> <value>`，
 * answers 是 `{ <catalog-id>: <value> }`，兩者進這裡時已經同形，走完全相同的
 * normalizer（契約 § 共用建立 intake：「兩者走相同 normalizer」）。
 */
export interface CatalogFlagArgs {
  /** --db-host 或 answers-file 的 db-host 值 */
  dbHost?: string
  nonInteractive: boolean
  /** register-fleet 解析結果；true = managed 流程 */
  register?: boolean
  repoId?: string
  workflowModel?: string
  businessActivity?: string
  /** 'auto' 或 1024-65535 的 port 字串（互動流程的 'custom' 不存在於機讀答案） */
  devPort?: string
  deployTrack?: string
  updatePolicy?: string
}

const WORKFLOW_MODEL_VALUES = ['trunk-based', 'pr-merge-based'] as const
const BUSINESS_ACTIVITY_VALUES = [
  'pre-production',
  'active',
  'maintenance',
  'paused',
  'auto',
] as const
const DEPLOY_TRACK_VALUES = ['wrangler-action', 'void-cloud', 'node-server', 'none'] as const

export function applyCatalogFlags(
  selections: UserSelections,
  args: CatalogFlagArgs,
): UserSelections {
  const next = { ...selections }
  const supabase = usesSupabaseDatabase(next.dbStack, next.features)

  if (args.dbHost && !supabase) {
    failValidation('--db-host 只在這個專案會用到 Supabase 時才有意義')
  }

  if (supabase) {
    if (args.dbHost && DB_HOSTS.includes(args.dbHost as DbHost)) {
      next.dbHost = args.dbHost as DbHost
    } else if (args.nonInteractive && !next.dbHost) {
      const q = questionById('db-host')
      failValidation(
        `--yes / 旗標模式不能略過「${q.prompt}」。\n` +
          `請加 --db-host this-machine（這台電腦 Docker）或 --db-host existing-server（連到已在跑的伺服器）。`,
      )
    }
  }

  // register-only 題：先驗值（壞值要報值，不報 coherence），再驗「沒登記卻帶
  // register 答案」的矛盾。兩者都在寫第一個檔之前完成。
  if (args.repoId !== undefined && !REPO_ID_PATTERN.test(args.repoId)) {
    failValidation('--repo-id 格式必須是 owner/repo')
  }
  if (
    args.workflowModel !== undefined &&
    !WORKFLOW_MODEL_VALUES.includes(args.workflowModel as 'trunk-based')
  ) {
    failValidation('--workflow-model 必須是 trunk-based 或 pr-merge-based')
  }
  if (
    args.businessActivity !== undefined &&
    !BUSINESS_ACTIVITY_VALUES.includes(args.businessActivity as 'pre-production')
  ) {
    failValidation('--business-activity 值不合法')
  }
  if (args.devPort !== undefined) {
    const parsed = Number(args.devPort)
    if (args.devPort !== 'auto' && (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535)) {
      failValidation('--dev-port 必須是 1024 到 65535 的整數，或 auto')
    }
  }
  if (args.deployTrack !== undefined && !DEPLOY_TRACK_VALUES.includes(args.deployTrack as 'none')) {
    failValidation('--deploy-track 必須是 wrangler-action | void-cloud | node-server | none')
  }
  if (
    args.updatePolicy !== undefined &&
    !UPDATE_POLICIES.includes(args.updatePolicy as UpdatePolicy)
  ) {
    throw new IntakeError('POLICY_INVALID', `--update-policy 只接受 ${UPDATE_POLICIES.join(' | ')}`)
  }

  if (args.register !== undefined) {
    next.registerFleet = args.register
  }
  if (args.register !== true) {
    const contradictions = [
      ['--repo-id', args.repoId],
      ['--workflow-model', args.workflowModel],
      ['--business-activity', args.businessActivity],
      ['--dev-port', args.devPort],
      ['--deploy-track', args.deployTrack],
      ['--update-policy', args.updatePolicy],
    ]
      .filter(([, value]) => value !== undefined)
      .map(([flag]) => flag)
    if (contradictions.length > 0) {
      throw new IntakeError(
        'INTAKE_CONFLICT',
        `${contradictions.join('、')} 是登記 fleet（register-fleet=yes）才需要的答案，` +
          '與 register-fleet=no／--no-register-consumer 衝突',
      )
    }
    return next
  }

  if (args.repoId !== undefined) next.repoId = args.repoId
  if (args.workflowModel !== undefined) {
    next.workflowModel = args.workflowModel as UserSelections['workflowModel']
  }
  if (args.businessActivity !== undefined) {
    next.businessActivity = args.businessActivity as UserSelections['businessActivity']
  }
  if (args.devPort !== undefined) {
    next.devPort = args.devPort === 'auto' ? 'auto' : Number(args.devPort)
  }
  if (args.deployTrack !== undefined) {
    next.deployTrack = args.deployTrack as UserSelections['deployTrack']
  }
  // update-policy 的 default 由 catalog 宣告（pinned）—— normalizer 在這裡套用，
  // 契約禁止呼叫端或測試代填預設值。
  next.updatePolicy = (args.updatePolicy ?? questionById('update-policy').defaultValue) as
    | UpdatePolicy
    | undefined
  return next
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

interface CompletionReport {
  status: 'ready' | 'scaffolded' | 'failed' | 'cancelled'
  registration?: 'completed' | 'unregistered' | 'failed'
  consumerId?: string
  effectivePolicy?: unknown
  release?: unknown
  workRoute?: string
  target: string
  diagnostics: Array<{ code: string; message: string }>
}

/**
 * `--json` 完成報告（契約 § 機讀完成報告）：
 * - managed 成功且 bootstrap 回報了可驗證身分 → ready / completed + identity 欄位
 * - bootstrap 跑過但沒給 consumerId/effectivePolicy/release → 不宣稱 ready
 *   （降回 scaffolded + completed + BOOTSTRAP_RESULT_UNVERIFIED）
 * - scaffold-only → scaffolded / unregistered，NEVER 捏造 managed policy／release
 * - bootstrap 實際失敗 → failed，保留具名 diagnostics
 */
function buildCompletionReport(
  targetDir: string,
  registerConsumer: boolean,
  outcome: PostScaffoldOutcome,
): CompletionReport {
  const target = targetDir
  if (!registerConsumer) {
    return { status: 'scaffolded', registration: 'unregistered', target, diagnostics: [] }
  }
  const managed = outcome.managed
  if (!managed?.ran) {
    return {
      status: 'scaffolded',
      registration: 'unregistered',
      target,
      diagnostics: managed?.diagnostics ?? [
        {
          code: 'ASSET_UNAVAILABLE',
          message: 'managed 流程被要求，但 clade 來源不可用，bootstrap 未執行',
        },
      ],
    }
  }
  if (!managed.ok) {
    return { status: 'failed', registration: 'failed', target, diagnostics: managed.diagnostics }
  }
  const bootstrapReport = managed.report
  const hasVerifiableIdentity =
    typeof bootstrapReport?.consumerId === 'string' &&
    bootstrapReport.effectivePolicy !== undefined &&
    bootstrapReport.release !== undefined
  if (!hasVerifiableIdentity) {
    return {
      status: 'scaffolded',
      registration: 'completed',
      target,
      diagnostics: [
        {
          code: 'BOOTSTRAP_RESULT_UNVERIFIED',
          message:
            'managed bootstrap 回報成功但未提供可驗證的 consumerId/effectivePolicy/release；' +
            '不宣稱 ready。registry/manifest 以真產物為準。',
        },
      ],
    }
  }
  return {
    status: 'ready',
    registration: 'completed',
    consumerId: bootstrapReport.consumerId as string,
    effectivePolicy: bootstrapReport.effectivePolicy,
    release: bootstrapReport.release,
    workRoute:
      typeof bootstrapReport.workRoute === 'string' ? bootstrapReport.workRoute : undefined,
    target,
    diagnostics: [],
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
      description:
        'Skip TTY prompts. Applicable catalog answers must already be flags (e.g. --db-host).',
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
    'deploy-track': {
      type: 'string',
      description:
        'Clade deploy-track: wrangler-action | void-cloud | node-server | none（self-hosted 無公網 HTTPS prod DB 時必須 none）',
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
      description: 'Database stack: supabase | nuxthub-d1 | void-d1 (default: supabase)',
      required: false,
    },
    'db-host': {
      type: 'string',
      description:
        'Where the Supabase database runs in development: this-machine | existing-server（Supabase 軌必填；--yes 不可省略）',
      required: false,
    },
    'update-policy': {
      type: 'string',
      description:
        'Clade consumer 更新政策：pinned | subscribed（register-fleet=yes 才適用；未給由 catalog default 得 pinned）',
      required: false,
    },
    'answers-file': {
      type: 'string',
      description:
        'AI intake 的機讀答案檔：{ schemaVersion: 1, answers: { <catalog-id>: <value> } }；給了自動進非互動模式',
      required: false,
    },
    json: {
      type: 'boolean',
      description: '機讀完成報告：stdout 只輸出一個 JSON object，進度／診斷一律走 stderr',
      default: false,
    },
    release: {
      type: 'string',
      description: 'managed bootstrap 要安裝的 clade release（semver，例如 1.13.16）',
      required: false,
    },
    'release-store': {
      type: 'string',
      description: '已驗證 release 的儲存根目錄（managed 流程的執行控制旗標）',
      required: false,
    },
    'registry-path': {
      type: 'string',
      description:
        '明確指定 registry 檔（managed 流程用）；給定後所有讀寫與子程序使用同一個 registry',
      required: false,
    },
    push: {
      type: 'boolean',
      description:
        'managed bootstrap 允許 push／外部設定變更（--no-push 關閉，仍做本機同步與驗證）',
      default: true,
    },
    offline: {
      type: 'boolean',
      description: '禁止外部查詢與下載；必要的本機輸入缺失時明確失敗',
      default: false,
    },
  },
  async run({ args }) {
    // --json：stdout 只留下最後一個 JSON object，所有進度／診斷一律走 stderr。
    // 在 fd 層攔截 stdout.write —— consola、遺漏的裸寫、以及子行程轉發
    // 都會落進 stderr，不靠每個呼叫點記得「現在是 json 模式」。
    const jsonMode = args.json === true
    let emitJson: ((report: unknown) => void) | undefined
    if (jsonMode) {
      const realStdoutWrite = process.stdout.write.bind(process.stdout)
      process.stdout.write = process.stderr.write.bind(
        process.stderr,
      ) as typeof process.stdout.write
      emitJson = (report) => realStdoutWrite(`${JSON.stringify(report, null, 2)}\n`)
    }
    // 失敗共用形狀：具名 diagnostic code + 人讀訊息。這裡的呼叫點全在
    // 「寫第一個檔之前」，registration 只能是 unregistered。
    const failRun = (code: string, message: string): never => {
      consola.error(message)
      emitJson?.({
        status: 'failed',
        registration: 'unregistered',
        diagnostics: [{ code, message }],
      })
      process.exit(1)
    }
    const intakeCode = (error: unknown): string =>
      error instanceof IntakeError ? error.code : 'INTAKE_INVALID'

    const monorepoRoot = detectMonorepoRoot()
    const invocationCwd = getInvocationCwd(monorepoRoot)
    const projectName = args.dir as string | undefined
    const workflowModelArg = (args['workflow-model'] as string | undefined) ?? 'trunk-based'
    const businessActivityArg =
      (args['business-activity'] as string | undefined) ?? 'pre-production'
    const devPortRaw = args['dev-port'] as string | undefined
    // `auto` 由 Clade 依 fleet 慣例配號，本地不解析成數字。
    const devPortAutoArg = devPortRaw === 'auto'
    const devPortArg = devPortRaw === undefined || devPortAutoArg ? undefined : Number(devPortRaw)
    const deployTrackRaw = args['deploy-track'] as string | undefined
    const deployTracks = new Set(['wrangler-action', 'void-cloud', 'node-server', 'none'])
    if (deployTrackRaw && !deployTracks.has(deployTrackRaw)) {
      failRun(
        'INTAKE_INVALID',
        '--deploy-track 必須是 wrangler-action | void-cloud | node-server | none',
      )
    }
    const dbHostArg = args['db-host'] as string | undefined
    if (dbHostArg && !DB_HOSTS.includes(dbHostArg as DbHost)) {
      failRun('INTAKE_INVALID', '--db-host 必須是 this-machine 或 existing-server')
    }
    const deployTrackArg = deployTrackRaw as
      | 'wrangler-action'
      | 'void-cloud'
      | 'node-server'
      | 'none'
      | undefined
    const repoIdArg = args['repo-id'] as string | undefined
    if (repoIdArg && !REPO_ID_PATTERN.test(repoIdArg)) {
      failRun('INTAKE_INVALID', '--repo-id 格式必須是 owner/repo')
    }
    if (!['trunk-based', 'pr-merge-based'].includes(workflowModelArg)) {
      failRun('INTAKE_INVALID', '--workflow-model 必須是 trunk-based 或 pr-merge-based')
    }
    if (
      !['pre-production', 'active', 'maintenance', 'paused', 'auto'].includes(businessActivityArg)
    ) {
      failRun('INTAKE_INVALID', '--business-activity 值不合法')
    }
    if (
      devPortArg !== undefined &&
      (!Number.isInteger(devPortArg) || devPortArg < 1024 || devPortArg > 65535)
    ) {
      failRun('INTAKE_INVALID', '--dev-port 必須是 1024 到 65535 的整數，或 auto')
    }
    const updatePolicyArg = args['update-policy'] as string | undefined
    if (
      updatePolicyArg !== undefined &&
      !UPDATE_POLICIES.includes(updatePolicyArg as UpdatePolicy)
    ) {
      failRun('POLICY_INVALID', `--update-policy 只接受 ${UPDATE_POLICIES.join(' | ')}`)
    }
    const releaseArg = args['release'] as string | undefined
    if (releaseArg !== undefined && !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/.test(releaseArg)) {
      failRun('INTAKE_INVALID', '--release 必須是 semver（例如 1.13.16）')
    }
    const releaseStoreArg = args['release-store'] as string | undefined
    const registryPathArg = args['registry-path'] as string | undefined
    const offline = args.offline === true
    const noPush = args.push === false
    const answersFileArg = args['answers-file'] as string | undefined
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

    // --answers-file：AI intake 的機讀入口。與旗標走同一 normalizer；
    // 未知 id／壞 JSON／schemaVersion 不符／與顯式旗標衝突，都在寫第一個檔之前拒絕。
    const present = flagsPresent(process.argv)
    let answers: Record<string, string> | undefined
    if (answersFileArg !== undefined) {
      try {
        answers = loadAnswersFile(resolve(invocationCwd, answersFileArg))
      } catch (error) {
        return failRun(intakeCode(error), (error as Error).message)
      }
    }
    let catalogArgs: CatalogArgValues
    try {
      catalogArgs = mergeAnswersIntoFlags(
        answers,
        {
          dbHost: dbHostArg,
          registerConsumer: (args['register-consumer'] as boolean) !== false,
          repoId: repoIdArg,
          workflowModel: args['workflow-model'] as string | undefined,
          businessActivity: args['business-activity'] as string | undefined,
          devPort: devPortRaw,
          deployTrack: deployTrackRaw,
          updatePolicy: updatePolicyArg,
        },
        present,
      )
    } catch (error) {
      return failRun(intakeCode(error), (error as Error).message)
    }
    // answers 已答的題視同旗標已給 —— missingYesFlags 不得再對它們要旗標。
    if (answers) {
      for (const id of Object.keys(answers)) {
        present.add(questionById(id).flag)
      }
    }
    const answersDriven = answers !== undefined

    // Validate directory.
    //
    // 「已開好 git repo + 寫好產品 README，還沒有 code」是最常見的起手式之一，
    // 舊行為把它跟「目錄裡已經有一個專案」混為一談，兩者都吐同一句
    // 「已存在且不為空」就 exit 1，使用者沒有任何下一步可循。
    // 現在分成三態：可就地展開 → 說明處置後照走；真的被佔用 → 拒絕但給出路。
    // 採用既有業務專案：目標是已有內容的 git repo，且使用者「明確」給了
    // --register-consumer（預設值不算）——只交付 managed bootstrap，不 scaffold。
    // 沒有明確旗標的 occupied 目錄仍照舊拒絕，避免誤把既有專案登記進 fleet。
    const explicitRegister = present.has('--register-consumer')
    const isManagedAdopt = (state: TargetDirState): boolean =>
      state.kind === 'occupied' && state.hasGitRepo && explicitRegister
    let adoptState: TargetDirState | undefined
    if (projectName) {
      const targetDir = resolve(invocationCwd, projectName)
      adoptState = classifyTargetDir(targetDir)
      if (adoptState.kind === 'occupied' && !isManagedAdopt(adoptState)) {
        const [headline, ...rest] = describeRejection(projectName, adoptState)
        failRun('TARGET_OCCUPIED', [headline, ...rest].join('\n'))
      }
    }

    let selections: UserSelections

    // --answers-file 自動進非互動模式（與 --yes／自訂旗標同一路徑）。
    if (args.yes || hasCustomFlags || answersDriven) {
      // Non-interactive mode with defaults/custom flags
      const name = projectName || 'nuxt-app'
      try {
        selections = applyCatalogFlags(
          buildSelectionsFromArgs({
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
          }),
          {
            dbHost: catalogArgs.dbHost,
            nonInteractive: true,
            register: catalogArgs.register !== false,
            repoId: catalogArgs.repoId,
            workflowModel: catalogArgs.workflowModel,
            businessActivity: catalogArgs.businessActivity,
            devPort: catalogArgs.devPort,
            deployTrack: catalogArgs.deployTrack,
            updatePolicy: catalogArgs.updatePolicy,
          },
        )
        const missing = missingYesFlags({
          hasSupabase: usesSupabaseDatabase(selections.dbStack, selections.features),
          register: catalogArgs.register !== false,
          present,
        })
        if (missing.length > 0) failValidation(formatMissingYesFlags(missing))
      } catch (error) {
        return failRun(intakeCode(error), (error as Error).message)
      }

      const displayName = basename(resolve(invocationCwd, name))
      if (hasCustomFlags || answersDriven) {
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
    const managedAdopt = isManagedAdopt(adoptState)
    if (adoptState.kind === 'occupied' && !managedAdopt) {
      const [headline, ...rest] = describeRejection(pkgName, adoptState)
      failRun('TARGET_OCCUPIED', [headline, ...rest].join('\n'))
    }

    // Display summary and confirm
    displaySummary(selections)

    const cladeModules = inferCladeModules(selections.features, selections.dbStack)

    if (adoptState.kind === 'adoptable') {
      // 顯示解析後的目錄名，不是使用者打的字面值 —— 既有 repo 的正確咒語是
      // 專案名填 `.`，而「偵測到既有 repo「.」」讀起來像是 CLI 搞錯了。
      consola.info(`偵測到既有 repo「${pkgName}」，將就地展開 starter。`)
      for (const line of describeAdoption(adoptState)) {
        consola.log(`  ${line}`)
      }
    }

    // answers-file 自動進非互動：confirm 與下游的互動確認都照 --yes 同等處理。
    const effectiveYes = (args.yes as boolean) || answersDriven
    if (!effectiveYes) {
      const confirmed = await confirmScaffold()
      if (!confirmed) {
        consola.info('已取消。')
        emitJson?.({ status: 'cancelled', registration: 'unregistered', diagnostics: [] })
        process.exit(0)
      }
    }

    const repoId = selections.repoId ?? repoIdArg
    const workflowModel = selections.workflowModel ?? workflowModelArg
    const businessActivity = selections.businessActivity ?? businessActivityArg
    const deployTrack = selections.deployTrack ?? deployTrackArg
    const resolvedDevPort = selections.devPort ?? (devPortAutoArg ? 'auto' : devPortArg)
    const registerConsumer =
      selections.registerFleet === false ? false : catalogArgs.register !== false
    // 政策只存在於 managed 流程；default 一律讀 catalog 宣告，不在這裡寫死。
    const updatePolicy = registerConsumer
      ? ((selections.updatePolicy ??
          updatePolicyArg ??
          questionById('update-policy').defaultValue) as UpdatePolicy | undefined)
      : undefined

    // managed 資料來源旗標（release／store／registry）只服務 register 流程；
    // register-fleet=no 帶它們是矛盾答案，與 answers/flag 衝突同等處理：寫第一個
    // 檔之前拒絕。--no-push／--offline 是限制型執行控制，scaffold-only 本來就不
    // push、不下載，帶著它們不矛盾（契約：scaffold-only 執行控制只留 no-push/offline）。
    if (!registerConsumer) {
      const managedOnly = [
        releaseArg !== undefined ? '--release' : undefined,
        releaseStoreArg !== undefined ? '--release-store' : undefined,
        registryPathArg !== undefined ? '--registry-path' : undefined,
      ].filter((flag): flag is string => flag !== undefined)
      if (managedOnly.length > 0) {
        failRun(
          'INTAKE_CONFLICT',
          `${managedOnly.join('、')} 是 managed 流程的執行控制；與 --no-register-consumer（register-fleet=no）衝突`,
        )
      }
    }

    // --offline：禁止外部查詢與下載。依賴安裝一定要網路；managed 流程的 clade
    // 來源也必須已在本機 —— CLADE_HOME 指定但不存在時 findCladeRoot 不 fallback。
    if (offline && args.install !== false) {
      failRun(
        'INTAKE_INVALID',
        '--offline 禁止外部下載：依賴安裝需要網路。請加 --no-install，或先備妥依賴後重跑。',
      )
    }
    if (offline && registerConsumer && !findCladeRoot()) {
      failRun(
        'ASSET_UNAVAILABLE',
        '--offline 且 managed 流程需要本機 clade 來源：CLADE_HOME / ~/clade / ~/offline/clade 皆不可用' +
          '（CLADE_HOME 已指定但不存在時不 fallback 真 home）。',
      )
    }

    // 給了 --repo-id 就是要求登記進 Clade fleet —— 那些約束（fleet base、
    // consumer_id / repo_id 衝突、dev port 撞號）在寫第一個檔之前就問得出來。
    // 不先問的話要等 scaffold + pnpm install 全部跑完才在最後一步 warn，
    // 而專案已經建在錯的位置上了。
    // --no-register-consumer 明示不登記，這時預檢沒有東西要保護。
    if (repoId && registerConsumer) {
      const cladeRoot = findCladeRoot()
      if (cladeRoot) {
        const preflight = preflightCladeRegistration(cladeRoot, targetDir, {
          repoId,
          workflowModel: workflowModel as 'trunk-based' | 'pr-merge-based',
          businessActivity: businessActivity as 'pre-production',
          devPort: resolvedDevPort,
          deployTrack,
          dbRuntime: cladeModules.dbRuntime,
          // registry path 明確指定時，預檢與後續所有子程序都對同一個 registry。
          registryPath: registryPathArg ? resolve(invocationCwd, registryPathArg) : undefined,
        })
        if (preflight.status === 'rejected') {
          consola.log('  修正後重跑，或拿掉 --repo-id 先建立不登記的專案。')
          failRun(
            'IDENTITY_CONFLICT',
            `Clade fleet 登記預檢未過，未建立任何檔案：${preflight.reason ?? '未知原因'}`,
          )
        }
        if (preflight.status === 'skipped') {
          consola.warn(`略過 Clade 登記預檢：${preflight.reason}`)
        }
      }
    }

    if (managedAdopt) {
      // adopt：既有業務專案只接 managed bootstrap；scaffold／init-consumer／
      // commit 全部略過，業務檔與 WIP 原封不動。
      consola.info(
        `偵測到既有業務專案「${pkgName}」，只交付 Clade managed bootstrap（不 scaffold）。`,
      )
      let adoptOutcome: PostScaffoldOutcome
      try {
        adoptOutcome = await adoptExistingProject(targetDir, {
          yes: effectiveYes,
          registerConsumer: true,
          wirePreCommit: false,
          cloneClade: false,
          existingGitRepo: true,
          dbStack: selections.dbStack,
          dbHost: selections.dbHost,
          repoId,
          workflowModel: workflowModel as 'trunk-based' | 'pr-merge-based',
          businessActivity: businessActivity as
            | 'pre-production'
            | 'active'
            | 'maintenance'
            | 'paused'
            | 'auto',
          devPort: resolvedDevPort,
          deployTrack,
          dbRuntime: cladeModules.dbRuntime,
          agentTargets: selections.agentTargets,
          updatePolicy,
          release: releaseArg,
          releaseStore: releaseStoreArg ? resolve(invocationCwd, releaseStoreArg) : undefined,
          registryPath: registryPathArg ? resolve(invocationCwd, registryPathArg) : undefined,
          noPush,
          offline,
          json: jsonMode,
        })
      } catch (error) {
        return failRun('BOOTSTRAP_FAILED', `採用既有專案失敗：${(error as Error).message}`)
      }
      const adoptReport = buildCompletionReport(targetDir, true, adoptOutcome)
      emitJson?.(adoptReport)
      if (adoptReport.status === 'failed') process.exit(1)
      return
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
      return failRun('SCAFFOLD_FAILED', `建立專案失敗：${(error as Error).message}`)
    }

    // Post-scaffold
    let outcome: PostScaffoldOutcome
    try {
      outcome = await postScaffold(targetDir, pkgName, invocationCwd, cladeModules, {
        yes: effectiveYes,
        registerConsumer,
        wirePreCommit: args['wire-pre-commit'] as boolean,
        cloneClade: args['clone-clade'] as boolean,
        installDeps: args.install as boolean,
        existingGitRepo: adoptState?.hasGitRepo === true,
        deployTarget: selections.deploymentTarget,
        dbStack: selections.dbStack,
        dbHost: selections.dbHost,
        repoId,
        workflowModel: workflowModel as 'trunk-based' | 'pr-merge-based',
        businessActivity: businessActivity as
          | 'pre-production'
          | 'active'
          | 'maintenance'
          | 'paused'
          | 'auto',
        devPort: resolvedDevPort,
        deployTrack,
        dbRuntime: cladeModules.dbRuntime,
        agentTargets: selections.agentTargets,
        updatePolicy,
        release: releaseArg,
        releaseStore: releaseStoreArg ? resolve(invocationCwd, releaseStoreArg) : undefined,
        registryPath: registryPathArg ? resolve(invocationCwd, registryPathArg) : undefined,
        noPush,
        offline,
        json: jsonMode,
      })
    } catch (error) {
      return failRun('SCAFFOLD_FAILED', `post-scaffold 失敗：${(error as Error).message}`)
    }

    // --json 完成報告：stdout 唯一一個 JSON object（機讀契約）。
    // bootstrap 回報成功但未提供可驗證身分時降回 scaffolded，不宣稱 ready。
    const report = buildCompletionReport(targetDir, registerConsumer, outcome)
    emitJson?.(report)
    if (report.status === 'failed') process.exit(1)
  },
})

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMain(main)
}
