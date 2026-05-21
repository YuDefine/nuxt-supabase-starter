---
description: Cloudflare Workers secret 管理規約 — single source of truth = GitHub Secret
paths: [".github/workflows/**/*.yml", "wrangler.toml", "wrangler.jsonc"]
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/runtime/cf-workers/secrets.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


# Cloudflare Workers Secrets

**Single source of truth = GitHub repo secret**。所有 worker runtime 用的 secret 一律走 GitHub Actions + `cloudflare/wrangler-action@v3` 的 `secrets:` input 推進 worker。

## MUST

- **MUST** 把所有 runtime secret 設在 GitHub repo secret，naming 對齊 `STAGING_<NAME>` / `PRODUCTION_<NAME>`（per-env）或 `<NAME>`（cross-env shared，限非敏感如 OAuth client id）
- **MUST** 在 `deploy-{staging,production}.yml` 用 `cloudflare/wrangler-action@v3` 並透過 `secrets: |` list + `env:` block 把 GitHub secret 推進 worker
- **MUST** 對應 worker runtime env 名稱（不帶 `STAGING_` / `PRODUCTION_` 前綴）— GitHub secret 帶前綴、worker runtime 不帶
- **MUST** rotation 只動 GitHub Secret（`gh secret set`），下次 deploy workflow 自動 sync 進 worker
- **MUST** 把 secret 值同步寫進 Notion「GitHub Secrets & 環境變數」page（per consumer），讓 rotation 時找得到 SoT

## NEVER

- **NEVER** 手動跑 `wrangler secret put <NAME>` 設 production / staging worker secret — 繞過正規流程，rotation 會脫節
- **NEVER** 把 secret 寫進 `wrangler.toml` 的 `[vars]` 區塊 — `[vars]` 是 plaintext，會在 worker dashboard 可見且 commit 進 git
- **NEVER** 在 `wrangler-action` 之外的 workflow step 直接 echo secret 到 `wrangler secret put` — 同樣繞過 SoT，且 echo 容易 leak 進 log
- **NEVER** dev / staging / production 共用同一條 secret（rotation 風險：一漏全崩）— 每個 env 獨立生成

## 唯一例外

只在以下情況可手動跑 `wrangler secret put`：

- **Bootstrap 初次 deploy 之前**：worker 尚未存在、deploy workflow 還沒跑過第一次，需要手動 push 初始 secret 才能讓 first deploy 不 crash。第一次 deploy 後立即把 secret 加進 workflow `secrets:` list，後續 rotation 走正規流程
- **緊急 incident response**：production secret 洩漏需立即 rotation，等不及下次 deploy。**必同時** `gh secret set` 更新 GitHub Secret + 開 issue / 在 commit message 註記，下次 deploy 會 overwrite 同值

## 推送流程範例（perno production）

```yaml
# .github/workflows/deploy-production.yml
- uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    command: deploy --env production
    secrets: |
      EVLOG_AUDIT_SECRET     # ← secret name 在 worker runtime 看到的
      SUPABASE_SECRET_KEY
      ...
  env:
    EVLOG_AUDIT_SECRET: ${{ secrets.PRODUCTION_EVLOG_AUDIT_SECRET }}  # ← GitHub secret name
    SUPABASE_SECRET_KEY: ${{ secrets.PRODUCTION_SUPABASE_SECRET_KEY }}
    ...
```

## Verify checklist（per consumer，CF Workers runtime）

- [ ] `deploy-{staging,production}.yml` 內 `wrangler-action` 步驟有 `secrets: |` list 列出所有 worker runtime 用到的 secret
- [ ] `env:` block 對應每個 secret 從 GitHub Secret pull（帶 `STAGING_` / `PRODUCTION_` 前綴）
- [ ] GitHub Secret 已設好對應的 `STAGING_<NAME>` + `PRODUCTION_<NAME>`（`gh secret list -R <repo>` 看得到）
- [ ] Notion「GitHub Secrets & 環境變數」page 該 consumer 段落有記載 secret 用途 + 對應值
- [ ] 沒人手動跑過 `wrangler secret put` 之外（檢查 `~/.wrangler/logs/` 有無近期 `secret put` 紀錄；有的話是 anti-pattern signal）

## 為什麼

- **Rotation 安全**：secret 只在 GitHub 一個地方更新，下次 deploy 自動推到 worker；不需要記得跑 `wrangler secret put` + 不會漏設 staging
- **Audit trail**：GitHub Secret 的修改有 log；`wrangler secret put` 沒有 audit
- **Consumer team handoff**：新 maintainer 只看 workflow yaml + Notion 就能看完整 secret 圖譜，不用問 “是不是還有什麼東西在 wrangler 裡？”
- **CI/CD reproducibility**：deploy workflow 是 declarative；手動 `wrangler secret put` 是 imperative side effect，破壞 reproducibility

## 反例（perno 2026-05-09）

HANDOFF.md 指引設 `EVLOG_AUDIT_SECRET` 同時走 `gh secret set` + `wrangler secret put`，把後者也當 first-class 步驟。實際上：

- `wrangler secret put` 之後 `deploy-production.yml` 沒列入 `EVLOG_AUDIT_SECRET` → 下次 deploy 不會 re-sync → rotation 時容易漏（GitHub Secret 改完，wrangler 沒重 push）
- staging worker 也得手動跑一次 `wrangler secret put`，跟 production 不同 secret，容易混
- Notion 沒記載這條 secret 值，rotation 時找不到 SoT

修法（已落地 commit `ad-hoc bcfde9c8` 之後）：把 `EVLOG_AUDIT_SECRET` 加進 `deploy-{staging,production}.yml` 的 `secrets:` list；GitHub Secret rename 成 `STAGING_EVLOG_AUDIT_SECRET` + `PRODUCTION_EVLOG_AUDIT_SECRET`；Notion 327b7911 page 補記載。後續 rotation 一律 `gh secret set` → push commit → 下次 deploy 自動 sync。
