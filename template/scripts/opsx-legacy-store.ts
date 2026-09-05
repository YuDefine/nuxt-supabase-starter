// 🔒 LOCKED — managed by clade · Source: vendor/scripts/opsx-legacy-store.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/opsx-legacy-store.ts
import { DatabaseSync } from 'node:sqlite'
import { existsSync, lstatSync, readdirSync, realpathSync, statSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

/**
 * Read the retired Spectra store without using the retired executable.
 *
 * This module is deliberately a reader only.  The database is opened with
 * SQLite's readOnly option and all lookup values are bound parameters.  The
 * store is historical evidence: absence, an unsupported schema, corruption,
 * and a missing artifact directory are different observations and are never
 * represented as an empty successful result.
 */

export type LegacyStoreStatus = 'available' | 'missing' | 'unsupported' | 'corrupt'
export type LegacyArtifactStatus = 'available' | 'missing' | 'unsupported' | 'corrupt'
export type LegacyChangeState = 'parked' | 'stashed' | 'in-progress'
export type LegacyCapabilityStatus = 'present' | 'absent' | 'unknown'

export interface LegacyStoreCapabilities {
  parked: LegacyCapabilityStatus
  stashed: LegacyCapabilityStatus
  in_progress: LegacyCapabilityStatus
}

export interface LegacyChangeMetadata {
  change_id: string
  state: LegacyChangeState
  original_modified: string | number | null
  tasks_total: number | null
  tasks_done: number | null
  has_proposal: boolean | null
  has_tasks: boolean | null
  created_by: string | null
  created_with: string | null
}

export interface LegacyStoreSnapshot {
  status: LegacyStoreStatus
  common_dir: string | null
  database_path: string | null
  capabilities: LegacyStoreCapabilities
  parked: LegacyChangeMetadata[]
  stashed: LegacyChangeMetadata[]
  in_progress: LegacyChangeMetadata[]
  error: { code: string; message: string } | null
}

export interface LegacyArtifactFile {
  path: string
  kind: 'proposal' | 'design' | 'tasks' | 'spec'
  size_bytes: number
  digest: `sha256:${string}`
  preview: string
  preview_truncated: boolean
  authority: 'raw-historical-record'
}

export interface LegacyChangeRead {
  status: LegacyStoreStatus
  artifact_status: LegacyArtifactStatus
  change_id: string
  metadata: LegacyChangeMetadata[]
  common_dir: string | null
  database_path: string | null
  capabilities: LegacyStoreCapabilities
  artifact_root: string | null
  files: LegacyArtifactFile[]
  truncated: boolean
  truncation_reasons: string[]
  error: { code: string; message: string } | null
}

const MAX_CHANGE_ID_LENGTH = 128
const MAX_ARTIFACT_FILE_BYTES = 16 * 1024 * 1024
const MAX_PREVIEW_BYTES = 8 * 1024
const MAX_VISITED_PATHS = 10_000
const MAX_WALK_DEPTH = 32
const CHANGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const STORE_RELATIVE_PATH = ['spectra-app', 'spectra.db'] as const
const ARTIFACT_DIRECTORY = ['spectra-app', 'changes'] as const

class UnsupportedLegacySchema extends Error {}

function failure(status: LegacyStoreStatus, code: string, message: string): LegacyStoreSnapshot {
  return {
    status,
    common_dir: null,
    database_path: null,
    capabilities: { parked: 'unknown', stashed: 'unknown', in_progress: 'unknown' },
    parked: [],
    stashed: [],
    in_progress: [],
    error: { code, message },
  }
}

function validChangeId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_CHANGE_ID_LENGTH && CHANGE_ID.test(value)
}

export function assertLegacyChangeId(value: string): string {
  if (!validChangeId(value)) {
    throw new Error(
      `legacy change id must be an exact slug (letters, digits, '.', '_' or '-'): ${value}`,
    )
  }
  return value
}

function confinedPath(root: string, parts: readonly string[], label: string): string {
  const candidate = resolve(root, ...parts)
  const rel = relative(root, candidate)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${requireSeparator()}`)) {
    throw new Error(`${label} escapes its root: ${parts.join('/')}`)
  }
  let current = root
  for (const part of parts) {
    current = join(current, part)
    if (!existsSync(current)) continue
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} contains a symlink: ${current}`)
    }
  }
  if (existsSync(candidate)) {
    const actual = realpathSync(candidate)
    const actualRel = relative(root, actual)
    if (
      isAbsolute(actualRel) ||
      actualRel === '..' ||
      actualRel.startsWith(`..${requireSeparator()}`)
    ) {
      throw new Error(`${label} resolves outside its root: ${candidate}`)
    }
  }
  return candidate
}

