# Spectra 使用指南

> 用結構化的方式讓 AI 更好地理解你的需求

## 什麼是 Spectra？

Spectra 是一套輕量級的「規格驅動開發」框架，專為現有專案設計。它把功能開發拆成三個階段：

```
變更提案 → 實作執行 → 歸檔完成
(proposal)  (apply)    (archive)
```

每個階段都有明確的產出（Markdown 檔案），讓 AI 能更精準地理解你的需求，減少來回溝通的成本。

## 為什麼需要 Spectra？

### 問題：直接讓 AI 寫程式碼

```
使用者：幫我做一個待辦事項功能

AI：好的，這是一個待辦事項的元件...
[產生一堆程式碼]

使用者：不對，我需要的是...
[來回修改 N 次]
```

### 解法：先定義清楚再動手

```
使用者：/spectra-propose
       我需要一個待辦事項功能...

AI：[產生 proposal.md]
    - 變更原因與範圍
    - 設計決策
    - 實作任務清單
    - 規格差異

使用者：（確認提案正確）

AI：/spectra-apply
    [逐步執行任務]
```

中間任何一步發現問題，都可以回頭修正，不用等到寫完程式碼才發現方向錯了。

---

## 命令一覽

| 命令               | 說明                 | 輸入     | 輸出                             |
| ------------------ | -------------------- | -------- | -------------------------------- |
| `/spectra-propose` | 建立變更提案         | 功能描述 | proposal.md, design.md, tasks.md |
| `/spectra-apply`   | 執行任務             | 變更名稱 | 程式碼                           |
| `/spectra-archive` | 歸檔完成的變更       | 變更名稱 | 移動到 archive/ + 合併 specs     |
| `/spectra-discuss` | 聚焦討論並達成結論   | -        | 討論記錄                         |
| `/spectra-ask`     | 查詢規格文件         | 問題     | 回答                             |
| `/spectra-ingest`  | 從外部上下文更新變更 | 變更名稱 | 更新後的 artifacts               |
| `/spectra-debug`   | 系統化除錯           | 問題描述 | 除錯報告                         |
| `/spectra-tdd`     | 依 TDD 流程實作      | 功能描述 | 測試 + 程式碼                    |
| `/spectra-analyze` | 分析現有程式碼       | -        | 分析報告                         |
| `/spectra-clarify` | 釐清需求             | -        | 釐清結果                         |
| `/spectra-sync`    | 同步規格             | 變更名稱 | 更新後的 specs                   |
| `/spectra-verify`  | 驗證實作             | 變更名稱 | 驗證報告                         |

---

## 核心工作流程

### 1. /spectra-propose - 建立變更提案

從自然語言描述建立結構化的變更提案。

**使用時機**：

- 開始新功能時
- 收到 PM/客戶的需求時

**範例**：

```
/spectra-propose

我需要一個待辦事項功能：
- 使用者可以建立、查看、更新、刪除待辦事項
- 每個待辦事項有標題、描述、到期日、優先級
- 可以標記完成/未完成
- 使用者只能看到自己的待辦事項
```

Claude 會在 `openspec/changes/add-todos/` 建立：

```
openspec/changes/add-todos/
├── proposal.md      # 變更提案（原因、範圍、影響）
├── design.md        # 設計決策
├── tasks.md         # 實作任務清單
└── specs/           # Delta specs（規格差異）
    └── todos/
        └── spec.md
```

### 2. /spectra-apply - 執行實作

逐步執行任務清單中的任務。

**使用時機**：

- 提案已確認
- 準備開始寫程式碼

**範例**：

```
/spectra-apply add-todos
```

Claude 會：

1. 讀取 `tasks.md`
2. 依序執行每個任務
3. 使用 TDD 流程（先寫測試）
4. 更新任務狀態
5. 每完成一個階段詢問是否繼續

### 3. /spectra-archive - 歸檔變更

將完成的變更歸檔，並將 delta specs 合併到主 specs。

**使用時機**：

- 所有任務已完成
- 程式碼已通過測試
- 準備將變更正式納入系統

**範例**：

```
/spectra-archive add-todos
```

Claude 會：

1. 檢查任務完成狀態
2. 將 delta specs 合併到 `openspec/specs/`
3. 將變更目錄移動到 `openspec/changes/archive/YYYY-MM-DD-add-todos/`

---

## 目錄結構

