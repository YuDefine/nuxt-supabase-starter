// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/plan-gates.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/plan-gates.ts
/**
 * Plan lifecycle gates — entry / specification-readiness / dispatch / close-acceptance /
 * scope-spec-integrity.
 *
 * 父 plan `W-2026-09-14-plan-truth-refactor` § Notes「Enforcement and delivery boundary」要求把同
 * 一份契約綁到真正的 planning／dispatch／closure 入口，並在缺漏、過期、矛盾時給出**可據以行動的
 * 理由**。所以本檔每一條 finding 都帶穩定 `code` ＋ `path` ＋ `detail`：`code` 是機器（測試、
 * dispatch 入口、稽核）唯一該比對的東西，散文只給人看。**NEVER** 讓拒絕訊息只寫「不符契約」——
 * 那句話與沒有訊息等值。
 *
 * 本檔只讀不寫：不動 truth、不動 plan.md、不鑄 id。唯一的副作用是 readiness 會在暫存目錄跑一次
 * plan 自己宣告的 acceptance 指令（`--dry-run`），那是 plan 的契約而不是本檔的選擇。
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'

import {
  fileRevisedAtMs,
  normalizeReportUri,
  parseFeatureScenarios,
  planRevisedAt,
  readAcceptanceVerdicts,
  readEvidenceVerdicts,
} from './acceptance-verdicts.ts'
import {
  ANCHOR_REQUIRED_KINDS,
  TRUTH_FEATURES_PREFIX,
  parseWorkKind,
  readPlanDeltas,
  regressionAnchors,
  requirementSet,
  splitDeltaUnit,
  type RegressionAnchor,
  type RequirementSet,
  type TruthDelta,
  type WorkKind,
} from './plan-delta.ts'
import { PLAN_ROOT, TRUTH_ROOT, hashTruth } from './plan-paths.ts'

/** 每一條拒絕理由。`code` 穩定、被測試與入口比對；`path` 指到看得見的東西；`detail` 給人。 */
export interface GateFinding {
  code: string
  path: string
  detail: string
}

export interface PlanRef {
  workId: string
  path: string
  status: string
  slug: string
}

export type ResolveStatus = 'resolved' | 'not_found' | 'ambiguous'

export interface ResolveResult {
  query: string
  status: ResolveStatus
  workId: string | null
  path: string | null
  planStatus: string | null
  candidates: string[]
}

export interface ReadinessResult {
  workId: string
  plan: string
  ready: boolean
  acceptanceCommand: string | null
  /** plan 宣告的工作種類；null＝沒判過（或值域外），照完整要求集。 */
  work_kind: WorkKind | null
  /** 這次套用的要求集：`full`＝現行完整 readiness，`regression`＝只要迴歸錨點。 */
  requirement_set: RequirementSet
  findings: GateFinding[]
}

export interface DispatchGateResult {
  /** 這次 dispatch 有沒有落進本 gate 的適用範圍。false = 行為與 gate 不存在時完全相同。 */
  gated: boolean
  /** 為什麼不適用（gated=false 時）／為什麼適用（gated=true 時）。 */
  reason: string
  workId: string | null
  ready: boolean
  /** gated 時是 readiness 讀到的工作種類，拒絕訊息的標題帶它。 */
  workKind?: WorkKind | null
  findings: GateFinding[]
}

export interface IntegrityResult {
  workId: string
  since: string
  ok: boolean
  findings: GateFinding[]
}

/** 只有這些狀態算「還在進行中的同一件工作」，slug 重開時 resume 它。 */
const LIVE_PLAN_STATUSES = new Set(['active', 'blocked', 'closing'])

const WORK_ID_RE = /^W-\d{4}-\d{2}-\d{2}-(.+)$/u

export function slugOfWorkId(workId: string): string | null {
  return WORK_ID_RE.exec(workId)?.[1] ?? null
}

function toPosix(p: string): string {
  return p.split(sep).join('/')
}

function walkFiles(dir: string, accept: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(full, accept))
    else if (accept(entry.name)) out.push(full)
  }
  return out.toSorted()
}

/**
 * plan.md 的 frontmatter 原文欄位。
 *
 * 用 regex 而不是 `parsePlan`：`plan-lifecycle.ts` import 本檔（close／open 兩處 gate），
 * 反向 import 會成環（oxlint `import/no-cycle` 是 error）。`acceptance_command` 已由
 * `PlanDocument.acceptanceCommand` 承載（render／parse 對稱），本檔只是不透過它讀。
 */
export function readFrontmatterField(markdown: string, field: string): string | null {
  if (!markdown.startsWith('---')) return null
  const end = markdown.indexOf('\n---', 3)
  if (end === -1) return null
  const block = markdown.slice(3, end)
  const re = new RegExp(`^${field}:\\s*(.*)$`, 'mu')
  const raw = re.exec(block)?.[1]?.trim()
  if (!raw) return null
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1)
  }
  return raw
}

function planDirOf(root: string, workId: string): string {
  return join(root, PLAN_ROOT, workId)
}

function planPathOf(root: string, workId: string): string {
  return join(planDirOf(root, workId), 'plan.md')
}

/** package 是不是 lifecycle plan：frontmatter 同時有 `work_id:` 與 `truth_baseline:`。 */
export function isLifecyclePlan(root: string, workId: string): boolean {
  const p = planPathOf(root, workId)
  if (!existsSync(p)) return false
  const text = readFileSync(p, 'utf8')
  return (
    readFrontmatterField(text, 'work_id') !== null &&
    readFrontmatterField(text, 'truth_baseline') !== null
  )
}

