#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/pulls-review.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pulls-review.ts
/**
 * pulls-review.ts — 以 fleet 固定設定啟動 pulls.review 本機閱讀器（分組過的 diff 閱讀入口）
 *
 * 上游 CLI（antfu/pulls.review）自己標明 "Heavily work in progress"，而且 Local agent 的 model
 * 只能在瀏覽器 Settings 選、沒選就吃 `claude` 的預設 model。本 script 把四件事固定下來：
 *
 * - 鎖住整棵相依：版本寫在同目錄的 `pulls-review.package.json`，連 transitive 的解析結果寫在
 *   `pulls-review.pnpm-lock`。上游套件自己的相依是 caret range（啟動 server、讀 `gh auth
 *   token`、spawn `claude` 的程式都在那裡），所以不經 npx：以 `pnpm install --frozen-lockfile
 *   --ignore-scripts` 裝進 `~/.cache/clade/pulls-review/<兩檔的 hash>/`，再直接跑裡面的 bin。
 *   上游發新版不會改變這裡跑的程式；升版＝重產 lockfile 的那個 commit（做法見下方「升版」）。
 * - 固定 port：瀏覽器設定綁在 `localhost:<port>`，port 一變設定就不見。
 * - Local agent 的 model 逐次指定，預設 Sonnet：頁面 Settings 選的 model 存在瀏覽器裡，選過一次
 *   `opus` 之後每次分析都會帶 `--model opus`，而且畫面不提醒。所以 server 的 `PATH` 最前面放一支
 *   `claude` shim（就是本 script 的 `--claude-shim` 模式）：丟掉頁面帶來的 `--model`，改帶這一次啟動
 *   指定的 model——不帶 `--model` 旗標就是 Sonnet，要用 Opus 就那一次加 `--model opus`。頁面的
 *   model 選單因此不生效。`ANTHROPIC_MODEL` 也設成同一個 model，蓋過 user／專案層 settings 的 pin。
 *   這層**只管 Local agent 選 Claude Code 的那條路**：Settings 改選 OpenCode、或改用自填 API key 的
 *   provider（AI Gateway／Anthropic／OpenAI-compatible）時，分析不經過 shim，用哪個 model、算誰的
 *   額度或帳單都不受本 script 控制；啟動時只印一行提醒。
 * - 清掉 gateway／計費 env：gateway 會把 `opus` 映射成別家 model，`ANTHROPIC_API_KEY` 會把分析
 *   改成按量計費。清的是 `cc`／`ccw` launcher 清的同一組。
 *
 * 本 script 只啟動 server；AI 分析要人在頁面上按才會跑。NEVER 從 hook、gate、batch 呼叫它。
 *
 * Usage:
 *   node vendor/scripts/pulls-review.ts [<target>] [--worktree] [--port <n>] [--model <sonnet|opus>] [--dry-run]
 *
 *   <target>  PR 編號（`123`／`#123`，展開成本 repo 的 `owner/repo#123`）、`owner/repo#123`、
 *             github.com 網址，或 git revision／range（`HEAD`、`main...feat`）。省略＝目前 branch。
 *   --model   這一次啟動的 Local agent model；省略＝sonnet。只管這一次，下次啟動回到 sonnet。
 *   --dry-run 只印出會執行的指令與 env 差異（JSON），不啟動。
 *
 *   --dry-run 不安裝；`install.installed` 回報這份 lockfile 的安裝目錄是否已存在。
 *
 * 升版（兩個檔一起改，NEVER 手改 lockfile）：把 `pulls-review.package.json` 複製成空目錄裡的
 * `package.json`、改版本（MUST 是確切版本，不帶 `^`／`~`），在該目錄跑
 * `pnpm install --lockfile-only --ignore-workspace --ignore-scripts`，再把 `package.json` 與
 * `pnpm-lock.yaml` 複製回這兩個檔名。檔名刻意不叫 `package.json`／`pnpm-lock.yaml`：投影到 consumer
 * 的 `scripts/` 之後，不該被 workspace、Renovate 或 Dependabot 當成那個 repo 的套件。
 *
 * Exit: 上游 CLI 的 exit code／1 安裝失敗（含找不到 pnpm）／2 用法錯誤或 PR 編號解析不出 repo
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, hostname, userInfo } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MANIFEST_FILE = 'pulls-review.package.json'
export const LOCK_FILE = 'pulls-review.pnpm-lock'
/** frozen：lockfile 與 manifest 對不上就拒裝，不重新解析；不跑任何套件的 install script。 */
export const INSTALL_COMMAND = 'pnpm'
export const INSTALL_ARGS = [
  'install',
  '--frozen-lockfile',
  '--ignore-scripts',
  '--ignore-workspace',
] as const
const INSTALLED_MARKER = '.clade-installed'

