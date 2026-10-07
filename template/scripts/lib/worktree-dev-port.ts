// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/worktree-dev-port.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/worktree-dev-port.ts
/**
 * worktree-dev-port.ts — 「這棵 worktree 的 dev server 聽哪個 port」的唯一 SoT。
 *
 * 分配與讀取都收斂到本檔，讓「哪個 port」對每一個消費端都是同一個答案：
 *
 *   - `wt-helper add` / `wt-helper dev`（worktree 建立時分配、起 dev server 時使用）
 *
 * ## 分配模型
 *
 * 一律是「**一個 offset 套用到該 consumer 宣告的每一個 port**」。兩個池，依序取：
 *
 *   1. **base 池** `base+1..base+9` —— registry 把各 consumer 的 base 排成 +10 間距，中間
 *      這 9 個號碼天然屬於它。號碼貼著 base，人看得懂，優先用。
 *   2. **worktree band**（registry `dev_ports.worktree_band`，4200–4899 區）—— base 池只有
 *      9 格，而單一 consumer 開到十幾條 worktree 是常態。band 是每個 consumer 各自 50 個
 *      號碼的專屬區段，與所有 base、dev-router 的 control/backend 區（3300–3510）完全不重疊。
 *
 * 兩池都排掉三件事：mapped port 落到別人的地盤、mapped port 撞到本 consumer 另一個宣告 port
 * （<consumer-a> 宣告 3040 + 3045）、offset 已被 sibling worktree 佔用。
 *
 * 分配紀錄寫在 `~/.cache/clade/dev-port/<consumer>/<basename>--<path SHA256>.json`，**不**進 repo：`.clade/` 在
 * 多數 consumer 沒被 gitignore，寫進去等於每條 worktree 帶一個 untracked 檔進 merge-back /
 * publish 的 dirty 判定。worktree 目錄消失即釋放槽位，不需要手動回收。
 */

import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, isAbsolute, join, resolve } from 'node:path'

export interface DeclaredDevPort {
  port: number
  alias: string
}

/** `[start, end]`，兩端皆含。 */
export type WorktreePortBand = [number, number]

export interface WorktreeDevPortRecord {
  offset: number
  base: number
  wtPath: string
  ports: { alias: string; port: number; mainPort: number }[]
  /** 這個 offset 來自哪個池。舊紀錄沒有這欄，一律視為 `base`。 */
  pool?: 'base' | 'band'
}

/** registry 把各 consumer 的 base 排成 +10 間距，所以 base+1..base+9 屬於這個 consumer。 */
export const DEV_PORT_BAND = 9

const ALLOCATION_LOCK = '.allocation.lock'
const LOCK_TIMEOUT_MS = 2000
const LOCK_RETRY_MS = 25
const MAX_RECORD_BYTES = 64 * 1024
/** 加在「JSON.parse 失敗」的 record 錯誤上，讓掃描端能把不可讀檔跟 unsafe／changed 分開。 */
const ERR_RECORD_MALFORMED = 'ERR_DEV_PORT_MALFORMED'
const lockWait = new Int32Array(new SharedArrayBuffer(4))

interface RecordSnapshot {
  record: WorktreeDevPortRecord
  bytes: Buffer
  identity: Stats
}

interface RecordValue {
  value: unknown
  bytes: Buffer
  identity: Stats
}

function recordName(wtPath: string): string {
  const normalized = resolve(wtPath)
  const digest = createHash('sha256').update(normalized).digest('hex')
  return `${basename(normalized)}--${digest}.json`
}

function legacyRecordName(wtPath: string): string {
  return `${basename(resolve(wtPath))}.json`
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

function sameInode(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function validPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 65535
}

function isDevPortRecord(value: unknown): value is WorktreeDevPortRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<WorktreeDevPortRecord>
  if (
    typeof record.wtPath !== 'string' ||
    !isAbsolute(record.wtPath) ||
    !Number.isSafeInteger(record.offset) ||
    record.offset! <= 0 ||
    !validPort(record.base) ||
    !Array.isArray(record.ports) ||
    record.ports.length === 0 ||
    (record.pool !== undefined && record.pool !== 'base' && record.pool !== 'band')
  )
    return false
  const aliases = new Set<string>()
  const mainPorts = new Set<number>()
  for (const port of record.ports) {
    if (
      typeof port !== 'object' ||
      port === null ||
      typeof port.alias !== 'string' ||
      port.alias.length === 0 ||
      aliases.has(port.alias) ||
      !validPort(port.mainPort) ||
      port.mainPort < record.base ||
      mainPorts.has(port.mainPort) ||
      !validPort(port.port) ||
      port.port !== port.mainPort + record.offset!
    )
      return false
    aliases.add(port.alias)
    mainPorts.add(port.mainPort)
  }
  if (record.ports[0].mainPort !== record.base) return false
  if (record.ports.some((port) => mainPorts.has(port.port))) return false
  if ((record.pool ?? 'base') === 'base') {
    return (
      record.offset! <= DEV_PORT_BAND &&
      record.ports.every((port) => port.port <= record.base! + DEV_PORT_BAND)
    )
  }
  return record.offset! > DEV_PORT_BAND
}

