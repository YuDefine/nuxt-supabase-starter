#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/deploy-trigger-check.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/deploy-trigger-check.ts

/**
 * deploy-trigger-check.ts — resolve a consumer's real deploy trigger from
 * .github/workflows/, and check the declared `deploy.deployTrigger` against it.
 *
 * Why this exists as a gate rather than a rule: `/commit` Step 6-Gate decides
 * whether to publish a version and push tags without asking anyone, and it used
 * to decide that from the manifest alone. A manifest is a hand-written claim.
 * A consumer that says `push-main` while its workflow fires on tag push gets
 * the unattended-release branch for free, and nothing in the run says so —
 * <consumer-b> sat in that state until someone grepped workflows by hand (2026-08-22).
 *
 * So the gate asks this script, and the script asks the workflows. `push-main`
 * is confirmed only when the workflows agree; every other outcome — undeclared,
 * mismatched, ambiguous, no deploy workflow found — resolves to
 * `needs-approval`, which routes Step 6 to its ask-first branch. A wrong
 * declaration can no longer buy the permissive path.
 *
 * Usage:
 *   node scripts/deploy-trigger-check.ts [--repo <path>] [--json]
 *
 * Exit codes:
 *   0 — declared and derived agree, or nothing was declared to disagree with
 *   1 — declared contradicts what the workflows do (a real drift to fix)
 *   2 — bad usage
 *
 * Step 6-Gate branches on stdout `verdict=`, not on the exit code: a
 * `needs-approval` that stems from ambiguity is not a failure, it is the gate
 * working. Deliberately dependency-free — `yaml` is not a direct dependency of
 * clade and the parser below only needs the `on:` block subset the fleet uses.
 */

import { spawnSync } from 'node:child_process'

export type DeployTriggerClass = 'push-main' | 'tag-v' | 'pr-merge' | 'manual'

export interface WorkflowClassification {
  file: string
  workflowName: string | null
  classes: DeployTriggerClass[]
}

export interface DerivedDeployTrigger {
  /** Confident single class, or null when nothing conclusive was found. */
  value: DeployTriggerClass | null
  /** 'none' — no production deploy workflow; 'ambiguous' — workflows disagree. */
  reason: 'derived' | 'none' | 'ambiguous'
  workflows: WorkflowClassification[]
  source: string
}

interface Node {
  key: string
  value: string
  children: Node[]
}

/** Filename / workflow-name shapes that mark a workflow as deploying. */
const DEPLOY_RE = /deploy|release|publish/i
/**
 * ...and shapes that mark it as deploying somewhere other than production.
 * Production is the only environment `deployTrigger` describes, so a repo with
 * both `deploy-staging.yml` (push main) and `deploy-production.yml` (tag push)
 * must not read as ambiguous.
 */
const NON_PROD_RE = /staging|preview|canary|nightly|example|sandbox/i

const MAIN_BRANCHES = new Set(['main', 'master'])

export function classifyWorkflowTriggers(raw: string): DeployTriggerClass[] {
  const on = findOnNode(raw)
  if (!on) return []

  const classes = new Set<DeployTriggerClass>()
  const events = eventNames(on)

  const push = childNamed(on, 'push')
  if (events.has('push')) {
    // `on: push` with no qualifiers fires on every branch, main included.
    const branches = push ? listValues(push, 'branches') : null
    const branchesIgnore = push ? listValues(push, 'branches-ignore') : null
    const tags = push ? hasChild(push, 'tags') || hasChild(push, 'tags-ignore') : false
    if (tags) classes.add('tag-v')
    const mainIsPushed = branches
      ? branches.some(isMainBranch)
      : !branchesIgnore?.some(isMainBranch) && !tags
    if (mainIsPushed) classes.add('push-main')
  }

  // A release publish is tag-shaped from the deployTrigger vocabulary's view.
  if (events.has('release')) classes.add('tag-v')

  // Chained deploys (`workflow_run` after CI) fire from whatever pushed the
  // upstream workflow — the branch filter is what makes it a main-push deploy.
  const workflowRun = childNamed(on, 'workflow_run')
  if (workflowRun && listValues(workflowRun, 'branches')?.some(isMainBranch)) {
    classes.add('push-main')
  }

  const pullRequest = childNamed(on, 'pull_request') ?? childNamed(on, 'pull_request_target')
  if (pullRequest && listValues(pullRequest, 'types')?.includes('closed')) {
    classes.add('pr-merge')
  }

  // Only a human can start it.
  if (
    classes.size === 0 &&
    (events.has('workflow_dispatch') || events.has('workflow_call') || events.has('schedule'))
  ) {
    classes.add('manual')
  }

  return [...classes]
}

export function deriveDeployTrigger(
  workflowFiles: { file: string; raw: string }[],
): DerivedDeployTrigger {
  const source = '.github/workflows/*.yml:on'
  const candidates: WorkflowClassification[] = []

  for (const { file, raw } of workflowFiles) {
    const workflowName = scalarAtRoot(raw, 'name')
    const haystack = `${file} ${workflowName ?? ''}`
    if (!DEPLOY_RE.test(haystack)) continue
    if (NON_PROD_RE.test(haystack)) continue
    candidates.push({
      file,
      workflowName,
      classes: refineByProductionJobs(raw, classifyWorkflowTriggers(raw)),
    })
  }

  if (candidates.length === 0) return { value: null, reason: 'none', workflows: [], source }

  // `manual` alongside an automatic trigger is the `workflow_dispatch` escape
  // hatch nearly every deploy workflow carries; it does not describe how the
  // workflow normally fires.
  const automatic = new Set<DeployTriggerClass>()
  for (const c of candidates) for (const k of c.classes) if (k !== 'manual') automatic.add(k)

  if (automatic.size === 1) {
    return { value: [...automatic][0], reason: 'derived', workflows: candidates, source }
  }
  if (automatic.size === 0) {
    const anyManual = candidates.some((c) => c.classes.includes('manual'))
    return anyManual
      ? { value: 'manual', reason: 'derived', workflows: candidates, source }
      : { value: null, reason: 'none', workflows: candidates, source }
  }
  return { value: null, reason: 'ambiguous', workflows: candidates, source }
}

interface JobInfo {
  id: string
  name: string | null
  environment: string | null
  ifExpr: string | null
  hasPermissions: boolean
}

/**
 * A single workflow file may carry both the production and the staging deploy
 * as separate jobs (TD-778: `deploy.yml` with `deploy-production` gated on
 * `refs/tags/v*` and `deploy-staging` gated on `refs/heads/main`). The file's
 * `on:` then lists both triggers and the filename is neutral, so the file-level
 * view can only say "ambiguous" — and no declaration can fix that.
 *
 * When the file splits into non-production and production jobs, keep only the
 * triggers the production jobs' `if:` admits. Anything this cannot read — a
 * production job with no `if:`, an `if:` that is not a flat allow-list of known
 * atoms (see `refsAdmittedBy`), or a gate that admits none of the file's
 * automatic triggers — leaves the classes untouched, so the result stays
 * fail-closed.
 */
export function refineByProductionJobs(
  raw: string,
  classes: DeployTriggerClass[],
): DeployTriggerClass[] {
  const automatic = classes.filter((k) => k !== 'manual')
  if (automatic.length < 2) return classes

  const jobs = parseJobs(raw)
  const isNonProd = (j: JobInfo) =>
    NON_PROD_RE.test(`${j.id} ${j.name ?? ''} ${j.environment ?? ''}`)
  if (!jobs.some(isNonProd)) return classes
  const production = jobs.filter(
    (j) => !isNonProd(j) && (j.environment !== null || DEPLOY_RE.test(`${j.id} ${j.name ?? ''}`)),
  )
  if (production.length === 0) return classes

  const admitted = new Set<DeployTriggerClass>()
  for (const job of production) {
    const gate = refsAdmittedBy(job.ifExpr)
    if (gate === null) return classes
    for (const k of gate) admitted.add(k)
  }
  const refined = classes.filter((k) => k === 'manual' || admitted.has(k))
  // The job gate and `on:` share no automatic trigger: one of the two reads is
  // wrong, and dropping to `manual` / `none` would hide that.
  if (!refined.some((k) => k !== 'manual')) return classes
  return refined
}

