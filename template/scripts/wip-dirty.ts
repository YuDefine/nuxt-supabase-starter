#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/wip-dirty.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/wip-dirty.ts
// wip-dirty.ts — 列出一個 repo working tree 內「user WIP」dirty paths，
// 即 `git status --porcelain=v1 -z` 過濾掉可忽略漂移後剩下的檔。
//
// 本檔自己跑的 status 一律帶 `-z`，交給 lib/git-status-z.ts 解析：不帶 `-z` 時非 ASCII 路徑被
// `core.quotePath` 跳脫成 `"\346…"`，對不上投影清單，非 ASCII 檔名的投影殘留會被當成 user WIP。
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
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readGitStatus, type GitStatusEntry } from './lib/git-status-z.ts'
import { isLockedProjectionPathFor } from './locked-projection.ts'

// 這裡的 git 呼叫一律以 cwd 定位 repo：剝掉繼承的 `GIT_*`（hook 內常帶 GIT_DIR／GIT_INDEX_FILE），
// 否則呼叫端用隔離 env 跑的 porcelain 與本檔的 `git show HEAD:` 可能讀到不同 repo。
const cwdScopedGitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
)
// 唯讀判定（計數、disk-hygiene）不讓 `git status` 回寫 index：那會刷新 gitdir mtime（推遲
// disk-hygiene 的靜置窗），也會與樹裡的活寫入者搶 index.lock。
const readOnlyGitEnv = { ...cwdScopedGitEnv, GIT_OPTIONAL_LOCKS: '0' }

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

