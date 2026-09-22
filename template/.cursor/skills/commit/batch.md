# Worktree 批次提交

本分支適用每個 runtime 的 `/commit`、手動 merge back 與自動收割。Helper 在 clade 為 `vendor/scripts/wt-helper.ts`，consumer 為 `scripts/wt-helper.ts`；以下命令以 consumer 路徑表示。用工作目錄參數在指定 tree 執行，不要求使用者切換 task。

## 1. 收件與觸發

Worker 完成實作、必要測試、行為驗收後，先把 scoped 變更 commit（hooks 照跑），再記錄 checkpoint。Checkpoint 只保存來源 HEAD、作者與 scope，**不**啟動完整 AI review、不收割全 repo WIP、不發版。

```bash
node scripts/wt-helper.ts batch checkpoint <source-path> --work-id <work-id> --author <作者>
node scripts/wt-helper.ts batch ready <source-path> --work-id <work-id> \
  --evidence <驗收證據檔> --authorize-landing --release-writer
node scripts/wt-helper.ts batch status --trigger auto --workflow <workflow_model>
```

`batch ready` 才是 PR ready／品質入口。證據放來源外可持久讀取的檔；紀錄實跑命令、結果、受測 HEAD。`--authorize-landing` 表示既有工作授權允許正式落地及安全回收，不是由 flag 創造授權。需保留來源時加 `--retain <owner 與下一個落地事件>`。

```bash
node scripts/wt-helper.ts batch unready <source-path> --reason <撤回原因>
```

`batch unready` 撤回單一來源的 ready 登記：只刪該來源的 ready 紀錄，並把 path／branch／head／workId／reason 記進 state 的 `unready[]`（例如來源經 ad-hoc `commit --only` 或他人 merge-back 在 batch 外落地、或已被取代）。屬於 in-flight batch（integrating／review／sealed）的成員拒絕——成員由 batch lifecycle（cancel／cleanup）處理，**NEVER** 用 unready 抽別人批次的成員。撤回後該來源可重驗再 `batch ready`。`<source-path>` 必填（不預設 cwd），旗標順序自由；worktree 目錄已被手動刪除的 stale ready 列同樣可撤回。缺 path、多餘位置參數或其他 usage error 一律印 usage 並 exit 2。

### Draft PR（可見性；不是 ready）

相對 `main` 已有非空 committed diff 後，**slice owner** 自己 push 該 session branch 並開 draft PR（全文 [[github-flow]]）。同一個 work id 拆成多個平行切片時**不走這一段**——切片不開 PR，由 coordinator 併入 `integration/<work-id>`，只有那一條對 `main` 開 draft（[[github-flow]] § Integration branch）。開 draft 後 **MUST** 登記可見性 receipt，否則 prepare 沒有完整綁定：

```bash
node scripts/wt-helper.ts batch draft <source-path> \
  --work-id <work-id> --pr <number> --kind visibility
```

```bash
gh pr view <session-branch> --json number,isDraft,headRefName
git push -u origin <session-branch>
gh pr create --draft --base main --head <session-branch> --title '<切片摘要>' --body '<scope；CI 紅燈回這張 PR>'
gh pr view <session-branch> --json number,isDraft,headRefName
```

**NEVER** 把該來源放進 ready 池、**NEVER** 當 `prepare` 成員、**NEVER** 啟動完整品質鏈、**NEVER** merge、**NEVER** push `origin main`。空 branch、只有 WIP → 不開 PR。CI 紅燈修回同一張 PR（處置見下方 § CI 紅燈處置）。討論 draft 另加具名討論者與具體問題時才跑（舊命令無 `--kind` 仍是 discussion，兩欄都必填）：

```bash
node scripts/wt-helper.ts batch draft <source-path> \
  --work-id <work-id> --pr <number> --kind discussion \
  --discussant '<具名討論者>' --question '<會改變剩餘實作的具體問題>'
```

seal 之後同一 `workId` MUST 把受審 formal HEAD 交到**既有** draft 的 head ref，再標 ready。**NEVER** 開第二張 PR。轉換失敗就停。PR ready 仍走上面的 `batch ready`。

