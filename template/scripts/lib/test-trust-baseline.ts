// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/test-trust-baseline.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/test-trust-baseline.ts
/**
 * 凍結 baseline：`.clade/test-trust-baseline.json` 的唯一讀寫與比對入口。
 *
 * 孤兒 delta 閘門與 skip 閘門（以及兩支稽核的 `--init-baseline`）都只經這支讀寫，
 * 不各自 parse，否則「身分鍵」與「只縮不增」的判定會在兩處漂開。
 *
 * - 身分鍵：孤兒 `path`＋`reason`；skip 以 `path` 為鍵、比 `count`。
 * - 只縮不增（FR-036）：`compareBaseline` 任何一列新增或 `count` 變大 → `grow`；
 *   只有縮小／刪列 → `shrink`；base 無檔而 head 有 → `create`（唯一入口，由呼叫端列出全部列數供 0-A 檢視）。
 * - head 沒有 baseline → `missing`（呼叫端 exit 3）。**NEVER** 把它當全部存量新增，也 **NEVER** 當放行。
 *
 * 本檔不判定 exit code、不印輸出：只回資料，措辭歸閘門。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { atomicWriteText } from './atomic-file.ts'

export const BASELINE_FORMAT_VERSION = 1
export const BASELINE_REL_PATH = '.clade/test-trust-baseline.json'

export interface OrphanBaselineRow {
  path: string
  reason: string
}

export interface SkipBaselineRow {
  path: string
  count: number
}

export interface TestTrustBaseline {
  format_version: number
  created_at: string
  created_by: string
  orphans: OrphanBaselineRow[]
  skips: SkipBaselineRow[]
}

/** 讀不懂（JSON 壞、欄位型別錯、重複身分鍵、版本不支援）。呼叫端應視為「讀不到 baseline」而非「沒有 baseline」。 */
export class BaselineFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BaselineFormatError'
  }
}

export function baselinePath(repoRoot: string): string {
  return join(repoRoot, BASELINE_REL_PATH)
}

