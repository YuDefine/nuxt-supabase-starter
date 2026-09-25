---
description: flow spine 的 work 生命週期契約——一件 work 何時誕生、誰鑄名、`work.done` 的憑證強度、驗收由誰按；動到 vendor/scripts/flow/** 或 .clade/flow/** 時 path-scoped 載入
paths:
  - 'vendor/scripts/flow/**'
  - '.clade/flow/**'
  - 'vendor/review-gui-web/pages/work/**'
---
<!-- Clade native rule; source: rules/core/flow-work-tracking.md; edit canonical source -->

<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# flow work 生命週期契約

## 一件 work 是什麼

**一件 work = 一個人可指認、可驗收的問題。** 誕生在被指認的當下（Notion ticket triage / 客訊轉述 / 建 `tasks/` 檔 / `wt-helper add` / 開 TD），結束在 `work.accept` 或 `work.drop`。

一次 dispatch 通常是 **span**，不是 work：relay / fanout 預設沿用 `CLADE_WORK_ID`。只有明確建立 parent relation（有 relation receipt）時才有帶 `parent_work_id` 的 child work；不要從 fanout 數量推導 work 階層，也不要把明確的 `work.link` / child-work relation 壓平。

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

這是整套設計**唯一**的 fail-closed 點——寬鬆的 done 讓驗收建立在假的完成上。

`work.done` 的 emit 權在**做完的那個 agent**，掛在五個既有動作上：

| 場景 | 既有動作 | 怎麼掛 |
| --- | --- | --- |
| dispatch 收尾 | `--complete success` | 加 `--work-done --verification '<摘要>'`。**opt-in 明示**：pane success **NEVER** 自動升級成 work done（`dispatch-common.md` 那條 NEVER 仍然有效）。同時帶 `--followup-brief` 時機械拒絕 `--work-done` |
| attended session 直接做完 | `/handoff park` \| `relay` | ambient work 存在且無殘工要交接 → 順路 `flow done <id> --verification`；有殘工 → emit `work.park`。`relay` 走 Step 1.5：**同一件事的續集 NEVER emit**（successor 要接著做），ambient work 本身已完成才 emit |
| 做的人沒宣告、收割者判定落地 | `--adjudicate --disposition landed` | landed 且該 work 無其他 in-flight span → 順路 emit done，`verification` 引 adjudication 的 `--reason` |
| worktree land 收尾 | `wt-helper merge-back` | 加 `--work-done --verification '<摘要>'`。**opt-in 明示**；與 `--dry-run` 互斥；caller 的 verification 逐字保留，工具觀測到的落地事實（squash / cleanup / staged-pending）附加在後。記給**worktree claim 綁定的卡**（`wt-helper add` 當下寫進 claim），ambient `CLADE_WORK_ID` 只當 fallback；兩者不一致或兩者皆無 → 在動 main 之前拒絕（ambient 活不過單次 Bash 呼叫；記錯卡的 `work.done` 只能事後用 `flow reopen` 追加撤回，撤回前每個讀者都已把那張卡讀成完成） |
| 標準層散播收尾 | `/clade-publish` Step 9b | ambient `CLADE_WORK_ID` 非空**且** publish 是那件 work 的最後一步 → `flow done`；publish 只是其中一步 → 跳過 |

**NEVER** 用「這件事很明顯做完了」「pane 回 success 就是做完」跳過憑證。

### 憑證是 commit 時，MUST 已經 push（warn-only，不 block）

`--artifact commit:<sha>` 只存在於本機時，`flow done` 在登記當下量（`git cat-file -e` ＋ `git branch -r --contains`），量不到就標 `unverified_artifact: true`：

| 這件事 | 會怎樣 |
| --- | --- |
| 登記本身 | **照樣寫入** |
| 驗收佇列 | 那一列**不排** |
| 24 小時後 | `flow status --stalled` 出 `done-unverified`，印出重跑的指令 |
| push 之後 | 重跑一次 `flow done <id> --verification '<同一句>'`，fold 是 last-write-wins，標記就清了 |

**NEVER 把它改成拒寫**（未 push 只是還沒到；擋下會逼人先推空 commit）。**NEVER 用 `git ls-remote` 之類的網路呼叫來「驗得更準」**（離線時卡住，且失敗與「沒 push」同形）。沒有 commit artifact 時這條不適用，**NEVER** 把 `url:` 工作標成憑證未驗。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 有 commit artifact 且一個都驗不出已 push → payload 標 `unverified_artifact`、stderr 印下一步、驗收列不排。**warn-only，不 block**；git 本身問不出來時 fail-open（不標） |
| 消費端 | 打 `flow done` 的那個人（當下 stderr）；`buildDecisionQueue` 的驗收列（`pendingAcceptItems`）；`flow status --stalled` 與 `/decisions` 的 `done-unverified`（>24h） |
| 載入路徑 | 本節由各 target adapter 投影；判定器 `vendor/scripts/flow/landing.ts` 的 `unverifiedCommitArtifacts`，與 R1 的出版證據共用同一份「已 push」判準 |

### dispatch 還沒回報時，驗收列同樣不排

`work.done` 與 dispatch 完成握手是兩個獨立寫入。判準是**有沒有沒 end 的 `session_transport`**（**NEVER** 放寬成「有沒有沒 end 的 span」——掛著一題沒回的 `decision.request` 會讓驗收列永久消失）。**NEVER** 讀成「工作沒做完」，只是還不能問。被擋下的工作 **MUST 在佇列上列名**（合併卡或第一列驗收列，共用 `decisions.ts` 的 `transportHeldLines`），**NEVER** 讓其中一條路徑靜默。

## R2 入口鑄名索引（informational — 不觸發任何東西）

義務燒在各入口的 code path 裡，本表只給**未來新增入口的開發者**一份對照。新增一個「事情從這裡誕生」的入口時照同一個形狀鑄名。

| 入口 | 鑄名者 | fail 姿勢 |
| --- | --- | --- |
| `/handoff relay` / `fanout` | 不鑄，繼承 env；無 ambient 時 adapter 用 label 降級鑄名 | fail-open |
| `/wt`（`wt-helper add`） | 用必填 `--task-summary` 鑄名並印 `export CLADE_WORK_ID=…` | fail-open |
| `notion-hub` 認領客戶票 | 每一張認領的 ticket 都鑄一個，`origin_ref: notion:<uuid>`——不是只處理第一張 | fail-open |
| `notion-sync.ts file`（工程師發現即建票） | 建票後由 script 自己 `flow open --origin notion:<uuid>` 並把 work_id 寫回票的 `Work ID` | fail-closed：票已建但 flow open 失敗 → 印出補跑指令 |
| `notion-hub` 問客戶 | 已有 work item 就沿用；沒有就等客戶回覆後走認領客戶票那一列 | fail-open |
| `tasks/<date>-<slug>.md` | 建檔順路 `flow open <slug>`，`origin_ref: tasks:<路徑>` | fail-open |
| 臨時小改動（單 session 內做完） | **刻意不鑄**——orphan 是這一格的正確結局 | — |
| 客戶通訊軟體 | 人轉述 → agent 判跨 session 就開 `tasks/` 檔，退化成上一列 | 無機械兜底可能 |

本表的失效模式是 orphan 佔比回升，而那由 R3 機械量測，不會零偵測。**本節不新增任何義務**：看到某個入口沒鑄名，去改那個入口的 code，不是來改這張表。

## R3 orphan 佔比訊號

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 近 7 天新增事件的 `orphan-` 佔比 > 25% 時 `flow status` 印 warn。**warn-only，不 block** |
| 消費端 | 各 target adapter 配置的 attended-session status entry；只有有實際 invocation receipt 才能宣稱自動帶出 |
| 載入路徑 | 本節由各 target adapter 投影，並與 clade home 的 `clade-role-and-todo-discipline.md` § 停滯訊號對接 |

存量 orphan **不追溯**：佔比只看近 7 天新增，改動的效果才看得出來。

## origin 與 carrier 是同一套 scheme，方向相反

`<scheme>:<id>`，兩邊共用 resolver：`notion:<uuid>` / `im:<一句話>` / `td:TD-NNN` / `tasks:<路徑>` / `handoff:<段名>`。

- **origin**（在 `work.open` 上）= 這件 work 從哪誕生
- **carrier**（在 `decision.request` 上）= 這個 decision 的答案落到哪

同一件 work 的 origin 與其 decisions 的 carrier 可以不同（Notion 來的工作，中途拍板題落 HANDOFF）——這是特性，**NEVER** 當成要修的不一致。

### 單向指向（本設計的支柱）

結構化端（spine / `DispatchRecord` / awaiting）持指標**指向** prose 世界；prose 端（TD entry / HANDOFF / `tasks/` 檔 / Notion 頁）**NEVER 回指 work_id**（沒有機械稽核，必然 drift）。例外只有兩個，入場條件都是「有已經在跑的機械消費端在讀它」：

| 例外 | 誰在讀 | 邊界 |
| --- | --- | --- |
| `/handoff park` 落的 HANDOFF / TD 段文字帶 work_id | 接手的下一個 session | park 是四個 arg 裡唯一純 prose 落檔、park 後**沒有任何結構化載體存活**的，所以這一筆 **MUST** 帶。寫入者是 skill 步驟 |
| `tasks/<date>-<slug>.md` 檔頭的 `work_id:` | `scripts/audit-stale-tasks.ts`（拿它把 archivable 從年齡推定升級成收尾證據） | **選填，NEVER 變強制**——缺欄位 **NEVER** 報違例、**NEVER** 讓任何 gate 因此擋人（[[session-tasks.operations]] § 寫入規約補充） |

**NEVER** 在這兩格之外新增回指；要新增第三格，先講得出誰在讀。

## 可重驗的驗收：`flow done --verify-cmd`

`--verification '<摘要>'` 記的是「當時驗過了」；`--verify-cmd '<指令>'` 多留一條**現在還能再跑一次**的指令。帶了指令的完成宣稱，`flow sources --apply --reverify` 對帳時機器代跑一次：

| 指令結果 | spine 落什麼 | 之後 |
| --- | --- | --- |
| exit 0 | `work.accept`（`accepted_by: 'machine-reverify'`、`actor: 'system'`） | 不再問人 |
| exit ≠ 0（且不是 126/127、輸出不帶環境錯誤簽名） | `work.reopened`（`cause: 'evidence_insufficient'`，reason 帶 exit code 與輸出尾巴） | 回到 agent 手上修——NEVER 變成問人的卡 |
| 跑不起來／逾時（126、127、spawn 失敗、signal、依賴沒裝、輸出帶環境錯誤簽名如 `command not found`／`Cannot find module`） | 什麼都不寫 | 照舊排驗收列問人。**判不出來 NEVER 翻成通過，也 NEVER 翻成沒過** |

- **指令 MUST 唯讀**（唯讀檢查：測試、lint、`test -f`、`git status` 這類）。它會在 operator 的 repo root 原樣執行；寫東西、動服務、`rm` 一律 NEVER。
- **執行是 opt-in**：`verify_cmd` 是 spine payload 裡的字串，任何能寫 spine 的 agent 都寫得進去，所以 `sources --apply` 預設**只列出不跑**，帶 `--reverify` 的那趟才真的執行。NEVER 讓例行對帳路徑（hook、cron、無 `--reverify` 的 `--apply`）執行這些指令。
- **dry-run NEVER 跑指令**——dry-run 的承諾是什麼都不動。
- 時限 120 秒，逾時歸「跑不起來」；同一宣稱（同 work_id＋done_ts＋指令）15 分鐘內不重跑（`.clade/flow/reverify-attempts.json` 退避窗，本機狀態，壞了只代表退避失效）。
- **只有散文 verification 的件 NEVER 自動收**——猜一段話算不算「現在仍為真」正是這個設計要避免的事。
- 寫裁決前重讀 spine：`done_ts` 變了（reopen／重新宣告）、dispatch 還在飛、或已不具候選資格 → 該輪不寫。NEVER 用「再跑一次指令」代替重讀。

## 驗收權歸實際擁有它的人

| work 類型 | 驗收者 | 怎麼落 spine |
| --- | --- | --- |
| `notion:` origin | **客戶**（board 狀態欄本來就是他們的驗收介面） | `notion-hub` 對帳驗收讀到客戶側狀態進終態 → emit `work.accept {accepted_by: 'customer', reason: <狀態值>}` |
| 其餘全部（`td:` / `tasks:` / `handoff:` / `im:`） | 人，經 /board 驗收按鈕或 `flow accept <id> --reason` | `reason` 必填 |

`work.accept` / `work.drop` **NEVER** 由 agent 代按（landing 證據自動 accept 見 [[decision-authoring]]）。

## spine 可信的是「發生過」，MUST 實跑的是「現在是」

spine 是**事件流**：它記錄「某個時刻有人做了什麼、宣稱了什麼」。它 **NEVER** 是系統的當前狀態快照——沒有任何事件會在世界改變時自己跟著改。

| 可以信 spine | MUST 仍實跑 |
| --- | --- |
| 歷程：誰在何時做過什麼、span 順序、耗時 | 任何**寫入動作的前置條件**：樹乾不乾淨、檔案持有權、測試綠不綠 |
| 宣稱的存在與其憑證**文本**（`work.done` 帶了什麼 `verification`） | **那份憑證現在是否仍為真**——驗收前重跑 verification 指的那個驗證 |
| 決策問答史、artifacts 座標、origin / carrier | deploy 活著沒、endpoint 通不通、檔案現在的內容 |
| **路由問題**：下一步找誰、從哪接、誰是持有者 | **行動問題**：現在能不能安全地做 |

分界線是**時效**：左欄寫下就永遠為真，右欄只在被量到的那一刻為真（與 [[session-tasks]]「NEVER 讀 HANDOFF 文字當現況」同一原則）。**NEVER** 因為 spine 上有 `work.done` 就跳過驗收前的實跑——R1 要求的是憑證存在，**不是**憑證仍然成立。

## 治理軌跡：`session_summary`

回答「那一次是什麼檔位、走過哪些 skill、外派了誰、是哪一版規約」。producer 與掛載入口由 runtime adapter 各自證明；**NEVER** 把一個 target 的收集路徑讀成其他 runtime 已自動收集。

**不帶 work_id**（`work_id: null`，validator 雙向強制）——它是 session 的性質；歸屬在讀端 join on `session_id`。它不出卡、不進 R3 orphan 的分子也不進分母。

三條硬規則：

- **NEVER 收錄 `<command-args>` 原文**（使用者原話可能含 redact 攔不到的業務細節）。只收 `{name, mode, invoked_by}`，`mode` = args 首 token **且 MUST 命中** `KNOWN_SKILL_MODES`，否則記 null
- **治理欄位一律裸名稱或 repo 相對路徑，NEVER 絕對路徑**
- **parser MUST fail-open**：parse 不出就缺席 + 一行 warn，**NEVER 讓它擋 session start**。transcript 是 harness 內部格式、無穩定契約

一個 session 有兩筆事件，靠 `payload.source` 分辨（`session-start-stamp` / `transcript-parse`），逐 source last-write-wins；讀端取兩者聯集，**NEVER 只取該 session 最新的那一筆**。

`clade_version` 只在開場 stamp 量得到；歷史 session **記 null，NEVER 用 parse 時的 git HEAD 或今天的版本推導補**。runtime 產品版本欄位不是 `clade_version`。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | **informational — 不觸發任何東西** |
| 消費端 | `flow brief --work-id` 卷宗（successor 判「燒了幾個 session、什麼檔位、走過哪些 skill」）＋ 事後歸因（「那次是 invoke 了 clade-publish 還是憑記憶跑的」）。外派的 `route` / `tier_basis` 另有既有讀者 |
| 載入路徑 | 本節由各 target adapter 投影（paths-gated 於 `vendor/scripts/flow/**` 的 target projectRoot） |

### per-decision rule attribution：永久放棄

「這條規約影響了這個決定」本質不可觀測（載入 ≠ 觸發），要 agent 自報的欄位無法校驗；逐 session 的「載入了哪些 rule」也講不出消費端。替代品是 `clade_version` + `rule_bundle` 指紋。**NEVER** 重開這一格。