| 事件 | trigger | 行為 |
| --- | --- | --- |
| 就緒／收割／session 接手 | `auto` | `pr-merge-based`：1 個 distinct work id 即準備獨立 PR；`trunk-based`：4 個才啟動。未達門檻繼續開發、不佔 commit lock。ready backlog 達 3 件時優先交付，active implementation 預設最多 3 件——**數的是進 `main` 的 PR**，一條 `integration/<work-id>` 連同它底下每一個切片合計算 1 件（[[github-flow]]） |
| 使用者 `/commit` 或 merge back | `manual` | 無最低件數；未就緒工作不阻擋；緊密相依工作可明確合批 |
| 下游須先落地 | `dependency` | 有就緒成員即結批 |
| 已授權開發皆完成或受阻 | `drained` | 有就緒成員即結批 |
| 使用者結束本輪開發 | `stop` | 有就緒成員即結批；換 session 不屬於 stop |

Status 沒有就緒 wt，也沒有待續跑批次時，回普通 `/commit`。所有輸出中的 stale／invalid 來源列名保留，不假裝進池。既有 active batch 優先續跑，新就緒工作進下一批。單成員 PR 預設；Charles-only leftover 卡該來源時跑 `batch yield-blocked` 讓出 active slot，blocked source 不可自動重回 ready，須具名 `batch unlock-blocked --event` 後重驗再 ready。無關獨立 workId 繼續。合批內一成員 blocked 則整批不落地。

### CI 紅燈處置

本節在落地路徑上被讀：draft／ready PR 的 CI 紅了，處置從這裡開始，不是從「再推一次」。**違反字面就是違反精神。**

**Iron Law：先判讀再處置。** 紅燈當下第一個動作是跑 `node scripts/test-lanes/ci-triage.ts --run <id> --json`，讀它的 `action`／`rerun_shards`／`register`／`failures[].class`。沒有這份輸出就 **NEVER** 重跑、**NEVER** 再 push。

| `action` | MUST |
| --- | --- |
| `fix` | 修 `failures` 裡的 real，push **同一張** PR。**NEVER** 開第二張 PR |
| `rerun-failed-shards` | `gh run rerun <id> --failed`。指令必須帶 `--failed` |
| `register-flaky` | 同一張 PR 同一支檔的**第二次** flaky：登記（`flow plan` 或 TD）並附 `register[].evidence`，**NEVER** 再重跑 |

合併門檻不變：所有 shard 都通過才可落地。本節不改 0-A／0-B／0-C、不改 `batch ready`、不改六 shard 互斥聯集。

逐字禁令：

- **NEVER** `gh run rerun <id>`（不帶 `--failed`）處理 flaky／infra
- **NEVER** 以空 commit 或 force-push 觸發整輪重跑
- **NEVER** 整輪重推同一 SHA 來「碰碰運氣」

| 開脫（逐字） | 實際 |
| --- | --- |
| 「整輪 rerun 比較快，shard 對帳很煩」 | 先判讀再 `gh run rerun <id> --failed` 才是處置；整輪 rerun 不是較短的路 |
| 「先 rerun 一遍，還紅再判」 | 沒有 `ci-triage` 輸出就重跑，是在用 runner 分鐘猜 class |
| 「空 commit 觸發 CI 又沒改產品」 | 空 commit 就是整輪重跑，且污染歷史 |
| 「force-push 清掉紅燈紀錄比較乾淨」 | 紅燈紀錄是 flaky 判準的輸入；清掉會把第二次 flaky 當成第一次 |
| 「同一檔又紅了，再 rerun 一次就好」 | 同一 PR 同一檔第二次 flaky 走 `register-flaky`，不是第三次 `--failed` |

P1 基線（`specs/plans/W-2026-09-20-test-lane-overhaul/evidence/p1-pr-run-baseline.md`；複驗：`gh run list --workflow validate.yml --event pull_request -L 100 --json databaseId,conclusion,runAttempt`）裡，rerun 轉綠的 run 平均用了 2.9 個整趟 attempt。本證據決定：flaky／infra 用 `--failed` 而不是整輪 rerun。本證據不決定：要不要修 real——real 的 `action` 是 `fix`，與 runner 分鐘無關。

