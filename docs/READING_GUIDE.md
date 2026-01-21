# 文件導讀指南

本專案包含約 54 個結構化文件，本指南幫助你快速找到所需資訊。

---

## 文件分類

### 給人類開發者

| 層級        | 目的     | 文件                                                                                                   | 何時閱讀           |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------ | ------------------ |
| **L1 入門** | 快速開始 | [README.md](../README.md), [QUICK_START.md](QUICK_START.md)                                            | 第一次使用         |
| **L2 指南** | 深入學習 | [WORKFLOW.md](WORKFLOW.md), [SUPABASE_GUIDE.md](SUPABASE_GUIDE.md), [API_PATTERNS.md](API_PATTERNS.md) | 開始開發時         |
| **L3 狀態** | 查閱參考 | [docs/verify/\*](verify/README.md)                                                                     | 需要確認系統狀態時 |

### 給 Claude/AI

| 類型     | 用途                               | 位置                        |
| -------- | ---------------------------------- | --------------------------- |
| 總規範   | 開發規則                           | [CLAUDE.md](../CLAUDE.md)   |
| Commands | 可執行命令（`/commit`, `/tdd` 等） | `.claude/commands/*.md`     |
| Agents   | 自動化流程（check-runner 等）      | `.claude/agents/*.md`       |
| Skills   | 專業知識（17 個）                  | `.claude/skills/*/SKILL.md` |

---

## 閱讀路徑

### 新人入門

**目標**：了解專案全貌，能夠開始開發

```
README.md（5 分鐘）
    ↓ 了解 Tech Stack 與專案目標
QUICK_START.md（15 分鐘）
    ↓ 完成環境設定
WORKFLOW.md（10 分鐘）
    ↓ 了解 TDD 開發流程
```

### 開始開發

**目標**：熟悉開發規範與工具

```
CLAUDE.md（20 分鐘）
    ↓ 了解 Standards 與自動化規則
SUPABASE_GUIDE.md（15 分鐘）
    ↓ 了解資料庫操作
API_PATTERNS.md（10 分鐘）
    ↓ 了解 Server API 設計
```

### 進階主題（按需閱讀）

| 主題           | 文件                                                                          |
| -------------- | ----------------------------------------------------------------------------- |
| 認證系統       | [docs/verify/AUTH_INTEGRATION.md](verify/AUTH_INTEGRATION.md)                 |
| Migration 操作 | [docs/verify/SUPABASE_MIGRATION_GUIDE.md](verify/SUPABASE_MIGRATION_GUIDE.md) |
| RLS 設計       | [docs/verify/RLS_BEST_PRACTICES.md](verify/RLS_BEST_PRACTICES.md)             |
| Pinia 架構     | [docs/verify/PINIA_ARCHITECTURE.md](verify/PINIA_ARCHITECTURE.md)             |
| 資料庫效能     | [docs/verify/DATABASE_OPTIMIZATION.md](verify/DATABASE_OPTIMIZATION.md)       |

### AI 協作（給想深入了解 Claude 配置的人）

```
CLAUDE.md → AI Skills 區塊
    ↓ 了解 Skills 分類與觸發機制
CLAUDE_CODE_GUIDE.md
    ↓ 了解 Claude Code 配置
SPEC_KIT.md
    ↓ 了解 Spec-Kit 工作流程
```

---

## 文件關係圖

```
┌─────────────────────────────────────────────────────────────────┐
│                        README.md（入口）                         │
└─────────────────────────────────────────────────────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  QUICK_START.md │   │   WORKFLOW.md   │   │   CLAUDE.md     │
│  （如何開始）    │   │  （開發流程）    │   │  （AI 規範）     │
└─────────────────┘   └─────────────────┘   └─────────────────┘
          │                     │                     │
          ▼                     ▼                     ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ SUPABASE_GUIDE  │   │  API_PATTERNS   │   │  SPEC_KIT.md    │
│ SUPABASE_MCP    │   │                 │   │  CLAUDE_CODE    │
└─────────────────┘   └─────────────────┘   └─────────────────┘
          │                     │                     │
          └─────────────────────┼─────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     docs/verify/（系統狀態）                     │
│  AUTH_INTEGRATION | API_DESIGN_GUIDE | SUPABASE_MIGRATION_GUIDE │
│  RLS_BEST_PRACTICES | PINIA_ARCHITECTURE | DATABASE_OPTIMIZATION│
└─────────────────────────────────────────────────────────────────┘
```

---

## 文件層次說明

### L1 入門文件

快速參考、操作步驟為主。

- **README.md**：專案概覽、Tech Stack、成效展示
- **QUICK_START.md**：安裝、設定、第一次執行

### L2 指南文件

深入說明、最佳實踐。

- **WORKFLOW.md**：TDD 流程、Spec-Kit、自動化
- **SUPABASE_GUIDE.md**：Supabase 入門、RLS、Migration
- **API_PATTERNS.md**：Server API 設計模式

### L3 狀態文件（docs/verify/）

系統當前狀態的**單一事實來源**。

- 使用**現在式**描述
- 直接覆寫，不保留歷史
- 與其他文件的關係：
  - QUICK_START → 教你「**怎麼做**」
  - docs/verify/ → 告訴你「**現在是什麼**」
  - CLAUDE.md → 定義「**規則是什麼**」

---

## 快速查詢

### 我想知道...

| 問題                     | 答案在                                                                        |
| ------------------------ | ----------------------------------------------------------------------------- |
| 專案用了哪些技術？       | [README.md](../README.md)                                                     |
| 怎麼開始開發？           | [QUICK_START.md](QUICK_START.md)                                              |
| TDD 流程是什麼？         | [WORKFLOW.md](WORKFLOW.md)                                                    |
| 認證怎麼做？             | [docs/verify/AUTH_INTEGRATION.md](verify/AUTH_INTEGRATION.md)                 |
| Migration 怎麼建立？     | [docs/verify/SUPABASE_MIGRATION_GUIDE.md](verify/SUPABASE_MIGRATION_GUIDE.md) |
| Client/Server 怎麼分工？ | [CLAUDE.md](../CLAUDE.md#-supabase-資料存取策略)                              |
| Spec-Kit 怎麼用？        | [SPEC_KIT.md](SPEC_KIT.md)                                                    |
| 常見問題？               | [FAQ.md](FAQ.md)                                                              |

---

## 下一步

1. **新手**：從 [QUICK_START.md](QUICK_START.md) 開始
2. **想了解開發流程**：閱讀 [WORKFLOW.md](WORKFLOW.md)
3. **有具體問題**：查看 [FAQ.md](FAQ.md)
