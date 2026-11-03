// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/mutation-probe/receipt.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/mutation-probe/receipt.ts
// CLADE:VENDOR-SCRIPT
//
// mutation-probe/receipt — 收據型別、組裝、讀寫與有效性判定
//
// 契約：specs/truth/data/break-receipt.md（欄位、值域、§ 有效性 1–6）、
//       specs/truth/contracts/mutation-probe-cli.md § 1（收據寫檔位置）。
//
// 有效性判定（`validateReceipt`）住這裡：刪除／合併測試閘門與 0-A 判準都引用它，不各寫一份。
// 有效性 6（CI 端重跑）不在本檔——它要跑測試行程，由 `mutation-probe.ts replay` 負責。
//
// 由 ~/clade vendor/scripts/lib/ 散播，請勿直接編輯 consumer 副本。

import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

// ───────────────────────── 型別（欄位照 break-receipt.md § 欄位表）─────────────────────────

export const RESULTS = ['caught', 'survived', 'baseline-red', 'not-applicable', 'timeout'] as const
export type MutationResult = (typeof RESULTS)[number]

export const NA_REASONS = ['target-not-found', 'target-is-test', 'target-missing'] as const
export type NaReason = (typeof NA_REASONS)[number]

export const SURVIVED_KINDS = ['exercised', 'not-loaded'] as const
export type SurvivedKind = (typeof SURVIVED_KINDS)[number]

export const SITE_SCOPES = ['function-body', 'module-level', 'unknown'] as const
export type SiteScope = (typeof SITE_SCOPES)[number]

export const RUNNER_KINDS = ['node-test', 'vitest'] as const
export type RunnerKind = (typeof RUNNER_KINDS)[number]

export const BASELINE_STATUSES = ['green', 'red', 'timeout'] as const
export type BaselineStatus = (typeof BASELINE_STATUSES)[number]

export const EXEMPTION_KINDS = ['feature-removed', 'bdd-remove'] as const
export type ExemptionKind = (typeof EXEMPTION_KINDS)[number]

/** 本檔支援的收據 `format_version`；閘門只認自己支援的版本，其餘判無效。 */
export const RECEIPT_FORMAT_VERSION = 1

/** 收據目錄（repo 相對、POSIX）。 */
export const RECEIPT_DIR = '.clade/break-receipts'

export interface MutationSpec {
  id: string | null
  file: string
  from: string
  to: string
  occurrence: number
  description?: string
  site_scope: SiteScope
}

export interface ReceiptBaseline {
  status: BaselineStatus
  passed: number
  failed: number
  ms: number
}

export interface FailingTest {
  file: string
  name: string
}

/** 收據替哪支被刪或合併的測試作證；整檔刪除 `test` 寫 `"*"`。 */
export interface Vouch {
  file: string
  test: string
}

export interface MutationReceipt {
  format_version: number
  kind: 'mutation'
  receipt_id: string
  created_at: string
  repo_head: string
  mutation: MutationSpec
  /** `mutation.file` 工作樹內容的 git blob sha；檔案不存在（`target-missing`）時為空字串。 */
  target_fingerprint: string
  runner: { kind: RunnerKind; command: string[]; node: string }
  tests: string[]
  /** `result=not-applicable` 時為 null。 */
  baseline: ReceiptBaseline | null
  result: MutationResult
  /** 只在 `result=not-applicable` 時出現。 */
  na_reason?: NaReason
  /** `result=not-applicable` 時為 null。 */
  applied: { loaded: boolean; hits: number } | null
  failing_tests: FailingTest[]
  /** 只在 `result=survived` 時非 null。 */
  survived_kind: SurvivedKind | null
  /** `result=not-applicable` 時為 null。 */
  ms: number | null
  vouches_for?: Vouch[]
}

export interface ExemptionReceipt {
  format_version: number
  kind: 'exemption'
  receipt_id: string
  created_at: string
  exemption: ExemptionKind
  reason: string
  /** `bdd-remove` 必填；`feature-removed` 選填（未給可省略或寫 null，兩者等價）。 */
  ref?: string | null
  /** `feature-removed` 必填。 */
  removed_paths?: string[]
  vouches_for: Vouch[]
}

export type Receipt = MutationReceipt | ExemptionReceipt

/**
 * 工具層錯誤：呼叫端轉 exit 2。突變沒套上卻被當成測試結果，是這個探針最該擋的誤判
 * （`hits=0` 而模組已載入；沒套上卻有測試失敗），所以丟出而不是回報成某個 result。
 */
export class ProbeToolError extends Error {}

