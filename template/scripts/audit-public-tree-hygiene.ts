#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/audit-public-tree-hygiene.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/audit-public-tree-hygiene.ts
// CLADE:VENDOR-SCRIPT
/**
 * audit-public-tree-hygiene.ts — PUBLIC consumer 自寫檔洩漏 gate
 *
 * 為什麼存在：propagate 只消毒「clade 投影出去的檔」。consumer 自己寫、自己 commit 的
 * tracked 檔（交接檔、tasks、docs ...）從來沒有任何 gate——實際發生過：PUBLIC repo 把含
 * 其他客戶代號與 maintainer 本機路徑的自寫檔推上公開 GitHub。本 audit 補的就是那一圈。
 *
 * 與 `audit-clade-leak.ts` 的分工：那支掃「clade 投影進來的檔」（清單 runtime 從 clade
 * registry 解析，只在 clade home 有效）；本支掃「整棵 tracked tree」，且**只吃投影進
 * consumer 的 hash 清單**，所以在 public CI（ubuntu-latest、沒有 clade）一樣能跑。
 *
 * token 清單**不可明文**進 public repo——清單本身就是客戶名單。因此 clade 端產生 salted
 * hash 檔（`scripts/public-tree-hygiene-tokens.json`），本支用滑窗 hash 比對：
 *   - consumer 代號：左側為非英數或行首、右側為非英數或行尾、不分大小寫（與 clade
 *     sanitizeText 的 `(?<![a-z0-9])TOKEN(?![a-z0-9])` + `i` 同語義；`_` / `-` 都算邊界）
 *   - personal：literal substring（區分大小寫）
 *   - literal：forbidden_tokens（完整 repo id 之類），literal substring
 * 輸出**只報 file:line:col + 類別 + 長度，NEVER 印出命中的文字**：public repo 的 CI log
 * 本身是公開的。
 *
 * ⚠️ 本檔會被投影進每個 PUBLIC consumer，並被 propagate 逐字套 sanitization profile。
 * NEVER 在這裡寫任何 consumer 代號 / 個人路徑字面（含註解與範例）——會被改寫，且
 * `test/audit-public-tree-hygiene.test.ts` 的 fixed-point 測試會擋。
 *
 * Usage:
 *   node scripts/audit-public-tree-hygiene.ts --staged        # pre-commit：掃 index 內 staged blob
 *   node scripts/audit-public-tree-hygiene.ts --tree          # CI：掃全部 `git ls-files`（不帶 paths filter）
 *   --root <dir>      要掃的 git repo root（預設 cwd 的 git toplevel；monorepo 式 consumer 也是整個 repo）
 *   --tokens <file>   hash 清單（預設：與本 script 同目錄的 public-tree-hygiene-tokens.json）
 *   --json            機器輸出
 *
 * Exit（per rules/core/checker-contract.md）：0 乾淨 / 1 有命中 / 2 infrastructure error
 * （hash 檔缺失或毀損、git 列舉失敗——**NEVER** 當綠燈）。
 *
 * 跳過：binary（前 8KB 含 NUL）、submodule gitlink；全數列在輸出 `skipped:`。
 * 路徑本身也掃（檔名含客戶代號同樣是洩漏）。
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** hash 清單與本 script 同目錄投影（starter 式 monorepo 是 `template/scripts/`，不是 repo root）。 */
export const HASH_FILE_NAME = 'public-tree-hygiene-tokens.json'
export const HASH_FILE_VERSION = 2
/**
 * 清單裡的前綴 hash 只留 12 bit：它只是預篩，必須大量碰撞——32-bit 未加 salt 的多項式
 * hash 可以直接解回長 token 的前 w 個字。命中與否一律由 salted sha 決定。
 */
export const PREFIX_MASK = 0x0fff
export const HASH_ALGO = 'sha256-16'
const DEFAULT_TOKENS_PATH = join(dirname(fileURLToPath(import.meta.url)), HASH_FILE_NAME)
const CANARY = 'public-tree-hygiene-canary'
const BINARY_SNIFF_BYTES = 8192

export type HitClass = 'consumer' | 'personal' | 'literal'
export const CLASS_LABEL: Record<HitClass, string> = {
  consumer: 'consumer 代號',
  personal: 'personal（個人路徑／email）',
  literal: 'forbidden literal（repo id 等）',
}

