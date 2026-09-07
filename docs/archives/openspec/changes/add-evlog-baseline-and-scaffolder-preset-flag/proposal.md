## Why

starter（`nuxt-supabase-starter/template`）是 5 consumer 的 reference 範本。clade evlog adoption M3a 階段已把 30 個 preset file（`evlog-baseline` / `evlog-d-pattern-audit` / `evlog-nuxthub-ai`）sync 進 `presets/` 目錄，但**starter template 自身**並未套用 evlog wiring — `node scripts/evlog-adoption-audit.mjs --repo /Users/charles/offline/nuxt-supabase-starter/template` 顯示 depth 3（drain pipeline 已套，enrichers < 4），不符合自家設定的 baseline 標準（depth 5）。

兩件事要同時做才能讓 starter 對得起「reference template」身分：

1. **starter 自家 wiring 升 depth 5** — 把 `presets/evlog-baseline/` 內 7 個 file 套進 starter template 主體（`server/plugins/evlog-*.ts`、`app/utils/evlog-identity.ts`、`nuxt.config.ts` evlog block 等）
2. **scaffolder CLI 加 `--evlog-preset` flag** — `pnpm create nuxt-supabase-starter my-app --evlog-preset baseline | d-pattern-audit | nuxthub-ai` 讓 user scaffold 時直接選 evlog tier，不用事後 cp preset

兩件不分開做的理由：starter 自家 wiring 升上去後，scaffolder 預設 baseline preset 已存在於 template，CLI flag 只是讓 user 切到別的 preset（d-pattern-audit / nuxthub-ai 是疊加 / 替換 baseline 的 file set）。先做 #1 再做 #2 順序自然。

## What Changes

- 把 `presets/evlog-baseline/` 7 個 file 套進 starter template 主體（拷貝到對應路徑：`app/utils/evlog-identity.ts`、`server/plugins/evlog-drain.ts` / `evlog-enrich.ts` / `evlog-sentry-drain.ts`、`docs/evlog-client-transport.md`）
- 修 starter `nuxt.config.ts`：套 `presets/evlog-baseline/PRESET.md` 內 pre-applied 範例的 evlog module block（含 sampling / redaction / client transport / typed fields）
- 改 scaffolder CLI（`packages/create-nuxt-starter/src/cli.ts` + `prompts.ts`）：加 `--evlog-preset <name>` flag，accept `none` / `baseline` / `d-pattern-audit` / `nuxthub-ai`
- 改 scaffolder `assemble.ts`：依 `--evlog-preset` 決定要套哪一組 preset file（merge 或覆蓋 starter 自家 baseline）
- 加 prompts 對話式問答對齊 flag（user 沒帶 flag 時 wizard mode 問 evlog preset 偏好）
- 跑 evlog-adoption-audit 驗證 starter depth ≥ 5（block signals 0/4）

## Non-Goals (optional)

- **不**做 `--multi-package` flag（M3b.3 — T4 layout overlay；獨立 spectra change scope）
- **不**改 `presets/*/` 目錄的 30 個 preset file（已由 clade `sync-evlog-presets.mjs` 管理；starter 端唯讀）
- **不**動 clade vendor snippets / clade 中央倉端任何檔（本 change 純粹 starter local）
- **不**支援 evlog version override flag（preset 鎖 evlog@2.16+；要動版本自己改 package.json）
- **不**重構 scaffolder feature module 系統（既有 `featureModules` 是另一條線）

## Capabilities

### New Capabilities

- `scaffolder-evlog-preset-flag`: scaffolder CLI `--evlog-preset` flag（含 `none` / `baseline` / `d-pattern-audit` / `nuxthub-ai` 4 個值）+ wizard mode 對話式問答 + assemble.ts 套 preset 邏輯
- `starter-evlog-baseline-wiring`: starter template 自身的 evlog T1 baseline wiring（drain pipeline + 5 件套 enricher + sampling / redaction / client transport）

### Modified Capabilities

（無 spec-level 改變；本 change 是 starter template 設定與 scaffolder behavior 擴充，不動既有 spec contract）

## Impact

- starter template 從「沒套 evlog wiring」升到「T1 baseline」— audit script 量到 depth 5
- scaffolder 用戶可一行指令 scaffold 不同 evlog tier 的 starter
- 既有 user（沒 `--evlog-preset` flag 跑舊版 scaffolder）行為不變（預設 `--evlog-preset baseline`，新 starter 開箱有 evlog；如需關掉用 `--evlog-preset none`）
- 新增 7 個 file 進 starter template 主體（不是 presets/ 目錄）— 散播到 5 consumer 的 starter 投影層（如有）
- 影響 `packages/create-nuxt-starter/` 內 4 個檔（`cli.ts` / `prompts.ts` / `assemble.ts` / 加 1 個 `evlog-preset.ts` helper）
