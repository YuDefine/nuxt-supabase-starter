# 開發工作流程指南

> 為什麼這套工作流程能讓你更快完成複雜系統？

## 概覽

這套工作流程的核心理念是：**把重複性高的工作交給 AI，把需要判斷力的工作留給人腦。**

```
功能規格 → 實作計畫 → 任務清單 → TDD 開發 → 自動檢查 → 提交
    ↓           ↓           ↓          ↓           ↓
spec.md    plan.md     tasks.md    Red/Green   pnpm check
```

每個階段都有明確的產出，讓 AI 能更精準地理解你的需求。

---

## TDD（測試驅動開發）

### 為什麼 TDD 在 AI 輔助開發中特別重要？

傳統開發中，TDD 被認為是「好習慣但很花時間」。但在 AI 輔助開發中，TDD 變成了**必要的驗收機制**。

想像這個場景：

- 你讓 AI 幫你寫一個排序函式
- AI 給你一段程式碼
- 你怎麼知道這段程式碼是對的？

如果沒有測試，你要手動驗證。如果有測試，跑一次就知道。

**測試 = AI 程式碼的品質保證。**

### TDD 流程

```
1. Red    → 先寫測試（會失敗）
2. Green  → 寫最少的程式碼讓測試通過
3. Refactor → 改善程式碼品質（測試維持綠燈）
```

#### 1. Red：先寫測試

```typescript
// test/unit/utils/sort.test.ts
import { describe, it, expect } from "vitest";
import { sortByDate } from "~/utils/sort";

describe("sortByDate", () => {
  it("should sort items by date in descending order", () => {
    const items = [
      { id: 1, date: new Date("2024-01-01") },
      { id: 2, date: new Date("2024-03-01") },
      { id: 3, date: new Date("2024-02-01") },
    ];

    const result = sortByDate(items);

    expect(result.map((i) => i.id)).toEqual([2, 3, 1]);
  });

  it("should handle empty array", () => {
    expect(sortByDate([])).toEqual([]);
  });

  it("should handle single item", () => {
    const items = [{ id: 1, date: new Date("2024-01-01") }];
    expect(sortByDate(items)).toEqual(items);
  });
});
```

這時候測試會失敗，因為 `sortByDate` 還不存在。這就是「Red」。

#### 2. Green：寫最小實作

```typescript
// app/utils/sort.ts
interface Dateable {
  date: Date;
}

export function sortByDate<T extends Dateable>(items: T[]): T[] {
  return [...items].sort((a, b) => b.date.getTime() - a.date.getTime());
}
```

跑測試，通過了。這就是「Green」。

#### 3. Refactor：改善程式碼

現在測試是綠燈，你可以放心重構。比如加上更多的類型安全：

```typescript
// app/utils/sort.ts
interface Dateable {
  date: Date;
}

export function sortByDate<T extends Dateable>(
  items: readonly T[],
  order: "asc" | "desc" = "desc",
): T[] {
  const multiplier = order === "desc" ? -1 : 1;
  return [...items].sort((a, b) => multiplier * (a.date.getTime() - b.date.getTime()));
}
```

重構後再跑測試，確保還是綠燈。

### 在 Claude Code 中使用 TDD

使用 `/tdd` 命令，Claude 會自動遵循這個流程：

```
使用者：幫我寫一個計算訂單總價的函式

Claude：好的，讓我先寫測試案例...
[寫測試]
[執行測試，確認失敗]
[寫最小實作]
[執行測試，確認通過]
[詢問是否需要重構]
```

---

## 自動化檢查

### 為什麼需要自動化檢查？

人會忘記、會偷懶。自動化檢查確保每次提交的程式碼都符合品質標準。

### pnpm check

這個命令會依序執行：

```bash
pnpm check
# 相當於：
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

| 步驟        | 說明                | 失敗時     |
| ----------- | ------------------- | ---------- |
| `format`    | 程式碼格式化        | 自動修復   |
| `lint`      | 程式碼品質檢查      | 需手動修復 |
| `typecheck` | TypeScript 類型檢查 | 需手動修復 |
| `test`      | 執行測試            | 需手動修復 |

### 在 Claude Code 中的自動執行

CLAUDE.md 中有定義，Claude 會在完成實作後自動執行 `pnpm check`：

```
完成實作
    ↓
