---
name: project-bootstrap
description: "Use when creating or onboarding a Clade consumer from nuxt-supabase-starter. Not for existing-consumer feature work."
license: MIT
metadata:
  author: clade
  version: "1.0"
  clade:
    permission_tier: action
---


# Project Bootstrap

原生 skill／命令入口以目前 runtime 實際提供的 catalog 為準；缺 slash UI 時讀取本文件與指定 references，使用同一 CLI 執行。`metadata.clade.permission_tier` 記錄工作性質，不提供原生權限。

<role>

把一個 repo 帶到「可開始業務開發的 Clade consumer」狀態。`nuxt-supabase-starter` 是新建 Nuxt 專案的產生器；Clade registry、`init-consumer.ts`、`bp-scan.ts`、golden paths 與 audits 是治理 SoT。本 skill 只編排它們，不複製各自判準。

</role>

<decision_boundary>

| Mode | 可觀察 predicate | 起點 | 完成輸出 |
| --- | --- | --- | --- |
| `new` | 目標 repo 尚不存在，或使用者要求從 starter 建立 | project name + target path | scaffolded project + registered consumer + ready report |
| `adopt` | repo 已存在，但 Clade registry 查不到 | existing repo path | registered consumer + ready report |

若 repo 已在 `registry/consumers.json`，停止 onboarding，改回該 consumer 的一般工作流。**例外**：使用者明確授權把該 consumer 清掉從 starter 重建。可重複的 playground 重建走 `node "$CLADE_HOME/scripts/rescaffold-playground.ts"`（預設 <consumer-e> / `--db-host existing-server`；`--dry-run` 只印步驟；`--skip-gates` 只驗 CLI）。不要自己複述 unregister / rm / CLI 順序——那支腳本是這條路徑的 SoT。不要把 registry 衝突讀成「改回一般工作流」。若使用者只要候選標準、不授權寫入，呼叫 `/bp plan` 後交付 plan，不繼續本 skill。

</decision_boundary>

## Playground quality loop

標準必須先在 **clade + starter** 落地；playground（現為 <consumer-e>）只拿來驗證。`bootstrap-project result=READY` **不是**滿意——文件、CLI、AI 指引、資訊揭露、配套檔、`/bp` required 沒自動落地，都算缺口。

每一輪（腳本內**不**無限 loop）：

1. 看：`node "$CLADE_HOME/scripts/inspect-new-project-round.ts" --consumer <target>`
2. 記：機讀缺口進 `tasks/new-project-quality-loop.jsonl`；質性偏差（doc / cli / ai-guidance / disclosure）同一 schema 補一筆
3. 修：**只改 clade 或 starter**。playground 當源頭改完不算
4. 清：`node "$CLADE_HOME/scripts/rescaffold-playground.ts"`（會再 inspect）
5. 對 ledger：過的 finding 關掉；還沒過的下一輪繼續

停手：inspect `errorCount=0` **且** ledger 沒有未關的質性缺口 **且** 使用者說滿意。Campaign SoT：`tasks/2026-09-03-0018-new-project-quality-loop.md`。

<workflow>

## 1. 建 intake sheet

先讀 `references/intake.md`，再 Read starter 的問題樹 SoT：

`$NUXT_STARTER_HOME/template/packages/create-nuxt-starter/src/question-catalog.ts`

（沒設環境變數就 `$HOME/offline/nuxt-supabase-starter/template/packages/create-nuxt-starter/src/question-catalog.ts`）

AI 不經 CLI、改用對話引導時，MUST 用該檔的 `prompt` 與 `options[].label` 問每一題 `when` 為真的 id。使用者訊息裡已經答過的可以跳過。**NEVER** 另寫 LXC / <consumer-b> / CT 選項標籤。catalog 題**不是**「只有無法安全推導的才問」——那句只適用 catalog 以外的 business variant。

`--yes` **只能**在適用的 catalog 題都有答案之後組 flags。缺 `--db-host`（Supabase 軌）就不要跑 CLI；CLI 會 fail-loud。

輸出並確認一次 intake sheet：

```text
mode:
project_name:
target_path:
starter_preset:
db_host:
register_fleet:
repo_id:
starter_overrides:
agent_targets:
workflow_model:
dev_port:
deploy_track:
business_activity:
optional_conventions:
```

`repo_id` 在 `register_fleet=yes` 時必填。existing repo 優先由 `git remote get-url origin` 推導。建立 GitHub repo、雲端資料庫、部署專案或 secrets 都是額外外部副作用，只有使用者明確要求才執行。

### 溝通期 BOM（尚無 consumer manifest）

