<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-routing.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Agent Routing

<!-- never-density-reviewed: 2026-07-29 — 覆核紀錄見 docs/rule-rationale/agent-routing.md § never-density 覆核 -->

**核心命題**：當工作交給另一個 runtime + model 組合的成本/品質明顯更好時，必須 handoff 而不是硬幹。但派工的預設是**不派**——先過 § 派不派，命中外派條件才進 Routing Table。本規則優先於個別 skill 內嵌的工具呼叫指示。

> 本檔是 routing 主規則（每 session 必載入）。派工模板、Watch Protocol、Plan-first / Git baseline、Runtime Gate 在 [`agent-routing.codex-watch-protocol.md`](./agent-routing.codex-watch-protocol.md)（下稱 reference）。
>
> **決定要派 codex 之後、送出 dispatch 之前，MUST 先 Read reference 的 § Codex 派工的標準流程。** reference 的 `paths:` 綁的是 spectra / screenshot 情境，「單純要派 codex」的 session **不會**自動載入它——靠 auto-load 會讀不到（成因與實測見 `docs/rule-rationale/agent-routing.md`）。

## 派不派（先於派給誰）

**主線自己做是預設。違反字面就是違反精神**——「反正派了比較快」「一件一個 agent 比較整齊」都不算遵守。下面的 Routing Table 決定**派給誰**，本節決定**派不派**：講不出命中哪一條外派條件，就是主線自己做。

**外派條件**（命中任一才派）：

- **寬掃**——要讀 5 個以上檔案或整棵目錄樹才答得出的問題。派 scout 回結構化事實表（檔名 / 行號 / 現值 / 判準命中與否），原文不進主線
- **有份量的獨立平行軌**——兩條以上彼此不讀對方產出的工作，且**每一條**都要 10+ tool call 才做得完
- **長時間 background job**——跑得久且主線不必盯著（build / 大量 test / 長 migration）
- **需要隔離環境**——worktree 平行改動、會互相踩檔或搶 port 的工作

**不外派**（命中就自己做，即使同時有好幾條）：少量工具即可結束；路徑已知的少量讀取；規約 / 契約 / 對外文件的**措辭**；視覺判讀與 Design Review（品質判定本身外包不了）；需要 claude.ai-connected MCP（Notion 等）的工作；安全敏感或不可逆的動作（憑證 / 刪檔 / force push / 對外發佈）；**複驗自己剛做完的東西**（判準見 [[checker-subagent]] § 過度派）。

**具名 threshold 優先於上段的 generic「少量」判準**：同一 prompt segment 準備執行第 3 個高信心 readonly Bash、第 5 個 distinct textual Read，或第一次 Read 501+ 行文字檔時，PreToolUse gate 會建立 pending decision。主線 MUST 以 decision-linked dispatch（exact trigger 走 `luna low`；更具體工作可走共用 policy 驗證過的 concrete Codex row）、structured waiver，或 dispatcher exit 3／4 後的 matching fallback authorization receipt 結案；完整命令與狀態轉移見 reference § Routing threshold gate。

**UI view 實作不在不外派清單**：命中外派條件時可派，但外派目標**只有一個合法值**——Claude `sonnet` subagent（per § Subagent 回報契約第 4 條），**NEVER** 派 codex（任何檔位）。視覺判讀與 Design Review 仍照上段留主線——可外派的是**實作**，不是品質判定。

**命中多條外派條件時先問「一個 subagent 能不能全部做完」**——能就派**一個**，**NEVER** 一條 task 配一個 agent 地拆。

**同時像寬掃又像措辭時看產出形狀**：產出是事實表 / 清單 / 統計 → 派（寬掃的價值在把原文壓成結論）；產出是要寫進規約、契約或對外文件的**措辭** → 留。措辭的語氣與抽象層級一致性外包不了，派出去的典型結果是回頭逐條重寫（成本見 rationale）。

## Dispatch 資料邊界（Approved-Tools gate，先於能力判斷）

上一節的不外派清單管的是**動作**（憑證 / 刪檔 / force push），本節管的是**內容**：一個完全合法的
外派動作，照樣可以把 secret 或客戶個資寫進另一個 runtime 的 prompt 與其日誌。適用**每一次**
dispatch 的**每一種** brief 載體——`codex-dispatch.ts` 的 prompt 檔、Claude subagent 的 thin brief、
Herdr transport 的 durable task 檔、workflow agent 的 prompt 字串。

### MUST：brief 明列 Approved Tools

每份 brief **MUST** 有一段逐條列出這次准許動用的資源：可讀 / 可寫的檔案或目錄、可跑的指令、
可打的外部服務，並寫明**清單外的一律回報、NEVER 自取**。

這是本節唯一**買得到東西**的一條，其餘是查表。實測（2026-08-13，`dispatch-data-boundary`
scenario，5 reps 兩臂）：無規約時 **0/5** 的 brief 帶准許資源清單，有規約時 **5/5** 帶。

清單寫不出來 = 這件事還沒被消化到可以外派（回 § 派不派 的預消化紀律）。

### 查表：什麼不進 dispatch prompt

| 類別 | 改帶什麼 |
| --- | --- |
| 憑證與 secret 的**值**（`.env` 任一行、API key、token、cookie、session id、DB 連線字串、private key） | 變數名 + 檔案路徑（「值在目標 repo `.env.local` 的 `SUPABASE_SERVICE_ROLE_KEY`，你自己讀」） |
| 客戶個資（真實姓名 / email / 電話 / 地址 / 身分證字號 / 帳務與訂單明細） | 只給 id 與欄位型別，或同 schema 的假資料；fleet 內有客戶案（<consumer-b> / <consumer-a>） |
| 未公開商業內容（報價、合約條款、客戶內部策略） | 只給判斷所需的結論，不給原文 |
| 完整 log / DB dump / request body 原文 | 取樣 + 遮蔽後的片段 |

判準是資料**離開本 session、進入另一個 runtime**，不是誰付費、不是對方可不可信。判不出來就不帶。

**本表刻意寫成查表而不是紀律型三件套**：同一次 micro-test 顯示這半**兩臂皆 5/5**——無規約時模型
已經自發指路徑不貼值、自發遮蔽個資。沒有真實違規 telemetry 佐證前，**NEVER** 把它加寫成
Iron Law + rationalization table（per [[rule-authoring]] § 先分類失敗型態：沒有要修的失敗就別加句子）。
出現第一筆真實違規時，處置是**帶著那筆 telemetry**回來改寫本節，不是憑感覺加強語氣。

### 為什麼這條沒有機械網子接

redaction 只在 signal payload 上強制（`vendor/signals/redact.mjs`），**dispatch prompt 不經過它**。
本節是這條路徑上唯一的攔截點，**NEVER** 假設有下游 gate 會幫忙擋。

## Session transport boundary

**Herdr transport 不新增 routing 權限。** 有空 workspace / pane 不是外派條件；當前 session 能在既有授權與 scope 內直接完成目標 cwd 的工作，就直接完成。只有本節已判定要換互動 session、或 [[session-tasks]] 的 session boundary 已成立時，才依該規約 § Herdr session transport 搬運 durable task / thin brief。