// ───────────────────────── git 小工具 ─────────────────────────

/** 工作樹內容的 git blob sha（`git hash-object`，含 clean filter，與 commit 進去的 blob 同口徑）；檔案不存在回 ''。 */
export function blobShaOfWorktreeFile(root: string, file: string): string {
  if (!existsSync(join(root, file))) return ''
  return execFileSync('git', ['hash-object', '--', file], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** 目前 HEAD sha；沒有 commit 或不是 git repo 回 ''。 */
export function gitHead(root: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

// ───────────────────────── 組裝 ─────────────────────────

/** `YYYYMMDDTHHMMSSZ`（沒有毫秒）。 */
function compactStamp(d: Date): string {
  return d
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '')
}

/** ISO 8601 UTC，沒有毫秒（`YYYY-MM-DDTHH:MM:SSZ`）。 */
export function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function safeStem(name: string): string {
  const stem = basename(name, extname(name)).replace(/[^A-Za-z0-9_-]+/g, '-')
  return stem === '' ? 'target' : stem
}

/** `<created_at 的 YYYYMMDDTHHMMSSZ>-<target 檔名 stem>-<6 hex>`；與收據檔名相同。 */
export function makeReceiptId(
  stemSource: string,
  now: Date = new Date(),
  hex: string = randomBytes(3).toString('hex'),
): string {
  return `${compactStamp(now)}-${safeStem(stemSource)}-${hex}`
}

/** 一趟突變執行的觀測結果（執行器填）。 */
export interface RunOutcome {
  timedOut: boolean
  failing: FailingTest[]
  /** 被突變的模組在測試行程中是否載入過。 */
  loaded: boolean
  /** 替換實際發生的次數（跨所有測試子行程加總）。 */
  hits: number
  ms: number
  /**
   * 真的執行且通過的 test case 完整名稱（巢狀前綴以 ` > ` 串接；skip／todo 不算）。
   * `revive` 靠它核對復活的測試確實跑過：沒有失敗不等於它有跑。
   */
  passedNames?: string[]
}

export interface ReceiptCommon {
  mutation: MutationSpec
  target_fingerprint: string
  runner: { kind: RunnerKind; command: string[]; node: string }
  tests: string[]
  /** `not-applicable` 時傳 null；其餘為基線實測。 */
  baseline: ReceiptBaseline | null
  repo_head: string
  vouches_for?: Vouch[]
  now?: Date
  /** 測試用：固定 6 hex。 */
  hex?: string
}

/**
 * 這一個突變怎麼收場。單一形狀（tsconfig strict:false，union 不收斂）：
 * - `not-applicable`：`na_reason` 必填，不跑測試
 * - `baseline-red`：基線不綠，突變沒跑
 * - `ran`：突變那一趟的 `run` 必填；`baseline` 必須 green
 */
export interface MutationOutcome {
  kind: 'not-applicable' | 'baseline-red' | 'ran'
  na_reason?: NaReason
  run?: RunOutcome
}

/** 判定 `ran` 的結果。`hits=0` 而已載入、或沒套上卻有測試失敗 → ProbeToolError。 */
export function decideRanResult(run: RunOutcome): {
  result: MutationResult
  survived_kind: SurvivedKind | null
} {
  if (run.timedOut) return { result: 'timeout', survived_kind: null }
  if (run.loaded && run.hits === 0) {
    throw new ProbeToolError(
      '被突變的模組已載入但 hits=0：from 與載入內容對不上，突變沒套上（不是 survived）',
    )
  }
  if (run.failing.length > 0) {
    if (run.hits === 0) {
      throw new ProbeToolError(
        '突變沒有套上（hits=0）卻有測試失敗：結果不可歸因於突變，不能算 caught',
      )
    }
    return { result: 'caught', survived_kind: null }
  }
  return { result: 'survived', survived_kind: run.loaded ? 'exercised' : 'not-loaded' }
}

/** 收據組裝。`not-applicable` 的 baseline／applied／ms 為 null（data 契約 § result 值域）。 */
export function assembleMutationReceipt(
  common: ReceiptCommon,
  outcome: MutationOutcome,
): MutationReceipt {
  const now = common.now ?? new Date()
  const base = {
    format_version: RECEIPT_FORMAT_VERSION,
    kind: 'mutation' as const,
    receipt_id: makeReceiptId(common.mutation.file, now, common.hex),
    created_at: isoSeconds(now),
    repo_head: common.repo_head,
    mutation: common.mutation,
    target_fingerprint: common.target_fingerprint,
    runner: common.runner,
    tests: [...new Set(common.tests)].toSorted(),
    vouches_for: common.vouches_for ?? [],
  }

  if (outcome.kind === 'not-applicable') {
    if (!outcome.na_reason) throw new ProbeToolError('not-applicable 必須帶 na_reason')
    return {
      ...base,
      baseline: null,
      result: 'not-applicable',
      na_reason: outcome.na_reason,
      applied: null,
      failing_tests: [],
      survived_kind: null,
      ms: null,
    }
  }

  if (!common.baseline) throw new ProbeToolError(`${outcome.kind} 必須帶基線結果`)

  if (outcome.kind === 'baseline-red') {
    if (common.baseline.status === 'green') {
      throw new ProbeToolError('baseline-red 的基線卻是 green')
    }
    // 突變沒跑：applied 記未載入、ms 記 0（型別只允許 not-applicable 為 null）。
    return {
      ...base,
      baseline: common.baseline,
      result: 'baseline-red',
      applied: { loaded: false, hits: 0 },
      failing_tests: [],
      survived_kind: null,
      ms: 0,
    }
  }

  if (!outcome.run) throw new ProbeToolError('ran 必須帶 run')
  if (common.baseline.status !== 'green') {
    throw new ProbeToolError('基線不綠時 NEVER 跑突變（FR-002），ran 不可搭配非 green 基線')
  }
  const run = outcome.run
  const decided = decideRanResult(run)
  return {
    ...base,
    baseline: common.baseline,
    result: decided.result,
    applied: { loaded: run.loaded, hits: run.hits },
    failing_tests: decided.result === 'caught' ? run.failing : [],
    survived_kind: decided.survived_kind,
    ms: run.ms,
  }
}

export interface ExemptionInput {
  exemption: ExemptionKind
  reason: string
  ref?: string
  removed_paths?: string[]
  vouches_for: Vouch[]
  now?: Date
  hex?: string
}

/** 豁免宣告組裝；欄位缺漏 → ProbeToolError（**NEVER** 組出殘缺的宣告）。 */
export function assembleExemption(input: ExemptionInput): ExemptionReceipt {
  const problem = exemptionFieldProblem(input)
  if (problem) throw new ProbeToolError(problem)
  if (input.vouches_for.length === 0)
    throw new ProbeToolError('exempt 缺 --vouch：沒有指明替哪支測試豁免')
  const now = input.now ?? new Date()
  const out: ExemptionReceipt = {
    format_version: RECEIPT_FORMAT_VERSION,
    kind: 'exemption',
    receipt_id: makeReceiptId('exemption', now, input.hex),
    created_at: isoSeconds(now),
    exemption: input.exemption,
    reason: input.reason,
    vouches_for: input.vouches_for,
  }
  if (input.ref !== undefined && input.ref !== '') out.ref = input.ref
  if (input.removed_paths && input.removed_paths.length > 0) out.removed_paths = input.removed_paths
  return out
}

/** 豁免宣告欄位合法性（組裝與有效性共用）；合法回 null，否則回缺什麼。 */
function exemptionFieldProblem(e: {
  exemption?: string
  reason?: string
  ref?: string
  removed_paths?: string[]
}): string | null {
  if (!(EXEMPTION_KINDS as readonly string[]).includes(e.exemption ?? '')) {
    return `exemption 只能是 ${EXEMPTION_KINDS.join('|')}`
  }
  if (typeof e.reason !== 'string' || e.reason.trim() === '') return '缺 reason（--reason 不可空）'
  if (e.exemption === 'bdd-remove' && (typeof e.ref !== 'string' || e.ref === '')) {
    return 'bdd-remove 缺 ref（--ref <path#anchor>）'
  }
  if (
    e.exemption === 'feature-removed' &&
    (!Array.isArray(e.removed_paths) || e.removed_paths.length === 0)
  ) {
    return 'feature-removed 缺 removed_paths（--removed <product path>）'
  }
  return null
}

// ───────────────────────── 讀寫 ─────────────────────────

/** 寫 `.clade/break-receipts/<receipt_id>.json`；回 repo 相對路徑。已存在 → 丟錯（不覆蓋）。 */
export function writeReceipt(root: string, receipt: Receipt): string {
  const rel = `${RECEIPT_DIR}/${receipt.receipt_id}.json`
  mkdirSync(join(root, RECEIPT_DIR), { recursive: true })
  writeFileSync(join(root, rel), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
  return rel
}

export interface ParseReceiptResult {
  ok: boolean
  receipt?: Receipt
  error?: string
  /** `format_version` 不是本檔支援的版本（與「讀不懂」分開，閘門訊息不同）。 */
  unsupported_version?: boolean
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
const isStr = (v: unknown): v is string => typeof v === 'string'
const isInt = (v: unknown): v is number => Number.isInteger(v)

function vouchesProblem(v: unknown, required: boolean): string | null {
  if (v === undefined) return required ? '缺 vouches_for' : null
  if (!Array.isArray(v)) return 'vouches_for 不是陣列'
  for (const x of v) {
    if (!isObj(x) || !isStr(x.file) || !isStr(x.test)) return 'vouches_for 元素缺 file／test'
  }
  return null
}

/** 欄位形狀檢查（只擋會讓判定讀到 undefined 的缺漏；值域語意由 validateReceipt 判）。 */
function shapeProblem(o: Record<string, unknown>): string | null {
  if (!isStr(o.receipt_id) || !isStr(o.created_at)) return '缺 receipt_id／created_at'
  if (o.kind === 'exemption') {
    if (!isStr(o.exemption) || !isStr(o.reason)) return '豁免宣告缺 exemption／reason'
    if (o.ref !== undefined && o.ref !== null && !isStr(o.ref)) return 'ref 不是字串'
    if (
      o.removed_paths !== undefined &&
      !(Array.isArray(o.removed_paths) && o.removed_paths.every(isStr))
    ) {
      return 'removed_paths 不是字串陣列'
    }
    return vouchesProblem(o.vouches_for, true)
  }
  if (o.kind !== 'mutation') return `未知 kind ${String(o.kind)}`
  const m = o.mutation
  if (!isObj(m) || !isStr(m.file) || !isStr(m.from) || !isStr(m.to) || !isInt(m.occurrence)) {
    return 'mutation 缺 file／from／to／occurrence'
  }
  if (!isStr(o.target_fingerprint)) return '缺 target_fingerprint'
  const r = o.runner
  if (!isObj(r) || !isStr(r.kind) || !Array.isArray(r.command) || !r.command.every(isStr)) {
    return 'runner 缺 kind／command'
  }
  if (!Array.isArray(o.tests) || !o.tests.every(isStr)) return 'tests 不是字串陣列'
  if (!(RESULTS as readonly string[]).includes(o.result as string))
    return `result 值域外：${String(o.result)}`
  if (!Array.isArray(o.failing_tests)) return 'failing_tests 不是陣列'
  for (const f of o.failing_tests) {
    if (!isObj(f) || !isStr(f.file) || !isStr(f.name)) return 'failing_tests 元素缺 file／name'
  }
  return vouchesProblem(o.vouches_for, false)
}

/** shapeProblem 通過即視為 Receipt（形狀已逐欄檢過，守衛取代斷言）。 */
function passesShape(o: Record<string, unknown>): o is Record<string, unknown> & Receipt {
  return shapeProblem(o) === null
}

/** 解析收據 JSON 文字：讀不懂與版本不支援各自回報（呼叫端 exit 2 或判無效）。 */
export function parseReceipt(
  text: string,
  supportedVersions: readonly number[] = [RECEIPT_FORMAT_VERSION],
): ParseReceiptResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `不是合法 JSON：${(e as Error).message}` }
  }
  if (!isObj(raw)) return { ok: false, error: '收據不是 JSON 物件' }
  if (!isInt(raw.format_version)) return { ok: false, error: '缺 format_version' }
  if (!supportedVersions.includes(raw.format_version)) {
    return {
      ok: false,
      unsupported_version: true,
      error: `format_version ${raw.format_version} 不受支援（支援 ${supportedVersions.join(',')}）`,
    }
  }
  if (!passesShape(raw)) return { ok: false, error: shapeProblem(raw) ?? '收據欄位形狀不合' }
  return { ok: true, receipt: raw }
}

/** 讀收據檔；讀不到或讀不懂 → ok:false。 */
export function readReceipt(
  path: string,
  supportedVersions?: readonly number[],
): ParseReceiptResult {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    return { ok: false, error: `讀不到 ${path}：${(e as Error).message}` }
  }
  return parseReceipt(text, supportedVersions)
}

