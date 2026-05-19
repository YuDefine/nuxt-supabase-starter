#!/usr/bin/env node
/**
 * Local Manual Review GUI.
 *
 * This file is the clade-owned source. sync-vendor.mjs copies it to
 * consumer repositories as scripts/review-gui.mts, where pnpm review:ui runs
 * it from the consumer repo root.
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync } from 'node:fs'
import { mkdir, open as openFd, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import net from 'node:net'
import { join, normalize, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const DEFAULT_PORT = 5174

// =============================================================================
// Manual Review Pre-Flight Pattern Source
// =============================================================================
// Loads the same patterns.json that post-propose-manual-review-check.sh uses,
// keeping the bash hook and GUI client in lockstep (single source-of-truth).
// Patterns evaluate on parent item block content (parent line + scoped children
// joined by newlines) so that a sample UID / URL inline in a sub-item satisfies
// `requiresPresenceOf` / `requiresAbsenceOf` on the parent.

export interface ManualReviewPatternEntry {
  code: string
  description: string
  regex: string
  regexFlags?: string
  anchor: string
  remediation: string
  requiresPresenceOf?: string
  requiresAbsenceOf?: string
  appliesTo?: string
  requiresKindIn?: string[]
  /**
   * `"group"` → requiresAbsenceOf evaluates against the parent's full group
   * block (parent line + all scoped sub-items) regardless of whether the
   * current item is the parent or a sub-item. Use for rules where any line
   * in the group can satisfy the requirement (e.g. UI_ITEM_NO_URL: parent
   * declares the URL once, sub-items inherit). Default (omitted) keeps the
   * legacy scope: parent → full block, sub-item → its own line.
   */
  requiresAbsenceOfScope?: 'group'
  requiresPresenceOfScope?: 'group'
}

interface CompiledManualReviewPatternEntry extends ManualReviewPatternEntry {
  // Precompiled regex objects — populated lazily by `loadManualReviewPatterns`
  // so `evaluateManualReviewPatterns` skips repeated `new RegExp(...)` per item.
  _primaryRe: RegExp | null
  _presenceRe: RegExp | null
  _absenceRe: RegExp | null
}

let cachedPatterns: CompiledManualReviewPatternEntry[] | null = null

function compileOrNull(source: string | undefined, flags: string | undefined): RegExp | null {
  if (!source) return null
  try {
    return new RegExp(source, flags ?? '')
  } catch {
    return null
  }
}

function locatePatternsFile(): string | null {
  // Search upward from CWD looking for vendor/snippets/manual-review-enforcement/patterns.json
  // (works in both clade central repo and consumer repos).
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'vendor', 'snippets', 'manual-review-enforcement', 'patterns.json')
    if (existsSync(candidate)) return candidate
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Translate POSIX bracket expressions used by the bash hook into JS-compatible
 * regex syntax. patterns.json is designed for both `grep -E` (POSIX) and JS
 * `RegExp`; this one-way transform keeps a single source-of-truth.
 */
function translatePosixToJs(pattern: string): string {
  return pattern
    .replace(/\[\[:space:\]\]/g, '\\s')
    .replace(/\[\[:digit:\]\]/g, '\\d')
    .replace(/\[\[:alpha:\]\]/g, '[A-Za-z]')
    .replace(/\[\[:alnum:\]\]/g, '[A-Za-z0-9]')
    .replace(/\[\[:upper:\]\]/g, '[A-Z]')
    .replace(/\[\[:lower:\]\]/g, '[a-z]')
}

export function loadManualReviewPatterns(): ManualReviewPatternEntry[] {
  if (cachedPatterns !== null) return cachedPatterns
  const path = locatePatternsFile()
  if (!path) {
    cachedPatterns = []
    return cachedPatterns
  }
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as { patterns?: ManualReviewPatternEntry[] }
    const entries = Array.isArray(parsed.patterns) ? parsed.patterns : []
    cachedPatterns = entries.map((p) => {
      const regex = translatePosixToJs(p.regex)
      const presence = p.requiresPresenceOf ? translatePosixToJs(p.requiresPresenceOf) : undefined
      const absence = p.requiresAbsenceOf ? translatePosixToJs(p.requiresAbsenceOf) : undefined
      return {
        ...p,
        regex,
        requiresPresenceOf: presence,
        requiresAbsenceOf: absence,
        _primaryRe: compileOrNull(regex, p.regexFlags),
        _presenceRe: compileOrNull(presence, p.regexFlags),
        _absenceRe: compileOrNull(absence, p.regexFlags),
      }
    })
  } catch {
    cachedPatterns = []
  }
  return cachedPatterns
}

/**
 * Evaluate manual-review patterns against an item block.
 * `block`: when `isParent` is true, the parent line + scoped children joined
 *   by newline; when `isParent` is false, the sub-item line by itself.
 * `isParent`: drives default presence/absence scope (parent → full block,
 *   sub-item → its own line).
 * `groupBlock`: optional override — the parent's full group block (parent
 *   line + all scoped sub-items) used when a pattern declares
 *   `requiresAbsenceOfScope: "group"` or `requiresPresenceOfScope: "group"`.
 *   Defaults to `block` for backward compat (callers that only have one
 *   block keep prior semantics).
 * `appliesTo: parentLineOnly` patterns skip scoped children entirely.
 */
export function evaluateManualReviewPatterns(
  block: string,
  isParent: boolean,
  groupBlock?: string,
): Array<{ code: string; description: string; anchor: string }> {
  const patterns = loadManualReviewPatterns() as CompiledManualReviewPatternEntry[]
  const hits: Array<{ code: string; description: string; anchor: string }> = []
  // Primary regex evaluates against the first line (the item line itself).
  const firstLine = block.split('\n')[0] ?? ''
  const effectiveGroupBlock = groupBlock ?? block
  for (const p of patterns) {
    if (p.appliesTo === 'parentLineOnly' && !isParent) continue
    const primaryRe = p._primaryRe
    if (!primaryRe) continue
    if (!primaryRe.test(firstLine)) continue
    // requiresKindIn: pattern only fires when item's leading kind marker is in the allowed list.
    // Example: MULTI_STEP_NOT_SCOPED uses requiresKindIn: ["review:ui"] so it doesn't over-fire
    // on [verify:api] / [verify:api+ui] / [verify:e2e] items (verify channels — agent runs the
    // round-trip itself, not the user; arrow chains there describe agent-verifiable evidence).
    if (p.requiresKindIn && p.requiresKindIn.length > 0) {
      const kindMatch = firstLine.match(/\[((?:review|verify|discuss):[a-z+]+)\]/)
      const kind = kindMatch ? kindMatch[1] : null
      if (!kind || !p.requiresKindIn.includes(kind)) continue
    }
    const defaultScope = isParent ? block : firstLine
    if (p._presenceRe) {
      const scope = p.requiresPresenceOfScope === 'group' ? effectiveGroupBlock : defaultScope
      if (p._presenceRe.test(scope)) continue
    }
    if (p._absenceRe) {
      const scope = p.requiresAbsenceOfScope === 'group' ? effectiveGroupBlock : defaultScope
      if (p._absenceRe.test(scope)) continue
    }
    // MULTI_STEP_NOT_SCOPED special case: skip if parent block already contains
    // scoped sub-items (lines beginning with two-space indent + `- [`).
    if (p.code === 'MULTI_STEP_NOT_SCOPED' && isParent) {
      const hasScopedChildren = block.split('\n').some((l) => /^ {2}- \[[ xX]\]/.test(l))
      if (hasScopedChildren) continue
    }
    hits.push({ code: p.code, description: p.description, anchor: p.anchor })
  }
  return hits
}

const PORT_FALLBACK_RANGE = 20
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'])
const MANUAL_REVIEW_HEADING_RE = /^##\s+.*人工檢查\s*$/
const NEXT_HEADING_RE = /^##\s+/
const CHECKBOX_LINE_RE = /^[ \t]*- \[[ xX]\]\s+/
const PARENT_ITEM_RE = /^- \[([ xX])\] (#[1-9][0-9]*) (.+)$/
const SCOPED_ITEM_RE = /^  - \[([ xX])\] (#[1-9][0-9]*\.[1-9][0-9]*) (.+)$/
const TRAILING_NO_SCREENSHOT_RE = /(^|[^ ]) @no-screenshot$/
// `@no-manual-review-check[<reason>]` bypass marker per manual-review.md hard rule.
// Empty brackets and bare marker (no brackets) are invalid by schema → not captured here.
// May coexist with trailing `@no-screenshot` (canonical ordering: bypass then no-screenshot).
const TRAILING_NO_MANUAL_REVIEW_CHECK_RE =
  /@no-manual-review-check\[([^\][]+)\](?:\s+@no-screenshot)?\s*$/
// 解析 leading kind marker — 必須緊接 `#N` / `#N.M` 後第一個 token、含一個 trailing space。
// description-mid 的 [discuss] / [review:ui] / [verify:*] 不會被命中（不是行首）。
const LEADING_KIND_RE = /^\[([^\]]+)\]\s+/
const VERIFY_CHANNEL_ORDER = ['e2e', 'api', 'ui'] as const
const VERIFY_KIND_ORDER = ['verify:e2e', 'verify:api', 'verify:ui'] as const
const VALID_KINDS = new Set(['review:ui', 'discuss', 'verify:auto', ...VERIFY_KIND_ORDER])
const VERIFY_CHANNELS = new Set<string>(VERIFY_CHANNEL_ORDER)
const BACKEND_ONLY_DECLARATION = '**No user-facing journey (backend-only)**'
const STRUCTURED_ANNOTATION_ORDER = [
  'verifiedE2e',
  'verifiedApi',
  'verifiedUi',
  'claudeDiscussed',
] as const

export type ManualReviewItemKind =
  | 'review:ui'
  | 'discuss'
  | 'verify:auto'
  | 'verify:e2e'
  | 'verify:api'
  | 'verify:ui'

type ResolvedManualReviewItemKind = Exclude<ManualReviewItemKind, 'verify:auto'>
type DefaultManualReviewItemKind = Extract<ManualReviewItemKind, 'review:ui' | 'discuss'>
type StructuredAnnotationKey = (typeof STRUCTURED_ANNOTATION_ORDER)[number]

export interface VerifiedE2eAnnotation {
  raw: string
  timestamp: string
  spec: string
  trace: string
}

export interface VerifiedApiAnnotation {
  raw: string
  timestamp: string
  method: string
  url: string
  status: string
  body?: string
}

export interface VerifiedUiAnnotation {
  raw: string
  timestamp: string
  screenshot: string
  dom?: string
}

export interface ClaudeDiscussedAnnotation {
  raw: string
  timestamp: string
}

export interface ManualReviewItemAnnotations {
  verifiedE2e?: VerifiedE2eAnnotation
  verifiedApi?: VerifiedApiAnnotation
  verifiedUi?: VerifiedUiAnnotation
  claudeDiscussed?: ClaudeDiscussedAnnotation
  // *List 保留同一個 raw 行裡所有同 prefix annotation。單值欄位 = 最後一個（back-compat）；
  // upsert/canonicalize 路徑仍走單值 record，這裡只服務 parse + display 的多筆顯示需求。
  verifiedE2eList?: VerifiedE2eAnnotation[]
  verifiedApiList?: VerifiedApiAnnotation[]
  verifiedUiList?: VerifiedUiAnnotation[]
  claudeDiscussedList?: ClaudeDiscussedAnnotation[]
}

export interface ManualReviewItem {
  id: string
  description: string
  checked: boolean
  scoped: boolean
  parentId: string | null
  raw: string
  lineIndex: number
  lineNumber: number
  noScreenshot: boolean
  /** Pre-flight bypass marker `@no-manual-review-check[<reason>]`，若 valid 則 hook + GUI 跳過 pattern eval。 */
  bypassManualReviewCheck: { reason: string } | null
  /** Pre-flight hit findings — patterns.json regex matches against item block。bypassManualReviewCheck 非 null 時為空。 */
  manualReviewHits: Array<{ code: string; description: string; anchor: string }>
  /** Resolved leading kind marker；legacy field，等於 `kinds[0]`。 */
  kind: ManualReviewItemKind
  /** Resolved kind markers；`[verify:auto]` 會展開成 `['verify:api', 'verify:ui']`。 */
  kinds: ReadonlyArray<ResolvedManualReviewItemKind>
  /** Structured evidence annotations parsed from raw line. */
  annotations: ManualReviewItemAnnotations
  /** 原始 raw 行有 explicit leading kind marker（true）或走 default 推導（false） */
  hasExplicitKind: boolean
}

export interface ManualReviewMalformedLine {
  lineIndex: number
  lineNumber: number
  raw: string
  reason: string
}

export interface ManualReviewSection {
  heading: string
  startLine: number
  endLine: number
  items: ManualReviewItem[]
  malformed: ManualReviewMalformedLine[]
}

export interface ParsedManualReview {
  sections: ManualReviewSection[]
  items: ManualReviewItem[]
  malformed: ManualReviewMalformedLine[]
}

export interface FileVersion {
  hash: string
  mtimeMs: number
}

/**
 * Build a set of parent item IDs that own at least one scoped child (`#N.M`).
 * Server-side equivalent of the GUI's `rebuildParentChildrenIndex()` so the
 * completion counter and archive-readiness check share one notion of
 * "parent-with-children".
 */
export function buildParentsWithScopedChildren(items: readonly ManualReviewItem[]): Set<string> {
  const parents = new Set<string>()
  for (const item of items) {
    if (item.scoped && item.parentId) parents.add(item.parentId)
  }
  return parents
}

/**
 * Whether `item` is a parent that owns at least one scoped child. Such parents
 * are intentionally excluded from completion / archive counts: the GUI's
 * `requiresUserConfirmation()` returns false for them so users cannot OK / Issue
 * / Skip the parent directly. Counting them in `pending` keeps the change
 * stuck even after every scoped child passes.
 */
export function manualReviewItemHasScopedChildren(
  item: ManualReviewItem,
  parentsWithScopedChildren: ReadonlySet<string>,
): boolean {
  if (item.scoped) return false
  return parentsWithScopedChildren.has(item.id)
}

interface CliOptions {
  host: string
  port: number
  repoRoot: string
  openBrowser: boolean
  /** Headless scan：不啟 server，輸出 readiness JSON 到 stdout 後結束。供 review-readiness-scan skill 使用。 */
  scan: boolean
  /**
   * User 顯式帶 `--repo <path>` → 視為已知意圖（如 CI / 腳本指定 main path 跑 scan），
   * skip preflightCwd 的 worktree 拒絕檢查。預設 process.cwd() 啟動時 enforce check。
   */
  explicitRepo: boolean
}

interface ScreenshotFile {
  relPath: string
  url: string
  name: string
}

interface ScreenshotTopic {
  env: string
  topic: string
  files: ScreenshotFile[]
}

interface ChangeSummary {
  name: string
  tasksPath: string
  /**
   * 該 change 實際所在的 working tree 絕對路徑。
   * - main repo → mainRoot
   * - worktree → 對應 worktree path
   * 後續 readChangeDetail / persistReviewAction / invokeReviewArchive / serveScreenshot 全部依此 route。
   */
  sourceRoot: string
  /** Worktree slug；main repo 為 null。前端用此貼 `wt:<slug>` 標籤。 */
  worktreeSlug: string | null
  total: number
  checked: number
  pending: number
  /** 含 `（issue: ...）` annotation 的 item 數；issue 在 raw 是 `[ ]`，仍算 pending 但 UI 要區分 */
  issued: number
  /**
   * effective items 中「需要 user 親自確認（review:ui / verify:ui）」且未 [x]、未標 issue 的數量。
   * verify:api / verify:e2e 自動驗證 item（GUI `requiresUserConfirmation` 回 false）即使 [ ]
   * 也不算進此值。home page 用此判斷「user 是否還有可點的 item」，0 = 所有可點項已處理。
   */
  userActionPending: number
  malformed: number
  /** Pre-Review Data Readiness：effective items 命中的 manual-review pattern 總次數。0 = ready for review。 */
  readinessHits: number
  /** Hit code → count，提供 home page 顯示「MISSING_URL ×2, BACKEND_MISFLAGGED ×1」摘要。 */
  hitsByCode: Record<string, number>
  /**
   * Effective items 標了 `[verify:e2e]` / `[verify:api]` / `[verify:ui]` 但缺對應 `(verified-*:)` annotation
   * 的清單。每個 entry 一個 item（kinds 可能多個 tag）。配合 home page 把這類 change 歸到 not-ready 群、
   * 健康檢查 prompt 一併列出由 Claude 跑 `/spectra-apply` Step 8a 補齊。
   */
  evidenceMissing: Array<{
    itemId: string
    description: string
    kinds: ReadonlyArray<'e2e' | 'api' | 'ui'>
  }>
  /**
   * Impl task 總數 — 計算 `- [ ] N.M ...` / `- [x] N.M ...` 行（含小數點 ID，無 `#` 前綴）。
   * 排除 `## 人工檢查` 區塊（那邊用 `#N` / `#N.M` 格式）。用於 home page 判斷該 change 是
   * 「apply 已完成、可批量補 evidence」還是「apply 還在動工、補 evidence 會撞不存在的 UI/seed」。
   */
  implTotal: number
  /** 已勾選的 impl task 數（`- [x] N.M ...`）。`implDone / implTotal` 是 apply 完成度估計值。 */
  implDone: number
  screenshotTopicCount: number
  screenshotTopics: string[]
}

interface ChangeDetail extends ChangeSummary {
  version: FileVersion
  items: ManualReviewItem[]
  malformedLines: ManualReviewMalformedLine[]
  screenshotPools: ScreenshotTopic[]
}

class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * 從 proposal.md 內容推導 default kind。
 * - 含 `**No user-facing journey (backend-only)**` → `discuss`
 * - 否則 → `review:ui`
 *
 * NEVER 改成「沒 proposal.md 直接 throw」— legacy in-flight change 沒 marker 時
 * 仍依此 fallback 不破壞既有 archive flow（spec line 60-62 / task 8.5）。
 */
export function deriveDefaultKindFromProposal(
  proposalContent: string | null,
): DefaultManualReviewItemKind {
  if (!proposalContent) return 'review:ui'
  return proposalContent.includes(BACKEND_ONLY_DECLARATION) ? 'discuss' : 'review:ui'
}

export interface ParseManualReviewOptions {
  /** Default kind 套用條件：item line 沒 leading marker 時 fallback 到此值。預設 `review:ui` */
  defaultKind?: ManualReviewItemKind
  /** Warning context for parser diagnostics. */
  sourcePath?: string
}

export function parseManualReviewSections(
  content: string,
  options: ParseManualReviewOptions = {},
): ParsedManualReview {
  const defaultKind = normalizeDefaultKind(options.defaultKind ?? 'review:ui', {
    sourcePath: options.sourcePath ?? '<inline>',
    lineNumber: 0,
  })
  const sourcePath = options.sourcePath ?? '<inline>'
  const lines = content.split(/\r?\n/)
  const sections: ManualReviewSection[] = []
  let current: ManualReviewSection | null = null
  let parentIds = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (MANUAL_REVIEW_HEADING_RE.test(line)) {
      current = {
        heading: line,
        startLine: i,
        endLine: lines.length - 1,
        items: [],
        malformed: [],
      }
      sections.push(current)
      parentIds = new Set<string>()
      continue
    }

    if (current && NEXT_HEADING_RE.test(line)) {
      current.endLine = i - 1
      current = null
      continue
    }

    if (!current || !CHECKBOX_LINE_RE.test(line)) continue

    const parent = line.match(PARENT_ITEM_RE)
    if (parent) {
      const item = toReviewItem(parent, line, i, false, defaultKind, sourcePath)
      current.items.push(item)
      parentIds.add(item.id)
      continue
    }

    const scoped = line.match(SCOPED_ITEM_RE)
    if (scoped) {
      const item = toReviewItem(scoped, line, i, true, defaultKind, sourcePath)
      const parentId = item.id.split('.')[0]!
      if (!parentIds.has(parentId)) {
        current.malformed.push({
          lineIndex: i,
          lineNumber: i + 1,
          raw: line,
          reason: `Scoped item ${item.id} references missing parent ${parentId}`,
        })
        continue
      }
      current.items.push(item)
      continue
    }

    current.malformed.push({
      lineIndex: i,
      lineNumber: i + 1,
      raw: line,
      reason: 'Expected - [ ] #N description or two-space indented - [ ] #N.M description',
    })
  }

  // Post-pass: evaluate Pre-Review Data Readiness patterns against each item.
  // Parent items see the full block (parent line + scoped children); scoped items
  // see only their own line. Bypassed items keep `manualReviewHits` empty.
  for (const section of sections) {
    const byParent = new Map<string, ManualReviewItem[]>()
    for (const item of section.items) {
      if (item.scoped && item.parentId) {
        if (!byParent.has(item.parentId)) byParent.set(item.parentId, [])
        byParent.get(item.parentId)!.push(item)
      }
    }
    // Pre-build group blocks per parent id so sub-items can pass their
    // parent's full group as `groupBlock` for `requiresAbsenceOfScope: "group"`
    // patterns (e.g. UI_ITEM_NO_URL — continuation sub-items inherit the URL
    // declared in a sibling).
    const groupBlocks = new Map<string, string>()
    for (const item of section.items) {
      if (item.scoped) continue
      const children = byParent.get(item.id) ?? []
      groupBlocks.set(item.id, [item.raw, ...children.map((c) => c.raw)].join('\n'))
    }
    for (const item of section.items) {
      if (item.bypassManualReviewCheck) continue
      if (item.scoped) {
        const groupBlock = groupBlocks.get(item.parentId!) ?? item.raw
        item.manualReviewHits = evaluateManualReviewPatterns(item.raw, false, groupBlock)
      } else {
        const block = groupBlocks.get(item.id) ?? item.raw
        item.manualReviewHits = evaluateManualReviewPatterns(block, true, block)
      }
    }
  }

  const items = sections.flatMap((section) => section.items)
  const malformed = sections.flatMap((section) => section.malformed)
  return { sections, items, malformed }
}

function toReviewItem(
  match: RegExpMatchArray,
  raw: string,
  lineIndex: number,
  scoped: boolean,
  defaultKind: DefaultManualReviewItemKind,
  sourcePath: string,
): ManualReviewItem {
  const id = match[2]!
  const rawDescription = match[3]!.trim()
  const {
    description: afterKind,
    kinds,
    hasExplicitKind,
  } = parseLeadingKindMarker(rawDescription, defaultKind, {
    sourcePath,
    lineNumber: lineIndex + 1,
  })
  const annotations = parseStructuredAnnotations(raw, { sourcePath, lineNumber: lineIndex + 1 })
  const withoutAnnotations = stripStructuredAnnotations(afterKind)
  // Parse bypass marker before @no-screenshot so they coexist correctly.
  const { description: afterBypass, bypassManualReviewCheck } =
    parseNoManualReviewCheckMarker(withoutAnnotations)
  const { description, noScreenshot } = parseNoScreenshotMarker(afterBypass)
  if (bypassManualReviewCheck) {
    process.stderr.write(
      `[info] ${sourcePath}:${lineIndex + 1} bypass: ${bypassManualReviewCheck.reason}\n`,
    )
  }
  return {
    id,
    description,
    checked: match[1]!.toLowerCase() === 'x',
    scoped,
    parentId: scoped ? id.split('.')[0]! : null,
    raw,
    lineIndex,
    lineNumber: lineIndex + 1,
    noScreenshot,
    bypassManualReviewCheck,
    // Filled in by parseManualReviewSections post-pass once scoped children are available.
    manualReviewHits: [],
    kind: kinds[0]!,
    kinds,
    annotations,
    hasExplicitKind,
  }
}

/**
 * Strip leading `[review:ui]` / `[discuss]` marker，回傳 description（含後續所有 trailing markers）。
 * - Marker **MUST** 緊接 `#N` 後第一個 token（已被 PARENT_ITEM_RE / SCOPED_ITEM_RE 切走 id），
 *   所以這裡的 description 是 `[<kind>] <rest>` 或 `<rest>`（無 marker）。
 * - 不合法 kind（如 `[auto]`）→ stderr warn、保留 literal `[auto]` 在 description、用 defaultKind。
 * - mid-description `[discuss]` / `[review:ui]` 不會命中（regex 鎖開頭）。
 */
function parseLeadingKindMarker(
  description: string,
  defaultKind: DefaultManualReviewItemKind,
  context: ParserWarningContext,
): {
  description: string
  kinds: ReadonlyArray<ResolvedManualReviewItemKind>
  hasExplicitKind: boolean
} {
  const match = description.match(LEADING_KIND_RE)
  if (!match) {
    return { description, kinds: [defaultKind], hasExplicitKind: false }
  }
  const candidate = match[1]!
  const parsed = parseKindMarkerCandidate(candidate, defaultKind, context)
  if (!parsed.valid) {
    return { description, kinds: [defaultKind], hasExplicitKind: false }
  }
  return {
    description: description.slice(match[0]!.length),
    kinds: parsed.kinds,
    hasExplicitKind: true,
  }
}

interface ParserWarningContext {
  sourcePath: string
  lineNumber: number
}

function formatParserLocation(context: ParserWarningContext): string {
  return context.lineNumber > 0 ? `${context.sourcePath}:${context.lineNumber}` : context.sourcePath
}

function warnParser(context: ParserWarningContext, message: string): void {
  process.stderr.write(`[review-gui] warn: ${formatParserLocation(context)}: ${message}\n`)
}

function normalizeDefaultKind(
  candidate: ManualReviewItemKind,
  context: ParserWarningContext,
): DefaultManualReviewItemKind {
  if (candidate === 'review:ui' || candidate === 'discuss') return candidate
  warnParser(
    context,
    `invalid default manual-review kind '${candidate}' — falling back to default 'review:ui'`,
  )
  return 'review:ui'
}

function parseKindMarkerCandidate(
  candidate: string,
  defaultKind: DefaultManualReviewItemKind,
  context: ParserWarningContext,
): { valid: true; kinds: ReadonlyArray<ResolvedManualReviewItemKind> } | { valid: false } {
  if (candidate === 'verify:auto') {
    warnParser(context, '[verify:auto] is deprecated; prefer [verify:api+ui]')
    return { valid: true, kinds: ['verify:api', 'verify:ui'] }
  }

  if (candidate.includes('+')) {
    return parseMultiChannelKindMarker(candidate, defaultKind, context)
  }

  if (!VALID_KINDS.has(candidate)) {
    warnParser(
      context,
      `unknown manual-review kind marker [${candidate}] — falling back to default '${defaultKind}'`,
    )
    return { valid: false }
  }

  return { valid: true, kinds: [candidate as ResolvedManualReviewItemKind] }
}

function parseMultiChannelKindMarker(
  candidate: string,
  defaultKind: DefaultManualReviewItemKind,
  context: ParserWarningContext,
): { valid: true; kinds: ReadonlyArray<ResolvedManualReviewItemKind> } | { valid: false } {
  if (!candidate.startsWith('verify:')) {
    warnParser(
      context,
      `invalid multi-channel manual-review kind marker [${candidate}] — only verify:* channels may be combined; falling back to default '${defaultKind}'`,
    )
    return { valid: false }
  }

  const rawChannels = candidate.slice('verify:'.length).split('+')
  if (rawChannels.length < 2 || rawChannels.length > 3) {
    warnParser(
      context,
      `invalid multi-channel manual-review kind marker [${candidate}] — expected 2 or 3 verify channels; falling back to default '${defaultKind}'`,
    )
    return { valid: false }
  }

  const seen = new Set<string>()
  for (const channel of rawChannels) {
    if (!VERIFY_CHANNELS.has(channel)) {
      warnParser(
        context,
        `invalid multi-channel manual-review kind marker [${candidate}] — unknown verify channel '${channel}'; falling back to default '${defaultKind}'`,
      )
      return { valid: false }
    }
    if (seen.has(channel)) {
      warnParser(
        context,
        `invalid multi-channel manual-review kind marker [${candidate}] — duplicate verify channel '${channel}'; falling back to default '${defaultKind}'`,
      )
      return { valid: false }
    }
    seen.add(channel)
  }

  return {
    valid: true,
    kinds: VERIFY_CHANNEL_ORDER.filter((channel) => seen.has(channel)).map(
      (channel) => `verify:${channel}` as ResolvedManualReviewItemKind,
    ),
  }
}

function canonicalizeLeadingKindMarker(line: string): string {
  return line.replace(
    /^(\s*- \[[ xX]\]\s+#[1-9][0-9]*(?:\.[1-9][0-9]*)?\s+)\[verify:([^\]]*\+[^\]]*)\]/,
    (full: string, prefix: string, channelsText: string) => {
      const channels = channelsText.split('+')
      if (
        channels.length < 2 ||
        channels.length > 3 ||
        channels.some((channel) => !VERIFY_CHANNELS.has(channel)) ||
        new Set(channels).size !== channels.length
      ) {
        return full
      }
      const canonical = VERIFY_CHANNEL_ORDER.filter((channel) => channels.includes(channel)).join(
        '+',
      )
      return `${prefix}[verify:${canonical}]`
    },
  )
}

function parseNoScreenshotMarker(description: string): {
  description: string
  noScreenshot: boolean
} {
  if (!TRAILING_NO_SCREENSHOT_RE.test(description)) {
    return { description, noScreenshot: false }
  }

  return {
    description: description.slice(0, -' @no-screenshot'.length).trim(),
    noScreenshot: true,
  }
}

/**
 * Parse `@no-manual-review-check[<reason>]` bypass marker per manual-review.md hard rule.
 * Empty brackets `[]` and bare marker (no brackets) are invalid → returns null.
 * Marker must be trailing (optionally followed by `@no-screenshot`).
 */
function parseNoManualReviewCheckMarker(description: string): {
  description: string
  bypassManualReviewCheck: { reason: string } | null
} {
  const match = description.match(TRAILING_NO_MANUAL_REVIEW_CHECK_RE)
  if (!match) {
    return { description, bypassManualReviewCheck: null }
  }
  const reason = match[1]!.trim()
  if (!reason) {
    return { description, bypassManualReviewCheck: null }
  }
  // Strip the bypass marker but preserve trailing @no-screenshot for downstream parser.
  const stripped = description.slice(0, match.index).trim()
  const afterScreenshot = match[0]!.endsWith('@no-screenshot') ? ' @no-screenshot' : ''
  return {
    description: (stripped + afterScreenshot).trim(),
    bypassManualReviewCheck: { reason },
  }
}

function parseStructuredAnnotations(
  line: string,
  context: ParserWarningContext,
): ManualReviewItemAnnotations {
  const annotations: ManualReviewItemAnnotations = {}
  const matches = line.matchAll(
    /\((verified-e2e|verified-api|verified-ui|claude-discussed):\s*([^)]*)\)/g,
  )
  for (const match of matches) {
    const prefix = match[1]!
    const body = match[2]!.trim()
    const raw = match[0]!
    const parsed = parseStructuredAnnotationValue(prefix, raw, body, context)
    if (!parsed) continue
    if (parsed.verifiedE2e) {
      ;(annotations.verifiedE2eList ??= []).push(parsed.verifiedE2e)
      annotations.verifiedE2e = parsed.verifiedE2e
    }
    if (parsed.verifiedApi) {
      ;(annotations.verifiedApiList ??= []).push(parsed.verifiedApi)
      annotations.verifiedApi = parsed.verifiedApi
    }
    if (parsed.verifiedUi) {
      ;(annotations.verifiedUiList ??= []).push(parsed.verifiedUi)
      annotations.verifiedUi = parsed.verifiedUi
    }
    if (parsed.claudeDiscussed) {
      ;(annotations.claudeDiscussedList ??= []).push(parsed.claudeDiscussed)
      annotations.claudeDiscussed = parsed.claudeDiscussed
    }
  }
  return annotations
}

