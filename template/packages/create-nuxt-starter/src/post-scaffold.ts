import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { consola } from 'consola'

export interface CladeModules {
  auth: 'better-auth' | 'nuxt-auth-utils' | 'supabase-self-hosted'
  dbSchema: 'supabase' | 'supabase-self-hosted'
  dbRuntime: 'cf-workers' | 'supabase-self-hosted'
  runtime: 'cf-workers' | 'vercel-node' | 'nitro-self-hosted'
  framework: 'nuxt'
  localHooks: string[]
}

export interface PostScaffoldOptions {
  yes: boolean
  registerConsumer: boolean
  wirePreCommit: boolean
  cloneClade: boolean
}

export async function postScaffold(
  targetDir: string,
  projectName: string,
  invocationCwd: string,
  cladeModules: CladeModules,
  opts: PostScaffoldOptions
): Promise<void> {
  // Use the user's actual cwd for the cd hint, not invocationCwd
  // (which may differ when running inside the monorepo)
  const userCwd = process.env.INIT_CWD?.trim() || process.env.PWD?.trim() || process.cwd()
  const relativeTargetDir = relative(userCwd, targetDir) || '.'

  // 1. Register as clade consumer — rewrite .claude/hub.json with the
  //    selected modules and inject postinstall + hub:* scripts into
  //    package.json. --no-bootstrap defers the heavy sync to pnpm install.
  //    If clade is missing, may attempt to git clone it (controlled by opts.cloneClade).
  const cladeRoot = await runInitConsumer(targetDir, cladeModules, opts)

  // 2. Install dependencies — postinstall hook runs clade bootstrap-hub
  //    which pulls fresh rules / skills / hooks / scripts into .claude/.
  // pnpm v10/v11 在 fresh install 時可能對 build script approval 機制 emit
  // ERR_PNPM_IGNORED_BUILDS 即使 package.json 已設 pnpm.allowBuilds dict。
  // 實測 retry 一次（lockfile 已建立）必通過，所以失敗時自動 retry 一次。
  consola.start('正在安裝依賴套件...')
  let pnpmInstalled = false
  for (const attempt of [1, 2]) {
    try {
      execFileSync('pnpm', ['install'], { cwd: targetDir, stdio: 'inherit' })
      consola.success('依賴套件安裝完成！')
      pnpmInstalled = true
      break
    } catch (error) {
      if (attempt === 1) {
        consola.warn('第一次 pnpm install 結束時 emit 警告，自動 retry 一次...')
        continue
      }
      consola.warn(`依賴套件安裝失敗：${(error as Error).message}`)
      consola.log(`  上方為 pnpm 實際輸出；修正後手動執行：`)
      consola.log(`  cd ${relativeTargetDir} && pnpm install`)
    }
  }

  // 3. Prune orphan rules — bootstrap pulls all variant rules，但本專案
  //    選的 modules 可能不需要某些 rule（例如 auth=nuxt-auth-utils 不需要
  //    通用 auth.md），讓 hub:check 結束時直接全綠。
  if (pnpmInstalled) {
    runHubPrune(targetDir)
  }

  // 4. Re-project .codex/.agents/AGENTS.md from the new project's final
  //    .claude/ (after bootstrap-hub pulled fresh clade content). Doing
  //    this before pnpm install would leave projections stale.
  if (pnpmInstalled) {
    runSyncToAgents(targetDir)
  } else {
    consola.warn('略過 sync-to-agents — 請在 pnpm install 成功後手動：')
    consola.log(`  cd ${relativeTargetDir} && node ~/.claude/scripts/sync-to-agents.mjs`)
  }

  // 5. Initialize git
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

  // 6. Register as clade consumer (idempotent; opt-out via --no-register-consumer)
  let consumerRegistered = false
  if (cladeRoot && opts.registerConsumer) {
    consumerRegistered = await maybeRegisterConsumer(cladeRoot, targetDir, opts.yes)
  }

  // 7. Wire pre-commit hook (idempotent; opt-out via --no-wire-pre-commit)
  let preCommitWired = false
  if (cladeRoot && opts.wirePreCommit) {
    preCommitWired = await maybeWirePreCommit(cladeRoot, targetDir, opts.yes)
  }

  // 8. Write .claude/.first-run marker — AI session 第一次進此專案時讀此檔，
  //    觸發 verify:starter + spectra:roadmap 暖機，跑完自行刪 marker。
  //    詳見 docs/AGENTS.md「第一次進此 session 該做什麼」。
  writeFirstRunMarker(targetDir, projectName, cladeModules)

  // 9. Display next steps
  const nextSteps = [
    `專案 ${projectName} 建立完成！`,
    `路徑：${targetDir}`,
    '',
    '接下來：',
    `  cd ${relativeTargetDir}`,
    '  pnpm run setup           # 檢查環境 → 啟動 Supabase → 產生型別',
    '  pnpm dev                 # 啟動開發伺服器',
  ]

  if (cladeRoot && !consumerRegistered) {
    nextSteps.push(
      '',
      '選用 — 把專案登記到 clade 中央倉，未來 propagate 才會推到這裡：',
      `  echo "${targetDir} flow=main" >> ${cladeRoot}/consumers.local`
    )
  }

  if (cladeRoot && !preCommitWired) {
    nextSteps.push(
      '',
      '選用 — wire pre-commit hook（擋掉 clade-managed 檔的本地誤改）：',
      `  cp ${cladeRoot}/vendor/git-pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`,
      '  # 或（已用 husky）：echo "pnpm hub:check" >> .husky/pre-commit'
    )
  }

  consola.log('')
  consola.box(nextSteps.join('\n'))
}

