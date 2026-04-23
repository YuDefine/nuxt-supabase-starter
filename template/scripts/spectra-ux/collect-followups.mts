#!/usr/bin/env -S node --experimental-strip-types
/**
 * spectra-ux v1.5+: Collect follow-up markers from tasks.md + validate against register.
 *
 * Usage:
 *   node scripts/spectra-ux/collect-followups.mts                  # human report
 *   node scripts/spectra-ux/collect-followups.mts --json           # machine-readable
 *   node scripts/spectra-ux/collect-followups.mts --fail-on-drift  # CI gate
 *   node scripts/spectra-ux/collect-followups.mts --session-summary  # condensed surfacing
 *
 * Inputs:
 *   - openspec/changes/** /tasks.md  (active + archived; marker scan)
 *   - docs/tech-debt.md              (register)
 *
 * Exit codes:
 *   0 — no drift, or drift present but --fail-on-drift not set
 *   1 — drift present and --fail-on-drift set
 *   2 — unrecoverable error (missing register, IO failure)
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

interface MarkerOccurrence {
  id: string
  file: string
  line: number
  context: string
}

interface RegisterEntry {
  id: string
  title: string
  status: 'open' | 'in-progress' | 'done' | 'wontfix' | 'unknown'
  priority: 'critical' | 'high' | 'mid' | 'low' | 'unknown'
  discovered: string | null
  hasProblem: boolean
  hasFix: boolean
  hasAcceptance: boolean
  hasReason: boolean
}

const ROOT = process.cwd()
const CHANGES_DIR = join(ROOT, 'openspec', 'changes')
const REGISTER_PATH = join(ROOT, 'docs', 'tech-debt.md')

const args = new Set(process.argv.slice(2))
const jsonMode = args.has('--json')
const failOnDrift = args.has('--fail-on-drift')
const sessionMode = args.has('--session-summary')

const PRIORITY_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  mid: 2,
  low: 1,
  unknown: 0,
}

async function walkTaskFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...(await walkTaskFiles(full)))
      } else if (entry.isFile() && entry.name === 'tasks.md') {
        results.push(full)
      }
    }
  } catch {
    /* directory not present; ignore */
  }
  return results
}

async function scanMarkers(file: string): Promise<MarkerOccurrence[]> {
  const content = await readFile(file, 'utf8')
  const lines = content.split('\n')
  const pattern = /@followup\[(TD-\d+)\]/g
  const occurrences: MarkerOccurrence[] = []

  lines.forEach((line, i) => {
    let m: RegExpExecArray | null
    while ((m = pattern.exec(line)) !== null) {
      occurrences.push({
        id: m[1]!,
        file: file.replace(ROOT + '/', ''),
        line: i + 1,
        context: line.trim().slice(0, 160),
      })
    }
  })

  return occurrences
}

