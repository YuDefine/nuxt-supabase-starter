#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/legacy-tests.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/legacy-tests.ts
/**
 * legacy-tests —— aixbdd consumer 的舊測試凍結與盤點。
 *
 * 舊測試 = 檔首帶 `clade-legacy-test: frozen=<YYYY-MM-DD>` marker 的測試檔：凍結日之前就存在、
 * 沒有對應 truth、等待被吸收。身分標在檔案自身，不另建清單——agent 讀到檔案就讀到處置方式。
 *
 * repo 根的 `.legacy-tests.json` 只記凍結日（`{"frozen_at":"YYYY-MM-DD"}`），由 `mark` 寫入。
 * 它讓「最後一支舊測試被吸收」之後 repo 仍是 frozen；它第一次進 commit 就是封存點——
 * 之後 `mark` 一律拒絕，封存點之後動過 marker 行、目前仍帶 marker 的檔列為違規（只減不增）。
 *
 * Usage:
 *   node scripts/legacy-tests.ts status [--json]
 *   node scripts/legacy-tests.ts mark --frozen <YYYY-MM-DD> (--all | <path>...) [--dry-run] [--json]
 *   node scripts/legacy-tests.ts unmark <path>... [--json]
 *
 * Exit: 0 ok · 1 mark 有被拒絕的檔 · 2 用法錯誤／不在 git repo
 *
 * 規約：runtime skill 目錄下的 clade-spec-workflow/rules/legacy-tests.md（clade 源檔 rules/modules/capabilities/aixbdd/legacy-tests.md）
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MARKER_KEY = 'clade-legacy-test'
export const RULE_POINTER = 'clade-spec-workflow/rules/legacy-tests.md'
/** marker 只在檔首這幾行內找：shebang 與 test runner pragma 可能排在它前面。 */
export const MARKER_WINDOW = 10
export const RECORD_FILE = '.legacy-tests.json'

const MARKER_RE = /clade-legacy-test:\s*frozen=(\S+)/
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/
// runtime 投影目錄（.claude／.agents／.cursor／.codex）裡有上游 skill 的範例 feature 與測試，不是這個 repo 的。
const EXCLUDED_SEGMENT_RE =
  /(^|\/)(vendor|node_modules|\.claude|\.agents|\.cursor|\.codex|\.clade)\//
// BDD 層：feature 檔本身不會命中 TEST_FILE_RE；這裡排除的是 features/ 底下的 step 與 support。
const BDD_LAYER_RE = /(^|\/)features\/(step[-_]?definitions|steps|support)\//
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface StatusReport {
  state: 'not-frozen' | 'frozen'
  frozen_at: string | null
  legacy: number
  unmarked: number
  post_freeze_unmarked: string[]
  late_marked: string[]
  malformed: string[]
  unverifiable: string[]
  features: number
  shallow: boolean
  /** 工作樹有 `.legacy-tests.json`。 */
  recorded: boolean
  /** `.legacy-tests.json` 已進 commit：mark 關閉，封存後重新帶上 marker 的檔列入 late_marked。 */
  sealed: boolean
}

export interface MarkReport {
  frozen: string
  dry_run: boolean
  marked: string[]
  already_marked: string[]
  refused: string[]
  skipped_post_freeze: string[]
  unverifiable: string[]
  /** 這次寫入了 `.legacy-tests.json`（dry-run 與已有 record 時為 false）。 */
  record_written: boolean
}

export interface UnmarkReport {
  removed: string[]
  not_marked: string[]
}

export class UsageError extends Error {}
/** record 曾 commit 後被刪、或封存後改了內容：凍結被拆掉。audit 把它當違規（WARN），不是判不出來。 */
export class RecordRemovedError extends UsageError {}

function git(root: string, args: string[]): string {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  if (r.status !== 0) throw new UsageError(`git ${args.join(' ')} 失敗：${r.stderr.trim()}`)
  return r.stdout
}

export function repoRoot(cwd: string): string {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new UsageError(`不在 git repo 裡：${cwd}`)
  return r.stdout.trim()
}

