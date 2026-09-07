#!/usr/bin/env node
/* eslint-disable no-console */
/* oxlint-disable no-console */

/**
 * 0-A gate metrics recorder
 *
 * 用途：讓 0-A 的閾值調參有實測分佈可依，而不是拍腦袋。回答的問題是
 * 「diff 規模 vs finding 數長什麼樣」「0-A.2 觸發率多少」「dismiss 有多少是
 * 沒附反證被翻回 real issue 的」「TD-246 fallback 多常發生」。
 *
 * 用法：
 *   node .claude/scripts/0a-metrics.mjs record --review-mode independent \
 *     --reviewer '<actual runtime/model>' --repo /absolute/repo \
 *     --diff-lines 120 --diff-files 3 --critical 0 --major 0 --minor 2 --info 0 \
 *     --a2 false --dismissed 1 --dismissed-unsubstantiated 0 \
 *     --screenshot skip --doc skip
 *
 *   node .claude/scripts/0a-metrics.mjs record --review-mode escalated \
 *     --reviewer '<actual runtime/model>' --adjudicator '<actual runtime/model>' ...
 *
 * Legacy rows remain readable and the historical --codex interface remains supported:
 *   node .claude/scripts/0a-metrics.mjs record --diff-lines 120 --diff-files 3 \
 *     --codex xhigh --critical 0 --major 1 --minor 2 --info 0 \
 *     --a2 true --dismissed 1 --dismissed-unsubstantiated 0 \
 *     --screenshot skip --doc skip [--anomaly td246-fallback]
 *
 *   node .claude/scripts/0a-metrics.mjs summary [--repo /absolute/repo] [--last 20]
 *
 * `record` 會印出 0-A/B/C/D 的匯合行——這是刻意的結構耦合：匯合行只能由本
 * script 產出，漏跑就沒有那行輸出，比「規約寫 MUST 呼叫」更難靜默漏掉。
 *
 * 落點 `.clade/0a-metrics.jsonl`（gitignored，本地 telemetry）。**不**寫進
 * `vendor/signals/` 的 ledger：那條路是 failure-event → threshold → digest
 * candidate 的機制，schema 為 closed（14 個 required 欄位全是錯誤導向），把常態
 * 成功事件灌進去會重演 improvement-digest.ts 註解記載的 occurrences 灌水。
 * 異常事件（anomaly 欄位非 null）留在同一份檔——需要的是「率」，算得出來就夠，
 * 產 digest 候選對這類異常沒有增值，處置早已寫在 gates.md 的 fallback 路徑。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const ANOMALY_KINDS = ['td246-fallback', 'verdict-missing', 'large-change-rerun']
const CODEX_MODES = [
  'astra-low',
  'astra-medium',
  'astra-medium+fable',
  'xhigh',
  'xhigh+max+fable',
  'fast-path-skip',
]
const REVIEW_MODES = ['independent', 'escalated', 'fast-path-skip']

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      die(`--${key} 必須提供值`)
    }
    const value = next
    if (out[key] !== undefined && out[key] !== value) {
      die(
        `--${key} 不可同時使用互相矛盾的值（${JSON.stringify(out[key])} / ${JSON.stringify(value)}）`,
      )
    }
    out[key] = value
    if (next !== undefined && !next.startsWith('--')) i++
  }
  return out
}

function projectDir(args, legacy = false) {
  if (args.repo !== undefined) {
    if (!isAbsolute(args.repo)) die('--repo 必須是絕對路徑')
    try {
      if (!statSync(args.repo).isDirectory())
        die(`--repo 必須是目錄，收到 ${JSON.stringify(args.repo)}`)
    } catch {
      die(`--repo 目錄不存在，收到 ${JSON.stringify(args.repo)}`)
    }
    return resolve(args.repo)
  }
  // CLAUDE_PROJECT_DIR is retained only for the historical --codex path. Canonical
  // review-mode records must be rooted at the invocation cwd unless --repo is given.
  return legacy ? process.env.CLAUDE_PROJECT_DIR || process.cwd() : process.cwd()
}

function git(args, cwd, fallback) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim() || fallback
  } catch {
    return fallback
  }
}

// worktree 內 `--show-toplevel` 回的是 worktree 目錄名（如 clade-wt/<slug>），不是 repo
// 名——0-A 常在 worktree 跑，用它會讓同一個 repo 的紀錄散成好幾個名字。remote URL 不受
// worktree 影響，是這裡唯一穩定的來源。
function repoName(cwd) {
  const url = git(['config', '--get', 'remote.origin.url'], cwd, '')
  const m = url.match(/([^/:]+?)(?:\.git)?$/)
  if (m) return m[1]
  return git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd, cwd)
    .replace(/\/\.git\/?$/, '')
    .split('/')
    .pop()
}

function num(v, field) {
  if (v === undefined) die(`record 缺 --${field}`)
  if (!/^\d+$/.test(String(v))) die(`--${field} 必須是完整的非負整數，收到 ${JSON.stringify(v)}`)
  const n = Number(v)
  if (!Number.isSafeInteger(n))
    die(`--${field} 必須是安全範圍內的非負整數，收到 ${JSON.stringify(v)}`)
  return n
}

function bool(v, field, fallback = false) {
  if (v === undefined) return fallback
  if (v !== 'true' && v !== 'false')
    die(`--${field} 必須是 true 或 false，收到 ${JSON.stringify(v)}`)
  return v === 'true'
}

function choice(v, field, values, fallback) {
  const value = v ?? fallback
  if (!values.includes(value)) {
    die(`--${field} 只接受 ${values.join(' | ')}，收到 ${JSON.stringify(value)}`)
  }
  return value
}

function identity(args, field) {
  if (args[field] === undefined) return null
  const value = String(args[field]).trim()
  if (!value) die(`--${field} 不可為空白`)
  return value
}

function modeConfig(args) {
  const hasCanonical = args['review-mode'] !== undefined
  const hasLegacy = args.codex !== undefined
  if (hasCanonical && hasLegacy) die('--review-mode 與 legacy --codex 不可同時使用')

  if (hasCanonical) {
    const reviewMode = args['review-mode']
    if (!REVIEW_MODES.includes(reviewMode)) {
      die(`--review-mode 只接受 ${REVIEW_MODES.join(' | ')}，收到 ${JSON.stringify(reviewMode)}`)
    }
    const reviewer = identity(args, 'reviewer')
    const adjudicator = identity(args, 'adjudicator')
    if ((reviewMode === 'independent' || reviewMode === 'escalated') && !reviewer) {
      die(`--review-mode ${reviewMode} 必須提供非空 --reviewer`)
    }
    if (reviewMode === 'escalated' && !adjudicator) {
      die('--review-mode escalated 必須提供非空 --adjudicator')
    }
    return { canonical: true, reviewMode, reviewer, adjudicator, codex: null }
  }

  const codex = args.codex ?? die('record 缺 --codex 或 --review-mode')
  if (!CODEX_MODES.includes(codex)) {
    die(`--codex 只接受 ${CODEX_MODES.join(' | ')}，收到 ${JSON.stringify(codex)}`)
  }
  return {
    canonical: false,
    reviewMode: null,
    reviewer: null,
    adjudicator: null,
    codex,
  }
}

function die(msg) {
  console.error(`[0a-metrics] ${msg}`)
  process.exit(2)
}

function record(args) {
  const mode = modeConfig(args)
  const cwd = projectDir(args, !mode.canonical)
  const ledger = resolve(cwd, '.clade', '0a-metrics.jsonl')
  if (args.anomaly && !ANOMALY_KINDS.includes(args.anomaly)) {
    die(`--anomaly 只接受 ${ANOMALY_KINDS.join(' | ')}，收到 ${JSON.stringify(args.anomaly)}`)
  }

  const findings = {
    critical: num(args.critical, 'critical'),
    major: num(args.major, 'major'),
    minor: num(args.minor, 'minor'),
    info: num(args.info, 'info'),
  }
  const a2 = bool(args.a2, 'a2')
  const dismissed = num(args.dismissed ?? '0', 'dismissed')
  const unsubstantiated = num(args['dismissed-unsubstantiated'] ?? '0', 'dismissed-unsubstantiated')
  if (unsubstantiated > dismissed) {
    die(`--dismissed-unsubstantiated (${unsubstantiated}) 不能大於 --dismissed (${dismissed})`)
  }

  // 0-A.2 只在 Critical/Major 出現時觸發（gates.md § 0-A.1）。宣告不一致代表
  // 呼叫端把流程走錯了或參數填錯，兩者都該當場停，不該靜默記一筆假資料。
  const hadCriticalOrMajor = findings.critical > 0 || findings.major > 0
  if (mode.canonical) {
    if (a2 && !hadCriticalOrMajor) {
      die('--a2 true 但 critical/major 皆為 0——0-A.2 的觸發條件不成立，檢查參數')
    }
    if (a2 && mode.reviewMode !== 'escalated') {
      die('--a2 true 只能記錄 review-mode escalated')
    }
    if (
      mode.reviewMode === 'fast-path-skip' &&
      (hadCriticalOrMajor || a2 || Object.values(findings).some((n) => n > 0))
    ) {
      die('fast-path-skip 不可搭配任何 finding 或 --a2 true')
    }
    if (mode.reviewMode === 'escalated' && !a2) {
      die('review-mode escalated 必須搭配 --a2 true')
    }
    if (mode.reviewMode === 'independent' && hadCriticalOrMajor && !a2) {
      die('Critical/Major 非 0 時須改用 review-mode escalated，並提供 --adjudicator 與 --a2 true')
    }
  } else {
    if (
      a2 &&
      !hadCriticalOrMajor &&
      !['xhigh+max+fable', 'astra-medium+fable'].includes(mode.codex)
    ) {
      die('--a2 true 但 critical/major 皆為 0——0-A.2 的觸發條件不成立，檢查參數')
    }
    if (hadCriticalOrMajor && !a2 && mode.codex !== 'fast-path-skip') {
      die('critical/major 非 0 卻 --a2 false——gates.md § 0-A.1 規定此時 MUST 進 0-A.2')
    }
  }

  const screenshot = mode.canonical
    ? choice(args.screenshot, 'screenshot', ['pass', 'skip'], 'skip')
    : (args.screenshot ?? 'skip')
  const doc = mode.canonical
    ? choice(args.doc, 'doc', ['aligned', 'skip'], 'skip')
    : (args.doc ?? 'skip')

  const row = {
    ts: new Date().toISOString(),
    repo: repoName(cwd),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, 'unknown'),
    base_sha: git(['rev-parse', '--short', 'HEAD'], cwd, 'unknown'),
    diff_lines: num(args['diff-lines'], 'diff-lines'),
    diff_files: num(args['diff-files'], 'diff-files'),
    fast_path: mode.canonical
      ? mode.reviewMode === 'fast-path-skip'
      : mode.codex === 'fast-path-skip',
    review_mode: mode.reviewMode,
    ...(mode.canonical ? {} : { codex: mode.codex }),
    reviewer: mode.reviewer,
    adjudicator: mode.adjudicator,
    findings,
    a2_triggered: a2,
    dismissed,
    dismissed_unsubstantiated: unsubstantiated,
    screenshot,
    doc,
    anomaly: args.anomaly ?? null,
  }

  mkdirSync(dirname(ledger), { recursive: true })
  appendFileSync(ledger, `${JSON.stringify(row)}\n`, 'utf-8')

  const codexLabel = mode.codex?.startsWith('astra-')
    ? `${mode.codex === 'astra-low' ? 'GPT-6-astra via Pi（effort: low）' : 'GPT-6-astra via Pi（effort: medium）'}${mode.codex.endsWith('+fable') ? ' + Claude Fable 5.1（effort: max）' : ''}`
    : mode.codex === 'fast-path-skip'
      ? '獨立 review 跳過（fast-path）'
      : mode.codex === 'xhigh+max+fable'
        ? 'GPT-5.6-sol via Pi（effort: xhigh → max）+ Claude Fable 5.1（effort: max）'
        : 'GPT-5.6-sol via Pi（effort: xhigh）'
  const canonicalLabel = [
    `review-mode ${mode.reviewMode}`,
    mode.reviewer && `reviewer ${mode.reviewer}`,
    mode.adjudicator && `adjudicator ${mode.adjudicator}`,
  ]
    .filter(Boolean)
    .join(', ')
  console.log(
    `✅ 0-A/B/C/D 並行匯合通過（${mode.canonical ? canonicalLabel : codexLabel}、screenshot ${row.screenshot}、check 全綠、doc ${row.doc}）`,
  )
  if (row.anomaly) console.log(`⚠ 本次記錄 anomaly: ${row.anomaly}`)
}

function readRows(ledger) {
  if (!existsSync(ledger)) return []
  return readFileSync(ledger, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function summary(args) {
  const cwd = projectDir(args, args.codex !== undefined)
  const ledger = resolve(cwd, '.clade', '0a-metrics.jsonl')
  const all = readRows(ledger)
  if (all.length === 0) {
    console.log(`[0a-metrics] ${ledger} 尚無紀錄`)
    return
  }
  const last = args.last === undefined ? all.length : num(args.last, 'last')
  const rows = all.slice(-last)

  const tot = (f) => rows.reduce((s, r) => s + f(r), 0)
  const pct = (n) => `${Math.round((n / rows.length) * 100)}%`
  const findingsTotal = tot(
    (r) => r.findings.critical + r.findings.major + r.findings.minor + r.findings.info,
  )
  const dismissed = tot((r) => r.dismissed)
  const unsub = tot((r) => r.dismissed_unsubstantiated)

  console.log(`## 0-A metrics — 最近 ${rows.length} 次（全檔 ${all.length} 筆）`)
  console.log('')
  console.log(`fast-path 命中     ${pct(rows.filter((r) => r.fast_path).length)}`)
  console.log(`0-A.2 觸發        ${pct(rows.filter((r) => r.a2_triggered).length)}`)
  const modes = rows.reduce((counts, row) => {
    const mode = row.review_mode ?? (row.codex ? `legacy:${row.codex}` : 'unknown')
    counts[mode] = (counts[mode] ?? 0) + 1
    return counts
  }, {})
  console.log(
    `review mode 分佈   ${Object.entries(modes)
      .map(([mode, count]) => `${mode} ${count}`)
      .join(' / ')}`,
  )
  console.log(`anomaly 出現       ${pct(rows.filter((r) => r.anomaly).length)}`)
  for (const k of ANOMALY_KINDS) {
    const n = rows.filter((r) => r.anomaly === k).length
    if (n > 0) console.log(`  └ ${k}: ${n} 次`)
  }
  console.log('')
  console.log(
    `finding 總數       ${findingsTotal}（Critical ${tot((r) => r.findings.critical)} / Major ${tot((r) => r.findings.major)} / Minor ${tot((r) => r.findings.minor)} / Info ${tot((r) => r.findings.info)}）`,
  )
  console.log(
    `dismissed          ${dismissed}，其中無反證被翻回 ${unsub}${dismissed > 0 ? `（${Math.round((unsub / dismissed) * 100)}%）` : ''}`,
  )
  console.log('')
  console.log('diff 規模 vs finding 數（每列一次 0-A）：')
  console.log('  lines  files  findings  a2')
  for (const r of rows.slice(-20)) {
    const f = r.findings.critical + r.findings.major + r.findings.minor + r.findings.info
    console.log(
      `  ${String(r.diff_lines).padStart(5)}  ${String(r.diff_files).padStart(5)}  ${String(f).padStart(8)}  ${r.a2_triggered ? '✓' : ' '}`,
    )
  }
}

const [cmd, ...rest] = process.argv.slice(2)
const args = parseArgs(rest)

if (cmd === 'record') record(args)
else if (cmd === 'summary') summary(args)
else {
  console.error(
    '用法: 0a-metrics.mjs record --diff-lines N --diff-files N --codex <mode> --critical N --major N --minor N --info N [...]',
  )
  console.error('      0a-metrics.mjs summary [--last N]')
  process.exit(2)
}