function sameAllocation(left: WorktreeDevPortRecord, right: WorktreeDevPortRecord): boolean {
  return (
    resolve(left.wtPath) === resolve(right.wtPath) &&
    left.offset === right.offset &&
    left.base === right.base &&
    (left.pool ?? 'base') === (right.pool ?? 'base') &&
    left.ports.length === right.ports.length &&
    left.ports.every((port) =>
      right.ports.some(
        (other) =>
          port.alias === other.alias &&
          port.port === other.port &&
          port.mainPort === other.mainPort,
      ),
    )
  )
}

// TOCTOU-safe read without the strict record schema: release paths must
// recognize every record the lax holders listing would surface, including
// pre-schema `{ offset, wtPath }` files the strict reader refuses.
function readRecordValue(path: string): RecordValue | null {
  let before: Stats
  try {
    before = lstatSync(path)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error(`Unsafe dev-port record: ${path}`)
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const identity = fstatSync(fd)
    if (!sameInode(before, identity) || !identity.isFile() || identity.size > MAX_RECORD_BYTES)
      throw new Error(`Changed or oversized dev-port record: ${path}`)
    const bytes = readFileSync(fd)
    const after = fstatSync(fd)
    if (
      bytes.length !== identity.size ||
      after.size !== identity.size ||
      after.mtimeMs !== identity.mtimeMs ||
      !sameInode(identity, lstatSync(path))
    )
      throw new Error(`Dev-port record changed while reading: ${path}`)
    let value: unknown
    try {
      value = JSON.parse(bytes.toString('utf8'))
    } catch (error) {
      const malformed = new Error(`Malformed dev-port record: ${path}`, { cause: error })
      ;(malformed as NodeJS.ErrnoException).code = ERR_RECORD_MALFORMED
      throw malformed
    }
    return { value, bytes, identity }
  } finally {
    closeSync(fd)
  }
}

function readRecordSnapshot(path: string): RecordSnapshot | null {
  const read = readRecordValue(path)
  if (read === null) return null
  if (!isDevPortRecord(read.value)) throw new Error(`Invalid dev-port record fields: ${path}`)
  return { record: read.value, bytes: read.bytes, identity: read.identity }
}

function releaseLock(path: string, fd: number): void {
  try {
    if (!sameInode(fstatSync(fd), lstatSync(path)))
      throw new Error(`Dev-port allocation lock was replaced; retained: ${path}`)
    unlinkSync(path)
  } finally {
    closeSync(fd)
  }
}

function readStateDirectory(dir: string): Stats | null {
  let directory: Stats
  try {
    directory = lstatSync(dir)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new Error(`Unsafe dev-port state directory: ${dir}`)
  return directory
}

function parseLockPid(text: string): number | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return null
    const pid: unknown = Reflect.get(parsed, 'pid')
    return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * 鎖檔記了持有人 pid；holder 死掉（SIGKILL、當機）的殘鎖永遠不會自己消失，pid
 * 確認不在就接手刪掉重搶。讀不出 pid 的鎖——別的實作寫的、或寫到一半就死的——
 * 辨不出持有人，NEVER 搶，留給 busy 錯誤附上人工移除指引。
 *
 * 刪之前握著 fd 比對 inode：讀完到 unlink 之間檔案可能被換成別人的新鎖，
 * 刪掉的必須是剛驗過死亡的那顆。
 */
function tryStealDeadLock(path: string): boolean {
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    return false
  }
  try {
    const identity = fstatSync(fd)
    if (!identity.isFile()) return false
    const pid = parseLockPid(readFileSync(fd).toString('utf8'))
    if (pid === null || pidAlive(pid)) return false
    try {
      if (!sameInode(identity, lstatSync(path))) return false
      unlinkSync(path)
      return true
    } catch {
      return false
    }
  } finally {
    closeSync(fd)
  }
}

