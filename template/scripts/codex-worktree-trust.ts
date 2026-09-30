#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/codex-worktree-trust.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/codex-worktree-trust.ts
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

type TrustResult = { status: 'updated' | 'dry-run' | 'skipped'; reason: string; added: number }
type TrustEntry = { trusted_hash: string }

const PARSE_HOOK_STATE = [
  'import json, sys, tomllib',
  'root = tomllib.loads(sys.stdin.read())',
  'hooks = root.get("hooks", {})',
  'state = hooks.get("state", {}) if isinstance(hooks, dict) else {}',
  'json.dump(state, sys.stdout)',
].join('\n')
const TRUST_KEY = /^(.*\/\.codex\/hooks\.json)(:[^:]+:\d+:\d+)$/
const TRUST_HASH = /^sha256:[0-9a-f]{64}$/

function parseHookState(raw: string): Record<string, unknown> {
  const parsed = spawnSync('python3', ['-c', PARSE_HOOK_STATE], {
    input: raw,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (parsed.error || parsed.status !== 0)
    throw new Error(
      `config.toml TOML parse failed: ${parsed.error?.message ?? parsed.stderr.trim()}`,
    )
  const state: unknown = JSON.parse(parsed.stdout)
  if (!state || typeof state !== 'object' || Array.isArray(state))
    throw new Error('config.toml hooks.state must be a TOML table')
  return state as Record<string, unknown>
}

function sourceEntries(state: Record<string, unknown>): Map<string, Map<string, TrustEntry>> {
  const sources = new Map<string, Map<string, TrustEntry>>()
  for (const [key, value] of Object.entries(state)) {
    const match = TRUST_KEY.exec(key)
    if (!match || !value || typeof value !== 'object' || Array.isArray(value)) continue
    const hash = (value as Record<string, unknown>).trusted_hash
    if (typeof hash !== 'string' || !TRUST_HASH.test(hash)) continue
    const entries = sources.get(match[1]) ?? new Map<string, TrustEntry>()
    entries.set(match[2], { trusted_hash: hash })
    sources.set(match[1], entries)
  }
  return sources
}

export function extendCodexWorktreeHookTrust(
  cwd: string,
  { dryRun = false }: { dryRun?: boolean } = {},
): TrustResult {
  const target = join(realpathSync(cwd), '.codex', 'hooks.json')
  let targetContent: Buffer
  try {
    if (!lstatSync(target).isFile())
      return { status: 'skipped', reason: 'target hooks.json is not a regular file', added: 0 }
    targetContent = readFileSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { status: 'skipped', reason: 'target hooks.json is absent', added: 0 }
    throw error
  }

  const config = join(resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex')), 'config.toml')
  let original: string
  let mode: number
  try {
    const info = lstatSync(config)
    if (!info.isFile()) throw new Error('config.toml is not a regular file')
    mode = info.mode & 0o7777
    original = readFileSync(config, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { status: 'skipped', reason: 'Codex config.toml is absent', added: 0 }
    throw error
  }

  const state = parseHookState(original)
  let matching: Map<string, TrustEntry> | undefined
  for (const [source, entries] of sourceEntries(state)) {
    if (source === target) continue
    try {
      if (!lstatSync(source).isFile() || !readFileSync(source).equals(targetContent)) continue
      if (!matching || entries.size > matching.size) matching = entries
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  if (!matching)
    return {
      status: 'skipped',
      reason: 'no already trusted hooks.json has identical bytes',
      added: 0,
    }

  const missing = [...matching].filter(([suffix]) => !Object.hasOwn(state, `${target}${suffix}`))
  if (missing.length === 0)
    return { status: 'skipped', reason: 'target trust keys already exist', added: 0 }

  const append = missing
    .map(
      ([suffix, entry]) =>
        `[hooks.state.${JSON.stringify(`${target}${suffix}`)}]\ntrusted_hash = ${JSON.stringify(entry.trusted_hash)}\n`,
    )
    .join('\n')
  const updated = `${original}${original.endsWith('\n') ? '\n' : '\n\n'}${append}`
  parseHookState(updated)
  if (dryRun)
    return { status: 'dry-run', reason: 'identical trusted source found', added: missing.length }

  const temporary = join(dirname(config), `.config.toml.trust-${process.pid}-${Date.now()}`)
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporary, 'wx', mode)
    writeFileSync(descriptor, updated)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    chmodSync(temporary, mode)
    if (readFileSync(config, 'utf8') !== original)
      throw new Error('config.toml changed during trust extension; retry on next worktree')
    renameSync(temporary, config)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temporary, { force: true })
  }
  return {
    status: 'updated',
    reason: 'copied trust from identical hooks.json',
    added: missing.length,
  }
}

if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
) {
  try {
    const { values, positionals } = parseArgs({
      options: { 'dry-run': { type: 'boolean' }, cwd: { type: 'string' } },
      allowPositionals: true,
    })
    const cwd = values.cwd ?? positionals[0]
    if (!cwd || positionals.length > (values.cwd ? 0 : 1))
      throw new Error('usage: codex-worktree-trust.ts [--dry-run] <cwd>')
    const result = extendCodexWorktreeHookTrust(cwd, { dryRun: values['dry-run'] })
    console.log(`codex-worktree-trust: ${result.status}: ${result.reason}; added=${result.added}`)
  } catch (error) {
    console.error(
      `codex-worktree-trust: warn: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  }
}
