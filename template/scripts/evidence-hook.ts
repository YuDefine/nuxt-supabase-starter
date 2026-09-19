#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/evidence-hook.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/evidence-hook.ts
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * RTK is retired: there is no permission oracle left to consult, and rewriting
 * tool input ahead of the host's native permission check would evaluate the
 * operator's allow/ask/deny rules against a wrapper instead of the original
 * command (FR-002). This hook therefore never emits updatedInput and never
 * synthesizes a permissionDecision — every runtime runs the raw command under
 * its native policy. Raw capture stays available through the explicit
 * `node vendor/scripts/run-evidence.ts -- <command>` entry.
 */
export function evidenceHook(
  _payload: Record<string, any>,
  _runtime = process.env.CLADE_RUNTIME,
): {
  systemMessage?: string
  hookSpecificOutput?: {
    permissionDecision?: string
    hookEventName?: string
    updatedInput?: Record<string, any>
  }
} {
  return {}
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
