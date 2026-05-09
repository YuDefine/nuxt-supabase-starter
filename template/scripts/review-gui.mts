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
import { mkdir, open as openFd, readFile, readdir, stat, writeFile } from 'node:fs/promises'
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
const TRAILING_NO_SCREENSHOT_RE = /(^|[^ ]) @no-screenshot$/

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
  /** 含 `（issue: ...）` annotation 的 item 數；issue 在 raw 是 `[ ]`，仍算 pending 但 UI 要區分 */
  issued: number
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
  const { description, noScreenshot } = parseNoScreenshotMarker(match[3]!.trim())
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
  }
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
  // 切換 action 前先剝離舊 annotation，避免 stale 殘留（例：先 issue 後改 ok 會留 (issue: ...)）
  const stripped = stripAnnotations(line)
  if (action === 'ok') {
    const base = setCheckbox(stripped, true)
    return note.trim() ? appendAnnotation(base, 'note', note) : base
  }
  if (action === 'issue') {
    const base = setCheckbox(stripped, false)
    return appendAnnotation(base, 'issue', note || 'needs follow-up')
  }
  const base = setCheckbox(stripped, true)
  return appendAnnotation(base, 'skip', note)
}

function setCheckbox(line: string, checked: boolean): string {
  return line.replace(/^(\s*- \[)[ xX](\])/, `$1${checked ? 'x' : ' '}$2`)
}

function stripAnnotations(line: string): string {
  return line
    .replace(/（issue:[^）]*）/g, '')
    .replace(/（skip(?::[^）]*)?）/g, '')
    .replace(/（note:[^）]*）/g, '')
    .replace(/[ \t]+$/, '')
}

function appendAnnotation(line: string, kind: 'issue' | 'skip' | 'note', note: string): string {
  let label: string
  if (kind === 'skip') {
    label = note.trim() ? `（skip: ${sanitizeNote(note)}）` : '（skip）'
  } else if (kind === 'issue') {
    label = `（issue: ${sanitizeNote(note)}）`
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
        'Install consumer dev dependencies with: pnpm add -D hono tsx\n' +
        'Then run: pnpm review:ui\n\n' +
        `Original error: ${message}`,
      { cause: err }
    )
  }
}