export interface LockedDeps {
  manifest: string
  lock: string
  /** `pulls.review` 的確切版本（manifest 寫的）。 */
  version: string
  /** 兩個檔內容的 hash；安裝目錄以它命名，所以改 lockfile 就換一個目錄。 */
  hash: string
}

export function readLockedDeps(dir: string = import.meta.dirname): LockedDeps {
  const manifest = readFileSync(join(dir, MANIFEST_FILE), 'utf8')
  const lock = readFileSync(join(dir, LOCK_FILE), 'utf8')
  const parsed: unknown = JSON.parse(manifest)
  const dependencies =
    typeof parsed === 'object' && parsed !== null && 'dependencies' in parsed
      ? parsed.dependencies
      : undefined
  const version =
    typeof dependencies === 'object' && dependencies !== null && 'pulls.review' in dependencies
      ? dependencies['pulls.review']
      : undefined
  if (typeof version !== 'string')
    throw new Error(`${MANIFEST_FILE} 沒有 dependencies["pulls.review"]`)
  const hash = createHash('sha256')
    .update(manifest)
    .update('\0')
    .update(lock)
    .digest('hex')
    .slice(0, 16)
  return { manifest, lock, version, hash }
}

function cacheRoot(env: Record<string, string | undefined>, home: string): string {
  return join(env.XDG_CACHE_HOME || join(home, '.cache'), 'clade', 'pulls-review')
}

export function installDirFor(
  hash: string,
  env: Record<string, string | undefined>,
  home: string,
): string {
  return join(cacheRoot(env, home), hash)
}

/** 放 `claude` shim 的目錄；shim 內容固定（路徑都從 env 讀），所以所有啟動共用一份。 */
export function shimDirFor(env: Record<string, string | undefined>, home: string): string {
  return join(cacheRoot(env, home), 'shim')
}

export const PULLS_REVIEW_PORT = 7390
/** `--model` 旗標收的別名 → 交給 `claude --model` 的 id。寫確切 id，不靠 `claude` 自己解析別名。 */
export const LOCAL_AGENT_MODELS = {
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
} as const
export const LOCAL_AGENT_DEFAULT_MODEL = LOCAL_AGENT_MODELS.sonnet

export const SHIM_FLAG = '--claude-shim'
const SHIM_ENV = {
  model: 'CLADE_PULLS_REVIEW_MODEL',
  realClaude: 'CLADE_PULLS_REVIEW_REAL_CLAUDE',
  shimDir: 'CLADE_PULLS_REVIEW_SHIM_DIR',
  node: 'CLADE_PULLS_REVIEW_NODE',
  wrapper: 'CLADE_PULLS_REVIEW_WRAPPER',
} as const
/** shim 本體：把呼叫原樣轉給本 script 的 shim 模式。路徑都從 env 讀，內容不隨啟動改變。 */
export const SHIM_SCRIPT = `#!/bin/sh\nexec "$${SHIM_ENV.node}" "$${SHIM_ENV.wrapper}" ${SHIM_FLAG} "$@"\n`

/**
 * 丟掉呼叫端（頁面 Settings）帶來的 `--model`，分析呼叫（`-p`）改帶這一次啟動指定的 model。
 * 放在最前面：上游的 argv 尾端是吃多個值的 `--allowedTools`／`--disallowedTools`。
 * 非分析呼叫（`claude --version` 的偵測）只丟不加。
 */
