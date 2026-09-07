<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/commit/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Commit reviewer qualification

<!-- clade-targets: claude,codex,cursor -->

本檔是每一個 runtime 的 commit review 共用政策。`gates.md` 定義觸發與完成條件；本檔決定 reviewer 是否合格。Runtime adapter 只選可執行載體，不降低資格。

## 每次派遣的判定表

| 欄位 | 完成條件 |
| --- | --- |
| Scope | 具名 checkout、base 與完整 changeset snapshot；每個受審檔都有內容及 hash，缺檔或截斷明示未覆蓋 |
| Context | reviewer 沒參與實作、不繼承 maker 對話；只給 diff、驗收契約及必要來源 pointer，保有查證相關 code 的讀取權 |
| Identity | 記錄 maker 與 reviewer 各自的實際 runtime、model、model family、effort、session／dispatch id；未知值不猜、不從 runtime 名推模型 |
| Model difference | 0-A.1 reviewer 與 maker 的模型族不同；0-A.2 裁決者與深度 reviewer 的模型族不同。換帳號、供應池、runtime 或 fresh session 不自動滿足本欄 |
| Quality | 該組合已有對應任務的核准與品質證據；達到階段需要的推理深度，不能僅以名稱含 high 或模型較新推定等價 |
| Access | 真正的唯讀工具／OS 限制或已核准的隔離方案；僅在 prompt 寫「不要修改」不算技術隔離。材料來源與外送服務在本次授權範圍 |
| Result | 對應同一 snapshot 的完整 verdict、全部適用 Semantic Verdict id、逐項 finding 與查證位置；exit、身份、覆蓋或 snapshot 驗證失敗均保持未完成 |

**Fresh context 與跨模型分開驗證。** 同模型的新上下文可以完成獨立 checker，但不能充作本流程的跨模型 gate。使用者授權某模型實作，也不等於豁免其後的品質條件。

## 既有資格與新組合

最新 main 的 code-review 基準是 GPT-6-astra via Pi（effort: medium）（一般與深度）與 Claude Fable 5.1（effort: max）（裁決及一般 review fallback）。原 Sol low 對應 Astra low，其餘原 Sol effort 對應 Astra medium。Astra 目前沒有已驗證的 Cursor model，不走 Cursor 換池。Astra 配額不足時，只有 fresh Fable 仍通過下表模型差異與資格判定才可接手；不符合或不可用就保留 gate 未達成。

這是已使用組合的基準，不指定哪個 runtime 必須當主線，也不保證當前 catalog 可用。實際派遣仍逐欄通過上表；例如 maker 已屬 GPT 系列，另一個 GPT 席位不因名字不同就自動達成跨模型。

新模型／載體採同一組有已知答案的案例比較：邏輯與安全缺陷召回、誤報反證、跨檔影響、修法 regression、完整 verdict／semantic coverage、唯讀及 snapshot 約束。保留逐例原始輸入輸出、版本與實際工具事件，明示哪些是合成案例、哪些是真實產品觀察。資格變更由對照證據與明確採用決定承載；只有可啟動、一次 PASS 或純文字壓力測試不足以改門檻。

UI reviewer 另須能實際取得及檢視指定圖片、對照 item 與互動證據。既有 `screenshot-review` 的視覺品質資格不會隨檔案投影自動轉移到另一載體。沒有合格且可用的組合時，0-B 保持未完成，不以一般 code reviewer、文字摘要或自行宣稱「看過」補位。

## 執行與缺能力

1. 依當前 catalog 與已驗證 adapter 取得實際候選，逐欄記錄判定。支援 CLI 的入口可呼叫共同 wrapper；呼叫者不因 wrapper 名含 codex 或相容路徑 `.claude/` 就改變 runtime。
2. 使用該入口原生背景 handle、等待／取消及完成事件；先確保 owner 能收回結果，再並行其他軸。沒有非同步能力時可使用已授權的同步載體，保留全部 gate 與 snapshot 條件並明示並行不可用。沒有可用載體則保持未完成。
3. 配額耗盡只改已核准的候選／供應池，重新驗模型差異與品質；更換 runtime 需既有授權。候選全不可用時記錄未達 gate、snapshot 及原因，停止 commit。主線自審可以協助修復，不能產生缺席 reviewer 的 PASS。

**NEVER** 用假 model、假 family、假完成事件或另一入口的 tool 參數填滿表格。每一個 gate receipt 都描述實際執行；完整輸出與可核對的 snapshot 是完成證據，背景啟動成功不是。

## 消費與載入

| 欄位 | 契約 |
| --- | --- |
| 觸發條件 | 每次 commit 0-A／0-B dispatch 或 fallback 前逐欄判定；必要欄未滿則該 gate 未完成 |
| 消費端 | 執行 commit 的主線與 reviewer adapter；匯合時核對結果，不讓 metrics 字串替代品質證據 |
| 載入路徑 | 當前 runtime 的 commit skill `gates.md` 在 0-A／0-B 明確要求先讀本檔；規約入口由 `commit` 與 `commit.detail` 載入 skill |
