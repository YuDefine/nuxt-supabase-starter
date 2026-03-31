#!/usr/bin/env bash
# PreToolUse hook: 強制所有 git commit 必須通過 /commit 流程
# exit 2 = 阻擋工具呼叫

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)

# 只攔截 git commit
if ! echo "$CMD" | grep -q '^git commit'; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0

MARKER="$CLAUDE_PROJECT_DIR/.claude/.commit-approved"

# 檢查是否有 /commit 流程的 marker（必須包含有效 token，空檔案 = 偽造）
if [ -f "$MARKER" ]; then
  TOKEN=$(cat "$MARKER" 2>/dev/null | tr -d '[:space:]')
  # Token 必須是 /commit skill 產生的 32+ 字元 hex string
  if [ ${#TOKEN} -lt 32 ] || ! echo "$TOKEN" | grep -qE '^[0-9a-f]{32,}$'; then
    echo "⛔ .commit-approved marker 無效！"
    echo ""
    echo "marker 必須由 /commit skill 產生（包含有效 token）。"
    echo "touch 或手動建立的空檔案會被拒絕。"
    echo ""
    echo "請使用 /commit 來提交變更。"
    rm -f "$MARKER"
    exit 2
  fi
  # token 有效 — 允許 commit，刪除 marker（一次性使用）
  rm -f "$MARKER"
  exit 0
fi

# 沒有 marker — 阻擋 commit
echo "⛔ git commit 被阻擋！"
echo ""
echo "所有 commit 必須通過 /commit 流程，不可直接 git commit。"
echo "/commit 會執行完整品質檢查（simplify → code-review → pnpm check）後才允許 commit。"
echo ""
echo "請使用 /commit 來提交變更。"
exit 2
