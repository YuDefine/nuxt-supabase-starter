# Commit gate 執行與證據契約


進入 ceremony 的 Step 0-Transport 時讀本檔。每一道 gate 的觸發與判準仍由 SKILL.md、gates.md 及其引用的共通政策決定；下表定義三端如何交付可核對的執行結果。

## 三端載體

| 操作 | Claude Code | Codex | Cursor |
| --- | --- | --- | --- |
| 讀檔、取得 diff、執行 CLI | 當前 catalog 的讀檔與 shell 工具 | 當前 catalog 的讀檔與 exec 工具 | 當前 catalog 的讀檔與 terminal 工具 |
| 獨立 reviewer | 實際可派且通過 review-policy 的原生 agent 或已授權 CLI | 實際可派且通過 review-policy 的原生 agent 或已授權 CLI | 實際可派且通過 review-policy 的原生 agent 或已授權 CLI，另遵守本入口 residency 政策 |
| 等待、收回、取消 | 對該次呼叫回傳的原生 agent／process handle 操作 | 分辨 agent id、exec session id 與 running cell id，再呼叫各自工具 | 對該次呼叫回傳的 task／process handle 操作 |
| 人類決策 | 可用詢問工具；缺席時在對話中等待回答 | 可用詢問工具；缺席時在對話中等待回答 | 可用詢問工具；缺席時在對話中等待回答 |
| 瀏覽與通知 | 已連接且本次已授權的工具 | 已連接且本次已授權的工具 | 已連接且本次已授權的工具，遵守本入口 browser 政策 |

以上列的是能力角色，工具名稱與參數取自本次 catalog；不是對產品功能的存在性宣告。每個 CLI 先解析成實際存在的絕對路徑並確認依賴可執行。本 skill 宣告的隨附資源與 `COMMIT_SKILL_DIR` 見 runtime-lifecycle；中央 helper 另驗實際安裝，不由 Markdown 已送達推論依賴也已安裝。需要的載體不可用時，依該 gate 已定義的替代路徑處置；無替代就留下未完成結果。Cursor 的 0-A.2 Fable：**缺 pane 先開 pane**（`herdr-session-handoff.ts --launcher ccw --new-tab --coordinate`，失敗再 `cc`），不是略過 gate。第一次沒嘗試開 pane 就寫未完成／BLOCKED = 違規。

## 每道 gate 的共同記錄

每筆結果包含 `gate`、`work_id`、`checkout`、`runtime`、`session_id`、受測 base／snapshot／paths、實際 invocation、handle（有非同步執行時）、終態與 exit、輸出位置、verdict，以及引用的授權（需要人類決策時）。未觸發的 gate 記 predicate 與判定輸入；失敗或未取得終態不能記成 skipped。持鎖 token 留在本地 owner receipt，不進這份可分享記錄。

| Gate | 輸入與執行者（三端相同責任） | 完成輸出與失敗處置 | 證據 |
| --- | --- | --- | --- |
| 0-Lock／續持 | 主線帶真實 work／runtime／session、checkout 呼叫共同 lock CLI | acquire／renew 成功；拒絕即停止新的 gate 與 Git mutation | owner receipt；恢復另有精確 hash、原 owner、原因與授權 |
| 0-Coord／0-Scope | 主線讀 index、WIP、活動線索與既有 scope 授權，查證 ownership | 可提交候選與 withheld 範圍分明；未明內容保留並協調 | status、diff、所有權依據、協調結果、必要時的精確 stash SHA |
| 0-MR／Archive | 主線執行 branch／pathspec／人工檢查與 archive 判定 | 按 gates.md withheld 受阻 paths；不足的 archive 狀態不入庫 | 判定命令、change 名、交集與 readiness／coupling 輸出 |
| 0-S | 主線對敏感 paths 呼叫已安裝的 security scanner | 讀 exit 與 failure_class；工具故障只能走 security-scan.md 的明確授權分支 | report、coverage、ledger；未掃描授權時保留該文件要求的兩種記號 |
| 0-A.0 | 主線先執行 simplify | 完成修正才凍結 review snapshot | simplify 結果、變更後 snapshot |
| 0-A.1 | 合格獨立跨模型 reviewer；主線核對資格與結果 | 完整 verdict 與全部 finding；缺資格、缺覆蓋或 snapshot 漂移時未通過 | review-policy 各欄、真實 dispatch／session、完整輸出 |
| 0-A.2 | Critical／Major 觸發時由深度 reviewer 與不同模型族裁決者執行。Cursor 的 Fable 裁決缺 pane 時主線 MUST 先開 Herdr pane | 深度 review 和裁決都完成；其中之一缺席仍未通過。無 pane 不是合法 skip | 兩位身份、各自 snapshot／verdict、裁決與修正依據；開 pane 失敗時還要 launcher／exit／evidence receipt |
| 0-B | 已觸發視覺改動由符合 UI 政策的執行者取得真實畫面並判讀 | 依 UI gate 收斂；無 browser／截圖／合格判讀載體時保留缺口 | 頁面、viewport、截圖、判讀與修正後證據 |
| 0-C | 可派 runner 執行；主線依 gates.md 複驗 check、明確 test 與 doctor | 全部完成且符合各自判準；worker PASS、doctor exit 0 或仍在跑均不足 | 每支命令的終態與原始輸出、doctor 分數／warnings |
| 0-D | 主線比對 diff 與文件、規約、snippet、audit 契約 | 同步必要文件；匯合後依大改動回扣重驗受影響 snapshot | 文件對照、修正 diff、回扣結果 |
| 0-E／0-F | 主線執行已觸發的 entry point coverage／資產交叉比對 | 0-E 依 gate 滿分；0-F 維持 advisory | 各 entry point 分數／資產重疊與缺口，不混為同一種 verdict |
| Schema | 主線每次判觸發，命中後執行 schema-sync.md 各步 | types 比對、SQL lint 與 advisors 各留結果；遵守 reset 前備份與授權 | config 路徑、備份、重建差異、lint／advisor 輸出 |
| 分組與 commit | 主線對完整 status 候選完成 scope 與 gate 後以精確 paths 提交 | 核對 scope、內容、行數；失敗從實際失敗點處理 | commit SHA、pathspec、stat、逐檔內容驗證與剩餘 WIP |
| HANDOFF／ROADMAP | 主線更新尚未被接手的工作及相關狀態 | 依 handoff-steps.md 入庫；共享檔先查爭用 | carrier paths、提交、接手責任與 withheld 記錄 |
| 發版／CI watch | 主線跑 deploy-trigger-check，沿既有授權與 SKILL.md 的 6-A／6-B 分支 | 缺宣告／工具／一致性走 6-B；遠端動作與 CI 終態分別驗證 | trigger verdict、授權、SHA／具名 tag、對應 workflow run 終態 |
| release／中斷 | 主線先收回所有可能寫入的背景工作，再依 runtime-lifecycle.md 釋放自己的鎖 | 無法確認 writer 停止時保留鎖與責任；不以 timeout 自動接管 | correlated 終態、release receipt；中斷時保留 handle 與恢復依據 |

## 驗收層次

Source／projection test 證明文件與目標片段送達；CLI fixture 證明協定在受控 checkout 可執行；文字情境測試證明該次回答如何解讀規約。原生 ceremony 驗收另外記錄實際產品入口、身份取得、派遣與收回、決策、gate 結果、提交與退出。每個產品各列實測與未驗欄位；不把一端的結果或合成 fixture 當成另一端已完成 ceremony 的證據。
