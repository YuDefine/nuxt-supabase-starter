#!/usr/bin/env bash
# PreToolUse:Write|Edit|MultiEdit|NotebookEdit|Bash hook — cloud session 寫 `.git/` 內或 clone 目錄外時直接 deny（exit 2）
#
# 為什麼：cloud session 恆為 default 權限模式（bypass 旗標與 permissions.defaultMode 都不生效），檔案工具動到
# clone 目錄外或 `.git/` 內就停在權限框，沒有人點。
# 派工前的文字判定（lib/coordinator-cloud-allow.ts）擋不到 session 執行期自己挑的做法；本 hook 在那一刻擋下並印
# 替代做法，session 換路走而不是停住。規格：rules/core/agent-routing.dispatch-execution.md § Cloud session 載體
# 「全程不需人類授權」。
#
# 實測依據（specs/plans/W-2026-10-13-cloud-no-permission-prompt/evidence/vm-probe-pretooluse.md）：
# cloud session 會跑 repo `.claude/settings.json` 註冊的 PreToolUse hook；exit 2＋stderr 先於權限判定生效、stderr
# 原文回到 agent，session 不進 requires_action。
#
# 只在 cloud VM 動作：`CLAUDE_CODE_REMOTE` 空／`0`／`false` 一律 exit 0、無輸出（本機這些寫入是合法的，權限框有人答）。
#
# threat model：防漂移（絆索不是牆）。對象是誠實但順手把 commit message、暫存檔寫到 `.git/` 或 `/tmp` 的 session。
#   - 不承諾完整語意，只認常見入口：檔案工具的 `file_path`／`notebook_path`，Bash 裡未加引號的輸出重導
#     （`>`／`>>`／`>|`／`&>`）後面那個 word，與指令位置上 `tee` 的檔名參數。`cp`／`mv`／`dd of=`／`node -e`／
#     腳本內的寫入、`cd` 之後的相對路徑、symlink 指到外面，都看不到。
#   - 只判會被 shell 當成重導執行的字：heredoc 內文、引號內的字串（sed／grep 的運算式、`node -e` 的程式碼）、
#     註解、非指令位置的 `tee` 一律不看。代價是雙引號與 heredoc 內的命令替換（`"$(cat > /tmp/x)"`）也看不到。
#   - 沒加引號的 `[[ a > /tmp/b ]]`、`(( a > b ))` 仍會被當成重導（掃描不認這兩種複合指令）；deny 訊息給的
#     出路對它同樣走得通。
#   - 路徑只做字面正規化（`.`、`..`、`~`、`$HOME`、`$TMPDIR`、`$PWD`、`$CLAUDE_PROJECT_DIR`），不解 symlink；
#     帶其他變數或命令替換的目標判不出來，放行。
#
# gate 型別：提示型（命中才 deny；判不出來一律放行）。擋的是「session 停住沒人點」，不是不可逆動作；放行的退路仍在——
# 權限框本身，加上 cloud-dispatch patrol 的 `session-needs-action`。倒向擋的代價是 cloud session 的每一次寫檔與
# Bash 都被擋死，高於漏掉一件的代價。
#
# | 判不出來的分支 | 處置 |
# | --- | --- |
# | E1 直譯器缺失 | 只用 bash builtin，沒有外部指令可缺；bash 本身不在 → harness 當 non-blocking，放行 |
# | E2 本檔不在（投影不完整） | harness 當 non-blocking，放行 |
# | E3 stdin 空、非 JSON、缺 tool_name／路徑／command | exit 0 |
# | E3' 沒有 clone 根（`CLAUDE_PROJECT_DIR` 與 payload `cwd` 都沒有） | exit 0 |
# | E4/E5 判定丟例外（bash 執行期錯誤） | 非 0／2 退出 → harness 當 non-blocking，放行 |
# | E6 逾時 | harness 砍掉，non-blocking，放行 |
# | 目標帶未知變數／命令替換，或 `$`／反引號出自單引號、反斜線跳脫 | 該目標跳過 |
# | 引號或 heredoc 沒有收尾 | 收不到尾的那一段當成內文，不產生目標 |
#
# 放行不 deny 的路徑：clone 目錄內 `.git/` 以外的一切；`/dev/*`；harness 自己的目錄（`/tmp/claude*/`、
# `$HOME/.claude/`、`$CLAUDE_CONFIG_DIR/`——scratchpad、memory、plan 檔，本 hook 不替它們下結論）。
#
# 繞行場景：
# | 繞法 | 預期攔截點 |
# | --- | --- |
# | 被擋後改用 `cp`／`python -c` 寫同一個目標 | 不攔（防漂移）；deny 訊息寫明換寫法會停在權限框 |
# | `cd /tmp && echo x > f` | 不攔（相對路徑一律當 clone 目錄內） |
# | symlink 指到 clone 目錄外 | 不攔（不解 symlink） |
# | 設 `CLADE_CLOUD_WORKDIR_GATE_OFF=1` | 放行，並以 additionalContext 留一行在 transcript |
#
# 訊號契約：
# | 觸發條件 | cloud VM 內，寫入目標字面正規化後落在 clone 根的 `.git/` 內或 clone 目錄外 → exit 2，該次 tool call 不執行 |
# | 消費端 | 該 cloud session 的 agent：照 stderr 的改法換路走，或在 PR 留 `BLOCKED: needs-charles` |
# | 觸發點 | 工具事件 hook：predicate 成立那一刻 stderr 印原因與替代做法（訊息由 test/pre-tool-cloud-workdir-gate.test.ts 釘住） |
#
# Locked 面（本檔、hooks.json 的註冊、test/pre-tool-cloud-workdir-gate.test.ts）：
#   - bootstrap：源檔在 clade 改，經 PR＋publish 散播；consumer 經 native hook 投影併入 settings.json。
#     clade home 由 `.claude/settings.json` 直接註冊 live source。
#   - update：改本檔與測試都走 PR；本檔在 clone 目錄內，不會擋自己的更新。
#   - recovery：`CLADE_CLOUD_WORKDIR_GATE_OFF=1`（專用開關）；cloud VM 內設不了 env 時，拔掉註冊的 PR 就是出口。