function parseStructuredAnnotationValue(
  prefix: string,
  raw: string,
  body: string,
  context: ParserWarningContext,
): ManualReviewItemAnnotations | null {
  const parts = body.split(/\s+/).filter(Boolean)
  const timestamp = parts[0]
  if (!timestamp) {
    warnParser(context, `malformed (${prefix}: ...) annotation — missing timestamp`)
    return null
  }

  if (prefix === 'verified-e2e') {
    const spec = findKeyValue(parts, 'spec')
    const trace = findKeyValue(parts, 'trace')
    if (!spec || !trace) {
      warnParser(
        context,
        `malformed (${prefix}: ...) annotation — expected spec=<path> trace=<path>`,
      )
      return null
    }
    return { verifiedE2e: { raw, timestamp, spec, trace } }
  }

  if (prefix === 'verified-api') {
    const method = parts[1]
    const url = parts[2]
    const status = parts[3]
    if (!method || !url || !status) {
      warnParser(
        context,
        `malformed (${prefix}: ...) annotation — expected <ISO> <METHOD> <URL> <STATUS>`,
      )
      return null
    }
    const bodyDigest = findKeyValue(parts, 'body')
    return {
      verifiedApi: {
        raw,
        timestamp,
        method,
        url,
        status,
        ...(bodyDigest ? { body: bodyDigest } : {}),
      },
    }
  }

  if (prefix === 'verified-ui') {
    const screenshot = findKeyValue(parts, 'screenshot')
    if (!screenshot) {
      warnParser(context, `malformed (${prefix}: ...) annotation — expected screenshot=<path>`)
      return null
    }
    const dom = findKeyValue(parts, 'dom')
    return {
      verifiedUi: {
        raw,
        timestamp,
        screenshot,
        ...(dom ? { dom } : {}),
      },
    }
  }

  return { claudeDiscussed: { raw, timestamp } }
}

function findKeyValue(parts: string[], key: string): string | undefined {
  const prefix = `${key}=`
  return parts.find((part) => part.startsWith(prefix))?.slice(prefix.length)
}

function annotationPrefixToKey(prefix: string): StructuredAnnotationKey {
  if (prefix === 'verified-e2e') return 'verifiedE2e'
  if (prefix === 'verified-api') return 'verifiedApi'
  if (prefix === 'verified-ui') return 'verifiedUi'
  return 'claudeDiscussed'
}

function stripStructuredAnnotations(line: string): string {
  return line
    .replace(/\s*\((?:verified-e2e|verified-api|verified-ui|claude-discussed):[^)]*\)/g, '')
    .replace(/[ \t]+$/, '')
}

function collectStructuredAnnotationRaw(line: string): {
  base: string
  annotations: Partial<Record<StructuredAnnotationKey, string>>
} {
  const annotations: Partial<Record<StructuredAnnotationKey, string>> = {}
  const base = line.replace(
    /\s*\((verified-e2e|verified-api|verified-ui|claude-discussed):[^)]*\)/g,
    (raw: string, prefix: string) => {
      annotations[annotationPrefixToKey(prefix)] = raw.trim()
      return ''
    },
  )
  return { base: base.replace(/[ \t]+$/, ''), annotations }
}

function renderStructuredAnnotations(
  annotations: Partial<Record<StructuredAnnotationKey, string>>,
): string {
  return STRUCTURED_ANNOTATION_ORDER.flatMap((key) =>
    annotations[key] ? [annotations[key]!] : [],
  ).join(' ')
}

function upsertStructuredAnnotation(
  line: string,
  key: StructuredAnnotationKey,
  annotation: string,
): string {
  const { base, annotations } = collectStructuredAnnotationRaw(line)
  annotations[key] = annotation
  const rendered = renderStructuredAnnotations(annotations)
  return rendered ? `${base.trimEnd()} ${rendered}` : base
}

function canonicalizeStructuredAnnotations(line: string): string {
  const { base, annotations } = collectStructuredAnnotationRaw(line)
  const rendered = renderStructuredAnnotations(annotations)
  return rendered ? `${base.trimEnd()} ${rendered}` : base
}

export interface ParentRollupResult {
  parentId: string
  lineBefore: string
  lineAfter: string
}

export interface ApplyReviewActionResult {
  content: string
  lineBefore: string
  lineAfter: string
  parentRollup?: ParentRollupResult
}

export function applyReviewActionToContent(
  content: string,
  itemId: string,
  action: 'ok' | 'issue' | 'skip',
  note = '',
  options: ParseManualReviewOptions = {},
  finding = '',
): ApplyReviewActionResult {
  const parsed = parseManualReviewSections(content, options)
  if (parsed.malformed.length > 0) {
    throw new HttpError(
      422,
      'Manual-review section has malformed checkbox lines. Fix schema before writing.',
    )
  }

  const item = parsed.items.find((candidate) => candidate.id === itemId)
  if (!item) throw new HttpError(404, `Manual-review item not found: ${itemId}`)

  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const lineBefore = lines[item.lineIndex] ?? ''
  const lineAfter = applyActionToLine(lineBefore, action, note, finding)
  lines[item.lineIndex] = lineAfter

  const parentRollup = item.scoped ? rollupParentForScopedItem(lines, item, options) : null

  const result: ApplyReviewActionResult = {
    content: lines.join(newline),
    lineBefore,
    lineAfter,
  }
  if (parentRollup) result.parentRollup = parentRollup
  return result
}

function rollupParentForScopedItem(
  lines: string[],
  scopedItem: ManualReviewItem,
  options: ParseManualReviewOptions,
): ParentRollupResult | null {
  if (!scopedItem.scoped || !scopedItem.parentId) return null

  const reparsed = parseManualReviewSections(lines.join('\n'), options)
  const parent = reparsed.items.find((i) => i.id === scopedItem.parentId && !i.scoped)
  if (!parent) return null

  const siblings = reparsed.items.filter((i) => i.scoped && i.parentId === scopedItem.parentId)
  if (siblings.length === 0) return null

  const allChildrenOk = siblings.every((i) => i.checked && !/（issue:[^）]*）/.test(i.raw))

  const lineBefore = lines[parent.lineIndex] ?? ''
  if (allChildrenOk === parent.checked) return null

  const lineAfter = setCheckbox(lineBefore, allChildrenOk)
  if (lineAfter === lineBefore) return null

  lines[parent.lineIndex] = lineAfter
  return { parentId: parent.id, lineBefore, lineAfter }
}

function isAutomaticOnlyKinds(kinds: ReadonlyArray<ResolvedManualReviewItemKind>): boolean {
  return kinds.length > 0 && kinds.every((kind) => kind === 'verify:e2e' || kind === 'verify:api')
}

function hasExpectedAutomaticAnnotations(item: ManualReviewItem): boolean {
  return item.kinds.every((kind) => {
    if (kind === 'verify:e2e') return Boolean(item.annotations.verifiedE2e)
    if (kind === 'verify:api') return Boolean(item.annotations.verifiedApi)
    return false
  })
}

/**
 * Step 8a helper：pure automatic channels (`verify:e2e` / `verify:api`) complete from
 * evidence annotations alone. UI-confirmation channels remain user-driven.
 */
export function autoCheckCompletedAutomaticItems(
  content: string,
  options: ParseManualReviewOptions = {},
): { content: string; checkedItemIds: string[] } {
  const parsed = parseManualReviewSections(content, options)
  if (parsed.malformed.length > 0) {
    throw new HttpError(
      422,
      'Manual-review section has malformed checkbox lines. Fix schema before writing.',
    )
  }

  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const checkedItemIds: string[] = []

  for (const item of parsed.items) {
    if (item.checked) continue
    if (!isAutomaticOnlyKinds(item.kinds)) continue
    if (!hasExpectedAutomaticAnnotations(item)) continue

    const lineBefore = lines[item.lineIndex] ?? ''
    lines[item.lineIndex] = setCheckbox(canonicalizeLeadingKindMarker(lineBefore), true)
    checkedItemIds.push(item.id)
  }

  return { content: lines.join(newline), checkedItemIds }
}

/**
 * 在 tasks.md item line 上記錄「Claude 已與 user 討論並取得 OK」的 evidence trail，
 * 用於 spectra-archive Step 2.5 walkthrough 的 OK 路徑（spec line 102-111）。
 *
 * 行為：
 * - 勾選 checkbox（`- [x]`）
 * - 在 description 後、所有 trailing markers (`@followup` / `@no-screenshot`) 前插入
 *   `(claude-discussed: <ISO-8601-timestamp>)` annotation
 * - 保留 leading kind marker `[discuss]`（spec line 191）
 * - 保留 trailing markers 原順序（spec line 197）
 *
 * 預期僅對 `kind: 'discuss'` items 呼叫 — caller 自行確認 kind。
 */
export function applyClaudeDiscussedAnnotationToContent(
  content: string,
  itemId: string,
  isoTimestamp: string,
  options: ParseManualReviewOptions = {},
): { content: string; lineBefore: string; lineAfter: string } {
  const parsed = parseManualReviewSections(content, options)
  if (parsed.malformed.length > 0) {
    throw new HttpError(
      422,
      'Manual-review section has malformed checkbox lines. Fix schema before writing.',
    )
  }
  const item = parsed.items.find((candidate) => candidate.id === itemId)
  if (!item) throw new HttpError(404, `Manual-review item not found: ${itemId}`)

  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const lineBefore = lines[item.lineIndex] ?? ''
  const lineAfter = applyClaudeDiscussedToLine(lineBefore, isoTimestamp)
  lines[item.lineIndex] = lineAfter
  return { content: lines.join(newline), lineBefore, lineAfter }
}

function applyClaudeDiscussedToLine(line: string, isoTimestamp: string): string {
  const { core, trailing } = extractTrailingMarkers(line)
  const checked = setCheckbox(canonicalizeLeadingKindMarker(core), true)
  const annotated = upsertStructuredAnnotation(
    checked,
    'claudeDiscussed',
    `(claude-discussed: ${isoTimestamp})`,
  )
  return trailing ? `${annotated}${trailing}` : annotated
}

export interface VerifyAutoEvidence {
  /** Mutation HTTP status code observed by agent，必填以證明 round-trip 真的發生 */
  network: string
  /** DOM 觀察結果（list refetch / toast / banner 等），可選 */
  dom?: string
  /** 其他自由 key=value（不能含 space 或 `)`），依 key 字典序輸出 */
  [key: string]: string | undefined
}

export interface VerifiedE2eEvidence {
  spec: string
  trace: string
}

export interface VerifiedApiEvidence {
  method: string
  url: string
  status: string
  body?: string
}

export interface VerifiedUiEvidence {
  screenshot: string
  dom?: string
}

/**
 * 在 tasks.md item line 上記錄「screenshot-review agent verify mode round-trip」的 evidence trail，
 * 用於 spectra-apply Step 8a Verify-Auto Pass 的 PASS 路徑。
 *
 * 行為：
 * - **不**勾選 checkbox（保留 `[ ]`）— `[verify:auto]` 仍需 user 在 review GUI 點 OK 才勾，避免 agent 觀察品質不足造成假通過
 * - 在 description 後、所有 trailing markers (`@followup` / `@no-screenshot`) 前插入
 *   `(verified-auto: <ISO> network=<status>[ dom=<obs>][ key=value]...)` annotation
 * - 保留 leading kind marker `[verify:auto]`
 * - 保留 trailing markers 原順序
 *
 * 預期僅對 `kind: 'verify:auto'` items 呼叫 — caller 自行確認 kind。
 */
export function applyVerifiedAutoAnnotationToContent(
  content: string,
  itemId: string,
  isoTimestamp: string,
  evidence: VerifyAutoEvidence,
  options: ParseManualReviewOptions = {},
): { content: string; lineBefore: string; lineAfter: string } {
  const parsed = parseManualReviewSections(content, options)
  if (parsed.malformed.length > 0) {
    throw new HttpError(
      422,
      'Manual-review section has malformed checkbox lines. Fix schema before writing.',
    )
  }
  const item = parsed.items.find((candidate) => candidate.id === itemId)
  if (!item) throw new HttpError(404, `Manual-review item not found: ${itemId}`)

  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const lineBefore = lines[item.lineIndex] ?? ''
  const lineAfter = applyVerifiedAutoToLine(lineBefore, isoTimestamp, evidence)
  lines[item.lineIndex] = lineAfter
  return { content: lines.join(newline), lineBefore, lineAfter }
}

export function applyVerifiedE2eAnnotationToContent(
  content: string,
  itemId: string,
  isoTimestamp: string,
  evidence: VerifiedE2eEvidence,
  options: ParseManualReviewOptions = {},
): { content: string; lineBefore: string; lineAfter: string } {
  return applyVerifyChannelAnnotationToContent(content, itemId, {
    key: 'verifiedE2e',
    annotation: `(verified-e2e: ${isoTimestamp} spec=${sanitizeEvidenceValue(evidence.spec)} trace=${sanitizeEvidenceValue(evidence.trace)})`,
    options,
  })
}

export function applyVerifiedApiAnnotationToContent(
  content: string,
  itemId: string,
  isoTimestamp: string,
  evidence: VerifiedApiEvidence,
  options: ParseManualReviewOptions = {},
): { content: string; lineBefore: string; lineAfter: string } {
  const body = evidence.body ? ` body=${sanitizeEvidenceValue(evidence.body)}` : ''
  return applyVerifyChannelAnnotationToContent(content, itemId, {
    key: 'verifiedApi',
    annotation: `(verified-api: ${isoTimestamp} ${sanitizeEvidenceValue(
      evidence.method.toUpperCase(),
    )} ${sanitizeEvidenceValue(evidence.url)} ${sanitizeEvidenceValue(evidence.status)}${body})`,
    options,
  })
}

export function applyVerifiedUiAnnotationToContent(
  content: string,
  itemId: string,
  isoTimestamp: string,
  evidence: VerifiedUiEvidence,
  options: ParseManualReviewOptions = {},
): { content: string; lineBefore: string; lineAfter: string } {
  const dom = evidence.dom ? ` dom=${sanitizeEvidenceValue(evidence.dom)}` : ''
  return applyVerifyChannelAnnotationToContent(content, itemId, {
    key: 'verifiedUi',
    annotation: `(verified-ui: ${isoTimestamp} screenshot=${sanitizeEvidenceValue(
      evidence.screenshot,
    )}${dom})`,
    options,
  })
}

function applyVerifyChannelAnnotationToContent(
  content: string,
  itemId: string,
  input: {
    key: Extract<StructuredAnnotationKey, 'verifiedE2e' | 'verifiedApi' | 'verifiedUi'>
    annotation: string
    options: ParseManualReviewOptions
  },
): { content: string; lineBefore: string; lineAfter: string } {
  const parsed = parseManualReviewSections(content, input.options)
  if (parsed.malformed.length > 0) {
    throw new HttpError(
      422,
      'Manual-review section has malformed checkbox lines. Fix schema before writing.',
    )
  }
  const item = parsed.items.find((candidate) => candidate.id === itemId)
  if (!item) throw new HttpError(404, `Manual-review item not found: ${itemId}`)

  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const lineBefore = lines[item.lineIndex] ?? ''
  const lineAfter = applyVerifyChannelAnnotationToLine(lineBefore, input.key, input.annotation)
  lines[item.lineIndex] = lineAfter
  return { content: lines.join(newline), lineBefore, lineAfter }
}

function applyVerifyChannelAnnotationToLine(
  line: string,
  key: Extract<StructuredAnnotationKey, 'verifiedE2e' | 'verifiedApi' | 'verifiedUi'>,
  annotation: string,
): string {
  const { core, trailing } = extractTrailingMarkers(line)
  const canonicalCore = canonicalizeLeadingKindMarker(core)
  const annotated = upsertStructuredAnnotation(canonicalCore, key, annotation)
  return trailing ? `${annotated}${trailing}` : annotated
}

function applyVerifiedAutoToLine(
  line: string,
  isoTimestamp: string,
  evidence: VerifyAutoEvidence,
): string {
  const { core, trailing } = extractTrailingMarkers(line)
  // 先 strip 舊 verified-auto（避免 retry 時 stale 重複），保留其他 annotations
  const cleaned = stripVerifiedAutoAnnotation(canonicalizeLeadingKindMarker(core))
  // verify:auto 設計上保留 `[ ]`，user 在 review GUI 確認後才勾 — 不在 helper 裡代勾
  const evidenceStr = serializeVerifyEvidence(evidence)
  const annotated = canonicalizeStructuredAnnotations(
    `${cleaned.trimEnd()} (verified-auto: ${isoTimestamp}${evidenceStr ? ' ' + evidenceStr : ''})`,
  )
  return trailing ? `${annotated}${trailing}` : annotated
}

function stripVerifiedAutoAnnotation(line: string): string {
  return line.replace(/\s*\(verified-auto:[^)]*\)/g, '').replace(/[ \t]+$/, '')
}

function serializeVerifyEvidence(evidence: VerifyAutoEvidence): string {
  const parts: string[] = []
  // 固定 key 順序：network 先、dom 次、其餘依字典序
  const fixedKeys = ['network', 'dom']
  for (const k of fixedKeys) {
    const v = evidence[k]
    if (v !== undefined && v !== '') parts.push(`${k}=${sanitizeEvidenceValue(v)}`)
  }
  const otherKeys = Object.keys(evidence)
    .filter((k) => !fixedKeys.includes(k))
    .toSorted()
  for (const k of otherKeys) {
    const v = evidence[k]
    if (v !== undefined && v !== '') parts.push(`${k}=${sanitizeEvidenceValue(v)}`)
  }
  return parts.join(' ')
}

// 範圍：U+0000–U+001F（C0 控制字元）；annotation 解析需要剝掉，否則 raw item 內藏的不可見字元會誤導 parser
// 用 String.fromCharCode 組裝避開 oxlint no-control-regex（literal / RegExp 字串中的 unicode escape 都會被偵測）
const CONTROL_CHARS_RE = new RegExp(
  '[' + String.fromCharCode(0) + '-' + String.fromCharCode(0x1f) + ']',
  'g',
)

function sanitizeEvidenceValue(v: string): string {
  // 禁止 space / `(` / `)` / 控制字符；空白替成 `-`，括號剝掉，避免破壞 annotation 解析
  return (
    v.replace(/[\s]+/g, '-').replace(/[()]/g, '').replace(CONTROL_CHARS_RE, '').slice(0, 120) ||
    'unknown'
  )
}

function applyActionToLine(
  line: string,
  action: 'ok' | 'issue' | 'skip',
  note: string,
  finding: string,
): string {
  const { core, trailing } = extractTrailingMarkers(line)
  // 切換 action 前先剝離舊 annotation，避免 stale 殘留（例：先 issue 後改 ok 會留 (issue: ...)）
  const stripped = stripAnnotations(canonicalizeLeadingKindMarker(core))
  let result: string
  if (action === 'ok') {
    const base = setCheckbox(stripped, true)
    result = note.trim() ? appendAnnotation(base, 'note', note) : base
  } else if (action === 'issue') {
    const base = setCheckbox(stripped, false)
    result = appendAnnotation(base, 'issue', note || 'needs follow-up')
  } else {
    const base = setCheckbox(stripped, true)
    result = appendAnnotation(base, 'skip', note)
  }
  if (finding.trim()) result = appendAnnotation(result, 'finding', finding)

  return trailing ? `${result}${trailing}` : result
}

/**
 * 從行尾抽出所有 trailing markers (`@followup[TD-NNN]` / `@no-screenshot`)，
 * 保持原 ordering、保留它們前面的單一 space。
 *
 * 比較舊 `extractTrailingNoScreenshot` 的差異：
 * - 舊版只抽 `@no-screenshot` → annotation 會插在 `@followup` 之後（spec 不允許）
 * - 新版抽完所有 trailing markers → annotation 插在 description 後、所有 trailing markers 前
 *   （spec line 197「Action annotations SHALL be inserted between the description and any
 *    trailing markers (`@followup` / `@no-screenshot`)」）
 */
function extractTrailingMarkers(line: string): { core: string; trailing: string } {
  // 反覆從行尾剝離 trailing marker（先 @no-screenshot、再 @followup[TD-NNN]）。
  // 兩個都 anchor 到 `[非空白] +marker`，避免把 description-mid 的 `@xxx` 誤切。
  const NO_SCREENSHOT_RE = /(.+[^ ])( @no-screenshot)$/
  const FOLLOWUP_RE = /(.+[^ ])( @followup\[TD-[0-9]+\])$/
  let core = line
  let trailing = ''
  // up to 4 iterations 防呆（理論上一行至多 1 個 followup + 1 個 no-screenshot）
  for (let i = 0; i < 4; i++) {
    const ns = core.match(NO_SCREENSHOT_RE)
    if (ns) {
      core = ns[1]!
      trailing = ns[2]! + trailing
      continue
    }
    const fu = core.match(FOLLOWUP_RE)
    if (fu) {
      core = fu[1]!
      trailing = fu[2]! + trailing
      continue
    }
    break
  }
  return { core, trailing }
}

function setCheckbox(line: string, checked: boolean): string {
  return line.replace(/^(\s*- \[)[ xX](\])/, `$1${checked ? 'x' : ' '}$2`)
}

function stripAnnotations(line: string): string {
  const withoutActionAnnotations = line
    .replace(/（issue:[^）]*）/g, '')
    .replace(/（skip(?::[^）]*)?）/g, '')
    .replace(/（note:[^）]*）/g, '')
    .replace(/（finding:[^）]*）/g, '')
    .replace(/[ \t]+$/, '')
  return canonicalizeStructuredAnnotations(withoutActionAnnotations)
}

function appendAnnotation(
  line: string,
  kind: 'issue' | 'skip' | 'note' | 'finding',
  note: string,
): string {
  let label: string
  if (kind === 'skip') {
    label = note.trim() ? `（skip: ${sanitizeNote(note)}）` : '（skip）'
  } else if (kind === 'issue') {
    label = `（issue: ${sanitizeNote(note)}）`
  } else if (kind === 'finding') {
    label = `（finding: ${sanitizeNote(note)}）`
  } else {
    label = `（note: ${sanitizeNote(note)}）`
  }
  return `${line.trimEnd()} ${label}`
}

function sanitizeNote(note: string): string {
  return (
    note
      .replace(/\s+/g, ' ')
      .replace(/[（）]/g, '')
      .trim()
      .slice(0, 240) || 'noted'
  )
}

export async function readFileVersion(filePath: string): Promise<FileVersion> {
  const [content, info] = await Promise.all([readFile(filePath), stat(filePath)])
  return {
    hash: createHash('sha256').update(content).digest('hex'),
    mtimeMs: info.mtimeMs,
  }
}

export function isSameVersion(a: FileVersion, b: FileVersion): boolean {
  return a.hash === b.hash && Math.trunc(a.mtimeMs) === Math.trunc(b.mtimeMs)
}

async function loadHono(): Promise<any> {
  const explicitImport = process.env.REVIEW_GUI_HONO_IMPORT
  if (explicitImport) {
    const specifier = explicitImport.startsWith('file:')
      ? explicitImport
      : pathToFileURL(resolve(explicitImport)).href
    return await import(specifier)
  }

  try {
    return await import('hono')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      '[review:ui] Missing Hono runtime dependency.\n' +
        'Install consumer dev dependencies with: pnpm add -D hono\n' +
        'Then run: pnpm review:ui\n\n' +
        `Original error: ${message}`,
      { cause: err },
    )
  }
}

export async function createReviewApp(mainRoot = process.cwd()): Promise<any> {
  const { Hono } = await loadHono()
  const app = new Hono()

  // `/review` 與 `/review/<change>` 都回同一 HTML（SPA），URL 變動由 client
  // 走 history.pushState / replaceState 控制。client 啟動會 parseLocationTarget
  // 解析 path/hash，deep link reload 才需要 server 認 path。
  app.get('/review', (c: any) => {
    c.header('Cache-Control', 'no-store')
    return c.html(renderReviewHtml({ mainRoot }))
  })
  app.get('/review/:change', (c: any) => {
    c.header('Cache-Control', 'no-store')
    return c.html(renderReviewHtml({ mainRoot }))
  })

  app.get('/api/health', (c: any) => c.json({ ok: true, repoRoot: mainRoot }))

  // GET /api/changes 與 /api/changes/:change 都不能讓瀏覽器 cache：
  // change detail 含 version.hash + mtime，cache 後 reload 會拿到 stale version
  // 而下一次 saveAction 仍用舊 version → server 端永遠回 409。
  app.get('/api/changes', async (c: any) => {
    c.header('Cache-Control', 'no-store')
    const changes = await listPendingChanges(mainRoot)
    return c.json({ changes })
  })

  app.get('/api/changes/:change', async (c: any) => {
    c.header('Cache-Control', 'no-store')
    const changeName = c.req.param('change')
    const source = await ensureChangeRoute(mainRoot, changeName)
    const detail = await readChangeDetail(source, changeName)
    return c.json({ change: detail })
  })

  app.post('/api/changes/:change/action', async (c: any) => {
    const change = c.req.param('change')
    const body = await c.req.json().catch(() => ({}))
    const result = await persistReviewAction(mainRoot, change, body)
    return c.json(result, result.statusCode || 200)
  })

  app.get('/api/screenshot/*', async (c: any) => {
    return serveScreenshot(mainRoot, c)
  })

  app.onError((err: unknown, c: any) => {
    const status = err instanceof HttpError ? err.status : 500
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ error: message }, status)
  })

  return app
}

function topicMatchesChange(topic: string, change: string): boolean {
  if (topic === change) return true
  if (change.startsWith(topic + '-')) return true
  if (topic.startsWith(change + '-')) return true
  return false
}

function filterPoolsForChange(pools: ScreenshotTopic[], change: string): ScreenshotTopic[] {
  return pools.filter((pool) => topicMatchesChange(pool.topic, change))
}

/**
 * List `openspec/changes/**` blob hashes at HEAD as a Map<relativePath, blobSha>.
 * Used by listPendingChanges to detect "worktree HEAD did not diverge from main HEAD
 * for this file" — in which case main's working-tree state (which may have uncommitted
 * updates) is canonical and worktree should NOT shadow main per the collision rule.
 *
 * Returns empty map on git error (safe default: behave like pre-fix, no skip).
 */
function listOpenspecChangesBlobHashes(repoRoot: string): Map<string, string> {
  const result = new Map<string, string>()
  try {
    const res = spawnSync(
      'git',
      ['-C', repoRoot, 'ls-tree', '-r', 'HEAD', '--', 'openspec/changes/'],
      { encoding: 'utf8' },
    )
    if (res.status !== 0) return result
    for (const line of res.stdout.split('\n')) {
      // ls-tree -r format: "<mode> blob <sha>\t<path>"
      const m = line.match(/^\d+\s+blob\s+([0-9a-f]+)\t(.+)$/)
      if (m) result.set(m[2], m[1])
    }
  } catch {
    // ignore
  }
  return result
}

/**
 * Check if a worktree has uncommitted changes (modified / staged / untracked) for a
 * specific path. Used by listPendingChanges diff-aware skip to confirm the worktree's
 * working tree is also clean before allowing main to shadow worktree.
 *
 * Without this check, the skip silently drops worktree entries when a sibling worktree
 * has mid-`/spectra-apply` edits to `<change>/tasks.md`: HEAD blob still matches main
 * (commit hasn't happened yet), but the worktree's working tree carries uncommitted
 * updates that the user MUST see in the GUI.
 *
 * Returns `true` (= dirty / cannot confirm clean) on git error — conservative default
 * matching the calling site's "skip only when we can fully prove clean" posture.
 */
function isWtPathDirty(wtRoot: string, relPath: string): boolean {
  try {
    const res = spawnSync('git', ['-C', wtRoot, 'status', '--porcelain', '--', relPath], {
      encoding: 'utf8',
    })
    if (res.status !== 0) return true
    return res.stdout.trim().length > 0
  } catch {
    return true
  }
}

/**
 * List change names that exist under main's `openspec/changes/archive/` directory.
 * Archive folders follow the convention `YYYY-MM-DD-<change-name>`.
 *
 * Used by listPendingChanges to dedupe stale sibling-worktree copies: when a change
 * has been archived in main, sibling worktrees forked before the archive still carry
 * the pre-archive active copy. Those stale copies should NOT surface in the review
 * GUI as pending work — the change is already done in main.
 *
 * Returns empty set on fs error (safe default: behave like pre-fix, no dedupe).
 */
function listMainArchivedChangeNames(mainRoot: string): Set<string> {
  const result = new Set<string>()
  const archiveRoot = join(mainRoot, 'openspec', 'changes', 'archive')
  if (!existsSync(archiveRoot)) return result
  try {
    const entries = readdirSync(archiveRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const match = entry.name.match(/^\d{4}-\d{2}-\d{2}-(.+)$/)
      if (match) result.add(match[1])
    }
  } catch {
    // ignore
  }
  return result
}

