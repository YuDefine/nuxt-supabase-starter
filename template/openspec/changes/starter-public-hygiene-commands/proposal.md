## Why

`nuxt-supabase-starter` 的定位是「真的公開、任何人可 clone」的 Nuxt + Supabase scaffold seed。但目前 `template/.claude/commands/` 內 9 個 starter-owned slash command（非 clade-managed projection）混雜了 starter 維護者個人 release / dashboard / archive 流程，公開讀者 clone 之後會看到一堆對自家專案完全沒用的指令，且部分 command 內含個人 path / GitHub repo 引用。

關聯 change：

- `clade-starter-sanitization`（另開於 `~/offline/clade`）— 處理 L1 hub:sync clade-managed 內容（49 rules + 13 spectra skills + 3 commands + 5 agents + 2 scripts）跟 L2 plugin marketplace skill 的 starter-mode sanitization
- `starter-public-hygiene-skills`（後續）— 處理 53 個 starter-owned skills 個別 audit

本 change 只負責 L3 commands 層，scope 鎖死，避免「一條 change 同時動 commands + skills + clade-managed projection」三層混雜難 review。

`template/.claude/.hub-state.json` checksum 清單比對後確認的邊界：

| Surface                                                                                                                                                                      | clade-managed？ | 由誰治理                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------- |
| `template/.claude/commands/commit.md` / `db-migration.md` / `doc-sync.md`                                                                                                    | 是              | clade，本 change **不動** |
| `template/.claude/commands/canary.md` / `freeze.md` / `guard.md` / `retro.md` / `second-opinion.md` / `ship.md` / `sprint-status.md` / `unfreeze.md` / `validate-starter.md` | 否              | starter，本 change scope  |

## What Changes

**9 個 starter-owned commands 個別 hygiene 決策**：對每條 command 採取下列其一處置：

- **Keep as-is**：對公開讀者也通用，無 personal context leak（保留檔案內容）
- **Sanitize**：generic 流程但內含個人 path / repo 引用，replace placeholder 後保留
- **Remove from `template/`**：純 starter 維護者用、scaffold 出去的新 consumer 不會用（移到 root meta 或刪除）

**`validate-starter` relocation**：`validate-starter` 是 starter repo 本身的 self-validation tool（驗證 scaffold 出去後新 consumer 的完整性），不該被 scaffold 帶到使用者新專案。

- Source `../scripts/validate-starter.sh`（root meta，正確位置）保留
- `template/.claude/commands/validate-starter.md` slash command 移到 root `../.claude/commands/validate-starter.md`，並由 starter 自家 sync-to-agents 投影機制不再把該 command 散播進 `template/`
- `template/.agents/skills/validate-starter/` 跟 `template/.codex/agents/...` 等 projection 同步清理

**新 audit script `audit-public-hygiene.mjs`**：

- 掃 `template/.claude/commands/` + `template/.agents/skills/` + `template/.codex/`，對每個非 LOCKED-managed-by-clade 檔案檢查是否在 allowlist（本 change 通過審查的 starter-owned commands）內
- 偵測新加進 `template/.claude/commands/` 但未經本 change 審查的 starter-owned commands，CI 警告
- 偵測殘留的 `validate-starter` 等本 change 已移除的 projection 路徑，CI 擋

## Acceptance Criteria

1. 9 個 starter-owned commands 每條都有明確 disposition（design.md 內列表）+ 對應實作完成
2. `template/.claude/commands/validate-starter.md` 從 `template/` 移除，root `../.claude/commands/validate-starter.md` 與 `../scripts/validate-starter.sh` 維持可用
3. `template/.agents/skills/validate-starter/`、`template/.codex/` 內對應 projection 同步清理
4. `audit-public-hygiene.mjs` 跑過 `template/` 0 violation，並啟用於 root `package.json` `audit:public-hygiene` script + GitHub Actions
5. 公開讀者跑 `pnpm create nuxt-supabase-starter my-app` 後新 consumer `.claude/commands/` 不含 `validate-starter` / 任何本 change 標 Remove 的 command
6. `starter-hygiene.md` 規則檔補一節「L3 commands hygiene」說明本層治理邊界

## Path 層級宣告（跨層 change）

依 root `CLAUDE.md` 與 `.claude/rules/starter-hygiene.md` 跨層規約，本 change 從 `template/openspec/changes/starter-public-hygiene-commands/` cwd 視角：

- **template paths**：`.claude/commands/<name>.md`、`.agents/skills/<name>/`、`.codex/`、`docs/`
- **root paths**（用 `../` 表示）：`../.claude/commands/validate-starter.md`、`../scripts/validate-starter.sh`、`../scripts/audit-public-hygiene.mjs`、`../.claude/rules/starter-hygiene.md`、`../.github/workflows/`

tasks 與 design 內每個 task 明確標 `(template)` 或 `(root)`。
