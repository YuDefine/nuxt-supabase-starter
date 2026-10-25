// 🔒 LOCKED — managed by clade · Source: vendor/scripts/retired-ledger.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/retired-ledger.ts
/**
 * retired-ledger.ts — 已退休 worktree／branch 的墓碑（「已退休 identity 不得推回 continuation」的謂詞來源）。
 *
 * 載體是 flow spine（`.clade/flow/events.jsonl`）：每筆墓碑是一個 `kind: 'other'` 的 point 事件，
 * `payload.marker === 'worktree.retire'`，`payload.row` 是原本 manifest 一列（`retired-work/v1`）的瘦身版。
 * 取代 `docs/archives/retired-work.jsonl`（W-2026-09-20-non-lifecycle-archive-retire US4，
 * Charles 2026-10-10 拍板 FR-010：A. flow spine）。
 *
 * - 寫：只寫 spine。`docs/archives/retired-work.jsonl` NEVER 再被追加（新增列數 0）。
 * - 讀：舊 jsonl 若還在，列逐行唯讀併進來（FR-011：既有列先保持可讀），之後才是 spine 的列；
 *   讀者因此對「舊 retire 留下的墓碑」與「新 retire 留下的墓碑」一視同仁。
 * - fail-closed：`appendRetirementRow` 回 `false`（spine 寫不進去、`CLADE_FLOW_OFF=1`、linked worktree 的
 *   main checkout 不見了）時，呼叫端 MUST 不得移除來源。spine 的 emit 本身是 fail-open，
 *   但墓碑不是遙測：沒寫成功就當沒有墓碑。
 * - spine 對 payload 做不可旁路的 redaction，`/home/<user>`、`/Users/<user>` 會被改寫成 `<HOME>`。
 *   讀回來時只把 `<HOME>` 還原成本機 `homedir()`（同機同使用者才成立；還原不出來的路徑讓比對失敗＝保守留下）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isRecord, parseJsonRecord } from './lib/json-unknown.ts'

// clade keeps flow beside this file; consumers receive the same modules under
// .clade/vendor/scripts/flow（wt-batch.ts 同一套解法）。靜態 `./flow/emit.ts` 在 consumer 的
// scripts/ 底下會 ERR_MODULE_NOT_FOUND，所以載入時解一次現存的投影。
const scriptDir = dirname(fileURLToPath(import.meta.url))
const localFlowDir = join(scriptDir, 'flow')
const flowDir = existsSync(join(localFlowDir, 'emit.ts'))
  ? localFlowDir
  : join(scriptDir, '..', '.clade', 'vendor', 'scripts', 'flow')
const { emitEvent, eventsPath, mintWorkId, newSpanId, openWorkOnce, readEventsFile } =
  (await import(pathToFileURL(join(flowDir, 'emit.ts')).href)) as typeof import('./flow/emit.ts')

export const RETIRED_MARKER = 'worktree.retire'
export const RETIRED_SCHEMA = 'retired-work/v1'

/** 舊載體。只讀，NEVER 寫。 */
export function legacyRetirementManifest(root: string) {
  return join(root, 'docs', 'archives', 'retired-work.jsonl')
}

export type RetirementRow = Record<string, unknown>

/** spine 裡不需要的欄位（`recovery` 是長 shell 指令，`archive/metadata.json` 已有同一份）。 */
const SPINE_ROW_OMIT = new Set(['recovery', 'submoduleBundles'])

function slimRow(row: RetirementRow): RetirementRow {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !SPINE_ROW_OMIT.has(key)))
}

const restoreHome = (value: string, home: string) => value.replaceAll('<HOME>', home)

/** 把 redaction 改寫過的 `<HOME>` 還原；只動讀者會拿去比對或開檔的欄位。 */
function restoreRow(row: RetirementRow, home: string): RetirementRow {
  const out: RetirementRow = { ...row }
  for (const key of ['identity', 'archive'])
    if (typeof out[key] === 'string') out[key] = restoreHome(out[key], home)
  if (isRecord(out.original)) {
    const original: Record<string, unknown> = { ...out.original }
    for (const key of ['path', 'branch'])
      if (typeof original[key] === 'string') original[key] = restoreHome(original[key], home)
    out.original = original
  }
  return out
}

