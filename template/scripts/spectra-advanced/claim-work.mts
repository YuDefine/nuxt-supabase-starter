#!/usr/bin/env node

import {
  claimMatchesPath,
  collectClaims,
  loadClaimsRuntimeConfig,
  normaliseClaimPaths,
  normaliseRepoPath,
  readClaim,
  resolveIdentity,
  writeClaim,
} from './claims-lib.mts'

interface CliOptions {
  change: string | null
  task: string | null
  note: string | null
  paths: string[]
  owner: string | null
  runtime: string | null
  sessionId: string | null
  acceptedFrom: string
  takeover: boolean
  json: boolean
  heartbeatFromPath: string | null
}

function usage(): string {
  return [
    'Usage:',
    '  claim-work.mts <change> [--task "..."] [--note "..."] [--path <repo-path>]',
    '                 [--owner <owner>] [--runtime <runtime>] [--session <id>]',
    '                 [--accept handoff|assign|manual] [--takeover] [--json]',
    '  claim-work.mts --heartbeat-from-path <file>',
  ].join('\n')
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    change: null,
    task: null,
    note: null,
    paths: [],
    owner: null,
    runtime: null,
    sessionId: null,
    acceptedFrom: 'manual',
    takeover: false,
    json: false,
    heartbeatFromPath: null,
  }

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--') continue
    if (arg === '--task') opts.task = argv[++i] ?? null
    else if (arg === '--note') opts.note = argv[++i] ?? null
    else if (arg === '--path') opts.paths.push(argv[++i] ?? '')
    else if (arg === '--owner') opts.owner = argv[++i] ?? null
    else if (arg === '--runtime') opts.runtime = argv[++i] ?? null
    else if (arg === '--session') opts.sessionId = argv[++i] ?? null
    else if (arg === '--accept') opts.acceptedFrom = argv[++i] ?? 'manual'
    else if (arg === '--takeover') opts.takeover = true
    else if (arg === '--json') opts.json = true
    else if (arg === '--heartbeat-from-path') opts.heartbeatFromPath = argv[++i] ?? null
    else if (arg === '--help' || arg === '-h') {
      console.log(usage())
      process.exit(0)
    } else if (!arg.startsWith('--') && !opts.change) {
      opts.change = arg
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  return opts
}

function emitJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2))
}

function heartbeat(pathArg: string | null, json: boolean): void {
  if (!pathArg) throw new Error('--heartbeat-from-path requires a file path')

  const config = loadClaimsRuntimeConfig()
  if (!config.enabled) {
    if (json) emitJson({ updated: [] })
    process.exit(0)
  }

  const identity = resolveIdentity({
    allowFallbackOwner: process.env.SPECTRA_UX_CLAIM_ALLOW_FALLBACK !== '0',
  })
  if (!identity.owner) {
    if (json) emitJson({ updated: [] })
    process.exit(0)
  }

  const nowIso = new Date().toISOString()
  const repoPath = normaliseRepoPath(config.repoRoot, pathArg)
  const updated: string[] = []
  for (const view of collectClaims(config)) {
    if (view.stale) continue
    if (view.record.owner !== identity.owner) continue
    if (identity.sessionId && view.record.sessionId && view.record.sessionId !== identity.sessionId)
      continue
    if (!claimMatchesPath(config, view.record, pathArg)) continue

    const nextPaths =
      repoPath && repoPath !== '.'
        ? normaliseClaimPaths(config.repoRoot, [...view.record.paths, repoPath])
        : view.record.paths
    writeClaim(config, {
      ...view.record,
      paths: nextPaths,
      updatedAt: nowIso,
    })
    updated.push(view.record.change)
  }

  if (json) {
    emitJson({ updated })
    process.exit(0)
  }

  if (updated.length > 0) {
    console.log('updated')
  }
}

function main(): void {
  const opts = parseArgs(process.argv)
  if (opts.heartbeatFromPath) {
    heartbeat(opts.heartbeatFromPath, opts.json)
    return
  }

  if (!opts.change) throw new Error(`missing change name\n\n${usage()}`)

  const config = loadClaimsRuntimeConfig()
  if (!config.enabled) {
    console.log('✓ spectra:claim: disabled in spectra-ux.config.json')
    return
  }

  const identity = resolveIdentity({
    owner: opts.owner,
    runtime: opts.runtime,
    sessionId: opts.sessionId,
  })
  if (!identity.owner) {
    throw new Error('unable to resolve claim owner; pass --owner or set SPECTRA_UX_CLAIM_OWNER')
  }

  const existing = readClaim(config, opts.change)
  const existingViews = collectClaims(config)
  const existingView = existingViews.find((view) => view.record.change === opts.change) ?? null

  if (
    existing &&
    existing.owner !== identity.owner &&
    existingView &&
    !existingView.stale &&
    !opts.takeover
  ) {
    throw new Error(
      `change ${opts.change} is already claimed by ${existing.owner}; use --takeover only after confirming handoff/stale state`
    )
  }

  const nowIso = new Date().toISOString()
  const record = {
    schemaVersion: 1 as const,
    change: opts.change,
    owner: identity.owner,
    runtime: opts.runtime?.trim() || identity.runtime,
    sessionId: opts.sessionId?.trim() || identity.sessionId,
    task: opts.task ?? existing?.task ?? null,
    note: opts.note ?? existing?.note ?? null,
    paths: normaliseClaimPaths(config.repoRoot, [...(existing?.paths ?? []), ...opts.paths]),
    acceptedFrom: opts.acceptedFrom || existing?.acceptedFrom || 'manual',
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  }

  writeClaim(config, record)

  const tookOver = existing && existing.owner !== identity.owner
  if (opts.json) {
    emitJson({
      change: record.change,
      owner: record.owner,
      runtime: record.runtime,
      sessionId: record.sessionId,
      task: record.task,
      note: record.note,
      paths: record.paths,
      acceptedFrom: record.acceptedFrom,
      tookOver,
      staleTakeover: tookOver && Boolean(existingView?.stale),
    })
    return
  }

  const takeoverLabel = tookOver
    ? existingView?.stale
      ? ` (took over stale claim from ${existing!.owner})`
      : ` (took over ${existing!.owner})`
    : existing
      ? ' (heartbeat refreshed)'
      : ''
  console.log(`✓ spectra:claim: ${record.change} → ${record.owner}${takeoverLabel}`)
}

try {
  main()
} catch (err) {
  console.error(`claim-work: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
