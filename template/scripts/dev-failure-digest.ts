#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/dev-failure-digest.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/dev-failure-digest.ts
/**
 * dev-failure-digest — 本機測試／E2E／agent-browser／curl 失敗後，印出上次讀之後新增的
 * server 失敗事件（evlog fs drain）與框架診斷（nostics collector），讓 agent 先讀 why/fix
 * 再讀 code。
 *
 * 規約：rules/modules/capabilities/evlog/evlog-investigate.md § dev／E2E 失敗；
 * 寫端：vendor/snippets/evlog-dev-fs-drain/。
 *
 * 讀哪裡：
 *   - `<tree>/.evlog/logs/*.jsonl`（nuxt dev）、`<tree>/.evlog/e2e/*.jsonl`（E2E）、`<tree>/.nostics.log`
 *   - `<tree>` = 自己的 consumer root（`--root` > `CLADE_CONSUMER_ROOT` > 本腳本在 consumer 版面
 *     `<consumerRoot>/scripts/` 時的上一層 > git toplevel；monorepo 子目錄 consumer 的 git toplevel
 *     是 meta repo 根，不是 consumer root），加上 dev-session verification lease 指向的 `devServer.cwd`；
 *     每棵樹另讀 `packages|apps|clients|layers/<x>/`（多套件 repo 的 Nuxt rootDir）
 *     （pinned port 多棵 worktree 共用時，寫檔的是持 lease 那棵，不一定是自己這棵）
 *
 * 挑什麼：
 *   - evlog：level error／fatal，且 status ≥500 或沒有 status（4xx 是測試常態，濾掉）
 *   - nostics：每一條新行
 *
 * 游標：byte offset 記在 `<root>/.clade/runtime/dev-failure-digest-cursor.json`；只讀到最後一個
 * 完整換行。NEVER 改寫、截斷或刪除 log 檔（collector／drain 同時在附加）。檔案 inode 變了或
 * 變短（輪替）就從 0 重讀。
 *
 * Usage:
 *   node vendor/scripts/dev-failure-digest.ts [--root <dir>] [--lease-dir <dir>] [--max <n>]
 *                                             [--json] [--peek]
 *   --peek   讀但不推進游標（輸出被截斷時，先 --peek --json 看全部再正常跑）
 *   --json   印 {roots, entries} JSON（不截 20 行）
 *
 * Exit: 0 正常（有沒有新事件都是 0）；2 參數錯誤。
 */

import { execFileSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_MAX_LINES = 20
const CURSOR_REL = '.clade/runtime/dev-failure-digest-cursor.json'
const EVLOG_DIRS = ['.evlog/logs', '.evlog/e2e']
const NOSTICS_FILE = '.nostics.log'
const FIELD_MAX = 200

export interface DigestEntry {
  source: 'evlog' | 'nostics'
  /** 事件來自別棵樹（lease 指向的 devServer.cwd）時記那棵樹的 root；自己這棵不記。 */
  tree?: string
  file: string
  timestamp?: string
  status?: number
  code?: string
  path?: string
  message?: string
  why?: string
  fix?: string
  requestId?: string
  raw?: string
}

interface CursorFile {
  version: 1
  files: Record<string, { offset: number; ino: number }>
}

export interface ServingRoot {
  root: string
  via: 'self' | 'lease'
  leaseFile?: string
}

// ── serving tree ─────────────────────────────────────────────────────────

function git(cwd: string, args: string[]): string | null {
  try {
    const out = execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out || null
  } catch {
    return null
  }
}

/**
 * lease 檔名用的 consumer id——與 dev-session.ts resolveConsumerId 同序：
 * `consumerId` → 舊 key `consumer_id` → main checkout 目錄名 → git toplevel 目錄名 → root 目錄名。
 * 少一個 fallback，持 lease 的那棵樹就被靜默略過，空輸出會被讀成「server 沒有 5xx」。
 */
export function readConsumerId(root: string): string {
  const metaPath = join(root, '.claude', 'consumer-meta.json')
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
      if (typeof meta?.consumerId === 'string' && meta.consumerId) return meta.consumerId
      if (typeof meta?.consumer_id === 'string' && meta.consumer_id) return meta.consumer_id
    } catch {
      // 壞掉的 meta → 走目錄名 fallback
    }
  }
  const commonDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const gitIdx = commonDir ? commonDir.lastIndexOf('/.git') : -1
  if (commonDir && gitIdx > 0) return basename(commonDir.slice(0, gitIdx))
  const top = git(root, ['rev-parse', '--show-toplevel'])
  return basename(top ?? root)
}

function pidAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * 自己這棵樹＋該 consumer 每張活著的 verification lease 指向的 devServer.cwd。
 * lease 檔名規則同 dev-session.ts／dev-singleton.ts：`<consumerId>[-<port>]-verification-lease.json`。
 */
export function resolveServingRoots(root: string, leaseDir: string): ServingRoot[] {
  const roots: ServingRoot[] = []
  const seen = new Set<string>()
  const consumerId = readConsumerId(root)
  if (existsSync(leaseDir)) {
    const pattern = new RegExp(
      `^${consumerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:-\\d+)?-verification-lease\\.json$`,
    )
    for (const name of readdirSync(leaseDir)
      .filter((n) => pattern.test(n))
      .toSorted()) {
      const leaseFile = join(leaseDir, name)
      try {
        const lease = JSON.parse(readFileSync(leaseFile, 'utf8'))
        const cwd = lease?.devServer?.cwd
        if (typeof cwd !== 'string' || !pidAlive(lease?.devServer?.pid)) continue
        const abs = resolve(cwd)
        if (seen.has(abs) || !existsSync(abs)) continue
        seen.add(abs)
        roots.push({ root: abs, via: 'lease', leaseFile })
      } catch {
        // 壞掉的 lease 檔不擋 digest
      }
    }
  }
  const self = resolve(root)
  if (!seen.has(self)) roots.push({ root: self, via: 'self' })
  return roots
}

// ── cursor ───────────────────────────────────────────────────────────────

function loadCursor(path: string): CursorFile {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed?.version === 1 && parsed.files && typeof parsed.files === 'object') return parsed
  } catch {
    // 沒有或壞掉 → 從頭讀
  }
  return { version: 1, files: {} }
}

