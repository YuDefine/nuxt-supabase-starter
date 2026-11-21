#!/usr/bin/env bash
# post-bash-rust-cli-hint.sh — 只在「回傳很大、而且有可量的浪費」那一次，給一行可直接照抄的替代指令。
#   （規約與工具清單的 SoT：docs/rust-cli-tools.md）
#
#   PostToolUse(Bash)：
#   - outline：`cat`／`sed -n` 整讀一支程式檔，輸出 ≥ 200 行 → `outline <檔>` 後用 Read offset／limit 讀命中段
#     （`sed` 沒帶 `-n` 不判：那多半是改寫或替換，不是讀檔）
#   - fd：`find` 輸出 ≥ 60 行且含 node_modules／dist／.git 路徑，且 PATH 上有 fd → `fd` 預設遵守 .gitignore
#   - rg：遞迴 `grep`（-r／-R／--recursive，含 -rn 這類合併旗標）輸出 ≥ 60 行且含 node_modules／dist 路徑，
#     且 PATH 上有 rg → `rg` 預設遵守 .gitignore；單檔 grep 不判（.gitignore 對單檔沒有意義）
#
# 型別：提醒型
# 重複證據：yudefine-hq research/2026-10-29-省token工具.md——工具輸出 60% 是 Read／sed -n／cat／head；
#   desk 近 2 天主 session 讀檔輸出 34.8M 字元，Read 帶 offset／limit 只佔 5%。
# 設計答案（hook-authoring `rules/提醒注入型的送達去重與噪音.md`）：
# - 送達通道：hookSpecificOutput.additionalContext（同 skill-entry-pointer.sh）。NEVER permissionDecision、NEVER exit 2、
#   NEVER 改寫指令（改寫會破壞原始證據與權限邊界：agent 看到的輸出不再是它下的指令的輸出）。
# - 指令自己的路徑引數已含 node_modules／dist／.git（刻意搜它們）→ 靜默：fd／rg 的 .gitignore 過濾正是會丟掉那些檔，
#   提示會誤導，還會用掉同 session 同類只提示一次的名額。
# - 觸發資料單一來源：本檔的三個類別與門檻；門檻可用環境變數覆寫（CLADE_RUST_HINT_CAT_LINES／CLADE_RUST_HINT_FIND_LINES）。
# - 噪音預算：一次事件一行、< 300 bytes；同一 session 同一類只提示一次（每 agent 每 session ≤ 3 行）。
# - 去重鍵：session_id（＋agent_id）＋類別；payload 沒有 session_id 時退回當日鍵。NEVER 用 PPID。
# - subagent：收（內容是這一次動作的替代指令，是動作本身的前置知識；子代理沒有 Skill tool），所以鍵含 agent_id。
# - 措辭：事實＋可照抄指令，不寫祈使句，不寫「ALWAYS」。
# - 工具存在才提示：outline 只認 clade 自己那份（${CLADE_HOME:-$HOME/offline/clade}/scripts/outline.ts，
#   與 session-start-rust-cli-table.sh 同一個候選）；NEVER 推薦 consumer repo 裡同名的 scripts/outline.ts
#   （那是別人的程式碼）。fd／rg 要在 PATH 上。沒裝的工具 NEVER 被推薦（驗收：因本項造成的指令失敗為 0）。
# - 效果指標：提示後同一 agent 接下來的 Bash 出現對應工具（`outline.ts`／`fd`／`rg`）；
#   hook_followthrough.py --match '⤷ (\d+ 行整讀|find 回了|grep -r 回了)' --follow-regex 'Bash .*"command":\s*"[^"]*(outline\.ts|\bfd |\brg )' 量
#   （--match 只篩送達內容；本提示沒有 READ 指標，followed 只看 --follow-regex 命中的後續 Bash 呼叫；
#   hook_followthrough.py 用預設 json.dumps 序列化 tool_input，冒號後有空白，所以 regex 用 `:\s*`）；scripts/measure-rust-cli-usage.ts 量重試。
# - 狀態住使用者私有的 cache（umask 077），超過 7 天的 session 目錄順手清掉。
#
# fail-open：jq 缺、payload 讀不懂、判不出來 → 靜默 exit 0。

set -uo pipefail

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -n "$CMD" ] || exit 0
OUT=$(printf '%s' "$INPUT" | jq -r '(.tool_response | if type == "object" then (.stdout // .output // "") elif type == "string" then . else "" end) // ""' 2>/dev/null)
[ -n "$OUT" ] || exit 0

CAT_LINES="${CLADE_RUST_HINT_CAT_LINES:-200}"
FIND_LINES="${CLADE_RUST_HINT_FIND_LINES:-60}"
LINES=$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')

CLASS=""
HINT=""

# 複合命令（管線、&&、;）不判：輸出不一定來自單一 cat／find，誤報的成本高於漏報。
case "$CMD" in *'|'* | *'&&'* | *';'* | *'$('* | *'`'*) exit 0 ;; esac

# 拆詞不展開 glob（`cat src/*.ts` 不能變成 hook cwd 裡的檔名）
read -ra ARGS <<<"$CMD"
first=${ARGS[0]:-}

