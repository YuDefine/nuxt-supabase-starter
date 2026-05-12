#!/usr/bin/env node

import {
  collectClaims,
  loadClaimsRuntimeConfig,
  readClaim,
  removeClaim,
  resolveIdentity,
} from './claims-lib.mts'

interface CliOptions {
  change: string | null
  owner: string | null
  runtime: string | null
  sessionId: string | null
  force: boolean
  json: boolean
}

function usage(): string {
  return [
    'Usage:',
    '  release-work.mts <change> [--owner <owner>] [--runtime <runtime>]',
    '                  [--session <id>] [--force] [--json]',
  ].join('\n')
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    change: null,
    owner: null,
    runtime: null,
    sessionId: null,
    force: false,
    json: false,
  }

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--') continue
    if (arg === '--owner') opts.owner = argv[++i] ?? null
    else if (arg === '--runtime') opts.runtime = argv[++i] ?? null
    else if (arg === '--session') opts.sessionId = argv[++i] ?? null
    else if (arg === '--force') opts.force = true
    else if (arg === '--json') opts.json = true
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

function main(): void {
  const opts = parseArgs(process.argv)
  if (!opts.change) throw new Error(`missing change name\n\n${usage()}`)

  const config = loadClaimsRuntimeConfig()
  if (!config.enabled) {
    console.log('✓ spectra:release: disabled in spectra-ux.config.json')
    return
  }

  const existing = readClaim(config, opts.change)
  if (!existing) {
    if (opts.json) emitJson({ removed: false, reason: 'missing' })
    else console.log(`✓ spectra:release: no claim for ${opts.change}`)
    return
  }

  const existingView =
    collectClaims(config).find((view) => view.record.change === opts.change) ?? null
  const identity = resolveIdentity({
    owner: opts.owner,
    runtime: opts.runtime,
    sessionId: opts.sessionId,
  })
  const sameOwner = identity.owner ? existing.owner === identity.owner : false

  if (!opts.force && !sameOwner && !(existingView?.stale ?? false)) {
    throw new Error(
      `change ${opts.change} is claimed by ${existing.owner}; pass --force only when you explicitly intend to clear it`
    )
  }

  removeClaim(config, opts.change)

  if (opts.json) {
    emitJson({
      removed: true,
      change: opts.change,
      owner: existing.owner,
      forced: opts.force || !sameOwner,
      stale: existingView?.stale ?? false,
    })
    return
  }

  console.log(`✓ spectra:release: ${opts.change}`)
}

try {
  main()
} catch (err) {
  console.error(`release-work: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