/**
 * The automatic triggers an `if:` admits, or null when it cannot be read as an
 * allow-list. The expression must be `||` branches of `&&` conjuncts, and every
 * conjunct must be one of the atoms `readAtom` knows — anything else (a negation
 * in any spelling: `!`, `!=`, `== false`, `== 0`; another function over the ref;
 * a nested `||`) makes the whole gate unread. Each branch must test a positive
 * ref or be explicitly gated on `workflow_dispatch`: a branch without either
 * could admit any event.
 */
export function refsAdmittedBy(expr: string | null): DeployTriggerClass[] | null {
  if (!expr) return null
  const body = expr.replace(/^\s*\$\{\{/, '').replace(/\}\}\s*$/, '')
  const branches = splitTopLevel(body, '||')
  if (branches === null) return null

  const out = new Set<DeployTriggerClass>()
  for (const branch of branches) {
    const conjuncts = splitTopLevel(branch, '&&')
    if (conjuncts === null) return null
    let gated = false
    for (const conjunct of conjuncts) {
      const atom = readAtom(conjunct)
      if (atom === null) return null
      if (atom.kind === 'ref') {
        out.add(atom.trigger)
        gated = true
      } else if (atom.kind === 'dispatch') gated = true
    }
    if (!gated) return null
  }
  return out.size > 0 ? [...out] : null
}

type Atom =
  | { kind: 'ref'; trigger: DeployTriggerClass }
  | { kind: 'dispatch' }
  | { kind: 'neutral' }

const LIT = String.raw`'([^']*)'`
const eq = (lhs: string) => new RegExp(String.raw`^(?:${lhs}\s*==\s*${LIT}|${LIT}\s*==\s*${lhs})$`)
const REF_EQ = eq(String.raw`github\.ref`)
const REF_NAME_EQ = eq(String.raw`github\.ref_name`)
const EVENT_EQ = eq(String.raw`github\.event_name`)
// Conjuncts that only narrow and never mention the ref.
const NEUTRAL_EQ = eq(String.raw`(?:github\.event\.inputs|inputs)\.[A-Za-z_][\w-]*`)
const TAG_PREFIX = new RegExp(String.raw`^startsWith\(\s*github\.ref\s*,\s*${LIT}\s*\)$`)

/** One `&&` conjunct, or null when it is not an exact known form. */
function readAtom(raw: string): Atom | null {
  const text = raw.trim()
  if (text === 'success()') return { kind: 'neutral' }
  let m = REF_EQ.exec(text)
  if (m) {
    const ref = m[1] ?? m[2]
    if (ref === 'refs/heads/main' || ref === 'refs/heads/master') {
      return { kind: 'ref', trigger: 'push-main' }
    }
    return ref.startsWith('refs/tags/') ? { kind: 'ref', trigger: 'tag-v' } : null
  }
  m = REF_NAME_EQ.exec(text)
  if (m) {
    const name = m[1] ?? m[2]
    return name === 'main' || name === 'master' ? { kind: 'ref', trigger: 'push-main' } : null
  }
  m = TAG_PREFIX.exec(text)
  if (m) return m[1].startsWith('refs/tags/') ? { kind: 'ref', trigger: 'tag-v' } : null
  m = EVENT_EQ.exec(text)
  if (m) return (m[1] ?? m[2]) === 'workflow_dispatch' ? { kind: 'dispatch' } : { kind: 'neutral' }
  if (NEUTRAL_EQ.test(text)) return { kind: 'neutral' }
  return null
}

/**
 * Split on `op` outside parentheses and string literals, flattening parts wrapped
 * whole in parentheses that are themselves `op`-lists; null on unbalanced input.
 * An `&&` part wrapping an `||` (`a && (b || c)`) is not a flat allow-list: null.
 */
function splitTopLevel(expr: string, op: '||' | '&&'): string[] | null {
  const parts = splitOnce(expr.trim(), op)
  if (parts === null) return null
  const out: string[] = []
  for (const part of parts) {
    if (!isWrapped(part)) {
      out.push(part)
      continue
    }
    const inner = part.slice(1, -1)
    const ors = splitOnce(inner.trim(), '||')
    if (ors === null) return null
    if (op === '||' && ors.length === 1) out.push(part)
    else if (op === '&&' && ors.length > 1) return null
    else {
      const nested = splitTopLevel(inner, op)
      if (nested === null) return null
      out.push(...nested)
    }
  }
  return out
}

function isWrapped(part: string): boolean {
  if (!part.startsWith('(') || !part.endsWith(')')) return false
  let depth = 0
  let quoted = false
  for (let i = 0; i < part.length; i++) {
    if (part[i] === "'") quoted = !quoted
    else if (quoted) continue
    else if (part[i] === '(') depth++
    else if (part[i] === ')' && --depth === 0) return i === part.length - 1
  }
  return false
}

function splitOnce(expr: string, op: '||' | '&&'): string[] | null {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let quoted = false
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (ch === "'") quoted = !quoted
    else if (quoted) continue
    else if (ch === '(') depth++
    else if (ch === ')' && --depth < 0) return null
    else if (depth === 0 && ch === op[0] && expr[i + 1] === op[1]) {
      parts.push(expr.slice(start, i))
      start = i + 2
      i++
    }
  }
  if (depth !== 0 || quoted) return null
  parts.push(expr.slice(start))
  return parts.map((p) => p.trim())
}

/** Jobs under the root `jobs:` key with the few fields the refinement reads. */
function parseJobs(raw: string): JobInfo[] {
  const lines = raw.split('\n')
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l))
  if (start === -1) return []
  const indentOf = (l: string) => l.length - l.trimStart().length
  const meaningful = (l: string) => l.trim() !== '' && !/^\s*#/.test(l)

  const jobs: JobInfo[] = []
  let jobIndent = -1
  let current: { info: JobInfo; lines: string[] } | null = null
  const flush = () => {
    if (current) jobs.push(fillJob(current.info, current.lines))
  }
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!meaningful(line)) {
      if (current) current.lines.push(line)
      continue
    }
    const indent = indentOf(line)
    if (indent === 0) break
    if (jobIndent === -1) jobIndent = indent
    if (indent === jobIndent) {
      flush()
      const id = splitKey(line.trim())?.key ?? line.trim()
      current = {
        info: { id, name: null, environment: null, ifExpr: null, hasPermissions: false },
        lines: [],
      }
    } else if (current) {
      current.lines.push(line)
    }
  }
  flush()
  return jobs
}

function fillJob(info: JobInfo, lines: string[]): JobInfo {
  const indentOf = (l: string) => l.length - l.trimStart().length
  const first = lines.find((l) => l.trim() !== '' && !/^\s*#/.test(l))
  if (!first) return info
  const propIndent = indentOf(first)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '' || indentOf(line) !== propIndent) continue
    const kv = splitKey(line.trim())
    if (!kv) continue
    // A property's value may continue on deeper-indented lines (block scalar or map).
    const nested: string[] = []
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== '' && indentOf(lines[j]) <= propIndent) break
      nested.push(lines[j].trim())
    }
    const inline = /^[|>][-+]?$/.test(kv.value) ? '' : kv.value
    if (kv.key === 'name') info.name = unquote(inline) || null
    if (kv.key === 'permissions') info.hasPermissions = true
    if (kv.key === 'if') info.ifExpr = [inline, ...nested].join(' ').trim() || null
    if (kv.key === 'environment') {
      const envName = nested.map((l) => splitKey(l)).find((n) => n?.key === 'name')?.value
      info.environment = unquote(inline || envName || '') || null
    }
  }
  return info
}

// ── minimal indentation parser ───────────────────────────────────────────

function isMainBranch(b: string) {
  return MAIN_BRANCHES.has(b)
}

function scalarAtRoot(raw: string, key: string): string | null {
  const m = raw.match(new RegExp(`^${key}:[ \\t]*(.+)$`, 'm'))
  if (!m) return null
  return unquote(m[1].trim()) || null
}

function findOnNode(raw: string): Node | null {
  const lines = raw.split('\n')
  // `on` is a YAML 1.1 boolean, so it is sometimes written quoted.
  const idx = lines.findIndex((l) => /^(?:on|'on'|"on"):/.test(l))
  if (idx === -1) return null

  const header = lines[idx]
  const inline = header.slice(header.indexOf(':') + 1).trim()
  const node: Node = { key: 'on', value: inline, children: [] }

  const block: string[] = []
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    if (!/^\s/.test(line)) break // next top-level key ends the block
    block.push(line)
  }
  node.children = parseIndentTree(block)
  return node
}

