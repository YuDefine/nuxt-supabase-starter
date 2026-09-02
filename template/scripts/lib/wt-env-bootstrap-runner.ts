// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/wt-env-bootstrap-runner.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/wt-env-bootstrap-runner.ts
// wt-env-bootstrap-runner.ts — consumer 的 per-worktree backing service 探針/補建的單一入口。
//
// 為什麼抽出來：這段原本只活在 `wt-helper.ts`（145KB）裡，且只在**建 worktree 那一刻**
// 被呼叫一次。`rules/core/db-preview-env.md` § 缺席側要求存在性檢查改綁在**起 dev server**
// 上——而 `dev-session.ts` 不可能為了呼叫它去 import 整個 wt-helper。
//
// 兩種呼叫語義，故意分成兩個 export：
//
//   runWtEnvBootstrap()  fail-closed —— wt-helper 的 add / cleanup 用。半 provision 的
//                        remote resource MUST 浮出來，NEVER 被吞掉。
//   probeBackingService() fail-open —— dev-session / review-gui 的 preflight 用。工具自身
//                        故障（探針壞掉、JSON 爛掉）NEVER 阻擋沒有 per-worktree 拓樸的
//                        consumer 起 dev server；真正的缺席才由呼叫端處置。
//
// 這個 fail 策略的不對稱是刻意的，對照 `db-lease.ts` 檔頭同一組取捨：enforcement 面
// fail-closed、tooling 面 fail-open。

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface WtEnvBootstrapRunResult {
  status?: number | null
  stdout?: string
  stderr?: string
}

export type WtEnvBootstrapRunner = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
) => WtEnvBootstrapRunResult

export interface WtEnvBootstrapOptions {
  allowOrphanRecord?: boolean
  spawnSyncImpl?: WtEnvBootstrapRunner
}

/**
 * `status` 的三態。語義由 consumer 的 wt-env-bootstrap 實作定義（reference impl：
 * <consumer-b> `scripts/wt-env-bootstrap.ts`）：
 *
 *   absent   clone DB 不存在
 *   created  clone 在，但 sidecar 還沒 ready
 *   ready    clone + sidecar 都在
 *
 * `created` **不是**可放行狀態 —— sidecar 缺席時 app 起得來、打不到 DB，正是要擋的形狀。
 */
export type BackingServiceState = 'absent' | 'created' | 'ready'

export interface BackingServiceProbe {
  /** false = 此 consumer 沒有 per-worktree 拓樸（或探針無法判讀）→ 呼叫端整段跳過。 */
  applicable: boolean
  state?: BackingServiceState
  dbName?: string
  containerName?: string
  port?: number
  supabaseUrl?: string
  /** applicable:false 時的原因，供 verbose log；NEVER 拿它當使用者面的錯誤訊息。 */
  skipReason?: string
  /**
   * shim 缺席的成因是「本 worktree 的 branch 過時」而非「此 consumer 無拓樸」。
   * 這一格是唯一分辨得了兩者的訊號 —— 兩者的 `applicable` 都是 false，外觀完全相同。
   */
  staleBranch?: boolean
}

/**
 * Locate the consumer's per-worktree bootstrap script.
 *
 * `.ts` is the documented name; `.mjs` is accepted because consumers migrating
 * off `.mjs` would otherwise lose the hook **silently** — see the hard rule below.
 *
 * Returns null only when the consumer genuinely ships no such script.
 *
 * **Any other extension is a hard error, never a skip.** A consumer that ships
 * `wt-env-bootstrap.<something-else>` clearly intends the hook to run; treating
 * that as "consumer doesn't have one" makes both `ensure` and `destroy` no-op
 * with zero signal. Observed cost (<consumer-b> 2026-08-02, TD-315): every new worktree
 * came up with `.env.local` still pointing at the *main* worktree's database,
 * and every `cleanup` left its PostgREST sidecar running — each orphan
 * permanently consuming a connection-admission slot until the ceiling was hit
 * and no new worktree could be provisioned at all. None of it surfaced, because
 * the lookup just returned null.
 */
export function resolveWtEnvBootstrapScript(worktreePath: string): string | null {
  const dir = join(worktreePath, 'scripts')
  for (const ext of ['ts', 'mjs']) {
    const candidate = join(dir, `wt-env-bootstrap.${ext}`)
    if (existsSync(candidate)) return candidate
  }
  if (!existsSync(dir)) return null
  const stray = readdirSync(dir).find((f) => f.startsWith('wt-env-bootstrap.'))
  if (stray) {
    throw new Error(
      `Found scripts/${stray} but expected wt-env-bootstrap.ts (or .mjs). ` +
        `Refusing to skip silently — per-worktree resources would be neither provisioned ` +
        `nor released. Rename it to wt-env-bootstrap.ts.`,
    )
  }
  return null
}