export interface HashEntry {
  /** token 長度（UTF-16 code units） */
  l: number
  /** token 前 w 個字的滾動 hash 取低 12 bit（PREFIX_MASK），只當預篩；命中才用 sha 確認 */
  p: number
  /** salted sha256 前 16 hex（整個 token） */
  h: string
}
export interface HashClass {
  /** 預篩窗口 = 該類最短 token 長度；掃描每類只滑一次窗，不是每個長度一次 */
  w: number
  entries: HashEntry[]
}
export interface HashFile {
  version: number
  algo: string
  salt: string
  canary: { h: string; r: number }
  consumer: HashClass
  personal: HashClass
  literal: HashClass
}
export interface Hit {
  cls: HitClass
  line: number
  col: number
  len: number
}

// ─── hash primitives（generator 與 audit 共用同一份） ──────────────────────

const ROLL_BASE = 16777619

export function shaHash(salt: string, s: string): string {
  return createHash('sha256').update(`${salt}\0${s}`).digest('hex').slice(0, 16)
}

/** 只動 ASCII A-Z、保持 index 不變——與 regex `i`（非 unicode）對 ASCII 的語義一致。 */
export function lowerAscii(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32))
}

export function rollingHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, ROLL_BASE) + s.charCodeAt(i)) >>> 0
  return h
}

function isAlnumCode(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
}

// ─── 清單載入 ──────────────────────────────────────────────────────────────

interface Table {
  w: number
  /** 前 w 字滾動 hash -> 候選（長度 + 整 token sha） */
  byPrefix: Map<number, Array<{ l: number; h: string }>>
  /** PREFIX_MASK 寬的預篩 bitmap（載入時建一次，不要每個檔重配）。 */
  bitmap: Uint8Array
  /** ROLL_BASE^(w-1) */
  pow: number
}

function buildTable(c: HashClass): Table {
  const byPrefix = new Map<number, Array<{ l: number; h: string }>>()
  const bitmap = new Uint8Array(PREFIX_MASK + 1)
  for (const e of c.entries) {
    let a = byPrefix.get(e.p)
    if (!a) byPrefix.set(e.p, (a = []))
    a.push({ l: e.l, h: e.h })
    bitmap[e.p] = 1
  }
  let pow = 1
  for (let k = 1; k < c.w; k++) pow = Math.imul(pow, ROLL_BASE)
  return { w: c.entries.length === 0 ? 0 : c.w, byPrefix, bitmap, pow }
}

export interface LoadedTokens {
  salt: string
  consumer: Table
  personal: Table
  literal: Table
  entryCount: number
}

function validClass(c: unknown): c is HashClass {
  const x = c as HashClass
  return (
    !!x &&
    Array.isArray(x.entries) &&
    Number.isInteger(x.w) &&
    x.w > 0 &&
    x.entries.every((e) => validEntry(e) && e.l >= x.w)
  )
}

function validEntry(e: unknown): e is HashEntry {
  const x = e as HashEntry
  return (
    !!x &&
    Number.isInteger(x.l) &&
    x.l > 0 &&
    Number.isInteger(x.p) &&
    x.p >= 0 &&
    x.p <= PREFIX_MASK &&
    typeof x.h === 'string' &&
    /^[0-9a-f]{16}$/.test(x.h)
  )
}

/** 解析 + 驗證 hash 檔；任何不合法 throw（caller 轉 exit 2）。 */
export function loadTokens(raw: string): LoadedTokens {
  let f: HashFile
  try {
    f = JSON.parse(raw)
  } catch (err) {
    throw new Error(`hash 檔不是合法 JSON: ${(err as Error).message}`, { cause: err })
  }
  if (!f || f.version !== HASH_FILE_VERSION || f.algo !== HASH_ALGO) {
    throw new Error(
      `hash 檔版本不符（要 version=${HASH_FILE_VERSION} algo=${HASH_ALGO}，實得 version=${f?.version} algo=${f?.algo}）——重新 propagate`,
    )
  }
  if (typeof f.salt !== 'string' || f.salt.length < 8) throw new Error('hash 檔缺 salt')
  for (const k of ['consumer', 'personal', 'literal'] as const) {
    if (!validClass(f[k])) throw new Error(`hash 檔 ${k} 區段毀損`)
  }
  // canary：本檔的 hash 實作必須與 generator 一致，否則整份比對都是假綠。
  if (f.canary?.h !== shaHash(f.salt, CANARY) || f.canary?.r !== rollingHash(CANARY)) {
    throw new Error('hash 檔 canary 不符——generator 與本 audit 的 hash 實作漂移，重新 propagate')
  }
  const entryCount =
    f.consumer.entries.length + f.personal.entries.length + f.literal.entries.length
  if (entryCount === 0) {
    throw new Error('hash 檔沒有任何 token——空清單會讓 audit 恆綠（fail-closed）')
  }
  return {
    salt: f.salt,
    consumer: buildTable(f.consumer),
    personal: buildTable(f.personal),
    literal: buildTable(f.literal),
    entryCount,
  }
}