// ───────────────────────── 有效性（break-receipt.md § 有效性 1–5）─────────────────────────

/** 改動 C（base→head）對判定的輸入。全部由閘門從 git 取得，本檔不碰 git。 */
export interface ReceiptChange {
  /** C 新增或修改的收據檔 receipt_id（有效性 1）。 */
  changedReceiptIds: ReadonlySet<string>
  /** 閘門支援的 format_version；預設只有 1。 */
  supportedVersions?: readonly number[]
  /** C 中整檔刪除的測試檔。 */
  deletedFiles: ReadonlySet<string>
  /** 名稱列舉判不出的測試檔（`test-cases.ts` 的 indeterminate）。 */
  indeterminateFiles: ReadonlySet<string>
  /** C 刪除的全部 test case `(file, 完整名稱)`（有效性 5 排除用）。 */
  deletedCases: readonly Vouch[]
  /** head 版該檔的 test case 完整名稱；檔案不存在或名稱判不出回 null（無法確認＝不成立）。 */
  headTestNames: (file: string) => readonly string[] | null
  /** head 版檔案的 git blob sha；檔案不存在回 null。 */
  headBlobSha: (file: string) => string | null
  /** head 是否有這個路徑（`bdd-remove` 的 `ref`）。 */
  headFileExists: (path: string) => boolean
}

