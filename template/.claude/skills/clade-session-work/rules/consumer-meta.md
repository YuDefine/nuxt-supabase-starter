---
description: 每個 consumer 自宣告 .claude/consumer-meta.json，描述 dev port / auth / database / deploy / verification 等 runtime 事實；clade 聚合成 registry/consumers-meta.json snapshot 供規則 / skill / audit 使用
paths: ['.claude/consumer-meta.json', 'registry/consumers-meta.json', 'registry/consumer-meta.schema.json', '.github/workflows/**']
---
<!-- Clade native rule; source: rules/core/consumer-meta.md; edit canonical source -->
<!-- clade-targets: claude,codex -->

# Consumer Meta（per-consumer 自宣告 + clade 聚合 snapshot）

consumer 的 runtime 事實（dev port、auth provider、DB、deploy platform、OAuth port-pin）收口成：

1. **每個 consumer** 在自家 repo 加 git-tracked 的 `.claude/consumer-meta.json`，依 `registry/consumer-meta.schema.json`
2. **clade aggregator**（`scripts/sync-consumer-meta.ts`）拉各 consumer 的 meta，對 `package.json` / `wrangler.toml` / `nuxt.config.ts` / `.env.example` cross-validate，derived 欄位帶 `source:` provenance
3. **聚合 snapshot** 寫到 `registry/consumers-meta.json`，給規則 / skill / audit 讀；範例在 `vendor/snippets/consumer-meta/`

## 設計原則

| 原則 | 內容 |
|---|---|
| **Declarative > Derivable** | manifest **只放**不能穩定推導的事實（auth provider、leaseMode、OAuth pin 與否）。框架版本、依賴清單、wrangler project name 等**可推導**欄位由 aggregator 從 source file 讀取並驗證，不寫進 manifest |
| **Cross-validation** | aggregator 對每個欄位驗一致性：consumer-meta 宣告 `dev.ports[0].port=3000` → aggregator 讀 `package.json scripts.dev` 確認真有 `--port 3000`；不一致 → 寫 `validation.errors` 進 snapshot |
| **Source provenance** | snapshot 內每個 derived 欄位附 `source: <relative-path>:<line-or-key>`，讓後續讀者知道事實從哪來 |
| **No secrets** | manifest **NEVER** 含 password / token / API key。只記 env var **名稱**，值由各 consumer 自家 `.env.local` 解析 |

## Aggregator 行為

`node scripts/sync-consumer-meta.ts` 經 `registry/consumers.local.json` 解析各 consumer path，schema 驗證後 cross-validate（`dev.ports[].port` vs `scripts.dev --port`、`auth.provider` vs dependencies、`deploy.platform` vs `wrangler.toml`、`commands.*` vs `package.json scripts`），每個 consumer 寫成 `{ declared, derived, validation: { manifest, manifestNote, warnings, errors } }`。schema 驗證失敗 → exit 1，但 snapshot 仍寫出。

`validation.manifest` 是一等採用狀態欄位：`present`／`missing`（路徑在、沒有 manifest）／`repo-absent`（consumers.local 路徑整個不存在，名單過期）／`not-listed`（registry 有、consumers.local 沒有的名單涵蓋註記）。缺 manifest **不**混進 `warnings[]`——「從沒採用」與「採用了但有瑕疵」在彙總數字上同形，讓缺席能躲進常態噪音（TD-779）。

## 何時跑 aggregator

| Trigger | 由誰 | 動作 |
|---|---|---|
| consumer 改 `.claude/consumer-meta.json` 後 | consumer 自家 commit hook（建議）| 該 consumer commit 前自驗 schema |
| clade 改 schema 或新增 audit logic | clade 主線 | 手動跑 `node scripts/sync-consumer-meta.ts` |
| clade propagate（散播投影） | `propagate.ts` | propagate 結尾自動跑 aggregator 更新 snapshot |

## Schema 演進

- `schemaVersion` bump = breaking change，aggregator 拒絕舊版 consumer 直到 consumer 更新
- 新增 optional field = 不 bump（向後相容）
- 修改 enum 值 = bump
- 移除 required field = bump

## 規則 / Skill 怎麼讀 manifest

