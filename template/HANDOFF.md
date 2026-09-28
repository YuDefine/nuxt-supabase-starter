# HANDOFF

## User-gate board

SOP 全文在 `docs/playbooks/`（索引：[README](docs/playbooks/README.md)）。狀態只准：`ready-for-user` | `waiting` | `user-done-unverified` | `verified` | `blocked-unexpected`。

| id | 標題 | 狀態 | playbook | 上次 probe | 下一步 |
| --- | --- | --- | --- | --- | --- |
| `dev-database` | 連到已在跑的開發資料庫 | ready-for-user | [01](docs/playbooks/01-dev-database.md) | mint | 跑 SOP 01。禁止 logout；**NEVER** 碰 {{NEVER_TOUCH_PEER}} |
| `ssh-config` | 本機 `Host {{TAILSCALE_HOSTNAME}}` | ready-for-user | [02](docs/playbooks/02-ssh-config.md) | mint | 01 verified 後跑 SOP 02 |
| `google-oauth` | Google Console {{DEV_PORT}} URI | ready-for-user | [03](docs/playbooks/03-google-oauth.md) | mint | callback 是 `/auth/google`。**不要**改 {{NEVER_TOUCH_PEER}} 既有 URI |
| `deploy-prod-db` | CI 只 build | ready-for-user | [04](docs/playbooks/04-deploy-prod-db.md) | mint | 預設選項 2；`deployTrigger=none`；registry 不得 compliant |
| `post-gate-verify` | 達標 probe 包 | ready-for-user | [05](docs/playbooks/05-post-gate-verify.md) | mint | live audit 讀 **main**；worktree 綠 ≠ onboard 完成 |

達標指令（數字記 `docs/playbooks/PROGRESS.md`；live = **main checkout**）：

```bash
cd ~/offline/clade && node scripts/convention-conformance-audit.ts --live --consumer {{CONSUMER}}
node ~/offline/clade/scripts/audit-consumer-readiness.ts --consumer ~/offline/{{CONSUMER}} --gate
node ~/offline/{{CONSUMER}}/scripts/deploy-trigger-check.ts
```
