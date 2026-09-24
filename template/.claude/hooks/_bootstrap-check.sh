#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/_bootstrap-check.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/_bootstrap-check.sh
#
# clade — bootstrap-check.sh
#
# 由 SessionStart hook 觸發。職責：
#   0. codebase-memory-mcp auto-index（fire-and-forget，不阻擋）
#   1. 確認 clade repo 找得到
#   2. 確認 .clade/manifest.json（或 legacy .claude/hub.json）存在
#   3. 跑 sync-rules --check 偵測 drift / orphan
#   4. drift 存在 → 嘗試自動修復（跑 bootstrap-hub.ts）
#   5. 仍失敗 → 印 blocking warning（讓使用者明確看到）
#
# Vendor 在 consumer 的 .claude/hooks/_bootstrap-check.sh，由 clade vendor 維護。
# 改動本檔的母本在：clade/vendor/_bootstrap-check.sh
#
# Exit code 行為：
#   0 = 正常 / 自動修復成功
#   1 = 嚴重錯誤（無法找到 clade repo、manifest 缺等不可自動修復狀況）
# SessionStart hook 的 non-zero exit 不一定擋 session，但 stderr 會顯示給使用者。

set -u

# 專案根目錄。下面這個變數只有 Claude 端會帶進來；Codex 端沒有對應的 env，會落到
# fallback。fallback 取 git toplevel 而非 pwd：session cwd 可能是 repo 的子目錄，
# 用 pwd 會讓 manifest 找不到，也會讓 auto-index 把子目錄當成獨立 project 建 index。
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
STATE_JSON="$PROJECT_ROOT/.claude/.hub-state.json"

# ─────────────────────────────────────────────────────────
# 0. codebase-memory-mcp auto-index（fire-and-forget）
# ─────────────────────────────────────────────────────────
# 若 binary 存在且當前 repo 尚未 index，背景跑 fast index。
# Silent skip on any error — 不阻擋 session 啟動。
#
# Identity/readiness is shared with explicit indexing and post-commit refresh.
# Main aliases are reused only when their stored root matches this checkout;
# worktrees use path-derived IDs. A populated graph does not prove freshness.

