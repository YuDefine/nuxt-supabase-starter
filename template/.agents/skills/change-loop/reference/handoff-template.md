<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/change-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# HANDOFF Status Template

> 本檔從 SKILL.md § Step 5 模板區塊搬移，原文逐字保留。主檔 pointer：「寫入 HANDOFF 前 MUST 先完整讀本檔取得模板」。

## Loop Engineer Status 模板

```markdown
<!-- BEGIN: loop-engineer-status -->
## Loop Engineer Status

_Updated: <YYYY-MM-DD HH:MM> by change-loop_

### ✅ Shipped (本輪)

- `<change-name>` — archived + committed as `<short-hash>` (<commit-message>)

_(空時寫 `_(none)_`)_

### 🟢 Ready for Review

- `<change-name>` — <一句話摘要改了什麼>
  - 驗收方式：<具體描述 user 要看什麼>
  - review-gui: `<reviewUrl>`

_(空時寫 `_(none)_`)_

### ⏸ Skipped

- `<change-name>` — bucket=`<bucket>` — <跳過原因>（dispatch 失敗的條目加 ` — fail-streak: N`）

_(空時寫 `_(none)_`)_

### 🧯 Escalated (fail-streak ≥ 3，已停止自動 retry)

- `<change-name>` — bucket=`<bucket>` — <最近一次失敗原因一句話> — fail-streak: N
  - 候選系統性修正：走 /oops 登 pitfall、或補 audit signal / eval，讓失敗可被 deterministic check 捕捉

_(空時寫 `_(none)_`；條目每輪原樣 re-emit，直到 Step 1.5 離場規則成立)_

### 📊 Progress (本輪推進但未完成)

- `<change-name>` — <N>% → <M>%（推進 <K> tasks，剩 <R>）

_(空時寫 `_(none)_`)_
<!-- END: loop-engineer-status -->
```

`--turbo` 啟用且有 turbo item 時，在 `📊 Progress` 段之後、`<!-- END -->` 之前加 Turbo 段——模板見 [turbo-dispatch.md](turbo-dispatch.md) § Step 5 Turbo 段模板。
