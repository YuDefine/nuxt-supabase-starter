#!/bin/bash
# post-propose-design-inject.sh
# PostToolUse hook: after spectra-propose, check if change has UI scope
# and remind Claude to add Design Review tasks if missing.
#
# This hook CANNOT edit files — it outputs a message that Claude sees and acts on.

set -euo pipefail

# Monorepo detection
if [ -d "${PROJECT_DIR}/template/app" ]; then
  _PROJECT="${PROJECT_DIR}/template"
else
  _PROJECT="${PROJECT_DIR}"
fi

INPUT=$(cat)
SKILL=$(echo "$INPUT" | jq -r '.tool_input.skill // ""' 2>/dev/null || echo "")

# 只對 spectra-propose 觸發
if [ "$SKILL" != "spectra-propose" ] && [ "$SKILL" != "spectra:propose" ]; then
  exit 0
fi

OPENSPEC_DIR="${_PROJECT}/openspec"

# Find the most recently modified change directory (just created by propose)
LATEST_CHANGE=""
LATEST_MTIME=0

if [ -d "$OPENSPEC_DIR/changes" ]; then
  for dir in "$OPENSPEC_DIR/changes"/*/; do
    [ -d "$dir" ] || continue
    # Skip archive subdirectory
    [[ "$dir" == *"/archive/"* ]] && continue

    tasks_file="$dir/tasks.md"
    [ -f "$tasks_file" ] || continue

    # Get modification time (macOS stat format)
    mtime=$(stat -f %m "$tasks_file" 2>/dev/null || stat -c %Y "$tasks_file" 2>/dev/null || echo 0)
    if [ "$mtime" -gt "$LATEST_MTIME" ]; then
      LATEST_MTIME=$mtime
      LATEST_CHANGE="$dir"
    fi
  done
fi

# No change found
if [ -z "$LATEST_CHANGE" ]; then
  exit 0
fi

TASKS_FILE="$LATEST_CHANGE/tasks.md"
CHANGE_NAME=$(basename "$LATEST_CHANGE")

# Check if tasks reference UI files
HAS_UI=false
if grep -qiE '\.vue|pages/|components/|layouts/' "$TASKS_FILE" 2>/dev/null; then
  HAS_UI=true
fi

# No UI scope — silent exit
if [ "$HAS_UI" = false ]; then
  exit 0
fi

# Check if Design Review section already exists
if grep -q '## .*Design Review' "$TASKS_FILE" 2>/dev/null; then
  exit 0
fi

# UI scope detected but no Design Review section — remind Claude
cat <<EOF
📐 Design Review 提醒：change「${CHANGE_NAME}」包含 UI 任務但 tasks.md 缺少 Design Review 區塊。

請依 .claude/rules/proactive-skills.md 的「Design Review Task Template」，在 tasks.md 最後功能區塊之後加入：

## N. Design Review

- [ ] N.1 檢查 .impeccable.md 是否存在，若無則執行 /impeccable teach
- [ ] N.2 執行 /design improve [affected pages/components]
- [ ] N.3 依 /design 計劃按 canonical order 執行 targeted skills
- [ ] N.4 執行 /audit — 確認 Critical = 0
- [ ] N.5 執行 review-screenshot — 視覺 QA

（N = 上一個功能區塊序號 + 1，[affected pages/components] 替換為實際範圍）
EOF

exit 0
