#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/_bootstrap-check.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/_bootstrap-check.sh
#
# clade — bootstrap-check.sh
#
# 由 SessionStart hook 觸發。職責：
#   0. codebase-memory-mcp auto-index（fire-and-forget，不阻擋）
#   1. 確認 clade repo 找得到
#   2. 確認 .claude/hub.json 存在
#   3. 跑 sync-rules --check 偵測 drift / orphan
#   4. drift 存在 → 嘗試自動修復（跑 bootstrap-hub.ts）
#   5. 仍失敗 → 印 blocking warning（讓使用者明確看到）
#
# Vendor 在 consumer 的 .cursor/hooks/_bootstrap-check.sh，由 clade vendor 維護。
# 改動本檔的母本在：clade/vendor/_bootstrap-check.sh
#
# Exit code 行為：
#   0 = 正常 / 自動修復成功
#   1 = 嚴重錯誤（無法找到 clade repo、manifest 缺等不可自動修復狀況）
# SessionStart hook 的 non-zero exit 不一定擋 session，但 stderr 會顯示給使用者。

set -u

# 專案根目錄。下面這個變數只有 Claude 端會帶進來；Codex 端沒有對應的 env，會落到
# fallback。fallback 取 git toplevel 而非 pwd：session cwd 可能是 repo 的子目錄，
# 用 pwd 會讓 hub.json 找不到，也會讓 auto-index 把子目錄當成獨立 project 建 index。
PROJECT_ROOT="${PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
HUB_JSON="$PROJECT_ROOT/.claude/hub.json"
STATE_JSON="$PROJECT_ROOT/.claude/.hub-state.json"

# ─────────────────────────────────────────────────────────
# 0. codebase-memory-mcp auto-index（fire-and-forget）
# ─────────────────────────────────────────────────────────
# 若 binary 存在且當前 repo 尚未 index，背景跑 fast index。
# Silent skip on any error — 不阻擋 session 啟動。
#
# 名稱契約（2026-08-25 <consumer-b>）：agent 會傳 consumerId / basename（`<consumer-b>`），
# MCP 預設卻用 path-derived id（`home-charles-offline-<consumer-b>`）。對不上時
# search_graph 回 "project not found or not indexed"，且 available_projects
# 只列前 64 筆 —— 真實名稱被藏住，agent 誤判「沒索引」而去 grep。
# 因此：main checkout 用 short name 索引；SessionStart stdout 印出
# `codebase-memory-mcp: project="…"` 讓 agent 不必猜。
# 已存在的 path-derived 圖不要 VACUUM-INTO 改名：`nodes.project` FK 掛
# `projects.name`，只改 PK 會讓 MCP 回 status=empty（nodes=0）。

