---
description: ad-hoc 工作的追蹤載體、唯讀與指定產物邊界、共享單檔紀律、session context 預算門檻
---
<!-- Clade native rule; source: rules/core/session-tasks.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Session Tasks

每一個 ad-hoc 工作先依當次授權選擇載體：

| 可觀察的任務範圍 | 追蹤與交付 |
| --- | --- |
| 明示唯讀、禁止寫檔，或只要求對話交付盤點／計畫 | 直接在對話交付，不建立 task 檔或修改 repository／spine |
| 只允許寫指定計畫／報告文件 | 只在該文件追蹤，不另建 tasks 檔、不擴成實作或提交 |
| 已授權本機修改、當次可完成的 ad-hoc 工作 | 提交說明保存意圖與驗證即可；需要同 session 清單時才建 `tasks/<YYYY-MM-DD-HHMM>-<slug>.md` |
| 需要跨 session 接續、決策或遷移 | **MUST** `node vendor/scripts/flow/flow.ts plan open <slug> --title '…'`，載體是 `specs/plans/<work-id>/plan.md` |

任務後續取得實作授權時重新套用上表；唯讀交付不代替實作追蹤。拆得開的工作 **NEVER** 用共享單檔（例如 `tasks/todo.md`／`tasks/notes.md`）；一 session 一檔，只編輯自己的 task 檔。`HANDOFF.md`、`ROADMAP.md`、`docs/tech-debt.md`、`docs/pitfalls/**` 是本質共享登記簿，改它們前依 [[shared-file-concurrent-write]]。

命中實作列時，原生進度工具只呈現進度，不能替代 task 檔。session 結束時每個未完項 MUST 升級或刪除，二擇一；模板、升級路徑、work id、Herdr transport、收工契約與 pane 判定在 [[session-tasks.operations]]，首次碰 `tasks/**` 或寫收工訊息前 MUST Read。

## Session context 預算

先依 target adapter 確認實際 runtime、launcher、量測口徑與已核准 profile；不可借另一 runtime 的門檻或 model 名稱宣稱豁免。**Iron Law：適用 hard tier 是收工線；soft tier 是限制新大工作段。** 超過 soft tier 後 MUST 不開新的 tasks 檔、多檔重構、新實作 phase 或尚未載入的 skill；手上驗收與小 item 仍可完成。超過 hard tier 後 MUST 保存狀態並按 [[session-tasks.operations]] 收工；壓縮不重設 hard-tier 義務。

兩級語義與 Iron Law 以本節為準；主判準的可觀察 predicate 表在 [[session-tasks.context-budget]]；runtime 的原生命令、hook 與 marker 由 adapter 承載。`paths:` 不是「收工」觸發錨；hard-tier 提示出現時依具名時機主動 Read。

## 並行爭用

檔案層的 dirty／mtime／claim 只能回答「有人寫」，不能回答「對方會不會停」。任何 commit、merge-back、stash 或 publish 遇到其他 actor 時，MUST Read [[session-tasks.concurrent-writers]] 完成四層探測（首步是 `node vendor/scripts/flow/flow.ts who --json`），再依 [[shared-file-concurrent-write]] 行動；**`agent_status: idle` NEVER 等於「對方收手了」。** 未知時保留 WIP，不 stash、不代 commit、不搶 publish。

## 真相層與回報

task 檔只承載當前 session 的授權、進度、證據與未完項。長期契約在 `specs/truth/`（或既有唯一機器 owner）。跨 session 工作接續同一份 plan。`HANDOFF.md` 是從 flow + active plan 生成的 view。follow-up 依 [[follow-up-register]]。**「等」是 [[session-tasks.concurrent-writers]] § 分類後直接行動 表中的一種處置，NEVER 是「判不出來」的同義詞。** Herdr 不可用時，**降級掉的是「對方是誰」，NEVER 是「所以可以 escalate 了」**；本規則不把短期 task 註記冒充長期登記，也不因 task 檔存在就宣稱工作完成。
