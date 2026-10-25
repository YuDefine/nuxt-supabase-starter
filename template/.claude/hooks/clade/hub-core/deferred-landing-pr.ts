#!/usr/bin/env node
/**
 * deferred-landing-pr.ts — 延後落地分支上擋 `gh pr create`／`gh pr ready`（CDB-521，Charles 2026-10-19 /sg）。
 *
 * 為什麼存在：CI 擁塞／PR 背壓時派出的延後落地件（coordinator 派工判準 Rule 8 § 延後落地）在 WIP gate 以 C7 放行，
 * 前提是 worker 只 push 分支、不開 PR——PR 由 watch 在閥放行後從待開 PR 佇列照同一組閾值代開。worker 違規自己開
 * PR，被放行的件就一起湧進 CI，正好打穿閘門。brief 的落地段只是文字；這支在開 PR 那一刻機械擋下。
 *
 * 標記：`brief.ts worker` 帶 `deferred_pr` 產 brief（--out）時，在該樹的 repo 設
 * `git config branch.<branch>.cladeDeferredLanding true`（peer 樹經 ssh 設在 peer 上，所以 peer 的 worker 讀得到）；
 * watch 代開成功後由 `coordinator-pr-triage.ts open-deferred` 清掉。本檔只讀標記。
 *
 * 兩個入口共用這一份判定：
 *   - fleet：`pre-bash-deferred-landing-pr-gate.sh`（同目錄）以 stdin 餵 hook payload 執行本檔
 *   - clade home：`.claude/hooks/clade-home-guard.ts` import `deferredLandingPrViolation`
 *
 * Threat model：守的是照 brief 做事、但手滑或沿用舊習慣開 PR 的 worker；不承諾擋住刻意繞過的 agent（改 git config、
 * 經 GitHub UI／API 開、換 harness）——那一層由 PR 分診的事後偵測（`deferred-pr-violation`）抓。
 * Gate 型別：PreToolUse:Bash block（exit 2），絆索不是牆。
 *
 *   | 判不出的東西 | 結果 |
 *   | --- | --- |
 *   | 不是命令位置的 `gh pr create|ready`（echo、heredoc 本文） | 放行 |
 *   | `--head` 是變數展開、cwd 不是 git 樹、讀不到 branch | 放行（事後偵測兜底） |
 *   | git config 讀失敗、stdin 不是 JSON、解析丟例外 | 放行 |
 *
 * Locked 面：本檔、wrapper、`test/deferred-landing-pr-gate.test.ts`。bootstrap＝隨 clade PR 合入、publish 散播；
 * update＝走 clade PR；recovery（gate 誤擋）＝主持者核對該件確實已不在佇列後 `git config --unset branch.<b>.cladeDeferredLanding`，
 * 或讓 watch 代開（代開成功會清標記）。沒有環境變數逃生門：逃生門 worker 也拿得到。
 *
 *   | REQUIRED 欄位 | 內容 |
 *   | --- | --- |
 *   | 觸發條件 | Bash 的 `gh pr create`（`--head` 或 cwd 的 branch）／`gh pr ready`（cwd 的 branch）指向帶 `cladeDeferredLanding` 標記的 branch → exit 2 |
 *   | 消費端 | 延後落地件的 worker（stderr 說明改為 push 分支後 `--complete success`）；下游是 watch 的待開 PR 佇列 |
 *   | 觸發點 | 工具事件 hook：`pre-bash-deferred-landing-pr-gate.sh`（fleet）與 `.claude/hooks/clade-home-guard.ts`（clade home）；訊息由 test/deferred-landing-pr-gate.test.ts 釘住 |
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { segments, words, WRAPPERS } from './gh-pr-create-work.ts'

/** 標記的 git config key（branch 子段）：`branch.<branch>.cladeDeferredLanding`。 */
export const DEFERRED_LANDING_CONFIG = 'cladeDeferredLanding'

export interface PrCall {
  sub: 'create' | 'ready'
  /** `gh pr create --head <b>` 指定的 branch（`owner:branch` 取冒號後）；沒指定 null；變數展開 'dynamic'。 */
  head: string | null | 'dynamic'
}