function withConsumerLock<T>(consumerRoot: string, operation: () => T): T {
  const dir = devPortStateDir(consumerRoot)
  mkdirSync(dir, { recursive: true })
  const directory = readStateDirectory(dir)
  if (directory === null) throw new Error(`Dev-port state directory disappeared: ${dir}`)
  const path = join(dir, ALLOCATION_LOCK)
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let fd: number
  for (;;) {
    try {
      fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const existing = lstatSync(path)
        if (!existing.isFile() || existing.isSymbolicLink())
          throw new Error(`Unsafe dev-port allocation lock; retained: ${path}`, { cause: error })
      } catch (inspectionError) {
        if (!isMissing(inspectionError)) throw inspectionError
        continue // 視窗內已被持有人放掉，直接重搶不用等
      }
      if (tryStealDeadLock(path)) continue
      const remaining = deadline - Date.now()
      if (remaining <= 0)
        throw new Error(
          `Dev-port allocation lock busy; retained: ${path}. ` +
            `If no wt-helper/dev run is actually holding it, remove the file to recover.`,
          { cause: error },
        )
      Atomics.wait(lockWait, 0, 0, Math.min(LOCK_RETRY_MS, remaining))
    }
  }
  let outcome: { ok: true; value: T } | { ok: false; error: unknown }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, token: randomUUID() }) + '\n')
    fsyncSync(fd)
    if (!sameInode(directory, lstatSync(dir)))
      throw new Error(`Dev-port state directory was replaced: ${dir}`)
    outcome = { ok: true, value: operation() }
  } catch (error) {
    outcome = { ok: false, error }
  }
  try {
    releaseLock(path, fd)
  } catch (error) {
    if (outcome.ok === false)
      throw new AggregateError(
        [outcome.error, error],
        'Dev-port operation and lock release failed',
        {
          cause: error,
        },
      )
    throw error
  }
  if (outcome.ok === false) throw outcome.error
  return outcome.value
}

/**
 * 分配紀錄放在 repo 外。寫進 `.clade/` 會在約 7 個 consumer（其 `.gitignore` 沒涵蓋該路徑）
 * 的每一條 worktree 留下 untracked 檔，而那正好出現在 merge-back / publish 這兩個把 dirty
 * 當風險的流程裡。
 */
export function devPortStateDir(consumerRoot: string): string {
  return join(
    process.env.XDG_CACHE_HOME || join(process.env.HOME || '', '.cache'),
    'clade',
    'dev-port',
    basename(consumerRoot),
  )
}

/**
 * base 池：1..9 之中最小的可用 offset，需同時滿足
 *   - 每個 mapped port 都在 `[base, base+9]` 內 —— 不會踩到下一個 consumer 的 base
 *   - mapped port 不等於本 consumer 另一個宣告 port（<consumer-a> 宣告 3040 + 3045，offset 5 會讓
 *     `<client-a>` 蓋掉 `shared`）
 *   - offset 沒被 sibling worktree 佔用
 * 池滿回 null（由 band 池接手）。
 */
export function pickDevPortOffset(
  declared: readonly DeclaredDevPort[],
  usedOffsets: ReadonlySet<number>,
): number | null {
  if (declared.length === 0) return null
  const base = declared[0].port
  const declaredSet = new Set(declared.map((d) => d.port))
  for (let n = 1; n <= DEV_PORT_BAND; n++) {
    if (usedOffsets.has(n)) continue
    const mapped = declared.map((d) => d.port + n)
    if (mapped.some((p) => p > base + DEV_PORT_BAND)) continue
    if (mapped.some((p) => declaredSet.has(p))) continue
    return n
  }
  return null
}

/**
 * band 池：把 band 切成寬度 `spread + 1` 的槽（spread = 最高宣告 port − base），逐槽試。
 *
 * 回傳的仍是**一個 offset**（`槽首 − base`），與 base 池同型 —— 下游每個消費端算 port 的方式
 * 只有一條：`宣告 port + offset`。band 池回來的 offset 是三位數起跳（<consumer-b> base 3000、band
 * 4400 → offset 1400），那是刻意的：任何地方若把 offset 當成「1..9 的小數字」處理都會當場
 * 露餡，而不是安靜地算出一個別人的 port。
 */
export function pickBandPortOffset(
  declared: readonly DeclaredDevPort[],
  usedOffsets: ReadonlySet<number>,
  band: WorktreePortBand | null,
): number | null {
  if (declared.length === 0 || !band) return null
  const [start, end] = band
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return null
  const base = declared[0].port
  const spread = declared[declared.length - 1].port - base
  const width = spread + 1
  for (let slotStart = start; slotStart + spread <= end; slotStart += width) {
    const offset = slotStart - base
    if (usedOffsets.has(offset)) continue
    return offset
  }
  return null
}

