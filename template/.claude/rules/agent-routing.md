<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-routing.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Agent Routing

<!-- never-density-reviewed: 2026-07-29 — 覆核紀錄見 docs/rule-rationale/agent-routing.md § never-density 覆核 -->

**核心命題**：當工作交給另一個 runtime + model 組合的成本/品質明顯更好時，必須 handoff 而不是硬幹。但派工的預設是**不派**——先過 § 派不派，命中外派條件才進 Routing Table。本規則優先於個別 skill 內嵌的工具呼叫指示。

> 本檔是 routing 主規則（每 session 必載入）。派工模板、Watch Protocol、Plan-first / Git baseline、Runtime Gate 在 [`agent-routing.pi-watch-protocol.md`](./agent-routing.pi-watch-protocol.md)（下稱 reference）。
>
> **決定要派 pi 之後、送出 dispatch 之前，MUST 先 Read reference 的 § Pi 派工的標準流程。** reference 的 `paths:` 綁的是 spectra / screenshot 情境，「單純要派 pi」的 session **不會**自動載入它——靠 auto-load 會讀不到（成因與實測見 `docs/rule-rationale/agent-routing.md`）。

## 派不派（先於派給誰）

**主線自己做是預設。違反字面就是違反精神**——「反正派了比較快」「一件一個 agent 比較整齊」都不算遵守。下面的 Routing Table 決定**派給誰**，本節決定**派不派**：講不出命中哪一條外派條件，就是主線自己做。

**外派條件**（命中任一才派）：

- **寬掃**——要讀 5 個以上檔案或整棵目錄樹才答得出的問題。派 scout 回結構化事實表（檔名 / 行號 / 現值 / 判準命中與否），原文不進主線
- **有份量的獨立平行軌**——兩條以上彼此不讀對方產出的工作，且**每一條**都要 10+ tool call 才做得完
- **長時間 background job**——跑得久且主線不必盯著（build / 大量 test / 長 migration）
- **需要隔離環境**——worktree 平行改動、會互相踩檔或搶 port 的工作

**不外派**（命中就自己做，即使同時有好幾條）：少量工具即可結束；路徑已知的少量讀取；規約 / 契約 / 對外文件的**措辭**；**UI view 實作**與視覺判讀 / Design Review（component / page / view / layout / styling —— 實作與品質判定都留主線 Opus，**NEVER** 派 Pi 任一 model、**NEVER** 派 Claude subagent）；需要 claude.ai-connected MCP（Notion 等）的工作；安全敏感或不可逆的動作（憑證 / 刪檔 / force push / 對外發佈）；**複驗自己剛做完的東西**（判準見 [[checker-subagent]] § 過度派）。

**具名 threshold 優先於上段的 generic「少量」判準**：同一 prompt segment 準備執行第 3 個高信心 readonly Bash、第 5 個 distinct textual Read，或第一次 Read 501+ 行文字檔時，PreToolUse gate 會建立 pending decision。主線 MUST 以 decision-linked dispatch（exact trigger 走 `luna low`；更具體工作可走共用 policy 驗證過的 concrete Pi row）、structured waiver，或 dispatcher exit 3／4 後的 matching fallback authorization receipt 結案；完整命令與狀態轉移見 reference § Routing threshold gate。

**命中多條外派條件時先問「一個 subagent 能不能全部做完」**——能就派**一個**，**NEVER** 一條 task 配一個 agent 地拆。

**同時像寬掃又像措辭時看產出形狀**：產出是事實表 / 清單 / 統計 → 派（寬掃的價值在把原文壓成結論）；產出是要寫進規約、契約或對外文件的**措辭** → 留。措辭的語氣與抽象層級一致性外包不了，派出去的典型結果是回頭逐條重寫（成本見 rationale）。

**NEVER 因 plan mode 這類唯讀模式寫不了檔，就判 in-process subagent 不能派**——`Agent` tool 的 brief 是 prompt 字串、不落檔，只有 `pi-dispatch.ts` 與 Herdr transport 落檔。逐字反開脫：「plan mode 不允許寫 brief 檔，所以改由主線直接讀檔探索」。

## 停下來要人做之前（agent 與人的邊界，先於一切派工判定）

上一節決定「主線做還是派出去」，本節決定**更前面**的一件事：這件事到底該不該離開 agent。
適用**每一次**準備寫出「請你跑 / 需要你 / 麻煩你 / 我自己解不開」的時刻，不分工具、不分情境。

**Iron Law：本 session 執行得了的動作**與**本 session 查得出答案的決策** NEVER 交給人。
違反字面就是違反精神——「他跑比較快」「這樣比較安全」「我試過了做不到」都不算遵守。

### MUST：兩條全中才准交給人

1. **該動作在本 session 已實際嘗試過並失敗**，且貼得出失敗的逐字輸出（指令 + exit code + 訊息）。
2. 失敗原因落在**人類專屬能力**：需要人的憑證或生物辨識、需要人在外部系統點擊授權、需要人做
   商業／產品決策、或該動作不可逆且既有規約明文要求人 gate。

兩條缺一就是自己做。**NEVER** 用「規約沒寫這種情況」推論可以交給人——沒有規約覆蓋的新情境，
預設是 agent 自己處理，不是升級給人。

### MUST：相鄰動作的失敗 NEVER 當作目標動作的證據

探測用的指令被擋、相似的指令失敗、同一個 gate 擋過別的東西——**都不是**目標動作會失敗的證據。
第 1 條要的是**那一個動作本身**的失敗輸出。

**NEVER** 把「機制 M 擋掉了 A」推論成「機制 M 會擋掉 B」，即使 A 與 B 都經過 M。實測：擋住
探測指令與放行解法指令，正是同一個 gate 被設計成要同時做到的兩件事。

### MUST：session-scoped 的動作只有本 session 做得到

動作若綁在本 session 的身分上（routing gate latch、session claim、verification lease、
本 session 持有的鎖），人與其他 session 都**代勞不了**——交出去不是省事，是把它變成無人能解。
遇到這類動作，第 1 條的「實際嘗試」是唯一出路。

### Red Flags（發現自己在想這些 = 停下來，先去實際跑一次）

- 「我自己解不開」——在還沒逐字跑過該動作之前
- 「這是死鎖 / 這是雞生蛋」——結構性不可能要有兩端各自的失敗輸出才成立
- 「請你跑這行就好，很快」——快不是理由，第 2 條才是
- 「我用 X 驗證過了，所以 Y 也不行」——X 不是 Y
- 「規約沒說這種情況怎麼辦，先問人比較保險」——沒覆蓋的預設是自己做
- 「這 blocker 是別 session 造成的，該問 user 怎麼走」——查歸屬 ＋ SendMessage 協調，**NEVER** 用 `AskUserQuestion` 把跨 session 衝突退回

### 已有的領域實例（本節是它們的通則，不取代任何一條）

[[proactive-skills.dev-server-spawn]]（agent 自起 dev server，不叫 user `cd`）、[[commit.detail]]
（不叫 user 開 main session）、[[session-tasks]] § Herdr session transport（transport 失敗回具體
blocker，不降級成叫 user 貼 prompt）、[[review-gui-surface]]（`fix-requested` item 是 Claude 的
工作，不推給 user）、[[manual-review.data-readiness]]（marker 誤標先改 marker，不叫 user 自己想辦法）。

新情境不在上列時適用本節通則，**NEVER** 因為「我這個情況不在清單裡」就交給人。

> 取證見 rationale § 停下來要人做之前的量測。**本證據不決定**要不要用 gate／latch 這類機制——
> **NEVER** 拿它論證放寬或移除 gate。

## Dispatch 資料邊界（Approved-Tools gate，先於能力判斷）

上一節的不外派清單管的是**動作**（憑證 / 刪檔 / force push），本節管的是**內容**：一個完全合法的
外派動作，照樣可以把 secret 或客戶個資寫進另一個 runtime 的 prompt 與其日誌。適用**每一次**
dispatch 的**每一種** brief 載體——`pi-dispatch.ts` 的 prompt 檔、Claude subagent 的 thin brief、
Herdr transport 的 durable task 檔、workflow agent 的 prompt 字串。

### MUST：brief 明列 Approved Tools

每份 brief **MUST** 有一段逐條列出這次准許動用的資源：可讀 / 可寫的檔案或目錄、可跑的指令、
可打的外部服務，並寫明**清單外的一律回報、NEVER 自取**。

這是本節唯一**買得到東西**的一條，其餘是查表（micro-test 數字見 rationale § dispatch 資料邊界的量測）。

清單寫不出來 = 這件事還沒被消化到可以外派（回 § 派不派 的預消化紀律）。