| 場景 | 該讀哪個欄位 |
|---|---|
| `proactive-skills.md § Dev Server Auto-Spawn` 判斷該不該 scan port | `auth.portPinned` + `dev.leaseMode` |
| `vendor/scripts/dev-singleton.ts` 起 dev server | `dev.ports[0].port` + `dev.singleton` path |
| `vendor/scripts/wt-env-sync.ts` 拉 env file | `dev.envSyncPolicy.filesToCopy` |
| `rules/core/db-preview-env.md` audit | `database.previewEnvCapability` vs `registry/consumers.json capabilities.preview_db` |
| `vendor/snippets/dev-auth/` cookbook 是否該推薦 | `auth.devSigninEnabled === false && auth.portPinned === true` |
| `audit-ux-drift.ts` 截圖驗證 | `dev.ports[].port` + `verification.smokePaths` |
| `notion-work-coupling.md` 判斷 work item 生命週期該不該推 Notion（ticket 狀態 + 客戶時程頁 交付項目） | `notion.hub` + `notion.projectCode`（座標在 `registry/notion-hubs.json`） |

讀者**MUST** 從 `registry/consumers-meta.json` snapshot 讀，**NEVER** 直接讀 consumer repo 的 `.claude/consumer-meta.json`（避免每個工具都 path-resolve consumer absolute path）。

## 與 registry/consumers.json 的關係

| 檔 | 內容 | 誰寫 |
|---|---|---|
| `registry/consumers.json` | **Governance**：consumer_id、role、projection_paths、improvement_loop_enabled、business_activity、workflow_model、capabilities（preview_db / data_branching） | clade 主線（手動） |
| `<consumer>/.claude/consumer-meta.json` | **Runtime facts**：dev port、auth provider、DB instance、commands、deploy platform、verification endpoints | 各 consumer（git tracked） |
| `registry/consumers-meta.json` | **Aggregated snapshot**：declared + derived + cross-validation | sync-consumer-meta.ts（generated） |

兩個 schema 有少數欄位有**交叉約束**：

- `consumers.json workflow_model='trunk-based'` ⇒ `consumer-meta.deploy.deployTrigger` 應為 `push-main` 或 `tag-v`
- `consumers.json workflow_model='pr-merge-based'` ⇒ `consumer-meta.deploy.deployTrigger` 應為 `pr-merge`、`tag-v`、`manual` 或 `none`；`push-main` 報錯（PR 合併制下宣告 main push 即部署，Step 6-Gate 會讀成無人值守發版）
- `consumer-meta.deploy.deployTrigger` ⇒ 必須等於 production deploy workflow 的實際觸發（`deploy-trigger-check.ts` 先讀 `on:`；同檔混 production 與 non-production job 時再以 production job 的 `if:` 收窄，讀不成 ref 清單就 fail-closed）
- `consumers.json capabilities.preview_db` ⇒ `consumer-meta.database.previewEnvCapability` 應一致

aggregator 對這些交叉約束做 cross-check，不一致寫進 `validation.errors`。

## `deployTrigger` 是發版分流的唯一依據

`/commit` 的 Step 6-Gate 用它決定要不要**無人值守**建 tag 並推出去：`push-main` 走完整發版流程，其餘一律停下來問人。

- 宣告 **MUST** 填 **production** 的觸發條件。main push 部 staging、tag push 部 production 時填 `tag-v`，**NEVER** 填 main push 那個——錯填 `push-main` 會讓 agent 靜默推 tag 部 production

兩道機械檢查：

| 何時 | 誰檢查 | 不符時 |
| --- | --- | --- |
| 聚合 snapshot 時 | `scripts/sync-consumer-meta.ts` 對每個 consumer 推導 `.github/workflows/` 的實際觸發 | 寫進 `validation.errors` |
| 每次 `/commit` | `vendor/scripts/deploy-trigger-check.ts`（projected 到每個 consumer） | `verdict=needs-approval`，Step 6 走 ask-first 分支 |

第二道 fail-closed：**`push-main` 只有在 workflow 推導同意時才成立**，其餘全部落到 needs-approval。

## Deployment type（`deploymentType`）

fleet 的部署形態收斂成**三型**。新專案 **MUST** 貼齊其中一型，不自創第四種。

| | `node-server` | `workers-d1` | `void-cloud` |
| --- | --- | --- | --- |
| Runtime | nitro `node-server` preset | NuxtHub 或 `cloudflare-module` | 同左（由平台代管） |
| DB | Supabase（Postgres） | D1 | D1（由平台 provision） |
| 部署動作 | rsync/SSH + systemd 或 `docker compose` | `cloudflare/wrangler-action` | `pnpm void:deploy` |
| Migration | **獨立 job + 風險分類 gate** | `deploy` job 內的一個 step | **不存在** |
| Deploy pipeline | 4-job（`ci → migrate → deploy → notify`） | 4-job | **3-job**（`ci → deploy → notify`） |
| Preview 途徑 | per-PR compose / LXC（見 [[db-preview-env]]） | Cloudflare 原生 per-version preview URL + D1 preview binding | 依平台能力，**不可假設等同 Cloudflare 原生** |

