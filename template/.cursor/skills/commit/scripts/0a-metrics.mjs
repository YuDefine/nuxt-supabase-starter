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
// `escalated-a2-deferred` 是 TD-1052 (c) 的具名例外：0-A.2 的深度 review 跑完了，但**裁決者
// 那一格結構性無人**（唯一具名的合格跨族裁決者配額耗盡）。它與 `escalated` 的差別只有一格 ——
// 裁決**還沒做**，不是做過了。**NEVER** 拿它記一次「找不到人所以算過」：下面 deferralConfig()
// 要求兩樣東西同時存在，兩樣都是機械可查的，不是宣稱。
const REVIEW_MODES = ['independent', 'escalated', 'escalated-a2-deferred', 'fast-path-skip']

/** `codex-review-safe.sh` 在配額耗盡時印的固定字串（該 script 的穩定輸出契約）。 */
const QUOTA_BLOCKED_MARKER = 'RESULT: quota-blocked'
/** `flow.ts open` 鑄出來的 work id 形狀。 */
const WORK_ID_RE = /^W-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/

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
    if (reviewMode === 'escalated-a2-deferred' && !reviewer) {
      die('--review-mode escalated-a2-deferred 必須提供非空 --reviewer（深度 review 仍要跑完）')
    }
    const deferral =
      reviewMode === 'escalated-a2-deferred'
        ? deferralConfig(args, adjudicator, projectDir(args, false))
        : null
    return { canonical: true, reviewMode, reviewer, adjudicator, deferral, codex: null }
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
    deferral: null,
    codex,
  }
}

/**
 * TD-1052 (c) 的兩個准入條件。兩個都是**機械可查**的，這是刻意的 —— 「延後裁決」與
 * 「跳過裁決」事後看起來完全一樣，唯一的差別是有沒有東西會把它叫回來。
 *
 *   1. `--a2-deferral-receipt <path>`：那次讓裁決者不可得的實跑憑證（典型是
 *      `codex-review-safe.sh` quota-blocked 的輸出）。**檢查檔案真的存在且非空**，
 *      不是收一個字串 —— 收字串等於允許「我打一句話說它不可用」。
 *   2. `--a2-deferral-work-id <W-...>`：承載補跑的 flow work item。**先有那張卡才准記這一列**，
 *      所以「之後補跑」在 ledger 落地的當下就已經有一個會浮出來的載體，不是一句承諾。
 *
 * 還有一條 NEVER 寫成程式碼：**同時給 `--adjudicator` 就拒收**。有裁決者就不叫延後，
 * 那組合唯一的用途是把一次真的裁決記成延後、或把一次延後粉飾成有人看過。
 */
function deferralConfig(args, adjudicator, cwd) {
  if (adjudicator) {
    die('--review-mode escalated-a2-deferred 不可同時提供 --adjudicator——有裁決者就用 escalated')
  }
  const receipt = identity(args, 'a2-deferral-receipt')
  if (!receipt) {
    die('--review-mode escalated-a2-deferred 必須提供 --a2-deferral-receipt <實跑憑證路徑>')
  }
  // 相對路徑要對 --repo（沒給就是 cwd）解析，NEVER 對 process.cwd() —— 兩者在
  // `--repo` 與呼叫端 cwd 不同時會分岔，ledger 落點卻是 `cwd`，相對憑證路徑因此可能
  // 指向一個跟 ledger 無關的目錄。
  const receiptPath = isAbsolute(receipt) ? receipt : resolve(cwd, receipt)
  if (!existsSync(receiptPath)) {
    die(`--a2-deferral-receipt 指向的檔不存在：${receiptPath}——憑證要是真的跑過留下的東西`)
  }
  if (statSync(receiptPath).size === 0) {
    die(`--a2-deferral-receipt 是空檔：${receiptPath}——空檔證明不了任何一次執行`)
  }
  // 「存在且非空」擋不住 `touch` ＋ `echo x`，更擋不住**拿另一種 receipt 冒充**：
  // gates.md 允許 Cursor 開 pane 失敗時留下 launcher／exit receipt，而那份檔在
  // 「存在且非空」的眼裡與 quota receipt 完全一樣 —— 規約用文字禁止的那條路，
  // 機械層是放行的。這裡綁到 `codex-review-safe.sh` 的穩定輸出契約上。
  if (!readFileSync(receiptPath, 'utf-8').includes(QUOTA_BLOCKED_MARKER)) {
    die(
      `--a2-deferral-receipt 不含 ${JSON.stringify(QUOTA_BLOCKED_MARKER)}：${receiptPath}——` +
        '它要是「合格裁決者因配額不可得」那次執行的原始輸出。開 pane 失敗的 launcher receipt ' +
        '不是這個，那條路的處置在 gates.md § 0-A.2，NEVER 走延後路徑。',
    )
  }
  const workId = identity(args, 'a2-deferral-work-id')
  if (!workId) {
    die(
      '--review-mode escalated-a2-deferred 必須提供 --a2-deferral-work-id <承載補跑的 flow work id>',
    )
  }
  if (!WORK_ID_RE.test(workId)) {
    die(`--a2-deferral-work-id 不是 flow work id 的形狀（${WORK_ID_RE.source}）：${workId}`)
  }
  return { receipt: receiptPath, workId }
}

