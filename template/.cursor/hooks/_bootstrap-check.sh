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

maybe_auto_index() {
  # 安裝位置是 machine-local state：PATH 優先（homebrew / npm -g / mise 各有落點），
  # ~/.local/bin 只是最後的 fallback。寫死單機路徑正是本 hook 要避免的 config drift，
  # 見 docs/pitfalls/2026-05-18-consumer-mcp-codebase-memory-missing.md。
  local bin
  bin=$(command -v codebase-memory-mcp 2>/dev/null) || bin="${HOME}/.local/bin/codebase-memory-mcp"
  [[ -x "$bin" ]] || return 0

  local project_id
  project_id=$(echo "$PROJECT_ROOT" | sed 's|^/||; s|/|-|g')

  local status_json
  status_json=$("$bin" cli index_status "{\"project\":\"$project_id\"}" 2>/dev/null) || status_json=""

  if echo "$status_json" | grep -q '"status":"ready"'; then
    return 0
  fi

  local payload
  payload="{\"repo_path\":\"$PROJECT_ROOT\",\"mode\":\"fast\"}"
  nohup "$bin" cli index_repository "$payload" >/dev/null 2>&1 &
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
