#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/evidence-hook.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/evidence-hook.ts
import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const runner = join(dirname(fileURLToPath(import.meta.url)), 'run-evidence.ts')
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"

/** One rewrite owner: query the incumbent RTK decision, then capture its raw input. */
export function evidenceHook(payload: Record<string, any>, runtime = process.env.CLADE_RUNTIME) {
  const input = payload.tool_input ?? payload.input ?? {}
  const command = input.command
  if (
    typeof command !== 'string' ||
    !command.trim() ||
    input.tty ||
    command.includes('run-evidence.ts')
  )
    return {}
  if (!existsSync(runner))
    return { systemMessage: 'clade evidence unavailable: run-evidence.ts is missing' }
  const rtk = spawnSync('rtk', ['hook', 'claude'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 5000,
  })
  let decision: Record<string, any> = {}
  try {
    decision = JSON.parse(rtk.stdout || '{}').hookSpecificOutput ?? {}
  } catch {
    /* no incumbent decision */
  }
  if (decision.permissionDecision === 'deny' || decision.permissionDecision === 'ask') {
    return { hookSpecificOutput: { ...decision, updatedInput: undefined } }
  }
  // Native Codex rejects updatedInput without allow. Never manufacture approval.
  if (runtime === 'codex' && decision.permissionDecision !== 'allow') return {}
  const shell =
    typeof input.shell === 'string' && input.shell.startsWith('/') ? input.shell : '/bin/bash'
  const updatedInput = {
    ...input,
    command: `${quote(process.execPath)} ${quote(runner)} --display -- ${quote(shell)} ${input.login === true ? '-lc' : '-c'} ${quote(command)}`,
  }
  return { hookSpecificOutput: { ...decision, hookEventName: 'PreToolUse', updatedInput } }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  try {
    console.log(JSON.stringify(evidenceHook(JSON.parse(input))))
  } catch (error) {
    console.log(JSON.stringify({ systemMessage: `clade evidence unavailable: ${String(error)}` }))
  }
}
