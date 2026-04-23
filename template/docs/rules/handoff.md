---
description: Handoff 規則——當 session 尚有未完成的 spectra work、blocker 或跨 agent 交接時，必須留下可執行的交接文件
globs: ['HANDOFF.md', 'openspec/changes/**']
---

# Handoff

繁體中文 | [English](./handoff.en.md)

**核心命題**：session 結束時若仍有 in-progress 的變更、未 commit 的 WIP、或明確的 blocker，資訊不能只留在對話上下文。必須落到 `HANDOFF.md`，讓下一個 session / agent 能直接接手。

此規則優先於個別 skill 說明與 ad-hoc 習慣。

## 什麼時候建立或更新 `HANDOFF.md`

符合以下任一情況，**MUST** 建立或更新專案根目錄的 `HANDOFF.md`：

- session 結束時仍有 active spectra change
- 被 `/clear`、context window、或外部中斷打斷
- 有未 commit 的 WIP 需要之後接續
- 工作轉交給其他 agent / runtime（Claude、Codex、Copilot、Cursor、subagent）
- 使用者明確要求留下交接

## 建議格式

```markdown
# Handoff

## In Progress

- [ ] 正在做什麼（change 名稱、task 編號、主要檔案）
- 目前做到哪裡、剩下什麼

## Blocked

- 被什麼擋住
- 還缺什麼資訊 / 權限 / 決策

## Next Steps

1. 下一步最先做什麼
2. 接著做什麼
3. 注意事項 / 風險 / 陷阱
```

## 生命週期

- `HANDOFF.md` 是 **session-scoped**
- `HANDOFF.md` 只保留**尚未被接手**的項目
- 新 session 接手後：**先建立 claim** → 移除已接手項目 → 繼續執行
- 所有項目都接完後：刪除 `HANDOFF.md`
- **允許 commit 進 git**，因為跨機器、跨 agent 交接時很有價值

## 接手流程

接受 handoff 時，順序必須是：

1. 執行專案的 `spectra:claim` script，宣告接手的 change
2. 確認 `openspec/ROADMAP.md` 已反映新的 ownership
3. 從 `HANDOFF.md` 移除對應項目
4. 若 `HANDOFF.md` 已空，直接刪除整份文件

**不是「讀了就刪」**，而是**「claim 已成立後再刪」**。

## 與長期知識的分工

| 文件                  | 用途                                       | 生命週期       |
| --------------------- | ------------------------------------------ | -------------- |
| `HANDOFF.md`          | 尚未被接手的 WIP、blocker、next steps      | 短期、用完即清 |
| `.spectra/claims/**`  | 即時 ownership / heartbeat                 | 短期、機器維護 |
| `docs/solutions/**`   | 非直覺問題的解法沉澱                       | 長期           |
| `docs/decisions/**`   | 架構決策與取捨                             | 長期           |
| `openspec/ROADMAP.md` | 進行中 change、active claims、未來工作排序 | 持續維護       |

## 禁止事項

- **NEVER** 把需要交接的資訊只留在對話裡
- **NEVER** 用含糊句子如「差不多好了」「剩下一點點」
- **NEVER** 把 `HANDOFF.md` 當成長期知識庫，結案後不清理
- **NEVER** 在 handoff 裡省略 change 名稱、task 編號、關鍵檔案路徑
- **NEVER** 接手之後還把同一項目留在 `HANDOFF.md`
