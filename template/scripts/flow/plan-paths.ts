// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/plan-paths.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/plan-paths.ts
/**
 * Plan／truth 的位置與內容雜湊——lifecycle（寫）與 gates（讀）共用的基元。
 *
 * 單獨成一個模組的理由只有一個：`plan-lifecycle.ts` 要呼叫 gate（close 時驗收、open 時查 slug），
 * 而 gate 要知道 plan 與 truth 住在哪裡。兩邊互相 import 就是一個相依環。把「住在哪裡」抽出來，
 * 環自然消失，而且**只有一份** `hashTruth`——baseline 新鮮度是 gate 與 lifecycle 都在判的同一件事，
 * 兩份實作一旦漂移，「truth 有沒有動過」會依呼叫者不同而有不同答案。
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { PLAN_ROOT } from './close-commit.ts'

export { PLAN_ROOT, planCloseHeader, planCloseTrailer } from './close-commit.ts'
export const TRUTH_ROOT = 'specs/truth'
export const LEGACY_MAP = 'specs/truth/legacy-ids.json'

export function planDir(root: string, workId: string): string {
  return join(root, PLAN_ROOT, workId)
}

/** lifecycle 檔（D2）：新格式叫 `work.md`；legacy 是讓出名字之前的 `plan.md`。 */
export const LIFECYCLE_FILE = 'work.md'
export const LEGACY_LIFECYCLE_FILE = 'plan.md'
export const TRUTH_DELTA_FILE = 'truth-delta.md'

/** lifecycle package 的 frontmatter 判準：同時含 `work_id:` 與 `truth_baseline:` 兩個鍵且值非空（同舊的 `readFrontmatterField !== null`，空值也是 null）。 */
export function hasLifecycleFrontmatter(text: string): boolean {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text)?.[1] ?? ''
  return /^work_id:\s*\S/mu.test(fm) && /^truth_baseline:\s*\S/mu.test(fm)
}

/** frontmatter 有非空 `work_id:`（不要求 `truth_baseline`）——fleet 上「work_id-only」舊 `plan.md` 的判準，與 `hasLifecycleFrontmatter` 同一套 regex 風格。 */
export function hasWorkIdFrontmatter(text: string): boolean {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text)?.[1] ?? ''
  return /^work_id:\s*\S/mu.test(fm)
}

/**
 * 這個 work id 的 `work.md`／`plan.md` 在 git 歷史（首次加入、HEAD）上曾經帶過兩鍵 lifecycle frontmatter。
 * 工作樹上現在沒有帶鍵的 lifecycle 檔時，這代表檔被上游 owner 覆寫（`work.md` 被改、或 legacy `plan.md` 被 /system-analysis 蓋掉）。
 * gate（`lifecycle-frontmatter-removed`）與 `open`（拒絕在覆寫的 package 旁邊鑄新 `work.md`）共用這一份判準。
 */
export function hadCommittedLifecycleFrontmatter(root: string, workId: string): boolean {
  const rels = [LIFECYCLE_FILE, LEGACY_LIFECYCLE_FILE].map((f) => `${PLAN_ROOT}/${workId}/${f}`)
  const git = (args: string[]): string => {
    try {
      return execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      return ''
    }
  }
  const firstAdd = git(['log', '--diff-filter=A', '--format=%H', '--', ...rels])
    .split('\n')
    .findLast(Boolean)
  return [firstAdd, 'HEAD']
    .filter((rev): rev is string => Boolean(rev))
    .flatMap((rev) => rels.map((rel) => git(['show', `${rev}:${rel}`])))
    .some(hasLifecycleFrontmatter)
}

export type LifecycleShape = 'work' | 'legacy' | 'ambiguous' | 'none'

