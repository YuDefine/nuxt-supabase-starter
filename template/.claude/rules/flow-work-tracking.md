---
description: flow spine 的 work 生命週期契約——一件 work 何時誕生、誰鑄名、`work.done` 的憑證強度、驗收由誰按；動到 vendor/scripts/flow/** 或 .clade/flow/** 時 path-scoped 載入
paths:
  - 'vendor/scripts/flow/**'
  - '.clade/flow/**'
  - 'vendor/review-gui-web/pages/flow.vue'
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/flow-work-tracking.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# flow work 生命週期契約

## 一件 work 是什麼

**一件 work = 一個人可指認、可驗收的問題。** 誕生在被指認的當下（Notion ticket triage / 客訊轉述 / 建 `tasks/` 檔 / `wt-helper add` / 開 TD），結束在 `work.accept` 或 `work.drop`。

一次 dispatch 是 **span**，不是 work。relay / fanout 之間**不切分** work——`CLADE_WORK_ID` 走 `dispatchEnv` 繼承，successor 是同一件事的延續。一對多（一張 ticket 三個 PR）**不引入 work 階層**，靠 `origin_ref` 相同在 UI 聚合。

`WorkState` 六態，推導優先序 **終態 > done > in-flight > failed > settled**：

| state | 意思 |
| --- | --- |
| `in-flight` | 有 span 在跑 |
| `failed` | 最近一次 span 失敗，且沒人接手 |
| `settled` | 沒 span 在跑、也沒人宣稱做完 —— **刻意不是終態**，它就是「完成了沒」這一問的答案本身 |
| `done` | 有人宣稱做完並附了憑證 |
| `accepted` / `dropped` | 終態，只有人（或客戶）能寫 |

`done` 之後又出現新 span → 回 `in-flight`。那是驗收退回重做的自然表達，**NEVER** 為此新增 reopen 事件。

## R1 `work.done` 憑證條款（fail-closed）

`work.done` 的 payload **MUST** 帶 `verification`——一句可查證的實跑摘要（跑了什麼、輸出是什麼），不是「已完成」「測試通過」這類無指涉的宣告。缺 `verification` 的 `work.done` 由 `emit.ts` **拒寫**。

這是整套設計**唯一**的 fail-closed 點，其餘全部 fail-open。理由：寬鬆的 done 比沒有 done 更毒——它讓「驗收了沒」建立在一個假的「完成了」上，而驗收者看到 done 態就不會再去查。

`work.done` 的 emit 權在**做完的那個 agent**，掛在五個既有動作上：

| 場景 | 既有動作 | 怎麼掛 |
| --- | --- | --- |
| dispatch 收尾 | `--complete success` | 加 `--work-done --verification '<摘要>'`。**opt-in 明示**：pane success **NEVER** 自動升級成 work done（`dispatch-common.md` 那條 NEVER 仍然有效）。同時帶 `--followup-brief` 時機械拒絕 `--work-done` |
| attended session 直接做完 | `/handoff park` \| `relay` | ambient work 存在且無殘工要交接 → 順路 `flow done <id> --verification`；有殘工 → emit `work.park`。`relay` 走 Step 1.5：**同一件事的續集 NEVER emit**（successor 要接著做），ambient work 本身已完成才 emit |
| 做的人沒宣告、收割者判定落地 | `--adjudicate --disposition landed` | landed 且該 work 無其他 in-flight span → 順路 emit done，`verification` 引 adjudication 的 `--reason` |
| worktree land 收尾 | `wt-helper merge-back` | 加 `--work-done --verification '<摘要>'`。**opt-in 明示**；與 `--dry-run` 互斥；caller 的 verification 逐字保留，工具觀測到的落地事實（squash / cleanup / staged-pending）附加在後 |
| 標準層散播收尾 | `/clade-publish` Step 9b | ambient `CLADE_WORK_ID` 非空**且** publish 是那件 work 的最後一步 → `flow done`；publish 只是其中一步 → 跳過 |

**NEVER** 用「這件事很明顯做完了」「pane 回 success 就是做完」跳過憑證——那兩句話正是這條 gate 要擋的東西，而它們在 emit 端一律得到同一個拒寫。

## R2 入口鑄名索引（informational — 不觸發任何東西）

義務燒在各入口的 code path 裡，本表只給**未來新增入口的開發者**一份對照。新增一個「事情從這裡誕生」的入口時照同一個形狀鑄名。

| 入口 | 鑄名者 | fail 姿勢 |
| --- | --- | --- |
| `/handoff relay` / `fanout` | 不鑄，繼承 env；無 ambient 時 adapter 用 label 降級鑄名 | fail-open |
| `/wt`（`wt-helper add`） | 用必填 `--task-summary` 鑄名並印 `export CLADE_WORK_ID=…` | fail-open |
| `/notion-board` triage | 每一張進 triage 的 ticket 都鑄一個，`origin_ref: notion:<uuid>`——不是只處理第一張 | fail-open |
| `/notion-ticket` | 建票 + 登 HANDOFF 時一併鑄，work_id 寫進 entry | fail-open |
| `tasks/<date>-<slug>.md` | 建檔順路 `flow open <slug>`，`origin_ref: tasks:<路徑>` | fail-open |
| 臨時小改動（單 session 內做完） | **刻意不鑄**——orphan 是這一格的正確結局 | — |
| 客戶通訊軟體 | 人轉述 → agent 判跨 session 就開 `tasks/` 檔，退化成上一列 | 無機械兜底可能 |

本表的失效模式是 orphan 佔比回升，而那由 R3 機械量測，不會零偵測。**本節不新增任何義務**：看到某個入口沒鑄名，去改那個入口的 code，不是來改這張表。

## R3 orphan 佔比訊號

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 近 7 天新增事件的 `orphan-` 佔比 > 25% 時 `flow status` 印 warn。**warn-only，不 block** |
| 消費端 | `session-start-stalled.sh` 已在每個 attended session 開頭跑 `flow status --stalled`，順路帶出 |
| 載入路徑 | 本節（散播到 consumer `.claude/rules/flow-work-tracking.md`）＋ clade home 的 `clade-role-and-todo-discipline.md` § 停滯訊號 |

存量 orphan **不追溯**：佔比只看近 7 天新增，改動的效果才看得出來。

## origin 與 carrier 是同一套 scheme，方向相反

`<scheme>:<id>`，兩邊共用 resolver：`notion:<uuid>` / `im:<一句話>` / `td:TD-NNN` / `tasks:<路徑>` / `handoff:<段名>`。

- **origin**（在 `work.open` 上）= 這件 work 從哪誕生
- **carrier**（在 `decision.request` 上）= 這個 decision 的答案落到哪

同一件 work 的 origin 與其 decisions 的 carrier 可以不同（Notion 來的工作，中途拍板題落 HANDOFF）——這是特性，**NEVER** 當成要修的不一致。

### 單向指向（本設計的支柱）

結構化端（spine / `DispatchRecord` / awaiting）持指標**指向** prose 世界；prose 端（TD entry / HANDOFF / `tasks/` 檔 / Notion 頁）**NEVER 回指 work_id**。

理由：prose 端的回指沒有任何機械稽核保證、必然 drift——「任一環漏寫就退化成模糊 grep」是這條鏈的實測失敗形狀。spine 端的指標由工具在 emit 當下寫入、append-only，不會事後爛掉。

例外只有兩個，而**入場條件是同一條**：回指有一個**已經在跑的機械消費端**在讀它，且它保持選填 / 由工具寫入而非人的記憶。

| 例外 | 誰在讀 | 邊界 |
| --- | --- | --- |
| `/handoff park` 落的 HANDOFF / TD 段文字帶 work_id | 接手的下一個 session | park 是四個 arg 裡唯一純 prose 落檔、park 後**沒有任何結構化載體存活**的，所以這一筆 **MUST** 帶。寫入者是 skill 步驟 |
| `tasks/<date>-<slug>.md` 檔頭的 `work_id:` | `scripts/audit-stale-tasks.ts`（拿它把 archivable 從年齡推定升級成收尾證據） | **選填，NEVER 變強制**——缺欄位 **NEVER** 報違例、**NEVER** 讓任何 gate 因此擋人（[[session-tasks.operations]] § 寫入規約補充） |

**NEVER** 用「反正多寫一個 id 也不會怎樣」在這兩格之外新增回指：沒有消費端的回指沒有人會發現它爛掉，而它爛掉的形狀是「看起來有對照、實際指向不存在的 work」。要新增第三格，先講得出誰在讀。

## 驗收權歸實際擁有它的人

| work 類型 | 驗收者 | 怎麼落 spine |
| --- | --- | --- |
| `notion:` origin | **客戶**（board 狀態欄本來就是他們的驗收介面） | `notion-board reconcile` 讀到客戶側狀態進終態 → emit `work.accept {accepted_by: 'customer', reason: <狀態值>}` |
| 其餘全部（`td:` / `tasks:` / `handoff:` / `im:`） | 人，經 /flow 驗收按鈕或 `flow accept <id> --reason` | `reason` 必填 |

`work.accept` / `work.drop` **NEVER** 由 agent 代按。上表每一格都綁在一個已經有人在跑的動作上——這是它與 work-loop `decisions{}` 那個 39 筆全 null 的 `answeredAt` 欄位的唯一差異：欄位存在不等於有人負責填它。

## spine 可信的是「發生過」，MUST 實跑的是「現在是」

spine 是**事件流**：它記錄「某個時刻有人做了什麼、宣稱了什麼」。它 **NEVER** 是系統的當前狀態快照——沒有任何事件會在世界改變時自己跟著改。

| 可以信 spine | MUST 仍實跑 |
| --- | --- |
| 歷程：誰在何時做過什麼、span 順序、耗時 | 任何**寫入動作的前置條件**：樹乾不乾淨、檔案持有權、測試綠不綠 |
| 宣稱的存在與其憑證**文本**（`work.done` 帶了什麼 `verification`） | **那份憑證現在是否仍為真**——驗收前重跑 verification 指的那個驗證 |
| 決策問答史、artifacts 座標、origin / carrier | deploy 活著沒、endpoint 通不通、檔案現在的內容 |
| **路由問題**：下一步找誰、從哪接、誰是持有者 | **行動問題**：現在能不能安全地做 |

分界線是**時效**，不是可信度：左欄的事實一旦寫下就永遠為真（「2026-08-27 那個 pane 宣稱測試綠了」不會因為今天測試紅了而變假），右欄的事實只在被量到的那一刻為真。

這與 [[session-tasks]] 的「**NEVER** 讀 HANDOFF 文字當現況」**零衝突，是同一原則的兩半**：兩者都禁止把「有人寫下過的東西」讀成「現在的樣子」。差別只在 spine 多給了一件 HANDOFF 給不了的東西——**誰在何時寫下的**，那正是路由問題的答案。

**NEVER** 因為 spine 上有 `work.done` 就跳過驗收前的實跑：R1 要求的是憑證存在，**不是**憑證仍然成立。一句「跑了 `vp check` 全綠」在三天後與「三天前跑過一次」等價，而那三天裡 fleet 動過。

## 治理軌跡：`session_summary`

回答「那一次是什麼檔位、走過哪些 skill、外派了誰、是哪一版規約」。採集源是 `~/.claude/projects/<slug>/<session_id>.jsonl`——harness 本來就在寫的檔，**agent 側 0 token、0 spawn、0 自報欄位**。實作在 `vendor/scripts/flow/transcript-summary.ts`，掛在 `session-start-stalled.sh` 內部（`.claude/settings.json` 零改動）。

**不帶 work_id**（`work_id: null`，validator 雙向強制）。它是 **session 的性質，不是 work 的性質**：一個 session 橫跨多件 work、一件 work 橫跨多個 session，任何硬掛規則都會錯誤歸屬。歸屬在**讀端 join on `session_id`**——每件 work 的 span 本來就帶它，零新欄位。連帶效果是它天然不出卡、不進 R3 orphan 的分子**也不進分母**（進分母等於讓 sweep 跑得越勤、佔比看起來越好）。

三條硬規則：

- **NEVER 收錄 `<command-args>` 原文**。只收 `{name, mode, invoked_by}`，`mode` = args 首 token **且 MUST 命中該 skill 的白名單**（`KNOWN_SKILL_MODES`），命中不到記 null。風險有兩層：args 可能含 home 路徑（`redact.ts` 會改寫成 `<HOME>`，欄位當場變形）；更重要的是 **args 是使用者原話，可能含不在任何 pattern 內的業務細節——redact 攔不到的那半才是真正的洩漏面**
- **治理欄位一律裸名稱或 repo 相對路徑，NEVER 絕對路徑**
- **parser MUST fail-open**：parse 不出就缺席 + 一行 warn，**NEVER 讓它擋 session start**。transcript 是 harness 內部格式、無穩定契約

一個 session 有**兩筆**事件、共用同一個 kind、靠 `payload.source` 分辨：`session-start-stamp`（開場量的環境）與 `transcript-parse`（事後摺的內容）。Idempotency 是**逐 source** last-write-wins——讀端取「最新的 stamp」∪「最新的 summary」，**NEVER 只取該 session 最新的那一筆**：兩者欄位不重疊，取最新會讓後寫的那半把另一半抹掉。spine 是 append-only，重摺一律是新事件、不改寫。

`clade_version` 是 parse 的**補集不是替代**：transcript 沒有它，只有 session 開始那一刻量得到（開場 stamp）。歷史 session **記 null，NEVER 用 parse 時的 git HEAD 或今天的版本推導補**——推出來的與量到的在讀端不可區分。transcript 的 `version` 欄位是 **Claude Code 版本**，順手收，但**它不是 `clade_version`**。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | **informational — 不觸發任何東西** |
| 消費端 | `flow brief --work-id` 卷宗（successor 判「燒了幾個 session、什麼檔位、走過哪些 skill」）＋ 事後歸因（「那次是 invoke 了 clade-publish 還是憑記憶跑的」）。外派的 `route` / `tier_basis` 另有既有讀者 |
| 載入路徑 | 本節（散播到 consumer `.claude/rules/flow-work-tracking.md`，paths-gated 於 `vendor/scripts/flow/**`） |

### per-decision rule attribution：永久放棄

「這條規約影響了這個決定」**本質不可觀測**。載入 ≠ 觸發：規約進了 context 不代表它在那個決定上起了作用，而起了作用的那次也可能是模型從別處推出同一個結論。任何要 agent 自報「我這一步依據了哪條 rule」的欄位都是**測不準的治理劇場**——它會被填滿，而填出來的東西沒有任何獨立來源可以校驗。

逐 session 的「載入了哪些 rule」清單一併放棄：講不出常設消費端。

**替代品是 `clade_version` + `rule_bundle` 指紋**，它回答的是真正被問過的那個問題——「做壞那次是哪一版規約」。**NEVER** 拿「多記一個欄位也不會怎樣」重開這一格：這段話存在的唯一理由，就是免得半年後再被提一次。
