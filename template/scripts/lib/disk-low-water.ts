#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/disk-low-water.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/disk-low-water.ts
/**
 * disk-low-water.ts — 磁碟低水位三級判定與入口准入（W-2026-10-01-disk-low-water-guard）
 *
 * 2026-10-01 desk / 寫滿：routing gate 空 lock 卡死 5 個 session、<consumer-a> 安全掃描 ENOSPC、
 * transcript 寫入失敗。回收 timer 在跑，但新樹、新 pane、publish gate 照開，寫入速度贏過回收。
 * 本檔是所有入口與 timer 共用的同一份門檻：
 *
 *   ok      ≥ warn
 *   warn    < CLADE_DISK_WARN_GB（預設 25）     入口放行、stderr 一行警告
 *   block   < CLADE_DISK_BLOCK_GB（預設 15）    新樹／新 pane／publish／security-scan exit 75
 *   reclaim < CLADE_DISK_RECLAIM_GB（預設 8）   同 block，另由 disk-hygiene 跑緊急 worktree 回收
 *
 * 門檻是絕對 GiB：要保護的是一次 publish gate／一棵新樹要寫的 bytes，那由工作量決定，
 * 不隨磁碟大小縮放。量 `/` 與 `$HOME` 所在檔案系統，取較緊者；`/tmp` 不算——它是固定大小
 * 的 tmpfs，有自己的 tmp-capacity 准入。
 *
 * 只有建立新工作的入口呼叫 `enforceDiskAdmission`。completion、cleanup、merge-back、
 * disk-hygiene 自己永遠不呼叫：它們不是釋放空間就是收尾，擋了只會更糟。
 *
 * 失敗語義：statfs 拋錯 → 准入 fail-open（放行並警告）。准入守門自己壞掉不能變成全面停擺。
 *
 * 用法（CLI）：
 *   node vendor/scripts/lib/disk-low-water.ts --brief    # "<tier> <availGiB> <warn> <block> <reclaim>"
 *   node vendor/scripts/lib/disk-low-water.ts --json
 *   node vendor/scripts/lib/disk-low-water.ts admit <op>  # block／reclaim → exit 75
 *
 * 測試注入：`CLADE_DISK_STATFS`（JSON `{"bavail","bsize","blocks"}`，套用到每個量測點）。
 */

import { appendFileSync, mkdirSync, statfsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRecord } from './json-unknown.ts'

export type DiskTier = 'ok' | 'warn' | 'block' | 'reclaim'

export interface DiskThresholds {
  warnGiB: number
  blockGiB: number
  reclaimGiB: number
}

export const DEFAULT_THRESHOLDS: DiskThresholds = { warnGiB: 25, blockGiB: 15, reclaimGiB: 8 }
export const DISK_ADMISSION_EXIT = 75 // EX_TEMPFAIL：等空間回來再試
const GIB = 1024 ** 3

export interface DiskMeasurement {
  path: string
  availableBytes: number
  totalBytes: number
}

export interface DiskStatus {
  tier: DiskTier
  tightest: DiskMeasurement
  thresholds: DiskThresholds
  warnings: string[]
}

function positive(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : Number.NaN
}

/**
 * 讀門檻。矛盾（非 warn > block > reclaim > 0）或格式錯 → 整組退回預設並回警告：
 * 錯設定不能把守門關掉。`CLADE_DISK_WARN_ROOT_GB` 是 SessionStart 舊名，保留為 warn 的 alias。
 */