function parseIndentTree(lines: string[]): Node[] {
  const roots: Node[] = []
  const stack: { indent: number; node: Node }[] = []

  for (const line of lines) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    const indent = line.length - line.trimStart().length
    const body = line.trim()

    let key: string
    let value: string
    if (body.startsWith('- ')) {
      key = '-'
      value = body.slice(2).trim()
    } else if (body === '-') {
      key = '-'
      value = ''
    } else {
      const colon = splitKey(body)
      if (!colon) continue
      key = colon.key
      value = colon.value
    }

    const node: Node = { key, value, children: [] }
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) stack.pop()
    if (stack.length === 0) roots.push(node)
    else stack[stack.length - 1].node.children.push(node)
    stack.push({ indent, node })
  }

  return roots
}

function splitKey(body: string): { key: string; value: string } | null {
  const m = body.match(/^([\w'"-]+)\s*:\s*(.*)$/)
  if (!m) return null
  return { key: unquote(m[1]), value: m[2].trim() }
}

function unquote(s: string) {
  return s.replace(/^['"]|['"]$/g, '')
}

function eventNames(on: Node): Set<string> {
  const names = new Set<string>()
  if (on.value) {
    // `on: push` / `on: [push, pull_request]`
    for (const token of on.value.replace(/[[\]]/g, ' ').split(/[,\s]+/)) {
      if (token) names.add(unquote(token))
    }
  }
  for (const c of on.children) {
    if (c.key === '-') {
      if (c.value) names.add(unquote(c.value))
    } else {
      names.add(c.key)
    }
  }
  return names
}

function childNamed(node: Node, key: string): Node | null {
  return node.children.find((c) => c.key === key) ?? null
}

function hasChild(node: Node, key: string): boolean {
  return node.children.some((c) => c.key === key)
}

/** Values of a `key: [a, b]` or `key:` + `- a` list, or null when absent. */
function listValues(node: Node, key: string): string[] | null {
  const child = childNamed(node, key)
  if (!child) return null
  const out: string[] = []
  if (child.value) {
    for (const token of child.value.replace(/[[\]]/g, ' ').split(/[,\s]+/)) {
      if (token) out.push(unquote(token))
    }
  }
  for (const item of child.children) {
    if (item.key === '-' && item.value) out.push(unquote(item.value))
  }
  return out
}

/** Like `listValues`, but entries may hold spaces (`workflows: ['CI / Deploy']`): split on commas outside quotes. */
function listValuesQuoted(node: Node, key: string): string[] | null {
  const child = childNamed(node, key)
  if (!child) return null
  const out: string[] = []
  const inline = stripLineComment(child.value)
    .trim()
    .replace(/^\[|\]$/g, '')
  if (inline !== '') {
    let quote: string | null = null
    let start = 0
    for (let i = 0; i <= inline.length; i++) {
      const ch = inline[i]
      if (quote) {
        if (ch === quote) quote = null
      } else if (ch === "'" || ch === '"') quote = ch
      else if (ch === ',' || i === inline.length) {
        const item = unquote(inline.slice(start, i).trim())
        if (item) out.push(item)
        start = i + 1
      }
    }
  }
  for (const item of child.children)
    if (item.key === '-' && item.value) out.push(unquote(stripLineComment(item.value).trim()))
  return out
}

// ── declared vs derived ──────────────────────────────────────────────────

export type Verdict = 'confirmed-push-main' | 'needs-approval'

export interface TriggerCheck {
  declared: string | null
  derived: DerivedDeployTrigger
  verdict: Verdict
  /** Why the verdict is what it is — reported verbatim by /commit Step 6-Gate. */
  status: 'confirmed' | 'mismatch' | 'undeclared' | 'unconfirmable'
  detail: string
}

/**
 * Declared and derived are not compared as plain strings: `none` and `manual`
 * both say "nothing fires this automatically", and under a pr-merge-based
 * workflow model a main-push deploy *is* the merge.
 */
export function triggersAgree(
  declared: string,
  derived: DeployTriggerClass,
  workflowModel?: string,
): boolean {
  if (declared === derived) return true
  // `none` is only ever declared, never derived — a repo with nothing
  // automatic derives as `manual` (dispatch-only) or reports reason 'none'.
  if (declared === 'none' && derived === 'manual') return true
  return declared === 'pr-merge' && derived === 'push-main' && workflowModel === 'pr-merge-based'
}

export function checkDeployTrigger(
  declared: string | null | undefined,
  derived: DerivedDeployTrigger,
  workflowModel?: string,
): TriggerCheck {
  const where = derived.workflows.map((w) => w.file).join(', ') || '(none)'

  if (declared === null || declared === undefined) {
    return {
      declared: null,
      derived,
      verdict: 'needs-approval',
      status: 'undeclared',
      detail: '.claude/consumer-meta.json has no deploy.deployTrigger',
    }
  }

  // "no deploy workflow" and "nothing deploys automatically" are the same claim.
  if (derived.reason === 'none' && (declared === 'manual' || declared === 'none')) {
    return {
      declared,
      derived,
      verdict: 'needs-approval',
      status: 'confirmed',
      detail: 'no deploy workflow in .github/workflows/ — consistent with the declaration',
    }
  }

  if (derived.reason !== 'derived' || derived.value === null) {
    return {
      declared,
      derived,
      verdict: 'needs-approval',
      status: 'unconfirmable',
      detail:
        derived.reason === 'ambiguous'
          ? derived.workflows.some((w) => w.classes.filter((k) => k !== 'manual').length > 1)
            ? `${where} fires on more than one automatic trigger and its production jobs could not be told apart — changing the declaration will not help; split the file, or give each deploy job an environment: and a job-level if: on the ref`
            : `production deploy workflows disagree (${where}) — declare the production trigger, not the staging one`
          : `no production deploy workflow found in .github/workflows/ — "${declared}" cannot be confirmed from this repo`,
    }
  }

  if (!triggersAgree(declared, derived.value, workflowModel)) {
    return {
      declared,
      derived,
      verdict: 'needs-approval',
      status: 'mismatch',
      detail: `declared "${declared}" but ${where} fires on "${derived.value}" — fix whichever is wrong`,
    }
  }

  return {
    declared,
    derived,
    verdict: declared === 'push-main' ? 'confirmed-push-main' : 'needs-approval',
    status: 'confirmed',
    detail: `${where} fires on "${derived.value}"`,
  }
}

export type MainPushScope = 'staging-only' | 'production' | 'none'

// ── capability-based main-push scope ─────────────────────────────────────
//
// Question: after this PR lands on the base branch, can a push there deploy
// production? Names and keywords are claims, not capabilities (a neutral
// `ci.yml` can run `wrangler deploy`; a deploy-named file can be tag-only), so
// the verdict is read off what the workflow is *able* to do: GitHub Actions
// cannot deploy without a credential, and a composite action sees no `secrets`
// context, so the calling workflow's permissions and secrets bound the damage.
// Everything fails closed — anything unreadable, dynamic or unlisted is
// treated as production. Design record: specs/plans/W-2026-10-18-deploy-scope-ci-misclass/research.md.

const SCOPE_RANK: Record<MainPushScope, number> = { none: 0, 'staging-only': 1, production: 2 }
const maxScope = (a: MainPushScope, b: MainPushScope): MainPushScope =>
  SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b

/** Secrets that cannot deploy anything: the token itself and notification webhooks. */
const BENIGN_SECRET_RE = /^(?:GITHUB_TOKEN|DISCORD_(?:[A-Z0-9_]*_)?WEBHOOK_URL)$/
/** Write scopes that only touch PR metadata — not code, packages, pages, deployments or the OIDC token. */
const SAFE_WRITE = new Set(['checks', 'statuses', 'pull-requests', 'issues'])
const NONPROD_SEG_RE = /(?:^|_)(?:STAGING|PREVIEW|DEV|TEST|E2E)(?:_|$)/
const PROD_SEG_RE = /(?:^|_)(?:PROD|PRODUCTION|LIVE)(?:_|$)/
/** Narrower than NON_PROD_RE on purpose: `nightly` is a cadence, `canary` is live traffic, `example` is too broad. */
const NONPROD_NAME_RE = /staging|preview|sandbox/i
/** Platforms that deploy from a git integration — no workflow shows it. */
const GIT_INTEGRATION_PLATFORMS = new Set(['vercel', 'netlify', 'cloudflare-pages'])
const NON_PROD_HOST_ROLES = new Set(['dev', 'staging', 'preview', 'test'])

const DEPLOY_CMD_RE = new RegExp(
  [
    String.raw`\bwrangler\s+(?:deploy|publish|pages\s+deploy|versions\s+upload|d1\b[^\n]*--remote)`,
    String.raw`cloudflare/wrangler-action`,
    String.raw`\bvercel\b[^\n]*--prod`,
    String.raw`\bnetlify\s+deploy`,
    String.raw`\b(?:flyctl|fly)\s+deploy`,
    String.raw`\bfirebase\s+deploy`,
    String.raw`\bsupabase\s+(?:db\s+push|functions\s+deploy|link|migration\s+up)`,
    String.raw`actions/deploy-pages`,
    String.raw`peaceiris/actions-gh-pages`,
    String.raw`\bgh-pages\b`,
    String.raw`\bkubectl\s+(?:apply|set\s+image|rollout)`,
    String.raw`\bhelm\s+(?:upgrade|install)`,
    String.raw`\bdocker\s+push`,
    String.raw`\bdocker(?:\s+|-)compose\b[^\n]*\bup\b`,
    String.raw`(?:^|[\s;&|(\`])(?:ssh|scp|rsync)\s`,
    String.raw`appleboy/(?:ssh|scp)-action`,
    String.raw`\bgh\s+workflow\s+run`,
    String.raw`createWorkflowDispatch|/dispatches\b`,
    String.raw`\bgit\s+push\b`,
    String.raw`\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:deploy|release|publish)\b`,
  ].join('|'),
  'im',
)

export interface ScopeFile {
  /** Repo-relative path (`.github/actions/x/action.yml`) or workflow basename. */
  path: string
  raw: string
}

/** The `deploy` block of `.claude/consumer-meta.json`, as far as the scope check reads it. */
export interface DeclaredDeploy {
  deployTrigger?: string | null
  mainPushScope?: string | null
  platform?: string | null
  hosts?: { role?: string }[] | null
}

export interface MainPushScopeOptions {
  /** `.github/actions/**` action files. Absent ⇒ any local `uses: ./.github/actions/…` is unreadable ⇒ production. */
  actions?: ScopeFile[]
  /** Base-tip `deploy` block: its declared values are a floor, never a ceiling. */
  deploy?: DeclaredDeploy | null
  /** false ⇒ report the workflows' own verdict (the CLI compares it to the declaration, so it must not include it). */
  applyFloor?: boolean
  /** Branch the PR merges into; unknown ⇒ both `main` and `master` are tried. */
  branch?: string
}

/** A declaration can only raise the scope: the PR (or the consumer) cannot talk its way down. */
export function declaredScopeFloor(deploy: DeclaredDeploy | null | undefined): MainPushScope {
  if (!deploy) return 'none'
  let floor: MainPushScope = 'none'
  if (deploy.deployTrigger === 'push-main' || deploy.deployTrigger === 'pr-merge')
    floor = 'production'
  const declared = deploy.mainPushScope
  if (declared === 'production' || declared === 'staging-only') floor = maxScope(floor, declared)
  if (deploy.platform && GIT_INTEGRATION_PLATFORMS.has(deploy.platform)) floor = 'production'
  return floor
}

/**
 * `DEV_*`/`E2E_*` secrets only mean "not production" when a separate non-prod host exists; a
 * single host shared by prod and dev (<consumer-d>) makes a `DEV_` name a label, not a boundary.
 */
function nonProdCredsTrusted(deploy: DeclaredDeploy | null | undefined): boolean {
  return !!deploy?.hosts?.some((h) => h.role !== undefined && NON_PROD_HOST_ROLES.has(h.role))
}

function stripLineComment(line: string): string {
  if (/^\s*#/.test(line)) return ''
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === "'" || ch === '"') quote = ch
    else if (ch === '#' && i > 0 && /\s/.test(line[i - 1])) return line.slice(0, i)
  }
  return line
}

/** For text scans only (keyword/command hits); capability scans read the raw text, comments included. */
function stripComments(raw: string): string {
  return raw.split('\n').map(stripLineComment).join('\n')
}

function workflowNameOf(file: string, raw: string): string {
  const name = scalarAtRoot(raw, 'name')
  return (name ? stripLineComment(name).trim() : '') || `.github/workflows/${file}`
}

// ── reachability: can a push to the base branch start this workflow? ─────

function globToRegExp(pattern: string): RegExp | null {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*'
        i++
      } else out += '[^/]*'
    } else if (ch === '?' || ch === '+') out += ch
    else if (ch === '[') {
      const end = pattern.indexOf(']', i + 1)
      if (end === -1) return null
      out += pattern.slice(i, end + 1)
      i = end
    } else out += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  }
  try {
    return new RegExp(`^${out}$`)
  } catch {
    return null
  }
}

/** GitHub filter semantics: patterns in order, a later `!` pattern excludes, a later plain one re-includes. */
function filterAdmits(patterns: string[], candidate: string): boolean | null {
  let admitted = false
  for (const p of patterns) {
    const negated = p.startsWith('!')
    const re = globToRegExp(negated ? p.slice(1) : p)
    if (!re) return null
    if (re.test(candidate)) admitted = !negated
  }
  return admitted
}

/** Does a `branches`/`branches-ignore` pair admit the branch? Unreadable ⇒ true. */
function branchesAdmit(node: Node, candidates: string[]): boolean {
  const branches = listValues(node, 'branches')
  const ignore = listValues(node, 'branches-ignore')
  if ((branches !== null && branches.length === 0) || (ignore !== null && ignore.length === 0))
    return true
  if (branches === null && ignore === null) return true
  return candidates.some((c) => {
    if (branches !== null) return filterAdmits(branches, c) !== false
    return filterAdmits(ignore ?? [], c) !== true
  })
}

interface WorkflowReach {
  /** Starts on a branch push (or another event a merge can cause) without any other workflow running first. */
  direct: boolean
  /** `workflow_run` upstream names, when the only way in is a chained run on this branch. */
  upstream: string[] | null
}

const ALWAYS_REACHABLE_EVENTS = [
  'check_suite',
  'check_run',
  'status',
  'deployment',
  'deployment_status',
  'repository_dispatch',
]

function workflowReach(raw: string, candidates: string[]): WorkflowReach {
  const on = findOnNode(raw)
  // A trigger block this parser cannot read must not read as "never fires".
  const flowMap = (v: string) => /\{\s*[^}\s]/.test(v) // `{}` (no filters) is fine; `{ branches: … }` is not parsed
  if (!on || flowMap(on.value) || on.children.some((c) => flowMap(c.value)))
    return { direct: true, upstream: null }
  const events = eventNames(on)
  let direct = ALWAYS_REACHABLE_EVENTS.some((e) => events.has(e))

  if (events.has('push')) {
    const push = childNamed(on, 'push')
    const filtered = !!push && (hasChild(push, 'branches') || hasChild(push, 'branches-ignore'))
    const tagsOnly =
      !!push && !filtered && (hasChild(push, 'tags') || hasChild(push, 'tags-ignore'))
    if (!tagsOnly && (!push || !filtered || branchesAdmit(push, candidates))) direct = true
  }

  // A merged PR fires `pull_request: closed` workflows just as a push does.
  for (const key of ['pull_request', 'pull_request_target']) {
    const pr = childNamed(on, key)
    const types = pr ? listValues(pr, 'types') : null
    if (types?.includes('closed')) direct = true
  }

  let upstream: string[] | null = null
  if (events.has('workflow_run')) {
    const wr = childNamed(on, 'workflow_run')
    const names = wr ? listValuesQuoted(wr, 'workflows') : null
    if (!wr || !names || names.length === 0) direct = true
    else if (branchesAdmit(wr, candidates)) upstream = names
  }
  return { direct, upstream }
}

/** Least fixed point: a chained `workflow_run` is reachable only when its upstream is. */
function reachableWorkflows(files: { file: string; raw: string }[], candidates: string[]) {
  const reach = files.map((f) => workflowReach(f.raw, candidates))
  const names = files.map((f) => workflowNameOf(f.file, f.raw))
  const reachable = reach.map((r) => r.direct)
  for (let changed = true; changed;) {
    changed = false
    reach.forEach((r, i) => {
      if (reachable[i] || !r.upstream) return
      const unknownUpstream = r.upstream.some((u) => !names.includes(u))
      const upstreamReachable = r.upstream.some((u) =>
        names.some((n, j) => n === u && reachable[j]),
      )
      if (unknownUpstream || upstreamReachable) {
        reachable[i] = true
        changed = true
      }
    })
  }
  return files.filter((_, i) => reachable[i])
}

// ── closure: the workflow plus everything it calls from this tree ────────

const LOCAL_USES_RE = /^\s*(?:-\s+)?uses:\s*['"]?(\.[^\s'"#]*)/gm

function closureOf(
  wf: { file: string; raw: string },
  files: { file: string; raw: string }[],
  actions: ScopeFile[],
): { text: string; unreadable: boolean } {
  const seen = new Set<string>([`.github/workflows/${wf.file}`])
  const parts = [wf.raw]
  let unreadable = false
  const queue = [wf.raw]
  while (queue.length > 0) {
    const raw = queue.pop() ?? ''
    for (const m of raw.matchAll(LOCAL_USES_RE)) {
      const target = m[1].replace(/^\.\//, '').replace(/\/+$/, '')
      if (seen.has(target)) continue
      seen.add(target)
      let found: string | undefined
      if (target.startsWith('.github/workflows/'))
        found = files.find((f) => `.github/workflows/${f.file}` === target)?.raw
      else if (target.startsWith('.github/actions/'))
        found = actions.find(
          (a) => a.path === `${target}/action.yml` || a.path === `${target}/action.yaml`,
        )?.raw
      if (found === undefined) unreadable = true
      else {
        parts.push(found)
        queue.push(found)
      }
    }
  }
  return { text: parts.join('\n'), unreadable }
}

// ── capability facts, read off raw text (comments included: errors go strict) ─

function secretNames(text: string): { names: Set<string>; dynamic: boolean } {
  const names = new Set<string>()
  for (const m of text.matchAll(/\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1])
  const dynamic =
    /\bsecrets\s*\[|toJSON\(\s*secrets\s*\)|^\s*secrets:\s*inherit\b|\bsecrets\s*(?:\}\}|[|&,)])/m.test(
      text,
    )
  return { names, dynamic }
}

/** True when any `permissions:` block grants something a push-triggered run could deploy with. */
function permissionsEscalate(text: string): boolean {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)permissions:\s*(.*)$/.exec(stripLineComment(lines[i]))
    if (!m) continue
    const inline = m[2].trim()
    const grants: [string, string][] = []
    if (inline === 'write-all') return true
    if (inline === 'read-all' || inline === '{}') continue
    if (inline.startsWith('{')) {
      for (const pair of inline.replace(/[{}]/g, '').split(',')) {
        const kv = splitKey(pair.trim())
        if (kv) grants.push([kv.key, kv.value])
      }
    } else if (inline !== '') return true
    else {
      for (let j = i + 1; j < lines.length; j++) {
        const next = stripLineComment(lines[j])
        if (next.trim() === '') continue
        if (next.length - next.trimStart().length <= m[1].length) break
        const kv = splitKey(next.trim())
        if (kv) grants.push([kv.key, kv.value])
      }
    }
    for (const [scope, level] of grants) {
      if (level === 'read' || level === 'none') continue
      if (level === 'write' && SAFE_WRITE.has(scope)) continue
      return true
    }
  }
  return false
}

