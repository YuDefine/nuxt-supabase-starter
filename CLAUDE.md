<!-- SPECTRA:START v1.0.0 -->

# Spectra Instructions

This project uses Spectra for Spec-Driven Development(SDD). Specs live in `openspec/specs/`, change proposals in `openspec/changes/`.

## Entry Point

**`/spectra`** — 主要入口，自動偵測專案狀態並引導到正確的 sub-skill。不確定該用哪個時，用這個。

## Sub-skills（直接指定）

- `/spectra:discuss` — 需求不明確，先討論再決定
- `/spectra:propose` — 規劃新功能/改動
- `/spectra:apply` — 開始或繼續實作
- `/spectra:ingest` — 從對話或 plan 更新 artifacts
- `/spectra:ask` — 查詢現有 spec 內容
- `/spectra:archive` — 完成歸檔
- `/spectra:audit` — 審查程式碼安全性
- `/spectra:debug` — 系統性排查問題

## Workflow

discuss? → propose → apply ⇄ ingest → archive

- `discuss` is optional — skip if requirements are clear
- Requirements change mid-work? Plan mode → `ingest` → resume `apply`
- 不知道現在該做什麼？直接 `/spectra`

<!-- SPECTRA:END -->

# CLAUDE.md

## Language

**YOU MUST** respond in 繁體中文 (zh-TW). **NEVER** use 簡體中文 (zh-CN).

## Stack

Nuxt 4, Vue 3 (Composition API + `<script setup>`), TypeScript, Tailwind CSS, Nuxt UI, Pinia, Supabase (PostgreSQL), nuxt-auth-utils 或 @onmax/nuxt-better-auth（二擇一）

## Commands

```bash
pnpm dev             # Nuxt dev server（需要時自動啟動，見 browser-use-screenshot skill）
pnpm check           # vp check (lint + fmt + test) + typecheck
vp test              # All tests + coverage
vp lint              # Lint only
vp fmt               # Format only
pnpm typecheck       # Type check only
supabase db reset    # Reset + apply all migrations
supabase db lint --level warning  # Security check
```

## Environment Variables

統一使用 **GitHub Secrets** 管理環境變數，透過 CI/CD 部署時注入。

**禁止**直接在 Cloudflare Dashboard 設定環境變數。

新增環境變數時：

1. 在 GitHub repo → Settings → Secrets and variables → Actions 新增
2. 確認 `docs/templates/.github/workflows/` 中的部署 workflow 有正確傳遞該變數

## Proactive Behaviors (Project-Specific)

- **需要 dev server 時**（截圖、瀏覽、測試 UI）：自動偵測並啟動，不詢問。詳見 `browser-use-screenshot` skill
- **產品思維**（僅在需求模糊時）：從用戶角度提問協助釐清，需求明確時直接執行

## Commit Format

See `commitlint.config.js` for types. Use `/commit` command.

## References

| Topic       | File                                      |
| ----------- | ----------------------------------------- |
| Auth        | `docs/verify/AUTH_INTEGRATION.md`         |
| Migration   | `docs/verify/SUPABASE_MIGRATION_GUIDE.md` |
| RLS         | `docs/verify/RLS_BEST_PRACTICES.md`       |
| API         | `docs/verify/API_DESIGN_GUIDE.md`         |
| Pinia       | `docs/verify/PINIA_ARCHITECTURE.md`       |
| Environment | `docs/verify/ENVIRONMENT_VARIABLES.md`    |
| Screenshot  | `docs/verify/SCREENSHOT_GUIDE.md`         |
| 歷史經驗    | `docs/solutions/README.md`                |

## Documentation

### docs/verify/ Purpose

Record **current state**, not iteration history. Use present tense, no timestamps.

### docs/solutions/ Purpose

Record **problem → solution** experiences accumulated during development. Auto-managed by Claude (see Auto-Harness in global CLAUDE.md). Schema defined in `docs/solutions/README.md`.
