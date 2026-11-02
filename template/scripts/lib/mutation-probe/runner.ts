// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/mutation-probe/runner.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/mutation-probe/runner.ts
// CLADE:VENDOR-SCRIPT
//
// mutation-probe/runner — 執行器介面與探測流程（與執行器種類無關的判定）
//
// 契約：specs/truth/contracts/mutation-probe-cli.md § 1（前置判定、基線、逐突變一趟、exit code、
//       工作樹保證）、specs/truth/data/break-receipt.md（收據、result 值域）。
//
// 分工：
//   - 本檔：`Runner` 介面、`runProbe`（not-applicable 前置 → 基線 → 逐突變 → 收據 → 工作樹比對 → exit）。
//     結果判定一律走 receipt.ts 的 `assembleMutationReceipt`／`decideRanResult`（`hits=0` 而已載入
//     會丟 ProbeToolError → exit 2），這裡不另寫第二份。
//   - `node-runner.ts`、`vitest-runner.ts`：各自 export `createRunner: RunnerFactory`，只負責「跑一趟、
//     回觀測結果」。新增執行器只需新增 `<kind>-runner.ts` 並登記在 `RUNNER_MODULES`（本檔動態載入）。
//
// 由 ~/clade vendor/scripts/lib/ 散播，請勿直接編輯 consumer 副本。

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { judgeApplicability, toMutationSpec } from './mutation.ts'
import type { MutationInput } from './mutation.ts'
import {
  ProbeToolError,
  assembleMutationReceipt,
  blobShaOfWorktreeFile,
  gitHead,
  writeReceipt,
} from './receipt.ts'
import type { MutationReceipt, ReceiptBaseline, RunOutcome, RunnerKind, Vouch } from './receipt.ts'
import { beginWorktreeGuard } from './worktree-guard.ts'
import type { GuardResult } from './worktree-guard.ts'

// ───────────────────────── 執行器介面 ─────────────────────────

export interface RunnerOptions {
  /** git repo 根；測試行程的 cwd。 */
  root: string
  /** 測試檔（repo 相對、POSIX）。 */
  tests: string[]
  /** `--config` 的絕對路徑（入口已以呼叫端 cwd 解析；vitest 才用，node-test 不收）。 */
  config?: string
  /** 登記 detached 子行程（pgid=pid），讓 SIGINT／SIGTERM 時整個群組被終止；回傳取消登記函式。 */
  trackGroup: (pid: number) => () => void
  /** 探針專屬的暫存目錄（repo 之外）；執行器的回報檔放這裡，探針結束時整個刪掉。 */
  workDir: string
}

/**
 * 一種測試執行器。每個方法 = 一趟**新**行程（模組層常數只在載入時求值一次，同一行程內切換突變
 * 會讓這類突變永遠不生效）。
 */
export interface Runner {
  readonly kind: RunnerKind
  /** 基線與突變共用的完整指令（不含探針自己加的 hook／reporter 參數）；寫進收據 `runner.command`。 */
  readonly command: string[]
  /**
   * 不帶突變跑一次。紅燈與逾時是**結果**（`status` red／timeout），不丟錯；
   * 執行器起不來（沒有任何測試開始執行）才丟 ProbeToolError。
   */
  baseline(timeoutMs: number): Promise<ReceiptBaseline>
  /**
   * 帶一個突變跑一次，回觀測結果（`RunOutcome`）。`loaded`／`hits` 的語意見 break-receipt.md；
   * 判定（caught／survived／hits=0 錯誤）不在這裡做。逾時回 `timedOut=true`。
   */
  runMutation(m: MutationInput, timeoutMs: number): Promise<RunOutcome>
}

export type RunnerFactory = (opts: RunnerOptions) => Runner | Promise<Runner>

/** 執行器種類 → 模組（相對本檔）。模組 MUST export `createRunner: RunnerFactory`。 */
export const RUNNER_MODULES: Record<RunnerKind, string> = {
  'node-test': './node-runner.ts',
  vitest: './vitest-runner.ts',
}

