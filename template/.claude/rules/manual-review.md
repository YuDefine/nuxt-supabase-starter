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
- **MUST** 對不需要截圖、只能由使用者親自操作驗收的 round-trip-only item，加上可選的 `@no-screenshot` marker；使用者完成 round-trip 後可在 `pnpm review:ui` 直接勾 OK。Marked item 的 viewer **MUST** 顯示 round-trip-only UI，且 **MUST NOT** 顯示「複製 handoff prompt」。完整 marker schema 見下方「`@no-screenshot` Marker（hard rule）」；截圖策略配套見 `screenshot-strategy.md` 的「round-trip-only manual-review item」。
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

## `@no-screenshot` Marker（hard rule）

當人工檢查項目是純 functional round-trip，且 screenshot review 無法提供有效視覺證據時，可在該 checkbox line 行尾加上 `@no-screenshot` marker。這個 marker 表示 `pnpm review:ui` 應把該 item 視為 round-trip-only manual-review item：使用者親自操作後可直接勾 OK，不需要截圖，viewer 顯示 round-trip-only UI，且不顯示「複製 handoff prompt」。

Marker 語法：

- `@no-screenshot` **MUST** 是單一 trailing token，位於整行最後。
- `@no-screenshot` 前方 **MUST** 只有一個空白。
- 同一行 **MUST NOT** 出現多個 `@no-screenshot` marker。
- Parent item（`#N`）與 scoped sub-item（`#N.M`）都支援此 marker。
- `@no-screenshot` 出現在 description 中間時只是 plain text，**MUST NOT** 被解析成 marker。

Parent item 範例：

```markdown
- [ ] #5 Admin 送出表單 → 200 OK，列表顯示新狀態 @no-screenshot
```

Scoped sub-item 範例：

```markdown
- [ ] #6 權限拒絕流程
  - [ ] #6.1 非管理者送出 → 403，畫面保留原狀並顯示可理解錯誤 @no-screenshot
```

與 `@followup[TD-NNN]` 共存時，canonical ordering **MUST** 是：

```markdown
- [ ] #7 送出時觸發樂觀鎖 409 → 顯示 conflict copy 並保留輸入 @followup[TD-001] @no-screenshot
```

`@no-screenshot` 永遠是最後一個 trailing token；`@followup[TD-NNN]` 必須放在它前面。若寫成 `... @no-screenshot @followup[TD-001]`，就不是 canonical format，tooling 不保證可穩定解析。

## 截圖檔名與 item id 配對（hard rule）

`pnpm review:ui` 設計成自動把截圖配到正確的 item，使用者不需要手動挑選。為此截圖檔名
**MUST** 以 item id 開頭：

```text
#<item-id>[<variant>]-<descriptor>.<ext>
```

例：item `#1` 的截圖命名為 `#1-clock-light.png`、`#1a-clock-dark.png`；scoped item
`#3.1` 命名為 `#3.1-mobile.png`。

完整命名規範（含變體、legacy fallback、違反處理）見 `screenshot-strategy.md`。

## 標準流程

**首選（DEFAULT）**：tasks.md 仍有 `## 人工檢查` 未勾項時，第一動作 **MUST** 是引導使用者跑 `pnpm review:ui`——本地 GUI 自動依 `#N` / `#N.M` schema 配對截圖、可鍵盤完成 OK / Issue / SKIP、conflict-aware 寫回 tasks.md，不在 chat 內燒 token。完整工具行為見 `vendor/scripts/review-gui.mts`。

**NEVER** 預設用 `AskUserQuestion` 在 chat 內逐項彈對話框——那是 fallback，不是 default path。

**Fallback**（`pnpm review:ui` 不可用時——consumer 沒有該 script、使用者明確拒絕 GUI、或 pure backend 完全無 UI 證據需求）：

1. 依 task 清單逐項準備截圖或證據
2. 說明截圖中看到的狀態
3. 問使用者這一項是否通過
4. 依使用者答覆決定勾選、保留未勾、或註記 skip

## 禁止事項

- **NEVER** 問「要不要我直接幫你勾完」
- **NEVER** 在未展示證據的情況下代勾
- **NEVER** 把 screenshot review 當成等同於人工功能驗證
- **NEVER** 為了通過 gate 而批次勾選未確認的項目
