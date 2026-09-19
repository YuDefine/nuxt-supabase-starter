#!/usr/bin/env bash
# Stop hook — warn (not block) when working tree has uncommitted user WIP.
# Multi-session 並行共用 working tree 是常態，別 session 的 dirty file 不應 block 當前 session 停止。
# 真正的 orphan WIP 由 Layer 2（handoff-drift-scan Trigger 5）在下個 session-start 接住。
#
# 非 git repo / helper 不存在 / node 缺 → silent exit 0。

set -euo pipefail

cat > /dev/null

# ── 今日 task 檔未歸檔提示（session-tasks 規約的「升級或刪，二擇一」）────────
# 只看今天建立的檔：舊檔的堆積由 audit-stale-tasks.ts 事後稽核，Stop hook 每次都唸
# 別 session 的舊檔會變成背景噪音。task 檔多半已 commit，所以這段不能放在下面的
# wip-dirty 檢查之後——乾淨 working tree 同樣需要這個提示。
if [ -d tasks ]; then
  today=$(date +%Y-%m-%d)
  today_tasks=$(find tasks -maxdepth 1 -name "${today}-*.md" 2>/dev/null || true)
  if [ -n "$today_tasks" ]; then
    cat >&2 <<EOF
⚠️ 今日的 task 檔尚未歸檔：
$(printf '%s\n' "$today_tasks")
   對每個未完項升級（HANDOFF / tech-debt / ROADMAP）或直接刪，再 mv 到 tasks/archive/。
EOF
  fi
fi

# 定位 wip-dirty helper — consumer 端 scripts/，clade 端 vendor/scripts/
helper=""
for candidate in \
  "scripts/wip-dirty.ts" \
  "vendor/scripts/wip-dirty.ts"; do
  if [ -f "$candidate" ]; then
    helper="$candidate"
    break
  fi
done

# helper 不存在 / node 缺 → fail-open
if [ -z "$helper" ]; then
  exit 0
fi
if ! command -v node >/dev/null 2>&1; then
  exit 0
fi

# wip-dirty.ts：exit 0 = 無 user WIP（乾淨 / 全 projection / 非 git）→ 放行；
#               exit 1 + stdout user WIP 清單 = 有未 commit user WIP。
node_exit=0
wip=$(node "$helper" 2>/dev/null) || node_exit=$?
if [ "$node_exit" = "0" ]; then
  exit 0
fi

count=$(printf '%s\n' "$wip" | grep -c . 2>/dev/null || printf '0')
cat >&2 <<EOF
⚠️ working tree 有 ${count} 個未 commit 的 user WIP（已排除 clade projection）：
$(printf '%s\n' "$wip" | head -10)
EOF
exit 0