// `applyToolManagedFlip` 只翻 warn→install 方向（與 isToolManagedDrift 的方向敏感一致）；
// 行形狀比照 wt-helper cmdAdd 的「Flip verify-deps-before-run」區塊。
const TOOL_MANAGED_WARN_LINE = {
  '.npmrc': /^verify-deps-before-run=warn[ \t]*$/m,
  'pnpm-workspace.yaml': /^verifyDepsBeforeRun:[ \t]*warn[ \t]*$/m,
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
 * 工具快取噪音：產生端寫進任何樹（含從未 commit 的 empty 樹）的 bytes，內容隨樹消失都不損失工作，
 * 且 cleanup 會先存成 refs/clade-residue。empty 樹的未提交改動可能是派工 session 唯一的產出，
 * 所以 empty 樹只認這份，不認 LANDED_DELIVERY_NOISE_PATHSPECS 其餘的 brief／session 清單／ledger。
 * 比對規則同 `matchesDiscardPathspec`。
 *
 * consumer 樹裡的產生端寫入：`.pi/settings.json` 是 clade package 的 `@vX.Y.Z` 版本釘，
 * 每次 publish 後 bootstrap 改寫（樹落後 main 時是 ` M`，HEAD 沒有時整個 `.pi/` 收合成一行 `?? .pi/`）。
 * 寫成目錄 `.pi`：clade 的 gitignore 治理只放行 `.pi/settings.json`（`.pi/*` 其餘都 ignored），所以
 * 這個目錄裡 git 看得到的檔只有它；cleanup 的 uncommitted gate 用收合模式，`.pi/settings.json` 點不中 `?? .pi/`。
 * `.impeccable/hook.cache.json` 是 impeccable hook 的快取（untracked）；`.impeccable/` 常有 tracked 的使用者內容，
 * NEVER 寫成目錄。整個 `.impeccable/` 都 untracked 時收合成 `?? .impeccable/`，點不中、cleanup 照擋（保留，安全）。
 */
export const TOOL_CACHE_NOISE_PATHSPECS = Object.freeze(['.pi', '.impeccable/hook.cache.json'])

/**
 * 已落地樹的交付噪音（W-2026-10-01-worktree-accumulation-root-cause §3 C3／C4）：產生端寫進樹、
 * 卻不屬於該樹工作的 bytes——主持者 brief 與 session 清單（consumer 的 `tasks/`；clade home 的
 * `specs/coordinator/`、`specs/sessions/`）、ledger 追加（`vendor/ledger/signals.jsonl`）、
 * review GUI 舊建置產物（`vendor/review-gui-web/`）、ai-quota 舊 HEAD 殘留的建置產物（`vendor/ai-quota/`）。
 *
 * **只給已落地的樹用**（從未 commit 的 empty 樹只用 TOOL_CACHE_NOISE_PATHSPECS），而且 NEVER 讓它們
 * 被靜默丟掉：回收端（disk-hygiene）把這份清單原樣交給
 * `wt-helper cleanup --discard-pathspec`，由 cleanup 先把命中的殘留存成 `refs/clade-residue/<slug>`
 * 再移除。它**不**進 `isIgnorableWorktreeDrift`——merge-back／stop-wip-guard 對未落地的樹仍要擋。
 * 比對規則同 `matchesDiscardPathspec`：逐字等於，或以 `<pathspec>/` 為前綴。
 */
export const LANDED_DELIVERY_NOISE_PATHSPECS = Object.freeze([
  'tasks',
  'specs/coordinator',
  'specs/sessions',
  'vendor/ledger/signals.jsonl',
  'vendor/review-gui-web',
  'vendor/ai-quota',
  ...TOOL_CACHE_NOISE_PATHSPECS,
])

/**
 * 已落地樹的 append-only ledger（同為落地專屬噪音，**不**進 `isIgnorableWorktreeDrift`）：
 * 樹裡的 `vendor/ledger/{signals,candidates,outcomes}.jsonl` 只比 HEAD 多了追加行，而那些行
 * 已逐字存在於 landing base（`origin/main`）上的同一份檔——內容沒有任何會隨樹消失的 bytes，
 * 於是不算待救的 user WIP。只有 `blockingStatusPaths`／`countUserDirty` 在呼叫端**明確帶
 * `landedBaseRef`**（呼叫端已證明該樹 merged／squash-merged）時才放行；merge-back／stop-wip-guard
 * 走不帶 base 的 `userDirtyPaths`，未落地的樹上同樣的追加行照舊判 dirty。
 */
export const LANDED_LEDGER_APPEND_PATHS = Object.freeze([
  'vendor/ledger/signals.jsonl',
  'vendor/ledger/candidates.jsonl',
  'vendor/ledger/outcomes.jsonl',
])

/** porcelain XY 碼是否為純修改（` M`／`M `／`MM`）；刪除、新增、rename、衝突都不是。 */
export function isPlainModifiedCode(code: string): boolean {
  return code === ' M' || code === 'M ' || code === 'MM'
}

/**
 * `filePath` 是否為 ledger 的「純追加且已在 `baseRef`」：路徑在 LANDED_LEDGER_APPEND_PATHS、
 * `git diff HEAD` 沒有任何 `-` 行、至少一條 `+` 行、且每條 `+` 行都逐字存在於 `baseRef:<同檔>`。
 * 任何一步讀不到（git 失敗、base 沒有該檔）一律 false（fail closed：寧可算 dirty）。
 * 不看樹是否已落地——那是呼叫端的前置條件（見 LANDED_LEDGER_APPEND_PATHS 註解）。
 */
export function isLandedLedgerAppendOnly(
  wtPath: string,
  filePath: string,
  baseRef: string,
): boolean {
  if (!LANDED_LEDGER_APPEND_PATHS.includes(filePath)) return false
  let diff: string
  let baseText: string
  try {
    diff = execFileSync(
      'git',
      ['diff', 'HEAD', '--no-color', '--no-ext-diff', '-U0', '--', filePath],
      {
        cwd: wtPath,
        env: readOnlyGitEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 256 * 1024 * 1024,
      },
    )
    baseText = execFileSync('git', ['show', `${baseRef}:${filePath}`], {
      cwd: wtPath,
      env: readOnlyGitEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024,
    })
  } catch {
    return false
  }
  const added: string[] = []
  let inHunk = false
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('-')) return false
    if (line.startsWith('+')) added.push(line.slice(1))
  }
  if (added.length === 0) return false
  const baseLines = new Set(baseText.split('\n'))
  return added.every((line) => baseLines.has(line))
}

