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
//   3. clade hook 區塊 drift — isCladeHookBlockDrift（本檔）：bootstrap 改寫 hook 檔頭的
//      drift-guard marker 區塊，區塊外逐位元組相同才算。
//
// 「這棵樹有幾筆 dirty」的計數（wt-helper list／backlog、worktree-freshness 的可回收清單）
// 也 MUST 走同一份判準（`countUserDirty`）：裸 porcelain 行數會把投影殘留算成待救成果，
// 於是 cleanup 明明放行的樹在清單上永遠不是 dirty 0、進不了回收候選。
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
import { basename, join } from 'node:path'
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

// clade drift-guard 區塊（`scripts/lib/pre-commit-governance.ts` 的 CLADE_HOOK_BLOCK）是第二種
// tool-managed drift：bootstrap 每次 `pnpm install` 都把 hook 檔頭那段 marker 區塊改寫成 clade
// 當下的版本，而 hook 檔本身（典型 `.husky/pre-commit`）是 consumer 的 tracked 檔、不在
// LOCKED_PROJECTION_RE 內（整個 `.husky/` 不能鎖，見 locked-projection.ts）。區塊一改版，
// 每棵樹就掛一筆 ` M`，直到 consumer 的 main 收到新版區塊為止；不豁免的話，全新、沒動過
// 任何檔的樹也過不了 `cleanup` 的 uncommitted gate。`.gitignore` 的治理行是另一格，由
// propagate 的 delivery commit 收斂，不在這裡放寬。
//
// 判的是區塊**外**：只在檔名是 `pre-commit`、且「把 marker 區塊整段抽掉後，HEAD 與 working tree
// 逐位元組相同」時回 true。區塊外任何一個字元不同＝consumer 自己的 hook 邏輯有改動＝user WIP。
// 區塊**內**不比對、也不分方向（本檔會散播到 consumer，拿不到 clade 當前版區塊的字面值）：
// marker 之間是 bootstrap 的東西，手改或還原成舊版都會在下一次 install 被覆寫，所以不當 user WIP 保。
// HEAD 還沒有區塊（bootstrap 首次接上）時，比的是 `applyBlock` 的兩種插入形狀：檔頭有 shebang
// 時區塊前後各多一個空行，沒有時只有區塊後多一個。
// 新舊 marker 都認（早期名稱 `clade hub:check`），與 pre-commit-governance.ts 的 ALL_MARKERS 對齊；
// 兩邊的字面值由 test/wip-dirty-hook-block.test.ts 鎖住。
export const CLADE_HOOK_BLOCK_MARKERS = Object.freeze([
  { start: '# >>> clade drift-guard >>>', end: '# <<< clade drift-guard <<<' },
  { start: '# >>> clade hub:check >>>', end: '# <<< clade hub:check <<<' },
])

/** 把檔案在 clade hook 區塊處切成前後兩段；沒有完整區塊回 null。 */
function splitAtCladeHookBlock(text: string): { before: string; after: string } | null {
  for (const { start, end } of CLADE_HOOK_BLOCK_MARKERS) {
    const from = text.indexOf(start)
    if (from === -1) continue
    const to = text.indexOf(end, from + start.length)
    if (to === -1) return null
    // 同一份檔出現第二組區塊不是 bootstrap 寫得出來的形狀，不替它判。
    if (text.indexOf(start, to) !== -1) return null
    return { before: text.slice(0, from), after: text.slice(to + end.length) }
  }
  return null
}

export function isCladeHookBlockDrift(wtPath, filePath) {
  if (basename(filePath) !== 'pre-commit') return false
  let headText
  let currentText
  try {
    currentText = readFileSync(join(wtPath, filePath), 'utf8')
  } catch {
    return false
  }
  // 絕大多數 dirty 檔沒有 marker——先看 working tree，省掉一次 `git show`。
  const current = splitAtCladeHookBlock(currentText)
  if (current === null) return false
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
  if (headText === currentText) return false
  const head = splitAtCladeHookBlock(headText)
  if (head !== null) return head.before === current.before && head.after === current.after
  // 首次接上：區塊後一定多一個空行；檔頭有 shebang 時區塊前也多一個。
  if (!current.after.startsWith('\n\n')) return false
  const rest = current.after.slice(2)
  return (
    headText === current.before + rest ||
    (current.before.endsWith('\n\n') && headText === current.before.slice(0, -1) + rest)
  )
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
    (kind === 'modified' &&
      (isToolManagedDrift(repoRoot, path) || isCladeHookBlockDrift(repoRoot, path)))
  )
}

/**
 * 已落地樹的交付噪音（W-2026-10-01-worktree-accumulation-root-cause §3 C3／C4）：產生端寫進樹、
 * 卻不屬於該樹工作的 bytes——主持者 brief（`tasks/`）、ledger 追加（`vendor/ledger/signals.jsonl`）、
 * review GUI 舊建置產物（`vendor/review-gui-web/`）。
 *
 * **只給已落地的樹用**，而且 NEVER 讓它們被靜默丟掉：回收端（disk-hygiene）把這份清單原樣交給
 * `wt-helper cleanup --discard-pathspec`，由 cleanup 先把命中的殘留存成 `refs/clade-residue/<slug>`
 * 再移除。它**不**進 `isIgnorableWorktreeDrift`——merge-back／stop-wip-guard 對未落地的樹仍要擋。
 * 比對規則同 `matchesDiscardPathspec`：逐字等於，或以 `<pathspec>/` 為前綴。
 */