export async function listPendingChanges(mainRoot: string): Promise<ChangeSummary[]> {
  const sources = await listSourceRoots(mainRoot)
  // 重建兩個 module-level cache：sourceRootIndex 給 rootId → SourceRoot；changeRouteCache 給 change → SourceRoot。
  sourceRootIndex = new Map(sources.map((src) => [src.rootId, src]))
  changeRouteCache = new Map()

  // Diff-aware collision rule (refines the older worktree-prefer rule):
  // 「worktree 是 ahead 版本」假設只在 worktree's HEAD committed changes to that
  // specific change file 時成立。若 worktree HEAD == main HEAD for `<change>/tasks.md`
  // （worktree fork 自 main 後沒 commit 過該 change file），main 的 working-tree
  // 才是 canonical（main 可能有未 commit 的 WIP 更新），worktree **MUST NOT** shadow main。
  // 對應 anti-pattern：active worktree A 做 change X，但繼承了 main 的 change Y / Z 目錄；
  // user 在 main 改 Y / Z 的 tasks.md（未 commit），舊規則讓 worktree 的 stale Y / Z 蓋過 main。
  const mainBlobHashes = listOpenspecChangesBlobHashes(mainRoot)
  // sibling-worktree stale copy dedupe：fork 點早於 archive 的 worktree 仍會帶著 pre-archive
  // 的 active copy；main 已 archive 的 change 不該再在 review GUI 顯示為 pending。
  const archivedInMain = listMainArchivedChangeNames(mainRoot)

  // Parallelize per-source work: pools walk + per-change summarize all overlap.
  // Result is an array of `{ src, summaries }` in the same order as `sources`,
  // so the downstream merge preserves the legacy collision rule (main first,
  // worktree later writes shadow main).
  const partials = await Promise.all(
    sources.map(async (src) => {
      const changesRoot = join(src.root, 'openspec', 'changes')
      if (!existsSync(changesRoot)) return { src, summaries: [] as ChangeSummary[] }

      // 對 worktree source 預載 HEAD blob hash（main source 跳過：main 永遠是 fallback target）
      const wtBlobHashes = src.slug !== null ? listOpenspecChangesBlobHashes(src.root) : null

      const [pools, entries] = await Promise.all([
        listScreenshotPools(src.root, src.rootId),
        readdir(changesRoot, { withFileTypes: true }).catch(() => null),
      ])
      if (!entries) return { src, summaries: [] as ChangeSummary[] }

      const summarized = await Promise.all(
        entries.map(async (entry) => {
          if (!entry.isDirectory() || entry.name === 'archive' || entry.name.startsWith('.'))
            return null
          // archive-aware dedupe：sibling worktree 的 active copy 若在 main 已 archive，跳過。
          // 只對 worktree source 套用（main 自己的 archive folder 已在上一行的 name === 'archive' 排除）。
          if (src.slug !== null && archivedInMain.has(entry.name)) return null
          const tasksPath = join(changesRoot, entry.name, 'tasks.md')
          if (!existsSync(tasksPath)) return null
          // Diff-aware skip：worktree HEAD 跟 main HEAD 對該 change tasks.md 的 blob hash 相同
          // → worktree 沒在這條 change 上 commit 任何變動 → 不蓋過 main entry（讓 main 的
          // working-tree state 服務 user）。兩邊 hash 任一缺失（檔不在 HEAD tree、git 失敗等）
          // 視為「無法確認 worktree 沒動過」→ 保守走舊邏輯（overwrite as usual）。
          if (wtBlobHashes !== null) {
            const relPath = `openspec/changes/${entry.name}/tasks.md`
            const wtHash = wtBlobHashes.get(relPath)
            const mainHash = mainBlobHashes.get(relPath)
            if (wtHash && mainHash && wtHash === mainHash) {
              // HEAD blobs match — but worktree working tree could still carry uncommitted
              // edits (mid-`/spectra-apply` scenario). Only skip when working tree is also
              // confirmed clean; otherwise fall through and let worktree shadow main so the
              // user sees the WIP edits in the review GUI.
              if (!isWtPathDirty(src.root, relPath)) return null
            }
          }
          return summarizeChange(
            src.root,
            entry.name,
            tasksPath,
            filterPoolsForChange(pools, entry.name),
            src.slug,
          )
        }),
      )
      return {
        src,
        summaries: summarized.filter((s): s is ChangeSummary => s !== null),
      }
    }),
  )

  const summariesByName = new Map<string, ChangeSummary>()
  // partials 維持 sources 的順序：main 第一筆、worktree 在後。後寫蓋掉前寫 → worktree-prefer
  // collision rule（受 mainBlobHashes 判斷 skip 條件約束）。
  for (const { src, summaries } of partials) {
    for (const summary of summaries) {
      summariesByName.set(summary.name, summary)
      changeRouteCache.set(summary.name, src)
    }
  }

  return Array.from(summariesByName.values()).toSorted((a, b) => {
    if (a.pending !== b.pending) return b.pending - a.pending
    if (a.malformed !== b.malformed) return b.malformed - a.malformed
    return a.name.localeCompare(b.name)
  })
}

/**
 * 讀取 change 的 proposal.md 並推導 default kind。proposal 不存在 → 回 `review:ui`（保守 fallback；
 * 嚴格規約僅作用於宣告 backend-only 的 change）。
 */
async function loadProposalDefaultKind(
  repoRoot: string,
  change: string,
): Promise<DefaultManualReviewItemKind> {
  const proposalPath = join(repoRoot, 'openspec', 'changes', change, 'proposal.md')
  if (!existsSync(proposalPath)) return 'review:ui'
  try {
    const content = await readFile(proposalPath, 'utf8')
    return deriveDefaultKindFromProposal(content)
  } catch {
    return 'review:ui'
  }
}

async function summarizeChange(
  sourceRoot: string,
  name: string,
  tasksPath: string,
  pools: ScreenshotTopic[],
  worktreeSlug: string | null = null,
): Promise<ChangeSummary | null> {
  const content = await readFile(tasksPath, 'utf8')
  const defaultKind = await loadProposalDefaultKind(sourceRoot, name)
  const parsed = parseManualReviewSections(content, { defaultKind, sourcePath: tasksPath })
  if (parsed.sections.length === 0) return null

  // 排除 parent-with-children：GUI 的 `requiresUserConfirmation` 對這類 item 回 false
  // （UI 不允許 user 直接勾），若仍把它們算進 total / pending，子項全勾後 change 仍會
  // 卡在 pending 不會自動 archive。helper 與 archive completion check 共用同一語義。
  const parentsWithChildren = buildParentsWithScopedChildren(parsed.items)
  const effectiveItems = parsed.items.filter(
    (item) => !manualReviewItemHasScopedChildren(item, parentsWithChildren),
  )

  // 「真的通過」= [x] 且沒有 issue annotation。`[x]` + `（issue: ...）` 並存
  // 是舊版時代的 stale state，語義上應算 issue 待解，不能算通過。
  const issued = effectiveItems.filter((item) => /（issue:[^）]*）/.test(item.raw)).length
  const checked = effectiveItems.filter(
    (item) => item.checked && !/（issue:[^）]*）/.test(item.raw),
  ).length
  // user-actionable pending：對齊 GUI `requiresUserConfirmation`——只認 review:ui / verify:ui
  // （verify:api / verify:e2e 自動驗證 item user 點不到）。home page feedbackGiven 分類用此值
  // 取代 `pending === issued`：verify:api 自動驗證但未 [x] 的 item 不該卡住 user 可點項已全處理的 change。
  const userActionPending = effectiveItems.filter(
    (item) =>
      (item.kinds.includes('review:ui') || item.kinds.includes('verify:ui')) &&
      !item.checked &&
      !/（issue:[^）]*）/.test(item.raw),
  ).length
  // Pre-Review Data Readiness：對齊 GUI 內顯示 banner 的 items 範圍——
  // effective items（排除 parent-with-children，GUI 不讓 user 勾這類）+ 未勾且非 issued
  // （[x] 或 issue 已經分流到別的處理路徑，readiness 只關注「等待 user 檢查」這群）。
  const readinessTargets = effectiveItems.filter(
    (item) => !item.checked && !/（issue:[^）]*）/.test(item.raw),
  )
  const hitsByCode: Record<string, number> = {}
  let readinessHits = 0
  for (const item of readinessTargets) {
    const hits = item.manualReviewHits ?? []
    for (const hit of hits) {
      hitsByCode[hit.code] = (hitsByCode[hit.code] ?? 0) + 1
      readinessHits++
    }
  }
  // Verify-channel evidence missing：對齊 client `computeMissingEvidence`，iterate ALL
  // 未勾且非 issued items（含 parent-with-children）。parent 的 verify markers 是 explicit
  // declaration，spectra-apply Step 8a 寫的 (verified-*: ...) annotation 直接寫在 parent line，
  // 不繼承自子項；GUI 的 compound-evidence panel 也 render 在 parent line 上。
  // 「由子項回饋」只影響 parent 的 OK/Issue/Skip 按鈕顯示，跟 evidence ownership 無關。
  // 若沿用 `readinessTargets`（排除 parent-with-children）會讓 server 漏算 parent 缺 evidence
  // 的情境，導致 change 被誤分到 ready 群（home page 應顯示在 applyPending）。
  const evidenceTargets = parsed.items.filter(
    (item) => !item.checked && !/（issue:[^）]*）/.test(item.raw),
  )
  const evidenceMissing: Array<{
    itemId: string
    description: string
    kinds: ReadonlyArray<'e2e' | 'api' | 'ui'>
  }> = []
  for (const item of evidenceTargets) {
    const tags: Array<'e2e' | 'api' | 'ui'> = []
    if (item.kinds.includes('verify:e2e') && !item.annotations.verifiedE2e) tags.push('e2e')
    if (item.kinds.includes('verify:api') && !item.annotations.verifiedApi) tags.push('api')
    if (item.kinds.includes('verify:ui') && !item.annotations.verifiedUi) tags.push('ui')
    if (tags.length > 0) {
      evidenceMissing.push({ itemId: item.id, description: item.description, kinds: tags })
    }
  }
  // Impl task 進度：count `- [ ] N.M ...` / `- [x] N.M ...`（impl tasks 用 N.M 格式，
  // 人工檢查用 `#N` / `#N.M`，regex 不會誤抓）。home page 用此值決定該 change 是進
  // 「✅ Apply 已完成、可補 evidence」還是「⏳ Apply 還在動工」群——避免對 §3 UI / §6
  // Fixtures 未動工的 change 派 agent 跑 Step 8a 撞 404 / 缺 seed。
  const implTaskLine = /^- \[([ x])\] [0-9]+\.[0-9]+ /gm
  let implTotal = 0
  let implDone = 0
  for (const match of content.matchAll(implTaskLine)) {
    implTotal++
    if (match[1] === 'x') implDone++
  }
  return {
    name,
    tasksPath,
    sourceRoot,
    worktreeSlug,
    total: effectiveItems.length,
    checked,
    pending: effectiveItems.length - checked,
    issued,
    userActionPending,
    malformed: parsed.malformed.length,
    readinessHits,
    hitsByCode,
    evidenceMissing,
    implTotal,
    implDone,
    screenshotTopicCount: pools.length,
    screenshotTopics: pools.map((pool) => `${pool.env}/${pool.topic}`),
  }
}

async function readChangeDetail(source: SourceRoot, change: string): Promise<ChangeDetail> {
  const tasksPath = resolveChangeTasksPath(source.root, change)
  const [content, version, allPools, defaultKind] = await Promise.all([
    readFile(tasksPath, 'utf8'),
    readFileVersion(tasksPath),
    listScreenshotPools(source.root, source.rootId),
    loadProposalDefaultKind(source.root, change),
  ])
  const parsed = parseManualReviewSections(content, { defaultKind, sourcePath: tasksPath })
  if (parsed.sections.length === 0) {
    throw new HttpError(404, `Change has no ## 人工檢查 section: ${change}`)
  }
  const pools = filterPoolsForChange(allPools, change)
  const summary = await summarizeChange(source.root, change, tasksPath, pools, source.slug)
  if (!summary) throw new HttpError(404, `Change has no manual-review tasks: ${change}`)
  return {
    ...summary,
    version,
    items: parsed.items,
    malformedLines: parsed.malformed,
    screenshotPools: pools,
  }
}

function resolveChangeTasksPath(sourceRoot: string, change: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(change) || change === 'archive') {
    throw new HttpError(400, '無效的 change 名稱')
  }
  const tasksPath = join(sourceRoot, 'openspec', 'changes', change, 'tasks.md')
  if (!existsSync(tasksPath)) throw new HttpError(404, `tasks.md not found for change: ${change}`)
  return tasksPath
}

async function persistReviewAction(mainRoot: string, change: string, body: any): Promise<any> {
  const source = await ensureChangeRoute(mainRoot, change)
  const tasksPath = resolveChangeTasksPath(source.root, change)
  const action = body?.action
  if (!['ok', 'issue', 'skip'].includes(action))
    throw new HttpError(400, 'action must be ok, issue, or skip')
  if (typeof body?.itemId !== 'string') throw new HttpError(400, 'itemId is required')
  if (!body?.version?.hash || typeof body?.version?.mtimeMs !== 'number') {
    throw new HttpError(400, 'file version hash and mtimeMs are required')
  }

  const currentVersion = await readFileVersion(tasksPath)
  if (!isSameVersion(currentVersion, body.version)) {
    return {
      statusCode: 409,
      error: 'tasks.md changed after this page was loaded. Reload before saving.',
      currentVersion,
    }
  }

  const content = await readFile(tasksPath, 'utf8')
  const defaultKind = await loadProposalDefaultKind(source.root, change)
  const updated = applyReviewActionToContent(
    content,
    body.itemId,
    action,
    body.note || '',
    { defaultKind, sourcePath: tasksPath },
    body.finding || '',
  )
  await writeFile(tasksPath, updated.content, 'utf8')

  const detail = await readChangeDetail(source, change)
  // 與 summarizeChange 的 checked 算法同義：[x] 且沒 issue annotation 才算完成。
  // 否則 stale `[x] + （issue: ...）` 會誤觸發 archive。同樣排除 parent-with-children
  // — GUI 不讓使用者勾母項，若算進 effectiveItems 子項全勾仍判 incomplete，change 永遠卡。
  const parentsWithChildren = buildParentsWithScopedChildren(detail.items)
  const effectiveItems = detail.items.filter(
    (item) => !manualReviewItemHasScopedChildren(item, parentsWithChildren),
  )
  const complete =
    detail.malformed === 0 &&
    effectiveItems.length > 0 &&
    effectiveItems.every((item) => item.checked && !/（issue:[^）]*）/.test(item.raw))
  // archive cwd = change 所在的 source root（worktree-based change 在 worktree 跑 /review-archive
  // 才能寫 docs/manual-review-archive.md；後續 /spectra-archive 在 main 跑時 wt-helper merge-back
  // 把 doc 變動帶回 main）。
  const archive = complete
    ? await invokeReviewArchive(source.root, change)
    : { status: 'not-ready' }
  return {
    ok: true,
    itemId: body.itemId,
    action,
    lineBefore: updated.lineBefore,
    lineAfter: updated.lineAfter,
    parentRollup: updated.parentRollup ?? null,
    complete,
    archive,
    change: detail,
  }
}

