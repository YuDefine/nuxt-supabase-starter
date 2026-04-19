# Impeccable v1 → v2 Migration Reference

Historical reference for translating legacy v1 skill names to current v2.1 equivalents. Consult only when reading pre-2026-04-17 artifacts (archived changes, old spec drafts, external docs).

All live rules, hooks, orchestrators, and guides have been migrated to v2. New work should NEVER use v1 names.

## Command Name Mapping

| v1 舊名 | v2 對應 | 類型 |
|---|---|---|
| `/frontend-design` | `/impeccable craft`（or 主 `impeccable` skill） | v2.0 renamed — 併入 umbrella |
| `/teach-impeccable` | `/impeccable teach` | v2.0 renamed — 變成 subcommand |
| `/extract` | `/impeccable extract` | v2.1 renamed — 變成 subcommand |
| `/arrange` | `/layout` | v2.1 renamed |
| `/normalize` | `/polish` | v2.1 merged — 併入 polish 的對齊角色 |
| `/onboard` | `/harden` | v2.1 merged — 併入 harden 的首次體驗範疇 |

## Breaking Change Timeline

- **v2.0**（2026-04-08）: 主 `impeccable` skill 取代 `frontend-design`；`teach-impeccable` 收為 `/impeccable teach`
- **v2.1**（2026-04-10）: 21 skill 收斂為 18；`arrange → layout`、`extract → /impeccable extract`；`normalize` 併入 `polish`；`onboard` 併入 `harden`；新增 `/shape`（獨立）

## What's New in v2 (not a rename)

- **`/shape`** — 獨立 skill，在寫 code 前做 UX/UI 規劃訪談產出 design brief。填補 v1 缺的「需求釐清」階段
- **`impeccable`（umbrella）** — 主 skill，封裝 `teach/craft/extract` 3 個 subcommand
- **擴大的 `/harden`** — 除原有邊界情況，再吸收 first-time UX（空狀態、tooltips、onboarding tour）
- **擴大的 `/polish`** — 除原有 final pass，再吸收 design system alignment（原 `/normalize` 角色）

## Reading Old Artifacts

若在 `openspec/changes/archive/` 或舊 commit message 看到 v1 名稱：
- 保留原樣，視為歷史紀錄
- 引用當時語意時，在括號內標註 v2 對應名，例如：`/arrange`（今 `/layout`）
- **不要**回填修改舊 artifact — 歷史就是歷史

## Expiring This File

此檔案僅為歷史對照用。當團隊記憶確定不再需要（通常在升級後 6-12 個月），可整份刪除，並從 SKILL.md 移除「Reference Resources」中對它的引用。
