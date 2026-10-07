// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/acceptance-verdicts.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/acceptance-verdicts.ts
// clade flow acceptance verdicts — plan 驗收場景 × 最新 verdict × 新鮮度
// （W-2026-09-16-control-panel-redesign tasks 0.4、system-analysis §5）
//
// 一個 plan 的 `features/acceptance/**/*.feature` 是「做完長什麼樣」的唯一來源；跑出來的結果住在
// 兩種地方：機器跑的 cucumber JSON report（SpecFormula／cucumber-js `--format json:`、
// playwright-bdd 的 cucumber reporter 同格式），與人判的 evidence receipt（sidecar jsonl）。
// 這支把三者 join 成「每個 scenario 現在是什麼狀態、那個狀態還算不算數」。
//
// 新鮮度是這裡最重要的一格：**舊證據 NEVER 讓新版通過**。verdict 時間早於 plan 最後修訂
// 時間的，`fresh` 是 false——它證明的是上一版 plan。
//
// 身分只用既有的：scenario id = `<plan path>#<feature path>:<scenario title>`（system-analysis §5），
// receipt 用它自帶的 `receipt_id`。本檔不鑄任何新 id。
//
// READ-ONLY（含底部 CLI）。寫 receipt 在 `receipts.ts`（`flow receipt`），不在這裡。

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export type MachineVerdict = 'passed' | 'failed' | 'pending' | 'skipped'
export type HumanVerdict = 'pass' | 'fail' | 'skip'

/** 讀 report／sidecar 的慣例位置，相對於 plan 目錄。runner 要讓結果被看見，就寫到這裡。 */
export const EVIDENCE_DIR = 'evidence'
/** 人判與截圖 receipt 的 sidecar，一行一個 JSON（append-only，同 scenario 後寫者贏）。 */
export const RECEIPTS_FILE = 'receipts.jsonl'

export interface ScenarioDef {
  /** 相對於 plan 目錄，POSIX 分隔。 */
  feature: string
  title: string
  /** 含 Feature／Rule 層繼承下來的 tag，例 `@human`。 */
  tags: string[]
}

export interface ReportResult {
  /** report 自己記的 feature uri（原樣）；比對前經 `normalizeReportUri` 轉成 repo-relative。 */
  uri: string
  title: string
  verdict: MachineVerdict
}

export interface Receipt {
  receipt_id: string
  feature: string
  scenario: string
  kind: string
  verdict: HumanVerdict | null
  at: string
  by: string | null
  note: string | null
  screenshot: string | null
  url: string | null
}

export interface ScenarioVerdict {
  id: string
  plan: string
  feature: string
  title: string
  tags: string[]
  /** `@human`：這一條要人眼判，機器綠燈不算數。 */
  human: boolean
  machine: { verdict: MachineVerdict; at: string; report: string } | null
  human_verdict: {
    verdict: HumanVerdict
    at: string
    by: string | null
    note: string | null
    receipt_id: string
  } | null
  /** 這一條可打開的證據（截圖、URL），來自 receipt，時間序。 */
  evidence: string[]
  /**
   * 這一條的全部 receipt（時間序，去掉 feature／scenario 兩欄——它們就是本列）。證據頁的截圖放大 modal
   * 要「這張截圖是哪一筆 receipt、何時」，`evidence` 只剩路徑答不出來。
   */
  receipts: Omit<Receipt, 'feature' | 'scenario'>[]
  /** 最新一筆帶截圖／URL 的 receipt 時間；沒有證據 receipt 時 null。 */
  evidence_at: string | null
  /**
   * 證據本身是否晚於 plan 修訂——「證據齊」的那一格（attention-queue.feature 場景 5）。
   * null = 判不出：沒有任何證據 receipt，或 `plan_revised_at` 拿不到。與 `fresh` 分開：`fresh` 問的是
   * **判決**新不新，這一格問的是**被判的東西**新不新；舊截圖 NEVER 拿來請人判新版畫面。
   */
  evidence_fresh: boolean | null
  /** 最新 verdict（人判優先，否則機器）是否晚於 plan 修訂；沒有任何 verdict 時 null——「沒跑過」不是「過期」。 */
  fresh: boolean | null
}

export interface PlanAcceptance {
  /** repo-relative plan 目錄。 */
  plan: string
  /** ISO；讀不到修訂時間（非 git、目錄空）為 null，此時所有 `fresh` 為 null。 */
  plan_revised_at: string | null
  scenarios: ScenarioVerdict[]
  reports: { path: string; results: number; read_error: string | null }[]
  receipts: { path: string; rows: number; read_error: string | null } | null
}

