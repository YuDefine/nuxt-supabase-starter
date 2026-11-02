// 🔒 LOCKED — managed by clade · Source: vendor/scripts/mutation-probe.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/mutation-probe.ts
// CLADE:VENDOR-SCRIPT
//
// mutation-probe — 記憶體內突變探針 CLI 入口
//
// 契約：specs/truth/contracts/mutation-probe-cli.md（行為、exit code）、
//       specs/truth/data/break-receipt.md（收據欄位與值域）。
//
// 本檔現況（W-2026-10-24-test-trust-enforcement T001＋T030＋T040）：子指令分派（run／replay／exempt／revive）、
// 旗標解析、收據與彙總型別、人讀與 JSON 輸出格式，以及四個子指令。探測流程在 lib/mutation-probe/runner.ts
// （執行器依 `--runner` 動態載入 lib/mutation-probe/<kind>-runner.ts）；`replay` 逐張收據走同一個 `runProbe`；
// `revive` 在 lib/mutation-probe/revive.ts。
//
// exit 2 同時是「用法錯誤」與「工具不可用」：呼叫端（刪除閘門、skip 閘門）把 2 一律當工具不可用，
// 不會誤放行。
//
// 由 ~/clade vendor/scripts/ 散播，請勿直接編輯 consumer 副本。

import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseMutationFlag, parseMutationsJson } from './lib/mutation-probe/mutation.ts'
import type { MutationInput } from './lib/mutation-probe/mutation.ts'
import {
  ProbeToolError,
  assembleExemption,
  readReceipt,
  writeReceipt,
} from './lib/mutation-probe/receipt.ts'
import { runRevive } from './lib/mutation-probe/revive.ts'
import { gitToplevel, runProbe, toRepoRelative } from './lib/mutation-probe/runner.ts'
import type { RunnerFactory } from './lib/mutation-probe/runner.ts'
import { beginWorktreeGuard } from './lib/mutation-probe/worktree-guard.ts'

// ───────────────────────── 型別（定義在 lib/mutation-probe/receipt.ts，這裡 re-export）─────────────────────────

import {
  BASELINE_STATUSES,
  EXEMPTION_KINDS,
  NA_REASONS,
  RECEIPT_FORMAT_VERSION,
  RESULTS,
  RUNNER_KINDS,
  SITE_SCOPES,
  SURVIVED_KINDS,
} from './lib/mutation-probe/receipt.ts'
import type {
  BaselineStatus,
  ExemptionKind,
  ExemptionReceipt,
  FailingTest,
  MutationReceipt,
  MutationResult,
  MutationSpec,
  NaReason,
  Receipt,
  ReceiptBaseline,
  RunnerKind,
  SiteScope,
  SurvivedKind,
  Vouch,
} from './lib/mutation-probe/receipt.ts'

export {
  BASELINE_STATUSES,
  EXEMPTION_KINDS,
  NA_REASONS,
  RECEIPT_FORMAT_VERSION,
  RESULTS,
  RUNNER_KINDS,
  SITE_SCOPES,
  SURVIVED_KINDS,
}
export type {
  BaselineStatus,
  ExemptionKind,
  ExemptionReceipt,
  FailingTest,
  MutationReceipt,
  MutationResult,
  MutationSpec,
  NaReason,
  Receipt,
  ReceiptBaseline,
  RunnerKind,
  SiteScope,
  SurvivedKind,
  Vouch,
}

export interface ProbeCounts {
  caught: number
  survived: number
  survived_not_loaded: number
  baseline_red: number
  not_applicable: number
  timeout: number
}

/** `run --json` 的 stdout 形狀（契約 § 1 輸出）。衍生資料，**NEVER** 寫進 repo、**NEVER** 當收據。 */
export interface ProbeSummary {
  format_version: number
  runner: RunnerKind
  tests: string[]
  baseline: ReceiptBaseline | null
  receipts: MutationReceipt[]
  counts: ProbeCounts
  worktree_unchanged: boolean
}

/** `replay` 每張收據一筆（契約 § 2 輸出）。 */
export interface ReplayEntry {
  receipt_id: string
  recorded: MutationResult
  replayed: MutationResult
  /** 重跑結果與收據記錄的 result 相同。 */
  match: boolean
}

/** `replay --json` 的 stdout 形狀（契約 § 2 輸出）；`replays` 依輸入收據順序。 */
export interface ReplaySummary {
  format_version: number
  replays: ReplayEntry[]
}

