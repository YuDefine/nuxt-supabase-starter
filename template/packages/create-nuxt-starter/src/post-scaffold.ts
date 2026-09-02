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
import { basename, dirname, join, relative } from 'node:path'
import { consola } from 'consola'
import { DEFAULT_DB_STACK, type DbStack } from './types'

export interface CladeModules {
  auth: 'none' | 'better-auth' | 'nuxt-auth-utils' | 'supabase-self-hosted'
  dbSchema: 'cf-d1' | 'supabase' | 'supabase-self-hosted'
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
  /** false 時跳過 `pnpm install`（CI / e2e 測試用；預設安裝）。 */
  installDeps?: boolean
  dbStack?: DbStack
  repoId?: string
  workflowModel?: 'trunk-based' | 'pr-merge-based'
  businessActivity?: 'pre-production' | 'active' | 'maintenance' | 'paused' | 'auto'
  /** `auto` 交給 Clade 依 fleet 慣例配號（3000 起、每 10 一階）。 */
  devPort?: number | 'auto'
  /** 寫進 registry `deploy-track`；self-hosted 無公網 HTTPS prod DB 時必須是 `none`。 */
  deployTrack?: 'wrangler-action' | 'void-cloud' | 'node-server' | 'none'
  /** 寫進 registry `db-runtime`，與 hub.json modules 對齊。 */
  dbRuntime?: CladeModules['dbRuntime']
  /**
   * 就地展開到既有 git repo 時設 true：不重跑 `git init`，commit message 也
   * 改成「加入 starter」而非「initial scaffold」——那個 repo 的第一個 commit
   * 不是這次跑出來的。
   */
  existingGitRepo?: boolean
  /** 部署目標。void 需要一個 scaffold 完成後才做得到的必要步驟，見收尾警告。 */
  deployTarget?: 'cloudflare' | 'void' | 'node'
  /** 使用者勾選的 AI runtime。決定要不要跑 Cursor 投影。預設只有 claude-code。 */
  agentTargets?: readonly ('claude-code' | 'codex' | 'cursor')[]
}

/**
 * pnpm v11 遇到未表態的 build script 時，會把它寫進 `pnpm-workspace.yaml` 的
 * `allowBuilds`，值是佔位字串 `set this to true or false`，然後以退出碼 1 abort。
 * 回傳這些待表態的套件名（沒有就空陣列）。
 *
 * 這是「安裝其實成功、但退出碼是 1」的唯一已知形狀 —— 拿它來把這一種與真的安裝失敗
 * 分開，NEVER 靠退出碼本身判斷。
 */
export function readPendingBuildApprovals(targetDir: string): string[] {
  const wsPath = join(targetDir, 'pnpm-workspace.yaml')
  if (!existsSync(wsPath)) return []

  let content: string
  try {
    content = readFileSync(wsPath, 'utf8')
  } catch {
    return []
  }

  const pending: string[] = []
  for (const line of content.split('\n')) {
    const match = /^\s+'?([^':]+)'?:\s*set this to true or false\s*$/.exec(line)
    if (match) pending.push(match[1])
  }
  return pending
}