export async function loadRunnerFactory(kind: RunnerKind): Promise<RunnerFactory> {
  const rel = RUNNER_MODULES[kind]
  const file = fileURLToPath(new URL(rel, import.meta.url))
  if (!existsSync(file)) {
    throw new ProbeToolError(`--runner ${kind} 的執行器模組尚未提供（${rel}）`)
  }
  const mod = (await import(pathToFileURL(file).href)) as { createRunner?: RunnerFactory }
  if (typeof mod.createRunner !== 'function') {
    throw new ProbeToolError(`${rel} 沒有 export createRunner`)
  }
  return mod.createRunner
}

// ───────────────────────── 探測流程 ─────────────────────────

/** 基線沒給 `--timeout` 時的上限（契約只定義了突變的預設；基線要先有牆鐘才能推算）。 */
export const DEFAULT_BASELINE_TIMEOUT_MS = 15 * 60 * 1000
/** 突變預設時限 = 基線牆鐘 × 3，下限 60 秒（明確指定 `--timeout` 時不套下限）。 */
export const MUTATION_TIMEOUT_FACTOR = 3
export const MUTATION_TIMEOUT_FLOOR_MS = 60 * 1000

export const EXIT = {
  ok: 0,
  survived: 1,
  toolError: 2,
  worktreeChanged: 3,
  baselineRed: 4,
} as const

export interface ProbeRunInput {
  /** git repo 根（呼叫端以 `git rev-parse --show-toplevel` 取得）。 */
  root: string
  runnerKind: RunnerKind
  /** 測試檔（repo 相對、POSIX）。 */
  tests: string[]
  config?: string
  mutations: MutationInput[]
  vouches: Vouch[]
  /** `--timeout`（毫秒）；省略時基線用 DEFAULT_BASELINE_TIMEOUT_MS，突變用基線實測推算。 */
  timeoutMs?: number
  writeReceipts: boolean
  /** 測試用：換掉動態載入的執行器。 */
  runnerFactory?: RunnerFactory
  /** 進度訊息（stderr）。 */
  log?: (line: string) => void
  now?: () => Date
}

export interface ProbeRunOutput {
  /** 沒有任何突變需要跑（全部 not-applicable）時為 null。 */
  baseline: ReceiptBaseline | null
  receipts: MutationReceipt[]
  worktree: GuardResult
  /** `--write-receipts` 寫出的收據（repo 相對）。 */
  written: string[]
  exit: number
  /** 工具層錯誤（exit 2）的說明；有值時 `receipts` 為空、不寫任何收據。 */
  toolError?: string
}

/** git repo 根；不在 git repo 內丟 ProbeToolError。 */
export function gitToplevel(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    throw new ProbeToolError(`${cwd} 不在 git repo 內：探針需要 git 來保證工作樹不被改動`)
  }
}

/** 把使用者給的路徑轉成 repo 相對 POSIX；落在 repo 外丟 ProbeToolError。 */
export function toRepoRelative(root: string, p: string): string {
  const abs = isAbsolute(p) ? p : resolve(root, p)
  const rel = relative(root, abs).split('\\').join('/')
  if (rel === '' || rel.startsWith('../') || rel === '..') {
    throw new ProbeToolError(`路徑不在 repo 內：${p}`)
  }
  return rel
}

function exitFor(receipts: MutationReceipt[], worktree: GuardResult, baselineRed: boolean): number {
  if (!worktree.unchanged) return EXIT.worktreeChanged
  if (baselineRed) return EXIT.baselineRed
  if (receipts.some((r) => r.result === 'survived' || r.result === 'timeout')) return EXIT.survived
  return EXIT.ok
}