/**
 * 這棵 worktree 該用的 offset。base 池優先，滿了才進 band；兩池都滿回 null。
 *
 * **NEVER** 在這裡 fallback 到 offset 0（= base port）—— 那正是「兩條 worktree 指向同一台
 * dev server」這個 bug 的形狀，而它不會報錯，只會讓某個人的驗收畫面顯示別人的 code。
 */
export function allocateDevPortOffset(
  declared: readonly DeclaredDevPort[],
  usedOffsets: ReadonlySet<number>,
  band: WorktreePortBand | null,
): number | null {
  return pickDevPortOffset(declared, usedOffsets) ?? pickBandPortOffset(declared, usedOffsets, band)
}

/**
 * 這個 consumer 實際能發出幾個槽位。
 *
 * **不是** `DEV_PORT_BAND + band 寬度`：每個宣告 port 套同一個 offset，所以最高的那個宣告
 * port 先撞到天花板 —— 宣告 3040 + 3045 的 consumer 在 9 寬的 base 池裡只有 4 格。把池寬
 * 當容量報出去，等於告訴讀者「還有 5 格」，而那正是他在決定要不要清掉一條 worktree 時
 * 最不該相信的數字。
 *
 * 用窮舉 `allocateDevPortOffset` 得出，不另算一份算術 —— 兩者不可能不一致。
 */
export function devPortCapacity(
  declared: readonly DeclaredDevPort[],
  band: WorktreePortBand | null = null,
): number {
  const used = new Set<number>()
  for (;;) {
    const offset = allocateDevPortOffset(declared, used, band)
    if (offset === null) return used.size
    used.add(offset)
  }
}

/**
 * 其他 worktree 佔著的 offset——**唯讀、零副作用**版本，服務 `wt-helper dev --dry-run`
 * 這類預覽路徑：不 mkdir、不拿鎖、不刪檔。目錄不存在就回空集合。
 *
 * 樹已消失的紀錄這裡只跳過不刪；實際釋放由帶鎖的 collectSiblingOffsets 在分配時做，
 * 所以任何清理路徑都不必記得做額外的 deallocate。
 */
export function siblingDevPortOffsets(consumerRoot: string, selfWtPath: string): Set<number> {
  const dir = devPortStateDir(consumerRoot)
  if (readStateDirectory(dir) === null) return new Set()
  return collectSiblingOffsets(consumerRoot, selfWtPath, false)
}

function worktreeGone(wtPath: string): boolean {
  try {
    lstatSync(wtPath)
    return false
  } catch (error) {
    if (isMissing(error)) return true
    throw error
  }
}

/**
 * 拿出 wtPath 卻拿不出合法 claim 的檔（JSON 都 parse 不了、或 wtPath 不是絕對路徑）
 * 永遠不會自己變回合法紀錄——紀錄寫入是 atomic publish，殘缺只能是 pre-schema
 * 非 atomic 寫的截斷檔或外來垃圾。它可能是一棵活樹的殘檔所以不能刪，改名離開
 * `.json` 掃描範圍留證：一筆壞檔不該把整個 consumer 的分配卡死。
 */
function quarantineRecord(path: string): void {
  try {
    renameSync(path, `${path}.invalid`)
  } catch (error) {
    if (!isMissing(error)) throw error
  }
}

function releaseStaleRecord(path: string, snapshot: RecordValue): void {
  const current = readRecordValue(path)
  if (
    current === null ||
    !sameInode(current.identity, snapshot.identity) ||
    !current.bytes.equals(snapshot.bytes)
  )
    throw new Error(`Dev-port record changed before stale release; retained: ${path}`)
  unlinkSync(path)
}

/**
 * pre-schema 紀錄的最小形狀：`{ wtPath, offset }`。舊的非 atomic 寫入與更早的
 * 登記格式都可能留下它——holders 列表與 release 讀端是 lax 的，分配端對一棵
 * **還活著**的樹也必須認它佔著的那格，否則同一格會被發給第二棵樹。
 */
function preSchemaClaim(value: unknown): { wtPath: string; offset: number } | null {
  const rec = value as { wtPath?: unknown; offset?: unknown } | null
  const wtPath = rec?.wtPath
  const offset = rec?.offset
  if (typeof wtPath !== 'string' || !isAbsolute(wtPath)) return null
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset <= 0) return null
  return { wtPath, offset }
}

