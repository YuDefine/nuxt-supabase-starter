#!/usr/bin/env bash
# PreToolUse:Bash hook — 擋自由形式的 Notion page PATCH 把票寫成客戶側狀態（done／archived）（block，exit 2）
#
# 判定全在同目錄的 notion-ticket-status-guard.ts；本檔只做快篩與錯誤分支出口。
# 為什麼、判定表、放行標記、threat model、gate 型別、E1～E7 錯誤分支表、已知缺口，見該檔檔頭。
#
# 判定故障時不 fail-open（安全型 gate，判不出來倒向擋）：E1 node 不在、E2 判定檔不在、
# E6 判定行程非 0／2 退出、判定回 3（E3 非 JSON、E5 丟例外）一律匯到下面的 degrade()：
# 外殼讀不了 registry，分不出狀態字，所以保守檢查是「payload 帶寫入跡象就擋」——
# 命中 exit 2，沒命中（純讀取）exit 0 並以 additionalContext 告知 agent。
# 本檔自己決定 exit code，NEVER 直接沿用判定行程的非 0／2 退出碼（harness 把它當 non-blocking，等於放行）。
#
# 快篩在所有錯誤分支之前：沒提到 /v1/pages/、也不是（去掉引號與反斜線後）提到 pages／%xx 的 ntn／curl 指令或帶 [ ] 或指令內 { 的 curl 指令，在任何故障狀態下都 exit 0、無輸出。
# 降級路徑只能用 bash builtin（E1 時 PATH 裡沒有任何外部指令）。

set -uo pipefail

# `read -d ''` 只靠 builtin、對 pipe／socket／檔案都能讀到 EOF（遇 EOF 回 1，內容仍在）。
input=''
IFS= read -r -d '' input || true

# 快篩：絕大多數命令不碰 Notion page，不付 node 啟動成本。
# 字面 /v1/pages/ 之外，ntn／curl 指令只要提到 pages（大小寫不拘）或含 %xx 也進判定：
# ntn 會收合重複斜線（//v1//pages/）、curl 會解 dot segment、伺服器可能解 %xx，只認字面就在這裡被繞過。
# 比工具名與 pages 前先去掉引號與反斜線：c''url、n\tn、pa''ges、p"a"ges 經 bash 去引號後就是 curl／ntn／pages
# （判定的 words() 照樣還原），只比原字串就在這裡被繞過。
unquoted=${input//[\'\"\\]/}
screen=0
case "$unquoted" in
  */v1/pages/*) screen=1 ;;
  *ntn* | *curl*)
    case "$unquoted" in
      *[Pp][Aa][Gg][Ee][Ss]* | *%*) screen=1 ;;
    esac
    # curl URL globbing（[p-p]ages、{pages}、api.no{t}ion.com）展開後才是 page 路徑：含 [ ] 或
    # 指令字串裡的 { 就進判定。hook payload 本身是 JSON，結構 { 後面一定是未跳脫的 "，只排除這一種；
    # 指令裡的 { 在 payload 裡後面接的是 \（{\" body、{\p}ages 這類 shell 跳脫）或其他字，都要進判定。
    case "$unquoted" in
      *curl*)
        case "$input" in
          *[][]* | *'{'[!\"]*) screen=1 ;;
        esac
        ;;
    esac
    ;;
esac
[[ $screen == 1 ]] || exit 0

emit_context() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"%s"}}\n' "$1"
}

# $1=故障原因（固定文字，不含引號與反斜線）$2=修法 $3=只進 stderr 的補充（可空）
degrade() {
  local reason=$1 fix=$2 extra=${3-} line
  case "$input" in
    *PATCH* | *patch* | *' -d'* | *--data* | *--json*)
      if [[ ${CLADE_NOTION_GATE_DEGRADED_OK-} == 1 ]]; then
        line="notion-ticket-status-guard: 判定故障期以開關放行（CLADE_NOTION_GATE_DEGRADED_OK=1；故障：${reason}）"
        printf '%s\n' "$line" >&2
        emit_context "Notion 票狀態判定故障（${reason}），本次沒有檢查狀態值。${line}"
        exit 0
      fi
      printf '⛔ Notion 票狀態判定故障（%s），退回保守檢查；這條指令帶 Notion page 寫入跡象所以被擋。\n' "$reason" >&2
      printf '修法：%s\n' "$fix" >&2
      [[ -n $extra ]] && printf '%s\n' "$extra" >&2
      printf '%s\n' '票狀態轉移請走 notion-sync.ts（不經本 gate）。' >&2
      printf '%s\n' '緊急放行（人控面，放行會留紀錄）：在啟動 Claude Code 的環境設 CLADE_NOTION_GATE_DEGRADED_OK=1（只讀行程 env，不認指令前綴；修好後 unset）。' >&2
      exit 2
      ;;
  esac
  emit_context "Notion 票狀態判定故障（${reason}）：本次只做了保守檢查（帶 PATCH／-d／--data／--json 的 page 指令才擋），未命中故放行。修法：${fix}"
  exit 0
}

command -v node >/dev/null 2>&1 ||
  degrade '判定無法執行：node 不在 PATH' '安裝 node（需支援 TS 型別剝除，v22.18+／v24）並確認 hook 行程的 PATH 找得到它。'

if [[ ${BASH_SOURCE[0]} == */* ]]; then here=${BASH_SOURCE[0]%/*}; else here=.; fi
judge="$here/notion-ticket-status-guard.ts"
[ -f "$judge" ] ||
  degrade '判定檔缺失：hook 投影不完整' '重跑 sync-rules／重裝 clade plugin，讓 notion-ticket-status-guard.ts 與本檔同目錄。' "找不到：$judge"

# 判定只寫 stdout：exit 2 是 deny 訊息（轉 stderr），exit 0 是 additionalContext JSON 或空。
# node 的 stderr（型別剝除警告等）丟掉，免得混進 JSON。
out=$(node "$judge" <<<"$input" 2>/dev/null)
rc=$?
case $rc in
  0)
    [[ -n $out ]] && printf '%s\n' "$out"
    exit 0
    ;;
  2)
    printf '%s\n' "$out" >&2
    exit 2
    ;;
  3)
    degrade '判定讀不懂輸入或判斷途中出錯，exit 3' '這是 notion-ticket-status-guard.ts 的錯誤分支（E3／E5）；回報 clade 並附上被擋的指令。'
    ;;
  *)
    degrade "判定行程異常結束，exit ${rc}" '確認 node 支援 TS 型別剝除，且 gh-pr-create-work.ts 與本檔同目錄（E6）；手動跑 node <判定檔> 看錯誤。'
    ;;
esac