/** Every `environment:` in the closure: static literal name, or null when dynamic or unreadable. */
function environmentsOf(text: string): (string | null)[] {
  const lines = text.split('\n')
  const out: (string | null)[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?environment:\s*(.*)$/.exec(stripLineComment(lines[i]))
    if (!m) continue
    let value = m[2].trim()
    if (value === '') {
      for (let j = i + 1; j < lines.length; j++) {
        const next = stripLineComment(lines[j])
        if (next.trim() === '') continue
        if (next.length - next.trimStart().length <= m[1].length) break
        const kv = splitKey(next.trim())
        if (kv?.key === 'name') value = kv.value
      }
    }
    value = unquote(value)
    out.push(value === '' || value.includes('${{') || /^[{[]/.test(value) ? null : value)
  }
  return out
}

/**
 * GitHub-hosted runner images: fresh VMs with no standing credentials. An explicit list, not a
 * `ubuntu-*` prefix: a self-hosted runner registered as `ubuntu-prod` would match the prefix and
 * still be a persistent host.
 */
const HOSTED_RUNNER_RE =
  /^(?:ubuntu-(?:latest|slim|\d{2}\.\d{2})(?:-arm)?|windows-(?:latest|11-arm|\d{4}(?:-vs\d{4})?)|macos-(?:latest|\d{2})(?:-(?:intel|large|xlarge))?)$/
/** Labels of the ephemeral CI runner pool (docs/golden-paths/self-hosted-ci-runners.md): JIT runners, no standing prod credentials. */
const CI_POOL_LABELS = new Set(['ci-build', 'gh-runner-lxc'])
/** Persistent hosts that run the real database/service (`docker exec supabase-db`, `pm2`, `systemctl`). */
// Add a new persistent host's label here, or staging-named workflows on it are not held to the strict host-command check.
const PERSISTENT_HOST_LABELS = new Set(['supabase'])
/**
 * Labels that exclude every persistent host: GitHub schedules a job on any runner whose labels
 * include the job's labels, so `[self-hosted, Linux, X64]` can land on the `supabase` box. Only a
 * label no persistent host carries (the <client-a> shared pool's `<client-a>-selfhosted`) rules it out.
 */
// Add a label here only after confirming no persistent host registers it (docs/golden-paths/self-hosted-ci-runners.md).
const NON_PERSISTENT_LABELS = new Set(['<client-a>-selfhosted'])

/**
 * Host-side commands that act on whatever runs on the runner's own host (the production service
 * and database on a persistent self-hosted box). Harmless on a fresh VM, a deploy on a shared host.
 */
const SERVICE_CTL_CMD_SRC = [
  String.raw`\bpm2\s+(?:reload|restart|start|stop|delete|deploy)`,
  String.raw`\bsystemctl\s+(?:restart|reload|start|stop|enable)`,
  String.raw`\bservice\s+\S+\s+(?:restart|reload|start|stop)`,
]
/** Service control on the runner's own host: a deploy wherever it runs, not a test. */
const SERVICE_CTL_CMD_RE = new RegExp(SERVICE_CTL_CMD_SRC.join('|'), 'im')
const HOST_CMD_RE = new RegExp(
  [
    ...SERVICE_CTL_CMD_SRC,
    String.raw`\bdocker(?:\s+compose|-compose)?\s+(?:exec|restart|start|stop|rm|run)\b`,
    String.raw`\bpsql\b`,
  ].join('|'),
  'im',
)

/**
 * Where the closure's jobs run. `credential-free`: every `runs-on:` is a GitHub-hosted image or
 * the ephemeral CI pool. `dynamic`: some `runs-on:` is an expression or empty — the runner (and so
 * the reach) is unknown. `shared`: a static label set outside the credential-free set — bare
 * `self-hosted`, the persistent `supabase` host, custom labels, `group:` — that host may already
 * hold production credentials (`~/.ssh`, docker socket, a logged-in CLI) and may be the very box
 * the production deploy runs on.
 */
type RunnerClass = 'credential-free' | 'shared' | 'dynamic'

/** The label tokens of every `runs-on:` in the text, one list per occurrence. */
function runsOnTokens(text: string): string[][] {
  const lines = text.split('\n')
  const out: string[][] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?runs-on:\s*(.*)$/.exec(stripLineComment(lines[i]))
    if (!m) continue
    const parts = [m[2]]
    for (let j = i + 1; j < lines.length; j++) {
      const next = stripLineComment(lines[j])
      if (next.trim() === '') continue
      if (next.length - next.trimStart().length <= m[1].length) break
      parts.push(next.trim())
    }
    out.push(
      parts
        .join(' ')
        .replace(/[[\],'"]/g, ' ')
        .split(/\s+/)
        .filter((t) => t !== '' && t !== '-'),
    )
  }
  return out
}

function isPoolRunner(tokens: string[]): boolean {
  return (
    tokens.includes('self-hosted') &&
    tokens.some((t) => CI_POOL_LABELS.has(t)) &&
    !tokens.some((t) => PERSISTENT_HOST_LABELS.has(t))
  )
}

/**
 * Some job may run on a persistent host that holds the real database/service. Fail closed: a label
 * set that does not rule the host out (bare `self-hosted`, `[self-hosted, Linux, X64]`, a custom
 * label) can be scheduled onto it, so it counts as persistent.
 */
function onPersistentHost(text: string): boolean {
  return runsOnTokens(text).some((tokens) => {
    if (tokens.length > 0 && tokens.every((t) => HOSTED_RUNNER_RE.test(t))) return false
    if (tokens.some((t) => PERSISTENT_HOST_LABELS.has(t))) return true
    if (isPoolRunner(tokens)) return false
    return !tokens.some((t) => NON_PERSISTENT_LABELS.has(t))
  })
}

function runnerClass(text: string): RunnerClass {
  let cls: RunnerClass = 'credential-free'
  for (const tokens of runsOnTokens(text)) {
    if (tokens.length === 0 || tokens.some((t) => t.includes('$'))) return 'dynamic'
    if (tokens.every((t) => HOSTED_RUNNER_RE.test(t))) continue
    if (!isPoolRunner(tokens)) cls = 'shared'
  }
  return cls
}

/** One workflow's main-push verdict, the criterion that decided it, and the runner-sharing risk. */
export interface WorkflowScopeVerdict {
  file: string
  /** Deploy-trigger scope: what a main push makes this workflow deploy. The only input to the merge gates. */
  scope: MainPushScope
  /** The criterion that decided `scope` (named so a declaration conflict can point at it). */
  basis: string
  /**
   * A non-production verdict whose jobs run on a persistent/shared self-hosted runner: the job does not
   * deploy production, but the host it runs on may hold production credentials. Runner isolation is a
   * separate fix; this flag never raises `scope`.
   */
  runnerSharedWithProduction: boolean
}

function workflowScope(
  wf: { file: string; raw: string },
  files: { file: string; raw: string }[],
  actions: ScopeFile[],
  trustNonProdCreds: boolean,
): Omit<WorkflowScopeVerdict, 'file'> {
  const { text, unreadable } = closureOf(wf, files, actions)
  const runner = runnerClass(text)
  const verdict = (scope: MainPushScope, basis: string) => ({
    scope,
    basis,
    runnerSharedWithProduction: scope !== 'production' && runner === 'shared',
  })
  if (unreadable) return verdict('production', 'local uses: target unreadable')
  // An expression `runs-on:` can pick any runner, the production host included: no verdict below holds.
  if (runner === 'dynamic') return verdict('production', 'dynamic or empty runs-on')
  const plain = stripComments(text)
  const cmd = DEPLOY_CMD_RE.test(plain)
  const word = DEPLOY_RE.test(plain)
  // On a shared host, service/database commands act on what that host runs — possibly production.
  const hostCmd = runner === 'shared' && HOST_CMD_RE.test(plain)
  // Staging name and non-prod secrets do not downgrade a deploy on the real host: service control
  // anywhere on a shared runner, and any host command (docker exec, psql, docker run --network host)
  // on a runner that may be a persistent host (labels that do not rule it out). Whether a container
  // or socket is a throwaway CI one cannot be read reliably from shell text, so no command-shape
  // guess: a workflow that wants `staging-only` with such commands pins its runner away from the
  // persistent host (`<client-a>-selfhosted`), where `runnerSharedWithProduction` carries the risk.
  const hostBlocksStaging =
    runner === 'shared' &&
    (SERVICE_CTL_CMD_RE.test(plain) || (onPersistentHost(text) && HOST_CMD_RE.test(plain)))
  const { names, dynamic } = secretNames(text)
  const envs = environmentsOf(text)
  const envProd = envs.some((e) => e === null || !NONPROD_NAME_RE.test(e))

  const jobs = parseJobs(wf.raw)
  const declared =
    /^permissions:/m.test(wf.raw) || (jobs.length > 0 && jobs.every((j) => j.hasPermissions))
  const tokenSafe = !dynamic && !permissionsEscalate(text)
  const benignOnly = [...names].every((n) => BENIGN_SECRET_RE.test(n))
  const nonProdOnly = [...names].every(
    (n) => BENIGN_SECRET_RE.test(n) || (NONPROD_SEG_RE.test(n) && !PROD_SEG_RE.test(n)),
  )
  const inert = tokenSafe && declared && benignOnly && envs.length === 0
  const tokenOnly = tokenSafe && !declared && benignOnly && envs.length === 0
  const nonProdCred = tokenSafe && trustNonProdCreds && nonProdOnly

  if (inert && !cmd && !hostCmd)
    return verdict('none', 'read-only token, no secrets, no deploy command')

  const stagingByName = NONPROD_NAME_RE.test(`${wf.file} ${scalarAtRoot(wf.raw, 'name') ?? ''}`)
  const staging =
    stagingByName &&
    !hostBlocksStaging &&
    !envProd &&
    !dynamic &&
    nonProdOnly &&
    // The file's own text only: composite actions shared with the production workflow
    // legitimately say "production" (descriptions, case labels); their credentials are
    // already bounded by the closure-wide secret/environment checks above.
    !/\b(?:prod|production|live)\b/i.test(stripComments(wf.raw)) &&
    !/\b(?:deployments|pages):\s*write\b/.test(text)
  if (staging) return verdict('staging-only', 'staging name, non-prod secrets/environment only')
  if (envProd) return verdict('production', 'environment: production (or dynamic environment)')
  if ((tokenOnly || nonProdCred) && !cmd && !word && !hostCmd)
    return verdict(
      'none',
      nonProdCred
        ? 'non-prod secrets only, no deploy command'
        : 'token only, no deploy command or word',
    )
  const why = [
    dynamic && 'dynamic secrets',
    !tokenSafe && !dynamic && 'permissions escalate',
    !nonProdOnly && `secrets ${[...names].filter((n) => !BENIGN_SECRET_RE.test(n)).join(',')}`,
    nonProdOnly &&
      !benignOnly &&
      !trustNonProdCreds &&
      'non-prod secrets without a declared non-prod host',
    cmd && 'deploy command',
    hostCmd && 'host service/database command on a shared runner',
    !cmd && word && 'deploy/release/publish word',
  ].filter(Boolean)
  return verdict('production', why.join('; ') || 'no non-production criterion matched')
}

/**
 * Main-push deploy scope of a workflow set: the worst verdict among the workflows a push to
 * the base branch can reach, raised to the declared floor. `files` are `.github/workflows/*`
 * basenames; pass the tree's `.github/actions/**` action files in `opts.actions`.
 */
export function deriveMainPushScope(
  files: { file: string; raw: string }[],
  opts: MainPushScopeOptions = {},
): MainPushScope {
  let scope: MainPushScope = opts.applyFloor === false ? 'none' : declaredScopeFloor(opts.deploy)
  for (const r of reachableScopes(files, opts)) scope = maxScope(scope, r.scope)
  return scope
}

/** Per-workflow verdicts for the workflows a push can reach — what `deriveMainPushScope` takes the max of. */
export function reachableScopes(
  files: { file: string; raw: string }[],
  opts: MainPushScopeOptions = {},
): WorkflowScopeVerdict[] {
  const candidates = opts.branch ? [opts.branch] : [...MAIN_BRANCHES]
  const actions = opts.actions ?? []
  const trust = nonProdCredsTrusted(opts.deploy)
  return reachableWorkflows(files, candidates).map((wf) => ({
    file: wf.file,
    ...workflowScope(wf, files, actions, trust),
  }))
}

/** deploy-trigger 判定用的同步 git runner（測試注入）。 */
export type DeployScopeGit = (
  cwd: string,
  args: string[],
) => { status: number | null; stdout: string }

export const defaultDeployGit: DeployScopeGit = (cwd, args) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 120_000 })
  return { status: r.status, stdout: r.stdout ?? '' }
}