async function maybeRegisterConsumer(
  cladeRoot: string,
  targetDir: string,
  nonInteractive: boolean
): Promise<boolean> {
  // consumers.local 是空白分隔格式 (`<path> flow=main`)，路徑含 whitespace /
  // newline 會破壞解析。此處屬於 trust boundary 邊界——`targetDir` 來自
  // `resolve(invocationCwd, projectName)`，理論上不會含 newline，但保險起見
  // 顯式擋掉，避免日後重構時靜默壞掉。
  if (/[\n\r\t ]/.test(targetDir)) {
    consola.warn(
      `專案路徑含空白或控制字元，無法登記到 consumers.local（會破壞解析格式）：${targetDir}`
    )
    consola.log('  之後可改用無空白的路徑，或手動編輯 consumers.local')
    return false
  }

  const consumersFile = join(cladeRoot, 'consumers.local')
  const existing = tryReadFile(consumersFile) ?? ''
  if (existing) {
    const already = existing.split('\n').some((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return false
      // 第一個 token 即路徑（已禁止含空白，所以 split 安全）
      return trimmed.split(/\s+/)[0] === targetDir
    })
    if (already) {
      consola.info('專案已登記在 clade consumers.local — 跳過')
      return true
    }
  }

  if (!nonInteractive) {
    const confirmed = await consola.prompt(
      '登記到 clade consumers.local？未來 publish 新版時 propagate 會自動推到此專案',
      { type: 'confirm', initial: true }
    )
    if (!confirmed) {
      consola.info('已跳過 consumers.local 登記（之後可手動 echo append）')
      return false
    }
  }

  try {
    const prefix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n'
    appendFileSync(consumersFile, `${prefix}${targetDir} flow=main\n`)
    consola.success(`已登記到 ${consumersFile}`)
    return true
  } catch (error) {
    consola.warn(`登記 consumers.local 失敗：${(error as Error).message}`)
    return false
  }
}

async function maybeWirePreCommit(
  cladeRoot: string,
  targetDir: string,
  nonInteractive: boolean
): Promise<boolean> {
  const huskyHook = join(targetDir, '.husky', 'pre-commit')
  const gitHook = join(targetDir, '.git', 'hooks', 'pre-commit')
  const huskyDir = join(targetDir, '.husky')

  // Read existing hook content once，後面 append 階段會再用到，避免重讀。
  const huskyContent = tryReadFile(huskyHook)
  const gitHookContent = huskyContent === undefined ? tryReadFile(gitHook) : undefined

  // Already wired? Detect existing hub:check call.
  const existing = huskyContent ?? gitHookContent ?? ''
  if (existing.includes('hub:check') || existing.includes('git-pre-commit.sh')) {
    consola.info('pre-commit hook 已 wired — 跳過')
    return true
  }

  if (!nonInteractive) {
    const confirmed = await consola.prompt(
      'wire pre-commit hook？（commit 前自動跑 hub:check 擋掉 clade-managed 檔的本地誤改）',
      { type: 'confirm', initial: true }
    )
    if (!confirmed) {
      consola.info('已跳過 pre-commit wire（之後可手動）')
      return false
    }
  }

  // Pick strategy: husky directory exists → append; else cp clade vendor hook to .git/hooks/.
  try {
    if (existsSync(huskyDir)) {
      const huskyExisting = huskyContent ?? ''
      const prefix = huskyExisting.length === 0 || huskyExisting.endsWith('\n') ? '' : '\n'
      const line = 'pnpm hub:check\n'
      if (huskyExisting.length === 0) {
        // husky v9+ no longer requires the shebang/source line, but keep it portable.
        appendFileSync(huskyHook, `#!/usr/bin/env sh\n${line}`)
        chmodSync(huskyHook, 0o755)
      } else {
        appendFileSync(huskyHook, `${prefix}${line}`)
      }
      consola.success(`已 wire pre-commit (husky) — ${huskyHook}`)
      return true
    }

    const vendorHook = join(cladeRoot, 'vendor', 'git-pre-commit.sh')
    if (!existsSync(vendorHook)) {
      consola.warn(`找不到 ${vendorHook} — 略過 pre-commit wire`)
      return false
    }
    const gitDir = join(targetDir, '.git')
    if (!existsSync(gitDir)) {
      consola.warn('專案不是 git repo — 略過 pre-commit wire')
      return false
    }
    mkdirSync(dirname(gitHook), { recursive: true })
    copyFileSync(vendorHook, gitHook)
    chmodSync(gitHook, 0o755)
    consola.success(`已 wire pre-commit (git native) — ${gitHook}`)
    return true
  } catch (error) {
    consola.warn(`pre-commit wire 失敗：${(error as Error).message}`)
    return false
  }
}

