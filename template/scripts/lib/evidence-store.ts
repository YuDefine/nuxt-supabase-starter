#!/usr/bin/env node
/**
 * evidence-store — sidecar-first evidence resolver for review-gui annotations.
 *
 * Evidence lives in `.spectra/evidence/<change>.jsonl` (append-only, one JSON
 * object per line). Same-itemId records: last-write-wins on read.
 *
 * Dual-track: sidecar takes precedence; inline annotations in tasks.md are
 * the fallback for in-flight changes that haven't migrated yet.
 *
 * CLI:
 *   node evidence-store.mjs --repo <path> --change <name> [--item <id>] --json
 *   → prints merged evidence records to stdout as JSON array.
 *
 *   node evidence-store.mjs --repo <path> --change <name> --has-evidence --kind verified-ui --item '#1'
 *   → exit 0 if evidence exists for that item+kind, exit 1 otherwise.
 *     Shell scripts can use this instead of regex-scanning tasks.md.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { parseArgs } from 'node:util'

export interface EvidenceRecord {
  itemId: string
  kind: string
  timestamp?: string
  author?: string
  screenshot?: string
  dom?: string
  spec?: string
  trace?: string
  method?: string
  url?: string
  status?: string
  body?: string
  route?: string
  note?: string
  packet?: string
  raw?: string
}

interface EvidenceAnnotation {
  raw: string
  timestamp?: string
  screenshot?: string
  dom?: string
  spec?: string
  trace?: string
  method?: string
  url?: string
  status?: string
  body?: string
  route?: string
  note?: string
  packet?: string
}

export interface ManualReviewItemAnnotations {
  verifiedE2e?: EvidenceAnnotation
  verifiedE2eList?: EvidenceAnnotation[]
  verifiedApi?: EvidenceAnnotation
  verifiedApiList?: EvidenceAnnotation[]
  verifiedUi?: EvidenceAnnotation
  verifiedUiList?: EvidenceAnnotation[]
  claudeDiscussed?: EvidenceAnnotation
  claudeDiscussedList?: EvidenceAnnotation[]
  claudeAnalyzed?: EvidenceAnnotation
  claudeAnalyzedList?: EvidenceAnnotation[]
  awaitingUserDecision?: EvidenceAnnotation
  awaitingUserDecisionList?: EvidenceAnnotation[]
}

interface EvidenceCliValues {
  repo?: string
  change?: string
  item?: string
  kind?: string
  json: boolean
  'has-evidence': boolean
  write: boolean
  timestamp?: string
  screenshot?: string
  dom?: string
  spec?: string
  trace?: string
  method?: string
  url?: string
  status?: string
  body?: string
  route?: string
  note?: string
  packet?: string
}

// ── Record schema ──
// Each line in the JSONL file is one evidence record.
// {
//   itemId:    string   — e.g. '#1', '#3.2'
//   kind:      string   — 'verified-e2e' | 'verified-api' | 'verified-ui' |
//                         'claude-discussed' | 'claude-analyzed' | 'awaiting-user-decision'
//   timestamp: string   — ISO 8601
//   author:    string   — 'claude' | 'user' | 'system'
//   // kind-specific fields (all optional at schema level):
//   screenshot?: string
//   dom?:        string
//   spec?:       string
//   trace?:      string
//   method?:     string
//   url?:        string
//   status?:     string
//   body?:       string
//   route?:      string
//   note?:       string
//   packet?:     string
//   raw?:        string  — original inline annotation text (for migration)
// }

/**
 * Resolve the sidecar file path for a change.
 * @param {string} repoRoot
 * @param {string} changeName
 * @returns {string}
 */
export function sidecarPath(repoRoot, changeName) {
  return join(repoRoot, '.spectra', 'evidence', `${assertSafeChangeName(changeName)}.jsonl`)
}

/**
 * Spectra change names are slugs. Reject anything that could escape
 * `.spectra/evidence/` — `--write` appends to whatever path this resolves to,
 * so an unvalidated `../` would create or grow JSONL files outside the
 * intended directory.
 * @param {string} changeName
 * @returns {string}
 */
export function assertSafeChangeName(changeName) {
  if (typeof changeName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(changeName)) {
    throw new Error(
      `evidence-store: unsafe change name ${JSON.stringify(changeName)} — expected a slug matching /^[A-Za-z0-9][A-Za-z0-9._-]*$/`,
    )
  }
  if (changeName === '.' || changeName === '..' || changeName.includes('..')) {
    throw new Error(`evidence-store: unsafe change name ${JSON.stringify(changeName)}`)
  }
  return changeName
}