// ─── 掃描 ──────────────────────────────────────────────────────────────────

/**
 * 對整段文字滑窗（不逐行：逐行會讓每行都付一次 O(L) 的初始化，13MB 實測 22s）。
 * 比對不會跨行——token 不含換行，跨行窗口湊出命中的機率等於 hash 碰撞，且 sha 會再確認。
 * boundary=true（consumer 代號）：用 ASCII 小寫碼、且只在「左側為文首／非英數、右側為
 * 文尾／非英數」的窗口比 hash；否則 literal substring。
 * 預篩順序：12-bit bitmap → 同一 12-bit 前綴的候選 → （boundary）→ salted sha256 確認。
 * 每類只滑一次窗（w = 該類最短 token 長度），不是每個 token 長度各滑一次——後者 13MB
 * 要 10 秒、前者不到 1 秒。
 */
function scanTable(
  text: string,
  codes: Uint16Array,
  table: Table,
  salt: string,
  boundary: boolean,
  cls: HitClass,
  out: Array<{ cls: HitClass; off: number; len: number }>,
): void {
  const n = codes.length
  const w = table.w
  if (w === 0 || w > n) return
  const { bitmap, byPrefix, pow } = table
  let h = 0
  for (let k = 0; k < w; k++) h = (Math.imul(h, ROLL_BASE) + codes[k]) | 0
  for (let i = 0; ; i++) {
    if (bitmap[h & PREFIX_MASK] === 1) {
      const cands = byPrefix.get(h & PREFIX_MASK)
      if (cands && (!boundary || i === 0 || !isAlnumCode(codes[i - 1]))) {
        for (const c of cands) {
          if (i + c.l > n) continue
          if (boundary && i + c.l < n && isAlnumCode(codes[i + c.l])) continue
          const s = text.slice(i, i + c.l)
          if (c.h === shaHash(salt, boundary ? lowerAscii(s) : s)) {
            out.push({ cls, off: i, len: c.l })
          }
        }
      }
    }
    if (i + w >= n) break
    h = (Math.imul((h - Math.imul(codes[i], pow)) | 0, ROLL_BASE) + codes[i + w]) | 0
  }
}

/** 掃一段文字（可多行）；`firstLine` 讓路徑掃描報 line=0。 */
export function scanText(text: string, tokens: LoadedTokens, firstLine = 1): Hit[] {
  const n = text.length
  const raw = new Uint16Array(n)
  const low = new Uint16Array(n)
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i)
    raw[i] = c
    low[i] = c >= 65 && c <= 90 ? c + 32 : c
  }
  const found: Array<{ cls: HitClass; off: number; len: number }> = []
  scanTable(text, low, tokens.consumer, tokens.salt, true, 'consumer', found)
  scanTable(text, raw, tokens.personal, tokens.salt, false, 'personal', found)
  scanTable(text, raw, tokens.literal, tokens.salt, false, 'literal', found)
  if (found.length === 0) return []
  // offset → line/col（只對命中算，二分搜尋行首表）
  const lineStarts = [0]
  for (let i = 0; i < n; i++) if (raw[i] === 10) lineStarts.push(i + 1)
  return found
    .map((f) => {
      let lo = 0
      let hi = lineStarts.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (lineStarts[mid] <= f.off) lo = mid
        else hi = mid - 1
      }
      return { cls: f.cls, line: firstLine + lo, col: f.off - lineStarts[lo] + 1, len: f.len }
    })
    .toSorted((a, b) => a.line - b.line || a.col - b.col)
}

