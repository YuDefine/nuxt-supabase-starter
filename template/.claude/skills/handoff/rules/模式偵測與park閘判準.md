<!-- 跨檔的「下方／上方 §」皆指 rules/ 下同名段落 -->

## Step 0.1 — Value-first continuation gate（四種模式共用）

`park`、`relay`、`fanout`、`next` 都 MUST 先判斷是否仍值得保留 continuation。只有目前可驗證的 customer／product demand、current incident／data-security risk，或直接阻擋交付且可 bounded fix 的 blocker 至少一項成立，才可列為 continuation candidate；age、unknown、未落地、commit 數與「可能有價值」都不算。三者皆無時標記 `retired`／`cancelled`、保存 evidence、continuation candidates 固定為 0；歷史 worktree／branch 依下方 § 3.5.1 入口處理。`relay`／`fanout` 的 dispatch details 見 [dispatch-common.md](../dispatch-common.md) § 0.1；`park` 也受本 gate 約束，即使不開 pane。

## Step 0 — 解析參數

先解析 invocation args，**在 Step 1 之前分流**：

| Args | 開幾個 pane | 動作 |
| --- | --- | --- |
| 無參數 | 依判定結果 | **先過 Step 0.5 context 預算 gate**，未被 gate 改道才進 Step 1 兩層自動判定，落到 `park`／`relay`／`fanout`／`next` 其一 |
| `park` / `park <一句工作描述>` | 0 | 進 § park：只把未完項登記進 HANDOFF／TD／ROADMAP，收工。**user 顯式打 `park` 本身就是允許**，不必再問 |
| `relay` / `relay <一句工作描述>` | 1 successor | **MUST Read [relay-steps.md](../relay-steps.md) 全文並照順序執行** |
| `fanout` / `fanout <一句工作描述>` | N worker + 1 successor | **MUST Read [fanout-steps.md](../fanout-steps.md) 全文並照順序執行** |
| `next` | 依盤點結果 | **先過 Step 0.5 context 預算 gate**；未被改道才進 § next：先跑 health gate／worktree／TD hygiene 盤點，再決定派什麼，收工 |

**判準是「手上有幾件可平行的工作」，而預設方向是「派出去」**：1 件（含多件但彼此 serial）→ `relay`；N ≥ 2 件可平行 → `fanout`；還不知道有幾件 → `next`（盤點完會落到前三者之一）；**0 件才輪到 `park`，而裸 `/handoff` 自動判定落到 `park` 時 MUST 先取得 user 允許**（見 Step 1 § park gate）。

`relay` 與 `fanout` 是**優先選項**，判定成立就直接派，**NEVER** 再回頭問 user「要不要派」（接手的 pane 是互動式的，可以直接問 user）。

「可平行」走 [dispatch-steps.md](../dispatch-steps.md) § Serial vs Parallel 評估的四條 rubric，**四條全成立**才算。任一條不成立就是 serial，合併成一份 brief 走 `relay`。

**`relay` 與 `fanout` 的共用底座是 [dispatch-common.md](../dispatch-common.md)**：preflight、durable thin brief 紀律、`--label` 要求、runtime cleanup、parent worktree lifecycle、收工訊息契約。兩支 steps 檔只寫各自差異。

> `now` 已於本版**廢除**：舊 `/handoff now <task pointer>` 一律改走 `relay`（單件）或 `fanout`（多件可平行）。

## Step 0.5 — Session context 預算 gate（MUST，早於 Step 1）

**`next` 是四個 arg 裡唯一會在當前 session 燒掉大量 context 的**（前載一連串 scan，終點 2B.5 在當前 session 內呼下一件工作）——那正是 [[session-tasks]] § Session context 預算 過門檻後 MUST 停的事。**本 gate 對裸 `/handoff` 與顯式 `next` 同等生效。**

### 可觀察 predicate（用訊號，NEVER 憑感覺估）

門檻取 [[session-tasks]] § Session context 預算的 launcher profile（數字的 SoT 是 `session-context-budget-warn.sh` 的 profile 表）。`ccg`／`ccx` 已拆除、不是可用 launcher：gateway session 的 handoff fail closed，不自行改派其他 runtime；只有 user 明確點名時才可改交仍支援的 launcher。會進入共用 Herdr 流程的 runtime 原生繼承當前 session（`cc → cc`、`ccN → ccN`），工作 routing 不得覆蓋。判定材料只認下列三種**在 transcript 裡看得到**的訊號：

