#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/run-evidence.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/run-evidence.ts
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createReadStream,
  closeSync,
  mkdtempSync,
  openSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { constants, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

async function digest(path: string) {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length
    hash.update(chunk)
  }
  return { path, bytes, sha256: hash.digest('hex') }
}

/** Capture a single invocation before any presentation filter touches its output. */
export async function runEvidence(
  command: string[],
  options: { directory?: string; timeoutMs?: number } = {},
) {
  if (!command.length) throw new Error('Expected a command after --')
  const directory = mkdtempSync(join(options.directory ?? tmpdir(), 'clade-evidence-'))
  const stdout = join(directory, 'stdout.log')
  const stderr = join(directory, 'stderr.log')
  const out = openSync(stdout, 'wx', 0o600)
  const err = openSync(stderr, 'wx', 0o600)
  const startedAt = new Date().toISOString()
  let timedOut = false
  let spawnError: string | undefined
  const child = spawn(command[0]!, command.slice(1), {
    stdio: ['ignore', out, err],
    detached: process.platform !== 'win32',
  })
  closeSync(out)
  closeSync(err)
  function kill(signal: NodeJS.Signals) {
    if (!child.pid) return
    try {
      if (process.platform === 'win32') child.kill(signal)
      else process.kill(-child.pid, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  const onInterrupt = () => kill('SIGINT')
  const onTerminate = () => kill('SIGTERM')
  process.on('SIGINT', onInterrupt)
  process.on('SIGTERM', onTerminate)
  const timer = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true
        kill('SIGKILL')
      }, options.timeoutMs)
    : undefined
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (accept) => {
      child.on('error', (error) => {
        spawnError = error.message
      })
      child.on('close', (code, signal) => accept({ code, signal }))
    },
  )
  clearTimeout(timer)
  process.off('SIGINT', onInterrupt)
  process.off('SIGTERM', onTerminate)
  const receipt = {
    command,
    cwd: process.cwd(),
    startedAt,
    finishedAt: new Date().toISOString(),
    ...result,
    timedOut,
    spawnError,
    stdout: await digest(stdout),
    stderr: await digest(stderr),
  }
  const receiptPath = join(directory, 'receipt.json')
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 })
  return { ...receipt, receiptPath }
}

function invokedAsCli() {
  try {
    return (
      Boolean(process.argv[1]) &&
      realpathSync(process.argv[1]!) === realpathSync(fileURLToPath(import.meta.url))
    )
  } catch {
    return false
  }
}

if (invokedAsCli()) {
  const separator = process.argv.indexOf('--')
  if (separator !== 2 || process.argv.length < 4) {
    console.error('Usage: node run-evidence.ts -- <raw-command> [args...]')
    process.exitCode = 2
  } else {
    const result = await runEvidence(process.argv.slice(separator + 1))
    console.log(JSON.stringify(result))
    process.exitCode = result.spawnError
      ? 127
      : (result.code ?? 128 + (result.signal ? constants.signals[result.signal] : 0))
  }
}
