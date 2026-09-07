// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/lib/td-parse.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/lib/td-parse.ts
// clade flow spine — shared tech-debt register parser (P1a)
//
// This regex set was copy-pasted verbatim across at least four `.clade/work-loop/*.mjs` scripts
// (`r107-debtready.mjs`, `tmp-list-ready.mjs`, `tmp-list-scripts-only.mjs`, and the `r*-tdmax`
// family). Copies drift: a predicate fixed in one round stays broken in the next round's copy,
// and nothing detects it because each copy is a fresh file. One definition, one place to fix.
//
// Consumed by the td-* nodes and by anything else that needs to read `docs/tech-debt.md`
// structurally rather than by grep.

import { markdownSections, trimSeparatorTail } from './contract.ts'
import { parseTechDebtStatus, isTerminalStatus } from '../../tech-debt-status.ts'

export const TD_ID = /\bTD-\d+\b/
export const DEBT_OPEN_STATUS = /\b(open|in-progress|pending|landed-pending-verification)\b/i
export const DEBT_PARKED_STATUS = /blocked-attended-only|wontfix-until-signal/i
export const SELF_VERIFY_HEADING = /^#{2,6}\s*自驗/
export const ACCEPTANCE_PREDICATE =
  /\*\*(驗收|Acceptance|Unblock predicate|解凍 predicate)\*\*\s*[:：]/i
export const LOCATION_LINE = /^(?:[-*+]\s+)?\*\*Location\*\*\s*[:：]/
export const STATUS_LINE = /^(?:[-*+]\s+)?\*\*Status\*\*\s*[:：]\s*(.*)$/
/**
 * `**Parent**: TD-NNN` — the ONLY machine-readable statement that one entry belongs under another.
 *
 * Explicit marker only, on the same basis `scanTechDebt` refuses a keyword heuristic. `[[TD-NNN]]`
 * prose links do NOT carry direction: TD-787's Class line names both TD-684 and TD-786 while being
 * their DOWNSTREAM, and no reading of the link tells you which way it points. A field a person
 * typed on purpose is the only source that does.
 */
export const PARENT_LINE = /^(?:[-*+]\s+)?\*\*Parent\*\*\s*[:：]\s*(TD-\d+)\b/
/** A Location pointing into a clade-managed tree means the fix is not done until it propagates. */
export const PUBLISH_REQUIRED_PATH =
  /(?:^|[\s`(（、＋+])(?:rules|plugins|vendor|claude-md|\.claude)\//

export interface TdEntry {
  id: string
  /** Heading text after the `## `, verbatim. */
  title: string
  status: string
  location: string
  /** `**Parent**: TD-NNN`, when the entry states one. NEVER inferred from prose links. */
  parent: string | null
  /** A 自驗 heading or an acceptance predicate — either counts as an evidence carrier. */
  hasEvidence: boolean
  needsPublish: boolean
  isOpen: boolean
  isParked: boolean
  isClosed: boolean
  /** Line range of the whole entry within the source file, separator tail excluded. */
  start: number
  end: number
  /** The entry body, verbatim, separator tail excluded — this is what a byte-exact move carries. */
  text: string
}

/** Keep line coordinates while hiding examples and comments from metadata parsing. */
export function metadataLines(source: string): string[] {
  let fence: string | null = null
  return source
    .replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => comment.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
      if (fence) {
        if (
          marker &&
          marker[0] === fence[0] &&
          marker.length >= fence.length &&
          line.trim() === marker
        )
          fence = null
        return ''
      }
      if (marker) {
        fence = marker
        return ''
      }
      return line
    })
}

/**
 * Parse the register into entries. Section boundaries come from `markdownSections`, but it is fed
 * the copy `metadataLines` already blanked — that blanking is what skips fenced blocks and HTML
 * comments (the register embeds markdown examples whose `## ` lines are not entries).
 * `markdownSections` carries a fence branch of its own; on this path it never fires, so changing
 * it has no effect here.
 */
export function parseTdRegister(source: string): TdEntry[] {
  const lines = source.split('\n')
  const visible = metadataLines(source)
  const entries: TdEntry[] = []

  for (const section of markdownSections(visible)) {
    const heading = /^##\s+(.*)$/.exec(section.heading)
    if (!heading || !/^(?:\*\*)?TD-\d+\b/.test(heading[1])) continue

    const end = trimSeparatorTail(lines, section.start, section.end)
    const body = lines.slice(section.start, end)

    let status = ''
    let location = ''
    let parent: string | null = null
    let hasEvidence = false
    let needsPublish = false

    for (const line of visible.slice(section.start + 1, end)) {
      const st = STATUS_LINE.exec(line)
      if (st) status = st[1]
      const pa = PARENT_LINE.exec(line)
      if (pa) parent = pa[1]
      if (SELF_VERIFY_HEADING.test(line) || ACCEPTANCE_PREDICATE.test(line)) hasEvidence = true
      if (LOCATION_LINE.test(line)) {
        location = line
        if (PUBLISH_REQUIRED_PATH.test(line)) needsPublish = true
      }
    }

    const token = parseTechDebtStatus(visible.slice(section.start, end).join('\n'))
    const isParked = token !== null && /blocked-attended-only|(?:-until(?:-|$))/i.test(token)

    entries.push({
      id: TD_ID.exec(heading[1])![0],
      title: heading[1],
      status: status.trim(),
      location: location.trim(),
      parent,
      hasEvidence,
      needsPublish,
      isOpen: token !== null && DEBT_OPEN_STATUS.test(token) && !isParked,
      isParked,
      isClosed: isTerminalStatus(token),
      start: section.start,
      end,
      text: body.join('\n'),
    })
  }

  return entries
}