async function parseRegister(path: string): Promise<RegisterEntry[]> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch {
    return []
  }

  const lines = content.split('\n')
  const entries: RegisterEntry[] = []

  let current: RegisterEntry | null = null
  let sectionBuffer = ''
  // Track multi-line HTML comments so `<!-- TD-099 …` buried inside a
  // comment doesn't become a phantom register entry.
  let inHtmlComment = false

  const commit = () => {
    if (!current) return
    current.hasProblem = /^###\s+Problem\b/m.test(sectionBuffer)
    current.hasFix = /^###\s+Fix approach\b/m.test(sectionBuffer)
    current.hasAcceptance = /^###\s+Acceptance\b/m.test(sectionBuffer)
    current.hasReason =
      /^###\s+Reason\b/m.test(sectionBuffer) || /^\*\*Reason\*\*/m.test(sectionBuffer)
    entries.push(current)
    current = null
    sectionBuffer = ''
  }

  for (const line of lines) {
    if (inHtmlComment) {
      if (line.includes('-->')) inHtmlComment = false
      continue
    }
    if (line.includes('<!--') && !line.includes('-->')) {
      inHtmlComment = true
      continue
    }
    if (line.includes('<!--') && line.includes('-->')) {
      continue
    }

    const header = line.match(/^##\s+(TD-\d+)\s+—\s+(.+)$/)
    if (header) {
      commit()
      current = {
        id: header[1]!,
        title: header[2]!.trim(),
        status: 'unknown',
        priority: 'unknown',
        discovered: null,
        hasProblem: false,
        hasFix: false,
        hasAcceptance: false,
        hasReason: false,
      }
      sectionBuffer = ''
      continue
    }

    if (!current) continue
    sectionBuffer += line + '\n'

    const statusMatch = line.match(/^\*\*Status\*\*:\s+(\w+(?:-\w+)*)/)
    if (statusMatch) {
      const s = statusMatch[1]!.toLowerCase()
      if (s === 'open' || s === 'in-progress' || s === 'done' || s === 'wontfix') {
        current.status = s
      }
    }

    const priorityMatch = line.match(/^\*\*Priority\*\*:\s+(\w+)/)
    if (priorityMatch) {
      const p = priorityMatch[1]!.toLowerCase()
      if (p === 'critical' || p === 'high' || p === 'mid' || p === 'low') {
        current.priority = p
      }
    }

    const discoveredMatch = line.match(/^\*\*Discovered\*\*:\s+(.+?)$/)
    if (discoveredMatch) {
      current.discovered = discoveredMatch[1]!.trim()
    }
  }
  commit()
  return entries
}

function describeIncomplete(e: RegisterEntry): string[] {
  const issues: string[] = []
  if (e.status === 'unknown') issues.push('Status missing/invalid')
  if (e.priority === 'unknown') issues.push('Priority missing/invalid')
  if (e.status === 'wontfix') {
    if (!e.hasReason) issues.push('wontfix without Reason')
    if (!e.hasProblem) issues.push('missing Problem')
  } else if (e.status !== 'done') {
    if (!e.hasProblem) issues.push('missing Problem')
    if (!e.hasFix) issues.push('missing Fix approach')
    if (!e.hasAcceptance) issues.push('missing Acceptance')
  }
  return issues
}