const SCENARIO_KEYWORD =
  /^\s*(Scenario Outline|Scenario Template|Scenario|Example|場景|劇本|案例)\s*:\s*(.*)$/u
const FEATURE_KEYWORD = /^\s*(Feature|功能|Rule|規則)\s*:/u

/**
 * 從 .feature 原文抽出 scenario 標題與 tag。刻意只認結構行，不做完整 Gherkin 解析：
 * 驗收只需要「有哪幾條、各自帶什麼 tag」，而一支完整 parser 是 SpecFormula 那一側的依賴。
 *
 * tag 繼承：Feature 行上方的 tag 套到全檔；Rule 行上方的 tag 套到該 Rule 底下直到下一個 Rule。
 */
export function parseFeatureScenarios(text: string, feature: string): ScenarioDef[] {
  const out: ScenarioDef[] = []
  let pending: string[] = []
  let featureTags: string[] = []
  let ruleTags: string[] = []
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line.startsWith('#') || line === '') continue
    if (line.startsWith('@')) {
      pending.push(...line.split(/\s+/u).filter((t) => t.startsWith('@')))
      continue
    }
    const header = FEATURE_KEYWORD.exec(line)
    if (header) {
      if (/^(Feature|功能)$/u.test(header[1]!)) {
        featureTags = pending
        ruleTags = []
      } else {
        ruleTags = pending
      }
      pending = []
      continue
    }
    const scenario = SCENARIO_KEYWORD.exec(line)
    if (scenario) {
      out.push({
        feature,
        title: scenario[2]!.trim(),
        tags: [...new Set([...featureTags, ...ruleTags, ...pending])],
      })
      pending = []
      continue
    }
    // tag 只黏在緊接的下一個結構行上；中間夾了步驟或描述就作廢。
    pending = []
  }
  return out
}

function stepVerdict(statuses: string[]): MachineVerdict {
  if (statuses.some((s) => s === 'failed' || s === 'ambiguous')) return 'failed'
  if (statuses.some((s) => s === 'undefined' || s === 'pending')) return 'pending'
  if (statuses.length > 0 && statuses.every((s) => s === 'passed')) return 'passed'
  return 'skipped'
}

const WORSE: Record<MachineVerdict, number> = { failed: 3, pending: 2, skipped: 1, passed: 0 }

/**
 * cucumber JSON（legacy formatter 格式）→ 每個 scenario 一筆。Outline 展開成多個 element，
 * 同名合併取最差：一列失敗的 example 就是這個 scenario 沒過。
 *
 * 格式不符回空陣列並由呼叫端記 `read_error`——NEVER 丟例外讓整個 plan 讀不到。
 */
export function parseCucumberJson(json: unknown): ReportResult[] {
  if (!Array.isArray(json)) throw new Error('cucumber JSON MUST 是 feature 陣列')
  const merged = new Map<string, ReportResult>()
  for (const feature of json as Record<string, unknown>[]) {
    const uri = typeof feature?.uri === 'string' ? feature.uri : ''
    const elements = Array.isArray(feature?.elements) ? feature.elements : []
    for (const element of elements as Record<string, unknown>[]) {
      if (element?.type === 'background') continue
      const title = typeof element?.name === 'string' ? element.name.trim() : ''
      const steps = Array.isArray(element?.steps) ? element.steps : []
      const statuses = (steps as Record<string, unknown>[])
        .filter((step) => !step?.hidden)
        .map((step) => String((step?.result as Record<string, unknown>)?.status ?? 'skipped'))
      const verdict = stepVerdict(statuses)
      const key = `${uri}|${title}`
      const held = merged.get(key)
      if (!held || WORSE[verdict] > WORSE[held.verdict]) merged.set(key, { uri, title, verdict })
    }
  }
  return [...merged.values()]
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/** sidecar 一行 → Receipt；缺 feature／scenario／at 的行丟掉（它對不到任何一條）。 */
export function parseReceiptLine(line: string): Receipt | null {
  let row: Record<string, unknown>
  try {
    row = JSON.parse(line)
  } catch {
    return null
  }
  const feature = str(row.feature)
  const scenario = str(row.scenario)
  const at = str(row.at)
  if (!feature || !scenario || !at || !Number.isFinite(Date.parse(at))) return null
  const verdict = str(row.verdict)
  return {
    receipt_id: str(row.receipt_id) ?? `${feature}:${scenario}@${at}`,
    feature,
    scenario,
    kind: str(row.kind) ?? (verdict ? 'human-verdict' : 'evidence'),
    verdict: verdict === 'pass' || verdict === 'fail' || verdict === 'skip' ? verdict : null,
    at,
    by: str(row.by),
    note: str(row.note),
    screenshot: str(row.screenshot),
    url: str(row.url),
  }
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

function walk(dir: string, accept: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, accept))
    else if (accept(entry.name)) out.push(full)
  }
  return out.toSorted()
}