# 指令本身已指向 node_modules／dist／.git（刻意搜它們）→ 回 1：fd／rg 的 .gitignore 過濾會丟掉要找的檔，提示會誤導
targets_noisy_dir() {
  local a
  for a in "${ARGS[@]:1}"; do
    [[ $a =~ (^|[/=])(node_modules|dist|\.git)(/|$) ]] && return 1
  done
  return 0
}
case "$first" in
  cat | sed)
    [ "$LINES" -ge "$CAT_LINES" ] || exit 0
    # 取最後一個非旗標引數當檔名；sed 的腳本（-e 後一個，或沒有 -e 時第一個位置引數）不算
    FILE=""
    HAS_N=""
    SCRIPT_PENDING=""
    [ "$first" = sed ] && SCRIPT_PENDING=1
    SKIP_NEXT=""
    for a in "${ARGS[@]:1}"; do
      if [ -n "$SKIP_NEXT" ]; then SKIP_NEXT=""; continue; fi
      case "$a" in
        -e | --expression) SKIP_NEXT=1; SCRIPT_PENDING=""; continue ;;
        -n | --quiet | --silent) HAS_N=1; continue ;;
        -[!-]*) case "$a" in *n*) [ "$first" = sed ] && HAS_N=1 ;; esac; continue ;;
        -*) continue ;;
      esac
      if [ -n "$SCRIPT_PENDING" ]; then SCRIPT_PENDING=""; continue; fi
      FILE="$a"
    done
    [ "$first" = sed ] && [ -z "$HAS_N" ] && exit 0
    [ -n "$FILE" ] || exit 0
    # 只剝成對的引號；剝完還有引號＝含空白的路徑被拆開了，判不出完整檔名 → 靜默
    case "$FILE" in
      \'*\') FILE=${FILE#\'}; FILE=${FILE%\'} ;;
      \"*\") FILE=${FILE#\"}; FILE=${FILE%\"} ;;
    esac
    case "$FILE" in *\'* | *\"*) exit 0 ;; esac
    # 反斜線跳脫的空白（my\ file.ts）會被 read -ra 拆成兩詞，FILE 只剩尾段 → 任一引數含反斜線就判不出檔名
    case "$CMD" in *\\*) exit 0 ;; esac
    # 含 glob 字元＝一次讀多檔，outline 單檔指令照抄不了 → 靜默
    case "$FILE" in *'*'* | *'?'* | *'['*) exit 0 ;; esac
    case "$FILE" in
      *.ts | *.tsx | *.js | *.mjs | *.cjs | *.vue | *.py | *.sh | *.rs | *.go | *.md) ;;
      *) exit 0 ;;
    esac
    OUTLINE="${CLADE_HOME:-${HOME:-/nonexistent}/offline/clade}/scripts/outline.ts"
    [ -f "$OUTLINE" ] || exit 0
    CLASS="outline"
    HINT="⤷ ${LINES} 行整讀：先 node ${OUTLINE} ${FILE} 取簽名與行號，再用 Read 的 offset／limit 只讀命中那一段"
    ;;
  find)
    [ "$LINES" -ge "$FIND_LINES" ] || exit 0
    targets_noisy_dir || exit 0
    # here-string 而非 printf | grep -q：pipefail 下 grep 命中先退出，大輸出的 printf 吃 SIGPIPE 回 141（見 docs/pitfalls/2026-07-25-grep-q-pipefail-sigpipe-false-negative.md）
    grep -qE '(^|/)(node_modules|dist|\.git)/' <<<"$OUT" || exit 0
    command -v fd >/dev/null 2>&1 || exit 0
    CLASS="fd"
    HINT="⤷ find 回了 ${LINES} 行且含 node_modules／dist／.git：fd 預設遵守 .gitignore，例如 fd -e ts <關鍵字>"
    ;;
  grep)
    [ "$LINES" -ge "$FIND_LINES" ] || exit 0
    targets_noisy_dir || exit 0
    RECURSIVE=""
    for a in "${ARGS[@]:1}"; do
      case "$a" in
        --recursive | --dereference-recursive) RECURSIVE=1 ;;
        --*) ;;
        -*[rR]*) RECURSIVE=1 ;;
      esac
    done
    [ -n "$RECURSIVE" ] || exit 0
    grep -qE '(^|/)(node_modules|dist)/' <<<"$OUT" || exit 0
    command -v rg >/dev/null 2>&1 || exit 0
    CLASS="rg"
    HINT="⤷ grep -r 回了 ${LINES} 行且含 node_modules／dist：rg 預設遵守 .gitignore，例如 rg -n --max-columns 200 <樣式>"
    ;;
  *) exit 0 ;;
esac

[ -n "$CLASS" ] || exit 0

SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
AGENT=$(printf '%s' "$INPUT" | jq -r '.agent_id // empty' 2>/dev/null)
KEY="${SESSION:-no-session-$(date +%Y%m%d)}${AGENT:+-$AGENT}"
KEY=$(printf '%s' "$KEY" | tr -c 'A-Za-z0-9_-' '_')
STATE_ROOT="${XDG_CACHE_HOME:-${HOME:-/nonexistent}/.cache}/clade/rust-cli-hint"
STATE_DIR="$STATE_ROOT/$KEY"
[ -f "$STATE_DIR/$CLASS.seen" ] && exit 0
if [ ! -d "$STATE_DIR" ]; then
  find "$STATE_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} + 2>/dev/null
  (umask 077 && mkdir -p "$STATE_DIR") 2>/dev/null || exit 0
fi
: >"$STATE_DIR/$CLASS.seen" 2>/dev/null || exit 0

jq -cn --arg c "$HINT" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$c}}'
exit 0
