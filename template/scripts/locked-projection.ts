// 🔒 LOCKED — managed by clade · Source: vendor/scripts/locked-projection.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/locked-projection.ts
/**
 * locked-projection.ts — canonical regex for clade-managed projection paths.
 *
 * Single source of truth for "is this consumer path a clade-projection file?"
 * Shared between:
 *   - wt-helper.ts (merge-back blocker classification, baseline audit)
 *   - claim-helper / classifyDirtyPaths in wt-helper (Phase 3)
 *   - _validate-manifests.ts (Phase 6: cross-check against vendor-targets)
 *
 * Closes TD-018: the previous wt-helper-local hardcoded RE drifted from
 * actual sync targets (7 prefixes vs 12+ kinds of files written by propagate).
 *
 * Categories covered:
 *   - Rule / skill / command / agent / hook / scripts injected via sync-rules
 *     into `.claude/<dir>/`
 *   - Derived agent projections at `.agents/`, `.codex/`
 *   - Plumbing JSON: `.claude/hub.json`, `.claude/.hub-state.json`,
 *     `.claude/sync-to-codex.config.json`
 *   - Improvement-loop infra: `.clade/bin/`, `.clade/signals/`, `.clade/vendor/`
 *   - Vendored scripts at `scripts/` (wt-helper, claim-helper, stash-reconcile,
 *     review-gui, audit-test-scripts, handoff-drift-scan, wip-dirty,
 *     git-merge-clade-regenerate, spectra-archive-sidecar, dev-singleton)
 *   - Recursive vendored script trees: `scripts/spectra-advanced/`,
 *     `scripts/pre-commit/`, `scripts/pre-push/`
 *   - Snippets / shared presets: `vendor/snippets/`, `vendor/oxc-shared/`
 *   - GitHub Composite Actions vendored at `.github/actions/`
 *   - Top-level injected files: `AGENTS.md`, `CLAUDE.md`
 *   - utility: `utils/assert-never.ts`
 *
 * Symlink 模式決策（2026-06-11）：consumer `.claude/rules/*.md` 改為絕對路徑
 * symlink 指向 `<cladeRoot>/dist/<consumer_id>/rules/<name>.md` 後，**仍歸
 * LOCKED_PROJECTION_RE 管** — symlink blob 本身就是 clade-managed 產物，
 * 且 wt-helper merge-back auto-resolve take-theirs(main) 對 mode 120000 blob
 * 行為正確（取 main 側 symlink blob 即還原正確 target）。regex 本體與程式邏輯
 * 零改動；symlink-aware guard 在 propagate.ts（isCladeDistSymlink）處理。
 *
 * NEVER widen this without (a) ensuring propagate.ts actually writes the new
 * category, AND (b) confirming consumer auto-reset / wt-helper merge-back
 * classification both honor it.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const LOCKED_PROJECTION_RE = new RegExp(
  '^(' +
    [
      // Sync-rules injected directories (.claude/)
      String.raw`\.claude/(rules|skills|commands|agents|scripts|hooks)/`,
      // Derived agent projections
      String.raw`\.agents/`,
      String.raw`\.codex/`,
      // Plumbing JSON files
      String.raw`\.claude/(hub\.json|\.hub-state\.json|sync-to-codex\.config\.json)$`,
      // Improvement-loop infra (.clade/)
      // `scripts` / `registry` 於 2026-08-24 補上（TD-639）：兩者都是 improvement-loop
      // 投影的整目錄（`.clade/scripts/` 五支 + `.clade/registry/consumers.json`），
      // 抽查 <consumer-a> / <consumer-b> / <consumer-f> / <consumer-k> 四台，目錄內**沒有**任何 consumer
      // 自家檔——與 `scripts/lib/` 那種混住的目錄不同，可以整目錄匹配。
      String.raw`\.clade/(bin|signals|vendor|scripts|registry)/`,
      // Vendored script entry points (scripts/)
      String.raw`scripts/(wt-helper|claim-helper|stash-reconcile|review-gui|audit-test-scripts|audit-ux-drift|audit-risk-path-coverage|audit-clade-leak|deploy-trigger-check|handoff-drift-scan|wip-dirty|git-merge-clade-regenerate|locked-projection|_git-lock-detect|spectra-archive-sidecar|dev-singleton|dev-router|dev-session|db-lease|db-reset-peer-coordination)\.(mjs|mts|ts)$`,
      // Heavy-gate 併發閘門（bash helper，非 .mjs/.ts 家族，故單列一條）
      String.raw`scripts/gate-slot\.sh$`,
      // Recursive vendored script trees
      String.raw`scripts/(spectra-advanced|pre-commit|pre-push|checks)/`,
      // Vendored helpers under scripts/lib/ — MUST stay an explicit filename list.
      // NEVER widen to `scripts/lib/`: consumers author their own files there
      // (<consumer-a> `common.sh` / `read-infra-manifest.mjs`, <consumer-d> `vue-component-resolution.ts`),
      // and matching the whole dir would mark those clade-managed → auto-reset clobbers them.
      String.raw`scripts/lib/(evidence-store|detect-runtime|wt-env-bootstrap-runner|dev-workspace|json-unknown)\.(mjs|mts|ts)$`,
      // json-unknown.ts 第二條 dest：vendor/review-rules/scan.ts 以
      // `../scripts/lib/json-unknown.ts` 解析到 vendor/scripts/lib/。
      // NEVER 放寬成 `vendor/scripts/lib/`——那個目錄在 clade home 是源。
      String.raw`vendor/scripts/lib/json-unknown\.ts$`,
      // Snippets / shared presets
      String.raw`vendor/(snippets|oxc-shared|doctor-shared|review-rules|husky)/`,
      // prepare-commit-msg 掛載點 —— 逐檔列出，**NEVER** 放寬成 `\.husky/`：
      // consumer 的 commit-msg / pre-commit / pre-push 是 init-consumer 寫的自家檔，
      // 整個目錄標成 clade-managed 會讓 auto-reset 把它們清掉。
      String.raw`\.husky/prepare-commit-msg$`,
      // GitHub vendored actions
      String.raw`\.github/actions/`,
      // Utility files —— dest 是 `join(consumerRoot, manifest.paths.utils ?? 'utils',
      // 'assert-never.ts')`（`scripts/lib/vendor-targets.ts`），**utils 目錄可設定**。
      // 舊版寫死 `^utils/` 只蓋得到 default 值：任何設了 `paths.utils` 的 consumer，
      // 這支投影都不被認得 → auto-reset 當成 user-authored。目前 fleet 無人設定，所以是
      // 潛在而非現行漏洞；由 TD-400 把 `_validate-manifests` 改成全開 manifest 後浮出來。
      String.raw`(?:[^/]+/)*utils/assert-never\.ts$`,
      // Top-level injected files
      String.raw`AGENTS\.md$`,
      String.raw`CLAUDE\.md$`,
      String.raw`commitlint\.config\.ts$`,
    ].join('|') +
    ')',
)

export const isLockedProjectionPath = (p) => LOCKED_PROJECTION_RE.test(p)

/**
 * clade home 內「看起來像投影、其實是源檔」的路徑（TD-344）。
 *
 * `LOCKED_PROJECTION_RE` 描述的是 **consumer 端**的事實：這些路徑的內容由 clade 產生，
 * 就地改動會被下次 propagate 覆蓋，所以不算 user WIP。同一條規則搬到 clade home 語義**反轉**
 * —— `vendor/snippets/**` 在這裡是被 propagate 讀的那一份，是最不該被當成可再生內容的東西。
 *
 * 這裡只收「已驗證在 clade home 為源檔」的項，NEVER 直接鏡射整個 `LOCKED_PROJECTION_RE`：
 * `.claude/**`（clade home 消費自家 hub skill 的 symlink）與 `.github/actions/`
 * （clade 自己的源在 `vendor/actions/`）在 clade home 仍然是投影，照舊過濾。
 */