// ── Lifecycle layout guard ─────────────────────────────────────────────────

const NNN_PACKAGE_RE = /^\d{3,}-/u
const LIFECYCLE_CONTRACT = `${TRUTH_ROOT}/work-lifecycle.md`

function hasLifecycleKeys(text: string): boolean {
  return (
    readFrontmatterField(text, 'work_id') !== null &&
    readFrontmatterField(text, 'truth_baseline') !== null
  )
}

/**
 * 上游 aixbdd owner 照原文會建 `truth-delta.md`、遞增 `NNN-*` package、覆寫 `plan.md`；clade 只做加法
 * （W-2026-10-01-aixbdd-additive-only），伴隨覆寫檔要模型改走 lifecycle 落點，這裡是不靠模型自律
 * 的那一道：
 *
 * - lifecycle package（frontmatter 有 `work_id`＋`truth_baseline`）內不得有 `truth-delta.md`——delta
 *   的載體是 `plan.md` 的 `## Truth delta`
 * - repo 有 `specs/truth/work-lifecycle.md` 時，本工作期間 `specs/plans/` 不得新增 `NNN-*` package。
 *   「本工作期間」＝本 plan.md 第一次被 commit 之後（還沒 commit 就以 HEAD 為準）；在那之前就在的
 *   舊 `NNN-*` 是遷移前的歷史，不擋
 * - 已 commit 的版本有 `work_id`＋`truth_baseline`、現在卻沒了＝被上游 owner 覆寫掉。只看 git 裡
 *   曾經有過：從來沒有 frontmatter 的舊 plan 不是被抹掉
 *
 * 判準只看 frontmatter 鍵與 work-lifecycle 契約檔，NEVER 用 repo 名推斷。readiness 與 close 都呼叫。
 */
export function checkLifecycleLayout(root: string, workId: string): GateFinding[] {
  const findings: GateFinding[] = []
  const planRel = `${PLAN_ROOT}/${workId}/plan.md`
  const planFile = planPathOf(root, workId)
  if (!existsSync(planFile)) return findings
  const text = readFileSync(planFile, 'utf8')
  const lifecycle = hasLifecycleKeys(text)

  if (lifecycle) {
    for (const file of walkFiles(planDirOf(root, workId), (n) => n === 'truth-delta.md')) {
      findings.push({
        code: 'lifecycle-truth-delta-file',
        path: toPosix(relative(root, file)),
        detail:
          'a lifecycle package carries its truth delta in plan.md `## Truth delta`, never a truth-delta.md; move the rows there (state `proposed`) and delete the file',
      })
    }
  }

  const firstAdd = gitLines(root, ['log', '--diff-filter=A', '--format=%H', '--', planRel]).at(-1)
  if (!lifecycle) {
    const committed = [firstAdd, 'HEAD'].filter(Boolean).map((rev) => {
      try {
        return execFileSync('git', ['show', `${rev}:${planRel}`], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        })
      } catch {
        return ''
      }
    })
    if (committed.some(hasLifecycleKeys)) {
      findings.push({
        code: 'lifecycle-frontmatter-removed',
        path: `${planRel}:frontmatter`,
        detail:
          'the committed plan.md had `work_id:` and `truth_baseline:` but the working copy lost them; plan.md is a lifecycle file owned by flow — restore its frontmatter, write analysis to system-analysis.md',
      })
    }
  }

  if (existsSync(join(root, LIFECYCLE_CONTRACT))) {
    const base = firstAdd ?? 'HEAD'
    const before = new Set(
      gitLines(root, ['ls-tree', '-d', '--name-only', `${base}:${PLAN_ROOT}`]).filter((n) =>
        NNN_PACKAGE_RE.test(n),
      ),
    )
    const plansDir = join(root, PLAN_ROOT)
    for (const entry of existsSync(plansDir)
      ? readdirSync(plansDir, { withFileTypes: true })
      : []) {
      if (!entry.isDirectory() || !NNN_PACKAGE_RE.test(entry.name) || before.has(entry.name))
        continue
      findings.push({
        code: 'lifecycle-nnn-package',
        path: `${PLAN_ROOT}/${entry.name}`,
        detail: `this repo has ${LIFECYCLE_CONTRACT}: packages are \`flow plan open\` work ids, never a new NNN-* directory; move its artifacts into ${PLAN_ROOT}/${workId}/`,
      })
    }
  }
  return findings
}

export function listPlans(root: string): PlanRef[] {
  const dir = join(root, PLAN_ROOT)
  if (!existsSync(dir)) return []
  const out: PlanRef[] = []
  for (const name of readdirSync(dir).toSorted()) {
    const p = join(dir, name, 'plan.md')
    if (!existsSync(p)) continue
    const text = readFileSync(p, 'utf8')
    const workId = readFrontmatterField(text, 'work_id') ?? name
    out.push({
      workId: name,
      path: toPosix(relative(root, p)),
      status: readFrontmatterField(text, 'status') ?? 'active',
      slug: slugOfWorkId(workId) ?? slugOfWorkId(name) ?? name,
    })
  }
  return out
}