**Pane 是 dispatch 的投影，不是 dispatch 的理由。** Transport 預設分割當前 Tab，只改變已決定要派的工作長什麼樣。反方向同樣不承載資訊：**NEVER** 從「Tab 沒有分割」推論沒有工作在跑——in-process subagent 沒有 terminal。要看現況跑 `vendor/scripts/herdr-patrol.ts`。

每一個符合的跨 cwd / 新 Claude Code session handoff 都保留原有 worktree、scope、approval、verification 與 clade / consumer 邊界。Transport 失敗也不改變 routing 結論，且 **NEVER** 退回要求 user 手動 `cd`、開 session 或貼 prompt。

## Routing Table

> **Codex 派工是 (model, effort) 二維**，model 維只有兩個合法值：`sol` 與 `luna`。**Routing Table 已列明檔位的類別照列派**（各列多為 `--model sol`，分級靠 `--effort`）；**原本會派 Claude subagent 的委派工作**（原判 `sonnet`／`haiku`）依 § Claude 委派的 model 檔位 轉派 `--model luna`。**NEVER 派 `--model terra`**（2026-08-11 拍板；dispatcher 仍認得它是**能力**不是政策，理由見 rationale）。
>
> 選 effort 檔位看下列六維，**NEVER** 只看「這個工作重不重要」或「迴圈長不長」：
>
> 規格清晰度／搜尋空間與分支度／語意跨度（跨檔・矛盾來源）／錯誤成本不對稱性／可驗證性／mutation blast radius
>
> | 檔位 | 何時用 |
> | --- | --- |
> | `--model sol --effort low` | **Routing Table 類別的預設檔**。一般工具協調、read-heavy synthesis、有限探索、小型可驗證修改 |
> | `--model sol --effort medium`／`high`／`xhigh` | 命中任一即升 effort，**即使迴圈很短**：高模糊度／高漏報成本／跨域衝突裁決／廣泛 mutation／結果本身就是最終品質或安全 gate。升幾檔看命中幾維、以及漏報成本有多不對稱 |
> | `--model luna`（Routing Table 類別內降檔） | **本表列明 luna 的列照列派**；其餘要五條全中：規格完全明確 ∧ 來源已正規化 ∧ 低風險 ∧ 輸出可機械驗證 ∧ 錯誤有獨立 gate 接住。**需裁決一律不降**，回 `sol`；**exit 2 升 `sol` 重派** |
> | `--model luna`（Claude 委派替代檔） | 原判 Claude `sonnet` 的委派工作 → `--effort high`；原判 `haiku` → `--effort low`。准入判準在 § Claude 委派的 model 檔位——這是同級工作換 runtime，**不是降檔**，不走上一列的五條連言 |
>
> **每一次** codex dispatch **MUST 帶 `--route` 與 `--tier-basis`**（缺就 exit 1）：前者記走哪條
> 政策（本表某列 → `routing-table`；§ Claude 委派的 model 檔位 → `claude-delegate-sub`；配額降級鏈
> → `fallback-chain`；皆非才**顯式** `manual`），後者記該政策對 model 的**結論**（六值見 reference）；
> dispatcher 交叉檢查兩者與 `--model`、矛盾即 exit 1。**NEVER** 不確定就填 `manual` ／
> `table-row`——與「判定沒發生」不可區分。重試帶 `--retry-of <label>`，**NEVER** 用 `<label>2`。
>
> **`--tier-basis table-row` 時 MUST 再帶 `--table-row <列名>`**（缺就 exit 1，2026-08-13 起）：
> 列名就是下表每列開頭 〔`如此標示`〕 的那個 slug，dispatcher 拿該列列明的 model 交叉檢查。
> **NEVER** 因為「反正 table-row 也是查表」就省略它——`table-row` 曾是六個 basis 裡唯一對 model
> 零約束的值，於是宣告它成了「查表姿勢做足、派哪個 model 都不受檢查」的最省力路徑（2026-08-13
> `v1-annual-leave-scan`：命中 `read-heavy-scan` 列、該列列明 luna，實際派 sol，無人察覺）。
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
| 〔`web-search`〕 **Web search**（即時資料 / 外部資訊查詢） | **Codex `--model sol --effort low`** | 搜尋 + 整合，非長迴圈。 |
| 〔`code-review`〕 **Code review（commit 0-A）** | **(1) `simplify` + (2) Pi Codex review high（GPT-5.6-sol，經 codex-review-safe.sh），(3) 0-A.1 出 Critical / Major 時條件升 xhigh** | 跨模型互補盲點。詳見 commit SKILL Step 0-A。 |
| 〔`spectra`〕 **Spectra `propose` / `apply` 各階段（draft / cross-check / phase 粒度 / UI view phase）** | 見 reference § Spectra Routing Table | spectra 專屬 routing 在 path-scoped reference（碰 `openspec/changes/**` 時載入）。**不變的契約**：UI view phase 與 Design Review **永不派 codex**；propose 的 cross-check / final check **一律主線跑**。 |
| 〔`spectra-phase-implementation`〕 **Spectra Apply Class C phase 語意實作** | **Codex `--model sol --effort high` via 泛用 dispatcher** | schema／migration／API／backend／非 view frontend 等 phase 的預設 carrier。Plan-first、task→file、view guard、scope、one-phase-one-commit 與 L0–L2 gate 不因 carrier 統一而放寬。 |
| 〔`spectra-phase-prescan`〕 **Spectra Apply 已封閉 phase 的 read-only fact extraction** | **Codex `--model luna --effort low` via 泛用 dispatcher** | 只抽 task→file、既有 symbol、exact gate command 與 source location；不得做 status／identity／relevance／實作裁決。矛盾回 `needs_reconciliation`，後續實作仍走 `spectra-phase-implementation`。 |
| 〔`spectra-mechanical-substep`〕 **Spectra Apply machine-readable pilot marker 指定的 deterministic mutation** | **Codex `--model luna --effort low` via 泛用 dispatcher** | 只有 execution classifier 的完整低風險 predicate 全中才 eligible；rollout stage 未開或樣本 gate 未達時只記 shadow candidate，effective route 仍是 `spectra-phase-implementation` Sol high。 |
| 〔`screenshot-review-verify`〕 **`screenshot-review` verify mode**（`[verify:ui]` channel / archive 前視覺 QA） | **主線 Claude 直派 Codex GPT-5.6-sol low**（Bash 走 reference § Codex 派工的標準流程；**禁止** `Agent` tool with `subagent_type: screenshot-review`） | sonnet wrapper 會繞過 Step 0 自做工作（[[pitfall-screenshot-review-sonnet-wrapper-self-rationalize]]）。wrapper **僅**在 Pi Codex runtime 機械不可用時作 fallback，**禁止**當預設入口。詳見 reference。 |
| **Dev/test admin session cookie 取得**（verify channel evidence collection 階段） | **主線自己 scaffold `_dev-login` route + curl mint session**（**禁止**要 user 手動取 cookie；scaffold 前**MUST**先用 detection helper 確認真的 missing） | 詳見 [[manual-review.backend]] § Dev-login route missing → scaffold-first + [[pitfall-agent-asks-user-cookie-skipping-dev-login-scaffold]]。 |
| 〔`mechanical-fanout`〕 **Mechanical fan-out**（收集 / 掃描 / 跑指令驗證：grep 掃描、收 evidence、驗證矩陣、fleet 多 repo 盤點）。**不限委派**：主線**準備自己跑** ≥3 條唯讀指令（`grep`／`git log`／`jq`／一次性解析腳本）彙整成事實表就已命中 | **Codex `--model luna --effort low` via 泛用 dispatcher** | 第 3 個高信心 readonly Bash 前會建立 pending decision；依 reference § Routing threshold gate 結案。走泛用 dispatcher：命令清單列得全 → `fanout-analyze`，列不全 → `fanout-collect`。例外留 Claude：需要 claude.ai-connected MCP（Notion 等）、判讀 / 治理型分析（如 /oops Mode D 判讀段）、user 明確要求。**NEVER** 以「我自己順手跑掉比較快」略過本列（成因與成本證據見 rationale）。 |
| 〔`read-heavy-scan`〕 **封閉來源的 fact extraction**（長文件 / fleet 掃描中的固定欄位抽取）。**不限委派**：主線準備自己讀 ≥5 個檔或任一 >500 行長文件時先觸發 gate；只有 source list 已封閉、欄位固定、每筆要求 location + raw value、且不需 identity/status/relevance 裁決才走本列 | **Codex `--model luna --effort low` via 泛用 dispatcher** | 第 5 個 distinct textual Read 或第一次 Read 501+ 行文字檔前會建立 pending decision；依 reference § Routing threshold gate 結案。來源矛盾只准回 `needs-reconciliation`，主線改派 `exploration-prescan` Sol low。摘要只作輸入，規約措辭與拍板回主線。**NEVER** 拿「反正我讀一下就知道了」略過 gate，也 NEVER 把固定輸出 schema 當成不需裁決的證據。 |
| 〔`debug-evidence`〕 **Debug evidence 段**（log 完整 capture / repro script 撰寫執行 / 既定 hypothesis 的驗證迴圈） | **Codex `--model sol --effort high` via 泛用 dispatcher** | debug 是最大消耗桶；evidence / repro / verify 是機械段，root cause 推斷與修法設計留主線。repro 必在 throwaway worktree（template 內建 guard）。 |
| 〔`commit-0c-fix-verify`〕 **commit 0-C fix-verify loop**（pnpm check / test 修到全綠） | **Codex `--model sol --effort high` via 泛用 dispatcher** | 機械修 lint / type / test 與 dep-upgrade 已驗證模式同構；主線同回合續跑 0-A / 0-B。詳見 commit SKILL Step 0-C。 |
| 〔`security-review`〕 **Security review**（`/security-review` skill / commit 前安全檢查） | **最終 gate：Codex `--model sol --effort medium`**。候選 finding 的 pre-triage 可先跑 `--effort low`，但**收斂判定 MUST 回 medium 以上** | **NEVER** 因為「零互動 / structured diff → structured findings」就把安全 gate 當 pattern matching 降檔——漏報成本不對稱，且 class-conditional 差距遠大於通用 benchmark（class-conditional 實測見 rationale § model 檔位的量測依據）。**本列不以任何佔比為依據**（historical，見 rationale § 工作類別 telemetry 快照）。 |
| 〔`exploration-prescan`〕 **Exploration / reconciliation pre-scan**（「依賴什麼」「進度如何」「還有什麼要做」「N 張 change 狀態」或來源矛盾後對帳） | **Codex `--model sol --effort low` via 泛用 dispatcher**，主線消費 structured summary | 任一命中即走本列：未知路徑探索、跨檔 identity matching、partial completion／status 推斷、evidence relevance 判斷、git/history/state reconciliation、來源衝突裁決。固定輸出矩陣不會把這些語意工作變成 extraction，**所以不降 Luna**。主線拿 summary 做判斷，不自己逐檔 Read。（本列不以任何佔比為依據，見 rationale。） |
| 〔`handoff-scan`〕 **Handoff scan 段**（`/handoff` Mode B 的 scan：讀 HANDOFF.md + git log + openspec + tasks + git status 產出 outstanding 清單） | **Codex `--model sol --effort low` via 泛用 dispatcher**，主線消費 scan report 做決策 | 四個來源可能互相矛盾，判「已 commit / 部分完成 / 被工作樹取代」是**狀態 reconciliation** 不是格式化——**這是它不能降 Luna 的原因**。主線只看 report 做 routing。（不以佔比為依據，見 rationale。） |
| 〔`task-planning-prescan`〕 **Task-planning pre-scan**（「我需要做什麼」「接下來做什麼」「處理 N 張 change」的規劃 session 前置 scan） | **Codex `--model sol --effort low` via 泛用 dispatcher**，主線消費 structured report | 產出 per-change status matrix。矩陣格式固定**不代表**語意判定機械化——identity matching、partial completion、衝突裁決都在裡面，**故不降 Luna**。主線拿 matrix 做排序 / 決策。 |
| 〔`bugfix-evidence`〕 **Bug-fix evidence 段**（error log capture / stack trace 解析 / repro script 撰寫執行 / hypothesis 驗證迴圈） | **Codex `--model sol --effort high` via 泛用 dispatcher**（強化：非 Debug evidence 段，而是整個 bug-fix session 的 investigation 段） | investigation / evidence / repro 是機械段；root cause 推斷 + 修法設計留主線。**MUST** 在 bug-fix session 開工時先判斷：可分離的 evidence 段派 Codex，不可分離的留主線但 MUST 在 session 結尾回報未派 Codex 的理由。 |
| 〔`publish-prescan`〕 **clade publish/propagate pre-scan**（publish 前 dirty file 分組判斷：讀 `git status` + `git diff` 各 file 內容 + 辨識 logical group） | **Codex `--model sol --effort low` via 泛用 dispatcher**，主線消費分組建議後 selective commit | commit grouping 要推斷修改意圖、耦合、依賴順序與可獨立回退性——**讀取命令少不等於決策機械化**；可派的只有 pre-scan 的 reading 段。 |

