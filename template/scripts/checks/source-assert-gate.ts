// 🔒 LOCKED — managed by clade · Source: vendor/scripts/checks/source-assert-gate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/checks/source-assert-gate.ts
// CLADE:VENDOR-SCRIPT
//
// source-assert-gate — P 類測試（讀原始碼比字串）的 delta 閘門
//
// 判定邏輯在 source-assert-detect.ts；本檔只做「對 base 比斷言數」，一份判定式兩個消費端共用：
//   - pre-commit：`scripts/pre-commit/checks/source-assert-delta.sh` → `--staged`（base＝HEAD）
//   - CI：`vendor/actions/source-assert-delta` → `--against <ref>`（base＝merge-base(HEAD, ref)）
//
// 擋法＝delta（不需要 baseline 檔、不需要逐家武裝）：
//   P 類斷言數比 base 增加          → block（exit 1）。新增檔＝base 0，所以新增 P 檔必擋；
//                                    建空檔再填也一樣擋，因為比的是數量，不是檔案狀態
//   改到但斷言數沒增加               → warn（exit 0）
//   斷言數減少                       → 放行（吸收存量）
//   沒碰                             → 靜默
//   凍結 legacy 檔走同一套（增加本就違反 legacy-tests.md NEVER 3）
// 混合型（同檔有 E 又有 P 讀取點）v1 只 warn 並列命中行。
// D 類（yml／sql／toml／json…）不在 R 範圍，NEVER 納入 block。
//
// 逃生口：檔首 10 行 `clade-source-assert: <code> — <reason>`，code 只收
// `no-behavior-channel`｜`declarative`，reason 非空；命中放行但印 notice。code 不在列舉或 reason
// 空 → block（不是靜默放行）。marker 數由 scripts/audit-source-assert-markers.ts 計數。
//
// `--report [--root <dir>]`：唯讀，列出整個 repo 現況（tracked 測試檔）的 P／混合型分布，
// 用來對帳或估存量，不做 gate 判定，永遠 exit 0。
//
// 由 ~/clade vendor/scripts/checks/ 散播，請勿直接編輯 consumer 副本。

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const detectPath = join(here, 'source-assert-detect.ts')
if (!existsSync(detectPath)) {
  throw new Error(`source-assert-gate: 找不到 ${detectPath}`)
}
const detect = (await import(
  pathToFileURL(detectPath).href
)) as typeof import('./source-assert-detect.ts')
const { classify, isTestPath, parseMarker, MARKER_CODES } = detect

export interface Change {
  path: string
  /** rename 時的舊路徑；其餘等於 path */
  basePath: string
  after: string
  /** base 版內容；新增檔為 null */
  before: string | null
}