/**
 * Read all evidence records from sidecar. Returns [] if file doesn't exist.
 * @param {string} repoRoot
 * @param {string} changeName
 * @returns {Array<object>}
 */
export function readSidecar(repoRoot, changeName) {
  const p = sidecarPath(repoRoot, changeName)
  if (!existsSync(p)) return []
  const content = readFileSync(p, 'utf8')
  const records = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      records.push(JSON.parse(trimmed))
    } catch {
      // skip malformed lines
    }
  }
  return records
}

/**
 * Append one evidence record to the sidecar (append-only, last-write-wins).
 * @param {string} repoRoot
 * @param {string} changeName
 * @param {object} record — must have at least itemId, kind, timestamp
 */
export function writeSidecar(repoRoot, changeName, record) {
  const p = sidecarPath(repoRoot, changeName)
  mkdirSync(dirname(p), { recursive: true })
  appendFileSync(p, JSON.stringify(record) + '\n', 'utf8')
}

/**
 * Deduplicate records: for each (itemId, kind) pair, keep only the last entry.
 * @param {Array<object>} records
 * @returns {Array<object>}
 */
export function deduplicateRecords(records) {
  const map = new Map()
  for (const r of records) {
    map.set(`${r.itemId}::${r.kind}`, r)
  }
  return Array.from(map.values())
}

/**
 * Convert an inline ManualReviewItemAnnotations object (from parseStructuredAnnotations)
 * to an array of evidence records suitable for sidecar format.
 * @param {string} itemId
 * @param {object} annotations — ManualReviewItemAnnotations
 * @returns {Array<object>}
 */
export function inlineAnnotationsToRecords(itemId, annotations) {
  const records = []
  if (!annotations) return records

  for (const a of annotations.verifiedE2eList || []) {
    records.push({
      itemId,
      kind: 'verified-e2e',
      timestamp: a.timestamp,
      spec: a.spec,
      trace: a.trace,
      raw: a.raw,
      author: 'claude',
    })
  }
  for (const a of annotations.verifiedApiList || []) {
    records.push({
      itemId,
      kind: 'verified-api',
      timestamp: a.timestamp,
      method: a.method,
      url: a.url,
      status: a.status,
      ...(a.body ? { body: a.body } : {}),
      raw: a.raw,
      author: 'claude',
    })
  }
  for (const a of annotations.verifiedUiList || []) {
    records.push({
      itemId,
      kind: 'verified-ui',
      timestamp: a.timestamp,
      screenshot: a.screenshot,
      ...(a.dom ? { dom: a.dom } : {}),
      raw: a.raw,
      author: 'claude',
    })
  }
  for (const a of annotations.claudeDiscussedList || []) {
    records.push({
      itemId,
      kind: 'claude-discussed',
      timestamp: a.timestamp,
      raw: a.raw,
      author: 'claude',
    })
  }
  for (const a of annotations.claudeAnalyzedList || []) {
    records.push({
      itemId,
      kind: 'claude-analyzed',
      timestamp: a.timestamp,
      route: a.route,
      ...(a.note ? { note: a.note } : {}),
      raw: a.raw,
      author: 'claude',
    })
  }
  for (const a of annotations.awaitingUserDecisionList || []) {
    records.push({
      itemId,
      kind: 'awaiting-user-decision',
      timestamp: a.timestamp,
      ...(a.packet ? { packet: a.packet } : {}),
      raw: a.raw,
      author: 'claude',
    })
  }
  return records
}

/**
 * Merge sidecar records with inline-parsed annotations. Sidecar wins on conflict.
 * Returns deduplicated records array.
 * @param {Array<object>} sidecarRecords — from readSidecar
 * @param {Array<{itemId: string, annotations: object}>} inlineItems — parsed items with annotations
 * @returns {Array<object>}
 */
export function mergeEvidence(sidecarRecords, inlineItems) {
  // Start with inline as base
  const inlineRecords = []
  for (const item of inlineItems) {
    inlineRecords.push(...inlineAnnotationsToRecords(item.itemId || item.id, item.annotations))
  }
  // Sidecar appended after → last-write-wins dedup will prefer sidecar
  return deduplicateRecords([...inlineRecords, ...sidecarRecords])
}

/**
 * Check if a specific item has evidence of a specific kind.
 * Checks sidecar first, then inline fallback.
 * @param {string} repoRoot
 * @param {string} changeName
 * @param {string} itemId
 * @param {string} kind — e.g. 'verified-ui'
 * @param {Array<object>|null} inlineItems — optional parsed items for inline fallback
 * @returns {boolean}
 */