/**
 * 掃描 sibling 紀錄 → 佔用 offset 集合。
 *
 * 兩個 phase：先逐檔判「死樹／不可讀／活樹」——死樹紀錄在 mutate 模式驗證未變
 * 後就地刪（釋放槽位）、不可讀檔隔離成 `<name>.invalid`——再對活樹紀錄做嚴格
 * 驗證、檔名歸屬與 offset 衝突檢查。**順序不能反**：一筆 pre-schema 殘檔或截斷
 * 檔本來就該被清掉，讓嚴格驗證跑在清理前面等於讓一筆死紀錄卡死整個 consumer。
 *
 * mutate=false（dry-run 預覽）走同一份掃描但零寫入：跳過死樹與壞檔而不動它們。
 * 活樹的紀錄兩種模式一律 fail-closed：嚴格 schema 過不了就看 pre-schema claim
 * （認 offset、檔留著）；claim 也認不出、檔名對不上 wtPath、或 offset 撞喬才 throw。
 */
function collectSiblingOffsets(
  consumerRoot: string,
  selfWtPath: string,
  mutate: boolean,
): Set<number> {
  const dir = devPortStateDir(consumerRoot)
  const used = new Set<number>()
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (error) {
    if (isMissing(error)) return used
    throw error
  }
  const live: { name: string; path: string; read: RecordValue }[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const path = join(dir, name)
    let read: RecordValue | null
    try {
      read = readRecordValue(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === ERR_RECORD_MALFORMED) {
        if (mutate) quarantineRecord(path)
        continue
      }
      throw error
    }
    if (read === null) continue
    const stored = (read.value as { wtPath?: unknown } | null)?.wtPath
    if (typeof stored !== 'string' || !isAbsolute(stored)) {
      if (mutate) quarantineRecord(path)
      continue
    }
    if (worktreeGone(stored)) {
      if (mutate) releaseStaleRecord(path, read)
      continue
    }
    live.push({ name, path, read })
  }
  const byWorktree = new Map<string, { offset: number; record: WorktreeDevPortRecord | null }>()
  const byOffset = new Map<number, string>()
  for (const { name, path, read } of live) {
    const record = isDevPortRecord(read.value) ? read.value : null
    const claim = record ?? preSchemaClaim(read.value)
    if (claim === null) throw new Error(`Invalid dev-port record fields: ${path}`)
    if (name !== recordName(claim.wtPath) && name !== legacyRecordName(claim.wtPath))
      throw new Error(`Dev-port filename does not own its stored path: ${path}`)
    const owner = resolve(claim.wtPath)
    const previous = byWorktree.get(owner)
    if (previous) {
      const same =
        previous.record !== null && record !== null
          ? sameAllocation(previous.record, record)
          : previous.offset === claim.offset
      if (!same) throw new Error(`Conflicting owned dev-port records: ${path}`)
    } else {
      byWorktree.set(owner, { offset: claim.offset, record })
    }
    const offsetOwner = byOffset.get(claim.offset)
    if (offsetOwner !== undefined && offsetOwner !== owner)
      throw new Error(`Conflicting dev-port offset ${claim.offset}: ${path}`)
    byOffset.set(claim.offset, owner)
    if (owner !== resolve(selfWtPath)) used.add(claim.offset)
  }
  return used
}

/**
 * `<basename>.json` 是 equal-basename 姊妹樹共享的檔名：本樹的紀錄、別人的紀錄、
 * 截斷殘檔與 pre-schema `{wtPath, offset}` claim 都可能落在這個名字上。嚴格讀端
 * 一見殘檔就 throw，等於一筆無法歸屬的壞檔讓 `wt-helper dev` 永久罷工，所以
 * legacy 候選一律 lax 地讀：
 *
 * - 讀不出內容（截斷、非 JSON）或讀得出但沒有任何可用形狀 → stderr 留 note 後
 *   當不存在；清理由帶鎖的 collectSiblingOffsets／allocate 做，讀端不碰檔案。
 * - record／claim／wtPath 解析後屬於別人 → 靜默略過：那是合法的他樹檔，其 offset
 *   由 sibling 掃描認領，本讀端無權過問。
 * - 屬於本樹的內容回在 candidate 裡，歸屬與矛盾判定交給呼叫端。
 */
