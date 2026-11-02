---
description: Cloudflare Workers secret 管理規約 — single source of truth = GitHub Secret，CI 以 void secret sync 注入
paths: [".github/workflows/**/*.yml", "void.config.ts"]
---
<!-- Clade native rule; source: rules/modules/runtime/cf-workers/secrets.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Cloudflare Workers Secrets

**Single source of truth = GitHub repo secret**。所有 worker runtime 用的 secret 一律由 GitHub Actions 在 `void deploy` 前寫成暫存 dotenv，經 `void secret sync <dotenv>` 推進 worker，用畢刪檔（cloudflare-workers § 7.2）。非 void 的純 Worker 改用 `cf workers secrets bulk`，SoT 與流程不變。

遷移期仍停在舊 deploy 軌道、`registry/consumers.json` 的 `deploy-track` 尚為舊值的既有 consumer，其現有 workflow 的 secret 注入維持原狀、不得為提早合規自行拆掉，見 [[cloudflare-workers]] § 6；新設與遷移後一律照本檔。

## MUST

- **MUST** 把所有 runtime secret 設在 GitHub repo secret，naming 對齊 `STAGING_<NAME>` / `PRODUCTION_<NAME>`（per-env）或 `<NAME>`（cross-env shared，限非敏感如 OAuth client id）
- **MUST** 在 deploy workflow 的 `void deploy` 之前，先釘 void platform（`.void/project.json` 寫 `{"platform":"cloudflare"}`；`.void/` 不進 Git，CI 沒釘就掉進 Void Cloud 路徑報 Not logged in，見 cloudflare-workers § 7.2），再用 `env:` block 從 GitHub secret 取值、以 `printf '%s\n'` 寫成暫存 dotenv（key 為 worker runtime 名稱），跑 `void secret sync <dotenv>`，並用 `trap` 保證失敗也刪檔；**NEVER** 把 dotenv 留在 artifact、cache 或 log
- **MUST** 讓每條 deploy workflow 只 sync 自己那個 Worker 的 secret：void 直連 Cloudflare 時一份 `void.config.ts` 的 `cloudflare` 區塊只對一個 Worker（`cloudflare.name`），`void deploy`／`void secret` 沒有 env／staging 旗標、也拒收 `--project`。只有一個 Worker 就只寫 production workflow；有獨立 staging Worker 時，staging workflow **MUST** 部署到另一份 Cloudflare 設定指向的 Worker，**NEVER** 把 `STAGING_*` 的值 sync 進 production Worker
- **MUST** 對應 worker runtime env 名稱（不帶 `STAGING_` / `PRODUCTION_` 前綴）— GitHub secret 帶前綴、worker runtime 不帶
- **MUST** rotation 只動 GitHub Secret（`gh secret set`），下次 deploy workflow 自動 `void secret sync` 進 worker
- **MUST** 把 secret 值寫進 Notion「GitHub Secrets & 環境變數」page（per consumer）。**義務綁的是「收到明文的當下」，不是「改動 secret 值時」** —— 全文與唯一例外的措辭在 [[secret-custody]]，本條只是它在 Workers 面的入口

## NEVER

- **NEVER** 在 deploy workflow 的 `void secret sync` 之外手動或另開 step 推 production / staging worker secret（`void secret put` / `cf workers secrets` 皆同）— 繞過 SoT，rotation 會脫節，且容易 leak 進 log
- **NEVER** 把 secret 寫進 `void.config.ts` 的 `cloudflare` vars（或任何 tracked 設定檔的 plaintext vars）— plaintext 會在 worker dashboard 可見且 commit 進 git
- **NEVER** dev / staging / production 共用同一條 secret（rotation 風險：一漏全崩）— 每個 env 獨立生成

## 唯一例外

只在以下情況可手動推 secret，用 `void secret put`（非 void Worker 照 `cf-cli` skill § Worker secret；值不進 argv）：

- **Bootstrap 初次 deploy 之前**：worker 尚未存在、deploy workflow 還沒跑過第一次，需要手動 push 初始 secret 才能讓 first deploy 不 crash。第一次 deploy 後立即把 secret 加進 workflow 的 dotenv 寫入步驟，後續 rotation 走正規流程
- **緊急 incident response**：production secret 洩漏需立即 rotation，等不及下次 deploy。**必同時** `gh secret set` 更新 GitHub Secret + 開 issue / 在 commit message 註記，下次 deploy 會 overwrite 同值
- **移除殘留 binding**：secret 已從 workflow 的 dotenv 寫入步驟與 GitHub Secret 拿掉、且拿掉後的 deploy 已跑完，Worker 上仍留著舊 binding（`void secret sync` 只 upsert、不刪）。只准 `void secret delete`（非 void Worker 用 `cf workers secrets delete`），**NEVER** 藉此推新值

