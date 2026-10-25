#!/usr/bin/env bash
# PreToolUse:Bash hook — 擋會覆寫工作檔或丟 WIP 的 git 指令（block，exit 2）
#
# 判定全在同目錄的 wip-destructive-git.ts；本檔只做快篩、錯誤分支出口與保守樣式。
# 為什麼、matcher 規格、逃生門、threat model、gate 型別、E1～E6 錯誤分支表，見該檔檔頭。
#
# 判定故障時不 fail-open（安全型 gate，判不出來倒向擋）：E1 node 不在、E2 判定檔不在、
# E6 判定行程非 0／2 退出、判定回 3（E3 非 JSON、E5 丟例外）一律匯到下面的 degrade()：
# 退回只認不可逆形式的保守樣式——命中 exit 2，沒命中 exit 0 並以 additionalContext 告知 agent。
# 本檔自己決定 exit code，NEVER 直接沿用判定行程的非 0／2 退出碼（harness 把它當 non-blocking，等於放行）。
#
# 快篩在所有錯誤分支之前：沒提到那幾個 git 子命令的指令，在任何故障狀態下都 exit 0、無輸出。
# 降級路徑只能用 bash builtin（E1 時 PATH 裡沒有任何外部指令）。
# 保守樣式命中的每一件，正常判定也必須判 deny（test/wip-destructive-git.test.ts 的 subset fixture 釘住）。

set -uo pipefail

# 不用 `$(</dev/stdin)`：stdin 是 socketpair（Node spawn 的 stdio pipe）時 open(/dev/stdin) 會 ENXIO。
# `read -d ''` 只靠 builtin、對 pipe／socket／檔案都能讀到 EOF（遇 EOF 回 1，內容仍在）。
input=''
IFS= read -r -d '' input || true

# 快篩：絕大多數命令不碰這幾個子命令，不付 node 啟動成本
case "$input" in
  *git*restore* | *git*checkout* | *git*switch* | *git*reset* | *git*clean* | *git*stash*) ;;
  *) exit 0 ;;
esac

hit_why='' # 保守樣式命中時寫入「哪一種不可逆形式」，空字串＝沒命中
cmd=''     # 要判的命令文字（extract_cmd 設定）
anypos=0   # 1＝拿不到 command 欄位（E3），退而在段內任何位置找 git 字
LEAD="[({!\"'\`\$]"   # 段首字前導：subshell、group、否定、引號、$( 與反引號
TRAIL="*[)}\"'\`]"     # 字尾殘留：收尾括號與引號

# ---- 保守樣式（只認不可逆形式；只用 builtin）-----------------------------------

# 從 payload 取 tool_input.command 的 JSON 字串值並還原跳脫；取不到（E3 非 JSON）退回整份 input。
# 只看 command 欄位，description 等欄位提到 git 不會誤中。
extract_cmd() {
  local re='"command"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)"'
  local bs='\' q='"' nl=$'\n' sep=$'\001'
  if [[ $input =~ $re ]]; then
    cmd=${BASH_REMATCH[1]}
    cmd=${cmd//"$bs$bs"/$sep}
    cmd=${cmd//"${bs}n"/$nl}
    cmd=${cmd//"${bs}r"/ }
    cmd=${cmd//"${bs}t"/ }
    cmd=${cmd//"$bs$q"/$q}
    cmd=${cmd//"$bs/"//}
    cmd=${cmd//$sep/$bs}
    anypos=0
  else
    cmd=$input
    anypos=1
  fi
}

# 短旗標串 $1 在遇到「其後是值」的字母（$3）之前，是否含字母 $2
short_has() {
  local a=$1 want=$2 val=$3 i c
  [[ $a == -* && $a != --* ]] || return 1
  for ((i = 1; i < ${#a}; i++)); do
    c=${a:i:1}
    [[ $c == "$want" ]] && return 0
    [[ -n $val && $val == *"$c"* ]] && return 1
  done
  return 1
}

# git 子命令 $1＋參數 → 命中不可逆形式就設 hit_why
git_hit() {
  local sub=$1 a first='' fval=''
  local hard=0 force=0 discard=0 dry=0 staged=0 worktree=0 dd=0
  shift
  case $sub in
    checkout) fval=bB ;;
    switch) fval=cC ;;
    clean) fval=e ;;
    restore) fval=s ;;
  esac
  for a in "$@"; do
    if [[ $a == -- ]]; then
      dd=1
      break
    fi
    case $a in
      --hard) hard=1 ;;
      --force) force=1 ;;
      --discard-changes) discard=1 ;;
      --dry-run) dry=1 ;;
      --staged) staged=1 ;;
      --worktree) worktree=1 ;;
      --*) ;;
      -?*)
        short_has "$a" f "$fval" && force=1
        short_has "$a" n "$fval" && dry=1
        short_has "$a" S "$fval" && staged=1
        short_has "$a" W "$fval" && worktree=1
        ;;
      *) [[ -z $first ]] && first=$a ;;
    esac
  done
  case $sub in
    reset) ((hard)) && hit_why='git reset --hard' ;;
    clean) ((dry)) || hit_why='git clean（非 -n／--dry-run）' ;;
    checkout)
      if ((force)); then
        hit_why='git checkout -f'
      elif ((dd)); then
        hit_why='git checkout … -- <path>'
      fi
      ;;
    switch) ((force || discard)) && hit_why='git switch -f／--discard-changes' ;;
    restore) { ((!staged)) || ((worktree)); } && hit_why='git restore（覆寫工作檔）' ;;
    stash) [[ $first == clear ]] && hit_why='git stash clear' ;;
  esac
  return 0
}