/**
 * Optional per-worktree resource bootstrap.
 *
 * Consumers that provision per-worktree resources (typically an isolated dev
 * database clone plus its sidecar) ship `scripts/wt-env-bootstrap.ts` exposing
 * `ensure` / `destroy` / `status`. Consumers without that script are unaffected:
 * this returns null and callers skip the step.
 *
 * Fails closed when the script exists but the command errors or emits invalid
 * JSON — a half-provisioned remote resource must surface, not be swallowed.
 * Callers that need the opposite policy (dev-server preflight) use
 * `probeBackingService()` instead.
 *
 * TD-348: the required CLI is exactly
 *
 *     node scripts/wt-env-bootstrap.ts <ensure|destroy|status> --worktree <path> --json
 *
 * A script that parses none of those arguments exits 2 on every invocation, so
 * `add` degrades to a warning and `cleanup` fails outright, leaving the
 * worktree undeleted. Anything occupying this filename **MUST** implement that
 * CLI; a tool with a different CLI belongs under a different name, no matter
 * how related its purpose sounds (clade's own env-file copier was renamed to
 * `wt-env-sync.ts` for exactly this reason).
 */
export function runWtEnvBootstrap(
  worktreePath: string,
  command: string,
  opts: WtEnvBootstrapOptions = {},
) {
  const script = resolveWtEnvBootstrapScript(worktreePath)
  if (!script) return null

  const args = [script, command, '--worktree', worktreePath, '--json']
  if (opts.allowOrphanRecord) args.push('--allow-orphan-record')

  const run = (opts.spawnSyncImpl ?? spawnSync) as WtEnvBootstrapRunner
  const result = run(process.execPath, args, {
    cwd: worktreePath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || 'unknown error'
    // exit 2 is the usage-error convention; combined with an "unknown arg"
    // complaint it means the script does not implement this CLI at all, which
    // is a different repair than a genuine provisioning failure (TD-348).
    const contractMismatch = result.status === 2 || /unknown (arg|option|command)/i.test(stderr)
    throw new Error(
      `Worktree env bootstrap ${command} failed: ${stderr}` +
        (contractMismatch
          ? `\n  ${script} does not implement the required CLI ` +
            `\`<ensure|destroy|status> --worktree <path> --json\`. Either implement it or ` +
            `rename the file — this filename is reserved for that contract (TD-348).`
          : ''),
    )
  }
  try {
    return JSON.parse(result.stdout?.trim() ?? '')
  } catch {
    throw new Error(`Worktree env bootstrap ${command} returned invalid JSON`)
  }
}

const VALID_STATES = new Set<BackingServiceState>(['absent', 'created', 'ready'])

function toProbe(raw: unknown): BackingServiceProbe {
  const o = (raw ?? {}) as Record<string, unknown>
  // 契約欄位是 `status`（reference impl：<consumer-b> `scripts/wt-env-bootstrap.ts` 的 `status()`，
  // 回 `{status: 'absent'|'created'|'ready', dbName, containerName, port, …}`）。
  // `state` 只是相容別名 —— **NEVER** 只讀 `state`：讀錯 key 的失敗形狀是「永遠 applicable:false」，
  // 也就是 preflight 對每一個 consumer 靜默跳過，而外觀與「此 consumer 無 per-worktree 拓樸」
  // 完全相同（2026-08-06 對 <consumer-b> 實測時抓到）。
  const state = (o.status ?? o.state) as BackingServiceState
  if (!VALID_STATES.has(state)) {
    return { applicable: false, skipReason: `unrecognized state: ${JSON.stringify(o.state)}` }
  }
  return {
    applicable: true,
    state,
    dbName: typeof o.dbName === 'string' ? o.dbName : undefined,
    containerName: typeof o.containerName === 'string' ? o.containerName : undefined,
    port: typeof o.port === 'number' ? o.port : undefined,
    supabaseUrl: typeof o.supabaseUrl === 'string' ? o.supabaseUrl : undefined,
  }
}

/**
 * default branch 上有沒有 bootstrap shim。有、而本 worktree 的 checkout 沒有 = branch 過時。
 *
 * **NEVER 讓它 throw** —— 它只跑在 `probeBackingService` 的 fail-open 路徑上，一個判不出來的
 * git 狀態（沒有 remote、default branch 名字非慣例、repo 剛 init）本來就該退回「無拓樸」，
 * 而不是把 dev server 擋在啟動前。
 */
function defaultBranchHasBootstrapShim(worktreePath: string): { branch: string } | null {
  const git = (args: string[]) => {
    try {
      const r = spawnSync('git', ['-C', worktreePath, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return r.status === 0 ? (r.stdout ?? '').trim() : null
    } catch {
      return null
    }
  }
  const head = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  const candidates = [head, 'main', 'master'].filter((b): b is string => Boolean(b))
  for (const branch of candidates) {
    for (const ext of ['ts', 'mjs']) {
      if (git(['cat-file', '-e', `${branch}:scripts/wt-env-bootstrap.${ext}`]) !== null) {
        return { branch }
      }
    }
  }
  return null
}

/**
 * Fail-open 的 `status` 探針，給 dev-server 啟動路徑用。
 *
 * **NEVER 讓這個函式 throw** —— 它跑在每一次 dev server 啟動前，而絕大多數 consumer 根本
 * 沒有 per-worktree 拓樸。探針自身的任何故障都退回 `applicable:false`（呼叫端跳過），
 * 只有「探針正常回報 absent / created」才是要處置的缺席。
 */
export function probeBackingService(
  worktreePath: string,
  opts: WtEnvBootstrapOptions = {},
): BackingServiceProbe {
  let script: string | null
  try {
    script = resolveWtEnvBootstrapScript(worktreePath)
  } catch (e) {
    // stray-extension hard error：對 wt-helper 是 fail-closed，但在 dev server 啟動路徑
    // 上擋人沒有意義（那個修法是改檔名，不是起 server 的人當下能做的）。
    return { applicable: false, skipReason: (e as Error)?.message ?? String(e) }
  }
  if (!script) {
    // shim 缺席有兩個成因，`applicable:false` 對兩者完全同形：此 consumer 沒有 per-worktree
    // 拓樸（正常，絕大多數），或**本 worktree 的 branch 過時**（拓樸已進 default branch，
    // 這棵還沒 merge）。後者實測 2026-09-02 在 <consumer-a> 佔 30 棵中的 27 棵，全部零訊號。
    //
    // 判準刻意**不**讀 `.claude/hub.json` 的 capability —— 那個檔本身是 tracked、
    // 一樣 branch-dependent，過時的 branch 上它也還沒宣告 `worktree-db`，於是最該出聲的
    // 那一格恰好判不出來。改問 git：default branch 上有 shim、本 checkout 沒有 = branch 過時。
    const stale = defaultBranchHasBootstrapShim(worktreePath)
    return stale
      ? {
          applicable: false,
          staleBranch: true,
          skipReason: `${stale.branch} 有 scripts/wt-env-bootstrap.* 而本 worktree 沒有 — 這棵的 branch 過時，merge ${stale.branch} 即可取得 per-worktree 拓樸`,
        }
      : { applicable: false, skipReason: 'no scripts/wt-env-bootstrap.{ts,mjs}' }
  }

  const run = (opts.spawnSyncImpl ?? spawnSync) as WtEnvBootstrapRunner
  let result: WtEnvBootstrapRunResult
  try {
    result = run(process.execPath, [script, 'status', '--worktree', worktreePath, '--json'], {
      cwd: worktreePath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    return { applicable: false, skipReason: `spawn failed: ${(e as Error)?.message ?? e}` }
  }
  if (result.status !== 0) {
    return {
      applicable: false,
      skipReason: `status exited ${result.status}: ${result.stderr?.trim() || 'no stderr'}`,
    }
  }
  try {
    return toProbe(JSON.parse(result.stdout?.trim() ?? ''))
  } catch {
    return { applicable: false, skipReason: 'status returned invalid JSON' }
  }
}

/**
 * 缺席時的使用者面訊息。**MUST 點名 backing service 本身與修復指令** —— 這是
 * `db-preview-env.md` § 缺席側的硬要求：NEVER 只說「後端連線失敗」，那正是要消滅的那層代言。
 */
export function describeBackingServiceGap(probe: BackingServiceProbe, detail?: string): string {
  const svc =
    probe.state === 'created'
      ? `PostgREST sidecar${probe.port ? ` (port ${probe.port})` : ''}${
          probe.containerName ? ` / ${probe.containerName}` : ''
        }`
      : `DB clone${probe.dbName ? ` ${probe.dbName}` : ''}`
  const lines = [
    `per-worktree backing service 不存在：${svc}`,
    `  自動補建失敗${detail ? `：${detail}` : ''}`,
    `  修復：pnpm db:worktree:bootstrap（或 node scripts/wt-env-bootstrap.ts ensure --worktree "$PWD" --json）`,
    `  診斷：pnpm db:worktree:status`,
  ]
  return lines.join('\n')
}
