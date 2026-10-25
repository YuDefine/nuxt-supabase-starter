// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/herdr-machine.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/herdr-machine.ts
// Cross-machine Herdr plumbing shared by the dispatch helper, the completion consumer and patrol.
//
// Two peers (e.g. `desk` and `zenbook`) are both full nodes: each has `~/offline/clade` at the same
// path, its own helper and its own dispatch state. Whoever dispatches is the HOME of that dispatch:
// the record lives only there and only the home helper writes it. Code travels through GitHub;
// control travels through `herdr --machine <peer>`; completion travels back over ssh to the home
// helper. See vendor/snippets/herdr-session-handoff/README.md § Cross-machine dispatch.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { availableParallelism, homedir, loadavg } from 'node:os'
import { resolve } from 'node:path'
import { isRecord, parseJson } from './json-unknown.ts'
import {
  cpuBusyBetween,
  cpuUsePerCore,
  MEM_PRESSURE_AVG60,
  parseCpuPsi,
  parseCpuStatLine,
  SATURATED_LOAD_PER_CORE,
} from './machine-cpu.ts'

/**
 * Where a Herdr command runs. The bare binary means this machine (and keeps the
 * `--session default` pin); `{ bin, machine }` names a saved peer. Herdr refuses `--machine`
 * together with `--session`, so the two shapes are mutually exclusive by construction.
 *
 * Chosen per call, NEVER through a global switch: one `--complete` reads the child on the peer and
 * wakes the parent at home in the same process.
 */
export type HerdrTarget = string | { readonly bin: string; readonly machine: string }

export function herdrBinOf(target: HerdrTarget): string {
  return typeof target === 'string' ? target : target.bin
}

export function herdrMachineOf(target: HerdrTarget): string | undefined {
  return typeof target === 'string' ? undefined : target.machine
}

/** `machine` absent (a local record) keeps the plain binary; a peer label wraps it. */
export function herdrOn(target: HerdrTarget, machine: string | undefined): HerdrTarget {
  const bin = herdrBinOf(target)
  return machine ? { bin, machine } : bin
}

/** Leading argv for one Herdr invocation. */
export function herdrLeadingArgs(machine: string | undefined): string[] {
  return machine ? ['--machine', machine] : ['--session', 'default']
}

