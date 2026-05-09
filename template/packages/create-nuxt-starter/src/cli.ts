#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs'
import { basename, resolve } from 'pathe'
import { defineCommand, runMain } from 'citty'
import { consola } from 'consola'
import { assembleProject } from './assemble'
import { featureModules, getModuleById, resolveFeatureDependencies } from './features'
import { confirmScaffold, displaySummary, getDefaultSelections, promptUser } from './prompts'
import { postScaffold, type CladeModules } from './post-scaffold'
import { EVLOG_PRESETS, type AgentRuntime, type EvlogPreset } from './types'

type CliAuth = 'nuxt-auth-utils' | 'better-auth' | 'none'
type CliCi = 'simple' | 'advanced'
const VALID_AGENT_TARGETS = ['claude-code', 'codex', 'cursor'] as const

function isMonorepoRoot(dir: string): boolean {
  return (
    existsSync(resolve(dir, 'template/packages/create-nuxt-starter')) &&
    existsSync(resolve(dir, 'scripts/create-clean.sh'))
  )
}

function detectMonorepoRoot(): string | undefined {
  const initCwd = process.env.INIT_CWD?.trim()
  if (initCwd && isMonorepoRoot(initCwd)) {
    return initCwd
  }

  const shellPwd = process.env.PWD?.trim() || process.cwd()
  const normalized = shellPwd.replaceAll('\\', '/')

  if (normalized.endsWith('/template/packages/create-nuxt-starter')) {
    const root = resolve(shellPwd, '..', '..', '..')
    if (isMonorepoRoot(root)) return root
  }

  if (isMonorepoRoot(shellPwd)) {
    return shellPwd
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

  return process.env.PWD?.trim() || process.cwd()
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function inferDeploymentTarget(features: string[]): 'cloudflare' | 'vercel' | 'node' {
  if (features.includes('deploy-vercel')) return 'vercel'
  if (features.includes('deploy-node')) return 'node'
  return 'cloudflare'
}

function inferTestingLevel(features: string[]): 'full' | 'vitest-only' | 'none' {
  if (features.includes('testing-full')) return 'full'
  if (features.includes('testing-vitest')) return 'vitest-only'
  return 'none'
}

function inferCladeModules(features: string[]): CladeModules {
  const hasBetterAuth = features.includes('auth-better-auth')
  const hasNuxtAuthUtils = features.includes('auth-nuxt-utils')

  let auth: CladeModules['auth']
  if (hasBetterAuth) {
    auth = 'better-auth'
  } else if (hasNuxtAuthUtils) {
    auth = 'nuxt-auth-utils'
  } else {
    // No auth feature selected — clade manifest still requires a value.
    // Fall back to the lightest cookie-based option; the user can later
    // change .claude/hub.json if they actually integrate auth.
    consola.warn(
      '[clade] 未選 auth feature；hub.json 暫填 nuxt-auth-utils。實際接認證後請改 .claude/hub.json + 跑 pnpm hub:sync。'
    )
    auth = 'nuxt-auth-utils'
  }

  const deploy = inferDeploymentTarget(features)
  const runtime: CladeModules['runtime'] =
    deploy === 'vercel' ? 'vercel-node' : deploy === 'node' ? 'nitro-self-hosted' : 'cf-workers'

  // db-runtime schema only allows cf-workers / supabase-self-hosted.
  // Self-hosted Node deploy implies self-hosted Supabase; otherwise treat
  // DB connection as cf-workers (Supabase Cloud over HTTP, which Vercel
  // and CF Workers both use).
  const dbRuntime: CladeModules['dbRuntime'] =
    runtime === 'nitro-self-hosted' ? 'supabase-self-hosted' : 'cf-workers'
  const dbSchema: CladeModules['dbSchema'] =
    dbRuntime === 'supabase-self-hosted' ? 'supabase-self-hosted' : 'supabase'

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

function buildSelectionsFromArgs(args: {
  projectName: string
  auth?: string
  ci?: string
  with?: string
  without?: string
  minimal?: boolean
  preset?: string
  fast?: boolean
  agents?: string
  evlogPreset?: string
}) {
  const availableFeatureIds = new Set(featureModules.map((mod) => mod.id))
  const fromWith = parseCsv(args.with)
  const fromWithout = parseCsv(args.without)
  const unknown = [...fromWith, ...fromWithout].filter((id) => !availableFeatureIds.has(id))

  if (unknown.length > 0) {
    consola.error(`未知的 feature id：${unknown.join(', ')}`)
    consola.info('可用 feature id：')
    consola.info(featureModules.map((mod) => `  - ${mod.id}`).join('\n'))
    process.exit(1)
  }

  const validAuthValues: CliAuth[] = ['nuxt-auth-utils', 'better-auth', 'none']
  const authArg = args.auth as CliAuth | undefined
  if (authArg && !validAuthValues.includes(authArg)) {
    consola.error(`--auth 只接受：${validAuthValues.join(' | ')}`)
    process.exit(1)
  }

  const validCiValues: CliCi[] = ['simple', 'advanced']
  const ciArg = args.ci as CliCi | undefined
  if (ciArg && !validCiValues.includes(ciArg)) {
    consola.error(`--ci 只接受：${validCiValues.join(' | ')}`)
    process.exit(1)
  }

  const validPresetValues = ['default', 'fast'] as const
  const presetArg = args.preset as (typeof validPresetValues)[number] | undefined
  if (presetArg && !validPresetValues.includes(presetArg)) {
    consola.error(`--preset 只接受：${validPresetValues.join(' | ')}`)
    process.exit(1)
  }

  const evlogPresetArg = args.evlogPreset as EvlogPreset | undefined
  if (evlogPresetArg && !EVLOG_PRESETS.includes(evlogPresetArg)) {
    consola.error(`--evlog-preset 只接受：${EVLOG_PRESETS.join(' | ')}`)
    process.exit(1)
  }
  const evlogPreset: EvlogPreset = evlogPresetArg ?? 'baseline'

  const useFastPreset = args.fast === true || presetArg === 'fast'
  const agentTargets =
    parseAgentTargets(args.agents) ?? getDefaultSelections(args.projectName).agentTargets

  const selected = new Set(args.minimal ? [] : getDefaultSelections(args.projectName).features)

  if (useFastPreset) {
    selected.delete('testing-full')
    selected.delete('testing-vitest')
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

  if (authArg) {
    selected.delete('auth-nuxt-utils')
    selected.delete('auth-better-auth')
    if (authArg === 'nuxt-auth-utils') addFeature('auth-nuxt-utils')
    if (authArg === 'better-auth') addFeature('auth-better-auth')
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

  const features = resolveFeatureDependencies([...selected])

  return {
    projectName: args.projectName,
    features,
    ssr: features.includes('ssr'),
    deploymentTarget: inferDeploymentTarget(features),
    testingLevel: inferTestingLevel(features),
    agentTargets,
    evlogPreset,
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
      description: 'Profile preset: default | fast',
      required: false,
    },
    fast: {
      type: 'boolean',
      description: 'Alias of --preset fast',
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
        '登記到 clade consumers.local，讓 propagate 自動推到此專案（--no-register-consumer 跳過）',
      default: true,
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
    'evlog-preset': {
      type: 'string',
      description:
        'evlog preset: none | baseline | d-pattern-audit | nuxthub-ai (default: baseline)',
      required: false,
    },
  },
  async run({ args }) {
    const monorepoRoot = detectMonorepoRoot()
    const invocationCwd = getInvocationCwd(monorepoRoot)
    const projectName = args.dir as string | undefined
    const hasCustomFlags = Boolean(
      args.auth ||
      args.ci ||
      args.with ||
      args.without ||
      args.minimal ||
      args.preset ||
      args.fast ||
      args.agents ||
      args['evlog-preset']
    )

    // Validate directory
    if (projectName) {
      const targetDir = resolve(invocationCwd, projectName)
      if (existsSync(targetDir)) {
        const entries = readdirSync(targetDir)
        if (entries.length > 0) {
          consola.error(`目錄 "${projectName}" 已存在且不為空。`)
          process.exit(1)
        }
      }
    }

    let selections

    if (args.yes || hasCustomFlags) {
      // Non-interactive mode with defaults/custom flags
      const name = projectName || 'nuxt-app'
      selections = buildSelectionsFromArgs({
        projectName: name,
        auth: args.auth as string | undefined,
        ci: args.ci as string | undefined,
        with: args.with as string | undefined,
        without: args.without as string | undefined,
        minimal: args.minimal as boolean | undefined,
        preset: args.preset as string | undefined,
        fast: args.fast as boolean | undefined,
        agents: args.agents as string | undefined,
        evlogPreset: args['evlog-preset'] as string | undefined,
      })

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

    // Display summary and confirm
    displaySummary(selections)

    if (!args.yes) {
      const confirmed = await confirmScaffold()
      if (!confirmed) {
        consola.info('已取消。')
        process.exit(0)
      }
    }

    // Resolve target directory and use basename as project name for package.json
    const targetDir = resolve(invocationCwd, selections.projectName)
    const pkgName = basename(targetDir)
    consola.start(`正在建立專案 ${pkgName}...`)

    try {
      assembleProject(
        targetDir,
        selections.features,
        pkgName,
        selections.agentTargets,
        selections.evlogPreset
      )
      consola.success('專案檔案建立完成！')
    } catch (error) {
      consola.error('建立專案失敗：', error)
      process.exit(1)
    }

    // Post-scaffold
    await postScaffold(targetDir, pkgName, invocationCwd, inferCladeModules(selections.features), {
      yes: args.yes as boolean,
      registerConsumer: args['register-consumer'] as boolean,
      wirePreCommit: args['wire-pre-commit'] as boolean,
      cloneClade: args['clone-clade'] as boolean,
    })
  },
})

runMain(main)
