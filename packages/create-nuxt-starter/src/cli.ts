#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs'
import { basename, resolve } from 'pathe'
import { defineCommand, runMain } from 'citty'
import { consola } from 'consola'
import { assembleProject } from './assemble'
import { confirmScaffold, displaySummary, getDefaultSelections, promptUser } from './prompts'
import { postScaffold } from './post-scaffold'

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
  },
  async run({ args }) {
    const projectName = args.dir as string | undefined

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

    if (args.yes) {
      // Non-interactive mode with defaults
      const name = projectName || 'nuxt-app'
      selections = getDefaultSelections(name)
      consola.info(`使用預設配置建立專案：${name}`)
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