### MUST：檔案要逐個列路徑，NEVER 只給目錄名

brief 要 carrier 讀一批檔（截圖、log、fixture）時，**MUST 逐項列出精確相對路徑**，
NEVER 只寫「目錄：`./screenshots/`」讓它自己列。**NEVER** 拿「先列出目錄再逐一開啟」這句當修法——它只降低失敗率、不消除。失敗方向雖保守
（回 UNCERTAIN 而非假 PASS），但「**carrier 沒去看**」與「**證據真的不足**」在輸出上同形。
取證見 rationale § dispatch 資料邊界的量測。

### 查表：什麼不進 dispatch prompt

| 類別 | 改帶什麼 |
| --- | --- |
| 憑證與 secret 的**值**（`.env` 任一行、API key、token、cookie、session id、DB 連線字串、private key） | 變數名 + 檔案路徑（「值在目標 repo `.env.local` 的 `SUPABASE_SERVICE_ROLE_KEY`，你自己讀」） |
| 客戶個資（真實姓名 / email / 電話 / 地址 / 身分證字號 / 帳務與訂單明細） | 只給 id 與欄位型別，或同 schema 的假資料；fleet 內有客戶案（<consumer-b> / <consumer-a>） |
| 未公開商業內容（報價、合約條款、客戶內部策略） | 只給判斷所需的結論，不給原文 |
| 完整 log / DB dump / request body 原文 | 取樣 + 遮蔽後的片段 |

判準是資料**離開本 session、進入另一個 runtime**，不是誰付費、不是對方可不可信。判不出來就不帶。

**本表刻意寫成查表而不是紀律型三件套**（依據見 rationale § dispatch 資料邊界的量測）：出現第一筆
真實違規前，**NEVER** 把它加寫成 Iron Law + rationalization table。

### 為什麼這條沒有機械網子接

redaction 只在 signal payload 上強制（`vendor/signals/redact.mjs`），**dispatch prompt 不經過它**。
本節是這條路徑上唯一的攔截點，**NEVER** 假設有下游 gate 會幫忙擋。

## Session transport boundary

**Herdr transport 不新增 routing 權限。** 有空 workspace / pane 不是外派條件；當前 session 能在既有授權與 scope 內直接完成目標 cwd 的工作，就直接完成。只有本節已判定要換互動 session、或 [[session-tasks]] 的 session boundary 已成立時，才依該規約 § Herdr session transport 搬運 durable task / thin brief。

**Pane 是 dispatch 的投影，不是 dispatch 的理由。** Transport 預設分割當前 Tab，只改變已決定要派的工作長什麼樣。反方向同樣不承載資訊：**NEVER** 從「Tab 沒有分割」推論沒有工作在跑——in-process subagent 沒有 terminal。要看現況跑 `vendor/scripts/herdr-patrol.ts`。

每一個符合的跨 cwd / 新 Claude Code session handoff 都保留原有 worktree、scope、approval、verification 與 clade / consumer 邊界。Transport 失敗也不改變 routing 結論，且 **NEVER** 退回要求 user 手動 `cd`、開 session 或貼 prompt。

## Routing Table

> **Pi 派工是 (model, effort) 二維**，model 維合法值：`sol`、`sol-cursor`、`gemini`、`luna`、`luna-cursor`、`grok-xai`、`grok-cursor`（`grok` 是 `grok-cursor` 的向後相容別名）。同一 tier 的 `-cursor` 變體是**換配額池、不換檔位**，只在配額降級鏈上出現，**NEVER** 拿它當第一手選擇。**Routing Table 已列明檔位的類別照列派**（多數列為 `--model sol`，分級靠 `--effort`；web-search／screenshot-verify 兩列列明 `grok-xai`）；**原本會派 Claude subagent 的委派工作**（原判 `sonnet`／`haiku`）依 § Claude 委派的 model 檔位 轉派 `--model gemini`（額度耗盡才回 `luna`）。**NEVER 派 `--model terra`**（2026-08-11 拍板；dispatcher 仍認得它是**能力**不是政策，理由見 rationale）。**NEVER** 把 Cursor catalog 的 `gemini-3.7-flash` 當這一跳——那是 Ultra `Other Models` 桶。
>
> **`*-cursor` NEVER 接要讀 cwd 以外路徑的任務**：cursor 池的 `$HOME` 與 `/tmp` 是空 tmpfs
> （TD-520 刻意設計），派進去只會拿到一張**與真結果同形**的全 missing 表。配額鏈走到那一格時，
> brief 指涉 cwd 以外路徑就**跳過該格**進終端步驟——判的是**這份 brief**，不是列名。
> `pi-dispatch.ts` 送出前會掃 brief 拒跑（exit 1），但它只看得到 brief 寫出來的路徑，
> **NEVER** 拿它當自己不必判的理由。**NEVER** 用 `PI_CURSOR_SANDBOX_BIND` 加 bind 繞過。
> 成因與實測見 `docs/tech-debt.md` § TD-541。
>
> **理由欄只回答「為何不降 luna」，那不等於回答過「能不能用 grok」。NEVER** 把「理由欄沒提到 grok」讀成「已評估過並排除」。**樣本不足以轉列，現行檔位一律照表**；要轉先補 TD-509 列的 reps（已補的 n=1 取證見 rationale § grok 擴權取證）。
>
> 選 effort 檔位看下列六維，**NEVER** 只看「這個工作重不重要」或「迴圈長不長」：
>
> 規格清晰度／搜尋空間與分支度／語意跨度（跨檔・矛盾來源）／錯誤成本不對稱性／可驗證性／mutation blast radius
>
> | 檔位 | 何時用 |
> | --- | --- |
> | `--model sol --effort low` | **Routing Table 類別的預設檔**。一般工具協調、read-heavy synthesis、有限探索、小型可驗證修改 |
> | `--model sol --effort medium`／`high`／`xhigh` | 命中任一即升 effort，**即使迴圈很短**：高模糊度／高漏報成本／跨域衝突裁決／廣泛 mutation／結果本身就是最終品質或安全 gate。升幾檔看命中幾維、以及漏報成本有多不對稱 |
> | `--model gemini`（Routing Table 類別內降檔） | **本表列明 gemini 的列照列派**（額度耗盡才回 `luna`）；其餘要五條全中：規格完全明確 ∧ 來源已正規化 ∧ 低風險 ∧ 輸出可機械驗證 ∧ 錯誤有獨立 gate 接住。**需裁決一律不降**，回 `sol`；**exit 2 升 `sol` 重派**。**NEVER** 靜默改用舊 Flash model |
> | `--model gemini`（Claude 委派替代檔） | 原判 Claude `sonnet` 的委派工作 → `--effort high`；原判 `haiku` → `--effort low`。准入判準在 § Claude 委派的 model 檔位——這是同級工作換 runtime，**不是降檔**，不走上一列的五條連言。Gemini hop 不可用／exit 4 → `luna` |
>
> **每一次** pi dispatch **MUST 帶 `--route` 與 `--tier-basis`**（缺就 exit 1）：前者記走哪條
> 政策（本表某列 → `routing-table`；§ Claude 委派的 model 檔位 → `claude-delegate-sub`；配額降級鏈
> → `fallback-chain`；皆非才**顯式** `manual`），後者記該政策對 model 的**結論**（六值見 reference）；
> dispatcher 交叉檢查兩者與 `--model`、矛盾即 exit 1。**NEVER** 不確定就填 `manual` ／
> `table-row`——與「判定沒發生」不可區分。重試帶 `--retry-of <label>`，**NEVER** 用 `<label>2`。
>
> **`--tier-basis table-row` 時 MUST 再帶 `--table-row <列名>`**（缺就 exit 1，2026-08-13 起）：
> 列名就是下表每列開頭 〔`如此標示`〕 的那個 slug，dispatcher 拿該列列明的 model 交叉檢查。
> **NEVER** 因為「反正 table-row 也是查表」就省略它——它曾是六個 basis 裡唯一對 model
> 零約束的值，實測成了「查表姿勢做足、派哪個 model 都不受檢查」的最省力路徑（實錄見 rationale）。
> **NEVER** 在派工當下偏離列上的 model —— 認為某列該換檔位就先改本表再派。
>
> **Routing Table 類別的檔位選擇中，NEVER** 拿「輸出會被下游機械消費」當降檔理由：下游若只驗 JSON schema 而不驗語意，降檔引入的錯誤會被自動放大。只有下游具備**獨立且夠強的語意 gate** 才可降檔。（§ Claude 委派的 model 檔位 的轉派自帶語意 gate 要求——它的第 3 條 predicate 就是這一條。）
>
> **NEVER 拿 aggregate 跑分推導 routing boundary**：要看的是**這一類工作**的差距，不是總分。**同一個陷阱適用於 effort 檔位之間**——「low 跟 high 在通用題上差不多」對安全類 / 高漏報成本類零證據力。
>
> ⚠️ **配額權重 UNKNOWN**：`NEVER` 把 5:2.5:1 當成已證實的配額比寫進任何計算——那是 API 價格與 purchased-credit rate card，**訂閱內含配額**的 per-model debit multiplier 官方未公布。**降檔究竟省多少配額目前無法量化**。
>
> 跑分數字組與 benchmark 性質見 rationale § model 檔位的量測依據。

