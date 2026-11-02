// 🔒 LOCKED — managed by clade · Source: vendor/scripts/checks/skip-gate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/checks/skip-gate.ts
// CLADE:VENDOR-SCRIPT
//
// skip-gate — skip 誠實度閘門：新增的 skip 要寫理由與到期日，碰到過期 skip 的改動被擋，
// 宣稱 `revive=auto` 的 skip 在 CI 復活後必須是綠的
//
// skip 的辨認與標記解析只經 `../lib/mutation-probe/revive.ts` 的 `findSkipSites`／`parseSkipMarker`（`typescript`
// AST，不用 regex 認 skip）；baseline 讀寫與「只縮不增」比對只經 `../lib/test-trust-baseline.ts`。
// 一份判定式兩個消費端共用：
//   - pre-commit：`pre-commit/checks/skip-expiry.sh` → `--staged`（base＝HEAD，head＝index；不跑復活，只印「CI 會驗」）
//   - CI：`vendor/actions/skip-expiry` → `--against <ref>`（base＝merge-base(HEAD, ref)，head＝HEAD；另跑 `revive`）
//
// 標記格式（FR-015）：skip 所在行或其正上方一行的註解
//   `clade-skip: until=<YYYY-MM-DD> reason=<非空文字>[ revive=auto]`
//
// 擋法（只看本次 diff 中的測試檔）：
//   skip 數多於 baseline 該檔的數（或檔不在 baseline），多出來的缺標記或欄位不合法  → block missing-marker
//   任一帶合法標記的 skip，`until` 早於今天（UTC）                               → block expired
//   本次新增或修改的 `revive=auto` skip，CI 復活後 fail／timeout（或復活跑不起來）   → block revive-failed（僅 --against）
//   baseline 檔相對 base 新增列或 count 變大（FR-036）                            → block baseline
//   head 沒有 baseline                                                         → exit 3，印 `--init-baseline` 指令
//     （例外：pre-commit `--staged` 且 base 也沒有 baseline＝尚未採用 → 印 info 後 exit 0，不擋 commit）
// 放行：合法標記（marked）、復活通過（revived）、baseline 內存量無標記且該檔 skip 數未超過 baseline（baseline，plan D22）；
//   檔不在 diff 中的過期 skip 不擋（FR-015a）；`.todo(` 不算 skip。
//
// 其他模式：
//   `--report`         唯讀稽核：不看 diff，對全 repo 每個 skip 印 red（過期）／warn（無標記）／ok（標記合法），有 red exit 1
//   `--init-baseline`  凍結當下無標記（或標記不合法）的存量 skip 進 baseline 的 skips 段（已有 skip 列 → 拒絕 exit 2；保留 orphans 段，與孤兒端對稱）
//
// stdout 一行一筆（契約：specs/truth/features/cli/skip-gate/dsl.md）：
//   `<verdict> <file> > <name> — <code>[ <detail>]`；另有 `info`／`hint` 前綴的輔助行。給人看的說明走 stderr。
//
// 辨認 skip 依賴 `typescript`（從 consumer 自己的 node_modules 解析）；找不到 → 判定模式 soft-skip exit 0
// （非 TS repo，或 CI 還沒 install）；`--report`／`--init-baseline` 沒有 TS 就無從掃描 → exit 2。
//
// 由 ~/clade vendor/scripts/checks/ 散播，請勿直接編輯 consumer 副本。

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findSkipSites } from '../lib/mutation-probe/revive.ts'
import type { SkipSite } from '../lib/mutation-probe/revive.ts'
import { loadTypescript } from '../lib/mutation-probe/mutation.ts'
import {
  BASELINE_REL_PATH,
  BaselineFormatError,
  baselinePath,
  compareBaseline,
  createBaseline,
  parseBaseline,
  readBaseline,
  shrinkBaseline,
  writeBaseline,
  type SkipBaselineRow,
  type TestTrustBaseline,
} from '../lib/test-trust-baseline.ts'
import { isTestPath } from './source-assert-detect.ts'

const here = dirname(fileURLToPath(import.meta.url))

export const GROW_MESSAGE = 'baseline 只能縮小'
export const MARKER_FORMAT = 'clade-skip: until=<YYYY-MM-DD> reason=<文字>[ revive=auto]'
export const INIT_BASELINE_CREATED_BY = 'skip-gate.ts --init-baseline'
export const SHRINK_FLAG = '--shrink-baseline'

export type Mode = { staged: true } | { against: string }

// ───────────────────────── skip 清單 ─────────────────────────

/** `findSkipSites` 的一筆，加上「是不是真的在跳過」：`{ skip: false }`、`.skipIf(false)` 是明寫不跳過，不算 skip。 */
export type LiveSite = SkipSite & { live: boolean }