/** 一個 segment 若是命令位置的 `gh … pr create|ready`，回傳呼叫；不是回 null。 */
export function prCall(seg: string): PrCall | null {
  const w = words(seg)
  let i = 0
  // 命令位置：前置 env assignment、`env`、`command` 與 shell wrapper 都跳過
  while (
    i < w.length &&
    (/^[A-Za-z_][A-Za-z_0-9]*=/.test(w[i]!.text) ||
      ['env', 'command', '-p', '--'].includes(w[i]!.text) ||
      WRAPPERS.has(w[i]!.text))
  )
    i++
  const lead = (w[i]?.text ?? '').replace(/^[({!]+/u, '')
  if (!(lead === 'gh' || lead.endsWith('/gh'))) return null
  const pr = w.findIndex((x, k) => k > i && x.text === 'pr')
  const sub = w[pr + 1]?.text
  if (pr === -1 || (sub !== 'create' && sub !== 'ready')) return null
  if (sub === 'ready') return { sub, head: null }
  const args = w.slice(pr + 2)
  for (let k = 0; k < args.length; k++) {
    const a = args[k]!.text
    const inline = /^--head=/u.exec(a)
    const v = inline
      ? { text: a.slice(7), dynamic: args[k]!.dynamic }
      : a === '--head' || a === '-H'
        ? args[++k]
        : null
    if (!v) continue
    if (v.dynamic) return { sub, head: 'dynamic' }
    return { sub, head: v.text.includes(':') ? v.text.slice(v.text.indexOf(':') + 1) : v.text }
  }
  return { sub, head: null }
}

export interface MarkerProbe {
  /** cwd 那棵樹目前的 branch；讀不到 null。 */
  branchOf: (cwd: string) => string | null
  /** 該 repo 的 branch 帶延後落地標記。 */
  marked: (cwd: string, branch: string) => boolean
}

function git(cwd: string, args: string[]): string | null {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 5_000 })
  return r.status === 0 ? r.stdout.trim() : null
}

export const defaultMarkerProbe: MarkerProbe = {
  branchOf: (cwd) => git(cwd, ['symbolic-ref', '--short', 'HEAD']),
  marked: (cwd, branch) =>
    git(cwd, ['config', '--get', `branch.${branch}.${DEFERRED_LANDING_CONFIG}`]) === 'true',
}

/** 違規時回傳 branch 與子指令，否則 null。判不出一律放行（見檔頭表）。 */
export function deferredLandingPrViolation(
  cmd: string,
  cwd: string,
  probe: MarkerProbe = defaultMarkerProbe,
): { branch: string; sub: PrCall['sub'] } | null {
  if (!/\bgh\b[\s\S]*\bpr\b[\s\S]*\b(?:create|ready)\b/u.test(cmd)) return null
  for (const seg of segments(cmd)) {
    const call = prCall(seg)
    if (!call || call.head === 'dynamic') continue
    const branch = call.head ?? probe.branchOf(cwd)
    if (branch && probe.marked(cwd, branch)) return { branch, sub: call.sub }
  }
  return null
}

export function deferredLandingDeny(v: { branch: string; sub: PrCall['sub'] }): string {
  return (
    `⛔ gh pr ${v.sub}：branch ${v.branch} 是延後落地件（CI 擁塞／PR 背壓時照派、只 push 分支），**NEVER** 自己開 PR／轉 ready。\n` +
    `  照 brief 落地段：本機 gate 綠 → commit 明確 pathspec → git push origin ${v.branch} → --complete success（回報 head SHA 與分支名）。\n` +
    `  PR 由 watch 在 CI 閥放行後從待開 PR 佇列（~/.cache/clade/coordinator/pending-pr-queue.json）依優先序代開。`
  )
}

function main() {
  let input: { tool_input?: { command?: unknown }; cwd?: string } = {}
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return
  }
  const cmd = typeof input.tool_input?.command === 'string' ? input.tool_input.command : ''
  if (!cmd) return
  let v: ReturnType<typeof deferredLandingPrViolation>
  try {
    v = deferredLandingPrViolation(cmd, input.cwd || process.cwd())
  } catch {
    return
  }
  if (!v) return
  process.stderr.write(`${deferredLandingDeny(v)}\n`)
  process.exitCode = 2
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
