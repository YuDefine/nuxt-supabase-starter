/**
 * pr-lineage.ts — PR body 的 `Lineage: <root>/<generation>` 行（plans/40 T2，shadow）。
 *
 * 為什麼存在：拆單、取代之後的子 PR 現在只能靠人工歸類回到同一個家族，輪數也依 PR 號分段
 * （`0A派送與輪數.md:36`），一個家族實際用了幾輪沒人算得出來。開 PR 那一刻在 `Work:` 行旁邊寫一行
 * `Lineage:`，家族輪數帳（`vendor/scripts/lineage-ledger.ts`）就能機械重算。
 *
 * 格式：`Lineage: <root>/<generation>`
 *   - 沒有母 PR：`Lineage: self/1`（root 就是這張 PR 自己；開立前還沒有 PR 號，帳本讀的時候換成本身號碼）
 *   - 有母 PR（body 或標題寫了 `拆自 #N`／`Supersedes #N`／`取代 #N`／`split from #N`／`replaces #N`）：
 *     root＝母 PR 的 root（母是 `self` 就是母 PR 號），generation＝母世代＋1
 *   - 母 PR 的 Lineage 讀本機家族帳快取（`<state dir>/pr-lineage.json`，`lineage-ledger.ts sync` 寫；拆單的母 PR
 *     多半跑過 0-A，已在快取裡）。本模組 NEVER 打 gh（開 PR 的 hook 不新增直打 gh 的呼叫端；
 *     `test/gh-direct-callsite-ratchet.test.ts`）。快取沒有：root＝母 PR 號、generation＝2（最佳努力），
 *     帳本 sync 時再沿母鏈（走 gh-throttle）把 root 正規化。
 *
 * shadow：本行只供量測，NEVER 擋開 PR、NEVER 進任何放行或輪數判定（T11 才轉強制）。
 * kill switch：`CLADE_LINEAGE_SHADOW=off` 或 `<state dir>/lineage-shadow.off` 存在 → 不寫行、帳本不記。
 * state dir：`CLADE_LINEAGE_STATE_DIR`，預設 `~/.local/state/clade/lineage`。
 *
 * 轉正條件、撤掉條件與到量的量寫在 `lineage-ledger.ts` 檔頭。
 *
 * 正本：`capabilities/core/hooks/pr-lineage.ts`（hook 目錄整包投影到 consumer）；`vendor/scripts/lib/pr-lineage.ts`
 * 是逐字副本（程式開 PR 的路徑用），兩份由 test/pr-lineage.test.ts 釘住一致。
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LINEAGE_LINE_RE = /^[ \t]*Lineage[ \t]*[:：][ \t]*(\S+)/mu
const WORK_LINE_AT_RE = /^[ \t]*Work(?:[ \t]*id)?[ \t]*[:：][ \t]*\S.*$/mu

/** 母 PR 的寫法：中文「拆自／取代」、英文 Supersedes／split from／replaces；`PR #N` 與 `#N` 都收。 */
const PARENT_RE =
  /(?:拆自|取代|supersedes|superseded[ \t]+from|split(?:[ \t]+|-)from|replaces)[ \t]*[:：]?[ \t]*(?:PR[ \t]*)?#(\d+)/giu

export interface Lineage {
  /** 家族根 PR 號；`self`＝本張就是根。 */
  root: number | 'self'
  generation: number
}

export function lineageStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.CLADE_LINEAGE_STATE_DIR?.trim() || join(homedir(), '.local', 'state', 'clade', 'lineage')
  )
}

/** kill switch：env `CLADE_LINEAGE_SHADOW=off` 或 state dir 的 `lineage-shadow.off`。 */
export function lineageShadowOff(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CLADE_LINEAGE_SHADOW?.trim().toLowerCase() === 'off') return true
  try {
    return existsSync(join(lineageStateDir(env), 'lineage-shadow.off'))
  } catch {
    return false
  }
}

