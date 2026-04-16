# Skills 更新指南

管理與更新 Claude Code Skills 的完整指南。

**適用情境**：你已經用本 Starter 建立了專案，需要更新、新增或管理 AI Skills。

> Skills 的基本概念請先參考 [CLAUDE_CODE_GUIDE.md](./CLAUDE_CODE_GUIDE.md#skills技術知識庫)。

---

## 快速指令

| 指令                    | 說明                       |
| ----------------------- | -------------------------- |
| `pnpm skills:list`      | 查看已安裝的 Skills 及狀態 |
| `pnpm skills:install`   | 安裝或更新所有 Skills      |
| `pnpm skills:update`    | 同 `skills:install`        |

三個指令對應 `scripts/install-skills.sh` 和 `scripts/check-skills.sh`。

---

## 安裝機制

第三方 Skills 使用 [skills.sh](https://skills.sh) 的 `npx skills add` 安裝，統一採用 `--agent claude-code --copy` 模式：

```bash
npx skills add <registry>@<skill-name> --agent claude-code --copy -y
```

- `--agent claude-code`：安裝到 `.claude/skills/` 目錄
- `--copy`：直接複製檔案，不建立 symlink（避免跨環境問題）
- `-y`：自動確認

重複執行會覆寫為最新版，等同更新。

> 部分 Skills（例如 `design`、`arrange`、`frontend-design`、`review-archive`、`subagent-dev`）是隨 starter 版控的本地 skills，會在 scaffold 時直接複製，不透過 registry 安裝。

---

## 已安裝的 Skills 分類

### 核心框架（Antfu Skills）

| Skill                            | 來源            | 用途               |
| -------------------------------- | --------------- | ------------------ |
| `nuxt`、`vue`、`vueuse-functions` | `antfu/skills`  | 核心框架知識       |
| `vitest`、`vue-best-practices`   | `antfu/skills`  | 測試最佳實踐       |
| `pinia`、`vue-testing-best-practices` | `antfu/skills` | 狀態管理與測試 |
| `vitepress`                      | `antfu/skills`  | 文件網站           |

### Nuxt 生態系（Onmax Skills）

| Skill                                    | 來源              | 用途               |
| ---------------------------------------- | ----------------- | ------------------ |
| `document-writer`、`motion`              | `onmax/nuxt-skills` | 文件撰寫、動畫  |
| `nuxt-better-auth`                       | `onmax/nuxt-skills` | Better Auth 認證 |
| `nuxt-content`、`nuxt-modules`、`nuxthub` | `onmax/nuxt-skills` | 內容、模組、部署 |
| `reka-ui`、`ts-library`、`vueuse`        | `onmax/nuxt-skills` | 元件、函式庫     |

### 官方 Skills

| Skill                              | 來源                  | 用途              |
| ---------------------------------- | --------------------- | ----------------- |
| `supabase-postgres-best-practices` | `supabase/agent-skills` | Postgres 最佳化 |
| `nuxt-ui`                          | `nuxt/ui`             | Nuxt UI 元件庫   |

### TDD

| Skill                    | 來源              | 用途             |
| ------------------------ | ----------------- | ---------------- |
| `test-driven-development` | `obra/superpowers` | TDD 紅綠重構循環 |

### Observability（Evlog）

| Skill                                   | 來源          | 用途            |
| ---------------------------------------- | ------------- | --------------- |
| `create-evlog-adapter`                   | `hugorcd/evlog` | Logger adapter |
| `create-evlog-enricher`                  | `hugorcd/evlog` | Log enricher   |
| `create-evlog-framework-integration`     | `hugorcd/evlog` | 框架整合       |
| `review-logging-patterns`                | `hugorcd/evlog` | 日誌模式審查   |

### Design Skills（Impeccable）

Design skills 分成兩類：

1. **第三方 vendor skills**：由 `pbakaus/impeccable` 安裝與更新
2. **starter 本地 skills**：直接隨 `.claude/skills/` 版控

第三方 vendor skills：

```
adapt, animate, audit, bolder, clarify, colorize, critique, delight,
distill, optimize, overdrive, polish, quieter, typeset
```

starter 本地 skills：

```
arrange, design, design-retro, extract, frontend-design, harden,
normalize, onboard, teach-impeccable
```

### 工具

| Skill        | 來源               | 用途              |
| ------------ | ------------------ | ----------------- |
| `find-skills` | `vercel-labs/skills` | 搜尋與發現 Skills |

### 專案自建 Skills

以下 Skills 隨專案版控，不透過 `install-skills.sh` 管理：

```
design, design-retro, nuxt-auth-utils, pinia-store, review-archive,
arrange, extract, frontend-design, harden, normalize, onboard,
teach-impeccable, review-rules, review-screenshot, server-api, spectra, spectra-apply,
spectra-archive, spectra-ask, spectra-audit, spectra-debug,
spectra-discuss, spectra-ingest, spectra-propose, subagent-dev,
supabase-arch, supabase-migration, supabase-rls
```

---

## 更新 Skills

### 全部更新

```bash
pnpm skills:update
# 或等價的
pnpm skills:install
```

腳本會重新下載所有第三方 Skills，覆寫本地版本。

### 更新單一 Skill

```bash
npx skills add antfu/skills@nuxt --agent claude-code --copy -y
```

替換 `antfu/skills@nuxt` 為目標 Skill 的 registry 和名稱。

### 查看目前狀態

```bash
pnpm skills:list
```

會顯示分類清單，並偵測 broken symlink。

---

## 新增 Skill

### 從 Registry 安裝

```bash
npx skills add <registry>@<skill-name> --agent claude-code --copy -y
```

安裝後建議把指令加入 `scripts/install-skills.sh`，確保團隊成員能同步。

### 自建 Skill

1. 建立目錄：`.claude/skills/my-skill/`
2. 建立主文件：`SKILL.md`
3. 選擇性加入 `references/` 參考文件

```
.claude/skills/my-skill/
├── SKILL.md              # 觸發條件、核心知識
└── references/           # 補充文件（選用）
    └── api.md
```

`SKILL.md` 的基本結構：

```markdown
---
description: 簡短說明此 Skill 的用途和觸發條件
---

# My Skill

## 核心知識

...
```

---

## 移除 Skill

```bash
rm -rf .claude/skills/<skill-name>
```

如果是透過 `install-skills.sh` 安裝的，也從腳本中移除對應行，避免下次更新時重新安裝。

---

## 疑難排解

### Skill 沒有被觸發

1. 確認 `SKILL.md` 的 `description` frontmatter 描述了觸發條件
2. 在對話中明確提到：「參考 xxx skill」
3. 重新啟動 Claude Code CLI

### Broken Symlink

```bash
pnpm skills:list
# 如果看到 ⚠️ broken symlink，執行：
pnpm skills:install
```

`--copy` 模式會將 symlink 轉為實體檔案，解決跨環境問題。

### 更新後沒有生效

重新啟動 Claude Code CLI。Skills 在啟動時載入，執行中的 session 不會自動更新。

---

## 相關文件

| 文件                                           | 說明                |
| ---------------------------------------------- | ------------------- |
| [CLAUDE_CODE_GUIDE.md](./CLAUDE_CODE_GUIDE.md) | Claude Code 完整配置 |
| [QUICK_START.md](./QUICK_START.md)             | 新專案安裝步驟       |
| [skills.sh](https://skills.sh)                 | AI Skills 管理平台   |