1. `session-context-budget-warn` hook 已在本 session 響過（它逐字報「session context 已達 Nk」）
2. user 在訊息裡明講了 context 用量（「目前已經 43%」「快滿了」）
3. harness 顯示的 context 百分比

三者皆無 → 視為未過門檻，照 Step 1 正常判。**NEVER** 因為「感覺跑很久了」就自行判定過門檻，
也 **NEVER** 因為「還沒看到 hook」就無視 user 明講的百分比。

**身分豁免**：in-process subagent 與 Herdr 顧問 pane（`CLADE_ADVISORY_SESSION=1`）不改道；hook 另留的 Fable 系列主線豁免因 Fable 已禁用（2026-09-24）不會觸發（判準在 `capabilities/core/hooks/session-context-budget-warn.sh` 的身分豁免段）。**NEVER** 從工作性質自評身分。

### 分流

評估：first-match；以上皆非 → G*
| id | 可觀察 predicate | 動作 |
| --- | --- | --- |
| G1 | 已過**該 launcher 的 hard tier** | **跳過** 2B.0–2B.1.9 全部 scan（盤點本身有價值，但要由乾淨 session 做），改依**當前已知**的殘工件數直接落 `relay`／`fanout`；**每一項**都講得出具體外部條件時才 `park`（仍受 § park gate 管）。**NEVER** 因為「已經滿了、沒餘裕再派」就直接 `park`——那一級是**最該派**的時刻 |
| G2 | 已過**該 launcher 的 soft tier** | **NEVER 落 `next`**。改依 Step 1 第二層的件數判：≥1 件派得出去 → `relay`（1 件或多件 serial）／`fanout`（N 件可平行）；0 件 → `park` |
| G* | 未過門檻 | 不改道，照 Step 1 兩層判定 |

被本 gate 改道時 **MUST** 在宣布偵測結果那句話裡寫出來（例：「偵測到 `relay`（Step 0.5：context
已達 43%，過第一級門檻故不落 `next`；第二層：1 件派得出去）」），**NEVER** 靜默改道。

### 逐字反開脫

- ❌「盤點很快，跑完再收」——`next` 的四個 scan ＋ triage 就是「大工作段」本身，不是收尾
- ❌「先跑 scan 看看有什麼，再決定要不要收工」——順序反了，過門檻就是收工，scan 交給下一個 session
- ❌「user 是打 `next`，我照做就好」——顯式 arg 不豁免本 gate（見上）
- ❌「只差 2B.5 dispatch 沒做，其他都跑完了」——2B.5 正是把新工作塞進這個 session 的那一步
- ❌「context 已經過第二級了，沒餘裕再派，先登記就好」——跳過的是 scan，不是派工（見 G1）

## Step 1 — 偵測模式（只有裸 `/handoff` 才跑）

顯式帶了 arg 就**跳過本步**，直接進對應分支（Step 0.5 的 gate 除外，它對顯式 `next` 也生效）。

「Session」=**當前這個 chat session**，不是 working tree / git state / 檔案系統狀態（那些都可能來自別的並行 session）。

分兩層判：**先判當前 session 有沒有未交辦工作**，有的話**再判其中幾件派得出去**。

### 第一層 — 當前 chat session 有沒有未交辦工作

**有**（任一條成立）→ 進第二層：
- 當前對話與已載入 task carrier 記錄顯示當前 session 任何 `in_progress` 或 `pending` task（該 inventory 是 per-session host state，可信）
- 當前 chat 對話脈絡明顯顯示 user 正在 mid-task（我剛在做某事還沒收尾、user 剛交辦一個多步驟工作做到一半）
- Stop hook 攔住但 acceptance 未滿足 + 處於 [[wt]] 的 `rules/改tracked檔前先隔離判準.md` Rule 5 死鎖（cwd 在 main + main 已 dirty）且當前 session 已自評不適合走該 Rule 的「剩下的事可以隔離」出口（context 不寬裕 / 剩餘 work 不小 / 無法 selective stash）

