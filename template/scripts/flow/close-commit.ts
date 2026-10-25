// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/close-commit.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/close-commit.ts
/**
 * `flow plan close --apply` 落下的 commit 長相——寫的一側（`plan-lifecycle.ts`）與讀的一側
 * （`verify-check.ts` 的 `work-done`）共用的字面量。
 *
 * 單獨成檔、**不叫 `plan-*`** 的理由：`verify-check.ts` 掛在 `flow.ts` 的頂層 import 上，board（session-start
 * hook 的 `flow brief`）也走它；若它直接 import `plan-paths.ts`，board 路徑就會多載入 plan 模組
 * （`test/work-done-closing-rituals.test.ts` 的 marker 測試守這條）。這裡只放常數與純字串函式，沒有任何相依。
 */

export const PLAN_ROOT = 'specs/plans'

export function planCloseHeader(workId: string): string {
  return `📝 docs(plan): 關閉 ${workId}`
}

export function planCloseTrailer(workId: string): string {
  return `work_id: ${workId}`
}