# 設 word＝w[$1] 去掉前導字元（w 由呼叫端 scan_seg 持有）
word_at() {
  word=${w[$1]}
  while [[ $word == $LEAD* ]]; do word=${word#?}; done
}

# 設 REPLY＝$1 去掉字尾殘留
trim_trail() {
  REPLY=$1
  while [[ $REPLY == $TRAIL ]]; do REPLY=${REPLY%?}; done
}

# w[$1] 是 git（w、n 由呼叫端 scan_seg 持有）：略過全域選項取子命令，再判旗標
scan_git() {
  local j=$(($1 + 1)) k sub
  local -a ga=()
  while ((j < n)) && [[ ${w[j]} == -* ]]; do
    case ${w[j]} in
      -C | -c | --git-dir | --work-tree | --namespace | --super-prefix | --config-env) j=$((j + 1)) ;;
    esac
    j=$((j + 1))
  done
  ((j < n)) || return 0
  trim_trail "${w[j]}"
  sub=$REPLY
  for ((k = j + 1; k < n; k++)); do
    trim_trail "${w[k]}"
    ga+=("$REPLY")
  done
  git_hit "$sub" ${ga[@]+"${ga[@]}"}
}

# 前導包裝字之後的 -x 旗標（i、n、w 由 scan_seg 持有）
skip_flag_words() {
  while ((i < n)) && [[ ${w[i]} == -* ]]; do i=$((i + 1)); done
}

# 一段命令：略過 VAR=val 與 env／command／sudo 等前導，只認段首是 git（或 bash -c／eval 包的）
scan_seg() {
  local seg=$1 depth=$2 word head i=0 k rest
  local -a w
  read -ra w <<<"$seg"
  local n=${#w[@]}
  if ((anypos)); then
    # 退路（輸入不是 JSON、拿不到 command 欄位）：段內每個 git 字都試
    for ((i = 0; i < n; i++)); do
      word_at "$i"
      [[ ${word##*/} == git ]] && scan_git "$i"
      [[ -n $hit_why ]] && return 0
    done
    return 0
  fi
  while ((i < n)); do
    word_at "$i"
    # 只剩前導字元（例如單獨的 `(`、`{`）或 VAR=val：略過
    if [[ -z $word || $word =~ ^[A-Za-z_][A-Za-z_0-9]*= ]]; then
      i=$((i + 1))
      continue
    fi
    head=${word##*/}
    case $head in
      env | command | sudo | doas | time | nohup | exec | then | do | else | elif | if | while | until)
        i=$((i + 1))
        skip_flag_words
        continue
        ;;
      timeout)
        i=$((i + 1))
        skip_flag_words
        ((i < n)) && [[ ${w[i]} == [0-9]* ]] && i=$((i + 1))
        continue
        ;;
    esac
    break
  done
  ((i < n)) || return 0
  case $head in
    git)
      scan_git "$i"
      ;;
    bash | sh | zsh | dash)
      ((depth < 4)) || return 0
      for ((k = i + 1; k < n; k++)); do
        if [[ ${w[k]} == -[A-Za-z]* && ${w[k]} == *c* ]]; then
          rest="${w[*]:k+1}"
          scan_text "$rest" $((depth + 1))
          return 0
        fi
      done
      ;;
    eval)
      ((depth < 4)) || return 0
      rest="${w[*]:i+1}"
      scan_text "$rest" $((depth + 1))
      ;;
  esac
  return 0
}

