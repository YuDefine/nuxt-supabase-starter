#!/usr/bin/env -S node --experimental-strip-types
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/spectra-advanced/collect-followups.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/spectra-advanced/collect-followups.ts
/** Follow-up markers resolve against the live register and terminal closed archives.
 * Active work and SessionStart candidates always come from the live register.
 * --fail-on-drift exits 1; --gate <change> preserves the shell gate's exit 2.
 * --session-summary is fail-open and reports unavailable scans explicitly.
 */
import { readFile, readdir } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTechDebtStatus, isTerminalStatus, TD_FIELD_PREFIX } from '../tech-debt-status.ts'
import { parseTdRegister, closureReceipt, metadataLines } from '../flow/nodes/lib/td-parse.ts'

interface MarkerOccurrence {
  id: string
  file: string
  line: number
  context: string
}
interface RegisterEntry {
  id: string
  title: string
  status: string
  priority: string
  discovered: string | null
  hasProblem: boolean
  hasFix: boolean
  hasAcceptance: boolean
  hasReason: boolean
  hasReceipt: boolean
}
const PRIORITY_WEIGHT: Record<string, number> = { critical: 4, high: 3, mid: 2, low: 1 }
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

async function optionalRead(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isMissing(error)) return ''
    throw error
  }
}
async function walkTaskFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const nested = await Promise.all(
      entries.map((entry) => {
        const path = join(dir, entry.name)
        return entry.isDirectory()
          ? walkTaskFiles(path)
          : Promise.resolve(entry.isFile() && entry.name === 'tasks.md' ? [path] : [])
      }),
    )
    return nested.flat()
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}
function field(text: string, name: string): string | null {
  return (
    text.match(new RegExp(`^${TD_FIELD_PREFIX}\\*\\*${name}\\*\\*:\\s*(.+)$`, 'mi'))?.[1]?.trim() ??
    null
  )
}
function section(text: string, names: string): boolean {
  return new RegExp(
    `^(?:#{3,6}\\s+(?:${names})\\b|${TD_FIELD_PREFIX}\\*\\*(?:${names})\\*\\*:)`,
    'mi',
  ).test(text)
}
function parseRegister(content: string): RegisterEntry[] {
  // `metadataLines` 與 `closureReceipt` 各自重跑一次 fence / comment 遮罩，所以每個 entry
  // 只算一次。實測 850 個 entry：5×+2× 呼叫 95 ms → 各一次 28 ms。
  return parseTdRegister(content).map((entry) => {
    const meta = metadataLines(entry.text).join('\n')
    const receipt = closureReceipt(entry)
    return {
      id: entry.id,
      title: entry.title.replace(/^TD-\d+\s*[—-]?\s*/, ''),
      status: parseTechDebtStatus(`**Status**: ${entry.status}`) ?? 'unknown',
      priority:
        field(meta, 'Priority')
          ?.match(/^(critical|high|mid|low)\b/i)?.[1]
          ?.toLowerCase() ?? 'unknown',
      discovered: field(meta, 'Discovered'),
      hasProblem: section(meta, 'Problem'),
      hasFix: section(meta, 'Fix approach|Fix|Next action'),
      hasAcceptance: section(meta, 'Acceptance'),
      hasReason: !!receipt.reason,
      hasReceipt: receipt.valid,
    }
  })
}
function incompleteIssues(entry: RegisterEntry): string[] {
  const issues: string[] = []
  if (
    !/^(?:open|pending|in-progress|blocked|deferred|mitigated|workaround|landed)(?:-|$)/.test(
      entry.status,
    ) &&
    !isTerminalStatus(entry.status) &&
    !/-until(?:-|$)/.test(entry.status)
  )
    issues.push('Status missing/invalid')
  if (isTerminalStatus(entry.status)) {
    if (!entry.hasReason) issues.push('terminal status without Resolution/Reason')
    else if (!entry.hasReceipt) issues.push('terminal status without verified closure receipt')
    return issues
  }
  if (!entry.hasProblem) issues.push('missing Problem')
  if (!entry.hasFix) issues.push('missing Fix approach')
  if (!entry.hasAcceptance) issues.push('missing Acceptance')
  return issues
}

