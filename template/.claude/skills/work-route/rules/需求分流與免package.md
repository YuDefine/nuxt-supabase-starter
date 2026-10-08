# 需求分流與免 package

觸發點：SKILL.md 入口步（每一次收到需求）。文中「第 N 節」指 SKILL.md 的第 N 步與它讀取的判準檔：第 0 節 `rules/worktree隔離與work-id.md`、第 1 節 `rules/定位既有工作與鑄id.md`、第 2 節 `rules/owner載入與代打.md`、第 3 節 `rules/前提修復與gate失敗.md`、第 4 節 `rules/依產物推進.md`、第 5 節 `rules/驗收交付與回報.md`；「上表」「判定表」未另指明時指 `rules/需求分流與免package.md` Rule 2。

# Rule 1 - 本入口持有接續責任，artifact 仍由指定 owner 產出

- Level: `MUST`

使用者描述想完成的工作即可。本 skill 持有從需求到驗收、交付的接續責任：定位同一工作、載入正確 owner 的契約、執行已授權步驟、處理可修復前提，再依結果繼續。不是只列出「下一支 skill」就結束的導航頁。

每份 artifact 仍由指定 owner 產出；呼叫 owner 是同一 agent 載入其完整契約後執行，或依 runtime routing 交給必要 executor，不要求使用者輸入另一個 slash command。先通過 owner 的前提，不由 router 冒充 owner 或跳過驗收。

## Good Example

- 這個例子是好的，因為判出 owner 後由同一 agent 載入契約執行並查驗產出，再接下一步。

```text
判定下一步是 spec-by-example → 載入其契約 → 產出 features/acceptance/** → 查驗 → 回第 4 步重新判定
```

## Bad Example

- 這個例子是壞的，因為只列出下一支 skill 就結束回合，把協調責任丟回使用者。

```text
「下一步請你執行 /specify」→ 結束回合
```

# Rule 2 - 依當前需求取處理列

- Level: `MUST`

| 當前需求 | 處理 |
| --- | --- |
| 只問 onboard 狀態、readiness、registry drift | 交 clade-onboard 完成查詢，不建立 package |
| 純討論、評估方案，未要求落地 | 在對話中研究與說明，不寫 repo／flow |
| 新建／採用專案 | 執行 clade-onboard 判定，依結果承接 project-bootstrap；保留其 intake、外部副作用授權與完成條件，完成後回此入口 |
| 已簽 presale 包（`presale.json` status=signed）＋ 新 repo | 同上一列走 clade-onboard → project-bootstrap（intake 由 presale 包預填）；回此入口後以 `flow plan open <slug> --seed-from <presale 目錄> --milestone M1` 開第一個 package，不從會議紀錄重寫 spec |
| 已簽 presale 包 ＋ 既有 consumer | 直接以 `flow plan open <slug> --seed-from <presale 目錄> --milestone <M-x>` 開 package；後續 Milestone 在前一個結案後才開。`contract-<M-x>.feature` NEVER 改寫或刪除，範圍變更回 presale 開修訂版 |
| clade 中央倉，registry role=source-of-truth | 依 work-lifecycle 處理；不對它跑排除 source-of-truth 的 consumer audit，也不製造 consumer manifest |
| 已 onboard 專案的新工作／續跑 | 檢查其實際 manifest 與所需 capability，定位本次 package |
| 純措辭／設定，不改行為、權限、資料或部署語意 | 依 repo 流程直接實作與驗證，免 package |
| bug 回報，出錯的是沒有 I/O 的純邏輯（計算、解析、格式化、邊界值） | 免 package：迴歸落 unit test，與修正同一個 commit；不在 `work_kind` 值域內 |
| bug 回報，出錯的行為已有 scenario | `--kind bug-covered`：NOOP delta 指向被違反的不變量＋迴歸錨點（先紅再修）；不發明新 truth |
| bug 回報，出錯的行為沒有 scenario（只有舊測試或沒有測試） | `--kind bug-uncovered`，進下方 workflow：ADD delta 把當下正確的行為寫成 truth 與 scenario，再修；該區舊測試在 Phase 3 吸收 |
| 分析發現缺陷要重構，行為不變 | `--kind refactor`，進下方 workflow：先確認（缺的以 ADD delta 補上）釘住現行行為的 scenario 且綠，再動結構；該區舊測試同一件工作吸收。行為要變就走「新增／修改／刪除既有行為」列 |
| hotfix | `flow plan open --hotfix` 先修：它帶一條「補迴歸 scenario（hotfix 先修）」open work，沒補完結不了案；補的時候以 `flow plan set-kind` 定為 `bug-covered` 或 `bug-uncovered`，不以一支 unit／e2e 迴歸測試結案 |
| 一次性工作（不改行為） | 遵守該次授權，不強套完整流程 |
| 新增／修改／刪除既有行為 | `--kind behavior`，進下方 workflow，完成已授權部分 |

## Good Example

- 這個例子是好的，因為bug 回報、出錯行為已有 scenario，取 bug-covered 列，不發明新 truth。

```text
結帳金額算錯，已有「訂單重算」scenario → flow plan open … --kind bug-covered → NOOP delta 指向該不變量＋迴歸錨點，先紅再修
```

## Bad Example

- 這個例子是壞的，因為同一情境改以一支 unit／e2e 迴歸測試結案，scenario 沒有成為迴歸錨點。

```text
結帳金額算錯（有 I/O、已有 scenario）→ 免 package，補一支 unit test 就 commit
```

# Rule 3 - 迴歸落點與舊測試吸收照 legacy-tests 判準

- Level: `MUST`

宣告 aixbdd 的 consumer 裡，迴歸只有在受測單元沒有 I/O（純計算、解析、邊界值）時才落 unit test；帶 `clade-legacy-test` marker 的舊測試怎麼吸收、變紅時怎麼分岔，照 `clade-spec-workflow` skill 的 `rules/legacy-tests.md`，**每一次**進 bug、重構或 hotfix 列之前讀它。

## Good Example

- 這個例子是好的，因為進 bug 列之前先讀 legacy-tests 判準，再決定迴歸落 scenario 還是 unit test。

```text
宣告 aixbdd 的 consumer 收到 bug → 先讀 clade-spec-workflow 的 rules/legacy-tests.md → 受測單元有 I/O → 迴歸落 scenario
```

## Bad Example

- 這個例子是壞的，因為憑上一次的印象跳過閱讀，帶 marker 的舊測試變紅時直接改斷言。

```text
「上次讀過了」→ 帶 clade-legacy-test marker 的測試紅了 → 放寬斷言求綠
```

# Rule 4 - 只查本步前提；「繼續」沿用已確認範圍

- Level: `MUST`

所有路徑都檢查本步所需前提；不要求一次備齊未來步驟的輸出。使用者的「繼續／y」沿用已確認的範圍與決策，不重新訪談；未呈現過的 PM 驗收不因泛稱繼續而視為確認。

## Good Example

- 這個例子是好的，因為「繼續」只沿用已確認的決策，未呈現過的 PM 驗收仍要展示後確認。

```text
使用者回「y」→ 沿用已確認範圍續跑；Gherkin 尚未展示 → 先展示並問具體確認問題
```

## Bad Example

- 這個例子是壞的，因為把泛稱的「繼續」當成 PM 已確認，或要求一次備齊未來步驟的輸出。

```text
使用者回「繼續」→ 視為 Gherkin 已確認，直接進 system-analysis
```
