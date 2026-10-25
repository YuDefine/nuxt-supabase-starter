#!/bin/bash
# Hook: 程式碼變更後自動執行 format + typecheck
# 觸發條件: Edit/Write 完成後 (*.ts, *.vue 檔案)
#
# 用法：post-edit-typecheck.sh [format|typecheck]
#   format     同步跑（hooks.json 不帶 async）：只格式化本次變更的檔。必須同步——它會改寫剛編輯的檔，
#              背景跑會跟 agent 下一個 Edit 搶同一個檔。
#   typecheck  背景跑（hooks.json 帶 asyncRewake）：不擋工具呼叫；只有型別錯誤才 exit 2 喚醒 agent。
#   （不帶參數）舊註冊形狀：兩段都同步跑，供尚未換成新註冊的投影使用。
#
# 延遲來源：
#   - consumer worktree 的 `.npmrc` 若帶 `verify-deps-before-run=install`，裸 `pnpm format`／`pnpm typecheck`
#     每次都先跑 install；postinstall 一失敗，node_modules 永遠算不同步 → 每次編輯重裝。所以 pnpm 一律帶
#     `--config.verify-deps-before-run=false`——hook 不是裝依賴的地方（pre-push nuxt-typecheck、pre-commit vp-staged 同一修法）。
#   - 全量 typecheck 可能超過 60s，所以 typecheck 背景跑，上限 CLADE_TYPECHECK_TIMEOUT（預設 240s），
#     且整段（含等待）不超過 CLADE_TYPECHECK_HOOK_BUDGET（預設 290s，hooks.json timeout 300 內）。
#
# 併發紀律：多個 consumer session 並行時會同時開多個 vue-tsc（實測尖峰 3 個 = ~266% CPU /
# 8.5 GiB RAM），把開發 VM 拖進 CPU wait + swap thrash。因此：
#   - typecheck 走 scripts/gate-slot.sh 的 try 模式：同 repo 已有 heavy gate 在跑、或整機 slot 額滿 → 不排隊，
#     留 pending 標記；正在跑的 post-edit 那一輪做完後看到標記會補驗
#   - cooldown 內的重複觸發不立刻跑（連續編輯合併成一次驗證）
#   - 背景段被跳過的編輯不會被漏驗：同 repo 恆有一個等待者（waiter-$KEY），cooldown 到期或 slot 空出後
#     再跑一次；slot 被 pre-push 或別 repo 的 gate 佔住、或補驗輪數用完時也由它接手。其餘被跳過的直接離開
#   - 以 nice/ionice 降權執行，維持互動操作流暢
# pre-push 的 typecheck 不受影響——它走 clade-gate 的 wait 模式，一定會排到並完整執行。

set -e

MODE="${1:-all}"
case "$MODE" in
    format|typecheck|all) ;;
    *) echo "post-edit-typecheck.sh: unknown mode: $MODE" >&2; exit 0 ;;
esac

# Monorepo detection
if [ -d "${CLAUDE_PROJECT_DIR}/template/app" ]; then
  _PROJECT="${CLAUDE_PROJECT_DIR}/template"
else
  _PROJECT="${CLAUDE_PROJECT_DIR}"
fi

# 從 stdin 讀取 JSON 輸入
INPUT=$(cat)

# 取得被編輯的檔案路徑
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // ""')

# 只對 .ts 和 .vue 檔案執行
if [[ "$FILE_PATH" != *.ts ]] && [[ "$FILE_PATH" != *.vue ]]; then
    exit 0
fi

cd "$_PROJECT"

# hook 不是裝依賴的地方：關掉 consumer 的 verify-deps-before-run（見檔頭延遲根因）
_PNPM=(pnpm --config.verify-deps-before-run=false)