/**
 * 剩下的 dirty **全部**是「ledger 純追加且已在 base」才回 true（空陣列回 false）。
 * all-or-nothing：混著任何其他 dirty 就整批不放行、計數照舊——NEVER 為了回收放寬 dirty 條件。
 * freshness 的計數與 `wt-helper cleanup` 的 uncommitted gate 都呼叫這一支，不各寫一份。
 */
export function allLandedLedgerAppend(
  wtPath: string,
  entries: readonly { code: string; path: string; origPath?: string }[],
  baseRef: string,
): boolean {
  return (
    entries.length > 0 &&
    entries.every(
      (entry) =>
        entry.origPath === undefined &&
        isPlainModifiedCode(entry.code) &&
        isLandedLedgerAppendOnly(wtPath, entry.path, baseRef),
    )
  )
}

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
 * 不帶 `-z` 的 porcelain 一行剝出 path：`XY <path>` 或 rename `XY <old> -> <new>`（取 new）。
 * 只給 `onlyToolManagedDrift` 這條 stdin 介面用（見該函式）；本檔自己跑的 status 一律 `-z`。
 */
function porcelainPath(line) {
  const body = line.slice(3) // 剝 2 char 狀態碼 + 1 space
  const arrow = body.indexOf(' -> ')
  return arrow >= 0 ? body.slice(arrow + 4) : body
}

/** 單筆 status entry 是否仍會擋 gate（剔除可忽略漂移與呼叫端點名可丟的路徑）。 */
function entryBlocks(
  repoRoot: string,
  entry: GitStatusEntry,
  discardPathspecs: readonly string[],
): boolean {
  const source = entry.origPath ?? null
  // 呼叫端逐條點名可丟的路徑：rename 兩端都要落在 pathspec 內才放行。
  if (
    discardPathspecs.length > 0 &&
    matchesDiscardPathspec(entry.path, discardPathspecs) &&
    (source === null || matchesDiscardPathspec(source, discardPathspecs))
  )
    return false
  const kind = entry.code === '??' ? 'untracked' : 'modified'
  if (!isIgnorableWorktreeDrift(repoRoot, entry.path, kind)) return true
  // rename 兩端都要可忽略：`R  src/real.ts -> .claude/rules/x.md` 的目的端是投影，
  // 但來源端是一筆真的刪除，只看目的端會把它一起藏掉。
  return source !== null && !isIgnorableWorktreeDrift(repoRoot, source, kind)
}

/**
 * 把 status entries（`readGitStatus`）過濾成仍會擋 gate 的 paths（剔除可忽略漂移）。
 * 取得 status 的方式（fail-open / fail-closed）由呼叫端決定，過濾只有這一份。
 */
export function blockingStatusPaths(
  repoRoot,
  entries: readonly GitStatusEntry[],
  discardPathspecs: readonly string[] = [],
  landedBaseRef?: string,
): string[] {
  const blocking = entries.filter((entry) => entryBlocks(repoRoot, entry, discardPathspecs))
  // 已落地樹專屬（呼叫端明確帶 landedBaseRef）：剩下的 dirty **全部**都是「ledger 純追加且已在 base」
  // 才整批放行；混著任何其他 dirty 就照原本計數（NEVER 為了回收放寬 dirty 條件）。
  // 刻意放在 isIgnorableWorktreeDrift 之外：它是 merge-back／stop-wip-guard 的共用判準，不能放寬。
  if (landedBaseRef && allLandedLedgerAppend(repoRoot, blocking, landedBaseRef)) return []
  return blocking.map((entry) => entry.path)
}