| 工作類別 | 由誰執行 | 為什麼 |
| --- | --- | --- |
| 〔`web-search`〕 **Web search**（即時資料 / 外部資訊查詢） | **Pi `--model grok-xai --effort low`**（`xai/grok-4.6`）。exit 4 → `--model grok-cursor` 同 effort 重派一次 | 走 xAI OAuth 獨立池、不吃 codex-pool 配額（轉列取證見 rationale § grok 擴權取證）。**來源可信度裁決仍是本列工作的一部分**——查不到就回「查不到」，NEVER 拿二手彙整頁的數字充數。 |
| 〔`code-review`〕 **Code review（commit 0-A）** | **(1) `simplify` + (2) Pi review xhigh（GPT-5.6-sol，經 codex-review-safe.sh），(3) 0-A.1 出 Critical / Major 時條件升 max** | 跨模型互補盲點。詳見 commit SKILL Step 0-A。effort 以 `commit/gates.md` § 0-A 與 `codex-review-safe.sh` 的 default 為 SoT。 |
| 〔`spectra`〕 **Spectra `propose` / `apply` 各階段（draft / cross-check / phase 粒度 / UI view phase）** | 見 reference § Spectra Routing Table | spectra 專屬 routing 在 path-scoped reference（碰 `openspec/changes/**` 時載入）。**不變的契約**：UI view phase 與 Design Review **都永不外派**（主線 Opus 自己做）；propose 的 cross-check / final check **一律主線跑**。 |
| 〔`spectra-phase-implementation`〕 **Spectra Apply Class C phase 語意實作** | **Pi `--model sol --effort high` via 泛用 dispatcher** | schema／migration／API／backend／非 view frontend 等 phase 的預設 carrier。Plan-first、task→file、view guard、scope、one-phase-one-commit 與 L0–L2 gate 不因 carrier 統一而放寬。**NEVER 轉 grok**——前置契約未滿足時 grok 自報 `status: pass` ＋ `tasks_completed` 非空，sol／luna 都 fail-closed（取證見 rationale § `spectra-phase-implementation` NEVER 轉 grok）。**NEVER** 反過來讀成「反正下游 check 接得住所以可以轉」：`pi-phase-dispatch.md` § 6 的 check 6 只驗 `result.status` 精確為 `pass`，對「報 pass 但沒做」零訊號。 |
| 〔`spectra-phase-prescan`〕 **Spectra Apply 已封閉 phase 的 read-only fact extraction** | **Pi `--model gemini --effort low` via 泛用 dispatcher** | 只抽 task→file、既有 symbol、exact gate command 與 source location；不得做 status／identity／relevance／實作裁決。矛盾回 `needs_reconciliation`，後續實作仍走 `spectra-phase-implementation`。exit 4 → luna。 |
| 〔`spectra-mechanical-substep`〕 **Spectra Apply machine-readable pilot marker 指定的 deterministic mutation** | **Pi `--model gemini --effort low` via 泛用 dispatcher** | 只有 execution classifier 的完整低風險 predicate 全中才 eligible；rollout stage 未開或樣本 gate 未達時只記 shadow candidate，effective route 仍是 `spectra-phase-implementation` Sol high。exit 4 → luna。 |
| 〔`screenshot-review-verify`〕 **`screenshot-review` 全部模式**（`[verify:ui]` channel / archive 前視覺 QA / commit 0-B / ad-hoc 截圖） | **`Agent` tool，`subagent_type: screenshot-review`（Claude）。本列 NEVER 派 Pi 任一 model**——`grok-xai` / `grok-cursor` / `sol` / `gemini` / `luna` 一律不准，`pi-dispatch-screenshot-verify.ts` 已 fail-closed 拒跑 | 2026-08-22 Charles 拍板收回外派。**收回的理由不是 grok 拍不好**（兩 seat 同一個 `grok-4.6`），是兩條交付路徑各有不該付的代價：`xai` seat 無沙箱、完整工具集、完整網路；`cursor` seat 要拍到本機 dev server 就得在 default-deny egress 上開 RFC1918 例外。純機械取證不值這個價，判定本來就留主線。**NEVER** 把 [[pitfall-screenshot-review-sonnet-wrapper-self-rationalize]] 讀成「Claude 收不了截圖」——那次成因是 wrapper 被設計成路由器卻決定當執行體，本列已把路由層拿掉、subagent 就是執行體。**NEVER** 恢復任何「subagent 再轉派」的形狀。四個模式一律適用；verify / archive / 0-B 三個模式的輸出仍是 gate。詳見 [[review-gui-surface]] § 為什麼只准 Claude subagent。 |
| 〔`screenshot-match-analysis`〕 **截圖 vs item 要求的匹配判定**（`[verify:ui]` 收集完成後的 gate） | **Pi `--model sol --effort xhigh` via 泛用 dispatcher** | 收集與判定是兩個角色：收集走上一列 grok low（輸出不是 gate，錯了下游接得住），判定是 gate 且要擋「亂截圖搪塞」。**NEVER** 把兩者併成同一次 dispatch——那會讓 effort 不是單一值、檔位判不出來。留 sol 的理由是**樣本不足以轉**，不是 grok 守不住（取證見 rationale § gate 列與 reconciliation 列的 grok 取證）——**NEVER** 再拿「要最高推理力」當留列依據。要轉需補到 TD-509 列的 reps。 |
| **Dev/test admin session cookie 取得**（verify channel evidence collection 階段） | **主線自己 scaffold `_dev-login` route + curl mint session**（**禁止**要 user 手動取 cookie；scaffold 前**MUST**先用 detection helper 確認真的 missing） | 詳見 [[manual-review.backend]] § Dev-login route missing → scaffold-first + [[pitfall-agent-asks-user-cookie-skipping-dev-login-scaffold]]。 |
| 〔`mechanical-fanout`〕 **Mechanical fan-out**（收集 / 掃描 / 跑指令驗證：grep 掃描、收 evidence、驗證矩陣、fleet 多 repo 盤點）。**不限委派**：主線**準備自己跑** ≥3 條唯讀指令（`grep`／`git log`／`jq`／一次性解析腳本）彙整成事實表就已命中 | **Pi `--model gemini --effort low` via 泛用 dispatcher** | 第 3 個高信心 readonly Bash 前會建立 pending decision；依 reference § Routing threshold gate 結案。走泛用 dispatcher：命令清單列得全 → `fanout-analyze`，列不全 → `fanout-collect`。例外留 Claude：需要 claude.ai-connected MCP（Notion 等）、判讀 / 治理型分析（如 /oops Mode D 判讀段）、user 明確要求。**NEVER** 以「我自己順手跑掉比較快」略過本列（成因與成本證據見 rationale）。exit 4 → luna。 |
| 〔`read-heavy-scan`〕 **封閉來源的 fact extraction**（長文件 / fleet 掃描中的固定欄位抽取）。**不限委派**：主線準備自己讀 ≥5 個檔或任一 >500 行長文件時先觸發 gate；只有 source list 已封閉、欄位固定、每筆要求 location + raw value、且不需 identity/status/relevance 裁決才走本列 | **Pi `--model gemini --effort low` via 泛用 dispatcher** | 第 5 個 distinct textual Read 或第一次 Read 501+ 行文字檔前會建立 pending decision；依 reference § Routing threshold gate 結案。來源矛盾只准回 `needs-reconciliation`，主線改派 `exploration-prescan` grok-xai low。摘要只作輸入，規約措辭與拍板回主線。**NEVER** 拿「反正我讀一下就知道了」略過 gate，也 NEVER 把固定輸出 schema 當成不需裁決的證據。exit 4 → luna。 |
| 〔`debug-evidence`〕 **Debug evidence 段**（log 完整 capture / repro script 撰寫執行 / 既定 hypothesis 的驗證迴圈） | **Pi `--model sol --effort high` via 泛用 dispatcher** | debug 是最大消耗桶；evidence / repro / verify 是機械段，root cause 推斷與修法設計留主線。repro 必在 throwaway worktree（template 內建 guard）。 |
| 〔`commit-0c-fix-verify`〕 **commit 0-C fix-verify loop**（pnpm check / test 修到全綠） | **Pi `--model grok-xai --effort high` via 泛用 dispatcher**（`xai/grok-4.6`）。同一 dispatch 最多 **2** 輪 check→fix（`--var max_iterations=2`）。exit 4 → `--model grok-cursor` 同 effort 重派一次 | 機械修 lint / type / test。本列 grok 無 class-conditional 取證，用次數上限接住；主線重跑 check **不信自報**。詳見 commit SKILL Step 0-C。 |
| 〔`commit-0c-fix-verify-escalate`〕 **commit 0-C grok 次數用盡後的 sol 升級** | **Pi `--model sol --effort high` via 泛用 dispatcher** | **NEVER** 當第一手。只在 grok 2 輪後仍紅、grok 報 pass 但主線重跑仍紅、或 grok 兩池都 exit 4 時進。 |
| 〔`security-review`〕 **Security review**（`/security-review` skill / commit 前安全檢查） | **最終 gate：Pi `--model sol --effort medium`**。候選 finding 的 pre-triage 可先跑 `--effort low`，但**收斂判定 MUST 回 medium 以上** | **NEVER** 因為「零互動 / structured diff → structured findings」就把安全 gate 當 pattern matching 降檔——漏報成本不對稱，且 class-conditional 差距遠大於通用 benchmark（class-conditional 實測見 rationale § model 檔位的量測依據）。**本列不以任何佔比為依據**（historical，見 rationale § 工作類別 telemetry 快照）。 |
| 〔`exploration-prescan`〕 **Exploration / reconciliation pre-scan**（「依賴什麼」「進度如何」「還有什麼要做」「N 張 change 狀態」或來源矛盾後對帳） | **Pi `--model grok-xai --effort low` via 泛用 dispatcher**（`xai/grok-4.6`）。exit 4 → `--model grok-cursor` 同 effort 重派一次，主線消費 structured summary | 任一命中即走本列：未知路徑探索、跨檔 identity matching、partial completion／status 推斷、evidence relevance 判斷、git/history/state reconciliation、來源衝突裁決。固定輸出矩陣不會把這些語意工作變成 extraction，**所以不降 Luna**。轉 grok 見 rationale § 群 2 四列轉 grok-xai low。主線拿 summary 做判斷，不自己逐檔 Read。 |
| 〔`handoff-scan`〕 **Handoff scan 段**（`/handoff` Mode B 的 scan：讀 HANDOFF.md + git log + openspec + tasks + git status 產出 outstanding 清單） | **Pi `--model grok-xai --effort low` via 泛用 dispatcher**（`xai/grok-4.6`）。exit 4 → `--model grok-cursor` 同 effort 重派一次，主線消費 scan report 做決策 | 四個來源可能互相矛盾，判「已 commit / 部分完成 / 被工作樹取代」是**狀態 reconciliation** 不是格式化——**這是它不能降 Luna 的原因**。轉 grok 見 rationale § 群 2 四列轉 grok-xai low。主線只看 report 做 routing。 |
| 〔`task-planning-prescan`〕 **Task-planning pre-scan**（「我需要做什麼」「接下來做什麼」「處理 N 張 change」的規劃 session 前置 scan） | **Pi `--model grok-xai --effort low` via 泛用 dispatcher**（`xai/grok-4.6`）。exit 4 → `--model grok-cursor` 同 effort 重派一次，主線消費 structured report | 產出 per-change status matrix。矩陣格式固定**不代表**語意判定機械化——identity matching、partial completion、衝突裁決都在裡面，**故不降 Luna**。轉 grok 見 rationale § 群 2 四列轉 grok-xai low。主線拿 matrix 做排序 / 決策。 |
| 〔`bugfix-evidence`〕 **Bug-fix evidence 段**（error log capture / stack trace 解析 / repro script 撰寫執行 / hypothesis 驗證迴圈） | **Pi `--model sol --effort high` via 泛用 dispatcher**（強化：非 Debug evidence 段，而是整個 bug-fix session 的 investigation 段） | investigation / evidence / repro 是機械段；root cause 推斷 + 修法設計留主線。**MUST** 在 bug-fix session 開工時先判斷：可分離的 evidence 段派 Pi，不可分離的留主線但 MUST 在 session 結尾回報未派 Pi 的理由。 |
| 〔`publish-prescan`〕 **clade publish/propagate pre-scan**（publish 前 dirty file 分組判斷：讀 `git status` + `git diff` 各 file 內容 + 辨識 logical group） | **Pi `--model grok-xai --effort low` via 泛用 dispatcher**（`xai/grok-4.6`）。exit 4 → `--model grok-cursor` 同 effort 重派一次，主線消費分組建議後 selective commit | commit grouping 要推斷修改意圖、耦合、依賴順序與可獨立回退性——**讀取命令少不等於決策機械化**；可派的只有 pre-scan 的 reading 段。轉 grok 見 rationale § 群 2 四列轉 grok-xai low。 |