/** `revive --json` 的 stdout 形狀（契約 § 4 輸出）。 */
export interface ReviveSummary {
  revived: { file: string; name: string; status: 'pass' | 'fail' | 'timeout' }[]
  counts: { pass: number; fail: number; timeout: number }
}

// ───────────────────────── 輸出外殼 ─────────────────────────

export function countReceipts(receipts: MutationReceipt[]): ProbeCounts {
  const counts: ProbeCounts = {
    caught: 0,
    survived: 0,
    survived_not_loaded: 0,
    baseline_red: 0,
    not_applicable: 0,
    timeout: 0,
  }
  for (const r of receipts) {
    if (r.result === 'caught') counts.caught += 1
    else if (r.result === 'survived') {
      counts.survived += 1
      if (r.survived_kind === 'not-loaded') counts.survived_not_loaded += 1
    } else if (r.result === 'baseline-red') counts.baseline_red += 1
    else if (r.result === 'not-applicable') counts.not_applicable += 1
    else counts.timeout += 1
  }
  return counts
}

/** `--json`：stdout 只有這一份 JSON。 */
export function formatSummaryJson(summary: ProbeSummary): string {
  return `${JSON.stringify(summary, null, 2)}\n`
}

/**
 * 人讀（寫 stderr）：每個突變一行 `<id 或 file:occurrence> <result> [<failing 第一筆>]`，
 * 最後一行 `caught=<n> survived=<n>（未載入 <n>） baseline-red=<n> n/a=<n> timeout=<n>`。
 * 全部都是 `not-applicable`（或沒有突變）時另加一行標明「沒有任何突變被執行」。
 */
export function formatSummaryHuman(summary: ProbeSummary): string {
  const lines: string[] = []
  for (const r of summary.receipts) {
    const label = r.mutation.id ?? `${r.mutation.file}:${r.mutation.occurrence}`
    const first = r.failing_tests[0]
    const detail =
      r.result === 'not-applicable' && r.na_reason
        ? ` ${r.na_reason}`
        : first
          ? ` ${first.file} > ${first.name}`
          : ''
    lines.push(`${label} ${r.result}${detail}`)
  }
  const c = summary.counts
  if (summary.receipts.every((r) => r.result === 'not-applicable')) {
    lines.push('沒有任何突變被執行')
  }
  lines.push(
    `caught=${c.caught} survived=${c.survived}（未載入 ${c.survived_not_loaded}） ` +
      `baseline-red=${c.baseline_red} n/a=${c.not_applicable} timeout=${c.timeout}`,
  )
  return `${lines.join('\n')}\n`
}

// ───────────────────────── 旗標解析 ─────────────────────────

export const SUBCOMMANDS = ['run', 'replay', 'exempt', 'revive'] as const
export type Subcommand = (typeof SUBCOMMANDS)[number]

interface FlagSpec {
  /** 帶值旗標；值為 true 的旗標（`--json`）不帶值。 */
  kind: 'value' | 'bool'
  /** 可重複；值累積成陣列。 */
  repeat?: boolean
  /** 後面緊接的非旗標 token 都算這個旗標的值（`--test a.ts b.ts`）；只在 `--flag value` 寫法生效。 */
  variadic?: boolean
  /** 值域限制（`--runner`、`--kind`）。 */
  oneOf?: readonly string[]
}

const RUNNER_FLAG: FlagSpec = { kind: 'value', oneOf: RUNNER_KINDS }

const FLAG_SPECS: Record<Subcommand, Record<string, FlagSpec>> = {
  run: {
    '--runner': RUNNER_FLAG,
    '--config': { kind: 'value' },
    '--test': { kind: 'value', repeat: true, variadic: true },
    '--tests-from': { kind: 'value' },
    '--mutation': { kind: 'value', repeat: true },
    '--mutations': { kind: 'value' },
    '--vouch': { kind: 'value', repeat: true },
    '--timeout': { kind: 'value' },
    '--write-receipts': { kind: 'bool' },
    '--json': { kind: 'bool' },
  },
  replay: {
    '--json': { kind: 'bool' },
  },
  exempt: {
    '--kind': { kind: 'value', oneOf: EXEMPTION_KINDS },
    '--reason': { kind: 'value' },
    '--ref': { kind: 'value' },
    '--removed': { kind: 'value', repeat: true },
    '--vouch': { kind: 'value', repeat: true },
  },
  revive: {
    '--runner': RUNNER_FLAG,
    '--config': { kind: 'value' },
    '--test': { kind: 'value', repeat: true, variadic: true },
    '--json': { kind: 'bool' },
  },
}

