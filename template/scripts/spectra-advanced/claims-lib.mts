#!/usr/bin/env node

import os from 'node:os'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_CLAIMS_DIR = '.spectra/claims'
const DEFAULT_STALE_SECONDS = 60 * 60
const MAX_WALK_DEPTH = 8

export interface ClaimsRuntimeConfig {
  repoRoot: string
  openspecDir: string
  claimsDir: string
  staleSeconds: number
  enabled: boolean
}

export interface ClaimRecord {
  schemaVersion: 1
  change: string
  owner: string
  runtime: string
  sessionId: string | null
  task: string | null
  note: string | null
  paths: string[]
  acceptedFrom: string
  createdAt: string
  updatedAt: string
}

export interface ClaimView {
  record: ClaimRecord
  filePath: string
  ageSeconds: number
  stale: boolean
}

export interface Identity {
  owner: string | null
  ownerSource: 'explicit' | 'env' | 'session' | 'fallback'
  runtime: string
  sessionId: string | null
}

function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    if (existsSync(resolve(dir, 'spectra-ux.config.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    if (existsSync(resolve(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

export function loadClaimsRuntimeConfig(): ClaimsRuntimeConfig {
  const repoRoot = findRepoRoot()
  const defaults: ClaimsRuntimeConfig = {
    repoRoot,
    openspecDir: 'openspec',
    claimsDir: DEFAULT_CLAIMS_DIR,
    staleSeconds: DEFAULT_STALE_SECONDS,
    enabled: true,
  }
  const path = resolve(repoRoot, 'spectra-ux.config.json')
  if (!existsSync(path)) return defaults

  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      paths?: { openspec?: string }
      claims?: { enabled?: boolean; path?: string; staleSeconds?: number }
    }
    const staleSeconds =
      typeof raw.claims?.staleSeconds === 'number' && Number.isFinite(raw.claims.staleSeconds)
        ? Math.max(60, Math.floor(raw.claims.staleSeconds))
        : defaults.staleSeconds
    return {
      repoRoot,
      openspecDir: raw.paths?.openspec ?? defaults.openspecDir,
      claimsDir: raw.claims?.path ?? defaults.claimsDir,
      staleSeconds,
      enabled: raw.claims?.enabled ?? defaults.enabled,
    }
  } catch {
    return defaults
  }
}

function readJsonSafe(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function ensureSafeChangeName(change: string): string {
  const value = change.trim()
  if (!value || value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error(`invalid change name: ${change}`)
  }
  return value
}

export function claimFilePath(config: ClaimsRuntimeConfig, change: string): string {
  return resolve(config.repoRoot, config.claimsDir, `${ensureSafeChangeName(change)}.json`)
}

export function ensureClaimsDir(config: ClaimsRuntimeConfig): string {
  const dir = resolve(config.repoRoot, config.claimsDir)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function normaliseRepoPath(repoRoot: string, path: string): string | null {
  const rel = relative(repoRoot, resolve(repoRoot, path)).replace(/\\/g, '/')
  if (!rel || rel === '.') return '.'
  if (rel === '..' || rel.startsWith('../')) return null
  return rel
}

export function normaliseClaimPaths(repoRoot: string, paths: string[]): string[] {
  const next = new Set<string>()
  for (const path of paths) {
    const value = path.trim()
    if (!value) continue
    const rel = normaliseRepoPath(repoRoot, value)
    if (!rel || rel === '.') continue
    next.add(rel)
  }
  return [...next].toSorted()
}

function isClaimRecord(value: unknown): value is ClaimRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.schemaVersion === 1 &&
    typeof record.change === 'string' &&
    typeof record.owner === 'string' &&
    typeof record.runtime === 'string' &&
    (typeof record.sessionId === 'string' || record.sessionId === null) &&
    (typeof record.task === 'string' || record.task === null) &&
    (typeof record.note === 'string' || record.note === null) &&
    Array.isArray(record.paths) &&
    typeof record.acceptedFrom === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string'
  )
}

export function readClaim(config: ClaimsRuntimeConfig, change: string): ClaimRecord | null {
  const raw = readJsonSafe(claimFilePath(config, change))
  return isClaimRecord(raw) ? raw : null
}

export function writeClaim(config: ClaimsRuntimeConfig, record: ClaimRecord): void {
  ensureClaimsDir(config)
  writeFileSync(claimFilePath(config, record.change), JSON.stringify(record, null, 2) + '\n')
}

export function removeClaim(config: ClaimsRuntimeConfig, change: string): void {
  const path = claimFilePath(config, change)
  if (existsSync(path)) rmSync(path)
}

export function collectClaims(config: ClaimsRuntimeConfig, now: Date = new Date()): ClaimView[] {
  if (!config.enabled) return []
  const dir = resolve(config.repoRoot, config.claimsDir)
  if (!existsSync(dir)) return []

  const nowMs = now.getTime()
  const claims: ClaimView[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const filePath = resolve(dir, entry.name)
    const raw = readJsonSafe(filePath)
    if (!isClaimRecord(raw)) continue
    const updatedMs = Date.parse(raw.updatedAt)
    const ageSeconds = Number.isFinite(updatedMs)
      ? Math.max(0, Math.floor((nowMs - updatedMs) / 1000))
      : Number.MAX_SAFE_INTEGER
    claims.push({
      record: raw,
      filePath,
      ageSeconds,
      stale: ageSeconds > config.staleSeconds,
    })
  }

  return claims.toSorted((a, b) => {
    if (a.stale !== b.stale) return a.stale ? 1 : -1
    return Date.parse(b.record.updatedAt) - Date.parse(a.record.updatedAt)
  })
}

export function detectRuntime(): string {
  const env = process.env
  if (env.CLAUDE_PROJECT_DIR || env.CLAUDE_SESSION_ID || env.CLAUDE_CONVERSATION_ID) return 'claude'
  if (env.CODEX_SESSION_ID || env.CODEX_AGENT_NAME || env.CODEX_HOME) return 'codex'
  if (env.COPILOT_AGENT_ID || env.GITHUB_COPILOT_CHAT) return 'copilot'
  if (env.CURSOR_SESSION_ID || env.CURSOR_TRACE_ID) return 'cursor'
  return 'unknown'
}

function resolveEnvSessionId(): string | null {
  const env = process.env
  for (const key of [
    'CLAUDE_SESSION_ID',
    'CLAUDE_CONVERSATION_ID',
    'CODEX_SESSION_ID',
    'CODEX_CONVERSATION_ID',
    'COPILOT_AGENT_ID',
    'CURSOR_SESSION_ID',
  ]) {
    const value = env[key]?.trim()
    if (value) return value
  }
  return null
}

export function resolveIdentity(
  opts: {
    owner?: string | null
    runtime?: string | null
    sessionId?: string | null
    allowFallbackOwner?: boolean
  } = {}
): Identity {
  const runtime = opts.runtime?.trim() || detectRuntime()
  const sessionId = opts.sessionId?.trim() || resolveEnvSessionId()
  const envOwner = process.env.SPECTRA_UX_CLAIM_OWNER?.trim() || null
  if (opts.owner?.trim()) {
    return {
      owner: opts.owner.trim(),
      ownerSource: 'explicit',
      runtime,
      sessionId,
    }
  }
  if (envOwner) {
    return {
      owner: envOwner,
      ownerSource: 'env',
      runtime,
      sessionId,
    }
  }
  if (sessionId) {
    return {
      owner: `${runtime}:${sessionId}`,
      ownerSource: 'session',
      runtime,
      sessionId,
    }
  }
  if (opts.allowFallbackOwner === false) {
    return {
      owner: null,
      ownerSource: 'fallback',
      runtime,
      sessionId: null,
    }
  }
  return {
    owner: `${runtime}:${os.userInfo().username}@${os.hostname()}`,
    ownerSource: 'fallback',
    runtime,
    sessionId: null,
  }
}

export function claimMatchesPath(
  config: ClaimsRuntimeConfig,
  claim: ClaimRecord,
  filePath: string
): boolean {
  const rel = normaliseRepoPath(config.repoRoot, filePath)
  if (!rel || rel === '.') return false

  const openspecDir = config.openspecDir.replace(/\/$/, '')
  const changeRoot = `${openspecDir}/changes/${claim.change}`
  if (rel === changeRoot || rel.startsWith(`${changeRoot}/`)) return true

  for (const claimedPath of claim.paths) {
    if (rel === claimedPath || rel.startsWith(`${claimedPath}/`)) return true
    if (claimedPath.endsWith('/') ? rel === claimedPath.slice(0, -1) : false) return true
  }
  return false
}

export function formatAge(ageSeconds: number): string {
  if (ageSeconds < 60) return `${ageSeconds}s`
  if (ageSeconds < 60 * 60) return `${Math.floor(ageSeconds / 60)}m`
  if (ageSeconds < 60 * 60 * 24) return `${Math.floor(ageSeconds / 3600)}h`
  return `${Math.floor(ageSeconds / 86400)}d`
}
