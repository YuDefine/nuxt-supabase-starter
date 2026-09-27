#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/wip-dirty.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/wip-dirty.ts
// wip-dirty.ts — 列出一個 repo working tree 內「user WIP」dirty paths，
// 即 git status --porcelain 過濾掉可忽略漂移後剩下的檔。
//
// 「可忽略漂移」的單一判準是 `isIgnorableWorktreeDrift`（本檔）：
//   1. clade-managed projection 殘留 — isLockedProjectionPathFor（locked-projection.ts），
//      與 wt-helper merge-back 共用，避免 Stop hook / drift-scan 各自重刻 projection
//      pattern 漂移（2026-06-01 dev-session.ts 漏進 LOCKED_PROJECTION_RE 即此類 drift）。
//   2. tool-managed drift — isToolManagedDrift（本檔，自 wt-helper.ts 搬入）：
//      wt-helper bootstrap 自己種下且永不該 land 的 `verifyDepsBeforeRun` flip。
//
// 共用端：wt-helper cleanup 的 uncommitted gate、merge-back 的 WIP partition、
// wt-batch checkpoint / draft、stop-wip-guard（本檔 CLI）、handoff-drift-scan。
// 各 gate 對「user WIP」的定義必須逐字相同，否則同一棵樹在一道能過、另一道被擋
// （wt-batch checkpoint/draft 2026-09-27 前只認裸 porcelain，把所有 worktree 全擋死）。
//
// 程式用法（drift-scan Layer 2a）：
//   import { userDirtyPaths } from './wip-dirty.ts'
//   const wip = userDirtyPaths(worktreePath)  // → string[]（porcelain path，已剝 XY 狀態碼）
//
// CLI 用法（stop-wip-guard.sh Layer 0 warn）：
//   node wip-dirty.ts [repoRoot]
//   - stdout：每行一個 user WIP path（無則空）
//   - exit 1：有 user WIP；exit 0：乾淨 / 全 projection/tool-managed / 非 git repo（fail-open）

import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isLockedProjectionPathFor } from './locked-projection.ts'

// 這裡的 git 呼叫一律以 cwd 定位 repo：剝掉繼承的 `GIT_*`（hook 內常帶 GIT_DIR／GIT_INDEX_FILE），
// 否則呼叫端用隔離 env 跑的 porcelain 與本檔的 `git show HEAD:` 可能讀到不同 repo。
const cwdScopedGitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
)

// Tool-managed drift gate: drift that **wt-helper itself created** and that
// **must never land on main**. Excluded from the WIP gate entirely — neither
// blocked nor auto-committed.
//
// Today this is exactly one case: cmdAdd flips the worktree's
// `verifyDepsBeforeRun` from `warn` to `install` (see the "Flip
// verify-deps-before-run" block in cmdAdd — main deliberately keeps `warn` to
// avoid postinstall on ctrl+c, worktrees take `install` so dep desync
// auto-repairs).
//
// **兩個檔都要認（TD-723 遷移期）**：SoT 已從 `.npmrc` 搬到 `pnpm-workspace.yaml`
// （pnpm 11 不再讀 `.npmrc` 的非 auth 設定），但既有 worktree 與尚未跑過
// `ensureCladePnpmSettings` 的 consumer 還停在舊檔。只認一個，另一個的 drift 就會
// 被算成 user WIP 並擋住 merge-back —— 那正是本函式存在的原因。
// That leaves every worktree permanently showing ` M` on one of them,
// which the pre-flight then reports as user WIP and refuses to merge-back on
// — i.e. wt-helper's own bootstrap blocks wt-helper's own landing path
// (<consumer-a> TD-252, hit by all 4 lanes on 2026-07-26).
//
// It must NOT go through the auto-commit branch either: committing it would
// carry `install` into main, silently flipping main's pnpm behaviour. Since
// merge-back squashes **commits** only, leaving it uncommitted is correct —
// it simply must stop being counted as a blocker.
//
// Narrow by construction: returns true only when normalising that single line
// makes HEAD and the working tree byte-identical. Any other edit to `.npmrc`
// (a real user change) still falls through to the WIP gate.
// key 名兩邊不同（ini kebab vs yaml camel），所以行形狀 per-file 決定。
const TOOL_MANAGED_SETTING_LINE = {
  '.npmrc': /^verify-deps-before-run=(warn|install)$/m,
  'pnpm-workspace.yaml': /^verifyDepsBeforeRun:[ \t]*(warn|install)$/m,
}