**Red Flags**：發現自己正要打不帶 `--failed` 的 `gh run rerun`、正要 `git commit --allow-empty`、正要 force-push 只為重跑、或還沒打開 `ci-triage` 輸出就伸手推——停，回到本節第一句。

## 2. 準備隔離整合區

```bash
node scripts/wt-helper.ts batch prepare --trigger <trigger> --workflow <workflow_model>
```

`status` 與 `prepare` MUST 用**同一個**已解析 `workflow_model`。registry 裡已宣告的 consumer 用它的值；解析失敗 **NEVER** 默默改成 `pr-merge-based`。clade home 不是 registry consumer，試跑才准顯式 `--workflow pr-merge-based`。Trunk prepare 固定所有當下就緒成員。PR prepare 預設只收**一個** work id（一個獨立可接受目的對應一個 PR）；緊密相依合批必須顯式 `--group-work-ids <id>,<id>`，**NEVER** 把不相干的就緒來源默默塞進同一張 PR。來源 checkpoints 及整合中繼成果皆保留，main 不接收待審內容。另一位 coordinator 撞 active batch 時接續該批，**NEVER** 另開一批與它競爭。prepare 回傳既有批次時輸出帶 `reused: true`（新批為 `reused: false`），呼叫端可憑它分辨自己開的批與接續的批；帶 `--expect-work-id <id>`（逗號可複數）而回傳批成員不含該 id 時 prepare 直接拒絕。**NEVER** 看到成員不對就 `batch cancel`——先用 `batch status` 查那批是誰的。

衝突只在隔離區解，解完精確 stage 衝突檔後跑 `batch resume`；不删來源、不把未解衝突藏成就緒。中斷後先讀 `batch status`，依持久狀態續跑。`pr-merge-based` 的 base 是 `git fetch origin main` 後的 `refs/remotes/origin/main`；`trunk-based` 才使用 local main。main 前移用 `batch refresh` 對齊新基準並重新驗受影響範圍；來源變動則 `batch cancel --reason <原因>` 保存既有工作，重驗來源、重登記再 prepare。

Helper 在整批合併後沿用既有 worktree runtime bootstrap，建立投影工具、環境檔、dev-port 與 backing service；失敗保留 integration 並由 resume 重試。接著在 integration path 依專案 package manager 以 frozen lockfile 安裝依賴，再確認 dev-port／db-preview 的獨立驗證環境。依 SKILL.md Step 0-Lock 解析鎖腳本與 integration 的絕對路徑，取得 commit lock 後跑 Step 0–5 的完整流程。Scope 為該整合區的完整 base→candidate 差異；同一批只啟動一次品質鏈，可按功能建立多筆正式 commits。手動普通 commit 的全 WIP 契約只作用於普通工作區，不把 main WIP 偷渡進 batch。

Prepare 已把整批差異呈現在 base 上的 index。中断後若已有部分正式 commits、或需要補審整批，先跑 `batch review`：它保留 candidate、重新呈現完整 staged diff 並使舊 seal 失效，再依同一批狀態續跑既有品質鏈。不能對乾淨 HEAD 跑空 diff review 後宣稱整批通過。有 active PR 批次時，其他 session 可以照常 commit 到 local main，但 **NEVER push**；push 會前移 origin/main，才會使批次要求 refresh。

helper 登記的 integration 同樣適用 Step 0-MR／0-Archive 的 trunk 人工 gate，不能因 branch 名稱而 skip。依每個 member 的 change 與 archive 對應檢查整批 readiness；有 blocker 就保留整批與來源，修正後重驗。若要排除未就緒成員，取消本批後重新登記其餘成員、prepare，再跑完整品質鏈。

## 3. 證據與正式落地

```bash
node scripts/wt-helper.ts batch scope
```