# 依 ; & | 與換行切段，逐段判
scan_text() {
  local text=$1 depth=$2 seg
  text=${text//[;&|]/$'\n'}
  while IFS= read -r seg || [[ -n $seg ]]; do
    scan_seg "$seg" "$depth"
    [[ -n $hit_why ]] && return 0
  done <<<"$text"
  return 0
}

# ---- 錯誤分支出口 ---------------------------------------------------------------

emit_context() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"%s"}}\n' "$1"
}

# 設 REPLY＝$1 裡第一行帶 Error 的（沒有就用首行），給人看的線索
error_hint() {
  local line
  REPLY=${1%%$'\n'*}
  while IFS= read -r line; do
    [[ $line == *Error* ]] && { REPLY=$line; break; }
  done <<<"$1"
}

# $1=故障原因（固定文字，不含引號與反斜線）$2=修法 $3=只進 stderr 的補充（可空）
degrade() {
  local reason=$1 fix=$2 extra=${3-} line
  hit_why=''
  extract_cmd
  scan_text "$cmd" 0
  if [[ -n $hit_why ]]; then
    if [[ ${CLADE_WIP_GATE_DEGRADED_OK-} == 1 ]]; then
      line="wip-destructive-git: 判定故障期以開關放行（CLADE_WIP_GATE_DEGRADED_OK=1；故障：${reason}；放行形式：${hit_why}）"
      printf '%s\n' "$line" >&2
      emit_context "WIP 判定故障（${reason}），本次只做了保守檢查。${line}"
      exit 0
    fi
    printf '⛔ WIP 判定故障（%s），退回保守檢查；此指令屬不可逆形式（%s）所以被擋。\n' "$reason" "$hit_why" >&2
    printf '修法：%s\n' "$fix" >&2
    [[ -n $extra ]] && printf '%s\n' "$extra" >&2
    printf '%s\n' '緊急放行（人控面，放行會留紀錄）：在啟動 Claude Code 的環境設 CLADE_WIP_GATE_DEGRADED_OK=1（只讀行程 env，不認指令前綴；修好後 unset）。' >&2
    printf '%s\n' '要切分支請用 git switch <branch>；要還原檔案內容請用編輯工具反向修改，或具名 stash（git stash push -u -m <tag>）。' >&2
    exit 2
  fi
  emit_context "WIP 判定故障（${reason}）：本次只做了保守檢查（reset --hard、clean、checkout -f 與 checkout -- <path>、switch -f、restore 工作檔、stash clear），未命中故放行；修好判定前，其他破壞性 git 形式不會被擋。修法：${fix}"
  exit 0
}

# ---- 主流程 ---------------------------------------------------------------------

command -v node >/dev/null 2>&1 ||
  degrade '判定無法執行：node 不在 PATH' '安裝 node（需支援 TS 型別剝除，v22.18+／v24）並確認 hook 行程的 PATH 找得到它。'

if [[ ${BASH_SOURCE[0]} == */* ]]; then here=${BASH_SOURCE[0]%/*}; else here=.; fi
judge="$here/wip-destructive-git.ts"
[ -f "$judge" ] ||
  degrade '判定檔缺失：hook 投影不完整' '重跑 sync-rules／重裝 clade plugin，讓 wip-destructive-git.ts 與本檔同目錄。' "找不到：$judge"

out=$(node "$judge" <<<"$input" 2>&1)
rc=$?
case $rc in
  0 | 2)
    [[ -n $out ]] && printf '%s\n' "$out" >&2
    exit "$rc"
    ;;
  3)
    degrade '判定讀不懂輸入或判斷途中出錯，exit 3' '這是 wip-destructive-git.ts 的錯誤分支（E3／E5）；回報 clade 並附上被擋的指令。'
    ;;
  *)
    error_hint "$out"
    degrade "判定行程異常結束，exit ${rc}" '確認 node 支援 TS 型別剝除，且 gh-pr-create-work.ts 與本檔同目錄（E6）。' "node 輸出：${REPLY}"
    ;;
esac