set -uo pipefail
set -f

case "${CLAUDE_CODE_REMOTE:-}" in '' | 0 | false) exit 0 ;; esac

# 不用 `$(</dev/stdin)`：stdin 是 socketpair 時 open(/dev/stdin) 會 ENXIO；`read -d ''` 只靠 builtin。
input=''
IFS= read -r -d '' input || true
[ -n "$input" ] || exit 0

if [ "${CLADE_CLOUD_WORKDIR_GATE_OFF:-}" = "1" ]; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"cloud-workdir-gate：CLADE_CLOUD_WORKDIR_GATE_OFF=1，本次未檢查寫入目標。"}}'
  exit 0
fi

# 取 payload 第一個 "<key>": "<字串>" 並還原 JSON 跳脫；取不到回 1。
JSON_VALUE=''
json_str() {
  local re="\"$1\"[[:space:]]*:[[:space:]]*\"(([^\"\\\\]|\\\\.)*)\""
  local bs='\' q='"' nl=$'\n' sep=$'\001' v
  [[ $input =~ $re ]] || return 1
  v=${BASH_REMATCH[1]}
  v=${v//"$bs$bs"/$sep}
  v=${v//"${bs}n"/$nl}
  v=${v//"${bs}r"/ }
  v=${v//"${bs}t"/ }
  v=${v//"$bs$q"/$q}
  v=${v//"$bs/"//}
  v=${v//$sep/$bs}
  JSON_VALUE=$v
}

# 字面正規化成絕對路徑（不解 symlink）：`~`、相對路徑、`.`、`..`。
NORM=''
norm() {
  local p=$1 base=$2 seg n
  local -a out=()
  local home=${HOME:-}
  # shellcheck disable=SC2088 # 比對的是 payload 裡字面的 ~，不是要 shell 展開
  case "$p" in
    '~') p=$home ;;
    '~/'*) p="$home/${p#\~/}" ;;
  esac
  [[ $p == /* ]] || p="$base/$p"
  local IFS=/
  for seg in $p; do
    case "$seg" in
      '' | .) ;;
      ..)
        n=${#out[@]}
        if [ "$n" -gt 0 ]; then out=("${out[@]:0:n-1}"); fi
        ;;
      *) out+=("$seg") ;;
    esac
  done
  NORM="/${out[*]-}"
}

json_str tool_name || exit 0
tool=$JSON_VALUE

cwd=''
if json_str cwd; then cwd=$JSON_VALUE; fi
root=${CLAUDE_PROJECT_DIR:-$cwd}
[ -n "$root" ] || exit 0
norm "$root" /
root=$NORM
[ "$root" != "/" ] || exit 0
if [ -n "$cwd" ]; then
  norm "$cwd" /
  cwd=$NORM
else
  cwd=$root
fi

home_n=''
if [ -n "${HOME:-}" ]; then
  norm "$HOME" /
  home_n=$NORM
fi
config_n=''
if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
  norm "$CLAUDE_CONFIG_DIR" /
  config_n=$NORM
fi

# 判一個目標：WHY 空字串＝放行；`dot-git`／`outside-clone`＝deny。
WHY=''
TARGET=''
judge() {
  WHY=''
  norm "$1" "$cwd"
  TARGET=$NORM
  case "$TARGET" in
    /dev | /dev/* | /tmp/claude*/*) return 0 ;;
  esac
  if [ -n "$home_n" ] && [[ $TARGET == "$home_n/.claude" || $TARGET == "$home_n/.claude/"* ]]; then return 0; fi
  if [ -n "$config_n" ] && [[ $TARGET == "$config_n" || $TARGET == "$config_n/"* ]]; then return 0; fi
  if [[ $TARGET == "$root" || $TARGET == "$root/"* ]]; then
    if [[ $TARGET == "$root/.git" || $TARGET == "$root/.git/"* ]]; then WHY='dot-git'; fi
  else
    WHY='outside-clone'
  fi
}

deny() {
  local where
  case "$WHY" in
    dot-git) where='在 .git/ 內' ;;
    *) where='在 clone 目錄外' ;;
  esac
  {
    printf '%s\n' "⛔ CLOUD-WORKDIR-GATE(${WHY})：${tool} 的寫入目標 ${TARGET} ${where}。cloud session 是 default 權限模式，這個動作會停在權限框而沒有人點，所以在這裡擋下。"
    printf '%s\n' "改法：內容用 Write 工具寫進 clone 目錄（${root}）內、已被 .gitignore 忽略的路徑，再讓指令引用該檔；commit message 是 \`git commit -F <該檔> -- <pathspec>\`。"
    printf '%s\n' "${TARGET} 若只是指令裡的一段文字而不是要寫的檔，做法相同：那段文字用 Write 工具落成 clone 目錄內的檔，指令改成引用該檔。"
    printf '%s\n' "確實要寫 .git/ 內或 clone 目錄外時，換工具或換路徑寫法去寫同一個目標會停在權限框；停下來，在 PR 留言 \`BLOCKED: needs-charles <哪一步要動哪個路徑>\`。"
  } >&2
  exit 2
}

# Bash 重導／tee 的目標：展開認得的變數（名字後面必須是 `/` 或結尾）；還帶 `$` 或反引號的判不出來，回 1。
EXPANDED=''
expand_target() {
  local t=$1 tmp=${TMPDIR:-/tmp} name val
  for name in HOME TMPDIR CLAUDE_PROJECT_DIR PWD; do
    case "$name" in
      HOME) val=${HOME:-} ;;
      TMPDIR) val=$tmp ;;
      CLAUDE_PROJECT_DIR) val=$root ;;
      *) val=$cwd ;;
    esac
    case "$t" in
      "\$$name" | "\${$name}") t=$val ;;
      "\$$name/"*) t="$val${t#"\$$name"}" ;;
      "\${$name}/"*) t="$val${t#"\${$name}"}" ;;
      *) continue ;;
    esac
    break
  done
  case "$t" in *'$'* | *'`'*) return 1 ;; esac
  EXPANDED=$t
}

