#!/usr/bin/env bash
# PreToolUse(Bash) hook — haiku-implementer 擋讀未來（fetch／遠端 ref／gh）與越權（commit／push 等）。
#
# 判定與 threat model 在同目錄的 haiku-implementer-boundary.ts；本檔只做快速放行與 fail-closed 外殼。
# 快速放行：身分欄位（只看第一個 "tool_input" 之前，tool_input 內同名 key 不可冒充）不是 haiku-implementer → exit 0。
# 安全型：是 haiku-implementer 而判定起不來（node 不在、判定檔不在、非預期退出）→ exit 2 擋下這次呼叫。

set -uo pipefail

# 用 bash 內建 read，不靠 cat：PATH 壞掉時 cat 不在，input 變空會被當成「不是 Haiku」靜默放行
IFS= read -r -d '' input || true
head_part=${input%%'"tool_input"'*}
haiku_re='"agent_type"[[:space:]]*:[[:space:]]*"([A-Za-z0-9_-]+:)?haiku-implementer"'
[[ $head_part =~ $haiku_re ]] || exit 0

command -v node >/dev/null 2>&1 || {
  printf 'haiku-implementer 越界判定起不來（node 不在 PATH），判不出就擋。\n' >&2
  exit 2
}
judge="$(dirname "$0")/haiku-implementer-boundary.ts"
[ -f "$judge" ] || {
  printf 'haiku-implementer 越界判定檔不在：%s，判不出就擋。\n' "$judge" >&2
  exit 2
}
printf '%s' "$input" | node "$judge"
status=$?
case "$status" in
  0 | 2) exit "$status" ;;
  *)
    printf 'haiku-implementer 越界判定非預期退出 %s，判不出就擋。\n' "$status" >&2
    exit 2
    ;;
esac