/**
 * Entry gate 的查找：同一個 slug 已經有一個**進行中**的 plan 時，那就是這件工作的 canonical id。
 *
 * 日期不參與比對——`W-2026-09-14-foo` 與今天鑄的 `W-2026-09-17-foo` 是同一件事，而「今天的日期
 * 不一樣」正是重複開卡最常見的成因。
 *
 * 同 slug 有兩個以上進行中的 plan 是既存異常，**NEVER** 靜默挑一個：那會讓兩份工作各自以為自己
 * 是正本。這裡丟例外並指名候選，由人決定哪一個留下。
 */
export function resolveActivePlanBySlug(root: string, slug: string): PlanRef | null {
  const hits = listPlans(root).filter((p) => p.slug === slug && LIVE_PLAN_STATUSES.has(p.status))
  if (hits.length === 0) return null
  if (hits.length > 1) {
    throw new Error(
      `slug "${slug}" resolves to ${hits.length} active plans: ${hits
        .map((h) => h.workId)
        .join(', ')}; close or supersede all but one before opening`,
    )
  }
  return hits[0]!
}

/** `flow plan resolve <slug|work-id>` 的本體。skill／dispatch 用它問「這件事的正本是哪一個」。 */
export function resolvePlan(root: string, query: string): ResolveResult {
  const plans = listPlans(root)
  const byId = plans.find((p) => p.workId === query)
  if (byId) {
    return {
      query,
      status: 'resolved',
      workId: byId.workId,
      path: byId.path,
      planStatus: byId.status,
      candidates: [byId.workId],
    }
  }
  const bySlug = plans.filter((p) => p.slug === query && LIVE_PLAN_STATUSES.has(p.status))
  if (bySlug.length === 1) {
    const hit = bySlug[0]!
    return {
      query,
      status: 'resolved',
      workId: hit.workId,
      path: hit.path,
      planStatus: hit.status,
      candidates: [hit.workId],
    }
  }
  if (bySlug.length > 1) {
    return {
      query,
      status: 'ambiguous',
      workId: null,
      path: null,
      planStatus: null,
      candidates: bySlug.map((p) => p.workId),
    }
  }
  return { query, status: 'not_found', workId: null, path: null, planStatus: null, candidates: [] }
}

// ── Specification readiness ────────────────────────────────────────────────

const CLARIFICATION_MARKER = 'NEEDS CLARIFICATION'

export function unresolvedClarifications(text: string): { line: number; detail: string }[] {
  const out: { line: number; detail: string }[] = []
  text.split(/\r?\n/u).forEach((line, index) => {
    if (!line.includes(CLARIFICATION_MARKER)) return
    // 同一行標了 RESOLVED 的是留痕，不是未決。**NEVER** 把整段歷史記錄讀成未決事項。
    if (/\bRESOLVED\b/u.test(line)) return
    out.push({ line: index + 1, detail: line.trim() })
  })
  return out
}

interface DryRunStep {
  status: string
  keyword: string
  name: string
  line: number
  uri: string
  scenario: string
}

/**
 * 跑 plan 自己宣告的 acceptance 指令，只問「每一個 step 解析得出來嗎」。
 *
 * 契約：`<acceptance_command> --dry-run --format json:<tmp>` 印 cucumber JSON。undefined ／
 * ambiguous step 出現在 `steps[].result.status`。這是 plan 宣告的介面，不是本檔對某一個 runner
 * 的耦合——換 runner 只要它照樣印 cucumber JSON 就仍然成立。
 */
export function runAcceptanceDryRun(opts: { root: string; command: string; timeoutMs?: number }): {
  ok: boolean
  error: string | null
  scenarios: number
  /** 這次 run 涵蓋的每一條 scenario（repo-relative uri ＋ 標題），給錨點比對用。 */
  ran: { uri: string; title: string }[]
  unresolved: DryRunStep[]
} {
  const dir = mkdtempSync(join(tmpdir(), 'clade-readiness-'))
  const report = join(dir, 'dry-run.json')
  try {
    const run = spawnSync('sh', ['-c', `${opts.command} --dry-run --format json:${report}`], {
      cwd: opts.root,
      encoding: 'utf8',
      timeout: opts.timeoutMs ?? 120_000,
    })
    if (!existsSync(report)) {
      const tail = `${run.stderr ?? ''}${run.stdout ?? ''}`.trim().split('\n').slice(-5).join(' | ')
      return {
        ok: false,
        error: `acceptance command produced no cucumber JSON (exit ${run.status ?? 'null'})${
          tail ? `: ${tail}` : ''
        }`,
        scenarios: 0,
        ran: [],
        unresolved: [],
      }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(report, 'utf8'))
    } catch (error) {
      return {
        ok: false,
        error: `cucumber JSON is unreadable: ${(error as Error).message}`,
        scenarios: 0,
        ran: [],
        unresolved: [],
      }
    }
    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        error: 'cucumber JSON MUST be a feature array',
        scenarios: 0,
        ran: [],
        unresolved: [],
      }
    }
    const unresolved: DryRunStep[] = []
    const ran: { uri: string; title: string }[] = []
    let scenarios = 0
    for (const feature of parsed as Record<string, unknown>[]) {
      const uri = typeof feature?.uri === 'string' ? feature.uri : ''
      const featureTags = tagNames(feature?.tags)
      for (const element of (Array.isArray(feature?.elements) ? feature.elements : []) as Record<
        string,
        unknown
      >[]) {
        if (element?.type === 'background') continue
        scenarios += 1
        const scenario = typeof element?.name === 'string' ? element.name.trim() : ''
        ran.push({ uri: normalizeReportUri(opts.root, uri), title: scenario })
        const tags = new Set([...featureTags, ...tagNames(element?.tags)])
        // `@human` 場景本來就沒有可執行的 step；拿它的 undefined 去擋 dispatch 是誤報。
        if (tags.has('@human')) continue
        for (const step of (Array.isArray(element?.steps) ? element.steps : []) as Record<
          string,
          unknown
        >[]) {
          if (step?.hidden) continue
          const status = String((step?.result as Record<string, unknown>)?.status ?? '')
          if (status !== 'undefined' && status !== 'ambiguous') continue
          unresolved.push({
            status,
            keyword: String(step?.keyword ?? '').trim(),
            name: String(step?.name ?? '').trim(),
            line: Number(step?.line ?? 0),
            uri,
            scenario,
          })
        }
      }
    }
    return { ok: true, error: null, scenarios, ran, unresolved }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function tagNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((tag) =>
      typeof tag === 'string' ? tag : String((tag as Record<string, unknown>)?.name ?? ''),
    )
    .filter(Boolean)
}