# 掃 Bash command，收會被 shell 當成寫入執行的目標：未加引號的輸出重導後面那個 word、指令位置上 tee 的檔名參數。
# 引號內、heredoc 內文、註解都只是文字，不產生目標。S_* 是掃描狀態：
#   S_WANT    下一個 word 的角色——redir（重導目標）／dup（`>&` 之後：數字或 `-` 是 fd，其餘是檔）／
#             heredoc／heredoc-dash（`<<`／`<<-` 的結束字）／skip（輸入重導、here-string）
#   S_CMDPOS  下一個 word 在指令位置；S_TEE 目前這個 simple command 是 tee
#   S_OPAQUE  word 裡有出自單引號或反斜線跳脫的 `$`／反引號，展開不得
TARGETS=()
S_WORD='' S_HAS=0 S_OPAQUE=0 S_WANT='' S_CMDPOS=1 S_TEE=0
S_HD=()

end_word() {
  local w=$S_WORD want=$S_WANT has=$S_HAS opaque=$S_OPAQUE
  [ "$has" = 1 ] || return 0
  S_WORD='' S_HAS=0 S_OPAQUE=0 S_WANT=''
  case "$want" in
    dup)
      if [[ $w == - || $w =~ ^[0-9]+-?$ ]]; then return 0; fi
      want=redir
      ;;
    heredoc) S_HD+=("0$w") && return 0 ;;
    heredoc-dash) S_HD+=("1$w") && return 0 ;;
    skip) return 0 ;;
  esac
  if [ "$want" = redir ]; then
    [ "$opaque" = 1 ] || TARGETS+=("$w")
    return 0
  fi
  if [ "$S_CMDPOS" = 1 ]; then
    case "$w" in
      tee)
        S_TEE=1
        S_CMDPOS=0
        ;;
      sudo | command | builtin | exec | env | nohup | time | if | then | else | elif | do | while | until | '{' | '!') ;;
      [A-Za-z_]*=*) ;;
      *) S_CMDPOS=0 ;;
    esac
  elif [ "$S_TEE" = 1 ]; then
    case "$w" in
      -*) ;;
      *) [ "$opaque" = 1 ] || TARGETS+=("$w") ;;
    esac
  fi
}

