#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/install-tool-evidence.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/install-tool-evidence.ts
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
  realpathSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Replace only the incumbent RTK handler; unrelated hooks and permissions are untouched. */
export function installToolEvidence(settingsPath: string, helper: string): boolean {
  if (!existsSync(settingsPath) || !existsSync(helper)) return false
  const original = readFileSync(settingsPath, 'utf8')
  const settings = JSON.parse(original)
  let changed = false
  for (const group of settings.hooks?.PreToolUse ?? []) {
    if (group.matcher !== 'Bash') continue
    for (const handler of group.hooks ?? []) {
      if (handler.type !== 'command' || handler.command !== 'rtk hook claude') continue
      handler.command = `node '${helper.replaceAll("'", "'\\''")}'`
      changed = true
    }
  }
  if (!changed) return false
  if (readFileSync(settingsPath, 'utf8') !== original)
    throw new Error('Settings changed during evidence installation')
  const temporary = `${settingsPath}.evidence-${process.pid}`
  writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n', {
    mode: statSync(settingsPath).mode & 0o777,
  })
  renameSync(temporary, settingsPath)
  return true
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const helper = join(dirname(fileURLToPath(import.meta.url)), 'evidence-hook.ts')
  if (installToolEvidence(join(homedir(), '.claude', 'settings.json'), helper)) {
    console.log(
      'clade evidence: replaced the existing RTK hook; refresh Codex/Cursor hook projections',
    )
  }
}
