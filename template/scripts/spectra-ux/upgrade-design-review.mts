#!/usr/bin/env -S node --experimental-strip-types
/**
 * spectra-ux: upgrade existing Design Review sections from N-step (typically 5)
 * template to the canonical 7-step template (N.1~N.7).
 *
 * Usage:
 *   node scripts/spectra-ux/upgrade-design-review.mts             # report + upgrade in place
 *   node scripts/spectra-ux/upgrade-design-review.mts --dry-run   # report only
 *   node scripts/spectra-ux/upgrade-design-review.mts --json      # machine-readable report
 *
 * Scope:
 *   - openspec/changes/<name>/tasks.md (active changes, NOT archive)
 *   - skips changes without UI scope
 *   - skips changes whose Design Review section already has all 7 steps
 *
 * Behaviour:
 *   - For each task line in the existing section, classify which canonical step
 *     it maps to (by keyword regex). Preserve its [x]/[ ] state and original text.
 *   - For missing steps, insert [ ] with the canonical template text.
 *   - Renumber every line as N.1 ... N.7 with the same N as the section heading.
 *   - Write back atomically (only when content actually changes).
 *
 * Parked changes are NOT touched (their tasks.md lives in spectra.db, not on disk).
 * Run `spectra unpark <name>` first if you want to upgrade a parked change.
 */

import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const ARGS = new Set(process.argv.slice(2))
const DRY_RUN = ARGS.has('--dry-run')
const JSON_OUT = ARGS.has('--json')

interface StepDef {
  key: string
  matcher: RegExp
  defaultText: string
}

const STEPS_7: StepDef[] = [
  {
    key: 'N.1',
    matcher: /PRODUCT\.md|DESIGN\.md|impeccable teach|impeccable document/i,
    defaultText:
      '檢查 PRODUCT.md（必要）+ DESIGN.md（建議）；缺 PRODUCT.md 跑 /impeccable teach、缺 DESIGN.md 跑 /impeccable document',
  },
  {
    key: 'N.2',
    matcher: /\/design improve|design improve|Fidelity Report/i,
    defaultText: '執行 /design improve [affected pages/components]，產出 Design Fidelity Report',
  },
  {
    key: 'N.3',
    matcher: /DRIFT.*loop|loop.*DRIFT|修復.*DRIFT|fix.*DRIFT/i,
    defaultText: '修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0，max 2 輪）',
  },
  {
    key: 'N.4',
    matcher: /canonical order|targeted.*skills|impeccable skills|layout.*typeset|typeset.*colorize/i,
    defaultText:
      '依 /design improve 計劃按 canonical order 執行 targeted impeccable skills（layout / typeset / clarify / harden / colorize 等實際所需項目）',
  },
  {
    key: 'N.5',
    matcher: /\/impeccable audit|impeccable audit|Critical = 0|Critical=0/i,
    defaultText: '執行 /impeccable audit，確認 Critical = 0',
  },
  {
    key: 'N.6',
    matcher: /review-screenshot|screenshot review|視覺 QA/i,
    defaultText: '執行 review-screenshot，補 design-review.md / 視覺 QA 證據',
  },
  {
    key: 'N.7',
    matcher: /Fidelity 確認|Fidelity check|無 DRIFT 項|無 DRIFT|DRIFT = 0/i,
    defaultText: 'Fidelity 確認 — design-review.md 中無 DRIFT 項',
  },
]

const UI_SCOPE_RE = /\.vue\b|pages\/|components\/|layouts\//i
const SECTION_HEADING_RE = /^##\s+(\d+)\.\s+Design Review\s*$/im
const CHECKBOX_RE = /^-\s+\[([ x])\]\s+(\d+\.\d+)\s+(.*)$/

interface ChangeReport {
  change: string
  tasksPath: string
  hasUiScope: boolean
  hasSection: boolean
  existingStepCount: number
  matchedSteps: string[]
  missingSteps: string[]
  upgraded: boolean
  reason?: string
}

async function findActiveTasksFiles(): Promise<string[]> {
  const changesDir = join(ROOT, 'openspec', 'changes')
  let entries: string[]
  try {
    entries = await readdir(changesDir)
  } catch {
    return []
  }
  const out: string[] = []
  for (const name of entries) {
    if (name === 'archive' || name.startsWith('.')) continue
    const p = join(changesDir, name, 'tasks.md')
    try {
      const s = await stat(p)
      if (s.isFile()) out.push(p)
    } catch {
      /* tasks.md missing — skip */
    }
  }
  return out
}

interface SectionRange {
  startLine: number // line index of heading
  endLine: number // line index AFTER the section (exclusive)
  heading: string
  sectionNumber: number
}

