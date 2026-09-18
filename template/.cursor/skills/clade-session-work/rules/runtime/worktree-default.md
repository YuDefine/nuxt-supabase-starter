<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/worktree-default.md; edit canonical source -->
<!-- clade-targets: cursor -->

# Cursor native worktree transport

Cursor uses its configured native command, agent, or IDE entry for `/wt` operations. IDE, CLI, Desktop, Web, and Cloud surfaces are separate; worktree isolation and landing are supported only where the target entry is authorized and emits a completion receipt.

Cursor Project parallel slices use **CreateAgent**, not `/handoff relay|fanout`. Visibility is a draft PR per slice ([[github-flow]]); do not merge-back to make work visible. Isolated cloud VMs that need a DB boot an ephemeral instance on that VM ([[db-topology-invariant]]); desk shared LXC stays on ubuntu-2604.

Cloud clone 的絕對路徑不能當 desk 共用 worktree。Coordinator 必須 fetch 具名 branch、核對 checkpoint SHA，在本機受管來源對同一 `workId` 建映射，並以 worker 交回的 receipts 當唯一接續輸入。本 repository 只有一個 landing owner；worker 不持 merge credential。