export function isTestFile(path: string): boolean {
  return TEST_FILE_RE.test(path) && !EXCLUDED_SEGMENT_RE.test(path) && !BDD_LAYER_RE.test(path)
}

function isFeatureFile(path: string): boolean {
  return path.endsWith('.feature') && !EXCLUDED_SEGMENT_RE.test(path)
}

/** tracked ＋ untracked（尊重 .gitignore），不含已刪除但未 commit 的檔。 */
function listFiles(root: string): { tracked: string[]; untracked: Set<string> } {
  const split = (out: string) => out.split('\0').filter(Boolean)
  const tracked = split(git(root, ['ls-files', '-z'])).filter((p) => existsSync(resolve(root, p)))
  const untracked = split(git(root, ['ls-files', '-z', '--others', '--exclude-standard']))
  return { tracked, untracked: new Set(untracked) }
}

/** 本地日期：marker 是人在當地日曆上寫的；用 UTC 的話台灣清晨寫下的今天會被判成未來日期。 */
export function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function validDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

export type MarkerRead = { kind: 'none' } | { kind: 'ok'; date: string } | { kind: 'malformed' }

export function readMarker(text: string, now = today()): MarkerRead {
  const head = text.split('\n', MARKER_WINDOW)
  for (const line of head) {
    if (!line.includes(MARKER_KEY)) continue
    const m = MARKER_RE.exec(line)
    if (!m || !validDate(m[1]!) || m[1]! > now) return { kind: 'malformed' }
    return { kind: 'ok', date: m[1]! }
  }
  return { kind: 'none' }
}

/** `bound: true` = 日期只是上限：檔案在 shallow clone 的邊界 commit 就已存在，真正的建立日不晚於它。 */
export interface Created {
  date: string
  bound: boolean
}

/**
 * 每支檔第一次加入 git 的日期（author date），跨越搬移與改名。
 *
 * 一次 `git log` 由舊到新走完：A 記日期、R 把日期帶到新路徑、D 清掉。刪掉再加回來的檔
 * 是新檔，日期跟著重記。shallow clone 的邊界 commit 會把當時整棵樹報成 A——那些日期是上限
 * （檔案至少那天已存在），足以證明「凍結日之前就存在」，但證明不了「凍結日之後才建立」。
 */
function hasHead(root: string): boolean {
  return spawnSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: root }).status === 0
}

export function creationDates(root: string): { dates: Map<string, Created>; shallow: boolean } {
  const shallow = git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true'
  const dates = new Map<string, Created>()
  if (!hasHead(root)) return { dates, shallow }
  const boundaries = new Set<string>()
  if (shallow) {
    const file = git(root, ['rev-parse', '--git-path', 'shallow']).trim()
    const abs = isAbsolute(file) ? file : resolve(root, file)
    if (existsSync(abs))
      for (const sha of readFileSync(abs, 'utf8').split('\n')) if (sha) boundaries.add(sha)
  }
  const out = git(root, [
    'log',
    '--reverse',
    '--format=%x01%H %as',
    '--name-status',
    '-M',
    '--diff-filter=ADR',
    'HEAD',
  ])
  let date = ''
  let bound = false
  for (const line of out.split('\n')) {
    if (!line) continue
    if (line.startsWith('\x01')) {
      const [sha, d] = line.slice(1).split(' ')
      date = d ?? ''
      bound = boundaries.has(sha ?? '')
      continue
    }
    const [status, a, b] = line.split('\t')
    if (!status || !a) continue
    if (status === 'A') dates.set(a, { date, bound })
    else if (status === 'D') dates.delete(a)
    else if (status.startsWith('R') && b) {
      dates.set(b, dates.get(a) ?? { date, bound })
      dates.delete(a)
    }
  }
  return { dates, shallow }
}

/** record 文字裡的 frozen_at：parse 成 unknown 再驗形狀，壞 JSON 或缺欄位回 undefined。 */
function recordFrozenAt(text: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  return parsed !== null && typeof parsed === 'object' && 'frozen_at' in parsed
    ? parsed.frozen_at
    : undefined
}

