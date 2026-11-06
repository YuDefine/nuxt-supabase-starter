#!/usr/bin/env node
// benchmark skill 的重現判定（SKILL.md Phase 2 與 hillclimb rule 讀它的 stdout）。
//
//   node summarize-runs.mjs --a <數字,逗號分隔> --b <數字,逗號分隔> [--higher-is-better] [--json]
//     --a 是基準側（改動前），--b 是改動側（改動後）；數字依實際執行順序給，單位自訂但兩側要一致。
//     預設指標越小越好（時間、延遲）；越大越好（吞吐）加 --higher-is-better。
//     → route=<faster|slower|no-measurable-difference|need-more-runs|*>
//
// 判定刻意只用 median、range 與區間重疊（first-match）：
//   任一側 < 5 次 → need-more-runs；兩側 [min,max] 有重疊 → no-measurable-difference；
//   否則 --b 的 median 比 --a 更好 → faster，更差 → slower。
// 接近邊界要不要用 rank-sum 是 agent 的判斷，這支腳本不做。
// exit 0＝判定完成；exit 2＝用法錯或輸入不是有限數字（stdout 印 route=*，NEVER 落到業務分支）。
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

export const MIN_RUNS = 5

/** @typedef {{ n: number, median: number, min: number, max: number }} SideSummary */

/** @typedef {{ route: 'faster' | 'slower' | 'no-measurable-difference' | 'need-more-runs', reason: string, a: SideSummary, b: SideSummary, deltaPercent: number }} Summary */

/** @param {number[]} values */
export function median(values) {
  const sorted = values.toSorted((x, y) => x - y)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** @param {number[]} values @returns {SideSummary} */
export function summarizeSide(values) {
  return {
    n: values.length,
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

/** @param {number[]} a @param {number[]} b @param {{ higherIsBetter?: boolean }} [opts] @returns {Summary} */
export function summarize(a, b, opts = {}) {
  const sa = summarizeSide(a)
  const sb = summarizeSide(b)
  const deltaPercent = sa.median === 0 ? Number.NaN : ((sb.median - sa.median) / sa.median) * 100
  const base = { a: sa, b: sb, deltaPercent }
  if (sa.n < MIN_RUNS || sb.n < MIN_RUNS) {
    return {
      ...base,
      route: 'need-more-runs',
      reason: `每側至少 ${MIN_RUNS} 次，目前 a=${sa.n}、b=${sb.n}`,
    }
  }
  if (sa.min <= sb.max && sb.min <= sa.max) {
    return {
      ...base,
      route: 'no-measurable-difference',
      reason: '兩側 [min,max] 有重疊，差距不大於 run-to-run 變異',
    }
  }
  const bBetter = opts.higherIsBetter ? sb.median > sa.median : sb.median < sa.median
  return {
    ...base,
    route: bBetter ? 'faster' : 'slower',
    reason: `兩側 range 不重疊，b median ${sb.median} 相對 a median ${sa.median}`,
  }
}

/** @param {string} raw @param {string} label @returns {number[]} */
export function parseNumbers(raw, label) {
  const parts = raw.split(',').map((s) => s.trim())
  if (parts.length === 0 || parts.some((p) => p === '')) throw new Error(`--${label} 有空值`)
  const nums = parts.map(Number)
  if (nums.some((n) => !Number.isFinite(n))) throw new Error(`--${label} 含非有限數字：${raw}`)
  return nums
}

/** @param {string[]} argv */
function main(argv) {
  let values
  try {
    values = parseArgs({
      args: argv,
      options: {
        a: { type: 'string' },
        b: { type: 'string' },
        'higher-is-better': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
      },
      strict: true,
    }).values
    if (values.a === undefined || values.b === undefined) throw new Error('缺 --a 或 --b')
    const result = summarize(parseNumbers(values.a, 'a'), parseNumbers(values.b, 'b'), {
      higherIsBetter: values['higher-is-better'],
    })
    if (values.json) {
      console.log(JSON.stringify(result))
    } else {
      const side = (/** @type {string} */ name, /** @type {SideSummary} */ s) =>
        `${name}_n=${s.n}\n${name}_median=${s.median}\n${name}_min=${s.min}\n${name}_max=${s.max}`
      console.log(`route=${result.route}`)
      console.log(`reason=${result.reason}`)
      console.log(side('a', result.a))
      console.log(side('b', result.b))
      console.log(`delta_percent=${result.deltaPercent.toFixed(1)}`)
    }
    return 0
  } catch (error) {
    console.log('route=*')
    console.error(`summarize-runs: ${/** @type {Error} */ (error).message}`)
    return 2
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)))
