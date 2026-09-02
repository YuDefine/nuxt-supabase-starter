# SOP 04 — prod DB 可達 vs CI 只 build

**Todo id**：`gate-04-deploy-prod-db`  
**路徑**：`docs/playbooks/04-deploy-prod-db.md`  
**看板 id**：`deploy-prod-db`

開場白：「現在跑 `gate-04-deploy-prod-db`（本檔）。**不要等人選。** 無公網 HTTPS prod DB → 預設套用選項 2。」

## Ready

| probe | 真 |
| --- | --- |
| `.claude/consumer-meta.json` 的 `deploy.deployTrigger` | `none`（沒有就寫成 `none`） |
| `.github/workflows/` 沒有 production deploy job | 檔名/job 不含 deploy-to-prod |
| intake / preset 不是 Cloudflare Workers 可達的 prod DB | `self-hosted-node` 或 prod URL 是 `*.ts.net` |

## 預設決策（agent 直接套）

**選項 2**：CI 只 build、不連 DB、不自動 deploy。`deployTrigger` 維持 `none`。deploy-track **不得**標 registry compliant，直到有 Worker / 公網可達的 prod DB URL。

選項 1（公網 HTTPS prod DB）只在保管處**已經**有非 `*.ts.net` 的 prod URL 時才升級。沒有就不要發明。

`self-hosted-node` / 無 prod HTTPS **NEVER** 默默抄 `wrangler-action`。

## NEVER

- **NEVER** 等「請你選 1 或 2」。
- **NEVER** 讓 workflow 對 `*.ts.net` 打 DB。
- **NEVER** 在本 consumer 手改 clade `registry/consumers.json` 把 deploy-track 標 compliant。
- **NEVER** 把 LXC {{LXC_ID}} 當 prod。

## Turns

### Turn 1 — 寫下決策

**跑**：確認 consumer-meta `deployTrigger: none`；`node scripts/deploy-trigger-check.ts`（有這支才跑）。

看板 → `verified`（predicate = 選項 2）。下一步寫「有 prod HTTPS 再升選項 1」。

### Turn 2 — Success probe

```bash
node scripts/deploy-trigger-check.ts
# 真：declared=none 且 derived=none 且 status=confirmed
# needs-approval 對 none 是預期（不會自動發版）
```

通過 → todo completed。registry compliant **只**在 clade home live audit 同意後寫回。
