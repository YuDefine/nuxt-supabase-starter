---
name: review-rules
description: 編輯審查規則清單（CRUD）。此 skill 只負責管理規則檔內容，不執行 code review。執行 code review 請用 /code-review:code-review。
---

# Review Rules — 規則清單管理

此 skill **只負責 CRUD**：新增、修改、刪除、列出 `.codex/agents/references/project-review-rules.md` 中的審查規則。

**不要混淆**：

- `/review-rules` → 編輯規則清單（本 skill）
- `/code-review:code-review` → 執行 code review（會自動載入本清單）

## 觸發時機

- 使用者說「加一條 review 規則」「新增審查規則」「review rule」
- 使用者說「列出 / 查看審查規則」
- 使用者說「刪除 / 移除某條規則」
- **不觸發**：使用者要求「review 這個 PR」「幫我 code review」→ 那是 `/code-review:code-review`

## 操作流程

### 新增規則

1. 讀取 `.codex/agents/references/project-review-rules.md`
2. 確認規則不重複
3. 判斷規則屬於哪個分類（元件替代、命名慣例、import 風格、其他）
   - 若分類不存在，新增 `## 分類名稱` section
4. 以 table row 或 checklist 格式加入規則
5. 每條規則 **MUST** 包含：
   - **禁止的寫法**（具體範例）
   - **正確的替代方案**
   - **簡短說明**（為什麼）
   - **例外條件**（如有）

### 列出規則

讀取並展示 `.codex/agents/references/project-review-rules.md` 的完整內容。

### 刪除規則

1. 讀取規則檔
2. 找到對應規則
3. 移除該行
4. 若 section 下已無規則，移除整個 section

## 規則格式範本

### Table 格式（元件替代類）

```markdown
| `<img>` | `<NuxtImg>` | 使用 Nuxt Image，支援自動最佳化。除非有 `<!-- raw-img -->` 註解。 |
```

### Checklist 格式（通用規則）

```markdown
- [ ] 描述規則內容 — **正確**: `範例` / **錯誤**: `範例`
```

## 注意事項

- 規則檔位置固定：`.codex/agents/references/project-review-rules.md`
- code-review agent 會在 Step 0 自動載入此檔案
- 違反規則預設為 🟠 Major，除非使用者指定其他嚴重程度
