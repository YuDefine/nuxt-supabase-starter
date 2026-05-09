## ADDED Requirements

### Requirement: starter template 自身達 evlog T1 baseline depth ≥ 5

starter template (`nuxt-supabase-starter/template`) MUST 套 `presets/evlog-baseline/` 7 個 file 進 template 主體，且 `nuxt.config.ts` MUST 套 evlog module config block（含 sampling / redaction / client transport / typed fields）。`evlog-adoption-audit` MUST 量到 depth ≥ 5、block signals 0/4。

#### Scenario: starter clean checkout 後 audit script 量到 baseline

- **WHEN** clone starter template 後跑 `node /Users/charles/offline/clade/scripts/evlog-adoption-audit.mjs --repo $(pwd)`
- **THEN** depth estimate ≥ 5
- **AND** block signals 全為 0（drain.rawSentry / sampling.errorSampled / redaction.missingCore / consola.inServerApi 都 0）
- **AND** reference signals 顯示：useLogger.calls > 0、drain.pipelineWraps ≥ 1、sampling.policies ≥ 1、redaction.policies ≥ 1、enrichers.installed ≥ 4

##### Example: clean starter audit

| Signal                  | Expected Value |
| ----------------------- | -------------- |
| `useLogger.calls`       | ≥ 1            |
| `drain.pipelineWraps`   | ≥ 1            |
| `sampling.policies`     | ≥ 1            |
| `redaction.policies`    | ≥ 1            |
| `enrichers.installed`   | ≥ 4            |
| `drain.rawSentry`       | 0              |
| `sampling.errorSampled` | 0              |
| `redaction.missingCore` | 0              |
| `consola.inServerApi`   | 0              |

### Requirement: starter 必須含 evlog 7 個 file

starter template 主體 MUST 含下列 file（從 `presets/evlog-baseline/` cp 來）：

- `server/plugins/evlog-drain.ts`
- `server/plugins/evlog-enrich.ts`
- `server/plugins/evlog-sentry-drain.ts`
- `server/plugins/_evlog-drain.README.md`
- `app/utils/evlog-identity.ts`
- `docs/evlog-client-transport.md`

`nuxt.config.ts` MUST 含 evlog block：modules 加 `evlog`、加 `evlog: { sampling: {...}, redact: {...}, transport: {...}, fields: {...} }` config。

#### Scenario: 7 個 file + nuxt.config.ts evlog block 都在

- **WHEN** session agent 從 starter template 看 file tree
- **THEN** 上述 6 個 file path 都存在
- **AND** `nuxt.config.ts` grep `'evlog'` 命中 modules array + `evlog: {` config block

### Requirement: starter `.env.example` 含 evlog 環境變數

starter `.env.example` MUST 含 evlog 相關環境變數佔位：

- `SENTRY_DSN`
- `NUXT_PUBLIC_SENTRY_DSN`
- `EVLOG_CLIENT_RATE_LIMIT_PER_MIN=100`

#### Scenario: scaffold 出來的 app 有完整 .env.example

- **WHEN** scaffold 出新 app
- **THEN** `.env.example` 含上述 3 條環境變數佔位