export interface ValidityResult {
  valid: boolean
  /** 第一個不成立的有效性編號（1–5）；豁免宣告欄位不合法為 `'exemption'`；有效時 null。 */
  failed: number | 'exemption' | null
  reason: string
}

const ok = (): ValidityResult => ({ valid: true, failed: null, reason: '有效' })
const bad = (failed: number | 'exemption', reason: string): ValidityResult => ({
  valid: false,
  failed,
  reason,
})

/** 有效性 2：收據是否替 `target` 作證。 */
function vouchCovers(receipt: Receipt, target: Vouch, change: ReceiptChange): boolean {
  const vouches = receipt.vouches_for ?? []
  if (vouches.some((v) => v.file === target.file && v.test === target.test)) return true
  const wholeFileOk =
    change.deletedFiles.has(target.file) || change.indeterminateFiles.has(target.file)
  return wholeFileOk && vouches.some((v) => v.file === target.file && v.test === '*')
}

/**
 * 收據 `receipt` 對被刪 test case `target`（整檔刪除或 indeterminate 的檔，`test` 寫 `"*"`）是否有效。
 * `kind=mutation` 判 1–5；`kind=exemption` 判 1、2 與欄位合法（`bdd-remove` 的 `ref` 檔須存在於 head）。
 * 不判 6（CI 重跑）。回傳第一個不成立的編號。
 */
