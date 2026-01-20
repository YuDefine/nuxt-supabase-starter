# spec-kit 使用指南

> 用結構化的方式讓 AI 更好地理解你的需求

## 什麼是 spec-kit？

spec-kit 是一套「規格驅動開發」的工作流程，它把功能開發拆成幾個階段：

```
自然語言描述 → 結構化規格 → 實作計畫 → 任務清單 → 逐步執行
```

每個階段都有明確的產出（Markdown 文件），讓 AI 能更精準地理解你的需求，減少來回溝通的成本。

## 為什麼需要 spec-kit？

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
使用者：/speckit.specify
       我需要一個待辦事項功能...

AI：[產生 spec.md]
    - 功能需求
    - 使用者故事
    - 非功能需求
    - 邊界條件

使用者：（確認規格正確）

AI：[產生 plan.md]
    - 需要的資料庫結構
    - API 端點設計
    - 前端頁面規劃

使用者：（確認計畫正確）

AI：[產生 tasks.md + 逐步執行]
```

中間任何一步發現問題，都可以回頭修正，不用等到寫完程式碼才發現方向錯了。

---

## 命令一覽

| 命令 | 說明 | 輸入 | 輸出 |
|------|------|------|------|
| `/speckit.specify` | 從自然語言建立規格 | 功能描述 | `spec.md` |
| `/speckit.clarify` | 釐清規格中的模糊點 | 規格文件 | 更新的 `spec.md` |
| `/speckit.plan` | 從規格產生實作計畫 | `spec.md` | `plan.md` |
| `/speckit.tasks` | 從計畫產生任務清單 | `plan.md` | `tasks.md` |
| `/speckit.implement` | 執行任務清單 | `tasks.md` | 程式碼 |
| `/speckit.analyze` | 分析文件一致性 | 所有文件 | 分析報告 |
| `/speckit.checklist` | 產生檢查清單 | 規格文件 | 檢查清單 |
| `/speckit.constitution` | 設定專案原則 | - | `constitution.md` |
| `/speckit.taskstoissues` | 把任務轉成 GitHub Issues | `tasks.md` | GitHub Issues |

---

## 詳細說明

### /speckit.specify

從自然語言描述建立結構化的功能規格。

**使用時機**：
- 開始新功能時
- 收到 PM/客戶的需求時

**範例**：

```
/speckit.specify

我需要一個待辦事項功能：
- 使用者可以建立、查看、更新、刪除待辦事項
- 每個待辦事項有標題、描述、到期日、優先級
- 可以標記完成/未完成
- 使用者只能看到自己的待辦事項
- 支援依到期日或優先級排序
```

Claude 會產生類似這樣的 `spec.md`：

```markdown
# 功能規格：待辦事項管理

## 1. 概述
待辦事項管理功能讓使用者能夠追蹤和管理個人任務。

## 2. 使用者故事
- 作為使用者，我想要建立待辦事項，以便追蹤我需要完成的事
- 作為使用者，我想要設定到期日，以便知道什麼時候要完成
- ...

## 3. 功能需求
### 3.1 待辦事項 CRUD
- 建立：標題（必填）、描述（選填）、到期日（選填）、優先級（預設中）
- 讀取：列表顯示、詳情顯示
- 更新：所有欄位皆可更新
- 刪除：軟刪除或硬刪除

### 3.2 完成狀態
- 可標記為已完成/未完成
- 已完成的項目顯示刪除線

### 3.3 排序
- 依到期日排序（預設）
- 依優先級排序
- 依建立時間排序

## 4. 非功能需求
- 效能：列表載入 < 500ms
- 安全：使用者只能存取自己的資料（RLS）

## 5. 邊界條件
- 標題長度：1-200 字元
- 描述長度：0-2000 字元
- 優先級：高/中/低
```

### /speckit.clarify

當規格有模糊之處時，用來釐清細節。

**使用時機**：
- 規格不夠詳細
- 有多種可能的解讀

**範例**：

```
/speckit.clarify
```

Claude 會問你最多 5 個問題：

```
1. 到期日過了之後要如何顯示？
   - 顯示「已過期」標記
   - 自動移到「過期」分類
   - 什麼都不做

2. 刪除是軟刪除還是硬刪除？
   - 軟刪除（設定 deleted_at）
   - 硬刪除（真的刪掉）