function requireSeparator(): string {
  return process.platform === 'win32' ? '\\' : '/'
}

function commonDirFor(repoRoot: string): string {
  const raw = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  if (!raw) throw new Error('git returned an empty common directory')
  const common = realpathSync(resolve(repoRoot, raw))
  if (!statSync(common).isDirectory())
    throw new Error(`git common directory is not a directory: ${common}`)
  return common
}

function readText(value: unknown): string | null {
  return typeof value === 'string'
    ? value
    : value === null || value === undefined
      ? null
      : String(value)
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === 0 || value === 1) return value === 1
  return null
}

function metadataRow(row: Record<string, unknown>, state: LegacyChangeState): LegacyChangeMetadata {
  const id = readText(row.change_id)
  if (!id || !validChangeId(id))
    throw new Error(`legacy store contains an invalid change id: ${String(id)}`)
  return {
    change_id: id,
    state,
    original_modified:
      typeof row.original_modified === 'string' || typeof row.original_modified === 'number'
        ? row.original_modified
        : null,
    tasks_total: readNumber(row.tasks_total),
    tasks_done: readNumber(row.tasks_done),
    has_proposal: readBoolean(row.has_proposal),
    has_tasks: readBoolean(row.has_tasks),
    created_by: readText(row.created_by),
    created_with: readText(row.created_with),
  }
}

const REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  parked_changes: [
    'change_id',
    'original_modified',
    'tasks_total',
    'tasks_done',
    'has_proposal',
    'has_tasks',
    'created_by',
    'created_with',
  ],
  stashed_changes: [
    'change_id',
    'original_modified',
    'tasks_total',
    'tasks_done',
    'has_proposal',
    'has_tasks',
    'created_by',
    'created_with',
  ],
  in_progress_change: ['change_id'],
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name?: unknown }>
  return new Set(rows.map((row) => String(row.name ?? '')))
}

function ensureSchema(db: DatabaseSync): LegacyStoreCapabilities {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
    name?: unknown
  }>
  const available = new Set(tables.map((row) => String(row.name ?? '')))
  if (!available.has('parked_changes'))
    throw new UnsupportedLegacySchema('legacy store schema missing table parked_changes')
  const parkedColumns = tableColumns(db, 'parked_changes')
  const missingParked = REQUIRED_COLUMNS.parked_changes.filter(
    (column) => !parkedColumns.has(column),
  )
  if (missingParked.length > 0)
    throw new UnsupportedLegacySchema(
      `legacy store schema missing parked_changes columns: ${missingParked.join(', ')}`,
    )

  const hasStashed = available.has('stashed_changes')
  const hasInProgress = available.has('in_progress_change')
  // These are the two observed pre-stashed schemas. A parked+stashed database without the
  // in-progress table is not a known release and must remain unsupported.
  if (hasStashed && !hasInProgress) {
    throw new UnsupportedLegacySchema(
      'legacy store schema has stashed_changes but missing table in_progress_change',
    )
  }
  if (hasStashed) {
    const actual = tableColumns(db, 'stashed_changes')
    const missing = REQUIRED_COLUMNS.stashed_changes.filter((column) => !actual.has(column))
    if (missing.length > 0)
      throw new UnsupportedLegacySchema(
        `legacy store schema missing stashed_changes columns: ${missing.join(', ')}`,
      )
  }
  if (hasInProgress) {
    const actual = tableColumns(db, 'in_progress_change')
    const missing = REQUIRED_COLUMNS.in_progress_change.filter((column) => !actual.has(column))
    if (missing.length > 0)
      throw new UnsupportedLegacySchema(
        `legacy store schema missing in_progress_change columns: ${missing.join(', ')}`,
      )
  }
  return {
    parked: 'present',
    stashed: hasStashed ? 'present' : 'absent',
    in_progress: hasInProgress ? 'present' : 'absent',
  }
}

