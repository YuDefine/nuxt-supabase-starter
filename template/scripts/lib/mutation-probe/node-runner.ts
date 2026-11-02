// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/mutation-probe/node-runner.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/mutation-probe/node-runner.ts
// CLADE:VENDOR-SCRIPT
//
// mutation-probe/node-runner — `node --test` 執行器
//
// 契約：specs/truth/contracts/mutation-probe-cli.md § 突變的套用機制（node-test）。
// 每一趟（基線或一個突變）= 一個新的 `node --import=<load-hook.mjs> --test --test-reporter=tap <測試檔>…`
// 行程群組（detached，逾時或被中斷時整組 SIGTERM、5 秒後 SIGKILL）。載入時替換由 `load-hook.mjs` 做；
// 它把「目標檔載入過幾次、替換發生幾次」追加寫進回報檔，本檔讀回成 `applied.loaded`／`applied.hits`。
// 測試結果取自 TAP：失敗的 test case 名稱 = 外層 describe／子測試前綴以 ` > ` 串接，與 test-cases.ts
// 的完整名稱同口徑。
//
// 由 ~/clade vendor/scripts/lib/ 散播，請勿直接編輯 consumer 副本。

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { MutationInput } from './mutation.ts'
import { ProbeToolError } from './receipt.ts'
import type { FailingTest, ReceiptBaseline, RunOutcome } from './receipt.ts'
import type { Runner, RunnerFactory, RunnerOptions } from './runner.ts'
import { spawnTrial } from './spawn-trial.ts'

const HOOK_URL = new URL('./load-hook.mjs', import.meta.url).href

// ───────────────────────── TAP 解析 ─────────────────────────

export interface TapResult {
  /** 有讀到 `# tests`／`# pass`／`# fail` 摘要；沒有＝測試行程根本沒跑起來或被截斷。 */
  hasSummary: boolean
  passed: number
  /** `# fail` ＋ `# cancelled`。 */
  failed: number
  failing: FailingTest[]
  /** `ok` 且不帶 `# SKIP`／`# TODO` 的 test case（不含 suite）完整名稱。 */
  passedNames: string[]
}

