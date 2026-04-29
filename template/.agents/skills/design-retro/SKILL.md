---
name: design-retro
description: 分析 docs/design-review-findings.md 歷史，識別跨 spec 的重複 UI 問題模式，提出流程改善建議。spectra-archive 完成或 findings 累積 5 倍數時主動觸發。
---

# Design Retro

分析 Design Review 歷史發現，識別跨 spec 的重複問題模式，主動提出流程改善建議。

## 觸發條件

### 自動觸發（由 proactive-skills.md 規則驅動）

1. **Archive 後觸發** — `spectra-archive` 完成且該 change 有 design review findings 時
2. **累積門檻觸發** — `docs/design-review-findings.md` 新增記錄後，總 change 數達 5 的倍數（5、10、15…）

### 手動觸發

使用者執行 `/design-retro` 時。可選參數：

- `/design-retro` — 分析全部歷史
- `/design-retro last 3` — 只分析最近 3 個 change

## 執行流程

### Phase 1: 資料收集

1. 讀取 `docs/design-review-findings.md`
2. 若檔案不存在或為空 → 回報「尚無 design review 記錄」→ 結束
3. 解析所有 change 記錄，建立結構化資料：
   - 每筆 finding 的類別、嚴重度、發現來源（哪個 skill 發現的）
   - 按 change 時間排序

### Phase 2: 模式分析

對收集到的資料執行以下分析：

#### 2.1 頻率分析

按類別統計出現次數與佔比：

```
| 類別 | 次數 | 佔比 | 趨勢 |
|------|------|------|------|
| spacing | 14 | 30% | ↑ 連續 4 個 change 出現 |
| a11y | 9 | 19% | → 穩定 |
| color | 3 | 6% | ↓ 最近 3 個 change 未出現 |
```

趨勢判定：

- `↑` — 最近 3 個 change 中出現 ≥ 2 次
- `→` — 穩定出現但無明顯增減
- `↓` — 最近 3 個 change 中未出現

#### 2.2 嚴重度分析

```
| 嚴重度 | 次數 | 佔比 |
|--------|------|------|
| critical | 5 | 11% |
| warning | 30 | 64% |
| info | 12 | 25% |
```

#### 2.3 來源 skill 分析

統計哪個 design skill 發現最多問題：

```
| 發現來源 | 次數 | 常見類別 |
|---------|------|---------|
| /impeccable audit | 15 | a11y, color |
| /impeccable layout | 10 | spacing, layout |
| /design improve | 8 | consistency |
```

#### 2.4 熱點頁面分析

統計哪些頁面/元件反覆出現問題：

```
| 頁面/元件 | 出現次數 | 主要類別 |
|-----------|---------|---------|
| pages/admin/projects.vue | 4 | spacing, layout |
| components/DataTable.vue | 3 | a11y, responsive |
```

### Phase 3: 問題診斷

根據 Phase 2 的數據，診斷根因並分為三個層級：

#### 層級 A：規劃期缺陷（Propose 階段該攔住）

問題在 propose 階段就能預防，但 spec 沒有涵蓋。

**判定條件**：

- 同類別問題在 ≥ 3 個 change 中重複出現
- 問題屬於可預測類型（spacing、layout、typography、consistency）

**改善方向**：在 `spectra-propose` 的 design artifact 加入 checklist

#### 層級 B：實作期缺陷（Apply 階段該攔住）

問題在實作時應該被 skill 攔住，但沒有。

**判定條件**：

- 問題屬於 hardening 類型（a11y、responsive、hardening）
- 對應的 design skill 未被觸發（如該用 /impeccable harden 但沒用）

**改善方向**：調整 `proactive-skills.md` 的 skill 選擇指南或自動觸發條件

#### 層級 C：知識缺口（需要新規則）

問題反映開發者（包括 AI）缺乏某方面意識。

**判定條件**：

- 問題類型不屬於任何現有 `.claude/rules/` 的覆蓋範圍
- 或現有規則不夠具體

**改善方向**：建議新增或修改 `.claude/rules/` 規則

### Phase 4: 改善提案

根據 Phase 3 的診斷，產出具體且可執行的改善建議。

#### 輸出格式

```markdown
# Design Retro — YYYY-MM-DD

## 分析範圍

- 涵蓋 change: [change-1], [change-2], ...（共 N 個）
- 總 findings: M 筆

## 頻率摘要

[Phase 2.1 的表格]

## 診斷結果

### 需要行動的模式

#### 1. [類別] — [問題描述]

- **層級**: A / B / C
- **證據**: 在 [change-x], [change-y], [change-z] 中出現
- **根因**: [為什麼重複發生]
- **建議動作**:
  - [ ] [具體的改善行動，例如「在 spectra-propose 的 design artifact template 加入 spacing checklist」]
  - [ ] [第二個行動，若需要]
- **預期效果**: [實施後預期減少的問題量]

### 已改善的模式（正向回饋）

- [類別] 從 X% 降至 Y%（自從 [改善措施] 實施後）

### 暫不行動（觀察中）

- [類別]: 出現 N 次，尚未達行動門檻，持續觀察

## 建議優先序

1. [最高優先] — 影響範圍最大 / 嚴重度最高
2. ...
3. ...
```

### Phase 5: 使用者確認與執行

1. 將 Phase 4 的提案呈現給使用者
2. **逐項詢問**使用者是否同意執行（不自動執行）：
   - 同意 → 執行對應改動（修改 rules、更新 template、調整觸發條件）
   - 不同意 → 記錄原因，下次 retro 不再重複建議
   - 延後 → 保留，下次 retro 再提
3. 將使用者決策記錄到 `docs/design-review-findings.md` 尾部的 `## Retro 決策記錄` 區塊

### Phase 5 決策記錄格式

```markdown
## Retro 決策記錄

### YYYY-MM-DD

| #   | 建議                         | 決策   | 備註                            |
| --- | ---------------------------- | ------ | ------------------------------- |
| 1   | propose 加 spacing checklist | 同意   | 已更新 spectra-propose template |
| 2   | 強制觸發 /impeccable harden             | 延後   | 等累積更多數據                  |
| 3   | 新增 a11y rule               | 不同意 | 現有 /impeccable audit 已足夠              |
```

## 護欄

- **NEVER** 自動修改 `.claude/rules/` 或 skill 檔案 — 所有改動必須經使用者確認
- **NEVER** 刪除 findings 記錄 — 歷史資料是分析基礎
- 改善建議被使用者拒絕後，同一建議在後續 **3 次 retro** 內不再重複提出（除非有新證據）
- 若 findings 記錄不足 3 筆 change，只產出頻率摘要，不做診斷和建議（樣本太小）