export function isToolManagedDrift(wtPath, filePath) {
  const LINE = TOOL_MANAGED_SETTING_LINE[filePath]
  if (!LINE) return false
  let headText
  try {
    headText = execFileSync('git', ['show', `HEAD:${filePath}`], {
      cwd: wtPath,
      env: cwdScopedGitEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return false
  }
  let currentText
  try {
    currentText = readFileSync(join(wtPath, filePath), 'utf8')
  } catch {
    return false
  }
  if (headText === currentText) return false

  // **方向敏感**：只認 cmdAdd bootstrap 造成的 `warn` → `install`。
  // 反方向（HEAD 是 `install`、working tree 是 `warn`）是 user 手動把它改回來——那是**真的
  // user WIP**。若把兩個方向都當 tool-managed 放行，等於繞過 WIP 保護，cleanup 會靜默刪掉它。
  const headMatch = headText.match(LINE)
  const currentMatch = currentText.match(LINE)
  if (!headMatch || !currentMatch) return false
  if (headMatch[1] !== 'warn' || currentMatch[1] !== 'install') return false

  // 該行以外的內容必須逐位元組相同——同一次編輯若還動了別的行，整份就當 user WIP。
  const blank = (s) => s.replace(LINE, '<tool-managed-verify-deps-before-run>')
  return blank(headText) === blank(currentText)
}

/**
 * 可忽略漂移的單一判準。`kind` 是呼叫端對該 dirty entry 的分類：
 * 'modified'（porcelain 非 `??` 的全部狀態）或 'untracked'（`??`）。
 * tool-managed drift 只認 modified —— isToolManagedDrift 要跟 HEAD 比內容，
 * untracked 檔沒有 HEAD 版本可比。
 */
export function isIgnorableWorktreeDrift(repoRoot, path, kind) {
  return (
    isLockedProjectionPathFor(repoRoot, path) ||
    (kind === 'modified' && isToolManagedDrift(repoRoot, path))
  )
}

/**
 * git status --porcelain 的一行剝出 path。porcelain v1 格式：
 *   `XY <path>` 或 rename `XY <old> -> <new>`（取 new）。
 */
function porcelainPath(line) {
  const body = line.slice(3) // 剝 2 char 狀態碼 + 1 space
  const arrow = body.indexOf(' -> ')
  return arrow >= 0 ? body.slice(arrow + 4) : body
}

/** rename 行的來源 path（非 rename 回 null）。 */
function porcelainRenameSource(line) {
  const body = line.slice(3)
  const arrow = body.indexOf(' -> ')
  return arrow >= 0 ? body.slice(0, arrow) : null
}

/**
 * 把 `git status --porcelain` 輸出過濾成仍會擋 gate 的 paths（剔除可忽略漂移）。
 * 取得 porcelain 的方式（fail-open / fail-closed）由呼叫端決定，過濾只有這一份。
 */
export function blockingPorcelainPaths(repoRoot, porcelainOut) {
  return porcelainOut
    .split('\n')
    .filter((line) => line.length >= 4)
    .filter((line) => {
      const kind = line.slice(0, 2) === '??' ? 'untracked' : 'modified'
      if (!isIgnorableWorktreeDrift(repoRoot, porcelainPath(line), kind)) return true
      // rename 兩端都要可忽略：`R  src/real.ts -> .claude/rules/x.md` 的目的端是投影，
      // 但來源端是一筆真的刪除，只看目的端會把它一起藏掉。
      const source = porcelainRenameSource(line)
      return source !== null && !isIgnorableWorktreeDrift(repoRoot, source, kind)
    })
    .map(porcelainPath)
}

/**
 * 回傳 repoRoot working tree 內非可忽略漂移的 dirty paths。
 * 非 git repo / git 失敗 → 回空陣列（fail-open，呼叫端不該因 infra 故障誤判）。
 * 需要 fail-closed 的 gate（wt-batch checkpoint/draft）自行跑 porcelain，
 * 再交給同一支 `blockingPorcelainPaths` 過濾。
 */
export function userDirtyPaths(repoRoot) {
  let out
  try {
    out = execFileSync('git', ['status', '--porcelain'], {
      cwd: repoRoot,
      env: cwdScopedGitEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return []
  }
  return blockingPorcelainPaths(repoRoot, out)
}

// CLI mode — 給 bash hook 用（exit code 表示有無 user WIP）。
// CLI 進入判定：兩邊都 realpath。node 預設把 import.meta.url realpath 化、
// process.argv[1] 則原樣保留，經 symlink 叫進去兩者不相等 → 整個 CLI 區塊被靜默
// 跳過且 exit 0，長相與「一切正常」無法區分（TD-460）。
function invokedAsCli() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return entry === fileURLToPath(import.meta.url)
  }
}

if (invokedAsCli()) {
  const repoRoot = process.argv[2] || process.cwd()
  const wip = userDirtyPaths(repoRoot)
  if (wip.length > 0) {
    process.stdout.write(`${wip.join('\n')}\n`)
    process.exit(1)
  }
  process.exit(0)
}
