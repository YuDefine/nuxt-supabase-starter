#!/usr/bin/env node

/**
 * gate.mjs — evlog map ratchet gate
 *
 * 對照 committed `evlog.map.json` baseline 與當前 `evlog map --json` 結果，跑三條判定：
 *
 *   1. 全域分不得低於 baseline（只進不退）
 *   2. 本次 diff 觸及的 entry point 必須滿分（新增與修改都算）
 *   3. suppressedChecks 不得增加（防止靠 disable 註解洗分）
 *
 * 外加一條 false-green 防護：掃出 0 個 entry point 直接 fail，唯一出路是 repo 內
 * committed 的明文放行單 `evlog.map.waiver.json`（四欄必填 + 到期日）。evlog map 對定位不到
 * project root 的佈局（Nuxt layer monorepo 各 package 無 package.json）會回
 * `routes: []` 且 `score: 100` —— 零覆蓋回報滿分會讓上面三條判定全部靜默失效。
 *
 * 用法：
 *   node gate.mjs --baseline evlog.map.json --changed-files <file> [--cwd <dir>]
 *                 [--mode ratchet|min-score] [--min-score <n>] [--today YYYY-MM-DD]
 *
 * `--cwd` 可重複：Nuxt layer monorepo 每個 layer 是獨立的 scan root，各自帶一份
 * `<layer>/evlog.map.json` baseline，任一 layer 違反判定就整體 fail。
 *
 * exit 0 = 通過 / 1 = 違反判定 / 2 = 用法或環境錯誤
 */

import { execFile as execFileCb } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCb)

const DOC = 'https://evlog.dev/cli/map'
const RULES_DOC = 'https://evlog.dev/cli/rules'

function parseArgs(argv) {
  const out = {
    baseline: 'evlog.map.json',
    changedFiles: null,
    cwds: [],
    mode: 'ratchet',
    minScore: 100,
    today: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--baseline') out.baseline = argv[++i]
    else if (a === '--changed-files') out.changedFiles = argv[++i]
    else if (a === '--cwd') out.cwds.push(argv[++i])
    else if (a === '--mode') out.mode = argv[++i]
    else if (a === '--min-score') out.minScore = Number(argv[++i])
    else if (a === '--today') out.today = argv[++i]
    else {
      process.stderr.write(`unknown flag: ${a}\n`)
      process.exit(2)
    }
  }
  if (out.cwds.length === 0) out.cwds.push('.')
  // min-score 是 deprecated 別名：它原本比對全域整數分，已實測證明會被
  // Math.round 與 suppression 兩路稀釋，一律當 strict 處理。
  if (out.mode === 'min-score') out.mode = 'strict'
  if (out.mode !== 'ratchet' && out.mode !== 'strict') {
    process.stderr.write(`--mode must be ratchet | strict (got: ${out.mode})\n`)
    process.exit(2)
  }
  return out
}

/** GitHub Actions annotation；非 CI 環境退化成純文字前綴 */
function annotate(level, message) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    process.stdout.write(`::${level}::${message}\n`)
  } else {
    process.stdout.write(`[${level}] ${message}\n`)
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    return { parseError: err.message }
  }
}

/**
 * 跑 `evlog map --json --no-write` 拿當前結果。
 * --no-write 確保 gate 不會偷改 working tree 的 evlog.map.json。
 *
 * 預設走 `npx --no-install`，只認 node_modules 內裝好的版本 —— CI 不該在 gate 執行
 * 當下抓一個未 pin 的 CLI。`EVLOG_CLI_BIN` 覆寫執行檔，給 fixtures test 與把 CLI 裝在
 * node_modules 外的 repo 用。
 */
async function runMap(cwd) {
  const override = process.env.EVLOG_CLI_BIN
  const [cmd, argv] = override
    ? [override, ['map', '--json', '--no-write']]
    : ['npx', ['--no-install', 'evlog', 'map', '--json', '--no-write']]
  const { stdout } = await execFile(cmd, argv, { cwd, maxBuffer: 64 * 1024 * 1024 })
  return JSON.parse(stdout)
}

const WAIVER_FILE = 'evlog.map.waiver.json'
const WAIVER_FIELDS = ['reason', 'tracking', 'approved_by', 'expires']

