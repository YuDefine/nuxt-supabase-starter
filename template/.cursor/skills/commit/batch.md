<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/commit/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Worktree 批次提交

本分支適用每個 runtime 的 `/commit`、手動 merge back 與自動收割。Helper 在 clade 為 `vendor/scripts/wt-helper.ts`，consumer 為 `scripts/wt-helper.ts`；以下命令以 consumer 路徑表示。用工作目錄參數在指定 tree 執行，不要求使用者切換 task。

## 1. 收件與觸發

Worker 完成實作、必要測試、行為驗收後保存 scoped checkpoint。Spectra change 的 archive gates、spec sync 與 bookkeeping 先在來源 worktree 完成，再 checkpoint／登記就緒。主線收割 terminal outcome、驗 scope 與證據、確認原執行者交出寫入權，再用既有 claim CLI 釋放該來源的精確 claim；**NEVER** 把 process 退出當 session 已交出寫入權。

```bash
node scripts/wt-helper.ts batch ready <source-path> --work-id <work-id> \
  --evidence <驗收證據檔> --authorize-landing --release-writer
node scripts/wt-helper.ts batch status --trigger auto
```

證據放來源外可持久讀取的檔；紀錄實跑命令、結果、受測 HEAD。`--authorize-landing` 表示既有工作授權允許正式落地及安全回收，不是由 flag 創造授權。需保留來源時加 `--retain <owner 與下一個落地事件>`。

| 事件 | trigger | 行為 |
| --- | --- | --- |
| 就緒／收割／session 接手 | `auto` | 4 個 distinct work id 才啟動；未達門檻繼續開發、不佔 commit lock |
| 使用者 `/commit` 或 merge back | `manual` | 無最低件數；未就緒工作不阻擋 |
| 下游須先落地 | `dependency` | 有就緒成員即結批 |
| 已授權開發皆完成或受阻 | `drained` | 有就緒成員即結批 |
| 使用者結束本輪開發 | `stop` | 有就緒成員即結批；換 session 不屬於 stop |

Status 沒有就緒 wt，也沒有待續跑批次時，回普通 `/commit`。所有輸出中的 stale／invalid 來源列名保留，不假裝進池。既有 active batch 優先續跑，新就緒工作進下一批。

## 2. 準備隔離整合區

```bash
node scripts/wt-helper.ts batch prepare --trigger <trigger> --workflow <workflow_model>
```

Workflow 值來自 consumer registry：`trunk-based` 或 `pr-merge-based`；查不到用 PR 制。Prepare 固定所有當下就緒成員，在 helper 回傳的 integration path 串行合併。來源 checkpoints 及整合中繼成果皆保留，main 不接收待審內容。另一位 coordinator 撞 active batch 時接續該批，**NEVER** 另開一批與它競爭。

衝突只在隔離區解，解完精確 stage 衝突檔後跑 `batch resume`；不删來源、不把未解衝突藏成就緒。中斷後先讀 `batch status`，依持久狀態續跑。main 前移用 `batch refresh` 對齊新基準並重新驗受影響範圍；來源變動則 `batch cancel --reason <原因>` 保存既有工作，重驗來源、重登記再 prepare。

Helper 在整批合併後沿用既有 worktree runtime bootstrap，建立投影工具、環境檔、dev-port 與 backing service；失敗保留 integration 並由 resume 重試。接著在 integration path 依專案 package manager 以 frozen lockfile 安裝依賴，再確認 dev-port／db-preview 的獨立驗證環境。依 SKILL.md Step 0-Lock 解析鎖腳本與 integration 的絕對路徑，取得 commit lock 後跑 Step 0–5 的完整流程。Scope 為該整合區的完整 base→candidate 差異；同一批只啟動一次品質鏈，可按功能建立多筆正式 commits。手動普通 commit 的全 WIP 契約只作用於普通工作區，不把 main WIP 偷渡進 batch。

Prepare 已把整批差異呈現在 base 上的 index。中断後若已有部分正式 commits、或需要補審整批，先跑 `batch review`：它保留 candidate、重新呈現完整 staged diff 並使舊 seal 失效，再依同一批狀態續跑既有品質鏈。不能對乾淨 HEAD 跑空 diff review 後宣稱整批通過。

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

PR 制不直推 main：正式批次 commits 依原有 PR／ship 流程送審，PR 未合併時保留來源與 integration。確認 PR 合入 main 後跑 `batch confirm-merged`；機械證據不足（例如無法建立 squash 對應）時保留並查證，不宣稱 landed。

## 4. 完成報告前的回收

```bash
node scripts/wt-helper.ts batch cleanup
```

每個來源都需正式落地、HEAD 未變、無未保存工作／活 claim／lock／保留契約才移除；有不能安全刪的 ignored 內容也保留。**NEVER** 用 `--force` 補掉不成立的 predicate。報告逐來源列 `path`、`branch`、`dirty`、`merged_to_main`、`locked` 與 removed／retained 原因，integration 最後回收。

清理重試只跑 cleanup，不重跑完整品質鏈。下一次 `/commit` 或接手先檢查已落地待清理批次；使用原 integration 路徑取得的 commit lock，於刪 integration 之前釋放，或以原 canonical lock path 釋放。發布未授權不妨礙已正式落地的本地來源安全清理；PR 未合併則不能清理。
