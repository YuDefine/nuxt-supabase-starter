// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/register-paths.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/register-paths.ts
/**
 * clade home 的「登記簿」路徑與 append-only ledger——兩者都**不是**標準層源檔。
 *
 * 登記簿 allowlist：HANDOFF／ROADMAP／docs／tasks／plan package／主持者交棒／session 清單，職責要求它們當下寫在
 * 共享的本機 main 上，由 `main-sync.ts` 收斂回 origin，或由 worktree 跑 `register-land.ts` 直接落地
 * （人讀版在 clade-home-worktree § 本機 main 與 origin 的同步）。
 *
 * append-only ledger：gate telemetry，本機 main 每跑一次 gate 就 append，永遠 dirty。
 * 逐檔列名，NEVER 泛化成「所有 .jsonl」——main-sync 的收斂判定只看 byte 前綴，
 * 對一個不是 append-only 的檔這個判定是錯的（TD-1109）。
 *
 * 消費端：`main-sync.ts` 與 `register-land.ts`（放行哪些內容差）、`sync-rules.ts`（as-of 座標只把這兩類以外
 * 的未提交改動算成「影響比對結果」）、`wt-batch.ts` 的 merge receipt 檢查
 * （`verifyMergeReceipt`：審查期間 origin/main 前移時，`reviewed_base..merge^` 的每個路徑
 * 都必須通過 `isRegisterPath`，否則拒絕 confirm-merged）。各消費端 MUST 共用這份，NEVER 各自
 * 再寫一份 matcher。
 *
 * 本檔經 sync-vendor 投影到每個 consumer（`wt-batch.ts` 隨 vendor/scripts 散播並 import 它），
 * 改登記簿 allowlist 等於同時改 main-sync 放行範圍、sync-rules 比對與 merge receipt 的前移放行，
 * 並影響整個 fleet。
 */

export const REGISTER_EXACT: ReadonlySet<string> = new Set(['HANDOFF.md', 'ROADMAP.md'])
// `specs/coordinator/`、`specs/sessions/` 是 clade home 的交棒與 session 清單落點；
// `tasks/` 是 consumer 的同一用途落點，所以兩者都在。
export const REGISTER_PREFIXES: readonly string[] = [
  'docs/',
  'tasks/',
  'specs/plans/',
  'specs/coordinator/',
  'specs/sessions/',
]

// 每一檔都已逐檔證明：寫入端只走 vendor/signals/ledger-writer.ts 的 appendRecord(s)（同一把
// `<ledger>.lock`），讀取端只有 improvement-digest／propagate cadence 提示／audit-pitfall-detector-decay
// 這類資料消費者，不是任何 CI／gate／check 的輸入（證據在 PR body，W-2026-10-28-main-sync-candidates-digest-runs-pitfall-detecto）。
// 加成員前 MUST 重做同一組證明；同時抬 main-sync.ts 的 LEDGER_LOCK_STALE_MS 與
// ledger-writer.ts 的 CLADE_HOME_STALE_LOCK_MS（每檔最壞 +20s 持鎖）。
export const LEDGER_APPEND_PATHS: ReadonlySet<string> = new Set([
  'vendor/ledger/signals.jsonl',
  'vendor/ledger/candidates.jsonl',
  'vendor/ledger/outcomes.jsonl',
  'vendor/ledger/digest-runs.jsonl',
  'vendor/ledger/pitfall-detector-runs.jsonl',
])

/**
 * 「可在 sealed batch 期間前移 origin/main」的路徑——每一項都必須已證明**不是**任何 gate
 * （CI、0-A、0-C、sync-rules）的輸入。消費端只有 `wt-batch.ts` 的 `assertBatchBase`：
 * pr-merge-based 的 review／seal 遇到 origin/main 前移時，只有 `b.base..origin/main` 的
 * 變更路徑全落在這個集合、且與候選路徑不相交才放行，其餘照舊拒收。
 *
 * 起手為空集合（Charles 2026-10-19 flow ee25daf7 答 A）：程式路徑就位，行為等同舊判準。
 * NEVER 沿用上面的登記簿 allowlist 當這個集合（`specs/plans/`、`docs/` 是 gate 輸入）；
 * 加成員前 MUST 先逐項證明讀它的 gate 與讀取點，寫進
 * `specs/plans/W-2026-09-25-batch-merge-main-churn/plan.md` § Evidence。
 * 只放精確檔名，不放目錄前綴。
 */
export const PROVEN_NON_GATE: ReadonlySet<string> = new Set<string>()

export function isRegisterPath(path: string): boolean {
  if (REGISTER_EXACT.has(path) === true) return true
  for (const prefix of REGISTER_PREFIXES) {
    const dir = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
    if (path === dir || path.startsWith(`${dir}/`)) return true
  }
  return false
}
