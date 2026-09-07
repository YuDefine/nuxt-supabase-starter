## ADDED Requirements

### Requirement: scaffolder 提供 5 個 stack preset

`packages/create-nuxt-starter/src/presets.ts` MUST export `PRESETS` array 含下列 5 個 preset，每個 preset MUST 指定 `id` / `label` / `description` / `deploy` / `dbStack` / `evlogPreset` / `authDefault` / `ci`：

| Preset id               | Deploy     | DB stack   | Evlog preset | Auth 預設       | CI          | startEmpty |
| ----------------------- | ---------- | ---------- | ------------ | --------------- | ----------- | ---------- |
| `cloudflare-supabase`   | cloudflare | supabase   | baseline     | nuxt-auth-utils | ci-simple   | false      |
| `cloudflare-nuxthub-ai` | cloudflare | nuxthub-d1 | nuxthub-ai   | better-auth     | ci-simple   | false      |
| `vercel-supabase`       | vercel     | supabase   | baseline     | nuxt-auth-utils | ci-simple   | false      |
| `self-hosted-node`      | node       | supabase   | baseline     | nuxt-auth-utils | ci-advanced | false      |
| `minimal`               | cloudflare | supabase   | none         | none            | ci-simple   | true       |

`DEFAULT_PRESET_ID` MUST 是 `cloudflare-supabase`。

#### Scenario: getPresetById 取出 preset 定義

- **WHEN** `getPresetById('cloudflare-nuxthub-ai')`
- **THEN** 回傳的 PresetDefinition `dbStack` 是 `nuxthub-d1`
- **AND** `evlogPreset` 是 `nuxthub-ai`
- **AND** `authDefault` 是 `auth-better-auth`

#### Scenario: applyPreset 套 minimal 後從空集合起手

- **WHEN** `applyPreset(getPresetById('minimal')!)`
- **THEN** 回傳的 Set 不含 `database` / `ui` / `auth-nuxt-utils` / `auth-better-auth` / `monitoring`
- **AND** 仍含 `deploy-cloudflare` / `ci-simple`（preset 自帶的 deploy + ci）

### Requirement: scaffolder CLI 支援 `--preset` flag 接 5 個 stack id

`packages/create-nuxt-starter/src/cli.ts:buildSelectionsFromArgs` MUST 接受 `--preset <id>` flag，accept enum value：`cloudflare-supabase` / `cloudflare-nuxthub-ai` / `vercel-supabase` / `self-hosted-node` / `minimal`。flag 沒帶時等同 `--preset cloudflare-supabase`。

preset 預設值 MUST 可被 explicit flag 覆蓋：`--auth` 覆蓋 `authDefault`、`--ci` 覆蓋 `ci`、`--db` 覆蓋 `dbStack`、`--evlog-preset` 覆蓋 `evlogPreset`、`--with` / `--without` 覆蓋 feature set。

#### Scenario: --preset cloudflare-supabase 等同預設行為

- **WHEN** `pnpm create nuxt-supabase-starter my-app --preset cloudflare-supabase --yes`
- **THEN** 結果跟不帶 `--preset` 完全等價
- **AND** `dbStack=supabase`、`evlogPreset=baseline`、`deploymentTarget=cloudflare`

#### Scenario: --preset cloudflare-nuxthub-ai 自動鎖 dbStack + better-auth

- **WHEN** `pnpm create nuxt-supabase-starter my-app --preset cloudflare-nuxthub-ai --yes`
- **THEN** `dbStack=nuxthub-d1`、`evlogPreset=nuxthub-ai`
- **AND** features 含 `auth-better-auth`、不含 `auth-nuxt-utils`、不含 `database`（d1 模式 strip 掉）
- **AND** features 含 `monitoring`（evlog ≠ none 自動帶）

#### Scenario: --preset minimal 從空集合起手

- **WHEN** `pnpm create nuxt-supabase-starter my-app --preset minimal --yes`
- **THEN** features 不含 `database` / `ui` / `auth-*` / `monitoring`
- **AND** features 仍含 `deploy-cloudflare`、`ci-simple`（preset 自帶）
- **AND** `evlogPreset=none`

#### Scenario: --with 覆蓋 preset auth 預設

- **WHEN** `pnpm create nuxt-supabase-starter my-app --preset cloudflare-supabase --with auth-better-auth --yes`
- **THEN** features 含 `auth-better-auth`，不含 `auth-nuxt-utils`

#### Scenario: 未知 preset id

