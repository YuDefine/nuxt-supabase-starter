#!/usr/bin/env bash
# 人在迴圈（HITL）重現腳本。
# 複製本檔，改寫下方步驟後執行。
# 由使用者在自己的終端機執行並照提示操作；agent 的 Bash 沒有使用者的終端機，
# 在那裡跑時 read 會讀到 EOF 而失敗。agent 只讀結尾印出的 KEY=VALUE。
#
# 用法（使用者在另開的終端機視窗執行）：
#   bash hitl-loop.sh
#
# 兩個 helper：
#   step "<指示>"            → 顯示指示，等使用者按 Enter
#   capture VAR "<問題>"     → 顯示問題，把回答讀進 VAR
#                              （VAR 不可取名 var／question／answer，會被 helper 的 local 遮住）
#
# 結尾把擷取到的值印成 KEY=VALUE，供 agent 解析。
#
# `capture` 會把值印回終端機、由 agent 讀取，所以只拿來擷取觀察結果；
# 登入這類動作用 `step` 交給使用者自己完成，NEVER 用 capture 收密碼或 token。

set -euo pipefail

step() {
  printf '\n>>> %s\n' "$1"
  read -r -p "    [完成後按 Enter] " _
}

capture() {
  local var="$1" question="$2" answer
  printf '\n>>> %s\n' "$question"
  read -r -p "    > " answer
  printf -v "$var" '%s' "$answer"
}

# --- 以下改寫 -----------------------------------------------------------

step "打開 http://localhost:3000 並登入。"

capture ERRORED "按下「匯出」按鈕。有沒有跳出錯誤？(y/n)"

capture ERROR_MSG "貼上錯誤訊息（沒有就填 none）："

# --- 以上改寫 -----------------------------------------------------------

printf '\n--- 擷取結果 ---\n'
printf 'ERRORED=%s\n' "$ERRORED"
printf 'ERROR_MSG=%s\n' "$ERROR_MSG"