interface LegacyCandidate {
  /** strict-valid 完整紀錄；pre-schema 或殘版時為 null。 */
  record: WorktreeDevPortRecord | null
  /** pre-schema `{wtPath, offset}` claim；有完整 record 時為 null。 */
  claim: { wtPath: string; offset: number } | null
  /** JSON 內讀得出的絕對 wtPath——record／claim 都不成立時仍能判歸屬。 */
  stored: string | null
}

const warnedUnreadable = new Set<string>()

function warnUnreadable(path: string): void {
  if (warnedUnreadable.has(path)) return
  warnedUnreadable.add(path)
  console.error(`note: dev-port record unreadable at ${path}; ignoring`)
}

function readLegacyCandidate(path: string): LegacyCandidate | null {
  let read: RecordValue | null
  try {
    read = readRecordValue(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== ERR_RECORD_MALFORMED) throw error
    warnUnreadable(path)
    return null
  }
  if (read === null) return null
  if (isDevPortRecord(read.value))
    return { record: read.value, claim: null, stored: read.value.wtPath }
  const claim = preSchemaClaim(read.value)
  if (claim !== null) return { record: null, claim, stored: claim.wtPath }
  const raw = (read.value as { wtPath?: unknown } | null)?.wtPath
  warnUnreadable(path)
  return {
    record: null,
    claim: null,
    stored: typeof raw === 'string' && isAbsolute(raw) ? raw : null,
  }
}

function ownedLegacyRecord(
  candidate: LegacyCandidate | null,
  owner: string,
): WorktreeDevPortRecord | null {
  return candidate !== null &&
    candidate.record !== null &&
    resolve(candidate.record.wtPath) === owner
    ? candidate.record
    : null
}

function ownedLegacyClaim(
  candidate: LegacyCandidate | null,
  owner: string,
): { wtPath: string; offset: number } | null {
  return candidate !== null && candidate.claim !== null && resolve(candidate.claim.wtPath) === owner
    ? candidate.claim
    : null
}

/**
 * 把本樹的 pre-schema claim 升格成現在的完整紀錄——claim 的 offset 是本樹已佔的
 * 格（跑著的 dev server、寫出去的 URL 都可能已經用它），能保留就保留。算不出
 * 合法紀錄（offset 把某個宣告 port 推過 base+9 又不落在 band 形狀）回 null，
 * 由呼叫端決定隔離後重配。
 */
function recordFromClaim(
  declared: readonly DeclaredDevPort[],
  offset: number,
  owner: string,
): WorktreeDevPortRecord | null {
  const record: WorktreeDevPortRecord = {
    offset,
    base: declared[0].port,
    wtPath: owner,
    ports: declared.map((d) => ({ alias: d.alias, port: d.port + offset, mainPort: d.port })),
    pool: offset <= DEV_PORT_BAND ? 'base' : 'band',
  }
  return isDevPortRecord(record) ? record : null
}

/** `wtPath` 這棵 worktree 的分配紀錄；沒有回 null。 */
export function readWorktreeDevPorts(
  consumerRoot: string,
  wtPath: string,
): WorktreeDevPortRecord | null {
  const dir = devPortStateDir(consumerRoot)
  if (readStateDirectory(dir) === null) return null
  const owner = resolve(wtPath)
  const currentPath = join(dir, recordName(wtPath))
  const current = readRecordSnapshot(currentPath)
  if (current !== null && resolve(current.record.wtPath) !== owner)
    throw new Error(`Foreign dev-port record at exact path key: ${currentPath}`)
  const legacy = readLegacyCandidate(join(dir, legacyRecordName(wtPath)))
  const ownedRecord = ownedLegacyRecord(legacy, owner)
  const ownedClaim = ownedLegacyClaim(legacy, owner)
  if (current !== null && ownedRecord !== null && !sameAllocation(current.record, ownedRecord))
    throw new Error(`Conflicting owned dev-port records: ${currentPath}`)
  if (current !== null && ownedClaim !== null && ownedClaim.offset !== current.record.offset)
    throw new Error(`Conflicting owned dev-port records: ${currentPath}`)
  return current?.record ?? ownedRecord ?? null
}

/**
 * 釋放 `wtPath` 名下的分配紀錄——新（`<basename>--<sha>.json`）舊（`<basename>.json`）
 * 兩種檔名都查，回傳刪除筆數。
 *
 * 只刪儲存路徑解析後確屬本 worktree 的檔：equal-basename 的姊妹樹共用 legacy 檔名
 * 前段，`<basename>.json` 屬於別人是合法狀態（這正是新檔名存在的理由），foreign
 * 紀錄一律 retain，NEVER 因為檔名對上就刪。紀錄本身的驗證放寬到「可解析 JSON＋
 * wtPath 是字串」——reclaim／cleanup 面對的登記包含 holders 列表認得的 pre-schema
 * `{ offset, wtPath }` 檔，嚴格讀端（isDevPortRecord）拒收的東西在刪除端一樣要認得，
 * 否則那筆槽位永遠釋放不掉。
 *
 * 與 allocate 同一個 consumer lock：unlink 與 publish 互相看不見中間態。
 */