function basenameOf(path: string): string {
  return path.split(/[\\/]/u).pop() ?? path
}

/** report 的 feature uri → repo-relative POSIX 路徑（cucumber 從 repo 根跑時本來就是）。 */
export function normalizeReportUri(repoRoot: string, uri: string): string {
  let out = uri.startsWith('file://') ? uri.slice('file://'.length) : uri
  if (isAbsolute(out)) out = relative(repoRoot, out)
  out = toPosix(out)
  while (out.startsWith('./')) out = out.slice(2)
  return out
}

/**
 * report 的 uri 是不是指這一支 plan feature（FR-017：以相對路徑為鍵）。
 *
 * 認三種寫法：repo-relative、plan-relative（runner 從 plan 目錄跑）、以及從更深的 cwd 跑出來的
 * 路徑尾段（`/` 對齊，所以目錄也要對上）。只剩檔名（沒有任何 `/`）的 uri 退回檔名比對——那種
 * report 本來就分不出目錄。**NEVER** 只比檔名：不同目錄的同名 feature 會互相冒用判決。
 */
export function reportUriMatches(uri: string, planRel: string, feature: string): boolean {
  if (!uri) return false
  const full = `${planRel}/${feature}`
  if (uri === full || uri === feature) return true
  if (!uri.includes('/')) return basenameOf(full) === uri
  return full.endsWith(`/${uri}`)
}

const SOURCE_WORK_RE = /^#\s*來源\s*[:：]\s*work\s+(W-\S+)/u

/**
 * truth feature 裡每條 scenario 的來源 work（`# 來源：work <work-id>`，寫在 scenario 上方的註解）。
 *
 * 這是 truth scenario 替 plan acceptance scenario 作證的唯一對應：同一個 work、同一個標題。
 * 來源註解 **NEVER** 寫 plan 路徑——plan 結案時 truth 裡的 `specs/plans/<id>` 會被 live-refs 擋下。
 */
export function parseSourceWorks(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  let pending: string[] = []
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('@')) continue
    if (line.startsWith('#')) {
      const m = SOURCE_WORK_RE.exec(line)
      if (m) pending.push(m[1]!)
      continue
    }
    const scenario = SCENARIO_KEYWORD.exec(line)
    if (scenario && pending.length) {
      const title = scenario[2]!.trim()
      const set = out.get(title) ?? new Set<string>()
      for (const id of pending) set.add(id)
      out.set(title, set)
    }
    pending = []
  }
  return out
}

/** evidence report 裡的一筆判決（一個 scenario 在一份 report 裡的結果）。 */
export interface EvidenceVerdict {
  /** repo-relative feature 路徑。 */
  uri: string
  title: string
  verdict: MachineVerdict
  at: string
  /**
   * 這筆判決的時間（ms，含小數）：比先後用它，`at` 只到毫秒。來源依序是 report 內容的
   * `start_timestamp`（真的 run 時間）→ 乾淨追蹤檔的 git 最後 commit 時間（只到秒，且是 run 時間的
   * 上界，所以再扣 1 秒，見 `reportRevisedMs`）→ mtime；同刻且全部檔名都帶 red／green 時再加
   * 序號偏移（< 1ms）。三種時鐘混在同一條軸上，只有同來源的比較才精確。
   * `verdicts` 也可能含合成的 `pending` indeterminate 列，其 `report` 是原因說明而不是路徑。
   */
  atMs: number
  report: string
  /** 檔名的 red／green 序號（0／1），沒有為 null；只在同刻平手時有意義。 */
  stage?: number | null
}