function readConfigLine(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const base = env.XDG_CONFIG_HOME?.trim() || resolve(env.HOME?.trim() || homedir(), '.config')
  const path = resolve(base, 'clade', name)
  if (!existsSync(path)) return undefined
  try {
    return readFileSync(path, 'utf8').trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * This machine's label as the PEER's `herdr machine list` knows it (`desk` on desk, `zenbook` on
 * zenbook). It doubles as the ssh target the peer uses to reach home, so a child can relay its
 * completion back. `CLADE_HERDR_MACHINE` wins; `~/.config/clade/herdr-machine` is the durable
 * setting the bootstrap writes. NEVER default it to the hostname: desk's hostname is not `desk`.
 */
export function localMachineLabel(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.CLADE_HERDR_MACHINE?.trim() || readConfigLine('herdr-machine', env)
}

/**
 * `CLADE_HERDR_PEERS`（或 `~/.config/clade/herdr-peers`）列的機器，原樣、不濾本機。空陣列＝沒設清單。
 * 這份清單有兩個用途，改它就是同時改兩處：① `--machine auto` 的候選 peer（`peerMachineLabels`）；
 * ② auto-dispatch 的 ssh 白名單（`peerSshRefusal`）：有設清單而這台不在其中，所有 auto-dispatch 探測
 * （樹狀態、peer brief、最後 push 時間、路徑存在與否）一律判不可達、不發 ssh。
 * 所以「故意不列、不要新放件，但它上面還有樹或 PR」的 peer 會讓那些證據讀成不可達／判不出——要它繼續被
 * 讀就留在清單裡。清單只剩本機（`CLADE_HERDR_PEERS=<self>`，清空 peer 的 drain 用法）也算有設。
 */
export function configuredPeerLabels(env: NodeJS.ProcessEnv = process.env): string[] {
  // 有設（含空字串）就以它為準：`CLADE_HERDR_PEERS=` 是「沒有 peer」，NEVER 落回 config 檔
  //（測試與隔離環境靠它關掉跨機 ssh）。
  const raw =
    env.CLADE_HERDR_PEERS !== undefined
      ? env.CLADE_HERDR_PEERS.trim()
      : readConfigLine('herdr-peers', env) || ''
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  ]
}

/**
 * Peers eligible for `--machine auto`: `configuredPeerLabels` minus this machine. 這是用途 ① 而已——
 * 同一份清單另有用途 ②（auto-dispatch 的 ssh 白名單），見 `configuredPeerLabels`。
 */
export function peerMachineLabels(env: NodeJS.ProcessEnv = process.env): string[] {
  const self = localMachineLabel(env)
  return configuredPeerLabels(env).filter((label) => label !== self)
}

export const MACHINE_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/

export function sshBin(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLADE_SSH_BIN?.trim() || 'ssh'
}

/** Non-interactive, never prompts: a hung password prompt would hang the whole dispatch. */
export const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']

/** POSIX single-quote, for the one command string ssh hands to the remote shell. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * Non-interactive ssh on the peers measured 2026-09-23 does not put `~/.local/bin` on PATH, which
 * is where Herdr installs. Every remote command gets it prepended so the far side finds `herdr`
 * (and a mise/local node) without depending on shell rc files.
 */
export const REMOTE_PATH_PREFIX = 'PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"'

export type SshResult = { status: number; stdout: string; stderr: string; spawnError?: string }

/**
 * ssh 的失敗文字是不是「那台機器實體連不上」：connect timeout、無路由、網路不通、主機 down（tailscale offline
 * 典型是 connect timeout）。Connection refused（sshd 沒開）、Permission denied、Host key verification、
 * Could not resolve hostname 是機器可達但設定／服務壞了，主持者修得了，NEVER 算不可達。
 */
export function isSshUnreachableText(text: string): boolean {
  return /Connection timed out|Operation timed out|No route to host|Network is unreachable|Host is down|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/iu.test(
    text,
  )
}

/**
 * 不可達記憶的有效期。watch 是長壽行程（預設 29 分鐘、`--max-minutes 0` 不設限），每一輪都會對 peer
 * 發 ssh；永久記住會讓一次逾時黏到 watch 重啟、peer 開機後證據仍讀成不可達。有效期內同一輪的十幾次探測
 * 只撞一次逾時（CDB-461），過期後下一次探測自然重試。
 */
export const UNREACHABLE_TTL_MS = 2 * 60_000

/** 本行程已判實體不可達的機器 → 當時的 ssh 錯誤行與記下的時刻（TTL 內有效）。 */
const unreachableMachines = new Map<string, { line: string; at: number }>()

/**
 * 「連線階段沒印半個字就逾時」的次數：遠端指令跑慢（`git status`、整段做完才印的探測）在慢但可達的 peer
 * 上與連線卡住長一樣，單次不足以判不可達，同一 TTL 內連續第二次才算。任何一次正常結束就清掉。
 */
const SILENT_TIMEOUTS_TO_DOWN = 2
const silentTimeouts = new Map<string, { count: number; at: number }>()

/** 這台在本行程內（TTL 內）已判不可達時回當時的錯誤行（呼叫端據以不發 ssh），否則 undefined。 */
export function knownUnreachableMachine(
  machine: string,
  now: number = Date.now(),
): string | undefined {
  const known = unreachableMachines.get(machine)
  if (!known) return undefined
  if (now - known.at >= UNREACHABLE_TTL_MS) {
    unreachableMachines.delete(machine)
    return undefined
  }
  return known.line
}

/** ssh 結果是實體不可達 → 記下這台（TTL 內 sshRun 不再發 ssh）；回傳是否記下。 */
export function noteSshOutcome(
  machine: string,
  result: { status: number | null; stdout: string; stderr: string; spawnError?: string },
  now: number = Date.now(),
): boolean {
  // ssh 自己的錯誤以 255 結束；遠端指令（如 peer 上 git fetch 連不到 GitHub）印同樣字樣但 exit 碼不同，不算
  const sshDown = result.status === 255 && isSshUnreachableText(result.stderr)
  // spawn 逾時而且 ssh 一個字都沒印：ConnectTimeout 沒生效的連線卡住，或慢但可達的遠端指令（兩者看不出差別）
  const silentTimeout =
    (result.status === null || /ETIMEDOUT/u.test(result.spawnError ?? '')) &&
    /ETIMEDOUT/u.test(`${result.spawnError ?? ''}${result.stderr}`) &&
    !result.stdout
  if (!sshDown && !silentTimeout) {
    silentTimeouts.delete(machine)
    return false
  }
  if (!sshDown) {
    const prior = silentTimeouts.get(machine)
    const count = prior && now - prior.at < UNREACHABLE_TTL_MS ? prior.count + 1 : 1
    silentTimeouts.set(machine, { count, at: now })
    if (count < SILENT_TIMEOUTS_TO_DOWN) return false
  }
  silentTimeouts.delete(machine)
  const line = (
    result.stderr.trim().split('\n').at(-1) ||
    result.spawnError ||
    'ssh timeout'
  ).trim()
  unreachableMachines.set(machine, { line: line.slice(0, 200), at: now })
  return true
}

/** 測試用：清掉本行程的不可達記憶。 */
export function forgetUnreachableMachines(): void {
  unreachableMachines.clear()
  silentTimeouts.clear()
}

/** 不發 ssh 時回給呼叫端的結果：stderr 帶原錯誤行，`isSshUnreachableText` 照樣判得出不可達。 */
export function skippedSshResult(machine: string, why: string): SshResult {
  return {
    status: 255,
    stdout: '',
    stderr: `ssh: ${machine}: ${why}（clade：本行程判 Host is down，未發 ssh）\n`,
  }
}

/**
 * auto-dispatch 選 ssh 目標的守門：本行程（TTL 內）已判不可達、或有設 peer 清單（CLADE_HERDR_PEERS／
 * `~/.config/clade/herdr-peers`）而這台不在其中 → 回不可達理由（呼叫端 NEVER 發 ssh）；可以發回 null。
 * 「有設清單」看原樣的清單、不濾本機：`CLADE_HERDR_PEERS=<self>`（清空 peer 的 drain 用法）也算有設，
 * 其餘機器全數判不可達。沒設清單時判不出拓撲，只看不可達記憶。本機 label 一律放行（呼叫端本來就不會 ssh 自己）。
 */
export function peerSshRefusal(
  machine: string,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): string | null {
  const down = knownUnreachableMachine(machine, now)
  if (down) return `${machine} 本行程已判不可達（${down}），不再重試 ssh`
  if (machine === localMachineLabel(env)) return null
  const listed = configuredPeerLabels(env)
  if (listed.length && !listed.includes(machine))
    return `${machine} 不在 CLADE_HERDR_PEERS（${listed.join(',')}），判不可達、不發 ssh`
  return null
}

export function sshRun(
  machine: string,
  remoteCommand: string,
  options: { input?: string; timeout?: number; env?: NodeJS.ProcessEnv; now?: number } = {},
): SshResult {
  const env = options.env ?? process.env
  const down = knownUnreachableMachine(machine, options.now)
  if (down) return skippedSshResult(machine, down)
  const result = spawnSync(
    sshBin(env),
    [...SSH_OPTIONS, machine, `${REMOTE_PATH_PREFIX}; ${remoteCommand}`],
    {
      encoding: 'utf8',
      input: options.input ?? '',
      timeout: options.timeout ?? 30_000,
      maxBuffer: 8 * 1024 * 1024,
      env,
    },
  )
  const out: SshResult = {
    status: result.status ?? 255,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { spawnError: result.error.message } : {}),
  }
  noteSshOutcome(machine, out, options.now)
  return out
}