/** `git ls-tree <ref> -- .github/workflows`＋`git show <ref>:<檔>`；ref 讀不到 → null。 */
function workflowsAtRef(
  repoDir: string,
  ref: string,
  git: DeployScopeGit,
): { file: string; raw: string }[] | null {
  const list = git(repoDir, ['ls-tree', '-r', '--name-only', '-z', ref, '--', '.github/workflows'])
  if (list.status !== 0) return null
  const files: { file: string; raw: string }[] = []
  for (const path of list.stdout.split('\0').filter((x) => /\.ya?ml$/u.test(x))) {
    const raw = git(repoDir, ['show', `${ref}:${path}`])
    if (raw.status === 0) files.push({ file: path.split('/').pop() ?? path, raw: raw.stdout })
  }
  return files
}

/** `git ls-tree -r --name-only <ref> -- .github/actions`＋`git show`：只收 action.yml／action.yaml；讀不到 → null。 */
function actionsAtRef(repoDir: string, ref: string, git: DeployScopeGit): ScopeFile[] | null {
  const list = git(repoDir, ['ls-tree', '-r', '--name-only', '-z', ref, '--', '.github/actions'])
  if (list.status !== 0) return null
  const out: ScopeFile[] = []
  for (const path of list.stdout.split('\0').filter((x) => /(?:^|\/)action\.ya?ml$/u.test(x))) {
    const raw = git(repoDir, ['show', `${ref}:${path}`])
    if (raw.status !== 0) return null
    out.push({ path, raw: raw.stdout })
  }
  return out
}

