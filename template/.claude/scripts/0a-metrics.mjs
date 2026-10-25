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
 *     --reviewer '<actual runtime/model>' --a2 true ...
 *
 *   node .claude/scripts/0a-metrics.mjs record --review-mode blocked \
 *     --blocked-reason 'opus quota exhausted' --diff-lines 120 --diff-files 3 \
 *     --critical 0 --major 1 --minor 0 --info 0 --a2 true \
 *     --screenshot skip --doc skip
 *   （blocked：gate 觸發但沒跑完——Opus 5.5 reviewer 不可用（配額耗盡／量不到）等
 *   外部原因。reviewer 可省；findings 記已觀察到的部分。）
 *
 * Legacy rows remain readable and the historical --codex interface remains supported:
 *   node .claude/scripts/0a-metrics.mjs record --diff-lines 120 --diff-files 3 \
 *     --codex xhigh --critical 0 --major 1 --minor 2 --info 0 \
 *     --a2 true --dismissed 1 --dismissed-unsubstantiated 0 \
 *     --screenshot skip --doc skip [--anomaly td246-fallback]
 *
 *   node .claude/scripts/0a-metrics.mjs summary [--repo /absolute/repo] [--last 20]
 *
 * 作者回應四分類（findings 非 0 時 gates.md 規定 MUST 帶；沒帶仍收、stderr 警告；給了任一個就 MUST 把每則 finding 都分完）：
 *   --fixed minor=2 --wrong major=1 --intentional info=1 --didnt-matter minor=1
 *   值是 `<severity>=N` 以逗號串接（critical／major／minor／info，省略的 severity 為 0）。
 *   每個 severity 的四類加總 MUST 等於該 severity 的 finding 數；Critical＋Major 的 `wrong` MUST ≥
 *   有反證的 dismissal（dismissed − dismissed-unsubstantiated）。判定依據見 commit skill
 *   gates.md § 0-A/B/C/D 並行匯合。沒給四類的列記 `responses: null`，與沒有這個欄位的
 *   舊列一樣在 summary 標「未記錄」，NEVER 當成 0 算進比例。
 *   - 觸發條件：informational — 不觸發任何東西
 *   - 消費端：W-2026-10-18-review-quality-loop S4（Minor／Info 政策重評）讀 summary 的
 *     依 severity 分布，判斷 reviewer 是報錯（wrong）還是報了沒價值的東西（didnt-matter）
 *     ——分類記作者判斷不記處置，fixed 不等於實際修掉的件數
 *   - 觸發點：commit skill gates.md § 0-A/B/C/D 並行匯合的 record 步驟（每次 0-A 必讀）
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
// 含 `+fable` 的舊 mode 隨跨模型裁決一起退役：歷史列仍由 summary 讀得出，
// 但新記錄不得再宣告一個不存在的裁決者組合。
const CODEX_MODES = ['astra-low', 'astra-medium', 'xhigh', 'fast-path-skip']
// `blocked`：gate 觸發但因外部原因（如 Opus 5.5 reviewer 配額耗盡）沒跑完
// ——review-policy 要求保留 pending review 記錄，不能讓它從遙測上消失（TD-1010）。
const REVIEW_MODES = ['independent', 'escalated', 'fast-path-skip', 'blocked']

// 跨模型裁決退役後跟著退場的參數——留在 CLI 上任何一個都能把「其實沒有
// 裁決者」記成好像有。
const RETIRED_ARGS = ['adjudicator', 'a2-deferral-receipt', 'a2-deferral-work-id']

const SEVERITIES = ['critical', 'major', 'minor', 'info']
// 作者對每則 finding 的回應。CLI 旗標是 `--didnt-matter`，ledger 欄位用底線。
const RESPONSE_KINDS = [
  ['fixed', 'fixed'],
  ['wrong', 'wrong'],
  ['intentional', 'intentional'],
  ['didnt-matter', 'didnt_matter'],
]

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

function severityCounts(v, field) {
  const out = Object.fromEntries(SEVERITIES.map((s) => [s, 0]))
  const seen = new Set()
  for (const part of String(v).split(',')) {
    const m = part.trim().match(/^([a-z]+)=(.*)$/)
    if (!m || !SEVERITIES.includes(m[1])) {
      die(`--${field} 的格式是 <${SEVERITIES.join('|')}>=N，以逗號串接，收到 ${JSON.stringify(v)}`)
    }
    if (seen.has(m[1])) die(`--${field} 的 ${m[1]} 重複出現，收到 ${JSON.stringify(v)}`)
    seen.add(m[1])
    out[m[1]] = num(m[2], `${field} ${m[1]}`)
  }
  return out
}

