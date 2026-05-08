#!/usr/bin/env node
/**
 * Local Manual Review GUI.
 *
 * This file is the clade-owned source. sync-vendor.mjs copies it to
 * consumer repositories as scripts/review-gui.mts, where pnpm review:ui runs
 * it from the consumer repo root.
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import net from 'node:net'
import { join, normalize, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const DEFAULT_PORT = 5174
const PORT_FALLBACK_RANGE = 20
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'])
const MANUAL_REVIEW_HEADING_RE = /^##\s+.*人工檢查\s*$/
const NEXT_HEADING_RE = /^##\s+/
const CHECKBOX_LINE_RE = /^[ \t]*- \[[ xX]\]\s+/
const PARENT_ITEM_RE = /^- \[([ xX])\] (#[1-9][0-9]*) (.+)$/
const SCOPED_ITEM_RE = /^  - \[([ xX])\] (#[1-9][0-9]*\.[1-9][0-9]*) (.+)$/

export interface ManualReviewItem {
  id: string
  description: string
  checked: boolean
  scoped: boolean
  parentId: string | null
  raw: string
  lineIndex: number
  lineNumber: number
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

interface CliOptions {
  host: string
  port: number
  repoRoot: string
  openBrowser: boolean
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
  total: number
  checked: number
  pending: number
  malformed: number
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

export function parseManualReviewSections(content: string): ParsedManualReview {
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
      const item = toReviewItem(parent, line, i, false)
      current.items.push(item)
      parentIds.add(item.id)
      continue
    }

    const scoped = line.match(SCOPED_ITEM_RE)
    if (scoped) {
      const item = toReviewItem(scoped, line, i, true)
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

  const items = sections.flatMap((section) => section.items)
  const malformed = sections.flatMap((section) => section.malformed)
  return { sections, items, malformed }
}

function toReviewItem(
  match: RegExpMatchArray,
  raw: string,
  lineIndex: number,
  scoped: boolean
): ManualReviewItem {
  const id = match[2]!
  return {
    id,
    description: match[3]!.trim(),
    checked: match[1]!.toLowerCase() === 'x',
    scoped,
    parentId: scoped ? id.split('.')[0]! : null,
    raw,
    lineIndex,
    lineNumber: lineIndex + 1,
  }
}

export function applyReviewActionToContent(
  content: string,
  itemId: string,
  action: 'ok' | 'issue' | 'skip',
  note = ''
): { content: string; lineBefore: string; lineAfter: string } {
  const parsed = parseManualReviewSections(content)
  if (parsed.malformed.length > 0) {
    throw new HttpError(
      422,
      'Manual-review section has malformed checkbox lines. Fix schema before writing.'
    )
  }

  const item = parsed.items.find((candidate) => candidate.id === itemId)
  if (!item) throw new HttpError(404, `Manual-review item not found: ${itemId}`)

  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const lineBefore = lines[item.lineIndex] ?? ''
  const lineAfter = applyActionToLine(lineBefore, action, note)
  lines[item.lineIndex] = lineAfter
  return { content: lines.join(newline), lineBefore, lineAfter }
}

function applyActionToLine(line: string, action: 'ok' | 'issue' | 'skip', note: string): string {
  if (action === 'ok') return setCheckbox(line, true)
  if (action === 'issue') {
    const base = setCheckbox(line, false)
    return appendAnnotation(base, 'issue', note || 'needs follow-up')
  }
  const base = setCheckbox(line, true)
  return appendAnnotation(base, 'skip', note)
}

function setCheckbox(line: string, checked: boolean): string {
  return line.replace(/^(\s*- \[)[ xX](\])/, `$1${checked ? 'x' : ' '}$2`)
}

function appendAnnotation(line: string, kind: 'issue' | 'skip', note: string): string {
  if (kind === 'skip' && /（skip(?::[^）]*)?）/.test(line)) return line
  if (kind === 'issue' && /（issue:[^）]*）/.test(line)) {
    return line.replace(/（issue:[^）]*）/g, `（issue: ${sanitizeNote(note)}）`)
  }
  const label =
    kind === 'skip'
      ? note.trim()
        ? `（skip: ${sanitizeNote(note)}）`
        : '（skip）'
      : `（issue: ${sanitizeNote(note)}）`
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
        'Install consumer dev dependencies with: pnpm add -D hono tsx\n' +
        'Then run: pnpm review:ui\n\n' +
        `Original error: ${message}`
    )
  }
}

export async function createReviewApp(repoRoot = process.cwd()): Promise<any> {
  const { Hono } = await loadHono()
  const app = new Hono()

  app.get('/review', (c: any) => c.html(renderReviewHtml()))

  app.get('/api/health', (c: any) => c.json({ ok: true, repoRoot }))

  app.get('/api/changes', async (c: any) => {
    const changes = await listPendingChanges(repoRoot)
    return c.json({ changes })
  })

  app.get('/api/changes/:change', async (c: any) => {
    const detail = await readChangeDetail(repoRoot, c.req.param('change'))
    return c.json({ change: detail })
  })

  app.post('/api/changes/:change/action', async (c: any) => {
    const change = c.req.param('change')
    const body = await c.req.json().catch(() => ({}))
    const result = await persistReviewAction(repoRoot, change, body)
    return c.json(result, result.statusCode || 200)
  })

  app.get('/api/screenshot/*', async (c: any) => {
    return serveScreenshot(repoRoot, c)
  })

  app.onError((err: unknown, c: any) => {
    const status = err instanceof HttpError ? err.status : 500
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ error: message }, status)
  })

  return app
}

async function listPendingChanges(repoRoot: string): Promise<ChangeSummary[]> {
  const changesRoot = join(repoRoot, 'openspec', 'changes')
  if (!existsSync(changesRoot)) return []

  const pools = await listScreenshotPools(repoRoot)
  const entries = await readdir(changesRoot, { withFileTypes: true })
  const summaries: ChangeSummary[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'archive' || entry.name.startsWith('.')) continue
    const tasksPath = join(changesRoot, entry.name, 'tasks.md')
    if (!existsSync(tasksPath)) continue
    const summary = await summarizeChange(entry.name, tasksPath, pools)
    if (summary) summaries.push(summary)
  }

  return summaries.sort((a, b) => {
    if (a.pending !== b.pending) return b.pending - a.pending
    if (a.malformed !== b.malformed) return b.malformed - a.malformed
    return a.name.localeCompare(b.name)
  })
}

async function summarizeChange(
  name: string,
  tasksPath: string,
  pools: ScreenshotTopic[]
): Promise<ChangeSummary | null> {
  const content = await readFile(tasksPath, 'utf8')
  const parsed = parseManualReviewSections(content)
  if (parsed.sections.length === 0) return null

  const checked = parsed.items.filter((item) => item.checked).length
  return {
    name,
    tasksPath,
    total: parsed.items.length,
    checked,
    pending: parsed.items.length - checked,
    malformed: parsed.malformed.length,
    screenshotTopicCount: pools.length,
    screenshotTopics: pools.map((pool) => `${pool.env}/${pool.topic}`),
  }
}

async function readChangeDetail(repoRoot: string, change: string): Promise<ChangeDetail> {
  const tasksPath = resolveChangeTasksPath(repoRoot, change)
  const [content, version, pools] = await Promise.all([
    readFile(tasksPath, 'utf8'),
    readFileVersion(tasksPath),
    listScreenshotPools(repoRoot),
  ])
  const parsed = parseManualReviewSections(content)
  if (parsed.sections.length === 0) {
    throw new HttpError(404, `Change has no ## 人工檢查 section: ${change}`)
  }
  const summary = await summarizeChange(change, tasksPath, pools)
  if (!summary) throw new HttpError(404, `Change has no manual-review tasks: ${change}`)
  return {
    ...summary,
    version,
    items: parsed.items,
    malformedLines: parsed.malformed,
    screenshotPools: pools,
  }
}

function resolveChangeTasksPath(repoRoot: string, change: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(change) || change === 'archive') {
    throw new HttpError(400, 'Invalid change name')
  }
  const tasksPath = join(repoRoot, 'openspec', 'changes', change, 'tasks.md')
  if (!existsSync(tasksPath)) throw new HttpError(404, `tasks.md not found for change: ${change}`)
  return tasksPath
}

async function persistReviewAction(repoRoot: string, change: string, body: any): Promise<any> {
  const tasksPath = resolveChangeTasksPath(repoRoot, change)
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
  const updated = applyReviewActionToContent(content, body.itemId, action, body.note || '')
  await writeFile(tasksPath, updated.content, 'utf8')

  const detail = await readChangeDetail(repoRoot, change)
  const complete =
    detail.malformed === 0 && detail.items.length > 0 && detail.items.every((item) => item.checked)
  const archive = complete ? await invokeReviewArchive(repoRoot, change) : { status: 'not-ready' }
  return {
    ok: true,
    itemId: body.itemId,
    action,
    lineBefore: updated.lineBefore,
    lineAfter: updated.lineAfter,
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
      status: 'failed',
      message:
        'No review-archive command is available. Run /review-archive all manually or set REVIEW_GUI_ARCHIVE_CMD.',
    }
  }

  const rendered = command.replaceAll('{change}', shellQuote(change))
  const result = spawnSync(rendered, {
    cwd: repoRoot,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.status === 0) {
    return {
      status: 'success',
      command: rendered,
      stdout: result.stdout.trim(),
    }
  }
  return {
    status: 'failed',
    command: rendered,
    exitCode: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
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

async function listScreenshotPools(repoRoot: string): Promise<ScreenshotTopic[]> {
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
      const files = await collectImages(topicDir, relRoot)
      pools.push({
        env: envEntry.name,
        topic: topicEntry.name,
        files,
      })
    }
  }

  return pools.sort((a, b) => `${a.env}/${a.topic}`.localeCompare(`${b.env}/${b.topic}`))
}

async function collectImages(absDir: string, relRoot: string): Promise<ScreenshotFile[]> {
  const files: ScreenshotFile[] = []
  for (const entry of await readdir(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name)
    const rel = join(relRoot, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectImages(abs, rel)))
      continue
    }
    if (!entry.isFile()) continue
    const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
    if (!IMAGE_EXTS.has(ext)) continue
    const relPath = toPosix(rel)
    files.push({
      relPath,
      url: `/api/screenshot/${relPath.split('/').map(encodeURIComponent).join('/')}`,
      name: entry.name,
    })
  }
  return files.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

async function serveScreenshot(repoRoot: string, c: any): Promise<any> {
  const rawPath = decodeURIComponent(c.req.path.replace(/^\/api\/screenshot\//, ''))
  if (!rawPath.startsWith('screenshots/'))
    throw new HttpError(400, 'Screenshot path must start with screenshots/')
  const normalized = normalize(rawPath)
  if (normalized.startsWith('..') || normalized.includes(`${sep}..${sep}`))
    throw new HttpError(400, 'Invalid screenshot path')
  const abs = resolve(repoRoot, normalized)
  const screenshotsRoot = resolve(repoRoot, 'screenshots')
  if (!abs.startsWith(screenshotsRoot + sep)) throw new HttpError(400, 'Invalid screenshot path')
  if (!existsSync(abs)) throw new HttpError(404, 'Screenshot not found')
  const ext = abs.slice(abs.lastIndexOf('.')).toLowerCase()
  if (!IMAGE_EXTS.has(ext)) throw new HttpError(415, 'Unsupported screenshot file type')
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

function renderReviewHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Manual Review</title>
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
      min-height: 100vh;
    }
    .sidebar {
      border-right: 1px solid var(--line);
      background: #ede8dc;
      padding: 18px;
      overflow: auto;
    }
    .sidebar h1 {
      margin: 0 0 14px;
      font-size: 18px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .change-list {
      display: grid;
      gap: 8px;
    }
    .change-row {
      display: grid;
      gap: 8px;
      width: 100%;
      padding: 12px;
      text-align: left;
      box-shadow: none;
    }
    .change-row[aria-current="true"] {
      border-color: var(--accent);
      background: #f8fff9;
    }
    .change-name {
      font-weight: 700;
      overflow-wrap: anywhere;
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
    main {
      min-width: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 360px);
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
    .topic-select {
      width: 100%;
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      color: var(--ink);
      margin-bottom: 12px;
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
      place-items: center;
      padding: 20px;
      background: rgba(30, 37, 33, .78);
      z-index: 20;
    }
    .viewer.open { display: grid; }
    .viewer-inner {
      max-width: min(1100px, 96vw);
      max-height: 92vh;
      display: grid;
      gap: 10px;
    }
    .viewer img {
      max-width: 100%;
      max-height: 82vh;
      object-fit: contain;
      background: var(--panel);
      border-radius: 8px;
    }
    .viewer button {
      justify-self: end;
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
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <h1>Manual Review</h1>
      <div id="changeStatus" class="status">Loading changes...</div>
      <div id="changeList" class="change-list"></div>
    </aside>
    <main>
      <section class="review-pane">
        <div class="toolbar">
          <h2 id="currentTitle">Select a change</h2>
          <button id="reloadButton" type="button">Reload</button>
        </div>
        <div id="banner" class="banner"></div>
        <div id="taskList" class="task-list"></div>
      </section>
      <aside class="screenshot-pane">
        <h2>Screenshots</h2>
        <select id="topicSelect" class="topic-select" aria-label="Screenshot topic"></select>
        <div id="selectionStatus" class="status"></div>
        <div id="thumbGrid" class="thumb-grid"></div>
      </aside>
    </main>
  </div>
  <div id="viewer" class="viewer" role="dialog" aria-modal="true" aria-label="Full-size screenshot">
    <div class="viewer-inner">
      <button id="viewerClose" type="button">Close</button>
      <img id="viewerImage" alt="">
    </div>
  </div>
  <script>
    const state = {
      changes: [],
      current: null,
      activeIndex: 0,
      selectedTopic: '',
      selectedShots: {},
    };
    const el = {
      changeStatus: document.getElementById('changeStatus'),
      changeList: document.getElementById('changeList'),
      currentTitle: document.getElementById('currentTitle'),
      reloadButton: document.getElementById('reloadButton'),
      banner: document.getElementById('banner'),
      taskList: document.getElementById('taskList'),
      topicSelect: document.getElementById('topicSelect'),
      selectionStatus: document.getElementById('selectionStatus'),
      thumbGrid: document.getElementById('thumbGrid'),
      viewer: document.getElementById('viewer'),
      viewerImage: document.getElementById('viewerImage'),
      viewerClose: document.getElementById('viewerClose'),
    };

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, function (ch) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
      });
    }

    function showBanner(message, type) {
      el.banner.textContent = message || '';
      el.banner.className = 'banner' + (message ? ' show' : '') + (type ? ' ' + type : '');
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

    async function loadChanges() {
      showBanner('');
      const data = await api('/api/changes');
      state.changes = data.changes || [];
      el.changeStatus.textContent = state.changes.length
        ? state.changes.length + ' changes with manual review'
        : 'No pending manual-review sections';
      renderChanges();
      if (!state.current && state.changes[0]) await loadChange(state.changes[0].name);
    }

    function renderChanges() {
      el.changeList.innerHTML = state.changes.map(function (change) {
        const current = state.current && state.current.name === change.name;
        return '<button type="button" class="change-row" data-change="' + esc(change.name) + '" aria-current="' + (current ? 'true' : 'false') + '">' +
          '<span class="change-name">' + esc(change.name) + '</span>' +
          '<span class="metrics">' +
          '<span class="metric">' + change.pending + ' pending</span>' +
          '<span class="metric">' + change.checked + '/' + change.total + ' checked</span>' +
          '<span class="metric' + (change.malformed ? ' bad' : '') + '">' + change.malformed + ' malformed</span>' +
          '<span class="metric">' + change.screenshotTopicCount + ' topics</span>' +
          '</span>' +
          '</button>';
      }).join('');
      el.changeList.querySelectorAll('[data-change]').forEach(function (button) {
        button.addEventListener('click', function () { loadChange(button.dataset.change); });
      });
    }

    async function loadChange(name) {
      showBanner('');
      const data = await api('/api/changes/' + encodeURIComponent(name));
      state.current = data.change;
      state.activeIndex = Math.max(0, (state.current.items || []).findIndex(function (item) { return !item.checked; }));
      if (state.activeIndex < 0) state.activeIndex = 0;
      state.selectedTopic = topicKey((state.current.screenshotPools || [])[0]) || '';
      renderChanges();
      renderCurrent();
    }

    function renderCurrent() {
      const change = state.current;
      if (!change) return;
      el.currentTitle.textContent = change.name;
      if (change.malformedLines.length) {
        showBanner('Malformed manual-review schema blocks writes. Fix the listed tasks.md lines first.', 'error');
      }
      renderTasks();
      renderTopics();
      renderThumbs();
    }

    function renderTasks() {
      const change = state.current;
      if (!change) {
        el.taskList.innerHTML = '<div class="empty">Select a change to begin.</div>';
        return;
      }
      if (!change.items.length && !change.malformedLines.length) {
        el.taskList.innerHTML = '<div class="empty">This change has a manual-review heading but no parseable items.</div>';
        return;
      }
      const malformed = change.malformedLines.map(function (line) {
        return '<div class="task-item"><div class="task-head"><span class="task-id">Line ' + line.lineNumber + '</span><span class="task-desc">' + esc(line.raw) + '</span><span class="task-state">malformed</span></div></div>';
      }).join('');
      const items = change.items.map(function (item, index) {
        const active = index === state.activeIndex;
        const selectedCount = (state.selectedShots[item.id] || []).length;
        return '<article class="task-item' + (active ? ' active' : '') + (item.scoped ? ' scoped' : '') + '" data-item="' + esc(item.id) + '">' +
          '<div class="task-head">' +
          '<span class="task-id">' + esc(item.id) + '</span>' +
          '<span class="task-desc">' + esc(item.description) + '</span>' +
          '<span class="task-state">' + (item.checked ? 'checked' : 'pending') + (selectedCount ? ' · ' + selectedCount + ' screenshots' : '') + '</span>' +
          '</div>' +
          '<textarea class="note" data-note="' + esc(item.id) + '" placeholder="Issue or skip note"></textarea>' +
          '<div class="actions">' +
          '<button class="ok" data-action="ok" data-id="' + esc(item.id) + '" type="button">OK</button>' +
          '<button class="issue" data-action="issue" data-id="' + esc(item.id) + '" type="button">Issue</button>' +
          '<button class="skip" data-action="skip" data-id="' + esc(item.id) + '" type="button">SKIP</button>' +
          '</div>' +
          '</article>';
      }).join('');
      el.taskList.innerHTML = malformed + items;
      el.taskList.querySelectorAll('[data-item]').forEach(function (node, index) {
        node.addEventListener('click', function (event) {
          if (event.target && event.target.dataset && event.target.dataset.action) return;
          state.activeIndex = index;
          renderTasks();
          renderThumbs();
        });
      });
      el.taskList.querySelectorAll('[data-action]').forEach(function (button) {
        button.addEventListener('click', function () { saveAction(button.dataset.id, button.dataset.action); });
      });
    }

    function topicKey(pool) {
      return pool ? pool.env + '/' + pool.topic : '';
    }

    function renderTopics() {
      const pools = state.current.screenshotPools || [];
      if (!pools.length) {
        el.topicSelect.innerHTML = '<option value="">No screenshot pools</option>';
        el.topicSelect.disabled = true;
        return;
      }
      el.topicSelect.disabled = false;
      el.topicSelect.innerHTML = pools.map(function (pool) {
        const key = topicKey(pool);
        return '<option value="' + esc(key) + '"' + (key === state.selectedTopic ? ' selected' : '') + '>' + esc(key) + ' (' + pool.files.length + ')</option>';
      }).join('');
      el.topicSelect.onchange = function () {
        state.selectedTopic = el.topicSelect.value;
        renderThumbs();
      };
    }

    function activeItem() {
      if (!state.current || !state.current.items.length) return null;
      return state.current.items[Math.min(state.activeIndex, state.current.items.length - 1)];
    }

    function activePool() {
      const pools = state.current ? state.current.screenshotPools || [] : [];
      return pools.find(function (pool) { return topicKey(pool) === state.selectedTopic; }) || pools[0];
    }

    function renderThumbs() {
      const item = activeItem();
      const pool = activePool();
      if (!item) {
        el.selectionStatus.textContent = 'No active item';
        el.thumbGrid.innerHTML = '<div class="empty">Select a review item.</div>';
        return;
      }
      if (!pool || !pool.files.length) {
        el.selectionStatus.textContent = 'Item ' + item.id + ' accepts text-only review';
        el.thumbGrid.innerHTML = '<div class="empty">No screenshots found under screenshots/&lt;env&gt;/&lt;topic&gt;/.</div>';
        return;
      }
      const selected = new Set(state.selectedShots[item.id] || []);
      el.selectionStatus.textContent = 'Item ' + item.id + ' · ' + selected.size + ' selected';
      el.thumbGrid.innerHTML = pool.files.map(function (file) {
        const isSelected = selected.has(file.relPath);
        return '<button type="button" class="thumb' + (isSelected ? ' selected' : '') + '" data-shot="' + esc(file.relPath) + '" data-url="' + esc(file.url) + '">' +
          '<span class="thumb-frame"><img loading="lazy" decoding="async" src="' + esc(file.url) + '" alt="' + esc(file.relPath) + '"></span>' +
          '<span>' + esc(file.name) + '</span>' +
          '</button>';
      }).join('');
      el.thumbGrid.querySelectorAll('[data-shot]').forEach(function (button) {
        button.addEventListener('click', function (event) {
          if (event.detail >= 2) openViewer(button.dataset.url, button.dataset.shot);
          else toggleShot(item.id, button.dataset.shot);
        });
        button.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            openViewer(button.dataset.url, button.dataset.shot);
          }
        });
      });
    }

    function toggleShot(itemId, relPath) {
      const list = new Set(state.selectedShots[itemId] || []);
      if (list.has(relPath)) list.delete(relPath);
      else list.add(relPath);
      state.selectedShots[itemId] = Array.from(list);
      renderTasks();
      renderThumbs();
    }

    async function saveAction(itemId, action) {
      const change = state.current;
      if (!change) return;
      if (change.malformedLines.length) {
        showBanner('Fix malformed schema before writing.', 'error');
        return;
      }
      const noteNode = el.taskList.querySelector('[data-note="' + CSS.escape(itemId) + '"]');
      const note = noteNode ? noteNode.value : '';
      if (action === 'issue' && !note.trim()) {
        showBanner('Issue requires a short note.', 'error');
        if (noteNode) noteNode.focus();
        return;
      }
      try {
        const data = await api('/api/changes/' + encodeURIComponent(change.name) + '/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            itemId: itemId,
            action: action,
            note: note,
            screenshots: state.selectedShots[itemId] || [],
            version: change.version,
          }),
        });
        state.current = data.change;
        if (data.archive && data.archive.status === 'success') {
          showBanner('Saved. Review archive completed.', '');
        } else if (data.archive && data.archive.status === 'failed') {
          showBanner('Saved. Review archive failed: ' + (data.archive.message || data.archive.stderr || 'manual recovery needed'), 'error');
        } else {
          showBanner('Saved ' + itemId + ' as ' + action + '.', '');
        }
        renderCurrent();
      } catch (err) {
        if (err.status === 409) showBanner('Write conflict. Reload the change before saving.', 'error');
        else showBanner(err.message || String(err), 'error');
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
    }

    function openViewer(url, label) {
      el.viewerImage.src = url;
      el.viewerImage.alt = label || 'Screenshot';
      el.viewer.classList.add('open');
      el.viewerClose.focus();
    }

    function closeViewer() {
      el.viewer.classList.remove('open');
      el.viewerImage.removeAttribute('src');
    }

    document.addEventListener('keydown', function (event) {
      if (el.viewer.classList.contains('open')) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeViewer();
        }
        return;
      }
      const tag = document.activeElement ? document.activeElement.tagName : '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      const item = activeItem();
      if (!item) return;
      const key = event.key.toLowerCase();
      if (key === 'j') { event.preventDefault(); moveActive(1); }
      else if (key === 'k') { event.preventDefault(); moveActive(-1); }
      else if (key === 'o') { event.preventDefault(); saveAction(item.id, 'ok'); }
      else if (key === 'i') { event.preventDefault(); saveAction(item.id, 'issue'); }
      else if (key === 's') { event.preventDefault(); saveAction(item.id, 'skip'); }
      else if (key === 'enter') {
        const first = el.thumbGrid.querySelector('[data-url]');
        if (first) openViewer(first.dataset.url, first.dataset.shot);
      }
    });

    el.reloadButton.addEventListener('click', function () {
      if (state.current) loadChange(state.current.name);
      else loadChanges();
    });
    el.viewerClose.addEventListener('click', closeViewer);
    el.viewer.addEventListener('click', function (event) {
      if (event.target === el.viewer) closeViewer();
    });

    loadChanges().catch(function (err) {
      showBanner(err.message || String(err), 'error');
      el.changeStatus.textContent = 'Unable to load changes';
    });
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
    `No available localhost port in range ${startPort}-${startPort + PORT_FALLBACK_RANGE}`
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
  }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--no-open') opts.openBrowser = false
    else if (arg === '--host') opts.host = argv[++i] || opts.host
    else if (arg === '--port') opts.port = Number(argv[++i] || DEFAULT_PORT)
    else if (arg === '--repo') opts.repoRoot = resolve(argv[++i] || opts.repoRoot)
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: review-gui.mts [--repo <path>] [--host 127.0.0.1] [--port 5174] [--no-open]'
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }
  return opts
}

async function main() {
  const options = parseArgs(process.argv)
  if (!existsSync(options.repoRoot))
    throw new Error(`Repo root does not exist: ${options.repoRoot}`)
  const { url } = await startServer(options)
  console.log(`[review:ui] repo: ${options.repoRoot}`)
  console.log(`[review:ui] ${url}`)
  if (options.openBrowser) {
    const opened = openBrowser(url)
    if (!opened) console.log(`[review:ui] Browser launch failed. Open this URL manually: ${url}`)
  } else {
    console.log('[review:ui] Browser launch skipped (--no-open)')
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
const currentPath = fileURLToPath(import.meta.url)

if (invokedPath === currentPath) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
