<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/commit/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Commit lock 生命週期

<!-- clade-targets: claude,codex,cursor -->

每次進入 `/commit` 的 Step 0-Lock，以及中斷後重入、切換 session、處理持鎖衝突或離開流程前，**MUST 完整讀本檔**。三種 runtime 使用同一個鎖協定；原生工具、背景工作與通知能力以當前入口實際提供的能力為準。

## 呼叫上下文

| REQUIRED 值 | 來源 |
|---|---|
| `COMMIT_SKILL_DIR` | 本次實際載入的原生 commit skill 目錄絕對路徑，由載入來源取得；不要由模型名或其他 runtime 的目錄猜測 |
| `COMMIT_REPO` | 本次 ceremony 操作的 checkout 絕對路徑；不沿用其他 checkout 的 `CLAUDE_PROJECT_DIR` |
| `CLADE_WORK_ID` | 這件工作的既有 flow work id，沿用 [[flow-work-tracking]] 的工作歸屬；不為每個 gate 另開一件工作 |
| `COMMIT_RUNTIME` | 當前執行入口：`claude`、`codex` 或 `cursor`，不是模型名稱 |
| `COMMIT_SESSION_ID` | 當前原生 session 的確切識別；由該 runtime 的 session context／receipt 取得，不拿父 session、pane title 或模型名稱代填 |
| `COMMIT_OWNER_TOKEN` | 本次成功 acquire receipt 的 owner token；首次 acquire 前尚無此值 |

下列 shell 變數表示上述已查證的值。**每次工具呼叫都要帶齊實值**；前一次 shell 的 `export` 不保證存在於下一次 shell。無法取得 work／runtime／session 身分時，停在 Step 0-Lock 並指出缺哪個值，不開始品質閘門或 Git mutation。

將成功 acquire 的完整 receipt 保留在本工作可恢復的本地紀錄，連同 checkout、work、runtime、session 與 invocation。Token 不寫入 tracked 文件、commit message 或對外報告。

## 執行依賴

原生投影隨本 skill 交付 `scripts/commit-lock.mjs`、`scripts/0a-metrics.mjs`、`scripts/codex-review-safe.sh` 與 `references/` 下的兩份 review 政策。執行 Node script 使用 `node`，shell wrapper 使用 `bash`；交付檔不依賴 executable bit。先確認本次載入位置與所需檔案可讀，缺檔回報投影缺口。

這些資源不包含整套中央工具鏈。選用 Pi review wrapper 前依 runner-safety 確認中央 runner、工具與認證；各 gate 引用的中央 security、Spectra、Notion、BP helper 則在該 gate 觸發時確認 `CLADE_HOME` 與實際 helper。資源存在只證明交付，不證明前置依賴可用或該 gate 已通過。

## 取得與續持

首次取得：

```bash
node "$COMMIT_SKILL_DIR/scripts/commit-lock.mjs" acquire \
  --repo "$COMMIT_REPO" --work-id "$CLADE_WORK_ID" \
  --runtime "$COMMIT_RUNTIME" --session-id "$COMMIT_SESSION_ID" --json
```

成功 receipt 才表示取得互斥。**鎖不替代 WIP 所有權、品質閘門或發版授權**。接著依 SKILL.md 的順序執行 0-Coord、0-Scope 與後續 gates。

每次開始下一個 gate、收回背景 gate 結果，以及進入 Git mutation 前，使用同一 tuple 與 token 續持：

```bash
node "$COMMIT_SKILL_DIR/scripts/commit-lock.mjs" renew \
  --repo "$COMMIT_REPO" --work-id "$CLADE_WORK_ID" \
  --runtime "$COMMIT_RUNTIME" --session-id "$COMMIT_SESSION_ID" \
  --owner-token "$COMMIT_OWNER_TOKEN" --json
```

續持失敗 → 停止新的 gate／Git mutation，核對鎖現況與已起跑工作的狀態。**NEVER** 另取一個 token 讓失去所有權的 ceremony 繼續跑。

## 背景工作與退出

背景 gate 啟動後記錄其真實 handle、runtime/session、work id 與責任人。用當前入口支援的 wait／status／cancel 操作收回結果；通知只是提醒，完成仍以 correlated 終態及輸出為準。工具 catalog 沒有對應能力時，該分支維持未達成；只可走既有授權的替代 transport，不套用其他 runtime 的工具參數。

