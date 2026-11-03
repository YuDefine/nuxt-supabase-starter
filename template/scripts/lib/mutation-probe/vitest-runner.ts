// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/mutation-probe/vitest-runner.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/mutation-probe/vitest-runner.ts
// CLADE:VENDOR-SCRIPT
//
// mutation-probe/vitest-runner — vitest 執行器
//
// 契約：specs/truth/contracts/mutation-probe-cli.md § 突變的套用機制（vitest）。
// 每一趟（基線或一個突變）= 一個新的子行程（detached，逾時或被中斷時整組 SIGTERM、5 秒後 SIGKILL），
// 子行程就是本檔自己（`node vitest-runner.ts --vitest-child <spec.json>`）：從被測 repo 自己的
// node_modules 載入 vitest，以 programmatic `startVitest('test', files, { watch:false, run:true, … },
// { plugins:[<transform plugin>] })` 執行。plugin `enforce:'pre'`，對 `id` 的 realpath 等於目標檔的
// 模組，在 TS 型別剝除之前把第 `occurrence` 個 `from` 換成 `to`（替換語意與 node-test 共用
// `mutation-core.mjs`，單一來源）。
//
// 非 JS 目標（測試用 `readFileSync` 讀進來的 yml／sql／sh）不經過 transform（D36）：子行程在 `startVitest`
// 之前把 `load-hook.mjs` 放進自己的 `process.env.NODE_OPTIONS`（連同 `MUTATION_PROBE_FS_ONLY=1`），之後才
// spawn／建立的 worker（forks 的 child process、threads 的 worker thread）繼承它，只包 `fs.readFileSync`／
// `fs.promises.readFile`；vite server 與子行程本身不載入，否則 vite 讀目標檔時會先被替換一次、transform 再
// 替換一次。worker 裡安裝完成會在回報檔記 `armed`：突變趟沒有 `loaded` 也沒有任何 `armed`＝攔截沒進到
// worker（例如不吃 NODE_OPTIONS 的 pool），結果不可信，探針回 exit 2，**NEVER** 當成 survived。
//
// 為什麼每趟自成行程：契約要求每個突變（含基線）各一個新行程，模組層常數才會在載入時重新求值。
// `startVitest` 在探針行程內重複呼叫雖然也會重建 vite server，但同一個 Node 行程內的 import 快取
// （vitest 自己的模組、user config 載入）會跨趟殘留；一趟一行程把這個變數整個拿掉。
//
// 回報走檔案（不走 stdout：vitest reporter 與使用者測試的輸出混在 stdout）：
//   report-N.txt  plugin 每次 transform 目標檔追加 `loaded`，替換成功再追加 `hit`（與 node-test 同格式）
//   result-N.json 子行程收尾時寫：{ ok, passed, failed, files, failing[], unhandled }
// 兩個檔都在探針的 workDir（repo 之外）；vite 的 cacheDir 也指到 workDir，vitest 不在被測 repo 內寫檔。
//
// 由 ~/clade vendor/scripts/lib/ 散播，請勿直接編輯 consumer 副本。

import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { applyMutation } from './mutation-core.mjs'
import type { MutationInput } from './mutation.ts'
import { ProbeToolError } from './receipt.ts'
import type { FailingTest, ReceiptBaseline, RunOutcome } from './receipt.ts'
import type { Runner, RunnerFactory, RunnerOptions } from './runner.ts'
import { spawnTrial } from './spawn-trial.ts'

const CHILD_FLAG = '--vitest-child'
const HOOK_URL = new URL('./load-hook.mjs', import.meta.url).href

/** 子行程的輸入（寫成 JSON 檔，路徑走 argv）。 */
interface ChildSpec {
  root: string
  /** 絕對路徑；vitest 的 file filter 是路徑子字串比對，絕對路徑才不會誤中別處同名檔。 */
  files: string[]
  config?: string
  vitestEntry: string
  cacheDir: string
  reportPath: string
  resultPath: string
  mutation: {
    target: string
    from: string
    to: string
    occurrence: number
  } | null
}

