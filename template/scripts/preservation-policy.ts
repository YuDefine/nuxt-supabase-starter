// 🔒 LOCKED — managed by clade · Source: vendor/scripts/preservation-policy.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/preservation-policy.ts
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'

export const PRESERVATION_POLICY_ID = 'P0-full-preserve-v1'
export const PRESERVATION_SCHEMA_VERSION = 1
const GIB = 1024 ** 3

// Worktree teardown records its private-metadata renames in
// `<gitdir>/.clade-teardown-journal` so a crash mid-detach never leaves an
// unrecorded rename. It is operational metadata — excluded from inventory
// comparisons on the live, quarantine, and trashed sides alike.
export const WT_TEARDOWN_JOURNAL_NAME = '.clade-teardown-journal'

// The teardown journal is read as a fold: `detach` owns a pointer until a
// later `restored` line retires it, and the last `modules` stands until
// `modules-restored`. Both teardown (which generation owns this teardown)
// and reattach (what to undo) consult the same fold — never name-prefix
// guesses, or a foreign `.clade-torn-down-modules*` sibling could drive a
// detach or a restore the journal never owned.
export function readTeardownJournal(privateGitDir: string): {
  tornDown: string | undefined
  detached: Set<string>
  retired: Set<string>
} {
  const active = {
    tornDown: undefined as string | undefined,
    detached: new Set<string>(),
    retired: new Set<string>(),
  }
  try {
    const journalPath = join(privateGitDir, WT_TEARDOWN_JOURNAL_NAME)
    // A symlinked journal would feed another file's bytes into replay
    // decisions — ownership exists but cannot be trusted, so fail closed
    // like any other unreadable-journal state rather than parse it.
    const st = lstatSync(journalPath)
    if (!st.isFile()) throw new Error(`Teardown journal is not a regular file: ${journalPath}`)
    // A hard-linked journal's bytes are writable through the other link —
    // its records cannot be trusted to be ours, so fail closed.
    if (st.nlink > 1) throw new Error(`Teardown journal is multiply linked: ${journalPath}`)
    const raw = readFileSync(journalPath, 'utf8')
    const lines = raw.split('\n')
    // A crash mid-append leaves an unterminated tail — a truncated record can
    // name a different detached path or generation, and folding it would
    // misdirect recovery. The append-open repair truncates the tail, but a
    // read that runs first must not fold it: only newline-terminated lines
    // are committed records.
    if (!raw.endsWith('\n')) lines.pop()
    for (const line of lines) {
      // Path values are byte-exact — a checkout named ` sub` records
      // `detach  sub/...`, and trimming would claim a different path.
      if (line.startsWith('modules ')) active.tornDown = line.slice(8)
      else if (line === 'modules-restored') active.tornDown = undefined
      else if (line.startsWith('detach ')) {
        const rel = line.slice(7)
        active.detached.add(rel)
        active.retired.delete(rel)
      } else if (line.startsWith('restored ')) {
        const rel = line.slice(9)
        active.detached.delete(rel)
        active.retired.add(rel)
      }
    }
  } catch (error) {
    // ENOENT means no journal — no recorded ownership. Any other failure
    // (EACCES, EIO, a directory at the journal name) means ownership
    // exists but cannot be read: propagate so callers fail closed rather
    // than supersede a live generation or replay stale records.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return active
}

export type EvidenceState = 'declared-present' | 'verified-absent' | 'unknown'
export type InventoryEntryType = 'file' | 'directory' | 'symlink' | 'hardlink' | 'special'

export interface ConsumerProfile {
  id: string
  version: number
  roots: { source: string; forbidden?: string[] }
  topology: {
    nestedRepositories: EvidenceState
    submodules: EvidenceState
    sharedGitObjects: EvidenceState
    lfs: EvidenceState
  }
  resources: {
    databases: EvidenceState
    volumes: EvidenceState
    sidecars: EvidenceState
    secrets: EvidenceState
  }
  filesystem: {
    externalSymlinks: EvidenceState
    /**
     * When set with `externalSymlinks: 'declared-present'`, the only source-relative paths
     * allowed to be external symlinks. Anything else fails closed, so the declaration cannot
     * silently cover a symlink into a secret or a shared store.
     */
    externalSymlinkAllowlist?: string[]
    specialFiles: EvidenceState
    acl: EvidenceState
    xattr: EvidenceState
  }
  retention: {
    destination: string
    owner: string
    /** Fixture override; omitted production profiles keep the 40 GiB floor. */
    byteReserve?: number
    inodeReserve?: number
  }
}

export interface InventoryEntry {
  path: string
  type: InventoryEntryType
  mode: number
  size: number
  allocatedBytes: number
  uid: number
  gid: number
  mtimeMs: number
  digest?: string
  aclDigest?: string
  xattrDigest?: string
  target?: string
}

export interface InventoryOptions {
  acl?: boolean
  xattr?: boolean
  expectedProfile?: { id: string; version: number }
  allowMissingSymlinkTargets?: boolean
  allowExternalSymlinks?: boolean
  allowNestedRepositories?: boolean
}

export function inventoryOptionsFromProfile(profile: ConsumerProfile): InventoryOptions {
  return {
    acl: profile.filesystem.acl === 'declared-present',
    xattr: profile.filesystem.xattr === 'declared-present',
    allowMissingSymlinkTargets: profile.filesystem.externalSymlinks === 'declared-present',
    allowExternalSymlinks: profile.filesystem.externalSymlinks === 'declared-present',
    allowNestedRepositories: profile.topology.nestedRepositories === 'declared-present',
    expectedProfile: { id: profile.id, version: profile.version },
  }
}

export interface SourceInventory {
  root: string
  entries: InventoryEntry[]
  logicalBytes: number
  allocatedBytes: number
  entryCount: number
  digest: string
  externalSymlinks: string[]
  specialFiles: string[]
}

export interface CapacityRequirement {
  filesystem: string
  availableBytes: number
  availableInodes: number
  totalBytes: number
  totalInodes: number
  peakBytes: number
  peakInodes: number
  restoreFilesystem?: string
  filesystemId?: string
  restoreFilesystemId?: string
  restoreAvailableBytes?: number
  restoreAvailableInodes?: number
  restorePeakBytes?: number
  restorePeakInodes?: number
  restoreByteReserve?: number
  restoreInodeReserve?: number
  gitBytes?: number
  gitInodes?: number
  byteReserve: number
  inodeReserve: number
}

export interface PreservationReceipt {
  schemaVersion: number
  operationId: string
  policy: { id: string; version: number }
  profile: { id: string; version: number }
  source: { path: string; generation: string; gitCommonDir?: string; head?: string }
  inventory: {
    digest: string
    entries: number
    logicalBytes: number
    allocatedBytes: number
    git?: { digest: string; entries: number; logicalBytes: number; allocatedBytes: number }
  }
  archives: {
    worktree: { path: string; digest: string; bytes: number }
    git?: { path: string; digest: string; bytes: number }
  }
  capacity: CapacityRequirement
  consistency: { method: string; boundary: string }
  state: 'RESTORE_VERIFIED'
  createdAt: string
}

function isCompletedReceipt(value: unknown): value is PreservationReceipt {
  if (typeof value !== 'object' || value === null) return false
  const receipt = value as Record<string, unknown>
  const policy = receipt.policy as Record<string, unknown> | undefined
  const profile = receipt.profile as Record<string, unknown> | undefined
  const source = receipt.source as Record<string, unknown> | undefined
  const inventory = receipt.inventory as Record<string, unknown> | undefined
  const archives = receipt.archives as Record<string, unknown> | undefined
  const worktree = archives?.worktree as Record<string, unknown> | undefined
  const gitInventory = inventory?.git as Record<string, unknown> | undefined
  const gitArchiveSection = archives?.git as Record<string, unknown> | undefined
  const capacity = receipt.capacity as Record<string, unknown> | undefined
  const consistency = receipt.consistency as Record<string, unknown> | undefined
  const digest = (candidate: unknown): candidate is string =>
    typeof candidate === 'string' && /^[0-9a-f]{64}$/.test(candidate)
  const gitObjectId = (candidate: unknown): candidate is string =>
    typeof candidate === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(candidate)
  const nonNegativeInteger = (candidate: unknown): candidate is number =>
    typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0
  const nonNegativeNumber = (candidate: unknown): candidate is number =>
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
  const archive = (candidate: Record<string, unknown> | undefined): boolean =>
    candidate !== undefined &&
    typeof candidate.path === 'string' &&
    candidate.path.length > 0 &&
    digest(candidate.digest) &&
    nonNegativeInteger(candidate.bytes)
  const inventorySection = (candidate: Record<string, unknown> | undefined): boolean =>
    candidate !== undefined &&
    digest(candidate.digest) &&
    nonNegativeInteger(candidate.entries) &&
    nonNegativeInteger(candidate.logicalBytes) &&
    nonNegativeInteger(candidate.allocatedBytes)
  const capacityFields = [
    'availableBytes',
    'availableInodes',
    'totalBytes',
    'totalInodes',
    'peakBytes',
    'peakInodes',
    'restoreAvailableBytes',
    'restoreAvailableInodes',
    'restorePeakBytes',
    'restorePeakInodes',
    'restoreByteReserve',
    'restoreInodeReserve',
    'gitBytes',
    'gitInodes',
    'byteReserve',
    'inodeReserve',
  ]
  const hasGit = source?.gitCommonDir !== undefined
  return (
    receipt.schemaVersion === PRESERVATION_SCHEMA_VERSION &&
    typeof receipt.operationId === 'string' &&
    receipt.operationId.length > 0 &&
    policy?.id === PRESERVATION_POLICY_ID &&
    policy.version === 1 &&
    typeof profile?.id === 'string' &&
    profile.id.length > 0 &&
    nonNegativeInteger(profile.version) &&
    typeof source?.path === 'string' &&
    source.path.length > 0 &&
    typeof source.generation === 'string' &&
    source.generation.length > 0 &&
    (source.gitCommonDir === undefined || typeof source.gitCommonDir === 'string') &&
    (source.head === undefined || gitObjectId(source.head)) &&
    hasGit === (gitArchiveSection !== undefined) &&
    hasGit === (gitInventory !== undefined) &&
    hasGit === (source.head !== undefined) &&
    inventorySection(inventory) &&
    archive(worktree) &&
    (gitArchiveSection === undefined ? gitInventory === undefined : archive(gitArchiveSection)) &&
    (gitInventory === undefined || inventorySection(gitInventory)) &&
    typeof capacity?.filesystem === 'string' &&
    capacity.filesystem.length > 0 &&
    typeof capacity.filesystemId === 'string' &&
    capacity.filesystemId.length > 0 &&
    typeof capacity.restoreFilesystem === 'string' &&
    capacity.restoreFilesystem.length > 0 &&
    typeof capacity.restoreFilesystemId === 'string' &&
    capacity.restoreFilesystemId.length > 0 &&
    capacityFields.every((field) => nonNegativeNumber(capacity[field])) &&
    typeof consistency?.method === 'string' &&
    consistency.method.length > 0 &&
    typeof consistency.boundary === 'string' &&
    consistency.boundary.length > 0 &&
    receipt.state === 'RESTORE_VERIFIED' &&
    typeof receipt.createdAt === 'string' &&
    !Number.isNaN(Date.parse(receipt.createdAt))
  )
}

function sha256File(path: string): string {
  const fd = openSync(path, 'r')
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead = 0
    do {
      bytesRead = readSync(fd, buffer, 0, buffer.length, null)
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead)
    return hash.digest('hex')
  } finally {
    closeSync(fd)
  }
}