export function orphanKey(row: OrphanBaselineRow): string {
  return `${row.path}\u0000${row.reason}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(owner: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    throw new BaselineFormatError(`${owner}.${field} 必須是非空字串`)
  }
  return value
}

/** 解析並驗證 baseline 文字（含 `git show <ref>:.clade/test-trust-baseline.json` 取回的內容）。 */
export function parseBaseline(text: string): TestTrustBaseline {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new BaselineFormatError(`baseline 不是合法 JSON：${(error as Error).message}`)
  }
  if (!isRecord(raw)) throw new BaselineFormatError('baseline 頂層必須是物件')
  if (raw.format_version !== BASELINE_FORMAT_VERSION) {
    throw new BaselineFormatError(
      `baseline format_version 不支援：${JSON.stringify(raw.format_version)}（支援 ${BASELINE_FORMAT_VERSION}）`,
    )
  }
  const createdAt = requireString('baseline', 'created_at', raw.created_at)
  const createdBy = requireString('baseline', 'created_by', raw.created_by)
  if (!Array.isArray(raw.orphans)) throw new BaselineFormatError('baseline.orphans 必須是陣列')
  if (!Array.isArray(raw.skips)) throw new BaselineFormatError('baseline.skips 必須是陣列')

  const orphans: OrphanBaselineRow[] = []
  const seenOrphans = new Set<string>()
  raw.orphans.forEach((item: unknown, index: number) => {
    if (!isRecord(item)) throw new BaselineFormatError(`orphans[${index}] 必須是物件`)
    const row = {
      path: requireString(`orphans[${index}]`, 'path', item.path),
      reason: requireString(`orphans[${index}]`, 'reason', item.reason),
    }
    const key = orphanKey(row)
    if (seenOrphans.has(key)) {
      throw new BaselineFormatError(`orphans 有重複身分鍵：${row.path} / ${row.reason}`)
    }
    seenOrphans.add(key)
    orphans.push(row)
  })

  const skips: SkipBaselineRow[] = []
  const seenSkips = new Set<string>()
  raw.skips.forEach((item: unknown, index: number) => {
    if (!isRecord(item)) throw new BaselineFormatError(`skips[${index}] 必須是物件`)
    const path = requireString(`skips[${index}]`, 'path', item.path)
    const count = item.count
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
      throw new BaselineFormatError(`skips[${index}].count 必須是 >=1 的整數`)
    }
    if (seenSkips.has(path)) throw new BaselineFormatError(`skips 有重複身分鍵：${path}`)
    seenSkips.add(path)
    skips.push({ path, count })
  })

  return {
    format_version: BASELINE_FORMAT_VERSION,
    created_at: createdAt,
    created_by: createdBy,
    orphans,
    skips,
  }
}

/**
 * 序列化。MUST 是 `JSON.stringify(doc, null, 2)`（孤兒 delta 閘門 feature 斷言 `"orphans": []` 等片段）。
 * 不補結尾換行：片段斷言與往返比對都以這個輸出為準。
 */
export function serializeBaseline(doc: TestTrustBaseline): string {
  return JSON.stringify(doc, null, 2)
}

/** 排序後建立新 baseline（`--init-baseline` 用）；排序讓同一份存量寫出逐位元組相同的檔。 */
export function createBaseline(input: {
  createdBy: string
  orphans?: readonly OrphanBaselineRow[]
  skips?: readonly SkipBaselineRow[]
  now?: Date
}): TestTrustBaseline {
  const orphans = (input.orphans ?? [])
    .map(({ path, reason }) => ({ path, reason }))
    .toSorted((a, b) => a.path.localeCompare(b.path) || a.reason.localeCompare(b.reason))
  const skips = (input.skips ?? [])
    .map(({ path, count }) => ({ path, count }))
    .toSorted((a, b) => a.path.localeCompare(b.path))
  const doc: TestTrustBaseline = {
    format_version: BASELINE_FORMAT_VERSION,
    created_at: (input.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    created_by: input.createdBy,
    orphans,
    skips,
  }
  // 經一次 parse：重複身分鍵、count<1 在建立時就失敗，而不是寫出去之後才被閘門讀壞。
  return parseBaseline(serializeBaseline(doc))
}

/** 讀 `<repoRoot>/.clade/test-trust-baseline.json`；檔案不存在 → `null`，其餘讀不懂 → 拋 `BaselineFormatError`。 */
export async function readBaseline(repoRoot: string): Promise<TestTrustBaseline | null> {
  let text: string
  try {
    text = await readFile(baselinePath(repoRoot), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  return parseBaseline(text)
}

/** 原子寫入（暫存檔＋rename）；寫之前先驗證，壞資料不落盤。 */
export async function writeBaseline(repoRoot: string, doc: TestTrustBaseline): Promise<string> {
  const text = serializeBaseline(parseBaseline(serializeBaseline(doc)))
  const target = baselinePath(repoRoot)
  await atomicWriteText(target, text)
  return target
}

/**
 * `--shrink-baseline`：只保留 head 仍成立的列。孤兒列 head 已不是孤兒 → 刪；skip 列 head 的
 * 數量較少 → 降到 head 數量，歸零 → 刪。**不會**新增列或調高 `count`，所以結果對原檔恆為 `shrink`／`unchanged`。
 */
export function shrinkBaseline(
  doc: TestTrustBaseline,
  current: { orphans: readonly OrphanBaselineRow[]; skips: readonly SkipBaselineRow[] },
): TestTrustBaseline {
  const stillOrphan = new Set(current.orphans.map(orphanKey))
  const currentSkips = new Map(current.skips.map((row) => [row.path, row.count]))
  return {
    ...doc,
    orphans: doc.orphans.filter((row) => stillOrphan.has(orphanKey(row))),
    skips: doc.skips.flatMap((row) => {
      const count = Math.min(row.count, currentSkips.get(row.path) ?? 0)
      return count > 0 ? [{ path: row.path, count }] : []
    }),
  }
}

export type BaselineVerdict = 'missing' | 'create' | 'grow' | 'shrink' | 'unchanged'

export interface SkipGrowth {
  path: string
  /** base 沒有該列時為 0。 */
  from: number
  to: number
}

export interface BaselineComparison {
  verdict: BaselineVerdict
  /** head 新增的孤兒列（`grow` 時非空；`create` 時為空，列數見 `rowCount`）。 */
  addedOrphans: OrphanBaselineRow[]
  /** head 新增或 `count` 變大的 skip 列。 */
  grownSkips: SkipGrowth[]
  /** base 有、head 已沒有的孤兒列。 */
  removedOrphans: OrphanBaselineRow[]
  /** base 有、head 已刪或 `count` 變小的 skip 列（`to` 為 head 數量）。 */
  shrunkSkips: SkipGrowth[]
  /** head 的列數（供 `create` 時列出全部列數給 0-A 檢視）。 */
  rowCount: { orphans: number; skips: number }
}

/**
 * 比對 base 與 head 的 baseline。
 *
 * - head 為 `null` → `missing`（不論 base 有沒有；刪掉 baseline 不是縮小，是閘門失效）。
 * - base 為 `null`、head 有 → `create`。
 * - 任何一列新增或 `count` 變大 → `grow`，即使同時也有刪列（不能用刪一列換加一列）。
 * - 其餘有刪列或 `count` 變小 → `shrink`；完全相同 → `unchanged`。
 */
export function compareBaseline(
  base: TestTrustBaseline | null,
  head: TestTrustBaseline | null,
): BaselineComparison {
  const empty = {
    addedOrphans: [],
    grownSkips: [],
    removedOrphans: [],
    shrunkSkips: [],
  } satisfies Partial<BaselineComparison>
  if (head === null) {
    return { verdict: 'missing', ...empty, rowCount: { orphans: 0, skips: 0 } }
  }
  const rowCount = { orphans: head.orphans.length, skips: head.skips.length }
  if (base === null) return { verdict: 'create', ...empty, rowCount }

  const baseOrphans = new Set(base.orphans.map(orphanKey))
  const headOrphans = new Set(head.orphans.map(orphanKey))
  const baseSkips = new Map(base.skips.map((row) => [row.path, row.count]))
  const headSkips = new Map(head.skips.map((row) => [row.path, row.count]))

  const addedOrphans = head.orphans.filter((row) => !baseOrphans.has(orphanKey(row)))
  const removedOrphans = base.orphans.filter((row) => !headOrphans.has(orphanKey(row)))
  const grownSkips: SkipGrowth[] = []
  const shrunkSkips: SkipGrowth[] = []
  for (const [path, to] of headSkips) {
    const from = baseSkips.get(path) ?? 0
    if (to > from) grownSkips.push({ path, from, to })
  }
  for (const [path, from] of baseSkips) {
    const to = headSkips.get(path) ?? 0
    if (to < from) shrunkSkips.push({ path, from, to })
  }

  const verdict: BaselineVerdict =
    addedOrphans.length > 0 || grownSkips.length > 0
      ? 'grow'
      : removedOrphans.length > 0 || shrunkSkips.length > 0
        ? 'shrink'
        : 'unchanged'
  return { verdict, addedOrphans, grownSkips, removedOrphans, shrunkSkips, rowCount }
}
