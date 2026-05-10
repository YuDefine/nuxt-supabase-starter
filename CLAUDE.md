# CLAUDE.md

## Language

**YOU MUST** respond in 繁體中文 (zh-TW). **NEVER** use 簡體中文 (zh-CN).

## Project Structure

This is a monorepo. The actual Nuxt starter template lives in `template/`.

```
├── template/          # 完整 Nuxt + Supabase starter（自給自足的獨立專案）
├── docs/              # Starter 展示文件（QUICK_START, FIRST_CRUD 等）
└── scripts/           # Meta 維護腳本（create-clean, validate-starter）
```

## Meta vs Template 邊界

`nuxt-supabase-starter` root 是 meta 維護層；`template/` 是 scaffold / degit 後會被使用者新專案直接帶走的 starter seed。改檔前先判斷變更落點，避免把 root 維護工具、私人資料、dogfood 業務碼或未標記 starter-only 文件放進 `template/`。

| 情境                       | 落點                                                             | 判斷方式                                                                                                        |
| -------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 要改 root meta             | repo root，例如 `.claude/rules/`、`.husky/`、`scripts/`、`docs/` | 只服務 starter 維護、release、hook、audit、create-clean、validate-starter 或治理文件，不應被 scaffold 帶走      |
| 要改 `template/`           | `template/` 內，以 `template/` cwd 的相對路徑表示                | scaffold 後使用者專案需要繼承的 Nuxt app、Supabase schema、範例 env、docs、tests 或 agent instructions          |
| 要新建 Spectra change      | `template/openspec/changes/<change-name>/`                       | 變更跨 root meta 與 `template/`、影響 starter 能力或後續 scaffold 行為，需要 proposal / design / tasks 明確驗收 |
| 要登記 tech debt / ROADMAP | `template/docs/tech-debt.md` 或 `template/openspec/ROADMAP.md`   | 發現問題但不屬本次 scope，或需要後續 change 承接，當下登記，不把工作往未來口頭推遲                              |

Starter hygiene 的 root source of truth 是 `.claude/rules/starter-hygiene.md`（從 `template/` cwd 讀作 `../.claude/rules/starter-hygiene.md`）。`template/.claude/rules/` 是 clade-managed projection，會跟著 starter seed 被帶走；它不是 root meta hygiene rule 的落點，也不要把 root meta 維護政策寫進那裡。

跨層 Spectra change 必須在 proposal、design、tasks 裡標清 path 層級：

- root paths 用 repo root path，或在 `template/` cwd 中以 `../` 標註，例如 `../.husky/pre-commit`、`../scripts/audit-template-hygiene.sh`。
- `template/` paths 以 Spectra cwd 為準，例如 `app/**`、`server/**`、`supabase/**`、`docs/**`。
- proposal / design / tasks 不得混淆 path 層級；同一個 task 若跨 root meta 與 starter seed，必須說明為什麼需要跨層，並分開列出驗收。

For all development work, `cd template/` and follow `template/CLAUDE.md`.