**沒有** → `next`：以上皆否（即使 working tree 髒、tasks/ 有別 session 的 unchecked、`specs/plans/**` 有別 session 的 active work，都仍走 `next` —— 那些屬於別 session 的責任）。

**禁止訊號**（這些都不算「當前 session」狀態）：
- ❌ `git status --short` 有 dirty file
- ❌ `tasks/<YYYY-MM-DD-HHMM>-*.md` 存在或有 unchecked 項
- ❌ `specs/plans/NNN-<slug>/tasks.md` 有 unchecked 項
- ❌ `HANDOFF.md` 有 In Progress 段落

### 第二層 — 其中幾件派得出去

對**每一項**未交辦工作問「它派得出去嗎」。**「派不出去」MUST 講得出具體外部條件**，只有兩類算數：等一個具體外部 signal、被別 session 的未 commit 檔擋住（判準 SoT 在 [[session-tasks.operations]] § 收工三步，此處不複述）。「需要人判斷」「要謹慎」「這個比較複雜」「要 attended」**都不是**外部條件——派出去的是互動式 pane，需要拍板的直接在那個 pane 問 user。

| 派得出去的件數 | 落到 |
| --- | --- |
| 1，或多件但彼此 **serial** | `relay` — 直接派，不問 |
| N ≥ 2 且四條 parallel rubric 全成立 | `fanout` — 直接派，不問 |
| 0（**每一項**都講得出具體外部條件） | `park` — **MUST 先過下方 § park gate** |

### park gate（裸 `/handoff` 專用，MUST）

**可觀察 predicate：這一輪 `/handoff` 會不會開出任何 pane？** 不會 → **MUST 依詢問操作取得 user 允許才 park**，**NEVER** 自行決定。允許的形式只有兩種：user 顯式打了 `/handoff park`，
或 user 對這一次的詢問答了「可以」。

問法 MUST 附**為什麼派不出去**——逐項列出那個具體外部條件，讓 user 當場判得出理由站不站得住。
問句 MUST 給 `park` 與「還是派出去」兩個選項，**NEVER** 只問「這樣可以嗎」。

Predicate 綁的是**結果**不是路徑，所以「先自己做掉再 park」同樣命中（同樣沒有 pane 被開出來）。

**Rationalization table（逐字實錄，看到自己正要說出其中一句就停）**：

| 藉口 | 現實 |
| --- | --- |
| 「這件是單檔 2 分鐘的收尾，交出去等於讓下一個 session 重建 context」 | 照這句判，結果是**沒有任何 pane 被派出去**。工作量小不是外部條件，是偏好 |
| 「它是本 session 自己造出來的殘留，先做完再收工比較乾淨」 | 「誰造的」不改變它派不派得出去。做完再 park 的可觀察結果與直接 park 相同 |
| 「先登記起來，下個 session 會看到」 | 登記是 [[session-tasks.operations]] § 收工三步的**第 2 步**；第 1 步是派出去。跳過第 1 步就是這條 gate 要擋的 |
| 「這幾件還是我自己比較清楚」 | context 在 durable brief 裡，不在你腦裡。寫不出 brief 才是真的講不清楚——那要說出來，不是拿來當不派的理由 |
| 「需要人判斷 / 要謹慎 / 要 attended」 | 派出去的是**互動式** pane，要拍板的直接在那個 pane 問 user。這在第二層已經明講過，不是外部條件 |
| 「user 剛才叫我 handoff，意思就是收工登記」 | `/handoff` 的四個 arg **全部**收工，差別只在開幾個 pane。「收工」推不出「不派」 |

**Red flags（發現自己在想這些就停下來重判）**：

- 正在盤算「做完這一件就沒有未交辦工作了」
- 正在把某項的「派不出去」理由寫成形容詞（複雜 / 敏感 / 微小 / 收尾性質）而不是具體外部 signal
- 已經開始寫 HANDOFF 升級條目，但還沒問過 user

宣布偵測結果一句話，**兩層都要寫**：「偵測到 `fanout`（第一層：當前對話與已載入 task carrier 記錄有 3 個 in-progress；第二層：3 件都派得出去且檔案不重疊）」或「偵測到 `next`（當前 session 清空）」。落到 `park` 時**第三段要寫 gate 結果**：「park gate：已取得 user 允許」或「park gate：詢問中」。