/**
 * B5 的判定本體：這個 package 夠不夠格交給實作者開工。
 *
 * `runAcceptance: false` 只給「已經知道指令不存在」與單元測試用；正常路徑一律真的跑一次
 * `--dry-run`——**沒跑過的 DSL 與不存在的 DSL 事後不可區分**，而那正是 B5 要擋的東西。
 */
export function checkReadiness(
  root: string,
  workId: string,
  opts: { runAcceptance?: boolean; timeoutMs?: number } = {},
): ReadinessResult {
  const findings: GateFinding[] = []
  const planRel = `${PLAN_ROOT}/${workId}/plan.md`
  const planFile = planPathOf(root, workId)
  if (!existsSync(planFile)) {
    return {
      workId,
      plan: planRel,
      ready: false,
      acceptanceCommand: null,
      work_kind: null,
      requirement_set: 'full',
      findings: [
        {
          code: 'plan-missing',
          path: planRel,
          detail: `no lifecycle plan for ${workId}; \`flow plan open <slug>\` mints one`,
        },
      ],
    }
  }
  const planText = readFileSync(planFile, 'utf8')

  // 0. 工作種類與 delta 形狀。讀不懂的種類照完整要求集，並說出合法值。
  let kind: WorkKind | null = null
  try {
    kind = parseWorkKind(readFrontmatterField(planText, 'work_kind'))
  } catch (error) {
    findings.push({
      code: 'work-kind-invalid',
      path: `${planRel}:frontmatter.work_kind`,
      detail: `${(error as Error).message}; \`flow plan set-kind\` rewrites it`,
    })
  }
  const deltas = readPlanDeltas(planText)
  const anchors = regressionAnchors(deltas)
  const set = requirementSet(kind, anchors)
  findings.push(...kindDeltaMismatches(root, planRel, kind, deltas))

  // 1. spec.md（regression 不要求，但有就照查待釐清標記）
  const specRel = `${PLAN_ROOT}/${workId}/spec.md`
  const specFile = join(planDirOf(root, workId), 'spec.md')
  if (!existsSync(specFile)) {
    if (set === 'full') {
      findings.push({
        code: 'spec-missing',
        path: specRel,
        detail:
          'the package has no spec.md; the implementer has no bounded requirement to build to',
      })
    }
  } else {
    for (const hit of unresolvedClarifications(readFileSync(specFile, 'utf8'))) {
      findings.push({
        code: 'spec-unresolved-clarification',
        path: `${specRel}:${hit.line}`,
        detail: `unresolved ${CLARIFICATION_MARKER}: ${hit.detail}`,
      })
    }
  }

  // 2. full：features/acceptance/**；regression：迴歸錨點代替 plan acceptance 定義「要驗什麼」
  const usableAnchors = anchors.filter((a) => a.action === 'NOOP' || a.state === 'applied')
  if (set === 'full') {
    const featuresRel = `${PLAN_ROOT}/${workId}/features/acceptance`
    const featuresDir = join(planDirOf(root, workId), 'features', 'acceptance')
    const featureFiles = walkFiles(featuresDir, (n) => n.endsWith('.feature'))
    if (featureFiles.length === 0) {
      findings.push({
        code: 'acceptance-features-missing',
        path: `${featuresRel}/**/*.feature`,
        detail: 'no acceptance feature file; "done" has no observable definition',
      })
    } else {
      const scenarios = featureFiles.flatMap((file) =>
        parseFeatureScenarios(
          readFileSync(file, 'utf8'),
          toPosix(relative(planDirOf(root, workId), file)),
        ),
      )
      if (scenarios.length === 0) {
        findings.push({
          code: 'acceptance-no-scenarios',
          path: `${featuresRel}/**/*.feature`,
          detail: `${featureFiles.length} feature file(s) declare zero scenarios; a zero-scenario run NEVER counts as acceptance`,
        })
      }
    }
  } else if (usableAnchors.length === 0) {
    findings.push({
      code: 'regression-anchor-missing',
      path: `${planRel}#Truth delta`,
      detail: `${kind ?? 'this'} work needs at least one regression anchor: a delta row \`specs/truth/features/<path>.feature -> Scenario: <title>\` that is NOOP, or ADD and applied${
        anchors.length ? ` (${anchors.map((a) => a.deltaId).join(', ')} still proposed)` : ''
      }`,
    })
  }

  // 3. acceptance_command
  const acceptanceCommand = readFrontmatterField(planText, 'acceptance_command')
  if (!acceptanceCommand) {
    findings.push({
      code: 'acceptance-command-missing',
      path: `${planRel}:frontmatter.acceptance_command`,
      detail:
        'add `acceptance_command: <shell command>` to the plan frontmatter — the runnable entry that ' +
        "executes this package's acceptance scenarios; readiness appends `--dry-run --format json:<tmp>` to it",
    })
  }

  // 4. truth baseline 新鮮度
  const baseline = readFrontmatterField(planText, 'truth_baseline')
  if (!baseline) {
    findings.push({
      code: 'truth-baseline-missing',
      path: `${planRel}:frontmatter.truth_baseline`,
      detail: `plan records no truth baseline; it cannot tell whether ${TRUTH_ROOT} moved under it`,
    })
  } else {
    const current = hashTruth(root)
    if (current !== baseline) {
      findings.push({
        code: 'truth-baseline-stale',
        path: `${planRel}:frontmatter.truth_baseline`,
        detail: `truth moved (${baseline.slice(0, 8)} → ${current.slice(0, 8)}); re-check the plan against current truth, then \`flow plan apply-delta --recheck\` or rewrite the baseline`,
      })
    }
  }

  // 5. DSL 解析度（真的跑一次）；regression 另外要求每一個錨點都在這次 run 裡
  if (acceptanceCommand && opts.runAcceptance !== false) {
    const dry = runAcceptanceDryRun({ root, command: acceptanceCommand, timeoutMs: opts.timeoutMs })
    if (!dry.ok) {
      findings.push({
        code: 'acceptance-command-failed',
        path: `${planRel}:frontmatter.acceptance_command`,
        detail: `\`${acceptanceCommand}\`: ${dry.error}`,
      })
    } else {
      if (dry.scenarios === 0) {
        findings.push({
          code: 'acceptance-report-empty',
          path: `${planRel}:frontmatter.acceptance_command`,
          detail: `\`${acceptanceCommand}\` resolved zero scenarios; an empty run NEVER counts as acceptance`,
        })
      }
      for (const step of dry.unresolved) {
        findings.push({
          code:
            step.status === 'ambiguous' ? 'acceptance-step-ambiguous' : 'acceptance-step-undefined',
          path: `${step.uri}:${step.line}`,
          detail: `${step.status} step in "${step.scenario}": ${step.keyword}${step.name}`,
        })
      }
      if (set === 'regression') {
        for (const anchor of usableAnchors) {
          if (dry.ran.some((r) => r.uri === anchor.feature && r.title === anchor.title)) continue
          findings.push({
            code: 'regression-anchor-not-in-run',
            path: anchor.feature,
            detail: `${anchor.deltaId}: scenario "${anchor.title}" is not in the \`${acceptanceCommand}\` run; the acceptance command MUST execute every regression anchor`,
          })
        }
      }
    }
  }

  // 6. lifecycle 落點（上游 owner 原文的 NNN／truth-delta.md／覆寫 plan.md 在這裡被機械擋下）
  findings.push(...checkLifecycleLayout(root, workId))

  return {
    workId,
    plan: planRel,
    ready: findings.length === 0,
    acceptanceCommand,
    work_kind: kind,
    requirement_set: set,
    findings,
  }
}

