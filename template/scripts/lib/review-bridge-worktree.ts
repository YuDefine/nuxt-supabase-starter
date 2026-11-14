// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/review-bridge-worktree.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/review-bridge-worktree.ts
/**
 * Review Bridge 多機方案 A 的 clade 段（yudefine-hq research/2026-11-12-Review-Bridge多機兼容.md § 方案 A ①③）。
 *
 * ① 開樹後 init：只有標了要走 Bridge 的工作（`wt-helper add --bridge`，或派工時帶 env
 *    `CLADE_WT_BRIDGE=1`）才在新樹跑 `review-bridge init --writer claude --reviewer claude --json`，
 *    輸出存進該工作的 plan 目錄（`specs/plans/<work_id>/bridge-init.json`）。沒標就完全不動。
 *    project_id 由 init 產生，每棵樹一個，狀態在 data home 的 `projects/<project_id>/`（M4、M6、M7）。
 *
 * ③ 清理前檢查：結果檔住在樹內 `.review-bridge/results/<工單>/`，樹一刪就跟著消失（M9）。
 *    樹內有結果、但 `~/handoff/bridge-results/<任一 machine>/<run_id>/` 沒有完整收割的，清理就擋，
 *    並印出收割指令。收割器（②，HQ 段）寫到同一個路徑。每個 run 只比它自己的檔（記了該 run_id 的 .md；
 *    工單夾只有一個 run 時是整夾）：收割夾某一層有這組檔、相對路徑與大小都原樣對上才判已收割；
 *    多 run 時沒記 run_id 的檔整組在任一 run 的收割夾某一層原樣有一份即可（缺時落點 `<run_id>/<工單>-shared`）。
 *
 * 只用 Bridge 公開 CLI 與它寫在專案資料夾的檔，不碰 Bridge 原始碼、不連它的 DB。
 */

import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'

export const BRIDGE_INIT_ARGS = ['init', '--writer', 'claude', '--reviewer', 'claude', '--json']
export const BRIDGE_INIT_FILE = 'bridge-init.json'

/** `--bridge` 旗標優先；沒帶時看派工 env `CLADE_WT_BRIDGE`（1／true／yes）。 */
export function bridgeRequested(flag: boolean | undefined, env = process.env): boolean {
  if (flag) return true
  return /^(1|true|yes)$/iu.test(String(env.CLADE_WT_BRIDGE ?? '').trim())
}

export function bridgeBin(env = process.env): string {
  return env.CLADE_REVIEW_BRIDGE_BIN?.trim() || 'review-bridge'
}

export function bridgeMachine(env = process.env): string {
  return env.CLADE_BRIDGE_MACHINE?.trim() || hostname().split('.')[0]
}

export function bridgeHarvestRoot(env = process.env): string {
  return env.CLADE_BRIDGE_HARVEST_ROOT?.trim() || join(homedir(), 'handoff', 'bridge-results')
}

export interface BridgeInitResult {
  ok: boolean
  outPath: string | null
  detail: string
}

/**
 * 在 `wtPath` 跑 init，stdout（JSON）寫進 `outDir/bridge-init.json`。
 * 失敗時把 stdout／stderr 一併寫進同一檔（ok:false），讓 plan 目錄留下為什麼沒 init。
 */
export function runBridgeInit(
  wtPath: string,
  outDir: string,
  env: NodeJS.ProcessEnv = process.env,
): BridgeInitResult {
  const bin = bridgeBin(env)
  const r = spawnSync(bin, BRIDGE_INIT_ARGS, { cwd: wtPath, env, encoding: 'utf8' })
  const stdout = String(r.stdout ?? '')
  const stderr = String(r.stderr ?? '')
  const ok = !r.error && r.status === 0
  let body: string
  if (ok) {
    try {
      body = `${JSON.stringify(JSON.parse(stdout), null, 2)}\n`
    } catch {
      body = stdout
    }
  } else {
    body = `${JSON.stringify(
      {
        ok: false,
        command: [bin, ...BRIDGE_INIT_ARGS].join(' '),
        status: r.status,
        error: r.error ? String(r.error.message ?? r.error) : null,
        stdout,
        stderr,
      },
      null,
      2,
    )}\n`
  }
  let outPath: string | null = null
  try {
    mkdirSync(outDir, { recursive: true })
    outPath = join(outDir, BRIDGE_INIT_FILE)
    writeFileSync(outPath, body)
    excludeFromGit(wtPath, outPath)
  } catch (e) {
    return { ok: false, outPath: null, detail: `寫 init 輸出失敗：${(e as Error).message}` }
  }
  const detail = ok
    ? 'init ok'
    : r.error
      ? `${bin} 無法執行：${r.error.message}`
      : `${bin} init exit ${r.status}：${stderr.trim().split('\n').slice(-1)[0] ?? ''}`
  return { ok, outPath, detail }
}