/** `--today` 覆寫給測試用；否則取當日 UTC 日期 */
function todayIso(override) {
  return override || new Date().toISOString().slice(0, 10)
}

/**
 * 讀 repo 根的明文放行單。這是 `routes.length === 0` 的**唯一**出路 —— 掃不到就是
 * 量不到，預設硬擋；要放行必須留下可 review、可追蹤、會自己到期的記錄。
 *
 * 四個欄位全部必填，缺一不放行：
 *   reason       為什麼這個 repo 掃不到（技術成因，不是「趕時間」）
 *   tracking     追蹤位置（TD 編號 / issue URL）—— 放行不等於不修
 *   approved_by  誰核准的
 *   expires      YYYY-MM-DD，過期即失效並恢復硬擋
 *
 * expires 是刻意的：沒有到期日的放行單會變成永久靜音，而永久靜音跟沒有 gate 沒兩樣。
 */
function readWaiver(repoRoot, today) {
  const path = resolve(repoRoot, WAIVER_FILE)
  if (!existsSync(path)) {
    return { valid: false, why: `找不到 ${WAIVER_FILE}（預設硬擋）` }
  }
  const data = readJson(path)
  if (data.parseError) {
    return { valid: false, why: `${WAIVER_FILE} 解析失敗：${data.parseError}` }
  }
  const missing = WAIVER_FIELDS.filter((f) => !data[f] || String(data[f]).trim() === '')
  if (missing.length > 0) {
    return { valid: false, why: `${WAIVER_FILE} 缺必填欄位：${missing.join(', ')}` }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.expires)) {
    return { valid: false, why: `${WAIVER_FILE} 的 expires 不是 YYYY-MM-DD：${data.expires}` }
  }
  if (data.expires < today) {
    return {
      valid: false,
      why: `${WAIVER_FILE} 已於 ${data.expires} 到期（今天 ${today}）—— 重新評估後才能續期`,
    }
  }
  return { valid: true, data }
}