自動執行 pnpm check
    ↓
失敗 → 自動修復 → 重試
    ↓
全部通過
    ↓
詢問是否 commit
```

---

## Git Commit 規範

### Commit Message 格式

```
<emoji type>: <description>

[optional body]

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Emoji Types

| Emoji | Type     | 說明     | 範例                             |
| ----- | -------- | -------- | -------------------------------- |
| ✨    | feat     | 新功能   | `✨ feat: 加入使用者登入功能`    |
| 🐛    | fix      | 錯誤修正 | `🐛 fix: 修正日期排序問題`       |
| 🔨    | refactor | 重構     | `🔨 refactor: 簡化排序邏輯`      |
| 🧪    | test     | 測試     | `🧪 test: 加入排序函式測試`      |
| 📝    | docs     | 文件     | `📝 docs: 更新 API 文件`         |
| 🧹    | chore    | 維護     | `🧹 chore: 更新依賴`             |
| 🎨    | style    | 樣式     | `🎨 style: 調整按鈕顏色`         |
| 📦    | build    | 建置     | `📦 build: 修改 Cloudflare 配置` |
| 👷    | ci       | CI/CD    | `👷 ci: 加入 GitHub Actions`     |
| ⏪    | revert   | 還原     | `⏪ revert: 還原上次修改`        |
| 🚀    | deploy   | 部署     | `🚀 deploy: 發布 v1.0.0`         |
| 🎉    | init     | 初始化   | `🎉 init: 專案初始化`            |

### 功能分組 Commit

當你完成一個功能，可能會有多個檔案變更。建議依照邏輯分組 commit：

```bash
# 分組 1：資料庫變更
git add supabase/migrations/
git commit -m "✨ feat(db): 建立 todos 資料表"

# 分組 2：Server API
git add server/api/v1/todos/
git commit -m "✨ feat(api): 實作 todos CRUD API"

# 分組 3：前端頁面
git add app/pages/todos/ app/components/todos/
git commit -m "✨ feat(ui): 實作 todos 管理頁面"

# 分組 4：測試
git add test/unit/todos/
git commit -m "🧪 test: 加入 todos 相關測試"
```

### 使用 /commit 命令

Claude Code 的 `/commit` 命令會自動：

1. 分析變更內容
2. 建議分組方式
3. 產生符合規範的 commit message
4. 逐一建立 commit

---

## 資料庫變更工作流程

### Migration 工作流程

```
設計 → 建立 → 測試 → 類型產生 → 驗證 → 推送
```

#### 1. 設計

先想清楚：

- 需要什麼表格？
- 欄位有哪些？類型是什麼？
- 需要什麼索引？
- RLS 政策怎麼設計？

#### 2. 建立 Migration

```bash
supabase migration new create_todos_table
```

#### 3. 編輯 SQL

```sql
-- supabase/migrations/20240101000000_create_todos_table.sql

CREATE TABLE app.todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE app.todos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own todos"
  ON app.todos FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- ... 其他 policy
```

#### 4. 本地測試

```bash
supabase db reset
supabase db lint --level warning
```

#### 5. 產生 TypeScript 類型

```bash
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null
```

#### 6. 驗證程式碼

```bash
pnpm typecheck
```

#### 7. 推送到線上

```bash
supabase db push
```

### 使用 /db-migration 命令

Claude Code 的 `/db-migration` 命令會引導你完成整個流程，包括：

- 建立符合安全規範的 migration
- 自動設定 `search_path = ''`
- 產生標準的 RLS 政策
- 執行驗證步驟

---

## 文件同步

### docs/verify/ 目錄

這個目錄用來記錄「專案當前的狀態」，而非變更歷史。

**撰寫原則**：

- 使用現在式
- 不要加時間標記
- 直接覆寫舊內容（Git 已記錄歷史）

**常見文件**：
| 文件 | 內容 |
|------|------|
| AUTH_INTEGRATION.md | 認證系統的配置與用法 |
| ENVIRONMENT_VARIABLES.md | 環境變數說明 |
| API_DESIGN_GUIDE.md | API 設計模式 |
| PINIA_ARCHITECTURE.md | 狀態管理架構 |

### 使用 /doc-sync 命令

當你修改了相關功能，`/doc-sync` 會自動更新對應的文件。