## Claude 委派的 model 檔位（決定層）

上表管「派 codex 還是留 Claude」。本節只管**已決定留 Claude 的委派工作**該用哪個 model —— 這是
`Agent` / `Task` 的 `model` 參數，與 codex 的 `--model` 三檔位無關。

> **本節與 harness 預設對立，所以邊界要明寫**（完整論證見 rationale § 與 harness 預設對立）：本節
> **不**主張「委派都該指定 model」，只列**窮舉的**降檔 predicate——命中就指定 `model: 'sonnet'`，
> 一條都沒命中就照 harness 預設省略。**NEVER** 把本節讀成「不確定時降檔比較省」。

⚠️ **省多少配額 UNKNOWN**：訂閱內含配額的 per-model debit multiplier 官方未公布（同 § Routing Table
的 codex 側警告）。**NEVER** 把「降 Sonnet 省 X%」寫進任何精算或對外敘述——降檔的已知收益只有
「同一份工作換更便宜的執行者」這個方向，倍率不可量化。

### 進本節前 MUST 先過 Routing Table（per § Subagent 回報契約第 4 條）

**每一個**「留 Claude」的判定都要講得出「Routing Table 沒把它 route 給 Codex」。非 UI 工作命中
已 route 給 Codex 的類別 → 派 Codex，**NEVER** 走到本節挑 Claude 檔位。本節只處理判定後**仍留
Claude** 的殘集：需 claude.ai-connected MCP、判讀／治理型分析、user 明確指定、降級鏈接手。

