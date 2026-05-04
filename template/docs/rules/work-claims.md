---
description: Work claim 規則——開始接手 spectra change 前先 claim，避免多個 session / agent 不自覺撞工
globs: ['HANDOFF.md', 'openspec/ROADMAP.md', 'openspec/changes/**', '.spectra/claims/**']
---

# Work Claims

繁體中文

**核心命題**：`HANDOFF.md` 與 `openspec/ROADMAP.md` 都是可讀狀態，但真正避免撞工的是**可機器寫入的 claim**。只要 session / agent 要開始做某個 active change，就必須先 claim。

## 什麼時候 claim

符合以下任一情況，**MUST** 先建立或更新該 change 的 claim：

- 接手 `HANDOFF.md` 裡的工作
- 新 session 決定繼續某個 active spectra change
- 使用者明確把某個 change 指派給你
- 你要開始修改某個 change 對應的 tasks / proposal / implementation

## 標準流程

1. 執行專案的 `spectra:claim` script，宣告你要接手哪個 change
2. 確認 `openspec/ROADMAP.md` 的 `Active Claims` 已反映 ownership
3. 若是從 `HANDOFF.md` 接手：**立刻移除已接手項目**
4. 工作完成、park、archive、或明確交棒時，執行 `spectra:release`

## `HANDOFF.md` 的分工

- `HANDOFF.md` 只保留**尚未被接手**的項目
- 一旦 claim 成立，對應 handoff 項目就不再留在 `HANDOFF.md`
- `HANDOFF.md` 若已空，應刪除整份文件

## `openspec/ROADMAP.md` 的分工

- `Active Changes`：哪些 change 存在、目前處於哪個 stage
- `Active Claims`：**誰現在正在做哪個 change**
- `Next Moves`：未來想做什麼，不是即時鎖

## stale claim

- claim 超過一段時間沒有 heartbeat，會顯示為 stale
- stale 不代表可以默默覆蓋；接手前仍應先讀現況、確認沒有活人 session 正在做
- takeover 後要立即讓 roadmap 反映新的 ownership

## 禁止事項

- **NEVER** 在未 claim 的狀況下開始做 active spectra change
- **NEVER** 看到 stale claim 就直接無聲接管；至少要先檢查最新狀態
- **NEVER** 接手 handoff 後還把同一項目留在 `HANDOFF.md`
- **NEVER** 把 `ROADMAP.md` 當成 claim 的替代品；claim 才是 ownership ground truth