export interface UnharvestedBridgeRun {
  workPackage: string
  resultsDir: string
  /** null＝結果夾裡找不到 run_id（run 沒寫完、中止或格式不認得），一樣擋。 */
  runId: string | null
  /** 印出的收割落點（本機 machine 名稱）。runId 為 null 時是 null。 */
  expected: string | null
  /** missing＝任何 machine 夾下都沒有；incomplete＝有夾但缺結果檔（半途中斷的複製）；unreadable＝結果夾讀不到。 */
  state: 'missing' | 'incomplete' | 'no-run-id' | 'unreadable'
  /** true＝缺的是多 run 工單夾裡沒記 run_id 的共用檔（該 run 自己的檔已收割），落點是 `<run_id>/<工單>-shared`。 */
  shared?: boolean
}

const RUN_ID_LINE = /^run_id:\s*([0-9A-Fa-f][0-9A-Fa-f-]{7,})\s*$/mu

/** 結果夾頂層 .md 檔 → 該檔記的 run_id。沒有 run_id 行或讀不到的檔不列。 */
function runIdsByFile(dir: string): Map<string, string> {
  const byFile = new Map<string, string>()
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const p = join(dir, name)
    try {
      if (!statSync(p).isFile()) continue
      const m = RUN_ID_LINE.exec(readFileSync(p, 'utf8'))
      if (m) byFile.set(name, m[1])
    } catch {
      /* 讀不到的檔不提供 run_id；整夾無 run_id 時仍會擋 */
    }
  }
  return byFile
}

/** dir 底下所有檔（遞迴）的 相對路徑→大小。 */
function filesWithSize(dir: string, base = dir, out = new Map<string, number>()) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) filesWithSize(p, base, out)
    else if (st.isFile()) out.set(relative(base, p), st.size)
  }
  return out
}

/**
 * 收割是否完整：runDirs 其中一個收割夾（遞迴、任何層）底下，有一個前綴 P 讓這組結果檔每個都在
 * `P/<相對路徑>` 而且大小相同——也就是工單夾原樣複製在收割夾的某一層。前綴由第一個檔推出，
 * 其餘檔都要在同一前綴下精確對到，所以一份收割檔只抵一個結果檔，不會被別層的同名同大小檔頂替。
 * 只看「夾在不在」會讓半途中斷的複製（空夾、少檔）放行清理，把唯一完整的一份刪掉。
 */
function harvestCovers(runDirs: readonly string[], results: Map<string, number>): boolean {
  const want = [...results].map(([rel, size]) => [rel.split(sep).join('/'), size] as const)
  if (want.length === 0) return true
  const [anchor] = want[0]
  for (const d of runDirs) {
    const have = new Map<string, number>()
    try {
      for (const [rel, size] of filesWithSize(d)) have.set(rel.split(sep).join('/'), size)
    } catch {
      continue
    }
    for (const h of have.keys()) {
      if (h !== anchor && !h.endsWith(`/${anchor}`)) continue
      const prefix = h.slice(0, h.length - anchor.length)
      if (want.every(([rel, size]) => have.get(`${prefix}${rel}`) === size)) return true
    }
  }
  return false
}

/** 樹內 `.review-bridge/results/*` 裡，沒有完整收割的 run 清單；沒有 results 回空陣列。 */
export function findUnharvestedBridgeRuns(
  wtPath: string,
  env: NodeJS.ProcessEnv = process.env,
): UnharvestedBridgeRun[] {
  const resultsRoot = join(wtPath, '.review-bridge', 'results')
  try {
    if (!statSync(resultsRoot).isDirectory()) return []
  } catch {
    return []
  }
  const harvestRoot = bridgeHarvestRoot(env)
  const harvestDir = join(harvestRoot, bridgeMachine(env))
  // run_id 是 UUID、全域唯一：任何機器夾下有它就算數。機器名稱只決定印出的收割落點，
  // 不拿來判定——收割器若用別的機器名稱寫法（desk／完整 hostname），清理也不會被永遠擋住。
  const machineDirs = (() => {
    try {
      return readdirSync(harvestRoot).map((m) => join(harvestRoot, m))
    } catch {
      return []
    }
  })()
  const runDirs = (id: string) =>
    machineDirs.flatMap((d) =>
      [...new Set([id, id.toLowerCase()])].map((v) => join(d, v)).filter((p) => existsSync(p)),
    )
  const out: UnharvestedBridgeRun[] = []
  for (const wp of readdirSync(resultsRoot)) {
    const dir = join(resultsRoot, wp)
    let results: Map<string, number>
    let byFile: Map<string, string>
    try {
      if (!statSync(dir).isDirectory()) continue
      results = filesWithSize(dir)
      if (results.size === 0) continue
      byFile = runIdsByFile(dir)
    } catch {
      out.push({
        workPackage: wp,
        resultsDir: dir,
        runId: null,
        expected: null,
        state: 'unreadable',
      })
      continue
    }
    const ids = [...new Set(byFile.values())]
    if (ids.length === 0) {
      out.push({
        workPackage: wp,
        resultsDir: dir,
        runId: null,
        expected: null,
        state: 'no-run-id',
      })
      continue
    }
    // 一個工單夾可有多次 run：每個 run 只比它自己的檔（記了該 run_id 的 .md）；沒記 run_id 的檔
    // 歸不到哪個 run，要求至少一個 run 的收割夾有它。只比整夾會讓收割器只收自己 run 的檔時永遠擋。
    const untagged = new Map([...results].filter(([rel]) => !byFile.has(rel)))
    const ownFiles = (id: string) =>
      new Map(
        [...results].filter(
          ([rel]) => byFile.get(rel) === id || (ids.length === 1 && !byFile.has(rel)),
        ),
      )
    for (const id of ids) {
      const found = runDirs(id)
      if (found.some((d) => harvestCovers([d], ownFiles(id)))) continue
      out.push({
        workPackage: wp,
        resultsDir: dir,
        runId: id,
        expected: join(harvestDir, id),
        state: found.length > 0 ? 'incomplete' : 'missing',
      })
    }
    // 沒記 run_id 的檔：整組原樣在任一 run 的收割夾某一層有一份即可。本工單夾已有 run 列進未收割時，
    // 補收那個 run（整夾複製）就一併處理，不重複列。落點放在最後一個 run 底下的新子夾
    // `<run_id>/<工單>-shared`：該 run 的收割夾已存在，直接 mv -T 進去會撞上非空目標。
    if (ids.length > 1 && untagged.size > 0 && !out.some((r) => r.resultsDir === dir)) {
      if (!harvestCovers(ids.flatMap(runDirs), untagged)) {
        const id = ids[ids.length - 1]
        const expected = join(harvestDir, id, `${wp}-shared`)
        out.push({
          workPackage: wp,
          resultsDir: dir,
          runId: id,
          expected,
          shared: true,
          state: existsSync(expected) ? 'incomplete' : 'missing',
        })
      }
    }
  }
  return out
}