export const LANDED_DELIVERY_NOISE_PATHSPECS = Object.freeze([
  'tasks',
  'vendor/ledger/signals.jsonl',
  'vendor/review-gui-web',
])

/** `--discard-pathspec a,b` → ['a','b']；拒絕絕對路徑、`..`、glob 字元與空值（只收 repo 內的字面路徑）。 */
export function parseDiscardPathspecs(raw: unknown): string[] {
  if (raw === undefined || raw === null) return []
  const specs = String(raw)
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
  for (const spec of specs) {
    if (!spec || spec.startsWith('/') || spec.split('/').includes('..') || /[*?[\]:!]/.test(spec))
      throw new Error(
        `cleanup --discard-pathspec 只收 repo 內的字面路徑（逗號分隔，不收 glob／絕對路徑／..）：'${spec}'`,
      )
  }
  return specs
}

/**
 * porcelain path 是否落在任一 pathspec 內：逐字相等，或以 `<pathspec>/` 為前綴。
 * 收合成目錄的 untracked 行（`tasks/x/`）只在整個目錄都在 pathspec 內時才算命中；
 * 範圍比收合目錄窄的 pathspec 不命中（fail closed：寧可擋）。
 * 帶引號的 path（porcelain 對特殊字元的轉義）一律不命中。
 */
export function matchesDiscardPathspec(path: string, pathspecs: readonly string[]): boolean {
  if (path.startsWith('"')) return false
  const p = path.endsWith('/') ? path.slice(0, -1) : path
  return pathspecs.some((raw) => {
    const spec = raw.replace(/\/+$/, '')
    return spec.length > 0 && (p === spec || p.startsWith(`${spec}/`))
  })
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
export function blockingPorcelainPaths(
  repoRoot,
  porcelainOut,
  discardPathspecs: readonly string[] = [],
) {
  return porcelainOut
    .split('\n')
    .filter((line) => line.length >= 4)
    .filter((line) => {
      // 呼叫端逐條點名可丟的路徑：rename 兩端都要落在 pathspec 內才放行。
      const renamed = porcelainRenameSource(line)
      if (
        discardPathspecs.length > 0 &&
        matchesDiscardPathspec(porcelainPath(line), discardPathspecs) &&
        (renamed === null || matchesDiscardPathspec(renamed, discardPathspecs))
      )
        return false
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

/**
 * 一棵樹的 user WIP 筆數：`git status --porcelain` 剔除可忽略漂移後剩下的行數。
 * 讀不到 status 回 null（「沒讀到」NEVER 當成 0——呼叫端拿 `=== 0` 判可回收）。
 */
export function countUserDirty(repoRoot): number | null {
  let out
  try {
    out = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: repoRoot,
      // 計數是唯讀判定，呼叫端含 SessionStart／census：不讓 `git status` 回寫 index——那會刷新
      // gitdir mtime（推遲 disk-hygiene 的靜置窗），也會與樹裡的活寫入者搶 index.lock。
      env: { ...cwdScopedGitEnv, GIT_OPTIONAL_LOCKS: '0' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024,
    })
  } catch {
    return null
  }
  return blockingPorcelainPaths(repoRoot, out).length
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

/**
 * `--landed-noise-only <repoRoot>`：給 disk-hygiene 用的 fail-closed 判定。剔除可忽略漂移後，
 * 剩下的 dirty 是否**全部**落在 LANDED_DELIVERY_NOISE_PATHSPECS 內。
 * exit 0：是（含完全乾淨）；exit 1：有其他 dirty（stdout 列出）；exit 2：git 失敗（呼叫端保留）。
 * rename 行兩端都要在清單內。
 */
function landedNoiseOnlyCli(repoRoot: string): number {
  let out
  try {
    // --no-optional-locks：不回寫 index stat cache——disk-hygiene L3 以 gitdir/index 的 mtime 判
    // git 靜置，判定本身不能把它刷新。
    out = execFileSync('git', ['--no-optional-locks', 'status', '--porcelain'], {
      cwd: repoRoot,
      env: cwdScopedGitEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return 2
  }
  const rest = out
    .split('\n')
    .filter((line) => line.length >= 4)
    .filter((line) => blockingPorcelainPaths(repoRoot, line).length > 0)
    .filter((line) => {
      const source = porcelainRenameSource(line)
      return (
        !matchesDiscardPathspec(porcelainPath(line), LANDED_DELIVERY_NOISE_PATHSPECS) ||
        (source !== null && !matchesDiscardPathspec(source, LANDED_DELIVERY_NOISE_PATHSPECS))
      )
    })
    .map(porcelainPath)
  if (rest.length > 0) process.stdout.write(`${rest.join('\n')}\n`)
  return rest.length > 0 ? 1 : 0
}

if (invokedAsCli() && process.argv[2] === '--landed-noise-pathspecs') {
  process.stdout.write(`${LANDED_DELIVERY_NOISE_PATHSPECS.join(',')}\n`)
  process.exit(0)
}
if (invokedAsCli() && process.argv[2] === '--landed-noise-only') {
  process.exit(landedNoiseOnlyCli(process.argv[3] || process.cwd()))
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