/** report 內容自己帶的 run 時間（cucumber messages 系列的 `start_timestamp`，feature／element 層皆認）。 */
function reportRunMs(json: unknown): number | null {
  let best: number | null = null
  const see = (value: unknown): void => {
    if (typeof value !== 'string') return
    const ms = Date.parse(value)
    if (Number.isFinite(ms) && (best === null || ms > best)) best = ms
  }
  if (!Array.isArray(json)) return null
  for (const feature of json as Record<string, unknown>[]) {
    see(feature?.start_timestamp)
    const elements = Array.isArray(feature?.elements) ? feature.elements : []
    for (const element of elements as Record<string, unknown>[]) see(element?.start_timestamp)
  }
  return best
}

/** commit 時間（秒精度、run 時間的上界）換成 run 時間估計時扣掉的量。 */
const COMMIT_TIME_SKEW_MS = 1000

/**
 * 一份 report 檔的 run 時間，依序：內容帶的 run 時間 → git 最後 commit 時間（檔已追蹤且工作樹乾淨）
 * → mtime。**NEVER** 一律用 mtime：checkout／clone 之後同一 commit 的檔 mtime 全相同，
 * 先紅後綠的先後會被抹平。
 *
 * commit 時間不是 run 時間：它只到秒，且是 run 時間的上界。證據與 plan／feature 修訂放在同一個
 * commit 時兩者 commit 時間相同，`>=` 的新鮮度比較會把那份可能更舊的證據算成新，所以 commit 來源
 * 扣 1 秒——與修訂同 commit 的證據算舊，之後另一個 commit 補上的證據才算新。
 */