export type MachineLoad = {
  machine: string
  local: boolean
  load1?: number
  cores?: number
  /** Present = measured and still a candidate; the cwd / consumer gates drop it to disqualify. */
  per_core?: number
  /** CPU busy % over the probe's own ≥2 s `/proc/stat` window (steal counts as busy). Absent = ranks by `per_core`. */
  cpu_busy_pct?: number
  /** Memory PSI `some avg60` (time spent waiting on reclaim / swap). */
  mem_some_avg60?: number
  error?: string
}

const PROBE_MARK = '@@clade-load@@'
/**
 * One probe, local (`sh -c`) or on a peer (ssh): cores, load1, memory PSI, and — when `sample` — `/proc/stat` before
 * and after a 2 s sleep. Load1 counts queued work, so a `pnpm install` burst can read 1.2 per core on a machine that
 * is a quarter busy; placement ranks by what the CPU actually did instead. A caller that only reads
 * `per_core` (fanout's saturation guard) skips the sample and the sleep.
 */
export function loadProbeScript(sample: boolean = true): string {
  return [
    sample ? 'head -1 /proc/stat' : 'true',
    `echo ${PROBE_MARK}`,
    'nproc; cut -d" " -f1 /proc/loadavg',
    `echo ${PROBE_MARK}`,
    'cat /proc/pressure/memory 2>/dev/null',
    `echo ${PROBE_MARK}`,
    sample ? 'sleep 2; head -1 /proc/stat' : 'true',
  ].join('; ')
}