/** 讀變更檔清單（一行一個 repo-relative 路徑）。null = 沒有清單可用 */
function readChangedFilesRaw(listPath) {
  if (!listPath || !existsSync(listPath)) return null
  return readFileSync(listPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/** 把 repo-relative 清單換算成某個 scan root 底下的相對路徑（root 外的丟掉） */
function scopeChangedFiles(lines, repoRoot, scanCwd) {
  const set = new Set()
  for (const line of lines) {
    // git 給的是 repo-relative；route.file 是 scan-cwd-relative
    const abs = resolve(repoRoot, line)
    const rel = relative(scanCwd, abs)
    if (!rel.startsWith('..')) set.add(rel)
  }
  return set
}

/**
 * evlog map 有兩種 JSON 形狀，必須都吃：
 *   - `--json` stdout：`{ map: { score, routes }, summary: { suppressedChecks } }`
 *   - 寫進 `evlog.map.json` 的檔：只有 map 本體（`{ score, routes }`，**沒有** summary）
 *
 * suppressed 一律從 routes 現算（check 物件上的 `suppressed: true`），不讀 summary ——
 * 讀 summary 的話 baseline 檔永遠算出 0，判定 3 會拿 current 去跟 0 比，任何一個合法
 * 登記的豁免都會讓 gate 永久卡死。
 */
function normalizeMap(json) {
  const map = json?.map ?? json ?? {}
  const routes = map.routes ?? []
  let suppressed = 0
  for (const route of routes) {
    for (const check of Object.values(route.checks || {})) {
      if (check?.suppressed) suppressed++
    }
  }
  return { score: map.score ?? 0, routes, suppressed }
}

/** route 是否完全通過：滿分且沒有任何 fail check */
function routeFailures(route) {
  const failed = []
  for (const [name, check] of Object.entries(route.checks || {})) {
    if (check?.status === 'fail')
      failed.push({ name, message: check.message, evidence: check.evidence })
  }
  return failed
}

function describeRoute(route) {
  const method = route.method ? `${route.method} ` : ''
  const sens =
    route.sensitivity?.level && route.sensitivity.level !== 'none'
      ? ` [${route.sensitivity.level}]`
      : ''
  return `${method}${route.path || route.file}${sens}`
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const repoRoot = process.cwd()
  const changed = readChangedFilesRaw(opts.changedFiles)

  let failed = 0
  for (const cwd of opts.cwds) {
    const label = opts.cwds.length > 1 ? `[${cwd}] ` : ''
    const ok = await evaluateRoot({ repoRoot, cwd, label, opts, changed })
    if (!ok) failed++
  }

  if (failed > 0) {
    process.stdout.write(`\n✗ evlog map gate: ${failed}/${opts.cwds.length} 個 scan root 未通過\n`)
    process.exit(1)
  }
}

/**
 * 評估單一 scan root。回傳 true = 通過。
 * baseline 相對該 root 解析（`<root>/evlog.map.json`），所以每個 layer 各自累積自己的棘輪。
 */
async function evaluateRoot({ repoRoot, cwd, label, opts, changed }) {
  const scanCwd = resolve(repoRoot, cwd)

  let current
  try {
    current = await runMap(scanCwd)
  } catch (err) {
    annotate('error', `${label}evlog map 執行失敗：${err.message.split('\n')[0]} — 見 ${DOC}`)
    process.exit(2)
  }

  const { score, routes, suppressed } = normalizeMap(current)

  process.stdout.write(
    `${label}evlog map: score ${score} · ${routes.length} entry points · ` +
      `${suppressed} suppressed check(s) · framework ${current.map?.framework || 'unknown'}\n`,
  )

  // ── False-green 防護（先於所有判定）────────────────────────────────────────
  // routes 為 0 時 evlog map 回報 score 100。這不是「全部覆蓋」，是「什麼都沒掃到」。
  // 預設硬擋；唯一出路是 repo 內 committed 的明文放行單（見 readWaiver）。
  if (routes.length === 0) {
    const waiver = readWaiver(repoRoot, todayIso(opts.today))
    if (waiver.valid) {
      annotate(
        'warning',
        `${label}evlog map 掃到 0 個 entry point —— 已明文放行至 ${waiver.data.expires}。` +
          `理由：${waiver.data.reason}｜追蹤：${waiver.data.tracking}｜核准：${waiver.data.approved_by}。` +
          `這不是「覆蓋率 100」，是「量不到」。`,
      )
      return true
    }
    annotate(
      'error',
      `${label}evlog map 掃到 0 個 entry point 卻回報 score ${score} —— 這是 false green，不是滿分。` +
        `Nuxt layer monorepo 的解法是每個 layer 補一份 private package.json 並在 ` +
        `pnpm-workspace.yaml 排除，再用可重複的 --cwd 逐 layer 掃。\n` +
        `放行單狀態：${waiver.why}\n` +
        `格式與規則見 vendor/snippets/evlog-map/monorepo-layers.md`,
    )
    return false
  }

  // ── strict 模式（收斂完成後的終局形態）────────────────────────────────────
  // 判定用「每個 route 零 failed check」，**NEVER** 用全域分數。三個實測理由：
  //
  //   1. 分數是 Math.round(加權平均)。531 個 route 裡有一個掉到 80 分，全域是
  //      99.96 → 顯示 100。分數當 boolean 用，大 repo 必然放行真實失敗。
  //   2. suppression 會把 fail 轉成不扣分的 `n/a`。只看分數的話，把整份專案
  //      disable 掉就是滿分。
  //   3. `structured-errors` 不檢查 catalog 定義的內容——`throw someErrors.X()`
  //      一律當 pass。分數高不代表 why/fix 有價值（見 rules/core/evlog-adoption.md
  //      § Coverage 維度 的 false-green 警示）。這條 gate 擋不掉，但至少不該再
  //      被四捨五入與 suppression 二次稀釋。
  if (opts.mode === 'strict') {
    const failedRoutes = routes.filter((r) => routeFailures(r).length > 0)
    const violations = []

    if (failedRoutes.length > 0) {
      const sample = failedRoutes
        .slice(0, 10)
        .map((r) => {
          const names = routeFailures(r)
            .map((f) => f.name)
            .join(', ')
          return `      · ${describeRoute(r)} (${r.score}/100) — ${names}`
        })
        .join('\n')
      const more = failedRoutes.length > 10 ? `\n      …另外 ${failedRoutes.length - 10} 個` : ''
      violations.push(
        `${failedRoutes.length}/${routes.length} 個 entry point 仍有失敗的 check：\n${sample}${more}`,
      )
    }

    if (suppressed > 0) {
      violations.push(
        `${suppressed} 個 check 被 disable 註解豁免。strict 模式不接受任何豁免——` +
          `evlog map 會把 disabled check 轉成不扣分的 n/a，留著它們等於分數是洗出來的。`,
      )
    }

    if (violations.length > 0) {
      for (const v of violations) annotate('error', label + v)
      return false
    }

    process.stdout.write(
      `${label}✓ strict 通過（${routes.length} 個 entry point 全數零失敗，零豁免）\n`,
    )
    return true
  }

  // ── ratchet 模式 ──────────────────────────────────────────────────────────
  const baselinePath = resolve(scanCwd, opts.baseline)
  if (!existsSync(baselinePath)) {
    annotate(
      'warning',
      `${label}找不到 baseline ${opts.baseline} —— 尚未導入 evlog map，跳過 gate。` +
        `導入方式見 vendor/snippets/evlog-map/README.md`,
    )
    return true
  }
  const baseline = readJson(baselinePath)
  if (baseline.parseError) {
    annotate('error', `${label}baseline ${opts.baseline} 解析失敗：${baseline.parseError}`)
    process.exit(2)
  }

  const {
    score: baseScore,
    suppressed: baseSuppressed,
    routes: baselineRoutes,
  } = normalizeMap(baseline)
  const violations = []

  // 判定 1：失敗的 entry point 數不得增加。
  // **NEVER** 改回比較 score——那是 Math.round(加權平均)，大 repo 裡新增一兩個
  // 失敗 route 完全反映不到整數分上（531 個 route 掉一個到 80 分 → 99.96 → 100）。
  const baseFailed = baselineRoutes.filter((r) => routeFailures(r).length > 0).length
  const curFailed = routes.filter((r) => routeFailures(r).length > 0).length
  if (curFailed > baseFailed) {
    violations.push(
      `失敗的 entry point 增加：${baseFailed} → ${curFailed}（全域分 ${baseScore} → ${score}）。` +
        `evlog map 的覆蓋率只進不退；把新增的 gap 補起來，或說明為何 baseline 該降。`,
    )
  }

  // 判定 2：diff 觸及的 entry point 必須滿分
  if (changed === null) {
    annotate('warning', `${label}沒有變更檔清單 —— 跳過「觸及的 entry point 必須滿分」判定`)
  } else {
    const scoped = scopeChangedFiles(changed, repoRoot, scanCwd)
    const touched = routes.filter((r) => scoped.has(r.file))
    process.stdout.write(`${label}本次 diff 觸及 ${touched.length} 個 entry point\n`)
    for (const route of touched) {
      const failures = routeFailures(route)
      if (failures.length === 0) continue
      const detail = failures
        .map((f) => {
          const at = f.evidence?.line ? `:${f.evidence.line}` : ''
          return `      · ${f.name} — ${f.message || 'failed'} (${route.file}${at})`
        })
        .join('\n')
      violations.push(
        `${describeRoute(route)} 未滿分（${route.score}/100），但本次 commit 動到它：\n${detail}\n` +
          `      補 useLogger + log.set，或留 \`// evlog-map-disable-next-line <check> — <理由>\`。檢查定義見 ${RULES_DOC}`,
      )
    }
  }

  // 判定 3：suppressedChecks 不得增加
  if (suppressed > baseSuppressed) {
    violations.push(
      `suppressed check 增加：${baseSuppressed} → ${suppressed}。` +
        `新增的 disable 註解必須帶理由，且要在 review 中說明為何該 entry point 不可插樁 —— ` +
        `disable 是登記豁免，不是過 gate 的手段。`,
    )
  }

  if (violations.length > 0) {
    for (const v of violations) annotate('error', label + v)
    return false
  }

  process.stdout.write(
    `${label}✓ ratchet 通過（score ${score} >= ${baseScore}，suppressed ${suppressed} <= ${baseSuppressed}）\n`,
  )
  return true
}

main().catch((err) => {
  annotate('error', `gate 內部錯誤：${err.stack || err.message}`)
  process.exit(2)
})
