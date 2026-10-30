// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/dev-slots.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/dev-slots.ts
/**
 * dev server 主機並行額度（slot）的實況計數與 owner class 判定。
 *
 * 純判定：進程樣本、listener 表、lease 清單都由 caller 注入；本檔不讀 /proc、不跑 lsof、不碰 lease 檔。
 * 唯讀——NEVER 在這裡殺進程或改 lease。dev server 辨識與 Pss 取樣與 `tree-cost` 同源
 * （`isDevServerArgv`），所以 `slots` 的計數和巡檢摘要的 `devServers` 不會分叉。
 *
 * | REQUIRED 欄位 | 內容 |
 * | --- | --- |
 * | 觸發條件 | informational — 不觸發任何東西（I2 才把 `hostCap` 接進 `start`／`wait`） |
 * | 消費端 | `node vendor/scripts/dev-session.ts slots [--json]`；I2 的滿額判定、巡檢摘要 `--json` 接線 |
 * | 觸發點 | 失敗輸出：`slots --help` |
 */

import { isDevServerArgv, type ProcSample } from './dev-resource/tree-cost.ts'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const GIB_KIB = 1024 * 1024

export const DEFAULT_RESERVE_GIB = 4
/** 暫定值（spec § 校準）：zenbook 基線當下沒有 dev server 在跑，尚無實測。 */
export const DEFAULT_PER_SERVER_PSS_GIB = 1
const HOST_MEM_FRACTION = 0.6

/** 同一 (consumer, app) 的 agent resident dev server 預設上限（1 開發＋1 review slot；consumer-meta `dev.maxResident` 可覆寫）。 */
export const DEFAULT_MAX_RESIDENT = 2

/** consumer-meta 的 `dev.maxResident`；缺值或不是正整數就退回預設。 */
export function resolveMaxResident(meta: unknown): number {
  const value = (meta as { dev?: { maxResident?: unknown } } | null)?.dev?.maxResident
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
    ? value
    : DEFAULT_MAX_RESIDENT
}

export interface MaxResidentVerdict {
  full: boolean
  max: number
  /** 占格的同 consumer agent server（不含 `selfPort` 那一格：同一個 port 重起不算新增）。 */
  holders: DevSlot[]
}

/**
 * 同 consumer 的 agent resident server 數是否已達 `maxResident`。只數 `agent`：人類無界、`unleased` 沒有
 * 所屬 consumer 可歸（spec C5）。`selfPort` 排除在外，否則 reuse／重起自己那格會被自己擋下。
 */
export function maxResidentVerdict(input: {
  slots: readonly DevSlot[]
  consumerId: string
  selfPort: number | null
  max: number
}): MaxResidentVerdict {
  const holders = input.slots.filter(
    (s) => s.owner === 'agent' && s.consumerId === input.consumerId && s.port !== input.selfPort,
  )
  return { full: holders.length >= input.max, max: input.max, holders }
}

/**
 * `~/.config/clade/dev-slots.json`：registry `nodes[].dev_slots` 由 `dev-node.ts bootstrap` 寫出的覆寫值。
 * NEVER 手寫——檔與宣告漂移 `doctor` 會報。欄位全為選填，缺的用公式預設。
 */
export interface DevSlotsOverride {
  hostCap?: number
  reserveGiB?: number
  perServerPssGiB?: number
  idleWindowMin?: number
}

export function devSlotsOverridePath(home = homedir(), xdg = process.env.XDG_CONFIG_HOME): string {
  return join(xdg || join(home, '.config'), 'clade', 'dev-slots.json')
}

/** 檔不存在、壞掉、欄位型別不對都退回空覆寫（fail-open：計數工具不因設定檔擋工作）。 */
export function parseDevSlotsOverride(raw: string | null): DevSlotsOverride {
  if (!raw) return {}
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!value || typeof value !== 'object') return {}
  const v = value as Record<string, unknown>
  const positive = (x: unknown): number | undefined =>
    typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : undefined
  const out: DevSlotsOverride = {}
  const hostCap = positive(v.hostCap)
  if (hostCap !== undefined && Number.isInteger(hostCap)) out.hostCap = hostCap
  const reserve = v.reserveGiB
  if (typeof reserve === 'number' && Number.isFinite(reserve) && reserve >= 0)
    out.reserveGiB = reserve
  const per = positive(v.perServerPssGiB)
  if (per !== undefined) out.perServerPssGiB = per
  const idle = positive(v.idleWindowMin)
  if (idle !== undefined) out.idleWindowMin = idle
  return out
}