export interface SkipListing {
  /** 全部被辨認的 site（含 `live=false`），行序；`revive` 的輸出順序與此一致。 */
  sites: LiveSite[]
  error?: string
}

export function listSkips(source: string, file: string): SkipListing {
  const found = findSkipSites(source, file)
  if (found.error) return { sites: [], error: found.error }
  return {
    sites: found.sites.map((s) => ({
      ...s,
      live: !(
        (s.form === 'options-skip' || s.form === 'skipIf') &&
        s.replace.from.trim() === 'false'
      ),
    })),
  }
}

function siteLabel(s: SkipSite): string {
  return s.name ?? `(L${s.line})`
}

/** 跨版本比對同一個 skip：形狀＋名稱（名稱判不出就用被替換的條件原文）。 */
function siteKey(s: SkipSite): string {
  return `${s.form}\u0000${s.name ?? `?${s.replace.from}`}`
}

/** 比對「同一個 skip 沒被改過」：key 加標記全部欄位。 */
function siteFingerprint(s: SkipSite): string {
  const m = s.marker
  return `${siteKey(s)}\u0000${s.replace.from}\u0000${m ? `${m.until}|${m.reason}|${m.reviveAuto}` : ''}`
}

function isMarked(s: SkipSite): boolean {
  return s.marker !== null && s.marker.problems.length === 0
}

function isExpired(s: SkipSite, today: string): boolean {
  return isMarked(s) && s.marker!.until !== null && s.marker!.until < today
}

