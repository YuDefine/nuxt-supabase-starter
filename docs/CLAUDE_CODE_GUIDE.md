# Claude Code 配置指南

> 理解並客製化 AI 開發助手的行為

## 什麼是 Claude Code？

[Claude Code](https://claude.ai/code) 是 Anthropic 的 CLI 工具，讓你可以在終端機中與 Claude 對話，並讓它直接操作你的程式碼。

這個範本預先配置了一套完整的 AI 開發工作流程，包含：

| 類型      | 數量   | 說明                          |
| --------- | ------ | ----------------------------- |
| Commands  | 24 個  | 12 共用 + 12 Spectra          |
| SubAgents | 4 個   | 自動執行特定任務的專家        |
| Skills    | 43 個  | 26 通用 + 5 情境 + 12 Spectra |
| Hooks     | 9 個   | Auto-Harness 自動化腳本       |
| Rules     | 11 個  | 開發規範規則                  |
| CLAUDE.md | 1 份   | 專案開發規範                  |

---

## 訂閱方案建議

**推薦**：[Claude Code Max](https://claude.ai/code)（$100 級/月起）

本範本大量使用 Claude Opus 模型。為了獲得最佳開發體驗，建議使用 Max 方案以獲得充足的 Opus 配額。

| 方案       | 每月費用 | Opus 用量 | 適合                 |
| ---------- | -------- | --------- | -------------------- |
| Pro        | $20 級   | 有限      | 輕度使用、學習       |
| **Max 5x** | **$100 級** | **充足**  | **日常開發**（推薦） |
| Max 20x    | $200 級  | 大量      | 密集開發、團隊共用   |

> **實際經驗**：密集開發時 Pro 方案會頻繁遇到 Opus 配額限制。Max 5x 方案足以支撐日常開發。

---

## 快速開始

專案建立與安裝步驟請參考 **[QUICK_START.md](./QUICK_START.md)**。

以下說明 Claude Code 的安裝與本範本的 AI 配置。

### 安裝 Claude Code

```bash
curl -fsSL https://claude.ai/install.sh | sh
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
## Project
Nuxt 4 + Supabase starter template with Cookie-based auth, RLS, and spec-driven development.

## Stack
Nuxt 4, Vue 3 (Composition API + <script setup>), TypeScript, Tailwind CSS, Nuxt UI, ...

## Commands
pnpm dev / pnpm check / vp test / vp lint / vp fmt / pnpm typecheck

## Commit Format
See commitlint.config.js for types. Use /commit command.
```

修改 `## Project` 和 `## Stack` 區塊以符合你的專案。詳細規範由 `.claude/rules/` 中的規則檔案定義。

### .claude/ 目錄結構

```
.claude/
├── settings.json                # Claude Code 設定（權限、hooks、MCP）
├── commands/                    # 自定義指令（12 共用 + spectra/）
│   ├── commit.md
│   ├── db-migration.md
│   ├── doc-sync.md
│   ├── validate-starter.md
│   ├── guard.md / freeze.md / unfreeze.md
│   ├── ship.md / canary.md / retro.md
│   ├── sprint-status.md / second-opinion.md
│   └── spectra/                 # 12 個 Spectra 指令
├── agents/                      # SubAgents
│   ├── check-runner.md
│   ├── code-review.md
│   ├── db-backup.md
│   └── screenshot-review.md
├── hooks/                       # Auto-Harness 自動化腳本（9 個）
│   ├── knowledge-search-reminder.sh
│   ├── pre-commit-review.sh
│   ├── pre-archive-design-gate.sh
│   ├── post-migration-gen-types.sh
│   ├── post-edit-typecheck.sh
│   ├── post-edit-ui-qa.sh
│   ├── post-propose-design-inject.sh
│   ├── init-code-graph.sh
│   └── stop-accumulate.sh
├── rules/                       # 開發規範規則（11 個）
│   ├── development.md
│   ├── api-patterns.md
│   ├── auth.md
│   ├── database-access.md
│   ├── migration.md
│   ├── rls-policy.md
│   ├── error-handling.md
│   ├── logging.md
│   ├── testing-anti-patterns.md
│   ├── mcp-remote.md
│   └── proactive-skills.md
├── scripts/                     # Hook 輔助腳本
│   └── guard-check.mjs
└── skills/                      # 專案特定技術知識庫
    ├── supabase-rls/
    ├── server-api/
    └── ...
```

---

## Commands（自定義指令）

Commands 是可以用 `/指令` 觸發的工作流程。

### 共用指令（12 個）

| 指令                | 說明                                      |
| ------------------- | ----------------------------------------- |
| `/commit`           | 分析變更、依功能分組、逐一 commit         |
| `/db-migration`     | 建立 Supabase migration，確保符合安全規範 |
| `/doc-sync`         | 同步更新 docs/verify/ 文件                |
| `/validate-starter` | 驗證範本完整性                            |
| `/guard`            | 啟用程式碼守衛                            |
| `/freeze` / `/unfreeze` | 凍結/解凍變更                         |
| `/ship`             | 發布流程                                  |
| `/canary`           | Canary 部署驗證                           |
| `/retro`            | 回顧檢討                                  |
| `/sprint-status`    | Sprint 進度報告                           |
| `/second-opinion`   | 取得第二意見                              |

### Spectra 指令（12 個）

包含 `propose`、`apply`、`archive`、`discuss`、`ask`、`ingest`、`debug`、`tdd`、`analyze`、`clarify`、`sync`、`verify` 共 12 個指令，涵蓋從提案到歸檔的完整 Spec-Driven Development 流程。

詳細指令說明請參考 [OPENSPEC.md](../template/docs/OPENSPEC.md)。

### 指令串接

指令之間會自動串接：

```
TDD 完成（test-driven-development skill）→ 詢問 commit
/commit → check-runner 完整檢查 → 分組 → 逐一 commit
/db-migration 完成 → [Hook] 自動產生 TypeScript 類型
Spectra apply 完成 → 詢問 commit
Edit/Write .ts/.vue → [Hook] 自動執行 format + typecheck
```

### 建立自己的指令

在 `.claude/commands/` 下建立 Markdown 檔案：

````markdown
---
description: 執行某個工作流程
---

## User Input

```text
$ARGUMENTS
```
````

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

| Agent               | 用途                                   | 模型         |
| ------------------- | -------------------------------------- | ------------ |
| `check-runner`      | 執行 format → lint → typecheck → test  | Haiku（快）  |
| `code-review`       | 審查 PR 或本地變更，產出審查報告       | Opus（深度） |
| `db-backup`         | 執行資料庫備份並更新 seed.sql          | Haiku        |
| `screenshot-review` | 截圖比對與視覺 QA                      | Sonnet       |

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

| 步驟      | 狀態 | 錯誤數 |
| --------- | ---- | ------ |
| format    | ✓    | 0      |
| lint      | ✗    | 3      |
| typecheck | ✓    | 0      |

## 錯誤摘要

### lint (3 errors)

- app/components/Foo.vue:12 - 'unused' is defined but never used
  ...

````

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
````

---

## Hooks（自動化腳本）

Hooks（又稱 Auto-Harness）是在特定工具執行前後自動觸發的腳本，用於自動化重複性工作和品質把關。

### 內建的 Hooks（9 個）

| Hook | 觸發時機 | 功能 |
| --- | --- | --- |
| `knowledge-search-reminder` | PreToolUse: 首次 Edit/Write .ts/.vue | 搜索 docs/solutions/ + docs/verify/，提醒參考既有知識 |
| `pre-commit-review` | PreToolUse: `git commit` | 依變更量建議 Tier 1/2/3 review 深度 |
| `pre-archive-design-gate` | PreToolUse: Skill(spectra-archive) | 阻擋未完成人工檢查或缺 Design Review 的 archive |
| `post-migration-gen-types` | PostToolUse: `apply_migration` | 自動產生 TypeScript types |
| `post-edit-typecheck` | PostToolUse: Edit/Write | 自動執行 format + typecheck |
| `post-edit-ui-qa` | PostToolUse: Edit/Write UI 檔案 | 提醒截圖/QA 驗證 |
| `post-propose-design-inject` | PostToolUse: Skill(spectra-propose) | 偵測 UI scope，提醒注入 Design Review tasks |
| `init-code-graph` | SessionStart | 初始化程式碼知識圖譜 |
| `stop-accumulate` | Stop | 知識萃取，提醒同步偏差 |

### Hooks 架構

Hooks 在 `settings.json` 中配置，分為四個生命週期階段：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": ".../.claude/hooks/knowledge-search-reminder.sh" }]
      },
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": ".../.claude/hooks/pre-commit-review.sh" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "mcp__local-supabase__apply_migration",
        "hooks": [{ "type": "command", "command": ".../.claude/hooks/post-migration-gen-types.sh" }]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": ".../.claude/hooks/post-edit-typecheck.sh" },
          { "type": "command", "command": ".../.claude/hooks/post-edit-ui-qa.sh" }
        ]
      }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": ".../.claude/hooks/init-code-graph.sh" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": ".../.claude/hooks/stop-accumulate.sh" }] }
    ]
  }
}
```

### 建立自己的 Hook

1. 在 `.claude/hooks/` 建立 shell 腳本
2. 設定執行權限：`chmod +x your-hook.sh`
3. 在 `settings.json` 的對應生命週期（`PreToolUse`/`PostToolUse`/`SessionStart`/`Stop`）中配置觸發條件

Hook 腳本可以從 stdin 讀取 JSON 輸入，包含 `tool_input` 和 `tool_response`。

---

## Skills（技術知識庫）

Skills 是預先整理好的技術知識，讓 Claude 能正確使用各種框架和工具。

### 通用 Skills（26 個）

全部為第三方 Skills，透過 `scripts/install-skills.sh` 安裝至 `.claude/skills/`：

| Skill                                           | 來源                    | 用途                 |
| ----------------------------------------------- | ----------------------- | -------------------- |
| `nuxt`、`vue`、`vueuse-functions`               | `antfu/skills`          | 核心框架             |
| `vitest`、`vue-best-practices`                  | `antfu/skills`          | 測試最佳實踐         |
| `pinia`、`vue-testing-best-practices`           | `antfu/skills`          | 狀態管理與測試       |
| `vitepress`                                     | `antfu/skills`          | 文件網站             |
| `document-writer`、`motion`、`nuxt-better-auth` | `onmax/nuxt-skills`     | 文件、動畫、認證     |
| `nuxt-content`、`nuxt-modules`、`nuxthub`       | `onmax/nuxt-skills`     | 內容、模組、部署     |
| `reka-ui`、`ts-library`、`vueuse`               | `onmax/nuxt-skills`     | 元件、函式庫、工具   |
| `nuxt-ui`、`contributing`                       | `nuxt/ui`               | UI 元件與貢獻指南    |
| `supabase-postgres-best-practices`              | `supabase/agent-skills` | Postgres 效能最佳化  |
| `test-driven-development`                       | `obra/superpowers`      | TDD 工作流程         |
| `find-skills`                                   | `vercel-labs/skills`    | 搜尋與發現 skills    |
| `create-evlog-*`（3 個）                        | `hugorcd/evlog`         | Observability 適配器 |
| `review-logging-patterns`                       | `hugorcd/evlog`         | 日誌模式審查         |

### 情境觸發 Skills（5 個）

| Skill                | 觸發情境            |
| -------------------- | ------------------- |
| `supabase-rls`       | 建立 RLS Policy 時  |
| `supabase-migration` | 建立 migration 時   |
| `server-api`         | 建立 Server API 時  |
| `pinia-store`        | 建立 Pinia Store 時 |
| `supabase-arch`      | 架構決策時          |

### Spectra Skills（12 個）

12 個 skills（`spectra-*`），提供 Spec-Driven Development 工作流程支援。

### Skill 的結構

以 `nuxt-ui`（官方 skill，位於 `.claude/skills/`）為例：

```
.claude/skills/nuxt-ui/
├── SKILL.md              # 主文件：安裝、圖示、主題、表單、overlay
└── references/           # 參考文件
    ├── theming.md        # CSS 變數、自訂顏色、品牌客製化
    ├── components.md     # 125+ 元件統一文件
    ├── composables.md    # useToast、useOverlay、defineShortcuts
    └── layouts/          # 佈局範本
        ├── dashboard.md
        ├── page.md
        ├── docs.md
        ├── chat.md
        └── editor.md