maybe_auto_index() {
  # 安裝位置是 machine-local state：PATH 優先（homebrew / npm -g / mise 各有落點），
  # ~/.local/bin 只是最後的 fallback。寫死單機路徑正是本 hook 要避免的 config drift，
  # 見 docs/pitfalls/2026-05-18-consumer-mcp-codebase-memory-missing.md。
  local bin
  bin=$(command -v codebase-memory-mcp 2>/dev/null) || bin="${HOME}/.local/bin/codebase-memory-mcp"
  [[ -x "$bin" ]] || return 0

  local cache="${HOME}/.cache/codebase-memory-mcp"
  local path_id short_name="" is_worktree=0
  path_id=$(echo "$PROJECT_ROOT" | sed 's|^/||; s|/|-|g')

  local git_dir git_common
  git_dir=$(git -C "$PROJECT_ROOT" rev-parse --path-format=absolute --git-dir 2>/dev/null) || git_dir=""
  git_common=$(git -C "$PROJECT_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || git_common=""
  if [[ -n "$git_dir" && -n "$git_common" && "$git_dir" != "$git_common" ]]; then
    is_worktree=1
  fi

  if [[ "$is_worktree" -eq 0 ]]; then
    short_name=$(basename "$PROJECT_ROOT")
    if [[ -f "$PROJECT_ROOT/.claude/consumer-meta.json" ]] && command -v jq >/dev/null 2>&1; then
      local cid
      cid=$(jq -r '.consumerId // empty' "$PROJECT_ROOT/.claude/consumer-meta.json" 2>/dev/null || true)
      if [[ "$cid" =~ ^[A-Za-z0-9._-]+$ ]]; then
        short_name=$cid
      fi
    fi
  fi

  # Ready = on-disk nodes>0。不 spawn 270MB CLI；也不只看檔案存在
  # （空的 alias db 會讓 MCP 回 status=empty，比 not-found 更糟）。
  cbm_node_count() {
    local db="$cache/${1}.db"
    [[ -f "$db" ]] || { echo 0; return 0; }
    if command -v sqlite3 >/dev/null 2>&1; then
      sqlite3 "$db" 'SELECT count(*) FROM nodes;' 2>/dev/null || echo 0
    else
      echo -1
    fi
  }

  local ready_name="" ready_nodes=0 n
  if [[ -n "$short_name" ]]; then
    n=$(cbm_node_count "$short_name")
    if [[ "$n" -gt 0 ]]; then
      ready_name=$short_name
      ready_nodes=$n
    fi
  fi
  if [[ -z "$ready_name" ]]; then
    n=$(cbm_node_count "$path_id")
    if [[ "$n" -gt 0 ]]; then
      ready_name=$path_id
      ready_nodes=$n
    elif [[ "$n" -eq -1 && -f "$cache/${path_id}.db" ]]; then
      ready_name=$path_id
      ready_nodes="?"
    fi
  fi

  if [[ -n "$ready_name" ]]; then
    printf 'codebase-memory-mcp: project="%s" status=ready nodes=%s\n' "$ready_name" "$ready_nodes"
    return 0
  fi

  local payload
  if [[ -n "$short_name" ]]; then
    payload="{\"repo_path\":\"$PROJECT_ROOT\",\"mode\":\"fast\",\"name\":\"$short_name\"}"
    printf 'codebase-memory-mcp: project="%s" status=indexing (fast, background)\n' "$short_name"
  else
    payload="{\"repo_path\":\"$PROJECT_ROOT\",\"mode\":\"fast\"}"
    printf 'codebase-memory-mcp: project="%s" status=indexing (fast, background)\n' "$path_id"
  fi
  # 兩道保護，NEVER 拿掉（2026-08-27 事故，見
  # docs/pitfalls/2026-08-27-cbm-auto-index-concurrent-oom.md）：
  #   flock -n     —— 本 hook 在**每個 session 的每次 SessionStart** 觸發，而 ready 判定
  #                   是 nodes>0。DB 一旦損毀，全部 session 同時判「未 index」→ 同一個 repo
  #                   被 N 份併發 index。實測 25 份併發、5 份同時 index 同一個 repo。
  #   MemoryMax    —— index worker 記憶體無界成長，工具自報的 budget_mb 對它自己沒有約束力。
  #                   實測單一 worker anon-rss 衝到 16.2G、18 分鐘內 6 次 OOM kill，SIGKILL
  #                   打斷 journal_mode=delete 的 SQLite 寫入 → DB 損毀 → 迴圈自我維持。
  # 拿不到 lock 就放棄是正確語義：別人正在 index 同一個 repo，它跑完就是新的。
  # payload 一字不動，short name 契約不受影響。
  local lock="${TMPDIR:-/tmp}/cbm-index-${path_id}.lock"
  if [[ "$(systemctl --user is-system-running 2>/dev/null)" =~ ^(running|degraded)$ ]]; then
    nohup systemd-run --user --scope -q \
      -p MemoryMax="${CBM_INDEX_MEM_MAX:-6G}" -p MemorySwapMax=0 -p CPUQuota="${CBM_INDEX_CPU_QUOTA:-200%}" \
      flock -n "$lock" "$bin" cli index_repository "$payload" >/dev/null 2>&1 &
  else
    nohup flock -n "$lock" "$bin" cli index_repository "$payload" >/dev/null 2>&1 &
  fi
  disown
}

maybe_auto_index

# ─────────────────────────────────────────────────────────
# 0.5 temp 分割區壓力預警（fire-and-forget，不阻擋）
# ─────────────────────────────────────────────────────────
#
# 為什麼值得佔一段 session 啟動時間：temp 寫滿的**症狀完全不指向真因**。
# 2026-08-05 實測（<consumer-b>）：測試 fixture 在 /tmp 累積 53,129 個目錄佔 13G，撞爆
# tmpfs 的 usrquota 之後，vitest 547 個測試檔全數失敗於
# `Unknown system error -122`（errno 122 = EDQUOT），重導向的 log 檔變成 0 bytes，
# 連 `wc` 和 `python3` 的 stdout 都寫不出來。整組症狀看起來像 codebase 壞掉，
# 排查花掉的時間遠超過這段檢查的成本。
#
# 只讀 df、不掃目錄（/tmp 有數萬個 entry 時 du 會跑到逾時），所以幾乎零成本。

warn_if_tmp_pressure() {
  local tmp_dir="${TMPDIR:-/tmp}"
  [[ -d "$tmp_dir" ]] || return 0

  # df -P 保證單行輸出格式：Filesystem 1024-blocks Used Available Capacity Mounted
  local cap
  cap=$(df -P "$tmp_dir" 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
  [[ "$cap" =~ ^[0-9]+$ ]] || return 0
  [[ "$cap" -ge 75 ]] || return 0

  cat >&2 <<EOF

[clade] ⚠️  ${tmp_dir} 已用 ${cap}% — 接近寫滿

  寫滿後的症狀不會告訴你是磁碟問題：測試整批失敗於 errno 122 (EDQUOT) 或
  ENOSPC、重導向的 log 變 0 bytes、工具的 stdout 憑空消失。看起來像 code 壞了。

  先看有沒有測試 fixture 殘留：
    node <clade>/vendor/scripts/cleanup-stale-tmp.ts            # 只報告
    node <clade>/vendor/scripts/cleanup-stale-tmp.ts --apply    # 真的清

  根治（讓測試的 temp 關進 run-scoped 沙盒、跑完即刪）：
    package.json 的 test script 包一層
    node <clade>/vendor/scripts/with-scoped-tmp.ts --label <name> -- <原本的指令>

EOF
}

warn_if_tmp_pressure

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
# 1.5 clade home 專用：上次 publish / propagate 有沒有跑完
# ─────────────────────────────────────────────────────────
#
# 位置很重要：必須在下面第 2 段的 early exit **之前**。clade home 沒有
# .claude/hub.json（它是散播的源頭，不是 consumer），會在那裡靜默 exit 0。
#
# consumer 端天然跳過：兩個 guard 檔案只有 clade 中央倉有，shell test 不 spawn
# node，成本是零。輸出走 stderr（SessionStart 只有 stderr 會注入 session context），
# 且只在有事可報時才出聲（--quiet）。任何失敗都不影響 session 啟動。
#
# 成本：clade home 每次 SessionStart 約 1.1s，其中 ~0.97s 是 `git ls-remote`。
# 那一趟網路換到的是「bumped 但沒 push」這一級（既有 audit-governance-drift
# check1 只比本地 tag，抓不到）。要省掉它就得放棄那一級，**不要**為了啟動快
# 個一秒把它拿掉。離線 / 逾時會自動降級跳過該級，不會誤報。

maybe_publish_status() {
  [[ -f "$PROJECT_ROOT/registry/consumers.json" ]] || return 0
  [[ -f "$PROJECT_ROOT/scripts/publish-status.ts" ]] || return 0
  node "$PROJECT_ROOT/scripts/publish-status.ts" --quiet --repo "$PROJECT_ROOT" 2>&1 \
    | head -c 4000 >&2
  return 0
}

maybe_publish_status

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

CHECK_OUTPUT=$(node "$CLADE_ROOT/scripts/sync-rules.ts" --check 2>&1)
CHECK_EXIT=$?

if [[ $CHECK_EXIT -eq 0 ]]; then
  exit 0
fi

# drift / orphan 偵測到 → 嘗試自動修復
echo "" >&2
echo "[clade] 偵測到 drift / orphan，自動修復中..." >&2
echo "$CHECK_OUTPUT" >&2
echo "" >&2

if node "$CLADE_ROOT/scripts/bootstrap-hub.ts" >&2 \
   && node "$CLADE_ROOT/scripts/sync-rules.ts" --prune >/dev/null 2>&1; then
  # 再 check 一次確認修好了
  if node "$CLADE_ROOT/scripts/sync-rules.ts" --check >/dev/null 2>&1; then
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
