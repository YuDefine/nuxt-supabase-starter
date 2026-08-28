// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/worktree-dev-port.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/worktree-dev-port.ts
/**
 * worktree-dev-port.ts — 「這棵 worktree 的 dev server 聽哪個 port」的唯一 SoT。
 *
 * 為什麼要獨立成 lib（而不是留在 wt-helper 裡）：分配與**讀取**原本只有 wt-helper 一個
 * 消費端，於是 review-gui 起 dev server 時用的是 registry 的 base port —— 同一個 consumer
 * 的 N 條 worktree 全部指向同一個號碼，誰先起誰佔住，其餘的 item 只能顯示「port 3000 上跑
 * 的是別人的 dev server」。那不是提示，是設計本身要求人輪流等。
 *
 * 2026-08-28 實測：<consumer-b> 有 15 條 worktree、1 個 registry port，`shipment-loading-per-box-capacity`
 * 的驗收 item 嵌不了預覽，因為 3000 正被 `product-process-hierarchy-and-naming` 佔著。
 *
 * 所以分配與讀取都收斂到本檔，讓「哪個 port」對每一個消費端都是同一個答案：
 *
 *   - `wt-helper add` / `wt-helper dev`（worktree 建立時分配、起 dev server 時使用）
 *   - `review-gui` 的 port map（item 預覽連結、dev server 監看、start 按鈕的 spawn）
 *
 * ## 分配模型
 *
 * 一律是「**一個 offset 套用到該 consumer 宣告的每一個 port**」。兩個池，依序取：
 *
 *   1. **base 池** `base+1..base+9` —— registry 把各 consumer 的 base 排成 +10 間距，中間
 *      這 9 個號碼天然屬於它。號碼貼著 base，人看得懂，優先用。
 *   2. **worktree band**（registry `dev_ports.worktree_band`，4200–4899 區）—— base 池只有
 *      9 格，而單一 consumer 開到十幾條 worktree 是常態。band 是每個 consumer 各自 50 個
 *      號碼的專屬區段，與所有 base、dev-router 的 control/backend 區（3300–3510）完全不重疊。
 *
 * 兩池都排掉三件事：mapped port 落到別人的地盤、mapped port 撞到本 consumer 另一個宣告 port
 * （<consumer-a> 宣告 3040 + 3045）、offset 已被 sibling worktree 佔用。
 *
 * 分配紀錄寫在 `~/.cache/clade/dev-port/<consumer>/<slug>.json`，**不**進 repo：`.clade/` 在
 * 多數 consumer 沒被 gitignore，寫進去等於每條 worktree 帶一個 untracked 檔進 merge-back /
 * publish 的 dirty 判定。worktree 目錄消失即釋放槽位，不需要手動回收。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'

export interface DeclaredDevPort {
  port: number
  alias: string
}

/** `[start, end]`，兩端皆含。 */
export type WorktreePortBand = [number, number]

export interface WorktreeDevPortRecord {
  offset: number
  base: number
  wtPath: string
  ports: { alias: string; port: number; mainPort: number }[]
  /** 這個 offset 來自哪個池。舊紀錄沒有這欄，一律視為 `base`。 */
  pool?: 'base' | 'band'
}

/** registry 把各 consumer 的 base 排成 +10 間距，所以 base+1..base+9 屬於這個 consumer。 */
export const DEV_PORT_BAND = 9

/**
 * 分配紀錄放在 repo 外。寫進 `.clade/` 會在約 7 個 consumer（其 `.gitignore` 沒涵蓋該路徑）
 * 的每一條 worktree 留下 untracked 檔，而那正好出現在 merge-back / publish 這兩個把 dirty
 * 當風險的流程裡。
 */
export function devPortStateDir(consumerRoot: string): string {
  return join(
    process.env.XDG_CACHE_HOME || join(process.env.HOME || '', '.cache'),
    'clade',
    'dev-port',
    basename(consumerRoot),
  )
}

/**
 * base 池：1..9 之中最小的可用 offset，需同時滿足
 *   - 每個 mapped port 都在 `[base, base+9]` 內 —— 不會踩到下一個 consumer 的 base
 *   - mapped port 不等於本 consumer 另一個宣告 port（<consumer-a> 宣告 3040 + 3045，offset 5 會讓
 *     `<client-a>` 蓋掉 `shared`）
 *   - offset 沒被 sibling worktree 佔用
 * 池滿回 null（由 band 池接手）。
 */
