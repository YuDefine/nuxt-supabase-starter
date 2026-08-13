<!--
🔒 LOCKED — managed by clade
Source: rules/core/db-reset-coordination.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# DB Reset Coordination

**每一次**從 primary checkout reset dev DB 前，MUST 先跑：

```bash
node scripts/db-reset-peer-coordination.ts coordinate --cwd "$(pwd)"
```

只有 `safe_to_reset` 才可 reset。Helper 以 git common-dir 找同專案 Herdr peers；`resetting`／`dependent` peer 完成或到 checkpoint 後 release，requester 最後 reset。

**Iron Law：未收斂就不 reset；warning、title、`idle`／`done` 都不是同意。** 缺回覆、Herdr 不可用、identity／correlation mismatch、timeout 均 fail closed；agent MUST 自行協調，NEVER 照跑或叫 user 排序。

Linked worktree 回 `not_applicable` 後走 DB topology rule；shared／canonical DB 另須 `db-lease`。Herdr NEVER 傳 secret、credential 或 DB row data。
