// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/lib/contract.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/lib/contract.ts
// clade flow spine — node contract (P1a)
//
// Every node in the library is a plain CLI: `node nodes/<name>.ts [--flags]`. This module is the
// only thing they share, and it exists to make four idioms unskippable rather than re-derived.
// The four come from reading all 88 ad-hoc `.mjs` scripts in `.clade/work-loop/` — they are what
// those scripts got right (when they got it right), promoted from convention into code:
//
//   1. Locate by content anchor, NEVER by line number. `oversize-r76.mjs` carries the comment
//      "NEVER 憑行號盲改" and then hardcodes line numbers anyway; `docs/tech-debt.md` is a hot
//      file and any concurrent edit silently invalidates them.
//   2. Zero-loss verify. After any move or split, re-read both sides and assert the text is
//      still there verbatim. `r107-rotate.mjs` prints line-count deltas instead — a count that
//      matches proves nothing about content.
//   3. Missing-id fail-fast. One requested id not found is exit 1 with FATAL, never a silent skip.
//   4. Known-positive control. A threshold check that returns 0/empty is not trustworthy until the
//      same probe has returned non-zero against an input known to produce one.
//
// Nodes do NOT emit spans. `flow run` / `flow step` wrap each invocation in startSpan/endSpan, so
// a node called directly stays legal and simply does not appear on the graph.
//
// Exit codes: 0 ok, 1 usage error or FATAL, 2 nothing to show, 3 blocked (waiting on a human).

import { parseArgs } from 'node:util'

/** Raised by node bodies for an expected, actionable failure. Exits 1 with a FATAL: prefix. */
export class FatalError extends Error {
  override name = 'FatalError'
}

/** Raised when the node ran fine but has nothing to report. Exits 2. */
export class NothingToShow extends Error {
  override name = 'NothingToShow'
}

/**
 * Raised when the node refuses to act because a precondition outside its control is unmet, and a
 * human has to lift it. Exits 3, which the engine maps to a `blocked` span.
 *
 * `blocked` is NEVER a softer `fail`: a failure asks to be retried or explained, while blocked
 * says the work is correct and waiting. Collapsing the two is what makes a guard a tripwire that
 * only prints — the state has to be visible on the graph for anyone to act on it.
 */
export class BlockedError extends Error {
  override name = 'BlockedError'
}

export function fatal(message: string): never {
  throw new FatalError(message)
}

export function nothingToShow(message: string): never {
  throw new NothingToShow(message)
}

export function blocked(message: string): never {
  throw new BlockedError(message)
}

export interface NodeResult {
  /** One line a human can read without --json. */
  summary: string
  /** Structured payload printed under --json and folded into the span payload by the engine. */
  data?: Record<string, unknown>
}

export interface NodeSpec {
  name: string
  usage: string
  options: Record<string, { type: 'string' | 'boolean'; multiple?: boolean; default?: unknown }>
  run: (args: Record<string, unknown>, positionals: string[]) => NodeResult
}

/**
 * Wrap a node body in the shared CLI shell: arg parsing, --json/--help, exit-code mapping.
 * Kept deliberately thin — the engine's contract is "spawn it, read exit code and stdout".
 */
export function defineNode({ name, usage, options, run }: NodeSpec): void {
  let parsed
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        ...options,
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    })
  } catch (err) {
    process.stderr.write(`${name}: ${(err as Error).message}\n\n${usage}`)
    process.exit(1)
  }

  const { values: args, positionals } = parsed

  if (args.help) {
    process.stdout.write(usage)
    process.exit(0)
  }

  try {
    const result = run(args as Record<string, unknown>, positionals)
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ node: name, ...result }, null, 2)}\n`)
    } else {
      process.stdout.write(`${result.summary}\n`)
    }
    process.exit(0)
  } catch (err) {
    if (err instanceof NothingToShow) {
      process.stderr.write(`${name}: ${err.message}\n`)
      process.exit(2)
    }
    if (err instanceof BlockedError) {
      process.stderr.write(`${name}: BLOCKED: ${err.message}\n`)
      process.exit(3)
    }
    if (err instanceof FatalError) {
      process.stderr.write(`${name}: FATAL: ${err.message}\n`)
      process.exit(1)
    }
    process.stderr.write(`${name}: FATAL: ${(err as Error).stack ?? String(err)}\n`)
    process.exit(1)
  }
}

/** Required string flag. Absent or empty is a usage FATAL, never a silent default. */
export function requireArg(args: Record<string, unknown>, flag: string): string {
  const v = args[flag]
  if (typeof v !== 'string' || v.length === 0) fatal(`--${flag} is required`)
  return v
}

/** Comma-separated list flag, trimmed and de-blanked. */
export function listArg(args: Record<string, unknown>, flag: string): string[] {
  const raw = args[flag]
  if (typeof raw !== 'string' || raw.length === 0) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Idiom 3. Every id the caller asked for must have been found; report ALL misses at once so a
 * caller fixing a typo list does not discover them one round-trip at a time.
 */
export function assertAllFound(requested: string[], found: Iterable<string>, what: string): void {
  const have = new Set(found)
  const missing = requested.filter((id) => !have.has(id))
  if (missing.length > 0) fatal(`${what} not found: ${missing.join(' ')}`)
}

/**
 * Idiom 2. `fragments` must each appear verbatim in `container`. Reports the first miss with a
 * short excerpt — a truncated needle is enough to locate it, and the full body is often huge.
 */
export function assertZeroLoss(container: string, fragments: string[], where: string): void {
  for (const f of fragments) {
    if (!container.includes(f)) {
      const head = f.split('\n')[0].slice(0, 80)
      fatal(`zero-loss check failed in ${where}: missing "${head}…"`)
    }
  }
}

export interface MarkdownSection {
  /** Full heading line, verbatim. */
  heading: string
  /** First line index of the section (the heading itself). */
  start: number
  /** One past the last line index. */
  end: number
}

/**
 * Idiom 1. Split markdown into `## ` sections by content, skipping fenced blocks — the TD register
 * embeds markdown examples, and a `## ` inside a fence is not a section boundary.
 */
export function markdownSections(lines: string[], level = '## '): MarkdownSection[] {
  const heads: number[] = []
  let inFence = false
  for (const [i, line] of lines.entries()) {
    if (/^\s*(```|````)/.test(line)) inFence = !inFence
    if (inFence) continue
    if (line.startsWith(level)) heads.push(i)
  }
  return heads.map((start, h) => ({
    heading: lines[start],
    start,
    end: h + 1 < heads.length ? heads[h + 1] : lines.length,
  }))
}

/**
 * Trim the separator tail (`---` and blank lines) off a section's range. Those belong between
 * entries, not to either neighbour, so a move must not carry them along.
 */
export function trimSeparatorTail(lines: string[], start: number, end: number): number {
  let e = end
  while (e > start && (lines[e - 1].trim() === '' || lines[e - 1].trim() === '---')) e--
  return e
}