```

Claude 會根據上下文載入需要的文件，而不是一次讀取全部。

### 使用 Skills

Skills 是自動觸發的。當你詢問相關問題時，Claude 會自動讀取對應的 Skill：

```
你：幫我做一個 Modal 元件
Claude：[讀取 nuxt-ui/references/components.md]
       這是使用 UModal 的範例...
```

---

## 設定檔

### settings.json

控制 Claude Code 的權限和行為：

```json
{
  "permissions": {
    "allow": [
      "Bash(ls:*)",
      "Bash(node:*)",
      "Bash(supabase:*)",
      "Bash(pnpm check:*)",
      "Bash(pnpm test:*)",
      "Bash(pnpm lint:*)",
      "Bash(pnpm format:*)",
      "Bash(pnpm typecheck:*)",
      "Bash(pnpm build:*)",
      "Bash(pnpm dev:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git diff:*)",
      "Bash(git status:*)",
      "Bash(git log:*)",
      "Bash(git push:*)",
      "mcp__local-supabase__list_tables",
      "mcp__local-supabase__execute_sql",
      "..."
    ]
  },
  "enabledMcpjsonServers": ["local-supabase"]
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

> 📖 完整說明：[SUPABASE_MCP.md](../template/docs/SUPABASE_MCP.md)

---

## 客製化指南

### 情境 1：調整開發規範

編輯 `CLAUDE.md`（`## Project`、`## Stack`、`## Commands` 等區塊），或修改 `.claude/rules/` 中的規則檔案。

### 情境 2：新增自定義指令

1. 在 `.claude/commands/` 建立 `my-command.md`
2. 使用 `/my-command` 觸發

### 情境 3：新增 Skill

1. 在 `.claude/skills/` 建立目錄
2. 建立 `SKILL.md` 主文件
3. 加入 `references/` 參考文件

### 情境 4：調整權限

編輯 `.claude/settings.json`，新增或移除允許的指令。

---

## 常見問題

### Q: Claude 沒有遵守開發規範？

1. 確認規範寫在 `CLAUDE.md` 或 `.claude/rules/` 中
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
- [skills.sh](https://skills.sh) - AI Skills 管理平台
- [CLAUDE.md](../CLAUDE.md) - 本專案的開發規範
- [OPENSPEC.md](../template/docs/OPENSPEC.md) - Spectra 工作流程