/** `.github/workflows`＋`.github/actions` 兩棵子樹的 tree entry（內容變動 ⇒ oid 變動）；讀不到 → null。 */
function githubSubtrees(repoDir: string, ref: string, git: DeployScopeGit): string | null {
  // git-path-z-exempt: 只比對兩個固定 ASCII 子樹 entry（含 tree oid）的整份輸出是否相等，從不拆路徑
  const r = git(repoDir, ['ls-tree', ref, '--', '.github/workflows', '.github/actions'])
  return r.status === 0 ? r.stdout.trim() : null
}

/** base tip 的 `.claude/consumer-meta.json` 的 `deploy` 區塊：沒有這個檔 → null；讀得到卻壞掉 → 'unreadable'。 */
function baseDeployAt(
  repoDir: string,
  ref: string,
  git: DeployScopeGit,
): DeclaredDeploy | null | 'unreadable' {
  const probe = git(repoDir, [
    'ls-tree',
    '--name-only',
    '-z',
    ref,
    '--',
    '.claude/consumer-meta.json',
  ])
  if (probe.status !== 0) return 'unreadable'
  if (probe.stdout.trim() === '') return null
  const raw = git(repoDir, ['show', `${ref}:.claude/consumer-meta.json`])
  if (raw.status !== 0) return 'unreadable'
  try {
    const meta: unknown = JSON.parse(raw.stdout)
    const deploy =
      meta !== null && typeof meta === 'object' ? (meta as { deploy?: unknown }).deploy : undefined
    return deploy !== null && typeof deploy === 'object' ? (deploy as DeclaredDeploy) : null
  } catch {
    return 'unreadable'
  }
}

