import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { consola } from 'consola'

export interface CladeModules {
  auth: 'better-auth' | 'nuxt-auth-utils' | 'supabase-self-hosted'
  dbSchema: 'supabase' | 'supabase-self-hosted'
  dbRuntime: 'cf-workers' | 'supabase-self-hosted'
  runtime: 'cf-workers' | 'vercel-node' | 'nitro-self-hosted'
  framework: 'nuxt'
  localHooks: string[]
}

export async function postScaffold(
  targetDir: string,
  projectName: string,
  invocationCwd: string,
  cladeModules: CladeModules
): Promise<void> {
  // Use the user's actual cwd for the cd hint, not invocationCwd
  // (which may differ when running inside the monorepo)
  const userCwd = process.env.INIT_CWD?.trim() || process.env.PWD?.trim() || process.cwd()
  const relativeTargetDir = relative(userCwd, targetDir) || '.'

  // 1. Register as clade consumer — rewrite .claude/hub.json with the
  //    selected modules and inject postinstall + hub:* scripts into
  //    package.json. --no-bootstrap defers the heavy sync to pnpm install.
  const cladeRoot = runInitConsumer(targetDir, cladeModules)

  // 2. Install dependencies — postinstall hook runs clade bootstrap-hub
  //    which pulls fresh rules / skills / hooks / scripts into .claude/.
  consola.start('正在安裝依賴套件...')
  let pnpmInstalled = false
  try {
    execFileSync('pnpm', ['install'], { cwd: targetDir, stdio: 'pipe' })
    consola.success('依賴套件安裝完成！')
    pnpmInstalled = true
  } catch {
    consola.warn('依賴套件安裝失敗，請手動執行：')
    consola.log(`  cd ${relativeTargetDir} && pnpm install`)
  }

  // 3. Re-project .codex/.agents/AGENTS.md from the new project's final
  //    .claude/ (after bootstrap-hub pulled fresh clade content). Doing
  //    this before pnpm install would leave projections stale.
  if (pnpmInstalled) {
    runSyncToAgents(targetDir)
  } else {
    consola.warn('略過 sync-to-agents — 請在 pnpm install 成功後手動：')
    consola.log(`  cd ${relativeTargetDir} && node ~/.claude/scripts/sync-to-agents.mjs`)
  }

  // 4. Initialize git
  consola.start('正在初始化 Git...')
  try {
    execFileSync('git', ['init'], { cwd: targetDir, stdio: 'pipe' })
    execFileSync('git', ['add', '-A'], { cwd: targetDir, stdio: 'pipe' })
    execFileSync('git', ['commit', '-m', 'chore: initial project scaffold'], {
      cwd: targetDir,
      stdio: 'pipe',
    })
    consola.success('Git 初始化完成！')
  } catch {
    consola.warn('Git 初始化失敗，請手動執行。')
  }

  // 5. Display next steps
  const nextSteps = [
    `專案 ${projectName} 建立完成！`,
    `路徑：${targetDir}`,
    '',
    '接下來：',
    `  cd ${relativeTargetDir}`,
    '  pnpm run setup           # 檢查環境 → 啟動 Supabase → 產生型別',
    '  pnpm dev                 # 啟動開發伺服器',
  ]

  if (cladeRoot) {
    nextSteps.push(
      '',
      '選用 — 把專案登記到 clade 中央倉，未來 propagate 才會推到這裡：',
      `  echo "${targetDir}" >> ${cladeRoot}/consumers.local`
    )
  }

  consola.log('')
  consola.box(nextSteps.join('\n'))
}

function findCladeRoot(): string | undefined {
  const env = process.env.CLADE_HOME?.trim()
  if (env && existsSync(env)) return env
  const home = homedir()
  for (const candidate of [join(home, 'clade'), join(home, 'offline', 'clade')]) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function runSyncToAgents(targetDir: string): void {
  const script = join(homedir(), '.claude', 'scripts', 'sync-to-agents.mjs')
  if (!existsSync(script)) {
    consola.warn(
      '找不到 ~/.claude/scripts/sync-to-agents.mjs，略過 .codex/.agents/AGENTS.md 重投影'
    )
    return
  }
  consola.start('重投影 .codex/.agents/AGENTS.md（Claude Code First → projections）')
  try {
    execFileSync('node', [script], { cwd: targetDir, stdio: 'pipe' })
    consola.success('Projection 重生完成')
  } catch (error) {
    consola.warn(`sync-to-agents 執行失敗：${(error as Error).message}`)
    consola.log('  之後可手動：node ~/.claude/scripts/sync-to-agents.mjs')
  }
}

function runInitConsumer(targetDir: string, mods: CladeModules): string | undefined {
  const cladeRoot = findCladeRoot()
  if (!cladeRoot) {
    consola.warn('找不到 clade（CLADE_HOME / ~/clade / ~/offline/clade），略過 clade consumer 註冊')
    consola.log(
      '  之後可手動：CLADE_HOME=/path/to/clade node $CLADE_HOME/scripts/init-consumer.mjs --force --no-bootstrap --auth ...'
    )
    return undefined
  }

  const script = join(cladeRoot, 'scripts', 'init-consumer.mjs')
  if (!existsSync(script)) {
    consola.warn(`找到 clade 但缺 init-consumer.mjs：${script}`)
    return cladeRoot
  }

  consola.start('註冊 clade consumer（hub.json + postinstall + hub:* scripts）')
  const args = [
    script,
    '--force',
    '--no-bootstrap',
    '--auth',
    mods.auth,
    '--db-schema',
    mods.dbSchema,
    '--db-runtime',
    mods.dbRuntime,
    '--runtime',
    mods.runtime,
    '--framework',
    mods.framework,
  ]
  if (mods.localHooks.length > 0) {
    args.push('--local-hooks', mods.localHooks.join(','))
  }

  try {
    execFileSync('node', args, { cwd: targetDir, stdio: 'pipe' })
    consola.success('clade consumer 註冊完成')
  } catch (error) {
    consola.warn(`clade init-consumer 失敗：${(error as Error).message}`)
    consola.log(`  之後可手動：cd ${targetDir} && node ${script} ${args.slice(1).join(' ')}`)
  }

  return cladeRoot
}