const CLADE_OWN_SOURCE_RE = new RegExp(
  '^(' +
    [
      String.raw`vendor/(snippets|oxc-shared|doctor-shared|review-rules)/`,
      // clade home 的源檔在 `vendor/utils/assert-never.ts`。上面那條放寬成
      // `(?:[^/]+/)*utils/assert-never\.ts$` 之後，源檔自己也會命中 LOCKED_PROJECTION_RE
      // —— 沒有這一列，clade home 會把自己的源檔當投影過濾掉，改動不再算 user WIP。
      String.raw`vendor/utils/assert-never\.ts$`,
      String.raw`utils/assert-never\.ts$`,
      // json-unknown.ts 源檔在 vendor/scripts/lib/；LOCKED_PROJECTION_RE 為
      // consumer dest 加了同路徑之後，沒有這一列 clade home 會把自己的源當投影。
      String.raw`vendor/scripts/lib/json-unknown\.ts$`,
      String.raw`AGENTS\.md$`,
      String.raw`CLAUDE\.md$`,
      String.raw`commitlint\.config\.ts$`,
    ].join('|') +
    ')',
)

const cladeSourceRepoCache = new Map()

/**
 * repoRoot 是不是 clade 中央倉本身（含它的 linked worktree）。
 *
 * 判定走 **git 回推 + clade-only marker**，NEVER 比對路徑字串 `offline/clade`：worktree 落在
 * `~/offline/clade-wt/<slug>/`，而 clade 本身可以被 clone 到任何位置——路徑比對兩邊都會錯。
 *
 * fail-closed：git 不可用 / 取不到 common dir 時回 false，行為退回加這層之前（照舊過濾）。
 */
export function isCladeSourceRepo(repoRoot) {
  if (!repoRoot) return false
  const cached = cladeSourceRepoCache.get(repoRoot)
  if (cached !== undefined) return cached

  let result = false
  try {
    const commonDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    // main worktree 回 `<root>/.git`、linked worktree 回 `<main>/.git/worktrees/<slug>`，
    // 兩者的 dirname 都是 main worktree 的 root。
    const mainRoot = dirname(commonDir)
    result =
      existsSync(join(mainRoot, 'registry', 'consumers.json')) &&
      existsSync(join(mainRoot, 'scripts', 'publish.ts')) &&
      existsSync(join(mainRoot, 'vendor', 'scripts', 'locked-projection.ts'))
  } catch {
    result = false
  }

  cladeSourceRepoCache.set(repoRoot, result)
  return result
}

/**
 * repo-aware 版的 `isLockedProjectionPath`：**判 user WIP 的呼叫端一律用這支**
 * （stop-wip-guard / drift-scan / handoff-scan userWip / merge-back 的未 commit gate）。
 *
 * 純粹問「這個路徑的內容由 clade 產生嗎」的呼叫端（`_validate-manifests` 的 vendor-targets
 * 交叉檢查）**不該**改用這支——那個問題的答案與 repo 身分無關。
 */
export function isLockedProjectionPathFor(repoRoot, p) {
  if (CLADE_OWN_SOURCE_RE.test(p) && isCladeSourceRepo(repoRoot)) return false
  return LOCKED_PROJECTION_RE.test(p)
}