export interface ParsedArgs {
  subcommand: Subcommand
  /** 非旗標參數（`replay` 的收據路徑）。 */
  positionals: string[]
  /** 旗標名（含 `--`）→ 值；可重複旗標為 string[]，bool 旗標為 true。 */
  flags: Record<string, string | string[] | true>
}

// tsconfig 是 strict:false，discriminated union 不會收斂；用單一形狀：ok 為真時才有 args，否則才有 error。
export interface ParseResult {
  ok: boolean
  args?: ParsedArgs
  error?: string
}

const USAGE = [
  'usage: mutation-probe <run|replay|exempt|revive> [flags]',
  '  run     --runner node-test|vitest [--config <f>] (--test <f>... | --tests-from <list>)',
  "          (--mutation '<file>::<from>::<to>[::<occurrence>][::<id>]'... | --mutations <json>)",
  '          [--vouch <file>[::<name>]]... [--timeout <s>] [--write-receipts] [--json]',
  '  replay  <receipt.json>... [--json]',
  '  exempt  --kind feature-removed|bdd-remove --reason <text> [--ref <path#anchor>]',
  '          [--removed <product path>]... --vouch <file>[::<name>]...',
  '  revive  --runner node-test|vitest [--config <f>] --test <f>... [--json]',
].join('\n')

function isSubcommand(s: string | undefined): s is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(s ?? '')
}

/** 缺值、未知旗標、值不在值域 → `ok:false`（呼叫端轉 exit 2）。不判必填旗標是否齊全。 */
export function parseArgs(argv: string[]): ParseResult {
  const [sub, ...rest] = argv
  if (!isSubcommand(sub)) {
    return {
      ok: false,
      error: sub ? `未知子指令 ${sub}` : '缺子指令',
    }
  }
  const specs = FLAG_SPECS[sub]
  const flags: ParsedArgs['flags'] = {}
  const positionals: string[] = []

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (!token.startsWith('--')) {
      if (sub !== 'replay') return { ok: false, error: `${sub} 不接受位置參數 ${token}` }
      positionals.push(token)
      continue
    }
    const eq = token.indexOf('=')
    const name = eq >= 0 ? token.slice(0, eq) : token
    const spec = specs[name]
    if (!spec) return { ok: false, error: `${sub} 不認得旗標 ${name}` }

    if (spec.kind === 'bool') {
      if (eq >= 0) return { ok: false, error: `旗標 ${name} 不帶值` }
      flags[name] = true
      continue
    }

    let value: string | undefined
    const extra: string[] = []
    if (eq >= 0) value = token.slice(eq + 1)
    else if (i + 1 < rest.length && !rest[i + 1].startsWith('--')) {
      value = rest[++i]
      if (spec.variadic) {
        while (i + 1 < rest.length && !rest[i + 1].startsWith('--')) extra.push(rest[++i])
      }
    }
    if (value === undefined || value === '') return { ok: false, error: `旗標 ${name} 缺值` }
    if (spec.oneOf && !spec.oneOf.includes(value)) {
      return { ok: false, error: `旗標 ${name} 的值 ${value} 不在 ${spec.oneOf.join('|')} 內` }
    }
    if (spec.repeat) {
      const prev = flags[name]
      flags[name] = Array.isArray(prev) ? [...prev, value, ...extra] : [value, ...extra]
    } else {
      flags[name] = value
    }
  }
  return { ok: true, args: { subcommand: sub, positionals, flags } }
}

// ───────────────────────── 入口 ─────────────────────────

export interface CliIo {
  stdout: (s: string) => void
  stderr: (s: string) => void
  cwd: string
  /** 測試用：換掉動態載入的執行器（例：模擬 hits=0）。 */
  runnerFactory?: RunnerFactory
}

function asList(v: string | string[] | true | undefined): string[] {
  if (v === undefined || v === true) return []
  return Array.isArray(v) ? v : [v]
}

/** `--vouch <file>[::<name>]`；省略名稱＝"*"。 */
export function parseVouch(raw: string): Vouch {
  const i = raw.indexOf('::')
  if (i < 0) return { file: raw, test: '*' }
  return { file: raw.slice(0, i), test: raw.slice(i + 2) === '' ? '*' : raw.slice(i + 2) }
}