function reportRevisedMs(repoRoot: string, file: string, content: number | null): number {
  if (content !== null) return content
  const mtime = statSync(file).mtimeMs
  const rel = toPosix(relative(repoRoot, file))
  try {
    const dirty = execFileSync('git', ['status', '--porcelain', '--', rel], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (dirty) return mtime
    const ct = execFileSync('git', ['log', '-1', '--format=%ct', '--', rel], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return ct ? Number(ct) * 1000 - COMMIT_TIME_SKEW_MS : mtime
  } catch {
    return mtime
  }
}

/**
 * 檔名裡的明確序號：`red` 先於 `green`（先紅後綠是 plan 驗收的既定慣例命名）。
 * 只用來拆「時間完全相同」的平手；沒有這種字眼回 null。
 */
function stageRank(path: string): number | null {
  const tokens = basenameOf(path)
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
  if (tokens.includes('red')) return 0
  if (tokens.includes('green')) return 1
  return null
}

/**
 * plan `evidence/` 底下每一份 cucumber JSON 的每一筆結果，不合併、不挑最新——
 * 先紅後綠要看歷史，最新判決由呼叫端自己挑。
 *
 * 先後依 report 的 run 時間（見 `reportRevisedMs`）；時間相同、且平手的每一份 report 檔名都帶
 * red／green 序號時，再看序號。只有部分 report 帶序號不算數：沒序號的那份與誰先誰後都沒有依據，
 * **NEVER** 把它當成 red 或 green 的同級去拆平手。
 * 仍判不出先後、且判決不同的，**不默默取較差者**：補一筆 `pending` 的 indeterminate 判決
 * （report 欄寫明是哪幾份平手），讓呼叫端印出明確原因。
 */
export function readEvidenceVerdicts(
  repoRoot: string,
  planRel: string,
): { verdicts: EvidenceVerdict[]; reports: PlanAcceptance['reports'] } {
  const verdicts: EvidenceVerdict[] = []
  const reports: PlanAcceptance['reports'] = []
  for (const file of walk(join(repoRoot, planRel, EVIDENCE_DIR), (name) =>
    name.endsWith('.json'),
  )) {
    const path = toPosix(relative(repoRoot, file))
    try {
      const json: unknown = JSON.parse(readFileSync(file, 'utf8'))
      const results = parseCucumberJson(json)
      const stage = stageRank(path)
      const atMs = reportRevisedMs(repoRoot, file, reportRunMs(json))
      const at = new Date(atMs).toISOString()
      for (const result of results) {
        verdicts.push({
          uri: normalizeReportUri(repoRoot, result.uri),
          title: result.title,
          verdict: result.verdict,
          at,
          atMs,
          report: path,
          stage,
        })
      }
      reports.push({ path, results: results.length, read_error: null })
    } catch (error) {
      reports.push({ path, results: 0, read_error: (error as Error).message })
    }
  }
  applyStageOrder(verdicts)
  verdicts.push(...indeterminateTies(verdicts))
  return { verdicts, reports }
}

/** 兩個 report uri 是不是同一支 feature 的不同寫法（相等、互為 `/` 對齊的尾段、或只剩檔名的那種）。 */
function uriEquivalent(a: string, b: string): boolean {
  if (a === b) return true
  const tail = (long: string, short: string): boolean =>
    short.includes('/') ? long.endsWith(`/${short}`) : basenameOf(long) === short
  return a.length >= b.length ? tail(a, b) : tail(b, a)
}

function sameScenario(a: EvidenceVerdict, b: EvidenceVerdict): boolean {
  return a.title === b.title && uriEquivalent(a.uri, b.uri)
}

/**
 * 同一 scenario、同一時刻、來自不同 report 的平手：**每一份**都有 red／green 序號才用序號拆
 * （偏移 < 1ms，不會越過任何真實時間差）。任何一份沒序號就維持平手，交給 `indeterminateTies`。
 */
function applyStageOrder(verdicts: EvidenceVerdict[]): void {
  const snapshot = verdicts.map((v) => ({ v, atMs: v.atMs }))
  for (const { v, atMs } of snapshot) {
    const tied = snapshot.filter((o) => o.atMs === atMs && sameScenario(o.v, v))
    if (new Set(tied.map((o) => o.v.report)).size < 2) continue
    if (tied.some((o) => typeof o.v.stage !== 'number')) continue
    v.atMs = atMs + v.stage! * 0.001
  }
}

/** 同一 scenario 在最新時刻有多份 report 且判決不同 → 先後不明，補一筆 pending 說明原因。 */
function indeterminateTies(verdicts: EvidenceVerdict[]): EvidenceVerdict[] {
  // 分組與 `reportUriMatches` 一致：同一支 feature 的不同寫法（repo-relative、plan-relative、尾段）
  // 算同一個 scenario，不能因為 uri 字串不同就各自落單。
  const seen = new Set<string>()
  const out: EvidenceVerdict[] = []
  for (const anchor of verdicts) {
    const group = verdicts.filter((v) => sameScenario(v, anchor))
    const groupKey = group
      .map((v) => `${v.report}\0${v.uri}\0${v.title}`)
      .toSorted()
      .join('\n')
    if (seen.has(groupKey)) continue
    seen.add(groupKey)
    const top = Math.max(...group.map((v) => v.atMs))
    const tied = group.filter((v) => v.atMs === top)
    if (new Set(tied.map((v) => v.report)).size < 2) continue
    if (new Set(tied.map((v) => v.verdict)).size < 2) continue
    const first = tied[0]!
    const reason = `indeterminate: ${[...new Set(tied.map((v) => v.report))].join(', ')} share the same run time (${first.at}) with different verdicts; order them by naming every one red/green or giving the report a start_timestamp`
    // 每種 uri 寫法各補一筆：`readAcceptanceVerdicts` 是逐 uri 比對的，只補一種寫法會漏掉另一種。
    for (const uri of new Set(tied.map((v) => v.uri))) {
      out.push({
        ...first,
        uri,
        stage: null,
        // 略晚於平手那一刻：latestVerdict 的同刻「取最差」不能把 failed 挑回來蓋掉這筆。
        atMs: top + 0.0005,
        verdict: 'pending',
        report: reason,
      })
    }
  }
  return out
}

/** 候選判決裡最新的那一筆；同一刻（同一份 report）有多筆時取最差。 */
function latestVerdict(candidates: EvidenceVerdict[]): EvidenceVerdict | null {
  let best: EvidenceVerdict | null = null
  for (const v of candidates) {
    if (
      !best ||
      v.atMs > best.atMs ||
      (v.atMs === best.atMs && WORSE[v.verdict] > WORSE[best.verdict])
    )
      best = v
  }
  return best
}

/**
 * 一個 repo-relative 檔最後一次修訂（ms）：最後 commit 時間，工作樹有未提交改動時取 mtime（取大者）。
 * 讀不到回 null。
 */
export function fileRevisedAtMs(repoRoot: string, rel: string): number | null {
  let best = 0
  try {
    const ct = execFileSync('git', ['log', '-1', '--format=%ct', '--', rel], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (ct) best = Number(ct) * 1000
    const dirty = execFileSync('git', ['status', '--porcelain', '--', rel], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (dirty && existsSync(join(repoRoot, rel))) {
      best = Math.max(best, statSync(join(repoRoot, rel)).mtimeMs)
    }
  } catch {
    if (existsSync(join(repoRoot, rel))) best = statSync(join(repoRoot, rel)).mtimeMs
  }
  return best > 0 ? best : null
}

/**
 * plan 最後修訂時間：plan.md、spec.md 與 features/ 的最後 commit 時間，工作樹有未提交的改動時
 * 取那些檔的 mtime（取大者）。**刻意排除 `evidence/`**——把 report 提交進 plan 目錄不能讓 plan
 * 自己看起來剛被改過，否則每一份證據一落檔就把自己判成過期。
 */
export function planRevisedAt(repoRoot: string, planRel: string): string | null {
  const paths = ['plan.md', 'spec.md', 'features'].map((p) => `${planRel}/${p}`)
  let best = 0
  try {
    const ct = execFileSync('git', ['log', '-1', '--format=%ct', '--', ...paths], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (ct) best = Number(ct) * 1000
    const dirty = execFileSync('git', ['status', '--porcelain', '--', ...paths], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    for (const line of dirty.split('\n').filter(Boolean)) {
      const file = join(repoRoot, line.slice(3).trim())
      if (existsSync(file)) best = Math.max(best, statSync(file).mtimeMs)
    }
  } catch {
    for (const file of [
      ...paths.slice(0, 2).map((p) => join(repoRoot, p)),
      ...walk(join(repoRoot, planRel, 'features'), () => true),
    ]) {
      if (existsSync(file)) best = Math.max(best, statSync(file).mtimeMs)
    }
  }
  return best > 0 ? new Date(best).toISOString() : null
}

/** 這個 repo 裡帶 `features/` 的 plan 目錄（repo-relative）。clade 的 `W-*` 與產品的 `NNN-*` 同一條路。 */
export function listAcceptancePlans(repoRoot: string): string[] {
  const root = join(repoRoot, 'specs', 'plans')
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'features')))
    .map((entry) => `specs/plans/${entry.name}`)
    .toSorted()
}

/**
 * 讀一個 plan 的驗收狀態。
 *
 * `revisedAt` 可注入（測試、或 projector 已經量過）；未注入時跑 `planRevisedAt`。
 * 每一份 report／sidecar 的讀取失敗記在自己那一列，NEVER 讓一份壞檔拖垮整個 plan。
 */
export function readAcceptanceVerdicts(
  repoRoot: string,
  planRel: string,
  { revisedAt }: { revisedAt?: string | null } = {},
): PlanAcceptance {
  const planDir = join(repoRoot, planRel)
  const plan_revised_at = revisedAt === undefined ? planRevisedAt(repoRoot, planRel) : revisedAt

  const defs = walk(join(planDir, 'features'), (name) => name.endsWith('.feature')).flatMap(
    (file) => parseFeatureScenarios(readFileSync(file, 'utf8'), toPosix(relative(planDir, file))),
  )

  const { verdicts, reports } = readEvidenceVerdicts(repoRoot, planRel)
  // truth scenario 替這份 plan 作證：來源註解指名本 work、標題相同（每支 truth feature 只讀一次）。
  const workId = basenameOf(planRel)
  const sourceCache = new Map<string, Map<string, Set<string>>>()
  const sourcesOf = (uri: string): Map<string, Set<string>> => {
    let held = sourceCache.get(uri)
    if (!held) {
      const file = join(repoRoot, uri)
      held =
        uri.endsWith('.feature') && !uri.startsWith(`${planRel}/`) && existsSync(file)
          ? parseSourceWorks(readFileSync(file, 'utf8'))
          : new Map()
      sourceCache.set(uri, held)
    }
    return held
  }
  const machineFor = (def: ScenarioDef): ScenarioVerdict['machine'] => {
    const hit = latestVerdict(
      verdicts.filter(
        (v) =>
          v.title === def.title &&
          (reportUriMatches(v.uri, planRel, def.feature) ||
            sourcesOf(v.uri).get(v.title)?.has(workId) === true),
      ),
    )
    return hit ? { verdict: hit.verdict, at: hit.at, report: hit.report } : null
  }

  const receiptsPath = join(planDir, EVIDENCE_DIR, RECEIPTS_FILE)
  let receiptsMeta: PlanAcceptance['receipts'] = null
  const receipts: Receipt[] = []
  if (existsSync(receiptsPath)) {
    try {
      for (const line of readFileSync(receiptsPath, 'utf8').split('\n')) {
        if (!line.trim()) continue
        const receipt = parseReceiptLine(line)
        if (receipt) receipts.push(receipt)
      }
      receiptsMeta = {
        path: toPosix(relative(repoRoot, receiptsPath)),
        rows: receipts.length,
        read_error: null,
      }
    } catch (error) {
      receiptsMeta = {
        path: toPosix(relative(repoRoot, receiptsPath)),
        rows: 0,
        read_error: (error as Error).message,
      }
    }
  }

  const scenarios = defs.map((def): ScenarioVerdict => {
    const mine = receipts
      .filter((r) => r.feature === def.feature && r.scenario === def.title)
      .toSorted((a, b) => a.at.localeCompare(b.at))
    const lastHuman = mine.findLast((r) => r.verdict !== null)
    const machineVerdict = machineFor(def)
    const human = def.tags.includes('@human')
    const evidenceAt = mine.findLast((r) => r.screenshot || r.url)?.at ?? null
    // 人判的 scenario 以人判為準；機器綠燈 NEVER 替 @human 蓋章。非 @human 以較新的那一個為準。
    const latestAt = human
      ? (lastHuman?.at ?? null)
      : ([lastHuman?.at, machineVerdict?.at]
          .filter((v): v is string => Boolean(v))
          .toSorted()
          .at(-1) ?? null)
    return {
      id: `${planRel}#${def.feature}:${def.title}`,
      plan: planRel,
      feature: def.feature,
      title: def.title,
      tags: def.tags,
      human,
      machine: machineVerdict,
      human_verdict: lastHuman
        ? {
            verdict: lastHuman.verdict!,
            at: lastHuman.at,
            by: lastHuman.by,
            note: lastHuman.note,
            receipt_id: lastHuman.receipt_id,
          }
        : null,
      evidence: mine.flatMap((r) => [r.screenshot, r.url].filter((v): v is string => Boolean(v))),
      receipts: mine.map(({ feature: _feature, scenario: _scenario, ...rest }) => rest),
      evidence_at: evidenceAt,
      evidence_fresh:
        evidenceAt === null || plan_revised_at === null
          ? null
          : Date.parse(evidenceAt) >= Date.parse(plan_revised_at),
      fresh:
        latestAt === null || plan_revised_at === null
          ? null
          : Date.parse(latestAt) >= Date.parse(plan_revised_at),
    }
  })

  return { plan: planRel, plan_revised_at, scenarios, reports, receipts: receiptsMeta }
}

/** 一條 scenario 的最新有效判決，三值。`pending`／`skip` 與沒判過一樣算「未跑」——「沒跑過」不是「沒過」。 */
export type ScenarioOutcome = 'pass' | 'fail' | 'unrun'

/** 判決相對 plan 最後修訂：新／舊；有判決但修訂時間讀不到＝判不出；沒有判決＝未跑。 */
export type ScenarioFreshness = 'fresh' | 'stale' | 'unknown' | 'unrun'

export interface ScenarioStatus {
  outcome: ScenarioOutcome
  /** 有效判決來自誰；未跑為 null。 */
  source: 'human' | 'machine' | null
  at: string | null
  freshness: ScenarioFreshness
  /**
   * `@human` 那一條的證據狀態：證據早於 plan 修訂＝`stale`（等 agent 補新截圖）、沒有證據＝`missing`、
   * 齊＝`ok`。非 `@human` 為 null——機器判的場景不需要人看的證據。
   */
  evidence: 'ok' | 'stale' | 'missing' | 'unknown' | null
}

/**
 * 一條 scenario 現在是什麼狀態。專案頁的通過比（`summarizeAcceptance`）、證據頁逐條、以及本檔 CLI
 * 三處都從這一支取，**NEVER** 各自重判：`@human` 只認人判（機器綠燈不蓋章），非 `@human` 取人判與機器中
 * 較新者（與 `readAcceptanceVerdicts` 的 `fresh` 同一條 latestAt 規則）。
 */
export function scenarioStatus(s: ScenarioVerdict): ScenarioStatus {
  const human = s.human_verdict
  const machine = s.human ? null : s.machine
  const useHuman = Boolean(human && (!machine || human.at >= machine.at))
  const verdict = useHuman ? human!.verdict : (machine?.verdict ?? null)
  const outcome: ScenarioOutcome =
    verdict === 'pass' || verdict === 'passed'
      ? 'pass'
      : verdict === 'fail' || verdict === 'failed'
        ? 'fail'
        : 'unrun'
  const at = useHuman ? human!.at : (machine?.at ?? null)
  const freshness: ScenarioFreshness =
    s.fresh === true ? 'fresh' : s.fresh === false ? 'stale' : at === null ? 'unrun' : 'unknown'
  const evidence = !s.human
    ? null
    : s.evidence_fresh === true
      ? 'ok'
      : s.evidence_fresh === false
        ? 'stale'
        : s.evidence_at === null
          ? 'missing'
          : 'unknown'
  return {
    outcome,
    source: verdict === null ? null : useHuman ? 'human' : 'machine',
    at,
    freshness,
    evidence,
  }
}

export interface AcceptanceSummary {
  scenarios: number
  /** 最新有效判決為通過。`@human` 只認人判；非 `@human` 取人判與機器中較新的那一個。 */
  passed: number
  failed: number
  /** 沒有判決，或判決是 pending／skip。「沒跑過」不是「沒過」，分開數。 */
  unverdicted: number
  /** `fresh === true`：判決晚於 plan 修訂。 */
  fresh: number
  /** `fresh === false`：判決早於 plan 修訂，證明的是上一版。 */
  stale: number
}

/**
 * 一個 plan 的場景彙總（專案頁「通過比與新鮮度」、證據頁頁首）。只數 `scenarioStatus` 的結果，不重判。
 */
export function summarizeAcceptance(scenarios: readonly ScenarioVerdict[]): AcceptanceSummary {
  const out: AcceptanceSummary = {
    scenarios: scenarios.length,
    passed: 0,
    failed: 0,
    unverdicted: 0,
    fresh: 0,
    stale: 0,
  }
  for (const s of scenarios) {
    const status = scenarioStatus(s)
    if (status.outcome === 'pass') out.passed += 1
    else if (status.outcome === 'fail') out.failed += 1
    else out.unverdicted += 1
    if (status.freshness === 'fresh') out.fresh += 1
    else if (status.freshness === 'stale') out.stale += 1
  }
  return out
}

/**
 * CLI（唯讀）：印一個 plan 的逐條狀態與彙總，與證據頁同值。
 *
 *   node vendor/scripts/flow/acceptance-verdicts.ts <plan dir> [--repo-root <path>] [--json]
 *
 * `<plan dir>` 是 repo 相對路徑（例 `specs/plans/W-…`）；`--repo-root` 預設 cwd 的 git toplevel。
 */
function cli(argv: string[]): number {
  const json = argv.includes('--json')
  const rootAt = argv.indexOf('--repo-root')
  const planRel = argv.find(
    (a, i) => a !== '--json' && (rootAt === -1 || (i !== rootAt && i !== rootAt + 1)),
  )
  if (!planRel) {
    process.stderr.write('usage: acceptance-verdicts.ts <plan dir> [--repo-root <path>] [--json]\n')
    return 2
  }
  let repoRoot = rootAt === -1 ? null : (argv[rootAt + 1] ?? null)
  if (!repoRoot) {
    try {
      repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      repoRoot = process.cwd()
    }
  }
  const plan = readAcceptanceVerdicts(repoRoot, planRel.replace(/\/+$/u, ''))
  const rows = plan.scenarios.map((s) => ({
    id: s.id,
    title: s.title,
    human: s.human,
    ...scenarioStatus(s),
  }))
  const summary = summarizeAcceptance(plan.scenarios)
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ plan: plan.plan, plan_revised_at: plan.plan_revised_at, summary, scenarios: rows }, null, 2)}\n`,
    )
    return 0
  }
  const OUTCOME = { pass: '通過', fail: '失敗', unrun: '未跑' } as const
  const FRESH = { fresh: '新', stale: '舊', unknown: '判不出', unrun: '—' } as const
  process.stdout.write(`${plan.plan}（plan 修訂 ${plan.plan_revised_at ?? '讀不到'}）\n`)
  for (const r of rows) {
    process.stdout.write(
      `  ${OUTCOME[r.outcome]}\t${FRESH[r.freshness]}\t${r.human ? '@human ' : ''}${r.id}\n`,
    )
  }
  process.stdout.write(
    `scenarios ${summary.scenarios} · 通過 ${summary.passed} · 失敗 ${summary.failed} · 未跑 ${summary.unverdicted} · 新 ${summary.fresh} · 舊 ${summary.stale}\n`,
  )
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = cli(process.argv.slice(2))
}
