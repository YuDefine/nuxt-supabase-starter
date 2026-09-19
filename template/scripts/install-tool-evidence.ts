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
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const INTERPRETERS = new Set(['node', 'nodejs', 'python', 'python3', 'bash', 'sh'])

/**
 * Wrapper words skipped while resolving the effective executable
 * (`env X=1 cmd`, `exec cmd`, `nice cmd`). Anything resolved through a
 * wrapper is kept and reported, never removed.
 */
const SHELL_WRAPPERS = new Set(['env', 'command', 'exec', 'builtin', 'nice', 'nohup', 'time'])

/**
 * Commands whose positional argument is itself executed (`xargs rtk`,
 * `timeout 5 rtk`, `sudo rtk`, `eval rtk`). A bare `rtk` token under one of
 * these is an unresolved RTK invocation.
 */
const SHELL_RUNNERS = new Set([
  ...SHELL_WRAPPERS,
  ...INTERPRETERS,
  'xargs',
  'timeout',
  'stdbuf',
  'watch',
  'sudo',
  'doas',
  'eval',
])

/** Exact retired hook-script basenames: rtk-pretool.py, rtk-hook.sh, rtk.hook.js, rtk_hook.sh. */
const RTK_HOOK_SCRIPT = /^rtk[-_.](?:pretool|hook(?:-claude)?)\.[a-z0-9]+$/i

/**
 * Characters that can introduce separators, redirection, or substitution.
 * Presence anywhere means the token stream is not provably one simple
 * command; quoted uses like `echo 'a;b'` may over-trigger, which only
 * over-reports — never over-deletes.
 */
const SHELL_META = /[;&|<>()$`\\\n]/

/** A token carrying spaces or shell syntax may itself be a command string. */
const SHELL_TOKEN_SUBSTANCE = /[\s;&|`$()<>\\]/

/**
 * Shell-like tokenizer honoring single/double quotes and backslash escapes.
 * Adjacent quoted/unquoted fragments join into one word like a real shell,
 * so `"rtk"-guard` is the single executable `rtk-guard`, never `rtk`.
 */
function shellTokens(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let open = false
  let i = 0
  const n = command.length
  while (i < n) {
    const c = command[i]
    if (c === '\\') {
      if (i + 1 < n) {
        current += command[i + 1]
        i += 2
      } else {
        current += c
        i++
      }
      open = true
    } else if (c === "'") {
      const close = command.indexOf("'", i + 1)
      const end = close === -1 ? n : close
      current += command.slice(i + 1, end)
      i = close === -1 ? n : close + 1
      open = true
    } else if (c === '"') {
      i++
      while (i < n && command[i] !== '"') {
        if (
          command[i] === '\\' &&
          i + 1 < n &&
          (command[i + 1] === '"' ||
            command[i + 1] === '\\' ||
            command[i + 1] === '$' ||
            command[i + 1] === '`' ||
            command[i + 1] === '\n')
        ) {
          current += command[i + 1]
          i += 2
        } else {
          current += command[i]
          i++
        }
      }
      i++
      open = true
    } else if (/\s/.test(c)) {
      if (open) {
        tokens.push(current)
        current = ''
        open = false
      }
      i++
    } else {
      current += c
      i++
      open = true
    }
  }
  if (open) tokens.push(current)
  return tokens
}

type HookVerdict = 'managed' | 'unresolved' | 'clean'

/**
 * Classify one hook `command` string. 'managed' is exactly a retired
 * invocation — `rtk ...`, a known retired hook script run directly, an
 * interpreter handed that script, or an interpreter handed the planted
 * `evidence-hook.ts` — with no wrappers, separators, redirections, or
 * substitutions; safe to drop. 'unresolved' is rtk/evidence-shaped but
 * wrapped, compound, indirect, or argument-position — kept and reported.
 * Everything else is foreign and stays silently.
 */
