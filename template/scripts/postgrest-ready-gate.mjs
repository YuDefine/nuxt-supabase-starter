#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const script = join(process.cwd(), '.claude/scripts/postgrest-resilience/ready-watch.mjs')

if (!existsSync(script)) {
  console.error(
    'Missing .claude/scripts/postgrest-resilience/ready-watch.mjs. Run pnpm hub:sync first.'
  )
  process.exit(2)
}

const result = spawnSync(process.execPath, [script, ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(result.status ?? 1)