### `void-cloud` 為什麼是獨立一型而不是 `workers-d1` 的變體

`pnpm void:deploy` 是單一不透明指令，沒有插入 migration SQL 的位置；硬塞 `migrate` job 只會是空殼。併進 `workers-d1` 會讓「該有 migrate job」的稽核誤判。

### `null` 的兩種意思

**MUST** 用 `$comment` 寫明是哪一種：

- **尚未定型** — 合法但不該長期停在這，沒有 type 的 consumer 拿不到任何 type-scoped 的能力
- **不適用** — 該 consumer 不是 Nuxt app。實例：某 consumer 是 5 個 Go service 的 matrix build，無 preset、無 D1/Supabase 概念

**NEVER** 為了「讓每個 consumer 都有 type」而多開一個 enum 值容納單一特例——`null` + 明寫不適用的成本低得多。

### 宣告 vs 實際 MUST 一致

`deploymentType`、`deploy.platform`、`database.kind` 是 consumer 自宣告，但**宣告不是偏好，是事實主張**。`scripts/audit-consumer-meta-adoption.ts` 從實際檔案推導後比對：

- `nuxt.config.ts` 的 `preset`
- `wrangler.*` 的存在，以及裡面有無 `d1_databases`
- `package.json` 的 `@nuxthub/core` / supabase 依賴
- `.github/workflows` 有無任何 deploy workflow

`deploymentType` 的值域刻意與 `detectDeployMechanism()` 回傳值相同，直接比對。不符列進 audit 的「宣告 vs 實際」段；audit 不自動改，改哪邊由 consumer 決定，但**放著不處理不是選項**。

`<consumer>/template` 這類 scaffold 範本**不驗部署形態**——它本身不部署，宣告 `none` 是正確的。

## 遠端主機（`deploy.hosts[]`）

把 self-hosted stack 部署到遠端主機的 consumer，**每一台**部署目標（prod／staging／dev）都 MUST 在 `deploy.hosts[]` 宣告一列——沒有這一列，C 軸（遠端實際在跑的版本）對那台是零覆蓋。

| 欄位 | 內容 |
| --- | --- |
| `role` | `prod`／`staging`／`dev` |
| `ssh` | operator 機器上解析得到的 ssh alias（`~/.ssh/config` 或 tailnet 名，例 `fc-supabase-prod`）；**NEVER** 寫密碼、key 或 IP:port 以外的憑證 |
| `stack` | 主機上跑什麼；目前只有 `supabase-self-hosted`，新 stack 與它的 probe 同一次加 |
| `composeDir` | 主機上 `docker-compose.yml` 所在目錄（例 `/opt/supabase`）；`supabase-self-hosted` 必填，缺了 audit 報 `unreadable` |

讀者是 `scripts/audit-remote-env-version-drift.ts`：對每一列以唯讀 ssh（`cat <composeDir>/docker-compose.yml`）取 image tag，與官方 self-hosted compose 比對。ssh 不通報 `unreachable`、讀不到 compose 報 `unreadable`，兩者都 **NEVER** 讀成 aligned。audit 只出訊號；主機升版是 consumer 的 production 動作，relay 給該 consumer session。

## Adoption 順序

新增 consumer-meta.json 不是一次散播事件，是各 consumer 自家 session 漸進採用（步驟見 § 採用工作流；範例在 `vendor/snippets/consumer-meta/`）。

未採用 manifest 的 consumer 在 snapshot 內是 `declared: null` + `validation.manifest='missing'`，兩種模式 snapshot 內容相同；失敗與否在 exit code 層分：

| 跑法 | 缺 manifest | 名單上的路徑不存在 |
| --- | --- | --- |
| `node scripts/sync-consumer-meta.ts`（寫入 snapshot） | `manifest='missing'` 註記，exit 0——**NEVER** 擋 publish／snapshot 重生 | `manifest='repo-absent'` 註記，exit 0 |
| `node scripts/sync-consumer-meta.ts --check`（`/clade-health` live／full 跑的那條） | `✗`，exit 1。修法在那家 consumer：relay 給它採用 | `✗`，exit 1。修法在 `consumers.local`：改或刪那一行 |
| `node scripts/sync-consumer-meta.ts --consumers-file <list>`（fixture／單體驗收跑法；implies check mode，但不比對 committed snapshot——它描述的是真實 fleet 而非 fixture） | `✗`，exit 1。修法同 `--check`：那家 consumer 採用 | `✗`，exit 1。修法在 `<list>` 名單檔：改或刪那一行 |

