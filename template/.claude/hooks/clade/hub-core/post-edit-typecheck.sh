#!/bin/bash
# Hook: 程式碼變更後自動執行 format + typecheck
# 觸發條件: Edit/Write 完成後 (*.ts, *.vue 檔案)
#
# 併發紀律（2026-07-31）：這支 hook 每次編輯都跑一次完整 typecheck，多個 consumer session
# 並行時會同時開多個 vue-tsc（實測尖峰 3 個 = ~266% CPU / 8.5 GiB RAM），把開發 VM 拖進
# CPU wait + swap thrash。因此：
#   - format 只處理本次變更的檔，不掃整個專案
#   - typecheck 走 scripts/gate-slot.sh 的 try 模式：同 repo 已有 heavy gate 在跑、或整機
#     slot 額滿 → 直接 SKIP（下一次編輯會再試），不排隊、不疊加
#   - cooldown 內的重複觸發直接 SKIP（連續編輯合併成一次驗證）
#   - 以 nice/ionice 降權執行，維持互動操作流暢
# pre-push 的 typecheck 不受影響——它走 clade-gate 的 wait 模式，一定會排到並完整執行。

set -e

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
if [[ "$FILE_PATH" == *.ts ]] || [[ "$FILE_PATH" == *.vue ]]; then
    cd "$_PROJECT"

    # 路徑守衛：FILE_PATH 必須落在本專案內才跑 gate。
    # 兩個實測失敗形態（2026-08-02 transcript）：
    #   - 跨 repo 絕對路徑（consumer session 編輯 clade 源檔）餵給本專案 formatter →
    #     載入到錯的 vite.config，每次吐一份 Vite error stack 進 context
    #   - FILE_PATH 沒能附到 `pnpm format` 後面 → 退化成掃全專案（實測 2153 檔 / 11.5s），
    #     輸出整份進 context
    case "$FILE_PATH" in
        "$_PROJECT"/*) ;;
        *)
            printf '%s\n' '--- GATE_FEEDBACK ---'
            jq -c -n --arg f "$FILE_PATH" \
                '{gate:"format",status:"SKIPPED",note:("edited file is outside this project: " + $f)}'
            exit 0
            ;;
    esac

    # 執行 format（auto-fix；只格式化本次變更的檔）。
    # 通過時 NEVER 把 formatter 輸出印進 context —— 成功的 format 沒有任何資訊量，
    # 而它會被後續每一個 request 以 cache-read 重讀。
    FORMAT_OUTPUT=$(pnpm format "$FILE_PATH" 2>&1) && FORMAT_EXIT=0 || FORMAT_EXIT=$?
    printf '%s\n' '--- GATE_FEEDBACK ---'
    if [ "${FORMAT_EXIT:-0}" -eq 0 ]; then
        printf '%s\n' '{"gate":"format","status":"INFO"}'
    else
        printf '%s\n' "$FORMAT_OUTPUT" | tail -20
        printf '%s\n' '{"gate":"format","status":"INFO","note":"format command failed; tail above"}'
    fi

    # ── typecheck 併發閘門 ────────────────────────────────────────────────
    _REPO_TOP=$(git -C "$_PROJECT" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$_PROJECT")
    _LOCK_DIR="${CLADE_GATE_LOCK_DIR:-${XDG_RUNTIME_DIR:-/tmp}/clade-gates}"
    _SLOT_KEY=$(printf '%s' "$_REPO_TOP" | sha1sum | cut -c1-12)
    _COOLDOWN="${CLADE_TYPECHECK_COOLDOWN:-90}"
    _STAMP="$_LOCK_DIR/cooldown-$_SLOT_KEY"
    mkdir -p "$_LOCK_DIR" 2>/dev/null || true

    # Cooldown：上次通過後 N 秒內的重複編輯直接跳過（只有 PASS 才寫 stamp，
    # 所以 typecheck 紅燈時每次編輯都會立刻重驗，不會被 cooldown 蓋住）。
    _SKIP_REASON=''
    if [ -f "$_STAMP" ]; then
        _AGE=$(( $(date +%s) - $(stat -c %Y "$_STAMP" 2>/dev/null || echo 0) ))
        if [ "$_AGE" -lt "$_COOLDOWN" ]; then
            _SKIP_REASON="cooldown: last passing typecheck was ${_AGE}s ago (< ${_COOLDOWN}s)"
        fi
    fi

    if [ -n "$_SKIP_REASON" ]; then
        echo "Typecheck 跳過（$_SKIP_REASON）"
        printf '%s\n' '--- GATE_FEEDBACK ---'
        jq -c -n --arg note "$_SKIP_REASON" '{gate:"typecheck",status:"SKIPPED",note:$note}'
        exit 0
    fi

    # 降權執行：typecheck 不該跟互動操作搶 CPU / IO
    _NICE=()
    command -v nice >/dev/null 2>&1 && _NICE=(nice -n 15)
    command -v ionice >/dev/null 2>&1 && _NICE=("${_NICE[@]}" ionice -c 3)

    _GATE_SLOT="$_REPO_TOP/scripts/gate-slot.sh"
    [ -f "$_GATE_SLOT" ] || _GATE_SLOT="$_REPO_TOP/vendor/scripts/gate-slot.sh"

    if [ -f "$_GATE_SLOT" ]; then
        # try 模式：取不到 slot 立刻回 75，不排隊
        TYPECHECK_OUTPUT=$(bash "$_GATE_SLOT" try "$_SLOT_KEY" -- \
            timeout 60 "${_NICE[@]}" pnpm typecheck 2>&1) && TYPECHECK_EXIT=0 || TYPECHECK_EXIT=$?
    else
        TYPECHECK_OUTPUT=$(timeout 60 "${_NICE[@]}" pnpm typecheck 2>&1) && TYPECHECK_EXIT=0 || TYPECHECK_EXIT=$?
    fi

    if [ "${TYPECHECK_EXIT:-0}" -eq 75 ]; then
        echo "Typecheck 跳過（另一個 typecheck 正在執行或整機 heavy gate 額滿）"
        printf '%s\n' '--- GATE_FEEDBACK ---'
        printf '%s\n' '{"gate":"typecheck","status":"SKIPPED","note":"gate slot busy; will re-run on next edit"}'
        exit 0
    fi

    # TYPECHECK_OUTPUT 只在 FAIL 分支印（見下），且截尾。
    # PASS 時整份 typecheck 輸出對 Claude 沒有資訊量，卻會被後續每個 request 重讀 ——
    # 實測 PostToolUse:Edit 平均每次 1,668 tokens 進 context，7 天累積 4.35M。
    if [ "${TYPECHECK_EXIT:-0}" -eq 0 ]; then
        touch "$_STAMP" 2>/dev/null || true
        printf '%s\n' '--- GATE_FEEDBACK ---'
        printf '%s\n' '{"gate":"typecheck","status":"PASS"}'
    elif [ "$TYPECHECK_EXIT" -eq 124 ]; then
        echo "警告: Typecheck 超時 (60秒)" >&2
        printf '%s\n' '--- GATE_FEEDBACK ---'
        printf '%s\n' '{"gate":"typecheck","status":"FAIL","errors":[],"action":"fix_and_rerun","note":"typecheck timed out after 60s"}'
    else
        echo "Typecheck 發現錯誤，請檢查" >&2
        # 只有 FAIL 才印原始輸出，且截尾 40 行 —— 結構化 errors 已在下面給，
        # 這段是為了 TS error 格式以外的失敗（crash / OOM / 設定載入失敗）留線索。
        printf '%s\n' "$TYPECHECK_OUTPUT" | tail -40
        # 解析前 10 條 TS error → 結構化 JSON，讓 Claude Code 可 parse 後自動修正
        _MATCHING=$(printf '%s\n' "$TYPECHECK_OUTPUT" \
            | grep -E '^[[:space:]]*[^(]+\([0-9]+,[0-9]+\): error TS[0-9]+:' \
            | head -10 || true)
        _ERRORS_JSON=$(printf '%s\n' "$_MATCHING" | jq -R -s '
            split("\n")
            | map(select(length > 0))
            | map(capture("^[[:space:]]*(?<file>[^(]+)\\((?<line>[0-9]+),[0-9]+\\): error TS[0-9]+: (?<message>.*)$"))
            | map({file: (.file | gsub("^\\s+|\\s+$"; "")), line: (.line | tonumber), message: .message})
        ' 2>/dev/null || printf '[]')
        printf '%s\n' '--- GATE_FEEDBACK ---'
        jq -c -n --argjson errors "${_ERRORS_JSON:-[]}" \
            '{gate: "typecheck", status: "FAIL", errors: $errors, action: "fix_and_rerun"}' || true
    fi
fi

exit 0
