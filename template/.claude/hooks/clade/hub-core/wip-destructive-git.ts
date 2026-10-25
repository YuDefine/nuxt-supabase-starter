#!/usr/bin/env node
/**
 * wip-destructive-git.ts — 擋會覆寫工作檔或丟 WIP 的 git 指令（W-2026-10-07-context-engineering-cleanup 批次 0）。
 *
 * 為什麼存在：`rules/core/commit.md` §「Git 命令禁令」只是文字，agent 在「清場」「還原剛才為了驗證改的檔」
 * 時照樣會跑 `git checkout -- .`、`git restore <path>`、`git reset --hard`，丟掉的是本次工作開始前就在的 WIP，
 * 沒有還原路徑。在那一刻擋下比事後考古便宜。matcher 規格（每種變體、放行面、不在本批的範圍）：
 * `docs/rule-rationale/wip-destructive-git-matcher-spec.md`。
 *
 * fleet 入口：`pre-bash-wip-destructive-git-gate.sh`（同目錄）以 stdin 餵 hook payload 執行本檔。
 *
 * threat model：防漂移，不防主動規避。絆索不是牆：只看 agent 的 Bash tool call；`node -e`、腳本檔、
 * 子行程裡的 git 看不到，字串比對型判定也只認常見入口（見 matcher 規格）。
 * gate 型別：安全型（擋「不可逆地丟掉 WIP」這件不該發生的事）。判不出來倒向擋：
 * `git checkout <x>` 分不出 path 與 branch 時 fail closed（擋）；判定自身故障時也不放行，
 * 退回只認不可逆形式的保守樣式，見下方錯誤分支表。
 *
 * 錯誤分支表（判定故障的出口都在外殼 `.sh`，由外殼自己決定 exit code；NEVER 沿用判定行程的非 0／2 退出碼，
 * harness 把它當 non-blocking，tool call 照跑）。「保守樣式」＝外殼只用 bash builtin、只對 payload 的
 * `tool_input.command`（取不到時退回整份 stdin）認不可逆形式：`reset --hard`、`clean`（不帶 -n／--dry-run）、
 * `checkout -f`／`checkout … -- <path>`、`switch -f`／`--discard-changes`、`restore`（不帶 --staged，或帶 -W／--worktree）、
 * `stash clear`；保守樣式命中的每一件，本檔的 `violation()` 也必須判 deny（test 的 subset fixture 釘住）。
 *
 *   | #  | 錯誤分支 | 位置 | 行為 |
 *   | -- | --- | --- | --- |
 *   | E1 | `node` 不在 PATH | `.sh` | 保守樣式：命中 exit 2（stderr 寫「判定無法執行：node 不在」、修法、recovery 開關）；沒命中 exit 0＋additionalContext 告知判定故障 |
 *   | E2 | 判定檔（本檔）不在 `.sh` 同目錄 | `.sh` | 同上，stderr 寫「判定檔缺失」「投影不完整」 |
 *   | E3 | stdin 不是 JSON | `run()` 回 `3` | 外殼收到 3 → 保守樣式（拿不到 command 欄位時對整份 stdin 找 git 字） |
 *   | E4 | JSON 但無 `tool_input.command` 字串 | `run()` 回 `0` | 非受檢對象，不算錯誤，放行 |
 *   | E5 | `findViolation` 丟例外 | `run()` 回 `3` | 同 E3 |
 *   | E6 | 判定行程非 0／2 退出（import 失敗、node 不支援 TS 型別剝除、被 signal 終止） | `.sh` | 同 E1 |
 *
 * recovery 開關：`CLADE_WIP_GATE_DEGRADED_OK=1`，只從行程 env 讀、只在上表錯誤分支且保守樣式命中時生效、
 * 在外殼層就生效（呼叫 node 之前）；放行時 stderr 留一行「判定故障期以開關放行」，同一句也放進 additionalContext
 * （PreToolUse exit 0 的 stderr 進不了 transcript，additionalContext 才是稽核痕跡）。不沿用 `CLADE_ALLOW_WIP_DISCARD`。
 * 快篩（`.sh`）在所有錯誤分支之前：沒提到那幾個 git 子命令的指令，任何故障狀態下都 exit 0、無輸出。
 *
 * 已知限制：hooks.json 對本 hook 設的逾時（timeout: 10）到期時，Claude Code 直接砍掉 hook，屬 non-blocking，
 * 外殼收不到也無從出口；本 gate 無法覆蓋，記於此而不另加外殼 timeout。
 * 保守樣式只認段首是 git 的段（略過 VAR=val、env／command／sudo 等前導與其 -x 旗標、bash -c／eval 包裝；
 * 前導旗標的值不吃，`env -u X git …`、`sudo -u u git …`、`timeout -s KILL 5 git …` 故障期放行，見 DEGRADED_PASS 缺口），
 * 把不可逆形式放在段首的文字（例：heredoc 內某一行）故障期仍會誤擋，用 recovery 開關放行。
 *
 * 逃生門（只認「違規那一段」的命令前綴，或行程 env；同條命令串別段的前綴不算）：
 *   - `CLADE_ALLOW_WIP_DISCARD=1`：放行任何違規並在 stderr 留一行；只用於用完即丟的 scratch repo，
 *     NEVER 用在任何真實 checkout。deny 訊息刻意不提它。
 *   - `CLADE_ALLOW_WIP_RESTORE=1`：只放行 `git checkout <ref> -- <具體檔案路徑>`（fleet SOP 的「從指定 ref 還原檔案」，
 *     如 refs/wt-baseline/* 救援、scope 外改動 revert）；reset --hard／clean／裸 `checkout -- .` 等不吃它，
 *     整樹或範圍型 pathspec（`.`、`./`、`:/`、`:(top)`、glob、結尾 `/` 的目錄）也不吃——否則一個前綴就能丟光所有 WIP。
 *     deny 訊息只在合格形狀（`checkout <ref> -- <具體檔案>`）才指向它。
 *
 *   | REQUIRED 欄位 | 內容 |
 *   | --- | --- |
 *   | 觸發條件 | Bash 命令位置出現 matcher 規格列的 git 形式 → exit 2 擋下該次 tool call |
 *   | 消費端 | 正要跑該指令的 agent（stderr 兩條出口：`git switch <branch>`、commit.md 的 WIP 處置；`checkout <ref> -- <paths>` 另指 RESTORE 前綴） |
 *   | 觸發點 | 工具事件 hook：`pre-bash-wip-destructive-git-gate.sh`（fleet PreToolUse:Bash）；訊息由 test/wip-destructive-git.test.ts 釘住 |
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { WRAPPERS, segments, words } from './gh-pr-create-work.ts'

const GLOBAL_VALUE_OPTS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--config-env',
])

// 子命令的短選項中「其後是值」的字母
const SHORT_VALUE: Record<string, string> = {
  checkout: 'bB',
  switch: 'cC',
  clean: 'e',
  restore: 's',
  reset: '',
  stash: '',
}
const LONG_VALUE: Record<string, Set<string>> = {
  checkout: new Set(['--orphan', '--conflict', '--pathspec-from-file']),
  switch: new Set(['--create', '--force-create', '--orphan', '--conflict']),
  clean: new Set(['--exclude']),
  restore: new Set(['--source', '--conflict', '--pathspec-from-file']),
  reset: new Set(['--pathspec-from-file']),
  stash: new Set(),
}

interface Parsed {
  opts: Set<string>
  positional: string[]
  /** `--` 之前的 positional 數（`checkout <ref> -- <paths>` 的 <ref>） */
  beforeDash: number
  dashdash: boolean
}