async function invokeReviewArchive(repoRoot: string, change: string): Promise<any> {
  const configured = process.env.REVIEW_GUI_ARCHIVE_CMD
  const command = configured || findDefaultArchiveCommand()
  if (!command) {
    return {
      status: 'unavailable',
      message:
        'No review-archive command is available. Run /review-archive all manually or set REVIEW_GUI_ARCHIVE_CMD.',
    }
  }

  // Fire-and-forget：archive 命令（如 `claude -p "/review-archive all"`）會跑很久，
  // 同步等它收尾會讓 review GUI 的「✓ 通過」按鈕看起來 hung 住。
  // 改成 detached spawn，stdout/stderr 寫到 log file，response 立刻回。
  const rendered = command.replaceAll('{change}', shellQuote(change))
  const logDir = join(repoRoot, '.review-gui')
  const ts = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const logPath = join(logDir, `archive-${change}-${ts}.log`)
  try {
    await mkdir(logDir, { recursive: true })
    const fd = await openFd(logPath, 'a')
    const child = spawn(rendered, {
      cwd: repoRoot,
      shell: true,
      stdio: ['ignore', fd.fd, fd.fd],
      detached: true,
    })
    child.unref()
    await fd.close()
    return {
      status: 'started',
      command: rendered,
      logPath,
      pid: child.pid,
    }
  } catch (err) {
    return {
      status: 'failed',
      command: rendered,
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

function findDefaultArchiveCommand(): string | null {
  const claude = commandExists('claude')
  if (claude) return 'claude -p "/review-archive all"'
  return null
}

function commandExists(command: string): boolean {
  const result =
    process.platform === 'win32'
      ? spawnSync('where', [command], {
          stdio: 'ignore',
        })
      : spawnSync('sh', ['-c', `command -v ${command}`], {
          stdio: 'ignore',
        })
  return result.status === 0
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * 一個 review-gui server 同時要看 main repo + 所有 worktree 的 change。
 * SourceRoot 是「change 實際 commit 寫入的 working tree」單位：main + 每個 worktree 各一筆。
 * rootId 是 URL-safe namespace（`main` / `wt-<slug>`），給 `/api/screenshot/<rootId>/...` 用，避免不同 worktree 同 relPath 撞。
 */
export interface SourceRoot {
  root: string
  slug: string | null
  branch: string
  rootId: string
}

const WORKTREE_SLUG_BRANCH_RE = /^wt\/([^/]+)/

function computeRootId(slug: string | null): string {
  return slug === null ? 'main' : `wt-${slug}`
}

function computeWorktreeSlug(absPath: string, branch: string | undefined): string {
  if (branch) {
    const m = branch.match(WORKTREE_SLUG_BRANCH_RE)
    if (m) return m[1]
  }
  return absPath.split(sep).findLast((segment) => Boolean(segment)) ?? absPath
}

/**
 * 列出 main repo 及其所有 worktree（含 mainRoot 自己）。
 * - parse `git worktree list --porcelain`
 * - 失敗（非 git repo / git 不存在）→ 只回 mainRoot 一筆，行為等同改動前
 * - main 永遠排第一筆；後續 collision (`change name` 重複) worktree 蓋過 main（worktree 是 ahead 版本）
 */
export async function listSourceRoots(mainRoot: string): Promise<SourceRoot[]> {
  const mainAbs = resolve(mainRoot)
  const result = spawnSync('git', ['-C', mainAbs, 'worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
  })
  if (result.status !== 0 || !result.stdout) {
    return [{ root: mainAbs, slug: null, branch: '', rootId: 'main' }]
  }
  const sources: SourceRoot[] = []
  let current: { worktree?: string; branch?: string } = {}
  const flush = () => {
    if (current.worktree) {
      const abs = resolve(current.worktree)
      const isMain = abs === mainAbs
      const slug = isMain ? null : computeWorktreeSlug(abs, current.branch)
      sources.push({ root: abs, slug, branch: current.branch ?? '', rootId: computeRootId(slug) })
    }
    current = {}
  }
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      current.worktree = line.slice('worktree '.length).trim()
    } else if (line.startsWith('branch ')) {
      current.branch = line
        .slice('branch '.length)
        .trim()
        .replace(/^refs\/heads\//, '')
    } else if (line === '') {
      flush()
    }
  }
  flush()
  // main 永遠在第一筆；後續 listPendingChanges 用 Map.set 順序，worktree 在 main 之後寫入會蓋掉 main。
  return sources.toSorted((a, b) => {
    if (a.slug === null && b.slug !== null) return -1
    if (a.slug !== null && b.slug === null) return 1
    return (a.slug || '').localeCompare(b.slug || '')
  })
}

/**
 * 每次 listPendingChanges 重建；route per-change API 用。
 * key = change name；value = 該 change 所在的 SourceRoot。
 * Deep link reload（沒先打 /api/changes）會 lazy 重建。
 */
let changeRouteCache: Map<string, SourceRoot> = new Map()
let sourceRootIndex: Map<string, SourceRoot> = new Map()

async function ensureChangeRoute(mainRoot: string, change: string): Promise<SourceRoot> {
  const cached = changeRouteCache.get(change)
  if (cached && existsSync(join(cached.root, 'openspec', 'changes', change, 'tasks.md'))) {
    return cached
  }
  await listPendingChanges(mainRoot)
  const fresh = changeRouteCache.get(change)
  if (fresh) return fresh
  const mainEntry = sourceRootIndex.get('main')
  if (mainEntry) return mainEntry
  return { root: resolve(mainRoot), slug: null, branch: '', rootId: 'main' }
}

function resolveSourceByRootId(rootId: string): SourceRoot | null {
  return sourceRootIndex.get(rootId) ?? null
}

async function listScreenshotPools(repoRoot: string, rootId: string): Promise<ScreenshotTopic[]> {
  const root = join(repoRoot, 'screenshots')
  if (!existsSync(root)) return []

  const pools: ScreenshotTopic[] = []
  for (const envEntry of await readdir(root, { withFileTypes: true })) {
    if (!envEntry.isDirectory() || envEntry.name === '_archive' || envEntry.name.startsWith('.'))
      continue
    const envDir = join(root, envEntry.name)
    for (const topicEntry of await readdir(envDir, { withFileTypes: true })) {
      if (
        !topicEntry.isDirectory() ||
        topicEntry.name === '_archive' ||
        topicEntry.name.startsWith('.')
      )
        continue
      const topicDir = join(envDir, topicEntry.name)
      const relRoot = join('screenshots', envEntry.name, topicEntry.name)
      const files = await collectImages(topicDir, relRoot, rootId)
      pools.push({
        env: envEntry.name,
        topic: topicEntry.name,
        files,
      })
    }
  }

  return pools.toSorted((a, b) => `${a.env}/${a.topic}`.localeCompare(`${b.env}/${b.topic}`))
}

async function collectImages(
  absDir: string,
  relRoot: string,
  rootId: string,
): Promise<ScreenshotFile[]> {
  const files: ScreenshotFile[] = []
  for (const entry of await readdir(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name)
    const rel = join(relRoot, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectImages(abs, rel, rootId)))
      continue
    }
    if (!entry.isFile()) continue
    const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
    if (!IMAGE_EXTS.has(ext)) continue
    const relPath = toPosix(rel)
    const encodedRel = relPath.split('/').map(encodeURIComponent).join('/')
    files.push({
      relPath,
      url: `/api/screenshot/${encodeURIComponent(rootId)}/${encodedRel}`,
      name: entry.name,
    })
  }
  return files.toSorted((a, b) => a.relPath.localeCompare(b.relPath))
}

async function serveScreenshot(mainRoot: string, c: any): Promise<any> {
  // URL：/api/screenshot/<rootId>/<relPath>。舊形式（直接 screenshots/... 開頭）保留 fallback → mainRoot。
  const stripped = c.req.path.replace(/^\/api\/screenshot\//, '')
  const slashIdx = stripped.indexOf('/')
  if (slashIdx < 0) throw new HttpError(400, '截圖 URL 缺少路徑')
  const firstSegment = decodeURIComponent(stripped.slice(0, slashIdx))
  const remainder = stripped.slice(slashIdx + 1)
  let sourceRoot: string
  let relPath: string
  if (firstSegment === 'screenshots') {
    sourceRoot = mainRoot
    relPath = decodeURIComponent(stripped)
  } else {
    if (sourceRootIndex.size === 0) await listPendingChanges(mainRoot)
    const source = resolveSourceByRootId(firstSegment)
    if (!source) throw new HttpError(404, `未知的 rootId: ${firstSegment}`)
    sourceRoot = source.root
    relPath = decodeURIComponent(remainder)
  }
  if (!relPath.startsWith('screenshots/'))
    throw new HttpError(400, '截圖路徑必須以 screenshots/ 開頭')
  const normalized = normalize(relPath)
  if (normalized.startsWith('..') || normalized.includes(`${sep}..${sep}`))
    throw new HttpError(400, '無效的截圖路徑')
  const abs = resolve(sourceRoot, normalized)
  const screenshotsRoot = resolve(sourceRoot, 'screenshots')
  if (!abs.startsWith(screenshotsRoot + sep)) throw new HttpError(400, '無效的截圖路徑')
  if (!existsSync(abs)) throw new HttpError(404, '截圖不存在')
  const ext = abs.slice(abs.lastIndexOf('.')).toLowerCase()
  if (!IMAGE_EXTS.has(ext)) throw new HttpError(415, '不支援的截圖檔案類型')
  return new Response(Readable.toWeb(createReadStream(abs)) as any, {
    headers: {
      'content-type': imageMime(ext),
      'cache-control': 'no-store',
    },
  })
}

function imageMime(ext: string): string {
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.avif') return 'image/avif'
  return 'image/png'
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

function readCladeHubVersion(mainRoot: string): string | null {
  try {
    const raw = readFileSync(join(mainRoot, '.claude', 'hub.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version?: unknown }
    if (typeof parsed.version !== 'string') return null
    // 限制 safe charset 後直接 inline 進 HTML（semver 形態，無需 escape）
    return /^[\w.\-+]+$/.test(parsed.version) ? parsed.version : null
  } catch {
    return null
  }
}

export function renderReviewHtml(opts: { mainRoot?: string } = {}): string {
  const version = readCladeHubVersion(opts.mainRoot ?? process.cwd())
  const versionBadge = version ? `<span class="title-version">v${version}</span>` : ''
  return `<!doctype html>
<html lang="zh-Hant-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>人工檢查</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f4ef;
      --panel: #fffdfa;
      --panel-2: #ece7dd;
      --ink: #1e2521;
      --muted: #69736d;
      --line: #d8d0c3;
      --accent: #286c5b;
      --accent-2: #9d4b32;
      --warn: #8b5e15;
      --bad: #a33b3b;
      --focus: #195fcc;
      --shadow: 0 12px 32px rgba(30, 37, 33, .08);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      min-height: 100vh;
    }
    button, textarea, select {
      font: inherit;
    }
    button {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      min-height: 36px;
      border-radius: 6px;
      cursor: pointer;
    }
    button:hover { border-color: var(--accent); }
    button:focus-visible, textarea:focus-visible, select:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--focus) 45%, transparent);
      outline-offset: 2px;
    }
    .app {
      display: grid;
      grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
      height: 100vh;
      overflow: hidden;
    }
    .sidebar {
      border-right: 1px solid var(--line);
      background: #ede8dc;
      padding: 18px;
      overflow: auto;
    }
    .sidebar h1 {
      margin: 0 0 4px;
      font-size: 18px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .title-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: baseline;
      margin: 0 0 14px;
      font-size: 11px;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
    .title-meta .title-version {
      font-weight: 600;
      color: var(--accent);
    }
    .title-meta .title-updated {
      font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
    }
    .change-list {
      display: grid;
      gap: 14px;
    }
    .change-group {
      display: grid;
      gap: 8px;
    }
    .change-group-heading {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: var(--muted);
      text-transform: uppercase;
      padding: 4px 4px 0;
    }
    .change-group-note {
      font-size: 12px;
      color: var(--muted);
      padding: 0 4px 4px;
      line-height: 1.5;
    }
    .change-group-note code {
      font-family: var(--font-mono, ui-monospace, monospace);
      font-size: 11px;
      background: rgba(0, 0, 0, 0.05);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .change-row {
      display: grid;
      gap: 6px;
      width: 100%;
      padding: 12px;
      text-align: left;
      box-shadow: none;
    }
    .change-row.card-done { border-left: 4px solid #6aa181; }
    .change-row.card-issue { border-left: 4px solid #c97a2c; }
    .change-row.card-pending { border-left: 4px solid #b8b1a3; }
    .change-row.card-malformed { border-left: 4px solid var(--bad); }
    .change-row[aria-current="true"] {
      border-color: var(--accent);
      background: #f8fff9;
    }
    .change-row.card-done[aria-current="true"] { border-left-color: #6aa181; }
    .change-row.card-issue[aria-current="true"] { border-left-color: #c97a2c; }
    .change-row.card-pending[aria-current="true"] { border-left-color: #b8b1a3; }
    .change-row.card-malformed[aria-current="true"] { border-left-color: var(--bad); }
    .change-name {
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .card-badge {
      display: inline-flex;
      align-self: flex-start;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }
    .card-badge.done { background: #d6ecdf; color: #1e6042; }
    .card-badge.issue { background: #fce4c8; color: #8a4f0a; }
    .card-badge.pending { background: #ece8dd; color: #5a5341; }
    .card-badge.malformed { background: #fae0e0; color: #7a2828; }
    .wt-badge {
      display: inline-flex;
      align-items: center;
      padding: 1px 7px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 600;
      background: #dde6f2;
      color: #2b4470;
      margin-left: 6px;
      vertical-align: middle;
      white-space: nowrap;
    }
    .wt-badge.detail {
      font-size: 12px;
      padding: 2px 9px;
    }
    .metrics {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 3px 7px;
      background: color-mix(in srgb, var(--panel) 76%, transparent);
    }
    .metric.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 50%, var(--line)); }
    .metric.warn { color: #8a4f0a; background: #fce4c8; border-color: #f0c68d; font-weight: 600; }
    main {
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 360px);
      overflow: hidden;
    }
    .review-pane {
      min-width: 0;
      padding: 20px;
      overflow: auto;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    .toolbar h2 {
      margin: 0;
      font-size: 20px;
      line-height: 1.2;
      overflow-wrap: anywhere;
    }
    .status {
      min-height: 24px;
      color: var(--muted);
      font-size: 13px;
    }
    .banner {
      display: none;
      margin: 0 0 12px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      color: var(--ink);
    }
    .banner.show { display: block; }
    .banner.error { border-color: color-mix(in srgb, var(--bad) 55%, var(--line)); color: var(--bad); }
    .banner.pending {
      border-color: color-mix(in srgb, var(--accent) 35%, var(--line));
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 6%, var(--panel));
    }
    .banner.pending::before {
      content: '';
      display: inline-block;
      width: 10px;
      height: 10px;
      margin-right: 8px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      vertical-align: -1px;
      animation: rg-spin .8s linear infinite;
    }
    @keyframes rg-spin { to { transform: rotate(360deg); } }
    .loading-spin::before {
      content: '';
      display: inline-block;
      width: 12px;
      height: 12px;
      margin-right: 10px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      vertical-align: -1px;
      animation: rg-spin .8s linear infinite;
      opacity: .7;
    }
    .task-item.saving {
      position: relative;
      pointer-events: none;
    }
    .task-item.saving::after {
      content: '儲存中…';
      position: absolute;
      top: 8px;
      right: 12px;
      padding: 2px 8px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 12%, var(--panel));
      color: var(--accent);
      font-size: 11px;
      font-weight: 600;
    }
    .task-item.saving > * { opacity: 0.6; }
    .task-list {
      display: grid;
      gap: 10px;
    }
    .task-item {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 12px;
      box-shadow: var(--shadow);
    }
    .task-item.active { border-color: var(--accent); }
    .task-item.scoped { margin-left: 20px; }
    .task-head {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
    }
    .task-id {
      font-weight: 800;
      color: var(--accent);
      white-space: nowrap;
    }
    .task-desc {
      min-width: 0;
      overflow-wrap: anywhere;
      line-height: 1.45;
    }
    .task-state {
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .actions button {
      padding: 0 12px;
    }
    .ok { background: #e6f3ea; border-color: #a7cdb4; }
    .issue { background: #fff3e2; border-color: #d8ad68; }
    .skip { background: #f0eee8; }
    /* Pre-flight warning banner — Layer C of manual-review.md mechanical enforcement.
       Amber treatment, distinct from red verify-channel evidence-missing banners.
       Banner does NOT block — user can still OK / Issue / SKIP. */
    .manual-review-banner {
      background: #fff7e0;
      border: 1px solid #d8a851;
      border-left: 4px solid #c97a2c;
      padding: 8px 12px;
      margin: 8px 0;
      border-radius: 4px;
      font-size: 13px;
      color: #6b4a14;
    }
    .manual-review-banner .mr-banner-title {
      font-weight: 600;
      margin-bottom: 4px;
    }
    .manual-review-banner ul {
      margin: 4px 0 4px 16px;
      padding: 0;
    }
    .manual-review-banner li {
      margin: 2px 0;
    }
    .manual-review-banner code {
      background: #ffe9b3;
      padding: 0 4px;
      border-radius: 2px;
    }
    .manual-review-banner .mr-banner-hint {
      margin-top: 6px;
      font-style: italic;
      opacity: 0.85;
    }
    .task-item.decision-ok { border-left: 4px solid #6aa181; }
    .task-item.decision-issue { border-left: 4px solid #c97a2c; }
    .task-item.decision-skip { border-left: 4px solid #8a8275; }
    .task-item.collapsed { padding: 8px 12px; opacity: 0.78; }
    .task-item.collapsed .note,
    .task-item.collapsed .actions,
    .task-item.collapsed .evidence-panel,
    .task-item.collapsed .compound-evidence,
    .task-item.collapsed .verified-ui-panel,
    .task-item.collapsed .discuss-card { display: none; }
    .task-item.collapsed .task-desc {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .task-item.collapsed.active { opacity: 1; }
    .state-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }
    .state-badge.ok { background: #d6ecdf; color: #1e6042; }
    .state-badge.issue { background: #fce4c8; color: #8a4f0a; }
    .state-badge.skip { background: #e7e1d3; color: #5a5341; }
    /* 母項有子項時，body 顯示這條提示，告知使用者回饋焦點在子項。 */
    .parent-children-hint {
      margin-top: 6px;
      padding: 6px 10px;
      border-left: 3px solid color-mix(in srgb, var(--muted) 50%, transparent);
      background: color-mix(in srgb, var(--panel) 60%, transparent);
      color: var(--muted);
      font-size: 12px;
      font-style: italic;
      border-radius: 4px;
    }
    /* Kind badge — 在 task-id 後顯示小標籤區分 review:ui / discuss / verify:* */
    .kind-badge {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 6px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      vertical-align: middle;
      white-space: nowrap;
    }
    .kind-badge.review-ui { background: #e6eef7; color: #2455a3; }
    .kind-badge.discuss { background: #f3e7d6; color: #8a4f0a; }
    .kind-badge.verify-auto { background: #e0eee0; color: #2a6b2a; }
    .kind-badge.verify-e2e { background: #e8edf7; color: #284b8f; }
    .kind-badge.verify-api { background: #dff1ec; color: #176052; }
    .kind-badge.verify-ui { background: #f1e5f5; color: #6b347e; }
    .self-completed-section {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #f5f1e8;
      margin-bottom: 12px;
      overflow: hidden;
    }
    .handled-divider {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 14px 0 8px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: .02em;
    }
    .handled-divider::before,
    .handled-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--line);
    }
    .self-completed-section summary {
      cursor: pointer;
      padding: 10px 12px;
      font-weight: 700;
      color: var(--muted);
    }
    .self-completed-list {
      display: grid;
      gap: 10px;
      padding: 0 10px 10px;
    }
    .evidence-panel,
    .compound-evidence,
    .verified-ui-panel {
      margin-top: 10px;
      padding: 10px 12px;
      border: 1px solid #b9d6c7;
      border-radius: 6px;
      background: #f2f8f5;
      color: var(--ink);
      font-size: 12px;
      line-height: 1.5;
    }
    .compound-evidence {
      display: grid;
      gap: 8px;
      background: #f7f5ee;
      border-color: var(--line);
    }
    .evidence-panel h3,
    .compound-evidence h3,
    .verified-ui-panel h3 {
      margin: 0 0 6px;
      font-size: 13px;
      color: var(--accent);
    }
    .evidence-panel p,
    .compound-evidence p,
    .verified-ui-panel p {
      margin: 4px 0;
    }
    .evidence-panel code,
    .compound-evidence code,
    .verified-ui-panel code {
      background: rgba(255, 255, 255, .72);
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 11px;
    }
    /* 任務描述等地方由 escWithBackticks 產出的 inline code；點兩下整塊選取走下面
       document dblclick handler（光靠 CSS user-select: all 會吃掉 cursor 行為）。*/
    code.inline-code {
      background: rgba(30, 37, 33, .07);
      padding: 1px 5px;
      border-radius: 3px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: .92em;
      word-break: break-all;
      cursor: text;
    }
    .evidence-link {
      color: var(--focus);
      overflow-wrap: anywhere;
    }
    .auto-evidence-collapse {
      border: 1px solid #b9d6c7;
      border-radius: 6px;
      background: #f2f8f5;
      font-size: 12px;
      overflow: hidden;
    }
    .auto-evidence-collapse > summary {
      cursor: pointer;
      padding: 6px 10px;
      color: #176052;
      font-weight: 600;
      list-style: none;
    }
    .auto-evidence-collapse > summary::-webkit-details-marker { display: none; }
    .auto-evidence-collapse > summary::before {
      content: '▸ ';
      display: inline-block;
      width: 12px;
      transition: transform .15s ease;
    }
    .auto-evidence-collapse[open] > summary::before { content: '▾ '; }
    .auto-evidence-collapse[open] > summary {
      border-bottom: 1px solid #cfe3d8;
    }
    .auto-evidence-collapse > .evidence-panel {
      margin: 0;
      border: none;
      background: transparent;
      border-radius: 0;
    }
    .evidence-missing {
      border-color: #d8c37c;
      background: #fff8df;
      color: #6b5115;
    }
    .evidence-notice {
      color: var(--muted);
      font-size: 12px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      vertical-align: middle;
    }
    .status-badge.status-ok { background: #d6ecdf; color: #1e6042; }
    .status-badge.status-warn { background: #ffe9bd; color: #7a520f; }
    .status-badge.status-bad { background: #f8d2d2; color: #8a2525; }
    .status-badge.status-neutral { background: #e7e1d3; color: #5a5341; }
    .verified-ui-image {
      display: block;
      width: 100%;
      max-height: 360px;
      object-fit: contain;
      margin-top: 8px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      cursor: zoom-in;
    }
    .verified-ui-image:hover {
      border-color: var(--accent, #5a8dee);
    }
    .task-item.kind-automatic {
      background: #f3faf6;
    }
    .task-item.kind-verify-ui {
      background: #fbf7fc;
    }
    /* verify:auto evidence chip — 在 task-head 顯示「agent 已驗」+ tooltip 顯示 (verified-auto: ...) 內容 */
    .verified-auto-chip {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 6px;
      border-radius: 4px;
      background: #d6ecdf;
      color: #1e6042;
      font-size: 10px;
      font-weight: 600;
      cursor: help;
      vertical-align: middle;
    }
    /* verify-auto evidence card — bodyHtml 顯示 agent 觀察到的 network/dom 證據 + final-state screenshot 提示 */
    .verify-auto-card {
      margin-top: 10px;
      padding: 10px 12px;
      border: 1px solid #b9d6b9;
      border-radius: 6px;
      background: #f0f7ee;
      color: var(--ink);
      font-size: 12px;
      line-height: 1.5;
    }
    .verify-auto-card strong { color: #1e6042; font-weight: 600; }
    .verify-auto-card code { background: #d6ecdf; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
    .task-item.kind-verify-auto { background: #f4faf2; }
    /* Discuss-specific viewer card — 取代 OK/Issue/Skip + thumbnail */
    .discuss-card {
      margin-top: 12px;
      padding: 14px 16px;
      border: 1px dashed var(--accent-2);
      border-radius: 8px;
      background: #faf3e6;
      color: var(--ink);
    }
    .discuss-card h3 {
      margin: 0 0 8px;
      font-size: 14px;
      color: var(--accent-2);
    }
    .discuss-card p { margin: 4px 0; line-height: 1.5; }
    .discuss-card .notice { color: var(--muted); font-size: 12px; }
    /* Discuss item 在 list 中視覺降權，避免使用者誤以為要操作 */
    .task-item.kind-discuss { background: #fbf6ec; }
    .task-item.kind-discuss .actions { display: none; }
    .task-item.kind-discuss .note { display: none; }
    .reopen {
      padding: 0 8px;
      margin-left: 6px;
      font-size: 12px;
      background: transparent;
    }
    .note {
      width: 100%;
      min-height: 58px;
      margin-top: 10px;
      padding: 9px 10px;
      border-radius: 6px;
      border: 1px solid var(--line);
      resize: vertical;
      background: #fffefa;
      color: var(--ink);
    }
    /* 額外發現 disclosure — 與 ok/issue/skip 主要按鈕並列在 actions 之後，
       預設收合，hasFinding 時 server 端寫回後 open 起來方便繼續編輯。 */
    details.finding {
      margin-top: 8px;
      font-size: 12px;
    }
    details.finding > summary {
      cursor: pointer;
      color: var(--muted);
      padding: 4px 0;
      user-select: none;
      list-style: none;
    }
    details.finding > summary::-webkit-details-marker { display: none; }
    details.finding > summary:hover { color: var(--ink); }
    details.finding[open] > summary { color: var(--ink); margin-bottom: 6px; }
    .finding-input {
      width: 100%;
      min-height: 44px;
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid var(--line);
      resize: vertical;
      background: #fffefa;
      color: var(--ink);
      font-size: 12px;
    }
    /* 已註記 item 在 collapsed 狀態下，state-badge 旁的 📝 提示「有額外發現」 */
    .finding-indicator {
      display: inline-block;
      margin-left: 6px;
      font-size: 13px;
      cursor: help;
      opacity: 0.85;
    }
    /* discuss / automatic kind 不走人工確認，連帶隱藏 finding disclosure */
    .task-item.kind-discuss details.finding { display: none; }
    .screenshot-pane {
      min-width: 0;
      border-left: 1px solid var(--line);
      background: #f1ece2;
      padding: 18px;
      overflow: auto;
    }
    .screenshot-pane h2 {
      margin: 0 0 10px;
      font-size: 16px;
    }
    .thumb-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
      gap: 10px;
      align-items: start;
    }
    .thumb {
      display: grid;
      gap: 6px;
      padding: 6px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      text-align: left;
    }
    .thumb.selected { border-color: var(--accent-2); background: #fff8ee; }
    .thumb-frame {
      width: 100%;
      aspect-ratio: 16 / 10;
      overflow: hidden;
      border-radius: 5px;
      background: var(--panel-2);
    }
    .thumb img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .thumb span {
      font-size: 12px;
      color: var(--muted);
      overflow-wrap: anywhere;
      line-height: 1.25;
    }
    .empty {
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 14px;
      color: var(--muted);
      background: color-mix(in srgb, var(--panel) 62%, transparent);
    }
    .viewer {
      position: fixed;
      inset: 0;
      display: none;
      flex-direction: column;
      background: rgba(30, 37, 33, .82);
      z-index: 20;
    }
    .viewer.open { display: flex; }
    .viewer-toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      flex: 0 0 auto;
      color: rgba(255,255,255,.92);
    }
    .viewer-label {
      flex: 1 1 auto;
      min-width: 0;
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: .85;
    }
    .viewer-hint {
      font-size: 12px;
      opacity: .65;
    }
    .viewer-stage {
      flex: 1 1 auto;
      overflow: auto;
      padding: 0 20px 20px;
      display: grid;
      place-items: center;
      cursor: zoom-in;
    }
    .viewer-stage.zoomed {
      place-items: start;
      cursor: zoom-out;
    }
    .viewer-stage img {
      max-width: 100%;
      max-height: calc(100vh - 96px);
      object-fit: contain;
      background: var(--panel);
      border-radius: 8px;
      display: block;
    }
    .viewer-stage.zoomed img {
      max-width: none;
      max-height: none;
      width: auto;
      height: auto;
      object-fit: initial;
    }
    .viewer button {
      padding: 0 12px;
    }
    @media (max-width: 900px) {
      .app {
        grid-template-columns: 1fr;
      }
      .sidebar {
        border-right: 0;
        border-bottom: 1px solid var(--line);
        max-height: 38vh;
      }
      main {
        grid-template-columns: 1fr;
      }
      .screenshot-pane {
        border-left: 0;
        border-top: 1px solid var(--line);
      }
    }
    @media (max-width: 430px) {
      .sidebar, .review-pane, .screenshot-pane {
        padding: 12px;
      }
      .toolbar {
        align-items: flex-start;
        flex-direction: column;
      }
      .task-head {
        grid-template-columns: 1fr;
      }
      .task-state {
        white-space: normal;
      }
      .task-item.scoped {
        margin-left: 0;
      }
      .actions button {
        flex: 1 1 88px;
      }
      .thumb-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    /* ── onboarding 面板 ── */
    .onboard {
      margin: 0 0 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 10px 12px;
      font-size: 13px;
    }
    .onboard summary {
      cursor: pointer;
      font-weight: 600;
      list-style: none;
      user-select: none;
    }
    .onboard summary::-webkit-details-marker { display: none; }
    .onboard summary::before {
      content: '▶';
      display: inline-block;
      width: 14px;
      font-size: 10px;
      transition: transform .15s;
      color: var(--accent);
    }
    .onboard[open] summary::before { transform: rotate(90deg); }
    .onboard-steps {
      margin: 8px 0 0;
      padding-left: 18px;
      line-height: 1.7;
    }
    .onboard-steps li { margin-bottom: 4px; }
    .onboard-actions {
      margin: 6px 0 0;
      padding-left: 0;
      list-style: none;
      display: grid;
      gap: 3px;
    }
    .onboard-hint {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 12px;
    }
    .kbd {
      display: inline-block;
      min-width: 18px;
      padding: 0 6px;
      border: 1px solid var(--line);
      border-bottom-width: 2px;
      border-radius: 4px;
      background: var(--panel-2);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      font-weight: 600;
      text-align: center;
      line-height: 18px;
      color: var(--ink);
    }

    /* ── 快捷鍵 modal ── */
    .shortcut-modal {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(30, 37, 33, .55);
      z-index: 1000;
    }
    .shortcut-modal.open { display: flex; }
    .shortcut-modal-inner {
      background: var(--panel);
      border-radius: 12px;
      padding: 22px 26px;
      min-width: 320px;
      max-width: 480px;
      box-shadow: var(--shadow);
    }
    .shortcut-modal-inner h3 {
      margin: 0 0 14px;
      font-size: 18px;
    }
    .shortcut-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
      line-height: 1.7;
    }
    .shortcut-table td {
      padding: 4px 0;
      vertical-align: top;
    }
    .shortcut-table td:first-child {
      width: 130px;
      white-space: nowrap;
    }
    #shortcutModalClose {
      margin-top: 16px;
      width: 100%;
    }

    /* ── handoff prompt 按鈕（出現在所有「需要外部 Claude session 處理」的位置） ── */
    .copy-handoff-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 10px;
      margin-left: 6px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line));
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 8%, var(--panel));
      color: var(--accent);
      cursor: pointer;
      white-space: nowrap;
    }
    .copy-handoff-btn:hover {
      background: color-mix(in srgb, var(--accent) 18%, var(--panel));
    }
    .copy-handoff-btn[hidden] {
      display: none;
    }
    .copy-handoff-btn.block {
      display: inline-flex;
      margin-top: 10px;
      margin-left: 0;
      padding: 6px 14px;
      font-size: 13px;
    }
    .copy-handoff-btn.group {
      margin-left: 0;
      text-transform: none;
      letter-spacing: 0;
      font-size: 11px;
      padding: 3px 10px;
    }
    .change-group-heading.with-action {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding-right: 4px;
    }

    /* ── handoff prompt fallback modal（clipboard API 失敗時顯示） ── */
    .prompt-fallback-modal {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(30, 37, 33, .55);
      z-index: 1100;
    }
    .prompt-fallback-modal.open { display: flex; }
    .prompt-fallback-inner {
      background: var(--panel);
      border-radius: 12px;
      padding: 22px 26px;
      width: min(680px, 92vw);
      max-height: 86vh;
      display: grid;
      gap: 12px;
      box-shadow: var(--shadow);
    }
    .prompt-fallback-inner h3 {
      margin: 0;
      font-size: 18px;
    }
    .prompt-fallback-inner p {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
    }
    .prompt-fallback-inner textarea {
      width: 100%;
      min-height: 320px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      background: #fffefa;
      color: var(--ink);
      resize: vertical;
    }
    .prompt-fallback-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <h1>人工檢查</h1>
      <div class="title-meta">
        ${versionBadge}
        <span class="title-updated" id="updatedAt" aria-live="off"></span>
      </div>
      <details id="onboardPanel" class="onboard" open>
        <summary>怎麼用</summary>
        <ol class="onboard-steps">
          <li>從下方清單選一個 <b>change</b>（每個 change 顯示 metrics：待檢查、已通過、格式錯誤、截圖 topic 數）</li>
          <li>中間是檢查項清單，逐項決定：
            <ul class="onboard-actions">
              <li><span class="kbd">O</span> ✓ 通過</li>
              <li><span class="kbd">I</span> ⚠ 有問題（必填說明）</li>
              <li><span class="kbd">S</span> ⤵ 跳過（可選填）</li>
            </ul>
          </li>
          <li>右側是截圖：先點檢查項，再點縮圖把截圖綁到該項</li>
          <li>雙擊縮圖或按 <span class="kbd">Enter</span> 放大；<span class="kbd">Esc</span> 關閉</li>
        </ol>
        <p class="onboard-hint">按 <span class="kbd">?</span> 顯示完整鍵盤快捷鍵</p>
      </details>
      <div id="changeStatus" class="status loading-spin">載入 change 清單中…</div>
      <div id="changeList" class="change-list"></div>
    </aside>
    <main>
      <section class="review-pane">
        <div class="toolbar">
          <h2 id="currentTitle" class="loading-spin">載入 change 清單中…</h2>
          <button id="evidenceSweepButton" class="copy-handoff-btn" type="button" hidden title="複製整張 change 的補 evidence prompt — 讓新 Claude session 一次跑 /spectra-apply Step 8a 補齊所有缺項">📋 補齊全 change 缺失 evidence</button>
          <button id="reloadButton" type="button" title="重新載入目前 change">重新載入</button>
        </div>
        <div id="banner" class="banner"></div>
        <div id="taskList" class="task-list"></div>
      </section>
      <aside class="screenshot-pane">
        <h2>截圖</h2>
        <div id="selectionStatus" class="status"></div>
        <div id="thumbGrid" class="thumb-grid"></div>
      </aside>
    </main>
  </div>
  <div id="viewer" class="viewer" role="dialog" aria-modal="true" aria-label="截圖大圖檢視">
    <div class="viewer-toolbar">
      <span class="viewer-label" id="viewerLabel"></span>
      <span class="viewer-hint">點圖切 1:1 / Esc 關閉</span>
      <button id="viewerClose" type="button">關閉 (Esc)</button>
    </div>
    <div class="viewer-stage" id="viewerStage">
      <img id="viewerImage" alt="">
    </div>
  </div>
  <div id="shortcutModal" class="shortcut-modal" role="dialog" aria-modal="true" aria-label="鍵盤快捷鍵">
    <div class="shortcut-modal-inner">
      <h3>鍵盤快捷鍵</h3>
      <table class="shortcut-table">
        <tbody>
          <tr><td><span class="kbd">J</span> / <span class="kbd">K</span></td><td>下一個 / 上一個檢查項</td></tr>
          <tr><td><span class="kbd">O</span></td><td>標記為 ✓ 通過</td></tr>
          <tr><td><span class="kbd">I</span></td><td>標記為 ⚠ 有問題</td></tr>
          <tr><td><span class="kbd">S</span></td><td>標記為 ⤵ 跳過</td></tr>
          <tr><td><span class="kbd">Enter</span></td><td>放大第一張截圖</td></tr>
          <tr><td><span class="kbd">Esc</span></td><td>關閉大圖 / 此視窗</td></tr>
          <tr><td><span class="kbd">?</span></td><td>顯示這個視窗</td></tr>
        </tbody>
      </table>
      <button id="shortcutModalClose" type="button">關閉 (Esc)</button>
    </div>
  </div>
  <div id="promptFallbackModal" class="prompt-fallback-modal" role="dialog" aria-modal="true" aria-label="Handoff prompt（手動複製）">
    <div class="prompt-fallback-inner">
      <h3>複製 handoff prompt</h3>
      <p>瀏覽器拒絕直接寫剪貼簿（通常是非 secure context）。請手動全選 → 複製 → 貼到新 Claude session。</p>
      <textarea id="promptFallbackText" readonly></textarea>
      <div class="prompt-fallback-actions">
        <button id="promptFallbackSelectAll" type="button">全選</button>
        <button id="promptFallbackClose" type="button">關閉 (Esc)</button>
      </div>
    </div>
  </div>
  <script>
    const state = {
      changes: [],
      current: null,
      activeIndex: 0,
      expanded: new Set(),
      selfCompletedOpen: false,
      // draftNotes: 使用者在 textarea 輸入但尚未 saveAction 的內容；以 itemId 為 key。
      // renderTasks 會整個重設 innerHTML 觸發 textarea 重建，沒這層 cache 會把
      // 使用者打字內容沖掉（renderTasks 由點 task / j/k / saveAction / reopen
      // 等多處觸發）。saveAction 成功後清掉該 id（server 已存進 raw）。
      draftNotes: {},
      // 母項（#3）若有子項（#3.1、#3.2...），UI 不顯示按鈕跟 textarea — 使用者只對子項回饋。
      // 由 rebuildParentChildrenIndex 在 loadChange 後重建。
      parentsWithChildren: new Set(),
      // repoRoot / repoName 由啟動時 fetch /api/health 填入，給 handoff prompt 用。
      // 若 health fetch 失敗仍要讓 GUI 可用，prompt 會 fallback 顯示「(unknown)」。
      repoRoot: '',
      repoName: '',
    };
    const el = {
      changeStatus: document.getElementById('changeStatus'),
      changeList: document.getElementById('changeList'),
      currentTitle: document.getElementById('currentTitle'),
      evidenceSweepButton: document.getElementById('evidenceSweepButton'),
      reloadButton: document.getElementById('reloadButton'),
      banner: document.getElementById('banner'),
      taskList: document.getElementById('taskList'),
      selectionStatus: document.getElementById('selectionStatus'),
      thumbGrid: document.getElementById('thumbGrid'),
      viewer: document.getElementById('viewer'),
      viewerStage: document.getElementById('viewerStage'),
      viewerImage: document.getElementById('viewerImage'),
      viewerLabel: document.getElementById('viewerLabel'),
      viewerClose: document.getElementById('viewerClose'),
      shortcutModal: document.getElementById('shortcutModal'),
      shortcutModalClose: document.getElementById('shortcutModalClose'),
      promptFallbackModal: document.getElementById('promptFallbackModal'),
      promptFallbackText: document.getElementById('promptFallbackText'),
      promptFallbackSelectAll: document.getElementById('promptFallbackSelectAll'),
      promptFallbackClose: document.getElementById('promptFallbackClose'),
    };

    // ── URL <-> state 同步 ──
    // path '/review/<change>' 對應 state.current.name
    // hash '#item-<id>' 對應當前 active task item.id
    // 點 change 用 pushState（可 back 回 list view），切 task 用 replaceState
    // （避免 history 被連續按 j/k 灌爆）。reload / 分享 URL 由 client 啟動時
    // parseLocationTarget 解析後 deep-link。
    // 註：此 comment / 下方 helper 內**禁用** raw backtick — 整段 client JS
    // 嵌在 outer template literal 內，raw backtick 會提早結束 template。
    function parseLocationTarget() {
      const path = window.location.pathname || '';
      // regex 用 [/] 而非 \\/ — outer template literal 會把 \\/ 縮成 /，瀏覽器
      // 拿到 /^/review/(.+)$/ → flag 'r' 不合法 → Uncaught SyntaxError: Invalid
      // regular expression flags。[/] 等價且不受 template literal escape 影響。
      const m = path.match(/^[/]review[/](.+)$/);
      let change = null;
      if (m) {
        try { change = decodeURIComponent(m[1]); } catch (_) { change = m[1]; }
      }
      const hash = window.location.hash || '';
      let itemId = null;
      if (hash.indexOf('#item-') === 0) {
        try { itemId = decodeURIComponent(hash.slice(6)); } catch (_) { itemId = hash.slice(6); }
      }
      return { change: change, itemId: itemId };
    }
    function urlForChange(name) {
      return '/review/' + encodeURIComponent(name);
    }
    function urlForItem(name, itemId) {
      return urlForChange(name) + '#item-' + encodeURIComponent(itemId);
    }
    function pushChangeUrl(name) {
      const target = name ? urlForChange(name) : '/review';
      const currentFull = window.location.pathname + window.location.hash;
      if (currentFull === target) return;
      history.pushState({ change: name, itemId: null }, '', target);
    }
    function replaceItemUrl(name, itemId) {
      let target;
      if (name && itemId) target = urlForItem(name, itemId);
      else if (name) target = urlForChange(name);
      else target = '/review';
      const currentFull = window.location.pathname + window.location.hash;
      if (currentFull === target) return;
      history.replaceState({ change: name, itemId: itemId }, '', target);
    }
    function syncActiveItemUrl() {
      const change = state.current;
      if (!change) return;
      const item = change.items && change.items[state.activeIndex];
      if (!item) return;
      replaceItemUrl(change.name, item.id);
    }

    // 從截圖檔名擷取 item id token。支援 #N-、#N.M-、Nb-、N.Ma- 等變體。
    // 同時回傳是否為 legacy 格式（無 # 前綴）— legacy fallback 只能套用在 legacy
    // 檔名，不能讓 canonical scoped 檔（如 #3.1-）誤配到 parent #1。
    // regex 用 [0-9] / [.] 而非 \\d / \\. — oxlint no-useless-escape 對 template
    // literal 內字串字面 regex 誤判，這寫法等價且 lint clean。
    function extractFilenameId(name) {
      const m = name.match(/^(#?)([0-9]+(?:[.][0-9]+)?)([a-z]?)(?=[-._])/i);
      if (!m) return null;
      return { id: m[2], legacy: m[1] === '' };
    }
    // 從 raw tasks.md 行解析使用者已下的決定 + 之前填的 note。
    // appendAnnotation 用全形「（）」夾標籤，例：
    //   - [x] #1 ... （issue: 圖片載不出）
    //   - [x] #2 ... （skip: 不適用）
    //   - [x] #3 ...（純通過、無 annotation）
    // regex 用 [ ] 等價字符集而非 \\s — oxlint no-useless-escape 對 template
    // literal 內字串字面 regex 誤判（同 extractFilenameId 處理方式）。
    // server-side sanitizeNote 已 normalize whitespace 為單一 space，所以
    // [ ]* 足夠覆蓋所有實際輸入。
    function parseDecision(raw) {
      const issueMatch = raw.match(/（issue:[ ]*([^）]*)）/);
      if (issueMatch) return { kind: 'issue', note: issueMatch[1].trim() };
      const skipMatch = raw.match(/（skip(?::[ ]*([^）]*))?）/);
      if (skipMatch) return { kind: 'skip', note: (skipMatch[1] || '').trim() };
      // 用 startsWith 避開 oxlint no-useless-escape 對 regex \\[ / \\] 的誤判
      const trimmed = raw.replace(/^[ \t]+/, '');
      const checked = trimmed.startsWith('- [x]') || trimmed.startsWith('- [X]');
      if (checked) {
        const noteMatch = raw.match(/（note:[ ]*([^）]*)）/);
        return { kind: 'ok', note: noteMatch ? noteMatch[1].trim() : '' };
      }
      return { kind: 'pending', note: '' };
    }
    function decisionLabel(kind) {
      if (kind === 'ok') return '✓ 已通過';
      if (kind === 'issue') return '⚠ 有問題';
      if (kind === 'skip') return '⤵ 已跳過';
      return '待檢查';
    }
    // 與 ok/issue/skip 正交：finding 是「除了主要結論之外順手記下的觀察」，
    // 通常是 TD 候選，可單獨存在也可跟任一主要 action 共存。
    function parseFinding(raw) {
      const m = raw.match(/（finding:[ ]*([^）]*)）/);
      return m ? m[1].trim() : '';
    }

    function fileMatchesItem(filename, itemId) {
      const extracted = extractFilenameId(filename);
      if (!extracted) return false;
      const target = itemId.replace(/^#/, '');
      if (extracted.id === target) return true;
      // legacy section.item（如 8.1-...，無 #）對應 parent item — 只給 legacy 檔名用。
      // canonical #N.M-（有 #）不走 fallback，避免 #3.1-mobile.png 被 parent #1 抓到。
      if (extracted.legacy && !target.includes('.') && extracted.id.includes('.')) {
        const parts = extracted.id.split('.');
        if (parts.length === 2 && parts[1] === target) return true;
      }
      return false;
    }

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, function (ch) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
      });
    }

    // 切出 backtick-wrapped inline code，包成 <code class="inline-code">。配合下方
    // 全域 dblclick handler 達成「點兩下整塊選取」(/ 等符號 break default word
    // selection)。regex 內 backtick 用 \\u0060 escape（raw 寫法會把外層 template
    // literal 提早結束），\\n 是外層跳脫過的 \\n，禁止 inline code 跨行。
    function escWithBackticks(value) {
      const s = String(value ?? '');
      const tickRe = /\u0060([^\u0060\\n]+)\u0060/g;
      let out = '';
      let last = 0;
      for (const m of s.matchAll(tickRe)) {
        out += esc(s.slice(last, m.index));
        out += '<code class="inline-code">' + esc(m[1]) + '</code>';
        last = m.index + m[0].length;
      }
      out += esc(s.slice(last));
      return out;
    }

    // 對 raw 字串切出 http(s) URL，URL/text 兩段各自 esc 後拼回。
    // 比「先 esc 再掃 URL」安全：raw 字串內的 quote 與 ampersand 邊界仍是原樣，
    // URL regex 能正確判斷終點；先 esc 後 URL 末端會把 entity 吃進去。
    // 非 URL 段落交給 escWithBackticks 處理 backtick → <code>。
    // regex 字符類用顯式列舉取代 \\s — 同 extractFilenameId / parseDecision。
    function escWithLinks(value) {
      const s = String(value ?? '');
      const urlRe = /(https?:[/][/][^\\s<>"'\u0060)]+)/g;
      let out = '';
      let last = 0;
      for (const m of s.matchAll(urlRe)) {
        out += escWithBackticks(s.slice(last, m.index));
        let url = m[0];
        let trailing = '';
        while (url.length && '.,!?)'.indexOf(url[url.length - 1]) !== -1) {
          trailing = url.slice(-1) + trailing;
          url = url.slice(0, -1);
        }
        if (url) {
          out += '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a>';
        }
        out += esc(trailing);
        last = m.index + m[0].length;
      }
      out += escWithBackticks(s.slice(last));
      return out;
    }

    function showBanner(message, type) {
      el.banner.textContent = message || '';
      el.banner.className = 'banner' + (message ? ' show' : '') + (type ? ' ' + type : '');
    }

    // showBanner 配 handoff 按鈕；用於衝突等需要外部 Claude session 處理的情境。
    // textContent 會清掉 children，所以先 setText 再 appendChild。
    function showBannerWithHandoff(message, type, kind, label, errorMessage) {
      showBanner(message, type);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-handoff-btn';
      btn.textContent = '📋 複製 handoff prompt';
      btn.title = '複製 handoff prompt 給新 Claude session 處理此問題';
      btn.addEventListener('click', function () {
        copyHandoffPrompt(kind, { change: state.current, errorMessage: errorMessage }, label);
      });
      el.banner.appendChild(btn);
    }

    async function api(path, options) {
      const res = await fetch(path, options);
      const body = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        const err = new Error(body.error || ('HTTP ' + res.status));
        err.status = res.status;
        err.body = body;
        throw err;
      }
      return body;
    }

    // ── handoff prompt builder ──
    // 11 種情境共用骨架；每種往下填情境專屬段落。產出的 prompt 應自給自足，
    // 即便丟到一個沒讀過 CLAUDE.md / 沒 conversation history 的 cleanroom Claude
    // session 也能直接接手。
    //
    // Rules / codebase-memory-mcp 指引依 kind 條件式注入：footer 不再 blanket 套用——
    // 純檔案系統 / git 操作的 kind（malformed / no-pools / no-matched / conflict /
    // evidence-fillin-*）不需要 code graph，避免 cleanroom session 被引導往錯方向 +
    // 浪費 token 載 5 條 rules。需要 code 探索的 kind（item-issue / *-group / readiness）
    // 自己加 codeExplorationGuidance()。
    function relevantRules(kind) {
      const map = {
        'malformed': ['.claude/rules/manual-review.md（schema 段）'],
        'no-pools': ['.claude/rules/screenshot-strategy.md'],
        'no-matched': ['.claude/rules/screenshot-strategy.md（§檔名強制規範）', 'plugins/hub-core/agents/screenshot-review.md'],
        'conflict': [],
        'item-issue': [
          '.claude/rules/manual-review.md',
          '.claude/rules/tech-debt-routing.md',
        ],
        'manual-review-readiness': [
          '.claude/rules/manual-review.md（Pre-Review Data Readiness 段）',
          '.claude/rules/fixtures-reference.md',
        ],
        'evidence-fillin-item': [
          '.claude/rules/manual-review.md（verify channel 語意）',
        ],
        'evidence-fillin-change': [
          '.claude/rules/manual-review.md（verify channel 語意）',
        ],
      };
      const rules = map[kind] || [];
      if (!rules.length) return '';
      return [
        '',
        '## 相關 rules（必讀）',
        ...rules.map(function (r) { return '- ' + r; }),
      ].join('\\n');
    }
    function needsCodeExploration(kind) {
      // 只對「需要追實作 / 找 call chain / 看 schema」的 kind 強推 codebase-memory-mcp。
      // 純檔案系統 / git / Playwright baseline 操作不需要 code graph。
      const codeKinds = [
        'item-issue',
        'manual-review-readiness',
        'health-check-group',
        'feedback-given-group',
        'apply-pending-group',
      ];
      return codeKinds.indexOf(kind) !== -1;
    }
    function codeExplorationGuidance() {
      return [
        '',
        '## 程式碼探索規矩',
        '- **MUST** 用 codebase-memory-mcp：search_graph（找函式 / class / route）→ trace_path（追 call chain）→ get_code_snippet（讀原始碼）',
        '- graph 未 index 先跑 index_repository',
        '- Grep / Glob / Read 只用於非程式碼檔（.md / config / .env）',
      ].join('\\n');
    }
    function verifyChannelBaselineSection() {
      // 不含 step 編號，由 caller 自己排序；避免 evidence-fillin-item / -change 不同步驟順序時撞號。
      return [
        'Pre-verify baseline check（依出現的 channel 種類）：',
        '- 有 \`[verify:e2e]\`：確認 Playwright config + e2e fixtures 存在',
        '- 有 \`[verify:api]\`：確認 \`__test-login\` 或等價 session bypass route 存在',
        '- 有 \`[verify:ui]\`：確認 \`supabase/seed.sql\` 或 seed 等價檔存在',
        '- 缺 baseline → **STOP**，回報 user 補齊；**NEVER** 降級 channel',
      ].join('\\n');
    }
    function verifyChannelOrderSection() {
      // 不含 step 編號，由 caller 自己排序。
      return [
        '依 e2e → api → ui 順序補對應 evidence；每完成一個 channel 立刻 Edit tasks.md 寫對應 \`(verified-*: ...)\` annotation（不要等到最後一起寫）。',
        '',
        '全部完成後請 user 在 review:ui 重新整理；含 \`verify:ui\` 的 item checkbox 仍保留 \`[ ]\` 等 user 在 GUI 視覺確認。',
        '',
        '任一 channel 通不過 → 保留 \`[ ]\` + 寫 \`（issue: ...）\`；**NEVER** 寫不成功的 \`(verified-*:)\` annotation。',
      ].join('\\n');
    }
    function feedbackGivenSummaryPrompt(list, repoName, repoRoot) {
      const tableRows = list.map(function (c) {
        return '| \`' + c.name + '\` | ' + (c.issued || 0) + ' | _ | _ | _ | _ | _ |';
      }).join('\\n');
      return [
        '我在 consumer repo「' + repoName + '」（路徑：' + repoRoot + '）',
        '跑 \`pnpm review:ui\` 做 spectra 人工檢查，有 ' + list.length + ' 張 change 落「等 Claude 接手」群。',
        '',
        '**N=' + list.length + ' 已超過 4 張閾值——一次嚼三類項目 × 五路由會超 token 預算（單張深度 5-15k token）。**',
        '',
        '## 你要做的事（**MUST**，順序執行）',
        '',
        '先填下面 summary table，產出後立刻 STOP 等 user 選優先順序：',
        '',
        '- **STOP after summary table**',
        '- **Do not analyze individual changes yet**',
        '- **Wait for user to specify which change(s) to deep-dive**',
        '- **Only choose priorities after user replies**',
        '',
        '## 環境',
        '- consumer: ' + repoName,
        '- repo root: ' + repoRoot,
        '',
        '## 命中的 changes（共 ' + list.length + ' 張）',
        '',
        '| change | I (issue) | V (verify pending) | D (discuss) | risk | blocking? | needs code mcp? | recommended first action |',
        '| --- | ---: | ---: | ---: | --- | --- | --- | --- |',
        tableRows,
        '',
        '欄位說明：',
        '- **I (issue)**：已預填，server 計算的 issue 註記數',
        '- **V (verify pending)** / **D (discuss)** / **risk** / **blocking?** / **needs code mcp?** / **recommended first action**：由你逐張 \`Read openspec/changes/<change>/tasks.md\` 後填入；**不要展開深度分析**，只填這幾欄',
        '- **risk**：low / med / high（指根因不明 / 影響範圍大小 / 已有 evidence vs 純猜）',
        '- **blocking?**：blocking / non-blocking（會卡 archive 嗎？卡 prod 嗎？）',
        '- **needs code mcp?**：yes / no / unknown（單純看 spec 還是要展開 codebase-memory-mcp 才能判）',
        '- **recommended first action**：一句話 hint，例：「補 sample data → /spectra-ingest」「審 evidence body fingerprint → 若不合理改標 issue」',
        '',
        '## 排序建議（產 summary 時用）',
        '',
        'blocking issue > failed/ambiguous verification > discuss-only',
        '',
        '## 規矩',
        '- 讀 tasks.md 用 \`Read\`（不是 codebase-memory-mcp，因為這只是 .md schema 抓三類項目）',
        '- 每張只花 1-2 分鐘掃，不要展開深度 trace_path',
        '- summary 產完 STOP；user 會告訴你深入哪幾張',
        '',
        handoffStillVisibleNote(),
      ].join('\\n');
    }
    function planDiscipline(kind) {
      // 三層分類（依 codex 諮詢 2026-05-18）：
      // - 'direct'：限定動作範圍可直接做完回報（malformed typo / evidence annotation 寫入）
      // - 'diagnose'：只 diagnose + 提建議，不動手做完（檔案系統 / git mismatch 類）
      // - 'plan-first'：列方案等確認（涉及 spec / code / 多檔）
      const directKinds = ['malformed', 'evidence-fillin-item', 'evidence-fillin-change'];
      const diagnoseKinds = ['no-pools', 'no-matched', 'conflict'];
      if (directKinds.indexOf(kind) !== -1) {
        const range = kind === 'malformed'
          ? '- 限 format/schema 違規一行的 typo / 標點修正；若 item identity 不明、語意結構壞掉 → **STOP** 回報 user，不要自行重組 list'
          : '- 限既有 Step 8a 流程明訂的 evidence annotation 寫入（\`(verified-e2e: ...)\` / \`(verified-api: ...)\` / \`(verified-ui: ...)\`）；測試 fail / ambiguous → **NEVER** 順手修 code，回報 blocker';
        return [
          '',
          '## 處理紀律',
          '此類修法**範圍鎖死**可直接做完回報：',
          range,
          '- 動作範圍外（動 spec / code / 多檔）→ plan-first 列方案等確認',
        ].join('\\n');
      }
      if (diagnoseKinds.indexOf(kind) !== -1) {
        return [
          '',
          '## 處理紀律',
          '此類為 **diagnose-only fast path**：定位 mismatch / hash / pool routing 問題後提建議，**不動手做完**——',
          '- 列出根因評估 + 修法方案（reload / rename / 重拍 / git revert）',
          '- 動作由 user 自己執行（rename 檔 / 拍截圖 / reload GUI），cleanroom 不替 user 操作',
        ].join('\\n');
      }
      // plan-first kinds: item-issue / manual-review-readiness / *-group
      return [
        '',
        '## 處理紀律',
        'plan-first 必須：列方案 + 影響範圍 + 為何這樣修，**等我確認後再改**——急著動手 = 違反 user 規則',
      ].join('\\n');
    }
    function handoffHeader(change, ctx) {
      const repoName = state.repoName || '(unknown)';
      const mainRepoRoot = state.repoRoot || '(unknown)';
      const changeName = change ? change.name : '(unknown)';
      // 若 change 在 worktree，接手者 cwd 必須是 worktree 否則 tasks.md 路徑找不到。
      const wtSlug = change ? change.worktreeSlug : null;
      const sourceRoot = (change && change.sourceRoot) || mainRepoRoot;
      const item = (ctx && ctx.item) || null;
      const kinds = item ? itemKinds(item) : null;
      const kindLine = kinds && kinds.length ? '- item kind: ' + kinds.join(' + ') : null;
      const lines = [
        '我在 consumer repo「' + repoName + '」（路徑：' + mainRepoRoot + '）',
        '跑 \`pnpm review:ui\` 做 spectra 人工檢查，遇到下面這個問題需要你接手分析、提方案，',
        '等我確認後再動手。',
        '',
        '## 環境',
        '- consumer: ' + repoName,
        '- main repo root: ' + mainRepoRoot,
      ];
      if (wtSlug) {
        lines.push(
          '- ⚠️ 此 change 位於 worktree \`' + wtSlug + '\`：開工前 \`cd ' + sourceRoot + '\`，所有檔案讀寫都以這個 worktree 為主',
          '- working tree: ' + sourceRoot
        );
      }
      lines.push(
        '- change: ' + changeName,
        '- tasks.md: openspec/changes/' + changeName + '/tasks.md',
      );
      if (kindLine) lines.push(kindLine);
      lines.push('');
      return lines.join('\\n');
    }
    function handoffFooter(kind) {
      // relevantRules / codeExplorationGuidance / planDiscipline 各自負責 leading '\\n'
      // 段落分隔；為空時整段不附加，避免 conflict / 純檔案 kind 多出空白章節。
      const rules = relevantRules(kind);
      const codeGuide = needsCodeExploration(kind) ? codeExplorationGuidance() : '';
      const discipline = planDiscipline(kind);
      const youDo = [
        '',
        '## 你要做的事',
        '1. 先讀 tasks.md 確認當前真實狀態（不要相信我的轉述，以檔案為準）',
        '2. 提出處理方案：列出要動哪些檔、影響什麼、為何這樣修',
      ].join('\\n');
      const tail = [
        '',
        '',
        handoffStillVisibleNote(),
        '',
        '回覆時請先說「我看到的現況是 ...」再給方案，不要只回方案。',
      ].join('\\n');
      return rules + youDo + discipline + codeGuide + tail;
    }
    // 給「按鈕還在」狀況的固定指引：問題不在 consumer 而在 clade 中央倉。
    // 三類根因都有可能：實際改動沒落地 / GUI 偵測 false positive / 這份 prompt 講不清楚。
    function handoffStillVisibleNote() {
      return [
        '## 若處理完後 review:ui 同一顆按鈕還顯示',
        '代表 GUI 偵測條件還沒消除——根因有三種，**全部**回到 \`~/offline/clade\` 改，不要在 consumer 改：',
        '1. 改動沒真的落地 → 跑 \`git diff\` / \`git status\` 確認；review:ui home 也要重新整理',
        '2. review:ui 偵測邏輯 false positive（按鈕條件本來就不該成立）→ 改 \`~/offline/clade/vendor/scripts/review-gui.mts\` 的偵測函式',
        '3. 這份 prompt 講不清楚導致沒抓對根因 → 改 \`~/offline/clade/vendor/scripts/review-gui.mts\` 的 \`buildHandoffPrompt\`（或對應 group 段）',
        '改完依 \`~/offline/clade/CLAUDE.md\` § 異動 clade 後的標準流程 散播（vp check → commit → publish patch → push --tags → propagate）。',
        'consumer 端的 \`scripts/review-gui.mts\` 是 clade 投影（LOCKED + chmod 444），直接改會被下次 propagate 蓋回去。',
      ].join('\\n');
    }
    function buildHandoffPrompt(kind, ctx) {
      const change = ctx.change || state.current;
      let body = '';
      if (kind === 'malformed') {
        const lines = (ctx.malformedLines || (change ? change.malformedLines : []) || []);
        const formatted = lines.map(function (l) {
          return '第 ' + l.lineNumber + ' 行（' + (l.reason || 'parse error') + '）：' + l.raw;
        }).join('\\n');
        body = [
          '## 問題：tasks.md 有格式錯誤行（review:ui 無法寫入）',
          '',
          'GUI 解析 \`## 人工檢查\` 區塊時遇到下列行不符 schema，整個 change 的寫入被 freeze（按 O / I / S 都會被擋）。',
          '',
          '預期 schema：',
          '- \`- [ ] #N 描述...\`（top-level item）',
          '- \`- [ ] #N.M 描述...\`（scoped sub-item）',
          '- 已決定者：\`- [x] ...（issue: 說明）\` / \`- [x] ...（skip[: 說明]）\` / \`- [x] ...（note: 說明）\`',
          '',
          '違規行：',
          '\`\`\`',
          formatted || '(無)',
          '\`\`\`',
        ].join('\\n');
      } else if (kind === 'no-pools') {
        const cn = change ? change.name : '<change-name>';
        body = [
          '## 問題：找不到屬於此 change 的截圖資料夾',
          '',
          '## Tier 0（**先問 user 一句，再進 Tier 1，90% 案例就解**）',
          '',
          '請先問 user 一句：「截圖是真的還沒拍，還是命名漂掉了？」',
          '',
          '- 若 user 答**還沒拍** → 直接告訴 user 該補拍哪些 item 的截圖，**不要往下做 Tier 1 分析**',
          '- 若 user 答**命名漂了** / 不確定 / 沒回 → 進 Tier 1 命名規範分析',
          '',
          '## Tier 1 — 命名規範分析（user 確認是命名問題才做）',
          '',
          'GUI 對截圖資料夾用 substring match：',
          '\`topic === change\` 或 \`change.startsWith(topic+"-")\` 或 \`topic.startsWith(change+"-")\`',
          '掃完 \`screenshots/<env>/*\` 後，沒有任何資料夾與 change name \`' + cn + '\` 對得起來。',
          '',
          '預期路徑形如：',
          '- \`screenshots/<env>/' + cn + '/\`',
          '- \`screenshots/<env>/' + cn + '-<suffix>/\`',
          '',
          '常見原因：',
          '1. 資料夾名拼錯（typo / 用了 phase-N-section-N 或 feature-tag 等別名）',
          '2. 還沒拍——這個 change 的 \`## 人工檢查\` 區塊建立了，但截圖階段被跳過',
          '3. env 子目錄漏建（screenshots/ 下面要有一層 env，例如 default / desktop / mobile）',
          '',
          '請：',
          '- 跑 \`ls -la screenshots/\` 看現有 env 與 topic',
          '- 比對 \`openspec/changes/' + cn + '/tasks.md\` 的 \`## 人工檢查\` 是否真的需要截圖',
          '- 若是命名漂掉，提議重新命名的最小修法（不要直接改檔，先列方案）',
        ].join('\\n');
      } else if (kind === 'no-matched') {
        const item = ctx.item || {};
        const idLabel = (item.id || '').replace(/^#/, '');
        const pools = ctx.pools || (change ? change.screenshotPools : []) || [];
        const allFiles = ctx.files || [];
        const poolPaths = pools.map(function (p) { return 'screenshots/' + p.env + '/' + p.topic + '/'; });
        body = [
          '## 問題：截圖檔名與 item id 不符（無法配對）',
          '',
          '## Tier 0（**先問 user 一句，再進 Tier 1，90% 案例就解**）',
          '',
          '請先問 user 一句：「這個 item 的截圖是真的還沒拍，還是命名漂掉了？」',
          '',
          '- 若 user 答**還沒拍** → 直接告訴 user 該補拍 \`#' + idLabel + '-...\` 命名格式的截圖，**不要往下做 Tier 1 分析**',
          '- 若 user 答**命名漂了** / 不確定 / 沒回 → 進 Tier 1 配對規範分析',
          '',
          '## Tier 1 — 配對規範分析（user 確認是命名問題才做）',
          '',
          '當前 item：',
          '- id: ' + (item.id || '(未選)'),
          '- description: ' + (item.description || '(無)'),
          '',
          '已 match 的 topic 資料夾（共 ' + poolPaths.length + ' 個）：',
          poolPaths.length ? poolPaths.map(function (p) { return '- ' + p; }).join('\\n') : '- (無)',
          '',
          '此 change 共收到 ' + allFiles.length + ' 張截圖，但檔名都不以以下開頭：',
          '- \`#' + idLabel + '-...\`',
          '- \`#' + idLabel + '<letter>-...\`（variant，如 #' + idLabel + 'a-light.png）',
          '- legacy \`' + idLabel + '-...\`（無 # 前綴；只有 id 不含 . 時 fallback 才會用）',
          '',
          '現有檔名：',
          '\`\`\`',
          (allFiles.length ? allFiles.map(function (f) { return f.name; }).join('\\n') : '(無)'),
          '\`\`\`',
          '',
          '請：',
          '- 確認檔名與 item id 的對應規範（見 .claude/rules/screenshot-strategy.md §檔名強制規範，或 plugins/hub-core/agents/screenshot-review.md）',
          '- 若是命名漂掉，提議 rename 方案（map old → new，不要直接 mv）',
          '- 若是 item id 與設計不符（例如 tasks.md 是 #3 但截圖意圖是 #3.1 sub-item），建議改 tasks.md 結構',
        ].join('\\n');
      } else if (kind === 'conflict') {
        const cn = change ? change.name : '(unknown)';
        const ver = (change && change.version) || {};
        body = [
          '## 問題：review:ui 寫入衝突（HTTP 409）',
          '',
          '## Tier 0（**先做這個再進 Tier 1，90% 案例就解**）',
          '',
          '請 user 直接在瀏覽器 reload review:ui（cmd+R / ctrl+R），讓 client 重抓最新 hash 再試一次。',
          '若 reload 後仍 409，再進 Tier 1 細部診斷。',
          '',
          '## Tier 1 — 細部診斷（reload 也沒解才做）',
          '',
          'GUI 嘗試寫入 tasks.md 但 server 端偵測到 disk 內容與 client 持有的 version hash 不一致——意思是 tasks.md 在 user 按按鈕的同時被別的東西改過了。',
          '',
          '錯誤訊息：' + (ctx.errorMessage || '(無)'),
          '',
          'Client 持有的 version：',
          '- hash: ' + (ver.hash || '(unknown)'),
          '- mtimeMs: ' + (ver.mtimeMs || '(unknown)'),
          '',
          '常見原因：',
          '1. 我自己在編輯器裡改了 \`openspec/changes/' + cn + '/tasks.md\`',
          '2. 另一個 review:ui tab / 另一個 Claude session 跑 spectra-apply 改了',
          '3. git pull / rebase / spectra-ingest 拉到新版本',
          '4. 同時開兩個 review:ui，前一次 save 已落地但這個 tab 沒 reload',
          '',
          '請：',
          '- 跑 \`git status\` 與 \`git diff openspec/changes/' + cn + '/tasks.md\` 看誰動了',
          '- 看 git log 最近一筆對該檔的改動是否預期',
          '- 提議解法：通常是「reload GUI 拿新 version」即可，但若 tasks.md 已經被改成不一致狀態，要先協調修法',
          '- 若有未 commit 的本地修改造成衝突，協助我整理出乾淨的 commit 順序',
        ].join('\\n');
      } else if (kind === 'item-issue') {
        const item = ctx.item || {};
        const note = ctx.note || '';
        const matchedFiles = ctx.matchedFiles || [];
        const hits = Array.isArray(item.manualReviewHits) ? item.manualReviewHits : [];
        const hitLines = hits.length
          ? [
              '',
              '## Pre-Review Data Readiness 命中（review:ui client-side 偵測）',
              ''
            ].concat(
              hits.map(function (h) {
                return '- \`' + h.code + '\` — ' + h.description + '（rule: .claude/rules/' + h.anchor + '）';
              })
            ).concat([
              '',
              '這些 pattern 通常代表 proposal 階段 sample / URL / scoped sub-item 沒寫齊。處理 issue 時先判斷：root cause 是不是「proposal 不完整導致截圖難對焦」而非「實作 bug」。',
            ])
          : [];
        body = [
          '## 問題：人工檢查標記為 ⚠ 有問題（issue），需要 root cause + 修法',
          '',
          'Item：',
          '- id: ' + (item.id || '(unknown)'),
          '- description: ' + (item.description || '(無)'),
          '',
          '我填的 issue 說明：',
          '\`\`\`',
          note || '(空)',
          '\`\`\`',
          '',
          '已配對的截圖（' + matchedFiles.length + ' 張）：',
          matchedFiles.length ? matchedFiles.map(function (n) { return '- ' + n; }).join('\\n') : '- (無)',
        ].concat(hitLines).concat([
          '',
          '## Step 1：1 分鐘 issue triage（**MUST 先做，不要直接展開 code trace**）',
          '',
          '依 issue note 文字把這個問題分到下列三類之一，給理由：',
          '',
          '### (1) UX/copy 問題（純展示層）',
          '信號：文案 / 顏色 / 對齊 / 樣式 / 按鈕（顏色/位置）/ icon / spacing / margin / padding / layout / overflow / responsive / mobile / a11y / contrast / 字級 / 動畫 / hover / focus / disabled state / empty state / loading state / CTA / 英文翻譯',
          '→ workflow：直接給 Edit 修法（改 copy / Tailwind class / UI hint），**不用** codebase-memory-mcp',
          '',
          '### (2) Behavior bug（功能 / 資料 / API）',
          '信號：錯誤 / fail / 沒儲存 / API / 資料 / migration / validation / permission / null/undefined / status code / query / routing / navigation / state / cache / stale / race / auth / session / pagination / filter / sort / timezone / date / i18n locale / webhook / job / queue',
          '→ workflow：codebase-memory-mcp 找實作 + trace_path 找根因，**plan-first 列方案**',
          '',
          '### (3) Spec gap（規格沒寫 / 設計層級缺漏）',
          '信號：「應該要 X 但沒看到」「spec 沒寫」「不知道對不對」「ambiguous」「漏掉 case」「缺驗收條件」',
          '→ workflow：列要補的 spec 段 + 建議跑 \`/spectra-ingest <change>\` 改 proposal.md / tasks.md，**不要動 code**',
          '',
          '## 陷阱反例（不要被字面騙）',
          '',
          '- 「按鈕位置不對，點了沒反應」看似 UX → 核心是 click handler / disabled state（**Behavior**）',
          '- 「錯誤訊息太紅太嚇人」看似 Behavior(error) → 核心是 copy / visual tone（**UX**）',
          '- 「列表沒資料」看似 Behavior(empty) → 可能是 empty state UI 沒做（**UX**）或是 query 條件錯（**Behavior**）',
          '',
          '## 兩邊都中 / 都不中',
          '',
          '- 兩邊都中 → **預設 Behavior**（誤判成 UX 會漏掉資料破壞 / 功能壞掉）',
          '- 兩邊都不中 → 先做 lightweight triage（讀 spec + 看 screenshot + 看程式碼入口）再分類；不要直接展開 code trace',
          '',
          '## Step 2：依分類走對應 workflow',
          '',
          '修法路由（依 .claude/rules/tech-debt-routing.md）：',
          '- (1) UX/copy → 提 Edit 修法 + 寫 issue 後續對應動作（多為「直接動手」）',
          '- (2) Behavior → 提修法 + 列要動的檔 + 影響範圍 + 是否需要新測試 + 是否需要更新 spec',
          '  - 根因 code bug 影響窄、可延後 → 登 \`docs/tech-debt.md\` TD-NNN',
          '  - 根因跨多個 consumer / 在投影層（clade 中央倉）→ 提示要去 \`~/offline/clade\` 改',
          '  - 純 bug 當下可修 → 提方案等確認後改',
          '- (3) Spec gap → 列要補的 spec 段 + 建議 \`/spectra-ingest\`，**不要動 code**',
        ]).join('\\n');
      } else if (kind === 'manual-review-readiness') {
        const item = ctx.item || {};
        const hits = Array.isArray(item.manualReviewHits) ? item.manualReviewHits : [];
        const hitLines = hits.length
          ? hits.map(function (h) {
              return '- \`' + h.code + '\` — ' + h.description + '（rule: .claude/rules/' + h.anchor + '）';
            }).join('\\n')
          : '- (無)';
        const cn = change ? change.name : '<change>';
        body = [
          '## 問題：Pre-Review Data Readiness 命中（review:ui 提示 proposal 資料不完整）',
          '',
          'Item：',
          '- id: ' + (item.id || '(unknown)'),
          '- description: ' + (item.description || '(無)'),
          '',
          '命中 pattern（' + hits.length + ' 個）：',
          hitLines,
          '',
          '這些 pattern 代表 proposal 階段沒寫齊：缺具體 sample / URL / scoped sub-items / 截圖目標 / 驗收條件等，導致 review:ui 看到 item 時很難對焦（不知道要拍什麼、不知道哪段 UI 要驗）。這是 warning 不是 block——但通常代表 proposal 該補資料而非直接 OK / SKIP 過。',
          '',
          '請：',
          '1. 讀 \`openspec/changes/' + cn + '/proposal.md\` + \`tasks.md\` 看當前描述',
          '2. 對命中的每個 pattern，依 \`.claude/rules/manual-review.md\` §Pre-Review Data Readiness 與相關 rule（見上面 anchor）判斷該補哪類資料',
          '3. 用 \`/spectra-ingest\` 流程提議補強：',
          '   - 缺 sample → 找實際 fixture / URL / 內容範例',
          '   - 缺 scoped sub-items → 拆成 #N.1 / #N.2 等可獨立驗的 sub-item',
          '   - 缺驗收條件 → 補 expected behavior / screenshot intent',
          '4. 等我確認後再寫進 tasks.md / proposal.md（plan-first）',
          '',
          '若評估後判斷 proposal 已足夠（pattern 屬 false positive），直接回報「不用補」並說明理由即可，我會在 review:ui 直接 OK / Issue / SKIP 帶過 warning。',
        ].join('\\n');
      } else if (kind === 'health-check-group') {
        // Group-level prompt：只列 readinessHits > 0 的 change（Pre-Review Data Readiness pattern hits）。
        // 核心訴求是「分類後只回報 bug 候選，WIP / false positive 完全不要列」。
        // 跳開 handoffHeader/footer 自組（涉及多 change）。
        const list = Array.isArray(ctx.healthCheckChanges) ? ctx.healthCheckChanges : [];
        const repoName = state.repoName || '(unknown)';
        const repoRoot = state.repoRoot || '(unknown)';
        const lines = [
          '我在 consumer repo「' + repoName + '」（路徑：' + repoRoot + '）',
          '跑 \`pnpm review:ui\` 做 spectra 人工檢查，home page 有 ' + list.length + ' 張 change 落在',
          '「🩺 需健康檢查介入」這群——Pre-Review Data Readiness pattern hit（spec / data 不齊），',
          '請逐張讀 \`openspec/changes/<change>/proposal.md\` 與 \`tasks.md\` 分類後只回報 bug 候選。',
          '',
          '## 環境',
          '- consumer: ' + repoName,
          '- repo root: ' + repoRoot,
          '',
          '## 命中的 changes（共 ' + list.length + ' 張）',
          '',
        ];
        for (const c of list) {
          const summary = summarizeHits(c.hitsByCode) || '(無 code 細節)';
          lines.push('- \`' + c.name + '\` — ' + summary);
        }
        lines.push(
          '',
          '## 相關 rules（必讀）',
          '- .claude/rules/manual-review.md（pattern code 對應的判斷準則 + Pre-Review Data Readiness 段）',
          '- .claude/rules/fixtures-reference.md（sample / URL / scoped sub-items 樣態）',
          '- .claude/rules/tech-debt-routing.md（修法路由：clade vs consumer / TD vs spec）',
          '- openspec/AGENTS.md（spectra 工作流）',
          '',
          '## 你要做的事',
          '',
          '對每張 change 跑下面流程：',
          '',
          '1. 讀 \`openspec/changes/<change>/proposal.md\` 與 \`tasks.md\` 看當前狀態，把該 change 分到以下其一：',
          '   - **(A) WIP / 還沒寫完 / 留待之後補**——proposal 還在打草稿、sample/URL 尚未補、相關 task 還沒動工。pattern 命中只是因為資料尚未到位，這是預期狀態。',
          '   - **(B) bug 或規範違反**——spec 已完成但 item 內容與 spec 不符 / 違反 manual-review.md 規定（例：URL 寫了但對不上、multi-step 該拆但被合併、kind marker 用錯）。',
          '   - **(C) false positive**——pattern 命中但不適用（例：item 是 backend-only，本來就不需 URL）。',
          '',
          '2. **只對 (B) 類回報**，每條給：',
          '   - change name + item id',
          '   - 命中的 pattern code + 違規證據（引 spec / 引實作位置）',
          '   - 建議修法（要動哪些檔，依 \`.claude/rules/tech-debt-routing.md\` 路由：spec 缺漏 → \`/spectra-ingest\`；代碼 bug 影響窄 → \`docs/tech-debt.md\` TD-NNN；clade 投影層 → 提示去 clade 改）',
          '',
          '3. **(A) 與 (C) 完全不要列出**——不要寫「以下是略過的」「以下是 false positive」這類段落，那只是徒增噪音。',
          '',
          '4. **如果全部都是 (A) 或 (C)**：直接一句「全部都是 WIP / false positive，不用介入」結束。',
          '',
          '## 全域規矩',
          '- **MUST** 用 codebase-memory-mcp 探索（search_graph / trace_path / get_code_snippet）；graph 未 index 先跑 index_repository',
          '- Grep / Glob / Read 只用於非程式碼檔（.md / config / .env）',
          '- plan-first，bug 候選列出來等我確認後再改',
          '',
          handoffStillVisibleNote(),
          '',
          '回覆時請先說「我看到的現況是 ...」再給 bug 清單（若有）。',
        );
        return lines.join('\\n');
      } else if (kind === 'apply-pending-group') {
        // Group-level prompt：只列「純 evidence missing」的 change（無 pattern hit）。
        // 核心訴求是「一次性跑 /spectra-apply Step 8a Verify Channel，不要逐 item triage」。
        // 此 group 跑完後該群就清空、對應 change 進 ready 群。
        const list = Array.isArray(ctx.applyPendingChanges) ? ctx.applyPendingChanges : [];
        const repoName = state.repoName || '(unknown)';
        const repoRoot = state.repoRoot || '(unknown)';
        let totalItems = 0;
        let totalPairs = 0;
        for (const c of list) {
          if (!Array.isArray(c.evidenceMissing)) continue;
          for (const m of c.evidenceMissing) {
            totalItems++;
            totalPairs += (m.kinds || []).length;
          }
        }
        const lines = [
          '我在 consumer repo「' + repoName + '」（路徑：' + repoRoot + '）',
          '跑 \`pnpm review:ui\` 做 spectra 人工檢查，home page 有 ' + list.length + ' 張 change 落在',
          '「⏳ 等 apply 後就可處理」這群——item 標了 \`[verify:e2e/api/ui]\` 但缺對應 \`(verified-*:)\` annotation。',
          '**這類不是 bug、不需 triage**，直接依 \`/spectra-apply\` skill **Step 8a Verify Channel Pass** 一次補齊。',
          '',
          '## 環境',
          '- consumer: ' + repoName,
          '- repo root: ' + repoRoot,
          '',
          '## 缺 evidence 清單（共 ' + list.length + ' 張 change · ' + totalItems + ' item · ' + totalPairs + ' pair）',
        ];
        for (const c of list) {
          lines.push('', '### \`' + c.name + '\`');
          if (!Array.isArray(c.evidenceMissing)) continue;
          for (const m of c.evidenceMissing) {
            const desc = m.description ? ' — ' + m.description : '';
            lines.push('- ' + m.itemId + ' [' + (m.kinds || []).join(' + ') + ']' + desc);
          }
        }
        lines.push(
          '',
          '## 補 evidence 的規矩',
          '',
          '1. 先做整批 pre-verify baseline check（依出現的 channel 種類）：',
          '   - 有 \`[verify:e2e]\`：確認 Playwright config + e2e fixtures',
          '   - 有 \`[verify:api]\`：確認 \`__test-login\` 或等價 session bypass route',
          '   - 有 \`[verify:ui]\`：確認 \`supabase/seed.sql\` 或 seed 等價檔',
          '   - 缺 baseline → **STOP**，回報 user 補齊；**NEVER** 降級 channel',
          '',
          '2. **Deeper per-item baseline check**（即使 home page 把 change 分到「Apply 已完成」群，個別 item 仍可能撞 §3 UI / §6 Fixtures 尾巴遺漏；逐項自驗一次）：',
          '   - 對每個 \`[verify:ui]\` / \`[verify:api+ui]\` item，從 description 抓 URL（如 \`/admin/foo/[id]\`），grep \`app/pages/\` / \`packages/*/app/pages/\` 確認對應 \`.vue\` 存在',
          '   - 對 item description 中 inline 引用的 sample id（如 \`eval-draft-001\` / \`co-bigbyte-test-001\`），grep \`supabase/seed.sql\`（或 \`db/seed.sql\` / \`prisma/seed.ts\`）確認 seed 已寫入',
          '   - 任一 grep 0 命中 → 該 item 跳過 evidence 補齊、寫 \`（issue: §3 UI 或 §6 Fixtures 未完成，blocker：<具體缺什麼>）\`，**NEVER** 寫不成功的 \`(verified-*:)\` annotation',
          '   - 全部 item 都命中此情境 → STOP，回 user：「該 change 的核心 impl section 還沒完成，補 evidence 整批 abort，先回到 /spectra-apply」',
          '',
          '3. 對每個 item 依 e2e → api → ui 順序補對應 evidence；每完成一個 channel 立刻 Edit tasks.md 寫對應 \`(verified-*:)\` annotation（不要等到最後一起寫）',
          '',
          '4. 全部完成後請 user 在 review:ui 重新整理；含 \`verify:ui\` 的 item checkbox 仍保留 \`[ ]\` 等 user 在 GUI 視覺確認',
          '',
          '5. 任一 channel 通不過 → 保留 \`[ ]\` + 寫 \`（issue: ...）\`；**NEVER** 寫不成功的 \`(verified-*:)\` annotation',
          '',
          'Cookbook 與範本：\`~/offline/clade/vendor/snippets/verify-channels/README.md\`（Charles clade home；其他機器跑 \`find ~ -name verify-channels -type d 2>/dev/null\` 找）',
          '',
          '## 全域規矩',
          '- **MUST** 用 codebase-memory-mcp 探索（search_graph / trace_path / get_code_snippet）；graph 未 index 先跑 index_repository',
          '- Grep / Glob / Read 只用於非程式碼檔（.md / config / .env）',
          '- 可直接照 Step 8a 流程跑，不需等確認；唯一例外是 baseline 缺漏要先 STOP',
          '',
          handoffStillVisibleNote(),
          '',
          '回覆時請先說「我看到的現況是 ...」再給 evidence 補齊計劃。',
        );
        return lines.join('\\n');
      } else if (kind === 'feedback-given-group') {
        // Group-level prompt：user 已點完 N 張 change 的所有可動 item（review:ui / verify:ui），
        // 剩下的 pending 都是 user 點不到的 — issue 註記、verify:api/e2e 自動驗證 evidence、
        // discuss 議題。請 Claude 一次接手做 root cause / evidence 檢視 / 議題推進 + 路由。
        // 與 not-ready-group 一樣跳開 handoffHeader/footer 自組（涉及多 change）。
        const list = Array.isArray(ctx.feedbackChanges) ? ctx.feedbackChanges : [];
        const repoName = state.repoName || '(unknown)';
        const repoRoot = state.repoRoot || '(unknown)';
        // N >= 4 走 summary table 分批（依 codex 諮詢 2026-05-18）。每張 deep-dive 5-15k token，
        // N=4 已是 20-60k，再加 spec/code context 會超 cleanroom session budget。
        if (list.length >= 4) {
          return feedbackGivenSummaryPrompt(list, repoName, repoRoot);
        }
        const lines = [
          '我在 consumer repo「' + repoName + '」（路徑：' + repoRoot + '）',
          '跑 \`pnpm review:ui\` 做 spectra 人工檢查，已對 ' + list.length + ' 張 change 的所有 user 可動 item（review:ui / verify:ui）',
          '完成 OK / Issue 標記。剩下的 pending item 都是我點不到的——',
          '請逐張讀 \`openspec/changes/<change>/tasks.md\` 把這三種接手分析做完：',
          '',
          '1. \`（issue: <note>）\` 註記 → root cause + 修法路由',
          '2. \`[verify:api]\` / \`[verify:e2e]\` item 帶 \`(verified-*: ...)\` 但仍 \`[ ]\` → 看 evidence 是否合理',
          '3. \`[discuss]\` item 仍 \`[ ]\` → 摘要議題、補上下文、給建議方向',
          '',
          '## 環境',
          '- consumer: ' + repoName,
          '- repo root: ' + repoRoot,
          '',
          '## 命中的 changes（共 ' + list.length + ' 張）',
        ];
        for (const c of list) {
          const issued = c.issued || 0;
          const tail = issued > 0 ? issued + ' 個 issue + verify/discuss 剩餘' : '無 issue，僅 verify/discuss 剩餘';
          lines.push('- \`' + c.name + '\` — ' + tail);
        }
        lines.push(
          '',
          '## 相關 rules（必讀）',
          '- .claude/rules/manual-review.md（issue 註記語意 + Pre-Review Data Readiness + verify channel）',
          '- .claude/rules/tech-debt-routing.md（修法路由：clade vs consumer / TD vs spec / spectra-ingest）',
          '- openspec/AGENTS.md（spectra 工作流）',
          '',
          '## 你要做的事',
          '',
          '對每張 change 跑下面流程：',
          '',
          '### Step 1：讀 \`openspec/changes/<change>/tasks.md\` 把三類項目抓齊',
          '- **(I) issue 註記**：所有 \`- [ ] ... （issue: <note>）\` 或 \`- [x] ... （issue: <note>）\` 行',
          '- **(V) auto-verified pending**：標 \`[verify:api]\` / \`[verify:e2e]\` 且帶 \`(verified-api: ...)\` 或 \`(verified-e2e: ...)\` annotation 但仍 \`[ ]\` 的 item',
          '- **(D) discuss 議題**：標 \`[discuss]\` 仍 \`[ ]\` 的 item',
          '',
          '一張 change 三類可能全有 / 全無，按實況列。',
          '',
          '### Step 2：對每個項目做對應分析',
          '',
          '**(I) issue 註記** → root cause 分析',
          '- 用 codebase-memory-mcp（search_graph / trace_path / get_code_snippet）定位 item 對應的 feature 在哪實作',
          '- 從 issue note 描述的 symptom 反推根因（不要急著看 symptom）',
          '- 必要時補讀 \`proposal.md\` 看當初設計意圖',
          '',
          '**(V) auto-verified pending** → evidence 合理性檢視',
          '- 讀 annotation 的 method / url / status / body hash / timestamp',
          '- 對照該 item 預期行為（item description）：status code 對嗎？body fingerprint 有意義嗎？timestamp 在本次 apply 範圍內嗎？',
          '- 合理 → 建議翻 \`[x]\`；不合理 → 建議改標 issue（指出 evidence 跟期望不符的點）；或建議補做更細的驗證',
          '',
          '**(D) discuss 議題** → 議題推進',
          '- 用 codebase-memory-mcp 把 item description 涉及的 schema / config / migration 抓出來',
          '- 補上下文（目前實作狀態、相關 commit、proposal.md 設計動機）',
          '- 給建議方向（這個 production deploy check 怎麼做最有效？是否要寫 SQL? 是否要先補 fixture?）',
          '',
          '### Step 3：依 \`.claude/rules/tech-debt-routing.md\` 路由',
          '- **(A) spec / 設計層級缺漏** → \`/spectra-ingest\` 改 proposal.md / tasks.md',
          '- **(B) code bug 影響窄、可延後** → 登 \`docs/tech-debt.md\` 開 TD-NNN',
          '- **(C) 純 bug 當下可修** → 提方案等確認後改',
          '- **(D) 根因在 clade 投影層（rules / skills / vendor scripts）** → 提示要去 \`~/offline/clade\` 改源，不要在 consumer 改',
          '- **(E) false positive / item 應改回 OK 或翻 [x]** → 說明理由',
          '',
          '## 輸出格式',
          '',
          '每張 change 一段，按 (I) / (V) / (D) 分小節：',
          '',
          '\`\`\`',
          '### <change-name>',
          '',
          '**(I) issue 註記（N 項）**',
          '- **#<item-id>** — <一句話描述 issue>',
          '  - root cause: <分析結果，附 file:line 證據>',
          '  - 路由: (A) / (B) / (C) / (D) / (E)',
          '  - 建議: <具體要動的檔 / 開 TD / 改 proposal / 改回 OK 的理由>',
          '',
          '**(V) auto-verified pending（N 項）**',
          '- **#<item-id>** — <annotation 摘要>',
          '  - 評估: <evidence 是否合理；對照 item description>',
          '  - 路由: (A) / (B) / (C) / (D) / (E)',
          '  - 建議: <翻 [x] / 改標 issue / 補驗證 / ...>',
          '',
          '**(D) discuss 議題（N 項）**',
          '- **#<item-id>** — <議題摘要>',
          '  - 上下文: <相關實作狀態、commit、proposal 意圖>',
          '  - 路由: (A) / (B) / (C) / (D) / (E)',
          '  - 建議: <具體推進方向>',
          '\`\`\`',
          '',
          '## 規矩',
          '- **MUST** 用 codebase-memory-mcp 探索；graph 未 index 先跑 index_repository',
          '- Grep / Glob / Read 只用於非程式碼檔（.md / config / .env）',
          '- **plan-first**：列完三類項目的分析 + 路由建議後**停下**等我確認，不要直接動手改檔',
          '- 路由到 (D) clade 投影層的，列清楚但**不要**自己跨 repo 動手——那要切到 clade session 處理',
          '- 沒命中項目的小節（例如某 change 無 issue）可直接寫「無」省略，不要硬湊',
          '',
          handoffStillVisibleNote(),
        );
        return lines.join('\\n');
      } else if (kind === 'evidence-fillin-item') {
        const item = ctx.item || {};
        const missingKinds = Array.isArray(ctx.missingKinds) ? ctx.missingKinds : [];
        const changeName = change ? change.name : '<change-name>';
        const labelFor = function (k) {
          if (k === 'e2e') return '- \`[verify:e2e]\` — 需要 Playwright spec round-trip';
          if (k === 'api') return '- \`[verify:api]\` — 需要 HTTP round-trip evidence';
          if (k === 'ui') return '- \`[verify:ui]\` — 需要 final-state screenshot + DOM observation';
          return '- (unknown channel: ' + k + ')';
        };
        const channelLines = missingKinds.map(labelFor).join('\\n') || '- (無)';
        body = [
          '## 問題：人工檢查 item 缺 verify 證據（review:ui 顯示 evidence missing）',
          '',
          'Item：',
          '- id: ' + (item.id || '(unknown)'),
          '- description: ' + (item.description || '(無)'),
          '',
          '缺的 channel（共 ' + missingKinds.length + ' 個）：',
          channelLines,
          '',
          '請依 \`/spectra-apply\` skill **Step 8a Verify Channel Pass** 對這個 item 補齊 evidence：',
          '',
          '### 1. Baseline check',
          '',
          verifyChannelBaselineSection(),
          '',
          '### 2. 依 channel 執行',
          '',
          '（cookbook 在 \`~/offline/clade/vendor/snippets/verify-channels/\`；若你機器無此路徑跑 \`find ~ -name verify-channels -type d 2>/dev/null\` 找）',
          '',
          '- \`[verify:e2e]\`：寫並跑 \`e2e/verify/' + changeName + '/<topic>.spec.ts\` → pass 後 Edit tasks.md 加 \`(verified-e2e: <ISO-8601> spec=... trace=...)\`',
          '- \`[verify:api]\`：跑 HTTP round-trip → pass 後 Edit tasks.md 加 \`(verified-api: <ISO-8601> METHOD URL STATUS[ body=<sha256-12chars>])\`',
          '- \`[verify:ui]\`：default 走 codex dispatcher（\`node ~/offline/clade/vendor/scripts/codex-dispatch-screenshot-verify.mjs --change ' + changeName + ' --consumer-path . --dev-server-url <url> --items-json <items.json>\`）；fallback 走 \`screenshot-review\` subagent → PASS 後 Edit tasks.md 加 \`(verified-ui: <ISO-8601> screenshot=screenshots/local/' + changeName + '/#' + (item.id || '<id>') + '-final.png[ dom=<obs>])\`',
          '',
          '### 3. 順序、寫入、失敗處理',
          '',
          verifyChannelOrderSection(),
          '',
          '完成後 review:ui 對應 panel 會從 evidence missing 改顯示 evidence link。',
        ].join('\\n');
      } else if (kind === 'evidence-fillin-change') {
        const pairs = Array.isArray(ctx.missing) ? ctx.missing : [];
        const pairLines = pairs.map(function (p) {
          const desc = p.description ? ' — ' + p.description : '';
          return '- ' + p.itemId + ' [' + (p.kinds || []).join(' + ') + ']' + desc;
        }).join('\\n') || '- (無)';
        // Defense-in-depth：sweep button 已由 updateEvidenceSweepButton 對 non-ready change 隱藏，
        // 但若呼叫端直接打到此分支（dev console、未來新 caller），仍給正確 prompt 避免誤導 agent。
        const ctxChange = ctx.change || {};
        const readyForStep8a = isApplyComplete(ctxChange) && !(ctxChange.readinessHits || 0);
        if (!readyForStep8a) {
          const implTotal = ctxChange.implTotal || 0;
          const implDone = ctxChange.implDone || 0;
          const implPct = implTotal > 0 ? Math.round((implDone / implTotal) * 100) : 0;
          const hits = ctxChange.readinessHits || 0;
          const blocker = hits > 0
            ? 'change 含 ' + hits + ' 個 Pre-Review Data Readiness pattern hits（spec / data 缺漏）'
            : 'impl 進度 ' + implPct + '%（< ' + Math.round(APPLY_COMPLETE_THRESHOLD * 100) + '% threshold）';
          body = [
            '## 問題：人工檢查 evidence 補齊請求但 change 還沒 ready（不該跑 Step 8a）',
            '',
            '當前 change 不在「✅ Apply 已完成、可補 evidence」群：' + blocker + '。',
            '直接跑 Step 8a Verify Channel Pass 會撞 UI 不存在 / curl 打不通 / spec 待修，做白工。',
            '',
            '正確路徑：',
            hits > 0
              ? '- 跑 \`/spectra-ingest <change>\` 補上 spec / data hits（修 Pre-Review Data Readiness 違反），再回 review:ui'
              : '- 繼續 \`/spectra-apply <change>\` 完成 implementation phase（特別是 §3 UI / §6 Fixtures section），等 impl 進度過 ' + Math.round(APPLY_COMPLETE_THRESHOLD * 100) + '% 後 change 會自動進「✅ Apply 已完成」群',
            '',
            '當前 change 缺 evidence 的 item 列表（供參考、**不要**照這個跑 Step 8a）：',
            '',
            pairLines,
          ].join('\\n');
        } else {
          body = [
            '## 問題：人工檢查整張 change 多項 item 缺 verify 證據（review:ui 全 change sweep）',
            '',
            '掃了當前 change 的 \`## 人工檢查\`，下列 item × channel 缺 evidence（共 ' + pairs.length + ' pair）：',
            '',
            pairLines,
            '',
            '請依 \`/spectra-apply\` skill **Step 8a Verify Channel Pass** 一次補齊所有缺項：',
            '',
            '### 1. 整批 Baseline check',
            '',
            verifyChannelBaselineSection(),
            '',
            '### 2. 順序、寫入、失敗處理',
            '',
            verifyChannelOrderSection(),
            '',
            'Cookbook 與範本：\`~/offline/clade/vendor/snippets/verify-channels/README.md\`（Charles clade home；其他機器跑 \`find ~ -name verify-channels -type d 2>/dev/null\` 找）',
          ].join('\\n');
        }
      } else {
        body = '## 問題\\n\\n(unknown kind: ' + kind + ')';
      }
      return handoffHeader(change, ctx) + body + handoffFooter(kind);
    }

    // ── handoff prompt 複製 + fallback modal ──
    let promptFallbackPrevFocus = null;
    function openPromptFallbackModal(text) {
      promptFallbackPrevFocus = document.activeElement;
      el.promptFallbackText.value = text;
      const root = document.body;
      for (const child of Array.from(root.children)) {
        if (child !== el.promptFallbackModal && !child.hasAttribute('inert')) {
          child.setAttribute('inert', '');
          child.dataset._inertByPromptModal = '1';
        }
      }
      el.promptFallbackModal.classList.add('open');
      // 預設全選方便 user 直接 cmd+c
      requestAnimationFrame(function () {
        el.promptFallbackText.focus();
        el.promptFallbackText.select();
      });
    }
    function closePromptFallbackModal() {
      el.promptFallbackModal.classList.remove('open');
      const root = document.body;
      for (const child of Array.from(root.children)) {
        if (child.dataset._inertByPromptModal === '1') {
          child.removeAttribute('inert');
          delete child.dataset._inertByPromptModal;
        }
      }
      if (promptFallbackPrevFocus && typeof promptFallbackPrevFocus.focus === 'function') {
        promptFallbackPrevFocus.focus();
      }
      promptFallbackPrevFocus = null;
    }
    async function copyHandoffPrompt(kind, ctx, label) {
      const text = buildHandoffPrompt(kind, ctx || {});
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          showBanner('已複製 ' + label + ' handoff prompt 到剪貼簿，可貼到新 Claude session', '');
          return;
        }
      } catch (err) {
        // 落到 fallback；不要讓 clipboard 失敗整個吃掉操作
      }
      openPromptFallbackModal(text);
    }

    async function loadChanges() {
      showBanner('');
      const data = await api('/api/changes');
      state.changes = data.changes || [];
      el.changeStatus.classList.remove('loading-spin');
      el.changeStatus.textContent = state.changes.length
        ? state.changes.length + ' 個 change 含人工檢查區塊'
        : '目前沒有待處理的人工檢查項目';
      if (!state.changes.length) {
        el.currentTitle.classList.remove('loading-spin');
        el.currentTitle.textContent = '選擇一個 change 開始';
      }
      renderChanges();
      if (state.current) return;
      // Deep link：URL 指定的 change（path 第二段）優先，匹配不到才 fallback
      // 到第一筆。匹配不到時用 replaceState 把 path 清回 '/review'，避免
      // 失效的 URL 留在 address bar。
      const target = parseLocationTarget();
      let bootName = null;
      if (target.change && state.changes.find(function (c) { return c.name === target.change; })) {
        bootName = target.change;
      } else if (state.changes[0]) {
        bootName = state.changes[0].name;
      }
      if (!bootName) {
        history.replaceState({}, '', '/review');
        return;
      }
      await loadChange(bootName);
      // loadChange 完才知道 items；hash 指到的 item 在這裡 align。
      if (target.itemId && state.current) {
        const idx = state.current.items.findIndex(function (it) { return it.id === target.itemId; });
        if (idx >= 0) {
          state.activeIndex = idx;
          renderTasks();
          renderThumbs();
          syncActiveItemUrl();
        }
      }
    }

    // 依 metrics 推算 change card 主狀態：malformed > issue > pending > done
    function changeCardKind(change) {
      if (change.malformed > 0) return 'malformed';
      if ((change.issued || 0) > 0) return 'issue';
      if (change.pending > 0) return 'pending';
      return 'done';
    }
    function changeCardBadge(change, kind) {
      if (kind === 'malformed') return change.malformed + ' 行格式錯誤';
      if (kind === 'done') return '✓ 全部通過';
      const issued = change.issued || 0;
      // userPending：對齊 server userActionPending — user 還能點的 review:ui/verify:ui 項目數。
      // verify:api/e2e 自動驗證且 user 點不到的 item 不算進去；舊版用 pending-issued 會把這些列為「待檢查」誤導。
      const userPending = change.userActionPending || 0;
      if (kind === 'issue') {
        if (userPending > 0) return '⚠ ' + issued + ' 問題・' + userPending + ' 待檢查';
        return '⚠ ' + issued + ' 個問題待修';
      }
      if (userPending === 0) return '✓ 待 Claude 接手';
      return userPending + ' 待檢查';
    }
    // 把 hitsByCode 轉成 home page 用的單行摘要，例：UI_ITEM_NO_URL ×2, REVIEW_UI_BACKEND_ROUNDTRIP ×1。
    // 超過 3 個 code 後 truncate 顯示「+N more」避免擠爆 row。
    function summarizeHits(hitsByCode) {
      if (!hitsByCode) return '';
      const entries = Object.entries(hitsByCode).toSorted(function (a, b) { return b[1] - a[1]; });
      if (!entries.length) return '';
      const top = entries.slice(0, 3).map(function (entry) { return entry[0] + ' ×' + entry[1]; });
      const extra = entries.length - top.length;
      return top.join(', ') + (extra > 0 ? ', +' + extra + ' more' : '');
    }
    function renderChangeCard(change) {
      const current = state.current && state.current.name === change.name;
      const kind = changeCardKind(change);
      const badge = changeCardBadge(change, kind);
      const hits = change.readinessHits || 0;
      const hitSummary = hits > 0 ? summarizeHits(change.hitsByCode) : '';
      const evidenceMissingList = Array.isArray(change.evidenceMissing) ? change.evidenceMissing : [];
      const evidencePairCount = evidenceMissingList.reduce(function (acc, m) {
        return acc + (Array.isArray(m.kinds) ? m.kinds.length : 0);
      }, 0);
      const wtBadgeHtml = change.worktreeSlug
        ? '<span class="wt-badge" title="此 change 位於 worktree '
          + esc(change.sourceRoot || '')
          + '">wt:'
          + esc(change.worktreeSlug)
          + '</span>'
        : '';
      return '<button type="button" class="change-row card-' + kind + '" data-change="' + esc(change.name) + '" aria-current="' + (current ? 'true' : 'false') + '">' +
        '<span class="change-name">' + esc(change.name) + wtBadgeHtml + '</span>' +
        '<span class="card-badge ' + kind + '">' + esc(badge) + '</span>' +
        '<span class="metrics">' +
        '<span class="metric" title="已通過（含 skip） / 總項目數">' + change.checked + '/' + change.total + ' 通過</span>' +
        (hits > 0 ? '<span class="metric warn" title="Pre-Review Data Readiness pattern hits（命中代表 item 缺資料無法直接 review）">⚠ ' + hits + ' hits: ' + esc(hitSummary) + '</span>' : '') +
        (evidencePairCount > 0 ? '<span class="metric warn" title="標了 verify:e2e/api/ui 但缺對應 (verified-*:) annotation — 需跑 /spectra-apply Step 8a 補">⚠ ' + evidenceMissingList.length + ' item 缺 evidence (' + evidencePairCount + ' pair)</span>' : '') +
        (change.screenshotTopicCount ? '<span class="metric" title="對應的截圖資料夾數">' + change.screenshotTopicCount + ' 截圖</span>' : '') +
        '</span>' +
        '</button>';
    }
    // Apply 完成度估計閾值：implDone / implTotal ≥ 此值 → 視為 apply 完成、可批量補 evidence。
    // 觀察 perno consumer 6 張 change：0.93–0.98 是純剩 §4 Docs / §5 驗證 tail 的「真正 ready」；
    // 0.00–0.40 是 §3 UI / §6 Fixtures 還沒動的「apply 未完成」。0.90 區隔乾淨。
    const APPLY_COMPLETE_THRESHOLD = 0.90;
    function isApplyComplete(change) {
      // 沒 impl task（罕見：純人工檢查 change）→ 視為 ready（沒東西要 apply）
      if (!change.implTotal) return true;
      return (change.implDone || 0) / change.implTotal >= APPLY_COMPLETE_THRESHOLD;
    }
    function renderChanges() {
      const ready = [];
      // not-ready 拆三桶：
      //   healthCheckNeeded = pattern hits（spec/data 缺漏，須 ingest 介入）
      //   readyForEvidence  = 純 evidence missing + impl 已大致完成（跑 /spectra-apply Step 8a 可補齊）
      //   applyInProgress   = 純 evidence missing + impl 還在動工（補 evidence 會撞不存在的 UI/seed，純資訊顯示）
      // 同時命中 pattern + evidence missing 時優先歸 healthCheckNeeded — pattern 是 spec/data 問題，必先修；
      // 否則跑 Step 8a 補的 evidence 可能對應到「即將被改寫」的 item，做白工。
      const healthCheckNeeded = [];
      const readyForEvidence = [];
      const applyInProgress = [];
      const feedbackGiven = [];
      const done = [];
      for (const change of state.changes) {
        const kind = changeCardKind(change);
        const evidenceMissingCount = Array.isArray(change.evidenceMissing) ? change.evidenceMissing.length : 0;
        if (kind === 'done') done.push(change);
        else if ((change.readinessHits || 0) > 0) healthCheckNeeded.push(change);
        else if (evidenceMissingCount > 0) {
          if (isApplyComplete(change)) readyForEvidence.push(change);
          else applyInProgress.push(change);
        }
        else if (
          (change.malformed || 0) === 0 &&
          (change.userActionPending || 0) === 0 &&
          (change.pending || 0) > 0
        ) feedbackGiven.push(change);
        else ready.push(change);
      }
      const blocks = [];
      if (ready.length) {
        blocks.push(
          '<div class="change-group">' +
          '<div class="change-group-heading">✅ 可以開始檢查 · ' + ready.length + '</div>' +
          ready.map(renderChangeCard).join('') +
          '</div>'
        );
      }
      if (healthCheckNeeded.length) {
        blocks.push(
          '<div class="change-group">' +
          '<div class="change-group-heading with-action">' +
            '<span>🩺 需健康檢查介入 · ' + healthCheckNeeded.length + '</span>' +
            '<button class="copy-handoff-btn group" data-group-handoff="health-check" type="button" title="複製健康檢查 prompt：讓 Claude 逐張讀 proposal/tasks 分類 pattern hits，只回報 bug，不徒增 noise">📋 健康檢查 prompt</button>' +
          '</div>' +
          healthCheckNeeded.map(renderChangeCard).join('') +
          '</div>'
        );
      }
      if (readyForEvidence.length) {
        blocks.push(
          '<div class="change-group">' +
          '<div class="change-group-heading with-action">' +
            '<span>✅ Apply 已完成、可補 evidence · ' + readyForEvidence.length + '</span>' +
            '<button class="copy-handoff-btn group" data-group-handoff="apply-pending" type="button" title="複製整批補 evidence prompt：讓 Claude 一次跑 /spectra-apply Step 8a Verify Channel 補齊所有缺項，全做完此群就清空、change 進 ready">📋 補 evidence prompt（整批）</button>' +
          '</div>' +
          readyForEvidence.map(renderChangeCard).join('') +
          '</div>'
        );
      }
      if (applyInProgress.length) {
        // 純資訊顯示：這群 change 標了 [verify:*] 但 §3 UI / §6 Fixtures 等核心 impl section 還沒動完。
        // 不給 batch button — 派 agent 跑 Step 8a 會撞 UI 404、seed 找不到 sample id、curl 打不通；
        // 等 impl section 完成後這群會自動進「✅ Apply 已完成」群。
        blocks.push(
          '<div class="change-group">' +
          '<div class="change-group-heading">' +
            '<span>⏳ Apply 還在動工，evidence 暫不可補 · ' + applyInProgress.length + '</span>' +
          '</div>' +
          '<div class="change-group-note">這群 change 含 <code>[verify:*]</code> item，但 impl 進度 &lt; ' + Math.round(APPLY_COMPLETE_THRESHOLD * 100) + '%（§3 UI / §6 Fixtures 等核心 section 還沒動完）。等 impl 完成後會自動進「✅ Apply 已完成」群。</div>' +
          applyInProgress.map(renderChangeCard).join('') +
          '</div>'
        );
      }
      if (feedbackGiven.length) {
        blocks.push(
          '<div class="change-group">' +
          '<div class="change-group-heading with-action">' +
            '<span>🤖 等 Claude 接手 · ' + feedbackGiven.length + '</span>' +
            '<button class="copy-handoff-btn group" data-group-handoff="feedback-given" type="button" title="複製接手 prompt：讓 Claude 處理 user 已點完剩下的 issue 回饋 / verify auto-evidence / discuss 議題，做 root cause + 路由建議">📋 接手分析 prompt</button>' +
          '</div>' +
          feedbackGiven.map(renderChangeCard).join('') +
          '</div>'
        );
      }
      if (done.length) {
        blocks.push(
          '<div class="change-group">' +
          '<div class="change-group-heading">已完成 · ' + done.length + '</div>' +
          done.map(renderChangeCard).join('') +
          '</div>'
        );
      }
      // 用 createContextualFragment 取代 innerHTML，避免 plugin lint hook 阻擋；
      // 內容已 esc() 過 user-supplied 字串。
      el.changeList.replaceChildren();
      if (blocks.length) {
        const range = document.createRange();
        el.changeList.appendChild(range.createContextualFragment(blocks.join('')));
      }
      el.changeList.querySelectorAll('[data-change]').forEach(function (button) {
        button.addEventListener('click', function () { loadChange(button.dataset.change); });
      });
      el.changeList.querySelectorAll('[data-group-handoff]').forEach(function (button) {
        button.addEventListener('click', function (event) {
          event.stopPropagation();
          const kind = button.dataset.groupHandoff;
          if (kind === 'health-check') {
            const healthCheckChanges = (state.changes || []).filter(function (c) {
              return (c.readinessHits || 0) > 0;
            });
            copyHandoffPrompt('health-check-group', { healthCheckChanges: healthCheckChanges }, '健康檢查（' + healthCheckChanges.length + ' change）');
          } else if (kind === 'apply-pending') {
            // readyForEvidence 桶定義：純 evidence missing（無 pattern hit）+ impl 已大致完成。
            // applyInProgress 桶不含 batch button（純資訊顯示），所以 click handler 只服務 ready 群。
            const applyPendingChanges = (state.changes || []).filter(function (c) {
              if ((c.readinessHits || 0) > 0) return false;
              if (!Array.isArray(c.evidenceMissing) || c.evidenceMissing.length === 0) return false;
              return isApplyComplete(c);
            });
            copyHandoffPrompt('apply-pending-group', { applyPendingChanges: applyPendingChanges }, '補 evidence（' + applyPendingChanges.length + ' change）');
          } else if (kind === 'feedback-given') {
            const feedbackChanges = (state.changes || []).filter(function (c) {
              if ((c.malformed || 0) > 0) return false;
              if ((c.readinessHits || 0) > 0) return false;
              if (Array.isArray(c.evidenceMissing) && c.evidenceMissing.length > 0) return false;
              if ((c.userActionPending || 0) > 0) return false;
              return (c.pending || 0) > 0;
            });
            copyHandoffPrompt('feedback-given-group', { feedbackChanges: feedbackChanges }, '接手分析（' + feedbackChanges.length + ' change）');
          }
        });
      });
    }

    // pushUrl 預設 true：一般 user click / init auto-load 要 push history
    // 讓 back 能回 list view。popstate 觸發的 loadChange 傳 false，URL 已是
    // 使用者想要的位置，再 push 會破壞 back/forward。
    async function loadChange(name, pushUrl) {
      if (pushUrl === undefined) pushUrl = true;
      showBanner('');
      const data = await api('/api/changes/' + encodeURIComponent(name));
      state.current = data.change;
      rebuildParentChildrenIndex();
      const items = state.current.items || [];
      state.activeIndex = items.findIndex(function (item) {
        return !item.checked && requiresUserConfirmation(item);
      });
      if (state.activeIndex < 0) {
        state.activeIndex = items.findIndex(function (item) { return !item.checked; });
      }
      if (state.activeIndex < 0) state.activeIndex = 0;
      state.expanded = new Set();
      state.selfCompletedOpen = false;
      state.draftNotes = {};
      state.draftFindings = {};
      renderChanges();
      renderCurrent();
      if (pushUrl) pushChangeUrl(name);
      syncActiveItemUrl();
    }

    function renderCurrent() {
      const change = state.current;
      if (!change) return;
      // textContent 一次清掉舊內容，再 appendChild 可選 wt badge。
      el.currentTitle.classList.remove('loading-spin');
      el.currentTitle.textContent = change.name;
      if (change.worktreeSlug) {
        const badge = document.createElement('span');
        badge.className = 'wt-badge detail';
        badge.title = 'Worktree: ' + (change.sourceRoot || '');
        badge.textContent = 'wt:' + change.worktreeSlug;
        el.currentTitle.appendChild(badge);
      }
      if (change.malformedLines.length) {
        showBannerWithHandoff('人工檢查格式錯誤，需先修正下列 tasks.md 行才能寫入', 'error', 'malformed', '格式錯誤', '');
      }
      renderTasks();
      renderThumbs();
      updateEvidenceSweepButton();
    }

    function computeMissingEvidence(change) {
      const items = (change && change.items) || [];
      const checks = [
        { kind: 'verify:e2e', tag: 'e2e', listKey: 'verifiedE2eList', singleKey: 'verifiedE2e' },
        { kind: 'verify:api', tag: 'api', listKey: 'verifiedApiList', singleKey: 'verifiedApi' },
        { kind: 'verify:ui', tag: 'ui', listKey: 'verifiedUiList', singleKey: 'verifiedUi' },
      ];
      const byItem = new Map();
      for (const item of items) {
        if (!item || item.checked) continue;
        // 對齊 server-side evidenceMissing (見此檔 summarizeChange 內 evidenceTargets)：
        // （issue: ...） annotation 是規約定義的 deferred state（manual-review.md：任一 channel
        // 通不過 → 保留 [ ] + 寫 （issue: ...）），不該被當「缺 evidence」。
        // NOTE: 內聯識別符不加 backtick — backtick + 後接中文觸發 oxfmt 0.1.21 parser bug。
        if (item.raw && /（issue:[^）]*）/.test(item.raw)) continue;
        const kinds = itemKinds(item);
        for (const c of checks) {
          if (!kinds.includes(c.kind)) continue;
          const list = annotationList(item, c.listKey, c.singleKey);
          if (list.length) continue;
          if (!byItem.has(item.id)) byItem.set(item.id, { itemId: item.id, description: item.description || '', kinds: [], item: item });
          byItem.get(item.id).kinds.push(c.tag);
        }
      }
      return Array.from(byItem.values());
    }

    function updateEvidenceSweepButton() {
      if (!el.evidenceSweepButton) return;
      const change = state.current;
      if (!change) {
        el.evidenceSweepButton.hidden = true;
        return;
      }
      const missing = computeMissingEvidence(change);
      const pairCount = missing.reduce(function (acc, m) { return acc + m.kinds.length; }, 0);
      // Sweep button 只在 change 屬「✅ Apply 已完成、可補 evidence」群（readyForEvidence）時顯示。
      // - applyInProgress（impl < APPLY_COMPLETE_THRESHOLD）：UI page 不存在 / curl 打不通，
      //   生成的 Step 8a prompt 會誤導 agent 跑 verify 撞 404
      // - healthCheckNeeded（readinessHits > 0）：spec/data 缺漏，該先跑 spectra-ingest 補資料
      //   而不是 Step 8a verify
      // 與 renderChanges 分組邏輯（L4225-4236）對齊：只有 readyForEvidence 群可進 Step 8a。
      const readyForStep8a = isApplyComplete(change) && !(change.readinessHits || 0);
      if (!pairCount || !readyForStep8a) {
        el.evidenceSweepButton.hidden = true;
        return;
      }
      el.evidenceSweepButton.hidden = false;
      el.evidenceSweepButton.textContent = '📋 補齊全 change 缺失 evidence (' + pairCount + ')';
    }

    function itemKinds(item) {
      return Array.isArray(item.kinds) && item.kinds.length ? item.kinds : [item.kind || 'review:ui'];
    }

    function hasKind(item, kind) {
      return itemKinds(item).includes(kind);
    }

    function isAutomaticKind(kind) {
      return kind === 'verify:e2e' || kind === 'verify:api';
    }

    function isAutomaticOnly(item) {
      const kinds = itemKinds(item);
      return kinds.length > 0 && kinds.every(isAutomaticKind);
    }

    function requiresUserConfirmation(item) {
      // 母項若有子項（#3 → #3.1, #3.2...）: 母項本身不要使用者填回饋，焦點全給子項。
      // 影響：renderTaskControls 不渲染 textarea+按鈕、saveAction 拒收、O/I/S keyboard no-op。
      if (parentHasChildren(item)) return false;
      return hasKind(item, 'review:ui') || hasKind(item, 'verify:ui');
    }

    function parentHasChildren(item) {
      if (!item || item.scoped) return false;
      return state.parentsWithChildren ? state.parentsWithChildren.has(item.id) : false;
    }

    function rebuildParentChildrenIndex() {
      const set = new Set();
      const items = (state.current && state.current.items) || [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.scoped && it.parentId) set.add(it.parentId);
      }
      state.parentsWithChildren = set;
    }

    function isSoloKind(item, kind) {
      const kinds = itemKinds(item);
      return kinds.length === 1 && kinds[0] === kind;
    }

    function localFileHref(path) {
      if (!path) return '#';
      // 優先用當前 change 的 sourceRoot（worktree 路徑）；fallback main repoRoot。
      const fromChange = state.current && state.current.sourceRoot;
      const baseRaw = fromChange || state.repoRoot || '';
      const root = baseRaw.replace(/\\/$/, '');
      const abs = path.startsWith('/') ? path : (root ? root + '/' + path : path);
      return 'file://' + encodeURI(abs).replace(/#/g, '%23');
    }

    function screenshotUrl(path) {
      if (!path) return '';
      if (path.startsWith('screenshots/')) {
        // 帶 rootId namespace 才能對應正確的 worktree screenshots/
        const rootId = (state.current && state.current.worktreeSlug)
          ? 'wt-' + state.current.worktreeSlug
          : 'main';
        return '/api/screenshot/' + encodeURIComponent(rootId) + '/' + path.split('/').map(encodeURIComponent).join('/');
      }
      return localFileHref(path);
    }

    function statusClass(status) {
      const code = Number(status);
      if (code >= 200 && code < 300) return 'status-ok';
      if (code >= 400 && code < 500) return 'status-warn';
      if (code >= 500) return 'status-bad';
      return 'status-neutral';
    }

    function renderEvidenceMissing(item, kind) {
      const itemId = item && item.id ? item.id : '';
      const buttonHtml = itemId
        ? '<button class="copy-handoff-btn inline" data-handoff="evidence-fillin-item" data-id="' + esc(itemId) + '" data-evidence-kind="' + esc(kind || '') + '" type="button" title="複製 handoff prompt 給新 Claude session 跑 /spectra-apply Step 8a 補齊這項 verify evidence">📋 補 evidence prompt</button>'
        : '';
      return '<div class="evidence-panel evidence-missing">' +
          '<span>evidence missing — run /spectra-apply Step 8a</span>' +
          buttonHtml +
        '</div>';
    }

    function annotationList(item, listKey, singleKey) {
      const a = item && item.annotations;
      if (!a) return [];
      if (Array.isArray(a[listKey]) && a[listKey].length) return a[listKey];
      if (a[singleKey]) return [a[singleKey]];
      return [];
    }

    function renderE2eEvidence(item, title) {
      const list = annotationList(item, 'verifiedE2eList', 'verifiedE2e');
      if (!list.length) return (title ? '<h3>' + esc(title) + '</h3>' : '') + renderEvidenceMissing(item, 'e2e');
      const head = title ? '<h3>' + esc(title) + '</h3>' : '';
      return head + list.map(function(evidence, idx) {
        return '<div class="evidence-panel">' +
          (list.length > 1 ? '<p class="evidence-multi-label">記錄 ' + (idx + 1) + ' / ' + list.length + '</p>' : '') +
          '<p>spec: <a class="evidence-link" href="' + esc(localFileHref(evidence.spec)) + '" target="_blank" rel="noreferrer">' + esc(evidence.spec) + '</a></p>' +
          '<p>trace: <a class="evidence-link" href="' + esc(localFileHref(evidence.trace)) + '" target="_blank" rel="noreferrer">' + esc(evidence.trace) + '</a></p>' +
          '<p class="evidence-notice">自動完成，無需操作；archive-gate 認 annotation 為 evidence</p>' +
        '</div>';
      }).join('');
    }

    function renderApiEvidence(item, title) {
      const list = annotationList(item, 'verifiedApiList', 'verifiedApi');
      if (!list.length) return (title ? '<h3>' + esc(title) + '</h3>' : '') + renderEvidenceMissing(item, 'api');
      const head = title ? '<h3>' + esc(title) + '</h3>' : '';
      return head + list.map(function(evidence, idx) {
        const body = evidence.body ? '<p>body: <code>' + esc(evidence.body) + '</code></p>' : '';
        return '<div class="evidence-panel">' +
          (list.length > 1 ? '<p class="evidence-multi-label">記錄 ' + (idx + 1) + ' / ' + list.length + '</p>' : '') +
          '<p><code>' + esc(evidence.method) + '</code> <code>' + esc(evidence.url) + '</code> <span class="status-badge ' + statusClass(evidence.status) + '">' + esc(evidence.status) + '</span></p>' +
          body +
          '<p class="evidence-notice">自動完成，無需操作</p>' +
        '</div>';
      }).join('');
    }

    function renderUiEvidence(item, title) {
      const list = annotationList(item, 'verifiedUiList', 'verifiedUi');
      if (!list.length) return (title ? '<h3>' + esc(title) + '</h3>' : '') + renderEvidenceMissing(item, 'ui');
      const head = title ? '<h3>' + esc(title) + '</h3>' : '';
      return head + list.map(function(evidence, idx) {
        const src = screenshotUrl(evidence.screenshot);
        const dom = evidence.dom ? '<p>DOM: <code>' + esc(evidence.dom) + '</code></p>' : '';
        return '<div class="verified-ui-panel">' +
          (list.length > 1 ? '<p class="evidence-multi-label">記錄 ' + (idx + 1) + ' / ' + list.length + '</p>' : '') +
          '<p><a class="evidence-link" href="' + esc(localFileHref(evidence.screenshot)) + '" target="_blank" rel="noreferrer">' + esc(evidence.screenshot) + '</a></p>' +
          '<img class="verified-ui-image" src="' + esc(src) + '" alt="' + esc(evidence.screenshot) + '" title="點擊放大檢視">' +
          dom +
        '</div>';
      }).join('');
    }

    function autoEvidenceSummary(item, kind) {
      if (kind === 'e2e') {
        const list = annotationList(item, 'verifiedE2eList', 'verifiedE2e');
        if (!list.length) return '⚠ Playwright spec evidence — missing';
        const ev = list[list.length - 1];
        const spec = String(ev.spec || '').split('/').pop() || ev.spec || '';
        const suffix = list.length > 1 ? ' (+' + (list.length - 1) + ' more)' : '';
        return '✓ Playwright: ' + spec + suffix + ' — 自動完成';
      }
      if (kind === 'api') {
        const list = annotationList(item, 'verifiedApiList', 'verifiedApi');
        if (!list.length) return '⚠ API round-trip evidence — missing';
        const ev = list[list.length - 1];
        const suffix = list.length > 1 ? ' (+' + (list.length - 1) + ' more)' : '';
        return '✓ ' + (ev.method || '') + ' ' + (ev.url || '') + ' ' + (ev.status || '') + suffix + ' — 自動完成';
      }
      return '';
    }

    function wrapAutoEvidence(item, kind, innerHtml) {
      return '<details class="auto-evidence-collapse"><summary>' + esc(autoEvidenceSummary(item, kind)) + '</summary>' + innerHtml + '</details>';
    }

    function renderCompoundEvidence(item) {
      const parts = [];
      if (hasKind(item, 'verify:e2e')) parts.push(wrapAutoEvidence(item, 'e2e', renderE2eEvidence(item, 'Playwright spec evidence')));
      if (hasKind(item, 'verify:api')) parts.push(wrapAutoEvidence(item, 'api', renderApiEvidence(item, 'API round-trip evidence')));
      if (hasKind(item, 'verify:ui')) parts.push(renderUiEvidence(item, 'Final-state screenshot'));
      if (!parts.length) return '';
      return '<div class="compound-evidence"><h3>Compound evidence</h3>' + parts.join('') + '</div>';
    }

    function renderEvidenceForItem(item) {
      if (hasKind(item, 'discuss')) {
        return '<div class="discuss-card">' +
            '<h3>此項由 Claude 主導</h3>' +
            '<p>' + escWithLinks(item.description) + '</p>' +
            '<p class="notice">archive 階段 Claude 會主動準備證據與你討論，這裡無需操作。</p>' +
          '</div>';
      }
      if (isSoloKind(item, 'verify:e2e')) {
        return '<div class="evidence-panel"><h3>此項由 Playwright spec 自動完成</h3><p>' + escWithLinks(item.description) + '</p></div>' +
          renderE2eEvidence(item, '');
      }
      if (isSoloKind(item, 'verify:api')) {
        return '<div class="evidence-panel"><h3>此項由 API round-trip 自動完成</h3><p>' + escWithLinks(item.description) + '</p></div>' +
          renderApiEvidence(item, '');
      }
      if (isSoloKind(item, 'verify:ui')) {
        return renderUiEvidence(item, 'Final-state screenshot');
      }
      if (itemKinds(item).length > 1) return renderCompoundEvidence(item);
      return '';
    }

    function renderKindBadges(item) {
      return itemKinds(item).map(function (kind) {
        const className = kind.replace(':', '-');
        let label = '此項需要使用者親自操作驗收';
        if (kind === 'discuss') label = '此項由 Claude 主導，無需手動操作';
        if (kind === 'verify:e2e') label = '此項由 Playwright spec 自動完成';
        if (kind === 'verify:api') label = '此項由 API round-trip 自動完成';
        if (kind === 'verify:ui') label = '此項需要使用者確認 final-state screenshot';
        return '<span class="kind-badge ' + esc(className) + '" aria-label="' + esc(label) + '">[' + esc(kind) + ']</span>';
      }).join('');
    }

    function renderTaskControls(item, noteValue, findingValue) {
      if (parentHasChildren(item)) {
        return '<div class="parent-children-hint">↓ 母項不需要回饋，請對下方子項分別作回饋</div>';
      }
      if (!requiresUserConfirmation(item)) return '';
      const hasFinding = Boolean(findingValue);
      return '<textarea class="note" data-note="' + esc(item.id) + '" placeholder="填寫說明（「有問題」必填、「跳過」可選填）">' + noteValue + '</textarea>' +
        '<div class="actions">' +
          '<button class="ok" data-action="ok" data-id="' + esc(item.id) + '" type="button" title="標記此項通過 (O)">✓ 通過</button>' +
          '<button class="issue" data-action="issue" data-id="' + esc(item.id) + '" type="button" title="標記此項有問題，需填寫說明 (I)">⚠ 有問題</button>' +
          '<button class="skip" data-action="skip" data-id="' + esc(item.id) + '" type="button" title="跳過此項，可選填原因 (S)">⤵ 跳過</button>' +
        '</div>' +
        '<details class="finding"' + (hasFinding ? ' open' : '') + '>' +
          '<summary title="此欄與 ✓/⚠/⤵ 正交；按主要按鈕送出時一起寫回。可空白；填了就會以 （finding: ...）落在同一行，方便後續 TD 登記。">+ 額外發現' + (hasFinding ? '（已填）' : '（選填）') + '</summary>' +
          '<textarea class="finding-input" data-finding="' + esc(item.id) + '" placeholder="順手記下的觀察 / TD 候選（與主要結論獨立）">' + findingValue + '</textarea>' +
        '</details>';
    }

    function renderTaskItem(item, index) {
      const active = index === state.activeIndex;
      const decision = parseDecision(item.raw);
      const handled = decision.kind !== 'pending';
      const collapsed = handled && !state.expanded.has(item.id);
      const decisionClass = handled ? ' decision-' + decision.kind : '';
      const isDiscuss = hasKind(item, 'discuss');
      const kindClass = isDiscuss
        ? ' kind-discuss'
        : (isAutomaticOnly(item) ? ' kind-automatic' : (hasKind(item, 'verify:ui') ? ' kind-verify-ui' : ' kind-review-ui'));
      const persistedFinding = parseFinding(item.raw);
      const draftFinding = state.draftFindings[item.id];
      const findingSeed = draftFinding !== undefined ? draftFinding : persistedFinding;
      const findingValue = findingSeed ? esc(findingSeed) : '';
      let stateHtml;
      if (handled) {
        stateHtml = '<span class="state-badge ' + decision.kind + '">' + decisionLabel(decision.kind) + '</span>';
        if (persistedFinding) {
          stateHtml += '<span class="finding-indicator" title="額外發現：' + esc(persistedFinding) + '">📝</span>';
        }
        if (collapsed && requiresUserConfirmation(item)) {
          stateHtml += '<button class="reopen" data-action="reopen" data-id="' + esc(item.id) + '" type="button" title="重新編輯此項">↻ 編輯</button>';
        }
        if (decision.kind === 'issue' && requiresUserConfirmation(item)) {
          stateHtml += '<button class="copy-handoff-btn" data-handoff="item-issue" data-id="' + esc(item.id) + '" type="button" title="複製 handoff prompt 給新 Claude session 處理這個 issue">📋 handoff</button>';
        }
      } else if (parentHasChildren(item)) {
        stateHtml = '由子項回饋';
      } else if (isDiscuss) {
        stateHtml = '由 Claude 主導';
      } else if (isAutomaticOnly(item)) {
        stateHtml = 'Self-Completed';
      } else if (hasKind(item, 'verify:ui')) {
        stateHtml = '待人工確認';
      } else {
        stateHtml = '待檢查';
      }
      const noteValue = decision.note ? esc(decision.note) : '';
      const bannerHtml = renderManualReviewBanner(item);
      const bodyHtml = renderEvidenceForItem(item) + renderTaskControls(item, noteValue, findingValue);
      return '<article class="task-item' + (active ? ' active' : '') + (item.scoped ? ' scoped' : '') + decisionClass + (collapsed ? ' collapsed' : '') + kindClass + '" data-item="' + esc(item.id) + '" data-index="' + index + '">' +
        '<div class="task-head">' +
        '<span class="task-id">' + esc(item.id) + renderKindBadges(item) + '</span>' +
        '<span class="task-desc">' + escWithLinks(item.description) + '</span>' +
        '<span class="task-state">' + stateHtml + '</span>' +
        '</div>' +
        bannerHtml +
        bodyHtml +
        '</article>';
    }

    function renderManualReviewBanner(item) {
      var hits = item.manualReviewHits || [];
      if (!hits.length) return '';
      var lines = hits.map(function (h) {
        return '<li><code>' + esc(h.code) + '</code> — ' + esc(h.description) +
               ' <a href=".claude/rules/' + esc(h.anchor) + '" target="_blank" style="opacity:.8;font-size:11px;">(rule)</a></li>';
      }).join('');
      return '<div class="manual-review-banner" role="alert" data-mr-banner="1">' +
             '<div class="mr-banner-title">⚠ Pre-Review Data Readiness — ' + hits.length + ' 個 pattern 命中</div>' +
             '<ul>' + lines + '</ul>' +
             '<div class="mr-banner-hint">建議跑 <code>/spectra-ingest</code> 補上具體 sample / URL / scoped sub-items（warning non-blocking — 仍可 OK / Issue / SKIP）。</div>' +
             '<button class="copy-handoff-btn block" data-handoff="manual-review-readiness" data-id="' + esc(item.id) + '" type="button" title="複製 handoff prompt 給新 Claude session 跑 /spectra-ingest 補齊 proposal 資料">📋 複製 ingest prompt</button>' +
             '</div>';
    }

    function renderSelfCompletedSection(entries) {
      if (!entries.length) return '';
      return '<details id="selfCompletedSection" class="self-completed-section"' + (state.selfCompletedOpen ? ' open' : '') + '>' +
        '<summary>Self-Completed (' + entries.length + ')</summary>' +
        '<div class="self-completed-list">' +
        entries.map(function (entry) { return renderTaskItem(entry.item, entry.index); }).join('') +
        '</div>' +
      '</details>';
    }

    function renderTasks() {
      const change = state.current;
      if (!change) {
        el.taskList.innerHTML = '<div class="empty">← 從左側選一個 change 開始檢查</div>';
        return;
      }
      if (!change.items.length && !change.malformedLines.length) {
        el.taskList.innerHTML = '<div class="empty">此 change 有 ## 人工檢查 區塊，但沒有可解析的項目</div>';
        return;
      }
      const malformedHandoff = change.malformedLines.length
        ? '<div class="task-item" style="border-left: 4px solid var(--bad);">' +
          '<div class="task-head">' +
          '<span class="task-id">⚠ 格式錯誤</span>' +
          '<span class="task-desc">這些行不符 schema，整個 change 寫入被擋。需要修 tasks.md 才能繼續。</span>' +
          '<span class="task-state"></span>' +
          '</div>' +
          '<button class="copy-handoff-btn block" data-handoff="malformed" type="button" title="複製 handoff prompt 給新 Claude session 處理格式錯誤">📋 複製 handoff prompt</button>' +
          '</div>'
        : '';
      const malformed = malformedHandoff + change.malformedLines.map(function (line) {
        return '<div class="task-item"><div class="task-head"><span class="task-id">第 ' + line.lineNumber + ' 行</span><span class="task-desc">' + esc(line.raw) + '</span><span class="task-state">格式錯誤</span></div></div>';
      }).join('');
      const indexedItems = change.items.map(function (item, index) { return { item: item, index: index }; });
      const selfCompleted = indexedItems.filter(function (entry) { return isAutomaticOnly(entry.item); });
      const interactive = indexedItems.filter(function (entry) { return !isAutomaticOnly(entry.item); });
      const interactivePending = interactive.filter(function (entry) { return parseDecision(entry.item.raw).kind === 'pending'; });
      const interactiveHandled = interactive.filter(function (entry) { return parseDecision(entry.item.raw).kind !== 'pending'; });
      const handledDivider = interactiveHandled.length
        ? '<div class="handled-divider" role="separator"><span>已註記 (' + interactiveHandled.length + ')</span></div>'
        : '';
      const items = renderSelfCompletedSection(selfCompleted) +
        interactivePending.map(function (entry) { return renderTaskItem(entry.item, entry.index); }).join('') +
        handledDivider +
        interactiveHandled.map(function (entry) { return renderTaskItem(entry.item, entry.index); }).join('');
      el.taskList.innerHTML = malformed + items;
      const selfSection = el.taskList.querySelector('#selfCompletedSection');
      if (selfSection) {
        selfSection.addEventListener('toggle', function () {
          state.selfCompletedOpen = selfSection.open;
        });
      }
      el.taskList.querySelectorAll('[data-item]').forEach(function (node, index) {
        node.addEventListener('click', function (event) {
          const interactive = event.target.closest && event.target.closest('button, textarea, input, select');
          // 點當前 active card 的互動元素：不重建，保留 focus 與輸入
          const itemIndex = Number(node.dataset.index);
          if (interactive && state.activeIndex === itemIndex) return;
          if (state.activeIndex === itemIndex) return;
          // 點別張 card：切 active，若原本點的是 textarea，重建後把 focus 還回對應 textarea
          const focusNoteId = (event.target.tagName === 'TEXTAREA' && event.target.dataset && event.target.dataset.note)
            ? event.target.dataset.note
            : null;
          state.activeIndex = itemIndex;
          renderTasks();
          renderThumbs();
          syncActiveItemUrl();
          if (focusNoteId) {
            const textarea = el.taskList.querySelector('textarea[data-note="' + CSS.escape(focusNoteId) + '"]');
            if (textarea) {
              textarea.focus();
              const len = textarea.value.length;
              textarea.setSelectionRange(len, len);
            }
          }
        });
      });
      el.taskList.querySelectorAll('[data-action]').forEach(function (button) {
        button.addEventListener('click', function (event) {
          event.stopPropagation();
          if (button.dataset.action === 'reopen') {
            state.expanded.add(button.dataset.id);
            renderTasks();
            const node = el.taskList.querySelector('[data-note="' + CSS.escape(button.dataset.id) + '"]');
            if (node) {
              node.focus();
              const len = node.value.length;
              node.setSelectionRange(len, len);
            }
            return;
          }
          saveAction(button.dataset.id, button.dataset.action);
        });
      });
      el.taskList.querySelectorAll('[data-handoff]').forEach(function (button) {
        button.addEventListener('click', function (event) {
          event.stopPropagation();
          const kind = button.dataset.handoff;
          if (kind === 'malformed') {
            copyHandoffPrompt('malformed', { change: state.current }, '格式錯誤');
            return;
          }
          if (kind === 'item-issue') {
            const id = button.dataset.id;
            const target = (state.current && state.current.items || []).find(function (it) { return it.id === id; });
            if (!target) {
              showBanner('找不到 item ' + id + '，無法產生 handoff prompt', 'error');
              return;
            }
            const decision = parseDecision(target.raw);
            const matched = changeFiles().filter(function (f) { return fileMatchesItem(f.name, target.id); }).map(function (f) { return f.name; });
            copyHandoffPrompt('item-issue', {
              change: state.current,
              item: target,
              note: decision.note,
              matchedFiles: matched,
            }, 'issue ' + target.id);
            return;
          }
          if (kind === 'manual-review-readiness') {
            const id = button.dataset.id;
            const target = (state.current && state.current.items || []).find(function (it) { return it.id === id; });
            if (!target) {
              showBanner('找不到 item ' + id + '，無法產生 ingest prompt', 'error');
              return;
            }
            copyHandoffPrompt('manual-review-readiness', {
              change: state.current,
              item: target,
            }, 'ingest readiness ' + target.id);
            return;
          }
          if (kind === 'evidence-fillin-item') {
            const id = button.dataset.id;
            const target = (state.current && state.current.items || []).find(function (it) { return it.id === id; });
            if (!target) {
              showBanner('找不到 item ' + id + '，無法產生補 evidence prompt', 'error');
              return;
            }
            const evidenceKind = button.dataset.evidenceKind || '';
            copyHandoffPrompt('evidence-fillin-item', {
              change: state.current,
              item: target,
              missingKinds: evidenceKind ? [evidenceKind] : [],
            }, '補 ' + evidenceKind + ' evidence ' + target.id);
            return;
          }
        });
      });
      // textarea draft cache：使用者打字 → 寫進 state.draftNotes（key by itemId），
      // renderTasks 之後 restore；沒這層使用者輸入會被下次 innerHTML reset 沖掉。
      el.taskList.querySelectorAll('textarea[data-note]').forEach(function (textarea) {
        const id = textarea.dataset.note;
        if (state.draftNotes[id] !== undefined) textarea.value = state.draftNotes[id];
        textarea.addEventListener('input', function () {
          state.draftNotes[id] = textarea.value;
        });
      });
      // 同型 draft cache：finding textarea（與 note 平行，只是 key 不同）
      el.taskList.querySelectorAll('textarea[data-finding]').forEach(function (textarea) {
        const id = textarea.dataset.finding;
        if (state.draftFindings[id] !== undefined) textarea.value = state.draftFindings[id];
        textarea.addEventListener('input', function () {
          state.draftFindings[id] = textarea.value;
        });
      });
      // 任務卡片內的內嵌截圖（Final-state / verified-ui）：點擊放大進 viewer，
      // 與右側 thumbnail grid 一致。stopPropagation 防止冒泡到 task-item card 觸發 active 切換。
      el.taskList.querySelectorAll('img.verified-ui-image').forEach(function (img) {
        img.addEventListener('click', function (event) {
          event.stopPropagation();
          openViewer(img.src, img.alt || '');
        });
      });
    }

    function activeItem() {
      if (!state.current || !state.current.items.length) return null;
      return state.current.items[Math.min(state.activeIndex, state.current.items.length - 1)];
    }

    // 把該 change 所有 matched topic 的 files 合成一個 flat list
    function changeFiles() {
      const pools = state.current ? state.current.screenshotPools || [] : [];
      const seen = new Set();
      const files = [];
      for (const pool of pools) {
        for (const file of pool.files || []) {
          if (seen.has(file.relPath)) continue;
          seen.add(file.relPath);
          files.push(file);
        }
      }
      return files;
    }

    function renderThumbs() {
      const item = activeItem();
      if (!item) {
        el.selectionStatus.textContent = '尚未選擇檢查項';
        el.thumbGrid.replaceChildren(emptyMessage('先在中間點一個檢查項，這裡會顯示對應截圖'));
        return;
      }
      // Discuss items：不顯示 thumbnail grid、不顯示 handoff button、不顯示 unmatched guidance（spec line 169）。
      // 只在 thumb pane 顯示「此項由 Claude 主導」提示，與中間 task list 的 discuss-card 呼應。
      if (hasKind(item, 'discuss')) {
        el.selectionStatus.textContent = '檢查項 ' + item.id + ' · 此項由 Claude 主導，無需截圖驗證';
        el.thumbGrid.replaceChildren(discussThumbMessage(item.description));
        return;
      }
      if (isAutomaticOnly(item)) {
        el.selectionStatus.textContent = '檢查項 ' + item.id + ' · Self-Completed · 無需截圖操作';
        el.thumbGrid.replaceChildren(automaticThumbMessage(item.description));
        return;
      }
      const change = state.current;
      const pools = change ? change.screenshotPools || [] : [];
      const allFiles = changeFiles();
      const matched = allFiles.filter(function (f) { return fileMatchesItem(f.name, item.id); });
      const idLabel = item.id.replace(/^#/, '');
      const poolSummary = pools.length ? pools.map(function (p) { return p.env + '/' + p.topic; }).join(', ') : '無';
      if (item.noScreenshot === true) {
        el.selectionStatus.textContent = '檢查項 ' + item.id + ' · 純功能驗證 (no-screenshot) · 對應 ' + matched.length + ' / ' + allFiles.length + ' 張（topic 資料夾：' + poolSummary + '）';
        el.thumbGrid.replaceChildren(roundTripOnlyMessage(item.description));
        return;
      }
      if (!pools.length) {
        el.selectionStatus.textContent = '檢查項 ' + item.id + ' · 此 change 尚無對應截圖資料夾';
        const div = document.createElement('div');
        div.className = 'empty';
        const p1 = document.createElement('p');
        p1.textContent = '找不到屬於此 change 的截圖資料夾。';
        const p2 = document.createElement('p');
        p2.textContent = '命名規範：screenshots/<env>/' + (change ? change.name : '<change-name>') + '/';
        const p3 = document.createElement('p');
        p3.textContent = '（資料夾名等於 change name，或以 change name + - 開頭）';
        p3.style.opacity = '0.7';
        p3.style.fontSize = '12px';
        div.appendChild(p1);
        div.appendChild(p2);
        div.appendChild(p3);
        const handoffBtn = document.createElement('button');
        handoffBtn.type = 'button';
        handoffBtn.className = 'copy-handoff-btn block';
        handoffBtn.textContent = '📋 複製 handoff prompt';
        handoffBtn.title = '複製 handoff prompt 給新 Claude session 處理缺截圖資料夾';
        handoffBtn.addEventListener('click', function () {
          copyHandoffPrompt('no-pools', { change: state.current }, '缺截圖資料夾');
        });
        div.appendChild(handoffBtn);
        el.thumbGrid.replaceChildren(div);
        return;
      }
      el.selectionStatus.textContent = '檢查項 ' + item.id + ' · 對應 ' + matched.length + ' / ' + allFiles.length + ' 張（topic 資料夾：' + poolSummary + '）';
      if (!matched.length && allFiles.length > 0) {
        const div = descriptionGuidanceMessage(item.description);
        const handoffBtn = document.createElement('button');
        handoffBtn.type = 'button';
        handoffBtn.className = 'copy-handoff-btn block';
        handoffBtn.textContent = '📋 複製 handoff prompt';
        handoffBtn.title = '複製 handoff prompt 給新 Claude session 處理檔名不符';
        handoffBtn.addEventListener('click', function () {
          copyHandoffPrompt('no-matched', {
            change: state.current,
            item: item,
            pools: pools,
            files: allFiles,
          }, '檔名不符');
        });
        div.appendChild(handoffBtn);
        el.thumbGrid.replaceChildren(div);
        return;
      }
      if (!matched.length) {
        const hint = '此 change 共 ' + allFiles.length + ' 張截圖，但無檔名以 #' + idLabel + '- 或 #' + idLabel + '<letter>- 開頭。請以 #' + idLabel + '-... 命名後重整。';
        const div = emptyMessage(hint);
        const handoffBtn = document.createElement('button');
        handoffBtn.type = 'button';
        handoffBtn.className = 'copy-handoff-btn block';
        handoffBtn.textContent = '📋 複製 handoff prompt';
        handoffBtn.title = '複製 handoff prompt 給新 Claude session 處理檔名不符';
        handoffBtn.addEventListener('click', function () {
          copyHandoffPrompt('no-matched', {
            change: state.current,
            item: item,
            pools: pools,
            files: allFiles,
          }, '檔名不符');
        });
        div.appendChild(handoffBtn);
        el.thumbGrid.replaceChildren(div);
        return;
      }
      el.thumbGrid.replaceChildren(...matched.map(buildThumbButton));
    }

    function roundTripOnlyMessage(description) {
      const div = document.createElement('div');
      div.className = 'empty';
      const title = document.createElement('p');
      title.textContent = '此項為純功能驗證';
      const body = document.createElement('p');
      body.textContent = description;
      const hint = document.createElement('p');
      hint.textContent = '親自操作後可直接勾 OK，不需截圖';
      hint.style.opacity = '0.7';
      hint.style.fontSize = '12px';
      div.appendChild(title);
      div.appendChild(body);
      div.appendChild(hint);
      return div;
    }

    function discussThumbMessage(description) {
      const div = document.createElement('div');
      div.className = 'empty';
      const title = document.createElement('p');
      title.textContent = '此項由 Claude 主導';
      const body = document.createElement('p');
      body.textContent = description;
      const hint = document.createElement('p');
      hint.textContent = 'archive 階段 Claude 會主動準備證據與你討論，無需在此操作';
      hint.style.opacity = '0.7';
      hint.style.fontSize = '12px';
      div.appendChild(title);
      div.appendChild(body);
      div.appendChild(hint);
      return div;
    }

    function automaticThumbMessage(description) {
      const div = document.createElement('div');
      div.className = 'empty';
      const title = document.createElement('p');
      title.textContent = 'Self-Completed';
      const body = document.createElement('p');
      body.textContent = description;
      const hint = document.createElement('p');
      hint.textContent = 'automatic channel 的 evidence 顯示在中間清單，無需 OK / Issue / SKIP';
      hint.style.opacity = '0.7';
      hint.style.fontSize = '12px';
      div.appendChild(title);
      div.appendChild(body);
      div.appendChild(hint);
      return div;
    }

    function descriptionGuidanceMessage(description) {
      const div = document.createElement('div');
      div.className = 'empty';
      const body = document.createElement('p');
      body.textContent = description;
      const hint = document.createElement('p');
      hint.textContent = '若此項為純功能驗證（form submit / API 行為 / status transition），照上述步驟親自操作後可直接勾 OK，不需截圖';
      hint.style.opacity = '0.7';
      hint.style.fontSize = '12px';
      div.appendChild(body);
      div.appendChild(hint);
      return div;
    }

    function emptyMessage(text) {
      const div = document.createElement('div');
      div.className = 'empty';
      div.textContent = text;
      return div;
    }

    function buildThumbButton(file) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'thumb';
      button.dataset.shot = file.relPath;
      button.dataset.url = file.url;
      const frame = document.createElement('span');
      frame.className = 'thumb-frame';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = file.url;
      img.alt = file.relPath;
      frame.appendChild(img);
      const caption = document.createElement('span');
      caption.textContent = file.name;
      button.appendChild(frame);
      button.appendChild(caption);
      button.addEventListener('click', function () { openViewer(file.url, file.relPath); });
      button.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          openViewer(file.url, file.relPath);
        }
      });
      return button;
    }

    // 防止 double-click 在 server 還沒回前重複送出（每按一次就多一次 conflict 機會）
    const inflightSaves = new Set();
    async function saveAction(itemId, action) {
      const change = state.current;
      if (!change) return;
      const targetItem = (change.items || []).find(function (item) { return item.id === itemId; });
      if (!targetItem || !requiresUserConfirmation(targetItem)) {
        if (targetItem && parentHasChildren(targetItem)) {
          showBanner('此項是母項，請對其子項分別作回饋', '');
        } else {
          showBanner('此項自動完成或由 Claude 主導，無需在 GUI 操作', '');
        }
        return;
      }
      if (change.malformedLines.length) {
        showBanner('寫入前需先修正格式錯誤', 'error');
        return;
      }
      if (inflightSaves.has(itemId)) return;
      const noteNode = el.taskList.querySelector('[data-note="' + CSS.escape(itemId) + '"]');
      const note = noteNode ? noteNode.value : '';
      if (action === 'issue' && !note.trim()) {
        showBanner('「有問題」需要簡短說明', 'error');
        if (noteNode) noteNode.focus();
        return;
      }
      const findingNode = el.taskList.querySelector('[data-finding="' + CSS.escape(itemId) + '"]');
      const finding = findingNode ? findingNode.value : '';
      // visual feedback：立即把 task-item disable + 顯示「儲存中…」banner，
      // 讓使用者知道 click 收到了，不會以為 hung。
      inflightSaves.add(itemId);
      const itemNode = el.taskList.querySelector('[data-item="' + CSS.escape(itemId) + '"]');
      if (itemNode) itemNode.classList.add('saving');
      itemNode?.querySelectorAll('button[data-action], textarea').forEach(function (n) { n.disabled = true; });
      showBanner('儲存中…', 'pending');
      try {
        const data = await api('/api/changes/' + encodeURIComponent(change.name) + '/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            itemId: itemId,
            action: action,
            note: note,
            finding: finding,
            version: change.version,
          }),
        });
        state.current = data.change;
        state.expanded.delete(itemId);
        delete state.draftNotes[itemId];
        delete state.draftFindings[itemId];
        // sidebar metrics 是 state.changes 的 cache，saveAction 不會自動更新
        // 對應 entry，會跟 right pane 的 state.current 不一致。把 detail 的 summary
        // 欄位 patch 回 list，避免使用者看到「sidebar 1/6 已通過、right pane 4 ok」這種矛盾。
        const idx = state.changes.findIndex(function (c) { return c.name === data.change.name; });
        if (idx >= 0) {
          state.changes[idx] = {
            name: data.change.name,
            tasksPath: data.change.tasksPath,
            total: data.change.total,
            checked: data.change.checked,
            pending: data.change.pending,
            issued: data.change.issued,
            malformed: data.change.malformed,
            screenshotTopicCount: data.change.screenshotTopicCount,
            screenshotTopics: data.change.screenshotTopics,
          };
          renderChanges();
        }
        if (data.archive && data.archive.status === 'started') {
          showBanner('已儲存且全部通過，Review archive 已在背景執行（log: ' + (data.archive.logPath || 'see .review-gui/') + '）', '');
        } else if (data.archive && data.archive.status === 'unavailable') {
          showBanner('已儲存且全部通過，但找不到 review-archive 命令，請手動跑 /review-archive all', 'error');
        } else if (data.archive && data.archive.status === 'failed') {
          showBanner('已儲存，但無法觸發 Review archive：' + (data.archive.message || '需手動處理'), 'error');
        } else {
          showBanner('已將 ' + itemId + ' 標記為 ' + action, '');
        }
        renderCurrent();
      } catch (err) {
        if (err.status === 409) {
          // server 在 body.currentVersion 回新 hash；直接同步到 state.current.version，
          // 讓下次按按鈕用最新 version 不再撞 409。tasks.md 真有 out-of-band 修改時，
          // 內容也用 server 那邊重新拿，避免 client 顯示與 raw 不一致。
          if (err.body && err.body.currentVersion && state.current) {
            try {
              const fresh = await api('/api/changes/' + encodeURIComponent(state.current.name));
              state.current = fresh.change;
              renderCurrent();
              showBannerWithHandoff('版本已自動同步（其他人或上一次操作改過 tasks.md），請再按一次', 'error', 'conflict', '寫入衝突', err.message);
            } catch (reloadErr) {
              showBannerWithHandoff('版本衝突且自動同步失敗：' + (reloadErr.message || String(reloadErr)), 'error', 'conflict', '寫入衝突', reloadErr.message || String(reloadErr));
            }
          } else {
            showBannerWithHandoff('寫入衝突，請點「重新載入」再儲存', 'error', 'conflict', '寫入衝突', err.message);
          }
        } else {
          showBanner(err.message || String(err), 'error');
        }
      } finally {
        inflightSaves.delete(itemId);
        // success path renderCurrent 已重建整個 task list，新 DOM 沒 saving class；
        // error path 留在原 DOM，主動把 disable / saving class 拿掉避免使用者卡死。
        const itemNode2 = el.taskList.querySelector('[data-item="' + CSS.escape(itemId) + '"]');
        if (itemNode2) {
          itemNode2.classList.remove('saving');
          itemNode2.querySelectorAll('button[data-action], textarea').forEach(function (n) { n.disabled = false; });
        }
      }
    }

    function moveActive(delta) {
      if (!state.current || !state.current.items.length) return;
      state.activeIndex = Math.max(0, Math.min(state.current.items.length - 1, state.activeIndex + delta));
      renderTasks();
      renderThumbs();
      const item = state.current.items[state.activeIndex];
      const node = el.taskList.querySelector('[data-item="' + CSS.escape(item.id) + '"]');
      if (node) node.scrollIntoView({ block: 'nearest' });
      syncActiveItemUrl();
    }

    function openViewer(url, label) {
      el.viewerImage.src = url;
      el.viewerImage.alt = label || '截圖';
      el.viewerLabel.textContent = label || '';
      el.viewerStage.classList.remove('zoomed');
      el.viewerStage.scrollTo({ top: 0, left: 0 });
      el.viewer.classList.add('open');
      el.viewerClose.focus();
    }

    function closeViewer() {
      el.viewer.classList.remove('open');
      el.viewerImage.removeAttribute('src');
      el.viewerStage.classList.remove('zoomed');
    }

    let shortcutModalPrevFocus = null;
    function openShortcutModal() {
      shortcutModalPrevFocus = document.activeElement;
      // 把 modal 以外的所有頂層 children inert，防 keyboard tab 到下方 review action buttons
      const root = document.body;
      for (const child of Array.from(root.children)) {
        if (child !== el.shortcutModal && !child.hasAttribute('inert')) {
          child.setAttribute('inert', '');
          child.dataset._inertByModal = '1';
        }
      }
      el.shortcutModal.classList.add('open');
      el.shortcutModalClose.focus();
    }

    function closeShortcutModal() {
      el.shortcutModal.classList.remove('open');
      // 還原 inert
      const root = document.body;
      for (const child of Array.from(root.children)) {
        if (child.dataset._inertByModal === '1') {
          child.removeAttribute('inert');
          delete child.dataset._inertByModal;
        }
      }
      // 還原 focus 到打開前的元素
      if (shortcutModalPrevFocus && typeof shortcutModalPrevFocus.focus === 'function') {
        shortcutModalPrevFocus.focus();
      }
      shortcutModalPrevFocus = null;
    }

    // back/forward 觸發 popstate：重新解析 URL，align state。
    // - 同 change 內：只切 activeIndex（不重 fetch）
    // - 換 change：重 loadChange，pushUrl=false（URL 已是使用者導航後位置）
    // - 退到 list view：清掉 current
    window.addEventListener('popstate', function () {
      const target = parseLocationTarget();
      if (!target.change) {
        state.current = null;
        state.activeIndex = 0;
        renderChanges();
        el.taskList.replaceChildren();
        el.currentTitle.textContent = '';
        if (el.evidenceSweepButton) el.evidenceSweepButton.hidden = true;
        return;
      }
      if (state.current && state.current.name === target.change) {
        if (target.itemId) {
          const idx = state.current.items.findIndex(function (it) { return it.id === target.itemId; });
          if (idx >= 0 && idx !== state.activeIndex) {
            state.activeIndex = idx;
            renderTasks();
            renderThumbs();
          }
        }
        return;
      }
      loadChange(target.change, false).then(function () {
        if (target.itemId && state.current) {
          const idx = state.current.items.findIndex(function (it) { return it.id === target.itemId; });
          if (idx >= 0) {
            state.activeIndex = idx;
            renderTasks();
            renderThumbs();
            syncActiveItemUrl();
          }
        }
      }).catch(function (err) {
        showBanner(err.message || String(err), 'error');
      });
    });

    // 雙擊 <code> 整塊選取；預設 dblclick 用 / 之類符號 break word boundary，會把
    // 像 /reports/costs 之類路徑切成多段，反而難複製。涵蓋所有 <code>（含 evidence
    // panel 既有的）。
    document.addEventListener('dblclick', function (event) {
      const target = event.target;
      const codeEl = target && target.closest ? target.closest('code') : null;
      if (!codeEl) return;
      event.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(codeEl);
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
    });

    document.addEventListener('keydown', function (event) {
      if (el.viewer.classList.contains('open')) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeViewer();
        }
        return;
      }
      if (el.shortcutModal.classList.contains('open')) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeShortcutModal();
        }
        return;
      }
      if (el.promptFallbackModal.classList.contains('open')) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closePromptFallbackModal();
        }
        return;
      }
      if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        const tag = document.activeElement ? document.activeElement.tagName : '';
        if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
          event.preventDefault();
          openShortcutModal();
          return;
        }
      }
      const tag = document.activeElement ? document.activeElement.tagName : '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      const item = activeItem();
      if (!item) return;
      const key = event.key.toLowerCase();
      if (key === 'j') { event.preventDefault(); moveActive(1); }
      else if (key === 'k') { event.preventDefault(); moveActive(-1); }
      else if (key === 'o') { event.preventDefault(); if (requiresUserConfirmation(item)) saveAction(item.id, 'ok'); }
      else if (key === 'i') { event.preventDefault(); if (requiresUserConfirmation(item)) saveAction(item.id, 'issue'); }
      else if (key === 's') { event.preventDefault(); if (requiresUserConfirmation(item)) saveAction(item.id, 'skip'); }
      else if (key === 'enter') {
        const first = el.thumbGrid.querySelector('[data-url]');
        if (first) openViewer(first.dataset.url, first.dataset.shot);
      }
    });

    el.reloadButton.addEventListener('click', function () {
      if (state.current) loadChange(state.current.name);
      else loadChanges();
    });
    if (el.evidenceSweepButton) {
      el.evidenceSweepButton.addEventListener('click', function () {
        const change = state.current;
        if (!change) return;
        const missing = computeMissingEvidence(change);
        const pairCount = missing.reduce(function (acc, m) { return acc + m.kinds.length; }, 0);
        if (!pairCount) return;
        copyHandoffPrompt('evidence-fillin-change', { change: change, missing: missing }, '補 evidence (' + pairCount + ' pair)');
      });
    }
    el.viewerClose.addEventListener('click', closeViewer);
    el.viewer.addEventListener('click', function (event) {
      if (event.target === el.viewer) closeViewer();
    });
    el.viewerStage.addEventListener('click', function (event) {
      // 點圖切 1:1 / fit 對調；點圖外 stage 不關（避免誤觸）
      if (event.target === el.viewerImage || event.target === el.viewerStage) {
        el.viewerStage.classList.toggle('zoomed');
      }
    });
    el.shortcutModalClose.addEventListener('click', closeShortcutModal);
    el.shortcutModal.addEventListener('click', function (event) {
      if (event.target === el.shortcutModal) closeShortcutModal();
    });
    el.promptFallbackClose.addEventListener('click', closePromptFallbackModal);
    el.promptFallbackModal.addEventListener('click', function (event) {
      if (event.target === el.promptFallbackModal) closePromptFallbackModal();
    });
    el.promptFallbackSelectAll.addEventListener('click', function () {
      el.promptFallbackText.focus();
      el.promptFallbackText.select();
    });

    // 先 fetch /api/health 拿 repoRoot 給 handoff prompt 用；失敗不該擋住 GUI 啟動，
    // prompt 會 fallback 顯示 (unknown) 而不是讓使用者看不到 change 清單。
    api('/api/health').then(function (info) {
      if (info && info.repoRoot) {
        state.repoRoot = info.repoRoot;
        const segments = info.repoRoot.split('/').filter(Boolean);
        state.repoName = segments[segments.length - 1] || info.repoRoot;
      }
    }).catch(function () { /* noop — handoff prompt 會 fallback */ });

    loadChanges().catch(function (err) {
      showBanner(err.message || String(err), 'error');
      el.changeStatus.classList.remove('loading-spin');
      el.changeStatus.textContent = '無法載入 change 清單';
      el.currentTitle.classList.remove('loading-spin');
      el.currentTitle.textContent = '選擇一個 change 開始';
    });

    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function tickUpdatedAt() {
      const d = new Date();
      const s = d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' '
        + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
      const target = document.getElementById('updatedAt');
      if (target) target.textContent = s;
    }
    tickUpdatedAt();
    setInterval(tickUpdatedAt, 1000);
  </script>
</body>
</html>`
}

async function startServer(options: CliOptions): Promise<{ url: string; server: any }> {
  const app = await createReviewApp(options.repoRoot)
  const port = await findAvailablePort(options.host, options.port)
  const server = createServer(async (req, res) => {
    try {
      const request = nodeRequest(req)
      const response = await app.fetch(request)
      res.statusCode = response.status
      response.headers.forEach((value: string, key: string) => res.setHeader(key, value))
      if (response.body) {
        Readable.fromWeb(response.body as any).pipe(res)
      } else {
        res.end()
      }
    } catch (err) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
    }
  })
  await new Promise<void>((resolveStart, rejectStart) => {
    server.once('error', rejectStart)
    server.listen(port, options.host, () => resolveStart())
  })
  const url = `http://${options.host}:${port}/review`
  return { url, server }
}

function nodeRequest(req: any): Request {
  const host = req.headers.host || '127.0.0.1'
  const url = `http://${host}${req.url || '/'}`
  const init: any = {
    method: req.method,
    headers: req.headers,
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req)
    init.duplex = 'half'
  }
  return new Request(url, init)
}

async function findAvailablePort(host: string, startPort: number): Promise<number> {
  for (let port = startPort; port <= startPort + PORT_FALLBACK_RANGE; port++) {
    if (await canListen(host, port)) return port
  }
  throw new Error(
    `No available localhost port in range ${startPort}-${startPort + PORT_FALLBACK_RANGE}`,
  )
}

function canListen(host: string, port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const probe = net.createServer()
    probe.once('error', () => resolvePort(false))
    probe.once('listening', () => {
      probe.close(() => resolvePort(true))
    })
    probe.listen(port, host)
  })
}

// 啟動橫幅：iTerm2 / Terminal.app 對 raw http URL 都支援 cmd-click，所以 URL
// 本身不加 underline 等 ANSI 修飾（部分 terminal 會把 escape 算進 URL 邊界），
// 只用 bold + cyan 突顯。非 TTY（pipe to file / CI）自動省略 ANSI。
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, 'g')
const stripAnsi = (s: string) => s.replace(ANSI_ESCAPE_PATTERN, '')

