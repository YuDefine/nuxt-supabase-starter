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
    candidates.push({ file, workflowName, classes: classifyWorkflowTriggers(raw) })
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
          ? `production deploy workflows disagree (${where}) — declare the production trigger, not the staging one`
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
  const metaPath = join(repo, '.claude/consumer-meta.json')
  if (existsSync(metaPath)) {
    try {
      declared = JSON.parse(readFileSync(metaPath, 'utf8'))?.deploy?.deployTrigger ?? null
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

  const check = checkDeployTrigger(declared, deriveDeployTrigger(files))

  if (asJson) {
    process.stdout.write(`${JSON.stringify(check, null, 2)}\n`)
  } else {
    process.stdout.write(
      `declared=${check.declared ?? 'unknown'}\n` +
        `derived=${check.derived.value ?? check.derived.reason}\n` +
        `verdict=${check.verdict}\n` +
        `status=${check.status}\n` +
        `detail=${check.detail}\n`,
    )
  }

  return check.status === 'mismatch' ? 1 : 0
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith('deploy-trigger-check.ts')
if (invokedDirectly) process.exit(await main(process.argv.slice(2)))