以輸出填寫 seal JSON 的 `base`、`tree`、`members`（逐成員保留 `path`／`workId`／`head`），另附 `gates`：`simplify`、`review`、`checks`、`human`。每格使用 `{ "status": "passed", "evidence": "<絕對路徑>", "hash": "<檔案 sha256>" }`；條件未觸發時使用 `{ "status": "not-applicable", "reason": "<可核對判準>" }`。Review 包含適用的 0-A／0-B，checks 包含其他已觸發的檢查；human 只收既有人工 gate 的實際結果。

證據必須是本批真實執行產物，**NEVER** 用 worker checkpoint、布林 true 或自己寫的「all passed」代替。Helper 驗檔案與雜湊，不替主線判語意正確；主線仍須讀實際結果。任何審後修改（含 Step 5 bookkeeping）先依既有規約補驗／補審受影響範圍，證據覆蓋最終 tree 後才 seal。

```bash
node scripts/wt-helper.ts batch seal --evidence <seal.json>
node scripts/wt-helper.ts batch land
```

Trunk 成功後，Step 6 的發布／push 依原有 gates 在 main 執行；不在 integration branch 對 main 推送未受審內容。main dirty 時協調持有者，不 stash／丟棄 main WIP 以換取放行。

PR 制不直推 main：正式批次 commits 依原有 PR／ship 流程送審，PR 未合併時保留來源與 integration。確認 PR 合入 main 後，先保存一份 merge receipt，再跑：

```bash
node scripts/wt-helper.ts batch confirm-merged --receipt <merge-receipt.json>
```

Receipt 必須是 JSON 物件，欄位固定為：`repository`、`pr`（正整數）、`base`（`main`）、`merge_method`（`squash`）、`merged`（必須為 `true`）、`source_head`（reviewed formal HEAD）、`reviewed_base`、`candidate_tree`、`merge_sha`（GitHub squash 產生的單一 parent commit），以及 `content_patch_id`（`base..source_head` 的 `git patch-id --stable`）。Helper 會向 GitHub 查同一 `repository`／`pr`：必須 `merged=true`、base 為 `main`、遠端 merge SHA 等於 receipt、GitHub `head.sha` 等於 reviewed `source_head`；若本 checkout 有 `origin` GitHub remote，其 owner/repo 必須與 receipt 及遠端 PR 一致。**NEVER** 只信 caller 自填的 `merged`。接著 fetch origin/main，確認 `source_head` 仍是 reviewed formal HEAD、`reviewed_base` 仍是 seal 時的 base、merge parent 就是該 base、`merge_sha` 可由 `refs/remotes/origin/main` 達到且是單一 parent commit，並比對 reviewed candidate tree 與 merge tree（涵蓋 binary／rename／file mode）以及 stable patch-id；任一不符即保留來源與 integration。PR merge 確認後，local main 以 `git merge origin/main` 對齊，**NEVER rebase**。

`batch confirm-merged` 不接受沒有 receipt 的確認，也不接受 fast-forward／一般 merge 冒充 squash。PR 關閉但未合併、receipt 缺失或機械證據不足時保留並查證，不宣稱 landed。Receipt 驗證通過後才記錄 landed；cleanup 對 PR 批次以 receipt 的 `merge_sha` 驗證 main 可達性，同時仍以 formal HEAD 保護 integration branch 與來源回收。清理失敗只重試 cleanup，不重複合併。

具名 coordinator 在 C 節 predicate 全成立時，用 helper 合併，不自行拼裸 `gh pr merge`：

```bash
node scripts/wt-helper.ts batch yield-blocked \
  --work-id <work-id> --reason '<Charles leftover>' --owner <coord> \
  --carrier <path> --resume-event <named-event>
node scripts/wt-helper.ts batch unlock-blocked \
  --work-id <work-id> --event <named-event>
node scripts/wt-helper.ts batch merge-unattended \
  --authorization <auth.json> --world <world.json> --dry-run
node scripts/wt-helper.ts batch merge-unattended \
  --authorization <auth.json> --world <world.json>
```

`--world` 是當下 GitHub／CI／seal 快照；未知旗標 fail-closed。崩潰後重入：遠端已合併只補 receipt／confirm，不再次 merge。`batch land` 的 PR 路徑不偷偷啟用 auto-merge。Merge 後盯該 `merge_sha` 的 staging，不追下一個 SHA。