/** 讀凍結 record；沒有回 null，格式錯誤是用法錯誤（要人修，NEVER 靜默當成未凍結）。 */
export function readRecord(root: string, now = today()): string | null {
  const abs = resolve(root, RECORD_FILE)
  if (!existsSync(abs)) return null
  const frozen = recordFrozenAt(readFileSync(abs, 'utf8'))
  if (typeof frozen !== 'string' || !validDate(frozen) || frozen > now)
    throw new UsageError(`${RECORD_FILE} 要是 {"frozen_at":"YYYY-MM-DD"} 且不晚於今天`)
  return frozen
}

export function recordText(frozen: string): string {
  return `${JSON.stringify({ frozen_at: frozen })}\n`
}

/**
 * 封存點：`.legacy-tests.json` 第一次進 commit 的那個 commit。record 曾 commit、之後被刪 =
 * 有人把凍結拆掉，用法錯誤（刪 record 會讓 mark 重新開放）。
 */
export function sealCommit(root: string): string | null {
  if (!hasHead(root)) return null
  const adds = git(root, ['log', '--format=%H', '--diff-filter=A', 'HEAD', '--', RECORD_FILE])
    .split('\n')
    .filter(Boolean)
  if (!adds.length) return null
  const seal = adds.at(-1)!
  const abs = resolve(root, RECORD_FILE)
  if (!existsSync(abs))
    throw new RecordRemovedError(`${RECORD_FILE} 已 commit 過卻不在工作樹：凍結 record 不能刪`)
  // 封存後改 frozen_at（例如往後挪）會讓凍結後新建的測試悄悄掉出待確認清單：與封存 commit 的內容比對。
  if (
    recordFrozenAt(readFileSync(abs, 'utf8')) !==
    recordFrozenAt(git(root, ['show', `${seal}:${RECORD_FILE}`]))
  )
    throw new RecordRemovedError(
      `${RECORD_FILE} 的 frozen_at 與封存 commit ${seal.slice(0, 12)} 不同：凍結日不能改`,
    )
  return seal
}

/**
 * 封存點之後（不含封存 commit 本身）動過 marker 行的檔：已 commit 的走 `<seal>..HEAD`，
 * 還沒 commit 的走 `git diff HEAD`。一次 git log，不逐檔呼叫。
 */
function markerTouchedSince(root: string, seal: string): Set<string> {
  const touched = new Set<string>()
  const pick = (out: string) => {
    for (const line of out.split('\n')) if (line) touched.add(line)
  }
  pick(git(root, ['log', '-M', `-G${MARKER_KEY}:`, '--format=', '--name-only', `${seal}..HEAD`]))
  pick(git(root, ['diff', '-M', `-G${MARKER_KEY}:`, '--name-only', 'HEAD']))
  return touched
}

type Ctx = { dates: Map<string, Created>; untracked: Set<string> }

/** 建立日：還沒進歷史的檔（untracked、只 stage 未 commit）是「現在」建立的。 */
const NOT_YET: Created = { date: '9999-12-31', bound: false }

function createdOn(path: string, ctx: Ctx): Created {
  // 還沒進歷史 = 證明不了它在任何凍結日之前存在：當成晚於一切日期，連「今天凍結、今天新建」也擋。
  if (ctx.untracked.has(path)) return NOT_YET
  return ctx.dates.get(path) ?? NOT_YET
}

/** 三態：建立日晚於 `day` 為 after、不晚於為 onOrBefore；上限日晚於 `day` 時判不出來。 */
export function comparedTo(created: Created, day: string): 'after' | 'onOrBefore' | 'unknown' {
  if (created.date <= day) return 'onOrBefore'
  return created.bound ? 'unknown' : 'after'
}

/** 一次盤點要的 git 事實：status 與 mark 共用，同一個指令只算一次。 */
interface Scan extends Ctx {
  tracked: string[]
  shallow: boolean
  record: string | null
  seal: string | null
}