export function rewriteClaudeArgs(argv: string[], model: string): string[] {
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--model') i++
    else if (!argv[i].startsWith('--model=')) rest.push(argv[i])
  }
  return rest.includes('-p') || rest.includes('--print') ? ['--model', model, ...rest] : rest
}

/** `cc`／`ccw` launcher 清的同一組：gateway 路由、gateway 的 model 映射、按量計費的 key。 */
export const STRIPPED_ENV = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_OAUTH_TOKEN',
] as const

const USAGE =
  'usage: pulls-review.ts [<target>] [--worktree] [--port <n>] [--model <sonnet|opus>] [--dry-run]'

export interface LaunchPlan {
  command: string
  args: string[]
  env: Record<string, string | undefined>
  stripped: string[]
  port: number
  /** 這份 lockfile 的安裝目錄；`command` 是裡面的 bin。 */
  installDir: string
  /** 這一次啟動的 Local agent model（確切 id）。 */
  model: string
  /** 真的 `claude` 的路徑；`null`＝PATH 上找不到，沒有 shim，Local agent 也用不了。 */
  realClaude: string | null
  shimDir: string
  /** SSH session 才有：要在自己電腦上跑的 port forward 指令。 */
  sshForward: string | null
  dryRun: boolean
}

export interface PlanContext {
  /** 本 repo 的 `owner/repo`；只有 target 是 PR 編號時才會被呼叫。 */
  repoSlug: () => string | null
  user: string
  host: string
  installDir: string
  shimDir: string
  /** 在原本的 PATH 上找真的 `claude`（shim 目錄不算）。 */
  realClaude: () => string | null
  /** shim 要用來跑本 script 的 node 與本 script 的路徑。 */
  node: string
  wrapper: string
}

export class UsageError extends Error {}

/** `git@github.com:o/r.git`／`https://github.com/o/r(.git)` → `o/r`。 */
export function slugFromRemoteUrl(url: string): string | null {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())
  return m ? `${m[1]}/${m[2]}` : null
}

export function buildPlan(
  argv: string[],
  env: Record<string, string | undefined>,
  ctx: PlanContext,
): LaunchPlan {
  let target: string | undefined
  let worktree = false
  let dryRun = false
  let port = PULLS_REVIEW_PORT
  let model: string = LOCAL_AGENT_DEFAULT_MODEL
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--worktree') worktree = true
    else if (a === '--dry-run') dryRun = true
    else if (a === '--port') {
      port = Number(argv[++i])
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new UsageError(`--port 需要 1–65535 的整數（${USAGE}）`)
    } else if (a === '--model') {
      const alias = argv[++i]
      if (alias !== 'sonnet' && alias !== 'opus')
        throw new UsageError(`--model 只收 sonnet 或 opus（${USAGE}）`)
      model = LOCAL_AGENT_MODELS[alias]
    } else if (a.startsWith('--')) throw new UsageError(`unknown flag ${a}（${USAGE}）`)
    else if (target === undefined) target = a
    else throw new UsageError(`只收一個 target（${USAGE}）`)
  }

  const prNumber = target === undefined ? null : /^#?(\d+)$/.exec(target)
  if (prNumber) {
    const slug = ctx.repoSlug()
    if (!slug)
      throw new UsageError(
        `PR 編號 ${target} 解析不出本 repo 的 owner/repo（origin 不是 github.com？）；改給 owner/repo#${prNumber[1]}`,
      )
    target = `${slug}#${prNumber[1]}`
  }

  const ssh = Boolean(env.SSH_CONNECTION)
  const args: string[] = []
  if (target !== undefined) args.push(target)
  if (worktree) args.push('--worktree')
  args.push('--port', String(port))
  if (ssh) args.push('--no-open')

  const childEnv: Record<string, string | undefined> = { ...env }
  const stripped: string[] = []
  for (const key of STRIPPED_ENV)
    if (childEnv[key] !== undefined) {
      delete childEnv[key]
      stripped.push(key)
    }
  childEnv.ANTHROPIC_MODEL = model
  const realClaude = ctx.realClaude()
  if (realClaude) {
    childEnv[SHIM_ENV.model] = model
    childEnv[SHIM_ENV.realClaude] = realClaude
    childEnv[SHIM_ENV.shimDir] = ctx.shimDir
    childEnv[SHIM_ENV.node] = ctx.node
    childEnv[SHIM_ENV.wrapper] = ctx.wrapper
    childEnv.PATH = [ctx.shimDir, env.PATH].filter(Boolean).join(delimiter)
  }

  return {
    command: join(ctx.installDir, 'node_modules', '.bin', 'pulls.review'),
    args,
    env: childEnv,
    stripped,
    port,
    installDir: ctx.installDir,
    model,
    realClaude,
    shimDir: ctx.shimDir,
    sshForward: ssh ? `ssh -L ${port}:localhost:${port} ${ctx.user}@${ctx.host}` : null,
    dryRun,
  }
}

