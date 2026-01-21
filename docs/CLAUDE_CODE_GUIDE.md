# Claude Code 配置指南

> 理解並客製化 AI 開發助手的行為

## 什麼是 Claude Code？

[Claude Code](https://claude.ai/code) 是 Anthropic 的 CLI 工具，讓你可以在終端機中與 Claude 對話，並讓它直接操作你的程式碼。

這個範本預先配置了一套完整的 AI 開發工作流程，包含：

| 類型 | 數量 | 說明 |
|------|------|------|
| Commands | 13 個 | 可透過 `/指令` 觸發的工作流程 |
| SubAgents | 3 個 | 自動執行特定任務的專家 |
| Skills | 12 個 | 提供技術知識的參考文件 |
| CLAUDE.md | 1 份 | 專案開發規範 |

---

## 訂閱方案建議

**推薦**：[Claude Code Max](https://claude.ai/code)（每月 $100 美元起）

本範本大量使用 Claude Opus 4.5 模型。為了獲得最佳開發體驗，建議使用 Max 方案以獲得充足的 Opus 配額。

| 方案 | 每月費用 | Opus 用量 | 適合 |
|------|----------|-----------|------|
| Pro | $20 | 有限 | 輕度使用、學習 |
| **Max 5x** | **$100** | **充足** | **日常開發**（推薦） |
| Max 20x | $200 | 大量 | 密集開發、團隊共用 |

> **實際經驗**：2.5 個月開發中使用了 2,500+ 次 Claude 對話。若使用 Pro 方案，會頻繁遇到 Opus 配額限制。Max 5x 方案足以支撐日常開發。

---

## 快速開始

### 1. 安裝 Claude Code

```bash
# 使用 npm
npm install -g @anthropic-ai/claude-code

# 或使用 Homebrew
brew install claude-code
```

### 2. 複製設定檔

```bash
# 複製範例設定
cp .claude/settings.local.json.example .claude/settings.local.json
```

### 3. 啟動 Claude Code

```bash
# 在專案目錄下啟動
claude
```

### 4. 開始使用

```bash
# 試試看這些指令
/tdd 幫我寫一個計算稅金的函式
/commit
```

---

## 核心概念

### CLAUDE.md：專案規範

`CLAUDE.md` 是專案根目錄下的 Markdown 檔案，Claude 每次啟動都會讀取它。

**用途**：
- 定義專案的技術棧和規範
- 設定 Claude 應該遵守的開發原則
- 說明專案結構和慣例

**關鍵區塊**：

```markdown
## ⚠️ Standards
**MUST FOLLOW THESE RULES, NO EXCEPTIONS**
- 使用 Composition API + <script setup>
- 使用 TailwindCSS，不寫自定義 CSS
- 遵循 TDD 開發流程
...
```

當 Claude 違反這些規則時，可以直接指出：「這不符合 CLAUDE.md 的規範」。

### .claude/ 目錄結構

```
.claude/
├── settings.local.json.example  # 設定檔範例
├── commands/                    # 自定義指令
│   ├── tdd.md
│   ├── commit.md
│   ├── db-migration.md
│   └── speckit.*.md
├── agents/                      # SubAgents
│   ├── check-runner.md
│   ├── post-implement.md
│   └── db-backup.md
└── skills/                      # 技術知識庫
    ├── nuxt/
    ├── nuxt-ui/
    ├── vue/
    └── ...
```

---

## Commands（自定義指令）

Commands 是可以用 `/指令` 觸發的工作流程。

### 日常開發指令

| 指令 | 說明 |
|------|------|
| `/tdd` | 執行 TDD 流程：寫測試 → 確認紅燈 → 實作 → 確認綠燈 → 重構 |
| `/commit` | 分析變更、依功能分組、逐一 commit |
| `/db-migration` | 建立 Supabase migration，確保符合安全規範 |
| `/doc-sync` | 同步更新 docs/verify/ 文件 |

### spec-kit 指令

用於結構化的功能開發，詳見 [SPEC_KIT.md](./SPEC_KIT.md)。

| 指令 | 說明 |
|------|------|
| `/speckit.specify` | 從自然語言建立規格 |
| `/speckit.clarify` | 釐清規格中的模糊點 |
| `/speckit.plan` | 從規格產生實作計畫 |
| `/speckit.tasks` | 從計畫產生任務清單 |
| `/speckit.implement` | 執行任務清單 |
| `/speckit.analyze` | 分析文件一致性 |
| `/speckit.checklist` | 產生檢查清單 |
| `/speckit.constitution` | 設定專案原則 |
| `/speckit.taskstoissues` | 把任務轉成 GitHub Issues |

### 指令串接

指令之間會自動串接：

```
/tdd 完成 → check-runner → 詢問 commit
/commit → 先執行 check-runner
/db-migration 完成 → 產生 TypeScript 類型
/speckit.implement 完成 → check-runner → 詢問 commit
```

### 建立自己的指令

在 `.claude/commands/` 下建立 Markdown 檔案：

```markdown
---
description: 執行某個工作流程
---

## User Input

```text
$ARGUMENTS
```

## Outline

1. 第一步：做什麼
2. 第二步：做什麼
3. ...
```

檔名就是指令名稱（例如 `my-command.md` → `/my-command`）。

---

## SubAgents（專家代理）

SubAgents 是專門處理特定任務的「專家」，由 Claude 自動調用。

### 內建的 SubAgents

| Agent | 用途 | 模型 |
|-------|------|------|
| `check-runner` | 執行 format → lint → typecheck → test | Haiku（快） |
| `post-implement` | 實作完成後的標準化檢查與 commit 流程 | - |
| `db-backup` | 執行資料庫備份並更新 seed.sql | - |

### check-runner 範例

當 Claude 完成程式碼實作後，會自動調用 `check-runner`：

```
✅ 所有檢查通過！

- format: ✓
- lint: ✓
- typecheck: ✓
- test: ✓ (42 passed)

可以進行 commit。
```

如果有錯誤：

```
❌ 檢查未通過

| 步驟 | 狀態 | 錯誤數 |
|------|------|--------|
| format | ✓ | 0 |
| lint | ✗ | 3 |
| typecheck | ✓ | 0 |

## 錯誤摘要

### lint (3 errors)
- app/components/Foo.vue:12 - 'unused' is defined but never used
...
```

### 建立自己的 SubAgent

在 `.claude/agents/` 下建立 Markdown 檔案：

```markdown
---
name: my-agent
description: 這個 agent 做什麼
tools: Bash, Read, Grep, Glob
model: haiku
---

你是某個領域的專家。

## 執行流程

1. ...
2. ...

## 輸出格式

...
```

---

## Skills（技術知識庫）

Skills 是預先整理好的技術知識，讓 Claude 能正確使用各種框架和工具。

### 內建的 Skills

來自 [nuxt-skills](https://github.com/onmax/nuxt-skills)：

| Skill | 用途 |
|-------|------|
| `nuxt` | Nuxt 4 路由、composables、server |
| `nuxt-ui` | Nuxt UI v4 元件、表單、主題 |
| `vue` | Vue 3 Composition API、組件模式 |
| `vueuse` | VueUse composables |
| `nuxt-better-auth` | 認證模組 |
| `nuxt-content` | 內容管理 |
| `nuxt-modules` | 模組開發 |
| `reka-ui` | 無樣式元件 |
| `motion` | 動畫效果 |
| `nuxthub` | Cloudflare 整合 |
| `document-writer` | 文件寫作風格 |
| `ts-library` | TypeScript 函式庫開發 |

### Skill 的結構

以 `nuxt-ui` 為例：

```
skills/nuxt-ui/
├── SKILL.md              # 主文件：何時使用、概述
├── references/           # 參考文件
│   ├── installation.md
│   ├── theming.md
│   ├── components.md
│   ├── forms.md
│   ├── overlays.md
│   └── composables.md
└── components/           # 個別元件文件
    ├── button.md
    ├── modal.md
    └── ...
```

Claude 會根據上下文載入需要的文件，而不是一次讀取全部。

### 使用 Skills

Skills 是自動觸發的。當你詢問相關問題時，Claude 會自動讀取對應的 Skill：

```
你：幫我做一個 Modal 元件
Claude：[讀取 nuxt-ui/components/modal.md]
       這是使用 UModal 的範例...
```

---

## 設定檔

### settings.local.json

控制 Claude Code 的權限和行為：

```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm test:*)",
      "Bash(git commit:*)",
      "Bash(supabase db reset:*)",
      ...
    ]
  },
  "enabledMcpjsonServers": ["local-supabase"],
  "outputStyle": "default"
}
```

**權限說明**：
- `Bash(command:*)` - 允許執行特定指令
- `mcp__server__tool` - 允許使用 MCP 工具
- `WebSearch` - 允許網路搜尋

### MCP Servers

[MCP (Model Context Protocol)](https://modelcontextprotocol.io/) 讓 Claude 可以連接外部服務。

本範本預設啟用 `local-supabase`，讓 Claude 可以：
- 列出資料表結構
- 執行 SQL 查詢
- 搜尋 Supabase 文件
- 取得資料庫建議
- 查看 migration 歷史

這是 AI 輔助開發的關鍵組件——Claude 不再需要猜測你的資料庫結構，而是可以直接查看。

> 📖 完整說明：[SUPABASE_MCP.md](./SUPABASE_MCP.md)

---

## 客製化指南

### 情境 1：調整開發規範

編輯 `CLAUDE.md`，修改 `## ⚠️ Standards` 區塊。

### 情境 2：新增自定義指令

1. 在 `.claude/commands/` 建立 `my-command.md`
2. 使用 `/my-command` 觸發

### 情境 3：新增 Skill

1. 在 `.claude/skills/` 建立目錄
2. 建立 `SKILL.md` 主文件
3. 加入 `references/` 參考文件

### 情境 4：調整權限

編輯 `.claude/settings.local.json`，新增或移除允許的指令。

---

## 常見問題

### Q: Claude 沒有遵守 CLAUDE.md 的規範？

1. 確認規範寫在 `## ⚠️ Standards` 區塊
2. 使用明確的語氣（「必須」、「禁止」）
3. 直接指出：「這違反了 CLAUDE.md 中的 X 規範」

### Q: 指令沒有觸發？

1. 確認檔案在 `.claude/commands/` 目錄下
2. 確認檔案有 `---` 開頭的 frontmatter
3. 重新啟動 Claude Code

### Q: SubAgent 回報的錯誤很多？

SubAgent（如 check-runner）會回報所有問題。可以請 Claude 優先處理最重要的錯誤，或一次只修一個。

### Q: Skill 沒有被讀取？

Skills 是根據上下文自動載入的。如果沒有觸發，可以明確提到：
- 「使用 Nuxt UI 的 Modal」
- 「參考 nuxt skill」

---

## 相關資源

- [Claude Code 官方文件](https://docs.anthropic.com/claude-code)
- [nuxt-skills](https://github.com/onmax/nuxt-skills) - 本專案使用的 Skills
- [CLAUDE.md](../CLAUDE.md) - 本專案的開發規範
- [SPEC_KIT.md](./SPEC_KIT.md) - spec-kit 工作流程