function scan(root: string, now: string): Scan {
  const { tracked, untracked } = listFiles(root)
  const { dates, shallow } = creationDates(root)
  return {
    tracked,
    untracked,
    dates,
    shallow,
    record: readRecord(root, now),
    seal: sealCommit(root),
  }
}

export function collectStatus(root: string, now = today()): StatusReport {
  return statusFrom(root, now, scan(root, now))
}

function statusFrom(root: string, now: string, ctx: Scan): StatusReport {
  const { tracked, untracked, shallow, record, seal } = ctx
  const all = [...tracked, ...untracked]
  const tests = all.filter(isTestFile).toSorted()

  const marked: { path: string; date: string }[] = []
  const unmarkedPaths: string[] = []
  const malformed: string[] = []
  for (const path of tests) {
    const marker = readMarker(readFileSync(resolve(root, path), 'utf8'), now)
    if (marker.kind === 'ok') marked.push({ path, date: marker.date })
    else if (marker.kind === 'malformed') malformed.push(path)
    else unmarkedPaths.push(path)
  }

  // repo 只有一個凍結日：有 record 就是 record 記的那天；沒有 record 時取本身不違規（建立日不晚於
  // 自己 marker 日期）的 marker 裡最早的那個。違規的 marker NEVER 當錨點——偽造一個很早的日期就能
  // 把整個 repo 的凍結日拉回去。每支帶 marker 的檔都拿 repo 凍結日判定，不拿自己的日期：
  // 替新檔寫一個「今天」的 marker 照樣是違規。
  const judged = marked.map((m) => ({ ...m, created: createdOn(m.path, ctx) }))
  const anchors = judged.filter((j) => comparedTo(j.created, j.date) !== 'after').map((j) => j.date)
  const frozenAt = record ?? (anchors.length ? anchors.toSorted()[0]! : null)
  // 封存後：凍結前就存在的檔被 unmark 再標回去，建立日判不出來——改看封存後有沒有動過 marker 行。
  const touched = seal ? markerTouchedSince(root, seal) : new Set<string>()
  const lateMarked: string[] = []
  const unverifiable: string[] = []
  let legacy = 0
  for (const m of judged) {
    const verdict = comparedTo(m.created, frozenAt ?? m.date)
    if (verdict === 'after' || touched.has(m.path)) lateMarked.push(m.path)
    else {
      if (verdict === 'unknown') unverifiable.push(m.path)
      legacy++
    }
  }

  const postFreeze: string[] = []
  if (frozenAt) {
    for (const path of unmarkedPaths) {
      const verdict = comparedTo(createdOn(path, ctx), frozenAt)
      if (verdict === 'unknown') unverifiable.push(path)
      else if (verdict === 'after') postFreeze.push(path)
    }
  }

  return {
    state: frozenAt ? 'frozen' : 'not-frozen',
    frozen_at: frozenAt,
    legacy,
    unmarked: unmarkedPaths.length,
    post_freeze_unmarked: postFreeze,
    late_marked: lateMarked,
    malformed,
    unverifiable: unverifiable.toSorted(),
    features: all.filter(isFeatureFile).length,
    shallow,
    recorded: record !== null,
    sealed: seal !== null,
  }
}

export function markerLine(frozen: string): string {
  return `// ${MARKER_KEY}: frozen=${frozen} — 舊測試：沒有對應 truth，不是 BDD 的慣例來源；工作碰到就吸收（${RULE_POINTER}）`
}

/** 插在 shebang 與 `// @vitest-environment`、`/// <reference>` 這類 pragma 之後，讓 runner 照樣讀得到它們。 */
export function insertMarker(text: string, frozen: string): string {
  const lines = text.split('\n')
  let at = 0
  while (
    at < lines.length &&
    at < MARKER_WINDOW - 1 &&
    (lines[at]!.startsWith('#!') || /^\s*\/\/\/?\s*[@<]/.test(lines[at]!))
  ) {
    at++
  }
  lines.splice(at, 0, markerLine(frozen))
  return lines.join('\n')
}