export function hasEvidence(repoRoot, changeName, itemId, kind, inlineItems) {
  const sidecar = readSidecar(repoRoot, changeName)
  const sidecarMatch = sidecar.find((r) => r.itemId === itemId && r.kind === kind)
  if (sidecarMatch) return true

  if (inlineItems) {
    const item = inlineItems.find((it) => (it.itemId || it.id) === itemId)
    if (item && item.annotations) {
      const records = inlineAnnotationsToRecords(itemId, item.annotations)
      return records.some((r) => r.kind === kind)
    }
  }

  return false
}

/**
 * Resolve all evidence for a change: sidecar-first, inline fallback.
 * @param {string} repoRoot
 * @param {string} changeName
 * @param {Array<object>} inlineItems — parsed items with annotations
 * @returns {Array<object>} — deduplicated evidence records
 */
export function resolveAllEvidence(repoRoot, changeName, inlineItems) {
  const sidecar = readSidecar(repoRoot, changeName)
  return mergeEvidence(sidecar, inlineItems)
}

/**
 * Resolve evidence for a single (itemId, kind) pair.
 * Inline is the primary path; sidecar is fallback.
 * @param {string} repoRoot
 * @param {string} changeName
 * @param {string} itemId
 * @param {string} kind
 * @param {{ inlinePresent?: boolean, inlineCount?: number }} [opts]
 * @returns {{ present: boolean, count: number, source: 'inline' | 'sidecar' | 'none' }}
 */
export function resolveEvidence(
  repoRoot,
  changeName,
  itemId,
  kind,
  { inlinePresent = false, inlineCount = 0 } = {},
) {
  if (inlinePresent) {
    return { present: true, count: inlineCount, source: 'inline' }
  }
  const sidecar = readSidecar(repoRoot, changeName)
  let matching = sidecar.filter((r) => r.itemId === itemId && r.kind === kind)
  // verified-ui: only count records that carry a screenshot field
  if (kind === 'verified-ui') {
    matching = matching.filter((r) => r.screenshot)
  }
  const count = matching.length
  if (count > 0) {
    return { present: true, count, source: 'sidecar' }
  }
  return { present: false, count: 0, source: 'none' }
}

/**
 * Build a Set of `${itemId}::${kind}` keys from sidecar records (deduplicated).
 * Used by the parser to accept short markers when sidecar has the payload.
 * @param {Array<object>} records — raw sidecar records (pre- or post-dedup)
 * @returns {Set<string>}
 */
export function buildSidecarKeySet(records: EvidenceRecord[]): Set<string> {
  const keys = new Set<string>()
  for (const r of deduplicateRecords(records)) {
    keys.add(`${r.itemId}::${r.kind}`)
  }
  return keys
}

/**
 * Convert evidence records back to ManualReviewItemAnnotations format
 * (for consumption by existing code that expects the old shape).
 * @param {Array<object>} records — evidence records for a single item
 * @returns {object} — ManualReviewItemAnnotations shape
 */
export function recordsToAnnotations(records: EvidenceRecord[]): ManualReviewItemAnnotations {
  const annotations: ManualReviewItemAnnotations = {}
  for (const r of records) {
    switch (r.kind) {
      case 'verified-e2e': {
        const a = { raw: r.raw || '', timestamp: r.timestamp, spec: r.spec, trace: r.trace }
        annotations.verifiedE2e = a
        ;(annotations.verifiedE2eList ??= []).push(a)
        break
      }
      case 'verified-api': {
        const a = {
          raw: r.raw || '',
          timestamp: r.timestamp,
          method: r.method,
          url: r.url,
          status: r.status,
          ...(r.body ? { body: r.body } : {}),
        }
        annotations.verifiedApi = a
        ;(annotations.verifiedApiList ??= []).push(a)
        break
      }
      case 'verified-ui': {
        const a = {
          raw: r.raw || '',
          timestamp: r.timestamp,
          screenshot: r.screenshot,
          ...(r.dom ? { dom: r.dom } : {}),
        }
        annotations.verifiedUi = a
        ;(annotations.verifiedUiList ??= []).push(a)
        break
      }
      case 'claude-discussed': {
        const a = { raw: r.raw || '', timestamp: r.timestamp }
        annotations.claudeDiscussed = a
        ;(annotations.claudeDiscussedList ??= []).push(a)
        break
      }
      case 'claude-analyzed': {
        const a = {
          raw: r.raw || '',
          timestamp: r.timestamp,
          route: r.route || '',
          ...(r.note ? { note: r.note } : {}),
        }
        annotations.claudeAnalyzed = a
        ;(annotations.claudeAnalyzedList ??= []).push(a)
        break
      }
      case 'awaiting-user-decision': {
        const a = {
          raw: r.raw || '',
          timestamp: r.timestamp,
          ...(r.packet ? { packet: r.packet } : {}),
        }
        annotations.awaitingUserDecision = a
        ;(annotations.awaitingUserDecisionList ??= []).push(a)
        break
      }
    }
  }
  return annotations
}

