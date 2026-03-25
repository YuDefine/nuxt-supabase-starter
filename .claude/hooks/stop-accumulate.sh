#!/usr/bin/env bash
# Stop hook: 提醒 Claude 檢查是否需要累積 skill 或更新 docs

cat <<'PROMPT'
## 結束前檢查（Stop Hook）

請在結束前快速評估以下兩點，如果都不適用就直接結束：

### 1. Skill 累積
- 本次操作是否有值得記錄的流程、注意事項、或踩過的坑？
- 是否有現有 skill 需要更新？
- 如適用：通用 → `~/.claude/skills/`；專案專用 → `.claude/skills/`

### 2. docs/ 更新
- 本次是否涉及除錯、疑難排解、或架構決策？
- 如適用：在 `docs/` 記錄問題描述、root cause、解法（或目前進度）
PROMPT