intake 拍板 stack 之後、寫第一個檔之前，先出一張 **BOM**：conventions 一列、plugin/rule/skill 一列。這不是 catalog 題、也不是 `ai-guidance:catalog-vs-cli`。**NEVER** 自寫第二份投影模擬。**NEVER** 自動 `/bp record` 把 candidate 寫進 consumer 業務檔——輸出是候選，採用仍是判斷。

**Conventions**（`bp-scan` 的建議挑選邏輯不准改；缺 consumer manifest 時餵 `--modules`）：

```bash
node "$CLADE_HOME/scripts/bp-scan.ts" --plan --json --modules '<prospective manifest modules JSON>'
```

`--modules` 是 consumer manifest 的 `modules` 物件（可含 `profile`）。starter preset → 軸值用 `references/intake.md` 的 Clade runtime direction，不要另解。

**Plugins / rules / skills**（同一份 prospective manifest，呼叫既有 `projectionPlan`）：

```js
import { projectionPlan } from '$CLADE_HOME/scripts/audit-projection-invariant.ts'
import { resolveParsed } from '$CLADE_HOME/scripts/lib/resolve-manifest.ts'

const manifest = resolveParsed({ version: '0.0.0', modules: /* 同上 --modules */ })
const bom = await projectionPlan({ cladeRoot: process.env.CLADE_HOME, manifest })
// bom.plugins / bom.rules / bom.skills
```

把兩份輸出併進 intake sheet 給使用者看。catalog 題（db-host / register-fleet / deploy-track…）仍只問 `question-catalog.ts`，不要跟 BOM 列混成一張表。

UI／有前端（`@nuxt/ui`、或 Nuxt 且有 pages）：BOM 出完後 Read `references/impeccable-follow-up.md`。那是**追問契約**，不是 catalog。scaffold／projection 成功後（Step 3）agent **MUST 立刻自己載入**該檔並缺哪項問哪項直到齊、寫進檔。**NEVER** 只寫「記得裝 impeccable」就過，**NEVER** 把這段變成請人類手打 slash command。品牌／theme／tokens **不准**加成 catalog 題（會跟 `ai-guidance:catalog-vs-cli` 衝突）。

## 2. 建 session state 與隔離工作區

在 Clade 建本 session 的 `tasks/<timestamp>-project-bootstrap.md`，記錄 intake、phase 與 evidence。Clade 中央倉若會改 registry 或 skill source，依 clade-home worktree 規約進獨立 worktree；existing target repo 若會改 code，依該 repo 的 worktree 規約隔離。

開始寫入前做 fail-fast：

- target path 不得是非空陌生目錄。
- `consumer_id` 與 `repo_id` 不得和 registry 的不同 entry 衝突。
- dev port 必須通過 `node "$CLADE_HOME/scripts/dev-port-audit.ts" --json` 的 collision 檢查。
- `new` mode 必須找到 starter repo（`$NUXT_STARTER_HOME`，否則 `$HOME/offline/nuxt-supabase-starter`）。

## 3. 建立或接管 project

### `new`

依 intake 與當前 `question-catalog.ts`／CLI 組成一次 invocation。下表是組參數的條件，不是另一份 preset 判定器；實際 feature selection 與 flag 拼法以 starter 為準。

| 條件 | 加入的參數 |
| --- | --- |
| 所有適用 catalog 題已有答案 | `--yes --preset <starter-preset> --agents <agent-targets>`，加 CLI 所需 project name／target path |
| 最終 feature selection 使用需要主機選擇的 Supabase database | `--db-host <已回答的值>` |
| `register_fleet=yes` | `--repo-id`、`--workflow-model`、`--business-activity`、`--dev-port`、`--deploy-track`，值均來自適用 catalog 題 |
| `register_fleet=no` | `--no-register-consumer`；不傳 registration-only flags，這次只交付 scaffold，不能宣稱完成 fleet onboarding |

呼叫前確認實際 CLI cwd 與解析後 target path 等於 intake，避免 `pnpm --dir` 改變相對目的地。使用 starter `template/package.json` 的 `packageManager` 指定版本；本機版本不同時透過已安裝的 package-manager 管理工具選對版本。版本不匹配不構成修改 starter pin、CI 或 lockfile 的授權。`deploy_track` 與 `db_host` 依適用 catalog 答案填入；沒有答案就不使用 `--yes`。

需要 feature override 才加 `--auth` / `--db` / `--ci` / `--evlog-preset` / `--with` / `--without`。starter CLI 已負責組裝、dependency install、local `init-consumer.ts`、registry 登記（含 `--deploy-track` / `--db-runtime`）與初始 git；失敗時保留原始輸出，修 root cause 後重跑，不把半成品宣告成 consumer。