function findSection(lines: string[]): SectionRange | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SECTION_HEADING_RE)
    if (m) {
      // find next heading at same or higher level
      let j = i + 1
      while (j < lines.length) {
        if (/^##\s+/.test(lines[j])) break
        j++
      }
      return {
        startLine: i,
        endLine: j,
        heading: lines[i],
        sectionNumber: parseInt(m[1], 10),
      }
    }
  }
  return null
}

interface ParsedCheckbox {
  checked: boolean
  rawNumber: string // e.g. "7.2"
  text: string
}

function parseCheckboxes(sectionLines: string[]): ParsedCheckbox[] {
  const out: ParsedCheckbox[] = []
  for (const line of sectionLines) {
    const m = line.match(CHECKBOX_RE)
    if (m) {
      out.push({ checked: m[1] === 'x', rawNumber: m[2], text: m[3] })
    }
  }
  return out
}

interface UpgradeResult {
  newSectionLines: string[]
  matchedKeys: string[]
  missingKeys: string[]
  changed: boolean
}

function upgradeSection(
  oldSectionLines: string[],
  sectionNumber: number,
): UpgradeResult {
  const checkboxes = parseCheckboxes(oldSectionLines)
  const matchedKeys: string[] = []
  const missingKeys: string[] = []

  // For each canonical step, find the best-matching existing checkbox.
  // A checkbox can only be claimed once.
  const claimed = new Set<number>() // index into checkboxes
  const stepResolved: { key: string; checked: boolean; text: string }[] = []

  for (const step of STEPS_7) {
    let pickIdx = -1
    for (let i = 0; i < checkboxes.length; i++) {
      if (claimed.has(i)) continue
      if (step.matcher.test(checkboxes[i].text)) {
        pickIdx = i
        break
      }
    }
    if (pickIdx >= 0) {
      claimed.add(pickIdx)
      matchedKeys.push(step.key)
      stepResolved.push({
        key: step.key,
        checked: checkboxes[pickIdx].checked,
        text: checkboxes[pickIdx].text,
      })
    } else {
      missingKeys.push(step.key)
      stepResolved.push({ key: step.key, checked: false, text: step.defaultText })
    }
  }

  const heading = `## ${sectionNumber}. Design Review`
  const body: string[] = ['']
  for (const r of stepResolved) {
    const num = `${sectionNumber}.${r.key.split('.')[1]}`
    body.push(`- [${r.checked ? 'x' : ' '}] ${num} ${r.text}`)
  }
  body.push('')

  // Compare with old section to detect actual change
  const newSectionLines = [heading, ...body]
  const oldTrimmed = oldSectionLines.map((l) => l.replace(/\s+$/, '')).join('\n').trim()
  const newTrimmed = newSectionLines.map((l) => l.replace(/\s+$/, '')).join('\n').trim()
  const changed = oldTrimmed !== newTrimmed

  return { newSectionLines, matchedKeys, missingKeys, changed }
}