export function pickDevPortOffset(
  declared: readonly DeclaredDevPort[],
  usedOffsets: ReadonlySet<number>,
): number | null {
  if (declared.length === 0) return null
  const base = declared[0].port
  const declaredSet = new Set(declared.map((d) => d.port))
  for (let n = 1; n <= DEV_PORT_BAND; n++) {
    if (usedOffsets.has(n)) continue
    const mapped = declared.map((d) => d.port + n)
    if (mapped.some((p) => p > base + DEV_PORT_BAND)) continue
    if (mapped.some((p) => declaredSet.has(p))) continue
    return n
  }
  return null
}

/**
 * band 池：把 band 切成寬度 `spread + 1` 的槽（spread = 最高宣告 port − base），逐槽試。
 *
 * 回傳的仍是**一個 offset**（`槽首 − base`），與 base 池同型 —— 下游每個消費端算 port 的方式
 * 只有一條：`宣告 port + offset`。band 池回來的 offset 是三位數起跳（<consumer-b> base 3000、band
 * 4400 → offset 1400），那是刻意的：任何地方若把 offset 當成「1..9 的小數字」處理都會當場
 * 露餡，而不是安靜地算出一個別人的 port。
 */
export function pickBandPortOffset(
  declared: readonly DeclaredDevPort[],
  usedOffsets: ReadonlySet<number>,
  band: WorktreePortBand | null,
): number | null {
  if (declared.length === 0 || !band) return null
  const [start, end] = band
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return null
  const base = declared[0].port
  const spread = declared[declared.length - 1].port - base
  const width = spread + 1
  for (let slotStart = start; slotStart + spread <= end; slotStart += width) {
    const offset = slotStart - base
    if (usedOffsets.has(offset)) continue
    return offset
  }
  return null
}

/**
 * 這棵 worktree 該用的 offset。base 池優先，滿了才進 band；兩池都滿回 null。
 *
 * **NEVER** 在這裡 fallback 到 offset 0（= base port）—— 那正是「兩條 worktree 指向同一台
 * dev server」這個 bug 的形狀，而它不會報錯，只會讓某個人的驗收畫面顯示別人的 code。
 */
export function allocateDevPortOffset(
  declared: readonly DeclaredDevPort[],
  usedOffsets: ReadonlySet<number>,
  band: WorktreePortBand | null,
): number | null {
  return pickDevPortOffset(declared, usedOffsets) ?? pickBandPortOffset(declared, usedOffsets, band)
}

/**
 * 這個 consumer 實際能發出幾個槽位。
 *
 * **不是** `DEV_PORT_BAND + band 寬度`：每個宣告 port 套同一個 offset，所以最高的那個宣告
 * port 先撞到天花板 —— 宣告 3040 + 3045 的 consumer 在 9 寬的 base 池裡只有 4 格。把池寬
 * 當容量報出去，等於告訴讀者「還有 5 格」，而那正是他在決定要不要清掉一條 worktree 時
 * 最不該相信的數字。
 *
 * 用窮舉 `allocateDevPortOffset` 得出，不另算一份算術 —— 兩者不可能不一致。
 */
export function devPortCapacity(
  declared: readonly DeclaredDevPort[],
  band: WorktreePortBand | null = null,
): number {
  const used = new Set<number>()
  for (;;) {
    const offset = allocateDevPortOffset(declared, used, band)
    if (offset === null) return used.size
    used.add(offset)
  }
}

/**
 * 其他 worktree 佔著的 offset。worktree 目錄已消失的紀錄在這裡順手刪掉 —— 那就是「釋放
 * 槽位」的全部動作，所以任何清理路徑都不必記得做額外的 deallocate。
 */
export function siblingDevPortOffsets(consumerRoot: string, selfWtPath: string): Set<number> {
  const dir = devPortStateDir(consumerRoot)
  const used = new Set<number>()
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return used
  }
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const p = join(dir, name)
    let rec: WorktreeDevPortRecord
    try {
      rec = JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      continue
    }
    if (!rec?.wtPath || !existsSync(rec.wtPath)) {
      try {
        unlinkSync(p)
      } catch {
        // 別人先刪了；槽位反正是空的。
      }
      continue
    }
    if (resolve(rec.wtPath) === resolve(selfWtPath)) continue
    if (Number.isInteger(rec.offset)) used.add(rec.offset)
  }
  return used
}