正常完成、gate 失敗或使用者中止時，先讓本 ceremony 已起跑且會改檔／index／ref 的工作全部結束，或確認取消成功，再釋放自己的鎖。無法確認這些工作已停止時保留鎖，回報具體 handle 與接手責任；不能一邊釋放互斥、一邊留下仍會寫入的背景工作。

```bash
node "$COMMIT_SKILL_DIR/scripts/commit-lock.mjs" release \
  --repo "$COMMIT_REPO" --work-id "$CLADE_WORK_ID" \
  --runtime "$COMMIT_RUNTIME" --session-id "$COMMIT_SESSION_ID" \
  --owner-token "$COMMIT_OWNER_TOKEN" --json
```

收尾文字依當下已有的 receipt 選擇：

| 已取得的證據 | 可回報的現況 |
|---|---|
| commit 已驗證，writer 仍 running／終態未知 | commit 已建立；writer `<handle>` 尚未收回，鎖保留，流程尚未結束 |
| writer 終態與最後內容核對已完成，release receipt 成功 | commit 與最後核對已完成，背景工作已收回，自己的鎖已釋放 |

預定執行的 wait／cancel／release 只寫成下一步；不能把其預期結果填進第二列。取消本 ceremony 工作後仍要取得終態，取消請求本身不證明已停止。

保留 release receipt。拒絕釋放時保持原鎖與失敗證據，**NEVER** 改用 `rm`、省略身分或改填持有者身分繞過。

## 中斷與恢復

| 現況 | 動作 |
|---|---|
| 同一 work／runtime／session，保有原 token | acquire 帶同一 `--owner-token` 重入；核對先前 gate 的來源／diff 是否仍有效，接回已啟動的工作，不以重入 receipt 宣稱先前 gates 已通過 |
| 其他持有者仍在 | 用當前可用且已授權的協調通道聯絡，讓持有者自行完成退出與 release；沒有通道則回報持有者與缺口 |
| 只有 timeout、舊 heartbeat、失聯或 CLI PID 已消失 | 只能判為需要調查；這些訊號都不構成接管授權 |
| 原 ceremony 已確認結束，且本次有恢復授權 | 讀取 status 的當前 `lockHash`；canonical lock 缺席但有中斷 guard 時取 `emptyLockHash`。記錄確認方式、授權與原因，以本次恢復者自己的 work／runtime／session 核對同一快照 |
| session 已變、token 遺失、legacy／corrupt owner 或 ownership 不明 | 保留現況，先查證原 ceremony 與恢復授權；不偽造舊 session 或從鎖檔抄 token 冒充原持有者 |

```bash
node "$COMMIT_SKILL_DIR/scripts/commit-lock.mjs" status --repo "$COMMIT_REPO" --json
node "$COMMIT_SKILL_DIR/scripts/commit-lock.mjs" recover \
  --repo "$COMMIT_REPO" --work-id "$CLADE_WORK_ID" \
  --runtime "$COMMIT_RUNTIME" --session-id "$COMMIT_SESSION_ID" \
  --expected-lock-hash "$COMMIT_LOCK_HASH" --owner-ended \
  --reason "$COMMIT_RECOVERY_REASON" --json
```

`--owner-ended` 是呼叫者的明示斷言，**不是工具查證原生 session 已死**；hash 是被授權恢復的那份精確鎖快照。恢復者使用自己的 tuple，不能填成原持有者。原 owner 或 bytes 已變則拒絕，不自動改用新 hash 重試。恢復 receipt 保留原 owner、恢復者、快照與原因；恢復成功後仍須另跑首次 acquire 取得本次 token。

中斷 guard／recovery claim 是未完成操作的證據，canonical lock 缺席也不表示 checkout 已解鎖。工具會驗 journal、owner 與快照；毀損或歸屬不符時保留現場並拒絕恢復。成功恢復後以同一 expected hash 重試可取得既有 terminal receipt；期間出現新持有者時拒絕，不清除新鎖。失敗回報 `claimPath` 時保留該證據檔，不以手動刪除消除診斷。

## 證據邊界

每次 lifecycle receipt 記錄動作、checkout、work／runtime／session、結果與時間。每個 gate 另留來源／diff、實際 invocation、退出狀態及輸出位置；lock receipt 不代替 gate receipt。

三端共用 CLI 的 fixture 通過只證明協定。各產品入口的原生身分取得、背景等待、詢問、通知與中斷接續，仍須逐入口留實際證據；缺證據列未驗，不由另一產品的成功外推。
