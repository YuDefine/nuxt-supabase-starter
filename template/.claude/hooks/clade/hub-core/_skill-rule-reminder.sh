#!/usr/bin/env bash
# _skill-rule-reminder.sh — skill RuleFile 觸發 hook 的共用函式（sourced，不直接執行）。
#
# skill 的 RuleFile（`skills/<skill>/rules/*.md`）除了 SOP step 具名讀取之外，跨 session
# 情境由 hook 觸發：命中時只遞**一行** `READ <repo 相對路徑>`，其餘情況零輸出。本檔放那幾支
# hook 共用、而且 NEVER 各寫一份的幾件事：規則路徑解析、PreToolUse 輸出通道、main 直接
# commit 白名單的判定、linked worktree 判定，以及可信 helper 解析（fleet 成員身分判定——
# 凡是要執行「某個 repo 自帶腳本」的 hook 都走它，不限 RuleFile 提醒）。
#
# 成本契約同 pre-edit-claim-conflict.sh：無事 = 零輸出、exit 0；任何查詢失敗一律靜默
# （fail-open）。這些 hook 是提醒，NEVER 擋下工具呼叫。
#
# Usage（同目錄的 hook）：
#   . "$(dirname "${BASH_SOURCE[0]}")/_skill-rule-reminder.sh"

_SKILL_RULE_REMINDER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"

# skill_rule_path <repo_root> <skill> <rule_rel>
#   依序找 `.claude/skills/<skill>`（consumer 投影）、`.agents/skills/<skill>`（Codex 投影）、
#   `capabilities/core/skills/<skill>`（clade 源檔），取第一個**含該規則檔**的位置，印出相對
#   repo root 的路徑；都沒有就什麼都不印。
#   以「規則檔存在」而非「skill 目錄存在」為準：舊投影的 skill 目錄可能還沒有 rules/，
#   印一個讀不到的 READ 比不印更糟——讀者會學到「這行提示是壞的」。
skill_rule_path() {
  local root="$1" skill="$2" rel="$3" base
  [ -n "$root" ] && [ -n "$skill" ] && [ -n "$rel" ] || return 0
  for base in ".claude/skills/$skill" ".agents/skills/$skill" "capabilities/core/skills/$skill"; do
    if [ -f "$root/$base/$rel" ]; then
      printf '%s/%s\n' "$base" "$rel"
      return 0
    fi
  done
  return 0
}

# emit_pretool_context <text>
#   通道：hookSpecificOutput.additionalContext（TD-427 —— PreToolUse 上 stderr／裸 stdout 都
#   到不了 agent）。NEVER 補 permissionDecision：這是提醒，不是 block。空字串不輸出。
emit_pretool_context() {
  [ -n "${1:-}" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  jq -cn --arg ctx "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $ctx}}'
}

# main_commit_allowlisted <checkout_top> <repo_rel_path>
#   「這個路徑可以直接 commit 到這個 checkout 的 main」——回 0＝白名單內、1＝白名單外、
#   2＝判不出來（gate 不在／路徑形狀不能安全帶進指令）。
#
#   判準 NEVER 在這裡另寫一份：直接把同目錄的 pre-bash-git-commit-only-whitelist.sh 當 oracle，
#   餵它一條 `git commit --only -- '<path>'`，看它放行（exit 0）還是擋（exit 2）。那支 gate 在
#   clade home 消費 scripts/lib/register-paths.ts、在 consumer 用 commit.detail.md 的白名單，
#   兩條分流與 traversal 防護都只活在那裡；照抄任何一份清單，遲早會與 gate 給出不同答案。
#   gate 只讀 git 狀態、不寫檔，當 oracle 呼叫沒有副作用。
#
#   那支 gate 對 main／master 以外的 branch 一律放行（它只管「commit 到 main」），所以 checkout
#   切在別的 branch 時不能拿它當 oracle：main checkout 是共用樹，切到哪條 branch 都一樣要先隔離，
#   這時直接回 1（白名單外）讓提醒照常發出。
main_commit_allowlisted() {
  local top="$1" rel="$2" gate rc branch
  gate="$_SKILL_RULE_REMINDER_DIR/pre-bash-git-commit-only-whitelist.sh"
  [ -f "$gate" ] && [ -n "$top" ] && [ -n "$rel" ] || return 2
  branch=$(git -C "$top" symbolic-ref --short -q HEAD 2>/dev/null) || branch=""
  case "$branch" in
    main | master) ;;
    *) return 1 ;;
  esac
  command -v jq >/dev/null 2>&1 || return 2
  # 單引號包不住含單引號的路徑；換行會被 gate 讀成指令分隔。兩者都判不出來。
  case "$rel" in *"'"* | *$'\n'*) return 2 ;; esac
  jq -cn --arg c "git commit --only -- '$rel'" '{tool_input: {command: $c}}' |
    (cd "$top" 2>/dev/null && CDPATH='' bash "$gate" >/dev/null 2>&1)
  rc=$?
  case "$rc" in
    0) return 0 ;;
    2) return 1 ;;
    *) return 2 ;;
  esac
}