### `subagent_type` 是 `general-purpose` 或 `Explore` 時，派工當下 MUST 先判 codex 可用性

**適用範圍就是這兩個字面值**，且非 UI、不需 MCP，產出屬下列任一：

- **(a) 事實表／掃描結果** —— 主線要消費它的回報
- **(b) brief 內已逐字指定的機械改寫（mutation）** —— 產出就是改好的檔案本身，沒有回報要消費。
  (b) 額外 MUST 兩項：改動有**硬 gate**（typecheck ／ test ／ lint 的 exit code）接住，且**可一鍵
  還原**（`git checkout`）。兩項缺一 → 不走本節，照原判派 Claude `sonnet`。**NEVER** 拿「沒有回報
  通道就不該給 codex」當把 (b) 退回 Claude 的理由——那是 dispatch 形狀，不是檔位判準。

**每一個**這種派工都 MUST 顯式帶檔位，**NEVER** 省略參數靜默繼承主線。`subagent_type` 是別的值時照下一節四條
predicate 走，**NEVER** 把本小節外推成「委派都該指定 model」。

| 可觀察 predicate | 檔位 |
| --- | --- |
| Pi Codex可用（dispatcher未回exit 3／4） | 原判`sonnet` → `--model luna --effort high`；原判`haiku` → `--model luna --effort low` |
| Pi runtime機械不可用（exit 3） | 依watch-protocol判斷修runtime或顯式改派Claude；**NEVER** fallback到Codex CLI |
| Pi Codex配額不可用（exit 4） | 走§ 配額耗盡時的fallback紀律，`sonnet`／`haiku` **顯式帶** |

**PreToolUse:Agent 機械 gate**：主線直接呼叫 `Agent(subagent_type: Explore|general-purpose, model: haiku|sonnet)`（省略 `subagent_type` 時按預設 `general-purpose` 計）會立即建立 `claude-agent-dispatch` pending decision 並阻擋。正常結案必須是 `codex-dispatch.ts --decision-id <id> --route claude-delegate-sub --tier-basis delegate-sub --model luna`，effort 依原 model 為 Haiku→low、Sonnet→high。確實要留 Claude 時只接受三個具名 waiver：`claude-mcp-required`、`ui-view-implementation`、`user-explicit-claude-agent`；Luna exit 2 必須同 effort 升 Sol 重派，Sol 再 exit 2 才能以 `delegate-escalation-failed` fallback receipt 放行；Codex exit 3／4 則先記 dispatch outcome，再走 matching fallback receipt。**NEVER** 把例外理由寫進 Agent prompt 當作 bypass——gate 只認 decision receipt，不解析自由文字。

**本節路徑的 luna 准入（與 § Routing Table 五條連言無關）**：原判 `sonnet` 的委派 MUST 同時滿足
兩項——(1) § MUST 指定 `model: 'sonnet'` 的四條 predicate 全中（原判 sonnet 的判定本身就要求這
四條，此處是複核不是加碼）；(2) 未命中 § NEVER 降檔的形狀任一條。兩項都過 → 派
`--model luna --effort high`，**NEVER** 因「luna 是最低檔」自行改回 `--model sol` 或退回 Claude
`sonnet`。任一項不過 → 照原判派 Claude `sonnet`（顯式帶 `model`），**NEVER** `--model terra`。

**luna 回 exit 2（業務 fail）→ 升 `--model sol` 同 effort 重派一次**；再 fail 才回 Claude `sonnet`
subagent。exit 3／4 照 § 配額耗盡時的 fallback 紀律 與 watch-protocol 的 exit code 分流走，
**NEVER** 記入品質判斷。

### MUST 指定 `model: 'sonnet'` 的 predicate（窮舉）

**每一個**同時滿足下列**四條**的委派工作都要指定，不是只處理其中最大的那一個：

1. 規格在 brief 內已明確，subagent 不需要裁決「該做什麼」
2. 目標路徑**已知且已列在 brief 裡**，不需要跨檔追蹤或探索未知路徑
3. 輸出的正確性有**獨立且夠強的語意 gate** 接住（主線複讀、test、既有 audit script）
4. 錯誤的修正成本 ≤ 重派一次

既有先例：UI view phase 的派工目標已由 § Routing Table 的 spectra 列定為 Claude sonnet subagent。

### NEVER 降檔的形狀

- 輸出**本身**就是品質或安全 gate（review / 裁決 / 安全判定）
- 需要跨檔調解矛盾證據，或需要判斷「哪些 evidence 相關」
- 產出是**規約措辭**（理由見 § Subagent 回報契約 關於措辭一致性那條）
- 輸出格式結構化**不構成**降檔理由：判準是下游有沒有語意 gate。同一條界線在 § Routing Table
  的 codex 檔位段已寫成 NEVER 行，本節適用同一條，**NEVER** 在這裡另立一套寬鬆版

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

- **A. 純非-view change**：整條 change **沒有任何 UI view phase**（view 檔案判準同 § Spectra Apply Phase Dispatch B 類）**且** tasks.md 已定稿——工作性質是「執行已知計畫」。
- **B. 機械式 sweep**：lint fix / dep upgrade / rename / cross-file refactor / test 修復 / codemod，即使無正式 tasks.md。

**做法（change 粒度，不是 phase 粒度）**：

1. 主線**一次** dispatch 整條 change 的**所有**非 view phase 給單一 background codex（prompt 列全部 phase + acceptance + Plan-first + Commit Authorization；模板見 reference § Codex 派工的標準流程）。**NEVER** 一個一個 phase 派（phase 粒度是 Claude-primary 才用）。
2. Dispatch 後 **notification-only watch**（reference § 監看排程）——**不**逐 phase cross-check、**不**短輪詢。
3. 完工通知後**一次** change 粒度 cross-check：commit 數 / format、view-layer drift + scope discipline（reference § Spectra Apply Phase Dispatch Step 5）、typecheck + test。
4. 主線**自己**跑 Section 7 Design Review（永不派 codex），再進 `/commit` 0-A gate。

把關移到邊界：兩道 gate（`/commit` 0-A + archive Design Review）作用在最終 diff 上。
### Claude-primary（以下任一命中即留主線）

