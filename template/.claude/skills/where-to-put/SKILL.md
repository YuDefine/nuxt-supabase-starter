---
name: where-to-put
description: 'Use when 加規則、CLAUDE.md被擋：判載體'
metadata:
  author: clade
  version: "1.0"
---


# 想加入的東西放哪（決策表）

CLAUDE.md、AGENTS.md 全域與全專案保持淨空；它們只是指引、不該放任何約束，專案要中立、不記個人身分。專案層的 CLAUDE.md、AGENTS.md 各只留一行 pointer 指向本 skill（Charles 2026-11-10 裁示；`.claude/skills/where-to-put/SKILL.md`，只投影 agents target 時是 `.agents/skills/where-to-put/SKILL.md`）：`sync-rules` 缺 CLAUDE.md 就 seed 那一行、AGENTS.md 由 runtime 投影固定寫成那一行，擋寫入的 `pre-tool-keep-instruction-files-empty` hook 只放行空檔與這一行 pointer，其餘內容一律擋、**NEVER** 往兩檔加別的內容。skill 與 hook 隨 clade 投影進 repo，協作者 clone 就有、不必另裝全域檔。本表決定每一件「想讓 AI 以後都照做」的東西放哪個載體。

評估：first-match，由上往下第一個命中的 id 就停；以上皆非 → `W*`。

| id | 判定條件（可觀察） | 放哪 | 例 |
| --- | --- | --- | --- |
| W1 | 違反時可以用程式判出來，而且必須每次都成立（禁令、權限、gate、不准寫某路徑） | hook（`~/.claude/settings.json` 或專案 `.claude/settings.json` 的 PreToolUse／Stop／UserPromptSubmit）；跟 repo 內容有關的再加 CI check 或 linter | `sync-rules --check`、各專案的 CI check |
| W2 | harness 本身有設定項（語言、model、權限模式、環境變數、狀態列） | `settings.json` | 語言偏好 |
| W3 | 回覆的語氣、篇幅、格式，而且有量測證據顯示預設不夠 | output style（`~/.claude/output-styles/`，`settings.json` 的 `outputStyle`）；沒有證據就不加 | — |
| W4 | 有觸發情境的多步流程或判準（說得出「什麼時候用」） | skill，description 寫觸發與 NOT for；跨專案放 clade 或 `~/.agents/skills`，單一專案放該 repo `.claude/skills/` | 本表 |
| W5 | 只在某個席位、模式或 repo 開工時要知道的資訊（身分以外的開工指路） | SessionStart hook 依環境變數或 cwd 注入，只注入當下適用的那段 | clade 中央倉位置、依環境變數指路 |
| W6 | 只在讀或改某個檔、某個目錄時才相關 | 寫進持有它的檔（檔頭註解、該目錄 README、schema 註解） | 某目錄的 `README.md`、腳本檔頭註解 |
| W7 | 某主題的目標、待辦、決策紀錄、事實（不是可重複的步驟） | 專案的 `plans/`、`docs/`、`specs/`，由 W4 skill 或 W5 注入指過去 | `specs/plans/<work>/` |
| W8 | 個人身分、角色、稱呼、對特定人的偏好 | 不放：專案保持中立 | — |
| W9 | 只在這一台機器有效、不能進任何 repo 或 skill、也無法用程式取得的事實指針，而且上面每一列都判過不命中 | memory；寫入要使用者同意（個人機器若有 memory 寫入 hook 就走它）。預設不寫：偏好走 W2／W3／W8，糾正走 W1／W4，專案脈絡走 W7，外部指針走 W7 或該 skill | 幾乎沒有；判到這列先懷疑前面判錯 |
| `W*` | 判不出來 | 先當草案寫進相關 plan，下次碰到再用本表重判；NEVER 寫進 CLAUDE.md 或 AGENTS.md | — |

## memory 苛刻極簡

官方定位（https://code.claude.com/docs/en/memory）：CLAUDE.md 是「你寫的指示與規則」，auto memory 是「Claude 自己寫的學習與模式」，內容是偏好、你給的糾正、無法從程式碼推得的專案脈絡、外部指針；`MEMORY.md` 前 200 行或前 25KB 每個 session 都載入，只存在本機，不跨機器同步。兩者都只是 context，不是強制；要強制請用 hook 或 settings。

本表把官方列的四類 memory 內容都改派到別的載體：

| 官方 memory 類型 | 改放哪 |
| --- | --- |
| user（角色、專長、偏好） | W8 不放；harness 偏好走 W2 |
| feedback（糾正、確認過的做法） | 能機械判的走 W1 hook；做法走 W4 skill |
| project（進行中的工作、期限、決策） | W7 plans／docs |
| reference（外部資源在哪） | W7 或負責該服務的 skill |

所以 memory 只收 W9 這種極少數。`MEMORY.md` 每一行都是每個 session 的常駐成本，寫之前先證明 W1 至 W8 都不適用。

## 用法

1. 由上往下比對，第一個命中的 id 就照「放哪」做，在 commit message 或 journal 寫命中的 W id。
2. W1 優先於一切：能機械判定的約束不要只寫成文字。寫成 hook 之後，W4 skill 或 hook 自己的訊息負責解釋原因。
3. 搬既有內容時也照本表逐條判；判完原處刪掉，不留副本。

## 假設與退場

- `assumption`：指示檔的內容每個 session 都付成本，而且條數越多遵守率越低；hook 是確定執行、指示只是建議。來源是 HumanLayer、progressive disclosure、hooks over instructions 等社群論述的交集。
- `retire_if`：Claude Code 推出比 hook 更好的強制機制，或量測顯示某類指示放回 CLAUDE.md 的遵守率明顯更好、成本可接受，由專案擁有者拍板改表。