export function readDevSlotsOverride(path = devSlotsOverridePath()): DevSlotsOverride {
  try {
    return parseDevSlotsOverride(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

/** 宣告的 `hostCap` 直接蓋過公式；否則公式吃 `reserveGiB`／`perServerPssGiB` 覆寫。 */
export function resolveHostCap(
  input: { memTotalKiB: number; cores: number },
  override: DevSlotsOverride,
): number {
  if (override.hostCap !== undefined) return override.hostCap
  return computeHostCap({
    ...input,
    reserveGiB: override.reserveGiB,
    perServerPssGiB: override.perServerPssGiB,
  })
}

export interface HostCapInput {
  memTotalKiB: number
  cores: number
  reserveGiB?: number
  perServerPssGiB?: number
}

/** `clamp(floor((MemTotal × 0.6 − reserve) / perServerPss), 1, cores)`（spec C1）。 */
export function computeHostCap(input: HostCapInput): number {
  const reserve = input.reserveGiB ?? DEFAULT_RESERVE_GIB
  const perServer = input.perServerPssGiB ?? DEFAULT_PER_SERVER_PSS_GIB
  const usableGiB = (input.memTotalKiB / GIB_KIB) * HOST_MEM_FRACTION - reserve
  const byMem = Math.floor(usableGiB / perServer)
  return Math.max(1, Math.min(byMem, Math.max(1, input.cores)))
}

/** `lsof -nP -iTCP -sTCP:LISTEN -F pn` 的輸出 → pid → 在聽的 port。 */
export function parseLsofListeners(raw: string): Map<number, number[]> {
  const out = new Map<number, number[]>()
  let pid: number | null = null
  for (const line of raw.split('\n')) {
    if (line.startsWith('p')) {
      pid = Number(line.slice(1))
      continue
    }
    if (!line.startsWith('n') || pid === null || !Number.isFinite(pid)) continue
    const m = /:(\d+)\s*$/u.exec(line)
    if (!m) continue
    const ports = out.get(pid) ?? []
    if (!ports.includes(Number(m[1]))) ports.push(Number(m[1]))
    out.set(pid, ports)
  }
  return out
}

export type OwnerClass = 'human' | 'agent' | 'unleased'

/** dev-session lease 中 slots 會讀的欄位（其餘欄位忽略；舊格式缺欄位一律容忍）。 */
export interface SlotLease {
  consumerId?: string | null
  task?: string | null
  expiresAt?: string | null
  heartbeatAt?: string | null
  lastActiveAt?: string | null
  holder?: { kind?: string | null; label?: string | null } | null
  devServer?: { pid?: number | null; port?: number | null; cwd?: string | null } | null
}

export interface DevSlot {
  /** dev server 根進程。 */
  pid: number
  port: number
  cwd: string | null
  /** 根進程＋後代的 Pss 合計（KiB）。 */
  pssKiB: number
  procCount: number
  owner: OwnerClass
  consumerId: string | null
  holderLabel: string | null
  task: string | null
  /** agent 租約：`expired`／`heartbeat-dead` 表示 sweep 可回收；null＝存活或非 agent。 */
  leaseState: string | null
  /** agent 租約剩餘 ms（可為負＝已過期）；人類／unleased 為 null。 */
  ttlRemainingMs: number | null
  /** lease 的 `lastActiveAt`（I3 才會寫入）；沒有就 null。 */
  lastActiveAt: string | null
}

export interface BuildSlotsInput {
  procs: readonly ProcSample[]
  /** pid → 在聽的 port（`parseLsofListeners`）。 */
  listeners: ReadonlyMap<number, readonly number[]>
  leases: readonly SlotLease[]
  now: number
  /** 與 dev-session 的 `leaseReclaimable` 同一個判準（注入，避免兩處各定 180s）。 */
  reclaimReason: (lease: SlotLease, now: number) => string | null
}

/**
 * resident dev server ＝ dev server **根進程**（沒有 dev server 祖先）且它或它的後代在聽 TCP port。
 * 計數單位是根進程；`nuxt dev` 的 worker 子行程算進同一格。同一根進程聽多個 port 時取最小的那個當代表。
 */
export function buildSlots(input: BuildSlotsInput): DevSlot[] {
  const byPid = new Map(input.procs.map((p) => [p.pid, p]))
  const children = new Map<number, ProcSample[]>()
  for (const p of input.procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p])

  const hasDevAncestor = (p: ProcSample): boolean => {
    const seen = new Set([p.pid])
    for (let cur = byPid.get(p.ppid); cur && !seen.has(cur.pid); cur = byPid.get(cur.ppid)) {
      if (isDevServerArgv(cur.argv)) return true
      seen.add(cur.pid)
    }
    return false
  }

  const slots: DevSlot[] = []
  for (const root of input.procs) {
    if (!isDevServerArgv(root.argv) || hasDevAncestor(root)) continue
    const seen = new Set<number>()
    const stack = [root]
    const ports = new Set<number>()
    let pssKiB = 0
    while (stack.length > 0) {
      const cur = stack.pop() as ProcSample
      if (seen.has(cur.pid)) continue
      seen.add(cur.pid)
      pssKiB += cur.memKiB
      for (const port of input.listeners.get(cur.pid) ?? []) ports.add(port)
      stack.push(...(children.get(cur.pid) ?? []))
    }
    if (ports.size === 0) continue
    const port = Math.min(...ports)
    const lease = input.leases.find((l) => {
      const leasePort = l.devServer?.port
      return typeof leasePort === 'number' && ports.has(leasePort)
    })
    const kind = lease?.holder?.kind ?? null
    const owner: OwnerClass = !lease || !kind ? 'unleased' : kind === 'human' ? 'human' : 'agent'
    const expiresAt = lease?.expiresAt ? Date.parse(lease.expiresAt) : null
    slots.push({
      pid: root.pid,
      port,
      cwd: root.cwd,
      pssKiB,
      procCount: seen.size,
      owner,
      consumerId: lease?.consumerId ?? null,
      holderLabel: lease?.holder?.label ?? null,
      task: lease?.task ?? null,
      leaseState: lease && owner === 'agent' ? input.reclaimReason(lease, input.now) : null,
      ttlRemainingMs:
        owner === 'agent' && expiresAt !== null && Number.isFinite(expiresAt)
          ? expiresAt - input.now
          : null,
      lastActiveAt: lease?.lastActiveAt ?? null,
    })
  }
  return slots.toSorted((a, b) => a.port - b.port || a.pid - b.pid)
}

/** 線性插值外的最近排名 p-th 分位（nearest-rank）。空輸入回 null。 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = values.toSorted((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number
}

export interface SlotsReport {
  hostCap: number
  count: number
  overCap: boolean
  byOwner: Record<OwnerClass, number>
  /** 每格 Pss 的 p90（KiB）；格數 < 3 時仍算，但 `enoughForCalibration` 為 false。 */
  perServerPssP90KiB: number | null
  enoughForCalibration: boolean
  slots: DevSlot[]
}

export function summarizeSlots(slots: readonly DevSlot[], hostCap: number): SlotsReport {
  const byOwner: Record<OwnerClass, number> = { human: 0, agent: 0, unleased: 0 }
  for (const s of slots) byOwner[s.owner] += 1
  return {
    hostCap,
    count: slots.length,
    overCap: slots.length > hostCap,
    byOwner,
    perServerPssP90KiB: percentile(
      slots.map((s) => s.pssKiB),
      90,
    ),
    // 校準前提（spec § 校準）：≥3 支 resident dev server。不足就只當參考，不改 perServerPss。
    enoughForCalibration: slots.length >= 3,
    slots: [...slots],
  }
}
