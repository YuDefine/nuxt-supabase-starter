#!/usr/bin/env node
// spectra-archive-sidecar.mjs — lifecycle helper for /spectra-archive in-flight checkpoint
//
// Sidecar path: $MAIN_WT_PATH/.spectra/in-flight-archive/<change-name>.json
//   - MAIN_WT_PATH = dirname(git rev-parse --path-format=absolute --git-common-dir)
//     so writes always land on main worktree even when invoked from a linked worktree
//     (cross-session visibility: session B from main sees session A's wt-internal archive)
//
// Schema:
//   {
//     "change_name": "<X>",
//     "started_at": "<ISO>",
//     "session_id": "<CLAUDE_SESSION_ID or null>",
//     "original_wt_path": "<cwd at init time>",
//     "phase": "merge-back|gate-check|spec-sync|folder-mv|screenshot-sweep|cleanup",
//     "last_step_completed": "<phase or null>",
//     "pid": <number>,
//     "node_version": "<process.version>"
//   }
//
// Subcommands:
//   init <change-name>                          → create sidecar at phase=merge-back, prints sidecar path
//   update <change-name> --phase <p> [--last-completed <p>]  → update phase + optional last_step_completed
//   read <change-name>                          → print sidecar JSON to stdout
//   delete <change-name>                        → remove sidecar (silent if missing)
//   detect [--threshold-seconds N]              → list orphan sidecars older than N seconds (default 300)
//                                                 → emits warn lines to stderr per orphan, exits 0
//   list                                        → print all sidecars (JSON array) to stdout
//
// Exit codes:
//   0 success
//   1 user error (bad args, sidecar missing for update/read, invalid phase)
//   2 not in a git repo

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

const PHASES = new Set([
  'merge-back',
  'gate-check',
  'spec-sync',
  'folder-mv',
  'screenshot-sweep',
  'cleanup',
])

const DEFAULT_THRESHOLD_SECONDS = 300 // 5 min

function resolveMainWorktreePath() {
  let commonDir
  try {
    commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
  if (!commonDir) return null
  return dirname(commonDir)
}

function sidecarDirFor(mainWt) {
  return join(mainWt, '.spectra', 'in-flight-archive')
}

function sidecarPathFor(mainWt, changeName) {
  return join(sidecarDirFor(mainWt), `${changeName}.json`)
}

function ensureSidecarDir(mainWt) {
  const dir = sidecarDirFor(mainWt)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function readSidecar(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    return { parseError: e.message ?? String(e) }
  }
}

function writeSidecar(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function parseFlags(args) {
  const flags = {}
  const rest = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      rest.push(a)
    }
  }
  return { flags, rest }
}

function cmdInit(mainWt, args) {
  const { rest } = parseFlags(args)
  const [changeName] = rest
  if (!changeName) {
    process.stderr.write('error: init requires <change-name>\n')
    return 1
  }
  ensureSidecarDir(mainWt)
  const path = sidecarPathFor(mainWt, changeName)
  if (existsSync(path)) {
    process.stderr.write(`error: sidecar already exists: ${path}\n`)
    process.stderr.write('  use `update` to change phase, or `delete` to remove stale sidecar\n')
    return 1
  }
  const data = {
    change_name: changeName,
    started_at: new Date().toISOString(),
    session_id: process.env.CLADE_SESSION_LABEL ?? process.env.CLAUDE_SESSION_ID ?? null,
    original_wt_path: process.cwd(),
    phase: 'merge-back',
    last_step_completed: null,
    pid: process.pid,
    node_version: process.version,
  }
  writeSidecar(path, data)
  process.stdout.write(`${path}\n`)
  return 0
}

function cmdUpdate(mainWt, args) {
  const { flags, rest } = parseFlags(args)
  const [changeName] = rest
  if (!changeName) {
    process.stderr.write('error: update requires <change-name>\n')
    return 1
  }
  const phase = flags.phase
  if (!phase || typeof phase !== 'string') {
    process.stderr.write('error: update requires --phase <p>\n')
    return 1
  }
  if (!PHASES.has(phase)) {
    process.stderr.write(`error: invalid phase '${phase}' (allowed: ${[...PHASES].join(', ')})\n`)
    return 1
  }
  const path = sidecarPathFor(mainWt, changeName)
  if (!existsSync(path)) {
    process.stderr.write(`error: sidecar not found: ${path}\n`)
    return 1
  }
  const data = readSidecar(path)
  if (!data || data.parseError) {
    process.stderr.write(`error: sidecar parse failed: ${data?.parseError ?? 'unknown'}\n`)
    return 1
  }
  data.phase = phase
  if (flags['last-completed'] !== undefined) {
    const lc = flags['last-completed']
    if (lc === 'null' || lc === '') {
      data.last_step_completed = null
    } else {
      if (!PHASES.has(lc)) {
        process.stderr.write(`error: invalid --last-completed '${lc}'\n`)
        return 1
      }
      data.last_step_completed = lc
    }
  }
  writeSidecar(path, data)
  return 0
}

