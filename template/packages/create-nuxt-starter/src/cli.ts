#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs'
import { basename, resolve } from 'pathe'
import { defineCommand, runMain } from 'citty'
import { consola } from 'consola'
import { assembleProject } from './assemble'
import { featureModules, getModuleById, resolveFeatureDependencies } from './features'
import { confirmScaffold, displaySummary, getDefaultSelections, promptUser } from './prompts'
import { postScaffold } from './post-scaffold'

type CliAuth = 'nuxt-auth-utils' | 'better-auth' | 'none'

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

function buildSelectionsFromArgs(args: {
  projectName: string
  auth?: string
  with?: string
  without?: string
  minimal?: boolean
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

  const selected = new Set(
    args.minimal ? [] : getDefaultSelections(args.projectName).features,
  )

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
    deploymentTarget: inferDeploymentTarget(features),
    testingLevel: inferTestingLevel(features),
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
  },
  async run({ args }) {
    const projectName = args.dir as string | undefined
    const hasCustomFlags = Boolean(args.auth || args.with || args.without || args.minimal)

    // Validate directory
    if (projectName) {
      const targetDir = resolve(process.cwd(), projectName)
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
        with: args.with as string | undefined,
        without: args.without as string | undefined,
        minimal: args.minimal as boolean | undefined,
      })

      if (hasCustomFlags) {
        consola.info(`使用自訂參數配置建立專案：${name}`)
      } else {
        consola.info(`使用預設配置建立專案：${name}`)
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
    const targetDir = resolve(process.cwd(), selections.projectName)
    const pkgName = basename(targetDir)
    consola.start(`正在建立專案 ${pkgName}...`)

    try {
      assembleProject(targetDir, selections.features, pkgName)
      consola.success('專案檔案建立完成！')
    } catch (error) {
      consola.error('建立專案失敗：', error)
      process.exit(1)
    }

    // Post-scaffold
    await postScaffold(targetDir, pkgName)
  },
})

runMain(main)