- **UI view 工作**（per Routing Table 永不派 codex）
- **架構 / 設計決策、需求模糊**——先 plan mode 釐清
- **安全敏感** / 需 tight review loop 的 change
- **clade routing / 規則知識**的編輯
- **路徑未知的探索式 debug**

個別 phase 仍可派 codex → 走 § Spectra Apply Phase Dispatch。

### 機械 Enforcement

**每一條** change 開工都 **MUST** 跑 `residency-classify.ts classify` 拿機械 verdict 並立刻 `record`，不是只有看起來像純後端的那條——「主線自行判斷 residency」已實證不可靠。缺 record 會被 archive-gate Check 8 擋（exit 2）。完整命令、`--reason` 必填條件、繞過 marker、adoption 量測見 reference § Orchestration Residency — 機械 Enforcement。

## Spectra Propose Handoff（決策層）

1. **MUST** 預設跳三選一 dispatch 選單（A Codex draft + 主線 cross-check／B 三模型交叉：Fable draft + Codex review + 主線 final check／C 純 Claude）。使用者**明確**指定路徑（「純 Claude propose」「不要派 codex」「用 Fable」「用 codex」等）時跳過選單直接走。詳見 `spectra-propose` Step 0
2. **MUST** 主線是 quality gate — A 的 cross-check 與 B 的 final check 都由主線 Fable 5 xhigh 跑
3. **NEVER** 把 cross-check / final check 的修補丟回 codex — 主線自己 Edit 修

## Spectra Apply Phase Dispatch（決策層）

> **先判 residency**（§ Orchestration Residency）：符合 Codex-primary 進入條件 → change 粒度單次 dispatch + notification-only，**不要**逐 phase 派工；以下限 **Claude-primary** 場景。

執行 `spectra-apply` 時 phase 粒度派 codex。**三條契約**：

1. **Design Review phase 一律主線自己做，永不外派；UI view phase 永不派 codex，預設派 Claude `sonnet` subagent**（thin brief＋檔案所有權清單＋「只准動 view 層檔案」guard＋4-status 回報，per § Subagent 回報契約；主線收回後照跑該 phase 的機械檢查與 Design Review gate）。瑣碎 UI 修（≤2 files 且 ≤20 行）主線直接做，不派。其他 phase（schema / migration / API server / CLI / 純 backend / 非 view 的 frontend / unit test / docs）以泛用 dispatcher 的 `spectra-phase-implementation` row 派 background Codex Sol high；**每一個**符合封閉來源 extraction predicate 的 prescan 才可另走 `spectra-phase-prescan` Luna low，且不得取代 Sol 實作
2. **混雜 phase**（同一 phase 摻了 view 與非 view）：**已開工** → 主線整個 phase 自己做，不重切、不派 codex；**未開工** → **STOP** 請使用者跑 `/spectra-ingest <change>` 重切
3. **禁止**主線自行修改 tasks.md 的 phase 結構（屬 ingest 範圍）

A/B/C 三類的完整判定條件（含 view 層檔案路徑清單）與 C 類派工細節（共用 template／schema、dispatcher metadata、watch、drift 檢查、收尾驗證）見 reference § Spectra Apply Phase Dispatch（具體做法）。

## WebSearch Handoff（決策層）

1. **NEVER** 直接呼叫 Claude Code 內建的 `WebSearch` 工具
2. **MUST** 走 reference 檔的「Codex 派工的標準流程」，參數：`<topic>=websearch`、`<cwd>=/tmp`、`-c model_reasoning_effort=medium`
3. prompt 固定含：問題 + 期望輸出格式

**例外清單是窮舉的**（可直接處理）：本機檔案查詢（Read / Grep）、使用者明確要求「直接用 WebSearch」、Codex 已是當前 runtime、`WebFetch` 抓單一已知 URL。**不在這四條上的一律 handoff** —— 查詢多簡單、多趕時間、啟動開銷多不成比例，都不構成第五條例外。

**NEVER 拿本規約的 rationale 推翻本規約的字面。**「成本/品質最佳化」是這條規則存在的理由，不是可以就地自我豁免的判準 —— 照那個推法，任何一次 handoff 都論證得成「這次不划算」。三句逐字開脫與各自為什麼不成立，見 rationale § WebSearch 的開脫逐字實錄。

## 配額邊界（決策層）

Pi `openai-codex`目前不提供authoritative pre-dispatch quota snapshot。Dispatcher的quota precheck固定回`available:false`並fail-open；舊`~/.codex/sessions/**/rate_limits`只代表legacy Codex CLI歷史，**NEVER**拿它阻擋或宣稱Pi現況。

- Pi runtime回usage／rate-limit／quota error → dispatcher exit 4，payload帶`detected:'runtime'`與可解析到的`resets_at_human`。
- 沒有reset資訊時不得捏造window長度或時間；直接走§ 配額耗盡時的fallback紀律。
- 有明確reset時間且工作確實綁該外部signal時，可回報該時間；這不改變當下先判斷fallback能否完成工作的責任。
- `--no-quota-check`只改回報為`skipped:true`，不會繞過provider runtime quota。

### 最小 dispatch 門檻（避免瑣碎 override）

codex-primary verdict 但 ≤2 個 file 的瑣碎 fix（typo / 單行 bug / config tweak）→ Claude 直接做，**不需要**走 dispatch 流程。residency-classify 的 verdict 仍照跑（Check 8 需要 record），reason 填 `trivial-threshold`，不算 override 違規。

**判定標準**：`git diff --stat` ≤2 files **且** 預估 ≤20 行 **且** 不涉及 migration / auth / RLS / permission。超過任一門檻 → 照原 routing 走 Codex。

### 配額耗盡時的 fallback 紀律

配額耗盡（exit 4）**NEVER** 直接跳到 Opus 主線接走——那是拿最貴的檔位接最便宜的活。**MUST** 依序試降級鏈，命中即停：

```
Sol → Luna → Claude Sonnet subagent → Claude Haiku subagent → Opus 主線
      └ 同池較低權重 ┘   └─ 換池，吃 Claude 額度 ─┘
```

**降 effort 不是降級鏈的一步**：配額按 **model** 記，Sol 撞 usage limit 時 `--effort low` 重試撞的是**同一個** limit。effort 分級是品質 / 成本維度，**NEVER** 拿它當配額耗盡的應對。

1. **先降 Codex model 檔位**：以dispatcher `--model luna`重試，帶`--route fallback-chain --tier-basis quota-fallback --retry-of <sol-label>`。政策上Terra已出局，配額耗盡時也不解禁。Sol與Luna是否同時受限以Pi runtime結果為準，不引用legacy session猜測。
2. **再換池**：Luna同樣exit 4才動Claude subagent（`model`顯式帶`sonnet`／`haiku`，per § Subagent回報契約第4條）。
3. **最後才是主線**：上述全不可行時Opus主線接走，record reason含`quota-exhausted`；provider有回reset資訊才一併記錄。
4. Claude接走時session結尾 **MUST** 回報「本session因Pi Codex配額耗盡，由Claude執行N個Codex-primary change」；有runtime reset資訊再附上，沒有就明說unavailable。