function cmdRead(mainWt, args) {
  const { rest } = parseFlags(args)
  const [changeName] = rest
  if (!changeName) {
    process.stderr.write('error: read requires <change-name>\n')
    return 1
  }
  const path = sidecarPathFor(mainWt, changeName)
  if (!existsSync(path)) {
    process.stderr.write(`error: sidecar not found: ${path}\n`)
    return 1
  }
  process.stdout.write(readFileSync(path, 'utf8'))
  return 0
}

function cmdDelete(mainWt, args) {
  const { rest } = parseFlags(args)
  const [changeName] = rest
  if (!changeName) {
    process.stderr.write('error: delete requires <change-name>\n')
    return 1
  }
  const path = sidecarPathFor(mainWt, changeName)
  if (!existsSync(path)) {
    return 0 // silent no-op
  }
  try {
    unlinkSync(path)
  } catch (e) {
    process.stderr.write(`warn: failed to delete sidecar ${path}: ${e.message ?? e}\n`)
    return 1
  }
  return 0
}

function cmdList(mainWt) {
  const dir = sidecarDirFor(mainWt)
  if (!existsSync(dir)) {
    process.stdout.write('[]\n')
    return 0
  }
  const entries = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    const path = join(dir, f)
    const data = readSidecar(path)
    if (data) entries.push({ sidecarPath: path, ...data })
  }
  process.stdout.write(JSON.stringify(entries, null, 2) + '\n')
  return 0
}

function cmdDetect(mainWt, args) {
  const { flags } = parseFlags(args)
  let threshold = DEFAULT_THRESHOLD_SECONDS
  if (flags['threshold-seconds'] !== undefined) {
    const n = Number(flags['threshold-seconds'])
    if (Number.isFinite(n) && n >= 0) threshold = n
  }
  const dir = sidecarDirFor(mainWt)
  if (!existsSync(dir)) return 0
  const now = Date.now()
  let found = 0
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    const path = join(dir, f)
    const data = readSidecar(path)
    if (!data || data.parseError) {
      process.stderr.write(`⚠ spectra-archive sidecar unparseable: ${path}\n`)
      found++
      continue
    }
    if (!data.started_at) continue
    const startedMs = Date.parse(data.started_at)
    if (!Number.isFinite(startedMs)) continue
    const ageSec = Math.floor((now - startedMs) / 1000)
    if (ageSec < threshold) continue
    const changeName = data.change_name ?? f.replace(/\.json$/, '')
    const phase = data.phase ?? 'unknown'
    process.stderr.write(
      `⚠ spectra-archive interrupted: ${changeName} (phase=${phase}, ${ageSec}s ago)\n`,
    )
    process.stderr.write(
      `  recovery: cd ${mainWt} && claude /spectra-archive ${changeName} --resume\n`,
    )
    process.stderr.write(`  sidecar: ${path}\n`)
    found++
  }
  return 0 // warn-only, always success
}

function usage() {
  process.stderr.write(
    [
      'usage: spectra-archive-sidecar.mjs <subcommand> [args]',
      '',
      'subcommands:',
      '  init <change-name>                         create sidecar (phase=merge-back)',
      '  update <change-name> --phase <p>           update phase',
      '         [--last-completed <p|null>]',
      '  read <change-name>                         print sidecar JSON',
      '  delete <change-name>                       remove sidecar (silent if missing)',
      '  detect [--threshold-seconds N]             warn on orphans older than N (default 300)',
      '  list                                       print all sidecars as JSON array',
      '',
      `phases: ${[...PHASES].join(' | ')}`,
    ].join('\n') + '\n',
  )
}

function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    usage()
    return 1
  }
  const subcmd = args[0]
  const rest = args.slice(1)
  const mainWt = resolveMainWorktreePath()
  if (!mainWt) {
    process.stderr.write('error: not inside a git repository (cannot resolve main worktree)\n')
    return 2
  }
  switch (subcmd) {
    case 'init':
      return cmdInit(mainWt, rest)
    case 'update':
      return cmdUpdate(mainWt, rest)
    case 'read':
      return cmdRead(mainWt, rest)
    case 'delete':
      return cmdDelete(mainWt, rest)
    case 'list':
      return cmdList(mainWt)
    case 'detect':
      return cmdDetect(mainWt, rest)
    case '--help':
    case '-h':
    case 'help':
      usage()
      return 0
    default:
      process.stderr.write(`error: unknown subcommand '${subcmd}'\n`)
      usage()
      return 1
  }
}

process.exit(main())
