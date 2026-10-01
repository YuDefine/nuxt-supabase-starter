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

export const PLAN_ROOT = 'specs/plans'
export const TRUTH_ROOT = 'specs/truth'
export const LEGACY_MAP = 'specs/truth/legacy-ids.json'

export function planDir(root: string, workId: string): string {
  return join(root, PLAN_ROOT, workId)
}

export function planPath(root: string, workId: string): string {
  return join(planDir(root, workId), 'plan.md')
}

export function planRef(id: string): string {
  const trimmed = id.trim()
  if (trimmed.startsWith(`${PLAN_ROOT}/`)) {
    return trimmed.endsWith('.md') ? trimmed : join(trimmed, 'plan.md')
  }
  const workId = trimmed.replace(/\/plan\.md$/, '')
  return `${PLAN_ROOT}/${workId}/plan.md`
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