/** `--tests-from`：一行一個測試檔，空行與 `#` 開頭略過。 */
function readTestList(cwd: string, path: string): string[] {
  let text: string
  try {
    text = readFileSync(resolve(cwd, path), 'utf8')
  } catch (e) {
    throw new ProbeToolError(`--tests-from 讀不到 ${path}：${(e as Error).message}`)
  }
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
}

/** `--config` 的相對路徑以呼叫端 cwd 解析（D29），交給 runner 的一律是絕對路徑。 */
function resolveConfigFlag(cwd: string, flag: string | string[] | true | undefined) {
  return typeof flag === 'string' ? resolve(cwd, flag) : undefined
}

async function runRun(args: ParsedArgs, io: CliIo): Promise<number> {
  const f = args.flags
  try {
    const runnerKind = f['--runner'] as RunnerKind | undefined
    if (!runnerKind) throw new ProbeToolError('run 缺 --runner node-test|vitest')

    const root = gitToplevel(io.cwd)
    const tests = [
      ...asList(f['--test']),
      ...(typeof f['--tests-from'] === 'string' ? readTestList(io.cwd, f['--tests-from']) : []),
    ].map((t) => toRepoRelative(root, resolve(io.cwd, t)))
    if (tests.length === 0)
      throw new ProbeToolError('run 缺測試檔（--test <file>… 或 --tests-from <list>）')

    const inline = asList(f['--mutation'])
    const fromFile = typeof f['--mutations'] === 'string' ? f['--mutations'] : undefined
    if (inline.length > 0 && fromFile) {
      throw new ProbeToolError('--mutation 與 --mutations 擇一，不可並用')
    }
    if (inline.length === 0 && !fromFile) {
      throw new ProbeToolError(
        "run 缺突變（--mutation '<file>::<from>::<to>…' 或 --mutations <json>）",
      )
    }
    const mutations: MutationInput[] = []
    for (const raw of inline) {
      const p = parseMutationFlag(raw)
      if (!p.ok) throw new ProbeToolError(p.error)
      mutations.push(p.mutation)
    }
    if (fromFile) {
      let text: string
      try {
        text = readFileSync(resolve(io.cwd, fromFile), 'utf8')
      } catch (e) {
        throw new ProbeToolError(`--mutations 讀不到 ${fromFile}：${(e as Error).message}`)
      }
      const p = parseMutationsJson(text)
      if (!p.ok) throw new ProbeToolError(p.error)
      mutations.push(...p.mutations)
    }

    let timeoutMs: number | undefined
    if (typeof f['--timeout'] === 'string') {
      const sec = Number(f['--timeout'])
      if (!Number.isFinite(sec) || sec <= 0) {
        throw new ProbeToolError(`--timeout 必須是正數（秒）：${f['--timeout']}`)
      }
      timeoutMs = Math.round(sec * 1000)
    }

    const out = await runProbe({
      root,
      runnerKind,
      tests,
      config: resolveConfigFlag(io.cwd, f['--config']),
      mutations,
      vouches: asList(f['--vouch']).map(parseVouch),
      timeoutMs,
      writeReceipts: f['--write-receipts'] === true,
      runnerFactory: io.runnerFactory,
      log: (line) => io.stderr(`${line}\n`),
    })

    if (out.toolError !== undefined) {
      io.stderr(`mutation-probe run: ${out.toolError}\n`)
      if (!out.worktree.unchanged) {
        io.stderr(
          `mutation-probe run: 工作樹在執行後不一致：\n${out.worktree.changes.join('\n')}\n`,
        )
      }
      return out.exit
    }

    const summary: ProbeSummary = {
      format_version: RECEIPT_FORMAT_VERSION,
      runner: runnerKind,
      tests: [...new Set(tests)].toSorted(),
      baseline: out.baseline,
      receipts: out.receipts,
      counts: countReceipts(out.receipts),
      worktree_unchanged: out.worktree.unchanged,
    }
    io.stderr(formatSummaryHuman(summary))
    if (!out.worktree.unchanged) {
      io.stderr(`mutation-probe run: 工作樹在執行後不一致：\n${out.worktree.changes.join('\n')}\n`)
    }
    for (const w of out.written) io.stderr(`mutation-probe run: 寫入收據 ${w}\n`)
    if (f['--json'] === true) io.stdout(formatSummaryJson(summary))
    return out.exit
  } catch (e) {
    io.stderr(`mutation-probe run: ${(e as Error).message}\n`)
    return 2
  }
}

// ───────────────────────── replay ─────────────────────────