## Claude 委派的 model 檔位（決定層）

上表管「派 pi 還是留 Claude」。本節只管**已決定留 Claude 的委派工作**該用哪個 model —— 這是
`Agent` / `Task` 的 `model` 參數，與 pi 的 `--model` 三檔位無關。

> **本節與 harness 預設對立，所以邊界要明寫**（完整論證見 rationale § 與 harness 預設對立）：本節
> **不**主張「委派都該指定 model」，只列**窮舉的**降檔 predicate——命中就指定 `model: 'sonnet'`，
> 一條都沒命中就照 harness 預設省略。**NEVER** 把本節讀成「不確定時降檔比較省」。

⚠️ **省多少配額 UNKNOWN**：訂閱內含配額的 per-model debit multiplier 官方未公布（同 § Routing Table
的 codex-pool 側警告）。**NEVER** 把「降 Sonnet 省 X%」寫進任何精算或對外敘述——降檔的已知收益只有
「同一份工作換更便宜的執行者」這個方向，倍率不可量化。

### 進本節前 MUST 先過 Routing Table（per § Subagent 回報契約第 4 條）

**每一個**「留 Claude」的判定都要講得出「Routing Table 沒把它 route 給 Pi」。非 UI 工作命中
已 route 給 Pi 的類別 → 派 Pi，**NEVER** 走到本節挑 Claude 檔位。本節只處理判定後**仍留
Claude** 的殘集：需 claude.ai-connected MCP、判讀／治理型分析、user 明確指定、降級鏈接手。

### `subagent_type` 是 `general-purpose` 或 `Explore` 時，派工當下 MUST 先判 pi 可用性

**適用範圍就是這兩個字面值**，且非 UI、不需 MCP，產出屬下列任一：

- **(a) 事實表／掃描結果** —— 主線要消費它的回報
- **(b) brief 內已逐字指定的機械改寫（mutation）** —— 產出就是改好的檔案本身，沒有回報要消費。
  (b) 額外 MUST 兩項：改動有**硬 gate**（typecheck ／ test ／ lint 的 exit code）接住，且**可一鍵
  還原**（`git checkout`）。兩項缺一 → 不走本節，照原判派 Claude `sonnet`。**NEVER** 拿「沒有回報
  通道就不該給 pi」當把 (b) 退回 Claude 的理由——那是 dispatch 形狀，不是檔位判準。

**每一個**這種派工都 MUST 顯式帶檔位，**NEVER** 省略參數靜默繼承主線。`subagent_type` 是別的值時照下一節四條
predicate 走，**NEVER** 把本小節外推成「委派都該指定 model」。

| 可觀察 predicate | 檔位 |
| --- | --- |
| Pi可用（dispatcher未回exit 3／4） | 原判`sonnet` → `--model gemini --effort high`；原判`haiku` → `--model gemini --effort low` |
| Pi runtime機械不可用（exit 3） | 依watch-protocol判斷修runtime或顯式改派Claude；**NEVER** fallback到Codex CLI |
| Pi配額不可用（exit 4） | 走§ 配額耗盡時的fallback紀律，`sonnet`／`haiku` **顯式帶** |

**First-hit 路徑（正路，先於下面那道 gate）**：已判定要派 pi 的工作，**MUST 直接跑 `pi-dispatch.ts`**，**NEVER** 為了「先取得 decision_id」刻意呼一次 `Agent`。未帶 `--decision-id` 時 dispatcher 會自鑄一顆決策，寫 `trigger: 'self-dispatch'` receipt、ledger 記 `decisionOrigin: self-armed`——稽核紀錄與走 gate 的那條同樣完整，差別只在少一個 round trip。刻意先撞 gate 再補救，會把一筆本來就路由正確的 dispatch 記成 block 後的補救，讓「第一擊就派對」這個指標讀起來永遠是 0。

