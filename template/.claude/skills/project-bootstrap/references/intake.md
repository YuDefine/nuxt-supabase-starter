# Project Bootstrap Intake

問題樹 SoT 是 starter 的 `template/packages/create-nuxt-starter/src/question-catalog.ts`。
本檔**不得**另寫一組選項標籤。AI 引導不經 CLI 時，MUST Read 該檔，用裡面的 `prompt` 與 `options[].label` 問每一題 `when` 為真的 id。使用者訊息裡已經答過的可以跳過。

`--yes` 只代表「答案已齊、不要再出現 TTY prompt」，不是「用預設值略過沒問的題」。

## 最少輸入

| 欄位 | 推導順序 | 無法推導時 |
| --- | --- | --- |
| `mode` | target path 是否存在且有 repo | 無預設，按 predicate 分流 |
| `project_name` | target basename / package.json name | 使用者給的產品 slug |
| `target_path` | 使用者路徑 | `$HOME/offline/<project-name>` |
| `starter_preset` | 使用者 stack/deploy 語意 | 無；見下表。套件名叫 supabase-starter **不得**因此預設本機 Docker |
| `db_host` | catalog `db-host`（Supabase 軌必問） | 無；`this-machine` 或 `existing-server` |
| `register_fleet` | catalog `register-fleet` | 無；要登記才繼續 fleet 題 |
| `repo_id` | catalog `repo-id` / git remote | 登記時必填 `owner/專案名` |
| `agent_targets` | 使用者工具偏好 | 無固定預設可略過 catalog 外的偏好；沒說就問 |
| `workflow_model` | catalog `workflow-model` | 登記時必問 |
| `business_activity` | catalog `business-activity` | 登記時必問 |
| `dev_port` | catalog `dev-port` | 登記時必問；`auto` 或自填 |
| `deploy_track` | catalog `deploy-track` | 登記時必問 |

## AI 必須問的 catalog 題

先 Read `$NUXT_STARTER_HOME/template/packages/create-nuxt-starter/src/question-catalog.ts`（沒設環境變數就 `$HOME/offline/nuxt-supabase-starter/...`）。

| catalog `id` | CLI flag | 何時問 |
| --- | --- | --- |
| `db-host` | `--db-host this-machine \| existing-server` | `when: supabase`（stack 是 Supabase 且有 database feature） |
| `register-fleet` | `--register-consumer` / `--no-register-consumer` | 永遠 |
| `repo-id` | `--repo-id owner/專案名` | 選了要登記 |
| `workflow-model` | `--workflow-model` | 選了要登記 |
| `business-activity` | `--business-activity` | 選了要登記 |
| `dev-port` | `--dev-port auto \| <port>` | 選了要登記 |
| `deploy-track` | `--deploy-track` | 選了要登記 |

preset 已經決定的事（部署平台、DB 種類、CI、evlog）不要再問一遍。catalog 題**不是** preset 能代替的：「只有無法安全推導的才問」**不適用**這些 id。

選項文案用 catalog 的 `label`。**NEVER** 把選項寫成 LXC、CT、<consumer-b>、playbook 編號——那些是後續文件，不是給新人的第一個問題。

## Starter preset mapping

| Preset | DB | Deploy | Auth default | CI | Evlog | Clade runtime direction |
| --- | --- | --- | --- | --- | --- | --- |
| `cloudflare-supabase` | Supabase | Cloudflare Workers | nuxt-auth-utils | simple | baseline | `db-schema=supabase`, `db-runtime=cf-workers`, `runtime=cf-workers` |
| `cloudflare-nuxthub-ai` | NuxtHub D1 | Cloudflare Workers | Better Auth | simple | nuxthub-ai | `db-schema=cf-d1`, `db-runtime=cf-workers`, `runtime=cf-workers` |
| `self-hosted-node` | Supabase | Node server | nuxt-auth-utils | advanced | baseline | `db-schema=supabase-self-hosted`, `db-runtime=supabase-self-hosted`, `runtime=nitro-self-hosted` |
| `minimal` | none at scaffold | Cloudflare Workers | none | simple | none | 只適合明確要求最小專案；後續加 DB/auth 時重跑 module review |

`self-hosted-node` 的 `deploy_track` **NEVER** 默默抄 `wrangler-action`。無公網 HTTPS prod DB URL → `deployTrigger=none`，deploy-track **不得**宣告 `compliant`。`verify-channels=full` 需要 `dev-login=adopted`；dev-login 仍 `none` 時宣告 full 必須 fail-loud。

starter source of truth 是 `packages/create-nuxt-starter/src/presets.ts` 與 CLI `--help`；表格和實跑不一致時以 source/CLI 為準，停止並修本 reference。

## 溝通期 BOM

尚無 `.claude/hub.json` 時，conventions 走：

```bash
node "$CLADE_HOME/scripts/bp-scan.ts" --plan --json --modules '<modules JSON>'
```

`--modules` 用上表 Clade runtime direction（加上 `auth` / `framework=nuxt`）。plugin / rule / skill 走 `projectionPlan({ cladeRoot, manifest })`（`scripts/audit-projection-invariant.ts`），manifest 用 `resolveParsed({ version, modules })`。不准另寫投影模擬。這張表不是 catalog 題；不要跟 `question-catalog.ts` 的選項混問。不要自動 `/bp record`。

UI／有前端：BOM 之後立刻 Read `impeccable-follow-up.md`。scaffold／projection 成功後 agent **MUST 自己**逐 id 檢查；缺的 MUST 問 user 直到齊並寫進檔。**NEVER** 把那些題寫進 `question-catalog.ts` 或 CLI flags。**NEVER** 把後續引導寫成請人類手打 slash command。

## `db_host` 答完之後

| 值 | 語意 | 接下來 | 禁令 |
| --- | --- | --- | --- |
| `this-machine` | 這台電腦 Docker 起一份資料庫，適合第一次試 | 收尾 `pnpm run setup` / 本機 `supabase start`；型別用 `--local` | 不要把「連到別台伺服器」的 playbook 當成必做 |
| `existing-server` | 另一台已經在跑的伺服器，這台只連過去 | 收尾 playbook 01；`db-runtime` 依 preset | **NEVER** 本機 `supabase start`；**NEVER** 本機 `supabase gen types --local` |

D1 / void 軌沒有 `db-host`。沒答之前 **NEVER** 把收尾寫成本機 start 或「連既有伺服器」其中唯一一條。

## 必須拍板的 business variants

只有需求真的存在才問，不用一次把所有選項丟給使用者：

- `user-lifecycle`：系統會管理可停用/離職/刪除的正式使用者時才選。
- `audit-trail`：法遵、不可竄改證據或高價值交易需要時才選 d-pattern。
- `deploy-track`：catalog 已問初值；若實際部署平台不同才覆寫。`self-hosted-node` **NEVER** 抄 `wrangler-action`。無公網 HTTPS prod DB → 保持 `deployTrigger=none`，deploy-track 不得 `compliant`。
- `verify-channels`：不得在 `dev-login` 仍 `none` 時宣告 `full`（hard dependency；`convention-conformance-audit.ts --gate` 會擋）。
- `preview_db` / `data_branching`：團隊已要求 PR 隔離資料環境時才升級，否則先 `none`。
- `canary_eligible`：只有壞掉不會擋到人的 repo 才設 true，不以「新專案」自行推論。
