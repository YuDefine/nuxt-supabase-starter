// 🔒 LOCKED — managed by clade · Source: vendor/scripts/preservation-resource-adapters.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/preservation-resource-adapters.ts
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RESOURCE_ADAPTER_FIELDS,
  inventoryOptionsFromProfile,
  verifyPreservationArchive,
  verifyPreservationArchiveIntegrity,
  type ConsumerProfile,
  type InventoryOptions,
  type ResourceAdapterName,
  type ResourceField,
} from './preservation-policy.ts'

/**
 * Per-worktree release verdicts for the resources a consumer profile declares present
 * (specs/plans/W-2026-09-29-preservation-resource-adapters § Decisions). The profile stays a
 * per-consumer capability claim; whether THIS source path may be removed is decided here.
 *
 * Adapters only read. Anything they cannot prove is `retain`; a declared-present field no
 * registered adapter claims is `unsupported` (the pre-adapter fail-closed throw).
 */
export type ResourceVerdict =
  | { status: 'released' }
  | { status: 'retain'; reason: string }
  | { status: 'unsupported'; reason: string }

export interface ResourceReleaseContext {
  sourcePath: string
  branch?: string
  /** Worktree archive whose receipt was verified for this source (absent before capture). */
  archive?: string
  /** The source tree still exists on disk. */
  treeExists: boolean
  /**
   * Verify only the archive's own integrity (receipt + digests), not equality with the live
   * tree. Cleanup sets it: the archive was just captured and verified, and a journaled
   * removal resume holds a legitimately torn-down tree that is not archive-equal. The
   * per-secret byte comparison against the live tree still runs.
   */
  integrityOnly?: boolean
}

export type ResourceAdapter = (
  profile: ConsumerProfile,
  context: ResourceReleaseContext,
  fields: ResourceField[],
) => ResourceVerdict

export type ResourceAdapterSet = Partial<Record<ResourceAdapterName, ResourceAdapter>>

const retain = (reason: string): ResourceVerdict => ({ status: 'retain', reason })
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

// ---------------------------------------------------------------------------
// in-tree-archive: `.env*` secrets are preserved by the P0 full-tree archive.
// ---------------------------------------------------------------------------

export interface InTreeArchiveDeps {
  verifyArchive?: (archive: string, sourcePath: string, options: InventoryOptions) => boolean
  verifyIntegrity?: (archive: string, options: InventoryOptions) => boolean
}

const SECRET_NAME = /^\.env(\..+)?$/
const SECRET_TEMPLATE = /\.(example|sample|template|dist)$/
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')

