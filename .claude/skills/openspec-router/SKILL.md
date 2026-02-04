---
name: openspec-router
description: 根據用戶的需求描述，智能選擇最適合的 OpenSpec 工作流指令。
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: custom
  version: '1.0'
---

根據用戶描述，自動判斷並執行最適合的 OpenSpec 指令。

**Input**: 用戶的需求描述（可以是模糊的想法或具體的功能需求）

---

## Step 1: 收集輸入

如果用戶沒有提供描述，使用 **AskUserQuestion** 詢問：

> 你想做什麼？描述一下你的需求或想法。

---

## Step 2: 檢查現有 changes

```bash
openspec list --json 2>/dev/null
```

記錄是否有進行中的 changes，稍後判斷時會用到。

---

## Step 3: 分析需求特徵

根據用戶描述，評估以下維度：

### 清晰度（Clarity）

- **模糊**：「想改善效能」「不知道怎麼做比較好」「有個想法」
- **清楚**：「新增 X 功能」「修正 Y 問題」「把 A 改成 B」

### 規模（Scope）

- **小**：單一檔案、簡單修改、bug fix、加個欄位
- **中**：2-5 個檔案、新功能、需要設計
- **大**：跨多模組、架構調整、新系統

### 是否需要探索

- 用戶說「不確定」「怎麼做比較好」「有幾種方案」→ 需要探索
- 用戶說「要加」「要改」「要修」→ 不需要探索

---

## Step 4: 決策矩陣

| 清晰度 | 規模  | 現有 change | 推薦指令                          |
| ------ | ----- | ----------- | --------------------------------- |
| 模糊   | -     | -           | `/opsx:explore`                   |
| 清楚   | 小    | 無          | `/opsx:ff`                        |
| 清楚   | 中/大 | 無          | `/opsx:new`                       |
| -      | -     | 有相關的    | `/opsx:continue` 或 `/opsx:apply` |

### 特殊情況

- 如果用戶明確說「繼續」「接著做」→ `/opsx:continue`
- 如果用戶說「實作」「開始寫」且有 tasks.md → `/opsx:apply`
- 如果是第一次使用 OpenSpec → 建議 `/opsx:onboard`

---

## Step 5: 確認並執行

向用戶確認判斷結果：

```
## 分析結果

**你的需求**：[簡述用戶的描述]

**判斷**：
- 清晰度：[模糊/清楚]
- 規模：[小/中/大]
- 現有 change：[有/無]

**推薦**：`/opsx:XXX` - [簡短理由]

確認要執行嗎？
```

使用 **AskUserQuestion** 提供選項：

1. 執行推薦的指令（推薦）
2. 換成其他指令（列出替代選項）
3. 先不執行，我再想想

---

## Step 6: 執行對應指令

用戶確認後，調用對應的 skill：

- `/opsx:explore` → 使用 openspec-explore skill
- `/opsx:new` → 使用 openspec-new-change skill
- `/opsx:ff` → 使用 openspec-ff-change skill
- `/opsx:continue` → 使用 openspec-continue-change skill
- `/opsx:apply` → 使用 openspec-apply-change skill

將用戶原始描述傳遞給對應的 skill，讓它從這裡接手。

---

## Guardrails

- **永遠先確認**：不要直接執行，讓用戶確認判斷是否正確
- **解釋理由**：讓用戶理解為什麼推薦這個指令
- **允許覆寫**：用戶可以選擇不同的指令
- **傳遞上下文**：執行時要把用戶描述傳給下一個 skill