## 推送流程範例（production）

```yaml
# .github/workflows/deploy-production.yml
# void secret 依 .void/project.json 的 platform 選後端；.void 不進 Git，CI 要先釘 cloudflare
- name: Pin void platform
  run: mkdir -p .void && printf '{"platform":"cloudflare"}\n' > .void/project.json
- name: Sync runtime secrets
  run: |
    umask 077
    trap 'rm -f "$RUNNER_TEMP/runtime.env"' EXIT          # ← sync 失敗也刪檔
    {
      printf 'EVLOG_AUDIT_SECRET=%s\n' "$EVLOG_AUDIT_SECRET"   # ← key 是 worker runtime 看到的名稱
      printf 'SUPABASE_SECRET_KEY=%s\n' "$SUPABASE_SECRET_KEY"
    } > "$RUNNER_TEMP/runtime.env"
    pnpm exec void secret sync "$RUNNER_TEMP/runtime.env"
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    EVLOG_AUDIT_SECRET: ${{ secrets.PRODUCTION_EVLOG_AUDIT_SECRET }}  # ← GitHub secret name
    SUPABASE_SECRET_KEY: ${{ secrets.PRODUCTION_SUPABASE_SECRET_KEY }}
- name: Deploy via void
  run: pnpm run void:deploy
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

## Verify checklist（per consumer，CF Workers runtime）

- [ ] 每條 deploy workflow 在 `void deploy` 前有 Pin void platform 與 `void secret sync` 步驟，dotenv 涵蓋所有 worker runtime 用到的 secret，且以 `trap` 保證同一 step 內刪檔；有 staging workflow 時它指向另一個 Worker
- [ ] `env:` block 對應每個 secret 從 GitHub Secret pull（帶 `STAGING_` / `PRODUCTION_` 前綴）
- [ ] GitHub Secret 已設好對應的 `PRODUCTION_<NAME>`（有獨立 staging Worker 時加 `STAGING_<NAME>`；`gh secret list -R <repo>` 看得到）
- [ ] Notion「GitHub Secrets & 環境變數」page 該 consumer 段落有記載 secret 用途 + 對應值
- [ ] 沒有例外情境以外的手動 secret 異動（`cf workers versions list --worker-id <name>`，ID 或名稱皆可）。deploy workflow 的 `void secret sync` 本身也會產生 secret 異動的 version，**NEVER** 單看 version metadata 判來源：把 secret 異動的 version 的建立時間對 `gh run list --workflow <deploy workflow>` 的 run 時間，對不上任何 deploy run 的才是 anti-pattern signal

## 為什麼

- **Rotation 安全**：secret 只在 GitHub 一個地方更新，下次 deploy 自動推到 worker；不需要記得手動推 secret + 不會漏設 staging
- **Audit trail**：GitHub Secret 的修改有 log；手動推 secret 沒有 audit
- **Consumer team handoff**：新 maintainer 只看 workflow yaml + Notion 就能看完整 secret 圖譜，不用問 “是不是還有什麼東西手動推在 worker 上？”
- **CI/CD reproducibility**：deploy workflow 是 declarative；手動推 secret 是 imperative side effect，破壞 reproducibility

## 反例

把手動推 secret（`void secret put` / `cf workers secrets`）與 `gh secret set` 並列成 first-class 步驟（例如交接文件寫「兩個都跑」）：

- deploy workflow 沒列入該 secret → 下次 deploy 不會 re-sync → rotation 時容易漏（GitHub Secret 改完，worker 沒重 sync）
- staging worker 也得手動跑一次，跟 production 不同 secret，容易混
- Notion 沒記載這條 secret 值，rotation 時找不到 SoT

修法：把該 secret 加進 deploy workflow 的 dotenv 寫入步驟；GitHub Secret 改成 `PRODUCTION_<NAME>`（有獨立 staging Worker 時加 `STAGING_<NAME>`）；Notion page 補記載。後續 rotation 一律 `gh secret set` → push commit → 下次 deploy 自動 `void secret sync`。