export function removeMarker(text: string): string {
  const lines = text.split('\n')
  const idx = lines.slice(0, MARKER_WINDOW).findIndex((l) => l.includes(MARKER_KEY))
  if (idx >= 0) lines.splice(idx, 1)
  return lines.join('\n')
}

function toRepoPath(root: string, cwd: string, input: string): string {
  const abs = isAbsolute(input) ? input : resolve(cwd, input)
  return relative(root, abs).split('\\').join('/')
}

export function mark(
  root: string,
  opts: {
    frozen: string
    all: boolean
    paths: string[]
    dryRun: boolean
    cwd?: string
    now?: string
  },
): MarkReport {
  const now = opts.now ?? today()
  if (!validDate(opts.frozen))
    throw new UsageError(`--frozen 要是 YYYY-MM-DD：收到「${opts.frozen}」`)
  if (opts.frozen > now) throw new UsageError(`--frozen ${opts.frozen} 晚於今天 ${now}`)
  if (opts.all === opts.paths.length > 0)
    throw new UsageError('mark 要二擇一：--all 或列出檔案路徑')

  const ctx = scan(root, now)
  if (ctx.seal)
    throw new UsageError(
      `這個 repo 的凍結已封存（${RECORD_FILE} 已 commit）；mark 不再接受任何檔（舊測試只減不增）`,
    )
  const existing = statusFrom(root, now, ctx).frozen_at
  if (existing && existing !== opts.frozen) {
    throw new UsageError(`這個 repo 已於 ${existing} 凍結；--frozen 只接受同一天（舊測試只減不增）`)
  }
  const { tracked, untracked } = ctx
  const report: MarkReport = {
    frozen: opts.frozen,
    dry_run: opts.dryRun,
    marked: [],
    already_marked: [],
    refused: [],
    skipped_post_freeze: [],
    unverifiable: [],
    record_written: false,
  }

  const candidates = opts.all
    ? [...tracked, ...untracked].filter(isTestFile).toSorted()
    : opts.paths.map((p) => toRepoPath(root, opts.cwd ?? root, p))

  for (const path of candidates) {
    const abs = resolve(root, path)
    if (!existsSync(abs) || !isTestFile(path)) {
      // 指名的檔不存在或不是測試檔：一律拒絕，NEVER 替非測試檔貼 marker。
      report.refused.push(path)
      continue
    }
    const text = readFileSync(abs, 'utf8')
    const current = readMarker(text, now).kind
    if (current === 'malformed') {
      // 壞掉的 marker 要人修，NEVER 當成已凍結回報。
      report.refused.push(path)
      continue
    }
    if (current === 'ok') {
      report.already_marked.push(path)
      continue
    }
    const verdict = comparedTo(createdOn(path, ctx), opts.frozen)
    if (verdict === 'unknown') {
      // 證明不了它在凍結日之前存在：fail closed。
      if (opts.all) report.unverifiable.push(path)
      else report.refused.push(path)
      continue
    }
    if (verdict === 'after') {
      if (opts.all) report.skipped_post_freeze.push(path)
      else report.refused.push(path)
      continue
    }
    if (!opts.dryRun) writeFileSync(abs, insertMarker(text, opts.frozen))
    report.marked.push(path)
  }
  // 一個都沒標到也寫：分類完沒有留下舊測試的 repo，record 是它已凍結的唯一證據。
  if (!opts.dryRun && ctx.record === null) {
    writeFileSync(resolve(root, RECORD_FILE), recordText(opts.frozen))
    report.record_written = true
  }
  return report
}

export function unmark(root: string, paths: string[], cwd = root): UnmarkReport {
  if (paths.length === 0) throw new UsageError('unmark 要列出檔案路徑')
  const report: UnmarkReport = { removed: [], not_marked: [] }
  for (const input of paths) {
    const path = toRepoPath(root, cwd, input)
    const abs = resolve(root, path)
    if (!existsSync(abs)) throw new UsageError(`檔案不存在：${path}`)
    const text = readFileSync(abs, 'utf8')
    const next = removeMarker(text)
    if (next === text) report.not_marked.push(path)
    else {
      writeFileSync(abs, next)
      report.removed.push(path)
    }
  }
  return report
}