function unescapeTapName(s: string): string {
  return s.replace(/\\#/g, '#').replace(/\\\\/g, '\\')
}

/** `location: '/abs/x.test.ts:5:3'` → repo 相對的 `x.test.ts`；落在 repo 外保留原路徑。 */
function locationToFile(location: string, roots: string[]): string {
  let p = location.replace(/^'|'$/g, '').replace(/:\d+:\d+$/, '')
  if (p.startsWith('file://')) {
    try {
      p = fileURLToPath(p)
    } catch {
      return p
    }
  }
  for (const root of roots) {
    const rel = relative(root, p)
    if (rel !== '' && !rel.startsWith('..')) return rel.split('\\').join('/')
  }
  return p
}

/**
 * 解析 `--test-reporter=tap` 的輸出。
 * - 失敗的 test case = `not ok` 且 YAML `type: 'test'`（巢狀 describe 的 `subtestsFailed` 外層 suite 不算；
 *   suite 因 hook 失敗等別的原因失敗仍算一筆）。
 * - 名稱前綴由 `# Subtest: <name>` 行依縮排（4 空白＝一層）重建。
 * - 檔案取 YAML `location`；沒有時退回 `defaultFile`。
 */
export function parseTap(out: string, roots: string[], defaultFile: string): TapResult {
  const lines = out.split('\n')
  const stack: string[] = []
  const failing: FailingTest[] = []
  const passedNames: string[] = []
  const summary: Record<string, number> = {}

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const sum = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line)
    if (sum) {
      summary[sum[1]] = Number(sum[2])
      continue
    }
    const sub = /^( *)# Subtest: (.*)$/.exec(line)
    if (sub) {
      const level = Math.floor(sub[1].length / 4)
      stack.length = level
      stack[level] = unescapeTapName(sub[2])
      continue
    }
    const res = /^( *)(not ok|ok) \d+ - (.*)$/.exec(line)
    if (!res) continue
    const indent = res[1]
    const level = Math.floor(indent.length / 4)
    const directive = / # (?:SKIP|TODO)\b.*$/.exec(res[3])
    const name = unescapeTapName(directive ? res[3].slice(0, directive.index) : res[3])

    // 讀 YAML 診斷區塊（`<indent>  ---` … `<indent>  ...`）。
    const yaml: Record<string, string> = {}
    if (lines[i + 1] === `${indent}  ---`) {
      let j = i + 2
      for (; j < lines.length && lines[j] !== `${indent}  ...`; j++) {
        const kv = /^ *([A-Za-z]+): (.*)$/.exec(lines[j])
        // 只收該區塊最外層的欄位（縮排恰為 indent+2），多行字串內容更深。
        if (kv && lines[j].startsWith(`${indent}  `) && !lines[j].startsWith(`${indent}   `)) {
          yaml[kv[1]] = kv[2]
        }
      }
      i = j
    }

    const type = (yaml.type ?? "'test'").replace(/'/g, '')
    if (res[2] === 'ok') {
      if (!directive && type === 'test')
        passedNames.push([...stack.slice(0, level), name].join(' > '))
      continue
    }
    const failureType = (yaml.failureType ?? '').replace(/'/g, '')
    const isLeaf = type === 'test'
    const isOtherSuiteFailure = type === 'suite' && failureType !== 'subtestsFailed'
    if (!isLeaf && !isOtherSuiteFailure) continue
    failing.push({
      file: yaml.location ? locationToFile(yaml.location, roots) : defaultFile,
      name: [...stack.slice(0, level), name].join(' > '),
    })
  }

  const hasSummary = 'tests' in summary && 'pass' in summary && 'fail' in summary
  return {
    hasSummary,
    passed: summary.pass ?? 0,
    failed: (summary.fail ?? 0) + (summary.cancelled ?? 0),
    failing,
    passedNames,
  }
}

// ───────────────────────── 子行程 ─────────────────────────

function readReport(path: string): { loaded: boolean; hits: number } {
  if (!existsSync(path)) return { loaded: false, hits: 0 }
  const lines = readFileSync(path, 'utf8').split('\n')
  return {
    loaded: lines.includes('loaded'),
    hits: lines.filter((l) => l === 'hit').length,
  }
}

// ───────────────────────── Runner ─────────────────────────

export const createRunner: RunnerFactory = (opts: RunnerOptions): Runner => {
  if (typeof (nodeModule as { registerHooks?: unknown }).registerHooks !== 'function') {
    throw new ProbeToolError(
      `node-test 執行器需要 module.registerHooks（Node >= 22.15 / 23.5）；目前 ${process.version}`,
    )
  }
  if (opts.config !== undefined) {
    throw new ProbeToolError('--config 只用於 vitest 執行器；node-test 不收')
  }
  const roots = [...new Set([opts.root, realpathSync(opts.root)])]
  const defaultFile = opts.tests[0] ?? ''
  const nodeArgs = ['--test', ...opts.tests]
  let trialNo = 0

  const trial = async (spec: MutationInput | null, timeoutMs: number) => {
    const reportPath = join(opts.workDir, `report-${++trialNo}.txt`)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MUTATION_PROBE_REPORT: reportPath,
    }
    delete env.MUTATION_PROBE_SPEC
    // 探針本身跑在 node:test 行程內（測試、閘門 wrapper）時會繼承這個變數；子行程看到它會把
    // `node --test` 當成遞迴呼叫而「skipping running files」，什麼都不跑卻 exit 0。
    delete env.NODE_TEST_CONTEXT
    // hook 同時走 NODE_OPTIONS：`--import` 引數只傳給 `node --test` 的直接子行程，測試自己再 spawn 的
    // node（例如測 CLI 入口的 spawnSync，pr-lane C11 的 FULL_SHARDS guard 就在那一層）要靠環境變數才拿得到。
    // 兩條路載入同一個 URL，ESM 快取讓 hook 每個行程只註冊一次。測試把 env 清掉再 spawn 時仍套不到，
    // 那條路徑上的突變不生效（收據的 applied.hits 只計到有套上的行程）。
    env.NODE_OPTIONS = [env.NODE_OPTIONS, `--import=${HOOK_URL}`].filter(Boolean).join(' ')
    if (spec) {
      const target = join(opts.root, spec.file)
      env.MUTATION_PROBE_SPEC = JSON.stringify({
        target: existsSync(target) ? realpathSync(target) : target,
        from: spec.from,
        to: spec.to,
        occurrence: spec.occurrence,
      })
    }
    const result = await spawnTrial({
      cwd: opts.root,
      args: [`--import=${HOOK_URL}`, '--test-reporter=tap', ...nodeArgs],
      env,
      timeoutMs,
      trackGroup: opts.trackGroup,
    })
    return {
      ...result,
      tap: parseTap(result.stdout, roots, defaultFile),
      report: readReport(reportPath),
    }
  }

  const noStart = (r: { stdout: string; stderr: string; code: number | null }) =>
    new ProbeToolError(
      `node --test 沒有跑起來（exit ${r.code}，沒有 TAP 摘要）：${(r.stderr || r.stdout).trim().slice(-400)}`,
    )

  return {
    kind: 'node-test',
    command: ['node', ...nodeArgs],

    async baseline(timeoutMs: number): Promise<ReceiptBaseline> {
      const r = await trial(null, timeoutMs)
      if (r.timedOut) {
        return {
          status: 'timeout',
          passed: r.tap.passed,
          failed: r.tap.failed,
          ms: r.ms,
        }
      }
      if (!r.tap.hasSummary) throw noStart(r)
      const green = r.code === 0 && r.tap.failed === 0
      return {
        status: green ? 'green' : 'red',
        passed: r.tap.passed,
        failed: r.tap.failed,
        ms: r.ms,
      }
    },

    async runMutation(m: MutationInput, timeoutMs: number): Promise<RunOutcome> {
      const r = await trial(m, timeoutMs)
      if (r.timedOut) {
        return {
          timedOut: true,
          failing: [],
          loaded: r.report.loaded,
          hits: r.report.hits,
          ms: r.ms,
        }
      }
      if (!r.tap.hasSummary) throw noStart(r)
      let failing = r.tap.failing
      if (failing.length === 0 && (r.code !== 0 || r.tap.failed > 0)) {
        // 行程非零結束卻沒有個別失敗的 test case（頂層未捕捉例外等）：仍是突變造成的紅燈。
        failing = [
          {
            file: defaultFile,
            name: `(node --test exit ${r.code}，無個別失敗 case)`,
          },
        ]
      }
      return {
        timedOut: false,
        failing,
        loaded: r.report.loaded,
        hits: r.report.hits,
        ms: r.ms,
        passedNames: r.tap.passedNames,
      }
    },
  }
}