const TRUTH_BEHAVIOR_PREFIXES = [
  TRUTH_FEATURES_PREFIX,
  `${TRUTH_ROOT}/contracts/`,
  `${TRUTH_ROOT}/data/`,
]
const DSL_FILE_RE = /(^|\/)dsl\.(md|yml)$/u

/**
 * 宣告的工作種類與 delta 形狀一致嗎（FR-010）。不一致就是判錯了種類——要改判，不是改 delta 湊形狀。
 *
 * - `bug-covered`：沒有 MODIFY／DELETE；ADD 只落在已存在的 truth `.feature`；不碰 DSL（要新句型＝原本沒有 scenario）
 * - `refactor`：truth features／contracts／data 沒有 MODIFY／DELETE（行為要變就是 behavior）
 * - `bug-uncovered`：至少一列 ADD 到 truth features（正確行為要寫進 truth）
 * - `behavior`、未宣告：不限制
 */
function kindDeltaMismatches(
  root: string,
  planRel: string,
  kind: WorkKind | null,
  deltas: readonly TruthDelta[],
): GateFinding[] {
  if (kind === null || kind === 'behavior') return []
  const live = deltas.filter((d) => d.state !== 'withdrawn')
  const out: GateFinding[] = []
  const mismatch = (detail: string, suggest: WorkKind) =>
    out.push({
      code: 'kind-delta-mismatch',
      path: `${planRel}#Truth delta`,
      detail: `${detail}; re-judge with \`flow plan set-kind ${planRel.split('/').at(-2)} --to ${suggest} --reason <why>\``,
    })
  if (kind === 'bug-covered') {
    for (const d of live) {
      const [path] = splitDeltaUnit(d.unit)
      if (d.action === 'MODIFY' || d.action === 'DELETE') {
        mismatch(
          `${d.id} ${d.action}s truth (${path}); a bug with an existing scenario only adds a regression anchor`,
          'behavior',
        )
      } else if (d.action === 'ADD' && DSL_FILE_RE.test(path)) {
        mismatch(
          `${d.id} adds a DSL sentence (${path}); needing a new sentence means the behavior had no scenario`,
          'bug-uncovered',
        )
      } else if (
        d.action === 'ADD' &&
        !(
          path.startsWith(TRUTH_FEATURES_PREFIX) &&
          path.endsWith('.feature') &&
          existsSync(join(root, path))
        )
      ) {
        mismatch(
          `${d.id} adds ${path}, which is not an existing truth feature; a bug with an existing scenario lands its regression in the feature that already covers it`,
          'bug-uncovered',
        )
      }
    }
  } else if (kind === 'refactor') {
    for (const d of live) {
      const [path] = splitDeltaUnit(d.unit)
      if (
        (d.action === 'MODIFY' || d.action === 'DELETE') &&
        TRUTH_BEHAVIOR_PREFIXES.some((p) => path.startsWith(p))
      ) {
        mismatch(
          `${d.id} ${d.action}s behavior truth (${path}); a refactor keeps behavior unchanged — if the behavior changes, it is behavior work`,
          'behavior',
        )
      }
    }
  } else if (kind === 'bug-uncovered') {
    // 只認 `.feature`：只加 dsl.md／dsl.yml 的句型不算把正確行為寫進 truth。
    const adds = live.some((d) => {
      const path = splitDeltaUnit(d.unit)[0]
      return (
        d.action === 'ADD' && path.startsWith(TRUTH_FEATURES_PREFIX) && path.endsWith('.feature')
      )
    })
    if (!adds) {
      mismatch(
        'no ADD row to a specs/truth/features/**/*.feature; a bug without a scenario MUST write the correct behavior into truth',
        'bug-covered',
      )
    }
  }
  return out
}

