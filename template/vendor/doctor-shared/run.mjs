#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/doctor-shared/run.mjs · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/doctor-shared/run.mjs
// Project-local Doctor CLI adapter: legacy releases use `scan`, current releases use [path].
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const binary = join(process.cwd(), 'node_modules', '.bin', 'vite-doctor')
const help = spawnSync(binary, ['--help'], { encoding: 'utf8', timeout: 10_000 })
if (help.error || help.status !== 0) {
  process.stderr.write(
    `[doctor] Cannot inspect project-local vite-doctor: ${help.error?.message ?? help.stderr}\n`,
  )
  process.exit(help.status || 1)
}
const legacy = /vite-doctor\s+scan(?:\s|$)|^\s*scan(?:\s|$)/m.test(help.stdout)
if (!legacy && !/vite-doctor\s+\[path\]/.test(help.stdout)) {
  process.stderr.write('[doctor] Unsupported vite-doctor CLI; expected scan or [path] usage.\n')
  process.exit(1)
}
const result = spawnSync(
  binary,
  [...(legacy ? ['scan'] : []), '.', '--max-warnings', '0', ...process.argv.slice(2)],
  { stdio: 'inherit' },
)
if (result.error) process.stderr.write(`[doctor] ${result.error.message}\n`)
if (result.signal) process.kill(process.pid, result.signal)
process.exit(result.status ?? 1)
