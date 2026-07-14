---
description: 新 consumer 首次開 session 時 MUST 跑 golden-path-adoption audit，缺項主動補齊
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/golden-path-onboarding.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Golden Path Onboarding

**核心命題**：clade 的 `docs/golden-paths/` 定義了跨 consumer 共用的部署 / CI 樣板（Docker self-hosted deploy、Discord deploy-notify），`vendor/actions/` 有對應的 vendored composite action。但這些 golden path **不會自動套用**到新 consumer — 新 repo 開好後常整條漏掉，直到 user 手動發現才補。實證：cnc-link-dashboard / cnc-link-platform 兩個新 repo 一開始都沒有 Discord 部署通知。

這條 rule 把「對齊 golden path」變成 session 開場的反射動作，而非靠人肉發現。

## MUST

1. **首次在某 consumer 開 session 且該工作觸及 CI/CD / deploy / `.github/`** 時，**MUST** 先跑：

   ```bash
   node ~/offline/clade/scripts/audit-golden-path-adoption.mjs --consumer <consumer_id>
   ```

2. **status 非 `OK` 且非 `N/A`（DRIFT / MISSING）→ 主動補齊缺項，不等 user 開口要求**。補法對照 `docs/golden-paths/docker-self-hosted-deploy.md`：
   - `discord-action` 缺 → 該 vendored action 由 clade `sync-vendor.mjs` 投影，跑 propagate 補上 `.github/actions/discord-deploy-notify/`
   - `ci-notify-job` 缺 → 在 deploy / CI workflow 尾端加 `notify` job（`if: always()`，`uses: ./.github/actions/discord-deploy-notify`）
   - `webhook-secret` 未引用 → notify job 傳入 `webhook_url: ${{ secrets.DISCORD_WEBHOOK_URL }}`，並提醒 user 在 GitHub repo Actions secrets 設定該值（值本身 audit 查不到，標 `set=?`）

3. **`self-hosted-runner` 是 informational**：wrangler / Cloudflare 型 consumer 用 `ubuntu-latest` 合理，不因此判 drift。只有走 Docker self-hosted deploy 型（<consumer-a> / <consumer-b> / <consumer-d> / cnc-link-*）才 MUST 用 `[self-hosted, ...]` runner。

## Golden Path Checklist（目前項目）

| 項目 | 偵測 | 適用範圍 |
| --- | --- | --- |
| discord-deploy-notify action | `.github/actions/discord-deploy-notify/action.yml` 存在 | 所有有 deploy/CI 的 consumer |
| CI notify job | workflow 有 `uses: ./.github/actions/discord-deploy-notify` | 同上 |
| Discord webhook secret | workflow 引用 `secrets.DISCORD_WEBHOOK_URL` / `DISCORD_SENTRY_WEBHOOK_URL` | 同上（值需 user 在 GitHub 設定） |
| self-hosted runner | `runs-on: [self-hosted, ...]` | 只限 Docker self-hosted deploy 型 |

## NEVER

- **NEVER** 假設新 consumer 已對齊 golden path — 沒跑過 audit 前一律視為未知
- **NEVER** 把「補 golden path」當成等 user 要求才做的事 — DRIFT / MISSING 就主動補
- **NEVER** 因為 audit status 是 `N/A`（無 CI）就跳過 — 若該工作正在建立 CI/deploy pipeline，MUST 一併套 golden path

## 與其他機制的關係

- 完整 golden path 規格見 `docs/golden-paths/docker-self-hosted-deploy.md` 與 `docs/golden-paths/new-consumer-onboarding.md`
- audit script：`scripts/audit-golden-path-adoption.mjs`（diagnostic-only，exit 0）
- vendored action 的投影走既有 `sync-vendor.mjs` / propagate 流程，本 rule 不新增 propagate 機制