3. ...
```

你的回答會被整合回 `spec.md`。

### /speckit.plan

從規格產生實作計畫。

**使用時機**：
- 規格已確認
- 準備開始設計架構

**範例**：

```
/speckit.plan
```

Claude 會產生 `plan.md`：

```markdown
# 實作計畫：待辦事項管理

## 1. 資料庫設計

### 1.1 表格結構
```sql
CREATE TABLE app.todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES core.user_roles(user_id),
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### 1.2 RLS 政策
- SELECT：使用者只能看自己的
- INSERT：使用者只能新增自己的
- UPDATE：使用者只能更新自己的
- DELETE：使用者只能刪除自己的
- Service role：完整存取

## 2. API 設計

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | /api/v1/todos | 取得列表 |
| GET | /api/v1/todos/:id | 取得單筆 |
| POST | /api/v1/todos | 新增 |
| PATCH | /api/v1/todos/:id | 更新 |
| DELETE | /api/v1/todos/:id | 刪除 |
| PATCH | /api/v1/todos/:id/toggle | 切換完成狀態 |

## 3. 前端設計

### 3.1 頁面結構
- `/todos` - 待辦事項列表頁
- `/todos/[id]` - 待辦事項詳情頁（可選）

### 3.2 元件
- `TodoList.vue` - 列表元件
- `TodoItem.vue` - 單項元件
- `TodoForm.vue` - 新增/編輯表單
- `TodoFilters.vue` - 篩選排序工具

## 4. 測試策略
- 單元測試：排序邏輯、驗證邏輯
- API 測試：CRUD 操作、RLS 驗證
- 元件測試：表單驗證、互動邏輯
```

### /speckit.tasks

從計畫產生可執行的任務清單。

**使用時機**：
- 計畫已確認
- 準備開始實作

**範例**：

```
/speckit.tasks
```

Claude 會產生 `tasks.md`：

```markdown
# 任務清單：待辦事項管理

## Phase 1: 資料庫

- [ ] 1.1 建立 migration: create_todos_table
  - 建立表格結構
  - 建立索引
  - 設定 RLS 政策

- [ ] 1.2 產生 TypeScript 類型
  - 執行 supabase gen types

## Phase 2: Server API

- [ ] 2.1 建立 GET /api/v1/todos
  - 支援分頁
  - 支援排序參數

- [ ] 2.2 建立 GET /api/v1/todos/:id

- [ ] 2.3 建立 POST /api/v1/todos
  - Zod 驗證
  - 寫入測試

- [ ] 2.4 建立 PATCH /api/v1/todos/:id
  - Zod 驗證
  - 寫入測試

- [ ] 2.5 建立 DELETE /api/v1/todos/:id

- [ ] 2.6 建立 PATCH /api/v1/todos/:id/toggle

## Phase 3: 前端

- [ ] 3.1 建立 TodoForm 元件
  - 驗證邏輯
  - 元件測試

- [ ] 3.2 建立 TodoItem 元件
  - 完成狀態切換
  - 刪除確認

- [ ] 3.3 建立 TodoList 元件
  - 排序功能
  - 空狀態

- [ ] 3.4 建立 /todos 頁面
  - 整合所有元件
  - 載入狀態

## Phase 4: 整合測試

- [ ] 4.1 E2E 測試
  - 完整 CRUD 流程
```

### /speckit.implement

逐步執行任務清單。

**使用時機**：
- 任務清單已準備好
- 開始動手寫程式碼

**範例**：

```
/speckit.implement
```

Claude 會：
1. 讀取 `tasks.md`
2. 依序執行每個任務
3. 使用 TDD 流程（先寫測試）
4. 更新任務狀態
5. 每完成一個階段詢問是否繼續
6. **全部完成後自動執行檢查**（調用 check-runner）
7. **檢查通過後詢問是否 commit**

**自動化流程**：

```
tasks.md → 逐步執行 → 全部完成
                          ↓
                    check-runner
                          ↓
                    全部通過？
                          ↓ Yes
                    詢問 commit
                          ↓ Yes
                      /commit
```

這個自動化流程確保：
- 實作完成後一定會跑完整檢查
- 不會忘記 commit
- 減少手動操作步驟

### /speckit.analyze

分析 spec、plan、tasks 之間的一致性。

