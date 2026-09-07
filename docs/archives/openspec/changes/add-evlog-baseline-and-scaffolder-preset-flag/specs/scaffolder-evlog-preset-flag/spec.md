## ADDED Requirements

### Requirement: scaffolder CLI 支援 `--evlog-preset` flag

`packages/create-nuxt-starter/src/cli.ts` MUST 接受 `--evlog-preset <name>` flag，accept enum value：`none` / `baseline` / `d-pattern-audit` / `nuxthub-ai`。flag 沒帶時 default 為 `baseline`。

flag 值非預期時 MUST 印 error message + 列出可接受值，exit code 非 0。

#### Scenario: 帶 --evlog-preset baseline 跑 scaffolder

- **WHEN** `pnpm create nuxt-supabase-starter my-app --evlog-preset baseline`
- **THEN** scaffolder 跳過 evlog wizard 對話
- **AND** assemble.ts 跑 `applyPreset(targetDir, 'baseline')`，等於 starter template 主體保留（不改）
- **AND** target dir 含 evlog 7 個 file + nuxt.config.ts evlog block

#### Scenario: 帶 --evlog-preset none 跑 scaffolder

- **WHEN** `pnpm create nuxt-supabase-starter my-app --evlog-preset none`
- **THEN** scaffolder 跳過 evlog wizard 對話
- **AND** assemble.ts 跑 `applyPreset(targetDir, 'none')`，刪除 starter template 內 evlog 7 個 file + 移除 nuxt.config.ts evlog block
- **AND** target dir grep `useLogger` / `evlog` 在 server/ 0 命中

#### Scenario: 帶 --evlog-preset d-pattern-audit 跑 scaffolder

- **WHEN** `pnpm create nuxt-supabase-starter my-app --evlog-preset d-pattern-audit`
- **THEN** assemble.ts 套 baseline 後 overlay `presets/evlog-d-pattern-audit/` file
- **AND** target dir 含 audit-pattern hash chain helper

#### Scenario: 帶 --evlog-preset nuxthub-ai 跑 scaffolder

- **WHEN** `pnpm create nuxt-supabase-starter my-app --evlog-preset nuxthub-ai`
- **THEN** assemble.ts overlay `presets/evlog-nuxthub-ai/` file，替換 sentry drain 為 nuxthub D1 drain，加 ai-sdk-logger
- **AND** target dir 含 NuxtHub D1 drain plugin

#### Scenario: 帶不合法 flag 值

- **WHEN** `pnpm create nuxt-supabase-starter my-app --evlog-preset invalid-name`
- **THEN** scaffolder 印 error message，提示「--evlog-preset 只接受：none | baseline | d-pattern-audit | nuxthub-ai」
- **AND** exit code 非 0

### Requirement: scaffolder wizard mode 加 evlog preset 對話

`packages/create-nuxt-starter/src/prompts.ts` MUST 在 wizard mode（沒帶 `--evlog-preset` flag）對話中問 evlog preset 偏好，default 是 `baseline`。

對話 MUST 顯示 4 個選項與各自描述：

- `baseline` — T1 全套（drain pipeline + 5 件套 enricher + sampling/redaction）
- `d-pattern-audit` — baseline + audit hash chain（給有合規需求的 app）
- `nuxthub-ai` — 替換 sentry 為 NuxtHub D1 drain + AI SDK logger（給 NuxtHub stack）
- `none` — 不要任何 evlog（給「我自己 logging」的 user）

#### Scenario: wizard mode default 選 baseline

- **WHEN** `pnpm create nuxt-supabase-starter my-app`（沒帶 flag）
- **THEN** prompts 進入 evlog preset 問題，cursor default 在 `baseline`
- **AND** user 直接 enter 套 baseline

#### Scenario: wizard mode 選 none

- **WHEN** wizard 對話用方向鍵移到 `none` + enter
- **THEN** assemble.ts 跑 `applyPreset(targetDir, 'none')`

### Requirement: assemble.ts 提供 applyPreset helper

`packages/create-nuxt-starter/src/assemble.ts`（或 `src/evlog-preset.ts` helper）MUST 提供 `applyPreset(targetDir: string, preset: EvlogPreset): Promise<void>` function：

- `preset === 'baseline'` → no-op（starter template 已含 baseline）
- `preset === 'none'` → 刪除 `BASELINE_FILES` list 內所有 file + 移除 nuxt.config.ts evlog block
- `preset === 'd-pattern-audit'` → cp `presets/evlog-d-pattern-audit/` 內 file 到 targetDir 對應路徑（overlay）
- `preset === 'nuxthub-ai'` → cp `presets/evlog-nuxthub-ai/` 內 file 到 targetDir，覆蓋 baseline 的 sentry drain

`BASELINE_FILES` MUST 是明確 manifest（const array）— 之後新增 evlog file 進 starter template 必須同步更新此 list。

#### Scenario: applyPreset('none') 刪檔範圍

- **WHEN** scaffolder 跑 `applyPreset(targetDir, 'none')`
- **THEN** 下列 file 都被刪：
  - `server/plugins/evlog-drain.ts`
  - `server/plugins/evlog-enrich.ts`
  - `server/plugins/evlog-sentry-drain.ts`
  - `server/plugins/_evlog-drain.README.md`
  - `app/utils/evlog-identity.ts`
  - `docs/evlog-client-transport.md`
- **AND** `nuxt.config.ts` 的 `modules` 陣列移除 `'evlog'`
- **AND** `nuxt.config.ts` 的 `evlog: { ... }` config block 移除

### Requirement: assemble.ts 套 preset 後刪掉 presets/ 目錄

scaffolder 跑完 `applyPreset()` 後 MUST 刪除 `targetDir/presets/` 整個目錄（preset 套完不需保留）。

#### Scenario: target dir 不含 presets/

- **WHEN** scaffolder 完成 scaffold
- **THEN** `ls targetDir/presets/` 不存在

### Requirement: scaffolder README 含 `--evlog-preset` 章節

`packages/create-nuxt-starter/README.md` MUST 含 evlog preset 章節，列出 4 個值與各自使用情境。

#### Scenario: README 找得到 evlog preset 說明

- **WHEN** session agent 讀 `packages/create-nuxt-starter/README.md`
- **THEN** grep `--evlog-preset` 命中
- **AND** 4 個 preset 值都有描述