export function validateReceipt(
  receipt: Receipt,
  target: Vouch,
  change: ReceiptChange,
): ValidityResult {
  const supported = change.supportedVersions ?? [RECEIPT_FORMAT_VERSION]

  // 1. C 新增或修改的檔，版本受支援
  if (!supported.includes(receipt.format_version)) {
    return bad(1, `format_version ${receipt.format_version} 不受支援`)
  }
  if (!change.changedReceiptIds.has(receipt.receipt_id)) {
    return bad(1, `${receipt.receipt_id} 不是本次改動新增或修改的收據`)
  }

  // 2. 作證對象
  if (!vouchCovers(receipt, target, change)) {
    return bad(2, `vouches_for 沒有涵蓋 ${target.file} > ${target.test}`)
  }

  if (receipt.kind === 'exemption') {
    const problem = exemptionFieldProblem(receipt)
    if (problem) return bad('exemption', problem)
    if (receipt.exemption === 'bdd-remove') {
      const refPath = receipt.ref.split('#')[0]
      if (!change.headFileExists(refPath))
        return bad('exemption', `ref 指向的檔不存在於 head：${refPath}`)
    }
    return ok()
  }

  // 3. 指紋：收據產生後產品碼又改過 → 過期
  const head = change.headBlobSha(receipt.mutation.file)
  if (head === null || head !== receipt.target_fingerprint) {
    return bad(
      3,
      `target_fingerprint 與 head 的 ${receipt.mutation.file} 不符（收據過期或檔案已不存在）`,
    )
  }

  // 4. 只有 caught 證明保護仍在
  if (receipt.result !== 'caught') {
    return bad(4, `result=${receipt.result}，只有 caught 能證明保護仍在`)
  }

  // 5. 抓到它的 test case 不能是同一改動刪掉的
  const deleted = (file: string, name: string) =>
    change.deletedFiles.has(file) ||
    change.deletedCases.some((c) => c.file === file && c.test === name)
  const survivor = receipt.failing_tests.find((f) => {
    const names = change.headTestNames(f.file)
    return names !== null && names.includes(f.name) && !deleted(f.file, f.name)
  })
  if (!survivor) {
    return bad(5, 'failing_tests 沒有任何一筆在 head 仍存在且未被本次改動刪除（只指向被刪的測試）')
  }
  return ok()
}
