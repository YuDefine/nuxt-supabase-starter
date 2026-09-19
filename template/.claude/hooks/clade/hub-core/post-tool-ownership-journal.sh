#!/usr/bin/env bash
# PostToolUse(Edit|Write|NotebookEdit) hook — 把「哪個 session 在什麼時候寫了哪個檔」
# append 進 `<consumerRoot>/.clade/ownership/journal.jsonl`。
#
# **靜默、fail-open、永不 block。** 它不對 agent 說任何話：收件人是
# `classifyDirtyPaths` 與 `flow who`，不是正在寫檔的那個 session。
#
# ## 為什麼需要這條（TD-664）
#
# `.clade/claims/` 是**事前宣告**模型，而宣告型欄位實測不被維護（17 個 claim 檔裡
# `expected_paths` 全 `[]`、`task_summary` 全 `null`）。且 claims 只涵蓋 worktree，
# **不涵蓋 main working tree** —— 而 clade home 是全 fleet 共享的單一 main，那正是
# 爭用發生的地方。於是「這個 dirty 檔屬於誰」只能靠反推，而每一條可用的反推訊號
# 實測都不可信：herdr pane 掃描對已 commit 完的工作零訊號、terminal title 繼承上一棒、
# `agent_status` 只反映 tab 有沒有被人看過、stash 名稱有殘骸。2026-08-26 據此把
# 01:52 已落地的 12 個檔判成「孤兒」，代價是三個 session 互等約兩小時。
#
# 本 hook 是**寫入時證據**：不問任何人宣告什麼，只記錄 harness 實際執行了什麼。
#
# ## session_id MUST 來自 harness，NEVER 由 model 自報
#
# hook input JSON 的 `session_id` 是 Claude Code 自己填的。**NEVER** 改成讀某個
# 由 model 寫入的檔或 env —— 本條的全部價值就在於它是 model 動不了的證據；一旦
# 可自報，它就退化成又一個「宣告型欄位」，也就是 TD-664 要修的那個東西本身。
#
# ## pid / pid_start 是存活判定的 kernel 證據
#
# `rules/core/session-claims.md` § 存活證據三層 要求「session 活著」由 kernel 可驗
# （`kill -0`），**不是** heartbeat —— heartbeat 缺席與「hook 壞了」無法區分。
# 這裡往上走 process 樹找到 claude 本體的 pid，並一起記下它的 starttime
# （`/proc/<pid>/stat` 第 22 欄）：**pid 會被重用，單靠 pid 判活會把新 process
# 誤讀成舊 session 還活著**。兩欄一起比對才成立。
#
# 拿不到 `/proc`（非 Linux）時記 `null`，消費端據此判 `unknown` 而非 `orphan`
# —— 判死 MUST 兩個獨立訊號同時缺席，缺一個只能判 `unknown`。
#
# ## Bash 走時間窗，不解析 command（TD-664 Phase 2）
#
# 這個 session 家族有相當比例的檔案寫入走 `sed -i` / heredoc 而非 Edit/Write，而 PostToolUse
# 拿到的只有 command 字串 —— 從任意 shell 解析出「這次寫了哪些檔」不可靠，而**猜錯的方向會把
# 別人的檔記成我的**。所以 Bash 那條路徑不解析 command，改用 `pre-bash-ownership-stamp.sh`
# 開的時間窗：只收 mtime 落在 stamp 之後的 dirty 路徑，標 `attribution: "mtime-diff"`。
#
# **NEVER 改成「Bash 之後掃 git status 把所有 dirty 檔記成本 session 的」** —— 那正好是
# TD-664 § 最大失敗模式 的形狀。時間窗過濾就是本 hook 與那條禁令的分界，所以拿不到 stamp 時
# **整段不記**（見下方 `[ -f "$stamp" ] || exit 0`），NEVER 退化成「讀不到就全記」。

set -euo pipefail

payload=$(cat)

extract() {
  printf '%s' "$payload" |
    sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1
}

session=$(extract session_id)
tool=$(extract tool_name)
hook_cwd=$(extract cwd)