/**
 * 這條路徑的整個設計理由是「有東西會把它叫回來」，而那個東西就是那張 work item。
 * **只驗非空等於讓註解承諾程式碼沒做的事** —— 填 `W-2026-09-10-whatever` 一樣通過，
 * ledger 留一列指向不存在的卡，沒有任何對帳會發現。那正是 TD-1052 自己記下的形狀：
 * presence check 被讀成 allow-list。
 *
 * 純 fs，不引依賴：spine 固定在 `<projectDir>/.clade/flow/events.jsonl`，事件列帶 `work_id`。
 * **spine 不存在也拒收** —— 這條路徑的前提是這個 repo 有一條會浮出停滯訊號的 spine，
 * 沒有 spine 就沒有「之後會被叫回來」。
 */
function assertDeferralWorkItemExists(workId, cwd) {
  const spine = resolve(cwd, '.clade', 'flow', 'events.jsonl')
  if (!existsSync(spine)) {
    die(
      `找不到 flow spine：${spine}——延後裁決要求補跑掛在一張真的卡上，` +
        '而這個 repo 沒有 spine 可以承載它。',
    )
  }
  const found = readFileSync(spine, 'utf-8')
    .split('\n')
    .some((line) => {
      if (!line) return false
      try {
        return JSON.parse(line).work_id === workId
      } catch {
        // 壞行不代表這張卡不存在 —— 跳過它繼續找，NEVER 因為一行壞掉就判定查無。
        return false
      }
    })
  if (!found) {
    die(
      `--a2-deferral-work-id 在 spine 上查無此卡：${workId}——先開卡：` +
        "node ~/offline/clade/vendor/scripts/flow/flow.ts open <slug> --origin td:TD-1052 --title '<snapshot dir> @ <base sha>'",
    )
  }
}

function die(msg) {
  console.error(`[0a-metrics] ${msg}`)
  process.exit(2)
}

function record(args) {
  const mode = modeConfig(args)
  const cwd = projectDir(args, !mode.canonical)
  // spine 檢查放這裡而非 deferralConfig()：它需要 cwd，而 cwd 由 projectDir() 在
  // modeConfig() **之後**才解析得出來。
  if (mode.deferral) assertDeferralWorkItemExists(mode.deferral.workId, cwd)
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
    if (a2 && mode.reviewMode !== 'escalated' && mode.reviewMode !== 'escalated-a2-deferred') {
      die('--a2 true 只能記錄 review-mode escalated 或 escalated-a2-deferred')
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
    // 延後的前提是 0-A.2 **確實被觸發了**。「沒有 Critical/Major 卻記延後」那一格由本函式
    // 更上面的 `a2 && !hadCriticalOrMajor` 攔（訊息指向觸發條件不成立）——**NEVER 在這裡再加
    // 一條同義檢查**，那會是永遠跑不到的死碼。這裡只補它涵蓋不到的一格：`--a2 false`。
    if (mode.reviewMode === 'escalated-a2-deferred' && !a2) {
      die('review-mode escalated-a2-deferred 必須搭配 --a2 true')
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
    // 三個欄位一起出現才有意義：`a2_deferred: true` 的那一列，adjudicator 必然是 null，
    // 而 receipt / work id 說得出「憑什麼延後」與「誰會把它叫回來」。
    //
    // **只在 canonical row 出現**，與上面 `codex` 只在 legacy row 出現是同一個做法：
    // legacy `--codex` 走不到延後路徑（`deferralConfig` 只由 canonical 分支呼叫），
    // 給它補三個恆為 null/false 的欄位是在既有 row 上加噪音。
    ...(mode.canonical
      ? {
          a2_deferred: mode.reviewMode === 'escalated-a2-deferred',
          a2_deferral_receipt: mode.deferral?.receipt ?? null,
          a2_deferral_work_id: mode.deferral?.workId ?? null,
        }
      : {}),
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
    mode.deferral && `裁決延後（憑證 ${mode.deferral.receipt}、補跑掛 ${mode.deferral.workId}）`,
  ]
    .filter(Boolean)
    .join(', ')
  console.log(
    `✅ 0-A/B/C/D 並行匯合通過（${mode.canonical ? canonicalLabel : codexLabel}、screenshot ${row.screenshot}、check 全綠、doc ${row.doc}）`,
  )
  if (row.anomaly) console.log(`⚠ 本次記錄 anomaly: ${row.anomaly}`)
  // 匯合行本身印的是「通過」，而延後裁決**不是**通過 —— 它是「附條件放行且欠一次裁決」。
  // 這一行刻意跟在後面，讓讀 terminal 的人不會只看到上面那個 ✅ 就收工。
  if (row.a2_deferred) {
    console.log(
      `⚠ 0-A.2 裁決已延後，NEVER 讀成完成：補跑掛在 ${row.a2_deferral_work_id}，憑證 ${row.a2_deferral_receipt}`,
    )
  }
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