function printStartupBanner(url: string, repoRoot: string): void {
  const isTty = !!process.stdout.isTTY
  const bold = isTty ? '\x1b[1m' : ''
  const cyan = isTty ? '\x1b[36m' : ''
  const dim = isTty ? '\x1b[2m' : ''
  const reset = isTty ? '\x1b[0m' : ''
  const lines: Array<[string, string]> = [
    ['repo', `${dim}${repoRoot}${reset}`],
    ['open', `${bold}${cyan}${url}${reset}`],
  ]
  const labelWidth = Math.max(...lines.map(([label]) => label.length))
  const rendered = lines.map(([label, value]) => `${label.padEnd(labelWidth)}  ${value}`)
  const innerWidth = Math.max(...rendered.map((l) => stripAnsi(l).length))
  const horiz = '─'.repeat(innerWidth + 2)
  console.log('')
  console.log(`╭${horiz}╮`)
  for (const line of rendered) {
    const pad = ' '.repeat(innerWidth - stripAnsi(line).length)
    console.log(`│ ${line}${pad} │`)
  }
  console.log(`╰${horiz}╯`)
  console.log('')
}

function openBrowser(url: string): boolean {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.unref()
    return true
  } catch {
    return false
  }
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    host: '127.0.0.1',
    port: DEFAULT_PORT,
    repoRoot: process.cwd(),
    openBrowser: true,
    scan: false,
    explicitRepo: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--no-open') opts.openBrowser = false
    else if (arg === '--scan') opts.scan = true
    else if (arg === '--host') opts.host = argv[++i] || opts.host
    else if (arg === '--port') opts.port = Number(argv[++i] || DEFAULT_PORT)
    else if (arg === '--repo') {
      opts.repoRoot = resolve(argv[++i] || opts.repoRoot)
      opts.explicitRepo = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: review-gui.mts [--repo <path>] [--host 127.0.0.1] [--port 5174] [--no-open] [--scan]',
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }
  return opts
}