---

## 完整開發流程範例

假設你要開發一個「待辦事項」功能：

### 1. 使用 spec-kit 定義規格

```bash
/speckit.specify
```

描述：「使用者可以建立、查看、更新、刪除待辦事項。每個待辦事項有標題、描述、完成狀態。使用者只能看到自己的待辦事項。」

Claude 會產生 `spec.md`。

### 2. 產生實作計畫

```bash
/speckit.plan
```

Claude 會根據規格產生 `plan.md`，列出需要的：

- 資料庫表格
- API 端點
- 前端頁面
- 測試案例

### 3. 產生任務清單

```bash
/speckit.tasks
```

Claude 會產生 `tasks.md`，把計畫拆成可執行的任務。

### 4. 執行任務

```bash
/speckit.implement
```

Claude 會逐一執行任務，使用 TDD 流程。

### 5. 自動檢查與提交

完成後，Claude 會：

1. 執行 `pnpm check`
2. 詢問是否 commit
3. 依功能分組 commit

---

## 自動化流程

本範本的 Skills 會自動串接，減少手動操作。

### Skills 之間的自動串接

| Skill                | 完成後自動                      | 條件           |
| -------------------- | ------------------------------- | -------------- |
| `/tdd`               | 調用 check-runner               | 測試通過後     |
| `/tdd`               | 詢問是否 commit                 | check 通過後   |
| `/commit`            | **先**調用 check-runner         | 開始前強制     |
| `/db-migration`      | 產生 TypeScript 類型            | 測試通過後     |
| `/speckit.implement` | 調用 check-runner + 詢問 commit | 所有任務完成後 |

### SubAgents

| Agent            | 用途                      | 觸發時機               |
| ---------------- | ------------------------- | ---------------------- |
| `check-runner`   | 執行 pnpm check           | 被多個 Skills 自動調用 |
| `post-implement` | 標準化檢查+commit 流程    | 實作完成後             |
| `db-backup`      | 備份資料庫並更新 seed.sql | 手動                   |

### 自動流程示意

```
開發功能
    ↓
/tdd（或直接實作）
    ↓
完成 → check-runner 自動執行
    ↓
全部通過？
    ↓ Yes
詢問：要 commit 嗎？
    ↓ Yes
/commit（再次確認 check-runner）
    ↓
分析變更 → 分組 commit
```

### 為什麼要自動串接？

1. **避免遺漏**：不用記住每次都要跑 check
2. **強制品質**：commit 前必須通過檢查
3. **減少手動操作**：一個流程自動完成多個步驟
4. **標準化**：團隊成員都遵循相同流程

---

## 效率指標參考

使用這套工作流程的實際效率參考：

| 任務類型         | 傳統做法 | AI 輔助    | 加速比 |
| ---------------- | -------- | ---------- | ------ |
| CRUD API（一組） | 2-3 小時 | 30-60 分鐘 | 3-5x   |
| 資料庫 Migration | 1-2 小時 | 20-40 分鐘 | 3x     |
| 前端頁面         | 3-4 小時 | 1-2 小時   | 2-3x   |
| 測試撰寫         | 1-2 小時 | 30-60 分鐘 | 2-3x   |
| 文件撰寫         | 1 小時   | 10-20 分鐘 | 4-6x   |

**注意**：這些數字假設你已經熟悉這套工作流程。剛開始使用時會有學習曲線。

---

## 常見陷阱

### 1. 跳過測試

「這個功能很簡單，不需要測試」→ 後來發現有 bug，但沒有測試，不知道改了會不會壞其他東西。

**解法**：所有功能都要有測試，即使是「簡單」的功能。

### 2. 直接改線上資料庫

「這個小改動，直接在 Dashboard 改就好」→ 本地和線上資料庫結構不同步，下次 deploy 出問題。

**解法**：所有資料庫變更都走 migration。

### 3. 忽略 lint/typecheck 錯誤

「這個警告不重要」→ 警告累積，到後來真的有問題時被淹沒在一堆警告中。

**解法**：`pnpm check` 必須零錯誤零警告才能 commit。

### 4. 一次 commit 太多東西

「先做完再一起 commit」→ 需要 revert 時，只能全部還原。

**解法**：依功能分組 commit，每個 commit 都是一個完整的邏輯單元。
