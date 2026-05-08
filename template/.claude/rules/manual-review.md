<!--
🔒 LOCKED — managed by clade
Source: rules/core/manual-review.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: 人工檢查規則——`## 人工檢查` 只能在截圖驗證並取得使用者確認後勾選，不得由 agent 自行代勾
globs: ['openspec/changes/**/tasks.md', 'docs/manual-review-archive.md']
---

# 人工檢查（Manual Review）

繁體中文 | [English](./manual-review.en.md)

## 核心規則

**NEVER** 自行標記 `## 人工檢查` 區塊中的 `- [ ]` 為 `- [x]`。

人工檢查 checkbox 只能在以下流程中勾選：

1. 先派遣 screenshot review 流程截圖
2. 向使用者展示每個檢查項的實際畫面或證據
3. 使用者回覆 OK → 標記該項 `[x]`
4. 使用者回覆有問題 → 不標記，記錄問題
5. 使用者回覆 skip → 標記 `[x]` 並加註 `（skip）`
6. 使用者回覆 skip all → 全部標記 `[x]` 並註記

## 人工檢查與靜態 QA 的差別

| 類型 | 目的 | 能否直接勾選人工檢查 |
| --- | --- | --- |
| screenshot review / 靜態截圖 QA | 確認畫面、文案、佈局、狀態 | **不能直接代勾** |
| 使用者確認 | 確認功能與結果符合期待 | **可以** |

截圖是證據，不是使用者確認本身。

## 可解析格式（hard rule）

`tasks.md` 的 `## 人工檢查` 區塊必須使用可被工具穩定解析的 `#N` schema。

Parent item 格式：

```markdown
- [ ] #1 確認主要流程可完成
- [x] #2 確認錯誤狀態可理解（skip）
```

Scoped sub-item 格式必須剛好縮排兩個空白，並使用 `#N.M`：

```markdown
- [ ] #3 確認行動版流程
  - [ ] #3.1 390px viewport 無水平溢出
  - [x] #3.2 keyboard focus state 清楚
```

禁止在 `## 人工檢查` checkbox line 使用 legacy section ids，例如 `8.1`、`9.3`，也禁止省略 `#N` / `#N.M`。這個 schema 只讓 tooling 能定位與寫回項目，不改變人工檢查 ownership：agent 仍然 **NEVER** 在未取得使用者明確 OK、Issue handling、skip 或 skip all 前自行勾選。

## 建議流程

1. 依 task 清單逐項截圖
2. 說明截圖中看到的狀態
3. 問使用者這一項是否通過
4. 依使用者答覆決定勾選、保留未勾、或註記 skip

## 禁止事項

- **NEVER** 問「要不要我直接幫你勾完」
- **NEVER** 在未展示證據的情況下代勾
- **NEVER** 把 screenshot review 當成等同於人工功能驗證
- **NEVER** 為了通過 gate 而批次勾選未確認的項目