export function releaseWorktreeDevPorts(consumerRoot: string, wtPath: string): number {
  const dir = devPortStateDir(consumerRoot)
  if (readStateDirectory(dir) === null) return 0
  return withConsumerLock(consumerRoot, () => {
    const owner = resolve(wtPath)
    let removed = 0
    for (const name of new Set([recordName(wtPath), legacyRecordName(wtPath)])) {
      const path = join(dir, name)
      const snapshot = readRecordValue(path)
      if (snapshot === null) continue
      const stored = (snapshot.value as { wtPath?: unknown } | null)?.wtPath
      if (typeof stored !== 'string' || resolve(stored) !== owner) continue
      const current = readRecordValue(path)
      if (
        current === null ||
        !sameInode(current.identity, snapshot.identity) ||
        !current.bytes.equals(snapshot.bytes)
      )
        throw new Error(`Dev-port record changed before release; retained: ${path}`)
      try {
        unlinkSync(path)
        removed++
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    }
    return removed
  })
}

function publishRecord(dir: string, record: WorktreeDevPortRecord): WorktreeDevPortRecord {
  const target = join(dir, recordName(record.wtPath))
  const stagingDir = mkdtempSync(join(dir, '.allocation-'))
  const staging = join(stagingDir, 'record')
  let outcome: { ok: true; value: WorktreeDevPortRecord } | { ok: false; error: unknown }
  try {
    const fd = openSync(staging, 'wx', 0o600)
    try {
      writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    outcome = { ok: true, value: linkPreparedRecord(staging, target, record) }
  } catch (error) {
    outcome = { ok: false, error }
  }
  try {
    try {
      unlinkSync(staging)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    rmdirSync(stagingDir)
  } catch (error) {
    if (outcome.ok === false)
      throw new AggregateError(
        [outcome.error, error],
        'Dev-port publication and staging cleanup failed',
        { cause: error },
      )
    throw error
  }
  if (outcome.ok === false) throw outcome.error
  return outcome.value
}

function linkPreparedRecord(
  staging: string,
  target: string,
  record: WorktreeDevPortRecord,
): WorktreeDevPortRecord {
  try {
    linkSync(staging, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = readRecordSnapshot(target)
    if (existing === null || !sameAllocation(existing.record, record))
      throw new Error(`Conflicting dev-port publication; destination retained: ${target}`, {
        cause: error,
      })
    return existing.record
  }
  return record
}

/**
 * 算出 allocate 會給的登記但不落盤——`wt-helper dev --dry-run` 用它預覽，不佔格。
 * 與 allocate 走同一套檢查，分配不到時報出與實跑相同的錯誤。
 */
export function planWorktreeDevPorts(
  consumerRoot: string,
  wtPath: string,
  declared: readonly DeclaredDevPort[],
  band: WorktreePortBand | null = null,
): WorktreeDevPortRecord | null {
  const existing = readWorktreeDevPorts(consumerRoot, wtPath)
  if (existing !== null) return existing
  if (declared.length === 0) return null
  if (!existsSync(wtPath)) throw new Error(`Cannot allocate a missing worktree: ${wtPath}`)
  const owner = resolve(wtPath)
  const legacy = readLegacyCandidate(join(devPortStateDir(consumerRoot), legacyRecordName(owner)))
  const claim = ownedLegacyClaim(legacy, owner)
  const adopted = claim !== null ? recordFromClaim(declared, claim.offset, owner) : null
  if (adopted !== null) return adopted
  const offset = allocateDevPortOffset(declared, siblingDevPortOffsets(consumerRoot, wtPath), band)
  if (offset === null) return null
  const record: WorktreeDevPortRecord = {
    offset,
    base: declared[0].port,
    wtPath: owner,
    ports: declared.map((d) => ({ alias: d.alias, port: d.port + offset, mainPort: d.port })),
    pool: offset <= DEV_PORT_BAND ? 'base' : 'band',
  }
  if (!isDevPortRecord(record)) throw new Error('Invalid declared dev ports; allocation refused')
  return record
}

/** 分配並落檔。宣告不出 port、或兩池都滿 → null。 */
export function allocateWorktreeDevPorts(
  consumerRoot: string,
  wtPath: string,
  declared: readonly DeclaredDevPort[],
  band: WorktreePortBand | null = null,
): WorktreeDevPortRecord | null {
  return withConsumerLock(consumerRoot, () => {
    const existing = readWorktreeDevPorts(consumerRoot, wtPath)
    if (existing !== null) return existing
    if (declared.length === 0) return null
    if (!existsSync(wtPath)) throw new Error(`Cannot allocate a missing worktree: ${wtPath}`)
    const dir = devPortStateDir(consumerRoot)
    const owner = resolve(wtPath)
    // 共享檔名上確屬本樹、卻不是完整紀錄的殘版（pre-schema claim、只剩 wtPath
    // 的垃圾）：claim 能升格就保留原 offset；兌現不了就隔離——留著它會在下一
    // 次 sibling 掃描與新紀錄撞 Conflicting owned，變成第二種永久失敗。
    const legacyPath = join(dir, legacyRecordName(owner))
    const legacy = readLegacyCandidate(legacyPath)
    let adopted: WorktreeDevPortRecord | null = null
    if (
      legacy !== null &&
      legacy.record === null &&
      legacy.stored !== null &&
      resolve(legacy.stored) === owner
    ) {
      const claim = ownedLegacyClaim(legacy, owner)
      adopted = claim !== null ? recordFromClaim(declared, claim.offset, owner) : null
      if (adopted === null) quarantineRecord(legacyPath)
    }
    const offset =
      adopted?.offset ??
      allocateDevPortOffset(declared, collectSiblingOffsets(consumerRoot, wtPath, true), band)
    if (offset === null) return null
    const record: WorktreeDevPortRecord = adopted ?? {
      offset,
      base: declared[0].port,
      wtPath: owner,
      ports: declared.map((d) => ({ alias: d.alias, port: d.port + offset, mainPort: d.port })),
      pool: offset <= DEV_PORT_BAND ? 'base' : 'band',
    }
    if (!isDevPortRecord(record)) throw new Error('Invalid declared dev ports; allocation refused')
    return publishRecord(dir, record)
  })
}

/**
 * 已有紀錄就用它，沒有就當場配一個。
 *
 * 「當場配」是這條路徑存在的理由：worktree 可能建立於分配機制之前、或建立當時 base 池正好
 * 滿了。若在那種情況下退回 base port，畫面上看到的是一個**已經在跑、但服務別條 worktree**
 * 的 dev server —— 而那與「這條 worktree 的 dev server 已就緒」長得一模一樣。
 */
export function ensureWorktreeDevPorts(
  consumerRoot: string,
  wtPath: string,
  declared: readonly DeclaredDevPort[],
  band: WorktreePortBand | null = null,
): WorktreeDevPortRecord | null {
  return (
    readWorktreeDevPorts(consumerRoot, wtPath) ??
    allocateWorktreeDevPorts(consumerRoot, wtPath, declared, band)
  )
}

/**
 * `mainPort → 這棵 worktree 的 port`。main working tree（或沒有紀錄）回空 Map，呼叫端照原
 * 宣告值走 —— main 的 port 一個字都不改是 [[dev-port-allocation]] §4 的硬條件（OAuth
 * redirect URI、tunnel hostname 都釘在它上面）。
 */
export function worktreeDevPortMap(record: WorktreeDevPortRecord | null): Map<number, number> {
  const map = new Map<number, number>()
  for (const p of record?.ports ?? []) {
    if (Number.isInteger(p.mainPort) && Number.isInteger(p.port)) map.set(p.mainPort, p.port)
  }
  return map
}

/**
 * 這個 consumer 的 worktree port 會落在哪幾段。**回一組區間，NEVER 塌成一個** ——
 * base 池（`base+1..base+9`）與 band（4200 區）中間隔著其他 consumer 的 base，塌成
 * `[base+1, band.end]` 的單一區間等於把整段 3000–4899 都宣告成自己的，preview identity
 * gate 會據此把別人的畫面當成這個 consumer 的轉出去。
 */
export function worktreePortRanges(
  declared: readonly DeclaredDevPort[],
  band: WorktreePortBand | null,
): WorktreePortBand[] {
  const ranges: WorktreePortBand[] = []
  if (declared.length > 0) {
    const base = declared[0].port
    const top = declared[declared.length - 1].port
    ranges.push([base + 1, Math.max(base, top) + DEV_PORT_BAND])
  }
  if (band) ranges.push([band[0], band[1]])
  return ranges
}
