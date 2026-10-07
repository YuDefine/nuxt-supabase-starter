#!/usr/bin/env bash
# Stop hook — warn (not block) when working tree has uncommitted user WIP.
# Multi-session 並行共用 working tree 是常態，別 session 的 dirty file 不應 block 當前 session 停止。
# 真正的 orphan WIP 由 Layer 2（handoff-drift-scan Trigger 5）在下個 session-start 接住。
#
# 非 git repo / helper 不存在 / node 缺 → silent exit 0。

set -euo pipefail

cat > /dev/null

# wt-helper.ts／wip-dirty.ts 只取 fleet 成員 main checkout 的那一份（判定與威脅模型見
# _skill-rule-reminder.sh 的 trusted_fleet_helper）：cwd 是 agent `cd` 得到的任意目錄，NEVER 直接
# 執行它底下的腳本。不在 fleet → 這兩段跳過，其餘檢查照跑。
fleet_trust=0
# shellcheck source=_skill-rule-reminder.sh
if . "$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/_skill-rule-reminder.sh" 2>/dev/null; then
  fleet_trust=1
fi

# TD-863: clean main still has a worktree backlog. Warn before any WIP early exit.
# The whole hook has 10s (hooks.json): ancestry-only mode plus an inner 3s cap (portable via
# node, macOS has no `timeout`), so a large backlog never starves the checks below.
wt_helper=""
if [ "$fleet_trust" = 1 ]; then
  wt_helper=$(trusted_fleet_helper "$PWD" wt-helper.ts) || wt_helper=""
fi
if [ -n "$wt_helper" ] && command -v node >/dev/null 2>&1; then
  WT_BACKLOG_TIMEOUT_MS="${WT_BACKLOG_TIMEOUT_MS:-3000}" node -e '
    const { spawnSync } = require("node:child_process")
    const r = spawnSync(process.execPath, [process.argv[1], "backlog", "--no-landed-state"], {
      stdio: ["ignore", process.stderr, process.stderr],
      timeout: Number(process.env.WT_BACKLOG_TIMEOUT_MS),
      killSignal: "SIGKILL",
    })
    if (r.error && r.error.code === "ETIMEDOUT")
      console.error(`⚠️ worktree 堆積檢查逾時（>${process.env.WT_BACKLOG_TIMEOUT_MS}ms）已跳過；跑 node ${process.argv[1]} backlog 看清單`)
  ' "$wt_helper" >&2 || true
fi

# ── 今日 task 檔未歸檔提示（session-tasks 規約的「升級或刪，二擇一」）────────
# 只看今天建立的檔：舊檔的堆積由 audit-stale-tasks.ts 事後稽核，Stop hook 每次都唸
# 別 session 的舊檔會變成背景噪音。task 檔多半已 commit，所以這段不能放在下面的
# wip-dirty 檢查之後——乾淨 working tree 同樣需要這個提示。
if [ -d tasks ]; then
  today=$(date +%Y-%m-%d)
  today_tasks=$(find tasks -maxdepth 1 -name "${today}-*.md" 2>/dev/null || true)
  if [ -n "$today_tasks" ]; then
    # 已遷移 lifecycle 的 repo（specs/truth/work-lifecycle.md 存在）不再有 tech-debt／
    # tasks/archive/ 這兩個落點：未完項併進 plan Open work，做完的檔直接刪。
    # 未遷移的 consumer 維持舊指示，fleet 遷移完才一起拿掉（W-2026-09-20-consumer-lifecycle-migration）。
    if [ -f specs/truth/work-lifecycle.md ]; then
      disposition='對每個未完項併進所屬 plan 的 Open work（specs/plans/<work-id>/plan.md）或直接刪；全部勾完的檔直接 git rm，不搬到 tasks/archive/。'
    else
      disposition='對每個未完項升級（HANDOFF / tech-debt / ROADMAP）或直接刪，再 mv 到 tasks/archive/。'
    fi
    cat >&2 <<EOF
⚠️ 今日的 task 檔尚未歸檔：
$(printf '%s\n' "$today_tasks")
   ${disposition}
EOF
  fi
fi

# 定位 wip-dirty helper — consumer 端 scripts/，clade 端 vendor/scripts/（只認 fleet 成員）
helper=""
if [ "$fleet_trust" = 1 ]; then
  helper=$(trusted_fleet_helper "$PWD" wip-dirty.ts) || helper=""
fi

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