maybe_auto_index() {
  local wrapper="" candidate script_dir
  script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  for candidate in "$script_dir/scripts/cbm-index.sh" \
    "$PROJECT_ROOT/vendor/scripts/cbm-index.sh" "$PROJECT_ROOT/scripts/cbm-index.sh" \
    "$PROJECT_ROOT/.clade/scripts/cbm-index.sh" "$HOME/offline/clade/vendor/scripts/cbm-index.sh"; do
    if [[ -x "$candidate" && -f "$(dirname "$candidate")/cbm-project.sh" ]]; then
      wrapper=$candidate
      break
    fi
  done
  [[ -n "$wrapper" ]] || return 0
  source "$(dirname "$wrapper")/cbm-project.sh"
  cbm_resolve_project "$PROJECT_ROOT" || return 0
  cbm_is_temporary && return 0
  if [[ "$CBM_NODES" -gt 0 ]]; then
    printf 'codebase-memory-mcp: project="%s" status=ready nodes=%s (coverage/freshness unverified)\n' "$CBM_PROJECT" "$CBM_NODES"
    return 0
  fi
  command -v codebase-memory-mcp >/dev/null 2>&1 || [[ -x "$HOME/.local/bin/codebase-memory-mcp" ]] || return 0
  printf 'codebase-memory-mcp: project="%s" status=indexing (fast, background; results not ready yet)\n' "$CBM_PROJECT"
  nohup "$wrapper" "$CBM_REPO" fast >/dev/null 2>&1 &
  disown 2>/dev/null || true
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
  if [[ -n "${CLADE_HOME:-}" && -f "$CLADE_HOME/registry/consumers.json" ]]; then
    echo "$CLADE_HOME"; return 0
  fi
  for c in "$HOME/clade" "$HOME/offline/clade"; do
    if [[ -f "$c/registry/consumers.json" ]]; then
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
# .clade/manifest.json / .claude/hub.json（它是散播的源頭，不是 consumer），會在那裡靜默 exit 0。
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

# TD-1007：stop-wip-guard 把 orphan WIP 委派給下一個 session-start。這支是 consumer 與
# clade home 都會跑的 SessionStart（投影到 `.claude/hooks/_bootstrap-check.sh`）。
# MUST 在下面「沒 manifest 就 exit 0」之前：clade home 沒有 consumer manifest，放在那之後永遠跑不到。
# NEVER 再掛進 session-start-stalled.sh：那支只在 clade home settings，兩邊都掛會跑兩次。
# 只轉印 orphan WIP 列；失敗／逾時不改這支 hook 的 exit。
#
# 掃描本身在背景跑、結果落 git common dir 的快取，前景最多等 3 秒：
# clade home 有上百棵 worktree，一輪掃描 4–10 秒。前景 `timeout 3` 會每次都殺掉它，
# orphan WIP 就在最需要它的 repo 靜默消失（0-A #254）。等不到時印**上一輪完成的結果**，
# 這一輪的結果下一個 session 看得到；**NEVER** 改回前景 timeout 砍掉掃描。
maybe_orphan_wip() {
  local name="handoff-drift-scan.ts" scan=""
  local common cache tmp pid deadline
  for scan in "$PROJECT_ROOT/vendor/scripts/$name" "$PROJECT_ROOT/scripts/$name"; do
    [[ -f "$scan" ]] || continue
    common=$(git -C "$PROJECT_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 0
    cache="$common/clade-handoff-drift.last"
    tmp="$cache.$$"
    local -a guard=()
    command -v timeout >/dev/null 2>&1 && guard=(timeout 120)
    (
      cd "$PROJECT_ROOT" || exit 0
      # scanner 本身 fail-open：拋錯時只印 `[handoff-drift] error (non-fatal)` 仍 exit 0。那一行
      # 不是掃描結果，NEVER 讓它覆寫上一輪的快取、也 NEVER 當成本輪新鮮結果（0-A #254 第三輪）。
      if ${guard[@]+"${guard[@]}"} node "$scan" >"$tmp" 2>&1 &&
        ! grep -qF '[handoff-drift] error' "$tmp" && mv -f "$tmp" "$cache"; then exit 0; fi
      rm -f "$tmp"
      exit 1
    ) </dev/null >/dev/null 2>&1 &
    pid=$!
    # 牆鐘期限，NEVER 數迴圈次數：高負載下每次 `sleep 0.1` 都會拖長，30 次可以超過 5 秒。
    local wait_s="${CLADE_HANDOFF_DRIFT_WAIT_S:-3}"
    [[ "$wait_s" =~ ^[0-9]+$ ]] || wait_s=3
    deadline=$((SECONDS + wait_s))
    while kill -0 "$pid" 2>/dev/null && ((SECONDS < deadline)); do
      sleep 0.1
    done
    # fresh=1 只在「這一輪的掃描完成且改寫了快取」時成立。掃描失敗／`timeout 120` 砍掉時
    # 快取仍是上一輪的，NEVER 用本輪的標頭印它（0-A #254 第二輪）。
    local running=0 fresh=0 report=""
    if kill -0 "$pid" 2>/dev/null; then
      running=1
      disown "$pid" 2>/dev/null || true
    elif wait "$pid" 2>/dev/null; then
      fresh=1
    fi
    if [[ ! -s "$cache" ]]; then
      ((running)) && echo "[handoff-drift] 掃描 >3s 仍在背景跑，尚無上一輪結果；下一個 session 會顯示" >&2
      return 0
    fi
    # 只轉印 orphan WIP（本 hook 的職責）。其餘 drift 類型在 clade home 一輪可達數十條，
    # 每個 session 灌一次會蓋掉這一條；它們照舊由 `/handoff` 的 scan 呈現。
    report=$(grep -F '(orphan-uncommitted-wip)' "$cache" || true)
    [[ -n "$report" ]] || return 0
    if ((running)); then
      echo "[handoff-drift] orphan WIP（本輪掃描 >3s 仍在背景跑；以下是上一輪完成的結果）：" >&2
    elif ((!fresh)); then
      echo "[handoff-drift] orphan WIP（本輪掃描失敗或逾時；以下是上一輪完成的結果）：" >&2
    else
      echo "[handoff-drift] orphan WIP：" >&2
    fi
    printf '%s\n' "$report" >&2
    return 0
  done
  return 0
}

maybe_orphan_wip

# ─────────────────────────────────────────────────────────
# 2. 沒 manifest = 此 repo 不是 clade consumer，靜默退出
# ─────────────────────────────────────────────────────────

if [[ ! -f "$PROJECT_ROOT/.clade/manifest.json" && ! -f "$PROJECT_ROOT/.claude/hub.json" ]]; then
  exit 0
fi

# ─────────────────────────────────────────────────────────
# 3. 沒 clade repo = 阻擋
# ─────────────────────────────────────────────────────────

if ! CLADE_ROOT=$(find_clade_root); then
  cat >&2 <<EOF

[clade] ✘ 找不到 clade repo

此專案的 clade manifest 宣告需要 clade 配置中央倉，但本機沒裝。

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

# readonly session（herdr-session-handoff 對 readonly table row 注入 CLADE_WORKSPACE_READONLY=1，
# 例：0-A reviewer）NEVER 自動修復：bootstrap-hub 會改寫投影，而這棵樹正被 review——
# 2026-09-23 一次 v1.13.19→v1.13.20 bump 在受審樹改了 45 條投影路徑，
# claude-review-safe.sh 的 snapshot 檢查把 verdict 作廢（exit 6）。只回報，照受審當下的樹審。
if [[ "${CLADE_WORKSPACE_READONLY:-}" == "1" ]]; then
  FIRST_ERROR=$(printf '%s\n' "$CHECK_OUTPUT" | grep -m1 '\[clade error\]' || true)
  echo "[clade] 偵測到 drift / orphan，readonly session 不自動修復（CLADE_WORKSPACE_READONLY=1）${FIRST_ERROR:+: $FIRST_ERROR}" >&2
  exit 0
fi

# drift / orphan 偵測到 → 嘗試自動修復
# 第一行 MUST 帶上實際錯誤：Grok / 部分 harness 只展示 SessionStart stderr 的首行，
# 只寫「自動修復中」會讓人以為 hook 卡死，真正的 conflict path 被截掉。
FIRST_ERROR=$(printf '%s\n' "$CHECK_OUTPUT" | grep -m1 '\[clade error\]' || true)
echo "[clade] 偵測到 drift / orphan，自動修復中${FIRST_ERROR:+: $FIRST_ERROR}" >&2
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