/** `git ls-remote origin <ref>` 的 tip oid；多行時只認 ref 完全相符那行（`refs/heads/a` 會命中 `refs/heads/a/b` 的前綴）。 */
function remoteRefTip(repoDir: string, ref: string, git: DeployScopeGit): string | null {
  const r = git(repoDir, ['ls-remote', 'origin', ref])
  if (r.status !== 0) return null
  return (
    r.stdout
      .split('\n')
      .map((l) => l.trim().split(/\s+/u))
      .find(
        ([oid, name]) => name === ref && typeof oid === 'string' && /^[0-9a-f]{40}$/u.test(oid),
      )?.[0] ?? null
  )
}

/** `mergedTreeWorkflows` 讀不到合併樹 workflows 的原因分類（呼叫端訊息用）。 */
export type MergedTreeFailure =
  /** merge ref 過時（base parent 停在舊 tip）且本機 merge-tree 算不出乾淨的合併樹（衝突或失敗）。 */
  | 'stale-merge-failed'
  /** merge ref／base tip／head 讀不到、head 不在 merge parents，或合併樹的 .github/workflows 讀不到。 */
  | 'unreadable'

export interface MergedTreeWorkflows {
  files: { file: string; raw: string }[] | null
  /** files 為 null 時的原因；讀到時為 null。 */
  failure: MergedTreeFailure | null
  /** 合併樹 `.github/actions/**` 的 action 檔（composite action 的內部是 deploy 能力判定的一部分）。 */
  actions: ScopeFile[]
  /** 合併樹的 `.github/workflows`／`.github/actions` 子樹跟 base tip 不同（PR 改了 CI 本身）。 */
  githubChanged: boolean
  /** base tip 的 consumer-meta `deploy`（宣告值只能當下限）；沒有檔 → null、壞檔 → 'unreadable'。 */
  baseDeploy: DeclaredDeploy | null | 'unreadable'
  /** PR 的 base branch（可達性判定用）。 */
  baseRef: string | undefined
}

/**
 * merge ref 過時時的本機後備：算「head 合進現在的 base tip」的真實合併樹。
 * `merge-tree --write-tree` 只把新樹寫進物件庫，不動 checkout 的 index／refs／working tree。
 * 物件已在就不 fetch（`cat-file -e` 判存在）；衝突（exit≠0）或任何一步失敗 → null。
 */
function localMergedTreeOid(
  repoDir: string,
  pr: number,
  headOid: string,
  baseRef: string,
  baseTip: string,
  git: DeployScopeGit,
): string | null {
  const present = (oid: string, refspec: string) =>
    git(repoDir, ['cat-file', '-e', oid]).status === 0 ||
    (git(repoDir, ['fetch', '-q', 'origin', refspec]).status === 0 &&
      git(repoDir, ['cat-file', '-e', oid]).status === 0)
  if (!present(baseTip, `refs/heads/${baseRef}`) || !present(headOid, `refs/pull/${pr}/head`))
    return null
  const mt = git(repoDir, ['merge-tree', '--write-tree', baseTip, headOid])
  const treeOid = mt.stdout.split('\n', 1)[0]?.trim()
  if (mt.status !== 0 || !treeOid || !/^[0-9a-f]{40}$/u.test(treeOid)) return null
  return treeOid
}

/**
 * 合進 main 之後的 workflows：優先認 GitHub 算好的合併 commit `refs/pull/<n>/merge`
 * （內容＝base＋head 的合併樹），parents 要含本 head、且非 head 的 parent 要等於 base branch
 * 現在的 tip（`git ls-remote origin refs/heads/<base>`）才算新鮮——GitHub 對 test-merge 是懶算的，
 * base 前移後舊 merge ref 還在，讀到的是舊樹、看不出後來才落地的 production push:main deploy。
 * fetch 後立刻把 FETCH_HEAD 解析成固定 SHA、之後只讀那個 SHA——同 repo 的其他 fetch 會改寫 FETCH_HEAD。
 * merge ref 的 base parent 對不上 base 現在的 tip（過時）→ 不直接放棄，改用本機
 * `merge-tree --write-tree <baseTip> <headOid>` 算出的合併樹（`localMergedTreeOid`）。
 * 讀不到 → `{ files: null, failure }`（→ 'unknown' 維持人工）：NEVER 退回
 * 本 head 的樹，head 落後 main 時看不到 main 已有的 production deploy；NEVER 讀 checkout 的 working tree。
 */