**NEVER** 把「工作性質適合 Sol」當作跳過降級鏈的理由——配額耗盡時的選擇是「Luna vs 完全做不了」。品質顧慮寫進 report 交 user 判讀。

## Subagent 回報契約（所有 dispatch 通用）

適用範圍：**每一個** dispatch——Agent tool 開的 Claude subagent、泛用 dispatcher 派的 codex、[[subagent-dev]] 的 implementer / reviewer，全部適用，不是只有長任務才用。

1. **4-status 回報**：brief 內 MUST 要求 subagent 以四值之一收尾——`DONE`／`DONE_WITH_CONCERNS`（完成但對正確性有疑慮，concerns 必列）／`NEEDS_CONTEXT`（缺資訊，列缺什麼）／`BLOCKED`（做不了，列卡點與已試方法）。主線處置：`DONE_WITH_CONCERNS` → 先讀 concerns 再決定收不收；`NEEDS_CONTEXT` → 補 context 重派；`BLOCKED` → 依序考慮補 context／升 model／拆小／上報 user。**NEVER** 對 BLOCKED 原樣重派同一 model 不改任何條件。
2. **Report 是未驗證主張**：subagent 完成回報（含「no changes outside scope」「tests pass」「已自我 review」）一律當 claim——主線 MUST 用 `git status --short` + `git diff` 核實實際改動範圍 = brief 宣告 scope，scope 外 substantive change 一律 revert。subagent 自報的設計說詞（「per YAGNI 略過」「刻意簡化」）**不得**降級任何 review finding 的嚴重度——那是實作者替自己打分。
3. **File handoffs**：brief／report／diff 超過 ~30 行的內容走**檔案路徑**傳遞，不貼進 dispatch prompt 或回報訊息——貼文會常駐主線 context、每 turn 重讀。dispatch prompt 五要素：定位一行、brief 檔路徑、跨 task interfaces、歧義裁決、report 檔路徑＋回報契約（單一事件實錄見 rationale）。
4. **Model 與 effort 顯式指定**：**每一個** dispatch 都 MUST 把 model 與 effort 當成兩個獨立決策，不靠靜默繼承——省略 = 繼承主線（通常最貴檔 × 最深推理），機械掃描型 subagent 拿主線的 xhigh 跑就是效能過剩。選檔預設，依序判：
   - **先過 Routing Table**：非 UI 工作命中本檔已 route 給 Codex 的類別 → 依該列的 model / effort 派工（`mechanical-fanout`、`read-heavy-scan` 為 `luna low`），**NEVER** 用 Claude subagent 接；Claude subagent 只留給 Claude 例外（需 claude.ai-connected MCP、判讀／治理型分析、user 明確指定）
   - **UI view 實作**：派 Claude subagent 且 `model` **MUST** 是 `sonnet`（**NEVER** codex，per § 派不派）
   - **effort 選檔**：機械掃描／純轉錄 → `low`；一般執行 → `medium`；判讀型／高錯誤成本 → `high` 以上。**帶得了 effort 參數的入口**（codex `--effort` / `-c model_reasoning_effort`、Workflow `agent()` 的 `effort`、具名 agent type 的 frontmatter）**MUST** 顯式帶；Agent tool 本身沒有 effort 參數、只能繼承主線——這是機械型工作優先走 Codex 而非 Agent tool 的另一個理由
   - model 選檔原則「**turn count beats token price**」：brief 內含完整 code 的純轉錄型工作才用最低檔；review 型依 diff 的大小／風險選檔（為什麼見 rationale）。
5. **中間產物不進主線**：外派出去的 task，主線只讀對方寫回的 report 檔，**NEVER** 為了「確認它做對」把該 task 碰過的原始檔重讀一遍——那把省下來的 context 原封不動加回來，而且重讀的是同一批事實，換不到新判斷。第 2 條的 scope verify 照舊 MUST 跑：看**改了哪些檔**（`git status --short` / `git diff --stat`）跟重讀檔案內容是兩件事。

## 主線靜默上限（所有 dispatch 通用）

> **Iron Law：主線靜默 55 分鐘是上限，不是預算。違反字面就是違反精神——「等通知就好」「醒來也做不了什麼」都不算遵守。**

**Invariant**：session 內只要存在**任何**未收尾的 async work，主線相鄰兩個 assistant turn 的間隔 **NEVER** 超過 55 分鐘。

**適用範圍窮舉**（明寫，不靠外推）：**每一種** async 派工都適用，不是只有長任務——Agent tool subagent（含 `/wt` **Form 1–4 全部**）、`Bash(run_in_background)`、codex dispatch、`runner.sh`、Monitor、Workflow。task-aware control wakeup 僅適用於可用 `TaskOutput(block=false)` 查詢的 harness task id；沒有這個 id 的路徑不得假裝可查狀態。

### 派出當下的自查（MUST）

派出 async job 的**同一則訊息**內問一句「這預計超過 55 分鐘嗎？**答不出來 = 會**」，再依下表動作：

| 可觀察 predicate | MUST |
| --- | --- |
| 該路徑**已有**間隔 ≤3300s 的既有 wakeup（codex 的 1500s 安全網、work-loop 的 (d) heartbeat） | 不另外排。但收到完成通知前 **MUST** 持續重排既有那個 |
| 該路徑是可查 task id 的 `Bash(run_in_background)`，但沒有既有 wakeup | 立刻排 3300s task-aware generic async keepalive；`prompt` **MUST** 使用下方 canonical inert control message，**NEVER** 放原任務輸入 |
| 該路徑是沒有可查 task id 的 Agent tool / `/wt` Claude subagent / Monitor / Workflow，且沒有既有 wakeup | 立刻排 3300s notification-only keepalive；`prompt` **MUST** 使用下方 notification-only inert message，**NEVER** 放原任務輸入或虛構 task id |
| 派完主線手上**還有**不依賴該結果的獨立工作 | 先做那些工作（那本來就不會靜默）。做完仍在等 → 回上面兩列排 keepalive |
| session 內**沒有**任何未收尾 async job | 不排。keepalive 的觸發條件是「有東西在跑而主線不出聲」，不是「idle」 |

3300s = 55 分，留 5 分餘裕給 1 小時 TTL，落在 runtime 的 `[60, 3600]` clamp 內。

### Generic async keepalive prompt（canonical inert control message）

僅限有 `TaskOutput(block=false)` 可查詢的 `Bash(run_in_background)` harness task；派出時 **MUST** 同時記下 `<task-id>`、`<owner>` 與有限的 `<deadline>`。控制訊息只替換這三個欄位：

