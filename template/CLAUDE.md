<!-- SPECTRA:START v2.2.3 -->

# Spectra Instructions

This project uses Spectra 2.2.3 for Spec-Driven Development(SDD). Specs live in `openspec/specs/`, change proposals in `openspec/changes/`. Config: `.spectra.yaml`.

## Use `/spectra-*` skills when:

- A discussion needs structure before coding → `/spectra-discuss`
- User wants to plan, propose, or design a change → `/spectra-propose`
- Tasks are ready to implement → `/spectra-apply`
- There's an in-progress change to continue → `/spectra-ingest`
- User asks about specs or how something works → `/spectra-ask`
- Implementation is done → `/spectra-archive`

## Workflow

discuss? → propose → apply ⇄ ingest → archive

- `discuss` is optional — skip if requirements are clear
- Requirements change mid-work? Plan mode → `ingest` → resume `apply`

## Parked Changes

Changes can be parked（暫存）— temporarily moved out of `openspec/changes/`. Parked changes won't appear in `spectra list` but can be found with `spectra list --parked`. To restore: `spectra unpark <name>`. The `spectra-apply` and `spectra-ingest` skills handle parked changes automatically.

<!-- SPECTRA:END -->

# Proactive Skill Orchestra

**所有 Spectra sub-skill 與 Design skill 依 `.claude/rules/proactive-skills.md` 自主觸發，不需使用者手動指定。**

整合機制（Level 2 — 結構級）：

| 層    | 機制                                 | 觸發點                                                      |
| ----- | ------------------------------------ | ----------------------------------------------------------- |
| Rules | Design Review Task Template          | spectra-propose 時自動注入 design tasks 到 tasks artifact   |
| Hook  | `post-propose-design-inject.sh`      | spectra-propose 後驗證 UI scope → 提醒補 Design Review      |
| Skill | `/design` Step 0.5 Spectra Detection | /design 自動讀取 active change 的範圍，精準診斷             |
| Skill | `/design` Step 6 Persist Evidence    | /design 完成後寫 `design-review.md` 到 change 目錄          |
| Hook  | `pre-archive-design-gate.sh`         | archive 前檢查 design-review.md 或 Design Review tasks 完成 |
| Rules | Design → Spectra 回饋迴路            | design 發現影響 spec 的問題時觸發 spectra-ingest            |

**Design Review 是 tasks artifact 的一等公民**——spectra-apply 會自然按順序執行到 Design Review 區塊。與規格書來源無關——Notion、文件、對話皆適用。

# CLAUDE.md

## Language

**YOU MUST** respond in 繁體中文 (zh-TW). **NEVER** use 簡體中文 (zh-CN).

## Project

Nuxt 4 + Supabase starter template with Cookie-based auth, RLS, and spec-driven development.

## Stack

Nuxt 4, Vue 3 (Composition API + `<script setup>`), TypeScript, Tailwind CSS, Nuxt UI, Pinia, VueUse, Supabase (PostgreSQL), nuxt-auth-utils 或 @onmax/nuxt-better-auth（二擇一）

## Commands

```bash
pnpm dev             # Nuxt dev server（需要時自動啟動，見 browser-use-screenshot skill）
pnpm check           # vp check (lint + fmt + test) + typecheck
vp test              # All tests + coverage
vp lint              # Lint only
vp fmt               # Format only
pnpm typecheck       # Type check only
```

### Supabase

```bash
supabase migration new <name>  # Create migration (NEVER create .sql manually)
supabase db reset              # Reset + apply all migrations + gen types
supabase db lint --level warning  # Security check
supabase gen types typescript --local > app/types/database.types.ts  # Generate types
```

## Environment Variables

統一使用 **GitHub Secrets** 管理環境變數，透過 CI/CD 部署時注入。

**禁止**直接在 Cloudflare Dashboard 設定環境變數。

新增環境變數時：

1. 在 GitHub repo → Settings → Secrets and variables → Actions 新增
2. 確認 `docs/templates/.github/workflows/` 中的部署 workflow 有正確傳遞該變數

## Automation Triggers

| Trigger           | Action                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------- |
| `/commit`         | Run `pnpm check` → commit                                                              |
| Migration created | `supabase db reset` → `supabase db lint` → `supabase gen types` → `pnpm typecheck`    |
| New feature       | Follow `test-driven-development` skill                                                 |

## Proactive Behaviors

- **Dev server**：需要截圖/瀏覽/測試 UI 時，自動偵測並啟動。詳見 `browser-use-screenshot` skill
- **產品思維**（僅在需求模糊時）：從用戶角度提問協助釐清，需求明確時直接執行
- **其餘自動行為**（知識搜索、知識萃取、Review 深度、UI QA）由 `.claude/hooks/` 強制觸發，詳見全域 `~/.claude/CLAUDE.md` Auto-Harness

## Commit Format

See `commitlint.config.js` for types. Use `/commit` command.

## References

| Topic       | File                                  |
| ----------- | ------------------------------------- |
| 架構概覽    | `docs/architecture/SYSTEM_OVERVIEW.md` |
| Auth        | `docs/auth/AUTH_INTEGRATION.md`       |
| Migration   | `docs/database/MIGRATION_GUIDE.md`    |
| RLS         | `docs/database/RLS_POLICY_TEMPLATES.md` |
| API         | `docs/api/API_DESIGN_GUIDE.md`        |
| 錯誤處理    | `docs/api/ERROR_HANDLING.md`          |
| Logging     | `docs/api/LOGGING.md`                 |
| Pinia       | `docs/verify/PINIA_ARCHITECTURE.md`   |
| Environment | `docs/verify/ENVIRONMENT_VARIABLES.md` |
| 歷史經驗    | `docs/solutions/README.md`            |

開發手冊與所有參考文件索引：`docs/README.md`

## Documentation

### docs/verify/ Purpose

Record **current state**, not iteration history. Use present tense, no timestamps.

### docs/solutions/ Purpose

Record **problem → solution** experiences accumulated during development. Auto-managed by Claude (see Auto-Harness in global CLAUDE.md). Schema defined in `docs/solutions/README.md`.

## Decision Log

When choosing between alternatives that affect more than today's task — a library, an architecture pattern, an API design, or deciding NOT to do something — log it:

File: `decisions/YYYY-MM-DD-{topic}.md`

Format:

```
## Decision: {what you decided}
## Context: {why this came up}
## Alternatives considered: {what else was on the table}
## Reasoning: {why this option won}
## Trade-offs accepted: {what you gave up}
```

When about to make a similar decision, grep `decisions/` for prior choices. Follow them unless new information invalidates the reasoning.
