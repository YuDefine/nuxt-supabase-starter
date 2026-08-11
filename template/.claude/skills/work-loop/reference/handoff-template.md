<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# HANDOFF Status Template

> 主檔 pointer：Step 7.2 寫入 HANDOFF 前 MUST 先完整讀本檔取得模板。
>
> **舊 marker 遷移**：HANDOFF 內若還有 `<!-- BEGIN: loop-engineer-status -->` 或
> `<!-- BEGIN: handoff-loop-status -->` 包夾的段落，**MUST 整段刪除**（連 marker），
> 內容以本模板取代。NEVER 讓兩個世代的 status 段並存。

## Work Loop Status 模板

```markdown
<!-- BEGIN: work-loop-status -->
## Work Loop Status

_Round <N> · updated <ISO> · fingerprint `<8 碼>` (unchanged <M> rounds)_

### ✅ Completed (本 loop 累計)

- `<item>` — <一句話> — `<short-hash>`

_(空時寫 `_(none)_`)_

### 🟢 Ready for Review

- `<change-name>` — <一句話摘要改了什麼>
  - 驗收方式：<具體描述 user 要看什麼>
  - review-gui: `<reviewUrl>`

_(空時寫 `_(none)_`；無 spectra 的 repo 整段可省)_

### 📦 Packaged（待答佇列，選項見 `## ⏳ Awaiting Charles`）

- `<item>` — packaged <ISO>

_(空時寫 `_(none)_`；本段渲染 state 的 `awaiting[]`，attended 輪次跑完 Step 2.7 後**必為空**)_

### ✅ 本輪清算（Step 2.7）

- 已答：`<item>` → <選項 key>（<Charles 逐字一句>）
- 自主接手（prune）：`<item>` — 重判後可自主，未問
- 已失效移除：`<item>` — <不在本輪 scan 的原因>

_(空時寫 `_(none)_`；unattended 輪次只會出現後兩類)_

### ⏸ Skipped

- `<item>` — <skip 窮舉 3 條的哪一條>（dispatch 失敗的條目加 ` — failStreak: N`）

_(空時寫 `_(none)_`)_

### 🧯 Escalated (failStreak ≥ 3，已停止自動 retry)

- `<item>` — <最近一次失敗原因一句話> — failStreak: N
  - 候選系統性修正：走 /oops 登 pitfall、或補 audit signal / eval，讓失敗可被 deterministic check 捕捉

_(空時寫 `_(none)_`；條目每輪原樣 re-emit，直到 Step 1 離場規則成立)_

### 📊 Progress (本輪推進但未完成)

- `<item>` — <N>% → <M>%（推進 <K> tasks，剩 <R>）

_(空時寫 `_(none)_`)_

completed <a> / packaged <b> / escalated <c> / in-flight <d>
<!-- END: work-loop-status -->
```

**本段是人讀輸出，NEVER 是狀態來源**——`failStreak` / `escalated` / `packaged` / `awaiting` 一律以
`.clade/work-loop/state.json` 為準（per SKILL.md Step 1）。這裡的數字只是把 state 檔的內容
渲染給人看；兩邊不一致時修的是渲染，不是 state。