## 4. 完成報告前的回收

`/handoff park` / `/handoff next` 的 lifecycle drain 只會把已滿足 landing authorization、writer release 與 evidence 的工作送到這裡；handoff 不自行拼 merge。`trigger=drained` 代表本輪已授權工作都完成或明確受阻，仍須依本節完整跑 prepare → review → seal → land。

```bash
node scripts/wt-helper.ts batch cleanup
```

每個來源都需正式落地、HEAD 未變、無未保存工作／活 claim／lock／保留契約才移除；有不能安全刪的 ignored 內容也保留。**NEVER** 用 `--force` 補掉不成立的 predicate。報告逐來源列 `path`、`branch`、`dirty`、`merged_to_main`、`locked` 與 removed／retained 原因，integration 最後回收。

Cleanup 前，每一棵樹先被 P0 全量保存進 common Git 目錄下的 archive（receipt 記 inventory／Git closure，不再發 `excluded` 清單）。預設 `defaultLifecycle` **沒有** `withExclusiveWriterOwnership`，且未解析的 profile 會讓 `validateProfile` 失敗——此時 CLI `batch cleanup` **retain 每一個來源**，不會做上面描述的 capture／刪除。要真的 teardown，呼叫端必須提供：已解析且通過 `validateProfile` 的 profile，以及帶 mandatory exclusive-writer adapter 的 lifecycle。

**Profile 解析不了的 repo（例如帶 submodule 的 clade home）走 retire 路徑收尾**：`phase=landed` 的批次，只要 landed commit 由 Git 實查是 main 的祖先（pr-merge-based 另需 `mergeReceipt.merged`）、成員 branch 未前進、樹上 HEAD 與登記相符、無 `retain`／`removing`，`handoff-retire.ts` 就不再把該來源（與 ready 裡同 path＋head 的條目）算作 batch owner，由它的 archive→validate→recheck→remove 保存並移除。之後 `batch cleanup` 對「來源已不在、`docs/archives/retired-work.jsonl` 有 path＋branch＋head 完全相符的 `retired` 紀錄、且 archive 每個檔 hash 仍相符」的成員與 integration 記為 removed 並把批次轉 `cleaned`；紀錄不符或 archive 受損一律照舊 retain。**NEVER** 為了讓 retire 接手而改 state.json 的 phase 或刪 ready 條目。

兩件事讀報告時要知道：

- **Teardown 跑的是 main checkout 的 `scripts/wt-env-bootstrap.ts`，不是被刪那棵樹自己的那一份。** 一棵樹帶著的是它 fork 當天的 shim，於是 fork 早於某個 branch 命名形式的樹認不得自己的 branch（`E_BRANCH_SLUG`），結構上永遠刪不掉自己。Provisioning 仍用該樹自己的 shim，只有 teardown 換根。目標身分一律由 `--worktree` 決定，換根只換 config 與 script 的來源。**副作用**：provisioning 讀該樹的 config、teardown 讀 main 的 config，所以 `.claude/worktree-db.json` 的 prefix 在 fork 之後改過時，destroy 會算出不同的 dbName 而找不到 clone，留下 orphan。真的改過 prefix 時 MUST 先確認在途的樹已回收。
- **Nested repository（典型：Pi dispatch clone 進 `.pi/git/**`、或 `modules/` 裡 deinitialized / damaged submodule git dir）預設整棵保存，不排除。** P0 全量保存：沒有 nested-repository adapter 證明可離線復原時 MUST retain。不能只把「有 `.git` 且 `is-bare-repository=true`」當 nested；source 與 captured common metadata 都要查。top-level fsck 不能替代 nested closure。有 adapter 且證明成立時仍保存 remote 交還不了的部分（修改過的 tracked 檔、untracked、ignored）；證明不成立就整棵保存。

清理重試只跑 cleanup，不重跑完整品質鏈。下一次 `/commit` 或接手先檢查已落地待清理批次；使用原 integration 路徑取得的 commit lock，於刪 integration 之前釋放，或以原 canonical lock path 釋放。發布未授權不妨礙已正式落地的本地來源安全清理；PR 未合併則不能清理。