async function main() {
  try {
    await stat(CHANGES_DIR)
  } catch {
    console.error('[collect-followups] openspec/changes/ not found; nothing to scan')
    process.exit(0)
  }

  const taskFiles = await walkTaskFiles(CHANGES_DIR)
  const allMarkers: MarkerOccurrence[] = []
  for (const file of taskFiles) {
    allMarkers.push(...(await scanMarkers(file)))
  }

  const register = await parseRegister(REGISTER_PATH)
  const registerIds = new Set(register.map((e) => e.id))
  const markerIds = new Set(allMarkers.map((m) => m.id))

  const unregistered = [...markerIds].filter((id) => !registerIds.has(id)).sort()
  const orphaned = [...registerIds].filter((id) => !markerIds.has(id)).sort()

  const incomplete = register.filter((e) => {
    if (e.status === 'wontfix') {
      return !e.hasReason || !e.hasProblem
    }
    if (e.status === 'done') {
      return false
    }
    return !e.hasProblem || !e.hasFix || !e.hasAcceptance
  })

  const drift = unregistered.length + incomplete.length
  const byStatus: Record<string, number> = {}
  for (const e of register) {
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1
  }

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          summary: {
            totalMarkerOccurrences: allMarkers.length,
            uniqueMarkerIds: markerIds.size,
            registerEntries: register.length,
            unregistered: unregistered.length,
            orphaned: orphaned.length,
            incomplete: incomplete.length,
            byStatus,
          },
          registered: register,
          markers: allMarkers,
          drift: {
            unregistered,
            orphaned,
            incomplete: incomplete.map((e) => ({ id: e.id, issues: describeIncomplete(e) })),
          },
        },
        null,
        2
      )
    )
  } else if (sessionMode) {
    // Condensed form intended for SessionStart hook. Silent if nothing to
    // report; otherwise ~5-15 lines suitable for stderr surfacing. Always
    // exits 0 — this is surfacing, not gating.
    const openCount = byStatus.open ?? 0
    const inProgressCount = byStatus['in-progress'] ?? 0
    const activeCount = openCount + inProgressCount

    if (
      activeCount === 0 &&
      unregistered.length === 0 &&
      incomplete.length === 0 &&
      orphaned.length === 0
    ) {
      process.exit(0)
    }

    console.log(`# Follow-up Status — ${openCount} open, ${inProgressCount} in-progress`)

    const activeEntries = register
      .filter((e) => e.status === 'open' || e.status === 'in-progress')
      .sort((a, b) => (PRIORITY_WEIGHT[b.priority] ?? 0) - (PRIORITY_WEIGHT[a.priority] ?? 0))

    if (activeEntries.length > 0) {
      const top = activeEntries.slice(0, 5)
      console.log(`Top ${top.length} by priority:`)
      for (const e of top) {
        console.log(`  - ${e.id} [${e.priority}] ${e.title}`)
      }
    }

    if (unregistered.length > 0) {
      console.log(`⚠ Unregistered markers: ${unregistered.join(', ')}`)
    }
    if (incomplete.length > 0) {
      const summary = incomplete
        .map((e) => `${e.id} (${describeIncomplete(e).join('; ')})`)
        .join(', ')
      console.log(`⚠ Incomplete entries: ${summary}`)
    }
    if (orphaned.length > 0) {
      console.log(`ℹ Orphaned entries: ${orphaned.length} (run \`pnpm spectra:followups\` for list)`)
    }

    console.log('Detail: pnpm spectra:followups')
  } else {
    console.log('# Follow-up Register Report')
    console.log('')
    console.log('## Summary')
    console.log('')
    console.log(`- Register entries: ${register.length}`)
    console.log(`- Unique marker IDs in tasks.md: ${markerIds.size}`)
    console.log(`- Total marker occurrences: ${allMarkers.length}`)
    const statusSummary = Object.entries(byStatus).map(([s, n]) => `${s}=${n}`).join(', ')
    console.log(`- By status: ${statusSummary || '(empty)'}`)
    console.log('')

    if (register.length > 0) {
      console.log('## Registered')
      console.log('')
      console.log('| ID | Title | Priority | Status | Discovered |')
      console.log('| --- | --- | --- | --- | --- |')
      for (const e of register) {
        console.log(`| ${e.id} | ${e.title} | ${e.priority} | ${e.status} | ${e.discovered ?? '—'} |`)
      }
      console.log('')
    }

    if (unregistered.length > 0) {
      console.log('## ⚠ Unregistered markers (in tasks.md but missing from register)')
      console.log('')
      for (const id of unregistered) {
        console.log(`- **${id}**`)
        const occurrences = allMarkers.filter((m) => m.id === id)
        for (const o of occurrences) {
          console.log(`  - ${o.file}:${o.line} — ${o.context}`)
        }
      }
      console.log('')
    }

    if (incomplete.length > 0) {
      console.log('## ⚠ Incomplete entries (register but missing required sections)')
      console.log('')
      for (const e of incomplete) {
        console.log(`- **${e.id}** — ${describeIncomplete(e).join(', ')}`)
      }
      console.log('')
    }

    if (orphaned.length > 0) {
      console.log('## ℹ Orphaned entries (register but no tasks.md marker)')
      console.log('')
      for (const id of orphaned) {
        console.log(`- ${id}`)
      }
      console.log('')
    }

    if (drift === 0) {
      console.log('✅ No drift detected.')
    }
  }

  if (failOnDrift && drift > 0) {
    process.exit(1)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('[collect-followups] fatal:', err)
  process.exit(2)
})