function originSlug(): string | null {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' })
  return r.status === 0 ? slugFromRemoteUrl(r.stdout) : null
}

/** `PATH` 上第一支可執行的 `claude`，跳過 shim 目錄（從 shim 模式或巢狀啟動呼叫時它已經在 PATH 上）。 */
export function findOnPath(
  name: string,
  pathValue: string | undefined,
  skipDir: string,
): string | null {
  for (const dir of (pathValue ?? '').split(delimiter)) {
    if (!dir || dir === skipDir) continue
    const candidate = join(dir, name)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // 這個目錄沒有
    }
  }
  return null
}

export function ensureShim(shimDir: string): void {
  const target = join(shimDir, 'claude')
  if (existsSync(target) && readFileSync(target, 'utf8') === SHIM_SCRIPT) return
  mkdirSync(shimDir, { recursive: true })
  const staging = `${target}.tmp-${process.pid}`
  writeFileSync(staging, SHIM_SCRIPT, { mode: 0o755 })
  renameSync(staging, target)
}

/** shim 模式：server 以為自己在跑 `claude`。改寫 argv 後換成真的那一支，訊號與 exit code 原樣傳遞。 */
function runShim(argv: string[]): void {
  const real = process.env[SHIM_ENV.realClaude]
  const model = process.env[SHIM_ENV.model]
  if (!real || !model) {
    process.stderr.write(
      'pulls-review：claude shim 缺少啟動時的 env；請用 pulls-review.ts 重新啟動\n',
    )
    process.exit(127)
  }
  // 真的 claude 與它的子行程不該再繞回 shim。
  const env = { ...process.env }
  const shimDir = env[SHIM_ENV.shimDir]
  env.PATH = (env.PATH ?? '')
    .split(delimiter)
    .filter((dir) => dir !== shimDir)
    .join(delimiter)
  const child = spawn(real, rewriteClaudeArgs(argv, model), { stdio: 'inherit', env })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.on(signal, () => child.kill(signal))
  child.on('error', (error) => {
    process.stderr.write(`pulls-review：claude shim 啟動 ${real} 失敗：${error.message}\n`)
    process.exit(127)
  })
  child.on('close', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
}

export function isInstalled(installDir: string): boolean {
  return existsSync(join(installDir, INSTALLED_MARKER))
}

/**
 * 裝在旁邊的暫存目錄、裝完才 rename 成 `installDir`：中斷的安裝不會留下一個看起來可用的目錄，
 * 兩個同時啟動的 wrapper 也不會互相寫到一半。
 */
export function ensureInstalled(installDir: string, deps: LockedDeps): void {
  if (isInstalled(installDir)) return
  const staging = `${installDir}.tmp-${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  try {
    writeFileSync(join(staging, 'package.json'), deps.manifest)
    writeFileSync(join(staging, 'pnpm-lock.yaml'), deps.lock)
    process.stderr.write(
      `pulls-review：第一次用這份 lockfile（${deps.hash}），安裝 pulls.review@${deps.version} 到 ${installDir}\n`,
    )
    // pnpm 的進度寫到 stderr：stdout 只留給上游 CLI 印網址。
    const r = spawnSync(INSTALL_COMMAND, [...INSTALL_ARGS], {
      cwd: staging,
      stdio: ['ignore', 2, 2],
    })
    if (r.error)
      throw new Error(
        (r.error as NodeJS.ErrnoException).code === 'ENOENT'
          ? '找不到 pnpm（安裝鎖住的相依要用它）'
          : r.error.message,
      )
    if (r.status !== 0) throw new Error(`pnpm install --frozen-lockfile exit ${r.status}`)
    writeFileSync(join(staging, INSTALLED_MARKER), `${deps.hash}\n`)
    try {
      renameSync(staging, installDir)
    } catch (error) {
      // 另一個 wrapper 先裝好了同一份：用它的。
      if (!isInstalled(installDir)) throw error
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

function main(): void {
  if (process.argv[2] === SHIM_FLAG) return runShim(process.argv.slice(3))

  let plan: LaunchPlan
  const deps = readLockedDeps()
  const shimDir = shimDirFor(process.env, homedir())
  try {
    plan = buildPlan(process.argv.slice(2), process.env, {
      repoSlug: originSlug,
      user: userInfo().username,
      host: hostname(),
      installDir: installDirFor(deps.hash, process.env, homedir()),
      shimDir,
      realClaude: () => findOnPath('claude', process.env.PATH, shimDir),
      node: process.execPath,
      wrapper: import.meta.filename,
    })
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    process.stderr.write(`pulls-review：${error.message}\n`)
    process.exit(2)
  }

  if (plan.dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          command: plan.command,
          args: plan.args,
          install: {
            version: deps.version,
            lockHash: deps.hash,
            dir: plan.installDir,
            installed: isInstalled(plan.installDir),
            command: [INSTALL_COMMAND, ...INSTALL_ARGS],
          },
          model: plan.model,
          shim: plan.realClaude ? { dir: plan.shimDir, realClaude: plan.realClaude } : null,
          env: { set: { ANTHROPIC_MODEL: plan.env.ANTHROPIC_MODEL }, stripped: plan.stripped },
          sshForward: plan.sshForward,
        },
        null,
        2,
      )}\n`,
    )
    return
  }

  try {
    ensureInstalled(plan.installDir, deps)
  } catch (error) {
    process.stderr.write(`pulls-review：安裝失敗：${(error as Error).message}\n`)
    process.exit(1)
  }

  process.stderr.write(
    `pulls-review：pulls.review@${deps.version}（lock ${deps.hash}），port ${plan.port}，這一次的 Local agent model：${plan.model}\n`,
  )
  if (plan.realClaude) {
    ensureShim(plan.shimDir)
    process.stderr.write(
      'pulls-review：頁面 Settings 的 model 選單在這裡不生效；要換 model，這一次啟動加 --model opus\n',
    )
    process.stderr.write(
      'pulls-review：以上只管 Local agent 的 Claude Code。Settings 改選 OpenCode 或自填 API key 的分析不經過這裡，model 與計費都不受控\n',
    )
  } else
    process.stderr.write(
      'pulls-review：PATH 上找不到 claude，Local agent 分析用不了（閱讀頁照常）\n',
    )
  if (plan.stripped.length > 0)
    process.stderr.write(`pulls-review：已清掉 ${plan.stripped.join('、')}\n`)
  if (plan.sshForward)
    process.stderr.write(
      `pulls-review：這是 SSH session，不開瀏覽器。在你的電腦另開一個 terminal 跑：\n  ${plan.sshForward}\n再開下面印出的 localhost 網址。\n`,
    )

  // server 留下來會繼續占著固定 port，下一次啟動就撞 port。bin 是 shell shim、server 還會
  // spawn `claude`，所以讓子行程自成一個 process group，收到訊號時整組一起送。
  const child = spawn(plan.command, plan.args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: plan.env,
    detached: true,
  })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.on(signal, () => {
      try {
        if (child.pid) process.kill(-child.pid, signal)
      } catch {
        // 整組已經結束
      }
    })
  child.on('error', (error) => {
    process.stderr.write(`pulls-review：啟動失敗：${error.message}\n`)
    process.exit(1)
  })
  child.on('close', (code) => process.exit(code ?? 1))
}

/** 兩邊都 realpath：經 symlink 呼叫（consumer 的 `scripts/` 可能是 symlink 樹）也要進 main。 */
function invokedAsCli(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return entry === fileURLToPath(import.meta.url)
  }
}

if (invokedAsCli()) main()