```text
ASYNC_KEEPALIVE_CONTROL task=<task-id> owner=<owner> deadline=<ISO>. Status-only: call TaskOutput(block=false) for this task. If terminal, stop this wakeup and enqueue ASYNC_LIFECYCLE_HANDOFF task=<task-id> owner=<owner> cause=terminal. If running before deadline, re-arm this exact message. If running at deadline, or status remains unknown after the bounded retry, stop this wakeup and enqueue ASYNC_DEADLINE_INTERVENTION task=<task-id> owner=<owner> cause=<deadline|unknown>. Never replay the dispatched instruction.
```

**Iron Law：generic async keepalive 只控制既有 harness task 的生命週期，NEVER 承載原任務。違反字面就是違反精神。** 原任務若含共享修改，把它塞進 `prompt` 會讓 wakeup 被 classifier 正確讀成「未來重新執行共享修改」，即使本意只是 keepalive。

### Notification-only keepalive prompt（無 task id）

Agent tool、`/wt` Claude subagent、Monitor、Workflow 沒有可查的 harness task id 時，控制訊息只能維持 cache，**不得**偽裝成 task lifecycle control：

```text
ASYNC_NOTIFICATION_KEEPALIVE owner=<owner> deadline=<ISO>. Notification-only: if no native completion notification has arrived before deadline, re-arm this exact message. At or after deadline, stop this wakeup and enqueue ASYNC_DEADLINE_INTERVENTION owner=<owner> cause=deadline. Never query TaskOutput, infer task status, or replay the dispatched instruction.
```

native completion notification 到達時 **MUST** 停掉對應 wakeup。notification-only job 沒有 harness task status 可查，但 **owner 自己的原生狀態面**（Herdr pane 的 `agent_status`、Agent 的 idle notification）**是 allowlist 內的 liveness 確認**；被禁的是**讀 output / log / repo 猜進度**（兩者的界線見 rationale § liveness 確認 vs 猜進度）。dispatch 時 MUST 記錄可操作的 owner ref（Agent name/id、Monitor task id、Workflow run/task id）與 deadline。deadline intervention 只准用 owner 的原生控制面（例如 `TaskStop(owner)`）發出取消，並等待 native terminal notification；確認 terminal 前保留 ownership，NEVER 收割、重派、記 fail-streak或釋放 lock。**NEVER** 以虛構 task id 補洞。

### `/loop` dynamic 是唯一 prompt-preserving 分支

由 `/loop` dynamic mode 自我續跑的 wakeup **MUST** 保留同一份 `/loop` prompt；autonomous dynamic loop 使用 harness 指定的 `<<autonomous-loop-dynamic>>` sentinel（**逐字寫錯就等於默默放掉這個分支**，改動前先對照 `ScheduleWakeup` tool description 的 `prompt` 欄位；混用警告見 rationale）。這一支的目的就是下一輪繼續執行 loop，**NEVER** 套 generic inert message。反方向也成立：`runner.sh`、work-loop background dispatch、codex safety net 都是 generic keepalive，**NEVER** 因原任務來自 `/work-loop` 就保留原 prompt。

### Generic keepalive 醒來只做控制面動作

| 可觀察 predicate | 動作 |
| --- | --- |
| `TaskOutput(block=false)` = running，且未到 deadline | 以**完全相同**的 inert prompt 重排既有 interval，本 turn 結束 |
| task = terminal | 停對應 wakeup，排一次不含原任務、結果或授權的 `ASYNC_LIFECYCLE_HANDOFF task=<id> owner=<owner> cause=terminal` |
| task = running，且到 deadline | 停 control wakeup、保留 owner 與 in-flight claim，排 `ASYNC_DEADLINE_INTERVENTION`；owner 必須先取消 task（`TaskStop`）或取得具名延長，**確認 terminal 前 NEVER** 收割、釋放 lock 或重派 |
| 狀態不可判定（含 runtime 沒有 `TaskOutput` 可用） | 不 claim、不收割、不釋放 lock；以同一 inert prompt 進行有限次重查。次數用盡時走 `ASYNC_DEADLINE_INTERVENTION`，確認 terminal 前同樣不得重派。**NEVER** 因為查不到狀態就改讀 `BashOutput` tail 或 log 補判——那是 allowlist 外的動作，per 下一段 |

control turn 的 allowlist 只有「`TaskOutput(block=false)`、重排同一 inert wakeup、停止 wakeup、排 lifecycle handoff / deadline intervention」。**NEVER** 讀 repo / log 猜狀態、執行原任務、Edit / Write、commit、publish、propagate、push、開新工作或做任何 shared-resource mutation。

**每一個** native completion notification 與 terminal lifecycle handoff **MUST** 先共用 claim（`pending → harvesting → harvested`）再收尾。**claim key：有 harness task id 的路徑用 task-id；notification-only 路徑（`taskId: null`）用 owner ref**，狀態機相同：已是 `harvesting` / `harvested` 則 no-op（這擋掉 delayed notification 重複收割），deadline / unknown **不得 claim**。只有 claim 成功的正常 turn 可讀 result 並走 owner 既有收尾，且同一 turn **MUST** 停掉對應 wakeup（`ScheduleWakeup({stop: true})`）並一併 `TaskStop` owner 的 persistent Monitor（若有）。

### Shared-action specific consent UX

permission classifier 要求具名 shared-action consent 時，主線 **MUST** 用 `AskUserQuestion` 呈現；推薦選項的 `description` **MUST** 放完整授權範圍（目標 repo / resource、具名 action、允許的 path 或 ref、明確不包含什麼）。user 點選該選項即構成這一次的 specific consent，可直接執行該範圍；**NEVER** 再要求 user 手打、複製或貼上同一句完整授權文字。

canonical 選項形狀（label / description / 另一選項的逐字模板）見 rationale § shared-action consent 的 canonical 選項形狀。

若目前 runtime 不允許 `AskUserQuestion`（unattended / headless），該 shared action 維持 blocked，將**同一份完整具名範圍**寫進 decision packaging；**NEVER** 降級成要求 user 另開訊息手打授權句，也 NEVER 自行推定 consent。

逐字實錄 → 現實的六條對照（含 `ScheduleWakeup` description 那句 pure waste 的前提為何不成立）見 rationale § 主線靜默上限的 rationalization table。

### Red Flags（發現自己在想這些 = 停下來排 keepalive）

「等通知就好」／「醒來也做不了什麼」／「輪詢沒意義所以不用醒」／「這次應該很快」／「先結束這回合，有消息再說」。

### 邊界

