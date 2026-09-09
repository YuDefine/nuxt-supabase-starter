---
name: specformula-feature
description: 當要撰寫或修改 .feature 檔案時載入此規格
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/specformula-feature/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- LOCKED: mirrored from SpecFormula/specformula-dev-framework@e5568250a2c0599983bce90fb08d548da35e1d64 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->

# SpecFormula Feature 撰寫指南

SpecFormula 的 `.feature` 檔案使用 Gherkin DSL 搭配 ISA 指令與符號系統，以宣告式語法定義 BDD 測試。每個指令的 Gherkin 語法由 `isa.yml` 的 `instructions[].format` 正則表達式定義，撰寫前請先查看專案的 `isa.yml` 確認實際格式。

## 撰寫 SOP

### 新增 Feature

規劃新功能的完整測試檔案，依照 Step 1 → Step 2 → Step 3 流程撰寫所有 Scenario。

### 新增 Scenario

在現有 `.feature` 檔案中新增測試場景，依照 Step 1 → Step 2 → Step 3 流程撰寫。

### 新增 Step

在現有 Scenario 中新增步驟，根據步驟類型（Given / When / Then）參考對應的決策樹。

#### Step 1：前置條件（Given）

根據測試場景需要的初始狀態，判斷需要哪些前置條件：

- 測試涉及時間相關欄位（如 `createdAt`、`updatedAt`）？→ TimeControl（讀取 `time-control.md`）
- 測試需要模擬時間推移？→ 多次 TimeControl（讀取 `time-control.md`）
- 需要準備資料？→ EntitySetup（讀取 `entity-setup.md`）
- 需要前置 API 流程？→ ApiCall（讀取 `api-call.md`）
- 需要自訂步驟？→ Custom（讀取 `custom.md`）

```gherkin
Background:
  # 1. 固定時間
  Given 現在時間為 "2026-01-27T10:00:00"
  # 2. 直接插入資料庫
  Given 準備一個使用者, with table:
    | >Alice.id | name  | email             | passwordHash | status |
    | <userId   | Alice | alice@example.com | password123  | ACTIVE |
```

#### Step 2：事件（When）

- 執行 HTTP API 請求？→ ApiCall（讀取 `api-call.md`）
- 需要自訂步驟？→ Custom（讀取 `custom.md`）

```gherkin
  # 前置 API（取得 Token）
  When (No Actor) 使用者登入, call table:
    | >AliceToken | email             | password    |
    | <token      | alice@example.com | password123 |
  # 被測試的 API
  When (UID="$Alice.id") 新增待辦事項, call table:
    | >todo1.id | title  | description |
    | <todoId   | 買牛奶 | 去全聯買    |
```

#### Step 3：後置條件驗證（Then）

驗證事件執行後的結果：

- 驗證 API 狀態碼與回應內容？→ ResponseValidate（讀取 `response-validate.md`）
- 需要存在特定資料？→ EntityValidate（讀取 `entity-validate.md`）
- 需要不存在特定資料？→ EntityNonExistenceValidate（讀取 `entity-non-existence-validate.md`）
- 需要自訂步驟？→ Custom（讀取 `custom.md`）

```gherkin
  # 1. 回應驗證
  Then 新增待辦事項(201)回應, with table:
    | todoId    | userId    | title  | completed |
    | $todo1.id | $Alice.id | 買牛奶 | false     |
  # 2. 資料庫狀態驗證
  And 應該存在一個待辦事項, with table:
    | todoId    | userId    | title  | completed | createdAt                        |
    | $todo1.id | $Alice.id | 買牛奶 | false     | &sameTime("2026-01-27T10:00:00") |
```

### 修改 Feature / Scenario / Step

修改現有的 `.feature` 檔案時，依照以下流程：

1. 先讀取目標 `.feature` 檔案，了解現有的 Scenario 結構
2. 讀取 `isa.yml` 確認指令格式
3. 根據要修改的 Step 類型，讀取對應的指令文檔：
   - TimeControl → 讀取 `time-control.md`
   - EntitySetup → 讀取 `entity-setup.md`
   - ApiCall → 讀取 `api-call.md`
   - ResponseValidate → 讀取 `response-validate.md`
   - EntityValidate → 讀取 `entity-validate.md`
   - EntityNonExistenceValidate → 讀取 `entity-non-existence-validate.md`
   - Custom → 讀取 `custom.md`
4. 依照對應指令文檔的 SOP 修改 Step