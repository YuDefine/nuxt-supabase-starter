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

PROMPT