export async function collectFollowups(root: string, change?: string) {
  const changesDir = join(root, 'openspec', 'changes')
  if (
    change &&
    (resolve(changesDir, change) === changesDir ||
      relative(changesDir, resolve(changesDir, change)).startsWith('..'))
  ) {
    throw new Error('--gate change must be inside openspec/changes')
  }
  const taskFiles = change
    ? [join(changesDir, change, 'tasks.md')]
    : await walkTaskFiles(changesDir)
  const markers: MarkerOccurrence[] = []
  for (const path of taskFiles) {
    const source = change ? await optionalRead(path) : await readFile(path, 'utf8')
    source.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/@followup\[(TD-\d+)\]/g)) {
        markers.push({
          id: match[1]!,
          file: relative(root, path),
          line: index + 1,
          context: line.trim().slice(0, 160),
        })
      }
    })
  }
  const registered = parseRegister(await optionalRead(join(root, 'docs', 'tech-debt.md')))
  const archiveDir = join(root, 'docs', 'archives')
  let names: string[] = []
  try {
    names = (await readdir(archiveDir))
      .filter((name) => /^tech-debt-closed-.*\.md$/.test(name))
      .toSorted()
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  const archived: RegisterEntry[] = []
  for (const name of names)
    archived.push(...parseRegister(await readFile(join(archiveDir, name), 'utf8')))
  const markerIds = new Set(markers.map((entry) => entry.id))
  const liveIds = new Set(registered.map((entry) => entry.id))
  const terminalArchiveIds = new Set(
    archived.filter((entry) => isTerminalStatus(entry.status)).map((entry) => entry.id),
  )
  const counts = new Map<string, number>()
  for (const entry of [...registered, ...archived])
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1)
  const relevant = (id: string) => !change || markerIds.has(id)
  const duplicateIds = [...counts]
    .filter(([id, count]) => count > 1 && relevant(id))
    .map(([id]) => id)
    .toSorted()
  const archiveNonTerminal = [
    ...new Set(
      archived
        .filter((entry) => !isTerminalStatus(entry.status) && relevant(entry.id))
        .map((entry) => entry.id),
    ),
  ].toSorted()
  const unregistered = [...markerIds]
    .filter((id) => !liveIds.has(id) && !terminalArchiveIds.has(id))
    .toSorted()
  const orphaned = [...liveIds].filter((id) => !markerIds.has(id)).toSorted()
  const incomplete = [...registered, ...archived]
    .filter((entry) => relevant(entry.id))
    .map((entry) => ({ id: entry.id, issues: incompleteIssues(entry) }))
    .filter((entry) => entry.issues.length > 0)
  const byStatus: Record<string, number> = {}
  for (const entry of registered) byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1
  return {
    summary: {
      totalMarkerOccurrences: markers.length,
      uniqueMarkerIds: markerIds.size,
      registerEntries: registered.length,
      unregistered: unregistered.length,
      orphaned: orphaned.length,
      incomplete: incomplete.length,
      archiveDuplicates: duplicateIds.length,
      archiveNonTerminal: archiveNonTerminal.length,
      byStatus,
    },
    registered,
    markers,
    drift: { unregistered, orphaned, incomplete, duplicateIds, archiveNonTerminal },
  }
}

async function main() {
  const args = process.argv.slice(2)
  const sessionMode = args.includes('--session-summary')
  const gateIndex = args.indexOf('--gate')
  try {
    const change = gateIndex >= 0 ? args[gateIndex + 1] : undefined
    if (gateIndex >= 0 && (!change || change.startsWith('--')))
      throw new Error('--gate requires a change name')
    const result = await collectFollowups(process.cwd(), change)
    const { registered, drift, summary } = result
    const failures =
      drift.unregistered.length +
      drift.incomplete.length +
      drift.duplicateIds.length +
      drift.archiveNonTerminal.length
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2))
    else if (gateIndex >= 0) {
      if (failures)
        console.error(
          `[Follow-up Gate] archive blocked for change: ${change}\n${JSON.stringify(drift, null, 2)}`,
        )
    } else if (sessionMode) {
      const closed = registered.filter((entry) => isTerminalStatus(entry.status))
      const active = registered.filter(
        (entry) =>
          !isTerminalStatus(entry.status) && !/-until(?:-|$)|^blocked|^deferred/.test(entry.status),
      )
      if (active.length || closed.length || failures) {
        console.log(
          `# Follow-up Status — ${summary.byStatus.open ?? 0} open, ${summary.byStatus['in-progress'] ?? 0} in-progress, ${closed.length} closed in live register`,
        )
        const rulePath = (await optionalRead(join(process.cwd(), 'registry', 'consumers.json')))
          ? 'rules/core/follow-up-register.md'
          : '.claude/rules/follow-up-register.md'
        console.log(
          `主件優先；從本 repo 未被認領的相關舊項取一個小批次（至多 3 項），先驗已落地項並關單。動筆前讀 ${rulePath} § 主動消化；未驗完成不刪。`,
        )
        for (const entry of active
          .toSorted(
            (a, b) => (PRIORITY_WEIGHT[b.priority] ?? 0) - (PRIORITY_WEIGHT[a.priority] ?? 0),
          )
          .slice(0, 5))
          console.log(`  - ${entry.id} [${entry.priority}] ${entry.title}`)
        if (failures)
          console.log(`⚠ Follow-up drift: ${failures}; run pnpm spectra:followups --json`)
      }
    } else {
      console.log('# Follow-up Register Report\n')
      console.log(
        `- Register entries: ${registered.length}\n- Unique marker IDs in tasks.md: ${summary.uniqueMarkerIds}\n- Total marker occurrences: ${summary.totalMarkerOccurrences}`,
      )
      console.log(
        `- By status: ${
          Object.entries(summary.byStatus)
            .map(([status, count]) => `${status}=${count}`)
            .join(', ') || '(empty)'
        }`,
      )
      console.log(
        '\n| ID | Title | Priority | Status | Discovered |\n| --- | --- | --- | --- | --- |',
      )
      for (const entry of registered)
        console.log(
          `| ${entry.id} | ${entry.title} | ${entry.priority} | ${entry.status} | ${entry.discovered ?? '—'} |`,
        )
      if (failures) console.log(`\n## Follow-up drift\n${JSON.stringify(drift, null, 2)}`)
    }
    process.exitCode = sessionMode
      ? 0
      : failures
        ? gateIndex >= 0
          ? 2
          : args.includes('--fail-on-drift')
            ? 1
            : 0
        : 0
  } catch (error) {
    console.error(`[collect-followups] scan unavailable: ${(error as Error).message}`)
    process.exitCode = sessionMode ? 0 : 2
  }
}
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
)
  await main()
