#!/usr/bin/env bash
# PreToolUse:Bash hook — review checklist gate on `git commit`
#
# 觸發條件：tool_input.command 以 `git commit` 開頭、且不含 --no-verify。
# 行為：呼叫 vendor/scripts/review-checklist-audit.ts --staged，
#       違反 → exit 2 擋 commit；通過或無 staged → exit 0 放行。
#
# 解析失敗 / script error / audit script 不存在 → 不擋（fail-open），
# 避免基礎設施故障時封鎖正常 commit 流程。

set -euo pipefail

input=$(cat)

command=""
if command -v jq >/dev/null 2>&1; then
  command=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null || printf '')
fi

# 不是 git commit → 放行
if ! printf '%s' "$command" | grep -qE '^\s*git\s+commit\b'; then
  exit 0
fi

# 含 --no-verify → 物理放行（infra emergency 逃生口）；commit.md hard rule
# 在規約層禁止使用，本 hook 不在 git 層硬擋以保留 hook 自身壞掉時的可逃路徑。
if printf '%s' "$command" | grep -qE '(\s|^)--no-verify(\s|$)'; then
  exit 0
fi

# 定位 audit script — consumer 端在 scripts/，clade 端在 vendor/scripts/
audit_script=""
for candidate in \
  "scripts/review-checklist-audit.ts" \
  "vendor/scripts/review-checklist-audit.ts"; do
  if [ -f "$candidate" ]; then
    audit_script="$candidate"
    break
  fi
done

# 執行 audit；缺少其中一支 validator 時仍繼續檢查其餘 validator。
audit_output=""
audit_exit="0"
if [ -n "$audit_script" ]; then
  audit_output=$(node "$audit_script" --staged 2>&1) || audit_exit=$?
fi

# exit 1 = 違反 → 擋 commit
if [ "$audit_exit" = "1" ]; then
  cat >&2 <<EOF
⛔ Commit blocked by review-checklist-audit (three-layer review rules)

$audit_output

The change violates one or more rules from common / project / local review
rules. Fix the violations and retry. \`--no-verify\` exists as a physical
escape for infra-broken cases only and violates rules/core/commit.md hard
rule — using it represents an explicit deviation from the standard.
EOF
  exit 2
fi

# 走到這裡 = review-checklist audit 沒擋（TD-977 起 control-plane projection validator 已隨 OPSX 退役）
exit 0