/**
 * 「髒項全部是 tool-managed drift」的單一判準（auto-dispatch 的 syncPrTree 類守門共用）：
 * porcelain 每一行都是 modified 類、且 `isToolManagedDrift` 為真。untracked／rename／
 * 真實編輯有一條就回 false；空輸入回 true（沒有髒項）。
 * 收的是**不帶 `-z`** 的換行格式：呼叫端是 ssh 對端的 shell pipeline（`printf | wip-dirty
 * --tool-managed-only`），對端可能跑舊版。tool-managed 檔名全是 ASCII，被跳脫的非 ASCII 行
 * 對不上任何一支 → 回 false（判成有進度／不還原），方向是 fail closed。
 * 與 `isIgnorableWorktreeDrift` 不同：投影殘留、hook 區塊 drift 在這裡**不算**可忽略——
 * 這個判定餵給「還原後快轉」的流程，只放行能安全 `git checkout` 還原的 flip。
 */
export function onlyToolManagedDrift(repoRoot, porcelainOut) {
  return porcelainOut
    .split('\n')
    .filter((line) => line.length >= 4)
    .every((line) => line.slice(0, 2) !== '??' && isToolManagedDrift(repoRoot, porcelainPath(line)))
}

/**
 * `--apply-tool-managed` 的本體：`--restore-tool-managed` 把 flip 檔還原成 HEAD 的值
 * （main 刻意的 `warn`），快轉沿用樹的 syncPrTree 類流程要在快轉後把 cmdAdd bootstrap
 * 的 flip 種回去——worktree 要 `install`，依賴不同步時下一條 pnpm run 才會自修而不是
 * 只警告（剛快轉進來的 commit 又最可能動到 lockfile）。
 * 判準與 wt-helper cmdAdd「Flip verify-deps-before-run」區塊同一份：yaml 有這個 key 就
 * 只翻 yaml（yaml 是 SoT，有 key 時 NEVER 動 .npmrc）；yaml 沒 key 才翻 .npmrc；已是
 * install／是其它值／檔不存在 → 不動任何東西。成功（含無需翻）exit 0；讀寫失敗 exit 2。
 * 無條件跑在快轉後——也順便把修好前就停在 warn 的沿用樹治回 install。
 */
function applyToolManagedFlip(repoRoot: string): number {
  try {
    const yamlPath = join(repoRoot, 'pnpm-workspace.yaml')
    const yamlText = existsSync(yamlPath) ? readFileSync(yamlPath, 'utf8') : null
    if (yamlText !== null && /^verifyDepsBeforeRun:/m.test(yamlText)) {
      if (TOOL_MANAGED_WARN_LINE['pnpm-workspace.yaml'].test(yamlText))
        writeFileSync(
          yamlPath,
          yamlText.replace(
            TOOL_MANAGED_WARN_LINE['pnpm-workspace.yaml'],
            'verifyDepsBeforeRun: install',
          ),
        )
      return 0
    }
    const npmrcPath = join(repoRoot, '.npmrc')
    if (!existsSync(npmrcPath)) return 0
    const content = readFileSync(npmrcPath, 'utf8')
    if (TOOL_MANAGED_WARN_LINE['.npmrc'].test(content))
      writeFileSync(
        npmrcPath,
        content.replace(TOOL_MANAGED_WARN_LINE['.npmrc'], 'verify-deps-before-run=install'),
      )
    return 0
  } catch {
    return 2
  }
}

/**
 * `--restore-tool-managed` 的本體：porcelain 髒項**全部**是 tool-managed drift 時，
 * 逐檔 `git checkout HEAD --` 還原（index＋worktree 都回 HEAD，staged flip 也收掉），exit 0。
 * 有任何其它髒項 → 不動任何檔、exit 1（全有或全無）；git／還原失敗 → exit 2。
 */