// 給了任一類就要求每則 finding 都分完；一類都沒給回傳 null（未記錄，不是 0）。
function responses(args, findings, dismissed, unsubstantiated) {
  if (RESPONSE_KINDS.every(([flag]) => args[flag] === undefined)) return null
  const out = Object.fromEntries(
    RESPONSE_KINDS.map(([flag, key]) => [
      key,
      args[flag] === undefined
        ? Object.fromEntries(SEVERITIES.map((s) => [s, 0]))
        : severityCounts(args[flag], flag),
    ]),
  )
  for (const s of SEVERITIES) {
    const classified = RESPONSE_KINDS.reduce((n, [, key]) => n + out[key][s], 0)
    if (classified !== findings[s]) {
      die(
        `${s} 的作者回應加總 ${classified} ≠ --${s} ${findings[s]}——四類給了就要把每則 finding 都分完`,
      )
    }
  }
  // 0-A.2 dismissal 只針對 Critical／Major，Minor／Info 的 wrong 不能拿來湊數。
  const wrong = out.wrong.critical + out.wrong.major
  if (wrong < dismissed - unsubstantiated) {
    die(
      `--wrong critical+major ${wrong} 少於有反證的 dismissal ${dismissed - unsubstantiated}——已驗反證的 dismissal 依判定順序歸 wrong`,
    )
  }
  return out
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

  // Retired cross-model args are rejected on BOTH invocation shapes — a
  // legacy `--codex` call carrying `--adjudicator` is the same retired
  // machinery, not a compatibility path.
  for (const key of RETIRED_ARGS) {
    if (args[key] !== undefined) {
      die(
        `--${key} 已隨跨模型裁決退役——0-A.2 是合格 reviewer（Claude Opus 5.5（effort: medium））的 fresh-context 深度複審，沒有裁決者欄位`,
      )
    }
  }

  if (hasCanonical) {
    const reviewMode = args['review-mode']
    if (!REVIEW_MODES.includes(reviewMode)) {
      die(`--review-mode 只接受 ${REVIEW_MODES.join(' | ')}，收到 ${JSON.stringify(reviewMode)}`)
    }
    const blockedReason = identity(args, 'blocked-reason')
    if (reviewMode === 'blocked' && !blockedReason) {
      die('--review-mode blocked 必須提供非空 --blocked-reason')
    }
    if (reviewMode !== 'blocked' && blockedReason) {
      die('--blocked-reason 只能搭配 --review-mode blocked')
    }
    const reviewer = identity(args, 'reviewer')
    if ((reviewMode === 'independent' || reviewMode === 'escalated') && !reviewer) {
      die(`--review-mode ${reviewMode} 必須提供非空 --reviewer`)
    }
    return { canonical: true, reviewMode, reviewer, blockedReason, codex: null }
  }

  const codex = args.codex ?? die('record 缺 --codex 或 --review-mode')
  if (!CODEX_MODES.includes(codex)) {
    die(`--codex 只接受 ${CODEX_MODES.join(' | ')}，收到 ${JSON.stringify(codex)}`)
  }
  if (args['blocked-reason'] !== undefined) {
    die('--blocked-reason 只能搭配 --review-mode blocked')
  }
  return {
    canonical: false,
    reviewMode: null,
    reviewer: null,
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
    if (a2 && mode.reviewMode !== 'escalated' && mode.reviewMode !== 'blocked') {
      die('--a2 true 只能記錄 review-mode escalated 或 blocked（已觸發但沒跑完）')
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
      die('Critical/Major 非 0 時須改用 review-mode escalated，並提供 --a2 true')
    }
  } else {
    if (a2 && !hadCriticalOrMajor) {
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

  const response = responses(args, findings, dismissed, unsubstantiated)
  // gates.md 規定 findings 非 0 時 MUST 帶四類；仍收（舊呼叫端相容）但出聲，免得新列與舊列一樣靜默記成「未記錄」。
  if (response === null && SEVERITIES.some((s) => findings[s] > 0)) {
    process.stderr.write(
      '⚠ findings 非 0 但沒帶 --fixed／--wrong／--intentional／--didnt-matter：本列記為「未記錄」，S4 資料會缺這筆（gates.md § 作者回應四分類）\n',
    )
  }

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
    blocked_reason: mode.blockedReason ?? null,
    findings,
    a2_triggered: a2,
    dismissed,
    dismissed_unsubstantiated: unsubstantiated,
    responses: response,
    screenshot,
    doc,
    anomaly: args.anomaly ?? null,
  }

  mkdirSync(dirname(ledger), { recursive: true })
  appendFileSync(ledger, `${JSON.stringify(row)}\n`, 'utf-8')

  const codexLabel = mode.codex?.startsWith('astra-')
    ? `GPT-6-astra via Pi（effort: ${mode.codex === 'astra-low' ? 'low' : 'medium'}）`
    : mode.codex === 'fast-path-skip'
      ? '獨立 review 跳過（fast-path）'
      : 'GPT-5.6-sol via Pi（effort: xhigh）'
  const canonicalLabel = [
    `review-mode ${mode.reviewMode}`,
    mode.reviewer && `reviewer ${mode.reviewer}`,
  ]
    .filter(Boolean)
    .join(', ')
  if (mode.reviewMode === 'blocked') {
    // blocked 只記錄 pending review——印匯合通過行等於替沒跑完的 gate 造假 PASS。
    console.log(`⏸ 0-A gate 未完成（blocked）：${mode.blockedReason}`)
  } else {
    console.log(
      `✅ 0-A/B/C/D 並行匯合通過（${mode.canonical ? canonicalLabel : codexLabel}、screenshot ${row.screenshot}、check 全綠、doc ${row.doc}）`,
    )
  }
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
  // ledger 不追蹤補跑是否已完成——這一行只表示「這個視窗內記過的延後列」，
  // 不是「仍然懸著」。真正的懸著狀態要看那張 work item 卡本身是不是還開著；這一行
  // 只是讓它從純欄位變成看得到，不假裝知道卡的狀態。
  const deferred = rows.filter((r) => r.a2_deferred)
  if (deferred.length > 0) {
    console.log(
      `0-A.2 裁決延後      ${deferred.length} 列（${deferred.map((r) => r.a2_deferral_work_id).join(', ')}）——逐一確認對應 work item 是否已補跑裁決`,
    )
  }
  console.log('')
  console.log(
    `finding 總數       ${findingsTotal}（Critical ${tot((r) => r.findings.critical)} / Major ${tot((r) => r.findings.major)} / Minor ${tot((r) => r.findings.minor)} / Info ${tot((r) => r.findings.info)}）`,
  )
  console.log(
    `dismissed          ${dismissed}，其中無反證被翻回 ${unsub}${dismissed > 0 ? `（${Math.round((unsub / dismissed) * 100)}%）` : ''}`,
  )
  printResponses(rows)
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

// 只有記了四類的列進比例；舊列（沒有 responses 欄）與新的未記錄列（null）單獨計數。
function printResponses(rows) {
  const recorded = rows.filter((r) => r.responses)
  const unrecorded = rows.filter((r) => !r.responses)
  const findingsOf = (r) => SEVERITIES.reduce((n, s) => n + (r.findings?.[s] ?? 0), 0)
  const unrecordedFindings = unrecorded.reduce((n, r) => n + findingsOf(r), 0)
  console.log('')
  console.log(
    `作者回應           已記錄 ${recorded.length} 列 / 未記錄 ${unrecorded.length} 列（${unrecordedFindings} 則 finding，不計入下列比例）`,
  )
  if (recorded.length === 0) return
  const count = (key, sevs) =>
    recorded.reduce((n, r) => n + sevs.reduce((m, s) => m + (r.responses[key]?.[s] ?? 0), 0), 0)
  const line = (label, sevs) => {
    const counts = RESPONSE_KINDS.map(([flag, key]) => [flag, count(key, sevs)])
    const total = counts.reduce((n, [, c]) => n + c, 0)
    const body = counts
      .map(([flag, c]) => `${flag} ${c}${total > 0 ? `（${Math.round((c / total) * 100)}%）` : ''}`)
      .join(' / ')
    console.log(`  ${label.padEnd(9)}${String(total).padStart(4)} 則：${body}`)
  }
  line('整體', SEVERITIES)
  for (const s of SEVERITIES) line(s, [s])
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