# is_linked_worktree_dir <dir>
#   dir 所在的 checkout 是 linked worktree（git-dir 含 /worktrees/）回 0；main checkout 回 1；
#   不在 git tree 回 2。
is_linked_worktree_dir() {
  local gd
  gd=$(git -C "$1" rev-parse --git-dir 2>/dev/null) || return 2
  case "$gd" in
    */worktrees/*) return 0 ;;
    *) return 1 ;;
  esac
}

# ── 可信 helper 解析 ─────────────────────────────────────────────────────────────
# 威脅模型：hook 依「被讀／被改檔」所在 repo 找 helper 時，那個 repo 可能是任何人放進來的東西
# （clone 下來看看的專案、解開的 tarball）。agent 只要 Read／Edit 它的一個檔，hook 就 node 執行
# 它自帶的 `scripts/*.ts`——「讀一個檔」被升級成「執行那個 repo 的程式碼」，而 agent 與使用者
# 都沒同意過。所以 helper **只**從 fleet 內的 repo 取：
#   - clade home：`CLADE_HOME`／`~/clade`／`~/offline/clade` 中第一個有 `registry/consumers.json`
#     的（與各 hook 的 find_clade_root 同序）；
#   - registry 登記的 consumer：clade home 父目錄底下的 `local_dir`／`consumer_id`
#     （與 scripts/lib/consumers-local.ts 的 registryEntries 同推導，同樣不含 pending_onboard：
#     已登記、尚未 onboard 的 repo 還不是 fleet 成員）。
# 部署前提：consumer 的 checkout MUST 在 clade home 的父目錄下（docs/disaster-recovery.md § 3）。
# checkout 在別處的 consumer 判為不在 fleet，靠本檔取 helper 的 hook 對它一律靜默——而靜默與
# 「查過了沒事」同形，所以這個前提寫在佈局文件裡，不只在這裡。
# 判定是對「目標 repo main checkout 的實體路徑」（git-common-dir 的父目錄，`pwd -P`）做身分比對，
# helper 路徑也從那個可信 root 組出來。NEVER 用目標 repo 自己能寫的東西當憑據（remote URL、
# `scripts/sync-rules.ts` 之類的標記檔、registry 的副本）——那些全都能被偽造。
# 不在 fleet → 什麼都不印、回非 0，呼叫端照 fail-open 靜默。

# clade_home_root —— 印出 clade home 的實體路徑；找不到回 1。
clade_home_root() {
  local c
  for c in "${CLADE_HOME:-}" "${HOME:-/nonexistent}/clade" "${HOME:-/nonexistent}/offline/clade"; do
    [ -n "$c" ] && [ -f "$c/registry/consumers.json" ] || continue
    (cd -P -- "$c" 2>/dev/null && pwd -P) && return 0
  done
  return 1
}

# fleet_repo_root <dir> —— dir 所屬 repo 是 fleet 成員時印 `<kind>\t<main checkout 實體路徑>`
#   （kind = clade | consumer）；否則不印、回 1。
fleet_repo_root() {
  local common root clade base p real
  common=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  [ -n "$common" ] || return 1
  root=$(cd -P -- "$(dirname -- "$common")" 2>/dev/null && pwd -P) || return 1
  clade=$(clade_home_root) || return 1
  if [ "$root" = "$clade" ]; then
    printf 'clade\t%s\n' "$root"
    return 0
  fi
  command -v jq >/dev/null 2>&1 || return 1
  base=$(dirname -- "$clade")
  while IFS= read -r p; do
    case "$p" in '' | /* | *..*) continue ;; esac
    real=$(cd -P -- "$base/$p" 2>/dev/null && pwd -P) || continue
    if [ "$real" = "$root" ]; then
      printf 'consumer\t%s\n' "$root"
      return 0
    fi
  done < <(jq -r '.consumers[]? | select(.role != "source-of-truth" and .pending_onboard != true) | .local_dir // empty, .consumer_id // empty' \
    "$clade/registry/consumers.json" 2>/dev/null)
  return 1
}

# trusted_fleet_helper <dir> <helper.ts> —— dir 屬 fleet 時，印該 repo main checkout 的
#   `scripts/<helper>`，沒有再試 `vendor/scripts/<helper>`（consumer 投影／clade 源檔的落點）；
#   不在 fleet 或兩處都沒有 → 不印、回 1。
trusted_fleet_helper() {
  local hit root cand
  hit=$(fleet_repo_root "$1") || return 1
  root="${hit#*$'\t'}"
  for cand in "$root/scripts/$2" "$root/vendor/scripts/$2"; do
    if [ -f "$cand" ]; then
      printf '%s\n' "$cand"
      return 0
    fi
  done
  return 1
}