Spectra 相關的檔案都在 `openspec/` 目錄下：

```
openspec/
├── project.md              # 專案上下文（技術棧、慣例）
├── specs/                  # 系統規格（真相來源）
│   └── <capability>/
│       └── spec.md
└── changes/                # 變更提案區
    ├── <change-name>/      # 進行中的變更
    │   ├── proposal.md
    │   ├── design.md
    │   ├── tasks.md
    │   └── specs/          # Delta specs
    └── archive/            # 已完成的變更歷史
        └── YYYY-MM-DD-<name>/
```

### specs/ vs changes/

- **specs/**：代表系統的「現狀」，是所有功能的真相來源
- **changes/**：代表「進行中的變更」，完成後會合併回 specs/

這種分離設計讓你能清楚追蹤：

- 系統目前有什麼功能（看 specs/）
- 正在開發什麼功能（看 changes/）
- 過去做過什麼變更（看 changes/archive/）

---

## 規格格式

### 使用規範語言

- **SHALL/MUST**：表示強制要求
- **SHOULD**：表示建議
- **MAY**：表示可選

### Scenario 格式

使用 GIVEN-WHEN-THEN 描述情境：

```markdown
### Requirement: User Authentication

The system SHALL authenticate users via OAuth.

#### Scenario: Successful login

- **GIVEN** a user with valid Google credentials
- **WHEN** the user clicks "Sign in with Google"
- **THEN** the system creates a session
- **AND** redirects to the dashboard
```

### Delta 格式

變更中的規格差異使用 ADDED/MODIFIED/REMOVED 標記：

```markdown
## ADDED Requirements

### Requirement: Todo Management

The system SHALL allow users to create todo items.

## MODIFIED Requirements

### Requirement: User Dashboard

（完整修改後的內容）

## REMOVED Requirements

### Requirement: Legacy Feature

（已移除的功能）
```

---

## 最佳實踐

### 1. 提案要具體

**模糊**：

```
使用者可以管理待辦事項
```

**具體**：

```
使用者可以：
- 建立待辦事項（標題必填，描述選填）
- 設定到期日和優先級
- 標記完成/未完成
- 刪除待辦事項
```

### 2. 先討論再提案

如果需求不明確，使用 `/spectra-discuss` 先釐清：

```
/spectra-discuss

我想改善使用者體驗，但不確定從哪裡開始...
```

### 3. 善用 verify

實作完成後，用 `/spectra-verify` 確認符合規格：

```
/spectra-verify add-todos
```

### 4. 小步快跑

將大功能拆成多個小變更，每個變更獨立可交付：

```
add-todos-basic      # 基本 CRUD
add-todos-priority   # 優先級功能
add-todos-due-date   # 到期日功能
```

---

## 與 Plan Mode 的差異

| 面向         | Spectra                                   | Plan Mode      |
| ------------ | ----------------------------------------- | -------------- |
| **流程**     | 多 artifact（proposal → apply → archive） | 單一規劃階段   |
| **成果**     | proposal.md, design.md, tasks.md, specs/  | 單一 plan 檔案 |
| **規格管理** | specs/ 作為真相來源，delta 追蹤           | 無             |
| **歸檔機制** | 完整歷史保留                              | 無             |
| **適用場景** | 複雜功能、需要規格追蹤                    | 簡單修改       |

**選擇指南**：

| 情境                       | 推薦      |
| -------------------------- | --------- |
| 功能需要 **3+ 個檔案變更** | Spectra   |
| 需要**追蹤規格演進**       | Spectra   |
| 需要**多人審閱**計畫       | Spectra   |
| **Bug 修復**、單檔變更     | Plan Mode |
| **緊急部署**、時間緊迫     | 直接實作  |

---

## 常見問題

### Q: 規格要寫多詳細？

取決於功能的複雜度：

- **簡單功能**：概述 + 主要 requirements 即可
- **複雜功能**：詳細列出所有 requirements、scenarios、edge cases

原則：寧可多寫，AI 會忽略不需要的部分；但如果少寫，AI 會自己假設（可能猜錯）。

### Q: 不需要提案的情況？

以下情況可以直接實作，不需要建立提案：

- Bug 修復
- 修正錯字
- 更新依賴（非破壞性）
- 調整設定

---

## 相關資源

- [project.md](../openspec/project.md) - 本專案的技術上下文