export interface LifecycleFile {
  shape: LifecycleShape
  /** 讀取用的絕對路徑；`ambiguous` 指向 `work.md`，`none` 指向現存的那份（都沒有時是 `work.md`，新建落點）。 */
  path: string
  /** repo-relative（posix）。 */
  rel: string
  /**
   * 這個 package 已經有「自己的」lifecycle 檔，開同 work id 應 resume 而非新建：`work`／`legacy`，
   * 或 shape `none` 但已有 `work.md`、或現存的 `plan.md` 帶 `work_id`（缺 `truth_baseline` 的舊 plan）。上游 `/system-analysis`
   * 的 `plan.md`（沒有 `work_id`）不算，要在旁邊建 `work.md`。判準與 `pickLifecycle` 同源，NEVER 在呼叫端另寫。
   */
  resumable: boolean
}

/**
 * 解析一個 package 的 lifecycle 檔——所有 lifecycle 讀者共用的唯一入口，判準只看檔案形狀：
 * `work.md` 含兩個 frontmatter 鍵＝新格式；沒有 `work.md`、`plan.md` 含兩個鍵＝legacy（相容期）；
 * 兩者都是 lifecycle 檔＝`ambiguous`（fail closed，要求先 migrate）。上游 `/system-analysis` 寫的
 * `plan.md` 沒有這兩個鍵，不會被當 lifecycle 檔。沒有任何檔時指向 `work.md`（新建落點）；只有無鍵 `plan.md` 時指向它（shape `none`）。
 */
export function resolveLifecycleFile(root: string, workId: string): LifecycleFile {
  const { shape, file, resumable } = pickLifecycleIn(planDir(root, workId))
  return {
    shape,
    path: join(planDir(root, workId), file),
    rel: `${PLAN_ROOT}/${workId}/${file}`,
    resumable,
  }
}

/** 只有 package 目錄、沒有 repo root 時用（例如呼叫端手上只有 plans 目錄）：回 lifecycle 檔的絕對路徑，判準同上。 */
export function lifecycleFileIn(packageDir: string): string {
  return join(packageDir, pickLifecycleIn(packageDir).file)
}

function pickLifecycleIn(dir: string): { shape: LifecycleShape; file: string; resumable: boolean } {
  const read = (name: string) => {
    const p = join(dir, name)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }
  return pickLifecycle(read(LIFECYCLE_FILE), read(LEGACY_LIFECYCLE_FILE))
}

/**
 * `resolveLifecycleFile` 的判準本體：輸入兩個候選檔的內容（`null`＝不存在），回形狀與該讀哪一個。
 * 沒有帶鍵的 lifecycle 檔時：有 `work.md` 讀它，否則讀現存的（無鍵）`plan.md`，都沒有才指向 `work.md`（新建落點）。
 */
function pickLifecycle(
  work: string | null,
  legacy: string | null,
): { shape: LifecycleShape; file: string; resumable: boolean } {
  const workOk = work !== null && hasLifecycleFrontmatter(work)
  const legacyOk = legacy !== null && hasLifecycleFrontmatter(legacy)
  if (workOk && legacyOk) return { shape: 'ambiguous', file: LIFECYCLE_FILE, resumable: true }
  if (workOk) return { shape: 'work', file: LIFECYCLE_FILE, resumable: true }
  if (legacyOk) return { shape: 'legacy', file: LEGACY_LIFECYCLE_FILE, resumable: true }
  // 沒有帶鍵的 lifecycle 檔：讀取端沿用舊行為——有 `work.md` 就讀它，否則讀現存的 `plan.md`，都沒有才是新建（`work.md`）。
  // 缺 `truth_baseline` 的 active `plan.md` 必須指向它自己：回 `work.md` 會讓 fleet-works／plan-gates／answer
  // 拿到不存在的路徑而靜默略過。`shape` 仍是 `none`，gate 不會把它當 lifecycle 檔驗收。
  // `resumable`（開同 work id 時 resume 還是新建）：現存的 `work.md` 一律 resume——那是本工具自己的檔名，
  // 新建會覆寫它；resume 後 `readPlan` 驗 `work_id`，內容不合就丟錯，NEVER 靜默覆寫。
  // 沒有 `work.md` 時，現存 `plan.md` 帶 `work_id`（work_id-only 舊 plan）才 resume；無 `work_id` 的上游 `plan.md` 在旁邊建 `work.md`、不覆寫它。
  if (work !== null) return { shape: 'none', file: LIFECYCLE_FILE, resumable: true }
  if (legacy !== null) {
    return { shape: 'none', file: LEGACY_LIFECYCLE_FILE, resumable: hasWorkIdFrontmatter(legacy) }
  }
  return { shape: 'none', file: LIFECYCLE_FILE, resumable: false }
}