function printStatus(r: StatusReport): void {
  const lines = [
    `state: ${r.state}${r.frozen_at ? `（凍結日 ${r.frozen_at}${r.sealed ? '，已封存' : ''}）` : ''}`,
    `舊測試: ${r.legacy}　未標記測試: ${r.unmarked}　.feature: ${r.features}`,
  ]
  const list = (title: string, items: string[]) => {
    if (items.length) lines.push(`${title}（${items.length}）:`, ...items.map((p) => `  - ${p}`))
  }
  list(
    '凍結後新增、未標記——確認每一支都是純邏輯不變量，否則改寫成 scenario',
    r.post_freeze_unmarked,
  )
  list('違規：凍結日之後建立、或封存後才帶上 marker——移除 marker', r.late_marked)
  list('marker 格式錯誤或日期晚於今天', r.malformed)
  list(`建立日判不出來${r.shallow ? '（shallow clone）' : ''}`, r.unverifiable)
  lines.push(`規約：${RULE_POINTER}`)
  console.log(lines.join('\n'))
}

export function main(argv: string[], cwd = process.cwd()): number {
  const [command, ...rest] = argv
  const flags = new Set(rest.filter((a) => a.startsWith('--')))
  const json = flags.has('--json')
  const positional: string[] = []
  let frozen = ''
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (a === '--frozen') frozen = rest[++i] ?? ''
    else if (a.startsWith('--frozen=')) frozen = a.slice('--frozen='.length)
    else if (!a.startsWith('--')) positional.push(a)
  }
  try {
    const root = repoRoot(cwd)
    if (command === 'status') {
      const r = collectStatus(root)
      if (json) console.log(JSON.stringify(r, null, 2))
      else printStatus(r)
      return 0
    }
    if (command === 'mark') {
      const r = mark(root, {
        frozen,
        all: flags.has('--all'),
        paths: positional,
        dryRun: flags.has('--dry-run'),
        cwd,
      })
      if (json) console.log(JSON.stringify(r, null, 2))
      else {
        console.log(
          `${r.dry_run ? '（dry-run）' : ''}標記 ${r.marked.length} 支，已有 marker ${r.already_marked.length} 支`,
        )
        if (r.record_written)
          console.log(`寫入 ${RECORD_FILE}（凍結日 ${r.frozen}）：和 marker 同一個 commit 提交`)
        if (r.skipped_post_freeze.length)
          console.log(`凍結日之後建立、未標記：${r.skipped_post_freeze.length} 支`)
        if (r.unverifiable.length)
          console.log(`建立日判不出來、未標記：${r.unverifiable.join(', ')}`)
        if (r.refused.length)
          console.log(
            `拒絕：${r.refused.join(', ')}（不存在、不是測試檔，或建立日晚於 ${r.frozen}／判不出來）`,
          )
      }
      return r.refused.length ? 1 : 0
    }
    if (command === 'unmark') {
      const r = unmark(root, positional, cwd)
      if (json) console.log(JSON.stringify(r, null, 2))
      else
        console.log(
          `移除 marker ${r.removed.length} 支${r.not_marked.length ? `；本來就沒有 marker：${r.not_marked.join(', ')}` : ''}`,
        )
      return 0
    }
    throw new UsageError('用法：legacy-tests.ts status|mark|unmark（見檔頭說明）')
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`✗ legacy-tests: ${error.message}\n`)
      return 2
    }
    throw error
  }
}

// CLI 進入判定：兩邊都 realpath（經 symlink 叫進來時 argv[1] 與 import.meta.url 不相等，TD-460）。
function invokedAsCli(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return entry === fileURLToPath(import.meta.url)
  }
}

if (invokedAsCli()) process.exit(main(process.argv.slice(2)))
