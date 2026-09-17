// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/safety-observation.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/safety-observation.ts
/**
 * Shared fail-closed observation types for handoff / worktree lifecycle.
 *
 * Safety reads MUST return `known | unknown(reason)`. Callers may display an
 * unknown observation; they MUST NOT treat it as clean, unclaimed, unlocked,
 * or empty when authorizing takeover, landing, or cleanup.
 *
 * `kind` and `mergeBackSafety` are orthogonal:
 * - `kind` is the worktree identity (scanner table; never `'landable'`).
 * - `mergeBackSafety` of `'landable'` means 0 blockers and 0 uncommitted —
 *   a merge-back observation, not a mutation authorization.
 */
import { isRecord } from './json-unknown.ts'

export type Known<T> = { status: 'known'; value: T }
export type Unknown = { status: 'unknown'; reason: string }
export type Observed<T> = Known<T> | Unknown

export function known<T>(value: T): Known<T> {
  return { status: 'known', value }
}

export function unknown(reason: string): Unknown {
  return { status: 'unknown', reason }
}

export function isUnknown<T>(value: Observed<T>): value is Unknown {
  return value.status === 'unknown'
}

export function isKnown<T>(value: Observed<T>): value is Known<T> {
  return value.status === 'known'
}

export function isObserved(value: unknown): value is Observed<unknown> {
  return isRecord(value) && (value.status === 'known' || value.status === 'unknown')
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function asObserved<T>(value: T | Observed<T>): Observed<T> {
  if (isObserved(value)) return value as Observed<T>
  return known(value)
}

export function asObservedNumber(
  value: number | Observed<number> | null | undefined,
  missingReason = 'count unavailable',
): Observed<number> {
  if (isObserved(value)) return value as Observed<number>
  if (typeof value === 'number') return known(value)
  return unknown(missingReason)
}

export function asObservedBoolean(
  value: boolean | Observed<boolean> | null | undefined,
  missingReason = 'flag unavailable',
): Observed<boolean> {
  if (isObserved(value)) return value as Observed<boolean>
  if (typeof value === 'boolean') return known(value)
  return unknown(missingReason)
}

export function unknownReason(
  value: Observed<unknown> | null | undefined,
  field: string,
): string | null {
  if (!value) return null
  if (value.status === 'unknown') return `${field}: ${value.reason}`
  return null
}

/** Scanner worktree identity kinds. `'landable'` is not a kind. */
export type WorktreeKind =
  | 'merged'
  | 'merged-with-wip'
  | 'archived-change'
  | 'active-stale'
  | 'active-fresh'
  | 'unlanded-unknown'
  | 'unlanded-content-landed'
  | 'unlanded-partial'
  | 'unlanded'
  | 'orphan-with-wip'
  | 'orphan'
  | 'active-session-wip'
  | 'active-session-claimed'

export type MergeBackSafety = 'landable' | 'ptb-recoverable' | 'ptb-unsafe' | 'unclassified'

export type ContentLanded = 'yes' | 'partial' | 'no' | 'unknown'

export type LifecycleAction = 'cleanup' | 'batch-ready' | 'batch-cleanup' | 'retain' | 'report-only'

export interface FenceSnapshot {
  path: string
  head: Observed<string>
  userWip: Observed<number>
  claimGeneration: Observed<string | null>
  locked: Observed<boolean>
}

export function fenceGeneration(fence: FenceSnapshot): Observed<string> {
  if (fence.head.status === 'unknown') return unknown(`fence head: ${fence.head.reason}`)
  if (fence.userWip.status === 'unknown') return unknown(`fence userWip: ${fence.userWip.reason}`)
  if (fence.claimGeneration.status === 'unknown')
    return unknown(`fence claimGeneration: ${fence.claimGeneration.reason}`)
  if (fence.locked.status === 'unknown') return unknown(`fence locked: ${fence.locked.reason}`)
  const claim = fence.claimGeneration.value ?? 'none'
  return known(
    `${fence.head.value}:${fence.userWip.value}:${claim}:${fence.locked.value ? '1' : '0'}`,
  )
}

export function fenceUnknownReasons(fence: FenceSnapshot | undefined): string[] {
  if (!fence) return []
  const reasons: string[] = []
  if (fence.head.status === 'unknown') reasons.push(`head: ${fence.head.reason}`)
  if (fence.userWip.status === 'unknown') reasons.push(`userWip: ${fence.userWip.reason}`)
  if (fence.claimGeneration.status === 'unknown')
    reasons.push(`claimGeneration: ${fence.claimGeneration.reason}`)
  if (fence.locked.status === 'unknown') reasons.push(`locked: ${fence.locked.reason}`)
  return reasons
}

export function fenceDrift(
  planned: FenceSnapshot,
  current: Observed<FenceSnapshot>,
): string | null {
  if (current.status === 'unknown') return `stale-plan: current fence unknown (${current.reason})`
  const cur = current.value
  const plannedGen = fenceGeneration(planned)
  if (plannedGen.status === 'unknown')
    return `stale-plan: planned fence unknown (${plannedGen.reason})`
  const currentGen = fenceGeneration(cur)
  if (currentGen.status === 'unknown')
    return `stale-plan: current fence unknown (${currentGen.reason})`
  if (plannedGen.value !== currentGen.value) {
    return `stale-plan: fence drifted planned=${plannedGen.value} current=${currentGen.value}`
  }
  return null
}

export type UncommittedFiles = {
  modified: { path: string; status?: string }[]
  untracked: { path: string }[]
}