撞到下面那道 gate 時 **NEVER 讀成自己做錯了、流程壞了、或需要有人來解**：它是取證握手，訊息裡的 `decision_id` 就是給這次 dispatch 用的。照它給的指令跑完即可，**NEVER** 停下來反省或改問人。

**PreToolUse:Agent 機械 gate**：主線呼叫 `Agent` **一律**立即建立 `claude-agent-dispatch` pending decision 並阻擋，**不分 `subagent_type`、也不分 `model`**——`Explore`／`general-purpose`／`Plan`／任何具名 agent 一律計入（省略 `subagent_type` 時按預設 `general-purpose` 記錄），**省略 `model`（繼承主線）與明寫 Opus／Fable 同樣計入**。判準是 default-deny：`model` 是 optional，省略它等於讓 subagent 繼承主線 resolved model，那正是**最貴**的委派形狀，舊版「只認明寫便宜檔位」的 key 看不到它（TD-513）。agent 名稱與請求檔位（`model=inherited` / `model=opus` …）記進 decision key 供 receipt 追溯。正常結案必須是 `pi-dispatch.ts --decision-id <id> --route claude-delegate-sub --tier-basis delegate-sub --model gemini`，effort 依請求檔位為 Haiku→low、**其餘（含 inherited／Opus／Fable）→high**。確實要留 Claude 時只接受四個具名 waiver：`claude-mcp-required`、`parent-context-required`（`subagent_type: fork` 這種必須繼承主線 context 者）、`ui-view-implementation`、`user-explicit-claude-agent`；Gemini exit 2 必須同 effort 升 Sol 重派，Sol 再 exit 2 才能以 `delegate-escalation-failed` fallback receipt 放行；Gemini exit 4 先走 `--model luna` 配額鏈；Pi exit 3／4 則先記 dispatch outcome，再走 matching fallback receipt。**NEVER** 把例外理由寫進 Agent prompt 當作 bypass——gate 只認 decision receipt，不解析自由文字。

**本節路徑的 luna 准入（與 § Routing Table 五條連言無關）**：原判 `sonnet` 的委派 MUST 同時滿足
兩項——(1) § MUST 指定 `model: 'sonnet'` 的四條 predicate 全中（原判 sonnet 的判定本身就要求這
四條，此處是複核不是加碼）；(2) 未命中 § NEVER 降檔的形狀任一條。兩項都過 → 派
`--model gemini --effort high`，**NEVER** 因「gemini 較便宜」自行改回 `--model sol` 或退回 Claude
`sonnet`。任一項不過 → 照原判派 Claude `sonnet`（顯式帶 `model`），**NEVER** `--model terra`。

**gemini 回 exit 2（業務 fail）→ 升 `--model sol` 同 effort 重派一次**；再 fail 才回 Claude `sonnet`
subagent。exit 3／4 照 § 配額耗盡時的 fallback 紀律 與 watch-protocol 的 exit code 分流走，
**NEVER** 記入品質判斷。

### MUST 指定 `model: 'sonnet'` 的 predicate（窮舉）

**每一個**同時滿足下列**四條**的委派工作都要指定，不是只處理其中最大的那一個：

1. 規格在 brief 內已明確，subagent 不需要裁決「該做什麼」
2. 目標路徑**已知且已列在 brief 裡**，不需要跨檔追蹤或探索未知路徑
3. 輸出的正確性有**獨立且夠強的語意 gate** 接住（主線複讀、test、既有 audit script）
4. 錯誤的修正成本 ≤ 重派一次

### NEVER 降檔的形狀

- 輸出**本身**就是品質或安全 gate（review / 裁決 / 安全判定）
- 需要跨檔調解矛盾證據，或需要判斷「哪些 evidence 相關」
- 產出是**規約措辭**（理由見 § Subagent 回報契約 關於措辭一致性那條）
- 輸出格式結構化**不構成**降檔理由：判準是下游有沒有語意 gate。同一條界線在 § Routing Table
  的 pi 檔位段已寫成 NEVER 行，本節適用同一條，**NEVER** 在這裡另立一套寬鬆版

### 為什麼是四條全中，不是「傾向降檔」

委派側的 model 組成、Opus 佔委派的比例、`agentType` 分佈都是 rolling window，
**判現況一律複跑** `node scripts/audit-session-context-budget.ts` 的「模型組成」與「委派 × agentType」
兩表，**NEVER** 引用任何寫死的百分比當現值。
**NEVER** 拿 `agentType` 表的分佈當委派整體的分佈（`(unattributed)` 佔大宗）——兩件量測邊界的
完整說明見 rationale § 四條全中而非「傾向降檔」。

## Orchestration Residency（誰持有長 session — 決定層）

**核心命題**：Routing Table 決定誰**寫** code，這裡決定誰**持有長 session**（成本結構見 rationale）。依 change 特性二選一：

### Codex-primary（Codex 扛整條 session）

**進入條件**（A 或 B 命中即走）：

- **A. 純非-view change**：整條 change **沒有任何 UI view phase**（view 檔案判準同 [[agent-routing.pi-watch-protocol]] § Spectra Apply Phase Dispatch B 類）**且** tasks.md 已定稿——工作性質是「執行已知計畫」。
- **B. 機械式 sweep**：lint fix / dep upgrade / rename / cross-file refactor / test 修復 / codemod，即使無正式 tasks.md。

**做法（change 粒度，不是 phase 粒度）**：

1. 主線**一次** dispatch 整條 change 的**所有**非 view phase 給單一 background pi（prompt 列全部 phase + acceptance + Plan-first + Commit Authorization；模板見 reference § Pi 派工的標準流程）。**NEVER** 一個一個 phase 派（phase 粒度是 Claude-primary 才用）。
2. Dispatch 後 **notification-only watch**（reference § 監看排程）——**不**逐 phase cross-check、**不**短輪詢。
3. 完工通知後**一次** change 粒度 cross-check：commit 數 / format、view-layer drift + scope discipline（reference § Spectra Apply Phase Dispatch Step 5）、typecheck + test。
4. 主線**自己**跑 Section 7 Design Review（永不派 pi），再進 `/commit` 0-A gate。

把關移到邊界：兩道 gate（`/commit` 0-A + archive Design Review）作用在最終 diff 上。
### Claude-primary（以下任一命中即留主線）

- **UI view 工作**（per § 派不派 不外派清單 —— 實作與品質判定都留主線 Opus，永不外派）
- **架構 / 設計決策、需求模糊**——先 plan mode 釐清
- **安全敏感** / 需 tight review loop 的 change
- **clade routing / 規則知識**的編輯
- **路徑未知的探索式 debug**

個別 phase 仍可派 pi → 走 § Spectra Propose / Apply Dispatch 指向的那兩節。

### 機械 Enforcement

**每一條** change 開工都 **MUST** 跑 `residency-classify.ts classify` 拿機械 verdict 並立刻 `record`，不是只有看起來像純後端的那條——「主線自行判斷 residency」已實證不可靠。缺 record 會被 archive-gate Check 8 擋（exit 2）。完整命令、`--reason` 必填條件、繞過 marker、adoption 量測見 reference § Orchestration Residency — 機械 Enforcement。

## Spectra Propose / Apply Dispatch（決策層 — thin pointer）

`spectra-propose` 的三選一 dispatch 選單與主線 quality gate 責任、`spectra-apply` 的 phase 粒度
三條契約（Design Review 與 UI view phase 都永不外派／非 view phase 才派 Pi／混雜 phase
的已開工與未開工分支），全文在 [[agent-routing.pi-watch-protocol]] § Spectra Propose Handoff
與 § Spectra Apply Phase Dispatch。

**跑 `/spectra-propose` 或 `/spectra-apply` 之前 MUST 先讀那兩節**——本檔的 Routing Table 只回答
「派給誰」，那兩節回答「這條 change 該怎麼切、哪些 phase 不准外派」，Routing Table 答不出來。
先判 residency（§ Orchestration Residency）仍是這兩節的前置。

## WebSearch Handoff（決策層）

1. **NEVER** 直接呼叫 Claude Code 內建的 `WebSearch` 工具
2. **MUST** 走 reference 檔的「Pi 派工的標準流程」，參數：`<topic>=websearch`、`<cwd>=/tmp`、`-c model_reasoning_effort=medium`
3. prompt 固定含：問題 + 期望輸出格式

**例外清單是窮舉的**（可直接處理）：本機檔案查詢（Read / Grep）、使用者明確要求「直接用 WebSearch」、Codex 已是當前 runtime、`WebFetch` 抓單一已知 URL。**不在這四條上的一律 handoff** —— 查詢多簡單、多趕時間、啟動開銷多不成比例，都不構成第五條例外。

