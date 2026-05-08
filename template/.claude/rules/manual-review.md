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

## Screenshot Review ≠ Functional Verification（Hard Rule）

Screenshot review **只覆蓋視覺層**，**不**覆蓋功能 round-trip。下列工作 screenshot review **不能**算驗收完成：

| 類型 | Screenshot 能驗 | Screenshot 不能驗 |
| --- | --- | --- |
| 按鈕 / 控件**存在** | ✅ | — |
| Layout / 字級 / 色彩 / a11y attribute | ✅ | — |
| Empty / Loading / Error state 的**視覺呈現** | ✅ | — |
| **Form submit 真的送到 server** | — | ❌ 必須使用者實作 |
| **Server 真的回 200 + DB 真的變更** | — | ❌ 必須使用者實作 |
| **Dialog 提交後 list refetch + 顯示新狀態** | — | ❌ 必須使用者實作 |
| **Edge case payload（null / 空 / 邊界）** | — | ❌ 必須使用者實作 |
| **權限拒絕 path** | — | ❌ 必須使用者實作 |

### 真實案例（為什麼這條 rule 存在）

> 2026-05-08，`loan-conflict-prompt-and-manual-return` change 的 phase 7 screenshot review 報告 Fidelity 8/8、0 DRIFT、0 Critical，包含「Manual return dialog 結構正確」「Submit loading state OK」。Phase 6 quality gates 全綠（焦點 test 23 個）。
>
> 使用者人工檢查 #39 實際送出 dialog → 立刻收到 400 ZodError：「`return_notes`: expected string, received null」。Schema 用 `.optional()` 而非 `.nullish()`，client 送 `null`，phase 2 codex 寫的 test 沒含 `null` boundary case。
>
> Screenshot review 全綠 + test 全綠 + design fidelity 8/8 都沒擋住這個 bug — 因為**沒有任何環節真實送出 form**。

### 規約

- **MUST** 把 functional round-trip（form submit / mutation / API call → response → state update）列為**使用者人工檢查項目**，不依賴 screenshot review
- **MUST** 在 tasks.md 的 `## 人工檢查` 區塊明寫「送出 → 確認 server response → 確認 DB / list refetch」流程，不要只寫「看到按鈕」
- **NEVER** 把 screenshot review 「按鈕存在 + dialog 結構正確」當成 round-trip 已驗證
- **NEVER** 在使用者尚未真實互動驗收前 archive UI change

### 給 propose / spec 寫作者

寫 `## 人工檢查` 項目時，**MUST** 用「動詞 → 結果」格式描述真實使用者操作：

```markdown
✅ 好：
- [ ] #N Admin 在 `/asset-loans` 點品項 → 開 slideover → 點某筆 active loan 旁「手動歸還」→ dialog 開啟 → 選「正常」+ 不填備註 → 送出 → 200 OK，loan 狀態變 returned，列表自動刷新

❌ 不夠：
- [ ] #N 確認手動歸還按鈕能用
```

「能用」是模糊驗收，落到實作會被解讀為「能點到 / 看到 dialog」，漏掉真實送出 + DB 變更。

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
