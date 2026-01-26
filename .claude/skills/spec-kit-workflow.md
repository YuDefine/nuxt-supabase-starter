# Spec Kit 工作流程

當使用者要開始規劃中大型新功能、新模組、或重構既有功能時，自動載入此規範。

---

## 適用場景判斷

| 變更類型         | 是否使用 Spec Kit        |
| ---------------- | ------------------------ |
| Bug 修復、小調整 | ❌ 不需要，直接改        |
| 簡單 CRUD 頁面   | ❌ 不需要，overhead 太大 |
| 中型新功能       | ✅ 建議使用              |
| 大型新模組       | ✅ 強烈建議              |
| 重構既有功能     | ✅ 建議使用              |

如果不確定，問使用者：「這個功能需要用 Spec Kit 規劃嗎？」

---

## 核心流程

```
Constitution → Specify → Plan → Tasks → Implement
     │            │        │       │         │
   專案原則    功能規格   技術計畫  任務拆解    實作
  （已建立）  （每次功能）
```

---

## Step 1: 確認 Constitution 存在

檢查 `.specify/memory/constitution.md` 是否已建立：

```bash
# 如果不存在或內容是模板，需先建立
/speckit.constitution
```

使用前請先確認 Constitution 是否已建立。

---

## Step 2: 建立功能規格目錄

```bash
mkdir -p .specify/specs/YYYY-MM-feature-name/
```

命名規則：`YYYY-MM-<feature-name>`，例如：

- `2026-01-consumables-expenses`
- `2026-02-tool-lifecycle`

---

## Step 3: 撰寫 spec.md

**專注 What 和 Why，不講技術細節**

必要區塊：

1. **User Scenarios & Testing** — 使用者故事（P1/P2/P3 優先序）
2. **Requirements** — 功能需求（FR-001, FR-002...）
3. **Key Entities** — 主要資料實體
4. **Success Criteria** — 可量測的成功標準

模板位置：`.specify/templates/spec-template.md`

---

## Step 4: 撰寫 plan.md

**技術計畫，講 How**

必要區塊：

1. **Summary** — 簡短摘要
2. **Technical Context** — 技術棧、限制
3. **Constitution Check** — 驗證符合專案原則
4. **Project Structure** — 檔案結構
5. **Database Design** — 表格設計、RLS 政策
6. **API Design** — API 端點設計
7. **UI Design** — 頁面和組件設計

模板位置：`.specify/templates/plan-template.md`

---

## Step 5: 撰寫 tasks.md

**可執行的任務清單**

格式：`[ID] [P?] [Story] Description`

- `[P]` — 可平行執行
- `[Story]` — 對應的 User Story (US1, US2...)

結構：

1. **Phase 1: Setup** — 基礎建設（DB、Types）
2. **Phase 2-N: User Stories** — 依優先序實作
3. **Final Phase: Polish** — 整合、測試

模板位置：`.specify/templates/tasks-template.md`

---

## 檔案結構範例

```
.specify/
├── memory/
│   └── constitution.md              # 專案原則（已建立）
│
└── specs/
    └── 2026-01-consumables-expenses/
        ├── spec.md                  # 功能規格
        ├── plan.md                  # 技術計畫
        └── tasks.md                 # 任務清單
```

---

## 快速開始指令

如果使用者提供完整需求描述，可依序執行：

```
/speckit.specify    # 建立 spec.md
/speckit.plan       # 建立 plan.md
/speckit.tasks      # 建立 tasks.md
/speckit.implement  # 開始實作
```

如果需要釐清需求：

```
/speckit.clarify    # 提出澄清問題
```

---

## 手動遷移草稿

如果使用者已有草稿文件，遷移步驟：

1. 讀取草稿內容
2. 建立 specs 目錄
3. 拆分內容到 spec.md（What/Why）、plan.md（How）、tasks.md（任務）
4. 刪除原草稿

---

## 多圈迭代

### 全新功能

Constitution 不動，重新跑一圈 Specify → Plan → Tasks → Implement。

### 擴充既有功能

在 spec.md 說明要基於哪個現有模組擴充：

```markdown
在現有的 [模組名稱] 基礎上，新增 [功能]：

- [需求描述]
- 需要整合現有的 [路徑/模組]
```

### 重構既有功能

在 spec.md 描述現狀與目標：

```markdown
重構現有的 [模組名稱]：

- 現狀：[問題描述]
- 目標：[期望結果]
- 限制：[相容性要求等]
```

---

## 重要提醒

1. **每個步驟產出後都要人工 review**，確保 AI 理解正確
2. **Specify 專注 What/Why**，Plan 才講 How
3. **Constitution 是長期文件**，不要每次都改
4. **小改動不需要 Spec Kit**，overhead 不划算
5. **保留每次迭代的 spec 文件**，方便日後參考

---

## 檢查清單

開始新功能前確認：

- [ ] Constitution 已建立且內容正確
- [ ] 功能目錄已建立 `.specify/specs/YYYY-MM-feature-name/`
- [ ] spec.md 包含所有 User Stories 和優先序
- [ ] plan.md 通過 Constitution Check
- [ ] tasks.md 任務清單可執行且有明確依賴關係