/** 子行程收尾寫的結果。 */
interface ChildResult {
  ok: boolean
  error?: string
  /** 收集到的測試檔數；0＝vitest 沒找到任何測試檔。 */
  files: number
  /** 收集到的 test case 數（不含 skipped／todo）。 */
  tests: number
  passed: number
  failed: number
  failing: FailingTest[]
  /** 真的執行且 pass 的 test case 完整名稱（不含 skipped／todo）。 */
  passedNames: string[]
  unhandled: number
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

/** 子行程 spec 的邊界解析：形狀不對就丟（子行程非零退出，探針端讀不到結果）。 */
export function parseChildSpec(raw: unknown): ChildSpec {
  if (!isRecord(raw)) throw new Error('子行程 spec 不是 JSON 物件')
  const { root, files, config, vitestEntry, cacheDir, reportPath, resultPath, mutation } = raw
  if (
    typeof root !== 'string' ||
    !isStringArray(files) ||
    typeof vitestEntry !== 'string' ||
    typeof cacheDir !== 'string' ||
    typeof reportPath !== 'string' ||
    typeof resultPath !== 'string'
  ) {
    throw new Error('子行程 spec 欄位形狀不對')
  }
  let parsedConfig: string | undefined
  if (config !== undefined) {
    if (typeof config !== 'string') throw new Error('子行程 spec 的 config 欄位形狀不對')
    parsedConfig = config
  }
  let parsedMutation: ChildSpec['mutation'] = null
  if (mutation !== null && mutation !== undefined) {
    if (
      !isRecord(mutation) ||
      typeof mutation.target !== 'string' ||
      typeof mutation.from !== 'string' ||
      typeof mutation.to !== 'string' ||
      typeof mutation.occurrence !== 'number'
    ) {
      throw new Error('子行程 spec 的 mutation 欄位形狀不對')
    }
    parsedMutation = {
      target: mutation.target,
      from: mutation.from,
      to: mutation.to,
      occurrence: mutation.occurrence,
    }
  }
  return {
    root,
    files,
    config: parsedConfig,
    vitestEntry,
    cacheDir,
    reportPath,
    resultPath,
    mutation: parsedMutation,
  }
}

/** 子行程結果的邊界解析：讀不懂回 null（呼叫端當「子行程沒寫出結果」處理）。 */
export function parseChildResult(raw: unknown): ChildResult | null {
  if (!isRecord(raw)) return null
  const { ok, error, files, tests, passed, failed, failing, passedNames, unhandled } = raw
  if (
    typeof ok !== 'boolean' ||
    typeof files !== 'number' ||
    typeof tests !== 'number' ||
    typeof passed !== 'number' ||
    typeof failed !== 'number' ||
    typeof unhandled !== 'number' ||
    !isStringArray(passedNames) ||
    !Array.isArray(failing)
  ) {
    return null
  }
  let parsedError: string | undefined
  if (error !== undefined) {
    if (typeof error !== 'string') return null
    parsedError = error
  }
  const parsedFailing: FailingTest[] = []
  for (const f of failing) {
    if (!isRecord(f) || typeof f.file !== 'string' || typeof f.name !== 'string') return null
    parsedFailing.push({ file: f.file, name: f.name })
  }
  return {
    ok,
    error: parsedError,
    files,
    tests,
    passed,
    failed,
    failing: parsedFailing,
    passedNames,
    unhandled,
  }
}

// ───────────────────────── 探針端 ─────────────────────────

/** 從被測 repo 自己的依賴樹解析 vitest；找不到丟 ProbeToolError（exit 2）。 */
export function resolveVitestEntry(root: string): string {
  const req = createRequire(join(root, 'package.json'))
  try {
    return req.resolve('vitest/node')
  } catch {
    throw new ProbeToolError(
      `在 ${root} 解析不到 vitest（從該 repo 自己的 node_modules 找）：先安裝依賴再跑探針`,
    )
  }
}

function readReport(path: string): {
  loaded: boolean
  hits: number
  armed: number
} {
  if (!existsSync(path)) return { loaded: false, hits: 0, armed: 0 }
  const lines = readFileSync(path, 'utf8').split('\n')
  return {
    loaded: lines.includes('loaded'),
    hits: lines.filter((l) => l === 'hit').length,
    armed: lines.filter((l) => l === 'armed').length,
  }
}

function readResult(path: string): ChildResult | null {
  if (!existsSync(path)) return null
  try {
    return parseChildResult(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

export const createRunner: RunnerFactory = (opts: RunnerOptions): Runner => {
  const vitestEntry = resolveVitestEntry(opts.root)
  const config =
    opts.config === undefined
      ? undefined
      : isAbsolute(opts.config)
        ? opts.config
        : resolve(opts.root, opts.config)
  if (config !== undefined && !existsSync(config)) {
    throw new ProbeToolError(`--config 指到的檔案不存在：${opts.config}`)
  }
  // 收據 `runner.command` 的 config：repo 內寫 repo 相對 POSIX（replay 以 repo root 解析）；repo 外保留絕對路徑。
  let commandConfig: string | undefined
  if (config !== undefined) {
    const rel = relative(realpathSync(opts.root), realpathSync(config)).split('\\').join('/')
    commandConfig = rel === '' || rel.startsWith('../') || rel === '..' ? config : rel
  }
  const files = opts.tests.map((t) => join(opts.root, t))
  const defaultFile = opts.tests[0] ?? ''
  let trialNo = 0

  const trial = async (m: MutationInput | null, timeoutMs: number) => {
    const n = ++trialNo
    const specPath = join(opts.workDir, `spec-${n}.json`)
    const reportPath = join(opts.workDir, `report-${n}.txt`)
    const resultPath = join(opts.workDir, `result-${n}.json`)
    let mutation: ChildSpec['mutation'] = null
    if (m) {
      const target = join(opts.root, m.file)
      mutation = {
        target: existsSync(target) ? realpathSync(target) : target,
        from: m.from,
        to: m.to,
        occurrence: m.occurrence,
      }
    }
    const spec: ChildSpec = {
      root: opts.root,
      files,
      config,
      vitestEntry,
      cacheDir: join(opts.workDir, 'vite-cache'),
      reportPath,
      resultPath,
      mutation,
    }
    writeFileSync(specPath, JSON.stringify(spec))
    const env: NodeJS.ProcessEnv = { ...process.env }
    // 探針本身跑在 node:test／vitest 行程內（測試、閘門 wrapper）時會繼承這些變數；子行程看到會
    // 誤判自己是遞迴呼叫或 vitest worker。
    delete env.NODE_TEST_CONTEXT
    for (const k of Object.keys(env)) if (k.startsWith('VITEST')) delete env[k]
    const r = await spawnTrial({
      cwd: opts.root,
      args: [fileURLToPath(import.meta.url), CHILD_FLAG, specPath],
      env,
      timeoutMs,
      trackGroup: opts.trackGroup,
    })
    return {
      ...r,
      result: readResult(resultPath),
      report: readReport(reportPath),
    }
  }

  const noStart = (r: { stdout: string; stderr: string; code: number | null }, why?: string) =>
    new ProbeToolError(
      `vitest 沒有跑起來（exit ${r.code}${why ? `，${why}` : ''}）：${(r.stderr || r.stdout).trim().slice(-600)}`,
    )

  /** 結果檔缺、`ok=false`、沒收集到任何測試檔／case → 工具層錯誤，不是紅燈。 */
  const requireStarted = (r: Awaited<ReturnType<typeof trial>>): ChildResult => {
    const res = r.result
    if (!res) throw noStart(r, '子行程沒有寫出結果')
    if (!res.ok) throw noStart(r, res.error ?? '子行程回報失敗')
    if (res.files === 0 || (res.tests === 0 && res.failed === 0)) {
      throw noStart(r, `沒有任何測試被收集（files=${res.files} tests=${res.tests}）`)
    }
    return res
  }

  return {
    kind: 'vitest',
    command: [
      'vitest',
      'run',
      ...(commandConfig === undefined ? [] : ['--config', commandConfig]),
      ...opts.tests,
    ],

    async baseline(timeoutMs: number): Promise<ReceiptBaseline> {
      const r = await trial(null, timeoutMs)
      if (r.timedOut) {
        return {
          status: 'timeout',
          passed: r.result?.passed ?? 0,
          failed: r.result?.failed ?? 0,
          ms: r.ms,
        }
      }
      const res = requireStarted(r)
      const green = res.failed === 0 && res.unhandled === 0
      return {
        status: green ? 'green' : 'red',
        passed: res.passed,
        failed: res.failed,
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
      const res = requireStarted(r)
      if (!r.report.loaded && r.report.armed === 0) {
        throw new ProbeToolError(
          `vitest worker 沒有裝上 fs 讀檔攔截（回報檔沒有 armed）：目標檔 ${m.file} 若是被 readFileSync 讀進來的非 JS 檔，這趟的 survived 不可信，不回報（pool／設定可能不繼承 NODE_OPTIONS）`,
        )
      }
      let failing = res.failing
      if (failing.length === 0 && (res.failed > 0 || res.unhandled > 0)) {
        // 沒有個別失敗的 case（未捕捉的例外、unhandled rejection）：仍是突變造成的紅燈。
        failing = [
          {
            file: defaultFile,
            name: `(vitest 無個別失敗 case，unhandled=${res.unhandled})`,
          },
        ]
      }
      return {
        timedOut: false,
        failing,
        loaded: r.report.loaded,
        hits: r.report.hits,
        ms: r.ms,
        passedNames: res.passedNames,
      }
    },
  }
}

// ───────────────────────── 子行程端 ─────────────────────────
// 只有 `node vitest-runner.ts --vitest-child <spec.json>` 才執行；被探針 import 時不動作。

interface VitestTask {
  type: string
  name: string
  mode?: string
  tasks?: VitestTask[]
  file?: { filepath: string }
  filepath?: string
  result?: { state?: string; errors?: { message?: string }[] }
}

interface PluginContainerLike {
  getSortedPlugins?: (hook: string) => unknown[]
}

interface ViteServerLike {
  environments?: Record<string, { pluginContainer?: PluginContainerLike }>
  config: { plugins: readonly { name: string }[] }
}

interface VitestCtx {
  state: {
    getFiles(): VitestTask[]
    getUnhandledErrors(): unknown[]
  }
  projects?: { name: string; vite: ViteServerLike }[]
  close(): Promise<void>
}

type StartVitest = (
  mode: string,
  filters: string[],
  options: Record<string, unknown>,
  viteOverrides?: Record<string, unknown>,
) => Promise<VitestCtx | undefined>

/** 把 vitest 的 file task 樹攤成計數與失敗清單。名稱 = 外層 describe 前綴以 ` > ` 串接（與 test-cases.ts 同口徑）。 */
export function collectResults(
  files: VitestTask[],
  relFile: (abs: string) => string,
): Pick<ChildResult, 'tests' | 'passed' | 'failed' | 'failing' | 'passedNames'> {
  let tests = 0
  let passed = 0
  let failed = 0
  const failing: FailingTest[] = []
  const passedNames: string[] = []

  /** 回傳這棵子樹是否含有失敗的 test case。 */
  const walk = (task: VitestTask, prefix: string[], file: string): boolean => {
    if (task.type === 'test') {
      const state = task.result?.state
      if (task.mode === 'skip' || task.mode === 'todo' || state === 'skip' || state === 'todo') {
        return false
      }
      tests++
      if (state === 'fail') {
        failed++
        failing.push({ file, name: [...prefix, task.name].join(' > ') })
        return true
      }
      if (state === 'pass') {
        passed++
        passedNames.push([...prefix, task.name].join(' > '))
      }
      return false
    }
    // suite（file 本身也是 suite；file 的 prefix 不含檔名）
    const isFile = task.filepath !== undefined
    const nextPrefix = isFile ? prefix : [...prefix, task.name]
    let anyFailing = false
    for (const child of task.tasks ?? []) {
      if (walk(child, nextPrefix, file)) anyFailing = true
    }
    if (!anyFailing && task.result?.state === 'fail') {
      // suite／file 層自己失敗（hook 拋錯、import 失敗）且沒有任何 case 被記為失敗。
      failed++
      const why = task.result.errors?.[0]?.message?.split('\n')[0] ?? '失敗'
      const label = isFile ? '(file)' : nextPrefix.join(' > ')
      failing.push({ file, name: `${label}：${why}` })
      anyFailing = true
    }
    return anyFailing
  }

  for (const f of files) {
    walk(f, [], relFile(f.filepath ?? f.file?.filepath ?? ''))
  }
  return { tests, passed, failed, failing, passedNames }
}

const PLUGIN_NAME = 'mutation-probe'

/**
 * 把 transform plugin 掛進一個已經建好的 vite dev server 的每個 environment：包住該 environment 的
 * plugin container 的 `getSortedPlugins('transform')`（Vite 6+ 的公開 container 方法），讓我們的 plugin 排在最前，
 * 與 `enforce:'pre'` 同樣先於型別剝除。掛不上就丟錯（探針回 exit 2），不留 survived 的假象。
 */
function injectIntoServer(server: ViteServerLike, plugin: object, projectName: string): void {
  const envs = Object.values(server.environments ?? {})
  let patched = 0
  for (const env of envs) {
    const container = env.pluginContainer
    const orig = container?.getSortedPlugins
    if (!container || typeof orig !== 'function') continue
    container.getSortedPlugins = (hook: string) => {
      const rest = orig.call(container, hook)
      return hook === 'transform' ? [plugin, ...rest] : rest
    }
    patched++
  }
  if (patched === 0) {
    throw new ProbeToolError(
      `沒辦法把突變 plugin 掛進 vitest project「${projectName || '(default)'}」的 vite server（這版 vite 沒有 environment plugin container）`,
    )
  }
}

async function childMain(specPath: string): Promise<void> {
  const spec = parseChildSpec(JSON.parse(readFileSync(specPath, 'utf8')))
  const writeResult = (r: ChildResult) => writeFileSync(spec.resultPath, JSON.stringify(r))
  const fail = (error: string): ChildResult => ({
    ok: false,
    error,
    files: 0,
    tests: 0,
    passed: 0,
    failed: 0,
    failing: [],
    passedNames: [],
    unhandled: 0,
  })

  let ctx: VitestCtx | undefined
  try {
    const { startVitest } = (await import(pathToFileURL(spec.vitestEntry).href)) as {
      startVitest: StartVitest
    }
    const m = spec.mutation
    if (m) {
      // 之後才建立的 worker 繼承這幾個變數（見檔頭）；本行程不載入 load-hook。
      process.env.MUTATION_PROBE_SPEC = JSON.stringify(m)
      process.env.MUTATION_PROBE_REPORT = spec.reportPath
      process.env.MUTATION_PROBE_FS_ONLY = '1'
      process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--import=${HOOK_URL}`]
        .filter(Boolean)
        .join(' ')
    }
    const note = (line: string) => {
      try {
        appendFileSync(spec.reportPath, `${line}\n`)
      } catch {
        // 回報檔寫不進去時探針端會看到 loaded=false；不能讓測試行程因此死掉。
      }
    }
    const targetOf = (id: string): string | null => {
      // vite id 可能帶 query／`\0` 前綴／`/@fs/`；只處理檔案模組。
      let p = id.replace(/[?#].*$/, '')
      if (p.startsWith('\0')) return null
      if (p.startsWith('file://')) p = fileURLToPath(p)
      try {
        return realpathSync(p)
      } catch {
        return p
      }
    }
    const plugin = m
      ? {
          name: PLUGIN_NAME,
          enforce: 'pre' as const,
          transform(code: string, id: string) {
            if (targetOf(id) !== m.target) return null
            note('loaded')
            const { code: out, hits } = applyMutation(code, m)
            if (hits === 0) return null
            note('hit')
            // map: null：位置對應沒意義，也避免 vite 為替換後的字串重算 source map。
            return { code: out, map: null }
          },
        }
      : null
    const plugins = plugin ? [plugin] : []

    // `startVitest` 的第四個參數只進**根** vite server。設定了 `projects`（inline 或檔案）時，
    // 每個 project 各有自己的 vite server，不繼承根的 plugins，目標檔在那些 server 上不會經過
    // 我們的 transform（收據會是 survived／not-loaded 的假象）。reporter 的 `onInit` 在 projects 解析完、
    // 任何測試檔被轉換之前呼叫：在那裡把 plugin 補進沒有它的 project server。
    let injectError: string | null = null
    const injector = {
      onInit(vitest: VitestCtx) {
        if (!plugin) return
        try {
          for (const project of vitest.projects ?? []) {
            if (project.vite.config.plugins.some((p) => p.name === PLUGIN_NAME)) continue
            injectIntoServer(project.vite, plugin, project.name)
          }
        } catch (e) {
          injectError = (e as Error).message
        }
      },
    }

    ctx = await startVitest(
      'test',
      spec.files,
      {
        watch: false,
        run: true,
        root: spec.root,
        ...(spec.config === undefined ? {} : { config: spec.config }),
        // 只要結果物件，不要 reporter 輸出；coverage 即使 config 打開也關（探針只看過／不過）。
        reporters: [injector],
        coverage: { enabled: false },
        // vitest 5 的 fsModuleCache 把 transform 結果存在 node_modules/.vitest-cache、下一趟直接讀：
        // 突變 plugin 不會被呼叫（hits=0），還會拿到上一趟的突變碼。每趟都要重新 transform。
        fsModuleCache: false,
        passWithNoTests: false,
      },
      { plugins, cacheDir: spec.cacheDir },
    )
    if (!ctx) {
      writeResult(fail('startVitest 沒有回傳 context（設定錯誤或沒有可跑的專案）'))
      return
    }
    if (injectError !== null) {
      writeResult(fail(injectError))
      return
    }
    const roots = [...new Set([spec.root, realpathSync(spec.root)])]
    const relFile = (abs: string) => {
      for (const r of roots) {
        const rel = relative(r, abs)
        if (rel !== '' && !rel.startsWith('..')) return rel.split('\\').join('/')
      }
      return abs
    }
    const files = ctx.state.getFiles()
    const c = collectResults(files, relFile)
    writeResult({
      ok: true,
      files: files.length,
      ...c,
      unhandled: ctx.state.getUnhandledErrors().length,
    })
  } catch (e) {
    writeResult(fail((e as Error).stack ?? String(e)))
  } finally {
    try {
      await ctx?.close()
    } catch {
      // 收尾失敗不影響已寫出的結果。
    }
  }
}

function isChildEntry(): boolean {
  const entry = process.argv[1]
  if (process.argv[2] !== CHILD_FLAG || !entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isChildEntry()) {
  await childMain(process.argv[3])
  // vitest 的 worker 由 ctx.close() 收；這裡硬結束，避免 user config 留下的 handle 讓行程不退。
  process.exit(0)
}
