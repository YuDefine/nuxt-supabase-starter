#!/usr/bin/env -S node --experimental-strip-types
/**
 * Screenshot Quality Audit.
 *
 * Usage:
 *   tsx scripts/spectra-advanced/audit-screenshot-quality.mts
 *   tsx scripts/spectra-advanced/audit-screenshot-quality.mts <change-name>
 *   tsx scripts/spectra-advanced/audit-screenshot-quality.mts --json
 *   tsx scripts/spectra-advanced/audit-screenshot-quality.mts --fail-on-issues
 *
 * Exit:
 *   0 — clean, or issues found without --fail-on-issues
 *   1 — issues found with --fail-on-issues
 *   2 — script error
 */

import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import {
  deriveDefaultKindFromProposal,
  parseManualReviewSections,
  type ManualReviewItem,
} from '../review-gui.mts'

type Severity = 'warning' | 'critical'

interface CliOptions {
  changeName: string | null
  json: boolean
  failOnIssues: boolean
}

interface Issue {
  severity: Severity
  code: string
  change: string
  itemId: string | null
  file: string | null
  message: string
  suggestion: string
}

interface ScreenshotFile {
  absPath: string
  relPath: string
  baseName: string
  itemId: string | null
}

interface ChangeReport {
  name: string
  manualReviewItems: number
  screenshots: number
  issues: number
}

interface AuditReport {
  summary: {
    changesScanned: number
    itemsScanned: number
    screenshotsScanned: number
    warnings: number
    critical: number
  }
  issues: Issue[]
  changes: ChangeReport[]
}

const ROOT = resolve(process.cwd())
const CHANGES_DIR = join(ROOT, 'openspec', 'changes')
const SCREENSHOTS_DIR = join(ROOT, 'screenshots')
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const SCREENSHOT_SCHEMA_RE =
  /^#(?<id>\d+(?:\.\d+)?)(?<variant>[a-z])?-(?<descriptor>[a-z0-9]+(?:-[a-z0-9]+)*)\.(png|jpg|jpeg|webp)$/i
const STRICT_SCREENSHOT_SCHEMA_RE =
  /^#(?<id>\d+(?:\.\d+)?)(?<variant>[a-z])?-(?<descriptor>[a-z0-9]+(?:-[a-z0-9]+)*)\.(png|jpg|jpeg|webp)$/
const EXPLORATION_KEYWORDS = [
  'attempt',
  'after-click',
  '500-detail',
  'error-detail',
  'debug',
  'exploration',
  'try',
  'probe',
]

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { changeName: null, json: false, failOnIssues: false }
  for (const arg of argv.slice(2)) {
    if (arg === '--json') {
      opts.json = true
    } else if (arg === '--fail-on-issues') {
      opts.failOnIssues = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: audit-screenshot-quality.mts [change-name] [--json] [--fail-on-issues]',
          '',
          '  --json            Emit machine-readable JSON on stdout',
          '  --fail-on-issues  Exit 1 when any warning or critical issue is found',
        ].join('\n')
      )
      process.exit(0)
    } else if (arg.startsWith('-')) {
      console.error(`audit-screenshot-quality: unknown flag ${arg}`)
      process.exit(2)
    } else if (!opts.changeName) {
      opts.changeName = arg
    } else {
      console.error(`audit-screenshot-quality: unexpected argument ${arg}`)
      process.exit(2)
    }
  }
  return opts
}

async function main() {
  const options = parseArgs(process.argv)
  const report = await audit(options.changeName)

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(formatHumanReport(report))
  }

  process.exit(options.failOnIssues && report.issues.length > 0 ? 1 : 0)
}