// ── CLI entry point ──
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('evidence-store.ts') || process.argv[1].endsWith('evidence-store.ts'))

if (isMain) {
  const VALID_KINDS = [
    'verified-e2e',
    'verified-api',
    'verified-ui',
    'claude-discussed',
    'claude-analyzed',
    'awaiting-user-decision',
  ]

  const { values: rawValues } = parseArgs({
    options: {
      repo: { type: 'string' },
      change: { type: 'string' },
      item: { type: 'string' },
      kind: { type: 'string' },
      json: { type: 'boolean', default: false },
      'has-evidence': { type: 'boolean', default: false },
      write: { type: 'boolean', default: false },
      timestamp: { type: 'string' },
      // kind-specific payload fields
      screenshot: { type: 'string' },
      dom: { type: 'string' },
      spec: { type: 'string' },
      trace: { type: 'string' },
      method: { type: 'string' },
      url: { type: 'string' },
      status: { type: 'string' },
      body: { type: 'string' },
      route: { type: 'string' },
      note: { type: 'string' },
      packet: { type: 'string' },
    } as const,
    strict: false,
  })
  const values = rawValues as EvidenceCliValues

  if (!values.repo || !values.change) {
    console.error(
      'Usage: node evidence-store.mjs --repo <path> --change <name> [--item <id>] [--kind <kind>] [--json|--has-evidence|--write]',
    )
    process.exit(2)
  }

  // ── --write mode ──
  if (values.write) {
    if (!values.item) {
      console.error('--write requires --item')
      process.exit(2)
    }
    if (!values.kind || !VALID_KINDS.includes(values.kind)) {
      console.error(`--write requires --kind (one of: ${VALID_KINDS.join(', ')})`)
      process.exit(2)
    }
    const ts = values.timestamp || new Date().toISOString()
    const kind = values.kind

    // Validate kind-specific required payload
    if (kind === 'verified-ui' && !values.screenshot) {
      console.error('--kind verified-ui requires --screenshot')
      process.exit(2)
    }
    if (kind === 'verified-e2e' && (!values.spec || !values.trace)) {
      console.error('--kind verified-e2e requires --spec and --trace')
      process.exit(2)
    }
    if (kind === 'verified-api' && (!values.method || !values.url || !values.status)) {
      console.error('--kind verified-api requires --method, --url, and --status')
      process.exit(2)
    }
    if (kind === 'claude-analyzed' && !values.route) {
      console.error('--kind claude-analyzed requires --route')
      process.exit(2)
    }

    const record: EvidenceRecord = {
      itemId: values.item,
      kind,
      timestamp: ts,
      author: 'claude',
    }

    // Add kind-specific payload fields
    if (kind === 'verified-ui') {
      record.screenshot = values.screenshot
      if (values.dom) record.dom = values.dom
    } else if (kind === 'verified-e2e') {
      record.spec = values.spec
      record.trace = values.trace
    } else if (kind === 'verified-api') {
      record.method = values.method
      record.url = values.url
      record.status = values.status
      if (values.body) record.body = values.body
    } else if (kind === 'claude-analyzed') {
      record.route = values.route
      if (values.note) record.note = values.note
    } else if (kind === 'awaiting-user-decision') {
      if (values.packet) record.packet = values.packet
    }
    // claude-discussed: no payload fields

    writeSidecar(values.repo, values.change, record)
    // stdout: inline marker for tasks.md
    process.stdout.write(`(${kind}: ${ts})\n`)
    process.exit(0)
  }

  const sidecar = readSidecar(values.repo, values.change)

  if (values['has-evidence']) {
    if (!values.item || !values.kind) {
      console.error('--has-evidence requires --item and --kind')
      process.exit(2)
    }
    const found = sidecar.some((r) => r.itemId === values.item && r.kind === values.kind)
    process.exit(found ? 0 : 1)
  }

  let results = deduplicateRecords(sidecar)
  if (values.item) {
    results = results.filter((r) => r.itemId === values.item)
  }
  if (values.kind) {
    results = results.filter((r) => r.kind === values.kind)
  }

  if (values.json) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    for (const r of results) {
      console.log(`${r.itemId} ${r.kind} ${r.timestamp}`)
    }
  }
}