**NEVER 拿本規約的 rationale 推翻本規約的字面。**「成本/品質最佳化」是這條規則存在的理由，不是可以就地自我豁免的判準 —— 照那個推法，任何一次 handoff 都論證得成「這次不划算」。三句逐字開脫與各自為什麼不成立，見 rationale § WebSearch 的開脫逐字實錄。

## 配額邊界（決策層）

Pi `openai-codex`目前不提供authoritative pre-dispatch quota snapshot。Dispatcher的quota precheck固定回`available:false`並fail-open；舊`~/.codex/sessions/**/rate_limits`只代表legacy Codex CLI歷史，**NEVER**拿它阻擋或宣稱Pi現況。

- Pi runtime回usage／rate-limit／quota error → dispatcher exit 4，payload帶`detected:'runtime'`與可解析到的`resets_at_human`。
- 沒有reset資訊時不得捏造window長度或時間；直接走 § 配額耗盡時的 fallback 紀律。
- 有明確reset時間且工作確實綁該外部signal時，可回報該時間；這不改變當下先判斷fallback能否完成工作的責任。
- `--no-quota-check`只改回報為`skipped:true`，不會繞過provider runtime quota。

### 最小 dispatch 門檻（避免瑣碎 override）

codex-primary verdict 但 ≤2 個 file 的瑣碎 fix（typo / 單行 bug / config tweak）→ Claude 直接做，**不需要**走 dispatch 流程。residency-classify 的 verdict 仍照跑（Check 8 需要 record），reason 填 `trivial-threshold`，不算 override 違規。

**判定標準**：`git diff --stat` ≤2 files **且** 預估 ≤20 行 **且** 不涉及 migration / auth / RLS / permission。超過任一門檻 → 照原 routing 走 Pi。

### 配額耗盡時的 fallback 紀律

**執行 SoT 是 dispatcher 自己的 exit 4 payload**：`pi-dispatch.ts` 撞 runtime quota 時回
`next_tier` / `next_step`（`--chain-origin` 未解時 `next_tier` 回 null 並要求補帶），逐跳鏈與終點
Claude 檔位由它機械算出。**MUST 照那個 payload 派下一跳，NEVER 憑印象選 model**——記不得鏈長什麼樣
不是問題，payload 每次都會印。

always-load 只留 payload **算不出來**的三條判斷：

- **NEVER** 把 Sol 的活降成 Luna——鏈上每一跳是**換配額池**，不是降檔
- **NEVER** 拿 `--effort low` 重試當配額應對——配額按 **model** 記，同一個 model 撞的是同一個 limit
- **輸出本身就是 gate 的工作，鏈的終點是 Fable，NEVER 是主線自審**。判準見
  `vendor/scripts/pi-routing-policy.ts` 的 `GATE_OUTPUT_ROWS`（`code-review` /
  `security-review` / `spectra-prehandoff-judge`）——那一組與 § NEVER 降檔的形狀 第一條同源，
  **MUST 一起改**。理由是這類工作沒有「誰做都行」這個性質：產出 changeset 的那條主線回頭審自己，
  跟同家族模型代審一樣，gate 形式上補了位、實質是空的。因此 sol 鏈耗盡時 dispatcher 的
  `next_step` 對這些 row 指向 **Fable subagent**（`--model fable`，effort `max`），
  對其餘 row 才維持 Opus 主線。`-cursor` 那一跳照走，它換的是配額池不是家族
- `-cursor` 那一跳的准入 **MUST 綁在待審材料的來源，NEVER 綁在使用者意願**（TD-534）。門檻是機械的、
  兩層都會擋：repo 不在 `registry/consumers.json` 內 → runtime 拒跑（`errorClass:
  material-origin-refused`）；repo 是自家的但 branch 上有從未在 origin 預設分支出現過的作者
  （第三方 PR 的形狀）→ `codex-review-safe.sh` exit 7。**NEVER** 用 env var / flag / 提示語把它做成
  可繞過的形式——那三種都是「綁使用者意願」的變體

鏈的完整形狀、cross-family 跳的准入連言、`--chain-origin` 為何在 `grok-xai` 那格 required、
grok 接手 luna 鏈的 `PRECONDITIONS_VERIFIED:` 補償控制，全文在
[[agent-routing.pi-watch-protocol]] § 配額耗盡時的 fallback 紀律 —— **要新增或改動任何一跳之前
MUST 先讀那一節**，本 pointer 不複述。

## Subagent 回報契約（所有 dispatch 通用）

適用範圍：**每一個** dispatch——Agent tool 開的 Claude subagent、泛用 dispatcher 派的 pi、[[subagent-dev]] 的 implementer / reviewer，全部適用，不是只有長任務才用。

1. **4-status 回報**：brief 內 MUST 要求 subagent 以四值之一收尾——`DONE`／`DONE_WITH_CONCERNS`（完成但對正確性有疑慮，concerns 必列）／`NEEDS_CONTEXT`（缺資訊，列缺什麼）／`BLOCKED`（做不了，列卡點與已試方法）。主線處置：`DONE_WITH_CONCERNS` → 先讀 concerns 再決定收不收；`NEEDS_CONTEXT` → 補 context 重派；`BLOCKED` → 依序考慮補 context／升 model／拆小／上報 user。**NEVER** 對 BLOCKED 原樣重派同一 model 不改任何條件。
2. **Report 是未驗證主張**：subagent 完成回報（含「no changes outside scope」「tests pass」「已自我 review」）一律當 claim——主線 MUST 用 `git status --short` + `git diff` 核實實際改動範圍 = brief 宣告 scope，scope 外 substantive change 一律 revert。subagent 自報的設計說詞（「per YAGNI 略過」「刻意簡化」）**不得**降級任何 review finding 的嚴重度——那是實作者替自己打分。
   **Cursor 池的核實邊界（TD-520）**：`*-cursor` model 的 dispatch，pi 事件流只回放 builtin 七種工具（read/bash/edit/write/grep/find/ls）∩ pi active tools 的原生執行；**非 builtin 的原生工具（WebFetch、Delete、Cursor 端 Subagent 再派、MCP 呼叫）任何 profile 下都不產 tool_execution 事件**。`git status` / `git diff` 的核實**只覆蓋 worktree 內**——worktree 外副作用（`/tmp`、`$HOME`、網路）**查不到也稽核不了**。因此：會處理 secrets / prod 憑證、或 brief 明定「不得外連」的任務 **NEVER** 走 cursor 池；其餘任務走 cursor 池時，主線 NEVER 把「worktree 核實通過 + events log 乾淨」講成「無 scope 外副作用」——cursor 池的 events log 是單向證據，有痕可信、無痕不表示沒發生。
3. **File handoffs**：brief／report／diff 超過 ~30 行的內容走**檔案路徑**傳遞，不貼進 dispatch prompt 或回報訊息——貼文會常駐主線 context、每 turn 重讀。dispatch prompt 五要素：定位一行、brief 檔路徑、跨 task interfaces、歧義裁決、report 檔路徑＋回報契約（單一事件實錄見 rationale）。
4. **Model 與 effort 顯式指定**：**每一個** dispatch 都 MUST 把 model 與 effort 當成兩個獨立決策，不靠靜默繼承——省略 = 繼承主線（通常最貴檔 × 最深推理），機械掃描型 subagent 拿主線的 xhigh 跑就是效能過剩。選檔預設，依序判：
   - **先過 Routing Table**：非 UI 工作命中本檔已 route 給 Pi 的類別 → 依該列的 model / effort 派工（`mechanical-fanout`、`read-heavy-scan` 為 `gemini low`），**NEVER** 用 Claude subagent 接；Claude subagent 只留給 Claude 例外（需 claude.ai-connected MCP、判讀／治理型分析、user 明確指定）
   - **UI view 實作**：**不派**，主線 Opus 自己做（per § 派不派 不外派清單）。**NEVER** 為它挑任何 model —— 這一格沒有合法檔位
   - **effort 選檔**：機械掃描／純轉錄 → `low`；一般執行 → `medium`；判讀型／高錯誤成本 → `high` 以上。**帶得了 effort 參數的入口**（pi `--effort` / `-c model_reasoning_effort`、Workflow `agent()` 的 `effort`、具名 agent type 的 frontmatter）**MUST** 顯式帶；Agent tool 本身沒有 effort 參數、只能繼承主線——這是機械型工作優先走 Pi 而非 Agent tool 的另一個理由
   - model 選檔原則「**turn count beats token price**」：brief 內含完整 code 的純轉錄型工作才用最低檔；review 型依 diff 的大小／風險選檔（為什麼見 rationale）。