/**
 * 追加一筆墓碑到 spine。回傳是否確實寫入；`false` 時呼叫端 MUST 當作墓碑不存在（不得移除來源）。
 * `cwd` 決定落哪條 spine（linked worktree 會落到 main checkout 的那條）。
 */
export function appendRetirementRow(row: RetirementRow, options: { cwd: string }): boolean {
  const identity = typeof row.identity === 'string' ? row.identity : ''
  const ambient = process.env.CLADE_WORK_ID?.trim()
  const workId = ambient || mintWorkId('worktree-retire')
  // 墓碑可能掛在沒人開過卡的 id 上：補一筆 work.open。ambient id 是別人的工作，只補出生事件、
  // NEVER 取名（first-title-wins，會讓那張卡永遠叫「退役墓碑」）；自鑄的才命名。
  openWorkOnce({
    work_id: workId,
    slug: ambient ? '' : 'worktree-retire',
    title: ambient ? null : 'worktree 退役墓碑',
    actor: 'handoff-retire',
    substrate: 'git',
    cwd: options.cwd,
  })
  const written = emitEvent({
    work_id: workId,
    span_id: newSpanId(),
    phase: 'point',
    kind: 'other',
    actor: 'handoff-retire',
    substrate: 'git',
    session_id: null,
    payload: { marker: RETIRED_MARKER, identity, status: row.status ?? null, row: slimRow(row) },
    outcome: null,
    cwd: options.cwd,
  })
  return written.written === true
}

function legacyRows(path: string, skipInvalid: boolean): RetirementRow[] {
  if (!existsSync(path)) return []
  const rows: RetirementRow[] = []
  for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
    if (!line) continue
    try {
      rows.push(parseJsonRecord(line))
    } catch (error) {
      if (skipInvalid) continue
      throw new Error(`Invalid retirement manifest ${path}:${index + 1}: ${String(error)}`, {
        cause: error,
      })
    }
  }
  return rows
}

function spineRows(path: string, home: string): RetirementRow[] {
  if (!existsSync(path)) return []
  const rows: RetirementRow[] = []
  for (const event of readEventsFile(path)) {
    const payload = event.payload
    if (event.kind !== 'other' || !isRecord(payload) || payload.marker !== RETIRED_MARKER) continue
    if (isRecord(payload.row)) rows.push(restoreRow(payload.row, home))
  }
  return rows
}

/**
 * 所有墓碑列，舊在前新在後：舊 jsonl（唯讀）＋ spine。
 * 舊 jsonl 有壞行時 throw（沿用原本 fail-closed）；spine 壞行由 spine 讀者略過。
 */
export function readRetirementRows(options: {
  /** repo 根（main checkout 或任一 worktree）；決定 spine 位置與預設舊 jsonl 位置 */
  cwd: string
  /** 舊 jsonl 路徑；預設 `<cwd>/docs/archives/retired-work.jsonl` */
  legacyManifest?: string
  /** 舊 jsonl 的壞行：預設 throw（fail-closed）；清理類讀者可略過壞行、只信驗得過的列 */
  skipInvalid?: boolean
  /** 測試注入：`<HOME>` 的還原目標 */
  home?: string
}): RetirementRow[] {
  const legacy = options.legacyManifest ?? legacyRetirementManifest(options.cwd)
  return [
    ...legacyRows(legacy, options.skipInvalid === true),
    ...spineRows(eventsPath(options.cwd), options.home ?? homedir()),
  ]
}

/** 已完成退休（`status: 'retired'`）的 identity 清單。 */
export function retiredIdentities(options: Parameters<typeof readRetirementRows>[0]): string[] {
  return readRetirementRows(options).flatMap((row) =>
    row.status === 'retired' && typeof row.identity === 'string' ? [row.identity] : [],
  )
}
