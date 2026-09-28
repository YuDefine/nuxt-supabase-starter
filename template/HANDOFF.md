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

RUSH-69 主持者續行答覆（2026-09-28，保留原話）：

> fleet 沒有同時具備 Cloudflare＋Sentry＋NUXT_APP_ENV 的 consumer（perno 是 Docker、不算）。最接近的來源是 /home/charles/offline/nuxt-edge-agentic-rag：Cloudflare Workers／NuxtHub 部署、evlog（nuxt.config.ts:131、382），環境經 runtimeConfig 注入（nuxt.config.ts:60 NUXT_KNOWLEDGE_ENVIRONMENT）。做法：只唯讀（wrangler tail 或既有 evlog drain／NuxtHub log，NEVER 部署、NEVER 改該 repo），取一筆 production 事件的 environment 實值，並核對它是否走「Workers 注入 NUXT_* → useRuntimeConfig() module-eval snapshot」同一路徑。等價且讀得到 → 用它回答 TD-016 並記證據；機制不等價或讀不到（缺憑證等）→ TD-016 保持 open、在 summary 寫明原因，--complete 時 decision 改問 Charles 要不要另設一個 starter 的 Cloudflare 驗證部署。

- 工作來源：`/home/charles/offline/clade/tasks/2026-09-28-rush68/charles-answers-Q143-Q163.md` 的 Q160=A、Q161=用現有 Cloudflare consumer 讀數。當前實作在 `session/2026-09-28-1414-handoff-q143-answers`，改動 `docs/tech-debt.md`、`.github/workflows/template-ci.yml`、`template/packages/create-nuxt-starter/{src/assemble.ts,test/scaffold.test.ts,test/consumer-update-policy.test.ts,README.md}`。
- 已驗證：Codex CLI 0.157.1 在沒有 `.codex/rules` 的最小三件檔專案可讀 `.agents/skills`；scaffolder 相關 3 個測試檔 101/101 通過，scaffolder scoped `tsc`、`vp check`、pre-push Nuxt typecheck 通過。指定的 `npx tsc -p tsconfig.clade.json --noEmit` 因本 repo 沒有該 tsconfig 回 TS5058。draft PR #14 的 Template CI mechanical job 與 Validate Starter 綠；scaffold-smoke 紅在既有 TD-019 的 placeholder scan（main 同樣失敗），draft Unit tests skipped。
- TD-016 讀數：唯讀查 `nuxt-edge-agentic-rag` production D1 `evlog_events`，2026-09-28T06:18:16.095Z 的事件 `environment=production`；staging D1 一筆事件亦標 `production`，但 staging Wrangler 設 `NUXT_KNOWLEDGE_ENVIRONMENT=staging`。部署 SHA `0c4ca38f` 的 evlog `env` 沒有 `environment` 欄位，套件回退到 `NODE_ENV`／預設值；它沒有走 starter 的 `NUXT_APP_ENV → useRuntimeConfig()` 零參數路徑。詳證見 `docs/tech-debt.md` TD-016。故 TD-016 保持 open，不得用該讀數宣稱成立或結案；須由 Charles 決定是否另授權 starter Cloudflare 驗證部署。本 worker 未部署、未修改該 consumer。
- 其他接續：主持者擁有 `.claude/rules/starter-hygiene.md`，應把「忽略的 `.codex/`／`.agents/` 不會被 scaffold 帶走」改為「scaffold 會從 target `.claude/skills` 生成最小投影」；本 worker 不動該路徑。PR 0-A、ready、merge 與既有 TD-019／TD-021 CI 紅燈歸主持者或另派 owner，本 worker 不執行。