5. **中間產物不進主線**：外派出去的 task，主線只讀對方寫回的 report 檔，**NEVER** 為了「確認它做對」把該 task 碰過的原始檔重讀一遍——那把省下來的 context 原封不動加回來，而且重讀的是同一批事實，換不到新判斷。第 2 條的 scope verify 照舊 MUST 跑：看**改了哪些檔**（`git status --short` / `git diff --stat`）跟重讀檔案內容是兩件事。

N ≥ 3 個 dispatch 的 findings 要收斂進同一個 synthesis 時，reducer 的五步形狀、group key 准入表與 guard 表在 `~/offline/clade/vendor/snippets/fan-in-reduction/`。**這不是規約**——micro-test 顯示寫成 MUST 買不到東西，見 rationale § fan-in reducer 量到什麼。

## 主線靜默上限（所有 dispatch 通用）

> **Iron Law：主線靜默 55 分鐘是上限，不是預算。違反字面就是違反精神——「等通知就好」「醒來也做不了什麼」都不算遵守。**

**Invariant**：session 內只要存在**任何**未收尾的 async work，主線相鄰兩個 assistant turn 的間隔 **NEVER** 超過 55 分鐘。

**適用範圍窮舉**（明寫，不靠外推）：**每一種** async 派工都適用，不是只有長任務——Agent tool subagent（含 `/wt` **Form 1–4 全部**）、`Bash(run_in_background)`、pi dispatch、`runner.sh`、Monitor、Workflow。

### 派出當下的自查（MUST）

派出 async job 的**同一則訊息**內問一句「這預計超過 55 分鐘嗎？**答不出來 = 會**」，再依下表動作：

| 可觀察 predicate | MUST |
| --- | --- |
| 該路徑**已有**間隔 ≤3300s 的既有 wakeup（pi 的 1500s 安全網、work-loop 的 (d) heartbeat） | 不另外排。但收到完成通知前 **MUST** 持續重排既有那個 |
| 該路徑有 async job 在跑，但沒有既有 wakeup | 立刻排 3300s keepalive；`prompt` **MUST** 使用下方 canonical inert control message，**NEVER** 放原任務輸入或虛構 id |
| 派完主線手上**還有**不依賴該結果的獨立工作 | 先做那些工作（本來就不會靜默）。做完仍在等 → 回上面兩列排 keepalive |
| session 內**沒有**任何未收尾 async job | 不排。keepalive 的觸發條件是「有東西在跑而主線不出聲」，不是「idle」 |

3300s = 55 分，留 5 分餘裕給 1 小時 TTL，落在 runtime 的 `[60, 3600]` clamp 內。

### Async keepalive prompt（canonical inert control message）

**每一種** async 派工都用這一份模板：只有 `Bash(run_in_background)` 有 `TaskOutput(block=false)` 查得到的 harness task id，填真實 `<task-id>`；**其餘每一種**（Agent tool、`/wt` Claude subagent、Monitor、Workflow）**逐字**填 `task=none`，**NEVER** 虛構 id 補洞。派出時 MUST 記下這三個欄位的值（`<owner>` 要能被 `TaskStop(owner)` 操作），控制訊息也只替換它們：

```text
ASYNC_KEEPALIVE_CONTROL task=<task-id|none> owner=<owner> deadline=<ISO>. Status-only. If task is an id, call TaskOutput(block=false) for it: if terminal, stop this wakeup and enqueue ASYNC_LIFECYCLE_HANDOFF task=<task-id> owner=<owner> cause=terminal. If task=none, never query TaskOutput or infer task status; wait for the native completion notification instead. Before deadline, if it is still running or no notification has arrived, re-arm this exact message. At deadline, or if status remains unknown after the bounded retry, stop this wakeup and enqueue ASYNC_DEADLINE_INTERVENTION task=<task-id|none> owner=<owner> cause=<deadline|unknown>. Never replay the dispatched instruction.
```

**Iron Law：async keepalive 只控制既有 async job 的生命週期，NEVER 承載原任務。違反字面就是違反精神。** 原任務含共享修改時，塞進 `prompt` 會讓 classifier 正確讀成「未來重新執行共享修改」，即使本意只是 keepalive。

native completion notification 到達時 **MUST** 停掉對應 wakeup。`task=none` 的 job 沒有 harness task status 可查，但 **owner 自己的原生狀態面**（Herdr pane 的 `agent_status`、Agent 的 idle notification）**是 allowlist 內的 liveness 確認**；被禁的是**讀 output / log / repo 猜進度**（兩者的界線見 rationale § liveness 確認 vs 猜進度）。deadline intervention 只准用 owner 的原生控制面（例如 `TaskStop(owner)`）發出取消，並等待 native terminal notification；確認 terminal 前保留 ownership，NEVER 收割、重派、記 fail-streak或釋放 lock。

### deadline 怎麼取（MUST）

canonical 模板的 `deadline` 是**必填**欄位，也是破壞性分支的觸發點——到期要 `TaskStop(owner)`，善後只能冷啟重跑。取值錯的代價因此不對稱：太晚只是多等一輪 interval，太早會砍掉一個**仍在自己預算內**的 run。**一律往晚的方向取。**

**每一次**填 `deadline` 都先答一句「我派出去的東西，自己的硬超時（子層的 pi `--budget`、CI job timeout、Monitor TTL）落在哪？」再依下表取值。**每一份** keepalive 都適用，不是只有長任務：

| 可觀察 predicate | deadline MUST |
| --- | --- |
| 派出的東西有**已知**硬超時（pi dispatch `--budget N` → 實際 kill 在 `(N+5)` 分；CI job 的 timeout；Monitor TTL） | ≥ 該硬超時 ＋ 父層收尾所需時間。**NEVER** 取一個比它早的值 |
| 兩層 dispatch，下游 job 的 budget 由子層自己決定、父層填 deadline 當下**尚不存在**（`/wt` Form 3 → Claude subagent 再自行派 pi，是主幹不是邊角） | 取子層**可能的最大** budget 當上界；上界也取不出來 → brief 內 MUST 要求子層回報它選定的 budget，收到後**改排**一次修正 deadline |
| 完全估不出硬超時 | 取一個明顯寬鬆的值，並在 `ScheduleWakeup` 的 `reason` 逐字註明「deadline 為上界猜測」 |

**NEVER** 把 deadline 讀成「我希望它多久做完」——它不是期望值，是「超過這個點就判定它卡死」的閾值。**NEVER** 靠縮短 interval 補償取不準的 deadline：interval 管 prompt cache，deadline 管誤殺，兩條軸獨立。

逐字反開脫：「dispatch 時間 +4 小時，看起來夠寬鬆了」——2026-08-13 <consumer-a> 實測父層就是這樣填出 `20:48:37`，子層選 `--budget 240`、實際 kill timeout 落在 `20:56`，早了 8 分鐘。**直覺值不是上界**。

本證據決定：deadline 往哪個方向取（一律往晚；資訊不足時取上界並改排）。
本證據不決定：要不要排 keepalive——**NEVER** 拿「deadline 估不準」當不排 keepalive 的理由。

### `/loop` dynamic 是唯一 prompt-preserving 分支

由 `/loop` dynamic mode 自我續跑的 wakeup **MUST** 保留同一份 `/loop` prompt；autonomous dynamic loop 使用 harness 指定的 `<<autonomous-loop-dynamic>>` sentinel（**逐字寫錯就等於默默放掉這個分支**，改動前先對照 `ScheduleWakeup` tool description 的 `prompt` 欄位；混用警告見 rationale）。這一支的目的就是下一輪繼續執行 loop，**NEVER** 套 inert control message。反方向也成立：`runner.sh`、work-loop background dispatch、pi safety net 都是 async keepalive，**NEVER** 因原任務來自 `/work-loop` 就保留原 prompt。

### 醒來與 consent 的契約在 [[agent-routing.keepalive-wake]]（MUST 主動 Read）

**收到 keepalive wakeup 的那個 turn、以及 permission classifier 要求具名 shared-action consent 的那一刻，MUST 先 Read [[agent-routing.keepalive-wake]]**——control turn 的 allowlist（只准 `TaskOutput(block=false)`、重排同一 inert wakeup、停 wakeup、排 lifecycle handoff / deadline intervention）、`pending → harvesting → harvested` claim 狀態機、以及 consent 選項的逐字形狀都在那裡，**此處不複述**。consent 情境**不限於** keepalive turn，非 keepalive turn 觸發時同樣 MUST Read。

### Red Flags（發現自己在想這些 = 停下來排 keepalive）