/** Highest TD number present, or 0. The `r*-tdmax` family existed only to answer this. */
export function maxTdNumber(entries: TdEntry[]): number {
  return entries.reduce((max, e) => Math.max(max, Number(e.id.slice(3))), 0)
}

export type TdFilter = 'all' | 'open' | 'parked' | 'ready' | 'blocked-by-publish' | 'no-evidence'

/**
 * `ready` is the predicate the loop actually asks for each round: open, not parked, carries
 * evidence, and does not need a publish to land. `blocked-by-publish` is the same minus that last
 * clause — the two are reported separately because the second is not the agent's to unblock.
 */
export function filterTdEntries(entries: TdEntry[], filter: TdFilter): TdEntry[] {
  switch (filter) {
    case 'all':
      return entries
    case 'open':
      return entries.filter((e) => e.isOpen)
    case 'parked':
      return entries.filter((e) => e.isParked)
    case 'ready':
      return entries.filter((e) => e.isOpen && e.hasEvidence && !e.needsPublish)
    case 'blocked-by-publish':
      return entries.filter((e) => e.isOpen && e.hasEvidence && e.needsPublish)
    case 'no-evidence':
      return entries.filter((e) => e.isOpen && !e.hasEvidence)
  }
}

/** Ambiguous identifiers cannot authorize state changes. */
export function assertUniqueTdIds(entries: TdEntry[]): void {
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new Error(`duplicate live TD ID: ${entry.id}`)
    seen.add(entry.id)
  }
}

/** A receipt is a reason plus evidence of completion, not an acceptance plan. */
export function closureReceipt(entry: Pick<TdEntry, 'text'>): {
  reason: string | null
  evidence: string | null
  valid: boolean
} {
  const text = entry.text.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
  const metadata = metadataLines(text).join('\n')
  const status = parseTechDebtStatus(metadata)
  const nonPlaceholder = (value: string | undefined): string | null => {
    const cleaned = value?.trim()
    if (
      cleaned &&
      /^(?:[-*+]\s+)?\*\*(?:Evidence|Verification|證據|驗證|Acceptance)\*\*:/i.test(cleaned)
    )
      return null
    return cleaned && !/^(?:TODO|TBD|pending|待補|待驗|待確認|N\/A)(?:[\s.:：-]|$)/i.test(cleaned)
      ? cleaned
      : null
  }
  const reason =
    nonPlaceholder(
      metadata.match(
        /^(?:[-*+]\s+)?\*\*(?:Reason|Wontfix reason|Resolution)\*\*:[ \t]*(.+)$/im,
      )?.[1],
    ) ??
    nonPlaceholder(
      metadata.match(
        /^#{3,6}\s+(?:Reason|Wontfix reason|Resolution)\b[^\n]*\n+([\s\S]*?)(?=^#{1,6}\s|$(?![\s\S]))/im,
      )?.[1],
    )
  const explicit = nonPlaceholder(
    metadata.match(/^(?:[-*+]\s+)?\*\*(?:Evidence|Verification|證據|驗證)\*\*:[ \t]*(.+)$/im)?.[1],
  )
  // Historical receipts may place their concrete result in Resolution itself.
  const candidate = explicit ?? reason
  const carrier =
    /https?:\/\/\S+|\b[a-f0-9]{7,40}\b|(?:[\w.-]+\/)+[\w.-]+|\b(?:node|pnpm|npm|git|bash|pytest|vitest)\s+\S+/i
  const result =
    /\b(?:passed|verified|PASS)\b|\bexit[ =:]?0\b|通過|驗證|確認|已修|已解|為零|= ?0|[1-9]\d*\s*pass/i
  const negative =
    /\b(?:unverified|untested|failed|should|must|will|would|planned|expected|not (?:run|executed|tested|pass|passed|verified))\b|未(?:執行|測試|驗證|通過)|待(?:執行|測試|驗|補)|預(?:計|期)|尚未|[1-9]\d*\s+(?:fail(?:ed|ing|ure|ures|s)?|errors?)\b|\b(?:exit(?:[ _-]?(?:code|status))?|rc|returncode|return[ _-]?code)[ =:]*[1-9]\d*\b/i
  const evidence =
    candidate &&
    !/\b0\s+(?:tests?|pass(?:ed)?)\b/i.test(candidate) &&
    !/\b(?:no tests|all (?:tests )?skipped)\b/i.test(candidate) &&
    carrier.test(candidate) &&
    result.test(candidate) &&
    !negative.test(candidate.replace(/\b0\s+(?:fail(?:ed|ing|ure|ures|s)?|errors?)\b/gi, ''))
      ? candidate
      : null
  const retired =
    status !== null &&
    // 只留這兩個：`valid` 同時要求 isTerminalStatus，而 duplicate / cancelled / canceled /
    // dropped 連 LEGAL_STATUS_TOKENS 都不在，寫進來的那四個 alternative 結構上不可達。
    /^(?:wontfix|superseded)(?:-|$)/.test(status)
  return {
    reason,
    evidence,
    valid: isTerminalStatus(status) && !!reason && (retired || !!evidence),
  }
}