export async function audit(changeName: string | null = null): Promise<AuditReport> {
  const changeNames = await resolveChangeNames(changeName)
  const issues: Issue[] = []
  const changes: ChangeReport[] = []
  let itemsScanned = 0
  let screenshotsScanned = 0

  for (const name of changeNames) {
    const result = await auditChange(name)
    issues.push(...result.issues)
    changes.push({
      name,
      manualReviewItems: result.items.length,
      screenshots: result.screenshots.length,
      issues: result.issues.length,
    })
    itemsScanned += result.items.length
    screenshotsScanned += result.screenshots.length
  }

  return {
    summary: {
      changesScanned: changeNames.length,
      itemsScanned,
      screenshotsScanned,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
      critical: issues.filter((issue) => issue.severity === 'critical').length,
    },
    issues,
    changes,
  }
}

async function resolveChangeNames(changeName: string | null): Promise<string[]> {
  if (changeName) {
    const changeDir = join(CHANGES_DIR, changeName)
    if (!existsSync(changeDir)) {
      throw new Error(`change not found: ${changeName}`)
    }
    return [changeName]
  }

  if (!existsSync(CHANGES_DIR)) return []
  const entries = await readdir(CHANGES_DIR, { withFileTypes: true })
  return entries
    .filter(
      (entry) => entry.isDirectory() && entry.name !== 'archive' && !entry.name.startsWith('.')
    )
    .map((entry) => entry.name)
    .toSorted()
}

async function auditChange(changeName: string): Promise<{
  items: ManualReviewItem[]
  screenshots: ScreenshotFile[]
  issues: Issue[]
}> {
  const changeDir = join(CHANGES_DIR, changeName)
  const proposalPath = join(changeDir, 'proposal.md')
  const tasksPath = join(changeDir, 'tasks.md')
  const issues: Issue[] = []

  const proposalContent = await readOptional(proposalPath)
  const tasksContent = await readOptional(tasksPath)
  const defaultKind = deriveDefaultKindFromProposal(proposalContent)
  const parsed = tasksContent
    ? parseManualReviewSections(tasksContent, { defaultKind })
    : { items: [] as ManualReviewItem[] }
  const items = parsed.items
  const itemIds = new Set(items.map((item) => item.id))

  const screenshots = await collectScreenshotFiles(changeName, issues)
  const byItem = groupScreenshotsByItem(screenshots, itemIds, changeName, issues)
  applyCountRules(byItem, changeName, issues)
  applyMissingEvidenceRule(items, byItem, changeName, issues)
  await applyReviewReferenceRule(changeName, issues)

  return { items, screenshots, issues }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function collectScreenshotFiles(
  changeName: string,
  issues: Issue[]
): Promise<ScreenshotFile[]> {
  if (!existsSync(SCREENSHOTS_DIR)) return []
  const envs = await readdir(SCREENSHOTS_DIR, { withFileTypes: true })
  const files: ScreenshotFile[] = []

  for (const env of envs) {
    if (!env.isDirectory() || env.name === '_archive') continue
    const topicDir = join(SCREENSHOTS_DIR, env.name, changeName)
    if (!existsSync(topicDir)) continue
    const topicFiles = await walkImages(topicDir)
    for (const absPath of topicFiles) {
      const relPath = toRel(absPath)
      const baseName = basename(absPath)
      const schemaMatch = baseName.match(SCREENSHOT_SCHEMA_RE)
      const strictMatch = baseName.match(STRICT_SCREENSHOT_SCHEMA_RE)

      if (!strictMatch) {
        issues.push({
          severity: 'critical',
          code: 'invalid_filename_schema',
          change: changeName,
          itemId: schemaMatch?.groups?.id ? `#${schemaMatch.groups.id}` : null,
          file: relPath,
          message: `${relPath} does not match #N[variant]-descriptor.ext`,
          suggestion: 'rename the file to #<item-id>[<variant>]-<descriptor>.<png|jpg|jpeg|webp>',
        })
      }

      if (hasExplorationKeyword(relPath)) {
        issues.push({
          severity: 'warning',
          code: 'exploration_keyword',
          change: changeName,
          itemId: schemaMatch?.groups?.id ? `#${schemaMatch.groups.id}` : null,
          file: relPath,
          message: `${relPath} looks like exploration/debug evidence in the review pipeline`,
          suggestion: `move exploration files to screenshots/<env>/${changeName}/_exploration/ or recapture final-state evidence`,
        })
      }

      files.push({
        absPath,
        relPath,
        baseName,
        itemId: strictMatch?.groups?.id ? `#${strictMatch.groups.id}` : null,
      })
    }
  }

  return files
}

async function walkImages(root: string): Promise<string[]> {
  const result: string[] = []
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '_archive' || entry.name === '_exploration') continue
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name === 'review.md') continue
      if (IMAGE_EXTS.has(extname(entry.name).toLowerCase())) result.push(full)
    }
  }
  await walk(root)
  return result
}