const q = (p: string) => `'${p.replaceAll("'", `'\\''`)}'`

/** 擋下時的訊息：列出每條未收割 run 與收割指令。 */
export function formatUnharvestedBridgeRuns(
  wtPath: string,
  runs: readonly UnharvestedBridgeRun[],
): string {
  const lines = [
    `Review Bridge results in ${wtPath} are not harvested yet (${runs.length}); removing the worktree would delete them (M9).`,
  ]
  for (const r of runs) {
    if (r.runId && r.expected) {
      const tmp = `${r.expected}.partial`
      const root = r.shared ? dirname(dirname(dirname(r.expected))) : dirname(dirname(r.expected))
      lines.push(
        r.shared
          ? `  - ${r.workPackage}: files without run_id (shared by its runs) → ${r.state === 'incomplete' ? 'harvest is incomplete (files missing or size differs)' : 'not found'} under ${root}/<machine>/<run_id>/`
          : `  - ${r.workPackage} run ${r.runId} → ${r.state === 'incomplete' ? 'harvest is incomplete (files missing or size differs)' : 'not found'} under ${root}/<machine>/`,
      )
      // 先複製到暫存夾再 rename 進位：中斷時留下的是 .partial，不會被當成已收割。
      lines.push(
        `      harvest: mkdir -p ${q(dirname(r.expected))} && rm -rf ${q(tmp)} && cp -a ${q(r.resultsDir)} ${q(tmp)} && mv -T ${q(tmp)} ${q(r.expected)}`,
      )
      if (r.state === 'incomplete')
        lines.push(
          `      (an incomplete ${r.expected} must be moved aside first; mv -T refuses a non-empty target)`,
        )
    } else {
      lines.push(
        r.state === 'unreadable'
          ? `  - ${r.workPackage}: ${r.resultsDir} is unreadable; fix its permissions, then retry`
          : `  - ${r.workPackage}: no readable run_id in ${r.resultsDir} (run still going, aborted, or unknown format).`,
      )
      lines.push(
        `      no harvest location can clear this: once it is no longer needed (or copied elsewhere), move ${q(r.resultsDir)} out of the worktree, then retry`,
      )
    }
  }
  lines.push(
    '  HQ 收割器（bridge-w7b）寫到同一路徑 ~/handoff/bridge-results/<machine>/<run_id>/；收割完再重跑清理。',
  )
  return lines.join('\n')
}

/**
 * init 輸出寫進 tracked 的 plan 目錄，但它是本機、本樹專屬（project_id 每樹一個），不該進共享歷史；
 * 留成 untracked 又會讓整棵樹 dirty，cleanup／reclaim 都會拒刪。寫進 git common dir 的 info/exclude，
 * 各 worktree 共用、不動任何 tracked 檔，consumer 也適用。
 */
export function excludeFromGit(wtPath: string, filePath: string): void {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: wtPath,
    encoding: 'utf8',
  })
  if (r.status !== 0) return
  const exclude = join(String(r.stdout).trim(), 'info', 'exclude')
  const pattern = `/${relative(wtPath, filePath).split(sep).join('/')}`
  const existing = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
  if (existing.split('\n').includes(pattern)) return
  mkdirSync(dirname(exclude), { recursive: true })
  appendFileSync(exclude, `${existing && !existing.endsWith('\n') ? '\n' : ''}${pattern}\n`)
}
