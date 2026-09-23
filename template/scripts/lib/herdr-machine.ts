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

/** Peers eligible for `--machine auto`. Comma/space separated; never includes this machine. */
export function peerMachineLabels(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.CLADE_HERDR_PEERS?.trim() || readConfigLine('herdr-peers', env) || ''
  const self = localMachineLabel(env)
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  ].filter((label) => label !== self)
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

export function sshRun(
  machine: string,
  remoteCommand: string,
  options: { input?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {},
): SshResult {
  const env = options.env ?? process.env
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
  return {
    status: result.status ?? 255,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { spawnError: result.error.message } : {}),
  }
}

/**
 * Per-core load threshold. The desk rule was "load1 > 45 opens no new pane" on 6 cores; the same
 * pressure per core is 7.5, which on zenbook's 8 cores is load1 60.
 */
export const LOAD_PER_CORE_LIMIT = 45 / 6

export type MachineLoad = {
  machine: string
  local: boolean
  load1?: number
  cores?: number
  per_core?: number
  error?: string
}

export function localLoad(label: string): MachineLoad {
  const cores = availableParallelism()
  const load1 = loadavg()[0]
  return { machine: label, local: true, load1, cores, per_core: load1 / cores }
}

export function peerLoad(machine: string, env: NodeJS.ProcessEnv = process.env): MachineLoad {
  const probe = sshRun(machine, 'cut -d" " -f1 /proc/loadavg; nproc', { timeout: 15_000, env })
  const [load, cores] = probe.stdout.trim().split(/\s+/).map(Number)
  if (probe.status !== 0 || !Number.isFinite(load) || !Number.isFinite(cores) || cores <= 0) {
    return {
      machine,
      local: false,
      error: probe.spawnError ?? (probe.stderr.trim() || `ssh exit ${probe.status}`),
    }
  }
  return { machine, local: false, load1: load, cores, per_core: load / cores }
}

/**
 * `--machine auto`: the least loaded of this machine and its configured peers. An unreachable peer
 * is skipped rather than failing the dispatch; a winner above the per-core limit is refused by the
 * caller, because opening one more pane on a saturated fleet is what the desk rule forbids.
 */
export function chooseLeastLoaded(candidates: MachineLoad[]): {
  chosen: MachineLoad | undefined
  overloaded: boolean
} {
  const measured = candidates.filter(
    (candidate): candidate is MachineLoad & { per_core: number } =>
      typeof candidate.per_core === 'number',
  )
  const chosen = measured.toSorted(
    (a, b) => a.per_core - b.per_core || Number(b.local) - Number(a.local),
  )[0]
  return { chosen, overloaded: chosen ? chosen.per_core > LOAD_PER_CORE_LIMIT : false }
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