/** Normalized path (no leading `./`) -> the member name exactly as tar stored it. */
function archiveMembers(archive: string): Map<string, string> {
  const names = execFileSync('tar', ['--list', '--file', archive], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
    .split('\n')
    .filter(Boolean)
  return new Map(names.map((name) => [name.replace(/^\.\//, ''), name]))
}

function isSecretPath(path: string): boolean {
  const parts = path.split('/')
  const name = parts.at(-1) ?? ''
  if (!SECRET_NAME.test(name) || SECRET_TEMPLATE.test(name)) return false
  return !parts.some((part) => part === 'node_modules' || part === '.git')
}

function liveSecretPaths(root: string): string[] {
  // `git ls-files --others --cached` would miss ignored files, which is where secrets live.
  const out = execFileSync(
    'find',
    [
      '.',
      '(',
      '-name',
      'node_modules',
      '-o',
      '-name',
      '.git',
      ')',
      '-prune',
      '-o',
      '-name',
      '.env*',
      '-type',
      'f',
      '-print',
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 },
  )
  return out
    .split('\n')
    .map((name) => name.replace(/^\.\//, ''))
    .filter((name) => name && isSecretPath(name))
}

export function inTreeArchiveAdapter(deps: InTreeArchiveDeps = {}): ResourceAdapter {
  const verifyArchive = deps.verifyArchive ?? verifyPreservationArchive
  const verifyIntegrity = deps.verifyIntegrity ?? verifyPreservationArchiveIntegrity
  return (profile, context, fields) => {
    for (const field of fields)
      if (field !== 'secrets')
        return { status: 'unsupported', reason: `in-tree-archive cannot cover ${field}` }
    const { archive, sourcePath } = context
    if (!archive) return retain('no verified preservation archive for the secret files in the tree')
    try {
      const options = inventoryOptionsFromProfile(profile)
      const verified = context.integrityOnly
        ? verifyIntegrity(archive, options)
        : verifyArchive(archive, sourcePath, options)
      if (!verified)
        return retain('preservation archive does not verify; in-tree secrets are not preserved')
      // Secrets inside an archive are only as private as its directory.
      for (const dir of [dirname(archive), dirname(dirname(archive))]) {
        if ((lstatSync(dir).mode & 0o077) !== 0)
          return retain(
            `archive directory ${dir} is not owner-only; retain in-tree secrets (chmod 700 it to release)`,
          )
      }
      if (!context.treeExists) return { status: 'released' }
      const members = archiveMembers(archive)
      for (const secret of liveSecretPaths(sourcePath)) {
        const member = members.get(secret)
        if (member === undefined) return retain(`archive is missing secret file ${secret}`)
        const archived = execFileSync(
          'tar',
          ['--extract', '--to-stdout', '--file', archive, member],
          {
            maxBuffer: 1 << 26,
          },
        )
        if (sha256(archived) !== sha256(readFileSync(join(sourcePath, secret))))
          return retain(`archived secret file ${secret} differs from the live file`)
      }
      return { status: 'released' }
    } catch (error) {
      return retain(`secret archive check failed: ${errorText(error)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// worktree-db: clone database, PostgREST/storage sidecars and the storage volume live outside
// the tree. Released only when every read-only inventory shows nothing for ANY candidate
// identity. `clone-state`/`status`/`residueAbsent` are NEVER evidence: they answer absent when
// the manifest file is gone even though the database or container remains.
// ---------------------------------------------------------------------------

export interface WorktreeDbIdentity {
  sourcePath: string
  branch?: string
  treeExists: boolean
}

export interface WorktreeDbCandidate {
  dbName: string
  slug?: string
  sidecarContainerName?: string | null
  storageContainerName?: string | null
  storageVolumeName?: string | null
}

/** Read-only probes. Every method may throw; the adapter treats a throw as `retain`. */
export interface WorktreeDbEvidence {
  /** All identities this tree could have been provisioned under (managed block, branch slug, path basename). */
  candidates(identity: WorktreeDbIdentity): WorktreeDbCandidate[]
  lifecycleInventory(): unknown
  sidecarInventory(): unknown
  storageInventory(): unknown
  storageState(candidate: WorktreeDbCandidate): unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function candidateTokens(candidate: WorktreeDbCandidate): Set<string> {
  return new Set(
    [
      candidate.dbName,
      candidate.slug,
      candidate.sidecarContainerName,
      candidate.storageContainerName,
      candidate.storageVolumeName,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0),
  )
}

function entryStrings(entry: Record<string, unknown>): string[] {
  const strings: string[] = []
  const visit = (value: unknown, depth: number) => {
    if (typeof value === 'string') strings.push(value)
    else if (depth < 2 && isRecord(value))
      for (const inner of Object.values(value)) visit(inner, depth + 1)
  }
  visit(entry, 0)
  return strings
}

/**
 * A `lifecycle-inventory` entry that is only a leftover manifest: the inventory explicitly
 * reports `dbExists === false` (a boolean from the pg_database enumeration, never inferred from
 * `ownership`/`manifest`), and there is no ownership marker and no orphan flag. No database is
 * left to release, so it does not block. A missing or non-boolean `dbExists` (an older remote)
 * is NOT this case and keeps retaining.
 */
function isManifestOnlyResidue(entry: Record<string, unknown>): boolean {
  return (
    entry.dbExists === false &&
    (entry.marker === null || entry.marker === undefined) &&
    entry.orphan !== true
  )
}

/**
 * Entries listed for any candidate. `undefined` when the response lacks the expected array.
 * `ignore` drops entries the caller has positively classified as holding nothing.
 */
function matchingEntries(
  response: unknown,
  key: 'resources' | 'storageResources',
  candidates: WorktreeDbCandidate[],
  ignore?: (entry: Record<string, unknown>) => boolean,
): number | undefined {
  if (!isRecord(response) || !Array.isArray(response[key])) return undefined
  const tokens = new Set(candidates.flatMap((candidate) => [...candidateTokens(candidate)]))
  let matches = 0
  for (const entry of response[key] as unknown[]) {
    // An entry we cannot read is an entry we cannot rule out.
    if (!isRecord(entry)) return Number.POSITIVE_INFINITY
    if (entryStrings(entry).some((value) => tokens.has(value)) && !ignore?.(entry)) matches += 1
  }
  return matches
}

export function worktreeDbAdapter(evidence: WorktreeDbEvidence | undefined): ResourceAdapter {
  return (_profile, context, fields) => {
    for (const field of fields)
      if (field === 'secrets')
        return { status: 'unsupported', reason: 'worktree-db cannot cover secrets' }
    if (!evidence) return retain('no worktree-db release evidence is available; retain')
    try {
      const candidates = evidence.candidates({
        sourcePath: context.sourcePath,
        branch: context.branch,
        treeExists: context.treeExists,
      })
      if (!Array.isArray(candidates) || candidates.length === 0)
        return retain('no worktree-db identity could be derived for this source; retain')
      const probes: Array<[string, number | undefined]> = [
        [
          'clone database',
          matchingEntries(
            evidence.lifecycleInventory(),
            'resources',
            candidates,
            isManifestOnlyResidue,
          ),
        ],
        [
          'PostgREST sidecar',
          matchingEntries(evidence.sidecarInventory(), 'resources', candidates),
        ],
        [
          'storage container',
          matchingEntries(evidence.storageInventory(), 'storageResources', candidates),
        ],
      ]
      for (const [what, count] of probes) {
        if (count === undefined) return retain(`${what} inventory is malformed; retain`)
        if (count > 0) return retain(`${what} still exists for this worktree; release it first`)
      }
      for (const candidate of candidates) {
        if (!candidate.storageVolumeName)
          return retain('storage volume name could not be derived; retain')
        const state = evidence.storageState(candidate)
        if (
          !isRecord(state) ||
          typeof state.volumeExists !== 'boolean' ||
          typeof state.running !== 'boolean'
        )
          return retain('storage state is malformed; retain')
        if (state.volumeExists || state.running)
          return retain(
            `storage volume ${candidate.storageVolumeName} still exists; release it first`,
          )
      }
      return { status: 'released' }
    } catch (error) {
      return retain(`worktree-db release evidence failed: ${errorText(error)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Production evidence: the read-only entry `worktree-db/release-evidence.mjs`, run once per
// source path. It derives the candidate identities (managed block `WORKTREE_DB_NAME`, branch
// slug, path basename) and returns the raw lifecycle/sidecar/storage inventories and the
// storage state; the adapter above judges them. One child process per path, never cached across
// paths, so a dry-run and the real run both read the world as it is now.
// ---------------------------------------------------------------------------

export interface WorktreeDbCliEvidenceDeps {
  /** Absolute path of release-evidence.mjs. Default: the clade or consumer projection layout. */
  entry?: string
  /** Runs the entry with `args` and returns its stdout. Tests inject a fake; default spawns node. */
  run?: (entry: string, args: string[]) => string
}

/** clade: `vendor/scripts/worktree-db/`; consumer projection: `vendor/scripts/worktree-db/` under the repo root. */
const RELEASE_EVIDENCE_ENTRIES = [
  './worktree-db/release-evidence.mjs',
  '../vendor/scripts/worktree-db/release-evidence.mjs',
]

function resolveReleaseEvidenceEntry(): string | undefined {
  for (const relative of RELEASE_EVIDENCE_ENTRIES) {
    const path = fileURLToPath(new URL(relative, import.meta.url))
    if (existsSync(path)) return path
  }
  return undefined
}

const probeError = (value: unknown): string | undefined =>
  isRecord(value) && typeof value.error === 'string' ? value.error : undefined

/**
 * `undefined` when the repo does not carry the worktree-db scripts at all (the adapter then
 * retains, fail-closed). Constructing it touches nothing remote.
 */
export function productionWorktreeDbEvidence(
  deps: WorktreeDbCliEvidenceDeps = {},
): WorktreeDbEvidence | undefined {
  const entry = deps.entry ?? resolveReleaseEvidenceEntry()
  if (!entry) return undefined
  const run =
    deps.run ??
    ((script: string, args: string[]) =>
      execFileSync(process.execPath, [script, ...args], {
        encoding: 'utf8',
        maxBuffer: 1 << 26,
        timeout: 300_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }))
  let probe: Record<string, unknown> | undefined
  const field = (name: string): unknown => {
    if (!probe) throw new Error('worktree-db release evidence was not collected for this source')
    const failed = probeError(probe[name])
    if (failed !== undefined) throw new Error(`${name} probe failed: ${failed}`)
    return probe[name]
  }
  return {
    candidates(identity) {
      probe = undefined
      const args = ['--path', identity.sourcePath]
      if (identity.branch) args.push('--branch', identity.branch)
      if (!identity.treeExists) args.push('--tree-gone')
      const parsed: unknown = JSON.parse(run(entry, args))
      if (!isRecord(parsed)) throw new Error('release-evidence returned a non-object')
      probe = parsed
      return field('candidates') as WorktreeDbCandidate[]
    },
    lifecycleInventory: () => field('lifecycleInventory'),
    sidecarInventory: () => field('sidecarInventory'),
    storageInventory: () => field('storageInventory'),
    storageState(candidate) {
      const states = field('storageState')
      const key = String(candidate.storageVolumeName)
      if (!isRecord(states) || !(key in states))
        throw new Error(`no storage state collected for ${key}`)
      const failed = probeError(states[key])
      if (failed !== undefined) throw new Error(`storage-state probe failed: ${failed}`)
      return states[key]
    },
  }
}

// ---------------------------------------------------------------------------
// local-supabase: a plain `supabase start` consumer (no worktree-db topology). The stack is named
// by `supabase/config.toml` `project_id`; a tree that keeps main's id shares main's stack and owns
// nothing outside itself. A tree with its own id owns docker volumes/containers labelled
// `com.supabase.cli.project=<id>` — any of them left means retain.
// ---------------------------------------------------------------------------

export interface LocalSupabaseDeps {
  /** Runs `docker <args>` and returns stdout. Tests inject a fake; default spawns docker. */
  docker?: (args: string[]) => string
  /** Returns the tree's `supabase/config.toml` text (from the live tree or its archive). */
  readConfig?: (context: ResourceReleaseContext) => string
}

const SUPABASE_PROJECT_LABEL = 'com.supabase.cli.project'
const SUPABASE_CONFIG = 'supabase/config.toml'
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

function defaultReadConfig(context: ResourceReleaseContext): string {
  if (context.treeExists) return readFileSync(join(context.sourcePath, SUPABASE_CONFIG), 'utf8')
  if (!context.archive) throw new Error('source tree is gone and no archive holds its config.toml')
  const member = archiveMembers(context.archive).get(SUPABASE_CONFIG)
  if (member === undefined) throw new Error(`archive has no ${SUPABASE_CONFIG}`)
  return execFileSync('tar', ['--extract', '--to-stdout', '--file', context.archive, member], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  })
}

/** Top-level `project_id = "…"` (before the first table header); undefined unless exactly one. */
export function parseSupabaseProjectId(toml: string): string | undefined {
  const ids: string[] = []
  for (const line of toml.split('\n')) {
    const text = line.trim()
    if (text.startsWith('[')) break
    const match = /^project_id\s*=\s*(?:"([^"]*)"|'([^']*)')\s*(?:#.*)?$/.exec(text)
    if (match) ids.push(match[1] ?? match[2] ?? '')
  }
  return ids.length === 1 ? ids[0] : undefined
}

const defaultDocker = (args: string[]) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 60_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

export function localSupabaseAdapter(deps: LocalSupabaseDeps = {}): ResourceAdapter {
  const docker = deps.docker ?? defaultDocker
  const readConfig = deps.readConfig ?? defaultReadConfig
  return (profile, context, fields) => {
    for (const field of fields)
      if (field === 'secrets')
        return { status: 'unsupported', reason: 'local-supabase cannot cover secrets' }
    const canonical = profile.localSupabase?.canonicalProjectId
    if (!canonical) return retain('profile declares no canonical supabase project_id; retain')
    try {
      const projectId = parseSupabaseProjectId(readConfig(context))
      if (projectId === undefined)
        return retain(`${SUPABASE_CONFIG} has no single top-level project_id; retain`)
      if (projectId === canonical) return { status: 'released' }
      if (!PROJECT_ID.test(projectId))
        return retain(`supabase project_id ${JSON.stringify(projectId)} is not a safe id; retain`)
      const filter = `label=${SUPABASE_PROJECT_LABEL}=${projectId}`
      const probes: Array<[string, string[]]> = [
        ['docker volume', ['volume', 'ls', '-q', '--filter', filter]],
        ['docker container', ['ps', '-a', '-q', '--filter', filter]],
      ]
      for (const [what, args] of probes)
        if (docker(args).trim().length > 0)
          return retain(
            `${what} labelled ${SUPABASE_PROJECT_LABEL}=${projectId} still exists; supabase stop --no-backup it first`,
          )
      return { status: 'released' }
    } catch (error) {
      return retain(`local-supabase check failed: ${errorText(error)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export function defaultResourceAdapters(evidence?: WorktreeDbEvidence): ResourceAdapterSet {
  return {
    'in-tree-archive': inTreeArchiveAdapter(),
    'worktree-db': worktreeDbAdapter(evidence),
    'local-supabase': localSupabaseAdapter(),
  }
}

export interface ResourceVerdictOptions {
  /** Restrict to these adapters (e.g. only `worktree-db` before an archive exists). */
  only?: ResourceAdapterName[]
}

/** Combined verdict over every declared-present resource field. */
export function resourceVerdict(
  profile: ConsumerProfile,
  context: ResourceReleaseContext,
  adapters: ResourceAdapterSet = defaultResourceAdapters(),
  options: ResourceVerdictOptions = {},
): ResourceVerdict {
  const byAdapter = new Map<ResourceAdapterName, ResourceField[]>()
  for (const field of Object.keys(profile.resources) as ResourceField[]) {
    if (profile.resources[field] === 'verified-absent') continue
    const name = profile.resourceAdapters?.[field]
    if (
      !name ||
      !Object.hasOwn(RESOURCE_ADAPTER_FIELDS, name) ||
      !RESOURCE_ADAPTER_FIELDS[name].includes(field)
    )
      return {
        status: 'unsupported',
        reason: `Resource preservation adapters are required before a source can be removed (resources.${field})`,
      }
    byAdapter.set(name, [...(byAdapter.get(name) ?? []), field])
  }
  let blocked: ResourceVerdict | undefined
  for (const [name, fields] of byAdapter) {
    if (options.only && !options.only.includes(name)) continue
    const adapter = adapters[name]
    let verdict: ResourceVerdict
    if (!adapter)
      verdict = { status: 'unsupported', reason: `resource adapter ${name} is not registered` }
    else {
      try {
        verdict = adapter(profile, context, fields)
      } catch (error) {
        verdict = retain(`resource adapter ${name} failed: ${errorText(error)}`)
      }
    }
    if (verdict.status === 'unsupported') return verdict
    if (verdict.status === 'retain') blocked ??= verdict
  }
  return blocked ?? { status: 'released' }
}

/** Throws unless every declared-present resource is released for this source path. */
export function assertResourcesReleased(
  profile: ConsumerProfile,
  context: ResourceReleaseContext,
  adapters: ResourceAdapterSet = defaultResourceAdapters(),
  options: ResourceVerdictOptions = {},
): void {
  const verdict = resourceVerdict(profile, context, adapters, options)
  if (verdict.status !== 'released')
    throw new Error(`${verdict.reason}; source retained (${context.sourcePath})`)
}
