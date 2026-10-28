#!/usr/bin/env bash
# SessionStart hook — 糾正帳本有條目達門檻時印一行，並以 additionalContext 交給 Claude 在對話裡問
# 「處理／略過」（W-2026-10-06-retro-1-3-userpromptsubmit-session-sonnet，spec 故事 3）。
#
# 判定與輸出全在 vendor/scripts/correction-ledger.ts remind：達門檻（FR-012）、印出即記為已提醒
# （FR-015）、child／無人值守／cloud／歸類呼叫本身一律靜默（FR-016；判別實測見該 plan
# evidence/open-work-measurements.md §4.3）。帳本是本機資料（~/.local/state/clade/correction-ledger/），
# 所以一律跑 clade home 那份 CLI，不靠 consumer 端的投影。
#
# 讀不到 / 跑不動一律靜默（fail-open，NFR-001）：提醒不得成為 session 啟動的前提。內層 timeout（3s）
# 刻意短於 hooks.json 的 5s。
#
# 可覆寫：CLADE_CORRECTION_LEDGER_CLI（預設 $HOME/offline/clade/vendor/scripts/correction-ledger.ts）

set -uo pipefail
cat > /dev/null
CLI=${CLADE_CORRECTION_LEDGER_CLI:-$HOME/offline/clade/vendor/scripts/correction-ledger.ts}
[ -f "$CLI" ] && command -v node >/dev/null 2>&1 || exit 0
timeout 3 node "$CLI" remind 2>/dev/null || true
exit 0
