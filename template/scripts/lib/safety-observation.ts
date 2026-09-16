// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/safety-observation.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/safety-observation.ts
/**
 * Shared fail-closed observation types for handoff / worktree lifecycle.
 *
 * Safety reads MUST return `known | unknown(reason)`. Callers may display an
 * unknown observation; they MUST NOT treat it as clean, unclaimed, unlocked,
 * or empty when authorizing takeover, landing, or cleanup.
 */
export type Known<T> = { status: 'known'; value: T }
export type Unknown = { status: 'unknown'; reason: string }
export type Observed<T> = Known<T> | Unknown

export function known<T>(value: T): Known<T> {
  return { status: 'known', value }
}

export function unknown(reason: string): Unknown {
  return { status: 'unknown', reason }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