與 `\do-all` 主線閒置禁令、與全域「不要把工作往後放」都**不衝突**（兩條關係的完整論證見 rationale § keepalive 與其他兩條規約的關係）。

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
| **NEVER** 印「請開啟Codex CLI」「Stop here」「請貼prompt」這類純文字handoff訊息要使用者手動切 | 主線必須自己以背景dispatcher派Codex模型 |
| **NEVER** 直接執行`codex`binary（含`codex exec`／`codex review`／`codex exec resume`）或把它當Pi故障fallback | 每一個active Codex-model dispatch都走`vendor/scripts/codex-dispatch.ts`或專用Pi wrapper；execution transport只有Pi |
| **NEVER** 嘗試`codex:rescue`／`codex:setup`plugin路線 | 已驗證無法使用、已全清（含`/assign`） |
| **NEVER** 派 codex 跑 UI view phase 時省略 prompt 內「禁止改 view 層檔案」硬指令 | 缺這條 codex 容易順手改到 .vue / .tsx |
| **NEVER** 派 codex 跑 spectra-apply phase 而 prompt 內漏 Commit Authorization 段（一 phase 一 commit / `🧹 chore: wt <change>-phase-<N>` format / hook 必跑禁 `--no-verify` / commit 前自驗 view-layer + scope） | 缺這段 codex 會混 commit、撞 commitlint hook |
| **NEVER** 派 Codex 寫 code（spectra-propose draft / spectra-apply phase）而 prompt 漏掉 Plan-first 硬指令 | 沒 plan 主線只能從 diff 反推；codex 寫完 plan 必須立刻續跑 |
| **NEVER** 派 general-purpose / worktree Claude subagent 自跑 playwright / agent-browser 收 verify:ui evidence 來取代 Step 8a codex dispatcher | verify:ui evidence 的**唯一**入口是 `codex-dispatch-screenshot-verify.ts`；Claude fallback 僅限機械故障且 MUST 在對應 item 留 `UNCERTAIN(dispatcher-error)` 痕跡。（audit 實證見 rationale § verify:ui bypass 的 audit 實證）**機械 backstop**：dispatcher 落 receipt（`.spectra/verify-ui-dispatch-ledger.jsonl`），archive-gate Check 9 逐 item 比對，缺 receipt 且缺 `UNCERTAIN(dispatcher-error)` 痕跡 → block。**該 gate 擋的是 drift，NEVER 是對抗性偽造**——過 gate **NEVER** 讀成「evidence 來源已被證實」 |
| **NEVER** 讓 Claude subagent 當 codex 的**薄中介**——派出 codex 卻不自跑 Codex Watch Protocol，把死活判定留給上一層 | 判準是**誰持有 codex 的生命週期**，不是「有沒有經過 subagent」。薄中介的兩個已驗證失敗模式見 rationale（同 §）。完整持有生命週期的形狀見下一列 |
| codex **MUST** 由**該層編排者**在其自身 sandbox 內直接 Bash `run_in_background` 派出（含泛用 dispatcher）：主線是編排者時由主線派；`/wt` Form 3 / Form 4 的 worktree subagent 執行它被指派的 next-skill 時（`/spectra-apply` 的 Step 6b Class C、Step 8a verify channel、pre-handoff checks；`/spectra-debug` 的診斷 / repro dispatch；以及 next-skill `references/` 各層的每一處 codex 派工）由**該 subagent** 派 | 例外的**准入條件**是該編排者自跑完整 Codex Watch Protocol（notification-only + 安全網 fallback，per [[agent-routing.codex-watch-protocol]] § 監看排程）——做不到就退回上一列的薄中介禁令。編排者**以外**的任何一層對這些 codex **零探針**（per 同檔 § 跨 sandbox 可見度約束 v2）。**本列的範圍只及 `/wt` Form 3 / Form 4 開出的 worktree subagent**，**NEVER** 外推成「任意 Agent tool subagent 都可以派 codex」 |
| **NEVER** 在 exploration / research 型 session 自己逐檔 Read + scan 多個 source（openspec / HANDOFF / git log / docs）超過 3 個 source file | 先派 Codex `sol low` pre-scan 拿 structured summary，再由主線消費 summary 做判斷。例外：user 明確問特定檔案 / 需要 claude.ai-connected MCP |

### Watch 行為

| NEVER | 說明 |
| --- | --- |
| **NEVER** 沉默等使用者問進度 | 收到 `<task-notification> status=completed` 必須立刻自己讀檔回報 |
| **NEVER** 派出 codex 後不啟動 Codex Watch Protocol | 「乾等盲區」是已驗證根因 |
| **NEVER** 偵測到 `fetch failed` / sandbox 拒絕 / 互動 prompt 還繼續 wakeup | 必須立刻 `AskUserQuestion` 介入 |
| **NEVER** 在 watch loop 中跑與監看無關的工作（grep、Read、subagent） | 監看純粹只看進度 |
| **NEVER** 派 codex propose 後不跑 cross-check（post-propose-check + design-inject + 主線補 Design Review 7 步 + spectra analyze） | 主線 = quality gate |
| **NEVER** 收到 codex 完工通知後跳過 view-layer drift 檢查（`git diff --name-only` 過濾 view 路徑） | 主要的回收 quality gate |
| **NEVER** 對主線直接 Bash 派的 codex 啟動每 3 分鐘強制 poll | 直接派預設 **notification-only** + 單一 ~1500s 安全網 fallback。subagent 中介 dispatch 已全面禁止（§ Dispatch 入口） |
| **NEVER** 現場自組 `pgrep` / `ps \| grep` 當進度探針 | 要回報「派出去的長任務做到哪」時，**MUST** 貼 cookbook `~/offline/clade/vendor/snippets/subagent-progress-probe/` 的 artifact 探針（worktree commit 對 **merge-base**、tasks.md tick count 附分母、輸出檔 mtime + size）。process 列表沒有租戶邊界，兩個方向都會給錯答案（成因見 rationale） |

### Commit 0-A

| NEVER | 說明 |
| --- | --- |
| **NEVER** 在 commit 0-A 把 `simplify` 跟 codex 並行 | simplify 修完才是 codex 該看的版本 |
| **NEVER** 在 commit 0-A 啟用已棄用的 `code-review` agent（Opus subagent） | 與 codex review 重疊且同為 Anthropic 模型盲點 |
| **NEVER** 在 commit 0-A 跑第 3 輪 codex | 2 輪內處理不完先 split；0-A.2 由 0-A.1 Critical / Major 條件觸發，不可無條件升級也不可跳過 |
| **NEVER** 在 commit 0-A.0 用 `Agent` 包一層跑 simplify，也 **NEVER** 在 prompt 裡叫 agent 自行 launch N 個平行 review 子 agent | 主線直接 `Skill(simplify)`。隔離實測未達成、買到的只有中間層空轉與互斥建議（數字見 rationale）；四軸分工是 `simplify` skill 本體的內部實作。詳見 commit `gates.md` § 0-A.0 |

### Runtime gate

| NEVER | 說明 |
| --- | --- |
| **NEVER** 在 Codex 端執行 `$spectra-apply` 而 prompt body 沒有 `[DELEGATED-BY-CLAUDE-CODE]` marker | **MUST** 立即 STOP，不執行任何 `spectra` 命令（reference § Runtime Gate） |
| **NEVER** 主線派 Codex 跑 spectra apply phase 而 prompt 第一行不是 `[DELEGATED-BY-CLAUDE-CODE]` marker | 會被 Codex 端 Runtime Gate 擋掉、整個 phase dispatch 白做 |

另：**NEVER** 把 routing 例外寫死在個別 skill；要加例外請改本檔的 Routing Table。
