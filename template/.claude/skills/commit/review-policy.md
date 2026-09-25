# Commit reviewer qualification


本檔是每一個 runtime 的 commit review 共用政策。`gates.md` 定義觸發與完成條件；本檔決定 reviewer 是否合格。Runtime adapter 只選可執行載體，不降低資格。

> **2026-09-24 起 0-A 只有一席**：fresh-context Claude Opus 5.5（effort: medium）（Routing Table row `code-review-opus`）。GPT-6 Astra 與 Claude Fable 兩格已撤（Charles 2026-09-24：「通常一定是 Astra 先耗盡」；Fable 所有用途禁用），**沒有備援席**——Opus 額度耗盡或量不到時 gate 保持未完成、等額度恢復，**NEVER** 改派其他模型、**NEVER** 主線自審補位。規約 SoT：`rules/core/agent-routing.md` § commit 0-A reviewer。

## 每次派遣的判定表

| 欄位 | 完成條件 |
| --- | --- |
| Scope | 具名 checkout、base 與完整 changeset snapshot；每個受審檔都有內容及 hash，缺檔或截斷明示未覆蓋 |
| Context | reviewer 沒參與實作、不繼承 maker 對話；只給 diff、驗收契約及必要來源 pointer，保有查證相關 code 的讀取權 |
| Identity | 記錄 maker 與 reviewer 各自的實際 runtime、model、model family、effort、session／dispatch id；未知值不猜、不從 runtime 名推模型。reviewer receipt MUST 記 requested 與 observed model、`model_verification` 三值與原因；subagent carrier 另 MUST 記 requested／observed effort 與 `effort_verification`，缺值或不符都 exit 8、扣住 verdict。「沒核實」（如 transcript-timeout）與「核實了但不符」是兩個不同的結論，都要留逐字原因 |
| Model | 合格的 code reviewer **只有一席**：Claude Opus 5.5（effort: medium），Claude Code 主線走 in-process `commit-0a-reviewer` subagent、叫不出 Claude subagent 的 runtime 走 Herdr Claude child；0-A.1 與 0-A.2 深度 review 同一席。其他模型、主線自審、或未經 `prepare`／`finalize` 的 agent 都不滿足本欄 |
| Quality | 該組合已有對應任務的核准與品質證據；達到階段需要的推理深度，不能僅以名稱含 high 或模型較新推定等價 |
| Access | 真正的唯讀工具／OS 限制或已核准的隔離方案；僅在 prompt 寫「不要修改」不算技術隔離。材料來源與外送服務在本次授權範圍 |
| Result | 對應同一 snapshot 的完整 verdict、全部適用 Semantic Verdict id、逐項 finding 與查證位置；exit、身份、覆蓋或 snapshot 驗證失敗均保持未完成 |

**Fresh context 與模型資格分開驗證。** reviewer 是 Opus 5.5 medium，但 fresh context 仍是獨立條件：reviewer 不能是寫出這批 diff 的那個 session，身分與 coordinator 分離——主線同為 Opus 不構成自審的理由。使用者授權某模型實作，也不等於豁免其後的品質條件。

## 既有資格與新組合

0-A.1 一般 review 與 0-A.2 深度 review 都由 Opus 5.5 medium 執行，每一輪都是新的 fresh-context reviewer，兩份 receipt 各自記 requested／observed。複審 MUST 由合格席執行，NEVER 降級成主線自審、worker、cloud CI 或其他模型。

**Opus 不可用時 gate 保持未達成**並記錄 pending review——wrapper exit 4（account_unavailable）、11（account_unverifiable，量不到）、Herdr carrier 的 exit 3（review 沒跑成）都屬此類；subagent carrier 的 exit 3 是交付問題，照 `gates.md` § 0-A.1 重跑 finalize 或重跑 prepare 拿新 nonce；exit 8（model verification 為 `unverified`／`mismatch`）扣住 verdict，gate 保持未完成；**NEVER** 用其他模型、另一個 fresh agent 或主線自審補位；**NEVER** worker 或 Charles 代簽；**NEVER** 拿 cloud CI success 代替。exit 2（本地用法／依賴錯誤）、6（snapshot drift）、9（brief 無法安全交付）、10（本 session 是 leaf）是**本地或完整性問題**，照各自處置修正後重跑，不讀成 reviewer 不可用。

effort 恆 `medium`（Opus family cap）。**NEVER** 嘗試抬高——沒有 high／max 路徑，裁決需求也不升檔。`codex-review-safe.sh`（原 Astra carrier）整支 exit 2 拒跑；`CLAUDE_REVIEW_SEAT=fable` 同樣 exit 2，不靜默改 opus。

這是現行唯一的合格組合，不指定哪個 runtime 必須當主線，也不保證當前 catalog 可用。實際派遣仍逐欄通過上表；同一 runtime 再開一個 fresh-context agent，只是再跑一次同一個 reviewer，不產生額外的獨立判定。