# 路徑守衛：FILE_PATH 必須落在本專案內才跑 gate。
# 兩個實測失敗形態（2026-08-02 transcript）：
#   - 跨 repo 絕對路徑（consumer session 編輯 clade 源檔）餵給本專案 formatter →
#     載入到錯的 vite.config，每次吐一份 Vite error stack 進 context
#   - FILE_PATH 沒能附到 `pnpm format` 後面 → 退化成掃全專案（實測 2153 檔 / 11.5s），
#     輸出整份進 context
case "$FILE_PATH" in
    "$_PROJECT"/*) ;;
    *)
        # typecheck 背景段的 stdout 沒人讀，跳過時不出聲
        [ "$MODE" = typecheck ] && exit 0
        printf '%s\n' '--- GATE_FEEDBACK ---'
        jq -c -n --arg f "$FILE_PATH" \
            '{gate:"format",status:"SKIPPED",note:("edited file is outside this project: " + $f)}'
        exit 0
        ;;
esac

run_format() {
    # 執行 format（auto-fix；只格式化本次變更的檔）。
    # 通過時 NEVER 把 formatter 輸出印進 context —— 成功的 format 沒有任何資訊量，
    # 而它會被後續每一個 request 以 cache-read 重讀。
    FORMAT_OUTPUT=$("${_PNPM[@]}" format "$FILE_PATH" 2>&1) && FORMAT_EXIT=0 || FORMAT_EXIT=$?
    printf '%s\n' '--- GATE_FEEDBACK ---'
    if [ "${FORMAT_EXIT:-0}" -eq 0 ]; then
        printf '%s\n' '{"gate":"format","status":"INFO"}'
    else
        printf '%s\n' "$FORMAT_OUTPUT" | tail -20
        printf '%s\n' '{"gate":"format","status":"INFO","note":"format command failed; tail above"}'
    fi
}

# 解析前 10 條 TS error → 結構化 JSON，讓 Claude Code 可 parse 後自動修正
typecheck_errors_json() {
    _MATCHING=$(printf '%s\n' "$TYPECHECK_OUTPUT" \
        | grep -E '^[[:space:]]*[^(]+\([0-9]+,[0-9]+\): error TS[0-9]+:' \
        | head -10 || true)
    printf '%s\n' "$_MATCHING" | jq -R -s '
        split("\n")
        | map(select(length > 0))
        | map(capture("^[[:space:]]*(?<file>[^(]+)\\((?<line>[0-9]+),[0-9]+\\): error TS[0-9]+: (?<message>.*)$"))
        | map({file: (.file | gsub("^\\s+|\\s+$"; "")), line: (.line | tonumber), message: .message})
    ' 2>/dev/null || printf '[]'
}

# ── typecheck 併發閘門 ────────────────────────────────────────────────
# 設定 TYPECHECK_EXIT（75 = slot busy／cooldown 跳過）與 TYPECHECK_OUTPUT、_SKIP_REASON。
_REPO_TOP=$(git -C "$_PROJECT" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$_PROJECT")
_LOCK_DIR="${CLADE_GATE_LOCK_DIR:-${XDG_RUNTIME_DIR:-/tmp}/clade-gates}"
_SLOT_KEY=$(printf '%s' "$_REPO_TOP" | sha1sum | cut -c1-12)
_COOLDOWN="${CLADE_TYPECHECK_COOLDOWN:-90}"
_STAMP="$_LOCK_DIR/cooldown-$_SLOT_KEY"
_PENDING="$_LOCK_DIR/pending-$_SLOT_KEY"
mkdir -p "$_LOCK_DIR" 2>/dev/null || true

_NICE=()
command -v nice >/dev/null 2>&1 && _NICE=(nice -n 15)
command -v ionice >/dev/null 2>&1 && _NICE=("${_NICE[@]}" ionice -c 3)

_GATE_SLOT="$_REPO_TOP/scripts/gate-slot.sh"
[ -f "$_GATE_SLOT" ] || _GATE_SLOT="$_REPO_TOP/vendor/scripts/gate-slot.sh"

run_typecheck_once() {
    local limit="$1" run_start
    _SKIP_REASON=''
    _COOLDOWN_LEFT=0
    # Cooldown：上次通過的那一輪「開始」後 N 秒內的重複編輯不重跑（只有 PASS 才寫 stamp，
    # 所以 typecheck 紅燈時每次編輯都會立刻重驗，不會被 cooldown 蓋住）。
    # stamp 記開始時刻：那一輪跑的期間發生的編輯不算被它涵蓋。
    if [ -f "$_STAMP" ]; then
        _AGE=$(( $(date +%s) - $(stat -c %Y "$_STAMP" 2>/dev/null || echo 0) ))
        if [ "$_AGE" -lt "$_COOLDOWN" ]; then
            _SKIP_REASON="cooldown: last passing typecheck started ${_AGE}s ago (< ${_COOLDOWN}s)"
            _COOLDOWN_LEFT=$((_COOLDOWN - _AGE))
            TYPECHECK_EXIT=75
            return
        fi
    fi
    run_start=$(date +%s)
    if [ -f "$_GATE_SLOT" ]; then
        # try 模式：取不到 slot 立刻回 75，不排隊
        TYPECHECK_OUTPUT=$(bash "$_GATE_SLOT" try "$_SLOT_KEY" -- \
            timeout "$limit" "${_NICE[@]}" "${_PNPM[@]}" typecheck 2>&1) && TYPECHECK_EXIT=0 || TYPECHECK_EXIT=$?
    else
        TYPECHECK_OUTPUT=$(timeout "$limit" "${_NICE[@]}" "${_PNPM[@]}" typecheck 2>&1) && TYPECHECK_EXIT=0 || TYPECHECK_EXIT=$?
    fi
    if [ "$TYPECHECK_EXIT" -eq 75 ]; then
        _SKIP_REASON='gate slot busy (another heavy gate in this repo, or machine-wide slots full)'
    fi
    [ "$TYPECHECK_EXIT" -eq 0 ] && { touch -d "@$run_start" "$_STAMP" 2>/dev/null || true; }
    return 0
}

# 同 repo 只留一個等待者：mkdir 是原子操作；超過整段預算還在的目錄視為前一個被 kill 的殘留
_WAITER="$_LOCK_DIR/waiter-$_SLOT_KEY"
claim_waiter() {
    mkdir "$_WAITER" 2>/dev/null && return 0
    local age=$(( $(date +%s) - $(stat -c %Y "$_WAITER" 2>/dev/null || echo 0) ))
    [ "$age" -gt "$_BUDGET" ] || return 1
    rmdir "$_WAITER" 2>/dev/null || true
    mkdir "$_WAITER" 2>/dev/null
}

# 背景段：PASS／SKIP／超時都靜默 exit 0（不喚醒 agent）；只有型別錯誤 exit 2 + stderr 喚醒。
run_typecheck_async() {
    local limit="${CLADE_TYPECHECK_TIMEOUT:-240}" retry="${CLADE_TYPECHECK_RETRY:-10}"
    local rounds=0 started deadline left nap waiting=0
    _BUDGET="${CLADE_TYPECHECK_HOOK_BUDGET:-290}"
    deadline=$(( $(date +%s) + _BUDGET ))
    # 沒有 typecheck script 不是型別錯誤：pnpm 的 "Command not found" NEVER 拿來喚醒 agent
    jq -e '.scripts.typecheck // empty' package.json >/dev/null 2>&1 || exit 0
    # 每輪開始時刻的參照檔：pending 比它新 = 本輪跑的期間才留下（-nt 比到奈秒，不受同一秒誤判）
    local mark="$_LOCK_DIR/started-$_SLOT_KEY.$$"
    trap 'rm -f "'"$mark"'"' EXIT
    while :; do
        started=$(date +%s)
        touch "$mark" 2>/dev/null || true
        left=$((deadline - started))
        [ "$left" -lt "$limit" ] && limit=$left
        if [ "$limit" -le 0 ]; then
            [ "$waiting" -eq 1 ] && rmdir "$_WAITER" 2>/dev/null
            exit 0
        fi
        run_typecheck_once "$limit"
        if [ "$TYPECHECK_EXIT" -eq 75 ]; then
            # 本次編輯沒被驗到：留 pending，交給正在跑的那一輪或唯一的等待者。
            # 等待者重試時不再留標記——否則它會把剛消化掉的 pending 又種回去
            if [ "$waiting" -eq 0 ]; then
                touch "$_PENDING" 2>/dev/null || true
                claim_waiter || exit 0
                waiting=1
            fi
            nap=$retry
            [ "$_COOLDOWN_LEFT" -gt 0 ] && nap=$_COOLDOWN_LEFT
            left=$((deadline - $(date +%s)))
            [ "$nap" -gt "$left" ] && nap=$left
            [ "$nap" -gt 0 ] && sleep "$nap"
            # 先放掉再看 pending：之後才留下的標記一定找得到新的等待者
            rmdir "$_WAITER" 2>/dev/null || true
            # pending 被跑完的那一輪消化掉（它已補驗）→ 本次編輯已涵蓋
            [ -f "$_PENDING" ] || exit 0
            claim_waiter || exit 0
            continue
        fi
        [ "$waiting" -eq 1 ] && { rmdir "$_WAITER" 2>/dev/null || true; waiting=0; }
        # 本輪跑的期間有編輯被跳過 → 補驗（最多兩次，避免連續編輯把背景程序拖成無限迴圈；
        # 剩下的 pending 由等待者接手）
        if [ "$_PENDING" -nt "$mark" ] && [ "$rounds" -lt 2 ]; then
            rm -f "$_PENDING" 2>/dev/null || true
            rm -f "$_STAMP" 2>/dev/null || true
            rounds=$((rounds + 1))
            continue
        fi
        # 本輪開始前留下的 pending 已被本輪涵蓋
        if [ -f "$_PENDING" ] && ! [ "$_PENDING" -nt "$mark" ]; then
            rm -f "$_PENDING" 2>/dev/null || true
        fi
        break
    done
    case "$TYPECHECK_EXIT" in
        0) exit 0 ;;
        124) echo "post-edit typecheck: timed out after ${limit}s (not a type error; pre-push typecheck still gates)" >&2; exit 0 ;;
    esac
    {
        echo "背景 typecheck 發現錯誤（$FILE_PATH 編輯後觸發；可能已被後續編輯修掉，修完請重跑 typecheck 確認）"
        printf '%s\n' "$TYPECHECK_OUTPUT" | tail -40
        printf '%s\n' '--- GATE_FEEDBACK ---'
        jq -c -n --argjson errors "$(typecheck_errors_json)" \
            '{gate: "typecheck", status: "FAIL", errors: $errors, action: "fix_and_rerun"}' || true
    } >&2
    exit 2
}

# 舊註冊形狀：同步跑，維持原本的 60s 上限與 stdout GATE_FEEDBACK。
run_typecheck_sync() {
    run_typecheck_once 60
    if [ "${TYPECHECK_EXIT:-0}" -eq 75 ]; then
        if [ -n "$_SKIP_REASON" ] && [ "${_SKIP_REASON#cooldown:}" != "$_SKIP_REASON" ]; then
            echo "Typecheck 跳過（$_SKIP_REASON）"
        else
            echo "Typecheck 跳過（另一個 typecheck 正在執行或整機 heavy gate 額滿）"
        fi
        printf '%s\n' '--- GATE_FEEDBACK ---'
        jq -c -n --arg note "$_SKIP_REASON" '{gate:"typecheck",status:"SKIPPED",note:$note}'
        return
    fi
    # TYPECHECK_OUTPUT 只在 FAIL 分支印，且截尾。
    # PASS 時整份 typecheck 輸出對 Claude 沒有資訊量，卻會被後續每個 request 重讀 ——
    # 實測 PostToolUse:Edit 平均每次 1,668 tokens 進 context，7 天累積 4.35M。
    if [ "${TYPECHECK_EXIT:-0}" -eq 0 ]; then
        printf '%s\n' '--- GATE_FEEDBACK ---'
        printf '%s\n' '{"gate":"typecheck","status":"PASS"}'
    elif [ "$TYPECHECK_EXIT" -eq 124 ]; then
        echo "警告: Typecheck 超時 (60秒)" >&2
        printf '%s\n' '--- GATE_FEEDBACK ---'
        printf '%s\n' '{"gate":"typecheck","status":"FAIL","errors":[],"action":"fix_and_rerun","note":"typecheck timed out after 60s"}'
    else
        echo "Typecheck 發現錯誤，請檢查" >&2
        printf '%s\n' "$TYPECHECK_OUTPUT" | tail -40
        printf '%s\n' '--- GATE_FEEDBACK ---'
        jq -c -n --argjson errors "$(typecheck_errors_json)" \
            '{gate: "typecheck", status: "FAIL", errors: $errors, action: "fix_and_rerun"}' || true
    fi
}

case "$MODE" in
    format) run_format ;;
    typecheck) run_typecheck_async ;;
    all) run_format; run_typecheck_sync ;;
esac

exit 0