function classifyHookCommand(command: string, depth = 0): HookVerdict {
  const tokens = shellTokens(command)
  if (tokens.length === 0) return 'clean'
  // Skip leading VAR=value assignments and transparent wrapper words.
  let i = 0
  let wrapped = false
  while (i < tokens.length) {
    const token = tokens[i]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      wrapped = true
      i++
      continue
    }
    if (SHELL_WRAPPERS.has(basename(token))) {
      wrapped = true
      i++
      while (
        i < tokens.length &&
        (tokens[i].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]))
      )
        i++
      continue
    }
    break
  }
  const effective = tokens.slice(i)
  const executable = basename(effective[0] ?? '')
  const rtkExec =
    executable === 'rtk' ||
    RTK_HOOK_SCRIPT.test(executable) ||
    (INTERPRETERS.has(executable) && RTK_HOOK_SCRIPT.test(basename(effective[1] ?? '')))
  const evidenceExec =
    INTERPRETERS.has(executable) && basename(effective[1] ?? '') === 'evidence-hook.ts'
  // Script names or a bare `rtk` in non-executable position: `cat
  // rtk-pretool.py`, `echo evidence-hook.ts`, `xargs rtk`, `eval rtk ...`.
  const indirect =
    effective.some(
      (token, k) =>
        k > 0 && (RTK_HOOK_SCRIPT.test(basename(token)) || basename(token) === 'evidence-hook.ts'),
    ) ||
    (SHELL_RUNNERS.has(basename(tokens[0] ?? '')) &&
      tokens.slice(1).some((token) => token === 'rtk'))

  if (SHELL_META.test(command)) {
    // Possibly compound or wrapped in substitution — probe every rough
    // fragment. Over-splitting only over-reports, never over-deletes.
    if (rtkExec || evidenceExec || indirect) return 'unresolved'
    if (depth >= 4) return 'clean'
    for (const fragment of command.split(/[;&|<>()\n`]+|\$\(/)) {
      if (fragment === command) continue
      if (classifyHookCommand(fragment, depth + 1) !== 'clean') return 'unresolved'
    }
    return 'clean'
  }
  if (wrapped) return rtkExec || evidenceExec || indirect ? 'unresolved' : 'clean'
  if (rtkExec || evidenceExec) return 'managed'
  if (indirect) return 'unresolved'
  // Quoted command strings: `sh -c "rtk hook claude"`, `eval 'rtk;x'`.
  if (depth < 4) {
    for (const token of tokens) {
      if (SHELL_TOKEN_SUBSTANCE.test(token) && classifyHookCommand(token, depth + 1) !== 'clean')
        return 'unresolved'
    }
  }
  return 'clean'
}

export interface RetireToolEvidenceResult {
  /** The settings file was rewritten. */
  changed: boolean
  /**
   * Command hooks kept in place because they are rtk/evidence-shaped but
   * wrapped, compound, or indirect — removing them would silently delete
   * unrelated commands. The caller MUST surface these, not treat the run as
   * silently clean.
   */
  unresolved: string[]
}

/**
 * Remove retired tool-evidence hook entries — direct RTK invocations and the
 * inert evidence-hook rewrite this installer used to plant — when the entry
 * is exactly that invocation. Compound/wrapped entries are preserved whole
 * and returned in `unresolved`. Unrelated hooks, matchers, permissions, and
 * every other settings value stay untouched.
 */
export function retireToolEvidence(settingsPath: string): RetireToolEvidenceResult {
  const unresolved: string[] = []
  if (!existsSync(settingsPath)) return { changed: false, unresolved }
  const original = readFileSync(settingsPath, 'utf8')
  const settings = JSON.parse(original)
  let changed = false
  for (const group of settings.hooks?.PreToolUse ?? []) {
    if (group.matcher !== 'Bash') continue
    const kept = (group.hooks ?? []).filter((handler: Record<string, any>) => {
      if (handler.type !== 'command' || typeof handler.command !== 'string') return true
      const verdict = classifyHookCommand(handler.command)
      if (verdict === 'managed') return false
      if (verdict === 'unresolved') unresolved.push(handler.command)
      return true
    })
    if (kept.length !== (group.hooks ?? []).length) {
      group.hooks = kept
      changed = true
    }
  }
  if (!changed) return { changed, unresolved }
  if (readFileSync(settingsPath, 'utf8') !== original)
    throw new Error('Settings changed during evidence retirement')
  const temporary = `${settingsPath}.evidence-${process.pid}`
  writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n', {
    mode: statSync(settingsPath).mode & 0o777,
  })
  renameSync(temporary, settingsPath)
  return { changed, unresolved }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const settingsPath = process.argv[2] ?? join(homedir(), '.claude', 'settings.json')
  const result = retireToolEvidence(settingsPath)
  if (result.changed) {
    console.log('clade evidence: removed retired RTK/evidence hook entries')
  }
  if (result.unresolved.length > 0) {
    console.error('clade evidence: rtk/evidence-shaped hooks kept for manual review:')
    for (const command of result.unresolved) console.error(`  ${command}`)
    process.exitCode = 1
  }
}