新模型／載體採同一組有已知答案的案例比較：邏輯與安全缺陷召回、誤報反證、跨檔影響、修法 regression、完整 verdict／semantic coverage、唯讀及 snapshot 約束。保留逐例原始輸入輸出、版本與實際工具事件，明示哪些是合成案例、哪些是真實產品觀察。資格變更由對照證據與明確採用決定承載；只有可啟動、一次 PASS 或純文字壓力測試不足以改門檻。

UI Design Review 與截圖符合性 reviewer 使用 fresh Claude Opus 5.5（effort: medium），須實際取得及檢視指定圖片、對照 item 與互動證據。兩列無 Pi fallback。Routing Table 的「Opus 四列不可用時主線自己做」不適用於 commit gate：主線是 maker，不滿足上表 Context 欄，所以 Opus 5.5 無法執行時 0-B 與 0-A 一樣保持未完成。Screenshot evidence 由另一個 Gemini 3.8 Flash high worker 收集，收集 PASS 不代替 0-B 判定。沒有合格且可用的組合時，0-B 保持未完成，不以一般 code reviewer、文字摘要或自行宣稱「看過」補位。

## 執行與缺能力

1. 依當前 catalog 與已驗證 adapter 取得實際候選，逐欄記錄判定。支援 CLI 的入口可呼叫共同 wrapper；呼叫者不因 wrapper 名含 codex 或相容路徑 `.claude/` 就改變 runtime。
2. 使用該入口原生背景 handle、等待／取消及完成事件；先確保 owner 能收回結果，再並行其他軸。沒有非同步能力時可使用已授權的同步載體，保留全部 gate 與 snapshot 條件並明示並行不可用。
3. Opus 席不可用時依 `claude-review-safe.sh` 的 RESULT 行與 exit code 判定（上節）；不可用 → gate 保持未完成並保留實跑證據。主線自審可以協助修復，不能產生缺席 reviewer 的 PASS。Cloud CI success **不能代替** 0-A。Coordinator 跑 `/commit`；reviewer 必須是獨立的 fresh-context session，身分與 coordinator 分離。receipt 記 requested／observed model、`model_verification` 與 `model_verification_reason`；`unverified` NEVER 讀成已核實——wrapper 對 `unverified` 做一次有界 verification 重讀（不重跑 review），仍非 `verified` 則 verdict 扣住、gate pending。

**無 receipt 的 verdict 不得當 gate 證據。** 0-A 的 PASS 只能來自帶 requested／observed model、`model_verification` 與 session／dispatch 歸屬 receipt 的合格席輸出（`claude-review-safe.sh` 產出的那一份；subagent carrier 是 `finalize` 的 stdout）。headless `claude -p --model …`、互動 session 手動貼 prompt、主線自己轉述 subagent 回覆、手寫 prompt 派 `commit-0a-reviewer` 而沒經過 `prepare`／`finalize`，或任何沒有這份 receipt 的複審，產物只能當線索，**NEVER** 記成 0-A.1／0-A.2 的 verdict——「模型名字打對了」不等於身分已核實。

**Dispatched worker 若本身是 Claude Code session，直接走 subagent carrier**——subagent 不是巢狀 dispatch，下面的 exit 10 只屬於 Herdr carrier。**Dispatched worker（`CLADE_DISPATCH_ID` 非空）也跑得動 Herdr carrier 的 Opus 席。** `claude-review-safe.sh` 以 `--bounded-leaf` 開 reviewer child：helper 只對 readonly 的 gate-review row＋`--coordinate` 放行巢狀一層（TD-1105），leaf 本身再派仍被拒，所以 worker 可以自己取得帶 receipt 的 verdict。wrapper 回 **exit 10**（helper `nested_dispatch_refused`：本 session 本身就是 leaf）時，那一席**交回 coordinator 代跑**——exit 10 不是 reviewer 不可用，**NEVER** 讀成 exit 3 判 gate pending，**NEVER** 改走 headless `claude -p` 補一份無 receipt 的 verdict。helper 版本未含 TD-1105 時走不到 exit 10：strict `parseArgs` 不認得 `--bounded-leaf`，helper 回 `usage_error`／exit 2，wrapper 以本地用法錯誤收場——含義同樣是「這一席在本環境跑不動、交回 coordinator」，但診斷方向是 helper 版本落差而非巢狀拒絕。

**NEVER** 用假 model、假 family、假完成事件或另一入口的 tool 參數填滿表格。每一個 gate receipt 都描述實際執行；完整輸出與可核對的 snapshot 是完成證據，背景啟動成功不是。

## 消費與載入

| 欄位 | 契約 |
| --- | --- |
| 觸發條件 | 每次 commit 0-A／0-B dispatch 前逐欄判定；必要欄未滿則該 gate 未完成 |
| 消費端 | 執行 commit 的主線與 reviewer adapter；匯合時核對結果，不讓 metrics 字串替代品質證據 |
| 載入路徑 | 當前 runtime 的 commit skill `gates.md` 在 0-A／0-B 明確要求先讀本檔；規約入口由 `commit` 與 `commit.detail` 載入 skill |