function groupScreenshotsByItem(
  screenshots: ScreenshotFile[],
  itemIds: Set<string>,
  changeName: string,
  issues: Issue[]
): Map<string, ScreenshotFile[]> {
  const byItem = new Map<string, ScreenshotFile[]>()
  for (const screenshot of screenshots) {
    if (!screenshot.itemId) continue
    if (!itemIds.has(screenshot.itemId)) {
      issues.push({
        severity: 'warning',
        code: 'orphan_screenshot',
        change: changeName,
        itemId: screenshot.itemId,
        file: screenshot.relPath,
        message: `${screenshot.relPath} references ${screenshot.itemId}, but that item does not exist in tasks.md`,
        suggestion:
          'rename the screenshot to an existing item id or update tasks.md if this evidence belongs to a new item',
      })
      continue
    }
    const list = byItem.get(screenshot.itemId) ?? []
    list.push(screenshot)
    byItem.set(screenshot.itemId, list)
  }
  return byItem
}

function applyCountRules(
  byItem: Map<string, ScreenshotFile[]>,
  changeName: string,
  issues: Issue[]
) {
  for (const [itemId, files] of byItem) {
    if (files.length > 7) {
      issues.push({
        severity: 'critical',
        code: 'too_many_screenshots',
        change: changeName,
        itemId,
        file: null,
        message: `item ${itemId} has ${files.length} screenshots in the review pipeline`,
        suggestion:
          'keep 1-4 final-state screenshots and move exploration files into _exploration/',
      })
    } else if (files.length > 4) {
      issues.push({
        severity: 'warning',
        code: 'too_many_screenshots',
        change: changeName,
        itemId,
        file: null,
        message: `item ${itemId} has ${files.length} screenshots in the review pipeline`,
        suggestion:
          'keep 1-4 final-state screenshots and move exploration files into _exploration/',
      })
    }
  }
}

function applyMissingEvidenceRule(
  items: ManualReviewItem[],
  byItem: Map<string, ScreenshotFile[]>,
  changeName: string,
  issues: Issue[]
) {
  for (const item of items) {
    if (item.checked || item.kind === 'discuss' || item.noScreenshot) continue
    if ((byItem.get(item.id) ?? []).length > 0) continue
    // verify:auto items 設計上保證 agent round-trip 完一定拍 final-state screenshot；
    // 沒截圖 = agent 沒跑或失敗 = 比 review:ui 缺截圖更嚴重，升 critical
    const severity: Severity = item.kind === 'verify:auto' ? 'critical' : 'warning'
    const reason =
      item.kind === 'verify:auto'
        ? `${item.id} is [verify:auto] but has no final-state screenshot — agent round-trip didn't complete`
        : `${item.id} is pending [${item.kind}] but has no screenshot evidence and no @no-screenshot marker`
    const suggestion =
      item.kind === 'verify:auto'
        ? 'rerun spectra-apply Step 8a Verify-Auto Pass; if agent cannot round-trip this item, downgrade kind to [review:ui]'
        : 'capture final-state evidence or add @no-screenshot when the item is round-trip-only'
    issues.push({
      severity,
      code: 'missing_screenshot_evidence',
      change: changeName,
      itemId: item.id,
      file: `openspec/changes/${changeName}/tasks.md:${item.lineNumber}`,
      message: reason,
      suggestion,
    })
  }
}