export async function runProbe(input: ProbeRunInput): Promise<ProbeRunOutput> {
  const { root } = input
  const log = input.log ?? (() => {})
  const now = input.now ?? (() => new Date())

  for (const t of input.tests) {
    if (!existsSync(join(root, t))) throw new ProbeToolError(`測試檔不存在：${t}`)
  }
  if (input.tests.length === 0) throw new ProbeToolError('沒有指定任何測試檔')
  if (input.mutations.length === 0) throw new ProbeToolError('沒有指定任何突變')

  const mutations = input.mutations.map((m) => ({ ...m, file: toRepoRelative(root, m.file) }))
  const repoHead = gitHead(root)
  const factory = input.runnerFactory ?? (await loadRunnerFactory(input.runnerKind))

  const written: string[] = []
  const guard = beginWorktreeGuard({
    root,
    files: [...new Set(mutations.map((m) => m.file))],
    ignorePaths: () => written,
  })
  const workDir = mkdtempSync(join(tmpdir(), 'mutation-probe-'))

  try {
    const runner = await factory({
      root,
      tests: input.tests,
      config: input.config,
      trackGroup: guard.trackGroup,
      workDir,
    })
    const runnerInfo = { kind: runner.kind, command: runner.command, node: process.version }

    // 前置判定：不適用的突變不跑測試（FR-005）。
    const naReason = mutations.map((m) => judgeApplicability(root, m))
    const common = (m: MutationInput, baseline: ReceiptBaseline | null) => ({
      mutation: toMutationSpec(root, m),
      target_fingerprint: blobShaOfWorktreeFile(root, m.file),
      runner: runnerInfo,
      tests: input.tests,
      baseline,
      repo_head: repoHead,
      vouches_for: input.vouches,
      now: now(),
    })

    const hasWork = naReason.some((r) => r === null)
    let baseline: ReceiptBaseline | null = null
    if (hasWork) {
      log('mutation-probe: 跑基線（未突變）…')
      baseline = await runner.baseline(input.timeoutMs ?? DEFAULT_BASELINE_TIMEOUT_MS)
      log(
        `mutation-probe: 基線 ${baseline.status}（passed=${baseline.passed} failed=${baseline.failed}，${baseline.ms}ms）`,
      )
    }
    const baselineGreen = baseline?.status === 'green'
    const mutationTimeoutMs =
      input.timeoutMs ??
      Math.max(MUTATION_TIMEOUT_FLOOR_MS, (baseline?.ms ?? 0) * MUTATION_TIMEOUT_FACTOR)

    const receipts: MutationReceipt[] = []
    for (const [i, m] of mutations.entries()) {
      const na = naReason[i]
      if (na !== null) {
        receipts.push(
          assembleMutationReceipt(common(m, null), { kind: 'not-applicable', na_reason: na }),
        )
        continue
      }
      if (!baselineGreen) {
        receipts.push(assembleMutationReceipt(common(m, baseline), { kind: 'baseline-red' }))
        continue
      }
      log(`mutation-probe: [${i + 1}/${mutations.length}] ${m.id ?? `${m.file}:${m.occurrence}`}`)
      const run = await runner.runMutation(m, mutationTimeoutMs)
      // decideRanResult：hits=0 而已載入、或 hits=0 卻有測試失敗 → ProbeToolError。
      receipts.push(assembleMutationReceipt(common(m, baseline), { kind: 'ran', run }))
    }

    if (input.writeReceipts) {
      for (const r of receipts) written.push(writeReceipt(root, r))
    }
    const worktree = guard.finish()
    return {
      baseline,
      receipts,
      worktree,
      written,
      exit: exitFor(receipts, worktree, hasWork && !baselineGreen),
    }
  } catch (e) {
    // 工作樹被動過比工具錯誤更嚴重：兩者並存時報 3，訊息同時帶兩個原因。
    guard.dispose()
    if (e instanceof ProbeToolError) {
      const worktree = guard.finish()
      return {
        baseline: null,
        receipts: [],
        worktree,
        written,
        exit: worktree.unchanged ? EXIT.toolError : EXIT.worktreeChanged,
        toolError: e.message,
      }
    }
    throw e
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