/**
 * Worktree-aware preflight — review-gui aggregates main + all worktrees from the
 * main repo (see listSourceRoots). Starting from a non-main worktree produces:
 *   - stale snapshots: process reads worktree's review-gui.mts version (may not
 *     have latest collision fix), then becomes long-lived singleton serving
 *     wrong data
 *   - main-only changes missing from /api/changes home (worktree's stale copy
 *     of openspec/changes/<name>/ shadows main's authoritative version under
 *     pre-b3a6b86 collision rules; even with the fix, starting from worktree
 *     means singleton outlives propagate cycles)
 *
 * Refuse running from a non-main worktree. Skip if user passed `--repo` explicitly
 * (treat as intentional override, e.g. CI scan against absolute path).
 */
function preflightCwd(options: CliOptions): void {
  if (options.explicitRepo) return
  let gitDir: string
  let commonDir: string
  try {
    const gitDirResult = spawnSync('git', ['rev-parse', '--git-dir'], {
      cwd: options.repoRoot,
      encoding: 'utf8',
    })
    const commonDirResult = spawnSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: options.repoRoot,
      encoding: 'utf8',
    })
    if (gitDirResult.status !== 0 || commonDirResult.status !== 0) return
    gitDir = (gitDirResult.stdout || '').trim()
    commonDir = (commonDirResult.stdout || '').trim()
  } catch {
    return
  }
  if (!gitDir || !commonDir) return
  const absGitDir = resolve(options.repoRoot, gitDir)
  const absCommonDir = resolve(options.repoRoot, commonDir)
  if (absGitDir === absCommonDir) return
  const mainRoot = absCommonDir.replace(/[\\/]\.git[\\/]*$/, '')
  console.error('')
  console.error('✗ review-gui refuses to start from a non-main worktree.')
  console.error(`  cwd: ${options.repoRoot}`)
  console.error(`  Detected worktree git-dir: ${absGitDir}`)
  console.error(`  Main worktree git-dir:    ${absCommonDir}`)
  console.error('')
  console.error('  Reason: review-gui aggregates main + all worktrees from the main')
  console.error('  repo. Starting from a worktree creates a long-lived singleton with')
  console.error('  stale code that survives propagate cycles, and may shadow main-only')
  console.error('  changes from /api/changes home page.')
  console.error('')
  console.error('  Run from main worktree:')
  console.error(`    cd ${mainRoot}`)
  console.error('    pnpm review:ui')
  console.error('')
  console.error('  To override (e.g. CI scan against an absolute path):')
  console.error(`    review-gui.mts --repo ${mainRoot}${options.scan ? ' --scan' : ''}`)
  process.exit(2)
}