// ── Dispatch gate ──────────────────────────────────────────────────────────

/**
 * brief 第一段有沒有宣告 `stage: implement`。
 *
 * 只看第一段（到第一個空行為止，frontmatter 的 `---` 不算段落邊界）：宣告是**開頭就要看得見的
 * 契約**，埋在第 400 行的一句話對讀 brief 的人與對 gate 都不成立。
 */
export function declaresImplementationStage(brief: string): boolean {
  const text = brief.replace(/^﻿/u, '')
  const body = text.startsWith('---\n')
    ? text.slice(4, text.indexOf('\n---', 3) === -1 ? undefined : text.indexOf('\n---', 3))
    : text
  const first = body.replace(/^\s*\n+/u, '').split(/\n\s*\n/u)[0] ?? ''
  return /^\s*stage:\s*implement\s*$/mu.test(first)
}

/**
 * dispatch 入口的 admission：只有「這是一個 lifecycle plan 的實作派工」才受檢。
 *
 * 沒有宣告的 dispatch 行為**完全不變**——gate 的價值在它擋下該擋的那一次，不在它把每一次派工都
 * 變慢。`gated:false` 的每一條分支都要說得出理由，否則 gate 失效與 gate 沒裝事後不可區分。
 */
export function checkDispatchGate(opts: {
  root: string
  workId?: string | null
  briefText?: string | null
  briefPath?: string | null
  implementation?: boolean
  env?: NodeJS.ProcessEnv
  runAcceptance?: boolean
}): DispatchGateResult {
  const env = opts.env ?? process.env
  const workId = (opts.workId ?? env.CLADE_WORK_ID ?? '').trim()
  const none = (reason: string): DispatchGateResult => ({
    gated: false,
    reason,
    workId: workId || null,
    ready: true,
    findings: [],
  })
  if (!workId) return none('no work id on this dispatch')
  if (!isLifecyclePlan(opts.root, workId)) return none(`${workId} has no lifecycle plan package`)
  let declared = opts.implementation === true
  if (!declared) {
    let brief = opts.briefText ?? null
    if (brief === null && opts.briefPath && existsSync(opts.briefPath)) {
      brief = readFileSync(opts.briefPath, 'utf8')
    }
    declared = brief !== null && declaresImplementationStage(brief)
  }
  if (!declared) return none('brief does not declare `stage: implement`')
  const readiness = checkReadiness(opts.root, workId, { runAcceptance: opts.runAcceptance })
  return {
    gated: true,
    reason: `implementation dispatch against ${workId}`,
    workId,
    ready: readiness.ready,
    workKind: readiness.work_kind,
    findings: readiness.findings,
  }
}

/**
 * 入口共用的拒絕文字。每行一條 finding，`code` 在最前面——讀的人與 grep 的人看同一個東西。
 * 標題帶工作種類：同一條 finding 在不同種類下的修法不同（補 spec，還是改判）。
 */
export function formatGateRefusal(
  workId: string,
  findings: GateFinding[],
  workKind?: WorkKind | null,
): string {
  const kindLabel = workKind === undefined ? '' : ` [work_kind: ${workKind ?? 'null'}]`
  const head = `dispatch refused: ${workId}${kindLabel} is not specification-ready (${findings.length} finding${
    findings.length === 1 ? '' : 's'
  })`
  const lines = findings.map((f) => `  [${f.code}] ${f.path}\n      ${f.detail}`)
  return [
    head,
    ...lines,
    '  fix the package (or drop `stage: implement`), then re-run; nothing was dispatched and no ledger row was written.',
  ].join('\n')
}

// ── Close acceptance gate ──────────────────────────────────────────────────

export function hasAcceptanceFeatures(root: string, workId: string): boolean {
  return (
    walkFiles(join(planDirOf(root, workId), 'features', 'acceptance'), (n) =>
      n.endsWith('.feature'),
    ).length > 0
  )
}

/**
 * B7：package 有 acceptance feature 時，close 要求每一條場景都有**新鮮**的判決。
 *
 * 非 `@human` 要機器 `passed`，`@human` 要人判 `pass` receipt。新鮮度用 acceptance-verdicts 已經
 * 算好的 `fresh`——舊證據 NEVER 讓新版通過，而「上一版跑綠了」與「這一版跑綠了」在沒有新鮮度那
 * 一格時長得一模一樣。
 */