function parseArgs(sub: string, args: string[]): Parsed {
  const opts = new Set<string>()
  const positional: string[] = []
  let dashdash = false
  let beforeDash = 0
  const shortValue = SHORT_VALUE[sub] ?? ''
  const longValue = LONG_VALUE[sub] ?? new Set<string>()
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (dashdash) {
      positional.push(a)
    } else if (a === '--') {
      dashdash = true
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const name = eq > 0 ? a.slice(0, eq) : a
      opts.add(name)
      if (eq < 0 && longValue.has(name)) i++
    } else if (a.startsWith('-') && a.length > 1 && a !== '-') {
      for (let j = 1; j < a.length; j++) {
        opts.add(`-${a[j]}`)
        if (shortValue.includes(a[j])) {
          if (j === a.length - 1) i++
          break
        }
      }
    } else {
      positional.push(a)
      beforeDash++
    }
  }
  return { opts, positional, beforeDash, dashdash }
}

const has = (p: Parsed, ...names: string[]) => names.some((n) => p.opts.has(n))

/** `git checkout <ref> -- <paths>`：從明確 ref 還原檔案，fleet SOP 有意使用；唯一吃 RESTORE 前綴的形狀。 */
export const RESTORE_FROM_REF = 'git checkout <ref> -- <paths> 會用 <ref> 的內容覆寫工作檔'

/** `checkout <ref> -- <範圍型 pathspec>`：整樹、目錄、glob、pathspec magic；RESTORE 前綴不放行，deny 訊息也不提它。 */
export const RESTORE_WIDE_PATHSPEC =
  'git checkout <ref> -- <範圍型 pathspec>（整樹、目錄、glob、:magic）會一次覆寫一整片工作檔'