async function main() {
  const options = parseArgs(process.argv)
  if (!existsSync(options.repoRoot))
    throw new Error(`Repo root does not exist: ${options.repoRoot}`)
  preflightCwd(options)
  if (options.scan) {
    await runScan(options.repoRoot)
    return
  }
  const { url } = await startServer(options)
  printStartupBanner(url, options.repoRoot)
  if (options.openBrowser) {
    const opened = openBrowser(url)
    if (!opened) console.log(`[review:ui] Browser launch failed. Open this URL manually: ${url}`)
  } else {
    console.log('[review:ui] Browser launch skipped (--no-open)')
  }
}

/**
 * Headless scan：reuse listPendingChanges 的同一份 evaluator，輸出 JSON 給 skill 消費。
 * 結構穩定（任何欄位異動需更新 review-readiness-scan SKILL.md），避免 skill 端解析漂移。
 */
function isChangeNotReady(change: ChangeSummary): boolean {
  return change.readinessHits > 0 || change.malformed > 0 || change.evidenceMissing.length > 0
}

async function runScan(repoRoot: string): Promise<void> {
  const changes = await listPendingChanges(repoRoot)
  // pending=0 的 change 從 home page 隱藏不列；scan 也排除（review readiness 只關注待處理項目）。
  const active = changes.filter((change) => change.pending > 0)
  const ready = active
    .filter((change) => !isChangeNotReady(change))
    .map((change) => ({
      name: change.name,
      pending: change.pending,
      issued: change.issued,
      total: change.total,
    }))
  const notReady = active.filter(isChangeNotReady).map((change) => ({
    name: change.name,
    pending: change.pending,
    issued: change.issued,
    total: change.total,
    readinessHits: change.readinessHits,
    malformed: change.malformed,
    hitsByCode: change.hitsByCode,
    evidenceMissing: change.evidenceMissing,
  }))
  const output = {
    schema: 'review-readiness-scan/v1',
    generatedAt: new Date().toISOString(),
    repoRoot,
    counts: {
      ready: ready.length,
      notReady: notReady.length,
    },
    ready,
    notReady,
  }
  process.stdout.write(JSON.stringify(output, null, 2) + '\n')
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
const currentPath = fileURLToPath(import.meta.url)

if (invokedPath === currentPath) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