function saveCursor(path: string, cursor: CursorFile): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(cursor, null, 2)}\n`)
  renameSync(tmp, path)
}

/** 從游標讀到最後一個完整換行；回傳新行與新 offset。只開唯讀 fd。 */
function readNewLines(file: string, prev: { offset: number; ino: number } | undefined) {
  const st = statSync(file)
  let start = prev && prev.ino === st.ino && prev.offset <= st.size ? prev.offset : 0
  if (st.size <= start) return { lines: [] as string[], offset: start, ino: st.ino }
  const length = st.size - start
  const buf = Buffer.alloc(length)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, buf, 0, length, start)
  } finally {
    closeSync(fd)
  }
  const lastNl = buf.lastIndexOf(0x0a)
  if (lastNl < 0) return { lines: [], offset: start, ino: st.ino }
  const text = buf.subarray(0, lastNl + 1).toString('utf8')
  start += lastNl + 1
  return { lines: text.split('\n').filter((l) => l.trim() !== ''), offset: start, ino: st.ino }
}

// ── parse ────────────────────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim())
    return v.length > FIELD_MAX ? `${v.slice(0, FIELD_MAX)}…` : v
  if (typeof v === 'number') return String(v)
  return undefined
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

export function parseEvlogLine(line: string, file: string): DigestEntry | null {
  let ev: Record<string, unknown>
  try {
    ev = obj(JSON.parse(line))
  } catch {
    return null
  }
  const level = String(ev.level ?? '').toLowerCase()
  if (level !== 'error' && level !== 'fatal') return null
  const err = obj(ev.error)
  const rawStatus = ev.status ?? err.status ?? err.statusCode
  const status =
    typeof rawStatus === 'number' ? rawStatus : Number.parseInt(String(rawStatus ?? ''), 10)
  if (Number.isFinite(status) && status < 500) return null
  return {
    source: 'evlog',
    file,
    timestamp: str(ev.timestamp),
    status: Number.isFinite(status) ? status : undefined,
    code: str(err.code ?? ev.code ?? err.name),
    path: str(ev.path ?? obj(ev.request).path),
    message: str(err.message ?? ev.message),
    why: str(err.why ?? ev.why),
    fix: str(err.fix ?? ev.fix),
    requestId: str(ev.requestId ?? obj(ev.request).id ?? ev.traceId),
  }
}

export function parseNosticsLine(line: string, file: string): DigestEntry {
  try {
    const d = obj(JSON.parse(line))
    return {
      source: 'nostics',
      file,
      timestamp: str(d.timestamp ?? d.time),
      code: str(d.code),
      message: str(d.message),
      why: str(d.why),
      fix: str(d.fix),
    }
  } catch {
    return { source: 'nostics', file, raw: str(line.trim()) }
  }
}

// ── digest ───────────────────────────────────────────────────────────────

function jsonlFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.endsWith('.jsonl'))
    .toSorted()
    .map((n) => join(dir, n))
}

export interface DigestOptions {
  roots: ServingRoot[]
  cursorPath: string
  advance?: boolean
}

/** 多套件 repo 的 Nuxt rootDir 在 `packages/<x>`、`apps/<x>` 等子目錄，那裡的 .evlog／.nostics.log 也要讀。 */
const APP_PARENT_DIRS = ['packages', 'apps', 'clients', 'layers']

export function appRoots(root: string): string[] {
  const out = [root]
  for (const parent of APP_PARENT_DIRS) {
    const dir = join(root, parent)
    if (!existsSync(dir)) continue
    for (const d of readdirSync(dir, { withFileTypes: true }).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (d.isDirectory()) out.push(join(dir, d.name))
    }
  }
  return out
}

export function collectDigest({ roots, cursorPath, advance = true }: DigestOptions): DigestEntry[] {
  const cursor = loadCursor(cursorPath)
  const entries: DigestEntry[] = []
  for (const { root, tree } of roots.flatMap((r) =>
    appRoots(r.root).map((dir) => ({ root: dir, tree: r.via === 'lease' ? r.root : undefined })),
  )) {
    const tag = (e: DigestEntry): DigestEntry => (tree ? { ...e, tree } : e)
    for (const rel of EVLOG_DIRS) {
      for (const file of jsonlFiles(join(root, rel))) {
        const r = readNewLines(file, cursor.files[file])
        cursor.files[file] = { offset: r.offset, ino: r.ino }
        for (const line of r.lines) {
          const e = parseEvlogLine(line, file)
          if (e) entries.push(tag(e))
        }
      }
    }
    const nostics = join(root, NOSTICS_FILE)
    if (existsSync(nostics)) {
      const r = readNewLines(nostics, cursor.files[nostics])
      cursor.files[nostics] = { offset: r.offset, ino: r.ino }
      for (const line of r.lines) entries.push(tag(parseNosticsLine(line, nostics)))
    }
  }
  if (advance) saveCursor(cursorPath, cursor)
  return entries
}

/** 別棵樹的事件標 `[source@<tree root>]`，與失敗測試打到的那棵分得出來。 */
export function formatEntry(e: DigestEntry): string {
  const label = e.tree ? `[${e.source}@${e.tree}]` : `[${e.source}]`
  if (e.source === 'nostics' && e.raw) return `${label} ${e.raw}`
  const parts = [label]
  if (e.source === 'evlog') parts.push(e.status === undefined ? 'status=-' : `status=${e.status}`)
  if (e.code) parts.push(`code=${e.code}`)
  if (e.path) parts.push(`path=${e.path}`)
  if (e.why) parts.push(`why=${e.why}`)
  else if (e.message) parts.push(`msg=${e.message}`)
  if (e.fix) parts.push(`fix=${e.fix}`)
  if (e.requestId) parts.push(`requestId=${e.requestId}`)
  return parts.join(' ')
}

/** 依 timestamp 由舊到新排（沒有 timestamp 的排最前、維持讀取順序）；多棵樹、多目錄交錯時截斷才真的丟最舊的。 */
export function sortByTimestamp(entries: DigestEntry[]): DigestEntry[] {
  return entries
    .map((e, i) => ({ e, i, t: e.timestamp ? Date.parse(e.timestamp) : Number.NaN }))
    .toSorted((a, b) => {
      const ta = Number.isNaN(a.t) ? -Infinity : a.t
      const tb = Number.isNaN(b.t) ? -Infinity : b.t
      return ta === tb ? a.i - b.i : ta - tb
    })
    .map((x) => x.e)
}

/** 最多 max 行；超過時留最新的 max-1 筆，最後一行說省略幾筆。 */
export function formatDigest(
  entries: DigestEntry[],
  max = DEFAULT_MAX_LINES,
  { advanced = true }: { advanced?: boolean } = {},
): string[] {
  const sorted = sortByTimestamp(entries)
  if (sorted.length <= max) return sorted.map(formatEntry)
  const keep = sorted.slice(sorted.length - (max - 1))
  return [
    ...keep.map(formatEntry),
    advanced
      ? `… +${sorted.length - keep.length} 筆較舊的未列（游標已推進；要全看下次先跑 --peek --json）`
      : `… +${sorted.length - keep.length} 筆較舊的未列（--peek：游標未推進；要全看加 --json）`,
  ]
}

// ── CLI ──────────────────────────────────────────────────────────────────

/**
 * 沒帶 `--root` 時的 consumer root——同 vendor/scripts/pre-commit/consumer-root.sh 的優先序：
 *   1. `CLADE_CONSUMER_ROOT`（存在的目錄）
 *   2. 本腳本在 consumer 版面 `<consumerRoot>/scripts/` → 上一層（clade 源檔 `vendor/scripts/` 不算）
 *   3. cwd 的 git toplevel（再不行就 cwd）
 * monorepo 子目錄 consumer（registry `local_dir: <repo>/template`）的 git toplevel 是 meta repo 根，
 * 只走 3 會讀錯樹、空輸出被當成「沒有 5xx」，游標也寫進 meta repo。
 */
export function defaultRoot(scriptPath: string, cwd: string, env: NodeJS.ProcessEnv): string {
  const fromEnv = env.CLADE_CONSUMER_ROOT
  if (fromEnv && existsSync(fromEnv)) return resolve(fromEnv)
  const here = dirname(scriptPath)
  if (basename(here) === 'scripts') {
    const parent = dirname(here)
    if (basename(parent) !== 'vendor') return parent
  }
  return git(cwd, ['rev-parse', '--show-toplevel']) ?? cwd
}

function main(argv: string[]): number {
  let root: string | undefined
  let leaseDir = tmpdir()
  let max = DEFAULT_MAX_LINES
  let json = false
  let peek = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--root') root = argv[++i]
    else if (a === '--lease-dir') leaseDir = argv[++i]
    else if (a === '--max') max = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--json') json = true
    else if (a === '--peek') peek = true
    else if (a === '-h' || a === '--help') {
      process.stdout.write(
        'Usage: dev-failure-digest.ts [--root <dir>] [--lease-dir <dir>] [--max <n>] [--json] [--peek]\n',
      )
      return 0
    } else {
      process.stderr.write(`dev-failure-digest: unknown argument ${a}\n`)
      return 2
    }
  }
  if (!Number.isInteger(max) || max < 2) {
    process.stderr.write('dev-failure-digest: --max must be an integer ≥ 2\n')
    return 2
  }
  const self = resolve(
    root ?? defaultRoot(fileURLToPath(import.meta.url), process.cwd(), process.env),
  )
  const roots = resolveServingRoots(self, leaseDir)
  const entries = collectDigest({ roots, cursorPath: join(self, CURSOR_REL), advance: !peek })
  if (json) {
    process.stdout.write(`${JSON.stringify({ roots, entries }, null, 2)}\n`)
  } else if (entries.length > 0) {
    process.stdout.write(`${formatDigest(entries, max, { advanced: !peek }).join('\n')}\n`)
  }
  return 0
}

function invokedAsCli(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return entry === fileURLToPath(import.meta.url)
  }
}

if (invokedAsCli()) {
  process.exitCode = main(process.argv.slice(2))
}