# tool_input 的 file_path（Edit/Write）或 notebook_path（NotebookEdit）。
file_path=$(extract file_path)
[ -n "$file_path" ] || file_path=$(extract notebook_path)

[ -n "$session" ] || exit 0
# Edit/Write carry the path in the payload; Bash does not, and gets it from the mtime window
# below instead.
if [ "${tool:-}" != "Bash" ]; then
  [ -n "$file_path" ] || exit 0
fi

[ -n "$hook_cwd" ] || hook_cwd=$PWD
[ -d "$hook_cwd" ] || hook_cwd=$PWD

# 兩個 root，用途不同，NEVER 混用：
#   consumer_root = git-common-dir 的 parent = main worktree root（與 claim-helper.ts 的
#     findConsumerRoot 同定義）。**journal 檔本身**放這裡 —— 一個 consumer 一份 journal，
#     所有 worktree 共寫，讀的人才不必先知道有幾棵樹。
#   tree_root = 這次寫入實際發生的那棵樹的 toplevel（linked worktree 時 ≠ consumer_root）。
#     `path` 欄位相對它，因為 join 的對象是**那棵樹**的 `git status --porcelain` 輸出。
#
# 這兩者混用過一次：初版只有 consumer_root，於是 linked worktree 內寫的檔因為前綴對不上
# 而被整段丟棄 —— 而 worktree session 正是這條 journal 最需要涵蓋的一群。`worktree` 欄位
# 是消費端把兩者接回去的鍵，**NEVER 移除它**，沒有它就無法分辨兩棵樹裡的同名相對路徑。
common_dir=$(git -C "$hook_cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
[ -n "$common_dir" ] || exit 0
consumer_root=$(dirname "$common_dir")
[ -d "$consumer_root" ] || exit 0

tree_root=$(git -C "$hook_cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -n "$tree_root" ] || exit 0

journal_dir="$consumer_root/.clade/ownership"

# ── 這次寫入涵蓋哪些路徑 ───────────────────────────────────────────────────────
#
# Edit / Write / NotebookEdit：payload 直接給路徑，證據是 harness 說的，`attribution=hook`。
#
# Bash：payload 只有 command 字串。從任意 shell 解析「這次寫了哪些檔」不可靠，所以改用
# **時間窗**：PreToolUse 的 `pre-bash-ownership-stamp.sh` 先 touch 一個 stamp，這裡只收
# mtime 落在 stamp 之後的 dirty 路徑，`attribution=mtime-diff`。
#
# **NEVER 改成「Bash 之後掃 git status 把所有 dirty 檔記成本 session 的」** —— 那正是
# `rules/core/session-claims.md` § 3.2 逐字禁止的形狀，會把別 session 活著的 WIP 標成我的。
# 時間窗過濾就是本段與那條禁令的分界：沒有 stamp 就整段不記（下面直接 exit 0），
# **NEVER** 退化成「stamp 讀不到就全記」。
#
# 窗內仍可能夾到別 session 的併發寫入，所以 `attribution` 欄要留著讓消費端知道證據較弱 ——
# `flow who` 對 mtime-diff 的列會明說這件事。漏記安全、記錯不安全，這裡一律取窄。
rels=""
if [ "${tool:-}" = "Bash" ]; then
  stamp="$journal_dir/.bash-stamp-$(printf '%s' "$session" | tr -c 'A-Za-z0-9_.-' '_')"
  [ -f "$stamp" ] || exit 0
  stamp_s=$(stat -c %Y "$stamp" 2>/dev/null) || exit 0
  case "$stamp_s" in
    '' | *[!0-9]*) exit 0 ;;
  esac
  rm -f "$stamp" 2>/dev/null || true
  candidates=$(git -C "$tree_root" status --porcelain=v1 --untracked-files=all 2>/dev/null) || exit 0
  while IFS= read -r line; do
    [ ${#line} -gt 3 ] || continue
    cand=${line#???}
    # rename 行是 `R  old -> new`，被寫到的是 new。
    case "$cand" in
      *' -> '*) cand=${cand##* -> } ;;
    esac
    # porcelain 對含空白 / 特殊字元的路徑加引號；這種路徑跳過而不猜，寧可漏記。
    # journal 自己的目錄也跳過 —— 本 hook 每次都會動它，記進去等於每個 Bash 都宣稱自己
    # 持有 journal，而那是所有 session 共寫的檔。
    case "$cand" in
      '"'*) continue ;;
      .clade/ownership/*) continue ;;
    esac
    [ -f "$tree_root/$cand" ] || continue
    m=$(stat -c %Y "$tree_root/$cand" 2>/dev/null) || continue
    [ "$m" -ge "$stamp_s" ] 2>/dev/null || continue
    rels="$rels$cand
"
  done <<EOF
$candidates
EOF
  [ -n "$rels" ] || exit 0
  attribution=mtime-diff
else
  case "$file_path" in
    /*) abs=$file_path ;;
    *) abs="$hook_cwd/$file_path" ;;
  esac
  # 路徑不在本 session 的 tree 底下時，**歸屬跟著被寫的檔走，不跟著 session 的 cwd 走**。
  #
  # 舊版在這裡直接 exit 0，理由寫的是「repo 外的檔（~/.claude/** 之類）不記」——對 `~/.claude/**`
  # 是對的，但它連帶把「**寫進另一個 repo**」也靜默丟掉，而那正是唯一會讓歸屬完全失效的情況：
  # 那筆寫入不會進本 repo 的 journal（路徑不在樹裡），也不會進目標 repo 的 journal（hook 跑在
  # 這一邊），於是兩邊都沒有證據，`flow who` 對它只能回 `unknown`。
  #
  # 2026-08-28 實測：一個 cwd 在 <consumer-b> 的 session 用絕對路徑寫了 clade 的 8 個檔，八個 clade
  # session 逐一誠實否認、三種探測管道（herdr pane 廣播 / ListAgents / transcript 目錄）全部
  # 打不到它，因為那三種問的都是「誰在這個 repo 工作」——那是「誰寫了這個檔」的代理。
  # 最後靠人工翻 transcript 的絕對路徑才指認到，耗掉四個 session 半小時並擋住兩條 merge-back
  # 與兩趟 publish。
  #
  # 所以：目標路徑落在**別的 git repo** 時，改把這筆記進**那個 repo** 的 journal。目標不是
  # git repo（`~/.claude/**` 那類）才照舊丟棄——本 journal 回答的仍然是 working tree 所有權。
  rel=${abs#"$tree_root"/}
  if [ "$rel" = "$abs" ]; then
    target_dir=$(dirname "$abs")
    [ -d "$target_dir" ] || exit 0
    target_common=$(git -C "$target_dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
    target_root=$(git -C "$target_dir" rev-parse --show-toplevel 2>/dev/null) || exit 0
    [ -n "$target_common" ] && [ -n "$target_root" ] || exit 0
    target_consumer=$(dirname "$target_common")
    [ -d "$target_consumer" ] || exit 0
    rel=${abs#"$target_root"/}
    # 解析完仍不在該樹底下（symlink 之類）就丟棄，NEVER 用猜的補一個 rel。
    [ "$rel" != "$abs" ] || exit 0
    # journal 落在**目標** repo，worktree 欄同樣改用目標樹 —— 讀的人問的是「clade 的這個檔
    # 是誰寫的」，答案必須在 clade 的 journal 裡找得到。
    journal_dir="$target_consumer/.clade/ownership"
    tree_root=$target_root
  fi
  rels="$rel
"
  attribution=hook
fi

# 往上走 process 樹找 claude 本體。hook 的 $PPID 是起它的 shell，claude 通常再上一兩層。
claude_pid=null
pid_start=null
probe=${PPID:-0}
for _ in 1 2 3 4 5 6; do
  [ "$probe" -gt 1 ] 2>/dev/null || break
  [ -r "/proc/$probe/stat" ] || break
  # comm 欄（第 2 欄）可含空白與括號，所以一律先砍到最後一個 ')' 之後再切欄位：
  # 砍完 $1=state、$2=ppid、$20=starttime（原第 3 / 4 / 22 欄）。
  stat_tail=$(sed 's/^.*) //' "/proc/$probe/stat" 2>/dev/null) || break
  if tr '\0' ' ' <"/proc/$probe/cmdline" 2>/dev/null | grep -q 'claude'; then
    claude_pid=$probe
    pid_start=$(printf '%s' "$stat_tail" | awk '{print $20}')
    break
  fi
  probe=$(printf '%s' "$stat_tail" | awk '{print $2}')
  [ -n "$probe" ] || break
done
case "$pid_start" in
  '' | *[!0-9]*) pid_start=null ;;
esac

mkdir -p "$journal_dir" 2>/dev/null || exit 0
if [ ! -f "$journal_dir/.gitignore" ]; then
  printf '*\n!.gitignore\n' >"$journal_dir/.gitignore" 2>/dev/null || true
fi

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

pane=${HERDR_PANE_ID:-}
if [ -n "$pane" ]; then
  pane="\"$(json_escape "$pane")\""
else
  pane=null
fi

# 單行 append。O_APPEND 對 PIPE_BUF 以內的寫入是原子的，所以多 session 併發
# append 不會互相截斷 —— 這是選 jsonl 而非結構化檔的理由，NEVER 改成 read-modify-write。
now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '%s' "$rels" | while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  printf '{"ts":"%s","path":"%s","worktree":"%s","session_id":"%s","pane_id":%s,"cwd":"%s","tool":"%s","pid":%s,"pid_start":%s,"attribution":"%s"}\n' \
    "$now_iso" \
    "$(json_escape "$rel")" \
    "$(json_escape "$tree_root")" \
    "$(json_escape "$session")" \
    "$pane" \
    "$(json_escape "$hook_cwd")" \
    "$(json_escape "${tool:-unknown}")" \
    "$claude_pid" \
    "$pid_start" \
    "$attribution" \
    >>"$journal_dir/journal.jsonl" 2>/dev/null || true
done

# ── Claim heartbeat，throttle ≥5 分鐘（TD-664 Phase 2）──────────────────────────
#
# `last_heartbeat` 實測恆等於 `started_at`（17 個 claim 檔全數如此），因為唯一的 refresh
# 時機是 SessionStart —— 一個 session 開了之後就再也不會更新，於是那個欄位量的是「開過」
# 而不是「還在推進」。設計三層的第二層（任務在推進）要的正是後者。
#
# **寫者 MUST 是這支 hook，NEVER 是 model。** 一旦改成由 model 記得去呼叫 refresh，它就
# 退回宣告型欄位 —— 而宣告型欄位不被維護正是 TD-664 的前提本身。
#
# Throttle 用 stamp 檔的 mtime，不用 claim 檔自己的 `last_heartbeat`：claim 可能不存在
# （main working tree 的 session 多半沒有 claim），而 throttle 必須在那種情況下照樣生效，
# 否則每一次 Edit 都會 spawn 一個註定找不到 claim 的 node。
stamp="$journal_dir/.heartbeat-stamp"
now_s=$(date +%s 2>/dev/null || echo 0)
last_s=0
if [ -f "$stamp" ]; then
  last_s=$(stat -c %Y "$stamp" 2>/dev/null || echo 0)
fi
case "$last_s" in
  '' | *[!0-9]*) last_s=0 ;;
esac
if [ "$now_s" -gt 0 ] && [ $((now_s - last_s)) -ge 300 ]; then
  : >"$stamp" 2>/dev/null || true
  helper=""
  for cand in "$consumer_root/scripts/claim-helper.ts" "$consumer_root/vendor/scripts/claim-helper.ts"; do
    [ -f "$cand" ] && helper=$cand && break
  done
  # `refresh-by-cwd` 以 `process.cwd()` 比對 `worktree_path`，所以 node MUST 在寫入實際
  # 發生的那棵樹裡跑，NEVER 在 consumer_root 跑 —— 後者會讓每個 linked worktree 的 claim
  # 都刷不到自己那一份。背景執行 ＋ 全部輸出丟棄，維持本 hook 的靜默 / fail-open 契約。
  if [ -n "$helper" ] && command -v node >/dev/null 2>&1; then
    (cd "$tree_root" 2>/dev/null && node "$helper" refresh-by-cwd >/dev/null 2>&1 &) || true
  fi
fi

exit 0