/** `loadProbeScript` output → a candidate; unparsable cores / load1 → `error`. */
export function parseLoadProbe(machine: string, local: boolean, stdout: string): MachineLoad {
  const [head = '', load = '', memPsi = '', tail = ''] = stdout.split(PROBE_MARK)
  const [cores, load1] = load.trim().split(/\s+/u).map(Number)
  if (!Number.isFinite(cores) || !Number.isFinite(load1) || !(cores! > 0))
    return { machine, local, error: `unparsable load probe output: ${JSON.stringify(load.trim())}` }
  const out: MachineLoad = { machine, local, load1, cores, per_core: load1! / cores! }
  const a = parseCpuStatLine(head)
  const b = parseCpuStatLine(tail)
  const busy = a && b ? cpuBusyBetween(a, b) : null
  if (busy !== null) out.cpu_busy_pct = busy
  const memSome = parseCpuPsi(memPsi, 'avg60')
  if (memSome !== null) out.mem_some_avg60 = memSome
  return out
}

/**
 * Why a candidate is over a pressure line (`SATURATED_LOAD_PER_CORE` ranking-only / `MEM_PRESSURE_AVG60` memory hard
 * limit); empty = under both. Ranks it behind every candidate under both.
 */
export function pressureReasons(load: MachineLoad): string[] {
  const why: string[] = []
  if ((load.per_core ?? 0) >= SATURATED_LOAD_PER_CORE)
    why.push(`load1/core ${load.per_core!.toFixed(1)}`)
  if ((load.mem_some_avg60 ?? 0) >= MEM_PRESSURE_AVG60)
    why.push(`memory PSI some avg60 ${load.mem_some_avg60!.toFixed(0)}`)
  return why
}

export function localLoad(
  label: string,
  options: {
    sample?: boolean
    run?: (script: string) => { status: number | null; stdout: string }
  } = {},
): MachineLoad {
  const run =
    options.run ??
    ((script: string) => spawnSync('sh', ['-c', script], { encoding: 'utf8', timeout: 15_000 }))
  const probe = run(loadProbeScript(options.sample))
  const parsed = probe.status === 0 ? parseLoadProbe(label, true, probe.stdout) : undefined
  if (parsed && !parsed.error) return parsed
  // No /proc (or no sh): fall back to Node's own load1, ranked per core as before.
  const cores = availableParallelism()
  const load1 = loadavg()[0]!
  return { machine: label, local: true, load1, cores, per_core: load1 / cores }
}

export function peerLoad(
  machine: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { sample?: boolean } = {},
): MachineLoad {
  const probe = sshRun(machine, loadProbeScript(options.sample), { timeout: 20_000, env })
  if (probe.status !== 0)
    return {
      machine,
      local: false,
      error: probe.spawnError ?? (probe.stderr.trim() || `ssh exit ${probe.status}`),
    }
  return parseLoadProbe(machine, false, probe.stdout)
}

/**
 * `--machine auto`: candidates under both pressure lines first, then those over a ranking-only line, then those
 * at memory thrash; within a tier the lowest CPU use (`cpuUsePerCore`, the watch's fill measure), then this
 * machine. An unreachable peer is skipped rather than failing the dispatch.
 * `overloaded` (the caller refuses an explicit `--machine auto`) is only memory thrash (`MEM_PRESSURE_AVG60`, a hard
 * limit: one more pane on a swapping machine can take it down). Load1 per core, however high, only ranks — CPU
 * busyness never stops a dispatch.
 */
export function chooseLeastLoaded(candidates: MachineLoad[]): {
  chosen: MachineLoad | undefined
  overloaded: boolean
} {
  const measured = candidates.filter(
    (candidate): candidate is MachineLoad & { per_core: number } =>
      typeof candidate.per_core === 'number',
  )
  const refused = (load: MachineLoad & { per_core: number }) =>
    (load.mem_some_avg60 ?? 0) >= MEM_PRESSURE_AVG60
  // 0 = under both pressure lines, 1 = over a ranking-only line, 2 = over the memory hard limit
  const tier = (load: MachineLoad & { per_core: number }) =>
    refused(load) ? 2 : pressureReasons(load).length > 0 ? 1 : 0
  const chosen = measured.toSorted(
    (a, b) =>
      tier(a) - tier(b) ||
      cpuUsePerCore(a)! - cpuUsePerCore(b)! ||
      Number(b.local) - Number(a.local),
  )[0]
  return { chosen, overloaded: chosen ? refused(chosen) : false }
}