/** `runner.command` 裡的 `--config <f>`／`--config=<f>`／`-c <f>`（vitest 收據重跑要用同一份 config）。 */
function configFromCommand(command: string[]): string | undefined {
  for (let i = 1; i < command.length; i++) {
    const t = command[i]
    if (t === '--config' || t === '-c') return command[i + 1]
    if (t.startsWith('--config=')) return t.slice('--config='.length)
  }
  return undefined
}

/** 收據 `runner.command` 裡的 config 是 repo 相對路徑（repo 外為絕對路徑）：以 repo root 解析。 */
function resolveRecordedConfig(root: string, recorded: string | undefined): string | undefined {
  return recorded === undefined ? undefined : resolve(root, recorded)
}

export function formatReplayHuman(replays: ReplayEntry[]): string {
  return replays
    .map((r) => `${r.receipt_id} recorded=${r.recorded} replayed=${r.replayed} match=${r.match}`)
    .join('\n')
}

async function runReplay(args: ParsedArgs, io: CliIo): Promise<number> {
  try {
    if (args.positionals.length === 0)
      throw new ProbeToolError('replay 缺收據檔（<receipt.json>…）')
    const root = gitToplevel(io.cwd)

    // 先讀完全部收據：任一張讀不懂就不跑任何重跑（exit 2）。
    const receipts: MutationReceipt[] = []
    for (const p of args.positionals) {
      const r = readReceipt(resolve(io.cwd, p))
      if (!r.ok) throw new ProbeToolError(`收據 ${p}：${r.error}`)
      if (r.receipt.kind !== 'mutation') {
        throw new ProbeToolError(`收據 ${p} 的 kind=${r.receipt.kind}，replay 只重跑 kind=mutation`)
      }
      receipts.push(r.receipt)
    }

    const replays: ReplayEntry[] = []
    for (const rec of receipts) {
      const m = rec.mutation
      const out = await runProbe({
        root,
        runnerKind: rec.runner.kind,
        tests: rec.tests,
        config: resolveRecordedConfig(root, configFromCommand(rec.runner.command)),
        mutations: [
          {
            id: m.id,
            file: m.file,
            from: m.from,
            to: m.to,
            occurrence: m.occurrence,
            description: m.description,
          },
        ],
        vouches: [],
        writeReceipts: false,
        runnerFactory: io.runnerFactory,
        log: (line) => io.stderr(`${line}\n`),
      })
      if (out.toolError !== undefined) {
        io.stderr(`mutation-probe replay: ${rec.receipt_id}：${out.toolError}\n`)
        if (!out.worktree.unchanged) {
          io.stderr(
            `mutation-probe replay: 工作樹在執行後不一致：\n${out.worktree.changes.join('\n')}\n`,
          )
        }
        return out.exit
      }
      if (!out.worktree.unchanged) {
        io.stderr(
          `mutation-probe replay: 工作樹在執行後不一致：\n${out.worktree.changes.join('\n')}\n`,
        )
        return out.exit
      }
      const replayed = out.receipts[0].result
      replays.push({
        receipt_id: rec.receipt_id,
        recorded: rec.result,
        replayed,
        match: replayed === rec.result,
      })
    }

    io.stderr(`${formatReplayHuman(replays)}\n`)
    if (args.flags['--json'] === true) {
      const summary: ReplaySummary = { format_version: RECEIPT_FORMAT_VERSION, replays }
      io.stdout(`${JSON.stringify(summary, null, 2)}\n`)
    }
    return replays.every((r) => r.replayed === 'caught') ? 0 : 1
  } catch (e) {
    io.stderr(`mutation-probe replay: ${(e as Error).message}\n`)
    return 2
  }
}

// ───────────────────────── exempt ─────────────────────────