# 一個 simple command 結束（`;`、`|`、`&`、括號、換行）。
end_command() {
  end_word
  S_WANT='' S_CMDPOS=1 S_TEE=0
}

# `>`／`<` 前面緊貼的純數字是 fd，不是參數。
begin_redirect() {
  if [ "$S_HAS" = 1 ] && [[ $S_WORD =~ ^[0-9]+$ ]]; then
    S_WORD='' S_HAS=0 S_OPAQUE=0
  else
    end_word
  fi
}

scan_targets() {
  # 位元組語意：要認的字元全是 ASCII。bash 的 `${s:i:1}` 每次都先量整串長度，所以改從 1024 位元組的視窗取字，
  # 沒有特殊字元的一段一次吃掉；長指令（大 heredoc、長參數）才不會跑成平方時間、撞上 hook 的 timeout。
  local LC_ALL=C
  local s=$1 nl=$'\n' tab=$'\t' i=0 w=0 o n c d win rest seg line entry
  local plain_stop="['\"\\\\ ${tab}${nl}#;|()&<>]" dq_stop='["\\]'
  n=${#s}
  win=${s:0:1024}
  while [ "$i" -lt "$n" ]; do
    o=$((i - w))
    if [ "$o" -ge 1000 ]; then
      w=$i o=0
      win=${s:i:1024}
    fi
    rest=${win:o}
    # shellcheck disable=SC2295 # plain_stop 是 pattern，刻意不加引號
    seg=${rest%%$plain_stop*}
    if [ -n "$seg" ]; then
      S_WORD+=$seg
      S_HAS=1
      i=$((i + ${#seg}))
      continue
    fi
    c=${win:o:1}
    case "$c" in
      "'")
        rest=${s:i+1}
        seg=${rest%%"'"*}
        S_WORD+=$seg
        S_HAS=1
        case "$seg" in *'$'* | *'`'*) S_OPAQUE=1 ;; esac
        i=$((i + ${#seg} + 2))
        ;;
      '"')
        S_HAS=1
        i=$((i + 1))
        while [ "$i" -lt "$n" ]; do
          o=$((i - w))
          if [ "$o" -ge 1000 ]; then
            w=$i o=0
            win=${s:i:1024}
          fi
          rest=${win:o}
          # shellcheck disable=SC2295 # dq_stop 是 pattern，刻意不加引號
          seg=${rest%%$dq_stop*}
          if [ -n "$seg" ]; then
            S_WORD+=$seg
            i=$((i + ${#seg}))
            continue
          fi
          c=${win:o:1}
          [ "$c" != '"' ] || break
          d=${win:o+1:1}
          case "$d" in
            '$' | '`')
              S_WORD+=$d
              S_OPAQUE=1
              i=$((i + 2))
              ;;
            '"' | '\')
              S_WORD+=$d
              i=$((i + 2))
              ;;
            "$nl") i=$((i + 2)) ;;
            *)
              S_WORD+=$c
              i=$((i + 1))
              ;;
          esac
        done
        i=$((i + 1))
        ;;
      '\')
        d=${win:o+1:1}
        if [ "$d" != "$nl" ]; then
          S_WORD+=$d
          S_HAS=1
          case "$d" in '$' | '`') S_OPAQUE=1 ;; esac
        fi
        i=$((i + 2))
        ;;
      ' ' | "$tab")
        end_word
        i=$((i + 1))
        ;;
      "$nl")
        end_command
        i=$((i + 1))
        # 這一行掛著的 heredoc：內文逐行跳過，直到各自的結束字。
        for entry in ${S_HD[@]+"${S_HD[@]}"}; do
          rest=${s:i}
          d=${entry:1}
          if [ "${entry:0:1}" = 0 ]; then
            # 結束字獨佔一行：整段內文一次切掉，不逐行走。
            case "$rest" in
              "$d" | "$d$nl"*) i=$((i + ${#d} + 1)) ;;
              *"$nl$d$nl"*)
                seg=${rest%%"$nl$d$nl"*}
                i=$((i + ${#seg} + ${#d} + 2))
                ;;
              *) i=$n ;;
            esac
            continue
          fi
          # `<<-`：結束字前可以有縮排。json_str 把 tab 還原成空白，兩種都剝。
          while [ -n "$rest" ]; do
            line=${rest%%"$nl"*}
            i=$((i + ${#line} + 1))
            rest=${rest:${#line}+1}
            line=${line#"${line%%[! "$tab"]*}"}
            [ "$line" != "$d" ] || break
          done
        done
        S_HD=()
        ;;
      '#')
        if [ "$S_HAS" = 1 ]; then
          S_WORD+=$c
          i=$((i + 1))
        else
          rest=${s:i}
          seg=${rest%%"$nl"*}
          i=$((i + ${#seg}))
        fi
        ;;
      ';' | '|' | '(' | ')')
        end_command
        i=$((i + 1))
        ;;
      '&')
        if [ "${win:o+1:1}" = '>' ]; then
          # `&>`／`&>>`：stdout＋stderr 一起重導到檔
          end_word
          i=$((i + 2))
          if [ "${win:o+2:1}" = '>' ]; then i=$((i + 1)); fi
          S_WANT=redir
        else
          end_command
          i=$((i + 1))
        fi
        ;;
      '>')
        begin_redirect
        i=$((i + 1))
        d=${win:o+1:1}
        case "$d" in
          '>' | '|')
            i=$((i + 1))
            S_WANT=redir
            ;;
          '&')
            i=$((i + 1))
            S_WANT=dup
            ;;
          '(')
            # `>(cmd)`：process substitution，裡面是另一個指令
            i=$((i + 1))
            S_WANT='' S_CMDPOS=1 S_TEE=0
            ;;
          *) S_WANT=redir ;;
        esac
        ;;
      '<')
        begin_redirect
        d=${win:o+1:2}
        case "$d" in
          '<<')
            i=$((i + 3))
            S_WANT=skip
            ;;
          '<-')
            i=$((i + 3))
            S_WANT=heredoc-dash
            ;;
          '<'*)
            i=$((i + 2))
            S_WANT=heredoc
            ;;
          '('*)
            i=$((i + 2))
            S_WANT='' S_CMDPOS=1 S_TEE=0
            ;;
          '>'*)
            # `<>`：讀寫開檔
            i=$((i + 2))
            S_WANT=redir
            ;;
          '&'*)
            i=$((i + 2))
            S_WANT=skip
            ;;
          *)
            i=$((i + 1))
            S_WANT=skip
            ;;
        esac
        ;;
    esac
  done
  end_command
}

case "$tool" in
  Write | Edit | MultiEdit | NotebookEdit)
    json_str file_path || json_str notebook_path || exit 0
    [ -n "$JSON_VALUE" ] || exit 0
    judge "$JSON_VALUE"
    [ -z "$WHY" ] || deny
    ;;
  Bash)
    json_str command || exit 0
    cmd=$JSON_VALUE
    case "$cmd" in *'>'* | *tee*) ;; *) exit 0 ;; esac
    scan_targets "$cmd"
    for t in ${TARGETS[@]+"${TARGETS[@]}"}; do
      if expand_target "$t"; then
        judge "$EXPANDED"
        [ -z "$WHY" ] || deny
      fi
    done
    ;;
esac
exit 0