export function parseLineage(body: string | null | undefined): Lineage | null {
  const m = LINEAGE_LINE_RE.exec(body ?? '')
  if (!m) return null
  const g = /^(self|#?(\d+))\/(\d+)$/u.exec(m[1]!)
  if (!g) return null
  const generation = Number(g[3])
  if (!Number.isInteger(generation) || generation < 1) return null
  return { root: g[1] === 'self' ? 'self' : Number(g[2]), generation }
}

export function formatLineage(l: Lineage): string {
  return `Lineage: ${l.root}/${l.generation}`
}

/** 標題＋body 裡第一個母 PR 號；沒有回 null。 */
export function parentPr(text: string): number | null {
  PARENT_RE.lastIndex = 0
  const m = PARENT_RE.exec(text)
  return m ? Number(m[1]) : null
}

/** 母 PR body 的讀法；讀不到回 null。 */
export type PrBodyLookup = (pr: number) => string | null

/**
 * 預設的母 PR 讀法：家族帳快取（`<state dir>/pr-lineage.json`，鍵 `<owner/repo>#<pr>`）。
 * 有給 repo 只認該 repo（不分大小寫）；沒給時同號只有一個 repo 才採用。回成 `Lineage: <root>/<generation>` 一行；沒有回 null。
 */
export function cachedLineageLookup(
  env: NodeJS.ProcessEnv = process.env,
  repo?: string,
): PrBodyLookup {
  return (pr) => {
    try {
      const raw: unknown = JSON.parse(
        readFileSync(join(lineageStateDir(env), 'pr-lineage.json'), 'utf8'),
      )
      if (typeof raw !== 'object' || raw === null) return null
      const hits = Object.entries(raw).filter(
        ([k]) =>
          k.endsWith(`#${pr}`) && (!repo || k.toLowerCase() === `${repo}#${pr}`.toLowerCase()),
      )
      if (hits.length !== 1) return null
      const v: unknown = hits[0]![1]
      if (typeof v !== 'object' || v === null) return null
      const { root, generation } = v as { root?: unknown; generation?: unknown }
      if (typeof root !== 'number' || typeof generation !== 'number') return null
      return `Lineage: ${root === pr ? 'self' : root}/${generation}`
    } catch {
      return null
    }
  }
}

/** 由本張的標題＋body 推 Lineage：沒有母 PR → self/1；有 → 依母 PR 的 Lineage 行。 */
export function deriveLineage(text: string, lookup: PrBodyLookup): Lineage {
  const parent = parentPr(text)
  if (parent === null) return { root: 'self', generation: 1 }
  let mother: Lineage | null = null
  try {
    mother = parseLineage(lookup(parent))
  } catch {
    mother = null
  }
  if (!mother) return { root: parent, generation: 2 }
  return {
    root: mother.root === 'self' ? parent : mother.root,
    generation: mother.generation + 1,
  }
}

export interface LineageLineResult {
  body: string
  /** 補上的那一行；沒補（已有、kill switch）＝null。 */
  added: string | null
}

/**
 * body 沒有 `Lineage:` 行就補一行：有 `Work:` 行時緊接在它下面，沒有就放 body 最前面。
 * 已有、kill switch 開著 → 原樣。NEVER 丟例外（shadow 不准擋開 PR）。
 */
export function withLineageLine(
  body: string,
  opts: { title?: string; lookup?: PrBodyLookup; env?: NodeJS.ProcessEnv } = {},
): LineageLineResult {
  try {
    const env = opts.env ?? process.env
    if (lineageShadowOff(env) || LINEAGE_LINE_RE.test(body)) return { body, added: null }
    const line = formatLineage(
      deriveLineage(`${opts.title ?? ''}\n${body}`, opts.lookup ?? cachedLineageLookup(env)),
    )
    const work = WORK_LINE_AT_RE.exec(body)
    if (work) {
      const at = work.index + work[0].length
      return { body: `${body.slice(0, at)}\n${line}${body.slice(at)}`, added: line }
    }
    return { body: `${line}\n\n${body}`, added: line }
  } catch {
    return { body, added: null }
  }
}
