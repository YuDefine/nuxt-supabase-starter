// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/plan-delta.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/plan-delta.ts
/**
 * plan.md 的 Truth delta 表、工作種類與迴歸錨點——純文字解析，不 import 任何模組。
 *
 * 為什麼獨立成檔：`plan-lifecycle.ts` import `plan-gates.ts`（open／close 兩處 gate），gate 又要讀
 * delta 表與工作種類。讓 gate 反向 import `parsePlan` 會成環（oxlint `import/no-cycle` 是 error），
 * 所以兩邊共用的解析放在這個誰都不依賴的底層。**NEVER** 在這裡加 import：一加，這一層就不再是底層。
 *
 * 契約：`specs/truth/work-lifecycle.md` § Package（工作種類）、§ Delta（迴歸錨點列）。
 */

export type DeltaAction = 'ADD' | 'MODIFY' | 'DELETE' | 'NOOP'
export type DeltaState = 'proposed' | 'applied' | 'withdrawn'

export interface TruthDelta {
  id: string
  action: DeltaAction
  unit: string
  reason: string
  state: DeltaState
}

export const DELTA_ACTIONS: ReadonlySet<DeltaAction> = new Set(['ADD', 'MODIFY', 'DELETE', 'NOOP'])
export const DELTA_STATES: ReadonlySet<DeltaState> = new Set(['proposed', 'applied', 'withdrawn'])