- **WHEN** `pnpm create nuxt-supabase-starter my-app --preset unknown-preset`
- **THEN** scaffolder fail 並印「--preset 只接受：cloudflare-supabase | cloudflare-nuxthub-ai | vercel-supabase | self-hosted-node | minimal」
- **AND** exit code 非 0

### Requirement: scaffolder 互動 wizard 第一步是 preset picker

`packages/create-nuxt-starter/src/prompts.ts:promptUser` MUST 在互動模式第一步問 stack preset（select widget），option 包含 5 個 PRESET id 各自的 label + description，外加第 6 個 option `custom`（走完整 15-prompt wizard）。initial value MUST 是 `cloudflare-supabase`。

選 5 個 stack preset 之一時 MUST 走 short wizard（只問 projectName / auth / UI / SSR / extras / state / testing / agentTargets 共 8 prompt）；被 preset 鎖死的 prompt（dbStack / evlogPreset / deploy / monitoring / ci）MUST 不出現。

選 `custom` 時 MUST 走完整 15-prompt wizard，行為跟舊版 `promptUser` 100% 一致，**完全不**套用任何 preset 預設值。

#### Scenario: 選 cloudflare-supabase preset 走 short wizard

- **WHEN** wizard 第一步選 `cloudflare-supabase`
- **THEN** 後續 prompt 共 8 個（含專案名）
- **AND** 不問「資料庫？」「部署目標？」「監控與錯誤追蹤？」「GitHub Actions CI 模式？」「Database stack？」「evlog preset？」
- **AND** 結果 selections 的 `dbStack=supabase`、`evlogPreset=baseline`、`deploymentTarget=cloudflare`

#### Scenario: 選 custom 走完整 wizard

- **WHEN** wizard 第一步選 `custom`
- **THEN** 後續 prompt 跟舊版 wizard 完全一致（15 個 prompt）
- **AND** preset 預設值不套用（user 完全自由組合）

#### Scenario: 選 cloudflare-nuxthub-ai 自動鎖 dbStack 不問

- **WHEN** wizard 第一步選 `cloudflare-nuxthub-ai`
- **THEN** auth 預設值 cursor 落在 `auth-better-auth`（preset 強制）
- **AND** 結果 `dbStack=nuxthub-d1`、`evlogPreset=nuxthub-ai`

### Requirement: 破壞性變更 — 舊 `--preset default / fast` 與 `--fast` 移除

`packages/create-nuxt-starter/src/cli.ts:buildSelectionsFromArgs` MUST 在收到下列舊 flag 值時直接 `failValidation()`，error message 必須含等價新寫法：

| 舊 flag            | error message MUST 提示的新寫法                                      |
| ------------------ | -------------------------------------------------------------------- |
| `--preset default` | `--preset cloudflare-supabase`                                       |
| `--preset fast`    | `--preset cloudflare-supabase --without testing-full,testing-vitest` |
| `--fast`           | `--without testing-full,testing-vitest`                              |

舊 flag MUST NOT 被靜默接受或當作 alias 套用——必須讓 user 明確改寫。

#### Scenario: --preset default 明確 fail

- **WHEN** `pnpm create nuxt-supabase-starter my-app --preset default`
- **THEN** scaffolder fail
- **AND** error message 含「--preset default 已移除」與「--preset cloudflare-supabase」

#### Scenario: --preset fast 明確 fail

- **WHEN** `pnpm create nuxt-supabase-starter my-app --preset fast`
- **THEN** scaffolder fail
- **AND** error message 含「--preset fast 已移除」與「--without testing-full,testing-vitest」

#### Scenario: --fast 明確 fail

- **WHEN** `pnpm create nuxt-supabase-starter my-app --fast`
- **THEN** scaffolder fail
- **AND** error message 含「--fast 已移除」與「--without testing-full,testing-vitest」

### Requirement: scaffolder docs 含 preset picker 章節

`docs/QUICK_START.md` 與 `docs/CLI_SCAFFOLD.md` MUST 含 stack preset 章節，列出 5 個 preset 各自的 (deploy / dbStack / evlogPreset / authDefault / ci)，並 MUST 含破壞性變更 migration table。

`README.md` 的 CLI Tool 段 MUST 提及 5 個 stack preset 名稱。

#### Scenario: docs 找得到 preset 列表

- **WHEN** session agent 讀 `docs/QUICK_START.md`
- **THEN** grep `cloudflare-supabase` 命中
- **AND** grep `cloudflare-nuxthub-ai` 命中
- **AND** grep `--preset default 已移除` 或 `migration` table 命中
