#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/cbm-index.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/cbm-index.sh
# cbm-index.sh — codebase-memory index 的唯一入口（lock + 記憶體天花板）
#
# NEVER 裸跑 `codebase-memory-mcp cli index_repository` —— 兩道保護都在這支：
#   1. flock -n  每個 repo 同時只有一個 index 在跑（去抖：已有人在跑就放棄，
#      反正它跑完就是新的）
#   2. MemoryMax cgroup 天花板。index worker 記憶體無界成長，2026-08-25 實測
#      單一 worker anon-rss 衝到 16.2G 觸發 OOM killer，把整台機器拖進 swap
#      thrashing。工具自報的 budget_mb 對它自己沒有約束力。
#
# 用法：cbm-index.sh [repo_path]   （省略則取 git toplevel，再退回 cwd）
set -euo pipefail

repo="${1:-}"
if [ -z "$repo" ]; then
  repo="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi
repo="$(cd "$repo" 2>/dev/null && pwd)" || exit 0

# tmp 測試 worktree 不建 index —— 它們用完即棄，但 DB 會留下來。
# 2026-08-27 實測 cache 累積 4.2G 垃圾，其中絕大多數是這類路徑的殘骸。
case "$repo" in
  /tmp/*) exit 0 ;;
  "$HOME"/.tmp/*) exit 0 ;;
esac

command -v codebase-memory-mcp >/dev/null 2>&1 || exit 0

# slug MUST 與 codebase-memory 自己的命名規則一致：只把 `/` 換成 `-`，**保留點**。
# 依據 vendor/scripts/wt-helper.ts cleanupCodebaseMemoryIndex()：
#   worktreePath.replace(/^\//, '').replace(/\//g, '-')
# NEVER 用 `[^A-Za-z0-9]` 一律換掉——那會把 `.claude/worktrees/` 與 `.tmp/` 底下的路徑
# 算出對不上的檔名，DB 找不到而永遠誤報「尚未建 index」。clade 主路徑不含點，
# 所以只測主 repo 驗不出這個差異。
slug="$(printf '%s' "$repo" | sed 's|^/||; s|/|-|g')"
lock="${TMPDIR:-/tmp}/cbm-index-${slug}.lock"

# Opportunistic 清理：綁在 index 這個真實動作上，不排程盲跑。
cache="${XDG_CACHE_HOME:-$HOME/.cache}/codebase-memory-mcp"
[ -d "$cache" ] && find "$cache" -maxdepth 1 -name '*.corrupt' -mtime +7 -delete 2>/dev/null || true

mem="${CBM_INDEX_MEM_MAX:-6G}"
cpu="${CBM_INDEX_CPU_QUOTA:-200%}"

# systemd --user 不可用時（容器 / 非 systemd）退回純 flock：
# 少了記憶體天花板，但序列化仍在，仍優於裸跑。
if case "$(systemctl --user is-system-running 2>/dev/null)" in running|degraded) true ;; *) false ;; esac; then
  exec systemd-run --user --scope -q \
    -p MemoryMax="$mem" -p MemorySwapMax=0 -p CPUQuota="$cpu" \
    flock -n "$lock" \
    codebase-memory-mcp cli index_repository "{\"repo_path\":\"$repo\"}"
else
  exec flock -n "$lock" \
    codebase-memory-mcp cli index_repository "{\"repo_path\":\"$repo\"}"
fi