/** `## <name>` 到下一個 `## ` 之間的內文（不含標題），沒有該節時回空字串。 */
export function markdownSection(body: string, name: string): string {
  const re = new RegExp(`^## ${name}\\s*$`, 'm')
  const m = re.exec(body)
  if (!m || m.index === undefined) return ''
  const start = m.index + m[0].length
  const rest = body.slice(start)
  const next = rest.search(/^## /m)
  return (next < 0 ? rest : rest.slice(0, next)).trim()
}

export function parseDeltaTable(text: string): TruthDelta[] {
  const rows: TruthDelta[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
    if (cells.length < 5) continue
    if (cells[0] === 'id' || cells[0] === '---' || cells[0] === '—' || cells[1] === '---') continue
    if (!DELTA_ACTIONS.has(cells[1] as DeltaAction)) continue
    rows.push({
      id: cells[0],
      action: cells[1] as DeltaAction,
      unit: cells[2],
      reason: cells[3],
      state: DELTA_STATES.has(cells[4] as DeltaState) ? (cells[4] as DeltaState) : 'proposed',
    })
  }
  return rows
}

/** plan.md 全文 → delta 列。gate 端讀 delta 的唯一入口。 */
export function readPlanDeltas(markdown: string): TruthDelta[] {
  return parseDeltaTable(markdownSection(markdown, 'Truth delta'))
}

// ── 工作種類 ────────────────────────────────────────────────────────────────

/**
 * work-route 判定的工作種類。值域的順序就是拒絕訊息列出合法值的順序。
 *
 * 缺欄位（`null`）＝沒判過，一律照最嚴的完整要求集——與「判成 behavior」分得開。
 */
export const WORK_KINDS = [
  'behavior',
  'bug-uncovered',
  'refactor',
  'bug-covered',
  'acceptance-gap',
] as const
export type WorkKind = (typeof WORK_KINDS)[number]

export function isWorkKind(value: string): value is WorkKind {
  return (WORK_KINDS as readonly string[]).includes(value)
}

/** frontmatter 原文 → 工作種類。空值回 null；值域外丟例外並列出合法值。 */
export function parseWorkKind(raw: string | null | undefined): WorkKind | null {
  const value = raw?.trim()
  if (!value) return null
  if (!isWorkKind(value)) {
    throw new Error(`unknown work_kind: ${value} (expected one of ${WORK_KINDS.join(', ')})`)
  }
  return value
}

// ── 迴歸錨點 ────────────────────────────────────────────────────────────────

export const TRUTH_FEATURES_PREFIX = 'specs/truth/features/'

const ANCHOR_KEYWORD_RE =
  /^(Scenario Outline|Scenario Template|Scenario|Example|場景|劇本|案例)\s*:\s*(.+)$/u

export interface RegressionAnchor {
  deltaId: string
  action: 'ADD' | 'NOOP'
  state: DeltaState
  /** repo-relative truth feature 路徑。 */
  feature: string
  title: string
}

/** unit 欄 → `[路徑, 單元]`，兩邊去掉反引號。沒有 `->` 時單元為空字串。 */
export function splitDeltaUnit(unit: string): [string, string] {
  const idx = unit.indexOf('->')
  const strip = (s: string) => s.replace(/`/g, '').trim()
  if (idx < 0) return [strip(unit), '']
  return [strip(unit.slice(0, idx)), strip(unit.slice(idx + 2))]
}

/**
 * 一列 delta 是不是迴歸錨點：ADD 或 NOOP，unit 指向 truth 介面 feature 裡的一條 scenario
 * （`specs/truth/features/<路徑>.feature -> Scenario: <標題>`，也收 `Example:`、`Scenario Outline:`）。
 * 指向 `Rule:`、`Feature:` 或非 `.feature` 檔的列都不是錨點。
 */
export function regressionAnchor(delta: TruthDelta): RegressionAnchor | null {
  if (delta.action !== 'ADD' && delta.action !== 'NOOP') return null
  const [path, unit] = splitDeltaUnit(delta.unit)
  if (!path.startsWith(TRUTH_FEATURES_PREFIX) || !path.endsWith('.feature')) return null
  const m = ANCHOR_KEYWORD_RE.exec(unit)
  if (!m) return null
  return {
    deltaId: delta.id,
    action: delta.action,
    state: delta.state,
    feature: path,
    title: m[2]!.trim(),
  }
}

/** 仍有效（非 withdrawn）的錨點。 */
export function regressionAnchors(deltas: readonly TruthDelta[]): RegressionAnchor[] {
  return deltas
    .filter((d) => d.state !== 'withdrawn')
    .map(regressionAnchor)
    .filter((a): a is RegressionAnchor => a !== null)
}

/**
 * 要求集：`full` 是現行完整 readiness（spec、plan acceptance、驗收指令…），`regression` 只要迴歸錨點。
 *
 * - `bug-covered` → `regression`
 * - `refactor` → 每一列錨點都是 NOOP（行為已被既有 scenario 釘住）時 `regression`；有任何 ADD 錨點
 *   （要新寫 scenario）或沒有錨點時 `full`（Charles 2026-09-28 Q1=A）
 * - 其餘（含 `acceptance-gap`）與未宣告 → `full`
 */
export type RequirementSet = 'full' | 'regression'

export function requirementSet(
  kind: WorkKind | null,
  anchors: readonly RegressionAnchor[],
): RequirementSet {
  if (kind === 'bug-covered') return 'regression'
  if (kind === 'refactor' && anchors.length > 0 && anchors.every((a) => a.action === 'NOOP')) {
    return 'regression'
  }
  return 'full'
}

/** 結案必須至少有一個錨點的工作種類（修 bug、重構）。 */
export const ANCHOR_REQUIRED_KINDS: ReadonlySet<WorkKind> = new Set([
  'bug-covered',
  'bug-uncovered',
  'refactor',
  'acceptance-gap',
])

// ── 範圍盤點表（acceptance-gap）──────────────────────────────────────────────

/**
 * `acceptance-gap` 的範圍盤點表：plan.md `## Scope inventory`，該功能每個行為一列。
 *
 * `| id | 行為 | 落點 | scenario／理由 |`，落點值域：
 * - `existing`：已有 scenario，第四欄寫 `<truth feature> -> Scenario: <標題>`，Truth delta 要有同 unit 的 NOOP 列
 * - `add`：本次新寫，第四欄同上，Truth delta 要有同 unit 的 ADD 列
 * - `bug`：驗收發現的原 bug 的紅→綠錨點，第四欄同上，Truth delta 要有同 unit 的 ADD 或 NOOP 列
 * - `e2e`：覆蓋整條使用流程的端到端 scenario，第四欄同上，Truth delta 要有同 unit 的 ADD 或 NOOP 列
 * - `out`：明列不做，第四欄寫理由
 */
export const SCOPE_PLACEMENTS = ['existing', 'add', 'bug', 'e2e', 'out'] as const
export type ScopePlacement = (typeof SCOPE_PLACEMENTS)[number]

export interface ScopeRow {
  id: string
  behavior: string
  /** 原文；值域外照留，由 gate 報 `scope-inventory-row-unplaced`。 */
  placement: string
  /** 第四欄原文：scenario 參照或不做的理由。 */
  target: string
}

export function parseScopeInventory(markdown: string): ScopeRow[] {
  const rows: ScopeRow[] = []
  for (const line of markdownSection(markdown, 'Scope inventory').split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
    if (cells.length < 4) continue
    if (cells[0] === 'id' || /^:?-{3,}:?$/u.test(cells[0]!) || cells[0] === '—') continue
    rows.push({ id: cells[0]!, behavior: cells[1]!, placement: cells[2]!, target: cells[3]! })
  }
  return rows
}

/** 第四欄 → truth feature 裡的一條 scenario（與錨點同一個判準）；不是 scenario 參照回 null。 */
export function scopeScenario(target: string): { feature: string; title: string } | null {
  const anchor = regressionAnchor({
    id: '',
    action: 'NOOP',
    unit: target,
    reason: '',
    state: 'proposed',
  })
  return anchor ? { feature: anchor.feature, title: anchor.title } : null
}
