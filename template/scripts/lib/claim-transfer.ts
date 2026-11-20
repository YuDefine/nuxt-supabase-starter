// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/claim-transfer.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/claim-transfer.ts
// Move a relayed predecessor's live worktree claims to its successor, all or nothing.
//
// A relay signs the dispatch over to a successor and the successor `--reclaim`s the predecessor
// pane. The worktree claims in `.clade/claims/` stayed behind naming the predecessor, so the board
// and the coordinator's disposition read a stood-down session as the holder and cold-resumed work
// the successor already had. This is the write half; the read half is
// `flow/claim-holder-chain.ts`, which also covers claims this never reached (legacy, expired).
//
// What moves: the holder fields only. `session_id` (the file name), `started_at`, `expires_at`,
// `last_heartbeat`, `expected_paths`, `work_id` and the rest are the claim's own and stay.

import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

export const CLAIM_TRANSFER_AUDIT_FILE = 'transfers.jsonl'

/**
 * Set by test harnesses to the real checkout whose `.clade/claims/` fixtures must never touch.
 * A fixture record's cwd is the repo the suite runs in, and `findConsumerRoot()` of a linked
 * worktree is the main checkout, which holds the live claim of that very worktree. Every claim
 * mutation a fixture can reach (transfer here, release／drop in claim-helper) is a no-op on this
 * root — the same result the fixture gets in CI, where the checkout has no claims dir.
 */
export const CLAIM_TRANSFER_FORBIDDEN_ROOT_ENV = 'CLADE_CLAIMS_FIXTURE_FORBIDDEN_ROOT'

/** True when `consumerRoot` is the checkout `CLAIM_TRANSFER_FORBIDDEN_ROOT_ENV` names. */
export function isFixtureForbiddenClaimsRoot(
  consumerRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const forbidden = env[CLAIM_TRANSFER_FORBIDDEN_ROOT_ENV]?.trim()
  return Boolean(forbidden) && canonical(forbidden as string) === canonical(consumerRoot)
}

export interface ClaimTransferParty {
  claude_session_id: string
  pane_id?: string
}