/**
 * 本機這棵樹能不能改到 peer 開：乾淨且沒有未推 commit 才算可搬（coordinator `派工判準.md` Rule 2「可搬條件」）。
 * fanout 的機器守門與 helper 的預設 auto（`herdr-session-handoff.ts` `withoutDivergentTree`）共用。
 */
export type TreeState =
  | { movable: false; why: string }
  | {
      movable: true
      branch: string | null
      /** origin 上有同名 branch（peer 可 `--checkout`）；沒有就是還沒推過的新樹。 */
      onOrigin: boolean
      /** 這個 repo 的主 checkout 路徑：peer 沒有它就開不了樹。 */
      mainCheckout: string
    }

function gitIn(cwd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 20_000 })
  return { ok: r.status === 0, out: (r.stdout ?? '').trim() }
}

export function localTreeState(cwd: string): TreeState {
  const common = gitIn(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (!common.ok) return { movable: false, why: '不是 git 樹' }
  const dirty = gitIn(cwd, ['status', '--porcelain', '-z'])
  if (!dirty.ok) return { movable: false, why: 'git status 讀不到' }
  if (dirty.out) return { movable: false, why: '有未 commit 的改動' }
  const unpushed = gitIn(cwd, ['rev-list', '--max-count=1', 'HEAD', '--not', '--remotes'])
  if (!unpushed.ok) return { movable: false, why: '讀不到未推 commit' }
  if (unpushed.out) return { movable: false, why: '有未推的 commit' }
  const branch = gitIn(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const name = branch.ok && branch.out ? branch.out : null
  return {
    movable: true,
    branch: name,
    onOrigin:
      name !== null &&
      gitIn(cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`]).ok,
    mainCheckout: common.out.replace(/\/\.git$/u, ''),
  }
}

export function treeHeadOn(
  machine: string,
  cwd: string,
  local: boolean,
  env: NodeJS.ProcessEnv,
): string | null {
  if (local) {
    const head = gitIn(cwd, ['rev-parse', 'HEAD'])
    return head.ok && head.out ? head.out : null
  }
  const probe = sshRun(machine, `git -C ${shellQuote(cwd)} rev-parse HEAD`, {
    timeout: 15_000,
    env,
  })
  const sha = probe.stdout.trim()
  return !probe.spawnError && probe.status === 0 && /^[0-9a-f]{40,64}$/u.test(sha) ? sha : null
}

/** Patrol's `--machine` summary and anything else that needs a peer's pane + agent lists. */
export function readMachinePanesAndAgents(
  herdrBin: string,
  machine: string,
  timeout = 15_000,
): { panes: unknown[]; agents: unknown[] } | { error: 'pane list failed' | 'agent list failed' } {
  const list = (what: 'pane' | 'agent'): unknown[] | null => {
    const result = spawnSync(herdrBin, [...herdrLeadingArgs(machine), what, 'list'], {
      encoding: 'utf8',
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    })
    if ((result.status ?? 1) !== 0) return null
    try {
      // Not an object at all is not a Herdr envelope — as unusable as unparseable output. A missing
      // `result.<what>s` stays an empty list, as it always was.
      const parsed = parseJson((result.stdout ?? '').trim())
      if (!isRecord(parsed)) return null
      // Herdr reports some failures (e.g. `protocol_mismatch`) as an `error` envelope with exit 0.
      // Reading that as an empty list is "no other sessions" — the one wrong answer that looks
      // right (TD-1026). NEVER trust the exit code alone.
      if (parsed.error !== undefined) return null
      const body = parsed.result
      const items = isRecord(body) ? body[`${what}s`] : undefined
      return Array.isArray(items) ? items : []
    } catch {
      return null
    }
  }
  const panes = list('pane')
  if (!panes) return { error: 'pane list failed' }
  const agents = list('agent')
  if (!agents) return { error: 'agent list failed' }
  return { panes, agents }
}