scaffold / adopt 後 **MUST mint gate playbook pack**（缺才寫、idempotent）：

```bash
node "$CLADE_HOME/scripts/mint-gate-playbooks.ts" \
  --consumer-root <target-path> \
  --consumer <slug> \
  --dev-port <port>
```

產物：`docs/playbooks/README.md`（含 § Browser 分流）+ `PROGRESS.md` + `GATE-TODOS.md` + 01–05、HANDOFF `## User-gate board`。缺 pack 不算 bootstrap 完成。`bootstrap-project.ts` 已含這一步；本節是 skill 自己跑 scaffold 後、進 Step 4 之前的補齊。

UI consumer（mode=`new`、有前端／impeccable 適用）scaffold／projection 成功後，agent **MUST 立刻自己載入** `references/impeccable-follow-up.md`，或內部 invoke hub-core `design` 的 new mode。這是 bootstrap **同一條流程的必經段**：對使用者缺哪項問哪項直到齊，並把答案寫進 `PRODUCT.md`／`DESIGN.md`／theme tokens。`/design new` 只是 agent 可呼叫的 skill 入口，**不是**人類必打指令。**NEVER** 把 design new mode 寫成人類必打的 slash 作業。缺項未問完、檔未寫齊 **不准**把本 skill 收成 `READY`。

### `adopt`

先經 `scripts/lib/consumer-manifest.ts` 的 canonical／legacy resolver 讀取 `.clade/manifest.json` 或相容的 `.claude/hub.json`；兩者漂移時先處理衝突。尚無 manifest 時依實際 stack 與 intake 組出 module flags，再 dry-run：

```bash
cd <target-path>
node "$CLADE_HOME/scripts/init-consumer.ts" --dry-run <module-flags>
```

dry-run 無錯後移除 `--dry-run` 執行。既有 manifest 只有在 intake 明確要求重新推導時才依 CLI 支援方式更新；`--force` 不代替 canonical／legacy 一致性檢查。

## 4. 登記 registry 並跑 onboarding gate

使用既有 onboarding CLI 執行 registry／projection／readiness 與標準檢查；逐 step 讀取診斷，語義完成條件依 completion contract，不能只看 advisory scanner 的 exit code：

```bash
node "$CLADE_HOME/scripts/bootstrap-project.ts" \
  --consumer <target-path> \
  --repo-id <owner/repo> \
  --workflow-model <trunk-based|pr-merge-based> \
  --business-activity <pre-production|active|paused> \
  --dev-port <port|auto> \
  --deploy-track <wrangler-action|void-cloud|node-server|none> \
  --db-runtime <cf-workers|supabase-self-hosted> \
  --json
```

**NEVER 逐條複述那些指令**——複述會漂，而漂掉的那一步在報告上與跑過無法區分。`--dev-port auto` 依 fleet 慣例（3000 起、每 10 一階）配下一個空號；`--skip-registry` 用於已登記的 repo。

exit code：`0` 全綠 / `1` 用法錯誤或 registry 登記失敗 / `2` 有 gate 紅燈。`result` 三值：`READY`（全跑全綠）、`READY_PARTIAL`（有 step 被跳過——**NEVER** 讀成 READY）、`BLOCKED`。

同一組 `consumer_id + repo_id + path` 重跑是 idempotent。任一識別欄位指向不同 entry 時該支會停下並回報 conflict，不覆寫既有 consumer。

這支**不修業務 code**，只跑 gate 並如實回報。例外：mint 缺的 playbook pack，以及 readiness 紅時再跑一次 `sync-vendor --force`。**`hub:vendor` 成功訊息不算證據**，必須 `audit-consumer-readiness.ts --gate` exit 0。紅燈時修 root cause 後重跑，**NEVER** 把 `BLOCKED` 當成「大致完成」。

`semantic-inspection` 回報 required／variant／design 缺項時，依下一節完成 declarations 與既有 intake 決策，再重跑完整 onboarding CLI；不單獨補跑一項來替換整趟結果。

## 5. 核對 meta 與 convention declarations

Step 4 的 `consumer-meta` 與 `bp-scan` 兩步只**產出建議**，採用與否是判斷：把 meta 建議與 intake 逐欄核對後才寫入 `<target-path>/.claude/consumer-meta.json`。`bp-scan` 每一條輸出分成：

- `required-and-detectable`：starter 已具備或可由 Clade deterministic scaffold 補齊，直接完成並驗證。
- `variant-choice`：需要部署、資料生命週期、audit 等業務選擇；只採 intake 已拍板的 variant。
- `not-applicable`：在 registry 明確宣告，附可觀察理由。