export function checkAcceptanceClose(
  root: string,
  workId: string,
  read: typeof readAcceptanceVerdicts = readAcceptanceVerdicts,
): GateFinding[] {
  // close 的 lifecycle 落點檢查掛在這裡：plan-lifecycle close 走 superseded／cancelled 以外的每一份都會呼叫本函式。
  const findings: GateFinding[] = checkLifecycleLayout(root, workId)
  if (!hasAcceptanceFeatures(root, workId)) return findings
  const planRel = `${PLAN_ROOT}/${workId}`
  const acceptance = read(root, planRel)
  for (const scenario of acceptance.scenarios) {
    if (scenario.human) {
      if (!scenario.human_verdict) {
        findings.push({
          code: 'acceptance-human-receipt-missing',
          path: `${planRel}/${scenario.feature}`,
          detail: `@human scenario "${scenario.title}" has no receipt; \`flow receipt\` records the human verdict`,
        })
        continue
      }
      if (scenario.human_verdict.verdict !== 'pass') {
        findings.push({
          code: 'acceptance-human-receipt-not-pass',
          path: `${planRel}/${scenario.feature}`,
          detail: `@human scenario "${scenario.title}" last receipt is ${scenario.human_verdict.verdict}`,
        })
        continue
      }
      if (scenario.fresh !== true) {
        findings.push({
          code: 'acceptance-human-receipt-stale',
          path: `${planRel}/${scenario.feature}`,
          detail: `@human scenario "${scenario.title}" receipt (${scenario.human_verdict.at}) predates the plan revision (${acceptance.plan_revised_at ?? 'unknown'})`,
        })
      }
      continue
    }
    if (!scenario.machine) {
      findings.push({
        code: 'acceptance-verdict-missing',
        path: `${planRel}/${scenario.feature}`,
        detail: `scenario "${scenario.title}" has no machine verdict; run the acceptance command and keep its cucumber JSON under ${planRel}/evidence/`,
      })
      continue
    }
    if (scenario.machine.verdict !== 'passed') {
      findings.push({
        code: 'acceptance-verdict-not-passed',
        path: `${planRel}/${scenario.feature}`,
        detail: `scenario "${scenario.title}" is ${scenario.machine.verdict} in ${scenario.machine.report}`,
      })
      continue
    }
    if (scenario.fresh !== true) {
      findings.push({
        code: 'acceptance-verdict-stale',
        path: `${planRel}/${scenario.feature}`,
        detail: `scenario "${scenario.title}" passed at ${scenario.machine.at}, before the plan revision (${acceptance.plan_revised_at ?? 'unknown'}); re-run it`,
      })
    }
  }
  return findings
}

// ── Regression anchor close gate ───────────────────────────────────────────

/**
 * 迴歸錨點的結案條件（FR-015–018）：每一個錨點（NOOP，或已 applied 的 ADD）都要在 plan `evidence/`
 * 有 passed 判決，晚於 plan 最後修訂與該 truth feature 最後一次修改兩者較晚者；而且同一條 scenario
 * 先有 failed、後有 passed——沒紅過的綠燈證明不了它擋得住這個 bug。修 bug 與重構至少要有一個錨點。
 *
 * 先紅後綠不適用 `refactor`：重構的錨點釘住的是**不變**的行為，按定義不會紅。
 * 判決以 report 的 repo-relative uri ＋ 標題為鍵（FR-017），同檔名不同目錄的 feature 不互相冒用。
 */
export function checkRegressionAnchorsClose(
  root: string,
  workId: string,
  kind: WorkKind | null,
  anchors: readonly RegressionAnchor[],
): GateFinding[] {
  const planRel = `${PLAN_ROOT}/${workId}`
  const findings: GateFinding[] = []
  if (anchors.length === 0) {
    if (kind !== null && ANCHOR_REQUIRED_KINDS.has(kind)) {
      findings.push({
        code: 'regression-anchor-missing',
        path: `${planRel}/plan.md#Truth delta`,
        detail: `${kind} work closes only with a regression anchor: a delta row \`specs/truth/features/<path>.feature -> Scenario: <title>\` (ADD or NOOP)`,
      })
    }
    return findings
  }
  const checked = anchors.filter((a) => a.action === 'NOOP' || a.state === 'applied')
  if (checked.length === 0) return findings
  const { verdicts } = readEvidenceVerdicts(root, planRel)
  const planRevised = planRevisedAt(root, planRel)
  const planRevisedMs = planRevised ? Date.parse(planRevised) : 0
  for (const anchor of checked) {
    const history = verdicts
      .filter((v) => v.uri === anchor.feature && v.title === anchor.title)
      .toSorted((a, b) => a.atMs - b.atMs)
    const label = `${anchor.deltaId}: scenario "${anchor.title}"`
    const latest = history.at(-1)
    if (!latest) {
      findings.push({
        code: 'truth-scenario-verdict-missing',
        path: anchor.feature,
        detail: `${label} has no verdict; run it and keep the cucumber JSON under ${planRel}/evidence/`,
      })
      continue
    }
    if (latest.verdict !== 'passed') {
      findings.push({
        code: 'truth-scenario-verdict-not-passed',
        path: anchor.feature,
        detail: `${label} is ${latest.verdict} in ${latest.report}`,
      })
      continue
    }
    const featureRevisedMs = fileRevisedAtMs(root, anchor.feature) ?? 0
    const threshold = Math.max(planRevisedMs, featureRevisedMs)
    if (latest.atMs < threshold) {
      findings.push({
        code: 'truth-scenario-verdict-stale',
        path: anchor.feature,
        detail: `${label} passed at ${latest.at}, before ${
          featureRevisedMs >= planRevisedMs
            ? `the last change to ${anchor.feature}`
            : 'the plan revision'
        } (${new Date(threshold).toISOString()}); re-run it`,
      })
      continue
    }
    if (
      kind !== 'refactor' &&
      !history.some((v) => v.verdict === 'failed' && v.atMs < latest.atMs)
    ) {
      findings.push({
        code: 'regression-anchor-never-red',
        path: anchor.feature,
        detail: `${label} has no failed verdict before its pass; keep the red run's cucumber JSON under ${planRel}/evidence/ — a scenario that never failed has not shown it catches the bug`,
      })
    }
  }
  return findings
}

