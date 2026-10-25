#!/usr/bin/env bash
# PreCompact hook — 壓縮前把工作狀態機械落盤，並用 stdout 把「摘要必留項」附進壓縮指令。
# **永遠 exit 0。**
#
# 為什麼需要這條（plan W-2026-10-20-autocompact-300k-600k-plan-package-hook-helper-d § Open work 3）：
# 非主持席改用 300k 視窗後，壓縮是常態而不是意外。context 預算 hook 在觸發點前 32k 提示一次，
# 但觸發判定比的是「目前 context＋待送訊息」，一個大工具結果可以從提示線下直接越過門檻
# （evidence/2026-10-21-探測P1-P5.md § P1）——提示線不是保證，本 hook 才是保險。
#
# 落盤：`${XDG_STATE_HOME:-~/.local/state}/clade/precompact/<session_id>.md`，記 git 狀態、
# `CLADE_DISPATCH_ID`／`CLADE_WORK_ID`、transcript 路徑、最後叫用的 skill、在飛 0-A／Workflow
# 的候選，另記 trigger 與時間（D0 後用來補判 idle／precompute 路徑，plan Open work 6）。
# 同目錄 `events.tsv` 每分鐘每 (session, trigger) 一行。SessionStart:compact 的
# `session-start-compact-pointer.sh` 指回這個檔。
#
# stdout：實測 exit 0 的 stdout 會逐字進壓縮摘要（探測 § P2），所以這裡寫的是給摘要器的指令。
#
# ## threat model 與不承諾
#
# 這不是 gate：不擋任何東西，收件人是壓縮摘要器與壓縮後的同一個 session。不承諾候選清單完整——
# 0-A／Workflow 是從 transcript 尾端 grep 的線索，真正保住它們的是 stdout 叫摘要器逐字保留。
#
# ## 為什麼 NEVER exit 2（探測推翻了「exit 2 會跳 breaker」）
#
# window 來自 env 時（fleet 的設定全部經 env），threshold 壓縮一律走 reactive；被 PreCompact 擋下
# 記成 skip 而不是 failure，breaker 不會熄火。每次模型呼叫都重叫本 hook，context 一路長到
# blocking limit（探測 C2：同一 turn 叫了 7 次）。所以：
#
# - **NEVER exit 2**：擋下就等於該 session 不再壓縮
# - 出錯一律 fail-open（`trap … EXIT` 收成 exit 0），壓縮照常進行
# - **冪等**：同一次溢位可能被重叫多次；落盤檔整份覆寫，events.tsv 同分鐘同 trigger 不重複
# - **快**：transcript 只讀尾端；git 指令有 2 秒上限
#
# ## 判不出來的方向
#
# | 情況 | 處置 |
# | --- | --- |
# | payload 缺 session_id | 落盤到 `unknown.md`，stdout 照印 |
# | cwd 不是 git repo／git 超時 | git 欄位寫「無」，其餘照落 |
# | 落盤目錄寫不進去 | 不落盤，stdout 照印（摘要仍保住狀態） |

set -u
trap 'exit 0' EXIT

payload=$(cat 2>/dev/null) || payload=""

extract() {
  printf '%s' "$payload" |
    sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1
}

session=$(extract session_id | tr -c 'A-Za-z0-9._\n-' '_')
transcript=$(extract transcript_path)
cwd=$(extract cwd)
trigger=$(extract trigger)
[ -n "$cwd" ] || cwd=$PWD

state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/clade/precompact"
snapshot="$state_dir/${session:-unknown}.md"

run_git() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 2 git -C "$cwd" "$@" 2>/dev/null
  else
    git -C "$cwd" "$@" 2>/dev/null
  fi
}

branch=$(run_git rev-parse --abbrev-ref HEAD) || branch=""
head=$(run_git rev-parse --short HEAD) || head=""
dirty=$(run_git status --porcelain=v1 | head -30) || dirty=""

