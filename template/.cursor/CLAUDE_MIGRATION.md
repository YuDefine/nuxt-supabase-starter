# .claude to .cursor migration note

這份檔案記錄目前把 `template/.claude` 複製並調整到 Cursor 的狀態。

## 已完成

- 已建立 `template/.cursor/hooks.json`
- 將 `template/.claude/settings.json` 的 hook 邏輯映射到 Cursor 事件：
  - `PreToolUse` -> `preToolUse`
  - `PostToolUse` -> `postToolUse`
  - `SessionStart` -> `sessionStart`
  - `Stop` -> `stop`
- hook command 路徑已加上 `CLAUDE_PROJECT_DIR` fallback：
  - `\"${CLAUDE_PROJECT_DIR:-$PWD}\"/...`
  - 可在 Claude/Cursor 兩端共用同一批 shell script

## 已存在且可沿用

- `template/.cursor/rules/*.mdc`
- `template/.cursor/commands/*.md`
- `template/.cursor/agents/*.md`

## 仍需手動確認

- `postToolUse` 對 MCP matcher 的實際格式，可能需依 Cursor Hooks 面板輸出微調：
  - 目前使用：`MCP: .*apply_migration`
- `.claude/settings.json` 內 `permissions.allow` 與 `enabledMcpjsonServers` 不是 Cursor 同格式，需另外用 Cursor/MCP 設定處理

## 驗證建議

1. 開啟 Cursor 的 Hooks 面板確認 `hooks.json` 已載入
2. 任意編輯一個 `*.ts` 或 `*.vue` 觸發 `post-edit-typecheck.sh`
3. 檢查有無 timeout 或 matcher 不命中的錯誤訊息
4. 若有問題，先拿掉 matcher 驗證 hook 基本可執行，再逐步收斂 matcher

## 本輪重寫/替代（新增）

- 移除 `hooks.json` 內對 `Skill` matcher 的依賴，改以 `/cursor-spectra-*` 包裝指令承接流程 gate
- 新增 `legacy-stop-accumulate.sh`：在 Cursor stop 事件先執行 `.claude/hooks/stop-accumulate.sh`
- 新增 `permission-shell-guard.sh`：以 `beforeShellExecution` 近似替代 `.claude` 的 Bash allow-list
- 新增 `permission-mcp-guard.sh`：以 `beforeMCPExecution` 近似替代 `.claude` 的 MCP allow-list
