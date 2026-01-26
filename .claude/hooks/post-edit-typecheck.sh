#!/bin/bash
# Hook: 程式碼變更後自動執行 typecheck
# 觸發條件: Edit/Write 完成後 (*.ts, *.vue 檔案)

set -e

# 從 stdin 讀取 JSON 輸入
INPUT=$(cat)

# 取得被編輯的檔案路徑
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // ""')

# 只對 .ts 和 .vue 檔案執行 typecheck
if [[ "$FILE_PATH" == *.ts ]] || [[ "$FILE_PATH" == *.vue ]]; then
    cd "$CLAUDE_PROJECT_DIR"

    echo "正在執行 typecheck..."

    # 使用 timeout 避免執行太久，最多 60 秒
    if timeout 60 pnpm typecheck 2>&1; then
        echo "Typecheck 通過"
    else
        EXIT_CODE=$?
        if [ $EXIT_CODE -eq 124 ]; then
            echo "警告: Typecheck 超時 (60秒)" >&2
        else
            echo "Typecheck 發現錯誤，請檢查" >&2
        fi
        # 不要 exit 2，讓 Claude 繼續工作
        exit 0
    fi
fi

exit 0