// ── Scope / spec integrity ─────────────────────────────────────────────────

interface IntegritySurface {
  code: string
  matches: (rel: string) => boolean
  label: string
}

function seededContractPath(root: string, workId: string, since: string): string | null {
  const planRel = `${PLAN_ROOT}/${workId}/plan.md`
  const baseline = gitLines(root, ['show', `${since}:${planRel}`]).join('\n')
  const current = existsSync(join(root, planRel)) ? readFileSync(join(root, planRel), 'utf8') : ''
  const contractLine =
    /^- Contract: 範圍與驗收以 `(?<path>docs\/contract\/r[1-9]\d*\/presale\.json)`/mu
  return (
    contractLine.exec(baseline)?.groups?.path ?? contractLine.exec(current)?.groups?.path ?? null
  )
}

function integritySurfaces(workId: string, contractPath: string | null): IntegritySurface[] {
  const pkg = `${PLAN_ROOT}/${workId}`
  return [
    ...(contractPath
      ? [
          {
            code: 'presale-contract-modified',
            label: 'signed presale contract',
            matches: (rel: string) =>
              rel.startsWith(`${contractPath.slice(0, contractPath.lastIndexOf('/'))}/`),
          },
        ]
      : []),
    {
      code: 'acceptance-modified',
      label: 'acceptance criteria',
      matches: (rel) => rel.startsWith(`${pkg}/features/acceptance/`),
    },
    {
      code: 'spec-modified',
      label: 'specification',
      matches: (rel) => rel === `${pkg}/spec.md`,
    },
    {
      code: 'truth-features-modified',
      label: 'truth features',
      matches: (rel) => rel.startsWith(`${TRUTH_ROOT}/features/`),
    },
  ]
}

function gitLines(root: string, args: string[]): string[] {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((l) => l.replace(/\r$/u, ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * B6：實作者不得改動自己要被驗收的那份契約。
 *
 * 與 `scripts/scope-verify.ts` **互補不重疊**：那一支問「改動有沒有落在宣告的 scope 外」，這一支
 * 問「這三個面有沒有動過」——即使實作者的 scope 合法地涵蓋整個 package，改掉驗收條件仍然是把考卷
 * 改成自己的答案。committed 與未提交兩邊都看：沒 commit 的改動照樣會被當成交付內容讀走。
 */
export function checkSpecIntegrity(root: string, workId: string, since: string): IntegrityResult {
  const contractPath = seededContractPath(root, workId, since)
  const surfaces = integritySurfaces(workId, contractPath)
  const committed = gitLines(root, [
    'diff',
    '--name-only',
    ...(contractPath ? ['--no-renames'] : []),
    `${since}..HEAD`,
    '--',
  ])
  const worktree = gitLines(root, [
    'status',
    '--porcelain',
    ...(contractPath ? ['--no-renames', '--untracked-files=all'] : []),
  ])
    // porcelain 的前兩欄是狀態碼、第三欄是空白。**NEVER** 先 trim 整行再 slice(3)——
    // ` M path` 被 trim 成 `M path` 之後，slice(3) 吃掉的是路徑的第一個字元。
    .map((line) => line.slice(3).trim())
    .map((p) => (p.includes(' -> ') ? p.split(' -> ')[1]!.trim() : p))
  const seen = new Map<string, string>()
  for (const rel of committed) seen.set(rel, `committed in ${since}..HEAD`)
  for (const rel of worktree) {
    seen.set(
      rel,
      seen.has(rel) ? `${seen.get(rel)} and uncommitted` : 'uncommitted in the worktree',
    )
  }
  const findings: GateFinding[] = []
  for (const [rel, how] of [...seen.entries()].toSorted((a, b) => a[0].localeCompare(b[0]))) {
    const surface = surfaces.find((s) => s.matches(rel))
    if (!surface) continue
    const contractScope =
      contractPath !== null &&
      (surface.code === 'presale-contract-modified' ||
        surface.code === 'spec-modified' ||
        (surface.code === 'acceptance-modified' &&
          /^contract-[^/]+\.feature$/u.test(rel.slice(rel.lastIndexOf('/') + 1))))
    findings.push({
      code: surface.code,
      path: rel,
      detail: contractScope
        ? `${surface.label} changed (${how}); contract scope changes require presale revise, not edits to the signed baseline or seeded acceptance`
        : `${surface.label} changed (${how}); the implementer may not weaken what it is measured against`,
    })
  }
  return { workId, since, ok: findings.length === 0, findings }
}
