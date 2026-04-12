#!/usr/bin/env bash
# Stop hook: Compound Janitor — 評估 session 是否產出值得累積的知識

cat <<'PROMPT'
## 結束前檢查（Stop Hook — Compound Janitor）

快速評估以下三點，**只做適用的**，都不適用就直接結束：

### 1. 知識萃取（docs/solutions/ — 最重要）
回顧本次 session，是否符合以下**任一**條件？
- Debug 過程嘗試了 3+ 種方法才找到 root cause
- 發現框架/平台/套件的隱性限制或 undocumented behavior
- Root cause 非 typo，解法非直覺
- 解法涉及 workaround

**如果符合**：寫入 `docs/solutions/<category>/` 結構化文檔（見 README.md schema）
**先搜索**是否已有相似記錄 → 有則更新，無則新建

**不需萃取**：修 typo、調 CSS、跑 migration、更新依賴、直覺修復

### 2. Skill 累積
- 本次是否有值得記錄到 skill 的流程或注意事項？
- 如適用：通用 → `~/.claude/skills/`；專案專用 → `.claude/skills/`

### 3. HANDOFF.md 交接檢查
檢查是否有未完成的工作需要交接：
- `openspec/changes/` 中有非 archive 的 active change？
- `git status --porcelain` 有未 commit 的變更？

**如果有**：建立或更新 `HANDOFF.md`（格式見 `.claude/rules/handoff.md`）
**如果沒有**：跳過（也清理舊的 HANDOFF.md，如果存在的話）

PROMPT
