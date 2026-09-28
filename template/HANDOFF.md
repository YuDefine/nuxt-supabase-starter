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

## 2026-09-28 starter Q160／Q161／TD-004 後續指針

- 工作來源：`/home/charles/offline/clade/tasks/2026-09-28-rush68/charles-answers-Q143-Q163.md` 的 Q160=A、Q161=用現有 Cloudflare consumer 讀數。當前實作在 `session/2026-09-28-1414-handoff-q143-answers`，改動 `docs/tech-debt.md`、`.github/workflows/template-ci.yml`、`template/packages/create-nuxt-starter/{src/assemble.ts,test/scaffold.test.ts,test/consumer-update-policy.test.ts,README.md}`。
- 已驗證：Codex CLI 0.157.1 在沒有 `.codex/rules` 的最小三件檔專案可讀 `.agents/skills`；scaffolder 相關 3 個測試檔 101/101 通過，scaffolder scoped `tsc` 與 `vp check` 通過。指定的 `npx tsc -p tsconfig.clade.json --noEmit` 因本 repo 沒有該 tsconfig 回 TS5058。CI／PR 結論待該 branch push 後填入主持者接續紀錄。
- TD-016 剩餘：registry 的 Cloudflare consumer 中，starter 有 evlog 但無近期成功 `deploy.yml` 讀數；rental-scout 有成功部署但沒有 evlog/Sentry 接線；本機 `sentry-cli` 無 auth token。主持者須提供**既有**可讀的 Cloudflare＋Sentry／evlog 事件來源或存取路徑，唯讀取得真實 `environment` 後才能判定。不可新開部署。
- 其他接續：主持者擁有 `.claude/rules/starter-hygiene.md`，應把「忽略的 `.codex/`／`.agents/` 不會被 scaffold 帶走」改為「scaffold 會從 target `.claude/skills` 生成最小投影」；本 worker 不動該路徑。PR 0-A、ready、merge 與既有 TD-019／TD-021 CI 紅燈歸主持者或另派 owner，本 worker 不執行。