export function diskThresholds(env: NodeJS.ProcessEnv = process.env): {
  thresholds: DiskThresholds
  warnings: string[]
} {
  const warn = positive(env.CLADE_DISK_WARN_GB ?? env.CLADE_DISK_WARN_ROOT_GB)
  const block = positive(env.CLADE_DISK_BLOCK_GB)
  const reclaim = positive(env.CLADE_DISK_RECLAIM_GB)
  const candidate: DiskThresholds = {
    warnGiB: warn ?? DEFAULT_THRESHOLDS.warnGiB,
    blockGiB: block ?? DEFAULT_THRESHOLDS.blockGiB,
    reclaimGiB: reclaim ?? DEFAULT_THRESHOLDS.reclaimGiB,
  }
  const values = [candidate.warnGiB, candidate.blockGiB, candidate.reclaimGiB]
  if (
    values.some((v) => !Number.isFinite(v)) ||
    !(candidate.warnGiB > candidate.blockGiB && candidate.blockGiB > candidate.reclaimGiB)
  ) {
    return {
      thresholds: { ...DEFAULT_THRESHOLDS },
      warnings: [
        `disk-low-water: 門檻設定無效（warn=${candidate.warnGiB} block=${candidate.blockGiB} reclaim=${candidate.reclaimGiB}，須 warn > block > reclaim > 0），退回預設 ${DEFAULT_THRESHOLDS.warnGiB}/${DEFAULT_THRESHOLDS.blockGiB}/${DEFAULT_THRESHOLDS.reclaimGiB} GiB`,
      ],
    }
  }
  return { thresholds: candidate, warnings: [] }
}

export function tierFor(availableBytes: number, t: DiskThresholds): DiskTier {
  if (availableBytes < t.reclaimGiB * GIB) return 'reclaim'
  if (availableBytes < t.blockGiB * GIB) return 'block'
  if (availableBytes < t.warnGiB * GIB) return 'warn'
  return 'ok'
}

function statfsFor(
  path: string,
  env: NodeJS.ProcessEnv,
): { bavail: number; bsize: number; blocks: number } {
  const fixture = env.CLADE_DISK_STATFS
  if (!fixture) {
    const fs = statfsSync(path)
    return { bavail: Number(fs.bavail), bsize: Number(fs.bsize), blocks: Number(fs.blocks) }
  }
  const parsed: unknown = JSON.parse(fixture)
  const raw = isRecord(parsed) ? parsed : {}
  const num = (k: string): number => {
    const v = raw[k]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
      throw new Error(`CLADE_DISK_STATFS: ${k} must be a non-negative number`)
    return v
  }
  return { bavail: num('bavail'), bsize: num('bsize'), blocks: num('blocks') }
}

/** 量 `/` 與 `$HOME`；同一個檔案系統只量一次。 */
export function measureDisk(env: NodeJS.ProcessEnv = process.env): DiskMeasurement[] {
  const roots = [env.CLADE_DISK_ROOT || '/', env.HOME || homedir()]
  const seen = new Set<string>()
  const out: DiskMeasurement[] = []
  for (const path of roots) {
    let dev: string
    try {
      dev = env.CLADE_DISK_STATFS ? path : String(statSync(path).dev)
    } catch {
      continue
    }
    if (seen.has(dev)) continue
    seen.add(dev)
    const fs = statfsFor(path, env)
    out.push({ path, availableBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize })
    if (env.CLADE_DISK_STATFS) break // fixture 對每個點都一樣，量一次即可
  }
  if (!out.length) throw new Error('disk-low-water: 沒有可量測的檔案系統')
  return out
}

export function diskStatus(env: NodeJS.ProcessEnv = process.env): DiskStatus {
  const { thresholds, warnings } = diskThresholds(env)
  const tightest = measureDisk(env).reduce((a, b) => (b.availableBytes < a.availableBytes ? b : a))
  return { tier: tierFor(tightest.availableBytes, thresholds), tightest, thresholds, warnings }
}

const gib = (bytes: number): string => (bytes / GIB).toFixed(1)

export const RECLAIM_HINT =
  'bash ~/offline/clade/ops/disk-hygiene.sh run --dry-run（看清單後去掉 --dry-run）'

export interface AdmissionVerdict {
  allowed: boolean
  tier: DiskTier | 'unknown'
  message: string
}