export async function createReviewApp(repoRoot = process.cwd()): Promise<any> {
  const { Hono } = await loadHono()
  const app = new Hono()

  app.get('/review', (c: any) => {
    c.header('Cache-Control', 'no-store')
    return c.html(renderReviewHtml())
  })

  app.get('/api/health', (c: any) => c.json({ ok: true, repoRoot }))

  // GET /api/changes 與 /api/changes/:change 都不能讓瀏覽器 cache：
  // change detail 含 version.hash + mtime，cache 後 reload 會拿到 stale version
  // 而下一次 saveAction 仍用舊 version → server 端永遠回 409。
  app.get('/api/changes', async (c: any) => {
    c.header('Cache-Control', 'no-store')
    const changes = await listPendingChanges(repoRoot)
    return c.json({ changes })
  })

  app.get('/api/changes/:change', async (c: any) => {
    c.header('Cache-Control', 'no-store')
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

function topicMatchesChange(topic: string, change: string): boolean {
  if (topic === change) return true
  if (change.startsWith(topic + '-')) return true
  if (topic.startsWith(change + '-')) return true
  return false
}

function filterPoolsForChange(pools: ScreenshotTopic[], change: string): ScreenshotTopic[] {
  return pools.filter((pool) => topicMatchesChange(pool.topic, change))
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
    const summary = await summarizeChange(
      entry.name,
      tasksPath,
      filterPoolsForChange(pools, entry.name)
    )
    if (summary) summaries.push(summary)
  }

  return summaries.toSorted((a, b) => {
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

  // 「真的通過」= [x] 且沒有 issue annotation。`[x]` + `（issue: ...）` 並存
  // 是舊版時代的 stale state，語義上應算 issue 待解，不能算通過。
  const issued = parsed.items.filter((item) => /（issue:[^）]*）/.test(item.raw)).length
  const checked = parsed.items.filter(
    (item) => item.checked && !/（issue:[^）]*）/.test(item.raw)
  ).length
  return {
    name,
    tasksPath,
    total: parsed.items.length,
    checked,
    pending: parsed.items.length - checked,
    issued,
    malformed: parsed.malformed.length,
    screenshotTopicCount: pools.length,
    screenshotTopics: pools.map((pool) => `${pool.env}/${pool.topic}`),
  }
}

async function readChangeDetail(repoRoot: string, change: string): Promise<ChangeDetail> {
  const tasksPath = resolveChangeTasksPath(repoRoot, change)
  const [content, version, allPools] = await Promise.all([
    readFile(tasksPath, 'utf8'),
    readFileVersion(tasksPath),
    listScreenshotPools(repoRoot),
  ])
  const parsed = parseManualReviewSections(content)
  if (parsed.sections.length === 0) {
    throw new HttpError(404, `Change has no ## 人工檢查 section: ${change}`)
  }
  const pools = filterPoolsForChange(allPools, change)
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
    throw new HttpError(400, '無效的 change 名稱')
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
  // 與 summarizeChange 的 checked 算法同義：[x] 且沒 issue annotation 才算完成。
  // 否則 stale `[x] + （issue: ...）` 會誤觸發 archive。
  const complete =
    detail.malformed === 0 &&
    detail.items.length > 0 &&
    detail.items.every((item) => item.checked && !/（issue:[^）]*）/.test(item.raw))
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

  return pools.toSorted((a, b) => `${a.env}/${a.topic}`.localeCompare(`${b.env}/${b.topic}`))
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
  return files.toSorted((a, b) => a.relPath.localeCompare(b.relPath))
}

async function serveScreenshot(repoRoot: string, c: any): Promise<any> {
  const rawPath = decodeURIComponent(c.req.path.replace(/^\/api\/screenshot\//, ''))
  if (!rawPath.startsWith('screenshots/'))
    throw new HttpError(400, '截圖路徑必須以 screenshots/ 開頭')
  const normalized = normalize(rawPath)
  if (normalized.startsWith('..') || normalized.includes(`${sep}..${sep}`))
    throw new HttpError(400, '無效的截圖路徑')
  const abs = resolve(repoRoot, normalized)
  const screenshotsRoot = resolve(repoRoot, 'screenshots')
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

function renderReviewHtml(): string {
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
      margin: 0 0 14px;
      font-size: 18px;
      line-height: 1.2;
      letter-spacing: 0;
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
    .task-item.decision-ok { border-left: 4px solid #6aa181; }
    .task-item.decision-issue { border-left: 4px solid #c97a2c; }
    .task-item.decision-skip { border-left: 4px solid #8a8275; }
    .task-item.collapsed { padding: 8px 12px; opacity: 0.78; }
    .task-item.collapsed .note,
    .task-item.collapsed .actions { display: none; }
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
    .copy-handoff-btn.block {
      display: inline-flex;
      margin-top: 10px;
      margin-left: 0;
      padding: 6px 14px;
      font-size: 13px;
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
      <div id="changeStatus" class="status">載入 change 清單中…</div>
      <div id="changeList" class="change-list"></div>
    </aside>
    <main>
      <section class="review-pane">
        <div class="toolbar">
          <h2 id="currentTitle">選擇一個 change 開始</h2>
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
      // draftNotes: 使用者在 textarea 輸入但尚未 saveAction 的內容；以 itemId 為 key。
      // renderTasks 會整個重設 innerHTML 觸發 textarea 重建，沒這層 cache 會把
      // 使用者打字內容沖掉（renderTasks 由點 task / j/k / saveAction / reopen
      // 等多處觸發）。saveAction 成功後清掉該 id（server 已存進 raw）。
      draftNotes: {},
      // repoRoot / repoName 由啟動時 fetch /api/health 填入，給 handoff prompt 用。
      // 若 health fetch 失敗仍要讓 GUI 可用，prompt 會 fallback 顯示「(unknown)」。
      repoRoot: '',
      repoName: '',
    };
    const el = {
      changeStatus: document.getElementById('changeStatus'),
      changeList: document.getElementById('changeList'),
      currentTitle: document.getElementById('currentTitle'),
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
    // 5 種情境共用骨架；每種往下填情境專屬段落。產出的 prompt 應自給自足，
    // 即便丟到一個沒讀過 CLAUDE.md / 沒 conversation history 的 cleanroom Claude
    // session 也能直接接手。指示寫硬性使用 codebase-memory-mcp，對齊 user
    // global CLAUDE.md 的 Code Discovery rule。
    function handoffHeader(change) {
      const repoName = state.repoName || '(unknown)';
      const repoRoot = state.repoRoot || '(unknown)';
      const changeName = change ? change.name : '(unknown)';
      return [
        '我在 consumer repo「' + repoName + '」（路徑：' + repoRoot + '）',
        '跑 \`pnpm review:ui\` 做 spectra 人工檢查，遇到下面這個問題需要你接手分析、提方案，',
        '等我確認後再動手。',
        '',
        '## 環境',
        '- consumer: ' + repoName,
        '- repo root: ' + repoRoot,
        '- change: ' + changeName,
        '- tasks.md: openspec/changes/' + changeName + '/tasks.md',
        '- 相關 rules（若存在請優先讀）：',
        '  - .claude/rules/manual-review-format.md',
        '  - .claude/rules/screenshot-organization.md',
        '  - openspec/AGENTS.md（spectra 工作流）',
        '',
      ].join('\\n');
    }
    function handoffFooter() {
      return [
        '',
        '## 你要做的事',
        '1. 先讀 tasks.md 與相關 rules 確認當前真實狀態（不要相信我的轉述，以檔案為準）',
        '2. **MUST** 用 codebase-memory-mcp 做程式碼探索：',
        '   - search_graph(name_pattern/label/qn_pattern) 找函式 / class / route',
        '   - trace_path(function_name, mode=calls|data_flow|cross_service) 追 call chain',
        '   - get_code_snippet(qualified_name) 讀原始碼（不要用 cat / Read 讀程式碼檔）',
        '   - 若 graph 還沒 index，先跑 index_repository',
        '   - Grep / Glob / Read 只用於非程式碼檔（.md / config / .env）',
        '3. 提出處理方案：列出要動哪些檔、影響什麼、為何這樣修，**等我確認後再改**',
        '4. 不要急著動手——這是 plan-first 工作流；急著動手 = 違反 user 規則',
        '',
        '回覆時請先說「我看到的現況是 ...」再給方案，不要只回方案。',
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
          '- 確認檔名與 item id 的對應規範（見 .claude/rules/screenshot-organization.md 或 plugins/hub-core/agents/screenshot-review.md）',
          '- 若是命名漂掉，提議 rename 方案（map old → new，不要直接 mv）',
          '- 若是 item id 與設計不符（例如 tasks.md 是 #3 但截圖意圖是 #3.1 sub-item），建議改 tasks.md 結構',
        ].join('\\n');
      } else if (kind === 'conflict') {
        const cn = change ? change.name : '(unknown)';
        const ver = (change && change.version) || {};
        body = [
          '## 問題：review:ui 寫入衝突（HTTP 409）',
          '',
          'GUI 嘗試寫入 tasks.md 但 server 端偵測到 disk 內容與 client 持有的 version hash 不一致——意思是 tasks.md 在我按按鈕的同時被別的東西改過了。',
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
          '',
          '請把上面 issue 說明當 bug report 處理：',
          '1. 用 codebase-memory-mcp 找出這個 item 對應的 feature 在哪實作（從 description 抓 keyword → search_graph）',
          '2. trace_path 看相關 call chain，定位根因（不要急著看 symptom）',
          '3. 提修法：列要動的檔、影響範圍、是否需要新測試、是否需要更新 spec',
          '4. 若根因在 spec / 設計層級（不是 bug 而是 missing requirement），建議走 /spectra-ingest 改 proposal 而非直接改 code',
        ].join('\\n');
      } else {
        body = '## 問題\\n\\n(unknown kind: ' + kind + ')';
      }
      return handoffHeader(change) + body + handoffFooter();
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
      el.changeStatus.textContent = state.changes.length
        ? state.changes.length + ' 個 change 含人工檢查區塊'
        : '目前沒有待處理的人工檢查項目';
      renderChanges();
      if (!state.current && state.changes[0]) await loadChange(state.changes[0].name);
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
      const untouched = change.pending - issued;
      if (kind === 'issue') {
        if (untouched > 0) return '⚠ ' + issued + ' 問題・' + untouched + ' 待檢查';
        return '⚠ ' + issued + ' 個問題待修';
      }
      return untouched + ' 待檢查';
    }
    function renderChangeCard(change) {
      const current = state.current && state.current.name === change.name;
      const kind = changeCardKind(change);
      const badge = changeCardBadge(change, kind);
      return '<button type="button" class="change-row card-' + kind + '" data-change="' + esc(change.name) + '" aria-current="' + (current ? 'true' : 'false') + '">' +
        '<span class="change-name">' + esc(change.name) + '</span>' +
        '<span class="card-badge ' + kind + '">' + esc(badge) + '</span>' +
        '<span class="metrics">' +
        '<span class="metric" title="已通過（含 skip） / 總項目數">' + change.checked + '/' + change.total + ' 通過</span>' +
        (change.screenshotTopicCount ? '<span class="metric" title="對應的截圖資料夾數">' + change.screenshotTopicCount + ' 截圖</span>' : '') +
        '</span>' +
        '</button>';
    }
    function renderChanges() {
      const active = [];
      const done = [];
      for (const change of state.changes) {
        if (changeCardKind(change) === 'done') done.push(change);
        else active.push(change);
      }
      const blocks = [];
      if (active.length) {
        blocks.push(
          '<div class="change-group">' +
          '<div class="change-group-heading">進行中 · ' + active.length + '</div>' +
          active.map(renderChangeCard).join('') +
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
    }

    async function loadChange(name) {
      showBanner('');
      const data = await api('/api/changes/' + encodeURIComponent(name));
      state.current = data.change;
      state.activeIndex = Math.max(0, (state.current.items || []).findIndex(function (item) { return !item.checked; }));
      if (state.activeIndex < 0) state.activeIndex = 0;
      state.expanded = new Set();
      state.draftNotes = {};
      renderChanges();
      renderCurrent();
    }

    function renderCurrent() {
      const change = state.current;
      if (!change) return;
      el.currentTitle.textContent = change.name;
      if (change.malformedLines.length) {
        showBannerWithHandoff('人工檢查格式錯誤，需先修正下列 tasks.md 行才能寫入', 'error', 'malformed', '格式錯誤', '');
      }
      renderTasks();
      renderThumbs();
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
      const items = change.items.map(function (item, index) {
        const active = index === state.activeIndex;
        const decision = parseDecision(item.raw);
        const handled = decision.kind !== 'pending';
        const collapsed = handled && !state.expanded.has(item.id);
        const decisionClass = handled ? ' decision-' + decision.kind : '';
        let stateHtml;
        if (handled) {
          stateHtml = '<span class="state-badge ' + decision.kind + '">' + decisionLabel(decision.kind) + '</span>';
          if (collapsed) {
            stateHtml += '<button class="reopen" data-action="reopen" data-id="' + esc(item.id) + '" type="button" title="重新編輯此項">↻ 編輯</button>';
          }
          if (decision.kind === 'issue') {
            stateHtml += '<button class="copy-handoff-btn" data-handoff="item-issue" data-id="' + esc(item.id) + '" type="button" title="複製 handoff prompt 給新 Claude session 處理這個 issue">📋 handoff</button>';
          }
        } else {
          stateHtml = '待檢查';
        }
        const noteValue = decision.note ? esc(decision.note) : '';
        return '<article class="task-item' + (active ? ' active' : '') + (item.scoped ? ' scoped' : '') + decisionClass + (collapsed ? ' collapsed' : '') + '" data-item="' + esc(item.id) + '">' +
          '<div class="task-head">' +
          '<span class="task-id">' + esc(item.id) + '</span>' +
          '<span class="task-desc">' + esc(item.description) + '</span>' +
          '<span class="task-state">' + stateHtml + '</span>' +
          '</div>' +
          '<textarea class="note" data-note="' + esc(item.id) + '" placeholder="填寫說明（「有問題」必填、「跳過」可選填）">' + noteValue + '</textarea>' +
          '<div class="actions">' +
          '<button class="ok" data-action="ok" data-id="' + esc(item.id) + '" type="button" title="標記此項通過 (O)">✓ 通過</button>' +
          '<button class="issue" data-action="issue" data-id="' + esc(item.id) + '" type="button" title="標記此項有問題，需填寫說明 (I)">⚠ 有問題</button>' +
          '<button class="skip" data-action="skip" data-id="' + esc(item.id) + '" type="button" title="跳過此項，可選填原因 (S)">⤵ 跳過</button>' +
          '</div>' +
          '</article>';
      }).join('');
      el.taskList.innerHTML = malformed + items;
      el.taskList.querySelectorAll('[data-item]').forEach(function (node, index) {
        node.addEventListener('click', function (event) {
          const interactive = event.target.closest && event.target.closest('button, textarea, input, select');
          // 點當前 active card 的互動元素：不重建，保留 focus 與輸入
          if (interactive && state.activeIndex === index) return;
          if (state.activeIndex === index) return;
          // 點別張 card：切 active，若原本點的是 textarea，重建後把 focus 還回對應 textarea
          const focusNoteId = (event.target.tagName === 'TEXTAREA' && event.target.dataset && event.target.dataset.note)
            ? event.target.dataset.note
            : null;
          state.activeIndex = index;
          renderTasks();
          renderThumbs();
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
      const change = state.current;
      const pools = change ? change.screenshotPools || [] : [];
      const allFiles = changeFiles();
      const matched = allFiles.filter(function (f) { return fileMatchesItem(f.name, item.id); });
      const idLabel = item.id.replace(/^#/, '');
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
      el.selectionStatus.textContent = '檢查項 ' + item.id + ' · 對應 ' + matched.length + ' / ' + allFiles.length + ' 張（topic 資料夾：' + pools.map(function (p) { return p.env + '/' + p.topic; }).join(', ') + '）';
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
            version: change.version,
          }),
        });
        state.current = data.change;
        state.expanded.delete(itemId);
        delete state.draftNotes[itemId];
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
      el.changeStatus.textContent = '無法載入 change 清單';
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