`--check` 是採用收斂的 gate；`--consumers-file` 是同一 check mode 的 fixture 入口（絕不寫 snapshot），relay brief 的單體驗收走這條，未採用的 consumer 必須紅掉。

### propagate 交付前置（meta-withheld，TD-779）

`propagate.ts` 在 per-consumer 交付迴圈之前讀 committed `registry/consumers-meta.json` snapshot（`scripts/lib/consumer-meta-gate.ts`）：該家 entry 的 `validation.errors` 非空、或 `manifest` 為 `missing`／`repo-absent` → **扣該家交付**（收尾輸出列 `meta-withheld=N` 與逐家明細）。2026-09-26 拍板選 B——errors 非空的宣告等於下游 release-gate／deploy-trigger-check 會讀到與事實相反的資料，先把交付扣住；連 missing 一起扣是刻意的，只扣 errors 的話刪掉 manifest 就能繞過 gate。

邊界：**只扣那一列**——不擋其他 consumer、不計 `failed`、不改 propagate exit code、**NEVER** 接 clade 自己的 publish 前置。例外是 `--canary`：canary 目標被扣時 propagate exit 1——只有一台的 canary 被扣等於空跑，收尾計數卻與通過同形。snapshot 查無該家 entry（剛加進名單、snapshot 過期）→ `meta-unassessed` warn 放行：量不到不是扣交付的理由。解禁路徑：consumer 修自家 manifest → clade 跑 `node scripts/sync-consumer-meta.ts` 重生並 commit snapshot → 下趟 propagate 自動放行。存量修回屬 consumer 自治區，clade NEVER 代寫 consumer 的 manifest。

**schema 收緊會連帶扣交付**：這道 gate 讓 `registry/consumer-meta.schema.json` 的任何收緊（新增 required 欄位、縮 enum、加 cross-check）在下次重生 snapshot 時把所有不符的既有 manifest 變成 `errors`，下一趟 propagate 就扣住它們的**全部**投影——含 rule／hook 的安全修補。所以收緊 schema 或 cross-validation 的 commit 之前 **MUST** 先跑 `node scripts/sync-consumer-meta.ts --check` 看哪些 consumer 會新增 errors，並在同一個 PR 寫明影響清單與處置（先 relay consumer 修回、或把新規則先做成 `warnings` 再升級）；**NEVER** 讓 schema 收緊與 snapshot 重生同趟默默落地。

| 訊號契約 | 內容 |
| --- | --- |
| 觸發條件 | committed `registry/consumers-meta.json` 中該 consumer entry 的 `validation.errors` 非空，或 `validation.manifest` ∈ `missing`／`repo-absent` |
| 消費端 | `propagate.ts` 交付迴圈（扣該家交付，輸出 `meta-withheld`）；`/clade-health` live／full 經 `sync-consumer-meta.ts --check` 報告同一批狀態（exit 1） |
| 觸發點 | 本檔（`rules/core/consumer-meta.md`，觸碰 `registry/consumers-meta.json`／`.claude/consumer-meta.json` 時依 frontmatter `paths` 載入）＋ `scripts/lib/consumer-meta-gate.ts` 檔頭註解 |

## Adoption gap detection

兩個 clade-home script 用來偵測 + 協助 consumer 採用 manifest：

### `scripts/audit-consumer-meta-adoption.ts` — 跨 consumer 採用度報告

對每個 consumer 報 **FULL / PARTIAL / MISSING**（`--json`、`--consumer <abs-path>` 可用）。Diagnostic-only，exit 恆 0，不接 propagate。

### `scripts/scaffold-consumer-meta.ts` — 提議單一 consumer 的 manifest 內容

偵測 derivable facts 並 emit proposed manifest JSON（`--json` 可 pipe），欄位標 high / medium / low confidence。**Dry-run only**，`--write` 預設拒絕。

### 採用工作流

1. **clade session** 跑 audit script 看當前 adoption gap
2. **consumer session** 跑 scaffold、review low-confidence 欄位、寫進 `.claude/consumer-meta.json` 並 commit
3. **clade session** 跑 `node scripts/sync-consumer-meta.ts` 更新 snapshot

**NEVER** clade 主線替 consumer 直接寫 `.claude/consumer-meta.json`（manifest 內容含商業判斷如 prod URL / OAuth redirect_uri / 是否啟用 devSignin，是 consumer-self 決策）。