async function runExempt(args: ParsedArgs, io: CliIo): Promise<number> {
  const f = args.flags
  try {
    const kind = f['--kind']
    if (typeof kind !== 'string')
      throw new ProbeToolError('exempt 缺 --kind feature-removed|bdd-remove')
    if (typeof f['--reason'] !== 'string') throw new ProbeToolError('exempt 缺 --reason <text>')
    // 欄位缺漏在這裡就擋下（assembleExemption 丟 ProbeToolError）：NEVER 寫出殘缺的宣告，也不碰工作樹。
    const exemption = assembleExemption({
      exemption: kind as ExemptionKind,
      reason: f['--reason'],
      ref: typeof f['--ref'] === 'string' ? f['--ref'] : undefined,
      removed_paths: asList(f['--removed']),
      vouches_for: asList(f['--vouch']).map(parseVouch),
    })

    const root = gitToplevel(io.cwd)
    // 工作樹保證：唯一允許的新增是這張收據檔。
    const written: string[] = []
    const guard = beginWorktreeGuard({ root, files: [], ignorePaths: () => written })
    let path: string
    try {
      path = writeReceipt(root, exemption)
      written.push(path)
    } catch (e) {
      guard.dispose()
      throw new ProbeToolError(`寫入豁免收據失敗：${(e as Error).message}`)
    }
    const worktree = guard.finish()
    io.stderr(`mutation-probe exempt: 寫入豁免收據 ${path}\n`)
    if (!worktree.unchanged) {
      io.stderr(`mutation-probe exempt: 工作樹在執行後不一致：\n${worktree.changes.join('\n')}\n`)
      return 3
    }
    return 0
  } catch (e) {
    io.stderr(`mutation-probe exempt: ${(e as Error).message}\n`)
    return 2
  }
}

// ───────────────────────── revive ─────────────────────────

export function formatReviveHuman(
  revived: { file: string; name: string; status: string; firstFailing?: string }[],
  counts: ReviveSummary['counts'],
): string {
  const lines = revived.map(
    (r) => `${r.file} > ${r.name} ${r.status}${r.firstFailing ? ` ${r.firstFailing}` : ''}`,
  )
  lines.push(`pass=${counts.pass} fail=${counts.fail} timeout=${counts.timeout}`)
  return `${lines.join('\n')}\n`
}

async function runReviveCmd(args: ParsedArgs, io: CliIo): Promise<number> {
  const f = args.flags
  try {
    const runnerKind = f['--runner'] as RunnerKind | undefined
    if (!runnerKind) throw new ProbeToolError('revive 缺 --runner node-test|vitest')
    const root = gitToplevel(io.cwd)
    const tests = asList(f['--test']).map((t) => toRepoRelative(root, resolve(io.cwd, t)))
    if (tests.length === 0) throw new ProbeToolError('revive 缺測試檔（--test <file>…）')

    const out = await runRevive({
      root,
      runnerKind,
      tests,
      config: resolveConfigFlag(io.cwd, f['--config']),
      runnerFactory: io.runnerFactory,
      log: (line) => io.stderr(`${line}\n`),
    })
    if (out.toolError !== undefined) {
      io.stderr(`mutation-probe revive: ${out.toolError}\n`)
      if (!out.worktree.unchanged) {
        io.stderr(
          `mutation-probe revive: 工作樹在執行後不一致：\n${out.worktree.changes.join('\n')}\n`,
        )
      }
      return out.exit
    }
    io.stderr(formatReviveHuman(out.revived, out.counts))
    if (!out.worktree.unchanged) {
      io.stderr(
        `mutation-probe revive: 工作樹在執行後不一致：\n${out.worktree.changes.join('\n')}\n`,
      )
    }
    if (f['--json'] === true) {
      const summary: ReviveSummary = {
        revived: out.revived.map(({ file, name, status }) => ({ file, name, status })),
        counts: out.counts,
      }
      io.stdout(`${JSON.stringify(summary, null, 2)}\n`)
    }
    return out.exit
  } catch (e) {
    io.stderr(`mutation-probe revive: ${(e as Error).message}\n`)
    return 2
  }
}

/**
 * 回傳 exit code，不碰 process.exit：測試 in-process 呼叫，CLI 入口（invokedAsCli）才轉成 exit。
 * 四個子指令都要等子行程或 I/O，回 Promise；用法錯誤同步回 number。呼叫端一律 `await`。
 */
export function main(argv: string[], io: CliIo): number | Promise<number> {
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    io.stderr(`mutation-probe: ${parsed.error}\n${USAGE}\n`)
    return 2
  }
  switch (parsed.args.subcommand) {
    case 'run':
      return runRun(parsed.args, io)
    case 'replay':
      return runReplay(parsed.args, io)
    case 'exempt':
      return runExempt(parsed.args, io)
    case 'revive':
      return runReviveCmd(parsed.args, io)
  }
}

function invokedAsCli(): boolean {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedAsCli()) {
  // 先寫完 stdout 再 exit：`--json` 的輸出可能很大，process.exit 不會等管線排空。
  const code = await main(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    cwd: process.cwd(),
  })
  process.exitCode = code
}