export function looksBinary(buf: Buffer): boolean {
  const end = Math.min(buf.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < end; i++) if (buf[i] === 0) return true
  return false
}

// ─── git 列舉 ──────────────────────────────────────────────────────────────

interface Source {
  path: string
  read: () => Buffer | null
}

function git(root: string, args: string[], asBuffer = false): Buffer | string {
  const out = execFileSync('git', args, {
    cwd: root,
    maxBuffer: 1024 * 1024 * 512,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return asBuffer ? out : out.toString('utf8')
}

function listStaged(root: string): Source[] {
  const raw = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMRT', '-z']) as string
  const gitlinks = new Set<string>()
  const stage = git(root, ['ls-files', '-z', '--stage']) as string
  for (const rec of stage.split('\0')) {
    const m = /^160000 [0-9a-f]+ \d\t(.*)$/s.exec(rec)
    if (m) gitlinks.add(m[1])
  }
  return raw
    .split('\0')
    .filter((p) => p && !gitlinks.has(p))
    .map((p) => ({ path: p, read: () => git(root, ['show', `:${p}`], true) as Buffer }))
}

function listTree(root: string): { sources: Source[]; missing: string[] } {
  const stage = git(root, ['ls-files', '-z', '--stage']) as string
  const sources: Source[] = []
  const missing: string[] = []
  for (const rec of stage.split('\0')) {
    if (!rec) continue
    const m = /^(\d{6}) [0-9a-f]+ \d\t(.*)$/s.exec(rec)
    if (!m) throw new Error(`git ls-files 輸出無法解析: ${rec.slice(0, 40)}`)
    const [, mode, p] = m
    if (mode === '160000') continue
    const abs = join(root, p)
    let st
    try {
      st = lstatSync(abs)
    } catch {
      missing.push(p)
      continue
    }
    sources.push({
      path: p,
      read: () => (st.isSymbolicLink() ? Buffer.from(readlinkSync(abs)) : readFileSync(abs)),
    })
  }
  return { sources, missing }
}

// ─── main ──────────────────────────────────────────────────────────────────

export interface AuditResult {
  status: 'pass' | 'finding' | 'infrastructure-error'
  mode: 'staged' | 'tree'
  root: string
  scanned: number
  skipped: { binary: number; missing: number; unreadable: number }
  completeness: 'complete' | 'partial' | 'unknown'
  violations: Array<{ path: string; line: number; col: number; cls: HitClass; len: number }>
  error?: string
}

/** 把 1-based col 起、長 len 的每段換成同長度的 `*`（保留其餘路徑，讓人仍找得到檔）。 */
export function maskSpans(text: string, hits: Array<{ col: number; len: number }>): string {
  if (hits.length === 0) return text
  const chars = text.split('') // col 是 UTF-16 offset，與 scanText 同單位
  for (const h of hits) {
    for (let i = h.col - 1; i < h.col - 1 + h.len && i < chars.length; i++) chars[i] = '*'
  }
  return chars.join('')
}

export function runAudit(opts: {
  root: string
  mode: 'staged' | 'tree'
  tokensPath: string
}): AuditResult {
  const base: AuditResult = {
    status: 'pass',
    mode: opts.mode,
    root: opts.root,
    scanned: 0,
    skipped: { binary: 0, missing: 0, unreadable: 0 },
    completeness: 'complete',
    violations: [],
  }
  const infra = (error: string): AuditResult => ({
    ...base,
    status: 'infrastructure-error',
    completeness: 'unknown',
    error,
  })

  if (!existsSync(opts.tokensPath)) {
    return infra(
      `找不到 hash 清單 ${opts.tokensPath}——它由 clade propagate 對 PUBLIC consumer 產生；沒有清單等於沒有 gate`,
    )
  }
  let tokens: LoadedTokens
  try {
    tokens = loadTokens(readFileSync(opts.tokensPath, 'utf8'))
  } catch (err) {
    return infra((err as Error).message)
  }

  let sources: Source[]
  try {
    if (opts.mode === 'staged') sources = listStaged(opts.root)
    else {
      const t = listTree(opts.root)
      sources = t.sources
      base.skipped.missing = t.missing.length
    }
  } catch (err) {
    return infra(`git 列舉失敗: ${(err as Error).message.split('\n')[0]}`)
  }

  for (const src of sources) {
    // 路徑本身。命中段落在**所有**輸出（含同檔內文命中）一律遮掉——路徑會進 public CI log，
    // 不遮就等於把客戶代號印出來。
    const pathHits = scanText(src.path, tokens, 0)
    const shownPath = maskSpans(src.path, pathHits)
    for (const h of pathHits) {
      base.violations.push({ path: shownPath, line: 0, col: h.col, cls: h.cls, len: h.len })
    }
    let buf: Buffer | null
    try {
      buf = src.read()
    } catch {
      base.skipped.unreadable++
      continue
    }
    if (!buf) {
      base.skipped.unreadable++
      continue
    }
    if (looksBinary(buf)) {
      base.skipped.binary++
      continue
    }
    base.scanned++
    for (const h of scanText(buf.toString('utf8'), tokens)) {
      base.violations.push({ path: shownPath, line: h.line, col: h.col, cls: h.cls, len: h.len })
    }
  }
  if (base.skipped.missing > 0 || base.skipped.unreadable > 0) base.completeness = 'partial'
  base.status = base.violations.length > 0 ? 'finding' : 'pass'
  return base
}

function formatText(r: AuditResult): string {
  const lines: string[] = []
  lines.push(`audit-public-tree-hygiene: ${r.status}`)
  lines.push(
    `scope: roots=${r.root}; patterns=consumer-code,personal,literal (salted hash table); mode=${r.mode === 'tree' ? 'tracked' : 'staged'}`,
  )
  lines.push(
    `skipped: binary=${r.skipped.binary}; missing-in-worktree=${r.skipped.missing}; unreadable=${r.skipped.unreadable}`,
  )
  lines.push(`completeness: ${r.completeness}  (scanned ${r.scanned} text files)`)
  if (r.error) lines.push(`error: ${r.error}`)
  const MAX = 200
  for (const v of r.violations.slice(0, MAX)) {
    lines.push(`${v.path}:${v.line}:${v.col}  [${CLASS_LABEL[v.cls]}] len=${v.len}`)
  }
  if (r.violations.length > MAX) lines.push(`... 另有 ${r.violations.length - MAX} 筆`)
  if (r.status === 'finding') {
    lines.push('')
    lines.push(
      '修法：自寫檔改用 placeholder 稱呼其他 consumer / 客戶（例 <consumer-x>、<client-x>）、個人路徑改 ~/ 或 <home>。',
    )
    lines.push('（命中文字刻意不印——public CI log 也是公開的；到 file:line:col 看。）')
  }
  return lines.join('\n')
}

function parseArgs(argv: string[]) {
  const a = { staged: false, tree: false, json: false, root: '', tokens: '' }
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (x === '--staged') a.staged = true
    else if (x === '--tree') a.tree = true
    else if (x === '--json') a.json = true
    else if (x === '--root') a.root = argv[++i] ?? ''
    else if (x === '--tokens') a.tokens = argv[++i] ?? ''
    else throw new Error(`未知參數 ${x}`)
  }
  if (a.staged === a.tree) throw new Error('必須二選一：--staged 或 --tree')
  return a
}

function main(): void {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`audit-public-tree-hygiene: ${(err as Error).message}\n`)
    process.exit(2)
  }
  let root = args.root ? resolve(args.root) : ''
  if (!root) {
    try {
      root = (git(process.cwd(), ['rev-parse', '--show-toplevel']) as string).trim()
    } catch {
      process.stderr.write('audit-public-tree-hygiene: 不在 git repo 內（infrastructure-error）\n')
      process.exit(2)
    }
  }
  const tokensPath = args.tokens ? resolve(args.tokens) : DEFAULT_TOKENS_PATH
  const result = runAudit({ root, mode: args.staged ? 'staged' : 'tree', tokensPath })
  process.stdout.write((args.json ? JSON.stringify(result, null, 2) : formatText(result)) + '\n')
  process.exit(result.status === 'pass' ? 0 : result.status === 'finding' ? 1 : 2)
}

function isMain(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return entry === fileURLToPath(import.meta.url)
  }
}

if (isMain()) main()
