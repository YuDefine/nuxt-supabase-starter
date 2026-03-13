## Why

目前 CI 只做 lint + typecheck + unit test。TDMS 的 CI 還包含 migration push、table owner 驗證、以及 Cloudflare Workers 部署。Starter 的 CI/CD 需要展示完整的 production pipeline，讓使用者 fork 後只需設定 secrets 即可自動部署。

## What Changes

### Infrastructure（clean 版保留）

- 更新 `.github/workflows/ci.yml`：
  - 新增 Supabase CLI setup step
  - 新增 `supabase db push` step（推送 migration 到遠端）
  - 新增 table owner 驗證 step（防止 MCP DDL 問題）
  - 新增 `supabase db lint` step
- 建立 `.github/workflows/deploy.yml`：
  - Cloudflare Workers 部署 workflow
  - 從 GitHub Secrets 注入環境變數
  - 支援 staging / production 環境切換
  - Build → Deploy → Smoke test 步驟
- 更新 `wrangler.toml`：
  - 補齊 production 配置範例
  - 環境變數佔位符說明
- 建立 `.github/PULL_REQUEST_TEMPLATE.md`：PR template

## Capabilities

### New Capabilities

- `ci-database-verification`: CI 中的 migration push + table owner check
- `cd-cloudflare-deploy`: Cloudflare Workers 自動部署 workflow
- `pr-template`: PR 描述模板

### Modified Capabilities

(none)

## Impact

- 修改 `.github/workflows/ci.yml` (infrastructure)
- 新增 `.github/workflows/deploy.yml` (infrastructure)
- 修改 `wrangler.toml` (infrastructure)
- 新增 `.github/PULL_REQUEST_TEMPLATE.md` (infrastructure)
- 全部為 infrastructure，clean 版保留
- 不需要 migration
- 注意：需在 GitHub Secrets 設定 CLOUDFLARE_API_TOKEN、SUPABASE_ACCESS_TOKEN 等
