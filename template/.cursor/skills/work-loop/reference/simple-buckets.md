# 需求接續入口

<!-- carrier-independent candidate: 本檔的義務不經任何 runtime 專屬工具契約表達，是 [[TD-445]] 抽共用核心時最先可搬的一批。**這是候選標記，不是 audience**——真正的 audience 是上面那行 `clade-targets`，NEVER 因為看到本行就把 targets 放寬。放寬 reference 而不放寬 SKILL.md 會投出沒有 skill 入口指向的孤兒檔。 -->

需求分類與執行以 [SKILL.md](../SKILL.md) § 3.1a 為準。既有 scan bucket 名稱保留作觀測提示；canonical source、當前 revision 與 evidence 決定可執行動作。

- active 的 plan package 走 `/wt <slug>: /implement`，讀 carrier 的下一個未勾 phase。
- legacy parked／stashed 先透過中立 history 讀取原件，保留 supersedes／provenance 後接續。原始暫存資料維持唯讀。
- 歸檔前驗當前 evidence 與人的 gate；在實作 worktree 保存產品碼與 metadata 的 checkpoint，再依 commit skill `batch.md` 登記就緒；達批次條件時一起執行 `/commit`。
- 生成 tasks 的修復走 canonical source 與 project command，完成狀態由驗證器重算。