export interface Finding {
  level: 'block' | 'warn' | 'notice'
  path: string
  detail: string
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

export function makeIsIgnored(root: string): (p: string) => boolean {
  const memo = new Map<string, boolean>()
  return (p) => {
    let hit = memo.get(p)
    if (hit === undefined) {
      try {
        execFileSync('git', ['check-ignore', '-q', '--', p], { cwd: root, stdio: 'ignore' })
        hit = true
      } catch {
        hit = false
      }
      memo.set(p, hit)
    }
    return hit
  }
}

export function evaluate(changes: Change[], isIgnored?: (p: string) => boolean): Finding[] {
  const out: Finding[] = []
  for (const c of changes) {
    if (!isTestPath(c.path)) continue
    const marker = parseMarker(c.after)
    if (marker.status === 'invalid') {
      out.push({ level: 'block', path: c.path, detail: marker.detail })
      continue
    }
    const after = classify(c.after, c.path, { isIgnored })
    const before = c.before === null ? null : classify(c.before, c.basePath, { isIgnored })
    // base 是 p 才有 P 類基準；混合型 base 只在仍是混合型時沿用。混合型拿掉被執行的讀取點變成 p，
    // 那些斷言現在全是讀原文比字串，從 0 算（否則「先混合再拿掉 E」就能把 P 類斷言帶進來）
    const beforeCount =
      before?.kind === 'p' || (before?.kind === 'mixed' && after.kind === 'mixed')
        ? before.assertions
        : 0
    const touched = c.before === null || c.before !== c.after

    if (after.kind === 'mixed') {
      // p → mixed 加斷言＝只靠補一個「讀了又執行」的讀取點就繞過 P 類 block，不放行
      if (before?.kind === 'p' && marker.status !== 'valid' && after.assertions > beforeCount) {
        out.push({
          level: 'block',
          path: c.path,
          detail: `P 類斷言 ${beforeCount} → ${after.assertions}：檔案由 P 類變成混合型但斷言仍增加（補一個被執行的讀取點不構成行為斷言）`,
        })
        continue
      }
      if (touched) {
        out.push({
          level: 'warn',
          path: c.path,
          detail: `混合型：同檔讀原始碼（${after.targets.join('、')}）又有執行路徑；字串斷言在第 ${after.assertionLines.join('、')} 行附近。v1 不擋，請確認新增的斷言走行為通道`,
        })
      }
      continue
    }
    // p → none：補一個 import／執行被讀的檔，讀取點就變 E；斷言增加而仍在讀原始碼＝同一種繞法
    if (
      after.kind === 'none' &&
      before?.kind === 'p' &&
      after.hasSourceRead &&
      marker.status !== 'valid' &&
      after.assertions > beforeCount
    ) {
      out.push({
        level: 'block',
        path: c.path,
        detail: `P 類斷言 ${beforeCount} → ${after.assertions}：被讀的檔改成同時 import／執行，但仍讀原文且斷言增加（讀原文比字串不因多一個 import 變成行為斷言）`,
      })
      continue
    }
    if (after.kind !== 'p') continue

    if (marker.status === 'valid') {
      if (touched) {
        out.push({
          level: 'notice',
          path: c.path,
          detail: `marker clade-source-assert: ${marker.code} — ${marker.reason}（0-A 要審理由是否成立）`,
        })
      }
      continue
    }
    if (after.assertions > beforeCount) {
      out.push({
        level: 'block',
        path: c.path,
        detail: `P 類斷言 ${beforeCount} → ${after.assertions}（讀 ${after.targets.join('、')} 比字串；第 ${after.assertionLines.join('、')} 行附近）`,
      })
    } else if (touched && after.assertions === beforeCount) {
      // 減少＝吸收存量，靜默放行；只有「改到但數量不變」才提醒
      out.push({
        level: 'warn',
        path: c.path,
        detail: `P 類斷言維持 ${beforeCount}，沒增加所以放行；這個檔仍是讀原始碼比字串，改到時順手改成行為斷言`,
      })
    }
  }
  return out
}

function zList(out: string | null): string[] {
  return (out ?? '').split('\0').filter(Boolean)
}

/** `git diff --name-status -M -z` 的輸出解析成 (basePath, path) 對 */
function parseNameStatus(raw: string | null): { basePath: string; path: string }[] {
  const parts = zList(raw)
  const out: { basePath: string; path: string }[] = []
  for (let i = 0; i < parts.length;) {
    const status = parts[i++]
    if (status.startsWith('R') || status.startsWith('C')) {
      const basePath = parts[i++]
      const path = parts[i++]
      out.push({ basePath: status.startsWith('R') ? basePath : path, path })
    } else {
      const path = parts[i++]
      out.push({ basePath: path, path })
    }
  }
  return out
}

export type Mode = { staged: true } | { against: string }

export function collect(root: string, mode: Mode): Change[] {
  let base = ''
  let pairs: { basePath: string; path: string }[]
  let readAfter: (p: string) => string | null
  if ('staged' in mode) {
    base = git(root, ['rev-parse', '-q', '--verify', 'HEAD'])?.trim() ?? ''
    pairs = parseNameStatus(
      git(root, ['diff', '--cached', '--name-status', '-M', '-z', '--diff-filter=ACMR']),
    )
    readAfter = (p) => git(root, ['show', `:${p}`])
  } else {
    base = git(root, ['merge-base', 'HEAD', mode.against])?.trim() ?? ''
    if (!base) throw new Error(`cannot resolve merge-base(HEAD, ${mode.against})`)
    pairs = parseNameStatus(
      git(root, ['diff', '--name-status', '-M', '-z', '--diff-filter=ACMR', base, 'HEAD']),
    )
    readAfter = (p) => git(root, ['show', `HEAD:${p}`])
  }
  const out: Change[] = []
  for (const { basePath, path } of pairs) {
    if (!isTestPath(path)) continue
    const after = readAfter(path)
    if (after === null) continue
    const before = base ? git(root, ['show', `${base}:${basePath}`]) : null
    out.push({ path, basePath, after, before })
  }
  return out
}

export function formatFindings(findings: Finding[]): string {
  const blocks = findings.filter((f) => f.level === 'block')
  const lines: string[] = []
  if (blocks.length > 0) {
    lines.push(`source-assert-gate: ${blocks.length} 筆新增「讀原始碼比字串」的測試斷言`)
    for (const f of blocks) lines.push(`  ✗ ${f.path} — ${f.detail}`)
    lines.push(
      '',
      '  這類測試釘的是原始碼長相，不是行為：重構就紅，行為壞了不紅（rules/core/testing-anti-patterns.md U 判準）。',
      '    改走行為通道：mount／render 元件、呼叫函式、跑 CLI，斷言輸出或 DOM。',
      '    確實沒有行為通道（純宣告式檔案、無法執行的靜態資產）：檔首 10 行加',
      `      // clade-source-assert: <${MARKER_CODES.join('｜')}> — <reason>`,
      '    marker 會印 notice，commit 0-A 審理由是否成立；NEVER 用 marker 繞過「其實能 mount」的元件。',
    )
  }
  for (const f of findings.filter((x) => x.level === 'warn'))
    lines.push(`  ⚠ ${f.path} — ${f.detail}`)
  for (const f of findings.filter((x) => x.level === 'notice'))
    lines.push(`  ℹ ${f.path} — ${f.detail}`)
  return lines.join('\n')
}

interface ReportRow {
  path: string
  kind: 'p' | 'mixed'
  assertions: number
  targets: string[]
  marker: string | null
}

export function report(root: string): ReportRow[] {
  const isIgnored = makeIsIgnored(root)
  const rows: ReportRow[] = []
  for (const path of zList(git(root, ['ls-files', '-z']))) {
    if (!isTestPath(path)) continue
    let src: string
    try {
      src = readFileSync(join(root, path), 'utf8')
    } catch {
      continue
    }
    const c = classify(src, path, { isIgnored })
    if (c.kind === 'none') continue
    const m = parseMarker(src)
    rows.push({
      path,
      kind: c.kind,
      assertions: c.assertions,
      targets: c.targets,
      marker: m.status === 'valid' ? m.code : m.status === 'invalid' ? `invalid:${m.detail}` : null,
    })
  }
  return rows
}

const USAGE = 'usage: source-assert-gate (--staged | --against <ref> | --report) [--root <dir>]'

function invokedAsCli(): boolean {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

export interface CliIo {
  stdout: (s: string) => void
  stderr: (s: string) => void
  cwd: string
}

/** 回傳 exit code，不碰 process.exit：測試 in-process 呼叫，CLI 入口（invokedAsCli）才轉成 exit。 */
export function main(args: string[], io: CliIo): number {
  const rootIdx = args.indexOf('--root')
  const root =
    rootIdx >= 0 ? args[rootIdx + 1] : (git(io.cwd, ['rev-parse', '--show-toplevel'])?.trim() ?? '')
  const againstIdx = args.indexOf('--against')
  if (!root) {
    io.stderr(`${USAGE}\n`)
    return 2
  }
  if (args.includes('--report')) {
    for (const r of report(root)) {
      io.stdout(
        `${r.kind}\t${r.assertions}\t${r.path}\t${r.targets.join(',')}\t${r.marker ?? ''}\n`,
      )
    }
    return 0
  }
  const mode: Mode | null = args.includes('--staged')
    ? { staged: true }
    : againstIdx >= 0 && args[againstIdx + 1]
      ? { against: args[againstIdx + 1] }
      : null
  if (!mode) {
    io.stderr(`${USAGE}\n`)
    return 2
  }
  const findings = evaluate(collect(root, mode), makeIsIgnored(root))
  const text = formatFindings(findings)
  if (text) io.stderr(`${text}\n`)
  return findings.some((f) => f.level === 'block') ? 1 : 0
}

if (invokedAsCli()) {
  process.exit(
    main(process.argv.slice(2), {
      stdout: (s) => process.stdout.write(s),
      stderr: (s) => process.stderr.write(s),
      cwd: process.cwd(),
    }),
  )
}