function readSnapshotFromDatabase(commonDir: string, databasePath: string): LegacyStoreSnapshot {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(databasePath, { readOnly: true })
  } catch (error) {
    return failure(
      'corrupt',
      'database-open-failed',
      `legacy store cannot be opened read-only: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  try {
    const capabilities = ensureSchema(db)
    const select = (table: string): Array<Record<string, unknown>> =>
      db
        .prepare(
          `SELECT change_id, original_modified, tasks_total, tasks_done, has_proposal, has_tasks, created_by, created_with FROM "${table}" ORDER BY change_id`,
        )
        .all() as Array<Record<string, unknown>>
    const stashed = capabilities.stashed === 'present' ? select('stashed_changes') : []
    const inProgress =
      capabilities.in_progress === 'present'
        ? (db
            .prepare('SELECT change_id FROM "in_progress_change" ORDER BY change_id')
            .all() as Array<Record<string, unknown>>)
        : []
    return {
      status: 'available',
      common_dir: commonDir,
      database_path: databasePath,
      capabilities,
      parked: select('parked_changes').map((row) => metadataRow(row, 'parked')),
      stashed: stashed.map((row) => metadataRow(row, 'stashed')),
      in_progress: inProgress.map((row) => metadataRow(row, 'in-progress')),
      error: null,
    }
  } catch (error) {
    const unsupported = error instanceof UnsupportedLegacySchema
    return failure(
      unsupported ? 'unsupported' : 'corrupt',
      unsupported ? 'schema-unsupported' : 'database-query-failed',
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    db.close()
  }
}

export function readLegacyStore(repoRoot: string): LegacyStoreSnapshot {
  let commonDir: string
  try {
    commonDir = commonDirFor(repoRoot)
  } catch (error) {
    return failure(
      'missing',
      'common-directory-unavailable',
      error instanceof Error ? error.message : String(error),
    )
  }
  let databasePath: string
  try {
    databasePath = confinedPath(commonDir, STORE_RELATIVE_PATH, 'legacy store database')
  } catch (error) {
    return failure(
      'unsupported',
      'database-path-invalid',
      error instanceof Error ? error.message : String(error),
    )
  }
  if (!existsSync(databasePath)) {
    return {
      status: 'missing',
      common_dir: commonDir,
      database_path: databasePath,
      capabilities: { parked: 'unknown', stashed: 'unknown', in_progress: 'unknown' },
      parked: [],
      stashed: [],
      in_progress: [],
      error: {
        code: 'database-missing',
        message: `legacy store database not found: ${databasePath}`,
      },
    }
  }
  if (!statSync(databasePath).isFile()) {
    return failure(
      'unsupported',
      'database-not-file',
      `legacy store database is not a regular file: ${databasePath}`,
    )
  }
  return readSnapshotFromDatabase(commonDir, databasePath)
}

function artifactKind(path: string): LegacyArtifactFile['kind'] | null {
  const rel = path.replaceAll('\\', '/')
  const name = basename(rel).toLowerCase()
  if (name === 'proposal.md') return 'proposal'
  if (name === 'design.md') return 'design'
  if (name === 'tasks.md') return 'tasks'
  if (rel === 'specs' || rel.startsWith('specs/')) return 'spec'
  return null
}

function artifactFiles(
  root: string,
  limit: number,
): { files: LegacyArtifactFile[]; truncated: boolean; reasons: string[] } {
  const paths: string[] = []
  const reasons = new Set<string>()
  let visited = 0
  const walk = (current: string, depth: number): void => {
    if (depth > MAX_WALK_DEPTH) {
      reasons.add(`maximum directory depth ${MAX_WALK_DEPTH} reached`)
      return
    }
    for (const entry of readdirSync(current, { withFileTypes: true }).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      visited += 1
      if (visited > MAX_VISITED_PATHS) {
        reasons.add(`maximum visited paths ${MAX_VISITED_PATHS} reached`)
        return
      }
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`legacy artifact contains a symlink: ${path}`)
      if (entry.isDirectory()) {
        walk(path, depth + 1)
      } else if (entry.isFile() && artifactKind(relative(root, path))) {
        if (paths.length < limit) paths.push(path)
        else reasons.add(`history limit ${limit} reached`)
      }
      if (reasons.has(`maximum visited paths ${MAX_VISITED_PATHS} reached`)) return
    }
  }
  walk(root, 0)
  const files = paths.map((path) => {
    const size = statSync(path).size
    if (size > MAX_ARTIFACT_FILE_BYTES)
      throw new Error(`legacy artifact exceeds ${MAX_ARTIFACT_FILE_BYTES} bytes: ${path}`)
    const bytes = readFileSync(path)
    if (bytes.byteLength > MAX_ARTIFACT_FILE_BYTES)
      throw new Error(`legacy artifact exceeds ${MAX_ARTIFACT_FILE_BYTES} bytes: ${path}`)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const kind = artifactKind(relative(root, path))
    if (!kind) throw new Error(`unsupported legacy artifact: ${path}`)
    return {
      path,
      kind,
      size_bytes: bytes.byteLength,
      digest: `sha256:${hash}` as `sha256:${string}`,
      preview: bytes.subarray(0, MAX_PREVIEW_BYTES).toString('utf8'),
      preview_truncated: bytes.byteLength > MAX_PREVIEW_BYTES,
      authority: 'raw-historical-record' as const,
    }
  })
  return { files, truncated: reasons.size > 0, reasons: [...reasons] }
}

export function readLegacyChange(input: {
  repoRoot: string
  changeId: string
  limit?: number
}): LegacyChangeRead {
  const changeId = assertLegacyChangeId(input.changeId)
  const limit = input.limit ?? 100
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000)
    throw new Error('--limit must be an integer between 1 and 10000')
  const store = readLegacyStore(input.repoRoot)
  const metadata = [...store.parked, ...store.stashed, ...store.in_progress].filter(
    (row) => row.change_id === changeId,
  )
  if (store.status !== 'available') {
    return {
      status: store.status,
      artifact_status: store.status,
      change_id: changeId,
      metadata,
      common_dir: store.common_dir,
      database_path: store.database_path,
      capabilities: store.capabilities,
      artifact_root: null,
      files: [],
      truncated: false,
      truncation_reasons: [],
      error: store.error,
    }
  }
  if (metadata.length === 0) {
    return {
      status: 'available',
      artifact_status: 'missing',
      change_id: changeId,
      metadata: [],
      common_dir: store.common_dir,
      database_path: store.database_path,
      capabilities: store.capabilities,
      artifact_root: null,
      files: [],
      truncated: false,
      truncation_reasons: [],
      error: {
        code: 'change-missing',
        message: `legacy change is not present in the historical store: ${changeId}`,
      },
    }
  }
  const common = store.common_dir as string
  let root: string
  try {
    root = confinedPath(common, [...ARTIFACT_DIRECTORY, changeId], 'legacy artifact root')
  } catch (error) {
    return {
      status: 'available',
      artifact_status: 'unsupported',
      change_id: changeId,
      metadata,
      common_dir: common,
      database_path: store.database_path,
      capabilities: store.capabilities,
      artifact_root: null,
      files: [],
      truncated: false,
      truncation_reasons: [],
      error: {
        code: 'artifact-path-invalid',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
  if (!existsSync(root)) {
    return {
      status: 'available',
      artifact_status: 'missing',
      change_id: changeId,
      metadata,
      common_dir: common,
      database_path: store.database_path,
      capabilities: store.capabilities,
      artifact_root: root,
      files: [],
      truncated: false,
      truncation_reasons: [],
      error: { code: 'artifact-missing', message: `legacy artifact directory not found: ${root}` },
    }
  }
  try {
    if (!statSync(root).isDirectory())
      throw new Error(`legacy artifact root is not a directory: ${root}`)
    const result = artifactFiles(root, limit)
    return {
      status: 'available',
      artifact_status: 'available',
      change_id: changeId,
      metadata,
      common_dir: common,
      database_path: store.database_path,
      capabilities: store.capabilities,
      artifact_root: root,
      files: result.files,
      truncated: result.truncated,
      truncation_reasons: result.reasons,
      error: null,
    }
  } catch (error) {
    return {
      status: 'available',
      artifact_status: 'corrupt',
      change_id: changeId,
      metadata,
      common_dir: common,
      database_path: store.database_path,
      capabilities: store.capabilities,
      artifact_root: root,
      files: [],
      truncated: false,
      truncation_reasons: [],
      error: {
        code: 'artifact-read-failed',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

export function legacyChanges(snapshot: LegacyStoreSnapshot): LegacyChangeMetadata[] {
  return [...snapshot.parked, ...snapshot.stashed, ...snapshot.in_progress].toSorted(
    (a, b) => a.change_id.localeCompare(b.change_id) || a.state.localeCompare(b.state),
  )
}

// This standalone reader is also installed in consumers without project automation.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--repo-root') {
    console.error('Usage: opsx-legacy-store.ts --repo-root <path>')
    process.exitCode = 2
  } else {
    const snapshot = readLegacyStore(resolve(args[1]))
    console.log(JSON.stringify(snapshot))
  }
}