export interface ClaimTransferInput {
  /** The consumer's main tree: where `.clade/claims/` lives. */
  consumerRoot: string
  predecessor: ClaimTransferParty & { cwd?: string; dispatch_id?: string }
  successor: ClaimTransferParty
  /** The dispatch whose relay signed the transfer. */
  source_dispatch_id: string
  verified: boolean
  now?: () => Date
  /** Read for `CLAIM_TRANSFER_FORBIDDEN_ROOT_ENV`; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
}

export interface ClaimTransferSkip {
  claim: string
  reason: 'expired' | 'already-held' | 'other-holder' | 'not-the-predecessor-tree' | 'invalid'
}

export type ClaimTransferResult =
  | {
      status: 'transferred' | 'none'
      transferred: { claim: string; worktree_path: string | null }[]
      skipped: ClaimTransferSkip[]
      /** Put every moved claim back; for a reclaim that fails after the transfer. */
      rollback: () => void
    }
  | { status: 'failed'; error: string; skipped: ClaimTransferSkip[] }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path.replace(/\/+$/u, '')
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/** Atomic replace: write beside, rename over. */
function replaceFile(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.transfer.tmp`
  try {
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, file)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}

/**
 * The holder fields a claim carried when the plan read it. A write that finds different values
 * leaves the file alone — the claim changed hands mid-transfer and is no longer ours to move.
 * `hadTransfers` distinguishes an absent `transfers` key from an empty one so rollback restores
 * exactly what was there.
 */
interface PriorHolder {
  holder?: string
  holder_pane_id?: string
  hadTransfers: boolean
}

/** Re-read a claim file, apply `edit` to its CURRENT content, atomically replace. `edit` returns
 * the merged record, or null to contest (holder moved under us — file left untouched). The merge
 * keeps fields other writers own: a `refreshClaim` heartbeat or `bindClaimWorkId` written between
 * the plan read and this rename is carried into the result, not clobbered by a stale snapshot. */
function editClaim(
  file: string,
  edit: (raw: Record<string, unknown>) => Record<string, unknown> | null,
): 'applied' | 'contested' | 'unreadable' {
  let raw: Record<string, unknown> | null
  try {
    raw = record(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    raw = null
  }
  if (!raw) return 'unreadable'
  const next = edit(raw)
  if (!next) return 'contested'
  replaceFile(file, `${JSON.stringify(next, null, 2)}\n`)
  return 'applied'
}

export function transferWorktreeClaims(input: ClaimTransferInput): ClaimTransferResult {
  const now = (input.now ?? (() => new Date()))()
  const dir = join(input.consumerRoot, '.clade', 'claims')
  const skipped: ClaimTransferSkip[] = []
  const none: ClaimTransferResult = {
    status: 'none',
    transferred: [],
    skipped,
    rollback: () => {},
  }
  if (!existsSync(dir)) return none
  if (isFixtureForbiddenClaimsRoot(input.consumerRoot, input.env)) return none
  const predecessorTree = input.predecessor.cwd ? canonical(input.predecessor.cwd) : null
  const mainTree = canonical(input.consumerRoot)

  let names: string[]
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json') && !n.startsWith('.'))
  } catch (error) {
    return {
      status: 'failed',
      error: `claims dir unreadable: ${error instanceof Error ? error.message : String(error)}`,
      skipped,
    }
  }

  const planned: {
    name: string
    file: string
    tree: string | null
    /** The holder fields as the plan saw them — what the write re-verifies and rollback restores. */
    prior: PriorHolder
    /** The `transfers` entry this transfer appends and rollback removes. */
    entry: Record<string, unknown>
  }[] = []
  for (const name of names) {
    const file = join(dir, name)
    let raw: Record<string, unknown> | null
    try {
      raw = record(JSON.parse(readFileSync(file, 'utf8')))
    } catch {
      skipped.push({ claim: name, reason: 'invalid' })
      continue
    }
    if (!raw) {
      skipped.push({ claim: name, reason: 'invalid' })
      continue
    }
    const holder = str(raw.holder_claude_session_id)
    const tree = str(raw.worktree_path) ?? null
    // Whose claim is it? A recorded holder decides. A claim that never recorded one (every claim
    // written before the holder field) is the predecessor's iff it claims the predecessor's own
    // linked worktree — the main tree is shared by every session, so no claim on it is "theirs".
    let theirs: boolean
    if (holder) theirs = holder === input.predecessor.claude_session_id
    else
      theirs = Boolean(
        tree &&
        predecessorTree &&
        canonical(tree) === predecessorTree &&
        predecessorTree !== mainTree,
      )
    if (holder === input.successor.claude_session_id) {
      skipped.push({ claim: name, reason: 'already-held' })
      continue
    }
    if (!theirs) {
      skipped.push({
        claim: name,
        reason: holder ? 'other-holder' : 'not-the-predecessor-tree',
      })
      continue
    }
    const expires = Date.parse(str(raw.expires_at) ?? '')
    if (!Number.isFinite(expires) || expires < now.getTime()) {
      skipped.push({ claim: name, reason: 'expired' })
      continue
    }
    planned.push({
      name,
      file,
      tree,
      prior: {
        holder,
        holder_pane_id: str(raw.holder_pane_id),
        hadTransfers: 'transfers' in raw,
      },
      entry: {
        at: now.toISOString(),
        from_claude_session_id: input.predecessor.claude_session_id,
        ...(input.predecessor.pane_id ? { from_pane_id: input.predecessor.pane_id } : {}),
        to_claude_session_id: input.successor.claude_session_id,
        ...(input.successor.pane_id ? { to_pane_id: input.successor.pane_id } : {}),
        source_dispatch_id: input.source_dispatch_id,
        verified: input.verified,
      },
    })
  }
  if (planned.length === 0) return none

  const done: typeof planned = []
  // Rollback restores the holder fields onto the CURRENT content — fields other writers own
  // (heartbeat, expiry, work id) written since the transfer are kept, not rewound. A claim whose
  // holder moved since we wrote it is left alone: reverting it would steal somebody else's write.
  const restore = () => {
    for (const item of done.toReversed()) {
      try {
        editClaim(item.file, (raw) => {
          if (str(raw.holder_claude_session_id) !== input.successor.claude_session_id) return null
          const next = { ...raw }
          if (item.prior.holder === undefined) delete next.holder_claude_session_id
          else next.holder_claude_session_id = item.prior.holder
          if (item.prior.holder_pane_id === undefined) delete next.holder_pane_id
          else next.holder_pane_id = item.prior.holder_pane_id
          const marker = JSON.stringify(item.entry)
          const transfers = Array.isArray(next.transfers) ? [...next.transfers] : []
          const at = transfers.map((t) => JSON.stringify(t)).lastIndexOf(marker)
          if (at >= 0) transfers.splice(at, 1)
          if (transfers.length > 0 || item.prior.hadTransfers) next.transfers = transfers
          else delete next.transfers
          return next
        })
      } catch {
        // best effort: the audit line below names what could not be restored
      }
    }
  }
  const audit = (event: 'transferred' | 'rolled-back') => {
    const lines = planned
      .map((item) =>
        JSON.stringify({
          event,
          at: (input.now ?? (() => new Date()))().toISOString(),
          claim: item.name,
          worktree_path: item.tree,
          from_claude_session_id: input.predecessor.claude_session_id,
          to_claude_session_id: input.successor.claude_session_id,
          source_dispatch_id: input.source_dispatch_id,
          verified: input.verified,
        }),
      )
      .join('\n')
    appendFileSync(join(dir, CLAIM_TRANSFER_AUDIT_FILE), `${lines}\n`, 'utf8')
  }
  try {
    for (const item of planned) {
      const result = editClaim(item.file, (raw) => {
        if (str(raw.holder_claude_session_id) !== item.prior.holder) return null
        const previousTransfers = Array.isArray(raw.transfers) ? raw.transfers : []
        return {
          ...raw,
          holder_claude_session_id: input.successor.claude_session_id,
          ...(input.successor.pane_id ? { holder_pane_id: input.successor.pane_id } : {}),
          transfers: [...previousTransfers, item.entry],
        }
      })
      if (result !== 'applied')
        throw new Error(`claim ${item.name} ${result} mid-transfer, left untouched`)
      done.push(item)
    }
    audit('transferred')
  } catch (error) {
    restore()
    return {
      status: 'failed',
      error: `claim transfer failed, restored ${done.length}/${planned.length}: ${error instanceof Error ? error.message : String(error)}`,
      skipped,
    }
  }
  return {
    status: 'transferred',
    transferred: planned.map((p) => ({ claim: p.name, worktree_path: p.tree })),
    skipped,
    rollback: () => {
      restore()
      try {
        audit('rolled-back')
      } catch {
        // the claims are back; a missing audit line is not worth failing the caller again
      }
    },
  }
}