function restoreToolManagedDrift(repoRoot: string, porcelainOut: string): number {
  const lines = porcelainOut.split('\n').filter((line) => line.length >= 4)
  if (!onlyToolManagedDrift(repoRoot, porcelainOut)) return 1
  for (const line of lines) {
    try {
      execFileSync('git', ['checkout', 'HEAD', '--', porcelainPath(line)], {
        cwd: repoRoot,
        env: cwdScopedGitEnv,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
    } catch {
      return 2
    }
  }
  return 0
}

/**
 * `--restore-projection-drift` 的分類：porcelain（不帶 `-z` 的換行格式，同 `onlyToolManagedDrift`）每一行
 * 拆成「可還原」與「擋住」兩堆。可還原＝已追蹤、只有修改／刪除的狀態碼，且路徑是 clade-managed 投影
 * （`isLockedProjectionPathFor`，與 merge-back／wip-dirty 同一份判準）或 tool-managed flip。
 * untracked／rename／staged-add／衝突一律擋住（沒有 HEAD 版本可還原，或還原會丟東西）。
 * 被 quotePath 跳脫的非 ASCII 路徑對不上投影清單 → 落在擋住那堆，方向是 fail closed。
 */
export function classifyRestorableDrift(
  repoRoot: string,
  porcelainOut: string,
): { restorable: string[]; blocking: string[] } {
  const restorable: string[] = []
  const blocking: string[] = []
  for (const line of porcelainOut.split('\n').filter((l) => l.length >= 4)) {
    const path = porcelainPath(line)
    const tracked = /^[ MDT]{2}$/u.test(line.slice(0, 2))
    if (
      tracked &&
      (isLockedProjectionPathFor(repoRoot, path) || isToolManagedDrift(repoRoot, path))
    )
      restorable.push(path)
    else blocking.push(path)
  }
  return { restorable, blocking }
}

/**
 * `--restore-projection-drift` 的本體：髒項**全部**是投影漂移（clade-managed 投影或 tool-managed flip）時，
 * 逐檔 `git checkout HEAD --` 還原（index＋worktree 都回 HEAD），exit 0。
 * 夾帶任何其它髒項 → 不動任何檔（全有或全無）、stdout 逐行印出擋住的路徑、exit 1；git／還原失敗 exit 2。
 * 還原只是回到 HEAD：投影本來就由 propagate 重生，NEVER 因此丟掉非投影改動。
 */
function restoreProjectionDrift(repoRoot: string, porcelainOut: string): number {
  const { restorable, blocking } = classifyRestorableDrift(repoRoot, porcelainOut)
  if (blocking.length > 0) {
    process.stdout.write(`${blocking.join('\n')}\n`)
    return 1
  }
  for (const path of restorable) {
    try {
      execFileSync('git', ['checkout', 'HEAD', '--', path], {
        cwd: repoRoot,
        env: cwdScopedGitEnv,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
    } catch {
      return 2
    }
  }
  return 0
}

/**
 * 回傳 repoRoot working tree 內非可忽略漂移的 dirty paths。
 * 非 git repo / git 失敗 → 回空陣列（fail-open，呼叫端不該因 infra 故障誤判）。
 * 需要 fail-closed 的 gate（wt-batch checkpoint/draft）自行跑 `-z` status，
 * 再交給同一支 `blockingStatusPaths` 過濾。
 */
export function userDirtyPaths(repoRoot) {
  let entries
  try {
    entries = readGitStatus(repoRoot, { env: cwdScopedGitEnv })
  } catch {
    return []
  }
  return blockingStatusPaths(repoRoot, entries)
}

/**
 * 一棵樹的 user WIP 筆數：status 剔除可忽略漂移後剩下的筆數。
 * 讀不到 status 回 null（「沒讀到」NEVER 當成 0——呼叫端拿 `=== 0` 判可回收）。
 * `landedBaseRef` 只給**已證明 merged／squash-merged** 的樹帶（見 LANDED_LEDGER_APPEND_PATHS）。
 */
export function countUserDirty(repoRoot, landedBaseRef?: string): number | null {
  let entries
  try {
    entries = readGitStatus(repoRoot, { env: readOnlyGitEnv, untracked: 'all' })
  } catch {
    return null
  }
  return blockingStatusPaths(repoRoot, entries, [], landedBaseRef).length
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
 * 剩下的 dirty 是否**全部**落在 LANDED_DELIVERY_NOISE_PATHSPECS 內。`--tool-noise-only` 同形，
 * 只認 TOOL_CACHE_NOISE_PATHSPECS（給 empty 樹）。
 * exit 0：是（含完全乾淨）；exit 1：有其他 dirty（stdout 列出）；exit 2：git 失敗（呼叫端保留）。
 * rename 行兩端都要在清單內。
 */
function noiseOnlyCli(repoRoot: string, pathspecs: readonly string[]): number {
  let entries
  try {
    entries = readGitStatus(repoRoot, { env: readOnlyGitEnv })
  } catch {
    return 2
  }
  const rest = blockingStatusPaths(repoRoot, entries, pathspecs)
  if (rest.length > 0) process.stdout.write(`${rest.join('\n')}\n`)
  return rest.length > 0 ? 1 : 0
}

if (invokedAsCli() && process.argv[2] === '--landed-noise-pathspecs') {
  process.stdout.write(`${LANDED_DELIVERY_NOISE_PATHSPECS.join(',')}\n`)
  process.exit(0)
}
if (invokedAsCli() && process.argv[2] === '--landed-noise-only') {
  process.exit(noiseOnlyCli(process.argv[3] || process.cwd(), LANDED_DELIVERY_NOISE_PATHSPECS))
}
if (invokedAsCli() && process.argv[2] === '--tool-noise-pathspecs') {
  process.stdout.write(`${TOOL_CACHE_NOISE_PATHSPECS.join(',')}\n`)
  process.exit(0)
}
if (invokedAsCli() && process.argv[2] === '--tool-noise-only') {
  process.exit(noiseOnlyCli(process.argv[3] || process.cwd(), TOOL_CACHE_NOISE_PATHSPECS))
}
// `--tool-managed-only <repoRoot>`：stdin 收 `git status --porcelain` 輸出（呼叫端可先自行
// 過濾，例如排除 append-only ledger），每一行髒項都是 tool-managed drift 時 stdout 印
// `tool-managed-only` 並 exit 0；有其它髒項 exit 1。
// 用固定 marker 而不只靠 exit code：對端跑的若是舊版 wip-dirty，不認得 flag 會把它當
// repoRoot、fail-open exit 0；比對 marker 才能區分「支援」與「舊版誤判乾淨」。
if (invokedAsCli() && process.argv[2] === '--tool-managed-only') {
  const repoRoot = process.argv[3] || process.cwd()
  if (onlyToolManagedDrift(repoRoot, readFileSync(0, 'utf8'))) {
    process.stdout.write('tool-managed-only\n')
    process.exit(0)
  }
  process.exit(1)
}
// `--restore-tool-managed <repoRoot>`：stdin 同上；全為 tool-managed drift 才還原（見
// `restoreToolManagedDrift`），否則不動任何檔。
if (invokedAsCli() && process.argv[2] === '--restore-tool-managed') {
  process.exit(restoreToolManagedDrift(process.argv[3] || process.cwd(), readFileSync(0, 'utf8')))
}
// `--restore-projection-drift <repoRoot>`：stdin 同上；髒項全為 clade-managed 投影或 tool-managed flip 才
// 還原（見 `restoreProjectionDrift`），否則不動任何檔並在 stdout 列出擋住的路徑（exit 1）。
// 舊版對端不認得 flag 時落進預設 CLI、fail-open exit 0 不還原——呼叫端的第二次 porcelain 複核仍會擋下。
if (invokedAsCli() && process.argv[2] === '--restore-projection-drift') {
  process.exit(restoreProjectionDrift(process.argv[3] || process.cwd(), readFileSync(0, 'utf8')))
}
// `--apply-tool-managed <repoRoot>`：快轉後把 worktree 的 verifyDepsBeforeRun flip 種回去
// （見 `applyToolManagedFlip`）。舊版 wip-dirty 不認得 flag 時落進下面的預設 CLI、
// fail-open exit 0 不種——沿用照樣成功，只是那棵樹停在 warn（不更壞）。
if (invokedAsCli() && process.argv[2] === '--apply-tool-managed') {
  process.exit(applyToolManagedFlip(process.argv[3] || process.cwd()))
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