/** 純判定，不寫 stderr、不 exit；`enforceDiskAdmission` 是它的副作用版。 */
export function diskAdmission(op: string, env: NodeJS.ProcessEnv = process.env): AdmissionVerdict {
  // `node --test` 底下（NODE_TEST_CONTEXT 會傳到測試 spawn 的子行程）沒注入 fixture 就不量真實磁碟：
  // 數百支測試會實跑 wt-helper add／派 pane，主機或 runner 一低水位就整片假紅——與 #203
  // （runner 剩 834 MB，81 支 capture 測試紅）同一型。要測准入本身，注入 CLADE_DISK_STATFS。
  if (env.NODE_TEST_CONTEXT && !env.CLADE_DISK_STATFS)
    return { allowed: true, tier: 'ok', message: '' }
  let status: DiskStatus
  try {
    status = diskStatus(env)
  } catch (error) {
    return {
      allowed: true,
      tier: 'unknown',
      message: `⚠️ disk-low-water: ${op} 量不到磁碟水位（${error instanceof Error ? error.message : String(error)}），放行`,
    }
  }
  const { tier, tightest, thresholds } = status
  const prefix = status.warnings.map((w) => `⚠️ ${w}\n`).join('')
  const where = `${tightest.path} 可用 ${gib(tightest.availableBytes)}G`
  if (tier === 'ok') return { allowed: true, tier, message: prefix }
  if (tier === 'warn')
    return {
      allowed: true,
      tier,
      message: `${prefix}⚠️ 磁碟低水位：${where} < ${thresholds.warnGiB}G（L1 warn）；${op} 放行。回收：${RECLAIM_HINT}`,
    }
  const level =
    tier === 'reclaim'
      ? `${thresholds.reclaimGiB}G（L3 reclaim）`
      : `${thresholds.blockGiB}G（L2 block）`
  const override = env.CLADE_DISK_ADMISSION_OVERRIDE?.trim()
  if (override)
    return {
      allowed: true,
      tier,
      message: `${prefix}⚠️ 磁碟低水位：${where} < ${level}；${op} 以 CLADE_DISK_ADMISSION_OVERRIDE 放行：${override}`,
    }
  return {
    allowed: false,
    tier,
    message:
      `${prefix}✗ 磁碟低水位准入：${where} < ${level}，擋下 ${op}。\n` +
      `  先回收：${RECLAIM_HINT}\n` +
      `  completion／cleanup／merge-back 不受影響；確定要硬開，設 CLADE_DISK_ADMISSION_OVERRIDE='<理由>' 單次放行（會記錄）。`,
  }
}

function logOverride(op: string, verdict: AdmissionVerdict, env: NodeJS.ProcessEnv): void {
  const file =
    env.CLADE_DISK_ADMISSION_LOG ||
    join(env.HOME || homedir(), '.local', 'state', 'clade', 'disk-admission.log')
  try {
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(
      file,
      `${JSON.stringify({ at: new Date().toISOString(), op, tier: verdict.tier, reason: env.CLADE_DISK_ADMISSION_OVERRIDE, cwd: process.cwd() })}\n`,
    )
  } catch {
    // log 寫不進去（多半正是因為磁碟滿）不改變放行結果；stderr 已印理由。
  }
}

/** 建立新工作的入口呼叫：block／reclaim 時印原因並 exit 75。 */
export function enforceDiskAdmission(op: string, env: NodeJS.ProcessEnv = process.env): void {
  const verdict = diskAdmission(op, env)
  if (verdict.message) process.stderr.write(`${verdict.message.replace(/\n$/, '')}\n`)
  if (!verdict.allowed) process.exit(DISK_ADMISSION_EXIT)
  if (verdict.tier === 'block' || verdict.tier === 'reclaim') logOverride(op, verdict, env)
}

function main(argv: string[]): number {
  if (argv[0] === 'admit') {
    enforceDiskAdmission(argv[1] || 'unnamed-op')
    return 0
  }
  const status = diskStatus()
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(status)}\n`)
    return 0
  }
  if (argv.includes('--brief')) {
    const t = status.thresholds
    process.stdout.write(
      `${status.tier} ${Math.floor(status.tightest.availableBytes / GIB)} ${t.warnGiB} ${t.blockGiB} ${t.reclaimGiB}\n`,
    )
    return 0
  }
  process.stderr.write('Usage: disk-low-water.ts --brief | --json | admit <op>\n')
  return 2
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.exit(main(process.argv.slice(2)))
