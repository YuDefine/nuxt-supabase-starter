// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/plan-paths.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/plan-paths.ts
/**
 * Plan／truth 的位置與內容雜湊——lifecycle（寫）與 gates（讀）共用的基元。
 *
 * 單獨成一個模組的理由只有一個：`plan-lifecycle.ts` 要呼叫 gate（close 時驗收、open 時查 slug），
 * 而 gate 要知道 plan 與 truth 住在哪裡。兩邊互相 import 就是一個相依環。把「住在哪裡」抽出來，
 * 環自然消失，而且**只有一份** `hashTruth`——baseline 新鮮度是 gate 與 lifecycle 都在判的同一件事，
 * 兩份實作一旦漂移，「truth 有沒有動過」會依呼叫者不同而有不同答案。
 */

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

export type LifecycleShape = 'work' | 'legacy' | 'ambiguous' | 'none'

export interface LifecycleFile {
  shape: LifecycleShape
  /** 讀取用的絕對路徑；`ambiguous` 指向 `work.md`，`none` 指向現存的那份（都沒有時是 `plan.md`，新建落點）。 */
  path: string
  /** repo-relative（posix）。 */
  rel: string
}

/**
 * 解析一個 package 的 lifecycle 檔——所有 lifecycle 讀者共用的唯一入口，判準只看檔案形狀：
 * `work.md` 含兩個 frontmatter 鍵＝新格式；沒有 `work.md`、`plan.md` 含兩個鍵＝legacy（相容期）；
 * 兩者都是 lifecycle 檔＝`ambiguous`（fail closed，要求先 migrate）。上游 `/system-analysis` 寫的
 * `plan.md` 沒有這兩個鍵，不會被當 lifecycle 檔。沒有任何 lifecycle 檔時指向 `plan.md`（新建落點，寫入端切換前）。
 */
export function resolveLifecycleFile(root: string, workId: string): LifecycleFile {
  const { shape, file } = pickLifecycleIn(planDir(root, workId))
  return { shape, path: join(planDir(root, workId), file), rel: `${PLAN_ROOT}/${workId}/${file}` }
}

/** 只有 package 目錄、沒有 repo root 時用（例如呼叫端手上只有 plans 目錄）：回 lifecycle 檔的絕對路徑，判準同上。 */
export function lifecycleFileIn(packageDir: string): string {
  return join(packageDir, pickLifecycleIn(packageDir).file)
}

function pickLifecycleIn(dir: string): { shape: LifecycleShape; file: string } {
  const read = (name: string) => {
    const p = join(dir, name)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }
  return pickLifecycle(read(LIFECYCLE_FILE), read(LEGACY_LIFECYCLE_FILE))
}

/**
 * `resolveLifecycleFile` 的判準本體：輸入兩個候選檔的內容（`null`＝不存在），回形狀與該讀哪一個。
 * 沒有帶鍵的 lifecycle 檔時沿用舊行為——有 `work.md` 就讀它，否則讀 `plan.md`（無 frontmatter 的舊 plan），都沒有才是新建。
 */
function pickLifecycle(
  work: string | null,
  legacy: string | null,
): { shape: LifecycleShape; file: string } {
  const workOk = work !== null && hasLifecycleFrontmatter(work)
  const legacyOk = legacy !== null && hasLifecycleFrontmatter(legacy)
  if (workOk && legacyOk) return { shape: 'ambiguous', file: LIFECYCLE_FILE }
  if (workOk) return { shape: 'work', file: LIFECYCLE_FILE }
  if (legacyOk) return { shape: 'legacy', file: LEGACY_LIFECYCLE_FILE }
  if (work !== null) return { shape: 'none', file: LIFECYCLE_FILE }
  if (legacy !== null) return { shape: 'none', file: LEGACY_LIFECYCLE_FILE }
  return { shape: 'none', file: LEGACY_LIFECYCLE_FILE }
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

/** carrier／git 路徑用的 repo-relative lifecycle 檔路徑；沒有 root 時退回 `plan.md`（寫入端切換前的新建落點）。 */
export function planRef(id: string, root?: string): string {
  const trimmed = id.trim()
  if (trimmed.startsWith(`${PLAN_ROOT}/`)) {
    if (trimmed.endsWith('.md')) return trimmed
    const workId = trimmed.slice(PLAN_ROOT.length + 1).replace(/\/$/, '')
    return root ? resolveLifecycleFile(root, workId).rel : join(trimmed, LEGACY_LIFECYCLE_FILE)
  }
  const workId = trimmed.replace(/\/(plan|work)\.md$/, '')
  return root
    ? resolveLifecycleFile(root, workId).rel
    : `${PLAN_ROOT}/${workId}/${LEGACY_LIFECYCLE_FILE}`
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