「等通知就好」／「醒來也做不了什麼」／「輪詢沒意義所以不用醒」／「這次應該很快」／「先結束這回合，有消息再說」。

### 邊界

與 `\do-all` 主線閒置禁令、全域「不要把工作往後放」都**不衝突**（兩條關係的完整論證見 rationale § keepalive 與其他兩條規約的關係）。

> 成本量級與兩次靜默實測（119 分鐘 / 1h43m）見 rationale § keepalive 的成本量級。
>
> 本證據決定：主線要不要在 async work 期間醒來——要。
> 本證據不決定：醒來後做什麼——**NEVER** 拿它論證「所以應該多醒幾次」或「醒來順便輪詢進度」，那兩件事上表已各自禁止。

## 為什麼集中寫在這

見 rationale 同名 §（含 consumer 投影 `🔒 LOCKED`／**禁止**本地 override）。

## 必禁事項

> **入表判準**（往本節加行之前先讀）：見 rationale § 必禁事項的入表判準。

### Dispatch 入口

| NEVER | 說明 |
| --- | --- |
| **NEVER** 印「請開啟Codex CLI」「Stop here」「請貼prompt」這類純文字handoff訊息要使用者手動切 | 主線必須自己以背景dispatcher派Pi模型 |
| **NEVER** 直接執行`codex`binary（含`codex exec`／`codex review`／`codex exec resume`）或把它當Pi故障fallback | 每一個active Codex-model dispatch都走`vendor/scripts/pi-dispatch.ts`或專用Pi wrapper；execution transport只有Pi |
| **NEVER** 嘗試`codex:rescue`／`codex:setup`plugin路線 | 已驗證無法使用、已全清（含`/assign`） |
| **NEVER** 把 UI view phase 派給任何 runtime（Pi 任一 model／Claude subagent 都算） | UI view 實作在不外派清單；非 view phase 的 dispatch prompt 仍 MUST 含「禁止改 view 層檔案」硬指令，缺這條 runtime 容易順手改到 .vue / .tsx |
| **NEVER** 派 pi 跑 spectra-apply phase 而 prompt 內漏 Commit Authorization 段（一 phase 一 commit / `🧹 chore: wt <change>-phase-<N>` format / hook 必跑禁 `--no-verify` / commit 前自驗 view-layer + scope） | 缺這段 pi 會混 commit、撞 commitlint hook |
| **NEVER** 派 Pi 寫 code（spectra-propose draft / spectra-apply phase）而 prompt 漏掉 Plan-first 硬指令 | 沒 plan 主線只能從 diff 反推；pi 寫完 plan 必須立刻續跑 |
| **NEVER** 派 general-purpose / worktree / 臨時 Claude subagent 自跑 playwright / agent-browser 收 verify:ui evidence | 唯一入口是 `screenshot-review` 這支**具名** agent（2026-08-22 起本 channel Claude-only，**NEVER** 派 Pi）。本列擋的是「繞過具名 agent」，**NEVER** 因收回 Pi 外派而讀成放寬。（audit 實證見 rationale § verify:ui bypass 的 audit 實證）**機械 backstop**：主線消費完 subagent 的 JSON 後跑 `verify-ui-receipt.ts` 落 receipt（`.spectra/verify-ui-dispatch-ledger.jsonl`），archive-gate Check 9 逐 item 比對，缺 receipt 且缺 `UNCERTAIN(dispatcher-error)` 痕跡 → block。**該 gate 擋的是 drift，NEVER 是對抗性偽造**——過 gate **NEVER** 讀成「evidence 來源已被證實」 |
| **NEVER** 讓 Claude subagent 當 pi 的**薄中介**——派出 pi 卻不自跑 Pi Watch Protocol，把死活判定留給上一層 | 判準是**誰持有 pi 的生命週期**，不是「有沒有經過 subagent」。薄中介的兩個已驗證失敗模式見 rationale（同 §）。完整持有生命週期的形狀見下一列 |
| pi **MUST** 由**該層編排者**在其自身 sandbox 內直接 Bash `run_in_background` 派出（含泛用 dispatcher）：主線是編排者時由主線派；`/wt` Form 3 / Form 4 的 worktree subagent 執行它被指派的 next-skill 時（`/spectra-apply` 的 Step 6b Class C、Step 8a verify channel、pre-handoff checks；`/spectra-debug` 的診斷 / repro dispatch；以及 next-skill `references/` 各層的每一處 pi 派工）由**該 subagent** 派 | 例外的**准入條件**是該編排者自跑完整 Pi Watch Protocol（notification-only + 安全網 fallback，per [[agent-routing.pi-watch-protocol]] § 監看排程）——做不到就退回上一列的薄中介禁令。編排者**以外**的任何一層對這些 pi **零探針**（per 同檔 § 跨 sandbox 可見度約束 v2）。**本列的範圍只及 `/wt` Form 3 / Form 4 開出的 worktree subagent**，**NEVER** 外推成「任意 Agent tool subagent 都可以派 pi」 |
| **NEVER** 在 exploration / research 型 session 自己逐檔 Read + scan 多個 source（openspec / HANDOFF / git log / docs）超過 3 個 source file | 先派 Pi `sol low` pre-scan 拿 structured summary，再由主線消費 summary 做判斷。例外：user 明確問特定檔案 / 需要 claude.ai-connected MCP |

### Watch 行為

| NEVER | 說明 |
| --- | --- |
| **NEVER** 沉默等使用者問進度 | 收到 `<task-notification> status=completed` 必須立刻自己讀檔回報 |
| **NEVER** 派出 pi 後不啟動 Pi Watch Protocol | 「乾等盲區」是已驗證根因 |
| **NEVER** 偵測到 `fetch failed` / sandbox 拒絕 / 互動 prompt 還繼續 wakeup | 必須立刻 `AskUserQuestion` 介入 |
| **NEVER** 在 watch loop 中跑與監看無關的工作（grep、Read、subagent） | 監看純粹只看進度 |
| **NEVER** 派 pi propose 後不跑 cross-check（post-propose-check + design-inject + 主線補 Design Review 7 步 + spectra analyze） | 主線 = quality gate |
| **NEVER** 收到 pi 完工通知後跳過 view-layer drift 檢查（`git diff --name-only` 過濾 view 路徑） | 主要的回收 quality gate |
| **NEVER** 對主線直接 Bash 派的 pi 啟動每 3 分鐘強制 poll | 直接派預設 **notification-only** + 單一 ~1500s 安全網 fallback。subagent 中介 dispatch 已全面禁止（§ Dispatch 入口） |
| **NEVER** 現場自組 `pgrep` / `ps \| grep` 當進度探針 | 要回報「派出去的長任務做到哪」時，**MUST** 貼 cookbook `~/offline/clade/vendor/snippets/subagent-progress-probe/` 的 artifact 探針（worktree commit 對 **merge-base**、tasks.md tick count 附分母、輸出檔 mtime + size）。process 列表沒有租戶邊界，兩個方向都會給錯答案（成因見 rationale） |

### Commit 0-A

| NEVER | 說明 |
| --- | --- |
| **NEVER** 在 commit 0-A 把 `simplify` 跟 pi 並行 | simplify 修完才是 pi 該看的版本 |
| **NEVER** 在 commit 0-A 啟用已棄用的 `code-review` agent（Opus subagent） | 與 pi review 重疊且同為 Anthropic 模型盲點 |
| **NEVER** 在 commit 0-A 跑第 3 輪 pi | 2 輪內處理不完先 split；0-A.2 由 0-A.1 Critical / Major 條件觸發，不可無條件升級也不可跳過 |
| **NEVER** 在 commit 0-A.0 用 `Agent` 包一層跑 simplify，也 **NEVER** 在 prompt 裡叫 agent 自行 launch N 個平行 review 子 agent | 主線直接 `Skill(simplify)`；四軸分工是 `simplify` skill 本體的內部實作。依據見 rationale，詳見 commit `gates.md` § 0-A.0 |

### Runtime gate

| NEVER | 說明 |
| --- | --- |
| **NEVER** 在 Pi 端執行 `$spectra-apply` 而 prompt body 沒有 `[DELEGATED-BY-CLAUDE-CODE]` marker | **MUST** 立即 STOP，不執行任何 `spectra` 命令（reference § Runtime Gate） |
| **NEVER** 主線派 Pi 跑 spectra apply phase 而 prompt 第一行不是 `[DELEGATED-BY-CLAUDE-CODE]` marker | 會被 Codex 端 Runtime Gate 擋掉、整個 phase dispatch 白做 |

另：**NEVER** 把 routing 例外寫死在個別 skill；要加例外請改本檔的 Routing Table。
