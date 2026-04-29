#!/usr/bin/env bash
#
# clade — bootstrap-check.sh
#
# 由 SessionStart hook 觸發。職責：
#   1. 確認 clade repo 找得到
#   2. 確認 .claude/hub.json 存在
#   3. 跑 sync-rules --check 偵測 drift / orphan
#   4. drift 存在 → 嘗試自動修復（跑 bootstrap-hub.mjs）
#   5. 仍失敗 → 印 blocking warning（讓使用者明確看到）
#
# Vendor 在 consumer 的 .codex/hooks/_bootstrap-check.sh，由 clade vendor 維護。
# 改動本檔的母本在：clade/vendor/_bootstrap-check.sh
#
# Exit code 行為：
#   0 = 正常 / 自動修復成功
#   1 = 嚴重錯誤（無法找到 clade repo、manifest 缺等不可自動修復狀況）
# SessionStart hook 的 non-zero exit 不一定擋 session，但 stderr 會顯示給使用者。

set -u

PROJECT_ROOT="${PROJECT_DIR:-$(pwd)}"
HUB_JSON="$PROJECT_ROOT/.claude/hub.json"
STATE_JSON="$PROJECT_ROOT/.claude/.hub-state.json"

# ─────────────────────────────────────────────────────────
# 1. 找 clade repo
# ─────────────────────────────────────────────────────────

find_clade_root() {
  if [[ -n "${CLADE_HOME:-}" && -f "$CLADE_HOME/.claude-plugin/marketplace.json" ]]; then
    echo "$CLADE_HOME"; return 0
  fi
  for c in "$HOME/clade" "$HOME/offline/clade"; do
    if [[ -f "$c/.claude-plugin/marketplace.json" ]]; then
      echo "$c"; return 0
    fi
  done
  return 1
}

# ─────────────────────────────────────────────────────────
# 2. 沒 manifest = 此 repo 不是 clade consumer，靜默退出
# ─────────────────────────────────────────────────────────

if [[ ! -f "$HUB_JSON" ]]; then
  exit 0
fi

# ─────────────────────────────────────────────────────────
# 3. 沒 clade repo = 阻擋
# ─────────────────────────────────────────────────────────

if ! CLADE_ROOT=$(find_clade_root); then
  cat >&2 <<EOF

[clade] ✘ 找不到 clade repo

此專案的 .claude/hub.json 宣告需要 clade 配置中央倉，但本機沒裝。

修正：
  git clone <clade-repo-url> ~/clade        # 或 ~/offline/clade
  # 或
  export CLADE_HOME=/path/to/clade

之後 cd 回此專案，跑：
  pnpm hub:bootstrap

EOF
  exit 1
fi

export CLADE_HOME="$CLADE_ROOT"

# ─────────────────────────────────────────────────────────
# 4. sync-rules --check：偵測 drift / orphan
# ─────────────────────────────────────────────────────────

CHECK_OUTPUT=$(node "$CLADE_ROOT/scripts/sync-rules.mjs" --check 2>&1)
CHECK_EXIT=$?

if [[ $CHECK_EXIT -eq 0 ]]; then
  exit 0
fi

# drift / orphan 偵測到 → 嘗試自動修復
echo "" >&2
echo "[clade] 偵測到 drift / orphan，自動修復中..." >&2
echo "$CHECK_OUTPUT" >&2
echo "" >&2

if node "$CLADE_ROOT/scripts/bootstrap-hub.mjs" >&2 \
   && node "$CLADE_ROOT/scripts/sync-rules.mjs" --prune >/dev/null 2>&1; then
  # 再 check 一次確認修好了
  if node "$CLADE_ROOT/scripts/sync-rules.mjs" --check >/dev/null 2>&1; then
    echo "[clade] ✓ 自動修復成功" >&2
    exit 0
  fi
fi

# 修不好 → 嚴重 warning
cat >&2 <<EOF

[clade] ✘ 自動修復失敗

請手動處理：
  pnpm hub:doctor             # 列出問題
  pnpm hub:doctor --prune     # 清除 orphan
  pnpm hub:bootstrap          # 重跑完整 bootstrap

EOF
exit 1