/**
 * 具體檔案路徑的語法判斷（hook 看不到 cwd，不查檔案系統）：
 * 拒絕空字串、`.`／`./`／`..` 結尾（整樹或父層）、結尾 `/`（目錄）、`:` 開頭（`:/`、`:(top)` 等 pathspec magic）、
 * glob 字元 `*?[`、shell 展開 `$`／反引號。不帶斜線的目錄名（`src`）語法上與檔案同形，分不出——絆索不是牆。
 */
export function isConcreteFilePath(path: string): boolean {
  if (path === '' || path.startsWith(':') || path.endsWith('/')) return false
  if (/[*?[$`\\]/u.test(path)) return false
  const last = path.slice(path.lastIndexOf('/') + 1)
  return last !== '.' && last !== '..'
}

/** git 子命令＋其參數 → 擋的原因；放行回 null。 */
export function judgeGit(sub: string, args: string[]): string | null {
  if (!(sub in SHORT_VALUE)) return null
  const p = parseArgs(sub, args)
  switch (sub) {
    case 'restore':
      if (!has(p, '--staged', '-S') || has(p, '--worktree', '-W'))
        return 'git restore 會覆寫工作檔（只有純 --staged 不碰工作檔）'
      return null
    case 'checkout': {
      if (has(p, '-f', '--force')) return 'git checkout -f 會丟掉工作檔的未 commit 改動'
      const creates = has(p, '-b', '-B', '--orphan')
      if (has(p, '-p', '--patch', '--ours', '--theirs', '--pathspec-from-file'))
        return 'git checkout 帶路徑會覆寫工作檔'
      if (p.dashdash) {
        if (creates || p.beforeDash !== 1) return 'git checkout 帶路徑會覆寫工作檔'
        return p.positional.slice(p.beforeDash).every(isConcreteFilePath)
          ? RESTORE_FROM_REF
          : RESTORE_WIDE_PATHSPEC
      }
      if (has(p, '--detach', '-d')) return null
      if (p.positional.length === 0) return null
      if (creates) return null
      if (p.positional.length === 1 && p.positional[0] === '-') return null
      return 'git checkout <x> 分不出 <x> 是 branch 還是 path（是 path 就會覆寫工作檔）'
    }
    case 'switch':
      if (has(p, '-f', '--force', '--discard-changes'))
        return 'git switch -f／--discard-changes 會丟掉工作檔的未 commit 改動'
      return null
    case 'reset':
      return has(p, '--hard') ? 'git reset --hard 會丟掉所有未 commit 改動' : null
    case 'clean':
      return has(p, '-n', '--dry-run') ? null : 'git clean（非 -n／--dry-run）會刪掉 untracked 檔'
    case 'stash':
      return p.positional[0] === 'clear' ? 'git stash clear 一次丟掉全部 stash，無法逐條判定' : null
  }
  return null
}

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash'])
const ASSIGN = /^[({!]*([A-Za-z_][A-Za-z_0-9]*)=(.*)$/s

/** 違規＋它自己那一段的 `VAR=val` 前綴（逃生門只看這個）。 */
export interface Violation {
  why: string
  assigns: Record<string, string>
}

function assignsBefore(w: string[], end: number): Record<string, string> {
  const out: Record<string, string> = {}
  for (const x of w.slice(0, end)) {
    const m = ASSIGN.exec(x)
    if (m) out[m[1]] = m[2]
  }
  return out
}

/** `bash -c`／`-lc`／`-ec`：合併旗標含 c 的第一個短選項串，其後一字是命令字串。 */
function shellInline(w: string[], from: number): string | undefined {
  const k = w.findIndex((x, n) => n > from && /^-[A-Za-z]+$/.test(x) && x.includes('c'))
  return k === -1 ? undefined : w[k + 1]
}

function segmentViolation(seg: string, depth: number): Violation | null {
  const w = words(seg).map((x) => x.text)
  let i = 0
  while (/^[A-Za-z_][A-Za-z_0-9]*=/.test(w[i] ?? '')) i++
  if (w[i] === 'env') {
    i++
    while (i < w.length && (/^[A-Za-z_][A-Za-z_0-9]*=/.test(w[i]) || w[i].startsWith('-'))) {
      if (['-u', '--unset', '-C', '--chdir'].includes(w[i])) i++
      i++
    }
  }
  if (w[i] === 'command') {
    i++
    while (w[i] === '-p' || w[i] === '--') i++
  }
  const lead = (w[i] ?? '').replace(/^.*\//, '')
  if (depth < 4 && (SHELLS.has(lead) || lead === 'eval')) {
    const inner = lead === 'eval' ? w.slice(i + 1).join(' ') : shellInline(w, i)
    const hit = inner ? findViolation(inner, depth + 1) : null
    return hit && { why: hit.why, assigns: { ...assignsBefore(w, i), ...hit.assigns } }
  }
  const isGit = (t: string) => t === 'git' || t.endsWith('/git')
  let starts = [i]
  if (!isGit(w[i] ?? '')) {
    // 命令位置是 wrapper、subshell／group：拆不準就判段內每一個 git 字（寧可多擋）
    const opaque = WRAPPERS.has(w[i] ?? '') || /^[({!]/.test(w[i] ?? '')
    if (!opaque) return null
    starts = w.flatMap((x, k) => (k >= i && isGit(x.replace(/^[({!]+/, '')) ? [k] : []))
  }
  for (const start of starts) {
    let k = start + 1
    while (k < w.length && w[k].startsWith('-')) {
      if (GLOBAL_VALUE_OPTS.has(w[k])) k++
      k++
    }
    const sub = w[k]
    if (!sub) continue
    const rest = w.slice(k + 1)
    const end = rest.findIndex((x) => /^(&&|\|\||;|\||&)$/.test(x))
    const args = (end === -1 ? rest : rest.slice(0, end)).map((x) => x.replace(/[)};]+$/, ''))
    const why = judgeGit(sub, args)
    if (why) return { why, assigns: assignsBefore(w, start) }
  }
  return null
}

/** 整條 Bash 命令 → 第一個違規（含該段前綴）；放行回 null。 */
export function findViolation(cmd: string, depth = 0): Violation | null {
  if (!/\bgit\b/u.test(cmd)) return null
  for (const seg of segments(cmd)) {
    const hit = segmentViolation(seg, depth)
    if (hit) return hit
  }
  return null
}

/** 整條 Bash 命令 → 第一個違規原因；放行回 null。 */
export function violation(cmd: string): string | null {
  return findViolation(cmd)?.why ?? null
}

export function denyMessage(why: string): string {
  const restore =
    why === RESTORE_FROM_REF
      ? `\n  - 確定要從明確 ref／快照取回檔案（如 refs/wt-baseline/*、SOP 的 revert），且該路徑的工作檔改動可丟 → ` +
        `CLADE_ALLOW_WIP_RESTORE=1 git checkout <ref> -- <paths>（前綴只認這一段指令，只放行此形狀）`
      : ''
  return (
    `⛔ ${why}。工作檔裡可能有本次工作開始前就在的 WIP，丟了沒有還原路徑（rules/core/commit.md §Git 命令禁令）。\n` +
    `${restore ? '有三條出口' : '只有兩條出口'}：\n` +
    `  - 要切分支 → git switch <branch>（不帶 -f／--discard-changes；有衝突的未 commit 改動時 git 會拒絕，那是保護不是障礙）\n` +
    `  - 要還原檔案內容 → 照 commit.md 的 WIP 處置：用原本的編輯工具精確反向修改你自己改過的部分（保留其他差異）；` +
    `或具名 stash（git stash push -u -m <tag>）並把 tag 與原因寫進 HANDOFF.md。` +
    restore
  )
}

export interface HookIo {
  stdin: string
  env: NodeJS.ProcessEnv
  stderr: (text: string) => void
}

/** 判定自身故障（E3、E5）的專用退出碼：外殼收到就退回保守樣式，不當放行（0）也不當擋下（2）。 */
const DEGRADED_EXIT = 3

/** in-process 接縫：回傳 exit code；不碰 process.exit／全域 stdin。 */
export function run(io: HookIo): number {
  if (io.env.CLADE_ALLOW_WIP_DISCARD === '1') return 0
  let input: { tool_input?: { command?: unknown } } | null
  try {
    input = JSON.parse(io.stdin || '{}')
  } catch {
    return DEGRADED_EXIT // E3：stdin 不是 JSON
  }
  const cmd = typeof input?.tool_input?.command === 'string' ? input.tool_input.command : ''
  if (!cmd) return 0 // E4：不是 Bash payload，非受檢對象
  let hit: Violation | null
  try {
    hit = findViolation(cmd)
  } catch {
    return DEGRADED_EXIT // E5：判定丟例外
  }
  if (!hit) return 0
  const { why, assigns } = hit
  const on = (name: string) => assigns[name] === '1' || io.env[name] === '1'
  const escape =
    (assigns.CLADE_ALLOW_WIP_DISCARD === '1' && 'CLADE_ALLOW_WIP_DISCARD') ||
    (why === RESTORE_FROM_REF && on('CLADE_ALLOW_WIP_RESTORE') && 'CLADE_ALLOW_WIP_RESTORE')
  if (escape) {
    io.stderr(`wip-destructive-git: ${escape}=1 — 放行（${why}）\n`)
    return 0
  }
  io.stderr(`${denyMessage(why)}\n`)
  return 2
}

function main() {
  process.exitCode = run({
    stdin: readFileSync(0, 'utf8'),
    env: process.env,
    stderr: (text) => process.stderr.write(text),
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