/**
 * 同 `resolveLifecycleFile` 的判準，但讀的是工作樹以外的來源（例如 `git show <rev>:<rel>`）：
 * `read(rel)` 回該 repo-relative 路徑的內容，不存在回 `null`。`text` 是選中那份的內容（都不存在＝`null`）；
 * `candidates` 是兩個候選路徑，查「歷史上曾經有過」時兩個都要問。
 */
export async function resolveLifecycleAt(
  workId: string,
  read: (rel: string) => Promise<string | null>,
): Promise<{ shape: LifecycleShape; rel: string; text: string | null; candidates: string[] }> {
  const base = `${PLAN_ROOT}/${workId}`
  const candidates = [`${base}/${LIFECYCLE_FILE}`, `${base}/${LEGACY_LIFECYCLE_FILE}`]
  const [work, legacy] = await Promise.all(candidates.map(read))
  const { shape, file } = pickLifecycle(work, legacy)
  return {
    shape,
    rel: `${base}/${file}`,
    text: file === LIFECYCLE_FILE ? work : legacy,
    candidates,
  }
}

/** lifecycle 檔的絕對路徑（見 `resolveLifecycleFile`）。名字沿用 `planPath`，既有呼叫端不用改。 */
export function planPath(root: string, workId: string): string {
  return resolveLifecycleFile(root, workId).path
}

/** `work.md` 與 `plan.md` 都是 lifecycle 檔時丟錯（fail closed）。 */
export function assertUnambiguousLifecycle(root: string, workId: string): LifecycleFile {
  const f = resolveLifecycleFile(root, workId)
  if (f.shape === 'ambiguous') {
    throw new Error(
      `ambiguous-lifecycle-file: ${PLAN_ROOT}/${workId} has both work.md and plan.md with work_id/truth_baseline; run \`flow plan migrate ${workId}\` (or remove the stale one)`,
    )
  }
  return f
}

/** carrier／git 路徑用的 repo-relative lifecycle 檔路徑；沒有 root 時退回 `work.md`（新建落點）。 */
export function planRef(id: string, root?: string): string {
  const trimmed = id.trim()
  if (trimmed.startsWith(`${PLAN_ROOT}/`)) {
    if (trimmed.endsWith('.md')) return trimmed
    const workId = trimmed.slice(PLAN_ROOT.length + 1).replace(/\/$/, '')
    return root ? resolveLifecycleFile(root, workId).rel : join(trimmed, LIFECYCLE_FILE)
  }
  const workId = trimmed.replace(/\/(plan|work)\.md$/, '')
  return root ? resolveLifecycleFile(root, workId).rel : `${PLAN_ROOT}/${workId}/${LIFECYCLE_FILE}`
}

export function listFiles(dir: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === '.' || name === '..') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...listFiles(p))
    else out.push(p)
  }
  return out
}

export function hashTruth(root: string): string {
  const dir = join(root, TRUTH_ROOT)
  if (!existsSync(dir)) return 'empty'
  const files = listFiles(dir).toSorted()
  const h = createHash('sha256')
  for (const file of files) {
    const rel = relative(dir, file)
    h.update(rel)
    h.update('\0')
    h.update(readFileSync(file))
    h.update('\0')
  }
  return h.digest('hex')
}
