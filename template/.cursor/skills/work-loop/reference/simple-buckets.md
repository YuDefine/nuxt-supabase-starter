<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# 需求接續入口

需求分類與執行以 [SKILL.md](../SKILL.md) § 3.1a 為準。既有 scan bucket 名稱保留作觀測提示；canonical source、當前 revision 與 evidence 決定可執行動作。

- active OPSX 需求走 `/opsx <change-id>` 的 inspect／instructions／materialize。
- legacy parked／stashed 先透過中立 history 讀取原件，保留 supersedes／provenance 後接續。原始暫存資料維持唯讀。
- 歸檔前驗當前 evidence 與人的 gate；在實作 worktree 保存產品碼與 metadata 的 checkpoint，再依 commit skill `batch.md` 登記就緒；達批次條件時一起執行 `/commit`。
- 生成 tasks 的修復走 canonical source 與 project command，完成狀態由驗證器重算。
