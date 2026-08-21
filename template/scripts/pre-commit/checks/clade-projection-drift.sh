#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-commit/checks/clade-projection-drift.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-commit/checks/clade-projection-drift.sh
# CLADE:VENDOR-SCRIPT
#
# clade-projection-drift (pre-commit, staged) — 擋「staged 的 clade vendor 投影檔內容被本地改過」
#
# 擋的是 TD-582 那個失敗型態：consumer 端的人（或 agent）把 `scripts/audit-ux-drift.ts`
# 這類投影檔當自家檔案改、測、commit，下一次 propagate 用 checksum 判 drift 後直接覆寫回
# 源檔版本 —— 沒有衝突、沒有警告，commit message 只寫「升級 clade 至 vX.Y.Z」。
# 2026-08-22 實犯：一整輪 +863/-60 的修正（含 19 則回歸測試）在 40 分鐘後被 `-398` 靜默還原。
#
# 判定範圍是**本次 staged 的投影檔**，NEVER 整倉 vendor drift：
#   - PUBLIC repo（starter / <consumer-c>）在 sync-vendor 之後還會跑 consumer-sanitize
#     改寫投影內容，整倉 drift 對它們是常態；拿它當 gate 等於天天紅燈
#   - staged 視角只在「這次 commit 真的帶著一個被改過的投影檔」時才出聲
#
# propagate 自己的 delivery commit 由 `CLADE_PROPAGATE=1` 放行（`scripts/propagate.ts`
# 的 runGit 統一注入）。propagate 是被授權的寫入者，而且 sanitize 後的內容本來就 ≠ 投影內容。
# 這**不是** `--no-verify`（那條全線禁止）—— hook 照跑，只有這一條 check 認得該身分。
#
# 缺 node / 找不到 clade repo / 不是 consumer（無 .claude/hub.json）一律 soft-skip exit 0：
# 安全網不該把人鎖在門外（同 scripts/lib/pre-commit-governance.ts 的 Layer 3 guard）。
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

# propagate 的 delivery commit —— 授權寫入者，放行
[[ "${CLADE_PROPAGATE:-}" == "1" ]] && exit 0

command -v node >/dev/null 2>&1 || exit 0

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

[[ -f .claude/hub.json ]] || exit 0

# clade root 三選一，鏡射 vendor/git-pre-commit.sh 的 find_clade_root()
CLADE_ROOT="${CLADE_HOME:-}"
for candidate in "$HOME/clade" "$HOME/offline/clade"; do
  [[ -n "$CLADE_ROOT" ]] && break
  [[ -d "$candidate" ]] && CLADE_ROOT="$candidate"
done

[[ -n "$CLADE_ROOT" && -f "$CLADE_ROOT/scripts/sync-vendor.ts" ]] || exit 0

if node "$CLADE_ROOT/scripts/sync-vendor.ts" --check --staged; then
  exit 0
fi

cat <<'EOF' >&2

⚠️  上列檔案是 clade 中央倉的投影，不是本 repo 自家的 script。
   就地改動不會有衝突也不會有警告 —— 下一次 propagate 會用源檔版本直接覆寫，改動整段消失。

修法（擇一）：
  1. 把改動搬到 Source 路徑（$CLADE_HOME/<src>），在 clade 端跑 /clade-publish 散播回來
  2. 本地還原：pnpm hub:vendor --force  然後重新 commit

規約：clade rules/core（consumer 端投影層是唯讀語義）／TD-582
EOF
exit 1