last_skill=""
finalize=""
workflows=""
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  tail_text=$(tail -c 1048576 "$transcript" 2>/dev/null) || tail_text=""
  last_skill=$(printf '%s' "$tail_text" |
    grep -o '"name":"Skill","input":{"skill":"[^"]*"' | tail -1 | sed 's/.*"skill":"//; s/"$//') || last_skill=""
  # 只認 review-subagent.sh 印的 `FINALIZE: bash … finalize …` 形狀：壓縮摘要會轉述本 hook 自己的
  # stdout（含「FINALIZE 指令」字樣），寬鬆樣式會把那句當成最新候選、蓋掉真正的指令。
  # transcript 是 JSON 字串，引號是 `\"`、換行是 `\n`：先截到 `\n`，再還原引號。
  finalize=$(printf '%s' "$tail_text" |
    grep -o 'FINALIZE: bash .\{1,400\}' | grep ' finalize ' | tail -1 |
    sed 's/\\n.*//; s/\\"/"/g; s/"[}\]].*//') || finalize=""
  # 依最後出現的順序取五個不重複的 id——在飛的那個通常最晚出現；`sort -u` 會改成字母序。
  workflows=$(printf '%s' "$tail_text" |
    grep -o 'wf_[a-z0-9-]\{6,\}' | tac | awk '!seen[$0]++' | head -5 | tr '\n' ' ') || workflows=""
fi

if mkdir -p "$state_dir" 2>/dev/null; then
  tmp="$snapshot.$$"
  {
    printf '# PreCompact 落盤（%s）\n\n' "${session:-unknown}"
    printf -- '- trigger: %s\n' "${trigger:-unknown}"
    printf -- '- fired_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf -- '- window: %s\n' "${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-未設}"
    printf -- '- CLADE_DISPATCH_ID: %s\n' "${CLADE_DISPATCH_ID:-無}"
    printf -- '- CLADE_WORK_ID: %s\n' "${CLADE_WORK_ID:-無}"
    printf -- '- cwd: %s\n' "$cwd"
    printf -- '- branch／HEAD: %s %s\n' "${branch:-無}" "${head:-}"
    printf -- '- transcript: %s\n' "${transcript:-無}"
    printf -- '- 最後叫用的 skill: %s\n' "${last_skill:-無}"
    printf -- '- 在飛 0-A 候選（最後一筆 FINALIZE）: %s\n' "${finalize:-無}"
    printf -- '- 在飛 Workflow 候選: %s\n' "${workflows:-無}"
    printf '\n## 未 commit 檔（前 30 行）\n\n```\n%s\n```\n' "${dirty:-（乾淨）}"
  } >"$tmp" 2>/dev/null && mv -f "$tmp" "$snapshot" 2>/dev/null
  rm -f "$tmp" 2>/dev/null

  events="$state_dir/events.tsv"
  key="$(date -u +%Y-%m-%dT%H:%M)	${session:-unknown}	${trigger:-unknown}"
  if ! tail -n 200 "$events" 2>/dev/null | grep -qF "$key"; then
    printf '%s\t%s\n' "$key" "${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-}" >>"$events" 2>/dev/null
  fi
fi

cat <<EOF
壓縮摘要 MUST 逐字保留下列工作狀態（clade PreCompact 落盤檔：${snapshot}）：
- 落盤檔路徑本身；壓縮後先讀它與 plan.md § 進度再續做
- CLADE_DISPATCH_ID=${CLADE_DISPATCH_ID:-無}、CLADE_WORK_ID=${CLADE_WORK_ID:-無}、branch ${branch:-無}
- 在飛的 0-A：prepare 印的 work-dir 與 FINALIZE 指令（沒跑 FINALIZE 前 gate 未完成）
- 在飛的 Workflow run id、背景 task／Monitor 與它們在等的事件
- 正在執行的 skill（最後叫用：${last_skill:-無}）與目前在第幾步、下一步是什麼
EOF