export async function postScaffold(
  targetDir: string,
  projectName: string,
  invocationCwd: string,
  cladeModules: CladeModules,
  opts: PostScaffoldOptions,
): Promise<void> {
  // Use the user's actual cwd for the cd hint, not invocationCwd
  // (which may differ when running inside the monorepo).
  // NEVER 退回 process.env.PWD：那是呼叫者 shell 的值，不隨 spawn 的 cwd 改變，
  // 會讓 cd 提示指到完全無關的目錄（TD-007，與 cli.ts detectMonorepoRoot 同型）。
  const userCwd = process.env.INIT_CWD?.trim() || process.cwd()
  const relativeTargetDir = relative(userCwd, targetDir) || '.'

  // 1. Register as clade consumer — rewrite .claude/hub.json with the
  //    selected modules and inject postinstall + hub:* scripts into
  //    package.json. --no-bootstrap defers the heavy sync to pnpm install.
  //    If clade is missing, may attempt to git clone it (controlled by opts.cloneClade).
  const cladeRoot = await runInitConsumer(targetDir, cladeModules, opts)

  // 2. Install dependencies — postinstall hook runs clade bootstrap-hub
  //    which pulls fresh rules / skills / hooks / scripts into .claude/.
  //
  // pnpm v11 對「未表態的 build script」是 abort（退出碼 1），不是警告。未表態的套件
  // 會被 pnpm 自己寫進 pnpm-workspace.yaml 的 allowBuilds，值是佔位字串
  // `set this to true or false`。原本這裡的 retry 建立在「第一次只是警告、retry 必通過」
  // 的假設上 —— 實測是錯的：兩次都以同一個原因退出 1，而套件其實已經裝好了。
  // 所以 retry 保留（真的有瞬時失敗），但失敗後 MUST 分辨這一種：它不是安裝失敗。
  // 三態：true / undefined 都要裝，只有顯式 false 才跳過。
  const skipInstall = opts.installDeps === false
  let pnpmInstalled = false
  if (skipInstall) {
    consola.info('已跳過依賴安裝（--no-install）。')
    consola.log(`  需要時手動執行：cd ${relativeTargetDir} && pnpm install`)
  } else {
    consola.start('正在安裝依賴套件...')
    for (const attempt of [1, 2]) {
      try {
        execFileSync('pnpm', ['install'], { cwd: targetDir, stdio: 'inherit' })
        consola.success('依賴套件安裝完成！')
        pnpmInstalled = true
        break
      } catch (error) {
        const pending = readPendingBuildApprovals(targetDir)
        if (pending.length > 0) {
          consola.warn('pnpm 因為有未表態的 build script 而退出，依賴其實已經裝好。')
          consola.log(`  待表態：${pending.join(', ')}`)
          consola.log(`  修法：編輯 ${relativeTargetDir}/pnpm-workspace.yaml 的 allowBuilds，`)
          consola.log('        把上面每個 key 的值從佔位字串改成 true（或 false）。')
          consola.log('  這通常代表 starter 的 allowBuilds 預設清單少了東西，值得回報。')
          pnpmInstalled = true
          break
        }
        if (attempt === 1) {
          consola.warn('第一次 pnpm install 失敗，自動 retry 一次...')
          continue
        }
        consola.warn(`依賴套件安裝失敗：${(error as Error).message}`)
        consola.log(`  上方為 pnpm 實際輸出；修正後手動執行：`)
        consola.log(`  cd ${relativeTargetDir} && pnpm install`)
      }
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
    // 順序 MUST 是 codex → cursor：sync-to-cursor 的 pre-sync gate 會檢查 AGENTS.md
    // 在不在，而 AGENTS.md 由 sync-to-codex 產。反過來跑會拿到一條假的 critical lossy。
    if (opts.agentTargets?.includes('cursor')) {
      runSyncToCursor(targetDir)
    }
  } else if (skipInstall) {
    consola.info('略過 sync-to-agents（依賴未安裝）。裝完依賴後手動：')
    consola.log(`  cd ${relativeTargetDir} && node ~/.claude/scripts/sync-to-codex.mjs`)
  } else {
    consola.warn('略過 sync-to-agents — 請在 pnpm install 成功後手動：')
    consola.log(`  cd ${relativeTargetDir} && node ~/.claude/scripts/sync-to-codex.mjs`)
  }

  // 4.5 Typecheck — scaffold 的自我驗證。在此之前沒有任何一步確認「產出的專案編得過」，
  //     而 scaffold 最容易壞的正是模板與套件版本脫節（feature 組合是動態的，模板是靜態的）。
  //     失敗不中止：檔案都已落地，使用者需要的是知道哪裡壞了，不是回到零。
  if (pnpmInstalled) {
    consola.start('驗證產出的專案編得過（pnpm typecheck）...')
    try {
      execFileSync('pnpm', ['typecheck'], { cwd: targetDir, stdio: 'inherit' })
      consola.success('typecheck 通過。')
    } catch {
      consola.warn('typecheck 沒過 —— scaffold 產出的專案有型別錯誤。')
      consola.log('  上方為 tsc 實際輸出。這代表模板與當前套件版本脫節，值得回報。')
      consola.log(`  重跑：cd ${relativeTargetDir} && pnpm typecheck`)
    }
  }

  // 5. Initialize git
  const adoptingRepo = opts.existingGitRepo === true
  consola.start(adoptingRepo ? '正在提交 starter 檔案...' : '正在初始化 Git...')
  try {
    if (!adoptingRepo) {
      execFileSync('git', ['init'], { cwd: targetDir, stdio: 'pipe' })
    }
    execFileSync('git', ['add', '-A'], { cwd: targetDir, stdio: 'pipe' })
    execFileSync(
      'git',
      [
        'commit',
        '-m',
        adoptingRepo
          ? 'chore: scaffold nuxt starter into existing repo'
          : 'chore: initial project scaffold',
      ],
      { cwd: targetDir, stdio: 'pipe' },
    )
    consola.success(adoptingRepo ? 'starter 檔案已提交（既有歷史保留）！' : 'Git 初始化完成！')
  } catch {
    consola.warn(adoptingRepo ? 'Git 提交失敗，請手動執行。' : 'Git 初始化失敗，請手動執行。')
  }

  // 6. Register as clade consumer (idempotent; opt-out via --no-register-consumer)
  let consumerRegistered = false
  if (cladeRoot && opts.registerConsumer) {
    consumerRegistered = await maybeRegisterConsumer(cladeRoot, targetDir, opts)
  }

  // 6b. Mint gate playbook pack（缺才寫）。template 已帶一份 placeholder pack；
  // clade 有 mint script 時再填 consumer / port。沒有 script（尚未 publish）不算失敗。
  if (cladeRoot) {
    maybeMintGatePlaybooks(cladeRoot, targetDir, opts)
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
  ]

  // 收尾步驟 MUST 依 dbStack 分流到底：`scripts/setup.sh` 會檢查 Supabase CLI，
  // 找不到就直接中止。把它端給沒有 Supabase 的軌（void-d1 / nuxthub-d1），使用者
  // 會照著撞牆，然後以為是 scaffold 壞了。
  const resolvedDbStack = opts.dbStack ?? DEFAULT_DB_STACK
  if (resolvedDbStack === 'nuxthub-d1') {
    nextSteps.push(
      '  npx nuxthub link        # 連結 NuxtHub project',
      '  pnpm hub:db:migrations:apply --local',
      '  pnpm dev                # 啟動本機開發伺服器',
      '  pnpm verify:starter     # 檢查 scaffold 狀態',
    )
  } else if (resolvedDbStack === 'void-d1') {
    // 這條軌沒有 Supabase：D1 由 void 託管，schema 走 `void/db`。
    nextSteps.push(
      '  npx void init --agents   # 必要：產生 void.json / wrangler.jsonc（詳見下方警告）',
      '  pnpm dev                 # 啟動開發伺服器',
      '  pnpm verify:starter      # 檢查 scaffold 狀態',
    )
  } else {
    nextSteps.push(
      '  pnpm run setup           # 檢查環境 → 啟動 Supabase → 產生型別',
      '  pnpm dev                 # 啟動開發伺服器',
    )
  }

  if (cladeRoot && !consumerRegistered) {
    nextSteps.push(
      '',
      '尚未完成 Clade fleet 登記；請從 Clade 執行 project-bootstrap：',
      `  cd ${cladeRoot}`,
      `  /project-bootstrap adopt --consumer "${targetDir}" --repo-id <owner/repo> --dev-port <port>`,
    )
  }

  if (cladeRoot && !preCommitWired) {
    nextSteps.push(
      '',
      '選用 — wire pre-commit hook（擋掉 clade-managed 檔的本地誤改）：',
      `  cp ${cladeRoot}/vendor/git-pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`,
      '  # 或（已用 husky）：echo "pnpm hub:check" >> .husky/pre-commit',
    )
  }

  consola.log('')
  consola.box(nextSteps.join('\n'))

  // void 的 config 與 compatibility 設定跟 `void` npm package 版本鎖步，所以 starter
  // 刻意不產 void.json / wrangler.jsonc —— 抄某個時點的值進模板會變成會過期的地雷。
  // 代價是 scaffold 完還缺一步，而這一步缺了會在**部署當下**才炸。
  // 用 warn 不用 info、也不放進上面的 box：box 讀起來像補充說明，這是缺一步。
  if (opts.deployTarget === 'void') {
    consola.log('')
    consola.warn('void.cloud：還差一步，現在還不能部署')
    consola.log(`  cd ${relativeTargetDir} && npx void init --agents`)
    consola.log('')
    consola.log('  它會產生當前版本正確的 wrangler.jsonc，並裝上官方 void skill + MCP')
    consola.log('  （agent 之後查 void 用法的權威來源）。')
    consola.log('  nuxt.config 的 voidPlugin() 接線由 scaffold 直接寫好了 —— void init 不做這件事')
    consola.log('  （void 0.10.12 實測），也不產 void.json。')
    consola.log('')
    consola.log('  接著把 repo 連到 void project（staging / production 各做一次）：')
    consola.log('    void github connect <staging-slug> --repo <owner/repo> --branch main \\')
    consola.log('      --executor github_actions --workflow .github/workflows/deploy-staging.yml')
    consola.log('    void github connect <prod-slug> --repo <owner/repo> --branch main \\')
    consola.log(
      '      --executor github_actions --workflow .github/workflows/deploy-production.yml',
    )
    consola.log('')
    consola.log('  最後在 GitHub 設 repository variables（不是 secrets）：')
    consola.log('    VOID_PROJECT_STAGING / VOID_PROJECT')
    consola.log('  部署認證走 GitHub OIDC，沒有 token 要保管。')
  }
}

export function buildRegisterConsumerArgs(
  script: string,
  targetDir: string,
  repoId: string,
  workflowModel: 'trunk-based' | 'pr-merge-based',
  businessActivity: 'pre-production' | 'active' | 'maintenance' | 'paused' | 'auto',
  devPort: number | 'auto',
  extras?: {
    deployTrack?: PostScaffoldOptions['deployTrack']
    dbRuntime?: PostScaffoldOptions['dbRuntime']
  },
): string[] {
  const args = [
    script,
    '--consumer',
    targetDir,
    '--repo-id',
    repoId,
    '--workflow-model',
    workflowModel,
    '--business-activity',
    businessActivity,
    '--dev-port',
    String(devPort),
  ]
  if (extras?.deployTrack) {
    args.push('--deploy-track', extras.deployTrack)
  }
  if (extras?.dbRuntime) {
    args.push('--db-runtime', extras.dbRuntime)
  }
  return args
}

export function buildMintGatePlaybooksArgs(
  script: string,
  targetDir: string,
  consumerSlug: string,
  devPort?: number | 'auto',
): string[] {
  const args = [script, '--consumer-root', targetDir, '--consumer', consumerSlug]
  if (typeof devPort === 'number') {
    args.push('--dev-port', String(devPort), '--oauth-origin', `http://127.0.0.1:${devPort}`)
  }
  return args
}

export function maybeMintGatePlaybooks(
  cladeRoot: string,
  targetDir: string,
  opts: Pick<PostScaffoldOptions, 'devPort'>,
): boolean {
  const script = join(cladeRoot, 'scripts', 'mint-gate-playbooks.ts')
  if (!existsSync(script)) {
    consola.info('Clade checkout 尚無 mint-gate-playbooks.ts — 使用 template 內建 pack')
    return false
  }
  const args = buildMintGatePlaybooksArgs(script, targetDir, basename(targetDir), opts.devPort)
  try {
    execFileSync('node', args, { cwd: cladeRoot, stdio: 'pipe' })
    consola.success('gate playbook pack 已 mint（缺才寫）')
    return true
  } catch (error) {
    consola.warn(`mint gate playbook pack 失敗：${(error as Error).message}`)
    return false
  }
}

export interface PreflightOutcome {
  status: 'ok' | 'skipped' | 'rejected'
  reason?: string
}

/**
 * Scaffold **之前**問 Clade：「這個位置 / 身分 / port 登記得進去嗎？」
 *
 * 沒有這一步時，fleet base 這類約束要等整個 scaffold + pnpm install 跑完
 * （實測數分鐘）才在最後一步 warn，而那時專案已經建在錯的位置上了。
 *
 * 判準交給 Clade 的 register-consumer.ts --preflight，**NEVER** 在這裡重寫
 * fleet base 的計算 —— 兩份會漂，而漂掉的那份不會有任何訊號。
 */
export function preflightCladeRegistration(
  cladeRoot: string,
  targetDir: string,
  opts: Pick<
    PostScaffoldOptions,
    'repoId' | 'workflowModel' | 'businessActivity' | 'devPort' | 'deployTrack' | 'dbRuntime'
  >,
): PreflightOutcome {
  if (!opts.repoId) return { status: 'skipped', reason: '未給 --repo-id' }

  const script = join(cladeRoot, 'scripts', 'register-consumer.ts')
  if (!existsSync(script)) return { status: 'skipped', reason: `找不到 ${script}` }

  const args = [
    ...buildRegisterConsumerArgs(
      script,
      targetDir,
      opts.repoId,
      opts.workflowModel ?? 'trunk-based',
      opts.businessActivity ?? 'pre-production',
      opts.devPort ?? 'auto',
      { deployTrack: opts.deployTrack, dbRuntime: opts.dbRuntime },
    ),
    '--preflight',
    '--json',
  ]

  try {
    execFileSync('node', args, { cwd: cladeRoot, stdio: 'pipe' })
    return { status: 'ok' }
  } catch (error) {
    const message = String(
      (error as { stderr?: Buffer | string }).stderr ?? (error as Error).message,
    ).trim()
    // 舊版 Clade 還沒有 --preflight，會回 unknown flag。那是版本落差不是
    // 這次 scaffold 有問題 —— 略過 preflight，讓 scaffold 照舊往下走。
    if (/unknown flag: --preflight/.test(message)) {
      return { status: 'skipped', reason: 'Clade checkout 尚未支援 --preflight' }
    }
    return { status: 'rejected', reason: message }
  }
}

export async function maybeRegisterConsumer(
  cladeRoot: string,
  targetDir: string,
  opts: PostScaffoldOptions,
): Promise<boolean> {
  if (!opts.repoId) {
    consola.warn('缺少 --repo-id，已完成 project-local 初始化但尚未登記 Clade fleet')
    return false
  }
  if (opts.devPort === undefined) {
    consola.warn('缺少 --dev-port，已完成 project-local 初始化但尚未登記 Clade fleet')
    return false
  }

  const script = join(cladeRoot, 'scripts', 'register-consumer.ts')
  if (!existsSync(script)) {
    consola.warn(`Clade checkout 缺少 register-consumer.ts：${script}`)
    return false
  }

  if (!opts.yes) {
    const confirmed = await consola.prompt(`把 ${opts.repoId} 登記到 Clade registry？`, {
      type: 'confirm',
      initial: true,
    })
    if (!confirmed) {
      consola.info('已跳過 Clade fleet 登記')
      return false
    }
  }

  const workflowModel = opts.workflowModel ?? 'trunk-based'
  const businessActivity = opts.businessActivity ?? 'pre-production'
  const args = buildRegisterConsumerArgs(
    script,
    targetDir,
    opts.repoId,
    workflowModel,
    businessActivity,
    opts.devPort,
    { deployTrack: opts.deployTrack, dbRuntime: opts.dbRuntime },
  )
  try {
    execFileSync('node', args, { cwd: cladeRoot, stdio: 'pipe' })
    consola.success(`已登記到 Clade registry：${opts.repoId}`)
    return true
  } catch (error) {
    consola.warn(`Clade registry 登記失敗：${(error as Error).message}`)
    return false
  }
}

async function maybeWirePreCommit(
  cladeRoot: string,
  targetDir: string,
  nonInteractive: boolean,
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
      { type: 'confirm', initial: true },
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
    // instructions MUST 自給自足：原本結尾把讀者導到 starter 的 template/docs/ 底下
    // 那份 agent 指南，但 scaffold **不會複製**它（只複製 root AGENTS.md），所以每個
    // scaffold 出去的專案都拿到一個指向不存在檔案的指標。
    // 步驟本身也 MUST 只列產生出來的 script —— 舊版列了 pnpm spectra:claims，
    // 而那個 script 當時沒被寫進 package.json。
    instructions: [
      'AI agent: 看到此檔代表 scaffold 剛完成，請先跑首輪暖機再開始任何開發。',
      '(1) pnpm verify:starter —— 機械化驗收。exit 0=全過 / 2=有 WARN（環境仍可用）/ 1=有 FAIL。',
      '(2) pnpm spectra:roadmap —— 重算 ROADMAP（首次跑會建立基礎結構）。',
      '(3) pnpm spectra:claims —— 確認沒有殘留 claim。',
      '(4) 依 verify:starter 的 WARN/FAIL 列出 next-step 給使用者（缺的 env var、OAuth console URL 都會印在輸出裡）。',
      '(5) 暖機完成後 rm .claude/.first-run。',
    ].join('\n'),
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
      { type: 'confirm', initial: true },
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

export function findCladeRoot(): string | undefined {
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

/**
 * 這支 script 被改過名（`sync-to-agents` → `sync-to-codex`），且同時存在 `.mjs`
 * 與 `.ts` 兩種投影。寫死單一檔名的後果是「找不到就靜默跳過」——改名之後
 * 每一次 scaffold 都不再產 `.codex/` 與 `AGENTS.md`，而使用者只會看到一行
 * 略過警告，不會知道專案少了東西。所以這裡按序探測，全部落空才報。
 */
// 順序 MUST 是 `.ts` 在前：clade 自 `.mjs` → `.ts` 改名後，user shim 的安裝只增不減，
// 於是很多機器上仍留著一支**指向已不存在的 `run-sync-to-codex.mjs`** 的死 `.mjs`。
// 2026-08-24 全新 scaffold 實測，`.mjs` 排前面就固定挑到那支死的：
//   Error: Cannot find module '<clade>/scripts/run-sync-to-codex.mjs'
// clade v1.11.63 起 bootstrap-hub 會主動剪除它，但已存在的機器要下一次 bootstrap 才清掉。
const SYNC_TO_CODEX_CANDIDATES = [
  'sync-to-codex.ts',
  'sync-to-codex.mjs',
  // 舊名，保留給還沒更新 ~/.claude/scripts 的機器
  'sync-to-agents.mjs',
]

export function resolveSyncToCodexScript(scriptsDir: string): string | undefined {
  for (const name of SYNC_TO_CODEX_CANDIDATES) {
    const candidate = join(scriptsDir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * 同 SYNC_TO_CODEX_CANDIDATES 的理由：按序探測，NEVER 寫死單一檔名。
 * 這支比 codex 那支年輕（2026-08-24 才進 clade），所以還沒有舊名要相容 ——
 * 但形狀先立好，改名時才不會重演「靜默不產投影」。
 */
// 同上：`.ts` 在前。cursor 這支比 codex 年輕，目前沒有死 `.mjs` 的實例，但形狀先立好。
const SYNC_TO_CURSOR_CANDIDATES = ['sync-to-cursor.ts', 'sync-to-cursor.mjs']

export function resolveSyncToCursorScript(scriptsDir: string): string | undefined {
  for (const name of SYNC_TO_CURSOR_CANDIDATES) {
    const candidate = join(scriptsDir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function runSyncToCursor(targetDir: string): void {
  const scriptsDir = join(homedir(), '.claude', 'scripts')
  const script = resolveSyncToCursorScript(scriptsDir)
  if (!script) {
    consola.warn(
      `在 ~/.claude/scripts/ 找不到 ${SYNC_TO_CURSOR_CANDIDATES.join(' / ')}，略過 .cursor/ 重投影`,
    )
    consola.log('  專案裡的 .cursor/ 會停在 starter 附帶的版本，不會反映本專案選的 modules。')
    consola.log('  clade 需要 v1.11.62+；升級後手動：')
    consola.log(`  cd ${targetDir} && node ~/.claude/scripts/sync-to-cursor.ts`)
    return
  }
  consola.start('重投影 .cursor/（Claude Code First → Cursor projection）')
  try {
    execFileSync('node', [script], { cwd: targetDir, stdio: 'pipe' })
    consola.success('Cursor projection 重生完成')
  } catch (error) {
    consola.warn(`${basename(script)} 執行失敗：${(error as Error).message}`)
    consola.log(`  之後可手動：node ${script}`)
  }
}

function runSyncToAgents(targetDir: string): void {
  const scriptsDir = join(homedir(), '.claude', 'scripts')
  const script = resolveSyncToCodexScript(scriptsDir)
  if (!script) {
    consola.warn(
      `在 ~/.claude/scripts/ 找不到 ${SYNC_TO_CODEX_CANDIDATES.join(' / ')}，` +
        '略過 .codex/.agents/AGENTS.md 重投影',
    )
    consola.log('  這代表專案不會有 Codex / Cursor 的投影檔。只用 Claude Code 的話可以忽略。')
    return
  }
  consola.start('重投影 .codex/.agents/AGENTS.md（Claude Code First → projections）')
  try {
    execFileSync('node', [script], { cwd: targetDir, stdio: 'pipe' })
    consola.success('Projection 重生完成')
  } catch (error) {
    consola.warn(`${basename(script)} 執行失敗：${(error as Error).message}`)
    consola.log(`  之後可手動：node ${script}`)
  }
}

async function runInitConsumer(
  targetDir: string,
  mods: CladeModules,
  opts: PostScaffoldOptions,
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

  const script = resolveCladeInitScript(cladeRoot)
  if (!script) {
    consola.warn(`找到 clade 但缺 init-consumer.ts / init-consumer.mjs：${cladeRoot}`)
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

export function resolveCladeInitScript(cladeRoot: string): string | undefined {
  for (const filename of ['init-consumer.ts', 'init-consumer.mjs']) {
    const candidate = join(cladeRoot, 'scripts', filename)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}