async function processFile(tasksPath: string): Promise<ChangeReport> {
  const change = relative(join(ROOT, 'openspec', 'changes'), tasksPath).split('/')[0]
  const raw = await readFile(tasksPath, 'utf-8')
  const hasUiScope = UI_SCOPE_RE.test(raw)

  if (!hasUiScope) {
    return {
      change,
      tasksPath: relative(ROOT, tasksPath),
      hasUiScope: false,
      hasSection: false,
      existingStepCount: 0,
      matchedSteps: [],
      missingSteps: [],
      upgraded: false,
      reason: 'no-ui-scope',
    }
  }

  const lines = raw.split('\n')
  const section = findSection(lines)

  if (!section) {
    // Auto-insert: find next section number, insert 7-step Design Review block
    // before "## 人工檢查" / "## Manual Review" if present, otherwise append at end.
    const lastSectionMatch = [...raw.matchAll(/^##\s+(\d+)\.\s/gm)]
    const lastNumber = lastSectionMatch.length > 0
      ? Math.max(...lastSectionMatch.map((m) => parseInt(m[1], 10)))
      : 0
    const nextN = lastNumber + 1

    const newBlock: string[] = ['', `## ${nextN}. Design Review`, '']
    for (const step of STEPS_7) {
      const num = `${nextN}.${step.key.split('.')[1]}`
      newBlock.push(`- [ ] ${num} ${step.defaultText}`)
    }
    newBlock.push('')

    // Find insertion point: before "## 人工檢查" / "## Manual Review", else end of file
    const manualHeadingRe = /^##\s+(?:人工檢查|Manual Review)\s*$/im
    const manualMatch = lines.findIndex((l) => manualHeadingRe.test(l))

    let newContent: string
    if (manualMatch >= 0) {
      const before = lines.slice(0, manualMatch)
      const after = lines.slice(manualMatch)
      // Trim trailing empty lines from `before` to avoid double-blank
      while (before.length > 0 && before[before.length - 1].trim() === '') before.pop()
      newContent = [...before, ...newBlock, ...after].join('\n')
    } else {
      // Append at end
      const trimmed = lines.slice()
      while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') trimmed.pop()
      newContent = [...trimmed, ...newBlock].join('\n') + '\n'
    }

    if (!DRY_RUN) {
      await writeFile(tasksPath, newContent, 'utf-8')
    }

    return {
      change,
      tasksPath: relative(ROOT, tasksPath),
      hasUiScope: true,
      hasSection: false,
      existingStepCount: 0,
      matchedSteps: [],
      missingSteps: STEPS_7.map((s) => s.key),
      upgraded: true,
      reason: DRY_RUN ? 'would-insert-section' : 'inserted-section',
    }
  }

  const sectionLines = lines.slice(section.startLine, section.endLine)
  const existingCount = parseCheckboxes(sectionLines).length
  const result = upgradeSection(sectionLines, section.sectionNumber)

  if (!result.changed) {
    return {
      change,
      tasksPath: relative(ROOT, tasksPath),
      hasUiScope: true,
      hasSection: true,
      existingStepCount: existingCount,
      matchedSteps: result.matchedKeys,
      missingSteps: result.missingKeys,
      upgraded: false,
      reason: 'already-canonical',
    }
  }

  if (!DRY_RUN) {
    // Splice new section into file
    const before = lines.slice(0, section.startLine)
    const after = lines.slice(section.endLine)
    // Drop trailing empty line if our new section already provides one
    const newContent = [...before, ...result.newSectionLines, ...after].join('\n')
    await writeFile(tasksPath, newContent, 'utf-8')
  }

  return {
    change,
    tasksPath: relative(ROOT, tasksPath),
    hasUiScope: true,
    hasSection: true,
    existingStepCount: existingCount,
    matchedSteps: result.matchedKeys,
    missingSteps: result.missingKeys,
    upgraded: true,
    reason: DRY_RUN ? 'would-upgrade' : 'upgraded',
  }
}

async function main() {
  const tasksFiles = await findActiveTasksFiles()
  const reports: ChangeReport[] = []
  for (const f of tasksFiles) {
    try {
      reports.push(await processFile(f))
    } catch (err) {
      reports.push({
        change: relative(join(ROOT, 'openspec', 'changes'), f).split('/')[0],
        tasksPath: relative(ROOT, f),
        hasUiScope: false,
        hasSection: false,
        existingStepCount: 0,
        matchedSteps: [],
        missingSteps: [],
        upgraded: false,
        reason: `error: ${(err as Error).message}`,
      })
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ dryRun: DRY_RUN, reports }, null, 2))
    return
  }

  const upgraded = reports.filter((r) => r.upgraded)
  const skippedNoUi = reports.filter((r) => r.reason === 'no-ui-scope')
  const skippedNoSection = reports.filter((r) => r.reason?.startsWith('no-design-review-section'))
  const alreadyOk = reports.filter((r) => r.reason === 'already-canonical')
  const errored = reports.filter((r) => r.reason?.startsWith('error:'))

  console.log(`spectra-ux: upgrade-design-review ${DRY_RUN ? '(dry-run)' : ''}`)
  console.log(`scanned: ${reports.length} active changes`)
  console.log('')

  if (upgraded.length) {
    console.log(`${DRY_RUN ? 'Would upgrade' : 'Upgraded'}: ${upgraded.length}`)
    for (const r of upgraded) {
      console.log(`  - ${r.change}`)
      console.log(`      file: ${r.tasksPath}`)
      console.log(`      existing checkboxes: ${r.existingStepCount}`)
      console.log(`      matched canonical steps: ${r.matchedSteps.join(', ') || '(none)'}`)
      console.log(`      added missing steps: ${r.missingSteps.join(', ') || '(none)'}`)
    }
    console.log('')
  }

  if (alreadyOk.length) {
    console.log(`Already canonical (no change needed): ${alreadyOk.length}`)
    for (const r of alreadyOk) console.log(`  - ${r.change}`)
    console.log('')
  }

  if (skippedNoSection.length) {
    console.log(`Has UI scope but NO Design Review section: ${skippedNoSection.length}`)
    console.log(`  → run design-inject.sh or /spectra-ingest to add the section first`)
    for (const r of skippedNoSection) console.log(`  - ${r.change}`)
    console.log('')
  }

  if (skippedNoUi.length) {
    console.log(`Skipped (no UI scope): ${skippedNoUi.length}`)
    console.log('')
  }

  if (errored.length) {
    console.log(`Errors: ${errored.length}`)
    for (const r of errored) console.log(`  - ${r.change}: ${r.reason}`)
    console.log('')
    process.exit(1)
  }

  console.log('Note: parked changes are NOT touched (tasks.md not on disk).')
  console.log(`      run \`spectra unpark <name>\` then re-run this script.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