**使用時機**：
- 修改了其中一份文件
- 想確認文件之間沒有矛盾

**範例**：

```
/speckit.analyze
```

Claude 會檢查：
- spec 中的需求是否都在 plan 中有對應的設計
- plan 中的設計是否都在 tasks 中有對應的任務
- 是否有遺漏或矛盾

### /speckit.constitution

設定專案的基本原則和限制。

**使用時機**：
- 專案初始化時
- 想要更新專案原則時

**範例**：

```
/speckit.constitution
```

Claude 會引導你設定：

```markdown
# Project Constitution

## Core Principles
1. 所有程式碼必須有測試覆蓋
2. API 設計遵循 RESTful 原則
3. 資料庫操作必須使用 Migration

## Complexity Limits
- 單一函式不超過 50 行
- 單一檔案不超過 300 行
- 最多 3 層巢狀

## Technology Constraints
- 僅使用 TailwindCSS，不寫自定義 CSS
- 使用 Composition API，禁止 Options API
- 使用 named exports
```

這些原則會在後續的 specify/plan/implement 過程中被參考。

---

## 目錄結構

spec-kit 相關的檔案都在 `.specify/` 目錄下：

```
.specify/
├── memory/
│   └── constitution.md      # 專案原則（需自行建立）
├── templates/
│   ├── spec-template.md     # 規格範本
│   ├── plan-template.md     # 計畫範本
│   ├── tasks-template.md    # 任務範本
│   ├── checklist-template.md
│   └── agent-file-template.md
└── scripts/bash/
    ├── common.sh
    ├── check-prerequisites.sh
    ├── create-new-feature.sh
    ├── setup-plan.sh
    └── update-agent-context.sh
```

產出的文件通常放在功能的目錄下：

```
features/
└── todos/
    ├── spec.md
    ├── plan.md
    └── tasks.md
```

---

## 最佳實踐

### 1. 規格要具體

**❌ 模糊**：
```
使用者可以管理待辦事項
```

**✅ 具體**：
```
使用者可以：
- 建立待辦事項（標題必填，描述選填）
- 設定到期日和優先級
- 標記完成/未完成
- 刪除待辦事項
```

### 2. 先 clarify 再 plan

如果規格有任何模糊之處，先用 `/speckit.clarify` 釐清。模糊的規格會產生模糊的計畫，最後寫出不符需求的程式碼。

### 3. 計畫要對齊規格

執行 `/speckit.plan` 後，檢查：
- 規格中的每個需求是否都有對應的設計？
- 有沒有多餘的設計（規格中沒提到的）？

### 4. 任務要可執行

好的任務是：
- 具體：「建立 POST /api/v1/todos API」而非「實作後端」
- 可驗證：知道什麼時候算「完成」
- 獨立：盡量減少任務之間的依賴

### 5. 善用 analyze

修改任何文件後，跑一次 `/speckit.analyze` 確認一致性。

---

## 常見問題

### Q: 規格要寫多詳細？

取決於功能的複雜度和你對 AI 輸出的容忍度：
- **簡單功能**：概述 + 主要需求即可
- **複雜功能**：詳細列出所有需求、邊界條件、錯誤處理

原則：寧可多寫，AI 會忽略不需要的部分；但如果少寫，AI 會自己假設（可能猜錯）。

### Q: constitution 要怎麼寫？

從你的專案規範（如 CLAUDE.md）中提取核心原則：
- 必須遵守的規則
- 禁止的做法
- 技術限制

### Q: 可以跳過某些步驟嗎？

可以，但不建議：
- 跳過 specify → AI 不清楚你要什麼
- 跳過 plan → 可能漏掉重要設計
- 跳過 tasks → 無法追蹤進度

對於非常簡單的功能，可以直接 specify → implement。

### Q: 文件放哪裡？

建議：
```
features/
└── [功能名稱]/
    ├── spec.md
    ├── plan.md
    └── tasks.md
```

或者直接放在功能相關的目錄下（如 `app/pages/todos/`）。

---

## 與 CLAUDE.md 的關係

- **CLAUDE.md**：定義整個專案的開發規範
- **constitution.md**：定義 spec-kit 工作流程的原則
- **spec/plan/tasks**：每個功能的具體文件

三者是層層遞進的關係，從通用到具體。