async function applyReviewReferenceRule(changeName: string, issues: Issue[]) {
  const reviewFiles = await collectReviewFiles(changeName)
  for (const reviewFile of reviewFiles) {
    const content = await readFile(reviewFile, 'utf8')
    for (const ref of extractImageRefs(content)) {
      const absPath = resolveReferencePath(reviewFile, ref)
      if (!absPath) continue
      if (!existsSync(absPath)) {
        issues.push({
          severity: 'critical',
          code: 'review_reference_missing',
          change: changeName,
          itemId: inferItemIdFromRef(ref),
          file: toRel(reviewFile),
          message: `review.md references missing screenshot: ${ref}`,
          suggestion: 'fix the reference or recapture the missing screenshot',
        })
      }
    }
  }
}

async function collectReviewFiles(changeName: string): Promise<string[]> {
  if (!existsSync(SCREENSHOTS_DIR)) return []
  const result: string[] = []
  const envs = await readdir(SCREENSHOTS_DIR, { withFileTypes: true })
  for (const env of envs) {
    if (!env.isDirectory() || env.name === '_archive') continue
    const reviewPath = join(SCREENSHOTS_DIR, env.name, changeName, 'review.md')
    if (existsSync(reviewPath)) result.push(reviewPath)
  }
  return result
}

function extractImageRefs(content: string): string[] {
  const refs = new Set<string>()
  const markdownRefRe = /!?\[[^\]]*]\(([^)]+?\.(?:png|jpe?g|webp))(?:\s+["'][^"']*["'])?\)/gi
  const inlinePathRe = /(?:^|[\s`"'])(screenshots\/[^\s`"')]+?\.(?:png|jpe?g|webp))/gim
  let match: RegExpExecArray | null
  while ((match = markdownRefRe.exec(content)) !== null) refs.add(cleanRef(match[1]!))
  while ((match = inlinePathRe.exec(content)) !== null) refs.add(cleanRef(match[1]!))
  return [...refs]
}

function cleanRef(ref: string): string {
  return ref.trim().replace(/^<|>$/g, '')
}

function resolveReferencePath(reviewFile: string, ref: string): string | null {
  if (/^[a-z]+:\/\//i.test(ref) || ref.startsWith('data:')) return null
  const withoutQuery = ref.split('?')[0]!
  if (withoutQuery.startsWith('screenshots/')) return join(ROOT, withoutQuery)
  return resolve(dirname(reviewFile), withoutQuery)
}

function inferItemIdFromRef(ref: string): string | null {
  const name = basename(ref)
  const match = name.match(/^#(\d+(?:\.\d+)?)/)
  return match ? `#${match[1]}` : null
}

function hasExplorationKeyword(relPath: string): boolean {
  const normalized = relPath.toLowerCase()
  return EXPLORATION_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

function toRel(path: string): string {
  return relative(ROOT, path).split(sep).join('/')
}

function formatHumanReport(report: AuditReport): string {
  const lines = [
    '# Screenshot Quality Audit',
    '',
    '## Summary',
    '',
    `- Changes scanned: ${report.summary.changesScanned}`,
    `- Items scanned: ${report.summary.itemsScanned}`,
    `- Screenshots scanned: ${report.summary.screenshotsScanned}`,
    `- Issues: ${report.summary.critical} critical, ${report.summary.warnings} warning`,
    '',
  ]

  if (report.issues.length === 0) {
    lines.push('No screenshot quality issues found.')
    return lines.join('\n')
  }

  for (const change of report.changes) {
    lines.push(`## ${change.name}`, '')
    const changeIssues = report.issues.filter((issue) => issue.change === change.name)
    if (changeIssues.length === 0) {
      lines.push('- No issues', '')
      continue
    }
    for (const issue of changeIssues) {
      const target = issue.itemId ? `${issue.itemId} ` : ''
      const file = issue.file ? ` (${issue.file})` : ''
      lines.push(`- [${issue.severity}] ${target}${issue.code} — ${issue.message}${file}`)
      lines.push(`  suggestion: ${issue.suggestion}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(2)
})