function markerProblem(s: SkipSite): string {
  if (s.marker === null) return '沒有 clade-skip 標記'
  return s.marker.problems.join('；')
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

// ───────────────────────── 純判定 ─────────────────────────

export interface FileChange {
  path: string
  /** head 版內容。 */
  head: string
  /** base 版內容；新增檔（含 rename／copy 的新路徑）為 null——rename 照新增，baseline 不跟著搬。 */
  base: string | null
  /** rename 時的舊路徑內容，只供「這個 skip 有沒有被改過」的比對（baseline 配額仍以新路徑算）。 */
  renamedFrom?: string | null
}

export type ReviveStatus = 'pass' | 'fail' | 'timeout'
// tsconfig 是 strict:false，discriminated union 不會收斂；用單一形狀：ok 為真時才有 entries，否則才有 reason。
export interface ReviveOutcome {
  ok: boolean
  entries?: { file: string; name: string; status: ReviveStatus; detail?: string }[]
  reason?: string
}

/** CI 端復活：對一組檔（`runner` 為探針的 `--runner`）執行 `mutation-probe.ts revive`。 */
export type Reviver = (files: string[], runner: 'node-test' | 'vitest') => ReviveOutcome

export interface GateInput {
  base: TestTrustBaseline | null
  head: TestTrustBaseline | null
  files: readonly FileChange[]
  /**
   * head baseline 每個 skip 列所指檔案的 head 內容（檔已不在為 null），供「baseline 可縮」提示；
   * 省略＝不提示。
   */
  rowSources?: ReadonlyMap<string, string | null>
}

export interface GateContext {
  mode: 'staged' | 'against'
  /** `YYYY-MM-DD`（UTC）。 */
  today: string
  root: string
  /** 本檔路徑，hint 用。 */
  selfPath: string
  /** 只有 `--against` 用；沒給＝不復活（等同 pre-commit）。 */
  reviver?: Reviver
}

export interface GateResult {
  exitCode: 0 | 1 | 3
  stdout: string[]
  stderr: string[]
}

export function initBaselineCommand(selfPath: string): string {
  return `node ${selfPath} --init-baseline`
}

export function runnerKindFor(source: string): 'node-test' | 'vitest' {
  return /from\s+['"](?:vitest|vite-plus\/test|vite-plus)['"]/.test(source) ? 'vitest' : 'node-test'
}

/** 純判定：不碰檔案系統與 git；復活經 `ctx.reviver` 注入。 */
export function evaluate(input: GateInput, ctx: GateContext): GateResult {
  const stdout: string[] = []
  const stderr: string[] = []

  if (input.head === null && input.base === null && ctx.mode === 'staged') {
    // pre-commit 在尚未採用（沒有 baseline）的 consumer 不擋：否則 fleet 每個 commit 都被擋。
    // baseline 被刪（base 有、head 無）與 CI（--against）仍是 exit 3。
    stdout.push(
      `info skip-expiry 略過 — 無 baseline（${BASELINE_REL_PATH}），尚未採用；建立：${initBaselineCommand(ctx.selfPath)}`,
    )
    return { exitCode: 0, stdout, stderr }
  }

  if (input.head === null) {
    stdout.push(
      `block baseline — 無 baseline（${BASELINE_REL_PATH}），閘門不猜：既有 skip 需先凍結`,
      `hint 建立：${initBaselineCommand(ctx.selfPath)}（在 repo 根執行；建好後把 baseline 檔 commit 進 repo）`,
    )
    return { exitCode: 3, stdout, stderr }
  }

  let blocked = false
  const comparison = compareBaseline(input.base, input.head)
  if (comparison.verdict === 'grow') {
    blocked = true
    stdout.push(`block baseline — ${GROW_MESSAGE}`)
    for (const row of comparison.addedOrphans) {
      stderr.push(`  baseline 新增孤兒列：${row.path}（${row.reason}）`)
    }
    for (const g of comparison.grownSkips) {
      stderr.push(`  baseline skip 列變大：${g.path}（${g.from} → ${g.to}）`)
    }
    stderr.push(
      '  baseline 是上線當下的存量凍結，只能縮小。新增的 skip 請寫 clade-skip 標記，不要寫進 baseline。',
    )
  } else if (comparison.verdict === 'create') {
    stdout.push(
      `info baseline 建立 — orphans ${comparison.rowCount.orphans} 列、skips ${comparison.rowCount.skips} 列（0-A 請檢視這份存量凍結）`,
    )
  }

  const quota = new Map(input.head.skips.map((r) => [r.path, r.count]))

  interface Pending {
    file: string
    site: LiveSite
  }
  const reviveWanted: Pending[] = []
  const reviveRaw = new Map<string, LiveSite[]>()
  const runnerOf = new Map<string, 'node-test' | 'vitest'>()
  /** 每個 site 最後的輸出行，依 site 還原行序用。 */
  const outLines = new Map<LiveSite, string>()
  const orderedFiles: { file: string; sites: LiveSite[] }[] = []

  for (const change of input.files) {
    const listing = listSkips(change.head, change.path)
    if (listing.error) {
      stdout.push(`info ${change.path} — unparsable ${listing.error}`)
      continue
    }
    const sites = listing.sites
    const live = sites.filter((s) => s.live)
    orderedFiles.push({ file: change.path, sites: live })
    runnerOf.set(change.path, runnerKindFor(change.head))
    reviveRaw.set(
      change.path,
      sites.filter((s) => s.marker?.reviveAuto),
    )

    const baseSource = change.base ?? change.renamedFrom ?? null
    const baseListing = baseSource === null ? null : listSkips(baseSource, change.path)
    const baseSites =
      baseListing && !baseListing.error ? baseListing.sites.filter((s) => s.live) : []
    const baseKeys = new Map<string, number>()
    for (const s of baseSites) baseKeys.set(siteKey(s), (baseKeys.get(siteKey(s)) ?? 0) + 1)
    const baseFingerprints = new Set(baseSites.map(siteFingerprint))

    // 存量配額：baseline 該檔的 skip 數。沒標記（或標記不合法）的 skip 先用配額；
    // base 裡本來就有的那幾個排在前面，讓「新加的」那個分到被擋，而不是檔內第一個。
    let allowance = quota.get(change.path) ?? 0
    const unmarked = live.filter((s) => !isMarked(s))
    const remaining = new Map(baseKeys)
    const legacyFirst = unmarked.toSorted((a, b) => {
      const ka = remaining.get(siteKey(a)) ?? 0
      const kb = remaining.get(siteKey(b)) ?? 0
      return Number(kb > 0) - Number(ka > 0) || a.line - b.line
    })
    const covered = new Set<LiveSite>()
    for (const s of legacyFirst) {
      if (allowance <= 0) break
      covered.add(s)
      allowance--
    }

    for (const s of live) {
      const where = `${change.path} > ${siteLabel(s)}`
      if (isMarked(s)) {
        if (isExpired(s, ctx.today)) {
          blocked = true
          outLines.set(s, `block ${where} — expired until=${s.marker!.until}`)
          stderr.push(
            `  ${change.path}:${s.line}：skip 已過期（until=${s.marker!.until}，今天 ${ctx.today}）。` +
              '修好被跳過的測試把 skip 拿掉，或在確有理由時改 until 並更新 reason。',
          )
          continue
        }
        outLines.set(s, `pass ${where} — marked`)
        if (s.marker!.reviveAuto && !baseFingerprints.has(siteFingerprint(s))) {
          reviveWanted.push({ file: change.path, site: s })
        }
        continue
      }
      if (covered.has(s)) {
        outLines.set(s, `pass ${where} — baseline`)
        continue
      }
      blocked = true
      outLines.set(
        s,
        `block ${where} — missing-marker ${markerProblem(s)}；新增的 skip 必須在所在行或正上方一行寫 // ${MARKER_FORMAT}`,
      )
    }
  }

  // revive=auto：CI 端復活，pre-commit 只印「CI 會驗」。
  const reviveVerdict = new Map<LiveSite, { ok: boolean; line: string }>()
  if (reviveWanted.length > 0) {
    if (ctx.mode === 'staged' || !ctx.reviver) {
      for (const { file, site } of reviveWanted) {
        stdout.push(
          `info ${file} > ${siteLabel(site)} — revive=auto，CI 會驗（pre-commit 不跑復活）`,
        )
      }
    } else {
      const byRunner = new Map<'node-test' | 'vitest', string[]>()
      for (const f of new Set(reviveWanted.map((p) => p.file))) {
        const kind = runnerOf.get(f)!
        byRunner.set(kind, [...(byRunner.get(kind) ?? []), f])
      }
      const outcomes = new Map<string, { name: string; status: ReviveStatus; detail?: string }[]>()
      const failures = new Map<string, string>()
      for (const [kind, files] of byRunner) {
        const res = ctx.reviver(files, kind)
        if (!res.ok) {
          for (const f of files) failures.set(f, res.reason ?? '')
          continue
        }
        for (const e of res.entries ?? []) {
          outcomes.set(e.file, [...(outcomes.get(e.file) ?? []), e])
        }
      }
      for (const { file, site } of reviveWanted) {
        const where = `${file} > ${siteLabel(site)}`
        const failure = failures.get(file)
        if (failure !== undefined) {
          reviveVerdict.set(site, {
            ok: false,
            line: `block ${where} — revive-failed 復活跑不起來：${failure}`,
          })
          continue
        }
        const raw = reviveRaw.get(file) ?? []
        const entries = outcomes.get(file) ?? []
        const idx = raw.indexOf(site)
        // 探針依行序對每個 revive=auto skip 各出一筆；數量對得上就按序對，對不上退回用名稱對。
        const entry =
          entries.length === raw.length
            ? entries[idx]
            : entries.find((e) => e.name === siteLabel(site))
        if (!entry) {
          reviveVerdict.set(site, {
            ok: false,
            line: `block ${where} — revive-failed 探針沒有回報這個 skip 的復活結果`,
          })
        } else if (entry.status === 'pass') {
          reviveVerdict.set(site, { ok: true, line: `pass ${where} — revived` })
        } else {
          reviveVerdict.set(site, {
            ok: false,
            line: `block ${where} — revive-failed ${entry.status}${entry.detail ? ` ${entry.detail}` : ''}`,
          })
        }
      }
    }
  }

  for (const { sites } of orderedFiles) {
    for (const s of sites) {
      const revived = reviveVerdict.get(s)
      if (revived) {
        if (!revived.ok) blocked = true
        stdout.push(revived.line)
        continue
      }
      const line = outLines.get(s)
      if (line) stdout.push(line)
    }
  }

  const shrinkable = shrinkableRows(input.head, (path) => input.rowSources?.get(path))
  for (const row of shrinkable) {
    stdout.push(
      row.to === 0
        ? `baseline 可縮一列 ${row.path}`
        : `baseline 可縮 ${row.path}（count ${row.from} → ${row.to}）`,
    )
  }
  if (shrinkable.length > 0) {
    stdout.push(
      `hint 縮減：node ${ctx.selfPath} ${SHRINK_FLAG}（只縮不增，之後把 baseline 檔一起 commit）`,
    )
  }

  if (blocked) {
    stderr.push(
      '',
      '  skip 要誠實：新增的 skip 寫清楚理由與到期日，到期的 skip 在改到那個檔時就要處理，宣稱自動恢復的要能復活。',
      `    標記：// ${MARKER_FORMAT}`,
      '    revive=auto：宣稱條件解除後這個測試就會自己綠；CI 會把條件換掉實跑一次驗證。',
    )
  }
  return { exitCode: blocked ? 1 : 0, stdout, stderr: stderr }
}

// ───────────────────────── 稽核（--report） ─────────────────────────

export type ReportStatus = 'red' | 'warn' | 'ok'

export interface ReportRow {
  status: ReportStatus
  file: string
  name: string
  code: string
  detail?: string
}

export interface ReportInput {
  /** repo 內的測試檔（路徑與內容）。 */
  files: readonly { path: string; source: string }[]
  baseline: TestTrustBaseline | null
}

export interface ReportResult {
  rows: ReportRow[]
  counts: Record<ReportStatus, number>
  /** 讀不懂的檔（不計入 rows）。 */
  unparsable: { path: string; error: string }[]
}

/**
 * 稽核全 repo 的 skip：red＝標記合法但 `until` 已過；ok＝標記合法；warn＝沒有（合法）標記
 * （baseline 配額內是 `baseline`，超過配額是 `missing-marker`）。唯讀、不看 diff。
 */
export function buildReport(input: ReportInput, today: string): ReportResult {
  const quota = new Map((input.baseline?.skips ?? []).map((r) => [r.path, r.count]))
  const rows: ReportRow[] = []
  const unparsable: { path: string; error: string }[] = []
  for (const f of input.files.toSorted((a, b) => a.path.localeCompare(b.path))) {
    const listing = listSkips(f.source, f.path)
    if (listing.error) {
      unparsable.push({ path: f.path, error: listing.error })
      continue
    }
    let allowance = quota.get(f.path) ?? 0
    for (const s of listing.sites.filter((x) => x.live)) {
      const name = siteLabel(s)
      if (isMarked(s)) {
        if (isExpired(s, today)) {
          rows.push({
            status: 'red',
            file: f.path,
            name,
            code: 'expired',
            detail: `until=${s.marker!.until}`,
          })
        } else rows.push({ status: 'ok', file: f.path, name, code: 'marked' })
      } else if (allowance > 0) {
        allowance--
        rows.push({ status: 'warn', file: f.path, name, code: 'baseline' })
      } else {
        rows.push({
          status: 'warn',
          file: f.path,
          name,
          code: 'missing-marker',
          detail: markerProblem(s),
        })
      }
    }
  }
  const counts = { red: 0, warn: 0, ok: 0 }
  for (const r of rows) counts[r.status] += 1
  return { rows, counts, unparsable }
}

export function formatReport(report: ReportResult): string[] {
  const lines = report.rows.map(
    (r) => `${r.status} ${r.file} > ${r.name} — ${r.code}${r.detail ? ` ${r.detail}` : ''}`,
  )
  for (const u of report.unparsable) lines.push(`info ${u.path} — unparsable ${u.error}`)
  lines.push(
    `info report red=${report.counts.red} warn=${report.counts.warn} ok=${report.counts.ok}`,
  )
  return lines
}

// ───────────────────────── 建 baseline（--init-baseline） ─────────────────────────

export interface InitBaselineResult {
  code: 0 | 2
  message: string
}

/**
 * 每個檔「沒有（合法）標記」的 live skip 數（0 的不列）——與 `--shrink-baseline` 同一個定義，也是閘門 quota 實際消耗的數量，
 * 所以 init 後立刻 shrink 是 no-op；已合法標記的 skip 不進配額（否則檔內可多塞同數量的新無標記 skip）。
 */
export function skipRows(files: readonly { path: string; source: string }[]): {
  rows: SkipBaselineRow[]
  unparsable: string[]
} {
  const rows: SkipBaselineRow[] = []
  const unparsable: string[] = []
  for (const f of files) {
    const listing = listSkips(f.source, f.path)
    if (listing.error) {
      unparsable.push(f.path)
      continue
    }
    const count = listing.sites.filter((s) => s.live && !isMarked(s)).length
    if (count > 0) rows.push({ path: f.path, count })
  }
  return { rows, unparsable }
}

/**
 * 凍結當下的 skip（唯讀判定、只寫 `.clade/test-trust-baseline.json`），與 `audit-orphan-tests.ts --init-baseline` 對稱：
 * - baseline 已有 skip 列 → 2（再建一次等於重寫存量；baseline 只能縮小，不重建）。
 * - baseline 已存在但 skip 段為空（孤兒端先建）→ 保留 orphans 段與 created_by、只換上 skips 段。
 * - 既有 baseline 讀不懂 → 2，不覆寫。
 */
export async function initBaseline(
  root: string,
  files: readonly { path: string; source: string }[],
  now?: Date,
): Promise<InitBaselineResult> {
  let existing: TestTrustBaseline | null
  try {
    existing = await readBaseline(root)
  } catch (error) {
    if (error instanceof BaselineFormatError) {
      return { code: 2, message: `既有 baseline 讀不懂，不覆寫：${error.message}` }
    }
    throw error
  }
  if (existing && existing.skips.length > 0) {
    return {
      code: 2,
      message: `${baselinePath(root)} 已有 ${existing.skips.length} 列 skip：baseline 只能縮小，不重建`,
    }
  }
  const { rows, unparsable } = skipRows(files)
  const doc = createBaseline({
    createdBy: existing ? existing.created_by : INIT_BASELINE_CREATED_BY,
    orphans: existing?.orphans ?? [],
    skips: rows,
    now,
  })
  const target = await writeBaseline(root, doc)
  const total = rows.reduce((n, r) => n + r.count, 0)
  const note = unparsable.length > 0 ? `；${unparsable.length} 個檔讀不懂未計入` : ''
  return {
    code: 0,
    message: `baseline 已寫入 ${target}（skips ${doc.skips.length} 列、共 ${total} 個 skip；orphans ${doc.orphans.length} 列${note}）`,
  }
}

// ───────────────────────── 縮 baseline（--shrink-baseline） ─────────────────────────

/** 一個檔「沒有（合法）標記」的 live skip 數——baseline 配額真正要涵蓋的數量；讀不懂回 null。 */
export function unmarkedLiveCount(source: string, path: string): number | null {
  const listing = listSkips(source, path)
  if (listing.error) return null
  return listing.sites.filter((s) => s.live && !isMarked(s)).length
}

export interface ShrinkableRow {
  path: string
  from: number
  /** 縮完的 count；0＝整列刪除。 */
  to: number
}

/**
 * baseline skip 列中，head 實況的無標記 live skip 數比 `count` 少的列。`sourceOf` 回 undefined＝不知道內容（略過），
 * null＝檔已不在（視為 0），讀不懂的檔也略過（不能因讀不懂就刪列）。
 */
export function shrinkableRows(
  baseline: TestTrustBaseline | null,
  sourceOf: (path: string) => string | null | undefined,
): ShrinkableRow[] {
  const out: ShrinkableRow[] = []
  for (const row of baseline?.skips ?? []) {
    const source = sourceOf(row.path)
    if (source === undefined) continue
    const live = source === null ? 0 : unmarkedLiveCount(source, row.path)
    if (live === null) continue
    if (live < row.count) out.push({ path: row.path, from: row.count, to: live })
  }
  return out
}

export interface ShrinkBaselineResult {
  code: 0 | 2 | 3
  /** stdout 行。 */
  lines: string[]
  /** stderr 行（錯誤說明）。 */
  errors: string[]
}

/**
 * `--shrink-baseline`（與孤兒閘門對稱，依 head 實況）：把 baseline skips 各檔 `count` 縮到當下的無標記 live skip 數，
 * 只縮不增，縮到 0 的列刪除；orphans 段不動。無可縮 → 不改檔 exit 0；沒有 baseline → exit 3。
 * `files` 是工作樹現況的測試檔（可只含含 `skip` 字樣者；不在清單內的檔視為 0）。
 */
export async function shrinkSkipBaseline(
  root: string,
  files: readonly { path: string; source: string }[],
): Promise<ShrinkBaselineResult> {
  const doc = await readBaseline(root)
  if (doc === null) {
    return {
      code: 3,
      lines: [
        `block baseline — 無 baseline（${BASELINE_REL_PATH}），沒有可縮的東西`,
        `hint 建立：node skip-gate.ts --init-baseline`,
      ],
      errors: [],
    }
  }
  const sources = new Map(files.map((f) => [f.path, f.source]))
  const rows = shrinkableRows(doc, (path) => sources.get(path) ?? null)
  if (rows.length === 0) return { code: 0, lines: ['info baseline 沒有可縮的列'], errors: [] }
  const current = doc.skips.map((row) => {
    const hit = rows.find((r) => r.path === row.path)
    return { path: row.path, count: hit ? hit.to : row.count }
  })
  const shrunk = shrinkBaseline(doc, { orphans: doc.orphans, skips: current })
  const lines = rows.map((r) =>
    r.to === 0
      ? `baseline 已縮一列 ${r.path}`
      : `baseline 已縮 ${r.path}（count ${r.from} → ${r.to}）`,
  )
  await writeBaseline(root, shrunk)
  lines.push(
    `info 已寫入 ${BASELINE_REL_PATH}（skips ${doc.skips.length} 列 → ${shrunk.skips.length} 列）`,
  )
  return { code: 0, lines, errors: [] }
}

// ───────────────────────── git ─────────────────────────

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

interface DiffEntry {
  status: string
  path: string
  oldPath?: string
}

/** `git diff --name-status -z` → 新增／修改／rename／copy 的條目（刪除不看）。 */
export function parseNameStatus(raw: string | null): DiffEntry[] {
  const parts = (raw ?? '').split('\0').filter(Boolean)
  const entries: DiffEntry[] = []
  for (let i = 0; i < parts.length;) {
    const status = parts[i++]!
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = parts[i++]!
      entries.push({ status, oldPath, path: parts[i++]! })
    } else {
      entries.push({ status, path: parts[i++]! })
    }
  }
  return entries.filter((e) => !e.status.startsWith('D'))
}

const inNodeModules = (p: string) => p.split('/').includes('node_modules')

interface Collected {
  base: TestTrustBaseline | null
  head: TestTrustBaseline | null
  files: FileChange[]
  rowSources: Map<string, string | null>
}

function readBaselineAt(root: string, spec: string): TestTrustBaseline | null {
  const text = git(root, ['show', spec])
  return text === null ? null : parseBaseline(text)
}

function collect(root: string, mode: Mode): Collected | { error: string } {
  let entries: DiffEntry[]
  let showBase: (p: string) => string | null
  let showHead: (p: string) => string | null
  let baseline: { base: TestTrustBaseline | null; head: TestTrustBaseline | null }
  if ('staged' in mode) {
    const hasHead = git(root, ['rev-parse', '-q', '--verify', 'HEAD']) !== null
    const raw = git(root, ['diff', '--cached', '--name-status', '-M', '-z', '--diff-filter=ACMRT'])
    if (raw === null) return { error: 'git diff --cached 失敗' }
    entries = parseNameStatus(raw)
    showBase = (p) => (hasHead ? git(root, ['show', `HEAD:${p}`]) : null)
    showHead = (p) => git(root, ['show', `:${p}`])
    baseline = {
      base: hasHead ? readBaselineAt(root, `HEAD:${BASELINE_REL_PATH}`) : null,
      head: readBaselineAt(root, `:${BASELINE_REL_PATH}`),
    }
  } else {
    const base = git(root, ['merge-base', 'HEAD', mode.against])?.trim() ?? ''
    if (!base) return { error: `cannot resolve merge-base(HEAD, ${mode.against})` }
    const raw = git(root, [
      'diff',
      '--name-status',
      '-M',
      '-z',
      '--diff-filter=ACMRT',
      base,
      'HEAD',
    ])
    if (raw === null) return { error: `git diff ${base} HEAD 失敗` }
    entries = parseNameStatus(raw)
    showBase = (p) => git(root, ['show', `${base}:${p}`])
    showHead = (p) => git(root, ['show', `HEAD:${p}`])
    baseline = {
      base: readBaselineAt(root, `${base}:${BASELINE_REL_PATH}`),
      head: readBaselineAt(root, `HEAD:${BASELINE_REL_PATH}`),
    }
  }
  const files: FileChange[] = []
  for (const e of entries) {
    if (!isTestPath(e.path) || inNodeModules(e.path)) continue
    const head = showHead(e.path)
    if (head === null) continue
    const renamed = e.status.startsWith('R') || e.status.startsWith('C')
    files.push({
      path: e.path,
      head,
      base: renamed ? null : showBase(e.path),
      renamedFrom: renamed && e.oldPath ? showBase(e.oldPath) : undefined,
    })
  }
  const rowSources = new Map<string, string | null>()
  for (const row of baseline.head?.skips ?? []) rowSources.set(row.path, showHead(row.path))
  return { ...baseline, files, rowSources }
}

/** 全 repo 的測試檔（git 追蹤的、工作樹現況內容），只留可能有 skip 的（含 `skip` 字樣）。 */
function collectAllTestFiles(root: string): { path: string; source: string }[] | null {
  const raw = git(root, ['ls-files', '-z'])
  if (raw === null) return null
  const out: { path: string; source: string }[] = []
  for (const p of raw.split('\0').filter(Boolean)) {
    if (!isTestPath(p) || inNodeModules(p)) continue
    const abs = join(root, p)
    if (!existsSync(abs)) continue
    const source = readFileSync(abs, 'utf8')
    if (/skip/i.test(source)) out.push({ path: p, source })
  }
  return out
}

// ───────────────────────── 復活（CI） ─────────────────────────

/** 探針指令前綴：優先 repo 相對路徑，repo 外用絕對路徑。 */
export function probeCommandFor(root: string, probeScript: string): string {
  const rel = relative(root, probeScript)
  const shown = rel === '' || rel.startsWith('..') || isAbsolute(rel) ? probeScript : rel
  return `node ${shown.split('\\').join('/')}`
}

/** 解析 `mutation-probe.ts revive --json` 的 stdout；形狀不對回 null。 */
export function parseReviveJson(
  stdout: string,
): { file: string; name: string; status: ReviveStatus }[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const revived = (parsed as { revived?: unknown }).revived
  if (!Array.isArray(revived)) return null
  const out: { file: string; name: string; status: ReviveStatus }[] = []
  for (const e of revived) {
    if (!e || typeof e !== 'object') return null
    const r = e as Record<string, unknown>
    if (
      typeof r.file !== 'string' ||
      typeof r.name !== 'string' ||
      (r.status !== 'pass' && r.status !== 'fail' && r.status !== 'timeout')
    ) {
      return null
    }
    out.push({ file: r.file, name: r.name, status: r.status })
  }
  return out
}

export function makeReviver(root: string, probeScript: string): Reviver {
  return (files, runner) => {
    const r = spawnSync(
      process.execPath,
      [probeScript, 'revive', '--runner', runner, '--json', '--test', ...files],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 },
    )
    if (r.error) return { ok: false, reason: `無法執行 mutation-probe revive：${r.error.message}` }
    // exit 0／1＝復活完成（全 pass／有 fail 或 timeout）；其餘（2＝找不到標記或執行器起不來等）不判放行
    if (r.status !== 0 && r.status !== 1) {
      const firstLine =
        (r.stderr ?? '').split('\n').find((l) => l.startsWith('mutation-probe') || l.trim()) ?? ''
      return {
        ok: false,
        reason: `mutation-probe revive exit ${r.status}${firstLine ? `：${firstLine.trim()}` : ''}`,
      }
    }
    const entries = parseReviveJson(r.stdout ?? '')
    if (!entries) {
      return {
        ok: false,
        reason: 'mutation-probe revive 的 --json 輸出讀不懂（預期 { revived: [...], counts })',
      }
    }
    return { ok: true, entries }
  }
}

