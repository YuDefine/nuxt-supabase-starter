---
description: 新 consumer 首次開 session 時 MUST 跑 golden-path-adoption audit，缺項主動補齊；onboarding 必動的 manifest / meta / 入口檔上 path-scoped 載入
paths:
  - '.clade/manifest.json'
  - '.claude/hub.json'
  - '.claude/consumer-meta.json'
  - 'package.json'
  - 'README.md'
  - 'CLAUDE.md'
  - 'AGENTS.md'
  - 'scripts/init-consumer.ts'
  - 'scripts/register-consumer.ts'
---
<!-- Clade native rule; source: rules/core/golden-path-onboarding.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Golden Path Onboarding

`docs/golden-paths/` 的部署 / CI 樣板（Docker self-hosted deploy、Discord deploy-notify）**不會自動套用**到新 consumer；本規約把對齊變成 session 開場的反射動作。

## MUST

1. **首次在某 consumer 開 session 且該工作觸及 CI/CD / deploy / `.github/`** 時，**MUST** 先跑：

   ```bash
   node ~/offline/clade/scripts/audit-golden-path-adoption.ts --consumer <consumer_id>
   ```

2. **status 非 `OK` 且非 `N/A`（DRIFT / MISSING）→ 主動補齊缺項，不等 user 開口要求**。補法對照 `docs/golden-paths/docker-self-hosted-deploy.md`：
   - `discord-action` 缺 → 該 vendored action 由 clade `sync-vendor.ts` 投影，跑 propagate 補上 `.github/actions/discord-deploy-notify/`
   - `ci-notify-job` 缺 → 在 deploy / CI workflow 尾端加 `notify` job（`if: always()`，`uses: ./.github/actions/discord-deploy-notify`）
   - `webhook-secret` 未引用 → notify job 傳入 `webhook_url: ${{ secrets.DISCORD_WEBHOOK_URL }}`，並提醒 user 在 GitHub repo Actions secrets 設定該值（值本身 audit 查不到，標 `set=?`）

3. **`self-hosted-runner` 是 informational**：wrangler / Cloudflare 型 consumer 用 `ubuntu-latest` 合理，不因此判 drift。只有走 Docker self-hosted deploy 型的 consumer 才 MUST 用 `[self-hosted, ...]` runner。

4. **同一時機 MUST 一併跑 CI gate 接線稽核**（clade 散播的 blocking gate 只跑在 `.husky/pre-push`，`--no-verify` 與 web 編輯介面都能繞過）：

   ```bash
   node ~/offline/clade/scripts/audit-gate-coverage.ts
   ```

   § 2「CI composite action 載體」報「已散播但沒有任何 workflow 引用 → 從未執行」的，**MUST** 依 `docs/golden-paths/clade-gate-ci.md` 的範本補上 `clade-gates` job，同樣不等 user 開口要求。**每一個**有 `.github/workflows/` 的 consumer 都適用。

5. **沒有 `.github/workflows/` 不是 `N/A`，是缺 baseline CI**（convention `consumer-baseline-ci`）。已 onboard 的 consumer MUST 至少有一支會在 PR head 上掛 check 的 workflow（`pull_request`，或不限 branch 的 `push`）；沒有就先補（starter `ci-simple.yml` ＋ `docs/golden-paths/clade-gate-ci.md` 的 `clade-gates` job），再往下做其他工作。沒有 CI 的 PR 拿不到 check，0-A 的「CI 綠才審」與 merge-queue 都卡在空 rollup。只有 `pending_onboard` 可以暫時沒有 CI——但這段期間它的 PR 過不了 0-A 的 CI 閘（`ci-applicability.ts` 對零支 workflow 判 pending），所以補 CI 是它第一張要合的 PR；移除 `pending_onboard` 前 `audit-new-project-readiness.ts` 的 `ci.pull-request-workflow` MUST 通過。

## Golden Path Checklist（目前項目）

| 項目 | 偵測 | 適用範圍 |
| --- | --- | --- |
| discord-deploy-notify action | `.github/actions/discord-deploy-notify/action.yml` 存在 | 所有有 deploy/CI 的 consumer |
| CI notify job | workflow 有 `uses: ./.github/actions/discord-deploy-notify` | 同上 |
| Discord webhook secret | workflow 引用 `secrets.DISCORD_WEBHOOK_URL` / `DISCORD_SENTRY_WEBHOOK_URL` | 同上（值需 user 在 GitHub 設定） |
| self-hosted runner | `runs-on: [self-hosted, ...]` | 只限 Docker self-hosted deploy 型 |
| baseline CI | 至少一支 `pull_request` 或不限 branch 的 `push` 觸發的 workflow（`audit-new-project-readiness.ts` 的 `ci.pull-request-workflow`） | **每一個**已 onboard 的 consumer（含 `integration-target`） |
| clade-managed CI gate 接線 | workflow 有 `uses: ./.github/actions/review-rules-scan` 與 `scripts/pre-push/checks/` 的 blocking 全站 check step（`node scripts/audit-gate-coverage.ts` § 2 驗；範本 `docs/golden-paths/clade-gate-ci.md`） | **每一個**有 `.github/workflows/` 的 consumer |

## NEVER

- **NEVER** 假設新 consumer 已對齊 golden path — 沒跑過 audit 前一律視為未知
- **NEVER** 把「補 golden path」當成等 user 要求才做的事 — DRIFT / MISSING 就主動補
- **NEVER** 因為 audit status 是 `N/A`（無 CI）就跳過 — 沒有 CI 本身就是缺項（MUST 5）；建 CI/deploy pipeline 時 MUST 一併套 golden path

## 相關

- 規格詳見 `docs/golden-paths/docker-self-hosted-deploy.md`、`docs/golden-paths/new-consumer-onboarding.md`、`docs/golden-paths/clade-gate-ci.md`
- `audit-golden-path-adoption.ts` diagnostic-only（exit 0）、`audit-gate-coverage.ts` warn-only；gate 強制力對照 `docs/enforcement-matrix.md`