不得把未拍板的 business variant 猜成 `compliant`。

**安全憲法（`security-policy` convention）在這一步落地**：starter 的 `template/SECURITY.md` 是 user-owned 實填範例，`new` mode 已經帶進來——逐段核對 intake（攻擊入口是否多了 webhook / 公開表單、授權模型是 user-owned 還是 tenant-scoped、`.env.example` 的 key 名有沒有增減），tenant-scoped 就改用 `$CLADE_HOME/vendor/snippets/security-policy/SECURITY.template.tenant-scoped.md` 重填。`adopt` mode 沒有這份檔時從範本建。五段齊、不變量 ≥ 5 且每條 `enforced by` 是 `audit-new-project-readiness.ts` 與 `audit-security-policy.ts` 的判準；首次 baseline 掃描消耗 ChatGPT 額度，先跑官方 input check，再依 `commit/security-scan.md` 指定本次估算停止線執行，跑不了就在 registry 宣告 `security-policy: scan-only` 並登 TD。

## 6. 跑 completion contract

先讀 `references/completion-contract.md`，按順序執行所有 applicable gate。任何 gate 紅燈就留在本 phase 修到綠；`N/A` 必須附 predicate，`NOT-RUN` 不算完成。

引用最後一次完整 `bootstrap-project.ts` 的 exit code 與 `steps[]`，包含 `semantic-inspection`。Step 5 或後續修正改變被檢查內容時，重跑完整 CLI 取得新證據；內容未變時直接引用既有結果。本 phase 另補它涵蓋不到的 project-local gate：

```bash
cd <target-path> && pnpm verify:starter
cd <target-path> && pnpm check
```

`adopt` mode 沒有 `verify:starter` 時以 consumer meta 的 lint/typecheck/test/build commands 替代，逐一記證據。

### 新專案需求入口

宣告 `aixbdd` capability 的新產出，在所選 AI targets 的指引與可執行投影中都採用 `/specify` → `/tasks` → `/implement` 這條入口。以 target 的 `.claude/skills/` 實際存在該組 skill、且 `node .clade/vendor/scripts/flow/flow.ts status --json` 跑得起來為準；預設指引與 package scripts 須一致，不能只驗 skill 目錄存在。

使用者任務包含首件需求時，沿同一 source/change/work 完成 create → instructions/materialize → 風險選擇的測試／BDD → evidence/project → archive，另附真實 commit 與 deploy track 狀態。readiness READY 只結案建案檢查，不代替這條需求的交付證據。

<consumer-e> playground 的本輪驗證資料保存於 playground 外，再以正式 rescaffold 路徑重建。驗一件需 BDD 的行為、一件普通測試即可的低風險行為，以及明示修訂造成舊證據失效、重驗後才能 archive；修正一律回 clade／starter，再用相同答案重新產生驗證。

## 7. Land 與 publish

先提交 target repo 的 scaffold/onboarding commit，再提交 Clade registry/skill source。Clade worktree merge-back 後呼叫 `/clade-publish` 完成 publish + propagate；禁止在 worktree 內 publish。

publish 後再次在 target repo 跑 readiness gate 與 `pnpm hub:check`，確認驗的是已發佈 projection，不是 worktree 暫存版本。

</workflow>

<output_contract>

最後只用以下順序交付：

1. `Result`：`READY` / `BLOCKED`，一句話。
2. `Project`：path、repo_id、starter preset、Clade consumer_id、Clade version。
3. `Decisions`：只列實際採用的 variant。
4. `Evidence`：每個 completion gate 的 invocation、exit、關鍵 verdict。
5. `External setup`：只列無法由本 session 完成、且綁具體外部資源的項目；沒有就省略。

`READY` 必須同時具備 registry entry、`consumers.local` derived entry、readiness `READY`、gate playbook pack、`semantic-inspection` 無 pending／skip／error、project gates 綠燈、Clade publish/propagate 完成。UI／有前端還要 `impeccable-follow-up.md` 各項齊（或書面 N/A）且 inspect `designPending` 為空。缺任何一項只能輸出 `BLOCKED`，並標出停在哪個 predicate。

</output_contract>

<default_follow_through_policy>

使用者要求建立或 onboard 專案即授權 local scaffold、consumer files、Clade registry 與必要的 commit/publish。建立/刪除遠端 repo、雲端資料庫、部署專案、網域、secret 或付費資源不在默認授權內；需要時先取得明確同意。

</default_follow_through_policy>