// ───────────────────────── CLI ─────────────────────────

const USAGE =
  'usage: skip-gate (--staged | --against <ref> | --report | --init-baseline [<repo>] | --shrink-baseline) [--root <dir>]'

export interface CliIo {
  stdout: (s: string) => void
  stderr: (s: string) => void
  cwd: string
}

/** 回傳 exit code，不碰 process.exit：測試 in-process 呼叫，CLI 入口（invokedAsCli）才轉成 exit。 */
export async function main(args: string[], io: CliIo): Promise<number> {
  const valueOf = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    const v = i >= 0 ? args[i + 1] : undefined
    return v && !v.startsWith('--') ? v : undefined
  }
  const initIdx = args.indexOf('--init-baseline')
  const initTarget = initIdx >= 0 ? valueOf('--init-baseline') : undefined
  const rootArg = valueOf('--root') ?? initTarget
  const root = rootArg
    ? resolve(io.cwd, rootArg)
    : (git(io.cwd, ['rev-parse', '--show-toplevel'])?.trim() ?? '')
  const staged = args.includes('--staged')
  const against = valueOf('--against')
  const report = args.includes('--report')
  const init = initIdx >= 0
  const shrink = args.includes(SHRINK_FLAG)
  const chosen = [staged, against !== undefined, report, init, shrink].filter(Boolean).length
  if (!root || chosen !== 1 || (args.includes('--against') && against === undefined)) {
    io.stderr(`${USAGE}\n`)
    return 2
  }

  if (!loadTypescript()) {
    if (report || init || shrink) {
      io.stderr('skip-gate: 找不到 typescript（尚未 install？），無法辨認 skip\n')
      return 2
    }
    io.stderr('skip-gate: 找不到 typescript（非 TS repo，或尚未 install）— soft-skip\n')
    return 0
  }

  const selfPath = process.argv[1] ?? 'skip-gate.ts'
  const today = todayUtc()

  try {
    if (report || init || shrink) {
      const files = collectAllTestFiles(root)
      if (files === null) {
        io.stderr('skip-gate: 不是 git repo，無法列出測試檔\n')
        return 2
      }
      if (shrink) {
        const result = await shrinkSkipBaseline(root, files)
        for (const line of result.lines) io.stdout(`${line}\n`)
        for (const line of result.errors) io.stderr(`${line}\n`)
        return result.code
      }
      if (init) {
        const result = await initBaseline(root, files)
        if (result.code === 0) io.stdout(`${result.message}\n`)
        else io.stderr(`skip-gate: ${result.message}\n`)
        return result.code
      }
      const result = buildReport({ files, baseline: await readBaseline(root) }, today)
      for (const line of formatReport(result)) io.stdout(`${line}\n`)
      if (result.counts.red > 0) {
        io.stderr(
          `skip-gate: ${result.counts.red} 個 skip 已過期（red）：處理被跳過的測試，或在有理由時更新 until\n`,
        )
      }
      return result.counts.red > 0 ? 1 : 0
    }

    const mode: Mode = staged ? { staged: true } : { against: against! }
    const collected = collect(root, mode)
    if ('error' in collected) {
      io.stderr(`skip-gate: ${collected.error}\n`)
      return 2
    }
    const probeScript = join(here, '..', 'mutation-probe.ts')
    const result = evaluate(collected, {
      mode: staged ? 'staged' : 'against',
      today,
      root,
      selfPath: probeCommandFor(root, selfPath).replace(/^node /, ''),
      reviver: staged ? undefined : makeReviver(root, probeScript),
    })
    for (const line of result.stdout) io.stdout(`${line}\n`)
    for (const line of result.stderr) io.stderr(`${line}\n`)
    return result.exitCode
  } catch (error) {
    if (error instanceof BaselineFormatError) {
      io.stderr(`skip-gate: baseline 讀不懂：${error.message}\n`)
      return 2
    }
    throw error
  }
}

function invokedAsCli(): boolean {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

// 不用 process.exit：stdout 接 pipe 時 exit 會截斷尚未寫完的輸出。
if (invokedAsCli()) {
  process.exitCode = await main(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    cwd: process.cwd(),
  })
}
