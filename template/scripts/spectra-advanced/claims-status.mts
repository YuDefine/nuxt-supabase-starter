#!/usr/bin/env node

import { collectClaims, formatAge, loadClaimsRuntimeConfig } from './claims-lib.mts'

interface CliOptions {
  json: boolean
  sessionSummary: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { json: false, sessionSummary: false }
  for (const arg of argv.slice(2)) {
    if (arg === '--json') opts.json = true
    else if (arg === '--session-summary') opts.sessionSummary = true
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: claims-status.mts [--json] [--session-summary]\n' +
          '  --json             Emit machine-readable claim data.\n' +
          '  --session-summary  Condensed output for SessionStart surfacing.'
      )
      process.exit(0)
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return opts
}

function formatLine(view: ReturnType<typeof collectClaims>[number]): string {
  const task = view.record.task ? ` · task: ${view.record.task}` : ''
  const from = view.record.acceptedFrom ? ` · from: ${view.record.acceptedFrom}` : ''
  const state = view.stale ? 'stale' : 'active'
  return `- \`${view.record.change}\` → ${view.record.owner} (${state}, ${formatAge(view.ageSeconds)} ago)${task}${from}`
}

function main(): void {
  const cli = parseArgs(process.argv)
  const config = loadClaimsRuntimeConfig()
  if (!config.enabled) {
    if (cli.json) {
      console.log(JSON.stringify({ enabled: false, claims: [] }, null, 2))
    } else if (!cli.sessionSummary) {
      console.log('✓ spectra:claims: disabled in spectra-ux.config.json')
    }
    return
  }

  const claims = collectClaims(config)
  const active = claims.filter((claim) => !claim.stale)
  const stale = claims.filter((claim) => claim.stale)

  if (cli.json) {
    console.log(
      JSON.stringify(
        {
          enabled: true,
          staleSeconds: config.staleSeconds,
          active: active.map((view) => view.record),
          stale: stale.map((view) => view.record),
        },
        null,
        2
      )
    )
    return
  }

  if (cli.sessionSummary) {
    if (claims.length === 0) return
    console.log(
      `⚠ spectra claims: ${active.length} active · ${stale.length} stale (timeout: ${Math.floor(config.staleSeconds / 60)}m)`
    )
    for (const view of active.slice(0, 5)) console.log(`  active: ${formatLine(view).slice(2)}`)
    for (const view of stale.slice(0, 5)) console.log(`  stale : ${formatLine(view).slice(2)}`)
    return
  }

  if (claims.length === 0) {
    console.log('✓ spectra:claims: no active claims')
    return
  }

  console.log(
    `✓ spectra:claims: ${active.length} active · ${stale.length} stale (timeout: ${Math.floor(config.staleSeconds / 60)}m)`
  )
  console.log('')
  console.log('### Active')
  console.log('')
  console.log(active.length > 0 ? active.map(formatLine).join('\n') : '_(none)_')
  console.log('')
  console.log('### Stale')
  console.log('')
  console.log(stale.length > 0 ? stale.map(formatLine).join('\n') : '_(none)_')
}

try {
  main()
} catch (err) {
  console.error(`claims-status: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