/** `wtPath` 這棵 worktree 的分配紀錄；沒有回 null。 */
export function readWorktreeDevPorts(
  consumerRoot: string,
  wtPath: string,
): WorktreeDevPortRecord | null {
  const p = join(devPortStateDir(consumerRoot), `${basename(wtPath)}.json`)
  try {
    const rec = JSON.parse(readFileSync(p, 'utf8'))
    return resolve(rec.wtPath ?? '') === resolve(wtPath) ? rec : null
  } catch {
    return null
  }
}

/** 分配並落檔。宣告不出 port、或兩池都滿 → null。 */
export function allocateWorktreeDevPorts(
  consumerRoot: string,
  wtPath: string,
  declared: readonly DeclaredDevPort[],
  band: WorktreePortBand | null = null,
): WorktreeDevPortRecord | null {
  if (declared.length === 0) return null
  const offset = allocateDevPortOffset(declared, siblingDevPortOffsets(consumerRoot, wtPath), band)
  if (offset === null) return null
  const record: WorktreeDevPortRecord = {
    offset,
    base: declared[0].port,
    wtPath: resolve(wtPath),
    ports: declared.map((d) => ({ alias: d.alias, port: d.port + offset, mainPort: d.port })),
    pool: offset <= DEV_PORT_BAND ? 'base' : 'band',
  }
  const dir = devPortStateDir(consumerRoot)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${basename(wtPath)}.json`), `${JSON.stringify(record, null, 2)}\n`)
  return record
}

/**
 * 已有紀錄就用它，沒有就當場配一個。
 *
 * 「當場配」是這條路徑存在的理由：worktree 可能建立於分配機制之前、或建立當時 base 池正好
 * 滿了。若在那種情況下退回 base port，畫面上看到的是一個**已經在跑、但服務別條 worktree**
 * 的 dev server —— 而那與「這條 worktree 的 dev server 已就緒」長得一模一樣。
 */
export function ensureWorktreeDevPorts(
  consumerRoot: string,
  wtPath: string,
  declared: readonly DeclaredDevPort[],
  band: WorktreePortBand | null = null,
): WorktreeDevPortRecord | null {
  return (
    readWorktreeDevPorts(consumerRoot, wtPath) ??
    allocateWorktreeDevPorts(consumerRoot, wtPath, declared, band)
  )
}

/**
 * `mainPort → 這棵 worktree 的 port`。main working tree（或沒有紀錄）回空 Map，呼叫端照原
 * 宣告值走 —— main 的 port 一個字都不改是 [[dev-port-allocation]] §4 的硬條件（OAuth
 * redirect URI、tunnel hostname 都釘在它上面）。
 */
export function worktreeDevPortMap(record: WorktreeDevPortRecord | null): Map<number, number> {
  const map = new Map<number, number>()
  for (const p of record?.ports ?? []) {
    if (Number.isInteger(p.mainPort) && Number.isInteger(p.port)) map.set(p.mainPort, p.port)
  }
  return map
}

/**
 * 這個 consumer 的 worktree port 會落在哪幾段。**回一組區間，NEVER 塌成一個** ——
 * base 池（`base+1..base+9`）與 band（4200 區）中間隔著其他 consumer 的 base，塌成
 * `[base+1, band.end]` 的單一區間等於把整段 3000–4899 都宣告成自己的，preview identity
 * gate 會據此把別人的畫面當成這個 consumer 的轉出去。
 */
export function worktreePortRanges(
  declared: readonly DeclaredDevPort[],
  band: WorktreePortBand | null,
): WorktreePortBand[] {
  const ranges: WorktreePortBand[] = []
  if (declared.length > 0) {
    const base = declared[0].port
    const top = declared[declared.length - 1].port
    ranges.push([base + 1, Math.max(base, top) + DEV_PORT_BAND])
  }
  if (band) ranges.push([band[0], band[1]])
  return ranges
}