function syncFile(path: string): void {
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function syncDirectory(path: string): void {
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function syncDirectoryAndParents(path: string): void {
  let current = resolve(path)
  while (true) {
    syncDirectory(current)
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

function restoreAllocationUpperBound(inventory: SourceInventory, blockSize: number): number {
  return inventory.entries.reduce((total, entry) => {
    if (entry.type === 'hardlink') return total
    const blocks = Math.max(1, Math.ceil(entry.size / blockSize))
    return total + blocks * blockSize
  }, 0)
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function tarSize(root: string, inventory: SourceInventory): number {
  const result = spawnSync(
    'tar',
    [
      '--create',
      '--file',
      '/dev/null',
      '--format=posix',
      '--xattrs',
      '--xattrs-include=*',
      '--acls',
      '--sparse',
      '--numeric-owner',
      '--totals',
      '--directory',
      root,
      '--null',
      '--verbatim-files-from',
      '--no-recursion',
      '--files-from',
      '-',
    ],
    {
      input: inventory.entries.map((entry) => entry.path || '.').join('\0') + '\0',
      encoding: 'utf8',
    },
  )
  if (result.error || result.status !== 0)
    throw new Error(
      `Preservation archive sizing failed for ${root}: ${result.error?.message ?? result.stderr.trim()}`,
    )
  const match = result.stderr.match(/Total bytes written:\s*(\d+)/)
  if (!match) throw new Error(`Preservation archive sizing returned no byte total for ${root}`)
  const size = Number(match[1])
  if (!Number.isSafeInteger(size))
    throw new Error(`Preservation archive size is not a safe integer for ${root}`)
  return size
}

// The identity view of an inventory entry: what an offline restore must
// reproduce. `allocatedBytes` is st_blocks — filesystem-specific allocation
// slack that is evidence for capacity accounting, not identity. A directory
// `mtimeMs` is a topology clock: any child create/delete bumps it (a lockfile
// lifecycle inside a shared Git common dir is enough) without changing a
// preserved byte, and a live shared dir legitimately drifts inside the
// capture window. File `mtimeMs` stays: a rewritten file is real drift the
// archive must not hide.
function inventoryIdentityEntry(entry: InventoryEntry): Record<string, unknown> {
  const identity: Record<string, unknown> = { ...entry }
  delete identity.allocatedBytes
  if (identity.type === 'directory') delete identity.mtimeMs
  return identity
}

function inventoryDigest(entries: InventoryEntry[]): string {
  return sha256Json(entries.map(inventoryIdentityEntry))
}

function modeType(mode: number): InventoryEntryType {
  if ((mode & 0o170000) === 0o040000) return 'directory'
  if ((mode & 0o170000) === 0o120000) return 'symlink'
  if ((mode & 0o170000) === 0o100000) return 'file'
  return 'special'
}

function metadataDigest(path: string, kind: 'acl' | 'xattr'): string {
  const command = kind === 'acl' ? 'getfacl' : 'getfattr'
  const args =
    kind === 'acl'
      ? ['--absolute-names', '--omit-header', '--numeric', path]
      : ['--absolute-names', '--dump', '--no-dereference', '--match=-', path]
  let output: string
  try {
    output = execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Preservation profile declares ${kind}, but ${command} failed: ${detail}`, {
      cause: error,
    })
  }
  const normalized = output
    .split('\n')
    .filter((line) => !line.startsWith('# file: '))
    .join('\n')
  return createHash('sha256').update(normalized).digest('hex')
}

function metadataFor(
  path: string,
  options: InventoryOptions,
): Pick<InventoryEntry, 'aclDigest' | 'xattrDigest'> {
  return {
    ...(options.acl ? { aclDigest: metadataDigest(path, 'acl') } : {}),
    ...(options.xattr ? { xattrDigest: metadataDigest(path, 'xattr') } : {}),
  }
}

function walk(
  root: string,
  current: string,
  entries: InventoryEntry[],
  seen: Map<string, string>,
  options: InventoryOptions,
  excludedRoots: string[],
) {
  for (const child of readdirSync(current, { withFileTypes: true }).toSorted((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const absolute = join(current, child.name)
    if (
      excludedRoots.some((excluded) => absolute === excluded || absolute.startsWith(`${excluded}/`))
    )
      continue
    const path = relative(root, absolute)
    const stat = lstatSync(absolute)
    const type = modeType(stat.mode)
    const entry: InventoryEntry = {
      path,
      type,
      mode: stat.mode & 0o7777,
      // Directory allocated size is filesystem-specific and cannot be restored
      // byte-for-byte. Content size is the stable preservation measure.
      size: type === 'directory' ? 0 : stat.size,
      allocatedBytes: 0,
      uid: stat.uid,
      gid: stat.gid,
      mtimeMs: stat.mtimeMs,
      ...metadataFor(absolute, options),
    }
    if (type === 'file') {
      const identity = `${stat.dev}:${stat.ino}`
      const prior = seen.get(identity)
      if (prior) {
        entry.type = 'hardlink'
        entry.target = prior
      } else {
        seen.set(identity, path)
        entry.digest = sha256File(absolute)
        entry.allocatedBytes = Number(stat.blocks ?? 0) * 512
      }
      entries.push(entry)
      continue
    }
    if (type === 'symlink') {
      entry.target = readlinkSync(absolute)
      entries.push(entry)
      continue
    }
    entries.push(entry)
    if (type === 'directory') walk(root, absolute, entries, seen, options, excludedRoots)
  }
}

// An unchanged-mtime event is not proof of an atime-only read: chmod,
// chown, xattr writes, and a write that restored mtime afterwards all
// report the same mtime. Adjudicate those events by re-capturing the live
// entry and comparing every preservation-relevant field — not the
// timestamp — so only a genuinely unchanged entry stays exempt.
export function liveEntryMatchesInventory(
  root: string,
  entry: InventoryEntry,
  inventoryByPath: ReadonlyMap<string, InventoryEntry>,
  options: InventoryOptions = {},
): boolean {
  const absolute = join(root, entry.path)
  let stat
  try {
    stat = lstatSync(absolute)
  } catch {
    return false
  }
  const liveType = modeType(stat.mode)
  if (entry.type === 'file' || entry.type === 'hardlink') {
    if (liveType !== 'file') return false
  } else if (liveType !== entry.type) return false
  if (
    (stat.mode & 0o7777) !== entry.mode ||
    stat.uid !== entry.uid ||
    stat.gid !== entry.gid ||
    // Directory mtime is not a preserved field — the verify comparators
    // delete it because a dir's mtime only echoes a child create/delete.
    // Comparing it here would flag that echo; a chmod/xattr change on the
    // dir itself is still caught by the identity fields.
    (entry.type !== 'directory' && stat.mtimeMs !== entry.mtimeMs)
  )
    return false
  if (entry.type !== 'directory') {
    if (stat.size !== entry.size) return false
    if (liveType === 'file') {
      // A hardlink shares its first-seen entry's inode, so its content is
      // proven against that entry's digest and by still sharing the inode.
      const digestSource =
        entry.type === 'hardlink' ? inventoryByPath.get(entry.target ?? '') : entry
      if (sha256File(absolute) !== digestSource?.digest) return false
      if (entry.type === 'hardlink') {
        let target
        try {
          target = lstatSync(join(root, entry.target ?? ''))
        } catch {
          return false
        }
        if (target.dev !== stat.dev || target.ino !== stat.ino) return false
      } else if (Number(stat.blocks ?? 0) * 512 !== entry.allocatedBytes) return false
    }
    if (entry.type === 'symlink') {
      try {
        if (readlinkSync(absolute) !== entry.target) return false
      } catch {
        return false
      }
    }
  }
  const liveMeta = metadataFor(absolute, options)
  if (entry.aclDigest !== undefined && liveMeta.aclDigest !== entry.aclDigest) return false
  if (entry.xattrDigest !== undefined && liveMeta.xattrDigest !== entry.xattrDigest) return false
  return true
}

export function inventoryTree(
  root: string,
  options: InventoryOptions = {},
  excludedRoots: string[] = [],
): SourceInventory {
  const resolved = realpathSync(resolve(root))
  // An exclusion that does not exist excludes nothing — operational names
  // (e.g. the teardown journal) are legitimately absent from archives and
  // pre-teardown trees, so absence must not abort the walk.
  const resolvedExclusions = excludedRoots
    .filter((excluded) => existsSync(excluded))
    .map((excluded) => realpathSync(resolve(excluded)))
  const rootStat = lstatSync(resolved)
  const entries: InventoryEntry[] = [
    {
      path: '',
      type: modeType(rootStat.mode),
      mode: rootStat.mode & 0o7777,
      size: 0,
      allocatedBytes: 0,
      uid: rootStat.uid,
      gid: rootStat.gid,
      mtimeMs: rootStat.mtimeMs,
      ...metadataFor(resolved, options),
    },
  ]
  walk(resolved, resolved, entries, new Map(), options, resolvedExclusions)
  const externalSymlinks = entries
    .filter((entry) => entry.type === 'symlink')
    .filter((entry) => {
      const target = symlinkTarget(resolved, entry, options)
      return !isWithin(resolved, target)
    })
    .map((entry) => entry.path)
  const specialFiles = entries
    .filter((entry) => entry.type === 'special')
    .map((entry) => entry.path)
  const logicalBytes = entries.reduce((sum, entry) => sum + entry.size, 0)
  const allocatedBytes = entries.reduce((sum, entry) => sum + entry.allocatedBytes, 0)
  return {
    root: resolved,
    entries,
    logicalBytes,
    allocatedBytes,
    entryCount: entries.length,
    digest: inventoryDigest(entries),
    externalSymlinks,
    specialFiles,
  }
}

function symlinkTarget(root: string, entry: InventoryEntry, options: InventoryOptions): string {
  const absolute = join(root, entry.path)
  const parent = realpathSync(dirname(absolute))
  const target = resolve(parent, entry.target ?? '')
  try {
    return realpathSync(target)
  } catch (error) {
    if (options.allowMissingSymlinkTargets) return target
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Preservation inventory found missing symlink target: ${absolute} (${detail})`,
      { cause: error },
    )
  }
}

export function validateProfile(profile: ConsumerProfile): void {
  if (!profile.id || !Number.isInteger(profile.version))
    throw new Error('Preservation profile identity is incomplete')
  if (!profile.roots.source || !profile.retention.destination || !profile.retention.owner)
    throw new Error('Preservation profile must declare source, destination and owner')
  const states = [
    profile.topology.nestedRepositories,
    profile.topology.submodules,
    profile.topology.sharedGitObjects,
    profile.topology.lfs,
    profile.resources.databases,
    profile.resources.volumes,
    profile.resources.sidecars,
    profile.resources.secrets,
    profile.filesystem.externalSymlinks,
    profile.filesystem.specialFiles,
    profile.filesystem.acl,
    profile.filesystem.xattr,
  ]
  if (states.some((state) => !['declared-present', 'verified-absent', 'unknown'].includes(state)))
    throw new Error('Preservation profile contains an invalid evidence state')
  if (states.some((state) => state === 'unknown'))
    throw new Error(
      'Preservation profile contains unknown evidence; destructive transitions retain the source',
    )
  if (Object.values(profile.resources).some((state) => state !== 'verified-absent'))
    throw new Error('Resource preservation adapters are required before a source can be removed')
}

export function capacityRequirement(
  root: string,
  inventory: SourceInventory,
  options: {
    gitRoot?: string
    gitExcludedRoot?: string
    gitExcludedRoots?: string[]
    restoreRoot?: string
    byteReserve?: number
    inodeReserve?: number
  } = {},
): CapacityRequirement {
  const fs = statfsSync(root)
  const availableBytes = Number(fs.bavail) * Number(fs.bsize)
  const totalBytes = Number(fs.blocks) * Number(fs.bsize)
  const availableInodes = Number(fs.ffree)
  const totalInodes = Number(fs.files)
  const restoreFs = statfsSync(options.restoreRoot ?? tmpdir())
  const restoreAvailableBytes = Number(restoreFs.bavail) * Number(restoreFs.bsize)
  const restoreAvailableInodes = Number(restoreFs.ffree)
  const restoreTotalInodes = Number(restoreFs.files)
  const gitInventory = options.gitRoot
    ? inventoryTree(options.gitRoot, {}, [
        ...(options.gitExcludedRoot ? [options.gitExcludedRoot] : []),
        ...(options.gitExcludedRoots ?? []),
      ])
    : undefined
  const gitBytes = gitInventory?.logicalBytes ?? 0
  const gitInodes = gitInventory?.entryCount ?? 0
  const growth = Math.max(GIB, Math.ceil(inventory.logicalBytes * 0.2))
  const worktreeArchiveBytes = tarSize(inventory.root, inventory)
  const gitArchiveBytes = gitInventory ? tarSize(gitInventory.root, gitInventory) : 0
  const worktreeFootprint = worktreeArchiveBytes
  const gitFootprint = gitArchiveBytes
  const restorePeakBytes =
    restoreAllocationUpperBound(inventory, Number(restoreFs.bsize)) +
    (gitInventory ? restoreAllocationUpperBound(gitInventory, Number(restoreFs.bsize)) : 0) +
    growth
  const restorePeakInodes = inventory.entryCount + gitInodes + 1024
  const peakBytes = worktreeFootprint + gitFootprint + restorePeakBytes + growth
  const peakInodes = inventory.entryCount + gitInodes + restorePeakInodes
  return {
    filesystem: realpathSync(root),
    filesystemId: String(statSync(root).dev),
    availableBytes,
    availableInodes,
    totalBytes,
    totalInodes,
    // Worktree archive + restore scratch + Git closure archive, plus growth.
    peakBytes,
    peakInodes,
    restoreFilesystem: realpathSync(options.restoreRoot ?? tmpdir()),
    restoreFilesystemId: String(statSync(options.restoreRoot ?? tmpdir()).dev),
    restoreAvailableBytes,
    restoreAvailableInodes,
    restorePeakBytes,
    restorePeakInodes,
    restoreByteReserve: Math.min(40 * GIB, Math.ceil(restoreAvailableBytes * 0.1)),
    restoreInodeReserve: Math.min(
      1_000_000,
      Math.max(32_768, Math.ceil(restoreTotalInodes * 0.05)),
    ),
    gitBytes,
    gitInodes,
    // Production floor is 40 GiB or 10% of the filesystem, whichever is larger.
    // Fixture profiles pass `byteReserve` so capture tests do not depend on host headroom.
    byteReserve: options.byteReserve ?? Math.max(40 * GIB, Math.ceil(totalBytes * 0.1)),
    inodeReserve: options.inodeReserve ?? Math.max(1_000_000, Math.ceil(totalInodes * 0.05)),
  }
}

export function assertCapacity(requirement: CapacityRequirement): void {
  if (
    requirement.restoreFilesystem &&
    (requirement.filesystemId === undefined || requirement.restoreFilesystemId === undefined)
  )
    throw new Error('Cross-filesystem preservation capacity requires filesystem identity evidence')
  const sameFilesystem =
    !requirement.restoreFilesystem ||
    (requirement.filesystemId !== undefined &&
      requirement.filesystemId === requirement.restoreFilesystemId)
  const archivePeakBytes = sameFilesystem
    ? requirement.peakBytes
    : requirement.peakBytes - (requirement.restorePeakBytes ?? 0)
  const archivePeakInodes = sameFilesystem
    ? requirement.peakInodes
    : requirement.peakInodes - (requirement.restorePeakInodes ?? 0)
  if (requirement.availableBytes - archivePeakBytes < requirement.byteReserve)
    throw new Error(
      `Preservation capacity insufficient on ${requirement.filesystem}: ${requirement.availableBytes} bytes available, ${archivePeakBytes} peak, ${requirement.byteReserve} reserve required`,
    )
  if (requirement.availableInodes - archivePeakInodes < requirement.inodeReserve)
    throw new Error(
      `Preservation inode capacity insufficient on ${requirement.filesystem}: ${requirement.availableInodes} available, ${requirement.peakInodes} peak, ${requirement.inodeReserve} reserve required`,
    )
  if (
    !sameFilesystem &&
    (requirement.restoreAvailableBytes === undefined ||
      requirement.restorePeakBytes === undefined ||
      requirement.restoreByteReserve === undefined)
  )
    throw new Error(
      'Cross-filesystem preservation capacity requires complete restore byte evidence',
    )
  if (
    !sameFilesystem &&
    requirement.restoreAvailableBytes - requirement.restorePeakBytes <
      requirement.restoreByteReserve
  )
    throw new Error(
      `Preservation capacity insufficient on ${requirement.restoreFilesystem}: ${requirement.restoreAvailableBytes} bytes available, ${requirement.restorePeakBytes} peak, ${requirement.restoreByteReserve} reserve required`,
    )
  if (
    !sameFilesystem &&
    (requirement.restoreAvailableInodes === undefined ||
      requirement.restorePeakInodes === undefined ||
      requirement.restoreInodeReserve === undefined)
  )
    throw new Error(
      'Cross-filesystem preservation capacity requires complete restore inode evidence',
    )
  if (
    !sameFilesystem &&
    requirement.restoreAvailableInodes - requirement.restorePeakInodes <
      requirement.restoreInodeReserve
  )
    throw new Error(
      `Preservation inode capacity insufficient on ${requirement.restoreFilesystem}: ${requirement.restoreAvailableInodes} available, ${requirement.restorePeakInodes} peak, ${requirement.restoreInodeReserve} reserve required`,
    )
}

function gitValue(root: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: isolatedGitEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
      try {
        lstatSync(join(root, '.git'))
      } catch (gitPathError) {
        if ((gitPathError as { code?: string }).code === 'ENOENT') return undefined
        const detail = gitPathError instanceof Error ? gitPathError.message : String(gitPathError)
        throw new Error(`Git preservation cannot inspect .git pointer: ${detail}`, {
          cause: gitPathError,
        })
      }
    }
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Git preservation probe failed (${args.join(' ')}): ${detail}`, {
      cause: error,
    })
  }
}

function isWithin(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

function resolvedIfPresent(path: string): string {
  return existsSync(path) ? realpathSync(path) : path
}

const isolatedGitEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_NO_LAZY_FETCH: '1',
  GIT_OPTIONAL_LOCKS: '0',
}

type GitConfigEntry = { key: string; value: string | undefined }

/**
 * One `git config --no-includes --list -z` read of a single file, in file order. Callers used to
 * spawn `--get` once per key; a restore verification read the same file up to six times, which
 * was the largest git-spawn family in a wt-batch cleanup (2026-09-16). Git parses the file either
 * way, so the error surface is the same: a malformed file fails the list exactly as it failed each
 * `--get`. `value` is undefined for a value-less key (`[core] bare`), which `--get` prints as "".
 */
function readGitConfigFile(
  configFile: string,
): { entries: GitConfigEntry[] } | { error: string; status: number | null } {
  const result = spawnSync(
    'git',
    ['config', '--file', configFile, '--no-includes', '--list', '-z'],
    {
      encoding: 'utf8',
      env: isolatedGitEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  if (result.error) return { error: String(result.error), status: null }
  if (result.status !== 0)
    return { error: String(result.stderr ?? '').trim(), status: result.status }
  const entries = String(result.stdout ?? '')
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const separator = record.indexOf('\n')
      return separator === -1
        ? { key: record, value: undefined }
        : { key: record.slice(0, separator), value: record.slice(separator + 1) }
    })
  return { entries }
}

/**
 * `git config --get <key>` over entries already read: the last occurrence wins, section and
 * variable names compare case-insensitively, a subsection compares exactly, and a value-less key
 * reads as "". Trimmed like the per-key reads it replaces.
 */
function gitConfigEntryValue(entries: GitConfigEntry[], key: string): string | undefined {
  const canonical = (name: string) => {
    const first = name.indexOf('.')
    const last = name.lastIndexOf('.')
    if (first === -1) return name.toLowerCase()
    return (
      name.slice(0, first).toLowerCase() + name.slice(first, last) + name.slice(last).toLowerCase()
    )
  }
  const wanted = canonical(key)
  const match = entries.findLast((entry) => canonical(entry.key) === wanted)
  return match ? (match.value ?? '').trim() : undefined
}

/**
 * Git's own quoting for a written config value (a leading or trailing space, `;` or `#` quotes the
 * whole value; tabs and newlines are escaped, not quoted), so the file matches `git config` output.
 */
function gitConfigQuotedValue(value: string): string {
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\t', '\\t')
  const quote = /^ | $|[;#]/.test(value)
  return quote ? `"${escaped}"` : escaped
}

function isolateRestoredGitConfig(gitDirectory: string, worktree: string): void {
  const config = join(gitDirectory, 'config')
  // A config Git cannot parse reads as having no keys -- the same result the per-key reads gave.
  const read = readGitConfigFile(config)
  const entries = 'entries' in read ? read.entries : []
  const repositoryFormat = gitConfigEntryValue(entries, 'core.repositoryformatversion') ?? '0'
  const objectFormat = gitConfigEntryValue(entries, 'extensions.objectformat')
  const refStorage = gitConfigEntryValue(entries, 'extensions.refstorage')
  const partialClone = gitConfigEntryValue(entries, 'extensions.partialClone')
  if (!/^\d+$/.test(repositoryFormat))
    throw new Error(`Offline restored Git has an invalid repository format: ${repositoryFormat}`)
  if (objectFormat && !['sha1', 'sha256'].includes(objectFormat))
    throw new Error(`Offline restored Git has an unsupported object format: ${objectFormat}`)
  if (refStorage && !['files', 'reftable'].includes(refStorage))
    throw new Error(`Offline restored Git has an unsupported ref storage: ${refStorage}`)
  if (partialClone !== undefined)
    throw new Error('Offline restored Git cannot verify a partial clone offline')

  // A captured local config may name the live worktree, include arbitrary host files, or
  // launch helpers such as fsmonitor. Restore verification must prove the archived Git data
  // works without consulting any of those live-machine dependencies.
  // Written directly rather than by one `git config` spawn per key: the text is what those spawns
  // produced on an empty file, and every value but the worktree path is validated above.
  rmSync(config, { force: true })
  const extensions = [
    ...(objectFormat ? [`\tobjectFormat = ${objectFormat}\n`] : []),
    ...(refStorage ? [`\trefStorage = ${refStorage}\n`] : []),
  ]
  writeFileSync(
    config,
    '[core]\n' +
      `\trepositoryformatversion = ${repositoryFormat}\n` +
      '\tbare = false\n' +
      `\tworktree = ${gitConfigQuotedValue(worktree)}\n` +
      (extensions.length ? `[extensions]\n${extensions.join('')}` : ''),
  )
}

function assertAlternatesLocal(path: string, allowedRoots: string[]): void {
  const objectRoot = dirname(dirname(path))
  for (const alternate of readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)) {
    const target = resolvedIfPresent(resolve(objectRoot, alternate))
    if (!existsSync(target) || !allowedRoots.some((root) => isWithin(root, target)))
      throw new Error(
        `Git preservation cannot capture external or missing alternates object store: ${target}`,
      )
  }
}

function assertCommondirLocal(path: string, allowedRoots: string[]): void {
  const value = readFileSync(path, 'utf8').trim()
  if (!value) throw new Error(`Git preservation found an empty commondir file: ${path}`)
  const target = resolvedIfPresent(resolve(dirname(path), value))
  if (!existsSync(target) || !allowedRoots.some((root) => isWithin(root, target)))
    throw new Error(`Git preservation cannot capture external or missing commondir: ${target}`)
}

function assertGitClosureLocal(
  sourceRoot: string,
  common: string,
  inventoryRoot: string,
  inventory: SourceInventory,
): void {
  const hasPromisorPack = inventory.entries.some((entry) => entry.path.endsWith('.promisor'))
  let partialClone = false
  try {
    partialClone =
      gitValue(common, ['--git-dir', common, 'config', '--get', 'extensions.partialClone']) !==
      undefined
  } catch {
    // A missing config key is normal; malformed Git config fails through the regular probes.
  }
  if (hasPromisorPack || partialClone)
    throw new Error('Git preservation cannot verify a partial clone offline')
  const alternates = join(common, 'objects/info/alternates')
  if (existsSync(alternates)) assertAlternatesLocal(alternates, [sourceRoot, common])
  for (const entry of inventory.entries) {
    const absolute = join(inventoryRoot, entry.path)
    if (entry.type !== 'file') continue
    if (entry.path.split('/').at(-1) === '.git') {
      const gitdirLine = readFileSync(absolute, 'utf8')
        .split('\n')
        .find((line) => line.startsWith('gitdir:'))
      if (!gitdirLine || !gitdirLine.slice('gitdir:'.length).trim())
        throw new Error(`Git preservation cannot inspect malformed .git pointer: ${absolute}`)
      const target = resolvedIfPresent(
        resolve(dirname(absolute), gitdirLine.slice('gitdir:'.length).trim()),
      )
      if (!existsSync(target) || (!isWithin(sourceRoot, target) && !isWithin(common, target)))
        throw new Error(`Git preservation cannot capture external or missing gitdir: ${target}`)
      const gitdirRecord = join(target, 'gitdir')
      if (!existsSync(gitdirRecord))
        throw new Error(`Git preservation cannot capture worktree metadata: ${gitdirRecord}`)
      const recordedWorktree = resolve(
        dirname(gitdirRecord),
        readFileSync(gitdirRecord, 'utf8').trim(),
      )
      if (!existsSync(recordedWorktree) || !isWithin(sourceRoot, recordedWorktree))
        throw new Error(
          `Git preservation cannot capture invalid worktree metadata: ${gitdirRecord}`,
        )
    }
    if (entry.path.endsWith('/objects/info/alternates'))
      assertAlternatesLocal(absolute, [sourceRoot, common])
    if (entry.path.endsWith('/commondir')) assertCommondirLocal(absolute, [sourceRoot, common])
  }
}

function assertLinkedWorktreeMetadataLocal(sourceRoot: string, common: string): string[] {
  const metadataRoot = join(common, 'worktrees')
  if (!existsSync(metadataRoot)) return []
  const excluded: string[] = []
  for (const metadata of readdirSync(metadataRoot, { withFileTypes: true })) {
    if (!metadata.isDirectory())
      throw new Error('Git preservation cannot inspect linked-worktree metadata: ' + metadata.name)
    const metadataPath = join(metadataRoot, metadata.name)
    const gitdirRecord = join(metadataPath, 'gitdir')
    if (!existsSync(gitdirRecord) || !lstatSync(gitdirRecord).isFile())
      throw new Error('Git preservation cannot capture linked-worktree metadata: ' + gitdirRecord)
    const recordedWorktree = resolve(
      dirname(gitdirRecord),
      readFileSync(gitdirRecord, 'utf8').trim(),
    )
    if (!recordedWorktree || !recordedWorktree.endsWith('/.git'))
      throw new Error('Git preservation cannot inspect linked-worktree metadata: ' + gitdirRecord)
    if (!existsSync(recordedWorktree) || !lstatSync(recordedWorktree).isFile())
      throw new Error(
        'Git preservation cannot capture linked-worktree metadata: ' + recordedWorktree,
      )
    const pointerLine = readFileSync(recordedWorktree, 'utf8')
      .split('\n')
      .find((line) => line.startsWith('gitdir:'))
    if (!pointerLine)
      throw new Error(
        'Git preservation cannot inspect linked-worktree pointer: ' + recordedWorktree,
      )
    const pointerTarget = realpathSync(
      resolve(dirname(recordedWorktree), pointerLine.slice('gitdir:'.length).trim()),
    )
    if (pointerTarget !== realpathSync(metadataPath))
      throw new Error('Git preservation found mismatched linked-worktree metadata: ' + metadataPath)
    if (dirname(recordedWorktree) !== sourceRoot) excluded.push(metadataPath)
  }
  return excluded
}

export function gitExcludedRootsForArchive(
  sourceRoot: string,
  common: string,
  archiveRoot: string,
): string[] {
  const excludedRoot = isWithin(common, archiveRoot)
    ? basename(dirname(archiveRoot)) === 'clade-wt-batch'
      ? dirname(archiveRoot)
      : archiveRoot
    : undefined
  // Cleanup removal moves linked-worktree metadata to
  // `<common>/.clade-trashed-meta-*` rather than deleting it; those dirs are
  // trash, not live metadata — their relocated commondir/gitdir pointers
  // resolve outside the source and must not enter the inventory or its
  // locality assertions. A name-prefix match alone would also hide a
  // pre-existing foreign dir at the trash name from every archive, so an
  // exclusion additionally requires evidence of a cleanup-owned
  // relocation, not directory shape: the dir must carry the teardown
  // journal the lifecycle moves inside it (regular, single-linked, all
  // committed records well-formed) AND be the moved half of a recorded
  // relocation pair — its `gitdir` record names `<worktree>/.git`, and a
  // `.clade-trashed-*` sibling of that recorded worktree exists whose
  // `.git` pointer back-links to `common/worktrees/<adminId>` where
  // `<adminId>` is exactly the admin basename this dir's name embeds
  // (`.clade-trashed-meta-<adminId>-<trashTail>`). A foreign dir planted
  // at the prefix cannot reproduce the pair without the actual trash
  // tree. (`commondir` cannot bind the move: its `../..` back-link
  // resolves to the common dir's parent once the admin dir is relocated
  // beside it.) Anything else at the name stays in the inventory and
  // fails verification as drift.
  const trashedMetadata = existsSync(common)
    ? readdirSync(common, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('.clade-trashed-meta-'))
        .map((entry) => join(common, entry.name))
        .filter((dir) => {
          try {
            const recorded = resolve(dir, readFileSync(join(dir, 'gitdir'), 'utf8').trim())
            if (basename(recorded) !== '.git') return false
            const worktreeParent = dirname(dirname(recorded))
            const pair = readdirSync(worktreeParent, { withFileTypes: true }).some((entry) => {
              if (!entry.isDirectory() || !entry.name.startsWith('.clade-trashed-')) return false
              const trashGit = join(worktreeParent, entry.name, '.git')
              try {
                const line = readFileSync(trashGit, 'utf8')
                  .split('\n')
                  .find((l) => l.startsWith('gitdir:'))
                if (!line) return false
                const admin = resolve(dirname(trashGit), line.slice(7).trim())
                // The tree-side pointer must name this repo's original
                // admin location — `common/worktrees/<id>` — and the
                // meta name must embed that same id plus the trash
                // tail the relocation journaled.
                if (admin !== join(common, 'worktrees', basename(admin))) return false
                return (
                  basename(dir) ===
                  `.clade-trashed-meta-${basename(admin)}-${entry.name.slice('.clade-trashed-'.length)}`
                )
              } catch {
                return false
              }
            })
            if (!pair) return false
            const st = lstatSync(join(dir, WT_TEARDOWN_JOURNAL_NAME))
            if (!st.isFile() || st.nlink > 1) return false
            const raw = readFileSync(join(dir, WT_TEARDOWN_JOURNAL_NAME), 'utf8')
            // An unterminated tail means teardown crashed mid-append — the
            // dir is mid-lifecycle, not settled trash, so it stays visible.
            if (raw !== '' && !raw.endsWith('\n')) return false
            return raw
              .split('\n')
              .filter((line) => line !== '')
              .every(
                (line) =>
                  line.startsWith('modules ') ||
                  line === 'modules-restored' ||
                  line.startsWith('detach ') ||
                  line.startsWith('restored '),
              )
          } catch {
            return false
          }
        })
    : []
  // `<common>/modules` holds the MAIN checkout's submodule gitdirs. Removing a linked
  // worktree never touches it, and inventorying it would read those module repos as nested
  // repositories of every linked source. A module gitdir that belongs to this source is
  // rejected earlier by assertGitlinkPolicy, never hidden here.
  const sharedModules = (() => {
    try {
      return lstatSync(join(sourceRoot, '.git')).isFile() && existsSync(join(common, 'modules'))
        ? [join(common, 'modules')]
        : []
    } catch {
      return []
    }
  })()
  return [
    ...(excludedRoot ? [excludedRoot] : []),
    ...trashedMetadata,
    ...sharedModules,
    ...assertLinkedWorktreeMetadataLocal(sourceRoot, common),
  ]
}

export function gitWorktreeMetadataRoots(sourceRoot: string, common: string): string[] {
  const metadataRoot = join(common, 'worktrees')
  if (!existsSync(metadataRoot)) return []
  assertLinkedWorktreeMetadataLocal(sourceRoot, common)
  return readdirSync(metadataRoot, { withFileTypes: true })
    .filter((metadata) => metadata.isDirectory())
    .map((metadata) => join(metadataRoot, metadata.name))
    .filter((metadataPath) => {
      const gitdirRecord = join(metadataPath, 'gitdir')
      const recordedWorktree = resolve(
        dirname(gitdirRecord),
        readFileSync(gitdirRecord, 'utf8').trim(),
      )
      return dirname(recordedWorktree) === sourceRoot
    })
}

export function inventoryArchive(
  archive: string,
  options: InventoryOptions = {},
  excludedPaths: string[] = [],
): SourceInventory {
  return withRestoredArchive(archive, (restored) =>
    inventoryTree(
      restored,
      options,
      excludedPaths.map((path) => join(restored, path)),
    ),
  )
}

function nestedRepositoryPaths(inventoryRoot: string, inventory: SourceInventory): string[] {
  const paths = new Set(inventory.entries.map((entry) => entry.path))
  const nested: string[] = []
  const add = (repository: string) => {
    if (repository && repository !== inventoryRoot) nested.push(repository)
  }
  for (const entry of inventory.entries) {
    if (!entry.path) continue
    if (entry.path.split('/').at(-1) === '.git') add(dirname(join(inventoryRoot, entry.path)))
  }
  for (const entry of inventory.entries) {
    if (!entry.path || entry.type !== 'directory' || entry.path === '.git') continue
    const prefix = `${entry.path}/`
    if (!paths.has(`${prefix}HEAD`) || !paths.has(`${prefix}config`)) continue
    add(join(inventoryRoot, entry.path))
  }
  return [...new Set(nested)]
}

function portableResolvedPointer(
  sourceRoot: string,
  base: string,
  pointer: string,
  kind: string,
  state = { symlinkHops: 0 },
): string {
  const root = realpathSync(resolve(sourceRoot))
  let current = realpathSync(resolve(base))
  if (!isWithin(root, current))
    throw new Error(`Git preservation cannot capture external nested ${kind}: ${base}`)
  for (const component of pointer.split('/')) {
    if (!component || component === '.') continue
    current = component === '..' ? dirname(current) : join(current, component)
    if (!isWithin(root, current))
      throw new Error(`Git preservation cannot capture external nested ${kind}: ${current}`)
    let stat
    try {
      stat = lstatSync(current)
    } catch {
      throw new Error(`Git preservation cannot capture missing nested ${kind}: ${current}`)
    }
    if (!stat.isSymbolicLink()) continue
    if (++state.symlinkHops > 64)
      throw new Error(`Git preservation cannot resolve nested ${kind} symlink chain: ${pointer}`)
    const nestedPointer = readlinkSync(current)
    if (isAbsolute(nestedPointer))
      throw new Error(`Git preservation cannot capture absolute nested ${kind} symlink: ${current}`)
    current = portableResolvedPointer(root, dirname(current), nestedPointer, kind, state)
  }
  return realpathSync(current)
}

function nestedGitDirectory(
  repo: string,
  allowAbsolutePointer = false,
  sourceRoot?: string,
): string {
  const marker = join(repo, '.git')
  if (existsSync(marker)) {
    const stat = lstatSync(marker)
    if (stat.isSymbolicLink()) {
      const pointer = readlinkSync(marker)
      if (isAbsolute(pointer) && !allowAbsolutePointer)
        throw new Error(`Git preservation cannot capture absolute nested gitdir pointer: ${marker}`)
      return sourceRoot
        ? portableResolvedPointer(sourceRoot, dirname(marker), pointer, 'gitdir pointer')
        : resolve(dirname(marker), pointer)
    }
    if (stat.isFile()) {
      const line = readFileSync(marker, 'utf8')
        .split('\n')
        .find((value) => value.startsWith('gitdir:'))
      const pointer = line?.slice('gitdir:'.length).trim() ?? ''
      if (!pointer)
        throw new Error(`Git preservation cannot inspect nested .git pointer: ${marker}`)
      if (isAbsolute(pointer) && !allowAbsolutePointer)
        throw new Error(`Git preservation cannot capture absolute nested gitdir pointer: ${marker}`)
      return sourceRoot
        ? portableResolvedPointer(sourceRoot, dirname(marker), pointer, 'gitdir pointer')
        : resolve(dirname(marker), pointer)
    }
    return marker
  }
  if (existsSync(join(repo, 'HEAD')) && existsSync(join(repo, 'config'))) return repo
  throw new Error(`Git preservation cannot inspect nested repository: ${repo}`)
}

function nestedHasPromisorPack(gitDir: string): boolean {
  const pack = join(gitDir, 'objects', 'pack')
  if (!existsSync(pack)) return false
  return readdirSync(pack).some((name) => name.endsWith('.promisor'))
}

function assertNoNestedLfs(repo: string, bare: boolean): void {
  const config = spawnSync(
    'git',
    ['-C', repo, 'config', '--local', '--get-regexp', '^(filter\\.lfs\\.|lfs\\.)'],
    { encoding: 'utf8', env: isolatedGitEnv, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (config.error || (config.status !== 0 && config.status !== 1))
    throw new Error(`Git preservation cannot inspect nested LFS configuration: ${repo}`)
  if (config.status === 0)
    throw new Error(`Git preservation requires a nested LFS payload-closure adapter: ${repo}`)

  if (!bare) {
    const index = spawnSync(
      'git',
      [
        '--no-replace-objects',
        '-C',
        repo,
        'grep',
        '--cached',
        '--extended-regexp',
        '-l',
        '-e',
        '^version https://git-lfs.github.com/spec/v1$',
      ],
      { encoding: 'utf8', env: isolatedGitEnv, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    if (index.error || (index.status !== 0 && index.status !== 1))
      throw new Error(`Git preservation cannot inspect nested LFS index: ${repo}`)
    if (index.status === 0)
      throw new Error(`Git preservation requires a nested LFS payload-closure adapter: ${repo}`)
  }

  const revisions = spawnSync(
    'git',
    ['--no-replace-objects', '-C', repo, 'rev-list', '--all', '--reflog'],
    {
      encoding: 'utf8',
      env: isolatedGitEnv,
      maxBuffer: 128 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  if (revisions.error || revisions.status !== 0)
    throw new Error(`Git preservation cannot inspect nested LFS history: ${repo}`)
  const commits = [
    ...new Set(
      String(revisions.stdout ?? '')
        .split('\n')
        .filter(Boolean),
    ),
  ]
  for (let offset = 0; offset < commits.length; offset += 128) {
    const grep = spawnSync(
      'git',
      [
        '--no-replace-objects',
        '-C',
        repo,
        'grep',
        '--extended-regexp',
        '-l',
        '-e',
        '^version https://git-lfs.github.com/spec/v1$',
        ...commits.slice(offset, offset + 128),
      ],
      {
        encoding: 'utf8',
        env: isolatedGitEnv,
        maxBuffer: 128 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    if (grep.error || (grep.status !== 0 && grep.status !== 1))
      throw new Error(`Git preservation cannot inspect nested LFS pointers: ${repo}`)
    if (grep.status === 0)
      throw new Error(`Git preservation requires a nested LFS payload-closure adapter: ${repo}`)
  }

  if (bare) return
  const scan = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.isSymbolicLink()) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        scan(path)
        continue
      }
      if (
        entry.isFile() &&
        lstatSync(path).size <= 1024 &&
        readFileSync(path, 'utf8').startsWith('version https://git-lfs.github.com/spec/v1\n')
      )
        throw new Error(`Git preservation requires a nested LFS payload-closure adapter: ${path}`)
    }
  }
  scan(repo)
}

function nestedGitStoragePaths(gitDir: string, sourceRoot: string): string[] {
  const paths = [gitDir]
  const commondirFile = join(gitDir, 'commondir')
  if (existsSync(commondirFile)) {
    const value = readFileSync(commondirFile, 'utf8').trim()
    if (!value) throw new Error(`Git preservation found an empty commondir file: ${commondirFile}`)
    if (isAbsolute(value))
      throw new Error(
        `Git preservation cannot capture absolute nested commondir pointer: ${commondirFile}`,
      )
    paths.push(portableResolvedPointer(sourceRoot, gitDir, value, 'commondir pointer'))
  }
  return paths
}

function sourceGitDirectory(sourceRoot: string): string | undefined {
  if (
    !existsSync(join(sourceRoot, '.git')) &&
    !(existsSync(join(sourceRoot, 'HEAD')) && existsSync(join(sourceRoot, 'config')))
  )
    return undefined
  return resolvedIfPresent(nestedGitDirectory(sourceRoot, true))
}

function sharesSourceGitDirectory(sourceRoot: string, storage: string): boolean {
  const rootGit = sourceGitDirectory(sourceRoot)
  return rootGit !== undefined && (storage === rootGit || storage.startsWith(`${rootGit}/`))
}

export function assertContainedNestedGitStorage(repo: string, sourceRoot: string): void {
  sourceRoot = realpathSync(resolve(sourceRoot))
  const gitDir = resolvedIfPresent(nestedGitDirectory(repo, false, sourceRoot))
  if (!existsSync(gitDir))
    throw new Error(`Git preservation cannot capture missing nested repository: ${gitDir}`)
  const storageRoots = nestedGitStoragePaths(gitDir, sourceRoot).map((storage) =>
    resolvedIfPresent(storage),
  )
  const queued = [...storageRoots]
  const visited = new Set<string>()
  const objectStores = new Set<string>()
  const objectStoreQueue: string[] = []

  const containedTarget = (path: string, kind: string) => {
    if (!existsSync(path))
      throw new Error(`Git preservation cannot capture missing nested ${kind}: ${path}`)
    const target = realpathSync(path)
    if (!isWithin(sourceRoot, target) || sharesSourceGitDirectory(sourceRoot, target))
      throw new Error(`Git preservation cannot capture external nested ${kind}: ${target}`)
    return target
  }

  const containedPointerTarget = (base: string, pointer: string, kind: string) => {
    const target = portableResolvedPointer(sourceRoot, base, pointer, kind)
    if (!isWithin(sourceRoot, target) || sharesSourceGitDirectory(sourceRoot, target))
      throw new Error(`Git preservation cannot capture external nested ${kind}: ${target}`)
    return target
  }

  const assertLinkedWorktreesPortable = (common: string) => {
    const metadataRoot = join(common, 'worktrees')
    if (!existsSync(metadataRoot)) return
    for (const metadata of readdirSync(metadataRoot, { withFileTypes: true })) {
      if (!metadata.isDirectory())
        throw new Error(
          `Git preservation cannot inspect nested linked-worktree metadata: ${metadata.name}`,
        )
      const metadataPath = join(metadataRoot, metadata.name)
      const gitdirRecord = join(metadataPath, 'gitdir')
      if (!existsSync(gitdirRecord) || !lstatSync(gitdirRecord).isFile())
        throw new Error(
          `Git preservation cannot capture nested linked-worktree metadata: ${gitdirRecord}`,
        )
      const recorded = readFileSync(gitdirRecord, 'utf8').trim()
      if (!recorded || isAbsolute(recorded))
        throw new Error(
          `Git preservation cannot capture absolute nested linked-worktree gitdir: ${gitdirRecord}`,
        )
      const worktreeMarker = containedPointerTarget(
        metadataPath,
        recorded,
        'linked-worktree gitdir',
      )
      if (!worktreeMarker.endsWith('/.git') || !lstatSync(worktreeMarker).isFile())
        throw new Error(
          `Git preservation cannot capture nested linked-worktree metadata: ${worktreeMarker}`,
        )
      const pointerLine = readFileSync(worktreeMarker, 'utf8')
        .split('\n')
        .find((line) => line.startsWith('gitdir:'))
      const pointer = pointerLine?.slice('gitdir:'.length).trim() ?? ''
      if (!pointer || isAbsolute(pointer))
        throw new Error(
          `Git preservation cannot capture absolute nested linked-worktree pointer: ${worktreeMarker}`,
        )
      const pointerTarget = containedPointerTarget(
        dirname(worktreeMarker),
        pointer,
        'linked-worktree pointer',
      )
      if (pointerTarget !== realpathSync(metadataPath))
        throw new Error(
          `Git preservation found mismatched nested linked-worktree metadata: ${metadataPath}`,
        )
    }
  }

  const addObjectStore = (path: string) => {
    const target = containedTarget(path, 'object store')
    if (objectStores.has(target)) return
    objectStores.add(target)
    objectStoreQueue.push(target)
    queued.push(target)
  }

  const queueAlternates = (path: string, objectRoot: string) => {
    for (const alternate of readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)) {
      if (isAbsolute(alternate))
        throw new Error(
          `Git preservation cannot capture absolute nested alternates pointer: ${path}`,
        )
      const target = containedPointerTarget(objectRoot, alternate, 'alternates object store')
      addObjectStore(target)
    }
  }

  const walkStorage = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const pointer = readlinkSync(path)
        if (isAbsolute(pointer))
          throw new Error(
            `Git preservation cannot capture absolute nested git storage symlink: ${path}`,
          )
        const target = containedPointerTarget(dirname(path), pointer, 'git storage symlink')
        if (statSync(target).isDirectory()) {
          queued.push(target)
          if (entry.name === 'objects') addObjectStore(target)
        }
        continue
      }
      if (entry.isDirectory()) {
        walkStorage(path)
        continue
      }
      if (entry.name.endsWith('.promisor'))
        throw new Error('Git preservation cannot verify a nested partial clone offline')
    }
  }

  for (const resolved of storageRoots) {
    containedTarget(resolved, 'git storage')
    const objects = join(resolved, 'objects')
    if (existsSync(objects)) addObjectStore(objects)
    let partialClone = false
    try {
      partialClone =
        gitValue(resolved, [
          '--git-dir',
          resolved,
          'config',
          '--get',
          'extensions.partialClone',
        ]) !== undefined
    } catch {
      // A missing config key is normal; malformed Git config fails through the regular probes.
    }
    if (nestedHasPromisorPack(resolved) || partialClone)
      throw new Error('Git preservation cannot verify a nested partial clone offline')
  }
  while (queued.length || objectStoreQueue.length) {
    if (queued.length) {
      const resolved = containedTarget(queued.shift()!, 'git storage')
      if (!visited.has(resolved)) {
        visited.add(resolved)
        walkStorage(resolved)
      }
      continue
    }
    const objectRoot = objectStoreQueue.shift()!
    const alternates = join(objectRoot, 'info', 'alternates')
    if (!existsSync(alternates)) continue
    portableResolvedPointer(sourceRoot, objectRoot, 'info/alternates', 'alternates pointer')
    queueAlternates(alternates, objectRoot)
  }
  for (const storageRoot of storageRoots) {
    const storageInventory = inventoryTree(storageRoot, {
      allowExternalSymlinks: true,
      allowMissingSymlinkTargets: true,
    })
    assertGitConfigClosure(storageRoot, storageInventory, [sourceRoot], sourceRoot, gitDir)
    assertLinkedWorktreesPortable(storageRoot)
  }
  const bare = gitValue(repo, ['rev-parse', '--is-bare-repository']) === 'true'
  assertNoNestedLfs(repo, bare)
  assertNoReachableGitlinks(repo)
  if (!bare) assertNoUninitializedGitlinks(repo)
}

function assertNestedRepositoryPolicy(
  inventoryRoot: string,
  inventory: SourceInventory,
  allowNested: boolean,
): void {
  const nested = nestedRepositoryPaths(inventoryRoot, inventory)
  if (!nested.length) return
  if (!allowNested)
    throw new Error(
      `Git preservation has no nested repository closure adapter: ${nested.join(', ')}`,
    )
  for (const repo of nested) assertContainedNestedGitStorage(repo, inventoryRoot)
}

function assertNoNestedRepositories(inventoryRoot: string, inventory: SourceInventory): void {
  assertNestedRepositoryPolicy(inventoryRoot, inventory, false)
}

function gitlinkPaths(sourceRoot: string): string[] {
  const result = spawnSync('git', ['ls-files', '-s'], {
    cwd: sourceRoot,
    encoding: 'utf8',
    env: isolatedGitEnv,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.error)
    throw new Error(`Git preservation probe failed (ls-files -s): ${result.error.message}`)
  if (result.status !== 0)
    throw new Error(
      `Git preservation probe failed (ls-files -s): ${String(result.stderr ?? '').trim()}`,
    )
  const paths: string[] = []
  for (const line of (result.stdout ?? '').split('\n')) {
    if (!line.startsWith('160000 ')) continue
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    paths.push(line.slice(tab + 1))
  }
  return paths
}

function reachableGitlinkPaths(repo: string): string[] {
  const result = spawnSync(
    'git',
    [
      '--no-replace-objects',
      '-c',
      'diff.ignoreSubmodules=none',
      'log',
      '--all',
      '--reflog',
      '--raw',
      '--root',
      '-m',
      '--no-abbrev',
      '--format=',
    ],
    {
      cwd: repo,
      encoding: 'utf8',
      env: isolatedGitEnv,
      maxBuffer: 128 * 1024 * 1024,
    },
  )
  if (result.error)
    throw new Error(`Git preservation probe failed (log --raw): ${result.error.message}`)
  if (result.status !== 0)
    throw new Error(
      `Git preservation probe failed (log --raw): ${String(result.stderr ?? '').trim()}`,
    )
  const paths: string[] = []
  for (const line of (result.stdout ?? '').split('\n')) {
    const modes = line.match(/^:(\d{6}) (\d{6}) /)
    if (!modes || (modes[1] !== '160000' && modes[2] !== '160000')) continue
    const tab = line.indexOf('\t')
    const changedPaths = tab === -1 ? [] : line.slice(tab + 1).split('\t')
    paths.push(
      modes[2] === '160000'
        ? (changedPaths.at(-1) ?? '<unknown>')
        : (changedPaths[0] ?? '<unknown>'),
    )
  }
  return [...new Set(paths)]
}

function assertNoUninitializedGitlinks(sourceRoot: string): void {
  const gitlinks = gitlinkPaths(sourceRoot)
  if (gitlinks.length)
    throw new Error(
      `Git preservation has no nested repository closure adapter: ${gitlinks.join(', ')}`,
    )
}

/**
 * Top-level gitlink policy for a capture source.
 *
 * A gitlink's commit id lives in the index and HEAD tree, both inside the Git archive, and the
 * submodule remote holds the commit itself — so an UNINITIALIZED submodule (empty or absent
 * directory, no module gitdir owned by this checkout) loses nothing when the source goes.
 * An initialized one can hold unpushed submodule commits and local edits that no adapter
 * captures, so it still fails closed. Without a `declared-present` profile any gitlink fails:
 * the profile must not claim absence of what the index contains.
 */
function assertGitlinkPolicy(sourceRoot: string, common: string, declared: boolean): void {
  const gitlinks = gitlinkPaths(sourceRoot)
  if (!gitlinks.length) return
  if (!declared)
    throw new Error(
      `Git preservation has no nested repository closure adapter: ${gitlinks.join(', ')}`,
    )
  const rawGitDir = gitValue(sourceRoot, ['rev-parse', '--path-format=absolute', '--git-dir'])
  if (!rawGitDir) throw new Error('Git preservation cannot resolve the source git dir')
  const gitDir = realpathSync(rawGitDir)
  const commonDir = realpathSync(common)
  const initialized = gitlinks.filter((path) => {
    const checkout = join(sourceRoot, path)
    let stat
    try {
      stat = lstatSync(checkout)
    } catch {
      stat = undefined
    }
    if (stat && (!stat.isDirectory() || readdirSync(checkout).length > 0)) return true
    if (existsSync(join(gitDir, 'modules', path))) return true
    // A linked worktree's `<common>/modules` belongs to the main checkout, unless its
    // core.worktree was pointed back into this source.
    const sharedModule = join(commonDir, 'modules', path)
    if (gitDir !== commonDir && existsSync(join(sharedModule, 'config'))) {
      const result = spawnSync(
        'git',
        ['config', '--file', join(sharedModule, 'config'), '--get', 'core.worktree'],
        { encoding: 'utf8', env: isolatedGitEnv },
      )
      const worktree = (result.stdout ?? '').trim()
      if (worktree && isWithin(sourceRoot, resolve(sharedModule, worktree))) return true
    }
    return false
  })
  if (initialized.length)
    throw new Error(
      `Initialized submodules are not captured by this archive adapter: ${initialized.join(', ')}`,
    )
}

function assertNoReachableGitlinks(repo: string): void {
  const gitlinks = reachableGitlinkPaths(repo)
  if (gitlinks.length)
    throw new Error(
      `Git preservation has no nested repository closure adapter: ${gitlinks.join(', ')}`,
    )
}

function isGitConfigInventoryPath(path: string, inventoryRoot: string): boolean {
  const name = path.split('/').at(-1)
  if (name !== 'config' && name !== 'config.worktree') return false
  if (path.split('/').includes('.git')) return true
  const gitDir =
    existsSync(join(inventoryRoot, 'HEAD')) && existsSync(join(inventoryRoot, 'objects'))
  if (!gitDir) return false
  if (path === 'config' || path === 'config.worktree') return true
  const top = path.split('/')[0]
  return top === 'modules' || top === 'worktrees'
}

/**
 * `-z` keeps a subsection containing `=` (`[includeIf "gitdir:/a=b/"]`) from being split at the
 * wrong separator, which the line-oriented `--list` parse silently dropped as a non-include.
 */
function gitConfigIncludePaths(
  entries: GitConfigEntry[],
): Array<{ value: string; condition?: string }> {
  return entries
    .map((entry): { value: string; condition?: string } | undefined => {
      if (entry.value === undefined) return undefined
      const value = entry.value.trim()
      if (entry.key === 'include.path') return { value }
      const conditional = entry.key.match(/^includeIf\.(.+)\.path$/i)
      return conditional ? { value, condition: conditional[1] } : undefined
    })
    .filter((row) => row !== undefined)
}

function resolveIncludePath(configFile: string, value: string): string {
  if (value === '~' || value.startsWith('~/')) return join(homedir(), value.slice(1))
  if (value.startsWith('/')) return value
  return resolve(dirname(configFile), value)
}

function assertGitConfigClosure(
  inventoryRoot: string,
  inventory: SourceInventory,
  allowedRoots: string[],
  portableRoot?: string,
  portableGitDir?: string,
): void {
  const roots = allowedRoots.filter(Boolean).map((root) => resolvedIfPresent(root))
  const visited = new Set<string>()
  const queue: Array<{ logical: string; resolved?: string }> = []
  for (const entry of inventory.entries) {
    if (!entry.path || !isGitConfigInventoryPath(entry.path, inventoryRoot)) continue
    if (entry.type !== 'file' && entry.type !== 'symlink' && entry.type !== 'hardlink')
      throw new Error(
        `Git preservation cannot inspect ${entry.type} config: ${join(inventoryRoot, entry.path)}`,
      )
    queue.push({ logical: join(inventoryRoot, entry.path) })
  }
  while (queue.length) {
    const queuedConfig = queue.pop()!
    const configFile = queuedConfig.logical
    if (!existsSync(configFile))
      throw new Error(
        `Git preservation has no config dependency adapter for missing include: ${configFile}`,
      )
    let resolvedConfig: string
    try {
      resolvedConfig = queuedConfig.resolved ?? realpathSync(configFile)
    } catch {
      throw new Error(
        `Git preservation has no config dependency adapter for missing include: ${configFile}`,
      )
    }
    if (!roots.some((root) => isWithin(root, resolvedConfig)))
      throw new Error(
        `Git preservation has no config dependency adapter for include path: ${configFile}`,
      )
    const visitKey = `${resolve(configFile)}\0${resolvedConfig}`
    if (visited.has(visitKey)) continue
    visited.add(visitKey)
    const read = readGitConfigFile(resolvedConfig)
    if ('error' in read)
      throw new Error(
        `Git preservation cannot inspect config core.worktree: ${resolvedConfig}${read.status === null ? '' : `: ${read.error}`}`,
      )
    const worktree = gitConfigEntryValue(read.entries, 'core.worktree')
    if (portableRoot && worktree) {
      if (isAbsolute(worktree) || worktree === '~' || worktree.startsWith('~/'))
        throw new Error(
          `Git preservation cannot capture absolute nested core.worktree: ${worktree}`,
        )
      const resolvedWorktree = portableResolvedPointer(
        portableRoot,
        portableGitDir ?? dirname(resolvedConfig),
        worktree,
        'core.worktree',
      )
      if (sharesSourceGitDirectory(portableRoot, resolvedWorktree))
        throw new Error(
          `Git preservation cannot capture nested core.worktree in the source Git directory: ${worktree}`,
        )
    }
    for (const { value, condition } of gitConfigIncludePaths(read.entries)) {
      if (portableRoot && condition) {
        const gitdir = condition.match(/^gitdir(?:\/i)?:(.*)$/i)
        const pattern = gitdir?.[1]
        if (pattern && (isAbsolute(pattern) || pattern === '~' || pattern.startsWith('~/')))
          throw new Error(
            `Git preservation cannot capture nonportable nested config condition: ${condition}`,
          )
      }
      if (portableRoot && (isAbsolute(value) || value === '~' || value.startsWith('~/')))
        throw new Error(`Git preservation has no portable nested config include path: ${value}`)
      const resolved = portableRoot
        ? portableResolvedPointer(portableRoot, dirname(configFile), value, 'config include')
        : resolvedIfPresent(resolveIncludePath(configFile, value))
      if (portableRoot && sharesSourceGitDirectory(portableRoot, resolved))
        throw new Error(
          `Git preservation has no nested config adapter for the source Git directory: ${value}`,
        )
      if (!roots.some((root) => isWithin(root, resolved)))
        throw new Error(
          `Git preservation has no config dependency adapter for include path: ${value}`,
        )
      if (!existsSync(resolved))
        throw new Error(
          `Git preservation has no config dependency adapter for missing include: ${value}`,
        )
      queue.push({ logical: resolveIncludePath(configFile, value), resolved })
    }
  }
}

function createTar(
  archive: string,
  root: string,
  args: string[] = ['.'],
  fileList?: string[],
): void {
  execFileSync(
    'tar',
    [
      '--create',
      '--file',
      archive,
      '--format=posix',
      '--directory',
      root,
      '--xattrs',
      '--xattrs-include=*',
      '--acls',
      '--sparse',
      '--numeric-owner',
      ...(fileList
        ? ['--null', '--verbatim-files-from', '--no-recursion', '--files-from', '-']
        : args),
    ],
    { input: fileList ? fileList.join('\0') + '\0' : undefined, stdio: ['pipe', 'pipe', 'pipe'] },
  )
}

export function withRestoredArchive<T>(archive: string, fn: (root: string) => T): T {
  const sandbox = mkdtempSync(join(tmpdir(), 'clade-preservation-restore-'))
  const restored = join(sandbox, 'tree')
  mkdirSync(restored, 0o700)
  try {
    execFileSync(
      'tar',
      [
        '--extract',
        '--same-permissions',
        '--xattrs',
        '--xattrs-include=*',
        '--acls',
        '--file',
        archive,
        '--directory',
        restored,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return fn(restored)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}

function restoredInventory(archive: string, options: InventoryOptions): SourceInventory {
  return withRestoredArchive(archive, (restored) => inventoryTree(restored, options))
}

function restoreAndCompare(
  archive: string,
  expected: SourceInventory,
  options: InventoryOptions,
): void {
  const actual = restoredInventory(archive, options)
  const expectedExternalSymlinks = new Set(expected.externalSymlinks)
  const relocatedInternalSymlinks = actual.externalSymlinks.filter(
    (path) => !expectedExternalSymlinks.has(path),
  )
  if (relocatedInternalSymlinks.length)
    throw new Error(
      `Offline restore relocates internal symlinks outside the restored root: ${relocatedInternalSymlinks.join(', ')}`,
    )
  if (actual.externalSymlinks.length && !options.allowExternalSymlinks)
    throw new Error(
      `Offline restore contains symlinks outside the restored root: ${actual.externalSymlinks.join(', ')}`,
    )
  if (actual.digest === expected.digest && actual.entryCount === expected.entryCount) {
    verifyRestoredNestedGitClosure(archive, options)
    return
  }
  const expectedByPath = new Map(
    expected.entries.map((entry) => [entry.path, JSON.stringify(inventoryIdentityEntry(entry))]),
  )
  const actualByPath = new Map(
    actual.entries.map((entry) => [entry.path, JSON.stringify(inventoryIdentityEntry(entry))]),
  )
  const mismatch = [...new Set([...expectedByPath.keys(), ...actualByPath.keys()])]
    .filter((path) => expectedByPath.get(path) !== actualByPath.get(path))
    .slice(0, 3)
    .map((path) => `${path}: expected=${expectedByPath.get(path)} actual=${actualByPath.get(path)}`)
    .join('; ')
  throw new Error(
    `Offline restore inventory mismatch: expected ${expected.digest}, got ${actual.digest}; ${mismatch}`,
  )
}

function verifyRestoredNestedGitClosure(archive: string, options: InventoryOptions): void {
  if (options.allowNestedRepositories !== true) return
  withRestoredArchive(archive, (restored) => {
    const inventory = inventoryTree(restored, options)
    for (const repo of nestedRepositoryPaths(restored, inventory)) {
      assertContainedNestedGitStorage(repo, restored)
      try {
        execFileSync('git', ['-C', repo, 'rev-list', '--objects', '--all', '--reflog'], {
          env: isolatedGitEnv,
          stdio: ['ignore', 'ignore', 'pipe'],
        })
        execFileSync('git', ['-C', repo, 'fsck', '--full', '--strict'], {
          env: isolatedGitEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`Offline restored nested Git closure verification failed: ${detail}`, {
          cause: error,
        })
      }
    }
  })
}

function assertInventoryStable(
  expected: SourceInventory,
  actual: SourceInventory,
  label: string,
): void {
  if (expected.digest !== actual.digest || expected.entryCount !== actual.entryCount)
    throw new Error(`${label} changed during preservation capture`)
}

function compareAndInventory(
  archive: string,
  root: string,
  expected: SourceInventory,
  options: InventoryOptions,
): void {
  execFileSync(
    'tar',
    [
      '--compare',
      '--xattrs',
      '--xattrs-include=*',
      '--acls',
      '--file',
      archive,
      '--directory',
      root,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  restoreAndCompare(archive, expected, options)
}

function verifyRestoredGitClosure(
  archive: string,
  expected: SourceInventory,
  expectedHead: string,
  options: InventoryOptions,
): void {
  withRestoredArchive(archive, (restored) => {
    const inventory = inventoryTree(restored, options)
    assertInventoryStable(expected, inventory, 'Restored Git inventory')
    assertNoNestedRepositories(restored, inventory)
    assertGitConfigClosure(restored, inventory, [restored])
    isolateRestoredGitConfig(restored, restored)
    assertGitClosureLocal(restored, restored, restored, inventory)
    try {
      verifyRestoredGitObjects(restored, expectedHead)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Offline restored Git closure verification failed: ${detail}`, {
        cause: error,
      })
    }
  })
}

function verifyRestoredGitClosureDigest(
  archive: string,
  expected: { digest: string; entries: number; head: string },
  options: InventoryOptions,
): void {
  withRestoredArchive(archive, (restored) => {
    const inventory = inventoryTree(restored, options)
    if (inventory.digest !== expected.digest || inventory.entryCount !== expected.entries)
      throw new Error(
        `Offline restore inventory mismatch: expected ${expected.digest}, got ${inventory.digest}`,
      )
    assertNoNestedRepositories(restored, inventory)
    assertGitConfigClosure(restored, inventory, [restored])
    isolateRestoredGitConfig(restored, restored)
    assertGitClosureLocal(restored, restored, restored, inventory)
    try {
      verifyRestoredGitObjects(restored, expected.head)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Offline restored Git closure verification failed: ${detail}`, {
        cause: error,
      })
    }
  })
}

function verifyRestoredGitLayout(
  worktreeArchive: string,
  gitArchivePath: string,
  sourcePath: string,
  sourceCommon: string,
  expectedGit: { digest: string; entries: number; head: string },
  options: InventoryOptions,
): void {
  withRestoredArchive(worktreeArchive, (worktree) =>
    withRestoredArchive(gitArchivePath, (restoredGit) => {
      const inventory = inventoryTree(restoredGit, options)
      if (inventory.digest !== expectedGit.digest || inventory.entryCount !== expectedGit.entries)
        throw new Error(
          `Offline restore inventory mismatch: expected ${expectedGit.digest}/${expectedGit.entries}, got ${inventory.digest}/${inventory.entryCount}`,
        )
      const pointer = join(worktree, '.git')
      if (lstatSync(pointer).isFile()) {
        const line = readFileSync(pointer, 'utf8')
          .split('\n')
          .find((value) => value.startsWith('gitdir:'))
        if (!line || !line.slice('gitdir:'.length).trim())
          throw new Error(`Offline restored worktree has a malformed .git pointer: ${pointer}`)
        const originalTarget = resolve(sourcePath, line.slice('gitdir:'.length).trim())
        const relativeTarget = relative(sourceCommon, originalTarget)
        if (!relativeTarget || relativeTarget.startsWith('../') || relativeTarget === '..')
          throw new Error(
            `Offline restored worktree .git pointer escapes the Git archive: ${pointer}`,
          )
        const restoredTarget = join(restoredGit, relativeTarget)
        if (!existsSync(restoredTarget))
          throw new Error(`Offline restored worktree .git target is missing: ${restoredTarget}`)
        writeFileSync(pointer, `gitdir: ${restoredTarget}\n`)
        const gitdirRecord = join(restoredTarget, 'gitdir')
        if (existsSync(gitdirRecord)) writeFileSync(gitdirRecord, `${join(worktree, '.git')}\n`)
      } else {
        // Ordinary repositories carry a second copy of .git in the worktree archive.
        // Point the restored tree at the independently verified Git archive so its captured
        // config cannot redirect verification back to the live machine.
        rmSync(pointer, { recursive: true, force: true })
        writeFileSync(pointer, `gitdir: ${restoredGit}\n`)
      }
      assertLinkedWorktreeMetadataLocal(worktree, restoredGit)
      assertNoNestedRepositories(restoredGit, inventory)
      assertGitConfigClosure(restoredGit, inventory, [restoredGit, worktree])
      isolateRestoredGitConfig(restoredGit, worktree)
      assertGitClosureLocal(restoredGit, restoredGit, restoredGit, inventory)
      try {
        const effectiveGitDirectory = execFileSync(
          'git',
          ['-C', worktree, 'rev-parse', '--path-format=absolute', '--git-dir'],
          { encoding: 'utf8', env: isolatedGitEnv, stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim()
        if (!isWithin(restoredGit, resolvedIfPresent(effectiveGitDirectory)))
          throw new Error(
            `Offline restored worktree uses Git metadata outside its archive: ${effectiveGitDirectory}`,
          )
        const effectiveWorktree = execFileSync(
          'git',
          ['-C', worktree, 'rev-parse', '--path-format=absolute', '--show-toplevel'],
          { encoding: 'utf8', env: isolatedGitEnv, stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim()
        if (resolvedIfPresent(effectiveWorktree) !== resolvedIfPresent(worktree))
          throw new Error(
            `Offline restored Git resolves a worktree outside the restore: ${effectiveWorktree}`,
          )
        execFileSync('git', ['-C', worktree, 'status', '--porcelain'], {
          env: { ...isolatedGitEnv, CLADE_PRESERVATION_OFFLINE_VERIFY: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        const restoredHead = execFileSync(
          'git',
          ['-C', worktree, 'rev-parse', '--verify', 'HEAD'],
          { encoding: 'utf8', env: isolatedGitEnv, stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim()
        if (restoredHead !== expectedGit.head)
          throw new Error(
            `Offline restored Git HEAD mismatch: expected ${expectedGit.head}, got ${restoredHead}`,
          )
        verifyRestoredGitObjects(restoredGit, expectedGit.head)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`Offline restored Git layout verification failed: ${detail}`, {
          cause: error,
        })
      }
    }),
  )
}

function verifyRestoredGitObjects(gitDirectory: string, expectedHead: string): void {
  execFileSync('git', ['--git-dir', gitDirectory, 'cat-file', '-e', `${expectedHead}^{commit}`], {
    env: isolatedGitEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  execFileSync('git', ['--git-dir', gitDirectory, 'rev-list', '--objects', '--all', '--reflog'], {
    env: isolatedGitEnv,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  execFileSync('git', ['--git-dir', gitDirectory, 'fsck', '--full', '--strict'], {
    env: isolatedGitEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

// The recorded `gitdir:` text names `<admin>/modules/<chain>`. The chain
// is never read off a bare `/modules/` segment — an ancestor directory may
// legitimately be named `modules`, and the leftmost match would fabricate
// a chain resolving nowhere or into a wrong repo. The only trustworthy
// text anchor is the admin tail itself (`<adminId>/modules/`, where the
// id is the worktree admin basename — `.git` on a main checkout). The
// match must be segment-aligned on the left (a directory merely ENDING in
// the admin id — `foo.git` for `.git` — is not the admin dir), and the
// LAST aligned occurrence wins: the repo's own ancestors may legitimately
// contain `<adminId>/modules/` (a checkout nested inside another
// worktree's module tree), while a chain can only repeat the tail if a
// submodule is literally named the admin id — a shape the downstream
// module verification fails closed on either way.
export function moduleChainFromAdminTail(gitdir: string, adminId: string): string | undefined {
  const normalized = gitdir.replaceAll('\\', '/')
  const tail = `${adminId}/modules/`
  let idx = -1
  for (let from = 0; ; ) {
    const hit = normalized.indexOf(tail, from)
    if (hit < 0) break
    if (hit === 0 || normalized[hit - 1] === '/') idx = hit
    from = hit + 1
  }
  if (idx < 0) return undefined
  return normalized.slice(idx + tail.length) || undefined
}

// Full chain extraction for a live pointer: absolute text is matched
// against the live modules dir itself; a pointer still resolving inside
// that dir needs no anchor; stale text falls back to the admin tail.
export function recordedModuleChain(
  gitdir: string,
  checkout: string,
  adminId: string,
  modulesName: string,
): string | undefined {
  const normalized = gitdir.replaceAll('\\', '/')
  const prefix = `${modulesName.replaceAll('\\', '/')}/`
  if (normalized.startsWith(prefix)) return normalized.slice(prefix.length) || undefined
  const fromCheckout = relative(modulesName, resolve(checkout, gitdir))
  if (fromCheckout && !fromCheckout.startsWith('..') && !isAbsolute(fromCheckout)) {
    return fromCheckout
  }
  return moduleChainFromAdminTail(gitdir, adminId)
}

export function readPreservationReceipt(archive: string): PreservationReceipt {
  const receiptPath = join(dirname(archive), 'receipt.json')
  const parsed: unknown = JSON.parse(readFileSync(receiptPath, 'utf8'))
  if (!isCompletedReceipt(parsed))
    throw new Error(`Preservation receipt is invalid: ${receiptPath}`)
  return parsed
}

// The archive-integrity half of verifyPreservationArchive: the receipt is
// complete and every recorded archive file still matches its digest. No
// live-source comparison — a caller resuming a journaled removal holds a
// legitimately diverged post-teardown source, but the recorded artifacts
// must still be proven intact before cleanup may complete: trash is
// operator-collected, so a corrupt archive must never become the last copy.
export function verifyPreservationArchiveIntegrity(
  archive: string,
  options: InventoryOptions = {},
): boolean {
  try {
    const receipt: unknown = JSON.parse(
      readFileSync(join(dirname(archive), 'receipt.json'), 'utf8'),
    )
    if (!isCompletedReceipt(receipt)) return false
    // Same profile binding as verifyPreservationArchive: a journaled
    // resume must never trust artifacts captured under a superseded
    // policy — an obsolete profile's coverage no longer proves this
    // removal preserves what the current profile requires.
    if (
      options.expectedProfile &&
      (receipt.profile.id !== options.expectedProfile.id ||
        receipt.profile.version !== options.expectedProfile.version)
    )
      return false
    if (receipt.archives.worktree.path !== archive) return false
    if (!existsSync(archive) || sha256File(archive) !== receipt.archives.worktree.digest)
      return false
    if (Boolean(receipt.source.gitCommonDir) !== Boolean(receipt.archives.git)) return false
    if (Boolean(receipt.archives.git) !== Boolean(receipt.inventory.git)) return false
    return !(
      receipt.archives.git &&
      (!existsSync(receipt.archives.git.path) ||
        sha256File(receipt.archives.git.path) !== receipt.archives.git.digest)
    )
  } catch {
    return false
  }
}

export function verifyPreservationArchive(
  archive: string,
  sourcePath: string,
  options: InventoryOptions = {},
): boolean {
  try {
    const receiptPath = join(dirname(archive), 'receipt.json')
    const receipt: unknown = JSON.parse(readFileSync(receiptPath, 'utf8'))
    if (!isCompletedReceipt(receipt)) return false
    if (
      options.expectedProfile &&
      (receipt.profile.id !== options.expectedProfile.id ||
        receipt.profile.version !== options.expectedProfile.version)
    )
      return false
    if (
      receipt.source.path !== sourcePath ||
      receipt.archives.worktree.path !== archive ||
      !existsSync(archive) ||
      sha256File(archive) !== receipt.archives.worktree.digest
    )
      return false
    if (existsSync(sourcePath)) {
      const currentGitCommonDir = existsSync(join(sourcePath, '.git'))
        ? gitValue(sourcePath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
        : undefined
      const currentHead = currentGitCommonDir
        ? gitValue(sourcePath, ['rev-parse', 'HEAD'])
        : undefined
      if (
        currentGitCommonDir !== receipt.source.gitCommonDir ||
        currentHead !== receipt.source.head
      )
        return false
      const currentGitInventory = currentGitCommonDir
        ? inventoryTree(
            currentGitCommonDir,
            options,
            gitExcludedRootsForArchive(sourcePath, currentGitCommonDir, dirname(dirname(archive))),
          )
        : undefined
      if (
        Boolean(currentGitInventory) !== Boolean(receipt.inventory.git) ||
        currentGitInventory?.digest !== receipt.inventory.git?.digest ||
        currentGitInventory?.entryCount !== receipt.inventory.git?.entries
      )
        return false
      const currentWorktree = inventoryTree(sourcePath, options)
      if (
        currentWorktree.digest !== receipt.inventory.digest ||
        currentWorktree.entryCount !== receipt.inventory.entries
      )
        return false
    }
    const worktree = restoredInventory(archive, options)
    if (worktree.externalSymlinks.length && !options.allowExternalSymlinks) return false
    const hasGitMarker = worktree.entries.some(
      (entry) => entry.path === '.git' && (entry.type === 'file' || entry.type === 'directory'),
    )
    if (hasGitMarker && !receipt.source.gitCommonDir) return false
    if (
      worktree.digest !== receipt.inventory.digest ||
      worktree.entryCount !== receipt.inventory.entries
    )
      return false
    verifyRestoredNestedGitClosure(archive, options)
    if (Boolean(receipt.source.gitCommonDir) !== Boolean(receipt.archives.git)) return false
    if (Boolean(receipt.archives.git) !== Boolean(receipt.inventory.git)) return false
    if (receipt.archives.git) {
      if (
        !existsSync(receipt.archives.git.path) ||
        sha256File(receipt.archives.git.path) !== receipt.archives.git.digest
      )
        return false
      verifyRestoredGitClosureDigest(
        receipt.archives.git.path,
        {
          ...receipt.inventory.git,
          head: receipt.source.head!,
        },
        options,
      )
      if (receipt.source.gitCommonDir)
        verifyRestoredGitLayout(
          archive,
          receipt.archives.git.path,
          sourcePath,
          receipt.source.gitCommonDir,
          { ...receipt.inventory.git, head: receipt.source.head! },
          options,
        )
    }
    return true
  } catch {
    return false
  }
}

function gitArchive(
  root: string,
  destination: string,
  options: InventoryOptions,
  common: string | undefined,
  excludedRoot?: string,
  excludedRoots: string[] = [],
  expectedInventory?: SourceInventory,
  expectedHead?: string,
): { path: string; digest: string; bytes: number } | undefined {
  if (!common) return undefined
  const inventory =
    expectedInventory ??
    inventoryTree(common, options, [...(excludedRoot ? [excludedRoot] : []), ...excludedRoots])
  if (inventory.specialFiles.length || inventory.externalSymlinks.length)
    throw new Error('Git common directory contains unsupported special files or external symlinks')
  if (!inventory.entries.length) return undefined
  createTar(
    destination,
    common,
    [],
    inventory.entries.map((entry) => entry.path || '.'),
  )
  syncFile(destination)
  compareAndInventory(destination, common, inventory, options)
  if (!expectedHead) throw new Error('Git preservation cannot verify an unborn HEAD')
  verifyRestoredGitClosure(destination, inventory, expectedHead, options)
  return { path: destination, digest: sha256File(destination), bytes: lstatSync(destination).size }
}

export function captureAndVerify(options: {
  sourceRoot: string
  archiveRoot: string
  profile: ConsumerProfile
  generation?: string
  consistencyBoundary?: string
}): PreservationReceipt {
  validateProfile(options.profile)
  if (options.profile.topology.lfs === 'declared-present')
    throw new Error(
      'Git LFS preservation requires a payload-closure adapter; storage locality alone is insufficient',
    )
  const metadataOptions = inventoryOptionsFromProfile(options.profile)
  const gitMetadataOptions: InventoryOptions = {
    acl: metadataOptions.acl,
    xattr: metadataOptions.xattr,
  }
  const sourceRoot = realpathSync(resolve(options.sourceRoot))
  const profileRoot = realpathSync(resolve(options.profile.roots.source))
  if (sourceRoot !== profileRoot)
    throw new Error('Preservation profile source does not match capture source')
  const archiveRoot = resolve(options.archiveRoot)
  if (archiveRoot === sourceRoot || archiveRoot.startsWith(`${sourceRoot}/`))
    throw new Error('Preservation archive must not be inside the source tree')
  mkdirSync(archiveRoot, { recursive: true, mode: 0o700 })
  const gitCommonDir = (() => {
    try {
      return gitValue(sourceRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    } catch (error) {
      try {
        lstatSync(join(sourceRoot, '.git'))
      } catch (gitPathError) {
        if ((gitPathError as { code?: string }).code === 'ENOENT') return undefined
        throw gitPathError
      }
      throw error
    }
  })()
  const capturedHead = gitCommonDir ? gitValue(sourceRoot, ['rev-parse', 'HEAD']) : undefined
  if (gitCommonDir && !capturedHead)
    throw new Error('Git preservation cannot capture an unborn HEAD')
  const gitExcludedRoots = gitCommonDir
    ? gitExcludedRootsForArchive(sourceRoot, gitCommonDir, archiveRoot)
    : []
  const gitInventory = gitCommonDir
    ? inventoryTree(gitCommonDir, gitMetadataOptions, gitExcludedRoots)
    : undefined
  const inventory = inventoryTree(sourceRoot, metadataOptions)
  assertNestedRepositoryPolicy(
    sourceRoot,
    inventory,
    metadataOptions.allowNestedRepositories === true,
  )
  if (gitCommonDir)
    assertGitlinkPolicy(
      sourceRoot,
      gitCommonDir,
      options.profile.topology.submodules === 'declared-present',
    )
  if (gitCommonDir && gitInventory) assertNoNestedRepositories(gitCommonDir, gitInventory)
  const configRoots = gitCommonDir ? [sourceRoot, gitCommonDir] : [sourceRoot]
  assertGitConfigClosure(sourceRoot, inventory, configRoots)
  if (gitCommonDir && gitInventory) assertGitConfigClosure(gitCommonDir, gitInventory, configRoots)
  if (gitCommonDir) {
    assertGitClosureLocal(sourceRoot, gitCommonDir, sourceRoot, inventory)
    if (gitInventory) assertGitClosureLocal(sourceRoot, gitCommonDir, gitCommonDir, gitInventory)
  }
  if (inventory.specialFiles.length)
    throw new Error(`Unsupported special files: ${inventory.specialFiles.join(', ')}`)
  if (inventory.externalSymlinks.length && !metadataOptions.allowExternalSymlinks)
    throw new Error(
      `External symlink targets are not captured by this archive adapter: ${inventory.externalSymlinks.join(', ')}`,
    )
  const symlinkAllowlist = options.profile.filesystem.externalSymlinkAllowlist
  if (symlinkAllowlist) {
    const unexpected = inventory.externalSymlinks.filter((path) => !symlinkAllowlist.includes(path))
    if (unexpected.length)
      throw new Error(
        `External symlinks outside the profile allowlist are not captured: ${unexpected.join(', ')}`,
      )
  }
  const capacity = capacityRequirement(archiveRoot, inventory, {
    gitRoot: gitCommonDir,
    gitExcludedRoots,
    restoreRoot: tmpdir(),
    byteReserve: options.profile.retention.byteReserve,
    inodeReserve: options.profile.retention.inodeReserve,
  })
  assertCapacity(capacity)
  let generation = options.generation ?? randomUUID()
  if (basename(generation) !== generation || generation === '.' || generation === '..')
    throw new Error('Preservation generation must be a single path segment')
  let partial = join(archiveRoot, `${generation}.partial`)
  let complete = join(archiveRoot, generation)
  if (existsSync(complete)) {
    const receiptPath = join(complete, 'receipt.json')
    if (!existsSync(receiptPath))
      throw new Error(`Completed preservation archive has no receipt: ${complete}`)
    const parsed: unknown = JSON.parse(readFileSync(receiptPath, 'utf8'))
    if (!isCompletedReceipt(parsed))
      throw new Error(`Completed preservation receipt is invalid: ${receiptPath}`)
    const archiveMatches = !(
      parsed.profile.id !== options.profile.id ||
      parsed.profile.version !== options.profile.version ||
      parsed.source.path !== sourceRoot ||
      parsed.source.gitCommonDir !== gitCommonDir ||
      parsed.source.head !== capturedHead ||
      parsed.inventory.digest !== inventory.digest ||
      parsed.archives.worktree.path !== join(complete, 'worktree.tar') ||
      !existsSync(parsed.archives.worktree.path) ||
      sha256File(parsed.archives.worktree.path) !== parsed.archives.worktree.digest ||
      Boolean(parsed.archives.git) !== Boolean(gitCommonDir) ||
      Boolean(parsed.inventory.git) !== Boolean(gitCommonDir) ||
      (parsed.inventory.git !== undefined &&
        (gitInventory === undefined ||
          parsed.inventory.git.digest !== gitInventory.digest ||
          parsed.inventory.git.entries !== gitInventory.entryCount)) ||
      (parsed.archives.git !== undefined &&
        (!existsSync(parsed.archives.git.path) ||
          sha256File(parsed.archives.git.path) !== parsed.archives.git.digest))
    )
    if (archiveMatches) {
      compareAndInventory(parsed.archives.worktree.path, sourceRoot, inventory, metadataOptions)
      if (parsed.archives.git && gitCommonDir) {
        restoreAndCompare(parsed.archives.git.path, gitInventory!, gitMetadataOptions)
        verifyRestoredGitClosure(
          parsed.archives.git.path,
          gitInventory!,
          capturedHead!,
          gitMetadataOptions,
        )
        verifyRestoredGitLayout(
          parsed.archives.worktree.path,
          parsed.archives.git.path,
          sourceRoot,
          gitCommonDir,
          { ...parsed.inventory.git!, head: capturedHead! },
          gitMetadataOptions,
        )
      }
      assertInventoryStable(
        inventory,
        inventoryTree(sourceRoot, metadataOptions),
        'Source inventory',
      )
      if (gitCommonDir && gitInventory)
        assertInventoryStable(
          gitInventory,
          inventoryTree(gitCommonDir, gitMetadataOptions, gitExcludedRoots),
          'Git inventory',
        )
      syncDirectoryAndParents(complete)
      return parsed
    }
    // The source may have changed after a teardown failure. Keep the old
    // completed receipt as evidence and capture a new generation for retry.
    generation = `${generation}-${randomUUID()}`
    partial = join(archiveRoot, `${generation}.partial`)
    complete = join(archiveRoot, generation)
  }
  mkdirSync(partial, { recursive: true, mode: 0o700 })
  const worktreeArchive = join(partial, 'worktree.tar')
  const gitArchivePath = join(partial, 'git.tar')
  try {
    createTar(
      worktreeArchive,
      sourceRoot,
      [],
      inventory.entries.map((entry) => entry.path || '.'),
    )
    syncFile(worktreeArchive)
    compareAndInventory(worktreeArchive, sourceRoot, inventory, metadataOptions)
    assertInventoryStable(inventory, inventoryTree(sourceRoot, metadataOptions), 'Source inventory')
    const gitArchiveResult = gitArchive(
      sourceRoot,
      gitArchivePath,
      gitMetadataOptions,
      gitCommonDir,
      undefined,
      gitExcludedRoots,
      gitInventory,
      capturedHead,
    )
    if (gitArchiveResult && gitCommonDir && gitInventory)
      verifyRestoredGitLayout(
        worktreeArchive,
        gitArchiveResult.path,
        sourceRoot,
        gitCommonDir,
        { digest: gitInventory.digest, entries: gitInventory.entryCount, head: capturedHead! },
        gitMetadataOptions,
      )
    assertInventoryStable(inventory, inventoryTree(sourceRoot, metadataOptions), 'Source inventory')
    if (gitCommonDir && gitInventory)
      assertInventoryStable(
        gitInventory,
        inventoryTree(gitCommonDir, gitMetadataOptions, gitExcludedRoots),
        'Git inventory',
      )
    const receipt: PreservationReceipt = {
      schemaVersion: PRESERVATION_SCHEMA_VERSION,
      operationId: generation,
      policy: { id: PRESERVATION_POLICY_ID, version: 1 },
      profile: { id: options.profile.id, version: options.profile.version },
      source: {
        path: sourceRoot,
        generation,
        gitCommonDir,
        head: capturedHead,
      },
      inventory: {
        digest: inventory.digest,
        entries: inventory.entryCount,
        logicalBytes: inventory.logicalBytes,
        allocatedBytes: inventory.allocatedBytes,
        ...(gitInventory
          ? {
              git: {
                digest: gitInventory.digest,
                entries: gitInventory.entryCount,
                logicalBytes: gitInventory.logicalBytes,
                allocatedBytes: gitInventory.allocatedBytes,
              },
            }
          : {}),
      },
      archives: {
        worktree: {
          path: join(complete, 'worktree.tar'),
          digest: sha256File(worktreeArchive),
          bytes: lstatSync(worktreeArchive).size,
        },
        ...(gitArchiveResult
          ? { git: { ...gitArchiveResult, path: join(complete, 'git.tar') } }
          : {}),
      },
      capacity,
      consistency: {
        method: 'caller-quiesced-and-source-stable',
        boundary: options.consistencyBoundary ?? 'capture-start-to-restore-verified',
      },
      state: 'RESTORE_VERIFIED',
      createdAt: new Date().toISOString(),
    }
    writeFileSync(join(partial, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    })
    syncFile(join(partial, 'receipt.json'))
    syncDirectory(partial)
    renameSync(partial, complete)
    syncDirectoryAndParents(archiveRoot)
    return receipt
  } catch (error) {
    rmSync(partial, { recursive: true, force: true })
    syncDirectoryAndParents(archiveRoot)
    throw error
  }
}