export function mergedTreeWorkflows(
  repoDir: string,
  pr: number,
  headOid: string,
  baseRef: string | undefined,
  git: DeployScopeGit,
): MergedTreeWorkflows {
  const fail = (failure: MergedTreeFailure): MergedTreeWorkflows => ({
    files: null,
    failure,
    actions: [],
    githubChanged: false,
    baseDeploy: null,
    baseRef,
  })
  const read = (ref: string, baseTip: string): MergedTreeWorkflows => {
    const files = workflowsAtRef(repoDir, ref, git)
    const actions = actionsAtRef(repoDir, ref, git)
    const merged = githubSubtrees(repoDir, ref, git)
    const base = githubSubtrees(repoDir, baseTip, git)
    if (files === null || actions === null || merged === null || base === null)
      return fail('unreadable')
    return {
      files,
      failure: null,
      actions,
      githubChanged: merged !== base,
      baseDeploy: baseDeployAt(repoDir, baseTip, git),
      baseRef,
    }
  }
  if (!baseRef) return fail('unreadable')
  if (git(repoDir, ['fetch', '-q', 'origin', `refs/pull/${pr}/merge`]).status !== 0)
    return fail('unreadable')
  const parents = git(repoDir, ['rev-list', '--parents', '-n', '1', 'FETCH_HEAD'])
  if (parents.status !== 0) return fail('unreadable')
  const [mergeOid, ...parentOids] = parents.stdout.trim().split(/\s+/u)
  if (!mergeOid || !/^[0-9a-f]{40}$/u.test(mergeOid) || !parentOids.includes(headOid))
    return fail('unreadable')
  const baseTip = remoteRefTip(repoDir, `refs/heads/${baseRef}`, git)
  if (!baseTip) return fail('unreadable')
  if (parentOids.find((p) => p !== headOid) === baseTip) return read(mergeOid, baseTip)
  const treeOid = localMergedTreeOid(repoDir, pr, headOid, baseRef, baseTip, git)
  return treeOid === null ? fail('stale-merge-failed') : read(treeOid, baseTip)
}

/** 合併樹的判定值：多出兩種維持人工的結果——'unknown'（讀不到）與 'workflow-changed'（PR 改了 CI 本身）。 */
export type MergedTreeScope = MainPushScope | 'unknown' | 'workflow-changed'

/**
 * 合併樹 → main push deploy 範圍（merge-queue 與 PR 分診共用同一份判定）。順序是 fail-closed 的：
 * workflows 讀不到或是空的 → 'unknown'；PR 改了 `.github/workflows`／`.github/actions` →
 * 'workflow-changed'（判定吃的是合併樹，PR 能同時改動 CI 與判定的輸入，改動本身要人看）；base tip 的
 * consumer-meta 壞掉 → 'unknown'；其餘走能力判定，宣告值只當下限。
 */
export function scopeOfMergedTree(merged: MergedTreeWorkflows): MergedTreeScope {
  if (!merged.files?.length) return 'unknown'
  if (merged.githubChanged) return 'workflow-changed'
  if (merged.baseDeploy === 'unreadable') return 'unknown'
  return deriveMainPushScope(merged.files, {
    actions: merged.actions,
    deploy: merged.baseDeploy,
    branch: merged.baseRef,
  })
}

/**
 * `scopeOfMergedTree` 的判據明細（給分診資訊列）：判 production 的 workflow 與判據，以及
 * 不部署正式機但跑在與正式機共用 runner 上的 workflow。合併樹不走能力判定（unknown／workflow-changed）時兩者皆空。
 */
export function mergedTreeScopeDetail(merged: MergedTreeWorkflows): {
  production: { file: string; basis: string }[]
  runnerShared: string[]
} {
  if (!merged.files?.length || merged.githubChanged || merged.baseDeploy === 'unreadable')
    return { production: [], runnerShared: [] }
  const verdicts = reachableScopes(merged.files, {
    actions: merged.actions,
    deploy: merged.baseDeploy,
    branch: merged.baseRef,
  })
  return {
    production: verdicts
      .filter((v) => v.scope === 'production')
      .map(({ file, basis }) => ({ file, basis })),
    runnerShared: verdicts.filter((v) => v.runnerSharedWithProduction).map((v) => v.file),
  }
}

/** 單張 PR 合進 main 之後的 main push deploy 範圍（讀合併樹＋`scopeOfMergedTree`）。 */
export function mergedTreeMainPushScope(
  repoDir: string,
  pr: number,
  headOid: string,
  baseRef: string | undefined,
  git: DeployScopeGit = defaultDeployGit,
): MergedTreeScope {
  return scopeOfMergedTree(mergedTreeWorkflows(repoDir, pr, headOid, baseRef, git))
}

/**
 * Declared `mainPushScope` vs the workflows' own verdict: null when they agree (or nothing is declared);
 * otherwise the workflows whose verdict exceeds the declaration (derived higher) or, when derived is lower,
 * every reachable workflow — so the output names the file and the criterion behind the disagreement.
 */
export function mainPushScopeConflict(
  declared: string | null,
  derived: MainPushScope,
  workflows: WorkflowScopeVerdict[],
): {
  declared: string
  derived: MainPushScope
  workflows: { file: string; scope: MainPushScope; basis: string }[]
} | null {
  if (declared !== 'none' && declared !== 'staging-only' && declared !== 'production') return null
  if (declared === derived) return null
  const above = workflows.filter((w) => SCOPE_RANK[w.scope] > SCOPE_RANK[declared])
  const cited = above.length > 0 ? above : workflows
  return {
    declared,
    derived,
    workflows: cited.map(({ file, scope, basis }) => ({ file, scope, basis })),
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────

async function main(argv: string[]) {
  const { existsSync, readdirSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')

  let repo = process.cwd()
  let asJson = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') repo = argv[++i] ?? repo
    else if (argv[i] === '--json') asJson = true
    else if (argv[i] === '--help' || argv[i] === '-h') {
      process.stdout.write('Usage: node scripts/deploy-trigger-check.ts [--repo <path>] [--json]\n')
      return 0
    } else {
      process.stderr.write(`[deploy-trigger-check] unknown argument: ${argv[i]}\n`)
      return 2
    }
  }

  let declared: string | null = null
  let declaredMainPushScope: string | null = null
  let declaredDeploy: DeclaredDeploy | null = null
  const metaPath = join(repo, '.claude/consumer-meta.json')
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
      declared = meta?.deploy?.deployTrigger ?? null
      declaredMainPushScope = meta?.deploy?.mainPushScope ?? null
      declaredDeploy = meta?.deploy ?? null
    } catch {
      declared = null
    }
  }

  const dir = join(repo, '.github/workflows')
  const files: { file: string; raw: string }[] = []
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (!/\.ya?ml$/.test(file)) continue
      try {
        files.push({ file, raw: readFileSync(join(dir, file), 'utf8') })
      } catch {
        // unreadable workflow — same as absent for derivation purposes
      }
    }
  }

  const actions: ScopeFile[] = []
  const walk = (rel: string) => {
    const abs = join(repo, rel)
    if (!existsSync(abs)) return
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else if (/^action\.ya?ml$/.test(entry.name)) {
        try {
          actions.push({ path: child, raw: readFileSync(join(repo, child), 'utf8') })
        } catch {
          // unreadable action — a workflow that uses it then reads as production
        }
      }
    }
  }
  walk('.github/actions')

  const check = checkDeployTrigger(declared, deriveDeployTrigger(files))
  const scopeOpts = { actions, deploy: declaredDeploy, applyFloor: false } as const
  const mainPushScope = deriveMainPushScope(files, scopeOpts)
  const workflows = reachableScopes(files, scopeOpts)
  const runnerShared = workflows.filter((w) => w.runnerSharedWithProduction).map((w) => w.file)
  const conflict = mainPushScopeConflict(declaredMainPushScope, mainPushScope, workflows)

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ...check,
          declaredMainPushScope,
          derivedMainPushScope: mainPushScope,
          runnerSharedWithProduction: runnerShared,
          mainPushScopeConflict: conflict,
          mainPushWorkflows: workflows,
        },
        null,
        2,
      )}\n`,
    )
  } else {
    process.stdout.write(
      `declared=${check.declared ?? 'unknown'}\n` +
        `derived=${check.derived.value ?? check.derived.reason}\n` +
        `verdict=${check.verdict}\n` +
        `status=${check.status}\n` +
        `detail=${check.detail}\n` +
        `declaredMainPushScope=${declaredMainPushScope ?? 'undeclared'}\n` +
        `derivedMainPushScope=${mainPushScope}\n` +
        `runnerSharedWithProduction=${runnerShared.join(',') || 'none'}\n` +
        workflows.map((w) => `workflow ${w.file}: ${w.scope} (${w.basis})\n`).join('') +
        (conflict
          ? `mainPushScopeConflict: declared ${conflict.declared}, derived ${conflict.derived} — ${conflict.workflows.map((w) => `${w.file} (${w.basis})`).join('; ')}\n`
          : ''),
    )
  }

  return check.status === 'mismatch' ? 1 : 0
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith('deploy-trigger-check.ts')
if (invokedDirectly) process.exit(await main(process.argv.slice(2)))
