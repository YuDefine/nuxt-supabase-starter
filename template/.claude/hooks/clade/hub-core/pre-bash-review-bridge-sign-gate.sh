#!/usr/bin/env bash
# PreToolUse:Bash｜Monitor hook — Review Bridge 代簽守門（block，exit 2）。
#
# 判定全在同目錄的 pre-bash-review-bridge-sign-gate.ts（規則、繞行場景表、判不出來的分支表都在它的檔頭）；
# 本檔只做快篩與錯誤分支出口。安全型：判定故障時，指令（去掉引號與反斜線後）含 review-bridge 與 start／resume
# 與 --yes／-y 就擋，其餘放行——不讓 node 故障變成 Bridge 代簽的漏洞，也不讓它癱瘓所有 Bash。
# 生效範圍：vendor/scripts/lib/machine-safety-gate.ts 把本檔與判定檔一起複製到 ~/.claude/hooks/clade-machine-safety/，
# 只註冊本檔。

set -uo pipefail

input=''
IFS= read -r -d '' input || true

# 快篩：去掉引號、反斜線與 $ 後才比對（`review-"bridge"`、`review\-bridge`、`review-$''bridge` 這類拆字也會進判定；與判定檔 main 同一條），
# 絕大多數 Bash 在這裡返回，不付 node 啟動成本。比對的是整份 hook JSON：cwd／transcript_path 含 review-bridge 的 session
# 每次都會進判定（多付一次 node 啟動，不影響判定結果）
# JSON 裡的反斜線續行（`review-\\\nbridge`）先整組拿掉，否則剝完反斜線剩 review-nbridge
flat=${input//'\\\n'/}
flat=${flat//[\"\'\\\$]/}
case "$flat" in
  *review-bridge*) ;;
  *) exit 0 ;;
esac

fallback() {
  # 保守擋法另做一份正規化：JSON 的 \n／\t／\r 先換成空白，才看得到獨立的 -y
  local loose=${input//\\[ntr]/ }
  loose=${loose//[\"\'\\]/}
  case "$loose" in
    *start* | *resume*)
      case "$loose" in
        # 只認獨立的 -y（前面是空白、後面不是字元）：transcript_path／cwd 裡的 `-yudefine` 不算
        *--yes* | *[[:space:]]-y[![:alnum:]_-]* | *[[:space:]]-y)
          printf '%s\n' "review-bridge sign gate: 判定故障（$1），指令看起來是帶 --yes 的 review-bridge start／resume，先擋下。修好判定（node、判定檔）後重跑；規則見 ~/.claude/hooks/clade-machine-safety/pre-bash-review-bridge-sign-gate.ts 檔頭。" >&2
          exit 2
          ;;
      esac
      ;;
  esac
  exit 0
}

command -v node >/dev/null 2>&1 || fallback 'node 不在 PATH'
here=${BASH_SOURCE[0]%/*}
judge="$here/pre-bash-review-bridge-sign-gate.ts"
[ -f "$judge" ] || fallback '判定檔不在'

err=$(node --no-warnings "$judge" <<<"$input" 2>&1 >/dev/null)
rc=$?
case "$rc" in
  0) exit 0 ;;
  2)
    printf '%s\n' "$err" >&2
    exit 2
    ;;
  *) fallback "判定行程 exit $rc；node 輸出：${err:0:400}" ;;
esac