function writeFirstRunMarker(targetDir: string, projectName: string, mods: CladeModules): void {
  const claudeDir = join(targetDir, '.claude')
  if (!existsSync(claudeDir)) return // clade 未 init 時略過
  const markerPath = join(claudeDir, '.first-run')
  const payload = {
    scaffoldedAt: new Date().toISOString(),
    projectName,
    cladeModules: mods,
    instructions:
      'AI agent: 看到此檔代表 scaffold 剛完成。建議行動：(1) 跑 pnpm verify:starter；(2) 跑 pnpm spectra:roadmap；(3) 列出 next-step 給使用者；(4) 完成後 rm .claude/.first-run。詳見 docs/AGENTS.md。',
  }
  try {
    writeFileSync(markerPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
    consola.info(`已寫 first-run marker — ${markerPath}（session 開始時 AI 會自動處理）`)
  } catch (error) {
    consola.warn(`寫 first-run marker 失敗：${(error as Error).message}`)
  }
}

async function tryCloneClade(nonInteractive: boolean): Promise<string | undefined> {
  // Default target: ~/offline/clade（與 findCladeRoot 的搜尋順序一致）
  const target = join(homedir(), 'offline', 'clade')
  const parentDir = dirname(target)

  // Parent dir must exist or be creatable
  if (!existsSync(parentDir)) {
    try {
      mkdirSync(parentDir, { recursive: true })
    } catch {
      consola.warn(`找不到 clade 且無法建立 ${parentDir} — 略過 auto-clone`)
      return undefined
    }
  }

  // Already cloned? (race condition safety)
  if (existsSync(target)) {
    return target
  }

  if (!nonInteractive) {
    const ok = await consola.prompt(
      `找不到 clade，要 git clone 到 ${target}？（需要對 YuDefine/clade 的 read access）`,
      { type: 'confirm', initial: true }
    )
    if (!ok) {
      consola.info('已跳過 clade auto-clone')
      return undefined
    }
  }

  // Try ssh first, then https
  const candidates = ['git@github.com:YuDefine/clade.git', 'https://github.com/YuDefine/clade.git']

  for (const url of candidates) {
    // Probe access without cloning (cheap, no large download)
    consola.start(`偵測 ${url} 可達性...`)
    const probe = execFileSyncSafe('git', ['ls-remote', '--exit-code', url, 'HEAD'])
    if (!probe.ok) {
      consola.log(`  × ${url} 不可達`)
      continue
    }

    consola.start(`git clone ${url} → ${target}`)
    const clone = execFileSyncSafe('git', ['clone', url, target])
    if (clone.ok) {
      consola.success(`clade 已 clone 到 ${target}`)
      return target
    }
    consola.warn(`clone 失敗：${clone.error}`)
  }

  consola.warn('所有 git URL 都無法 clone clade — 你可能需要設定 SSH key 或 PAT')
  return undefined
}

function execFileSyncSafe(file: string, args: string[]): { ok: boolean; error?: string } {
  try {
    execFileSync(file, args, { stdio: 'pipe' })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

/** Read file utf8，不存在或 IO 失敗回 undefined（避免 existsSync + readFileSync 兩次系統呼叫）. */
function tryReadFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
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

function runHubPrune(targetDir: string): void {
  consola.start('清理本 modules 不需要的 orphan rules（pnpm hub:prune）')
  try {
    execFileSync('pnpm', ['hub:prune'], { cwd: targetDir, stdio: 'pipe' })
    consola.success('Orphan rules 清理完成')
  } catch (error) {
    consola.warn(`hub:prune 執行失敗：${(error as Error).message}`)
    consola.log(`  之後可手動：cd ${targetDir} && pnpm hub:prune`)
  }
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

async function runInitConsumer(
  targetDir: string,
  mods: CladeModules,
  opts: PostScaffoldOptions
): Promise<string | undefined> {
  let cladeRoot = findCladeRoot()
  if (!cladeRoot && opts.cloneClade) {
    cladeRoot = await tryCloneClade(opts.yes)
  }
  if (!cladeRoot) {
    consola.warn('找不到 clade（CLADE_HOME / ~/clade / ~/offline/clade），略過 clade consumer 註冊')
    consola.log('  之後可手動：')
    consola.log('    git clone git@github.com:YuDefine/clade.git ~/offline/clade')
    consola.log('    cd <projectDir> && pnpm hub:bootstrap')
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
